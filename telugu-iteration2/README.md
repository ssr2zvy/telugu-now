# Implementation Iteration 2
This repository contains Implementation Iteration 2 of the Telugu observation app. Iteration 1's persistent history/timing model, ten-item future queue, continuous one-for-one replenishment, sequential live preparation, and SQLite persistence remain the foundation.
Iteration 2 adds the source/complexity selection engine, persistent profile settings, repeatable source-record caching, tap-revealed controls, full-page Settings navigation, bilingual Settings labels, structured diagnostics, activation-time randomized Telugu typography, and standalone batch export. The actual external Telugu datasets are still mocked by three deterministic local sources.
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

Font assets

The live application and standalone exports use the same ten application-controlled Telugu WOFF2 assets. They are materialized under:

frontend/public/fonts/

The canonical family/file mapping is frontend/font-assets.json.

Run:

npm run fonts:sync

The sync script obtains the Telugu WOFF2 face for each configured family, stores the corresponding SIL Open Font License text, and writes frontend/public/fonts/font-assets.lock.json containing the exact resolved source URLs and SHA-256 hashes. If a lock already exists, the script verifies the local assets and restores a missing asset only from its locked source URL, rejecting hash mismatches.

npm run dev:client and npm run build:client automatically run fonts:sync first. A release repository should commit the generated WOFF2 files, license files, and lock file so normal production builds do not depend on a later upstream font change.

No font is fetched from the internet while a user generates or opens an export. Export preparation reads only the local application font assets.

Build and tests

./control.sh build --option start
./control.sh test --option start

The test suite preserves the accepted Iteration 1 queue/history/timing invariants and adds checks for Iteration 2 catalogs, global percentile calibration, canonical source weights, probability snapshots, repeats, settings isolation, shared source-record caching, batch export isolation, migration from the accepted Iteration 1 schema, numerical edge cases in the normal-distribution selector, standalone export behavior, and the control.sh repository contract.

Selection is also checked against an independently implemented numerical probability oracle, a deterministic 100-selection black-box audit, injected random-number boundary cases, and a seeded 50,000-selection Monte Carlo comparison against the full expected source+row distribution.

Frontend tests guard page-based Settings, mapping-table diagnostics, the ... empty observation state, permanently positioned revealed navigation arrows, two-stage Export/Download behavior, monochrome application-rendered Settings/language controls, the stable profile-entry viewport anchor, the curated font collection, local font asset coverage, and live/export presentation parity.

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

The desired complexity curve is a normal distribution centered at T. R is the half-width corresponding to the central 98% reference interval, so:

sigma = R / 2.326347874

The normal is truncated and renormalized to the valid percentile domain [0,1]. Its probability mass over each tied word-count percentile interval is divided by the global number of rows with that word count to produce a per-row global complexity mass. Once a source has been selected, those masses are normalized across the rows actually available in that source.

Source probability, conditional row probability, and overall source+row probability remain distinct and are stored in every normal acquisition’s immutable selection snapshot.

Repeats and shared source-record cache

Selections are independent and with replacement. The same (source_id, source_key) can therefore appear in multiple acquisitions.

A stable source record and an acquisition are separate concepts:

* a source record is the underlying source row and normalized retrieved content;
* an acquisition is one particular probabilistic selection event.

source_records is the shared persistent cache, keyed by (source_id, source_key). Once either the live queue or Export retrieves a source record, later live/export selections of that row reuse the cached content without another source request.

Queue behavior

The live profile still maintains ten selected unseen observations. Initial load fills a short queue to ten. Every first-time consumption moves one observation into history and atomically reserves exactly one replacement at the tail of the future queue.

Back/forward movement through already-seen history does not consume the queue and creates no replacement. Live source-record preparation remains sequential and queue order remains authoritative regardless of later settings changes, cache-hit speed, or source latency.

Saved source/complexity settings affect only acquisitions selected after the save. Existing history, existing unseen selections, and already-pending preparation work are not resampled.

Observation controls

Back, Next, and the bottom-right Settings icon are hidden by default. A single tap on the ordinary observation surface reveals all three controls; another background tap hides them. A successful Back/Next navigation hides them again.

Whenever controls are revealed, both Back and Next remain in their fixed positions. If either direction is unavailable, its arrow is visibly greyed out and disabled rather than disappearing.

The Settings control and the Settings-language control are application-rendered monochrome SVGs that inherit the same grey UI color through currentColor. Platform emoji glyphs are not used for either control.

When a valid profile has no current observation yet, the observation area displays:

...

This is only a UI placeholder. It does not create a history entry, acquisition, source record, or timing record.

Stable profile-code entry

The initial three-digit profile-code input is anchored to the viewport height captured when the entry screen first renders. The entry screen uses that fixed layout height rather than the keyboard-responsive dynamic viewport height.

Opening the software keyboard therefore does not recenter, shrink, or push the profile-code input upward as the mobile visual viewport changes. The bar stays at its original physical vertical position for that entry-screen session.

Observation typography

Each time an observation becomes the actively displayed observation, the client randomly chooses one font from this fixed curated collection:

* Noto Sans Telugu
* Noto Serif Telugu
* Mandali
* Ramabhadra
* NTR
* Peddana
* Ramaraja
* Sree Krushnadevaraya
* Suranna
* Tenali Ramakrishna

Font selection is presentation-only. It is not persisted in history, the acquisition, the source record, or the selection snapshot.

