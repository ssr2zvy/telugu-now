# Data Transformation and Dummy Data

The development data in this Codespace is **dummy data for testing**, not the
full datasets. It consists of the first **100 rows per source (300 total)**
from the supplied files, with real text and matching audio rather than
synthetic recordings. Truncation was a one-time operation, not a pipeline stage.

| Source | Original raw filenames | Retained rows | Supplied file rows |
| --- | --- | ---: | ---: |
| FLEURS | `dev.tsv`, `dev.tar.gz` | 100 | 311 |
| Shrutilipi | `train-00000-of-00012.parquet` | 100 | 4,674 |
| IndicVoices | `valid-00000-of-00001.parquet` | 100 | 3,295 |

Filenames, source formats, Parquet schemas and metadata, and retained column
values were preserved. The reduced FLEURS archive contained exactly the 100
referenced WAV files with their original `dev/` paths and unchanged audio bytes.
The full-size originals at the repository root were removed after verification.

## Pipeline Locations

All paths below are relative to the repository root:

```text
local-machine/data-transform/raw/{FLEURS,Shrutilipi,IndicVoices}/
    -> data --option samples
local-machine/data-transform/sample/{FLEURS,Shrutilipi,IndicVoices}/
    -> data --option prepare
data/corpus/  (corpus.sqlite, manifest.json, objects/, reports/)
```

Raw, sample, and prepared files are local working data and are Git-ignored.
This README lives outside the consumed inputs and remains after processing.
The pipeline does not download datasets or upload anything to Tigris.

## Process All Available Rows

Run from the repository root with Python 3.12, the packages declared in
`requirements.txt`, and `ffmpeg` installed. The existing local environment is
`.venv/` under this directory:

```bash
export PYTHON="$PWD/local-machine/data-transform/.venv/bin/python"
bash local-machine/control_local.sh data --option samples --rows all
bash local-machine/control_local.sh data --option prepare
```

Alternatively, `data --option all --rows all` runs both stages. The `--rows all`
flag matters: `--option all` alone still defaults to a 100-row extraction limit.
All-row extraction discovers available FLEURS splits and all Parquet shards,
including the supplied IndicVoices `valid` shard.

`samples` consumes raw rows and appends to existing samples. `prepare` processes
all available samples, validates and atomically replaces the entire prepared
corpus, then deletes consumed sample files. It does not append to an existing
corpus. Raw and sample folders can therefore be empty after a successful run.
Accepted/rejected counts are recorded in `data/corpus/manifest.json`, with
rejection details under `data/corpus/reports/`.

## Replace Dummy Data with Real Data

1. Stop the local app and any data-processing commands. Back up the existing
   `data/corpus/` if rollback is needed, and any raw/sample inputs you want to
   retain. The original full-size uploads are no longer available here; obtain
   fresh copies. Keep an external source copy if repeat processing is required.

   ```bash
   bash local-machine/control_local.sh dev --option stop
   ```

2. Remove only the old raw and sample working directories, then recreate the
   raw source folders. This avoids mixing dummy rows with real rows, because
   extraction preserves existing samples. These commands discard any inputs
   currently in those two directories:

   ```bash
   rm -rf -- local-machine/data-transform/raw local-machine/data-transform/sample
   mkdir -p local-machine/data-transform/raw/{FLEURS,Shrutilipi,IndicVoices}
   ```

3. Put full upstream files in the appropriate raw folders. FLEURS needs matching
   `<split>.tsv` and `<split>.tar.gz` pairs for available `dev`, `test`, or `train`
   splits; archives must retain their `<split>/<audio-filename>` member paths.
   Put Shrutilipi and IndicVoices Parquet shards under their respective source
   folders, preserving source schemas and any split subdirectories.

4. Run the all-row commands above. There is no need to delete `data/corpus/`
   first: successful preparation replaces it, including old dummy audio and
   corpus-side caches. On preparation failure, the previous corpus and sample
   inputs remain available. Verify source counts and rejection reports before
   using the replacement.

5. Rebuild runtime availability when starting the local app against the new
   corpus:

   ```bash
   CORPUS_BACKEND=local CORPUS_AVAILABILITY_REBUILD_ON_STARTUP=true bash local-machine/control_local.sh dev --option start
   ```

Do not delete the entire `data/` directory: `data/user/` and other runtime state
are separate from corpus preparation. This local workflow does not update a
Tigris bucket or a Fly volume. Publishing a production corpus is a separate
operation; an existing Fly corpus database is not refreshed by a local run.