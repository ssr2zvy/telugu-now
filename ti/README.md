# Implementation Iteration 2
This repository contains Implementation Iteration 2 of the Telugu observation app. Iteration 1's persistent history/timing model, ten-item future queue, continuous one-for-one replenishment, sequential live preparation, and SQLite persistence remain the foundation.
Iteration 2 adds source/complexity selection, persistent profile settings, repeatable source-record caching, tap-revealed controls, full-page Settings navigation, bilingual Settings labels, structured diagnostics, activation-time randomized Telugu typography, and portable offline export as either standalone HTML or interactive EPUB 3.
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
Start development:
```bash
./control.sh dev
```
The browser app is served by Vite on port `5173`. The Hono API runs on `127.0.0.1:8787`. Vite binds to `0.0.0.0` so development-container/Codespaces forwarding can expose the UI.
The configured prototype profile code is `001`.
## Build and tests
```bash
./control.sh build --option start
./control.sh test --option start
```
The tests preserve the accepted Iteration 1 history, timing, queue, and replenishment invariants and cover the Iteration 2 source selector, global complexity reference, probability snapshots, repeats, settings isolation, shared source-record cache, export isolation, migration, numerical edge cases, randomized presentation, local font assets, standalone HTML, and EPUB container generation.
Selection is additionally checked against an independent probability oracle, deterministic RNG boundaries, a 100-selection black-box audit, and a seeded 50,000-selection Monte Carlo comparison.
## Deterministic dummy sources
Iteration 2 has exactly three selectable dummy sources:
- `source1`: 12 rows
- `source2`: 24 rows
- `source3`: 36 rows
Their literal Telugu rows live under `server/src/sources/dummy/data/`. Each row has a stable source key. The fixture lengths were sampled once from fixed-seed right-skewed distributions and then committed literally. `source1` is shorter on average, `source2` is moderate, and `source3` is longer and broader. Across all 72 rows the current fixture spans 1 through 40 words.
An uncached dummy source retrieval waits 1–15 seconds by default. The delay can be overridden in the environment for tests.
## Source selection
Each profile stores one source weight per selectable source. Every weight is in `[0,1]`, and at least one weight must be exactly `1`. Configurations with every weight below `1` are rejected rather than normalized.
For source `i`, with `N_i` selectable rows and profile weight `w_i`:
```text
source mass = N_i * w_i
P(source i) = (N_i * w_i) / sum_j(N_j * w_j)
```
With all source weights at `1`, source probability is proportional to source row count.
## Global complexity reference
Iteration 2 uses word count only as the intrinsic measurement for one global complexity reference built from all 72 selectable dummy rows. The user does not configure a target word count.
For each word count `k`, tied rows occupy their empirical global percentile interval `[a_k,b_k]`.
The reference is versioned as:
```text
complexity_reference_version = 1
```
Each profile configures:
- global complexity percentile target `T` in `[0,1]`;
- global complexity percentile spread `R > 0`.
The desired complexity curve is a normal distribution centered at `T`. `R` is the half-width corresponding to the central 98% reference interval:
```text
sigma = R / 2.326347874
```
The normal is truncated and renormalized to `[0,1]`. Probability mass over each tied word-count percentile interval is divided by the global number of rows with that word count to produce per-row global complexity mass. Once a source has been selected, those masses are normalized over rows available in that source.
Source probability, conditional row probability, and overall source+row probability remain distinct and are stored in every normal acquisition's immutable selection snapshot.
## Repeats and shared source-record cache
Selections are independent and with replacement. The same `(source_id, source_key)` may appear in multiple acquisitions.
A stable source record and an acquisition are separate concepts:
- a source record is the underlying source row and normalized retrieved content;
- an acquisition is one particular probabilistic selection event.
`source_records` is the shared persistent cache, keyed by `(source_id, source_key)`. Once either the live queue or Export retrieves a source record, later live/export selections reuse it without another source request.
## Queue behavior
The live profile maintains ten selected unseen observations. Initial load fills a short queue to ten. Every first-time consumption moves one observation into history and atomically reserves exactly one replacement at the future-queue tail.
Back/forward movement through already-seen history does not consume the queue and creates no replacement. Live source-record preparation remains sequential and queue order remains authoritative regardless of later settings changes, cache-hit speed, or source latency.
Saved source/complexity settings affect only acquisitions selected after the save. Existing history, existing unseen selections, and already-pending preparation work are not resampled.
## Observation controls
Back, Next, and the bottom-right Settings icon are hidden by default. A single tap on the ordinary observation surface reveals all three; another background tap hides them. Successful Back/Next navigation hides them again.
Whenever controls are revealed, both Back and Next remain in fixed positions. An unavailable direction is greyed and disabled rather than removed.
The Settings and Settings-language controls are monochrome application-rendered SVGs using `currentColor` rather than platform emoji glyphs.
When a valid profile has no current observation yet, the observation area displays:
```text
...
```
The placeholder does not create history, an acquisition, source data, or timing state.
## Stable profile-code entry
The initial three-digit profile-code input is anchored to the viewport height captured when the entry screen first renders. Opening the software keyboard therefore does not recenter or move the bar upward as the mobile visual viewport changes.
## Observation typography
Each time an observation becomes actively displayed, the client randomly chooses one font from this fixed collection:
- Noto Sans Telugu
- Noto Serif Telugu
- Mandali
- Ramabhadra
- NTR
- Peddana
- Ramaraja
- Sree Krushnadevaraya
- Suranna
- Tenali Ramakrishna
Font selection is presentation-only and is not stored in history, acquisitions, source records, or selection snapshots. Navigating away and later returning rerolls the font. Closing Settings and returning also creates a fresh typography activation. Ordinary React rerenders, polling, timing refreshes, and queue-readiness changes do not reroll while the same observation remains continuously active.
The canonical presentation configuration lives in `frontend/src/presentation.ts` and is reused by the live viewer and both export formats.
The preferred size is derived continuously from observation length. After a font is selected, the browser waits for that font, measures the rendered observation, and reduces the preferred size only as necessary to fit the available area.
## Font assets
The live application, HTML export, and EPUB export use the same ten application-controlled Telugu WOFF2 assets under:
```text
frontend/public/fonts/
```
The canonical family/file mapping is `frontend/font-assets.json`.
Run:
```bash
npm run fonts:sync
```
The sync script stores the corresponding SIL Open Font License text and writes `frontend/public/fonts/font-assets.lock.json` with the resolved source URLs and SHA-256 hashes. The generated WOFF2 files, license files, and lock file are intended to remain committed so production behavior is tied to exact assets.
No font is fetched from the internet while a user generates or opens a completed export.
## Full-page Settings
Settings replaces the observation view while open; it is not a modal. The Settings root links to four child pages:
1. Complexity
2. Source weights
3. Diagnostic
4. Export
Each child page has Back to return to the Settings root. `×` exits the entire Settings hierarchy and returns to the same observation.
Because the observation is not visible while Settings is displayed, opening Settings pauses visible-time accumulation. The history-tail absolute timer continues under the accepted Iteration 1 timing model. Closing Settings resumes visible accumulation when appropriate.
A monochrome language control remains bottom-right throughout Settings and switches static Settings/Diagnostic labels between Telugu and English. This language preference is presentation-only.
## Diagnostic
Diagnostic has its own full page and renders the current acquisition as a two-column mapping table rather than free-form text. The table contains the Iteration 1 trigger/preparation fields and the complete persisted Iteration 2 selection snapshot.
If there is no current acquisition, the Diagnostic page displays `...`.
## Export selection semantics
Export is not a history export and does not simulate repeated Next presses.
The user enters a positive integer `N`. A completed export batch contains exactly `N` fresh independent source+row selections generated by the same selection engine used by normal acquisitions.
Export does not:
- advance the current history cursor;
- append profile history;
- consume or replenish the live queue;
- consume normal acquisition numbers;
- alter observation timing.
Export does use and populate the normal persistent source-record cache. Selected uncached rows are resolved sequentially; cached rows are reused immediately.
The completed `ExportResponse` is format-independent and remains the canonical generated batch.
## Export format choice
The Export page flow is:
```text
enter N
    ↓
Export
    ↓
choose format
    ├─ EPUB — iPhone / iPad · Apple Books · Interactive · Offline
    └─ HTML — Browser / Desktop · Interactive · Offline
    ↓
generate N selections if no current batch exists
    ↓
package the completed ExportResponse
    ↓
Download
```
Pressing Export opens a small transient format-choice modal. Cancel closes it without generating anything.
The selected format is not passed into source or row selection. EPUB versus HTML is only an artifact/container choice.
After the first format has generated the batch, pressing Export again and selecting the other format repackages the same retained `ExportResponse`; it does not generate another `N` selections.
Editing `N` or successfully saving source/complexity settings invalidates both the retained current batch and any prepared artifact shown by the Export page.
## Shared standalone viewer
`frontend/src/export-viewer.ts` owns the standalone viewer CSS, markup, diagnostic mapping, random-font activation semantics, continuous preferred-size formula integration, and DOM fit behavior shared by HTML and EPUB.
Both formats therefore preserve:
```text
entry becomes active
        ↓
randomly choose one of the same ten fonts
        ↓
wait for that font
        ↓
derive preferred size from observation length
        ↓
measure actual rendered text
        ↓
reduce only if necessary to fit
        ↓
display
```
Back/Next rerolls the newly activated entry's font. Diagnostic toggling does not. Resize/orientation changes refit the current entry without rerolling its active font.
## HTML export
Choosing HTML produces:
```text
telugu-export-N.html
```
It is one self-contained browser document containing all observations, diagnostics, inline CSS, inline JavaScript, canonical presentation configuration, all ten embedded WOFF2 fonts, and font-license notices.
It performs no runtime network requests after download.
## EPUB export
Choosing EPUB produces:
```text
telugu-export-N.epub
```
The Iteration 2 compatibility target is interactive offline use in Apple Books on iPhone/iPad, with macOS Apple Books tested where practical. Equivalent scripting behavior is not promised for every EPUB reader.
The EPUB is a real EPUB 3 ZIP container with this structure:
```text
mimetype
META-INF/
  container.xml
EPUB/
  package.opf
  nav.xhtml
  viewer.xhtml
  viewer.css
  viewer.js
  data.json
  fonts/
    <all 10 WOFF2 files>
  licenses/
    <all required font license files>
```
The `mimetype` entry contains exactly `application/epub+zip`, is the first ZIP entry, and is stored without compression. `META-INF/container.xml` points to `EPUB/package.opf`. The OPF manifest declares the navigation document, scripted viewer, shared viewer CSS/JavaScript, data, all fonts, and license resources. The viewer spine item is explicitly marked `scripted`.
Because Apple Books is the explicit EPUB target and the book embeds its own fonts, `package.opf` also declares the Apple Books `ibooks` vocabulary prefix and includes:
```xml
<meta property="ibooks:specified-fonts">true</meta>
```
This tells Apple Books to honor the packaged font faces used by the randomized typography viewer rather than substituting reader-selected fonts.
The browser-side EPUB packager is isolated in `frontend/src/export-epub.ts`. ZIP mechanics are isolated in `frontend/src/zip.ts`; the current implementation emits deterministic stored ZIP entries and requires no third-party ZIP runtime.
The EPUB contains the same immutable `ExportResponse` data and the same viewer behavior as HTML. All fonts and executable resources are inside the EPUB, so normal viewer operation requires no Telugu Now server, Fly.io, Codespaces, Google Fonts, installed Telugu fonts, APIs, external JavaScript, or external CSS.
## EPUB acceptance
Automated tests validate the EPUB ZIP/container structure, first uncompressed mimetype entry, OPF manifest, scripted declaration, Apple Books embedded-font metadata, viewer resources, data, ten fonts, licenses, and offline viewer code.
Before EPUB support is considered complete for release, it should additionally pass an actual-device acceptance test in Apple Books on iPhone:
```text
generate EPUB
→ open/save in Apple Books
→ enable airplane mode
→ close and reopen Books
→ open EPUB
→ verify Back / Next
→ verify random font rerolls
→ verify sizing/fitting
→ verify Diagnostic mapping table
→ rotate and verify refit without reroll
```
## Persistence and migration
The default SQLite file is:
```text
./data/app.sqlite
```
Override it with `DATABASE_PATH`.
Iteration 2 performs a non-destructive schema upgrade for Iteration 1 databases. It removes Iteration 1's observation-level uniqueness on `(source_id, source_key)` so repeats can create distinct acquisitions, creates the shared `source_records` cache, adds profile selection settings/weights, and adds persisted selection snapshots.
Already-ready Iteration 1 observations are backfilled into the shared source-record cache. A compatibility-only disabled Iteration 1 mock resolver remains available for old pending `mock` rows but is not one of the three selectable Iteration 2 sources.
## Environment defaults
See `.env.example`.
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