Navigating away from an observation and later returning to it chooses again. Closing Settings and returning to the observation also chooses again. A browser reload/new presentation session may choose again. Polling, timing refreshes, queue-readiness changes, and ordinary React rerenders do not reroll the font while the same observation remains continuously active.

The canonical presentation configuration is defined in frontend/src/presentation.ts. It contains the font pool and every sizing/fitting constant used by the live and standalone viewers.

The preferred observation font size is derived continuously from text load rather than from a few hardcoded sentence-length buckets. Short observations receive a larger preferred size and progressively longer observations receive progressively smaller sizes.

After the font is chosen, the browser loads that specific local family and measures the rendered observation. The fit pass reduces the preferred size only as necessary to fit the available observation width and height.

The order is:

observation becomes active
        ↓
choose random font
        ↓
derive preferred size from observation length
        ↓
load and measure that font
        ↓
reduce only if necessary to fit
        ↓
display

Full-page Settings

Settings replaces the observation view while it is open; it is not a modal. The Settings root page links to four child pages:

1. Complexity
2. Source weights
3. Diagnostic
4. Export

Every child page has a Back control that returns to the Settings root. The × control exits the entire Settings hierarchy and returns to the same observation.

Because the observation is not visible while a Settings page is displayed, opening Settings pauses the current observation’s visible-time accumulation. The history-tail absolute timer continues according to the accepted Iteration 1 timing rules. Closing Settings resumes visible-time accumulation if the observation is otherwise visible and creates a fresh typography activation for that observation.

A monochrome language control remains fixed in the bottom-right throughout the Settings hierarchy. It switches all Settings labels, including diagnostic field names, between Telugu and English. The preference is presentation-only and is persisted locally in the browser. It does not change selection settings, queue state, acquisition snapshots, or export probabilities.

Complexity and source-weight pages

The Complexity page edits the global percentile target and spread. The Source weights page edits one canonical weight for each source. Both persist through the existing profile-settings API and backend validation remains authoritative.

Saving either page affects only future selections. Already-selected unseen observations, history, and already-pending preparation work remain unchanged.

Diagnostic

Diagnostic has its own full page and renders the current acquisition as a two-column mapping table rather than free-form diagnostic text.

The table preserves the Iteration 1 trigger/preparation fields and adds the complete persisted Iteration 2 selection snapshot, including source weights, source probability, row key, word count, global percentile interval, target/spread/reference version, conditional row probability, overall probability, and cache-hit/request information.

If there is no current acquisition, the Diagnostic page displays ... rather than fabricating values.

Export

Export is not a history export and does not simulate repeated Next presses.

The user enters a positive integer N. Export snapshots the profile’s current source weights, complexity target/spread, and complexity-reference version once, then performs exactly N independent fresh selections using the same source and complexity selection engine used by normal acquisitions.

Export does not:

* advance the current history cursor;
* append profile history;
* consume or replenish the live ten-item queue;
* consume normal acquisition numbers;
* alter observation timing.

Export does use and populate the normal persistent source_records cache. Selected uncached rows are resolved sequentially through the source adapter; cached rows are reused immediately.

The Export page uses two explicit stages. Export first generates the batch and then prepares the complete standalone artifact, including all ten local WOFF2 fonts and their license notices. While either step is running, Download is disabled. Download becomes available only after the self-contained HTML is fully prepared in memory.

Editing the export count invalidates the prepared Download. Successfully saving new complexity or source-weight settings also invalidates any prepared Download.

The standalone viewer contains all observations, diagnostics, CSS, JavaScript, the canonical presentation configuration, all ten embedded font binaries, and font-license notices in one .html file. It performs no network requests after download and does not depend on the Telugu Now server, Node.js, SQLite, APIs, installed Telugu fonts, Google Fonts, or external JavaScript/CSS.

Each exported observation activation follows the same presentation semantics as the live viewer:

entry becomes active
        ↓
randomly choose one of the same ten fonts
        ↓
wait for that embedded font
        ↓
derive preferred size from observation length
        ↓
measure the rendered text
        ↓
reduce only if necessary to fit
        ↓
display

Next/Back navigation rerolls the font for the newly activated entry, including when returning to an earlier entry. Opening or closing Diagnostic does not reroll. Viewport resize/orientation changes refit the current text while retaining its active font. Reopening the HTML starts a new presentation session.

The export renderer serializes OBSERVATION_PRESENTATION rather than maintaining a separate hand-written set of typography constants, so live and exported sizing behavior cannot silently drift.

Persistence and migration

The default SQLite file is:

./data/app.sqlite

Override it with DATABASE_PATH.

Iteration 2 performs a non-destructive schema upgrade for Iteration 1 databases. In particular, it removes Iteration 1’s observation-level uniqueness on (source_id, source_key) so repeats can create distinct acquisitions, creates the stable shared source_records cache, adds profile selection settings/weights, and adds persisted selection snapshots.

Already-ready Iteration 1 observations are backfilled into the shared source-record cache. A compatibility-only disabled Iteration 1 mock resolver remains available for old pending mock rows but is not part of the three selectable Iteration 2 sources.

Environment defaults

See .env.example. Important defaults are:

SOURCE1_WEIGHT=1
SOURCE2_WEIGHT=1
SOURCE3_WEIGHT=1
COMPLEXITY_PERCENTILE_TARGET=0.5
COMPLEXITY_PERCENTILE_SPREAD=0.25
MOCK_DELAY_MIN_MS=1000
MOCK_DELAY_MAX_MS=15000
MAX_EXPORT_COUNT=500
