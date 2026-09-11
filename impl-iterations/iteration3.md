# Implementation Iteration 3

## Corpus and runtime foundation

1. `data-transform/` is the exclusive corpus acquisition/transformation boundary; ordinary Telugu Now build/start never transforms upstream data.
2. `control.sh data` explicitly dispatches `samples`, `prepare`, or `all`; `control.sh dev` only consumes an already-prepared corpus.
3. The same preparation implementation accepts sample-sized or complete source directories through input/output paths and streams Parquet rows rather than loading a full corpus into memory.
4. FLEURS canonical text is raw transcription; Shrutilipi and IndicVoices canonical text is `text`.
5. Stable row identity is canonical split plus source-native audio filename/path. `train`, `test`, `dev`, `valid`, and `validation` are normalized while the original upstream split is retained.
6. Every accepted row receives one persisted NFC extended-grapheme count, text SHA-256, audio SHA-256, duration, source metadata, and content-addressed canonical audio object key.
7. Individual invalid rows are rejected into per-source reports; unknown schemas/splits, source-key duplicates/collisions, and source-level structural incompatibilities fail preparation.
8. FLEURS expects WAV; Shrutilipi and IndicVoices expect FLAC. Actual byte signatures are checked and no audio is transcoded.
9. Prepared output contains `manifest.json`, indexed `corpus.sqlite`, immutable media objects, and rejection reports. Output replacement is transactional.
10. Iteration 3 adds `fleurs-te`, `shrutilipi-te`, and `indicvoices-te` beside `source1`, `source2`, and `source3`, for six independently weighted selectable sources.
11. Complexity reference version 2 uses grapheme counts and operates from source row counts plus complexity histograms; prepared source selection uses indexed class membership rather than materializing complete catalogs in JavaScript.
12. Runtime source preparation never calls Hugging Face and never parses upstream TSV/Parquet. It reads the local prepared corpus. Fly.io/Tigris integration is deferred; no cloud connection or storage-backend toggle is implemented.
13. The formal Media model persists both `TextMedia` and `AudioMedia`; the reader displays Unicode text and plays available WAV/FLAC audio with byte-range seeking, playback-speed controls, precision seeking and profile-owned bookmarks. Exports include available audio.
14. The profile-owned source-record cache persists media metadata as well as text while preserving Iteration 1/2 history, queue, acquisition, and export semantics. The corpus and audio objects remain global.
15. Settings gains a Data sources page showing source attribution, upstream repository, catalog counts/version, complexity metric, and deployed source status.
16. Historical Iteration 2 word-count selection snapshots remain readable and are mapped to the generalized complexity diagnostic model without mutation.

## User database boundary

There are two active SQLite files under the repository's `data/` directory:

- `data/corpus/corpus.sqlite`: global prepared catalog, canonical rows and complexity membership. Runtime reads it; offline preparation publishes it with its objects, manifest and reports.
- `data/users.sqlite`: all profiles' preferences, reading state, source-record cache, audio bookmarks and migration markers. This is one user database, not one database per profile. Rows are scoped by `profile_code`, directly or through profile-owned queue/history/acquisition relations.

