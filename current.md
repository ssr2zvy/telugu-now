.gitignore

@@ existing ignore rules @@
 data-transform/raw/
+ti/data/corpus/

data-transform/requirements.txt

@@ new file @@
+pyarrow>=17,<22
+regex>=2024.11.6

data-transform/scripts/extract-sample-data/FLEURS.py

@@ sample_split(), immediately after output_audio_dir is calculated @@
     output_tsv_path = args.output_root / f"{split}.tsv"
     output_audio_dir = args.output_root / split
+    legacy_audio_dir = args.output_root / "audio"
@@ inside `if args.replace:` @@
     if args.replace:
         if output_tsv_path.exists():
             output_tsv_path.unlink()
         if output_audio_dir.exists():
             shutil.rmtree(output_audio_dir)
+        # Older sample preparation produced a redundant flat audio/ copy.
+        # FLEURS preparation now resolves media from the actual split directory.
+        if legacy_audio_dir.exists():
+            shutil.rmtree(legacy_audio_dir)

data-transform/scripts/prepare-corpus/common.py

@@ new file @@
+from __future__ import annotations
+
+import hashlib
+import json
+import math
+import shutil
+import sqlite3
+import unicodedata
+from dataclasses import dataclass
+from pathlib import Path
+from typing import Any, Iterable
+
+import regex
+
+CORPUS_FORMAT_VERSION = 1
+COMPLEXITY_METRIC = "grapheme-count"
+COMPLEXITY_METRIC_VERSION = 1
+
+SPLIT_ALIASES = {
+    "train": "train",
+    "test": "test",
+    "dev": "validation",
+    "valid": "validation",
+    "validation": "validation",
+}
+
+
+class CorpusStructuralError(RuntimeError):
+    pass
+
+
+class RowRejected(RuntimeError):
+    def __init__(self, code: str, message: str) -> None:
+        super().__init__(message)
+        self.code = code
+
+
+@dataclass(frozen=True)
+class CanonicalInputRow:
+    source_id: str
+    source_key: str
+    canonical_split: str
+    upstream_split: str
+    text: str
+    audio_bytes: bytes
+    audio_mime_type: str
+    audio_extension: str
+    duration_seconds: float
+    source_metadata: dict[str, Any]
+
+
+def canonical_split(value: str) -> str:
+    normalized = value.strip().lower()
+    try:
+        return SPLIT_ALIASES[normalized]
+    except KeyError as error:
+        raise CorpusStructuralError(
+            f"UNKNOWN_SPLIT:{value}"
+        ) from error
+
+
+def grapheme_count(text: str) -> int:
+    normalized = unicodedata.normalize("NFC", text)
+    return len(regex.findall(r"\X", normalized))
+
+
+def sha256_bytes(value: bytes) -> str:
+    return hashlib.sha256(value).hexdigest()
+
+
+def sha256_text(value: str) -> str:
+    return hashlib.sha256(value.encode("utf-8")).hexdigest()
+
+
+def validate_text(text: str) -> str:
+    value = text.strip()
+    if not value:
+        raise RowRejected("EMPTY_TEXT", "Canonical text is empty.")
+    if grapheme_count(value) <= 0:
+        raise RowRejected("EMPTY_COMPLEXITY", "Grapheme count is zero.")
+    return value
+
+
+def validate_duration(value: float) -> float:
+    if not math.isfinite(value) or value <= 0 or value > 3600:
+        raise RowRejected("INVALID_DURATION", f"Invalid duration: {value}")
+    return value
+
+
+def detect_audio(audio: bytes) -> tuple[str, str]:
+    if not audio:
+        raise RowRejected("EMPTY_AUDIO", "Audio payload is empty.")
+    if audio.startswith(b"RIFF") and audio[8:12] == b"WAVE":
+        return "audio/wav", ".wav"
+    if audio.startswith(b"fLaC"):
+        return "audio/flac", ".flac"
+    raise RowRejected("UNSUPPORTED_AUDIO_FORMAT", "Unknown audio signature.")
+
+
+class CorpusWriter:
+    # Create output in a sibling temporary directory.
+    # Never mutate the existing prepared corpus in place.
+    #
+    # SQLite schema:
+    #
+    # sources(
+    #   source_id PRIMARY KEY,
+    #   display_name,
+    #   provider,
+    #   license,
+    #   upstream_url,
+    #   catalog_version,
+    #   accepted_rows,
+    #   rejected_rows,
+    #   complexity_metric,
+    #   status
+    # )
+    #
+    # source_rows(
+    #   source_id,
+    #   source_key,
+    #   canonical_split,
+    #   upstream_split,
+    #   text,
+    #   grapheme_count,
+    #   text_sha256,
+    #   audio_sha256,
+    #   audio_object_key,
+    #   audio_mime_type,
+    #   duration_seconds,
+    #   source_metadata_json,
+    #   PRIMARY KEY(source_id, source_key)
+    # )
+    #
+    # source_complexity_members(
+    #   source_id,
+    #   grapheme_count,
+    #   class_index,
+    #   source_key,
+    #   PRIMARY KEY(source_id, grapheme_count, class_index)
+    # )
+    #
+    # INDEX source_rows(source_id, grapheme_count)
+
+    # add_source() must:
+    # - stream rows rather than retaining the full source in memory;
+    # - validate text, duration and audio signatures;
+    # - enforce expected source audio format;
+    # - compute text/audio SHA-256;
+    # - compute grapheme count exactly once;
+    # - copy audio to:
+    #     objects/media/<source-id>/audio/<audio-sha256>.<ext>
+    # - use INSERT, never INSERT OR IGNORE, for source identity;
+    # - convert any duplicate (source_id, source_key) into
+    #   SOURCE_KEY_COLLISION and fail the entire source;
+    # - write individual RowRejected rows to
+    #   reports/<source-id>-rejected.jsonl;
+    # - exclude rejected rows from accepted_rows;
+    # - populate source_complexity_members with deterministic
+    #   class_index ordering after source ingestion.
+
+    # finalize() must:
+    # - verify accepted_rows == COUNT(source_rows);
+    # - verify complexity member counts exactly match source_rows;
+    # - write manifest.json containing corpus format/version,
+    #   complexity metric/version, source status/counts and generated_at;
+    # - fsync/close SQLite;
+    # - atomically replace the requested output only when --replace was given;
+    # - leave an existing valid corpus untouched on any failure.

data-transform/scripts/prepare-corpus/sources/__init__.py

@@ new file @@
+from .fleurs import read_fleurs
+from .indicvoices import read_indicvoices
+from .shrutilipi import read_shrutilipi
+
+__all__ = [
+    "read_fleurs",
+    "read_shrutilipi",
+    "read_indicvoices",
+]

data-transform/scripts/prepare-corpus/sources/fleurs.py

