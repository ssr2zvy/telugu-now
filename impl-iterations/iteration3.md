# Implementation Iteration 3

## Repository and local controller

The application lives in `upa/`. `control_local.sh` is the tracked local
development/data controller, renamed from `control.sh`; it retains the
dependency, build, test, development-process, and explicit data-preparation
commands. Interactive menus remain available, while `--option` selects an
operation noninteractively. Deployment starts the built Node server directly
and does not need this script.

`data-transform/` and `impl-iterations/` remain tracked alongside the controller.
The deployment-only removal/ignore policy was undone in favor of the original
`main` ignore policy. The temporary `current.md` was removed; this document is
the implementation record for Iteration 3, with operational details in the
[application README](../upa/README.md).

## Corpus and runtime foundation

1. `data-transform/` is the exclusive corpus acquisition/transformation boundary; ordinary Telugu Now build/start never transforms upstream data.
2. `control_local.sh data` explicitly dispatches `samples`, `prepare`, or `all`; `control_local.sh dev` never transforms upstream data. Local mode requires a prepared catalog and adjacent manifest at the configured path. Tigris mode skips that local prerequisite and bootstraps the catalog through the runtime.
3. The same preparation implementation accepts sample-sized or complete source directories through input/output paths and streams Parquet rows rather than loading a full corpus into memory.
4. FLEURS canonical text is raw transcription; Shrutilipi and IndicVoices canonical text is `text`.
5. Stable row identity is canonical split plus source-native audio filename/path. `train`, `test`, `dev`, `valid`, and `validation` are normalized while the original upstream split is retained.
6. Every accepted row receives one persisted NFC extended-grapheme count, text SHA-256, audio SHA-256, duration, source metadata, and content-addressed canonical audio object key.
7. Individual invalid rows are rejected into per-source reports; unknown schemas/splits, source-key duplicates/collisions, and source-level structural incompatibilities fail preparation.
8. FLEURS expects WAV; Shrutilipi and IndicVoices expect FLAC. Actual byte signatures are checked and no audio is transcoded.
9. Prepared output contains `manifest.json`, indexed `corpus.sqlite`, immutable media objects, and rejection reports. Output replacement is transactional.
10. Iteration 3 adds `fleurs-te`, `shrutilipi-te`, and `indicvoices-te` beside `source1`, `source2`, and `source3`, for six independently weighted selectable sources.
11. Complexity reference version 2 uses grapheme counts and operates from source row counts plus complexity histograms; prepared source selection uses indexed class membership rather than materializing complete catalogs in JavaScript.
12. Runtime source preparation never calls Hugging Face and never parses upstream TSV/Parquet. `CORPUS_BACKEND=local|tigris` selects filesystem or S3-compatible audio; both read canonical row content from a local prepared SQLite catalog and use a separate shared availability index for selection.
13. The formal Media model persists both `TextMedia` and `AudioMedia`; the reader displays Unicode text and plays available WAV/FLAC audio with byte-range seeking, playback-speed controls, precision seeking and profile-owned bookmarks. Exports include available audio.
14. The profile-owned source-record cache persists media metadata as well as text while preserving Iteration 1/2 history, queue, acquisition, and export semantics. The corpus and audio objects remain global.
15. Settings gains a Data sources page showing source attribution, upstream repository, catalog counts/version, complexity metric, and deployed source status.
16. Historical Iteration 2 word-count selection snapshots remain readable and are mapped to the generalized complexity diagnostic model without mutation.

### Shared corpus availability

`corpus.sqlite` is the canonical, runtime-read-only catalog. A separate
`availability.sqlite` determines which canonical rows can currently be selected:
local scans require nonempty audio files; Tigris scans require nonzero-size
objects in a complete paginated bucket inventory. Multiple rows referencing the
same audio remain separate selectable rows. Runtime never rewrites canonical
transcripts, source identities, or corpus indexes.

