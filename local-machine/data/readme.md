# Repository Dummy Data

The dummy data in this repository is **test data**, not the full datasets.
It consists of the first **100 rows per source (300 total)** from the supplied
files, with real text and matching audio rather than synthetic recordings.
Truncation was a one-time operation, not a pipeline stage.

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
local-machine/data/corpus/  (corpus.sqlite, manifest.json, objects/, reports/)
local-machine/data/user/    (dummy user SQLite database)
```

The prepared 300-row dummy corpus, its audio, and the dummy user SQLite database
are committed so a checkout includes usable local test data. Raw, sampled, and
processed data folders are not Git-ignored. Local secrets at
`local-machine/dev-secrets.env`, the Python environment, temporary corpus
publication/backup directories, Python caches, and UI test outputs remain
ignored. This README stays under `local-machine/data/` when pipeline inputs are consumed or the
prepared corpus is replaced. The pipeline does not download datasets or upload
anything to Tigris.

Before committing updated dummy SQLite data, stop the local app and checkpoint
its WAL writes into the main databases. WAL and SHM files are runtime sidecars,
not substitutes for the database; SQLite can remove them after a clean checkpoint
and close. Only commit deliberately prepared test data, never real user data.

## Process All Available Rows

Run from the repository root with Python 3.12, the packages declared in
[requirements.txt](../data-transform/requirements.txt), and
`ffmpeg` installed. The local Python environment belongs at
`local-machine/data-transform/.venv/`:

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
The committed dummy corpus has already passed through both stages; the original
raw/sample inputs are no longer present. Accepted/rejected counts are recorded
in `local-machine/data/corpus/manifest.json`, with rejection details under `local-machine/data/corpus/reports/`.

## Replace Dummy Data with Real Data

1. Stop the local app and any data-processing commands. Back up the existing
   `local-machine/data/corpus/` if rollback is needed, and any raw/sample inputs you want to
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

4. Run the all-row commands above. There is no need to delete `local-machine/data/corpus/`
   first: successful preparation replaces it, including old dummy audio and
   corpus-side caches. On preparation failure, the previous corpus and sample
   inputs remain available. Verify source counts and rejection reports before
   using the replacement.

5. Start the local app against the new corpus. The controller loads
   [dev.env](../dev.env), which defaults to local storage and
   rebuilds runtime availability before serving:

   ```bash
   bash local-machine/control_local.sh dev --option start
   ```

   Shell environment values take precedence over these defaults. If you have
   explicitly disabled rebuilding or selected Tigris, clear those overrides or
   set `CORPUS_BACKEND=local` and
   `CORPUS_AVAILABILITY_REBUILD_ON_STARTUP=true` for this command.

Do not delete the entire `local-machine/data/` directory: `local-machine/data/user/` and other runtime state
are separate from corpus preparation. This local workflow does not update a
Tigris bucket or a Fly volume. Publishing a production corpus is a separate
operation; an existing Fly corpus database is not refreshed by a local run.

Replacing the tracked dummy corpus with a full dataset modifies tracked files,
and new raw/sample/processed files will also be visible to Git. Do not commit
those replacements inadvertently. For full-data work that must stay outside
Git, invoke the extraction and preparation scripts with explicit paths outside
the checkout and set `DATA_DIRECTORY` for local runtime access there.