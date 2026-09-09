# Implementation Iteration 3
This repository contains Implementation Iteration 3 of the Telugu observation app. Iterations 1 and 2 remain the persistence, history/timing, ten-item queue, one-for-one replenishment, source selection, settings, typography, diagnostics, caching, and export foundation.
Iteration 3 adds the offline corpus-transformation boundary, three prepared real Telugu speech sources, persisted grapheme complexity, formal text/audio media metadata, and six-source selection.
## Stack
- TypeScript
- React + Vite
- Hono + Node.js
- SQLite (`better-sqlite3`)
## Project controller

## Prepared corpus prerequisite
Corpus acquisition and transformation are offline data-engineering operations under `data-transform/`. Telugu Now does not parse FLEURS TSV/audio layouts or AI4Bharat Parquet files at application runtime.
The explicit data-controller operations are:
```bash
./control.sh data --option samples
./control.sh data --option prepare
./control.sh data --option all
```
`samples` transforms source downloads under:
```text
data-transform/raw/
```
into source-shaped development input under:
```text
data-transform/sample/
```
`prepare` transforms the current source-shaped input into the canonical local corpus:
```text
data/corpus/
├── manifest.json
├── corpus.sqlite
├── objects/
└── reports/
```
`all` runs `samples` and then `prepare`, stopping immediately if either stage fails.
`./control.sh dev` never performs data transformation. It requires `manifest.json` and `corpus.sqlite` to already exist under `data/corpus/` and returns `CORPUS_NOT_PREPARED` otherwise.
The preparation scripts themselves accept explicit input and output paths. The current Codespaces workflow uses sample-sized source data, while the same transformation implementation is intended to process the complete downloaded corpora before production publication to Fly.io Tigris.

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
The tests preserve the accepted Iteration 1 history, timing, queue, and replenishment invariants; the Iteration 2 caching, settings, presentation, diagnostic, HTML, and EPUB behavior; and the Iteration 3 six-source selector, grapheme complexity reference, prepared-corpus store, formal media metadata, attribution surface, source-record compatibility, and production-style corpus indexing.
Selection is additionally checked against an independent probability oracle, deterministic RNG boundaries, a 100-selection black-box audit, and a seeded 50,000-selection Monte Carlo comparison.
With the development server running, run the isolated UI checks from `ti/`:
```bash
npx playwright install --with-deps chromium
npx playwright test tests/ui.browser.spec.ts --workers=1
```
The browser checks mock API responses and generate audio in memory, leaving real profiles and queues untouched. They cover desktop, phone, and landscape layouts, settings navigation, appearance persistence, export progress, playback speed, precision seeking, and popover dismissal. Screenshots are written to the ignored `test-results/` directory. Set `UI_TEST_URL` to test a different development-server URL.
To include real-media HTTP seeking checks, set `UI_TEST_AUDIO_URL` to a prepared WAV or FLAC object's `/api/audio/...` URL when running Playwright (`UI_TEST_FLAC_URL` remains supported). These checks leave profile requests mocked but let the audio request reach the real server, verifying byte-range responses, forward/backward seeking, precision dragging, and resumed playback. Only these corpus-dependent checks are skipped when neither variable is supplied.
## Selectable sources
Iteration 3 has six selectable sources with independently persisted weights:
1. `source1`: 12 development-fixture rows
2. `source2`: 24 development-fixture rows
3. `source3`: 36 development-fixture rows
4. `fleurs-te`: prepared FLEURS Telugu rows
5. `shrutilipi-te`: prepared Shrutilipi Telugu rows
6. `indicvoices-te`: prepared IndicVoices Telugu rows
The three dummy source rows remain literal development fixtures under `server/src/sources/dummy/data/`.
The three prepared real-source row counts come from the prepared corpus metadata and are never hardcoded into the application.
The current Codespaces sample corpus is only a development input. Replacing it with the complete source datasets changes the prepared source counts without changing the runtime source interface or selection algorithm.
Dummy-source cache misses retain the existing development-only configurable mock latency. Prepared real-source rows are read from the indexed canonical corpus and do not perform an upstream Hugging Face request.
## Source selection
Each profile stores one source weight per selectable source. Every weight is in `[0,1]`, and at least one weight must be exactly `1`. Configurations with every weight below `1` are rejected rather than normalized.
For source `i`, with `N_i` selectable rows and profile weight `w_i`:
```text
source mass = N_i * w_i
P(source i) = (N_i * w_i) / sum_j(N_j * w_j)
```
With all source weights at `1`, source probability is proportional to source row count.
## Global complexity reference
Iteration 3 uses NFC Unicode extended grapheme-cluster count as the intrinsic complexity measurement for every selectable source.
For prepared FLEURS, Shrutilipi, and IndicVoices rows, grapheme count is calculated exactly once during corpus preparation and persisted in `corpus.sqlite`.
The dummy sources calculate the same metric from their committed text fixtures.
The reference is versioned as:
```text
complexity_reference_version = 2
```
The global reference is constructed from source-level complexity classes and row counts rather than loading every prepared source row into JavaScript memory.
For each grapheme-count value `k`, tied rows occupy their empirical global percentile interval `[a_k, b_k]`.
Each profile configures:
1. global complexity percentile target `T` in `[0,1]`;
2. global complexity percentile spread `R > 0`.
The desired complexity curve is a normal distribution centered at `T`. `R` is the half-width corresponding to the central 98% reference interval:
```text
sigma = R / 2.326347874
```
The normal is truncated and renormalized to `[0,1]`. Probability mass over each tied grapheme-count percentile interval is divided by the global number of rows with that grapheme count to produce per-row global complexity mass.
After a source is selected, those masses are normalized over the complexity classes present in that source.
Source probability, conditional row probability, and overall source-and-row probability remain distinct and are persisted in every new acquisition's immutable selection snapshot.
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
Back and Next use invisible edge regions: double-click or double-tap the left edge to go back and the right edge to go next. Single edge clicks do not navigate. The regions remain keyboard-focusable and support Enter/Space; unavailable directions are disabled.
A brief top-right arrow and sequence number identify each Back/Next request actually dispatched, including failed requests. Polling and rerenders do not increment or replay the indicator. Overlapping requests and held-key repeats are suppressed. Status polls run one at a time and responses from before a navigation or local settings update are discarded, preventing older observations from flashing back onto the screen.
A single tap on the central observation surface reveals the bottom-right Settings icon; another central tap or successful navigation hides it. Settings uses the same corner placement as the Settings-language control.
The Settings and Settings-language controls are monochrome application-rendered SVGs using `currentColor` rather than platform emoji glyphs.
When a valid profile has no current observation yet, the observation area displays:
```text
...
```
The placeholder does not create history, an acquisition, source data, or timing state.
## Stable profile-code entry
The initial screen has three fixed digit positions and a profile icon, with no visible labels, placeholders, or error copy. Only entered digits are shown as text. Loading and invalid-code states use icons, with accessible status labels; input remains one native numeric-keyboard field supporting editing and paste. Completing three digits submits once and locks editing until the request finishes.
The control is anchored to the viewport height captured when the entry screen first renders. Opening the software keyboard therefore does not recenter or move it upward as the mobile visual viewport changes.
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
Refitting an already visible observation keeps it visible, reuses loaded fonts, skips unchanged dimensions, and discards superseded asynchronous fit results.
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
Settings replaces the observation view while open; it is not a modal. The root contains five entries:
1. Sampling: Complexity, Source weights, and Data sources
2. Diagnostic: Trigger & acquisition, Source, Complexity, and Global
3. Display: Playback speed and Appearance
4. Export
5. Reset queue: a separate page containing the explanation and reset action
Each child page has Back to return to its parent group. The top-right screen-corner `×` exits the entire Settings hierarchy and returns to the same observation.
At desktop widths (960px and above), a navigation rail also provides direct access to every settings page, with the active destination marked. The top-left sidebar button collapses and restores the rail without changing the current page or discarding unsaved field values. Phones and smaller windows retain the grouped drill-down navigation. The overview shows saved sampling values, the current acquisition, playback/font preferences, and the unseen queue count. Page changes reset content scroll and focus the heading; the short entrance transition is disabled for reduced motion.
The settings interface uses locally bundled Manrope variable type for Latin text, with the existing Noto Sans Telugu fallback. Appearance includes a live gradient and Telugu type sample that responds to color, font-pool, and size changes; the reader continues to choose from the enabled font pool.
Appearance preferences are saved in this browser, independently of profile sampling settings. They control three gradient colors, text and coordinated UI colors, a 0-100 font-size scale (50 preserves the default), and the enabled font pool; at least one font must remain enabled. Oversized gradient layers transition for 650ms when the active observation changes, then stay still until the next change, with no continuous drift or skewed layer edges. Reduced-motion mode keeps the gradient static.
Settings uses compact rows, inline numeric values with understated unit suffixes, and checkmark Save actions. Numeric fields use one underline focus indicator instead of an outer focus ring; keyboard focus remains visible.
Appearance exposes three explicit color roles:
- Background: the three colors used by the reader gradient.
- Text & icons: the exact foreground shared by reader text, settings text, icons, audio tracks, and waveform marks. Borders and muted states derive from this color.
- Settings & popovers: the shared surface behind Settings, export dialogs, and the precision magnifier. Automatic surface selects a light neutral for dark text or a dark neutral for light text; selecting a swatch makes it custom. Changing gradient colors no longer changes these surfaces.
Color swatches show their hex values. Randomize chooses a coordinated palette and restores Automatic surface. Reset colors restores the default colors without changing font size or font exclusions. Custom text/surface pairs should be chosen with sufficient contrast.
The settings refinement references [Google's Material 3 Expressive research](https://design.google/library/expressive-material-design-google-research), [Apple's materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials), and [Linear's UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui), consulted September 2026: stronger typography and hierarchy, a distinct navigation layer, restrained interaction states, and consistent alignment. Form surfaces remain opaque and use the selected appearance colors, rather than applying glass effects to content.
Playback speed supports 0.1x-1.5x. The flat audio controls share the appearance colors, and the precision scrubber moves one millisecond per pointer pixel. Popovers stay within the viewport and consume their outside-dismissal click without also navigating.
Play starts the native audio element directly during the user gesture, independently of Web Audio resume. Loudness normalization connects only after the processing context is running; an unavailable or stalled context does not block native playback. Media loading and playback failures appear above the bar, and Play retries the request.
The audio bar and Settings button start hidden. Clicking the reading area toggles them; after revealing them, pointer movement keeps them visible. They fade after three seconds of inactivity, except while a control is hovered, keyboard-focused, being dragged, or has an open popover. Movement alone does not reveal hidden controls. Keyboard focus can reveal its control, and hiding the audio bar does not interrupt playback. Navigating to another observation hides the controls again.
Audio objects are streamed with HTTP byte-range support for WAV and FLAC: partial requests receive 206 and Content-Range, and unsatisfiable requests receive 416. Versioned audio URLs bypass older immutable full-file responses that lacked seeking support; the canonical audio files are not converted or modified.
Scrubbers prevent native text dragging, selection, and touch callouts while retaining keyboard focus. Pointer capture keeps fine seeking active outside the track and resets after cancellation so the next drag can begin normally.
Because the observation is not visible while Settings is displayed, opening Settings pauses visible-time accumulation. The history-tail absolute timer continues under the accepted Iteration 1 timing model. Closing Settings resumes visible accumulation when appropriate.
A monochrome language control remains bottom-right throughout Settings and switches static Settings/Diagnostic labels between Telugu and English. This language preference is presentation-only.
The Data sources page exposes the current source catalog and attribution information. For FLEURS, Shrutilipi, and IndicVoices it shows the provider, CC BY 4.0 license, upstream Hugging Face repository, catalog version, accepted and rejected row counts, complexity metric, and deployed source status. The dummy sources are explicitly identified as development fixtures.
## Diagnostic
Diagnostic groups its two-column mapping tables into child pages for trigger/acquisition, source, complexity, and global fields. Together these contain the accepted trigger/preparation fields and the complete persisted selection snapshot, including complexity metric, grapheme complexity value, reference version, source mass, source probability, conditional row probability, and overall probability.
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
An indeterminate progress bar remains visible during generation and packaging; the API does not report completion percentages.
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
## Prepared media model
Each canonical prepared row retains:
1. source ID;
2. stable source key;
3. canonical split;
4. original upstream split;
5. canonical Telugu text;
6. persisted grapheme count;
7. text SHA-256;
8. audio SHA-256;
9. audio MIME type;
10. audio duration;
11. content-addressed audio object key;
12. retained source-specific metadata.
FLEURS uses its raw transcription as canonical text and preserves WAV audio.
Shrutilipi uses `text` as canonical text and preserves FLAC audio.
IndicVoices uses `text` as canonical text and preserves FLAC audio. Its verbatim, normalized, unsanitized, speaker, scenario, task, demographic, verification, and other available source metadata remain in source metadata rather than being discarded.
At runtime, canonical rows expose one `TextMedia` item and one `AudioMedia` item. The shared `source_records` cache persists those media descriptors.
Iteration 3 still renders only Unicode text. Audio playback remains deferred to the later Point 11 media interface.
Development resolves canonical object keys against `data/corpus/objects/`. Production will use equivalent object keys for media stored in Tigris; source selection and canonical row identity do not depend on the physical storage backend.
## Persistence and migration
The default SQLite file is:
```text
./data/app.sqlite
```
Override it with `DATABASE_PATH`.
Iteration 2 introduced the non-destructive persistence migration for repeated acquisitions, shared source-record caching, profile source weights, complexity settings, and persisted selection snapshots.
Iteration 3 extends `source_records` with `media_json`, introduces selection reference version 2 with grapheme complexity, and preserves compatibility with historical version-1 word-count snapshots.
Already-ready Iteration 1 observations are backfilled into the shared source-record cache with `media_json = '[]'`. When such a historical cached row is read, the runtime synthesizes its canonical `TextMedia` from the cached text.
A compatibility-only disabled Iteration 1 `mock` resolver remains available for old pending rows. It is not one of the six selectable Iteration 3 sources.
The prepared corpus database is separate from mutable profile/application state:
```text
data/app.sqlite
data/corpus/corpus.sqlite
```
The prepared corpus is generated data and is not application-authored user state.
## Environment defaults
See `.env.example`.
```text
DATABASE_PATH=./data/app.sqlite
CORPUS_DATABASE_PATH=./data/corpus/corpus.sqlite
CORPUS_OBJECTS_PATH=./data/corpus/objects
SOURCE1_WEIGHT=1
SOURCE2_WEIGHT=1
SOURCE3_WEIGHT=1
FLEURS_TE_WEIGHT=1
SHRUTILIPI_TE_WEIGHT=1
INDICVOICES_TE_WEIGHT=1
COMPLEXITY_PERCENTILE_TARGET=0.5
COMPLEXITY_PERCENTILE_SPREAD=0.25
MOCK_DELAY_MIN_MS=1000
MOCK_DELAY_MAX_MS=15000
MAX_EXPORT_COUNT=500
```