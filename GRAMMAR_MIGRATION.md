# Deploying the grammar migration

This change adds a separate, derived grammar SQLite database. It never rewrites `corpus.sqlite`, its audio objects, or historical observations. The bundled corpus is still only sample data. In production the worker reads the full existing volume corpus (approximately 1.5 GB in your deployment).

## Deployment and operation

1. Deploy this repository through the existing build/deploy workflow. `fly.toml` enables the temporary menu/worker with `GRAMMAR_MIGRATION_ENABLED=true`. Build packaging copies the worker from `data-transform/scripts/build-grammar/` into the runtime artifact. Python is already installed by the Containerfile.
2. Set a private `GRAMMAR_MIGRATION_TOKEN` in the deployment's secrets. The temporary settings page asks for this operator token; regular profile codes alone cannot start a global rebuild or activate it. Existing AWS/Tigris credentials must allow multipart upload, abort, read and writes under `corpus/grammar/`. No credentials are embedded in this ZIP.
3. Check actual free volume space. The original 1.5 GB corpus is not duplicated, but the derived catalog, SQLite journal/index work and existing user/media caches need additional space. The repository's 3 GB initial-volume setting is not a guarantee of sufficient capacity for the real data. The full derived size is not known from the 300-row sample.
4. Open Settings → Grammar Migration, enter the operator token and click Build grammar database. Progress reports fingerprinting, transcript processing, distinct words, indexing and uploaded bytes. The page can be closed; the worker belongs to the server.
5. If the app is interrupted, restart normally and use Resume build. Committed transcript checkpoints and word parses are reused for the same input versions. Upload failure keeps the staged result; multipart publication is aborted on caught failures and retried explicitly. If the input snapshot has changed, the next retry starts a new staged output after reporting the mismatch; old staging files may be removed after identifying them.
6. Once the job is ready, click Switch to new selection for every profile. Activation is transactional and global. Undisplayed legacy queues are removed. Displayed history and the current legacy observation remain accessible. New questions use the grammar model and start new per-profile grammar progress at zero. No restart or corpus force-download toggle is required.

The worker uploads `corpus/grammar/<sha256>.sqlite`, then `corpus/grammar/latest.json`. It keeps the same verified catalog locally under the volume's corpus/grammar directory. Activation requires a successful upload in Tigris mode; local mode validates locally without remote upload. The active file's identity, hash and enabled mode are recorded in the persistent user database. If that file is missing on a subsequent boot, the permanent loader downloads the recorded immutable object and verifies it. It does not silently activate whichever object happens to be latest remotely.

## Updating from the previous target policy

This revision uses `grammatical-components-v3` and `UNIT:v3` target IDs. Rebuild the derived grammar catalog before activation; the corpus database is unchanged. The builder fingerprints the progression code and refuses to resume a v2 checkpoint. The existing migration menu reports the mismatch; its next build retry chooses a new staging file. Runtime loading and activation reject older-policy catalogs.

Apply this revision before the old grammar mode has been activated. If v2 is already active, do not deploy this revision directly: the old inventory will be rejected at startup. Keep the running v2 deployment until an explicit inventory/progress migration is implemented. V2 streaks cannot be copied by array index because units have split and moved categories. This patch does not reset live progress or silently reinterpret existing batches.

## After the migration deployment

Set `GRAMMAR_MIGRATION_ENABLED=false` or remove that env setting on the next deployment. Remove the migration token if desired. The temporary settings menu and build/activation endpoints are then disabled; active grammar selection and recovery keep working. Worker assets can remain dormant or be removed from the build by removing `package-grammar-worker.mjs` from build:server and the worker COPY from the Containerfile. Keep the permanent `grammar/model.ts`, `store.ts`, `service.ts`, `persistence.ts`, evaluation endpoint and UI. Removing the entire grammar feature would break stored progression; disabling the worker does not do that.

`data-transform/scripts/build-grammar/` is the canonical calculation script location. `server/src/grammar/migration.ts` is the optional process/upload host. The other grammar modules are runtime functionality. The existing grapheme updater is preserved for legacy operation and must not be used to overwrite grammatical data.

## Agreed runtime behavior