Both backends use the same availability schema and selection algorithm:

| Table | Stored information |
|---|---|
| `metadata` | Snapshot generation, canonical/backend identity, and eligible-pool hash |
| `source_complexity_members` | `source_id`, `grapheme_count`, dense zero-based `class_index`, and `source_key` |
| `source_counts` | Eligible `row_count` per `source_id` |
| `complexity_counts` | Eligible `row_count` per source/grapheme-count class |

Inventory and eligibility staging tables are discarded before publication.
Snapshot identity includes the canonical path, size and modification time,
plus the local object root or remote endpoint/bucket/prefix. Missing or
incompatible availability never falls back to canonical selection indexes.
Source descriptions and full row content still come from the canonical catalog;
displayed eligible counts and new selections use availability.

Each build creates a complete sibling snapshot and publishes it atomically.
Unchanged eligible pools with matching identity keep the previous generation.
Partial inventories, malformed pagination, invalid object keys, and failed
builds do not replace the last complete snapshot. Local inventory excludes
symlinks that escape the audio root. Publication reloads the shared reader and
invalidates the selection engine's cached complexity reference before subsequent
selection, without rewriting queued observations or historical snapshots.

### Backend-independent startup and worker controls

Storage backend and refresh policy are separate decisions. Both boolean settings
accept only `true` or `false` and default to `false`:

| `CORPUS_AVAILABILITY_WORKER_ENABLED` | `CORPUS_AVAILABILITY_REBUILD_ON_STARTUP` | Startup and refresh behavior |
|---|---|---|
| `false` | `false` | Reuse an existing compatible availability file without scanning; fail clearly if missing, invalid, or incompatible. |
| `false` | `true` | Rebuild once in the application process before serving; no background worker or timer. A failed build prevents startup. |
| `true` | Either, ignored | Start a worker thread that refreshes immediately and periodically. |

The worker is a Node.js `worker_threads` thread inside the same backend process,
not a separately deployed service and not something triggered by the UI. Each
enabled API process owns its worker. It publishes completion messages to the
server, which reloads availability without restarting. A compatible snapshot
allows serving while refresh runs; without one, startup waits for the first
successful build and fails if initial refresh fails. Later refresh failures are
logged, preserve the current snapshot, and retry after the configured delay.

`CORPUS_AVAILABILITY_REFRESH_MS` defaults to `7200000` (two hours) and must be an
integer from 1 through 2147483647. This is the delay after a pass finishes, not a
wall-clock schedule. With the worker disabled, inventory changes require an
explicit rebuild and application restart. These switches do not change Tigris
catalog downloads, audio access, or storage paths.

### Tigris catalog bootstrap and audio

