from __future__ import annotations

import hashlib
import json
import math
import os
import tempfile
import shutil
import sqlite3
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
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
        raise CorpusStructuralError(
            f"UNKNOWN_SPLIT:{value}"
        ) from error


def normalize_source_locator(value: str) -> str:
    normalized = value.replace("\\", "/").strip()
    while normalized.startswith("./"):
        normalized = normalized[2:]

    normalized = "/".join(
        part
        for part in normalized.split("/")
        if part not in ("", ".")
    )

    if (
        not normalized
        or normalized.startswith("../")
        or "/../" in f"/{normalized}/"
    ):
        raise CorpusStructuralError(
            f"INVALID_SOURCE_LOCATOR:{value}"
        )

    return normalized


def grapheme_count(text: str) -> int:
    normalized = unicodedata.normalize("NFC", text)
    return len(regex.findall(r"\X", normalized))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def validate_text(text: Any) -> str:
    if not isinstance(text, str):
        raise RowRejected(
            "EMPTY_TEXT",
            "Canonical text is missing or is not a string.",
        )
    value = text.strip()
    if not value:
        raise RowRejected(
            "EMPTY_TEXT",
            "Canonical text is empty.",
        )
    if grapheme_count(value) <= 0:
        raise RowRejected(
            "EMPTY_COMPLEXITY",
            "Grapheme count is zero.",
        )
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
    def __init__(self, output: Path, replace: bool = False, batch_rows: int = 20) -> None:
        if batch_rows < 1:
            raise ValueError("batch_rows must be greater than 0")
        self.batch_rows = batch_rows
        self.output = Path(output).resolve()
        self.replace = replace
        self.output.parent.mkdir(parents=True, exist_ok=True)

        if self.output.exists() and not replace:
            raise FileExistsError(
                f"Prepared corpus already exists: {self.output}; "
                "pass --replace to replace it."
            )

        temporary = tempfile.mkdtemp(
            prefix=f".{self.output.name}.prepare-",
            dir=self.output.parent,
        )
        self.temporary = Path(temporary)
        self.objects_root = self.temporary / "objects"
        self.reports_root = self.temporary / "reports"
        self.objects_root.mkdir(parents=True, exist_ok=True)
        self.reports_root.mkdir(parents=True, exist_ok=True)

        self.database_path = self.temporary / "corpus.sqlite"
        self.db = sqlite3.connect(self.database_path)
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.execute("PRAGMA journal_mode = DELETE")
        self.db.executescript(
            """
            CREATE TABLE sources (
              source_id TEXT PRIMARY KEY,
              display_name TEXT NOT NULL,
              provider TEXT NOT NULL,
              license TEXT NOT NULL,
              upstream_url TEXT,
              catalog_version INTEGER NOT NULL,
              accepted_rows INTEGER NOT NULL,
              rejected_rows INTEGER NOT NULL,
              complexity_metric TEXT NOT NULL,
              status TEXT NOT NULL
                CHECK(status IN ('ready', 'fixture', 'invalid'))
            );

            CREATE TABLE source_rows (
              source_id TEXT NOT NULL,
              source_key TEXT NOT NULL,
              canonical_split TEXT NOT NULL,
              upstream_split TEXT NOT NULL,
              text TEXT NOT NULL,
              grapheme_count INTEGER NOT NULL
                CHECK(grapheme_count > 0),
              text_sha256 TEXT NOT NULL,
              audio_sha256 TEXT NOT NULL,
              audio_object_key TEXT NOT NULL,
              audio_mime_type TEXT NOT NULL,
              duration_seconds REAL NOT NULL
                CHECK(duration_seconds > 0),
              source_metadata_json TEXT NOT NULL,
              PRIMARY KEY(source_id, source_key),
              FOREIGN KEY(source_id)
                REFERENCES sources(source_id)
            );

            CREATE TABLE source_complexity_members (
              source_id TEXT NOT NULL,
              grapheme_count INTEGER NOT NULL,
              class_index INTEGER NOT NULL,
              source_key TEXT NOT NULL,
              PRIMARY KEY(
                source_id,
                grapheme_count,
                class_index
              ),
              UNIQUE(source_id, source_key),
              FOREIGN KEY(source_id, source_key)
                REFERENCES source_rows(source_id, source_key)
            );

            CREATE INDEX idx_source_rows_complexity
              ON source_rows(source_id, grapheme_count);
            """
        )
        self.db.commit()
        self.source_manifests: list[dict[str, Any]] = []
        self.finalized = False
        self.cleanup_handle: Any = None

    def consume_after_publish(self, path: Path) -> None:
        if self.cleanup_handle is None:
            self.cleanup_handle = (self.temporary / "pending-input-cleanup.jsonl").open("a", encoding="utf-8")
        self.cleanup_handle.write(json.dumps(str(path.resolve())) + "\n")

    def _cleanup_temporary(self) -> None:
        if self.cleanup_handle is not None:
            self.cleanup_handle.close()
        try:
            self.db.close()
        except Exception:
            pass
        if self.temporary.exists():
            shutil.rmtree(
                self.temporary,
                ignore_errors=True,
            )

    def _write_rejection(
        self,
        handle: Any,
        row: CanonicalInputRow,
        error: RowRejected,
    ) -> None:
        handle.write(
            json.dumps(
                {
                    "sourceId": row.source_id,
                    "sourceKey": row.source_key,
                    "upstreamSplit": row.upstream_split,
                    "errorCode": error.code,
                    "reason": str(error),
                },
                ensure_ascii=False,
            )
            + "\n"
        )

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
        if self.finalized:
            raise RuntimeError(
                "CorpusWriter is already finalized."
            )

        if self.db.execute(
            "SELECT 1 FROM sources WHERE source_id = ?",
            (source_id,),
        ).fetchone():
            raise CorpusStructuralError(
                f"DUPLICATE_SOURCE:{source_id}"
            )

        accepted_rows = 0
        rejected_rows = 0
        class_counts: dict[int, int] = {}
        rejection_path = (
            self.reports_root
            / f"{source_id}-rejected.jsonl"
        )

        self.db.execute(
            """
            INSERT INTO sources (
              source_id,
              display_name,
              provider,
              license,
              upstream_url,
              catalog_version,
              accepted_rows,
              rejected_rows,
              complexity_metric,
              status
            ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 'invalid')
            """,
            (
                source_id,
                display_name,
                provider,
                license_name,
                upstream_url,
                catalog_version,
                COMPLEXITY_METRIC,
            ),
        )
        self.db.commit()

        try:
            with rejection_path.open(
                "w",
                encoding="utf-8",
            ) as rejection_handle:
                for processed_rows, row in enumerate(rows, start=1):
                    if row.source_id != source_id:
                        raise CorpusStructuralError(
                            "SOURCE_ID_MISMATCH:"
                            f"{source_id}:{row.source_id}"
                        )

                    try:
                        text = validate_text(row.text)
                        duration_seconds = validate_duration(
                            float(row.duration_seconds)
                        )
                        detected_mime, detected_extension = (
                            detect_audio(row.audio_bytes)
                        )

                        if detected_mime != expected_audio_mime:
                            raise RowRejected(
                                "AUDIO_FORMAT_MISMATCH",
                                "Expected "
                                f"{expected_audio_mime}; detected "
                                f"{detected_mime}.",
                            )

                        if row.audio_mime_type != expected_audio_mime:
                            raise RowRejected(
                                "AUDIO_METADATA_MISMATCH",
                                "Reader declared "
                                f"{row.audio_mime_type}; expected "
                                f"{expected_audio_mime}.",
                            )

                        if row.audio_extension != detected_extension:
                            raise RowRejected(
                                "AUDIO_EXTENSION_MISMATCH",
                                "Reader declared "
                                f"{row.audio_extension}; detected "
                                f"{detected_extension}.",
                            )

                        text_hash = sha256_text(text)
                        audio_hash = sha256_bytes(
                            row.audio_bytes
                        )
                        complexity = grapheme_count(text)
                        object_key = (
                            f"media/{source_id}/audio/"
                            f"{audio_hash}{detected_extension}"
                        )

                        existing = self.db.execute(
                            """
                            SELECT text_sha256, audio_sha256
                            FROM source_rows
                            WHERE source_id = ?
                              AND source_key = ?
                            """,
                            (
                                source_id,
                                row.source_key,
                            ),
                        ).fetchone()

                        if existing is not None:
                            error_code = (
                                "DUPLICATE_SOURCE_ROW"
                                if existing
                                == (text_hash, audio_hash)
                                else "SOURCE_KEY_COLLISION"
                            )
                            raise CorpusStructuralError(
                                f"{error_code}:"
                                f"{source_id}:"
                                f"{row.source_key}"
                            )

                        object_path = (
                            self.objects_root / object_key
                        )
                        if not object_path.exists():
                            object_path.parent.mkdir(
                                parents=True,
                                exist_ok=True,
                            )
                            temporary_object_path = (
                                object_path.with_suffix(
                                    object_path.suffix + ".tmp"
                                )
                            )
                            temporary_object_path.write_bytes(
                                row.audio_bytes
                            )
                            os.replace(
                                temporary_object_path,
                                object_path,
                            )

                        source_metadata_json = json.dumps(
                            row.source_metadata,
                            ensure_ascii=False,
                            sort_keys=True,
                            separators=(",", ":"),
                            default=str,
                        )

                        self.db.execute(
                            """
                            INSERT INTO source_rows (
                              source_id,
                              source_key,
                              canonical_split,
                              upstream_split,
                              text,
                              grapheme_count,
                              text_sha256,
                              audio_sha256,
                              audio_object_key,
                              audio_mime_type,
                              duration_seconds,
                              source_metadata_json
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                source_id,
                                row.source_key,
                                row.canonical_split,
                                row.upstream_split,
                                text,
                                complexity,
                                text_hash,
                                audio_hash,
                                object_key,
                                detected_mime,
                                duration_seconds,
                                source_metadata_json,
                            ),
                        )

                        class_index = class_counts.get(
                            complexity,
                            0,
                        )
                        self.db.execute(
                            """
                            INSERT INTO source_complexity_members (
                              source_id,
                              grapheme_count,
                              class_index,
                              source_key
                            ) VALUES (?, ?, ?, ?)
                            """,
                            (
                                source_id,
                                complexity,
                                class_index,
                                row.source_key,
                            ),
                        )
                        class_counts[complexity] = (
                            class_index + 1
                        )
                        accepted_rows += 1

                    except RowRejected as error:
                        rejected_rows += 1
                        self._write_rejection(
                            rejection_handle,
                            row,
                            error,
                        )

                    if processed_rows % self.batch_rows == 0:
                        rejection_handle.flush()
                        self.db.commit()
                        print(f"{source_id}: processed {processed_rows} rows ({accepted_rows} accepted, {rejected_rows} rejected)", flush=True)

            if accepted_rows <= 0:
                raise CorpusStructuralError(
                    "SOURCE_HAS_NO_ACCEPTED_ROWS:"
                    f"{source_id}"
                )

            self.db.execute(
                """
                UPDATE sources
                SET accepted_rows = ?,
                    rejected_rows = ?,
                    status = 'ready'
                WHERE source_id = ?
                """,
                (
                    accepted_rows,
                    rejected_rows,
                    source_id,
                ),
            )
            self.db.commit()

        except BaseException:
            self.db.rollback()
            self._cleanup_temporary()
            raise

        self.source_manifests.append(
            {
                "sourceId": source_id,
                "displayName": display_name,
                "provider": provider,
                "license": license_name,
                "upstreamUrl": upstream_url,
                "catalogVersion": catalog_version,
                "acceptedRows": accepted_rows,
                "rejectedRows": rejected_rows,
                "complexityMetric": COMPLEXITY_METRIC,
                "status": "ready",
            }
        )

    def _verify(self) -> None:
        integrity = self.db.execute(
            "PRAGMA integrity_check"
        ).fetchone()
        if integrity is None or integrity[0] != "ok":
            raise CorpusStructuralError(
                f"SQLITE_INTEGRITY_FAILURE:{integrity}"
            )

        for source in self.source_manifests:
            source_id = source["sourceId"]
            expected = int(source["acceptedRows"])

            row_count = self.db.execute(
                """
                SELECT COUNT(*)
                FROM source_rows
                WHERE source_id = ?
                """,
                (source_id,),
            ).fetchone()[0]

            member_count = self.db.execute(
                """
                SELECT COUNT(*)
                FROM source_complexity_members
                WHERE source_id = ?
                """,
                (source_id,),
            ).fetchone()[0]

            if (
                row_count != expected
                or member_count != expected
            ):
                raise CorpusStructuralError(
                    "CORPUS_COUNT_MISMATCH:"
                    f"{source_id}:"
                    f"{expected}:"
                    f"{row_count}:"
                    f"{member_count}"
                )

    def finalize(self) -> None:
        if self.finalized:
            raise RuntimeError(
                "CorpusWriter is already finalized."
            )

        if not self.source_manifests:
            self._cleanup_temporary()
            raise CorpusStructuralError(
                "CORPUS_HAS_NO_SOURCES"
            )

        try:
            self._verify()
            self.db.commit()
            self.db.close()
            if self.cleanup_handle is not None:
                self.cleanup_handle.close()

            manifest = {
                "corpusFormatVersion": CORPUS_FORMAT_VERSION,
                "complexityMetric": COMPLEXITY_METRIC,
                "complexityMetricVersion": (
                    COMPLEXITY_METRIC_VERSION
                ),
                "generatedAt": datetime.now(
                    timezone.utc
                ).isoformat(),
                "sources": self.source_manifests,
            }

            manifest_path = (
                self.temporary / "manifest.json"
            )
            manifest_path.write_text(
                json.dumps(
                    manifest,
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )

            backup: Path | None = None
            if self.output.exists():
                if not self.replace:
                    raise FileExistsError(self.output)

                backup = self.output.with_name(
                    "."
                    f"{self.output.name}.backup-"
                    f"{os.getpid()}"
                )
                if backup.exists():
                    shutil.rmtree(backup)
                os.replace(self.output, backup)

            try:
                os.replace(
                    self.temporary,
                    self.output,
                )
            except Exception:
                if (
                    backup is not None
                    and backup.exists()
                    and not self.output.exists()
                ):
                    os.replace(
                        backup,
                        self.output,
                    )
                raise
            else:
                if (
                    backup is not None
                    and backup.exists()
                ):
                    shutil.rmtree(backup)

            self.finalized = True

        except Exception:
            if self.temporary.exists():
                shutil.rmtree(
                    self.temporary,
                    ignore_errors=True,
                )
            raise

        cleanup_path = self.output / "pending-input-cleanup.jsonl"
        if cleanup_path.exists():
            with cleanup_path.open(encoding="utf-8") as handle:
                for line in handle:
                    Path(json.loads(line)).unlink(missing_ok=True)
            cleanup_path.unlink()
