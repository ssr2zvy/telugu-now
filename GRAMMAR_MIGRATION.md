# Deploying the grammar migration

This change adds a separate, derived grammar SQLite database. It never rewrites `corpus.sqlite`, its audio objects, or historical observations. The bundled corpus is still only sample data. In production the worker reads the full existing volume corpus (approximately 1.5 GB in your deployment).

## Deployment and operation

1. Deploy this repository through the existing build/deploy workflow. `fly.toml` enables the temporary menu/worker with `GRAMMAR_MIGRATION_ENABLED=true`. Build packaging copies the worker from `local-machine/data-transform/scripts/build-grammar/` into the runtime artifact. Python is already installed by the Containerfile.
2. Set a private `GRAMMAR_MIGRATION_TOKEN` in the deployment's secrets. The temporary settings page asks for this operator token; regular profile codes alone cannot start a global rebuild or activate it. Existing AWS/Tigris credentials must allow multipart upload, abort, read and writes under `corpus/grammar/`. No credentials are embedded in this ZIP.
3. Check actual free volume space. The original 1.5 GB corpus is not duplicated, but the derived catalog, SQLite journal/index work and existing user/media caches need additional space. The repository's 3 GB initial-volume setting is not a guarantee of sufficient capacity for the real data. The full derived size is not known from the 300-row sample.
4. Open Settings → Grammar Migration, enter the operator token and click Build grammar database. Progress reports fingerprinting, transcript processing, distinct words, indexing and uploaded bytes. The page can be closed; the worker belongs to the server.
5. If the app is interrupted, restart normally and use Resume build. Committed transcript checkpoints and word parses are reused for the same input versions. Upload failure keeps the staged result; multipart publication is aborted on caught failures and retried explicitly. If the input snapshot has changed, the next retry starts a new staged output after reporting the mismatch; old staging files may be removed after identifying them.
6. Once the job is ready, click Switch to new selection for every profile. Activation is transactional and global. Undisplayed legacy queues are removed. Displayed history and the current legacy observation remain accessible. New questions use the grammar model and start new per-profile grammar progress at zero. No restart or corpus force-download toggle is required.

The worker uploads `corpus/grammar/<sha256>.sqlite`, then `corpus/grammar/latest.json`. It keeps the same verified catalog locally under the volume's corpus/grammar directory. Activation requires a successful upload in Tigris mode; local mode validates locally without remote upload. The active file's identity, hash and enabled mode are recorded in the persistent user database. If that file is missing on a subsequent boot, the permanent loader downloads the recorded immutable object and verifies it. It does not silently activate whichever object happens to be latest remotely.

## After the migration deployment

Set `GRAMMAR_MIGRATION_ENABLED=false` or remove that env setting on the next deployment. Remove the migration token if desired. The temporary settings menu and build/activation endpoints are then disabled; active grammar selection and recovery keep working. Worker assets can remain dormant or be removed from the build by removing `package-grammar-worker.mjs` from build:server and the worker COPY from the Containerfile. Keep the permanent `grammar/model.ts`, `store.ts`, `service.ts`, `persistence.ts`, evaluation endpoint and UI. Removing the entire grammar feature would break stored progression; disabling the worker does not do that.

`local-machine/data-transform/scripts/build-grammar/` is the canonical calculation script location. `server/src/grammar/migration.ts` is the optional process/upload host. The other grammar modules are runtime functionality. The existing grapheme updater is preserved for legacy operation and must not be used to overwrite grammatical data.

## Agreed runtime behavior

- Source weights and percentile target/spread no longer influence active grammar selection. Their old values remain stored for historical records, but controls are hidden and changes rejected. The existing audio-given/text-given probability remains configurable for future batches.
- Every new selection is a question. Pages are input → comparison → self-evaluation. The last page shows the correct transcript/audio and explicit Correct/Incorrect buttons. Only an explicit result counts; navigation cannot imply success or failure. Responses cannot be edited after evaluation.
- A batch contains ten questions sampled from one frozen state. Only after all ten evaluations are recorded are updates applied in original selection/presentation order, once. The next batch uses the resulting state. Partial batches and results survive reload/restart. Back navigation and identical HTTP retries do not add credit.
- Bare core bases are individual targets. Modified words share the complete canonical ordered chain and nesting signature across lexical bases. Selection categories are modifier count + 1, separate from the parser's GI score. Only the selected token affects progression; incidental vocabulary is logged without progress credit.
- Initial Zipf exponent 1; progressive prefix reversal; uniform target within category; available lengths weighted by 1/L²; uniform transcript within that length; uniform matching occurrence. Source and seen/unseen biases are removed. All raw GI values, offsets and selected evidence are retained in snapshots.
- Per-target three-consecutive-True streaks, False resets, and earlier-category regression multiplier `2.5 * 2^(distance-1)` match the reference. Completion is now latched: once reached, the final distribution remains in use indefinitely, even if later review answers are False. Review streaks/results still record normally.
- A rejected audio/blacklist reservation is replaced within its existing batch slot and target, with a new observation ID and conditional replacement probabilities. No failure credit is invented. If that target has no usable examples, the app exposes an unavailable state; it does not silently delete requirements or select a different target. Restore media/remove a blocking blacklist entry to resume. Then use Settings → Diagnostic → View the Queue → Retry unavailable questions. This resets preparation retries only; batch slots, answers and targets remain intact. There is no automatic inventory expansion or progress migration.
- Export uses the active grammar distribution without recording learning attempts. Export diagnostics include the grammar route; the old export settings envelope remains for backward compatibility and does not drive grammar selection.

## Storage and resource boundaries

`corpus.sqlite` remains the authoritative text/media catalog. `availability.sqlite` retains existing media availability. The grammar catalog adds parsed-word cache, targets, token mappings and indexes. `users.sqlite` adds `grammar_system`, `grammar_progress`, `grammar_batches`, and `grammar_attempts`; it remains the only store for user answers/streaks.

Only one worker owns a volume at a time. Process identity guards prevent overlapping starts and release stale locks across a container restart, including PID reuse. Use the existing single running Machine configuration for this migration; this is not a distributed job queue. A hard-killed multipart upload may require the bucket's incomplete-upload cleanup policy. No live Tigris access or permission check was performed while producing this ZIP.

## Validation

See `GRAMMAR_VALIDATION.md` for executed checks, baseline suite failures and the limits of sample-data validation. No deployment was performed.
