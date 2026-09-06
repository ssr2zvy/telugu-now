# Implementation Iteration 2
This repository contains Implementation Iteration 2 of the Telugu observation app. Iteration 1's persistent history/timing model, ten-item future queue, continuous one-for-one replenishment, sequential live preparation, and SQLite persistence remain the foundation.
Iteration 2 adds the real source/complexity selection engine, persistent profile settings, repeatable source-record caching, tap-revealed controls, full-page Settings navigation, bilingual Settings labels, structured diagnostics, and standalone batch export. The actual external Telugu datasets are still mocked by three deterministic local sources.
## Stack
- TypeScript
- React + Vite
- Hono + Node.js
- SQLite (`better-sqlite3`)
## Project controller
The root `control.sh` is the normal development entry point.
Install dependencies on a new checkout:
```bash
./control.sh deps --option install

Once a package-lock.json exists, dependency installation uses npm ci. An installed dependency tree can be reinstalled with:

./control.sh deps --option reinstall

Start development:

./control.sh dev

Choose start. Development runs in the foreground with normal Vite/Hono output attached to the terminal; Ctrl+C stops it. A second terminal can run ./control.sh dev and choose stop to terminate the running dev process group.

The browser app is served by Vite on port 5173. The Hono API runs on 127.0.0.1:8787. Vite binds to 0.0.0.0 so development-container/Codespaces forwarding can expose the UI.

The configured prototype profile code is 001.

Build and tests

./control.sh build --option start
./control.sh test --option start

The test suite preserves the accepted Iteration 1 queue/history/timing invariants and adds checks for Iteration 2 catalogs, global percentile calibration, canonical source weights, probability snapshots, repeats, settings isolation, shared source-record caching, batch export isolation, migration from the accepted Iteration 1 schema, numerical edge cases in the normal-distribution selector, standalone export behavior, and the control.sh repository contract.

Selection is also checked against an independently implemented numerical probability oracle, a deterministic 100-selection black-box audit, injected random-number boundary cases, and a seeded 50,000-selection Monte Carlo comparison against the full expected source+row distribution.

The repository-contract tests also guard the current frontend contract: Settings is page-based rather than modal/accordion-based, diagnostics use a mapping table, the empty observation state is ..., disabled navigation arrows remain present when controls are revealed, and Export generation is separate from Download.

Deterministic dummy sources

Iteration 2 has exactly three selectable dummy sources:

* source1: 12 rows
* source2: 24 rows
* source3: 36 rows

Their literal Telugu rows live under server/src/sources/dummy/data/. Each row has a stable source key.

The fixture lengths were sampled once from fixed-seed right-skewed distributions and then committed literally; they are never regenerated at runtime. source1 is shorter on average, source2 is moderate, and source3 is longer and broader.

Across the 72 rows the current committed fixture spans 1 through 40 words, so the complexity system is not shaped around a six-word mock ceiling.

An uncached dummy source retrieval waits 1–15 seconds by default. The delay can be overridden in the environment for local testing.

Source selection

Each profile stores one source weight per selectable source. Every weight is in [0,1], and at least one weight must be exactly 1; configurations with every weight below 1 are rejected rather than normalized.

For source i, with N_i selectable rows and profile weight w_i:

source mass = N_i * w_i
P(source i) = (N_i * w_i) / sum_j(N_j * w_j)

With all source weights at 1, source probability is proportional to source row count.

Global complexity reference

Iteration 2 uses word count only as the intrinsic measurement used to build one global complexity reference from all 72 selectable dummy rows. The user does not configure a target word count.

For each word count k, tied rows occupy their empirical global percentile interval [a_k,b_k].

The reference is versioned as:

complexity_reference_version = 1

Profile source weights never change this reference.

Each profile configures:

* global complexity percentile target T in [0,1];
* global complexity percentile spread R > 0.

The desired complexity curve is a normal distribution centered at T.

R is the half-width corresponding to the central 98% reference interval, so:

sigma = R / 2.326347874

The normal is truncated and renormalized to the valid percentile domain [0,1].

Its probability mass over each tied word-count percentile interval is divided by the global number of rows with that word count to produce a per-row global complexity mass.

Once a source has been selected, those masses are normalized across the rows actually available in that source.

Source probability, conditional row probability, and overall source+row probability remain distinct and are stored in every normal acquisition’s immutable selection snapshot.

Repeats and shared source-record cache

Selections are independent and with replacement. The same (source_id, source_key) can therefore appear in multiple acquisitions.

A stable source record and an acquisition are separate concepts:

* a source record is the underlying source row and normalized retrieved content;
* an acquisition is one particular probabilistic selection event.

source_records is the shared persistent cache, keyed by (source_id, source_key).

Once either the live queue or Export retrieves a source record, later live/export selections of that row reuse the cached content without another source request.

Queue behavior

The live profile still maintains ten selected unseen observations.

Initial load fills a short queue to ten. Every first-time consumption moves one observation into history and atomically reserves exactly one replacement at the tail of the future queue.

Back/forward movement through already-seen history does not consume the queue and creates no replacement.

Live source-record preparation remains sequential and queue order remains authoritative regardless of later settings changes, cache-hit speed, or source latency.

Saved source/complexity settings affect only acquisitions selected after the save.

Existing history, existing unseen selections, and already-pending preparation work are not resampled.

Observation controls

Back, Next, and the upper-right Settings icon are hidden by default.

A single tap on the ordinary observation surface reveals all three controls; another background tap hides them.

A successful Back/Next navigation hides them again.

Whenever controls are revealed, both Back and Next remain in their fixed positions.

If either direction is unavailable, its arrow is visibly greyed out and disabled rather than disappearing.

When a valid profile has no current observation yet, the observation area displays:

...

This is only a UI placeholder.

It does not create a history entry, acquisition, source record, or timing record.

Full-page Settings

Settings replaces the observation view while it is open; it is not a modal.

The Settings root page links to four child pages:

1. Complexity
2. Source weights
3. Diagnostic
4. Export

Every child page has a Back control that returns to the Settings root.

The × control exits the entire Settings hierarchy and returns to the same observation.

Because the observation is not visible while a Settings page is displayed, opening Settings pauses the current observation’s visible-time accumulation.

The history-tail absolute timer continues according to the accepted Iteration 1 timing rules.

Closing Settings resumes visible-time accumulation if the observation is otherwise visible.

A language control remains fixed in the bottom-right throughout the Settings hierarchy.

It switches all Settings labels, including diagnostic field names, between Telugu and English.

The preference is presentation-only and is persisted locally in the browser.

It does not change selection settings, queue state, acquisition snapshots, or export probabilities.

Complexity and source-weight pages

The Complexity page edits the global percentile target and spread.

The Source weights page edits one canonical weight for each source.

Both persist through the existing profile-settings API and backend validation remains authoritative.

Saving either page affects only future selections.

Already-selected unseen observations, history, and already-pending preparation work remain unchanged.

Diagnostic

Diagnostic has its own full page and renders the current acquisition as a two-column mapping table rather than free-form diagnostic text.

The table preserves the Iteration 1 trigger/preparation fields and adds the complete persisted Iteration 2 selection snapshot, including:

* source weights;
* source probability;
* row key;
* word count;
* global percentile interval;
* complexity target;
* complexity spread;
* complexity-reference version;
* conditional row probability;
* overall probability;
* cache-hit/request information.

If there is no current acquisition, the Diagnostic page displays:

...

rather than fabricating values.

Export

Export is not a history export and does not simulate repeated Next presses.

The user enters a positive integer N.

Export snapshots the profile’s current source weights, complexity target/spread, and complexity-reference version once, then performs exactly N independent fresh selections using the same source and complexity selection engine used by normal acquisitions.

Export does not:

* advance the current history cursor;
* append profile history;
* consume or replenish the live ten-item queue;
* consume normal acquisition numbers;
* alter observation timing.

Export does use and populate the normal persistent source_records cache.

Selected uncached rows are resolved sequentially through the source adapter; cached rows are reused immediately.

The Export page uses two explicit stages.

Export first generates the batch.

While generation is running, Download is disabled.

After all N rows are selected and resolved, the generated ExportResponse is retained in the browser and Download becomes available.

Download only serializes that already-completed result into the self-contained HTML file; it performs no new source selections or source retrievals.

Editing the export count invalidates the prepared Download.

Successfully saving new complexity or source-weight settings also invalidates any prepared Download, so the visible count/settings cannot disagree with the batch being downloaded.

The browser builds one self-contained .html file in memory containing:

* all selected Telugu observations;
* inline CSS;
* inline JavaScript;
* each export item’s diagnostic mapping table.

The downloaded file needs no app server, SQLite, Node.js, APIs, or external JavaScript libraries and can browse only its embedded sequence.

Persistence and migration

The default SQLite file is:

./data/app.sqlite

Override it with DATABASE_PATH.

Iteration 2 performs a non-destructive schema upgrade for Iteration 1 databases.

In particular, it:

* removes Iteration 1’s observation-level uniqueness on (source_id, source_key) so repeats can create distinct acquisitions;
* creates the stable shared source_records cache;
* adds profile selection settings/weights;
* adds persisted selection snapshots.

Already-ready Iteration 1 observations are backfilled into the shared source-record cache.

A compatibility-only disabled Iteration 1 mock resolver remains available for old pending mock rows but is not part of the three selectable Iteration 2 sources.

Environment defaults

See .env.example.

Important defaults are:

SOURCE1_WEIGHT=1
SOURCE2_WEIGHT=1
SOURCE3_WEIGHT=1
COMPLEXITY_PERCENTILE_TARGET=0.5
COMPLEXITY_PERCENTILE_SPREAD=0.25
MOCK_DELAY_MIN_MS=1000
MOCK_DELAY_MAX_MS=15000
MAX_EXPORT_COUNT=500
Those six are sufficient for the requested revision. `frontend/src/api.ts`, `shared/contracts.ts`, and the server-side services should remain untouched: the existing APIs already support the page-based presentation, visibility pause/resume, settings persistence, diagnostic data, two-stage client-side export handling, and shared source-record cache.
