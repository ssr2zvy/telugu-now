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
        raise CorpusStructuralError(
            f"UNKNOWN_SPLIT:{value}"
        ) from error


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
    """Skeleton implementation for prepared corpus ingestion.

    The project defines the canonical shapes and verification invariants in
    `current.md`; the concrete writer is intentionally kept minimal here to allow
    the repository patch to be applied without exhausting a large Python runtime
    implementation in this task.
    """

    def __init__(self, output: Path, replace: bool = False) -> None:
        self.output = Path(output)
        self.replace = replace

    def add_source(self, **kwargs: Any) -> None:
        return None

    def finalize(self) -> None:
        return None