@@ new file @@
+from __future__ import annotations
+
+import csv
+from pathlib import Path
+from typing import Iterator
+
+from ..common import (
+    CanonicalInputRow,
+    CorpusStructuralError,
+    canonical_split,
+)
+
+SOURCE_ID = "fleurs-te"
+DISPLAY_NAME = "FLEURS"
+PROVIDER = "Google"
+LICENSE = "CC BY 4.0"
+UPSTREAM_URL = "https://huggingface.co/datasets/google/fleurs"
+CATALOG_VERSION = 1
+EXPECTED_AUDIO_MIME = "audio/wav"
+SAMPLE_RATE_HZ = 16_000
+
+
+def read_fleurs(root: Path) -> Iterator[CanonicalInputRow]:
+    tsv_files = sorted(root.glob("*.tsv"))
+    if not tsv_files:
+        raise CorpusStructuralError("FLEURS_SCHEMA:NO_TSV_FILES")
+
+    for tsv_path in tsv_files:
+        upstream_split = tsv_path.stem.lower()
+        split = canonical_split(upstream_split)
+        audio_dir = root / upstream_split
+
+        if not audio_dir.is_dir():
+            raise CorpusStructuralError(
+                f"FLEURS_SCHEMA:MISSING_SPLIT_AUDIO:{upstream_split}"
+            )
+
+        with tsv_path.open("r", encoding="utf-8", newline="") as handle:
+            for line_number, columns in enumerate(
+                csv.reader(handle, delimiter="\t"),
+                start=1,
+            ):
+                if len(columns) != 7:
+                    raise CorpusStructuralError(
+                        f"FLEURS_SCHEMA:ROW_{line_number}_HAS_{len(columns)}_FIELDS"
+                    )
+
+                (
+                    sentence_id,
+                    audio_filename,
+                    raw_transcription,
+                    normalized_transcription,
+                    characterized_transcription,
+                    num_samples_raw,
+                    gender,
+                ) = columns
+
+                source_key = f"{split}:{audio_filename}"
+                audio_path = audio_dir / audio_filename
+
+                if not audio_path.is_file():
+                    # Yield as an individually rejectable row rather than
+                    # silently changing source identity or searching another split.
+                    audio_bytes = b""
+                else:
+                    audio_bytes = audio_path.read_bytes()
+
+                try:
+                    num_samples = int(num_samples_raw)
+                except ValueError as error:
+                    raise CorpusStructuralError(
+                        f"FLEURS_SCHEMA:INVALID_NUM_SAMPLES:{source_key}"
+                    ) from error
+
+                yield CanonicalInputRow(
+                    source_id=SOURCE_ID,
+                    source_key=source_key,
+                    canonical_split=split,
+                    upstream_split=upstream_split,
+                    text=raw_transcription,
+                    audio_bytes=audio_bytes,
+                    audio_mime_type=EXPECTED_AUDIO_MIME,
+                    audio_extension=".wav",
+                    duration_seconds=num_samples / SAMPLE_RATE_HZ,
+                    source_metadata={
+                        "sentenceId": sentence_id,
+                        "audioFilename": audio_filename,
+                        "rawTranscription": raw_transcription,
+                        "normalizedTranscription": normalized_transcription,
+                        "characterizedTranscription": characterized_transcription,
+                        "numSamples": num_samples,
+                        "sampleRateHz": SAMPLE_RATE_HZ,
+                        "gender": gender,
+                    },
+                )

data-transform/scripts/prepare-corpus/sources/shrutilipi.py

@@ new file @@
+from __future__ import annotations
+
+import re
+from pathlib import Path
+from typing import Iterator
+
+import pyarrow.parquet as pq
+
+from ..common import (
+    CanonicalInputRow,
+    CorpusStructuralError,
+    canonical_split,
+)
+
+SOURCE_ID = "shrutilipi-te"
+DISPLAY_NAME = "Shrutilipi"
+PROVIDER = "AI4Bharat"
+LICENSE = "CC BY 4.0"
+UPSTREAM_URL = "https://huggingface.co/datasets/ai4bharat/Shrutilipi"
+CATALOG_VERSION = 1
+EXPECTED_AUDIO_MIME = "audio/flac"
+
+
+def split_from_path(path: Path) -> tuple[str, str]:
+    for part in reversed(path.parts):
+        match = re.search(
+            r"(?:^|[-_.])(train|test|dev|valid|validation)(?:[-_.]|$)",
+            part.lower(),
+        )
+        if match:
+            upstream = match.group(1)
+            return upstream, canonical_split(upstream)
+    raise CorpusStructuralError(f"SHRUTILIPI_SCHEMA:UNKNOWN_SPLIT:{path}")
+
+
+def read_shrutilipi(root: Path) -> Iterator[CanonicalInputRow]:
+    parquet_paths = sorted(root.rglob("*.parquet"))
+    if not parquet_paths:
+        raise CorpusStructuralError("SHRUTILIPI_SCHEMA:NO_PARQUET_FILES")
+
+    required = {"audio_filepath", "text", "duration", "lang"}
+
+    for parquet_path in parquet_paths:
+        upstream_split, split = split_from_path(parquet_path.relative_to(root))
+        parquet = pq.ParquetFile(parquet_path)
+
+        missing = required.difference(parquet.schema_arrow.names)
+        if missing:
+            raise CorpusStructuralError(
+                f"SHRUTILIPI_SCHEMA:MISSING_COLUMNS:{','.join(sorted(missing))}"
+            )
+
+        for batch in parquet.iter_batches():
+            for row in batch.to_pylist():
+                audio = row["audio_filepath"]
+                if not isinstance(audio, dict):
+                    raise CorpusStructuralError(
+                        "SHRUTILIPI_SCHEMA:AUDIO_FIELD_CHANGED"
+                    )
+
+                upstream_path = audio.get("path")
+                if not isinstance(upstream_path, str) or not upstream_path:
+                    raise CorpusStructuralError(
+                        "SHRUTILIPI_SCHEMA:MISSING_AUDIO_PATH"
+                    )
+
+                source_key = f"{split}:{Path(upstream_path).as_posix()}"
+
+                yield CanonicalInputRow(
+                    source_id=SOURCE_ID,
+                    source_key=source_key,
+                    canonical_split=split,
+                    upstream_split=upstream_split,
+                    text=row["text"],
+                    audio_bytes=audio.get("bytes") or b"",
+                    audio_mime_type=EXPECTED_AUDIO_MIME,
+                    audio_extension=".flac",
+                    duration_seconds=float(row["duration"]),
+                    source_metadata={
+                        key: value
+                        for key, value in row.items()
+                        if key != "audio_filepath"
+                    } | {
+                        "upstreamAudioPath": upstream_path,
+                    },
+                )

data-transform/scripts/prepare-corpus/sources/indicvoices.py

@@ new file @@
+from __future__ import annotations
+
+import re
+from pathlib import Path
+from typing import Iterator
+
+import pyarrow.parquet as pq
+
+from ..common import (
+    CanonicalInputRow,
+    CorpusStructuralError,
+    canonical_split,
+)
+
+SOURCE_ID = "indicvoices-te"
+DISPLAY_NAME = "IndicVoices"
+PROVIDER = "AI4Bharat"
+LICENSE = "CC BY 4.0"
+UPSTREAM_URL = "https://huggingface.co/datasets/ai4bharat/IndicVoices"
+CATALOG_VERSION = 1
+EXPECTED_AUDIO_MIME = "audio/flac"
+
+
+def split_from_path(path: Path) -> tuple[str, str]:
+    for part in reversed(path.parts):
+        match = re.search(
+            r"(?:^|[-_.])(train|test|dev|valid|validation)(?:[-_.]|$)",
+            part.lower(),
+        )
+        if match:
+            upstream = match.group(1)
+            return upstream, canonical_split(upstream)
+    raise CorpusStructuralError(f"INDICVOICES_SCHEMA:UNKNOWN_SPLIT:{path}")
+
+
+def read_indicvoices(root: Path) -> Iterator[CanonicalInputRow]:
+    parquet_paths = sorted(root.rglob("*.parquet"))
+    if not parquet_paths:
+        raise CorpusStructuralError("INDICVOICES_SCHEMA:NO_PARQUET_FILES")
+
+    required = {
+        "audio_filepath",
+        "text",
+        "duration",
+        "lang",
+        "verbatim",
+        "normalized",
+    }
+
+    for parquet_path in parquet_paths:
+        upstream_split, split = split_from_path(parquet_path.relative_to(root))
+        parquet = pq.ParquetFile(parquet_path)
+
+        missing = required.difference(parquet.schema_arrow.names)
+        if missing:
+            raise CorpusStructuralError(
+                f"INDICVOICES_SCHEMA:MISSING_COLUMNS:{','.join(sorted(missing))}"
+            )
+
+        for batch in parquet.iter_batches():
+            for row in batch.to_pylist():
+                audio = row["audio_filepath"]
+                if not isinstance(audio, dict):
+                    raise CorpusStructuralError(
+                        "INDICVOICES_SCHEMA:AUDIO_FIELD_CHANGED"
+                    )
+
+                upstream_path = audio.get("path")
+                if not isinstance(upstream_path, str) or not upstream_path:
+                    raise CorpusStructuralError(
+                        "INDICVOICES_SCHEMA:MISSING_AUDIO_PATH"
+                    )
+
+                # `text` is the canonical display/complexity representation.
+                # Preserve verbatim/normalized/unsanitized forms in source metadata.
+                source_key = f"{split}:{Path(upstream_path).as_posix()}"
+
+                yield CanonicalInputRow(
+                    source_id=SOURCE_ID,
+                    source_key=source_key,
+                    canonical_split=split,
+                    upstream_split=upstream_split,
+                    text=row["text"],
+                    audio_bytes=audio.get("bytes") or b"",
+                    audio_mime_type=EXPECTED_AUDIO_MIME,
+                    audio_extension=".flac",
+                    duration_seconds=float(row["duration"]),
+                    source_metadata={
+                        key: value
+                        for key, value in row.items()
+                        if key != "audio_filepath"
+                    } | {
+                        "upstreamAudioPath": upstream_path,
+                    },
+                )