Global word images remain under `data/word-images/`; they are not moved into either database. Credentials and deployment configuration are not user records. The complete current persisted inventory and backup boundaries are maintained in [the README](../ti/README.md#storage-inventory).

`config.ts` locates the repository from `control.sh` and anchors defaults under root `data/`, independent of the working directory. `DATABASE_PATH`, `CORPUS_DATABASE_PATH` and `CORPUS_OBJECTS_PATH` may override locations inside `data/`; outside paths and identical user/corpus database paths are rejected. Only `NODE_ENV=test` permits temporary test databases outside this directory as test artifacts. Relative overrides still resolve from the process working directory.

All persisted information has user, global, credentials, downloads, or assets/artifacts scope. User/global data stays under `data/`. Credentials, downloaded HTML/EPUB files, bundled application files, dependencies, test output, and controller logs/process files are the exceptions. Corpus audio and generated word images are global data, not application assets. The controller and extraction scripts now default raw/sample datasets to `data/raw/` and `data/sample/`; transformation code stays under `data-transform/`.

### Obsolete storage removed

The previous `ti/data/app.sqlite` was already copied to `data/users.sqlite` with a WAL-consistent snapshot. The final cleanup stopped the server, compared existing user records exactly, transferred ten additional cache entries to the only user present in the old database, verified all 13 image byte sequences in global storage, and checked SQLite integrity and foreign keys. All 85 history entries and 81 cached source records were preserved. Only then were the obsolete database, its WAL/SHM sidecars and empty `ti/data/` directory deleted. Startup no longer reads or recreates that old path.

WAL, foreign keys and a five-second busy timeout remain enabled for the current user database. Root Git-ignore rules cover the current databases, sidecars, image files, corpus and raw/sample inputs. On older schemas, the former global prompt is copied into existing users' missing preference rows transactionally before `image_settings` is dropped. New users use the normal default prompt.

### Cache ownership

`source_records` now has primary key `(profile_code, source_id, source_key)` and a cascading profile foreign key. Its payload remains canonical text, media JSON and preparation timestamp; audio bytes are not duplicated.

For an older unscoped table, one transaction rebuilds the table and assigns entries to users with matching observations in queue, history or acquisitions. A row referenced by multiple users is copied for each owner. In this workspace, export-only entries omitted by that earlier migration were also recovered from the old database and assigned to its only user before deletion. Ready historical observations missing a cache row are backfilled for their owners with `media_json = '[]'`; reads synthesize `TextMedia` from cached text as before.

`sourceRecordService.resolve(profileCode, sourceId, sourceKey)` requires a known profile. Both persistent lookups and in-flight coalescing include the profile identity. Live preparation and Export pass the owning profile; history reads join through the same profile. Independent profiles therefore never share mutable cache entries or pending source requests, while each profile's live reader and Export reuse its own cache. No history, queue, timing or acquisition-selection semantics change. The compatibility-only disabled Iteration 1 `mock` resolver remains for old pending rows.

## Profile preferences

`profile_preferences` stores appearance JSON, Settings language, the personal image prompt and `allow_image_regeneration`. Sampling, source weights and playback speed retain their existing profile-keyed tables. Appearance includes colors, enabled fonts, font-size scale, text/audio offsets, magnifier position and control auto-fade. Shared appearance parsing/defaults live in `ti/shared/appearance.ts`; exports retain their existing presentation defaults.

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

The settings page saves the prompt and default-off toggle per profile. Regenerate appears only for a saved image when enabled; confirmation explains that replacement affects everyone. The old image remains visible during generation and on failures. Pollinations calls substitute every literal `<core word>` placeholder and use `microsoft/mai-image-2.5-flash` with a random numeric seed. The server reads the Git-ignored root `env` using Node's dotenv parser on each request; no browser provider SDK or credential exposure is involved. Downloads are capped at 10 MiB with a 120-second provider timeout. No automatic paid retries, uploads or user-supplied upstream URLs are accepted.

Each root maps to a SHA-256-named folder under `data/word-images/`. Initial publication atomically renames a directory containing `image.png`, `image.jpg` or `image.webp` plus `metadata.json`. Regeneration writes an immutable `image-<content-sha256>.<extension>` and atomically replaces metadata with a validated `file` pointer. Legacy metadata without that pointer still resolves the original image. Metadata records root, MIME type, creation time and active filename, not the generating profile, original prompt or seed. Old versions and unreferenced failed-publication files remain for in-flight readers; there is no pruning or image-history UI.

Ordinary generation reuses the saved image, even without a configured provider key. Per-root requests coalesce within one server process; multiple processes are not globally locked. Failed disk saves retain generated bytes in process memory for an explicit save retry without another provider call. Restarting loses those retry bytes. Damaged cache entries return errors rather than spending credits automatically.

`migrateLegacyWordImages` transfers old `word_images` SQLite blobs into global file storage before dropping that obsolete table. Existing active images are never replaced. Older differing bytes are retained as content-hashed image versions in the same root folder and verified before table deletion. A failed transfer leaves the database table intact for retry. This preserves global image data without keeping it in the user database.

## Validation

Existing non-browser tests cover root data path restrictions, old-schema/cache migration, two-user cache isolation and independent pending requests, preferences/migration/bookmark API validation and cascades, bookmark request ordering, browser transfer retries and conflict/malformed-value preservation, and failure-safe global image transfer. Pipeline tests use raw/sample fixtures under their temporary repository's `data/` directory. The full unit suite, TypeScript checks, production build and Python 3.12 pipeline tests are the validation gates. Playwright is not run for this change. Provider tests use mocks and do not validate live paid model output; Apple Books device acceptance remains separate.
