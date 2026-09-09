# Build the Final Data Directory

Produce the final `data/` directory from these downloaded Parquet files:

```text
./tigris-download/indicVoice_telugu/indicVoices/*.parquet
./tigris-download/indicVoice_telugu/Shrutilipi(done)/*.parquet
```

Run everything on the system containing the downloads. These instructions process all downloaded IndicVoices and Shrutilipi shards and do not require FLEURS. The task ends with the final `data/` directory; deployment is not included.

Stop if any command fails. Do not run concurrent pipeline operations or modify inputs while processing.

## 1. Set Up Python

Start in the directory containing `./tigris-download/`. Replace `REPO` with the absolute path to the `telugu-now` repository checkout. Python 3.12 must be installed.

```bash
DOWNLOADS="$(realpath ./tigris-download/indicVoice_telugu)"
REPO="/absolute/path/to/telugu-now"
cd "$REPO"
python3.12 -m venv .venv-data
source .venv-data/bin/activate
python -m pip install -r data-transform/requirements.txt
```

Continue all remaining steps in this same terminal, from the repository root.

## 2. Stage the Raw Files

Start with empty `data-transform/raw/` and `data-transform/sample/` directories. Move any previous inputs elsewhere first; do not mix old samples with these downloads.

```bash
mkdir -p data-transform/raw/IndicVoices data-transform/raw/Shrutilipi
cp "$DOWNLOADS/indicVoices/"*.parquet data-transform/raw/IndicVoices/
cp "$DOWNLOADS/Shrutilipi(done)/"*.parquet data-transform/raw/Shrutilipi/
```

These source paths match the download directory names exactly, including lowercase `indicVoices` and the parentheses in `Shrutilipi(done)`. The destination names match the pipeline's expected layout.

The Parquet files are the raw input format; no format conversion is needed if they match the schemas in the retained reference below. Copying preserves the original downloads because extraction consumes the staged raw files. Keep the original shard filenames.

## 3. Create the Sample Inputs

```bash
python data-transform/scripts/extract-sample-data/IndicVoices.py \
  --all-parquets --all-rows --batch-rows 20
python data-transform/scripts/extract-sample-data/Shrutilipi.py \
  --all-parquets --all-rows --batch-rows 20
```

This moves every staged shard into the corresponding sample directory:

```text
data-transform/sample/
  IndicVoices/
    train-*.parquet
  Shrutilipi/
    train-*.parquet
```

Despite the directory name, **every row is included** because `--all-rows` is supplied. The commands process only downloaded shards; they do not download any missing upstream shards.

## 4. Build the Final Corpus

The standard `control.sh data` command and `prepare.py` entry point also require FLEURS. Do not use them for this two-dataset run. The following command uses the existing readers and corpus writer to prepare only IndicVoices and Shrutilipi.

This step replaces any existing `data/corpus/`; it does not append. Back up that directory first if it must be retained, and do not replace a corpus while it is in use. Allow disk space for the original downloads, samples, the new corpus, and any previous corpus during replacement.

```bash
python - <<'PY'
import sys
from pathlib import Path

sys.path.insert(0, "data-transform/scripts/create-tigris-schema")
from common import CorpusWriter
from sources import indicvoices, shrutilipi

writer = CorpusWriter(Path("data/corpus"), replace=True, batch_rows=20)
for module, folder, reader in (
    (shrutilipi, "Shrutilipi", shrutilipi.read_shrutilipi),
    (indicvoices, "IndicVoices", indicvoices.read_indicvoices),
):
    writer.add_source(
        source_id=module.SOURCE_ID,
        display_name=module.DISPLAY_NAME,
        provider=module.PROVIDER,
        license_name=module.LICENSE,
        upstream_url=module.UPSTREAM_URL,
        catalog_version=module.CATALOG_VERSION,
        expected_audio_mime=module.EXPECTED_AUDIO_MIME,
        rows=reader(Path("data-transform/sample") / folder, batch_rows=20),
    )
writer.finalize()
PY
```

