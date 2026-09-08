from __future__ import annotations

import csv
from pathlib import Path
from typing import Iterator

from common import (
    CanonicalInputRow,
    CorpusStructuralError,
    canonical_split,
    normalize_source_locator,
)

SOURCE_ID = "fleurs-te"
DISPLAY_NAME = "FLEURS"
PROVIDER = "Google"
LICENSE = "CC BY 4.0"
UPSTREAM_URL = "https://huggingface.co/datasets/google/fleurs"
CATALOG_VERSION = 1
EXPECTED_AUDIO_MIME = "audio/wav"
SAMPLE_RATE_HZ = 16_000


def read_fleurs(root: Path) -> Iterator[CanonicalInputRow]:
    tsv_files = sorted(root.glob("*.tsv"))
    if not tsv_files:
        raise CorpusStructuralError("FLEURS_SCHEMA:NO_TSV_FILES")

    for tsv_path in tsv_files:
        upstream_split = tsv_path.stem.lower()
        split = canonical_split(upstream_split)
        audio_dir = root / upstream_split

        if not audio_dir.is_dir():
            raise CorpusStructuralError(
                f"FLEURS_SCHEMA:MISSING_SPLIT_AUDIO:{upstream_split}"
            )

        with tsv_path.open("r", encoding="utf-8", newline="") as handle:
            for line_number, columns in enumerate(
                csv.reader(handle, delimiter="\t"),
                start=1,
            ):
                if len(columns) != 7:
                    raise CorpusStructuralError(
                        f"FLEURS_SCHEMA:ROW_{line_number}_HAS_{len(columns)}_FIELDS"
                    )

                (
                    sentence_id,
                    audio_filename,
                    raw_transcription,
                    normalized_transcription,
                    characterized_transcription,
                    num_samples_raw,
                    gender,
                ) = columns

                normalized_audio_filename = (
                    normalize_source_locator(
                        audio_filename
                    )
                )
                source_key = (
                    f"{split}:"
                    f"{normalized_audio_filename}"
                )
                audio_path = (
                    audio_dir
                    / normalized_audio_filename
                )

                if not audio_path.is_file():
                    audio_bytes = b""
                else:
                    audio_bytes = audio_path.read_bytes()

                try:
                    num_samples = int(num_samples_raw)
                except (TypeError, ValueError):
                    num_samples = 0

                yield CanonicalInputRow(
                    source_id=SOURCE_ID,
                    source_key=source_key,
                    canonical_split=split,
                    upstream_split=upstream_split,
                    text=raw_transcription,
                    audio_bytes=audio_bytes,
                    audio_mime_type=EXPECTED_AUDIO_MIME,
                    audio_extension=".wav",
                    duration_seconds=num_samples / SAMPLE_RATE_HZ,
                    source_metadata={
                        "sentenceId": sentence_id,
                        "audioFilename": normalized_audio_filename,
                        "rawTranscription": raw_transcription,
                        "normalizedTranscription": normalized_transcription,
                        "characterizedTranscription": characterized_transcription,
                        "numSamples": num_samples,
                        "sampleRateHz": SAMPLE_RATE_HZ,
                        "gender": gender,
                    },
                )