data-transform/scripts/prepare-corpus/prepare.py

@@ new file @@
+#!/usr/bin/env python3
+from __future__ import annotations
+
+import argparse
+from pathlib import Path
+
+from common import CorpusWriter
+from sources import (
+    read_fleurs,
+    read_indicvoices,
+    read_shrutilipi,
+)
+from sources.fleurs import (
+    CATALOG_VERSION as FLEURS_VERSION,
+    DISPLAY_NAME as FLEURS_NAME,
+    EXPECTED_AUDIO_MIME as FLEURS_AUDIO,
+    LICENSE as FLEURS_LICENSE,
+    PROVIDER as FLEURS_PROVIDER,
+    SOURCE_ID as FLEURS_ID,
+    UPSTREAM_URL as FLEURS_URL,
+)
+from sources.indicvoices import (
+    CATALOG_VERSION as INDIC_VERSION,
+    DISPLAY_NAME as INDIC_NAME,
+    EXPECTED_AUDIO_MIME as INDIC_AUDIO,
+    LICENSE as INDIC_LICENSE,
+    PROVIDER as INDIC_PROVIDER,
+    SOURCE_ID as INDIC_ID,
+    UPSTREAM_URL as INDIC_URL,
+)
+from sources.shrutilipi import (
+    CATALOG_VERSION as SHRUTI_VERSION,
+    DISPLAY_NAME as SHRUTI_NAME,
+    EXPECTED_AUDIO_MIME as SHRUTI_AUDIO,
+    LICENSE as SHRUTI_LICENSE,
+    PROVIDER as SHRUTI_PROVIDER,
+    SOURCE_ID as SHRUTI_ID,
+    UPSTREAM_URL as SHRUTI_URL,
+)
+
+
+def parse_args() -> argparse.Namespace:
+    parser = argparse.ArgumentParser(
+        description="Transform upstream-shaped Telugu corpora into Telugu Now canonical storage."
+    )
+    parser.add_argument("--input", required=True, type=Path)
+    parser.add_argument("--output", required=True, type=Path)
+    parser.add_argument(
+        "--replace",
+        action="store_true",
+        help="Atomically replace an existing prepared corpus after successful validation.",
+    )
+    return parser.parse_args()
+
+
+def main() -> None:
+    args = parse_args()
+    writer = CorpusWriter(args.output, replace=args.replace)
+
+    writer.add_source(
+        source_id=FLEURS_ID,
+        display_name=FLEURS_NAME,
+        provider=FLEURS_PROVIDER,
+        license_name=FLEURS_LICENSE,
+        upstream_url=FLEURS_URL,
+        catalog_version=FLEURS_VERSION,
+        expected_audio_mime=FLEURS_AUDIO,
+        rows=read_fleurs(args.input / "FLEURS"),
+    )
+
+    writer.add_source(
+        source_id=SHRUTI_ID,
+        display_name=SHRUTI_NAME,
+        provider=SHRUTI_PROVIDER,
+        license_name=SHRUTI_LICENSE,
+        upstream_url=SHRUTI_URL,
+        catalog_version=SHRUTI_VERSION,
+        expected_audio_mime=SHRUTI_AUDIO,
+        rows=read_shrutilipi(args.input / "Shrutilipi"),
+    )
+
+    writer.add_source(
+        source_id=INDIC_ID,
+        display_name=INDIC_NAME,
+        provider=INDIC_PROVIDER,
+        license_name=INDIC_LICENSE,
+        upstream_url=INDIC_URL,
+        catalog_version=INDIC_VERSION,
+        expected_audio_mime=INDIC_AUDIO,
+        rows=read_indicvoices(args.input / "IndicVoices"),
+    )
+
+    writer.finalize()
+
+
+if __name__ == "__main__":
+    main()

ti/.gitignore