Preparation validates records, extracts audio, computes grapheme counts, builds SQLite indexes, and validates the corpus before publishing it. Samples are retained for rebuilding.

If preparation fails, fix the reported error and rerun Step 4. Do not restage duplicate inputs. Preparation restarts from the samples rather than resuming a partially built database.

## 5. Verify the Final Data Directory

```bash
python -m json.tool data/corpus/manifest.json
```

Confirm `indicvoices-te` and `shrutilipi-te` both have positive `acceptedRows`. Review `rejectedRows` and the corresponding reports under `data/corpus/reports/`; successful preparation does not mean every input row was accepted. Rejected records are excluded from the corpus.

The completed output is:

```text
data/
  corpus/
    manifest.json
    corpus.sqlite
    objects/
      media/
        indicvoices-te/
          audio/
        shrutilipi-te/
          audio/
    reports/
      indicvoices-te-rejected.jsonl
      shrutilipi-te-rejected.jsonl
```

Keep the entire output together: `corpus.sqlite` references audio files under `objects/`. The final `data/` directory is the deliverable. No deployment or application startup is required for this task.

## Raw Format Reference (Retained Handoff)

The following raw-format notes are retained from the existing handoff. They describe the importers, not additional steps for this run. FLEURS is reference-only and is not required for the two-dataset instructions above. The validation guidance in this reference concerns checking raw inputs before extraction.

Prepare `data-transform/raw/` to match the existing importers. Do not change
the importers to accommodate incorrectly formatted downloads.

### Required Layout

Directory names are case-sensitive. These are the default inputs, not a limit
on the dataset size. Preserve additional downloaded splits and shards under
the corresponding dataset directory using their original filenames.

```text
data-transform/raw/
  FLEURS/
    dev.tsv
    dev.tar.gz
  IndicVoices/
    train-00000-of-00061.parquet
  Shrutilipi/
    train-00000-of-00012.parquet
```

### FLEURS

- Use Telugu data from `google/fleurs`.
- Supply a UTF-8, headerless TSV with exactly seven columns in this order:
  `sentence_id`, `audio_filename`, `raw_transcription`,
  `normalized_transcription`, `characterized_transcription`, `num_samples`,
  `gender`.
- `dev.tar.gz` must contain `dev/<audio_filename>` for every TSV row.
- Preserve the original 16 kHz WAV audio.
- Additional splits use matching `train.tsv` and `train.tar.gz`, or `test.tsv`
  and `test.tar.gz`, with `train/` or `test/` archive members respectively.

### IndicVoices

- Use Telugu Parquet data from `ai4bharat/IndicVoices`.
- Required columns: `audio_filepath`, `text`, `duration`, `lang`, `verbatim`,
  `normalized`.
- `audio_filepath` must be a struct containing a nonempty `path` and embedded
  binary FLAC `bytes`, not a plain filename or decoded sample array.

### Shrutilipi

- Use Telugu Parquet data from `ai4bharat/Shrutilipi`.
- Required columns: `audio_filepath`, `text`, `duration`, `lang`.
- Use the same `audio_filepath` struct and embedded FLAC representation as
  IndicVoices.

### Preservation and Validation

- For both Parquet datasets, preserve original metadata, transcripts, paths,
  and split identities. Duration is in seconds.
- Do not substitute CSV, JSON, Arrow caches, or renamed non-Parquet files.
- If converting existing downloads, embed the matching original audio bytes.
  Do not fabricate missing metadata; report anything that cannot be recovered.
- Validate read-only: inspect Parquet schemas, embedded audio signatures,
  row counts, and TSV-to-archive matches. Report the resulting folder tree
  and any missing files.
- Do not run extraction or preparation for validation: the current scripts
  consume or delete their inputs.
- Do not overwrite or delete existing raw, sample, or corpus data without
  approval.