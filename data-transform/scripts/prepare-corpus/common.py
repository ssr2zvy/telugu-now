from __future__ import annotations

import hashlib
import json
import math
import shutil
import sqlite3
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import regex

CORPUS_FORMAT_VERSION = 1
COMPLEXITY_METRIC = "grapheme-count"
COMPLEXITY_METRIC_VERSION = 1

SPLIT_ALIASES = {
    "train": "train",
    "test": "test",
    "dev": "validation",
    "valid": "validation",
    "validation": "validation",
}


class CorpusStructuralError(RuntimeError):
    pass


class RowRejected(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class CanonicalInputRow:
    source_id: str
    source_key: str
    canonical_split: str
    upstream_split: str
    text: str
    audio_bytes: bytes
    audio_mime_type: str
    audio_extension: str
    duration_seconds: float
    source_metadata: dict[str, Any]


def canonical_split(value: str) -> str:
    normalized = value.strip().lower()
    try:
        return SPLIT_ALIASES[normalized]
    except KeyError as error:
        raise CorpusStructuralError(f"UNKNOWN_SPLIT:{value}") from error


def grapheme_count(text: str) -> int:
    normalized = unicodedata.normalize("NFC", text)
    return len(regex.findall(r"\X", normalized))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def validate_text(text: str) -> str:
    value = text.strip()
    if not value:
        raise RowRejected("EMPTY_TEXT", "Canonical text is empty.")
    if grapheme_count(value) <= 0:
        raise RowRejected("EMPTY_COMPLEXITY", "Grapheme count is zero.")
    return value


def validate_duration(value: float) -> float:
    if not math.isfinite(value) or value <= 0 or value > 3600:
        raise RowRejected("INVALID_DURATION", f"Invalid duration: {value}")
    return value


def detect_audio(audio: bytes) -> tuple[str, str]:
    if not audio:
        raise RowRejected("EMPTY_AUDIO", "Audio payload is empty.")
    if audio.startswith(b"RIFF") and audio[8:12] == b"WAVE":
        return "audio/wav", ".wav"
    if audio.startswith(b"fLaC"):
        return "audio/flac", ".flac"
    raise RowRejected("UNSUPPORTED_AUDIO_FORMAT", "Unknown audio signature.")


class CorpusWriter:
    def __init__(self, output_dir: Path, *, replace: bool = False) -> None:
        self.output_root = output_dir.resolve()
        self.replace = replace
        self.working_root = self.output_root.parent / f".{self.output_root.name}.tmp"
        if self.working_root.exists():
            shutil.rmtree(self.working_root)
        self.working_root.mkdir(parents=True, exist_ok=True)
        self.db_path = self.working_root / "corpus.sqlite"
        self.objects_dir = self.working_root / "objects"
        self.reports_dir = self.working_root / "reports"
        self.objects_dir.mkdir(parents=True, exist_ok=True)
        self.reports_dir.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.db_path)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self._initialize_schema()

    def _initialize_schema(self) -> None:
        self.conn.execute(
            """
            CREATE TABLE sources (
                source_id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                provider TEXT NOT NULL,
                license TEXT NOT NULL,
                upstream_url TEXT,
                catalog_version INTEGER NOT NULL,
                accepted_rows INTEGER NOT NULL DEFAULT 0,
                rejected_rows INTEGER NOT NULL DEFAULT 0,
                complexity_metric TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ready'
            )
            """
        )
        self.conn.execute(
            """
            CREATE TABLE source_rows (
                source_id TEXT NOT NULL,
                source_key TEXT NOT NULL,
                canonical_split TEXT NOT NULL,
                upstream_split TEXT NOT NULL,
                text TEXT NOT NULL,
                grapheme_count INTEGER NOT NULL,
                text_sha256 TEXT NOT NULL,
                audio_sha256 TEXT NOT NULL,
                audio_object_key TEXT NOT NULL,
                audio_mime_type TEXT NOT NULL,
                duration_seconds REAL NOT NULL,
                source_metadata_json TEXT NOT NULL,
                PRIMARY KEY (source_id, source_key)
            )
            """
        )
        self.conn.execute(
            """
            CREATE TABLE source_complexity_members (
                source_id TEXT NOT NULL,
                grapheme_count INTEGER NOT NULL,
                class_index INTEGER NOT NULL,
                source_key TEXT NOT NULL,
                PRIMARY KEY (source_id, grapheme_count, class_index)
            )
            """
        )
        self.conn.execute("CREATE INDEX idx_source_rows_source_id ON source_rows(source_id, grapheme_count)")
        self.conn.commit()

    def add_source(
        self,
        *,
        source_id: str,
        display_name: str,
        provider: str,
        license_name: str,
        upstream_url: str,
        catalog_version: int,
        expected_audio_mime: str,
        rows: Iterable[CanonicalInputRow],
    ) -> None:
        if self.conn.execute("SELECT 1 FROM sources WHERE source_id = ?", (source_id,)).fetchone():
            raise CorpusStructuralError(f"SOURCE_ALREADY_EXISTS:{source_id}")

        accepted: list[dict[str, Any]] = []
        rejected: list[str] = []
        seen_keys: set[tuple[str, str]] = set()

        for row in rows:
            source_key = (source_id, row.source_key)
            if source_key in seen_keys:
                raise CorpusStructuralError(f"SOURCE_KEY_COLLISION:{source_id}:{row.source_key}")
            seen_keys.add(source_key)
            try:
                text = validate_text(row.text)
                duration = validate_duration(row.duration_seconds)
                audio_mime_type, extension = detect_audio(row.audio_bytes)
                if audio_mime_type != expected_audio_mime:
                    raise RowRejected("WRONG_AUDIO_MIME", f"Expected {expected_audio_mime}, got {audio_mime_type}")
                object_key = f"objects/media/{source_id}/audio/{sha256_bytes(row.audio_bytes)}{extension}"
                audio_object = self.working_root / object_key
                audio_object.parent.mkdir(parents=True, exist_ok=True)
                if not audio_object.exists():
                    audio_object.write_bytes(row.audio_bytes)
                metadata = json.dumps({**row.source_metadata, "audioMimeType": audio_mime_type}, ensure_ascii=False, sort_keys=True)
                accepted.append(
                    {
                        "source_id": row.source_id,
                        "source_key": row.source_key,
                        "canonical_split": row.canonical_split,
                        "upstream_split": row.upstream_split,
                        "text": text,
                        "grapheme_count": grapheme_count(text),
                        "text_sha256": sha256_text(text),
                        "audio_sha256": sha256_bytes(row.audio_bytes),
                        "audio_object_key": object_key,
                        "audio_mime_type": audio_mime_type,
                        "duration_seconds": duration,
                        "source_metadata_json": metadata,
                    }
                )
            except RowRejected as exc:
                rejected.append(json.dumps({"code": exc.code, "message": str(exc), "source_key": row.source_key}, ensure_ascii=False))

        report_path = self.reports_dir / f"{source_id}-rejected.jsonl"
        report_path.write_text("\n".join(rejected) + ("\n" if rejected else ""), encoding="utf-8")

        self.conn.execute(
            "INSERT INTO sources (source_id, display_name, provider, license, upstream_url, catalog_version, accepted_rows, rejected_rows, complexity_metric, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')",
            (source_id, display_name, provider, license_name, upstream_url, catalog_version, len(accepted), len(rejected), COMPLEXITY_METRIC),
        )
        self.conn.executemany(
            """
            INSERT INTO source_rows (
                source_id, source_key, canonical_split, upstream_split, text,
                grapheme_count, text_sha256, audio_sha256, audio_object_key,
                audio_mime_type, duration_seconds, source_metadata_json
            ) VALUES (
                :source_id, :source_key, :canonical_split, :upstream_split, :text,
                :grapheme_count, :text_sha256, :audio_sha256, :audio_object_key,
                :audio_mime_type, :duration_seconds, :source_metadata_json
            )
            """,
            accepted,
        )

        ordered = sorted(accepted, key=lambda item: (item["grapheme_count"], item["source_key"]))
        for grapheme_count_value in sorted({row["grapheme_count"] for row in ordered}):
            members = [row for row in ordered if row["grapheme_count"] == grapheme_count_value]
            for index, row in enumerate(members):
                self.conn.execute(
                    "INSERT INTO source_complexity_members (source_id, grapheme_count, class_index, source_key) VALUES (?, ?, ?, ?)",
                    (source_id, grapheme_count_value, index, row["source_key"]),
                )
        self.conn.commit()

    def finalize(self) -> None:
        source_rows = self.conn.execute("SELECT COUNT(*) FROM source_rows").fetchone()[0]
        source_members = self.conn.execute("SELECT COUNT(*) FROM source_complexity_members").fetchone()[0]
        sources = self.conn.execute("SELECT source_id, accepted_rows FROM sources").fetchall()
        total_accepted = sum(row[1] for row in sources)
        if total_accepted != source_rows:
            raise CorpusStructuralError(f"ACCEPTED_ROW_MISMATCH:{total_accepted}!={source_rows}")
        if source_members != source_rows:
            raise CorpusStructuralError(f"COMPLEXITY_MEMBER_MISMATCH:{source_members}!={source_rows}")

        manifest = {
            "corpus_format_version": CORPUS_FORMAT_VERSION,
            "complexity_metric": COMPLEXITY_METRIC,
            "complexity_metric_version": COMPLEXITY_METRIC_VERSION,
            "generated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
            "sources": [
                {
                    "source_id": row[0],
                    "accepted_rows": row[1],
                    "rejected_rows": self.conn.execute("SELECT rejected_rows FROM sources WHERE source_id = ?", (row[0],)).fetchone()[0],
                    "status": self.conn.execute("SELECT status FROM sources WHERE source_id = ?", (row[0],)).fetchone()[0],
                } for row in sources
            ],
        }
        (self.working_root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        self.conn.close()
        if self.output_root.exists():
            if self.replace:
                if self.output_root.is_dir():
                    shutil.rmtree(self.output_root)
            else:
                raise RuntimeError(f"Corpus already exists: {self.output_root}")
        if self.output_root.exists() and not self.replace:
            raise RuntimeError(f"Corpus already exists: {self.output_root}")
        if self.replace and self.output_root.exists():
            shutil.rmtree(self.output_root)
        shutil.move(str(self.working_root), str(self.output_root))

