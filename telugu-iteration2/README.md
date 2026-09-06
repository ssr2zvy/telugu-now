# Implementation Iteration 2

This repository contains Implementation Iteration 2 of the Telugu observation app. Iteration 1's persistent history/timing model, ten-item future queue, continuous one-for-one replenishment, sequential live preparation, and SQLite persistence remain the foundation.

Iteration 2 adds the real source/complexity selection engine, persistent profile settings, repeatable source-record caching, tap-revealed controls, a collapsed settings modal, diagnostics, and standalone batch export. The actual external Telugu datasets are still mocked by three deterministic local sources.

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
```

Once a `package-lock.json` exists, dependency installation uses `npm ci`. An installed dependency tree can be reinstalled with:

```bash
./control.sh deps --option reinstall
```

Start development:

```bash
./control.sh dev
```

Choose `start`. Development runs in the foreground with normal Vite/Hono output attached to the terminal; Ctrl+C stops it. A second terminal can run `./control.sh dev` and choose `stop` to terminate the running dev process group.

The browser app is served by Vite on port `5173`. The Hono API runs on `127.0.0.1:8787`. Vite binds to `0.0.0.0` so development-container/Codespaces forwarding can expose the UI.

The configured prototype profile code is `001`.

## Build and tests

```bash
./control.sh build --option start
./control.sh test --option start
```

The test suite preserves the accepted Iteration 1 queue/history/timing invariants and adds checks for Iteration 2 catalogs, global percentile calibration, canonical source weights, probability snapshots, repeats, settings isolation, shared source-record caching, batch export isolation, migration from the accepted Iteration 1 schema, numerical edge cases in the normal-distribution selector, standalone export behavior, and the `control.sh` repository contract. Selection is also checked against an independently implemented numerical probability oracle, a deterministic 100-selection black-box audit, injected random-number boundary cases, and a seeded 50,000-selection Monte Carlo comparison against the full expected source+row distribution.

## Deterministic dummy sources

Iteration 2 has exactly three selectable dummy sources:

- `source1`: 12 rows
- `source2`: 24 rows
- `source3`: 36 rows

Their literal Telugu rows live under `server/src/sources/dummy/data/`. Each row has a stable source key. The fixture lengths were sampled once from fixed-seed right-skewed distributions and then committed literally; they are never regenerated at runtime. `source1` is shorter on average, `source2` is moderate, and `source3` is longer and broader. Across the 72 rows the current committed fixture spans 1 through 40 words, so the complexity system is not shaped around a six-word mock ceiling.

An uncached dummy source retrieval waits 1–15 seconds by default. The delay can be overridden in the environment for local testing.

## Source selection

Each profile stores one source weight per selectable source. Every weight is in `[0,1]`, and at least one weight must be exactly `1`; configurations with every weight below `1` are rejected rather than normalized.

For source `i`, with `N_i` selectable rows and profile weight `w_i`:

```text
source mass = N_i * w_i
P(source i) = (N_i * w_i) / sum_j(N_j * w_j)
```

With all source weights at `1`, source probability is proportional to source row count.

## Global complexity reference

Iteration 2 uses word count only as the intrinsic measurement used to build one global complexity reference from all 72 selectable dummy rows. The user does not configure a target word count.

For each word count `k`, tied rows occupy their empirical global percentile interval `[a_k,b_k]`. The reference is versioned as `complexity_reference_version = 1`. Profile source weights never change this reference.

Each profile configures:

- global complexity percentile target `T` in `[0,1]`;
- global complexity percentile spread `R > 0`.

The desired complexity curve is a normal distribution centered at `T`. `R` is the half-width corresponding to the central 98% reference interval, so:

```text
sigma = R / 2.326347874
```

The normal is truncated and renormalized to the valid percentile domain `[0,1]`. Its probability mass over each tied word-count percentile interval is divided by the global number of rows with that word count to produce a per-row global complexity mass. Once a source has been selected, those masses are normalized across the rows actually available in that source.

Source probability, conditional row probability, and overall source+row probability remain distinct and are stored in every normal acquisition's immutable selection snapshot.

## Repeats and shared source-record cache

Selections are independent and with replacement. The same `(source_id, source_key)` can therefore appear in multiple acquisitions.

A stable source record and an acquisition are separate concepts:

- a source record is the underlying source row and normalized retrieved content;
- an acquisition is one particular probabilistic selection event.

`source_records` is the shared persistent cache, keyed by `(source_id, source_key)`. Once either the live queue or Export retrieves a source record, later live/export selections of that row reuse the cached content without another source request.

## Queue behavior

The live profile still maintains ten selected unseen observations. Initial load fills a short queue to ten. Every first-time consumption moves one observation into history and atomically reserves exactly one replacement at the tail of the future queue.

Back/forward movement through already-seen history does not consume the queue and creates no replacement. Live source-record preparation remains sequential and queue order remains authoritative regardless of later settings changes, cache-hit speed, or source latency.

Saved source/complexity settings affect only acquisitions selected after the save. Existing history, existing unseen selections, and already-pending preparation work are not resampled.

## Observation controls and Settings

Back, Next, and the upper-right Settings icon are hidden by default. A single tap on the ordinary observation surface reveals them; another background tap hides them. A successful Back/Next navigation hides them again.

Settings opens without navigation or queue consumption. Every new opening starts with four collapsed sections:

1. Complexity
2. Source weights
3. Diagnostic
4. Export

The normal user-facing interface remains Telugu-only. The temporary diagnostic is development instrumentation and may contain English.

## Diagnostic

The current acquisition diagnostic preserves the Iteration 1 trigger/preparation fields and adds the complete persisted selection snapshot, including source weight/probability, row key, word count, global percentile interval, target/spread/reference version, conditional row probability, overall probability, and cache-hit status.

## Export

Export is not a history export and does not simulate repeated Next presses.

The user enters a positive integer `N`. Export snapshots the profile's current source weights, complexity target/spread, and complexity-reference version once, then performs exactly `N` independent fresh selections using the same source and complexity selection engine used by normal acquisitions.

Export does not:

- advance the current history cursor;
- append profile history;
- consume or replenish the live ten-item queue;
- consume normal acquisition numbers;
- alter observation timing.

Export does use and populate the normal persistent `source_records` cache. Selected uncached rows are resolved sequentially through the source adapter; cached rows are reused immediately.

After all `N` rows are resolved, the API returns the batch to the browser. The browser builds one self-contained `.html` file in memory containing all selected Telugu observations, inline CSS/JavaScript, and each export item's probability diagnostic. The downloaded file needs no app server, SQLite, Node.js, APIs, or external JavaScript libraries and can browse only its embedded sequence.

## Persistence and migration

The default SQLite file is `./data/app.sqlite`; override it with `DATABASE_PATH`.

Iteration 2 performs a non-destructive schema upgrade for Iteration 1 databases. In particular, it removes Iteration 1's observation-level uniqueness on `(source_id, source_key)` so repeats can create distinct acquisitions, creates the stable shared `source_records` cache, adds profile selection settings/weights, and adds persisted selection snapshots. Already-ready Iteration 1 observations are backfilled into the shared source-record cache. A compatibility-only disabled Iteration 1 mock resolver remains available for old pending `mock` rows but is not part of the three selectable Iteration 2 sources.

## Environment defaults

See `.env.example`. Important defaults are:

```text
SOURCE1_WEIGHT=1
SOURCE2_WEIGHT=1
SOURCE3_WEIGHT=1
COMPLEXITY_PERCENTILE_TARGET=0.5
COMPLEXITY_PERCENTILE_SPREAD=0.25
MOCK_DELAY_MIN_MS=1000
MOCK_DELAY_MAX_MS=15000
MAX_EXPORT_COUNT=500
```
