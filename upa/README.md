# Telugu Now
Telugu Now is a profile-based Telugu reader with prepared speech datasets, audio playback, personal settings and bookmarks, global word images, and offline HTML/EPUB exports.
Implementation and migration notes belong in the existing [iteration 3 document](../local-machine/impl-iterations/iteration3.md). The complete current persistence inventory is [below](#storage-inventory). Fly deployment instructions live in the [deployment guide](../ci-cd/deployingtofly.md).
## Stack
- TypeScript
- React + Vite
- Hono + Node.js
- SQLite (`better-sqlite3`)
## Project controller

## Prepared corpus prerequisite
Corpus acquisition and transformation are offline data-engineering operations under `local-machine/data-transform/`. Telugu Now does not parse FLEURS TSV/audio layouts or AI4Bharat Parquet files at application runtime.
The explicit data-controller operations are:
```bash
./local-machine/control_local.sh data --option samples
./local-machine/control_local.sh data --option prepare
./local-machine/control_local.sh data --option all
./local-machine/control_local.sh data --option samples --rows 500 --batch-rows 20
./local-machine/control_local.sh data --option all --rows all --batch-rows 20
```
`samples` transforms source downloads under:
```text
data/raw/
```
into source-shaped development input under:
```text
data/sample/
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
The workflow option and row scope are separate: `--option all` alone still extracts the default 100 rows; `--rows all` removes the limit. Numeric limits apply to the FLEURS `dev` split and separately across all available shards of each Parquet dataset. Full mode discovers all available FLEURS `dev`, `test`, and `train` splits and recursively discovers every Parquet shard, preserving its relative split path. It processes local downloads only; it does not download missing upstream data. The interactive data menu also asks for a row count or `all`.

Both stages accept `--batch-rows` (default 20). Parquet decoding and final SQLite writes are bounded by this row count, with progress reported during preparation. Audio payload sizes still determine memory per row. Full raw Parquet shards are moved directly without decoding; partial extraction rewrites only the remainder after the sampled output writer closes successfully. FLEURS scans each selected compressed archive once and reads its TSV metadata into memory. Repeated extraction keeps earlier samples instead of overwriting them; full-shard destination collisions fail explicitly.

The controller keeps move semantics: consumed raw files disappear after extraction, and consumed sample files disappear **only after the complete replacement corpus validates and is published**. A preparation error leaves sample inputs and the previous final corpus intact. This is bounded batch processing, not resumable in-place ingestion: failed preparation restarts from samples. Budget disk space for samples, the new prepared corpus, and any previous corpus until publication; batches do not eliminate that temporary disk requirement. Do not run overlapping data operations or modify their input folders during processing. `prepare` rebuilds from current samples; it does not append to an existing final corpus. Direct `prepare.py` runs retain inputs unless `--consume-input` is specified.

Use Python 3.12 with the declared data dependencies (the current PyArrow constraint has no Python 3.14 wheel). The controller honors `PYTHON`:
```bash
python3.12 -m venv data/.venv
data/.venv/bin/python -m pip install -r local-machine/data-transform/requirements.txt
PYTHON="$PWD/data/.venv/bin/python" ./local-machine/control_local.sh data --option all --rows all --batch-rows 20
data/.venv/bin/python -m unittest discover -s local-machine/data-transform/tests -v
```
The pipeline tests generate small temporary datasets and verify limits, all-split/all-shard coverage, incremental reads and writes, sample preservation on failure, and row/media counts. Raw, sample, prepared, and temporary corpus output directories are Git-ignored. Data operations do not stage files or create Git commits.
`./local-machine/control_local.sh dev` never performs data transformation. With `CORPUS_BACKEND=local`
(the default), it requires `manifest.json` and `corpus.sqlite` beside the configured
catalog and returns `CORPUS_NOT_PREPARED` otherwise. With `CORPUS_BACKEND=tigris`,
startup skips this local-only controller check and lets the runtime validate the
catalog and object-store configuration; it never generates a local audio corpus.
The controller's `data` command runs the tracked extraction and preparation
scripts under `local-machine/data-transform/`. Its offline data paths remain under repository
`data/`; runtime path overrides do not relocate the preparation workflow.
The preparation scripts themselves accept explicit input and output paths. The same implementation processes sample-sized inputs and complete local corpora before production publication to Fly.io Tigris.

The `local-machine/control_local.sh` script is the local development entry point; deployment
starts the built server directly and does not require this controller.
Run these commands from the repository root. Install dependencies on a new checkout:
```bash
./local-machine/control_local.sh deps --option install
```
Start development:
```bash
./local-machine/control_local.sh dev
```
By default, startup uses an existing compatible `availability.sqlite` without
rebuilding it. After preparing a new corpus, explicitly build availability once:
```bash
CORPUS_AVAILABILITY_WORKER_ENABLED=false CORPUS_AVAILABILITY_REBUILD_ON_STARTUP=true ./local-machine/control_local.sh dev --option start
```
Alternatively, set `CORPUS_AVAILABILITY_WORKER_ENABLED=true` for immediate and
periodic refreshes. These controls apply to both local and Tigris backends.
The browser app is served by Vite on port `5173`. The Hono API runs on `127.0.0.1:8787`. Vite binds to `0.0.0.0` so development-container/Codespaces forwarding can expose the UI.
The configured prototype profile code is `001`.
## Build and tests
```bash
./local-machine/control_local.sh build --option start
./local-machine/control_local.sh test --option start
```
The tests preserve the accepted Iteration 1 history, timing, queue, and replenishment invariants; the Iteration 2 caching, settings, presentation, diagnostic, HTML, and EPUB behavior; and the Iteration 3 six-source selector, grapheme complexity reference, prepared-corpus store, formal media metadata, attribution surface, source-record compatibility, and production-style corpus indexing.
Selection is additionally checked against an independent probability oracle, deterministic RNG boundaries, a 100-selection black-box audit, and a seeded 50,000-selection Monte Carlo comparison.
With the development server running, run the isolated UI checks from `upa/`:
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
The three prepared real-source selectable row counts come from the shared availability index, not the canonical catalog's full accepted-row totals, and are never hardcoded.
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

The UI expresses target and spread as percentages: target `1` and spread `1`
mean `T = 0.01` and `R = 0.01`, not the full `[0,1]` range. The central 98%
reference interval is approximately the 0th through 2nd global percentiles,
before truncation at the domain boundary and conditioning on the selected
source. It is not a guarantee that 98% of final draws fall in exactly 1% of a
source's rows. Percentiles are global, and all rows with the same grapheme count
share one interval; a tied class can contain far more than 1% of the corpus.
Its probability mass is divided among all its rows. The displayed overall
probability describes one particular source recording per draw, not every
recording with the same text, and not a history revisit.
## Repeats and profile source-record cache
Selections are independent and with replacement. The same `(source_id, source_key)` may appear in multiple acquisitions.
A stable source record and an acquisition are separate concepts:
- a source record is the underlying source row and normalized retrieved content;
- an acquisition is one particular probabilistic selection event.
`source_records` is a profile-owned persistent cache, keyed by `(profile_code, source_id, source_key)` in `data/user/users.sqlite`. Once that profile's live queue or Export retrieves a source record, later live/export selections for the same profile reuse it. The canonical corpus and audio objects remain global.
## Queue behavior
The live profile maintains ten selected unseen observations. Initial load fills a short queue to ten. Every first-time consumption moves one observation into history and atomically reserves exactly one replacement at the future-queue tail.
Back/forward movement through already-seen history does not consume the queue and creates no replacement. Live source-record preparation remains sequential and queue order remains authoritative regardless of later settings changes, cache-hit speed, or source latency.
Saved source/complexity settings affect only acquisitions selected after the save. Existing history, existing unseen selections, and already-pending preparation work are not resampled.
## Observation controls
### Word profiles and concept images
Double-click an observation word to open its word profile. The surrounding text,
single-click controls, navigation, audio, settings, and export behavior are unchanged.
The dialog closes with Escape, its close button, or a click outside it.

The popup contains the original word with recognized endings/changed stem parts
in a palette-derived secondary color, followed by its image. Whole Telugu graphemes
are kept intact. Analysis uses a small set of known noun alternations and conservative
case-ending rules, not a complete morphological analyzer. Unknown verbs, sandhi and
ambiguous forms are not guaranteed to be analyzed correctly. The original observation
text, layout and behavior are unchanged.

### Image generation setup
Set the lowercase `pollinations_api_key` in the server process environment
(a same-name Fly secret in deployment). A nonempty value takes precedence over
the local file; surrounding whitespace is trimmed. For local development, the
fallback is the repository-root `env`, located using `local-machine/control_local.sh` as the repository marker:
```dotenv
pollinations_api_key=
```
Enter the Pollinations key after `=`. The file is Git-ignored and blocked by Vite's
file server. Do not put the key in frontend code or a `VITE_` variable. The Node
server reads the environment first on each generation request, falling back to
the file when the environment value is missing or blank. Local file key changes
need no restart. Node 20.12+ is required for the standard dotenv parser.
Without `local-machine/control_local.sh`, local file lookup falls back to the parent of the server's
working directory (`../env`). Deployment secrets require neither local file nor
controller script; do not package either to supply credentials.

In **Settings > Display > Image generation**, save a prompt containing the literal
placeholder `<core word>`. The default is:
```text
Drawing of the concept of <core word>. The word itself should not be in the image.
```
The server substitutes every placeholder with the analyzed core word and requests
`microsoft/mai-image-2.5-flash` (MAI Image 2.5 Flash) from Pollinations' authenticated
`https://gen.pollinations.ai/image/{prompt}` endpoint. There is no browser provider
SDK, sign-in popup or exposed API key. Generation occurs only on an explicit click.
Each new provider request includes a random seed to request a fresh variation.
Pollinations account access, rate limits, credits and model terms apply; text-free
output is requested by the default prompt but is not guaranteed by the model.

**Enable regeneration** on this page is saved per profile and defaults to off,
including for existing profiles. Save the setting to expose **Regenerate** on word
dialogs that already have an image. Confirming it replaces that core word's global
image using the active profile's prompt, affecting all profiles and sentences that
reuse the root. The server checks the toggle too. The previous image remains
visible and readable until the replacement is successfully published; generation
or save failures leave it intact. Disabling the setting hides the button again.

Images live globally under `data/word-images/`, separately from both databases.
All profiles and sentences reuse the same normalized core word's saved image,
including when the API key is unavailable. Different senses currently share one
image. Changing a personal prompt affects only future generation or explicit
regeneration, never existing images automatically. Prior image versions are retained
without automatic pruning or a history UI. Back up this directory separately.
Generation is an explicit paid provider operation; keep the prototype behind
access controls. Provider calls are mocked in tests, which do not spend credits
or verify live model quality. API, publication, and retry details are recorded in
the [iteration 3 document](../local-machine/impl-iterations/iteration3.md#global-word-images).

Double-click or double-tap anywhere in the left third of the reader to go back, or the right third to go next. A word hit takes priority over these regions and opens its word/image view. Single clicks never navigate. The edge controls remain keyboard-focusable and support Enter/Space; unavailable directions are disabled.
A brief top-right direction arrow identifies each Back/Next request actually dispatched, including failed requests. No sequence number is displayed. Polling and rerenders do not replay the indicator. Overlapping requests and held-key repeats are suppressed. Status polls run one at a time and responses from before a navigation or local settings update are discarded, preventing older observations from flashing back onto the screen.
**Scroll mode** is enabled by default under **Display > Appearance > Audio controls**, including for existing profiles without a saved choice. Single taps toggle playback; bottom-third taps dismiss open precision controls first, and audio sliders keep their own gestures. Swipe horizontally in either direction to reveal only the audio bar; reverse that direction to hide it together with any open precision controls, including the speed view. Horizontal trackpad scrolling and Shift+wheel work too. Swipes beginning on sliders or buttons retain those controls' own gestures; swipe elsewhere or use horizontal wheel scrolling to dismiss them. The controls translate horizontally while a centered slit opens or closes over 320 ms, rather than appearing statically or entering from a screen edge. All open controls slide out together, and the next reveal shows only the bar: opening the magnifier remains the gateway to speed and bookmarks. Reduced-motion preferences disable the transition. Disabling scroll mode restores upper-two-thirds playback taps and bottom-third bar toggles/precision dismissal. The preference is saved per profile.

Single-tap actions wait for the double-tap decision window, including at hitbox boundaries. Double taps are unchanged: left/right thirds navigate back/forward, the middle third toggles the Settings icon, and a word takes priority to open its image view. Showing or hiding the bar never changes playback. Settings uses the same corner placement as the Settings-language control, with its gear painted in the audio controls' shared palette gradient.
The Settings and Settings-language controls are monochrome application-rendered SVGs using `currentColor` rather than platform emoji glyphs.
When a valid profile has no current observation yet, the observation area displays a loading status until the first queued item is ready:
```text
...
```
Once ready, a central arrow replaces the dots. Clicking, tapping, or activating it with Enter/Space opens the first observation. The loading status itself does not create history, an acquisition, source data, or timing state.
## Stable profile-code entry
The initial screen has three fixed, softly outlined digit slots and a profile icon, with no visible labels, placeholders, or error copy. Only entered digits are shown as text. Loading and invalid-code states use icons, with accessible status labels; input remains one native numeric-keyboard field supporting editing and paste. Completing three digits submits once and locks editing until the request finishes.
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
The reader lowers text by up to 20px when spare vertical space permits, retaining clearance for the transport and playback messages. Long passages keep their fitted size and receive a smaller or zero offset.
The canonical presentation configuration lives in `frontend/src/presentation.ts` and is reused by the live viewer and both export formats.
The preferred size is derived continuously from observation length. After a font is selected, the browser waits for that font, measures the rendered observation, and reduces the preferred size only as necessary to fit the available area. Replacement text is hidden immediately, without an opacity transition, until its font and final size are ready. Rendered text supports native selection and copying in the live reader and shared HTML/EPUB viewer.
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
3. Display: Playback speed, Appearance, and Image generation
4. Export
5. Reset queue: a separate page containing the explanation and reset action
Each child page has Back to return to its parent group. The top-right screen-corner `×` exits the entire Settings hierarchy and returns to the same observation.
At desktop widths (960px and above), a navigation rail also provides direct access to every settings page, with the active destination marked. The top-left sidebar button collapses and restores the rail without changing the current page or discarding unsaved field values. Phones and smaller windows retain the grouped drill-down navigation. The overview shows saved sampling values, the current acquisition, playback/font preferences, and the unseen queue count. Page changes reset content scroll and focus the heading; the short entrance transition is disabled for reduced motion.
The settings interface uses locally bundled Manrope variable type for Latin text, with the existing Noto Sans Telugu fallback. Appearance includes a live gradient and Telugu type sample that responds to color, font-pool, and size changes; the reader continues to choose from the enabled font pool.
Appearance preferences are saved in server-side SQLite for the active profile, alongside its sampling and playback settings. They control three gradient colors, text and coordinated UI colors, a 0-100 font-size scale (50 preserves the default), and the enabled font pool; at least one font must remain enabled. Oversized gradient layers transition for 650ms when the active observation changes, then stay still until the next change, with no continuous drift or skewed layer edges. Reduced-motion mode keeps the gradient static.

Under **Display > Appearance > Position**, separate text and audio-bar sliders adjust their vertical offsets from the defaults, from -200 to +200 pixels. Negative values move up; positive values move down. The bottom inset is 16 pixels plus the device safe area. **Audio control order** offers **Bar above / magnifier below** (default) and **Bar below / magnifier above**. There is no Play button. The bar, thumb, and precision controls share the same softly graded translucent glass. A centered 32-pixel-high highlight marks the magnified section on the main bar, with no connector or background behind the enlarged waveform. The compact lens and action rows lower the default bar by 20 pixels while preserving 44-pixel button hit targets and the safe-area inset. Speed and bookmarks sit directly below the lens in either order. Space is reserved so opening precision controls does not shift the bar under the pointer. Routine audio preparation appears as top-right dots; genuine playback errors remain visible even with the bar hidden. Saved offsets and magnifier order remain intact. **Reset positions** restores both offsets to zero and Bar above / magnifier below.
Under **Display > Appearance > Control spacing**, two independent 0-48 pixel sliders set **Audio bar to timestamp** and **Timestamp to magnifier** spacing (default 1px each). A live preview mirrors **Magnifier position > Above / Below**. From the main bar outward, the order is always timestamp, then magnifier; switching sides preserves both gaps. Existing shared spacing is carried over to both controls. **Reset control spacing** restores both defaults without changing position.
Settings uses compact rows, grouped numeric values with small unit suffixes, and checkmark Save actions. Numeric values and their units share one subtle rounded focus treatment without separate underlines. Secondary labels and inset dividers preserve the page hierarchy. Editable controls use at least 16px text to avoid mobile focus auto-zoom without disabling pinch zoom; keyboard-aware vertical scrolling keeps the focused field accessible. On narrow screens, the language globe has its own bottom row rather than overlaying scrollable settings.

**Settings > Eons** marks named periods of use for each profile. Enter a name (up to 80 characters) and choose **Start eon**; only one eon can be active at a time. Starting includes the current observation. Subsequent views, including already prepared observations and history revisits, belong to the active eon until **Stop eon**. Eons survive reloads and show their start/stop times and distinct observation counts. The same observation can belong to multiple eons without overwriting its original acquisition diagnostics.

Eon API: `GET /api/profiles/:code/eons`, `POST /api/profiles/:code/eons` with `{ "name": "Practice" }`, and `POST /api/profiles/:code/eons/:eonId/stop`. Start/stop results include the active eon and newest-first history. Failed changes are shown explicitly; reload checks the server state before retrying.

SQLite diagnostics retain first-consumption history/timing in `history_entries` and original generation-time selection parameters in `observation_acquisitions.selection_snapshot_json`, including complexity target/spread, source weights, and selection probabilities. `profile_eons` stores named boundaries, while `observation_views` records subsequent server-accepted load, visible-resume, back, forward, and next operations, plus the current-observation marker when an eon starts. These are presentation operations, not client-render acknowledgments or audio/tap telemetry. Polling and preloading do not create views. Timestamps are Unix epoch milliseconds; detailed revisit events begin with this feature and are not fabricated for older history.

```sql
SELECT v.viewed_at, v.kind, e.name AS eon, v.observation_id,
       v.history_position, a.selection_snapshot_json
FROM observation_views AS v
LEFT JOIN profile_eons AS e ON e.id = v.eon_id
LEFT JOIN observation_acquisitions AS a
  ON a.observation_id = v.observation_id AND a.profile_code = v.profile_code
WHERE v.profile_code = '001'
ORDER BY v.id;
```
Appearance exposes three explicit color roles:
- Background: the three colors used by the reader gradient.
- Text & icons: the foreground for reader and settings text and icons. Borders and muted states derive from this color.
- Settings & popovers: the surface behind Settings and export dialogs. Automatic selects a light neutral for dark text or a dark neutral for light text. Audio controls use a smooth three-stop palette wash with uniform translucency, not repeated bright bands. Shape masks reuse the icon SVG geometry so backdrop blur and saturation are confined to the glyphs rather than rectangular hit boxes; browsers without masking retain the SVG gradient paint. Thumbs also filter the backdrop, while thin tracks and waveform bars use matching translucent shading without a separate blur layer per waveform segment. HSL lightness changes retain the palette's hue and saturation. There are no glass panels or boxes behind the hit targets. Thin versus thick strokes distinguish tracks and progress. An entirely neutral gradient remains neutral. The settings surface swatch does not change the audio colors.
Color swatches show their hex values. Randomize chooses a coordinated palette and restores Automatic surface. Reset colors restores the default colors without changing font size or font exclusions. Custom text/surface pairs should be chosen with sufficient contrast.
The settings refinement references [Google's Material 3 Expressive research](https://design.google/library/expressive-material-design-google-research), [Apple's materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials), and [Linear's UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui), consulted September 2026: stronger typography and hierarchy, a distinct navigation layer, restrained interaction states, and consistent alignment. Form surfaces remain opaque and use the selected appearance colors, rather than applying glass effects to content.
Playback speed supports 0.1x-1.5x. Clicking the speed button replaces the magnified waveform and time with a horizontal speed slider and rate readout in the same space; clicking it again restores the waveform and its highlight on the main audio bar. The highlight is hidden in speed mode. Left/right arrows adjust speed, Home/End select its limits, and Escape from the speed slider restores the waveform and focuses the speed button. Speed and bookmarks keep their stationary 48 by 44 pixel targets below either view. The precision scrubber moves one millisecond per pointer pixel. Reader gestures, including navigation doubles, remain available while precision controls are open; the bottom-third single tap dismisses the whole group. Direct interactions with sliders and action buttons remain dedicated to those controls.
The precision bar and its speed/bookmark actions start hidden. A 300 ms hold on the main seek bar, or a pressure-sensitive hard press, opens the group. A normal bar click seeks. Enter/Space on the bar provides keyboard access. Escape or an outside single tap dismisses precision in scroll mode; reverse scrolling hides the entire group. Legacy tap mode uses the bottom third for precision dismissal. Merely opening or dismissing it does not pause audio. Precision dragging or arrow-key seeking still pauses for accuracy; a playback tap resumes. Space/Enter with the reader itself focused also toggles playback.
The desktop settings rail has independent collapse controls for Sampling, Diagnostic, and Display. Group navigation and child links remain available without resetting the current page.
Audio is prepared ahead of playback: the current recording has priority, and up to three upcoming ready queue/forward-history recordings are warmed without consuming reservations. Downloads are deduplicated; speculative preparation is serial with a reserved current-clip slot. Each recording is decoded, speech-only loudness-normalized, and encoded into one native PCM WAV Blob with exactly 500 ms of zero samples prepended. A persistent native element attempts autoplay on each observation while the bar stays hidden, without a suspendable output graph or source switches during playback. The silent half-second is part of the duration, waveform, and seek bar. Animation-frame updates follow its native clock. The selected pitch-preserving rate applies to the entire clip. Resume continues at the paused position without adding silence; replay starts at zero.

Cold preparation shows corner dots, not a false playing state. A playback tap while loading toggles whether audio should start when ready. Browser autoplay policies still apply: blocked playback shows a prompt to tap the upper reader area or allow sound. Failed downloads, decoding, and playback show actionable feedback and an upper-screen tap retries. Navigation aborts unowned pending downloads, ignores stale completions, and releases Blob ownership only after detaching native media. The cache has a 64 MiB WAV budget and normally retains at most six entries; in-use Blobs are never evicted. Downloads have a 32 MiB limit and a 30-second deadline; decoded clips support two channels and two minutes, with a 16 MiB prepared-clip limit. Decoding resamples to 24 kHz. Web Audio decoding is required, but its context need not run. Original corpus files and exports are unchanged. Bookmarks stay in original speech seconds in persistence, translated by +0.5 seconds for display/seeking and -0.5 when creating.

Focused reader-gesture browser regression command (with the development client running): `npx playwright test tests/ui.browser.spec.ts --grep 'reader tap playback|scroll mode' --output=test-results/audio-browser`. These cases cover hidden autoplay, swipe/wheel reversal, independent bar visibility, precision dismissal, saved scroll-mode opt-out, repeated doubles, and the persistent native element across navigation. For device acceptance, open a profile on iOS Safari/Android Chrome: audio should start with the bar hidden when the browser permits it. Check playback taps, horizontal reveal/hide swipes, legacy tap mode, double-tap navigation/settings/words, cold preparation, seeking, playback rates, replay, and bookmark reloads. Touch emulation is not a substitute for physical-device audio/pitch verification.
The audio bar and Settings icon start hidden. Reader taps use a 400 ms decision window. A second nearby tap cancels the single action entirely, including when the pair straddles hitboxes; repeated doubles never insert playback or visibility toggles. Click the revealed Settings icon to enter Settings. Double taps suppress native text selection. Scroll mode reserves horizontal drags for audio visibility; disabling it restores ordinary drag selection. Direct slider/action interactions and keyboard navigation do not wait for the reader-tap window. Keyboard focus can reveal either control group for accessibility. **Display > Appearance > Auto-fade** sets the shared inactivity delay from 1 to 60 seconds (default 15). Movement and keyboard activity reset the timer but do not reveal hidden controls. Active dragging postpones fading until release. Hiding controls does not stop playback. Navigation hides both groups. Profile preference loading uses the same text-free spinner as sign-in instead of flashing a loading sentence.
Audio objects are streamed with HTTP byte-range support for WAV and FLAC: partial requests receive 206 and Content-Range, and unsatisfiable requests receive 416. Versioned audio URLs bypass older immutable full-file responses that lacked seeking support; the canonical audio files are not converted or modified.
Scrubbers prevent native text dragging, selection, and touch callouts while retaining keyboard focus. Pointer capture keeps fine seeking active outside the track and resets after cancellation so the next drag can begin normally.
Because the observation is not visible while Settings is displayed, opening Settings pauses visible-time accumulation. The history-tail absolute timer continues under the accepted Iteration 1 timing model. Closing Settings resumes visible accumulation when appropriate.
A monochrome language control remains bottom-right throughout Settings and switches static Settings/Diagnostic labels between Telugu and English. This language preference is saved per profile and does not change source content.
The Data sources page exposes the current source catalog and attribution information. For FLEURS, Shrutilipi, and IndicVoices it shows the provider, CC BY 4.0 license, upstream Hugging Face repository, catalog version, accepted and rejected row counts, complexity metric, and deployed source status. The dummy sources are explicitly identified as development fixtures.
## Diagnostic
Diagnostic groups its two-column mapping tables into child pages for trigger/acquisition, source, complexity, and global fields. Together these contain the accepted trigger/preparation fields and the complete persisted selection snapshot, including complexity metric, grapheme complexity value, reference version, source mass, source probability, conditional row probability, and overall probability.

**Trigger & acquisition** also reports whether this recording was previously
displayed, its occurrence number, and its previous display time. Separate rows
report previous displays of the same text from other recordings. These are
per-profile first-display counts: selecting a queued candidate, reopening the
app, or revisiting the same history entry does not increment them. A snapshot is
saved when an observation first enters history; later history visits retain that
snapshot. Aggregates live in `recording_displays` in the user database and survive
history pruning and restarts. Existing profiles use the same concrete recorded
counts, starting with retained history and continuing with every new display;
they no longer remain permanently in an "unknown" state. Old entries without a
snapshot reconstruct one from earlier retained entries, excluding later displays.
The UI calls these **Times shown (recorded)**, not all-time totals: history deleted
before tracking began cannot be recovered or invented.

Relaunch restores the saved history cursor and queued candidates; it does not
start a seeded sequence over or automatically skip to the newest entry.
Navigation skips gaps left by history pruning rather than stepping onto missing
positions. New selections still use weighted random sampling with replacement:
legitimate repeats remain possible, particularly with concentrated complexity
settings or multiple recordings of the same text.

### Audio validation before queue readiness

Queued reservations are not displayable until their audio has passed bounded
FFmpeg decoding and, when supplied by the corpus, SHA-256 verification. Cached
source metadata does not bypass validation. Successful decode results are reused
only when the current object identity still matches (remote ETag/version or local
file identity, plus the expected checksum). Existing ready reservations are
revalidated on server restart, profile load and browser visibility resume.

The separate `AUDIO_VALIDATION_PATH` SQLite report defaults to
`audio-validation.sqlite` beside `CORPUS_AVAILABILITY_PATH`, which is
`/data/corpus/audio-validation.sqlite` on Fly. It stores object keys, validation
status, reason and timestamp, scoped to the storage backend/bucket/root.
Missing, malformed or checksum-mismatched recordings are quarantined persistently;
the read-only canonical corpus is never edited. Quarantine exclusions update
effective source counts, complexity classes and selection probabilities without
requiring a background availability worker. An invalid queued reservation is
replaced transactionally, preserving its queue slot and trigger.

Network/authentication failures, unavailable FFmpeg, timeouts and operational
size/duration limits do not permanently blacklist a recording. Preparation makes
at most three attempts, with one- and five-second retry delays, then exposes the
error in diagnostics instead of retrying forever. Correct the underlying problem
and reset the queue to retry exhausted preparation. Validation uses the bounded
conversion path: two concurrent jobs per validator, 32 MiB input, five minutes of
audio and a 30-second timeout. Quarantines require deliberate maintenance after
repair; replacing an object or rebuilding availability does not silently clear
them. Validation cannot prevent a later network failure or guarantee every
device's native codec support.
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
generate N fresh selections
    ↓
package the completed ExportResponse
    ↓
Download
```
Pressing Export opens a native modal format chooser covering the full viewport. Cancel or Escape closes it without generating anything and restores focus to Export.
An indeterminate progress bar occupies a separate row, showing selection and file-preparation stages; the API does not report completion percentages.
The selected format is not passed into source or row selection. EPUB versus HTML changes packaging (including EPUB-only MP3 conversion), not selection.
Every Export action generates a new batch, even if the count and format are unchanged. Download saves the currently prepared artifact without resampling. Fresh random selections may repeat rows, and source-record cache hits can still make later exports faster.
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
It is one self-contained browser document containing all observations, diagnostics, inline CSS, inline JavaScript, canonical presentation configuration, all ten embedded WOFF2 fonts, font-license notices, and available audio clips embedded as data URLs. A native audio control plays and seeks the active clip; navigation stops the previous clip. Text-only source rows have no audio control.
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
  audio.xhtml       # script-free first spine page when audio is present
  audio-help.xhtml
  viewer.xhtml
  viewer.css
  viewer.js
  data.json
  audio/
    clip-1.mp3      # available clips, deduplicated by original URL
  fonts/
    <all 10 WOFF2 files>
  licenses/
    <all required font license files>
```
The `mimetype` entry contains exactly `application/epub+zip`, is the first ZIP entry, and is stored without compression. `META-INF/container.xml` points to `EPUB/package.opf`. The OPF manifest declares the navigation document, scripted viewer, shared viewer CSS/JavaScript, data, all fonts, and license resources. The viewer manifest item is explicitly marked `scripted`; for audio books its spine item is non-linear, making the script-free audio page the primary reading flow.
Because Apple Books is the explicit EPUB target and the book embeds its own fonts, `package.opf` also declares the Apple Books `ibooks` vocabulary prefix and includes:
```xml
<meta property="ibooks:specified-fonts">true</meta>
```
This tells Apple Books to honor the packaged font faces used by the randomized typography viewer rather than substituting reader-selected fonts.
The browser-side EPUB packager is isolated in `frontend/src/export-epub.ts`. ZIP mechanics are isolated in `frontend/src/zip.ts`; the current implementation emits deterministic stored ZIP entries and requires no third-party ZIP runtime.
The EPUB preserves the selected observations and optional interactive viewer; a separate script-free text/audio page opens first when recordings are present, with native audio controls and MP3 links. For EPUB only, the client requests MP3 copies from `GET /api/export-audio/<encoded-corpus-object-key>` and packages `.mp3` files with `audio/mpeg` in the manifest, source elements, and copied export data. Original WAV/FLAC corpus bytes, live `/api/audio/...` playback, and HTML exports remain unchanged. Each distinct original URL is converted/fetched once per export; missing or failed audio aborts packaging rather than silently producing an incomplete file.

Local EPUB audio conversion requires `ffmpeg` on `PATH`, including the `libmp3lame` encoder (`sudo apt-get install ffmpeg` on Debian/Ubuntu). The runtime Docker image installs it. Conversion accepts only validated WAV/FLAC corpus object keys, uses the existing local-root/symlink or object-store protections, and never accepts arbitrary URLs or filesystem paths. It pipes audio through ffmpeg without a shell or corpus writes, producing 128 kbps mono 44.1 kHz MP3. Per server process, at most two conversions run at once, with no waiting queue; each has a 32 MiB input limit, 8 MiB output limit, five-minute audio limit, and 30-second total timeout (including loading). Over-limit or invalid audio fails explicitly rather than being silently truncated. Disconnect/error/timeout closes upstream streams and terminates the encoder. There is no conversion cache or server-side archive. Responses use `Cache-Control: no-store` and never inherit original byte-range, ETag, or encoding headers. Busy or missing-ffmpeg requests return 503; clients can retry the export.

All fonts, audio, and executable resources are inside the EPUB, so normal playback requires no Telugu Now server or network access. MP3 is an EPUB 3 core audio format supported by Apple Books, avoiding reliance on original WAV/FLAC decoder support. It does not enable scripting in readers that disable it or guarantee identical native controls across readers. The optional interactive viewer still requires reader scripting support; actual iPhone/iPad Apple Books playback and seeking acceptance remains required and is not claimed by the automated tests.
## EPUB acceptance
Automated tests validate the EPUB ZIP/container structure, first uncompressed mimetype entry, MP3 MIME/path declarations, script-free audio page, scripted viewer declaration, Apple Books embedded-font metadata, viewer resources, data, ten fonts, licenses, and offline viewer code. With ffmpeg installed, targeted server tests convert real small WAV and FLAC recordings and decode/probe the MP3 outputs, plus exercise limits, cancellation, and unchanged original-route behavior.
Before EPUB support is considered complete for release, it should additionally pass an actual-device acceptance test in Apple Books on iPhone:
```text
generate EPUB
→ open/save in Apple Books
→ enable airplane mode
→ close and reopen Books
→ open EPUB
→ verify script-free MP3 playback, pause and seeking
→ open the optional interactive viewer
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
At runtime, canonical rows expose one `TextMedia` item and one `AudioMedia` item. The profile-owned `source_records` cache persists those media descriptors, and the reader plays available audio with profile-owned bookmarks.
With `CORPUS_BACKEND=local`, runtime resolves canonical object keys against
`CORPUS_OBJECTS_PATH` (default `data/corpus/objects/`). With `CORPUS_BACKEND=tigris`,
it reads objects from the configured S3-compatible bucket and key prefix.
## Persistence and migration
There are three separate database files, with default paths relative to the repository root:
```text
data/corpus/corpus.sqlite       Global prepared corpus
data/corpus/availability.sqlite Shared object availability
data/user/users.sqlite         All user data, scoped by profile_code
```
There is no separate database per user. The application reads the prepared corpus;
all mutable reading state, settings, cache entries, bookmarks, and migration markers
go into the shared user database with profile ownership. Corpus availability and
images remain global rather than profile-owned.

All persisted local user and global data belongs under `DATA_DIRECTORY` (default:
repository-root `data/`); Tigris audio objects live in the configured bucket.
The only other exceptions
are credentials, downloaded HTML/EPUB files, and assets/artifacts. Assets are bundled
fonts, licences, icons, static application files and committed test fixtures.
Artifacts are build output, installed dependencies, test results, and controller
logs/process files. Corpus files, audio, generated word images and user caches are
data, not part of that exception.

Default runtime paths are located from the repository root, regardless of the
working directory; no `local-machine/control_local.sh` marker is required. An explicit `DATA_DIRECTORY`
may be any persistent mount root and does not require locating the repository.
`DATABASE_PATH`, `CORPUS_DATABASE_PATH`, `CORPUS_AVAILABILITY_PATH`, and
`CORPUS_OBJECTS_PATH` may select locations inside that root; runtime rejects paths
outside it and rejects sharing a file between the three databases. Relative
environment paths resolve against the working directory (`upa` with `local-machine/control_local.sh`).
Tests may use isolated database paths outside the data root.

The default layout is:
```text
data/                         # or DATA_DIRECTORY
├── corpus/
│   ├── corpus.sqlite         # canonical global catalog
│   ├── availability.sqlite   # shared object-availability state
│   ├── objects/              # local backend audio objects
│   ├── manifest.json
│   └── reports/
├── user/
│   └── users.sqlite          # all profile-owned records and caches
└── word-images/              # shared generated images, never per-user
```

On first startup with the **default** database path, an existing
`DATA_DIRECTORY/users.sqlite` is copied into `user/users.sqlite` through SQLite's
consistent snapshot mechanism, including committed transactions still in its WAL.
The verified snapshot is published atomically without replacing any existing
target. An explicit `DATABASE_PATH` disables this migration, even if it names the
default target. The original database is retained for recovery, never deleted.
Stop old application processes before upgrading so they cannot keep writing to
the old database after the snapshot. After verifying the new database and your
backup, archive the old database and its sidecars together. Existing targets are
authoritative and are not automatically merged with legacy files.
Legacy `word_images` table migration still transfers all images into the shared
`DATA_DIRECTORY/word-images/` directory before dropping the old table.

### Local and Tigris corpus backends
Set `CORPUS_BACKEND=local` for filesystem audio or `CORPUS_BACKEND=tigris` for
S3-compatible object storage. No automatic backend guessing is performed.
Keep the prepared catalog and shared availability database on the persistent
mount in either mode. Tigris uses `BUCKET_NAME`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`
(default `auto`), and standard AWS credential-provider environment variables.
Supply credentials through deployment secrets, not source files or browser code.
`CORPUS_OBJECTS_PREFIX` defaults to `corpus/objects/`; it is a bucket key prefix,
not a filesystem path. `CORPUS_AVAILABILITY_REFRESH_MS` applies to the worker in either backend,
defaults to `7200000` (two hours), and
must be an integer from 1 to 2147483647 milliseconds (the Node timer limit).
Availability is global corpus
state, not a user's source-record cache. Local mode does not require S3 credentials.
Changing these settings does not create buckets, upload audio, or provision infrastructure.

On the first Tigris startup, a missing `corpus/corpus.sqlite` is streamed from that
bucket key into a sibling staging file, checked for SQLite integrity and the
canonical schema, then published atomically. A failed download leaves no partial
catalog. An existing catalog is never downloaded again or rewritten by runtime.
Tigris needs only the two SQLite files under `corpus/` on the mount; local audio,
`manifest.json`, and `reports/` are not required in this mode. The application
does not download an audio mirror.

Both modes build `availability.sqlite` from the same canonical rows. Eligible
audio must be a nonempty local file or a nonzero-size object in a fully completed,
paginated S3 inventory. Multiple canonical rows sharing one audio object remain
separate rows; runtime never deduplicates or edits the corpus. Dense zero-based
indexes per source/grapheme-count class and stored class/source totals drive the
same source-weight, complexity, and random-row algorithm in both modes.

Availability startup behavior is independent of the backend:

| Worker enabled | Rebuild on startup | Behavior |
|---|---|---|
| `false` (default) | `false` (default) | Use the existing compatible `availability.sqlite`; fail startup if missing, invalid, or incompatible. No inventory scan or rebuild. |
| `false` | `true` | Rebuild once before serving, even if a snapshot exists; fail startup if rebuilding fails. No worker or timer. |
| `true` | Either (ignored) | Start immediate and periodic background refreshes. |

Set these with `CORPUS_AVAILABILITY_WORKER_ENABLED` and
`CORPUS_AVAILABILITY_REBUILD_ON_STARTUP`; both accept only `true` or `false`.
Tigris catalog downloads and audio access are unchanged by these settings.
With the worker disabled, audio inventory changes are not reflected until an
explicit rebuild and application restart.

When enabled, the worker thread inventories audio immediately and waits
the configured refresh interval after each pass completes before starting again.
It builds a complete sibling snapshot before atomically
replacing `availability.sqlite`. Failed scans, malformed or interrupted
pagination, and failed builds are logged and leave the previous complete pool
in service; retry occurs after the interval. The first launch waits if no matching
snapshot exists and fails safely if that initial build fails. Existing compatible
snapshots allow serving immediately while refresh runs. Allow disk space for the
old snapshot and its replacement. Each API process with the worker enabled manages its own refresh
worker. Publication notifies the backend to reload the snapshot without restarting
the service; the UI continues using the same API and does not contact the worker.

Snapshot metadata records its generation, eligible-pool hash, canonical file
identity, and backend location. Unchanged inventories do not publish a new
generation. Publication swaps the reader and invalidates the selection engine's
complexity reference before the next selection, so source totals, class counts,
and dense indexes always agree. New queue acquisitions and exports see the new
pool; already selected queue entries and immutable history snapshots are not
resampled. Keep published content-addressed audio available for those older
acquisitions and exports. Replacing the canonical catalog requires an app restart.

The live player and HTML export packaging use `/api/audio/...`; EPUB packaging
uses the separate bounded MP3 conversion route `/api/export-audio/...`. Tigris
GET responses are streamed through the server, with HEAD, byte ranges,
conditional requests, ETag/Last-Modified, MIME metadata, and 404/416 handling.
Unsafe keys are rejected before filesystem or S3 access, and upstream error
details are not exposed to clients. Credentials use the official AWS SDK default
provider chain; `.env.example` only documents variables and is not loaded automatically.

The old `upa/data/app.sqlite` and its sidecars have been deleted after verifying the
transfer of all user records and image files. Startup no longer reads or recreates
that old database. The old image tables have also been removed: their prompt is
preserved in existing users' settings and their images in global file storage.

Older settings and bookmarks still held by a browser are user data. After you enter
your three-digit code, the app transfers them into that user's database records.
Current server-saved settings and bookmarks are not overwritten. The exact older
values are also retained in the user database, including conflicting or unreadable
values, so deleting an old browser copy cannot discard information. The browser
removes only values confirmed saved by the server and unchanged during transfer.
Failed transfers keep the old copies and offer Retry. A browser must open the
updated app to transfer its data; the server cannot retrieve it from a closed or
unavailable browser. No normal settings or bookmark saves go to browser storage.

Saved settings and bookmarks follow the user across devices; open devices are not
live-synchronized. Appearance/language saves are ordered and offer Retry on failure;
bookmark edits become visible after server confirmation and also offer Retry.
Unsaved edits are not durable across closing the page. Three-digit codes remain
prototype identifiers, not secure authentication.

## Storage inventory
Paths below are relative to the repository root with normal `local-machine/control_local.sh` startup.
Every item below has user, global, credentials, downloads, or assets/artifacts scope.

| Information | Scope | Location and contents |
| --- | --- | --- |
| Prepared dataset catalog | Global | Read-only `data/corpus/corpus.sqlite`: `sources` (catalog/provenance), `source_rows` (canonical text and audio metadata), and the original offline `source_complexity_members` index, which runtime selection does not use. |
| Dataset audio and preparation metadata | Global | Local mode uses `data/corpus/objects/` for WAV/FLAC audio; Tigris uses `BUCKET_NAME` and `CORPUS_OBJECTS_PREFIX`. `manifest.json` and `reports/` under `data/corpus/` describe prepared data and validation results. |
| Built-in fixture datasets | Assets/artifacts | Committed TypeScript development fixtures in `upa/server/src/sources/dummy/data/`, not acquired corpus files or a mutable database. |
| Corpus availability | Global | `data/corpus/availability.sqlite`: `metadata` (generation, identity, pool hash), `source_counts`, `complexity_counts`, and dense eligible `source_complexity_members`; shared by all profiles, separate from canonical content. |
| Appearance and language | User | `data/user/users.sqlite`, `profile_preferences`: gradient, text/UI and surface colors, font pool and size, text/audio positions, magnifier position, scroll mode, auto-fade delay, Settings language. |
| Eons and view history | User | `data/user/users.sqlite`, `profile_eons` and `observation_views`: named usage periods and timestamped observation/eon links, including revisits. Original selection snapshots remain in `observation_acquisitions`. |
| Image-generation settings | User | Same user database, `profile_preferences`: personal prompt and default-off regeneration permission. These settings do not make image files private. |
| Sampling and playback settings | User | Same user database: `profile_selection_settings` (complexity target/spread), `profile_source_weights`, `profile_audio_settings` (default playback rate). |
| Reading state and diagnostics | User | Same user database: `profiles`, `queue_items`, `history_entries`, `observations`, `observation_acquisitions`. Retains cursor, history, queued items, absolute/visible timing, last-seen timestamps, preparation status and immutable selection/trigger snapshots. Observation ownership is linked through queue, history and acquisition rows. |
| Prepared source-record cache | User | Same user database, `source_records`, keyed by user code, source ID and source key. Stores reusable text, media descriptors and preparation timestamps, not copied audio bytes. |
| Audio bookmarks | User | Same user database, `profile_audio_bookmarks`, keyed by user code, source ID and source key; sorted playback positions in seconds. Empty lists retain an explicit cleared state. |
| Migration records | User | Same user database, `profile_migrations`: retained `settings-v1` and `bookmarks-v1` completion timestamps. |
| Transferred older browser data | User | Same user database, `profile_browser_data`: exact prior appearance, language, bookmark and migration values with transfer timestamps, scoped by user code. Current usable values also populate the preference/bookmark tables when missing. Older values are retained here even if they conflict with current settings or cannot be parsed. |
| Word images | Global | `data/word-images/<root-sha256>/`: image files and `metadata.json`, including retained superseded image files after regeneration. |
| Provider credentials | Credentials | Server environment `pollinations_api_key` takes precedence over the local root `env` fallback. Use a same-name Fly secret in deployment. Never expose credentials to the browser or commit them. |
| Runtime configuration | Assets/artifacts | Defaults are application configuration in `upa/server/src/config/config.ts`; `upa/.env.example` documents process-environment overrides. These are deployment configuration, not saved user settings. |
| Exports | Downloads | HTML/EPUB artifacts are packaged in browser memory; downloaded copies live wherever the browser saves them. There is no server-side export archive. |
| Operational/generated files | Assets/artifacts | `upa/.control/` contains controller logs, process IDs and state; `upa/dist/` is build output; `upa/test-results/` and `upa/playwright-report/` contain test artifacts. These are not stores for user data or corpus data. |
| Raw and sample inputs | Global | `data/raw/` and `data/sample/`; successful controller operations consume inputs. They are absent until data is acquired/extracted. `data/.corpus.prepare-*/` and `data/.corpus.backup-*/` may exist during corpus publication/recovery. |
| Bundled fonts and application files | Assets/artifacts | `upa/frontend/public/fonts/` contains WOFF2 assets, licenses and `font-assets.lock.json`; `upa/frontend/font-assets.json` maps families to files. Icons, static files, source code and package/config files remain with the app. Dependencies under `upa/node_modules/` are generated. |
| User database sidecars | User | `data/user/users.sqlite-wal` and `data/user/users.sqlite-shm` support live SQLite transactions and remain alongside the user database. |
| Corpus database sidecars | Global | Any SQLite sidecars remain alongside `data/corpus/corpus.sqlite`. |

SQLite WAL files may contain committed changes not yet checkpointed, so do not
copy only the main database while the app is writing. Use SQLite-aware backups
or stop the app cleanly before copying. Back up `data/user/users.sqlite`, the complete
`data/corpus/`, `data/word-images/`, credentials, and any wanted downloads separately.
Include any retained raw/sample inputs and legacy user database when backing up
global/user data, respectively. With Tigris, back up or retain/version the bucket's
audio objects separately; a volume backup does not contain remote audio bytes.
User databases, sidecars, image files and corpus data are Git-ignored.
Unfinished image requests, generated-but-unsaved retry bytes, unsaved form drafts,
current playback position, randomly activated fonts, UI navigation/collapse state,
active profile session and in-memory export artifacts are not durable storage.
## Artifact and container builds

From the repository root, install dependencies and produce all artifacts:

```bash
npm --prefix upa ci
./ci-cd/make-artifacts.sh
```

The script resolves paths from its own location, so it also works from another
working directory. It runs the existing `npm run build` without installing
dependencies or reading `fly.toml`. Outputs stay in the already-ignored
`upa/dist/client/` and `upa/dist/server/`. The frontend, backend, and availability
worker are always built together; worker activation is a runtime setting.

Image and artifact versions are independent, initially `0.0.1-initial`:

| Component | Version source | Packaged metadata |
|---|---|---|
| Image | `ci-cd/Containerfile` | OCI label `org.opencontainers.image.version` |
| Frontend | `upa/frontend/version.json` | `upa/dist/client/version.json` |
| Backend | `upa/server/version.json` | `upa/dist/server/version.json` |
| Worker | `upa/server/availability-worker.version.json` | `upa/dist/server/availability-worker.version.json` |

The npm post-build hooks copy each artifact's own version metadata into its
output, including when building the client or server separately. The workspace
`package.json` version is not an artifact release version. Update only the
affected artifact's source file when its version changes; the image label is
maintained separately in the Containerfile.

Build the single deployment image using the repository root as the context:

```bash
docker build -f ci-cd/Containerfile -t telugu-now:0.0.1-initial .
```

Docker tags are supplied by the build/publish command, not set by a Dockerfile
label. Use the image's version for the release tag; artifact versions may differ.

The multi-stage `Containerfile` uses Node 22 on Debian Bookworm for both dependency
installation and runtime, keeping the native SQLite module compatible. It caches
dependency installation separately, calls `ci-cd/make-artifacts.sh`, and copies
only the artifacts, application package metadata, and production dependencies
into the final image. Build tools, test sources, and the local controller are
not shipped. `.dockerignore` restricts the context to build inputs and excludes
local data, credentials, dependencies, and prior build output. Neither Git
cloning nor build-time corpus access or runtime secrets are required.

The container entrypoint, `ci-cd/container-scripts/entrypoint.sh`, starts as root
after the volume is mounted. It creates `DATA_DIRECTORY` (default `/data`) and
its `corpus/`, `user/`, and `word-images/` directories and assigns just those
directories to `node:node`. It then uses `gosu` to recheck access as the
unprivileged `node` user (UID/GID 1000) and execute `node dist/server/index.js`
from `/app/upa`. The backend and worker run non-root and serve port 8080.

Initialization is idempotent, does not recursively change existing files or
subdirectories, and fails explicitly for empty/root paths, symbolic links in
managed paths, non-directory entries, or permission errors. Existing restored
files and custom nested paths must already have suitable permissions. Starting
with an explicit non-root container user skips ownership changes and requires
that user to be able to create/access the managed directories. No corpus,
availability database, user records, word images, or credentials are baked into
the image. Without runtime overrides, the application uses local mode and
requires a compatible prepared corpus and availability snapshot.

## Fly configuration
The repository-root `fly.toml` configures `telugu-now` for Tigris audio, SQLite
under `/data/corpus/`, user data under `/data/user/`, and shared images under
`/data/word-images/`. It specifies one shared CPU with 1 GB RAM, HTTPS, and an
API health check with Fly's maximum one-minute startup grace period. The initial
corpus download may take longer; allow a longer deployment wait timeout, such as
`--wait-timeout 5m`, when deploying. Autostop is disabled to avoid
traffic-driven startup rebuilds.
This deployment explicitly sets `CORPUS_AVAILABILITY_WORKER_ENABLED=false`
and `CORPUS_AVAILABILITY_REBUILD_ON_STARTUP=true`. Startup rebuilds
`availability.sqlite` from the Tigris inventory before serving, without a
background availability worker. Existing corpus and user databases are reused.
This scan repeats on each application startup while the rebuild flag is enabled.

Deploy manually from Codespaces after merging to `main` by running
`ci-cd/deploy.sh deploy`, using the `FLY_API_TOKEN` Codespaces secret.
The GitHub deployment workflow is disabled scaffolding only; merges do not deploy.
The same script supports `stop`;
interrupt local deployment with Ctrl+C. `cancel RUN_ID` remains available for
legacy GitHub deployment runs. See the
[deployment guide](../ci-cd/deployingtofly.md) for authentication and cancellation limits.

Fly's `[build]` section selects `ci-cd/Containerfile`; `fly.toml` is deployment
configuration and is not copied into the image. The selected primary region is
`iad` (Ashburn, Virginia), with a 3 GB `telugu_now_data` volume mounted at `/data`.
`initial_size` sets the size if deployment needs to create a volume; it does not
resize existing storage. Before deployment, ensure the volume exists in `iad`;
the entrypoint initializes its top-level application directories at startup.
Restored files must already be accessible to UID/GID 1000. Billing links and storage costs are in
[costs.md](../costs.md). Start with
one application Machine: these SQLite databases and images are not replicated
across Machines. Setting the TOML does not provision anything or deploy the app.

Supply `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` through Fly secrets
(and `AWS_SESSION_TOKEN` only when using temporary credentials). Use credentials
with bucket-list access for `corpus/objects/` and read access to the corpus SQLite
and audio objects; the runtime does not require write access. Do not put
credentials in `fly.toml`, build arguments, or the container image. Backend,
paths, bucket, endpoint, region, and refresh delay are non-secret `[env]` settings;
avoid conflicting same-name Fly secrets, which override `[env]`.

For image generation, supply the lowercase `pollinations_api_key` through a
same-name Fly secret. `readPollinationsKey` reads the server environment first,
with the root `env` file retained only as a local fallback. Do not package the
local credential file.

## Environment defaults
See `.env.example`.
```text
DATA_DIRECTORY=<repository-root>/data
DATABASE_PATH=<DATA_DIRECTORY>/user/users.sqlite
CORPUS_DATABASE_PATH=<DATA_DIRECTORY>/corpus/corpus.sqlite
CORPUS_AVAILABILITY_PATH=<DATA_DIRECTORY>/corpus/availability.sqlite
CORPUS_OBJECTS_PATH=<DATA_DIRECTORY>/corpus/objects
CORPUS_BACKEND=local
CORPUS_AVAILABILITY_WORKER_ENABLED=false
CORPUS_AVAILABILITY_REBUILD_ON_STARTUP=false
CORPUS_AVAILABILITY_REFRESH_MS=7200000
CORPUS_OBJECTS_PREFIX=corpus/objects/
AWS_REGION=auto
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