Tigris mode uses `BUCKET_NAME`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION` (default
`auto`), and the AWS SDK's standard credential-provider chain. Secrets belong
in the server environment, never frontend configuration. `CORPUS_OBJECTS_PREFIX`
defaults to `corpus/objects/`; canonical row object keys are relative to this
prefix, just as local mode resolves them under its objects directory.

Before availability initialization, a missing local canonical database is
streamed from the fixed bucket key `corpus/corpus.sqlite`, checked for download
length, SQLite integrity, and required schema, then published atomically without
overwriting a concurrent winner. An existing local catalog is not downloaded
again or replaced. Failed downloads remove staged files, not existing data.
Runtime does not mirror audio or download the manifest/reports.

The audio API retains one browser/export-facing interface for both backends.
Local audio streams from disk; Tigris audio is streamed through the backend
without buffering the whole object. HEAD, single-range byte requests, conditional
requests, ETags/dates, and If-Range are handled with the appropriate HTTP
semantics. Cancellation closes upstream streams; object-key traversal and
encoded separators are rejected. Provider errors return safe responses rather
than credentials or upstream error bodies. Browser playback and offline
HTML/EPUB export need no separate Tigris credentials or backend-specific URLs.

## User database boundary

There are three active SQLite files under the configured data root. The default
root is repository `data/`; a Fly volume can supply the same layout under `/data`:

| Data | Local default | Tigris deployment |
|---|---|---|
| Canonical catalog | `data/corpus/corpus.sqlite` | `/data/corpus/corpus.sqlite` |
| Availability index | `data/corpus/availability.sqlite` | `/data/corpus/availability.sqlite` |
| User database | `data/user/users.sqlite` | `/data/user/users.sqlite` |
| Global word images | `data/word-images/` | `/data/word-images/` |
| Corpus audio | `data/corpus/objects/` | Tigris `corpus/objects/` |
| Manifest and rejection reports | `data/corpus/manifest.json`, `data/corpus/reports/` | Retained in Tigris, not required on the volume |

The user database contains all profiles' preferences, reading state, source-record
cache, audio bookmarks and migration markers. This is one user database, not one
per profile. Rows are scoped by `profile_code`, directly or through profile-owned
queue/history/acquisition relations. Word images remain global and shared across
users; they are not moved beneath `user/` or into SQLite. Credentials and
deployment configuration are not user records. The complete current inventory
and backup boundaries are maintained in [the README](../upa/README.md#storage-inventory).

`config.ts` locates the application through its package/source or built-server
layout, independently of the controller and working directory. `DATA_DIRECTORY`
can select an external persistent mount. `DATABASE_PATH`, `CORPUS_DATABASE_PATH`,
`CORPUS_AVAILABILITY_PATH`, and `CORPUS_OBJECTS_PATH` override individual paths
under that root. Empty/invalid roots, escaping paths, and collisions among user,
canonical, and availability database paths are rejected. Only `NODE_ENV=test`
permits out-of-root fixture paths. Relative overrides resolve from the process
working directory (`upa/` when launched with `control_local.sh`).

All persisted information has user, global, credentials, downloads, or
assets/artifacts scope. User/global data stays under `DATA_DIRECTORY`.
Credentials, downloaded HTML/EPUB files, bundled application files, dependencies,
test output, and controller logs/process files are the exceptions. Corpus audio
and generated word images are global data, not application assets. Offline
controller paths remain repository `data/raw/`, `data/sample/`, and
`data/corpus/`; runtime path overrides do not relocate data preparation.

### Obsolete storage removed

The earlier `ti/data/app.sqlite` cleanup moved its records and images to the
repository data boundary; runtime no longer reads or recreates that path.
The current startup migration moves the default user database from
`<DATA_DIRECTORY>/users.sqlite` to `<DATA_DIRECTORY>/user/users.sqlite` using
SQLite `VACUUM INTO`, including committed WAL records. It verifies integrity,
flushes the snapshot, and publishes without overwriting an existing target.
The legacy source is retained. An explicit `DATABASE_PATH` disables this
automatic relocation; existing targets are left alone, and orphaned target
sidecars or corrupt source data fail explicitly.

WAL, foreign keys and a five-second busy timeout remain enabled for the current
user database. The restored root Git-ignore policy covers legacy
`data/users.sqlite*`, word images, corpus and raw/sample inputs; it does not yet
cover the new `data/user/` directory or arbitrary custom in-repository data roots.
Those runtime files must not be staged or committed. On older schemas, the
former global prompt is copied into existing users' missing preference rows
transactionally before `image_settings` is dropped. New users use the normal
default prompt.

### Cache ownership

`source_records` now has primary key `(profile_code, source_id, source_key)` and a cascading profile foreign key. Its payload remains canonical text, media JSON and preparation timestamp; audio bytes are not duplicated.

For an older unscoped table, one transaction rebuilds the table and assigns entries to users with matching observations in queue, history or acquisitions. A row referenced by multiple users is copied for each owner. In this workspace, export-only entries omitted by that earlier migration were also recovered from the old database and assigned to its only user before deletion. Ready historical observations missing a cache row are backfilled for their owners with `media_json = '[]'`; reads synthesize `TextMedia` from cached text as before.

`sourceRecordService.resolve(profileCode, sourceId, sourceKey)` requires a known profile. Both persistent lookups and in-flight coalescing include the profile identity. Live preparation and Export pass the owning profile; history reads join through the same profile. Independent profiles therefore never share mutable cache entries or pending source requests, while each profile's live reader and Export reuse its own cache. No history, queue, timing or acquisition-selection semantics change. The compatibility-only disabled Iteration 1 `mock` resolver remains for old pending rows.

## Profile preferences

`profile_preferences` stores appearance JSON, Settings language, the personal image prompt and `allow_image_regeneration`. Sampling, source weights and playback speed retain their existing profile-keyed tables. Appearance includes colors, enabled fonts, font-size scale, text/audio offsets, magnifier position and control auto-fade. Shared appearance parsing/defaults live in `upa/shared/appearance.ts`; exports retain their existing presentation defaults.

The keyed `AppearanceProvider` transfers older browser-saved data after the user enters the three-digit code, then loads server preferences before displaying the reader. Appearance and language updates use ordered partial saves, retain failed edits for Retry, and warn on page unload while saves remain pending. Changing users discards the previous user's UI state. Other devices read saved values when the user supplies their code rather than subscribing to live changes.

`GET /api/profiles/:code/preferences` reads preferences, `POST` initializes missing appearance/language, and `PATCH` updates supplied fields. Initialization never overwrites saved values. Existing complete preference rows receive a `settings-v1` record; new initialization marks completion only after both values are present. The old global prompt is preserved in existing users' settings before its table is deleted. Regeneration defaults off for both new and migrated users.

## Bookmarks and browser migration

`profile_audio_bookmarks` stores sorted, deduplicated nonnegative finite playback positions in seconds, keyed by `(profile_code, source_id, source_key)`. Empty saved lists are retained so a migration cannot restore deliberately cleared bookmarks. `profile_migrations` stores per-profile migration keys and completion timestamps, currently `settings-v1` and `bookmarks-v1`. Both tables cascade on profile deletion.

The API provides:

- `GET /api/profiles/:code/migrations`: settings and bookmark migration completion.
- `GET /api/profiles/:code/bookmarks?sourceId=...&sourceKey=...`: saved positions, or an empty list.
- `PUT /api/profiles/:code/bookmarks`: replace positions for the supplied source identity.
- `POST /api/profiles/:code/bookmarks/import`: atomically import missing records and mark completion. Repeated imports return `imported: false`; existing saved records, including empty lists, are never overwritten.
- `POST /api/profiles/:code/browser-data`: transfer exact browser-saved settings, bookmarks and previous migration values into user-owned `profile_browser_data`, then populate missing usable preferences/bookmarks in the same transaction. Returns `saved: true` only after commit.

These routes require a configured, initialized profile and validate source identities and bookmark arrays. Source strings are bounded to 1,000 characters and cannot contain NUL; arrays are capped at 1,000 bookmarks, import batches at 5,000 records, and request bodies at 1 MiB. Mutating requests with an Origin header must match the request host. Prototype profile codes are not authentication; deployment still requires access controls.

The browser sends `telugu-now-appearance-v1`, `telugu-now-settings-language`, `telugu-now-preferences-migrated` and `telugu-now-audio-bookmarks:<sourceId>\u0000<sourceKey>` values to the user identified by the entered code. The old storage had no user identifier. `profile_browser_data` retains every exact value, including conflicts and malformed data, with user ownership and a transfer timestamp; its composite primary key makes retries idempotent. Existing saved settings and bookmarks, including deliberately empty bookmark lists, are not overwritten. Previously completed transfers do not block preserving values from another browser. The browser removes only values still matching those acknowledged by the server. Network/server failure retains the browser copies and offers Retry. No deletion occurs before the transaction commits. Inaccessible or closed browsers cannot be transferred until they run the updated app with storage available.

Normal settings, bookmark and migration writes now go to SQLite, not localStorage. Bookmark requests are serialized per profile/source identity, and reads await pending same-record writes. The audio hook guards stale completions when the observation or profile changes. It disables bookmark actions during loading/saving and commits the visible bookmark list only after the server acknowledges the save. Load/save failures expose Retry; a failed save's pending list is held in memory while that player remains mounted. Closing or navigating away can discard an unsaved edit. These changes do not store the current playback cursor or modify the audio files.

## Global word images

Word profiles analyze conservative Telugu noun/case forms while preserving grapheme boundaries. Images are indexed by NFC-normalized core word, shared across all profiles and sentences; different senses currently share one image. The active profile supplies the prompt for the first generation or explicit regeneration. A prompt change alone never replaces saved images.

`GET /api/word-images?root=...` retrieves an existing global image. `POST /api/word-images?root=...&profile=001` generates only if missing. `&regenerate=1` explicitly replaces an existing image and requires the profile's saved regeneration toggle; disabled profiles receive 403 and absent roots receive 404 before any provider call. `GET/PUT /api/word-images/settings?profile=001` reads/saves the prompt and `allowRegeneration`, exposing only whether a server key is configured.

The settings page saves the prompt and default-off toggle per profile. Regenerate appears only for a saved image when enabled; confirmation explains that replacement affects everyone. The old image remains visible during generation and on failures. Pollinations calls substitute every literal `<core word>` placeholder and use `microsoft/mai-image-2.5-flash` with a random numeric seed. Downloads are capped at 10 MiB with a 120-second provider timeout. No automatic paid retries, uploads or user-supplied upstream URLs are accepted.

On each request the server reads the lowercase
`process.env.pollinations_api_key` first, trimming surrounding whitespace. A
nonempty value overrides local configuration and requires no controller or
credential file; Fly injects the same-name secret. If absent or blank, lookup
falls back to the Git-ignored root `env`, parsed with Node's dotenv parser.
Local discovery uses `control_local.sh` as the repository marker, with `../env`
relative to the working directory as the fallback. Local file updates are read
without restarting. Missing-key errors explain both configuration paths, and
unreadable files produce explicit errors. The key is not sent to the browser,
stored in image metadata, or included in provider URLs.

Each root maps to a SHA-256-named folder under `data/word-images/`. Initial publication atomically renames a directory containing `image.png`, `image.jpg` or `image.webp` plus `metadata.json`. Regeneration writes an immutable `image-<content-sha256>.<extension>` and atomically replaces metadata with a validated `file` pointer. Legacy metadata without that pointer still resolves the original image. Metadata records root, MIME type, creation time and active filename, not the generating profile, original prompt or seed. Old versions and unreferenced failed-publication files remain for in-flight readers; there is no pruning or image-history UI.

Ordinary generation reuses the saved image, even without a configured provider key. Per-root requests coalesce within one server process; multiple processes are not globally locked. Failed disk saves retain generated bytes in process memory for an explicit save retry without another provider call. Restarting loses those retry bytes. Damaged cache entries return errors rather than spending credits automatically.

`migrateLegacyWordImages` transfers old `word_images` SQLite blobs into global file storage before dropping that obsolete table. Existing active images are never replaced. Older differing bytes are retained as content-hashed image versions in the same root folder and verified before table deletion. A failed transfer leaves the database table intact for retry. This preserves global image data without keeping it in the user database.

## Artifact and image packaging

`ci-cd/make-artifacts.sh` is the shared build entry point for local use, CI, and
Docker. It locates `upa/` relative to the script and runs the existing build
(type checking, frontend assets/font preparation, backend and worker bundling).
Dependency installation is separate. All outputs remain under the already
Git-ignored `upa/dist/`; no additional artifact directory is introduced.

The image and all three artifacts initially use `0.0.1-initial`, with independent
sources of version information. `Dockerfile` defines the image's OCI
`org.opencontainers.image.version` label. Artifact versions belong to
`upa/frontend/version.json`, `upa/server/version.json`, and
`upa/server/availability-worker.version.json`. The npm client/server post-build
hooks copy these metadata files into the corresponding `dist/client/` or
`dist/server/` output, including standalone builds. Neither artifact versions
nor the workspace npm package version are derived from the image label.
Docker image tagging remains a build/publish action, for example
`docker build -t telugu-now:0.0.1-initial .`.

The worker is always included alongside the frontend and backend. `fly.toml`
does not select build outputs: changing the runtime worker flag needs no
different image. The root multi-stage Dockerfile caches dependency installation,
builds with Node 22/Debian Bookworm, and produces production-only dependencies
with the same Node/native-module ABI. Its final stage contains package metadata,
production dependencies, and the complete `dist/` tree, not source/test files
or compilation tools. The `.dockerignore` allowlist keeps credentials, runtime
data, local dependencies, previous artifacts, and unrelated repository files
out of the build context.

The image runs the backend directly as the unprivileged `node` user (UID/GID
1000), with `/app/upa` as the working directory, port 8080, and `/data` as the
persistent root. Volume provisioning must make that root and existing state
writable by UID/GID 1000; mounting a volume can replace the mountpoint ownership
from the image. Corpus data and secrets are supplied only at runtime. Building
the image requires neither a Git clone inside Docker nor a live corpus.

## Fly deployment configuration

The root `fly.toml` configures Tigris mode, `/data` mounted from
`telugu_now_data`, canonical/availability paths, the object prefix, bucket,
endpoint and region. It explicitly enables the background worker despite the
application's disabled default, with a two-hour delay after each pass.
Autostop is off so refreshing does not depend on incoming UI traffic.

The server listens on port 8080, HTTPS is enforced, and `/api/health` is the
health-check endpoint with a one-minute startup grace period. The initial
catalog download and availability build may need a longer deployment wait
timeout. The VM configuration uses one shared CPU and 1 GB RAM.

AWS credentials and `pollinations_api_key` are Fly secrets, documented only as
commented placeholders in the TOML. `AWS_SESSION_TOKEN` is optional for temporary
credentials. Non-secret environment settings configure storage and refresh
policy; same-name Fly secrets override those settings. The application needs
read/list access, not corpus write access.

The TOML's `[build]` section selects the root Dockerfile; the TOML itself stays
outside the image. Deployment still requires choosing `primary_region` and
provisioning the volume with permissions for UID/GID 1000. Start with one Machine:
local SQLite, worker coordination, and global image publication are not
replicated or globally locked across Machines. These source changes do not
provision infrastructure, upload a corpus, or deploy the service.

## Validation coverage

Existing non-browser tests cover data-root restrictions, backend/configuration
validation, user database relocation including WAL state, old-schema/cache
migration, profile isolation, settings/bookmarks, and failure-safe global images.
Availability tests cover both backends, dense selection indexes, unchanged
generation reuse, failed publication, incompatible snapshots, all startup
policies, and live worker publication without a restart. Tigris tests exercise
paginated inventory, atomic catalog bootstrap, audio streaming, conditional/range
requests, cancellation, and safe error handling with mocked providers.
Pollinations tests cover environment precedence, blank-value file fallback,
local reloads, file errors, and provider failures without credential exposure.

Controller/repository contracts use `control_local.sh`. Pipeline tests use a
temporary `upa/` application directory and raw/sample fixtures under the
temporary repository's `data/` directory. TypeScript checks, the existing Node
tests, development/production worker entry points, and Python 3.12 pipeline
tests cover these surfaces. Provider mocks do not establish live paid model
behavior; browser/device acceptance and deployment behavior remain separate.