- Source weights and percentile target/spread no longer influence active grammar selection. Their old values remain stored for historical records, but controls are hidden and changes rejected. The existing audio-given/text-given setting remains stored for question presentation; this Settings layout exposes no question-probability control.
- Every new selection is a question. Pages are input → comparison → self-evaluation. The last page shows the correct transcript/audio and explicit Correct/Incorrect buttons. Only an explicit result counts; navigation cannot imply success or failure. Responses cannot be edited after evaluation.
- A batch contains ten questions sampled from one frozen state. Only after all ten evaluations are recorded are updates applied in original selection/presentation order, once. The next batch uses the resulting state. Partial batches and results survive reload/restart. Back navigation and identical HTTP retries do not add credit.
- Selection complexity counts grammatical components: each core grammar base contributes 1 and each modifier contributes 1. Non-core vocabulary bases contribute 0 and are excluded from target identity. Bare core bases and single modifiers on non-core vocabulary therefore both belong to category 1. Modified core bases remain in their complete target identity. Modifier-only chains share progress across vocabulary bases; order, length and nesting distinguish targets. Verified Unicode variants share canonical modifier/base IDs rather than literal spelling keys. Only the selected complete target affects progression; incidental words or chain prefixes receive no credit.
- Initial Zipf exponent 1; progressive prefix reversal; uniform target within category; available lengths weighted by 1/L²; uniform transcript within that length; uniform matching occurrence. Source and seen/unseen biases are removed. All raw GI values, offsets and selected evidence are retained in snapshots.
- Per-target three-consecutive-True streaks, False resets, and earlier-category regression multiplier `2.5 * 2^(distance-1)` match the reference. Completion is now latched: once reached, the final distribution remains in use indefinitely, even if later review answers are False. Review streaks/results still record normally.
- A rejected audio/blacklist reservation is replaced within its existing batch slot and target, with a new observation ID and conditional replacement probabilities. No failure credit is invented. If that target has no usable examples, the app exposes an unavailable state; it does not silently delete requirements or select a different target. Restore media/remove a blocking blacklist entry to resume. Then use Settings → Observations → Diagnostic → View the Queue → Retry unavailable questions. This resets preparation retries only; batch slots, answers and targets remain intact. There is no automatic inventory expansion or progress migration.
- Export uses the active grammar distribution without recording learning attempts. Export diagnostics include the grammar route; the old export settings envelope remains for backward compatibility and does not drive grammar selection.

## Settings and parser diagnostics

Settings now has an Observations section (Diagnostic, Data Sources, Blacklist, Reset Queue) and an External section (EPUB Export, HTML Export, App Archive Export, App Archive Import). The sampling, questions, complexity and source-weight pages are not exposed. Frequency Export is not present in the reviewed repository and is not added. Both the page list and the side navigation follow the new groups. Existing display/playback, appearance, image, eon, guide and version pages remain available.

Diagnostic → Parser shows catalog parser/adapter/schema versions, dictionary identity, actual depth/state limits, rule fingerprint, recognition/eligibility counts and exclusion reasons. New selected-word snapshots include parser status, confidence, canonical base/chain, normalization, parts, search information and offsets. Old observations without saved parser evidence say so. No grammar rules, lexicon files or eligibility decisions changed in this diagnostics update; the new adapter helper only reports configuration.

Recognition is not progression eligibility. A dictionary match can be recognized but excluded as plain vocabulary. Partial, unverified and unresolved parses also cannot drive progression. Reported unique-word counts and occurrence counts are separately labeled; no near-total-coverage claim is inferred from these metrics.

Reset Queue in active grammar mode retries preparation of the existing batch. It preserves selected units, recorded answers, progress and history. Export pages choose their format directly while keeping the existing selected-observation/audio archive semantics. App Archive Import retains its existing browser-local behavior; it is not a server/user-database restore. The separate fixed sentence-length weighting (1/L²) and reversing grammatical-category curve remain unchanged.

Already-active v3 catalogs remain compatible with this Settings-only extension. They may not contain the newly recorded parser configuration/count metadata, which is shown as unavailable rather than fabricated. Their parser version and fingerprint remain available, and new selections acquire parser snapshots from the existing word-analysis cache. No automatic rebuild or progress reset occurs. The earlier v2-to-v3 deployment warning still applies when applying the combined patch.

## Storage and resource boundaries

`corpus.sqlite` remains the authoritative text/media catalog. `availability.sqlite` retains existing media availability. The grammar catalog adds parsed-word cache, targets, token mappings and indexes. `users.sqlite` adds `grammar_system`, `grammar_progress`, `grammar_batches`, and `grammar_attempts`; it remains the only store for user answers/streaks.

Only one worker owns a volume at a time. Process identity guards prevent overlapping starts and release stale locks across a container restart, including PID reuse. Use the existing single running Machine configuration for this migration; this is not a distributed job queue. A hard-killed multipart upload may require the bucket's incomplete-upload cleanup policy. No live Tigris access or permission check was performed while producing this ZIP.

## Validation

See `GRAMMAR_VALIDATION.md` for executed checks, baseline suite failures and the limits of sample-data validation. No deployment was performed.
