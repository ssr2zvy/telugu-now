from __future__ import annotations

import re
from pathlib import Path
from typing import Iterator

import pyarrow.parquet as pq

from common import (
    CanonicalInputRow,
    CorpusStructuralError,
    canonical_split,
    normalize_source_locator,
)

SOURCE_ID = "shrutilipi-te"
DISPLAY_NAME = "Shrutilipi"
PROVIDER = "AI4Bharat"
LICENSE = "CC BY 4.0"
UPSTREAM_URL = "https://huggingface.co/datasets/ai4bharat/Shrutilipi"
CATALOG_VERSION = 1
EXPECTED_AUDIO_MIME = "audio/flac"


def split_from_path(path: Path) -> tuple[str, str]:
    for part in reversed(path.parts):
        match = re.search(
            r"(?:^|[-_.])(train|test|dev|valid|validation)(?:[-_.]|$)",
            part.lower(),
        )
        if match:
            upstream = match.group(1)
            return upstream, canonical_split(upstream)
    raise CorpusStructuralError(f"SHRUTILIPI_SCHEMA:UNKNOWN_SPLIT:{path}")


def read_shrutilipi(root: Path) -> Iterator[CanonicalInputRow]:
    parquet_paths = sorted(root.rglob("*.parquet"))
    if not parquet_paths:
        raise CorpusStructuralError("SHRUTILIPI_SCHEMA:NO_PARQUET_FILES")

    required = {"audio_filepath", "text", "duration", "lang"}

    for parquet_path in parquet_paths:
        upstream_split, split = split_from_path(parquet_path.relative_to(root))
        parquet = pq.ParquetFile(parquet_path)

        missing = required.difference(parquet.schema_arrow.names)
        if missing:
            raise CorpusStructuralError(
                f"SHRUTILIPI_SCHEMA:MISSING_COLUMNS:{','.join(sorted(missing))}"
            )

        for batch in parquet.iter_batches():
            for row in batch.to_pylist():
                audio = row["audio_filepath"]
                if not isinstance(audio, dict):
                    raise CorpusStructuralError(
                        "SHRUTILIPI_SCHEMA:AUDIO_FIELD_CHANGED"
                    )

                upstream_path = audio.get("path")
                if not isinstance(upstream_path, str) or not upstream_path:
                    raise CorpusStructuralError(
                        "SHRUTILIPI_SCHEMA:MISSING_AUDIO_PATH"
                    )

                normalized_audio_path = (
                    normalize_source_locator(
                        upstream_path
                    )
                )
                source_key = (
                    f"{split}:"
                    f"{normalized_audio_path}"
                )

                try:
                    duration_seconds = float(
                        row["duration"]
                    )
                except (TypeError, ValueError):
                    duration_seconds = float("nan")

                yield CanonicalInputRow(
                    source_id=SOURCE_ID,
                    source_key=source_key,
                    canonical_split=split,
                    upstream_split=upstream_split,
                    text=row["text"],
                    audio_bytes=audio.get("bytes") or b"",
                    audio_mime_type=EXPECTED_AUDIO_MIME,
                    audio_extension=".flac",
                    duration_seconds=duration_seconds,
                    source_metadata={
                        key: value
                        for key, value in row.items()
                        if key != "audio_filepath"
                    } | {
                        "upstreamAudioPath": normalized_audio_path,
                    },
                )