@@ after SQLite ignores @@
 data/*.sqlite
 data/*.sqlite-*
+data/corpus/

ti/.env.example

@@ storage configuration @@
 DATABASE_PATH=./data/app.sqlite
+CORPUS_DATABASE_PATH=./data/corpus/corpus.sqlite
+CORPUS_OBJECTS_PATH=./data/corpus/objects
@@ source weights @@
 SOURCE1_WEIGHT=1
 SOURCE2_WEIGHT=1
 SOURCE3_WEIGHT=1
+FLEURS_TE_WEIGHT=1
+SHRUTILIPI_TE_WEIGHT=1
+INDICVOICES_TE_WEIGHT=1

ti/control.sh

@@ immediately after SCRIPT_DIR/SCRIPT_NAME/SELF @@
 SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
 SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"
 SELF="$SCRIPT_DIR/$SCRIPT_NAME"
+REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
+DATA_TRANSFORM_DIR="$REPO_DIR/data-transform"
+SAMPLE_DATA_DIR="$DATA_TRANSFORM_DIR/sample"
+RAW_DATA_DIR="$DATA_TRANSFORM_DIR/raw"
+PREPARED_CORPUS_DIR="$SCRIPT_DIR/data/corpus"
@@ usage() @@
   ./$SCRIPT_NAME deps [--option install|reinstall|abort|exit]
   ./$SCRIPT_NAME test [--option start|abort|exit]
   ./$SCRIPT_NAME build [--option start|abort|exit]
   ./$SCRIPT_NAME dev [--option start|stop|exit]
+  ./$SCRIPT_NAME data [--option samples|prepare|all|exit]
@@ before run_dev_foreground() @@
+prepared_corpus_ready() {
+  [[ -f "$PREPARED_CORPUS_DIR/manifest.json" &&
+     -f "$PREPARED_CORPUS_DIR/corpus.sqlite" ]]
+}
+
+run_data_samples() {
+  python "$DATA_TRANSFORM_DIR/scripts/extract-sample-data/FLEURS.py" \
+    --input-root "$RAW_DATA_DIR/FLEURS" \
+    --output-root "$SAMPLE_DATA_DIR/FLEURS" \
+    --replace
+
+  python "$DATA_TRANSFORM_DIR/scripts/extract-sample-data/Shrutilipi.py" \
+    --input-root "$RAW_DATA_DIR/Shrutilipi" \
+    --output-root "$SAMPLE_DATA_DIR/Shrutilipi"
+
+  python "$DATA_TRANSFORM_DIR/scripts/extract-sample-data/IndicVoices.py" \
+    --input-root "$RAW_DATA_DIR/IndicVoices" \
+    --output-root "$SAMPLE_DATA_DIR/IndicVoices"
+}
+
+run_data_prepare() {
+  python "$DATA_TRANSFORM_DIR/scripts/prepare-corpus/prepare.py" \
+    --input "$SAMPLE_DATA_DIR" \
+    --output "$PREPARED_CORPUS_DIR" \
+    --replace
+}
+
+run_data_domain() {
+  local option="${1:-}"
+
+  if [[ -z "$option" ]]; then
+    printf 'DATA OPTIONS\n'
+    printf '1) samples\n'
+    printf '2) prepare\n'
+    printf '3) all\n'
+    printf '4) exit\n'
+    printf '\nSelect option: '
+    read -r selection
+    case "$selection" in
+      1) option="samples" ;;
+      2) option="prepare" ;;
+      3) option="all" ;;
+      4) option="exit" ;;
+      *) printf 'ERROR: invalid selection.\n' >&2; return 2 ;;
+    esac
+  fi
+
+  case "$option" in
+    samples)
+      run_data_samples
+      ;;
+    prepare)
+      run_data_prepare
+      ;;
+    all)
+      run_data_samples
+      run_data_prepare
+      ;;
+    exit)
+      return 0
+      ;;
+    *)
+      printf 'ERROR: invalid data option "%s".\n' "$option" >&2
+      return 2
+      ;;
+  esac
+}
@@ at the beginning of run_dev_foreground() @@
 run_dev_foreground() {
   local status dev_pid dev_pgid lf rc=0
+
+  if ! prepared_corpus_ready; then
+    printf 'ERROR: CORPUS_NOT_PREPARED\n' >&2
+    printf 'Run "./%s data --option prepare" first.\n' "$SCRIPT_NAME" >&2
+    return 1
+  fi
@@ after __runner/__deps_exec internal dispatch, before normal DOMAIN validation @@
+if [[ "${1:-}" == "data" ]]; then
+  shift
+  DATA_OPTION=""
+
+  while [[ $# -gt 0 ]]; do
+    case "$1" in
+      --option)
+        [[ $# -ge 2 ]] || {
+          printf 'ERROR: --option requires a value.\n' >&2
+          exit 2
+        }
+        DATA_OPTION="$2"
+        shift 2
+        ;;
+      *)
+        printf 'ERROR: unknown argument "%s".\n' "$1" >&2
+        exit 2
+        ;;
+    esac
+  done
+
+  run_data_domain "$DATA_OPTION"
+  exit $?
+fi

ti/shared/contracts.ts

@@ after ObservationStatus @@
+export type ComplexityMetric =
+  | 'word-count'
+  | 'grapheme-count';
+
+export interface TextMedia {
+  kind: 'text';
+  language: 'te';
+  text: string;
+}
+
+export interface AudioMedia {
+  kind: 'audio';
+  objectKey: string;
+  mimeType: string;
+  durationSeconds: number;
+  sha256: string;
+}
+
+export type MediaItem =
+  | TextMedia
+  | AudioMedia;
@@ SelectionSnapshot @@
-  wordCount: number;
+  complexityMetric: ComplexityMetric;
+  intrinsicComplexityValue: number;
   complexityReferenceVersion: number;
@@
-  globalRowsAtWordCount: number;
+  globalRowsAtComplexityValue: number;
   globalPerRowComplexityMass: number;
-  selectedSourceRowsAtWordCount: number;
+  selectedSourceRowsAtComplexityValue: number;
   selectedSourceNormalizationDenominator: number;
   rowProbabilityWithinSource: number;
   overallProbability: number;
+
+  // Historical Iteration 2 snapshots only.
+  wordCount?: number;
+  globalRowsAtWordCount?: number;
+  selectedSourceRowsAtWordCount?: number;
@@ before ApiErrorResponse @@
+export interface DataSourceInfo {
+  sourceId: string;
+  displayName: string;
+  provider: string;
+  license: string;
+  upstreamUrl: string | null;
+  catalogVersion: number;
+  acceptedRows: number;
+  rejectedRows: number;
+  complexityMetric: ComplexityMetric;
+  status: 'ready' | 'fixture' | 'invalid';
+}
+
+export interface DataSourcesResponse {
+  sources: DataSourceInfo[];
+}

ti/server/src/config/config.ts

@@ after databasePath @@
 const databasePath = process.env.DATABASE_PATH ?? './data/app.sqlite';
+const corpusDatabasePath =
+  process.env.CORPUS_DATABASE_PATH ?? './data/corpus/corpus.sqlite';
+const corpusObjectsPath =
+  process.env.CORPUS_OBJECTS_PATH ?? './data/corpus/objects';
@@ defaultSourceWeights @@
 const defaultSourceWeights = {
   source1: parseUnitInterval(process.env.SOURCE1_WEIGHT, 1),
   source2: parseUnitInterval(process.env.SOURCE2_WEIGHT, 1),
   source3: parseUnitInterval(process.env.SOURCE3_WEIGHT, 1),
+  'fleurs-te': parseUnitInterval(process.env.FLEURS_TE_WEIGHT, 1),
+  'shrutilipi-te': parseUnitInterval(process.env.SHRUTILIPI_TE_WEIGHT, 1),
+  'indicvoices-te': parseUnitInterval(process.env.INDICVOICES_TE_WEIGHT, 1),
 };
@@ exported config @@
   databasePath: path.resolve(databasePath),
+  corpusDatabasePath: path.resolve(corpusDatabasePath),
+  corpusObjectsPath: path.resolve(corpusObjectsPath),

ti/server/src/domain/source.ts

@@ imports @@
+import type {
+  DataSourceInfo,
+  MediaItem,
+} from '../../../shared/contracts';
@@ replace SourceCatalogRow @@
-export interface SourceCatalogRow {
-  sourceKey: string;
-  wordCount: number;
+export interface SourceComplexityClass {
+  complexityValue: number;
+  rowCount: number;
 }
 export interface SourceCandidate {
   sourceKey: string;
+  complexityValue: number;
 }
 export interface PreparedSourceObservation {
   text: string;
+  media: MediaItem[];
 }
 export interface DataSource {
   readonly id: string;
   readonly enabled: boolean;
-  catalog(): readonly SourceCatalogRow[];
+  rowCount(): number;
+  complexityClasses(): readonly SourceComplexityClass[];
+  candidateAt(
+    complexityValue: number,
+    classIndex: number,
+  ): SourceCandidate;
   prepare(candidate: SourceCandidate): Promise<PreparedSourceObservation>;
+  info(): DataSourceInfo;
 }

ti/server/src/sources/dummy/dummy-data-source.ts

@@ imports @@
 import type {
   DataSource,
   PreparedSourceObservation,
   SourceCandidate,
-  SourceCatalogRow,
+  SourceComplexityClass,
 } from '../../domain/source';
@@ replace wordCount() @@
-function wordCount(text: string): number {
-  const normalized = text.trim().replace(/\s+/g, ' ');
-  return normalized.length === 0 ? 0 : normalized.split(' ').length;
-}
+const graphemeSegmenter = new Intl.Segmenter(
+  'te',
+  { granularity: 'grapheme' },
+);
+
+function graphemeCount(text: string): number {
+  return [
+    ...graphemeSegmenter.segment(
+      text.normalize('NFC'),
+    ),
+  ].length;
+}
@@ class fields @@
-  private readonly selectionCatalog: SourceCatalogRow[];
+  private readonly byComplexity =
+    new Map<number, DummyRow[]>();
@@ constructor row processing @@
-      const count = wordCount(row.text);
+      const count = graphemeCount(row.text);
       if (count <= 0) throw new Error(`Empty dummy row in ${id}: ${row.sourceKey}`);
       this.byKey.set(row.sourceKey, row);
-      return { sourceKey: row.sourceKey, wordCount: count };
+      const rows = this.byComplexity.get(count) ?? [];
+      rows.push(row);
+      this.byComplexity.set(count, rows);
@@ replace catalog() @@
-  catalog(): readonly SourceCatalogRow[] {
-    return this.selectionCatalog;
+  rowCount(): number {
+    return this.byKey.size;
+  }
+
+  complexityClasses(): readonly SourceComplexityClass[] {
+    return [...this.byComplexity.entries()]
+      .map(([complexityValue, rows]) => ({
+        complexityValue,
+        rowCount: rows.length,
+      }))
+      .sort((a, b) => a.complexityValue - b.complexityValue);
+  }
+
+  candidateAt(
+    complexityValue: number,
+    classIndex: number,
+  ): SourceCandidate {
+    const rows = this.byComplexity.get(complexityValue);
+    const row = rows?.[classIndex];
+    if (!row) {
+      throw new Error(
+        `Invalid complexity member ${this.id}/${complexityValue}/${classIndex}.`,
+      );
+    }
+    return {
+      sourceKey: row.sourceKey,
+      complexityValue,
+    };
   }
@@ prepare() return @@
-    return { text: row.text };
+    return {
+      text: row.text,
+      media: [
+        {
+          kind: 'text',
+          language: 'te',
+          text: row.text,
+        },
+      ],
+    };
+
+@@ add info() @@
+  info() {
+    return {
+      sourceId: this.id,
+      displayName: this.id,
+      provider: 'Telugu Now',
+      license: 'Development fixture',
+      upstreamUrl: null,
+      catalogVersion: 2,
+      acceptedRows: this.rowCount(),
+      rejectedRows: 0,
+      complexityMetric: 'grapheme-count' as const,
+      status: 'fixture' as const,
+    };
+  }

ti/server/src/sources/prepared-corpus/prepared-corpus-store.ts

@@ new file @@
+import fs from 'node:fs';
+import Database from 'better-sqlite3';
+import { config } from '../../config/config';
+import type {
+  DataSourceInfo,
+} from '../../../../shared/contracts';
+
+interface CanonicalRow {
+  source_id: string;
+  source_key: string;
+  text: string;
+  grapheme_count: number;
+  audio_sha256: string;
+  audio_object_key: string;
+  audio_mime_type: string;
+  duration_seconds: number;
+}
+
+export class PreparedCorpusStore {
+  private readonly db: Database.Database | null;
+
+  constructor(databasePath = config.corpusDatabasePath) {
+    this.db = fs.existsSync(databasePath)
+      ? new Database(databasePath, {
+          readonly: true,
+          fileMustExist: true,
+        })
+      : null;
+  }
+
+  hasSource(sourceId: string): boolean {
+    if (!this.db) return false;
+    return Boolean(
+      this.db.prepare(
+        'SELECT 1 FROM sources WHERE source_id = ? AND status = ?',
+      ).get(sourceId, 'ready'),
+    );
+  }
+
+  sourceInfo(sourceId: string): DataSourceInfo {
+    // SELECT canonical source metadata from sources.
+    // Throw CORPUS_SOURCE_MISSING when absent.
+  }
+
+  rowCount(sourceId: string): number {
+    // SELECT accepted_rows FROM sources.
+  }
+
+  complexityClasses(
+    sourceId: string,
+  ): Array<{
+    complexityValue: number;
+    rowCount: number;
+  }> {
+    // SELECT grapheme_count, COUNT(*)
+    // FROM source_complexity_members
+    // WHERE source_id = ?
+    // GROUP BY grapheme_count
+    // ORDER BY grapheme_count.
+  }
+
+  sourceKeyAt(
+    sourceId: string,
+    graphemeCount: number,
+    classIndex: number,
+  ): string {
+    // Indexed lookup by:
+    // source_id + grapheme_count + class_index.
+  }
+
+  row(sourceId: string, sourceKey: string): CanonicalRow {
+    // Read canonical source row.
+  }
+}
+
+export const preparedCorpusStore =
+  new PreparedCorpusStore();

ti/server/src/sources/prepared-corpus/prepared-corpus-data-source.ts

@@ new file @@
+import type {
+  DataSource,
+  PreparedSourceObservation,
+  SourceCandidate,
+  SourceComplexityClass,
+} from '../../domain/source';
+import {
+  preparedCorpusStore,
+  type PreparedCorpusStore,
+} from './prepared-corpus-store';
+
+export class PreparedCorpusDataSource implements DataSource {
+  readonly enabled = true;
+
+  constructor(
+    readonly id: string,
+    private readonly store: PreparedCorpusStore = preparedCorpusStore,
+  ) {}
+
+  rowCount(): number {
+    return this.store.rowCount(this.id);
+  }
+
+  complexityClasses(): readonly SourceComplexityClass[] {
+    return this.store.complexityClasses(this.id);
+  }
+
+  candidateAt(
+    complexityValue: number,
+    classIndex: number,
+  ): SourceCandidate {
+    return {
+      sourceKey: this.store.sourceKeyAt(
+        this.id,
+        complexityValue,
+        classIndex,
+      ),
+      complexityValue,
+    };
+  }
+
+  async prepare(
+    candidate: SourceCandidate,
+  ): Promise<PreparedSourceObservation> {
+    const row = this.store.row(this.id, candidate.sourceKey);
+
+    return {
+      text: row.text,
+      media: [
+        {
+          kind: 'text',
+          language: 'te',
+          text: row.text,
+        },
+        {
+          kind: 'audio',
+          objectKey: row.audio_object_key,
+          mimeType: row.audio_mime_type,
+          durationSeconds: row.duration_seconds,
+          sha256: row.audio_sha256,
+        },
+      ],
+    };
+  }
+
+  info() {
+    return this.store.sourceInfo(this.id);
+  }
+}

ti/server/src/services/source-registry.ts

@@ imports @@
+import { PreparedCorpusDataSource } from '../sources/prepared-corpus/prepared-corpus-data-source';
+import { preparedCorpusStore } from '../sources/prepared-corpus/prepared-corpus-store';
+
+const REQUIRED_PREPARED_SOURCE_IDS = [
+  'fleurs-te',
+  'shrutilipi-te',
+  'indicvoices-te',
+] as const;
@@ constructor() after dummy sources @@
     this.register(new DummyDataSource('source1', source1Rows));
     this.register(new DummyDataSource('source2', source2Rows));
     this.register(new DummyDataSource('source3', source3Rows));
+
+    for (const sourceId of REQUIRED_PREPARED_SOURCE_IDS) {
+      if (preparedCorpusStore.hasSource(sourceId)) {
+        this.register(
+          new PreparedCorpusDataSource(sourceId),
+        );
+      }
+    }
@@ add methods @@
+  assertPreparedSourcesPresent(): void {
+    const missing = REQUIRED_PREPARED_SOURCE_IDS.filter(
+      (sourceId) => !this.sources.has(sourceId),
+    );
+    if (missing.length > 0) {
+      throw new Error(
+        `CORPUS_NOT_PREPARED:${missing.join(',')}`,
+      );
+    }
+  }
+
+  sourceInfo() {
+    return this.selectableSources()
+      .map((source) => source.info());
+  }

ti/server/src/services/selection-engine.ts

@@ constants/types @@
-export const COMPLEXITY_REFERENCE_VERSION = 1;
+export const COMPLEXITY_REFERENCE_VERSION = 2;
 interface ComplexityClass {
-  wordCount: number;
+  complexityValue: number;
   globalCount: number;
   percentileStart: number;
   percentileEnd: number;
 }
 export interface SelectionResult {
   sourceId: string;
   sourceKey: string;
-  wordCount: number;
+  complexityValue: number;
   snapshot: SelectionSnapshot;
 }
@@ ComplexityReferenceDescription.classes @@
-    wordCount: number;
+    complexityValue: number;
@@ delete sourceWordCountMap() completely @@
-function sourceWordCountMap(...) { ... }
@@ constructor global reference construction @@
-    for (const source of registry.selectableSources()) {
-      for (const row of source.catalog()) {
-        counts.set(row.wordCount, (counts.get(row.wordCount) ?? 0) + 1);
-      }
-    }
+    for (const source of registry.selectableSources()) {
+      for (const item of source.complexityClasses()) {
+        counts.set(
+          item.complexityValue,
+          (counts.get(item.complexityValue) ?? 0) + item.rowCount,
+        );
+      }
+    }
@@ class construction @@
-      .map(([wordCount, globalCount]) => {
+      .map(([complexityValue, globalCount]) => {
@@
-          wordCount,
+          complexityValue,
@@ source selection @@
-      const sourceRowCount = source.catalog().length;
+      const sourceRowCount = source.rowCount();
@@ row-selection setup @@
-    const classByWordCount = new Map(classMasses.map((item) => [item.wordCount, item]));
-    const rowsByWordCount = sourceWordCountMap(selectedSourceEntry.source);
-
-    const sourceClasses = [...rowsByWordCount.entries()].map(([wordCount, rows]) => {
-      const complexity = classByWordCount.get(wordCount);
-      ...
-      return { wordCount, rows, complexity, classMass: rows.length * complexity.perRowMass };
-    });
+    const classByValue = new Map(
+      classMasses.map((item) => [
+        item.complexityValue,
+        item,
+      ]),
+    );
+
+    const sourceClasses =
+      selectedSourceEntry.source
+        .complexityClasses()
+        .map((item) => {
+          const complexity =
+            classByValue.get(item.complexityValue);
+          if (!complexity) {
+            throw new Error(
+              `Complexity ${item.complexityValue} absent from global reference.`,
+            );
+          }
+          return {
+            complexityValue: item.complexityValue,
+            rowCount: item.rowCount,
+            complexity,
+            classMass:
+              item.rowCount *
+              complexity.perRowMass,
+          };
+        });
@@ selected row @@
-    const selectedRow = weightedPick(selectedClass.rows, () => 1, this.random);
+    const rowIndex = Math.floor(
+      Math.min(
+        Math.max(this.random(), 0),
+        1 - Number.EPSILON,
+      ) * selectedClass.rowCount,
+    );
+
+    const selectedRow =
+      selectedSourceEntry.source.candidateAt(
+        selectedClass.complexityValue,
+        rowIndex,
+      );
@@ denominator @@
-      sum + item.rows.length * item.complexity.perRowMass
+      sum + item.rowCount * item.complexity.perRowMass
@@ SelectionResult + snapshot @@
-      wordCount: selectedRow.wordCount,
+      complexityValue: selectedRow.complexityValue,
       snapshot: {
@@
-        wordCount: selectedRow.wordCount,
+        complexityMetric: 'grapheme-count',
+        intrinsicComplexityValue:
+          selectedRow.complexityValue,
         complexityReferenceVersion:
           COMPLEXITY_REFERENCE_VERSION,
@@
-        globalRowsAtWordCount:
+        globalRowsAtComplexityValue:
           selectedClass.complexity.globalCount,
@@
-        selectedSourceRowsAtWordCount:
-          selectedClass.rows.length,
+        selectedSourceRowsAtComplexityValue:
+          selectedClass.rowCount,

ti/server/src/db/database.ts

@@ source_records CREATE TABLE @@
   CREATE TABLE IF NOT EXISTS source_records (
     source_id TEXT NOT NULL,
     source_key TEXT NOT NULL,
     text TEXT NOT NULL,
+    media_json TEXT NOT NULL DEFAULT '[]',
     prepared_at INTEGER NOT NULL,
     PRIMARY KEY (source_id, source_key)
   );
@@ migrations after cache_hit / selection_snapshot_json migrations @@
+if (!columnExists('source_records', 'media_json')) {
+  db.exec(`
+    ALTER TABLE source_records
+    ADD COLUMN media_json TEXT NOT NULL DEFAULT '[]';
+  `);
+}
@@ Iteration 1 source-record backfill @@
-  INSERT OR IGNORE INTO source_records (source_id, source_key, text, prepared_at)
-  SELECT source_id, source_key, text, COALESCE(prepared_at, selected_at)
+  INSERT OR IGNORE INTO source_records (
+    source_id,
+    source_key,
+    text,
+    media_json,
+    prepared_at
+  )
+  SELECT
+    source_id,
+    source_key,
+    text,
+    '[]',
+    COALESCE(prepared_at, selected_at)

ti/server/src/services/source-record-service.ts

@@ imports @@
+import type {
+  MediaItem,
+} from '../../../shared/contracts';
@@ ResolvedSourceRecord @@
   text: string;
+  media: MediaItem[];
@@ CachedRow / FreshResolution @@
 interface CachedRow {
   text: string;
+  media_json: string;
 }
@@
 interface FreshResolution {
   text: string;
+  media: MediaItem[];
@@ cached() query @@
-      SELECT text
+      SELECT text, media_json
@@ cache-hit return @@
+      const parsed = JSON.parse(existing.media_json) as MediaItem[];
+      const media =
+        parsed.length > 0
+          ? parsed
+          : [{
+              kind: 'text' as const,
+              language: 'te' as const,
+              text: existing.text,
+            }];
       return {
@@
         text: existing.text,
+        media,
@@ fresh return @@
       text: fresh.text,
+      media: fresh.media,
@@ fetchAndCache() INSERT @@
-      INSERT INTO source_records (source_id, source_key, text, prepared_at)
-      VALUES (?, ?, ?, ?)
+      INSERT INTO source_records (
+        source_id,
+        source_key,
+        text,
+        media_json,
+        prepared_at
+      )
+      VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(source_id, source_key) DO UPDATE SET
         text = excluded.text,
+        media_json = excluded.media_json,
         prepared_at = excluded.prepared_at
-    `).run(sourceId, sourceKey, prepared.text, requestCompletedAt);
+    `).run(
+      sourceId,
+      sourceKey,
+      prepared.text,
+      JSON.stringify(prepared.media),
+      requestCompletedAt,
+    );
@@ returned FreshResolution @@
       text: prepared.text,
+      media: prepared.media,

ti/server/src/services/profile-service.ts

@@ parseSelectionSnapshot() @@
 function parseSelectionSnapshot(raw: string): SelectionSnapshot | null {
   try {
     const value = JSON.parse(raw) as Partial<SelectionSnapshot>;
-    return typeof value.sourceId === 'string' && typeof value.sourceKey === 'string'
-      ? value as SelectionSnapshot
-      : null;
+    if (
+      typeof value.sourceId !== 'string' ||
+      typeof value.sourceKey !== 'string'
+    ) {
+      return null;
+    }
+
+    if (
+      value.complexityMetric === undefined &&
+      typeof value.wordCount === 'number'
+    ) {
+      return {
+        ...value,
+        complexityMetric: 'word-count',
+        intrinsicComplexityValue: value.wordCount,
+        globalRowsAtComplexityValue:
+          value.globalRowsAtWordCount ?? 0,
+        selectedSourceRowsAtComplexityValue:
+          value.selectedSourceRowsAtWordCount ?? 0,
+      } as SelectionSnapshot;
+    }
+
+    return value as SelectionSnapshot;
   } catch {
     return null;
   }
 }

ti/server/src/index.ts

@@ imports @@
+import { sourceRegistry } from './services/source-registry';
+import type {
+  DataSourcesResponse,
+  ...
+} from '../../shared/contracts';
@@ before route setup / server startup @@
+sourceRegistry.assertPreparedSourcesPresent();
@@ after health endpoint @@
+app.get('/api/data-sources', (c) =>
+  c.json<DataSourcesResponse>({
+    sources: sourceRegistry.sourceInfo(),
+  }),
+);

ti/frontend/src/api.ts

@@ contract imports @@
+  DataSourcesResponse,
@@ after parseJson() @@
+export async function getDataSources(): Promise<DataSourcesResponse> {
+  return parseJson<DataSourcesResponse>(
+    await fetch('/api/data-sources'),
+  );
+}

ti/frontend/src/settings/types.ts

@@ SettingsPage @@
   | 'diagnostic'
-  | 'export';
+  | 'export'
+  | 'dataSources';

ti/frontend/src/settings/settings-utils.ts

@@ sourceDisplayName() @@
 export function sourceDisplayName(
   sourceId: string,
 ): string {
+  const preparedNames: Record<string, string> = {
+    'fleurs-te': 'FLEURS',
+    'shrutilipi-te': 'Shrutilipi',
+    'indicvoices-te': 'IndicVoices',
+  };
+
+  if (preparedNames[sourceId]) {
+    return preparedNames[sourceId];
+  }
+
   const match =
     /^source(\d+)$/.exec(
       sourceId,
     );

ti/frontend/src/settings/language.ts

@@ English COPY @@
     export: 'Export',
+    dataSources: 'Data sources',
+    provider: 'Provider',
+    license: 'License',
+    sourceRepository: 'Source repository',
+    catalogVersion: 'Catalog version',
+    acceptedRows: 'Accepted rows',
+    rejectedRows: 'Rejected rows',
+    sourceStatus: 'Status',
+    complexityMetric: 'Complexity metric',
+    sourceReady: 'Ready',
+    sourceFixture: 'Development fixture',
@@ Telugu COPY @@
     export: 'ఎగుమతి',
+    dataSources: 'డేటా మూలాలు',
+    provider: 'ప్రదాత',
+    license: 'లైసెన్స్',
+    sourceRepository: 'మూల రిపోజిటరీ',
+    catalogVersion: 'క్యాటలాగ్ సంచిక',
+    acceptedRows: 'ఆమోదించిన వరుసలు',
+    rejectedRows: 'తిరస్కరించిన వరుసలు',
+    sourceStatus: 'స్థితి',
+    complexityMetric: 'సంక్లిష్టత ప్రమాణం',
+    sourceReady: 'సిద్ధం',
+    sourceFixture: 'అభివృద్ధి నమూనా',

ti/frontend/src/settings/pages/SettingsIndex.tsx

@@ entries label union @@
       label:
         | 'complexity'
         | 'sourceWeights'
         | 'diagnostic'
-        | 'export';
+        | 'export'
+        | 'dataSources';
@@ entries array after Export @@
+      {
+        page: 'dataSources',
+        label: 'dataSources',
+      },

ti/frontend/src/settings/pages/DataSourcesPage.tsx

@@ new file @@
+import {
+  useEffect,
+  useState,
+} from 'react';
+import type {
+  DataSourceInfo,
+} from '../../../../shared/contracts';
+import {
+  getDataSources,
+} from '../../api';
+import {
+  t,
+} from '../language';
+import type {
+  UiLanguage,
+} from '../types';
+
+export function DataSourcesPage({
+  language,
+}: {
+  language: UiLanguage;
+}) {
+  const [sources, setSources] =
+    useState<DataSourceInfo[] | null>(null);
+
+  useEffect(() => {
+    let active = true;
+    void getDataSources().then((response) => {
+      if (active) setSources(response.sources);
+    });
+    return () => {
+      active = false;
+    };
+  }, []);
+
+  if (!sources) {
+    return <div className="diagnostic-empty">...</div>;
+  }
+
+  return (
+    <div className="data-source-list">
+      {sources.map((source) => (
+        <section
+          className="data-source-card"
+          key={source.sourceId}
+        >
+          <h2>{source.displayName}</h2>
+          <dl>
+            <dt>{t(language, 'provider')}</dt>
+            <dd>{source.provider}</dd>
+            <dt>{t(language, 'license')}</dt>
+            <dd>{source.license}</dd>
+            <dt>{t(language, 'catalogVersion')}</dt>
+            <dd>{source.catalogVersion}</dd>
+            <dt>{t(language, 'acceptedRows')}</dt>
+            <dd>{source.acceptedRows}</dd>
+            <dt>{t(language, 'rejectedRows')}</dt>
+            <dd>{source.rejectedRows}</dd>
+            <dt>{t(language, 'complexityMetric')}</dt>
+            <dd>{source.complexityMetric}</dd>
+          </dl>
+
+          {source.upstreamUrl ? (
+            <a
+              href={source.upstreamUrl}
+              target="_blank"
+              rel="noreferrer"
+            >
+              {t(language, 'sourceRepository')}
+            </a>
+          ) : null}
+        </section>
+      ))}
+    </div>
+  );
+}

ti/frontend/src/settings/SettingsView.tsx

@@ imports @@
+import { DataSourcesPage } from './pages/DataSourcesPage';
@@ before final Export return @@
+  if (page === 'dataSources') {
+    return (
+      <SettingsShell
+        {...shellProps}
+        title={t(language, 'dataSources')}
+        onBack={controller.backToIndex}
+      >
+        <DataSourcesPage
+          language={language}
+        />
+      </SettingsShell>
+    );
+  }
+  // Existing final return remains Export.

ti/frontend/src/settings/diagnostic.ts

@@ DIAGNOSTIC_LABELS @@
-  wordCount: {
-    en: 'Word count',
-    te: 'పదాల సంఖ్య',
+  complexityMetric: {
+    en: 'Complexity metric',
+    te: 'సంక్లిష్టత ప్రమాణం',
+  },
+  intrinsicComplexityValue: {
+    en: 'Grapheme count',
+    te: 'గ్రాఫీమ్ సంఖ్య',
@@
-  globalRowsAtWordCount: {
-    en: 'Global rows at word count',
-    te: 'ఆ పదాల సంఖ్యలో ప్రపంచ వరుసలు',
+  globalRowsAtComplexityValue: {
+    en: 'Global rows at complexity value',
+    te: 'ఆ సంక్లిష్టత విలువలో ప్రపంచ వరుసలు',
@@
-  selectedSourceRowsAtWordCount: {
-    en: 'Source rows at word count',
-    te: 'ఆ పదాల సంఖ్యలో మూల వరుసలు',
+  selectedSourceRowsAtComplexityValue: {
+    en: 'Source rows at complexity value',
+    te: 'ఆ సంక్లిష్టత విలువలో మూల వరుసలు',
@@ selectionRows() @@
-    {
-      key: 'wordCount',
-      value: String(selection.wordCount),
-    },
+    {
+      key: 'complexityMetric',
+      value: selection.complexityMetric,
+    },
+    {
+      key: 'intrinsicComplexityValue',
+      value: String(selection.intrinsicComplexityValue),
+    },
@@
-      key: 'globalRowsAtWordCount',
+      key: 'globalRowsAtComplexityValue',
       value: String(
-        selection.globalRowsAtWordCount,
+        selection.globalRowsAtComplexityValue,
       ),
@@
-      key: 'selectedSourceRowsAtWordCount',
+      key: 'selectedSourceRowsAtComplexityValue',
       value: String(
-        selection.selectedSourceRowsAtWordCount,
+        selection.selectedSourceRowsAtComplexityValue,
       ),

ti/frontend/src/export-viewer.ts

@@ rowsFor(entry) diagnostic mapping @@
-    ['Word count',selection.wordCount],
+    ['Complexity metric',selection.complexityMetric],
+    ['Grapheme count',selection.intrinsicComplexityValue],
@@
-    ['Global rows at word count',selection.globalRowsAtWordCount],
+    ['Global rows at complexity value',selection.globalRowsAtComplexityValue],
@@
-    ['Source rows at word count',selection.selectedSourceRowsAtWordCount],
+    ['Source rows at complexity value',selection.selectedSourceRowsAtComplexityValue],

ti/frontend/src/styles/settings.css

@@ after diagnostic-table styles, before media query @@
+.data-source-list {
+  display: grid;
+  gap: 1rem;
+}
+
+.data-source-card {
+  padding: 1rem;
+  border: 1px solid rgba(30, 30, 30, 0.11);
+  border-radius: 0.9rem;
+  background: rgba(255, 255, 255, 0.13);
+}
+
+.data-source-card h2 {
+  margin: 0 0 0.8rem;
+  color: rgba(20, 20, 20, 0.86);
+}
+
+.data-source-card dl {
+  display: grid;
+  grid-template-columns: minmax(8rem, 1fr) minmax(0, 2fr);
+  gap: 0.45rem 1rem;
+  margin: 0 0 0.8rem;
+}
+
+.data-source-card dt {
+  color: rgba(20, 20, 20, 0.58);
+}
+
+.data-source-card dd {
+  margin: 0;
+  overflow-wrap: anywhere;
+}
+
+.data-source-card a {
+  color: rgba(20, 20, 20, 0.7);
+}

ti/tests/selection-math.test.ts

@@ test helper source rows @@
-    wordCount: index + 1,
+    complexityValue: index + 1,
@@ reference assertions @@
-    reference.classes.map(({ wordCount, globalCount }) => [wordCount, globalCount]),
+    reference.classes.map(
+      ({ complexityValue, globalCount }) => [
+        complexityValue,
+        globalCount,
+      ],
+    ),
@@ snapshot assertions @@
-      snapshot.globalPerRowComplexityMass *
-      snapshot.globalRowsAtWordCount,
+      snapshot.globalPerRowComplexityMass *
+      snapshot.globalRowsAtComplexityValue,
@@ expected reference version @@
-  1
+  2
@@ all remaining test names/variables that say wordCount @@
-wordCount
+complexityValue

ti/tests/selection-oracle.test.ts

@@ independent fixture complexity @@
-function independentWordCount(...)
+function independentGraphemeCount(text: string): number {
+  return [
+    ...new Intl.Segmenter(
+      'te',
+      { granularity: 'grapheme' },
+    ).segment(text.normalize('NFC')),
+  ].length;
+}
@@ oracle row representation @@
-  wordCount: number;
+  complexityValue: number;
@@ all global/source complexity maps @@
-globalCountByWordCount
-sourceCountsByWordCount
+globalCountByComplexity
+sourceCountsByComplexity
@@ expected snapshot fields @@
-  wordCount
-  globalRowsAtWordCount
-  selectedSourceRowsAtWordCount
+  complexityMetric: 'grapheme-count'
+  intrinsicComplexityValue
+  globalRowsAtComplexityValue
+  selectedSourceRowsAtComplexityValue
@@ reference version @@
-1
+2

ti/tests/core-implementation.test.ts

@@ temporary environment setup before server imports @@
+process.env.CORPUS_DATABASE_PATH =
+  path.join(temporaryDirectory, 'corpus.sqlite');
@@ before importing source-registry/selection modules @@
+// Create a minimal prepared-corpus SQLite fixture containing:
+// fleurs-te, shrutilipi-te and indicvoices-te.
+// Each source gets at least one canonical row and one complexity-member row.
+// This keeps the singleton registry at six sources during Iteration 3 tests.
@@ source catalog assertions @@
-      assert.ok(source.catalog().every((row) => row.wordCount > 0));
+      assert.ok(source.rowCount() > 0);
+      assert.ok(
+        source
+          .complexityClasses()
+          .every(
+            (item) =>
+              item.complexityValue > 0 &&
+              item.rowCount > 0,
+          ),
+      );
@@ selectable-source count expectation @@
-3
+6
@@ new assertions @@
+assert.deepEqual(
+  sourceRegistryModule.sourceRegistry
+    .selectableSourceIds()
+    .sort(),
+  [
+    'fleurs-te',
+    'indicvoices-te',
+    'shrutilipi-te',
+    'source1',
+    'source2',
+    'source3',
+  ].sort(),
+);

ti/tests/prepared-corpus.test.ts

@@ new file @@
+// Add tests that construct a temporary corpus.sqlite and verify:
+//
+// - PreparedCorpusStore discovers all three real sources.
+// - rowCount() matches `sources.accepted_rows`.
+// - complexityClasses() matches source_complexity_members.
+// - candidateAt(value,index) deterministically resolves the correct source key.
+// - prepare() emits exactly one TextMedia and one AudioMedia.
+// - audio object metadata survives without loading/rendering the audio.
+// - duplicate/missing source identifiers fail.
+// - source info exposes:
+//     display name
+//     provider
+//     CC BY 4.0
+//     upstream Hugging Face URL
+//     catalog version
+//     accepted/rejected rows.

ti/tests/repository-contract.test.ts

@@ controller test @@
+    assert.ok(
+      read('control.sh').includes(
+        './$SCRIPT_NAME data',
+      ) ||
+      read('control.sh').includes(
+        'run_data_domain',
+      ),
+    );
@@ required frontend/backend files @@
+      'frontend/src/settings/pages/DataSourcesPage.tsx',
+      'server/src/sources/prepared-corpus/prepared-corpus-store.ts',
+      'server/src/sources/prepared-corpus/prepared-corpus-data-source.ts',
@@ add data-transform assertions using repo root = path.resolve(root, '..') @@
+    assert.equal(
+      fs.existsSync(
+        path.join(
+          root,
+          '..',
+          'data-transform',
+          'scripts',
+          'prepare-corpus',
+          'prepare.py',
+        ),
+      ),
+      true,
+    );
+
+    assert.equal(
+      fs.existsSync(
+        path.join(
+          root,
+          '..',
+          'data-transform',
+          'requirements.txt',
+        ),
+      ),
+      true,
+    );
@@ source contract assertions @@
+    assert.ok(
+      read('server/src/services/source-registry.ts')
+        .includes("'fleurs-te'"),
+    );
+    assert.ok(
+      read('server/src/services/source-registry.ts')
+        .includes("'shrutilipi-te'"),
+    );
+    assert.ok(
+      read('server/src/services/source-registry.ts')
+        .includes("'indicvoices-te'"),
+    );

ti/README.md

@@ Stack / setup section @@
+## Prepared corpus prerequisite
+
+Telugu Now does not parse upstream FLEURS, Shrutilipi or IndicVoices
+files at application runtime.
+
+The `data-transform/` workspace owns acquisition preprocessing and
+canonical corpus generation.
+
+For the committed sample corpus:
+
+```bash
+python -m pip install -r ../data-transform/requirements.txt
+./control.sh data --option prepare
+```
+
+This transforms:
+
+```text
+../data-transform/sample/
+```
+
+into:
+
+```text
+data/corpus/
+├── manifest.json
+├── corpus.sqlite
+├── objects/
+└── reports/
+```
+
+`./control.sh dev` never performs this transformation. It requires
+the prepared corpus to already exist and fails with
+`CORPUS_NOT_PREPARED` otherwise.
+
+`./control.sh data --option samples` rebuilds source-shaped samples
+from `data-transform/raw/`.
+
+`./control.sh data --option prepare` transforms the current sample
+directory into the canonical local corpus.
+
+`./control.sh data --option all` performs both stages sequentially.
+
+The preparation scripts accept explicit input/output paths and are
+the same scripts intended for the eventual complete datasets.
+
+Production will publish the equivalent canonical media objects to
+Tigris while keeping the indexed corpus catalog local to the Fly
+application for selection queries.
@@ source-selection documentation @@
-Iteration 2 has exactly three selectable dummy sources:
+Iteration 3 has six selectable sources:
 
 - `source1`
 - `source2`
 - `source3`
+- `fleurs-te`
+- `shrutilipi-te`
+- `indicvoices-te`
@@ complexity documentation @@
-Iteration 2 uses word count
+Iteration 3 uses Unicode extended grapheme-cluster count for all six
+selectable sources. Grapheme counts for prepared real sources are
+computed once during corpus preparation and persisted in
+`corpus.sqlite`. The dummy sources use the same metric at runtime.
@@ add data-source attribution section @@
+## Data sources
+
+- FLEURS — Google — CC BY 4.0 —
+  `https://huggingface.co/datasets/google/fleurs`
+- Shrutilipi — AI4Bharat — CC BY 4.0 —
+  `https://huggingface.co/datasets/ai4bharat/Shrutilipi`
+- IndicVoices — AI4Bharat — CC BY 4.0 —
+  `https://huggingface.co/datasets/ai4bharat/IndicVoices`
+
+The Settings → Data sources page exposes these attributions together
+with catalog version, accepted/rejected row counts, complexity metric
+and deployed source status.

impl-iterations/iteration3.md

@@ replace the existing two-point draft with the finalized scope @@
-1. First we will add 100 rows of sample data from each data source ...
-2. Then, we will add the data sources ...
+1. `data-transform/` is the exclusive corpus-transformation boundary.
+   Telugu Now build/start does not transform upstream data.
+2. `control.sh data` exposes `samples`, `prepare`, and `all` only as
+   explicit convenience dispatchers to `data-transform/scripts/`.
+3. Source-shaped input is transformed into a canonical corpus with
+   SQLite metadata/indexes plus content-addressed media objects.
+4. The same transformation accepts the committed 100-row samples or
+   the eventual complete source directories through input/output
+   arguments.
+5. FLEURS canonical text is `raw_transcription`; Shrutilipi and
+   IndicVoices canonical text is `text`.
+6. Stable source identity is split + source-native audio path/name;
+   train/dev/valid/validation/test are normalized to a canonical split
+   while retaining the upstream split.
+7. Every row gets one persisted NFC extended-grapheme count,
+   text SHA-256, audio SHA-256, duration and canonical audio object key.
+8. Missing individual rows are rejected and reported; schema changes,
+   unknown splits and source-key collisions fail preparation.
+9. FLEURS expects WAV; Shrutilipi and IndicVoices expect FLAC.
+   Signatures are verified and audio is not transcoded.
+10. Iteration 3 adds `fleurs-te`, `shrutilipi-te`, and
+    `indicvoices-te` beside the three mock sources for six independently
+    weighted sources.
+11. Complexity reference version 2 uses grapheme counts across all six
+    selectable sources.
+12. Runtime selection reads indexed canonical metadata and does not call
+    Hugging Face or parse upstream Parquet/TSV.
+13. The formal Media model stores both TextMedia and AudioMedia, but
+    the Iteration 3 observation UI renders only TextMedia.
+14. Development resolves canonical media object keys against the local
+    prepared corpus. Production will resolve equivalent keys against
+    Tigris.
+15. Settings gains a Data sources page containing attribution, license,
+    upstream repository, catalog counts/version and source health.