Implementation iteration 3

	•	3.1 Iteration 3 scope and ordering Iteration 3 addresses the remaining original requirements in the dependency order: first real dataset metadata/catalog analysis
	•	        ↓
	•	generic Media model
	•	        ↓
	•	source-specific parsing/resolution for that dataset
	•	        ↓
	•	repeat the same onboarding process for additional sources
	•	        ↓
	•	Point 11 text + audio experience
	•	        ↓
	•	text + audio behavior carried into export viewers The repository/project folder is now named ti; new documentation, scripts, tests, and generated paths must not introduce the old telugu-iteration2 folder name. 
	•	3.2 Begin with exactly one real dataset Do not attempt to integrate every real source simultaneously. Select one real dataset as the first source and use it to establish the metadata, catalog, media, acquisition, and audio-resolution contracts that later sources will follow.
	•	3.3 First-source metadata inspection precedes runtime integration Before implementing a source adapter for the first real dataset, obtain and inspect only the lightweight metadata/schema information necessary to understand: total row count
	•	row identifier/key
	•	Unicode text column
	•	nullable/missing-row behavior
	•	audio/media-related columns
	•	storage/reference representation
	•	any metadata files required to enumerate/select rows Do not download the full audio corpus merely to build the selection catalog if the source exposes enough metadata separately. 
	•	3.4 Persist a source metadata manifest The first real source gets an application-owned metadata manifest containing at least: source ID
	•	source/dataset version or revision when available
	•	total rows reported by the source
	•	selectable rows
	•	stable row-key field
	•	Unicode text field name
	•	media-related field names
	•	complexity-measure identifier
	•	metadata generation/version information Source-specific schema knowledge belongs to the source boundary rather than being hardcoded into the global selector. 
	•	3.5 Distinguish total rows from selectable rows Metadata analysis must record both: total source rows
	•	selectable source rows Rows may be excluded from the selection catalog if required fields are missing, malformed, unusable, or cannot identify a stable source record. Source probability uses the count of selectable rows, not an assumed raw-file count. 
	•	3.6 Identify the canonical Unicode text field explicitly For the first source, determine the exact metadata column/property containing the Unicode text associated with the observation. Record its literal field name in the source metadata manifest. The selection engine must not guess among possible transcript/text columns.
	•	3.7 Complexity no longer assumes word parsing The generic complexity architecture must not require tokenization or Telugu word segmentation. A source catalog exposes a numeric intrinsic-complexity value derived from its canonical Unicode text field.
	•	3.8 Initial real-source complexity measure is Unicode grapheme length For the first real dataset, use Unicode extended grapheme-cluster count as the initial intrinsic complexity measurement rather than word count. The text is first normalized to Unicode NFC, then segmented into user-perceived grapheme clusters, and the number of grapheme clusters becomes the row’s intrinsic complexity scalar. raw Unicode text
	•	        ↓
	•	NFC normalization
	•	        ↓
	•	Unicode grapheme segmentation
	•	        ↓
	•	grapheme count
	•	        ↓
	•	intrinsic_complexity This avoids needing Telugu-specific word parsing while better representing visible text length than UTF-8 byte count or raw UTF-16 code-unit count. 
	•	3.9 Complexity measurement is versioned The measurement used by the catalog is identified explicitly, for example: unicode_grapheme_count_v1 Changing normalization, segmentation, or the measurement definition requires a new measure/version rather than silently changing previously interpreted values. 
	•	3.10 Selection catalog remains lightweight The first real source gets a selection catalog containing only information required before record acquisition, principally: source row key
	•	intrinsic complexity scalar plus any minimal stable metadata required to locate the row. Full audio bytes and other large media must not be duplicated into the selection catalog. 
	•	3.11 Catalog generation is deterministic Given the same source metadata revision and complexity-measure version, regenerating the catalog must produce the same: selectable row set
	•	row keys
	•	complexity values Catalog generation should be scriptable and testable rather than manually curated. 
	•	3.12 Generate first-source complexity diagnostics before using it live Metadata analysis should produce summary information such as: total rows
	•	selectable rows
	•	missing text rows
	•	minimum grapheme length
	•	maximum grapheme length
	•	mean/median where useful
	•	percentile values
	•	frequency/tie counts so the committee can inspect the real distribution before freezing its complexity-reference behavior. 
	•	3.13 Global complexity engine becomes measurement-agnostic The existing percentile selection mathematics remains, but the selector must operate on a generic numeric intrinsicComplexity rather than a field semantically named wordCount. The engine should not know whether the source value came from:
	•	3.14 Real-source percentile intervals preserve the existing tied-value model For intrinsic-complexity value k: n_k   = global selectable rows with value k
	•	n_<k  = global selectable rows with lower value
	•	N     = total global selectable rows
	•	
	•	a_k = n_<k / N
	•	b_k = (n_<k + n_k) / N All rows sharing the same intrinsic-complexity value share the same global percentile interval exactly as tied word-count rows do today. 
	•	3.15 Existing source-weight independence remains unchanged Replacing mock word count with a real Unicode-length measure must not change the source-weight formula: P(source i)
	•	=
	•	(N_i × w_i)
	•	/
	•	Σ(N_j × w_j) Complexity continues to affect conditional row selection only after the source is selected. 
	•	3.16 Complexity snapshots become generic Acquisition/export diagnostics should replace word-count-specific terminology with generic complexity fields where appropriate: complexity measure ID
	•	intrinsic complexity value
	•	percentile interval
	•	interval mass
	•	global tied-row count
	•	per-row complexity mass
	•	source tied-row count
	•	source normalization denominator
	•	conditional row probability
	•	overall probability A source-specific diagnostic may additionally display a friendly interpretation such as grapheme count. 
	•	3.17 Formalize a generic Media model before implementing audio parsing A normalized observation/source record may contain zero or more media items. Media is represented as a discriminated model supporting: Unicode text
	•	image
	•	audio
	•	video
	•	reference rather than assuming that every observation is one text string. 
	•	3.18 Media items have stable explicit kinds The normalized Media model should conceptually support: TextMedia
	•	ImageMedia
	•	AudioMedia
	•	VideoMedia
	•	MediaReference Global application code branches on the generic media kind, never on source-specific column names. 
	•	3.19 Text media preserves Unicode exactly after source normalization The normalized text media object contains the Unicode string intended for presentation. Source-specific parsing decides which source field supplies it. Complexity metadata is associated with selection/catalog behavior and must not mutate the displayed Unicode text.
	•	3.20 Binary media and references are distinct concepts The Media model distinguishes: already resolved media from: a reference that must be resolved A URL, object-storage key, dataset path, shard identifier, API identifier, archive member, or other locator is not silently treated as audio bytes. 
	•	3.21 MediaReference records what it is expected to resolve into A generic media reference identifies at least: target media kind
	•	source-specific locator/reference data so the source adapter knows whether it is resolving an audio, image, video, or other reference. 
	•	3.22 Source-native data remains behind the source adapter boundary The global app must not know facts such as: "column 7 is audio"
	•	"this URL needs another API call"
	•	"this object key belongs to a shard"
	•	"this blob field contains encoded WAV" Those rules belong entirely to the implementation of that particular source. 
	•	3.23 First-source media-resolution analysis follows metadata analysis After the first source’s metadata/schema is obtained, inspect how its selected row actually identifies the corresponding audio. Determine which concrete case applies, including possibilities such as: direct audio bytes/blob
	•	downloadable URL
	•	authenticated URL
	•	object-storage path/key
	•	local archive member
	•	Parquet binary field
	•	dataset file path
	•	secondary API identifier
	•	manifest indirection
	•	shard + offset
	•	another source-specific mechanism Do not design the resolver around a hypothetical URL until the real dataset representation is known. 
	•	3.24 Record the first source’s acquisition chain explicitly After analysis, document the exact source-specific path: selection row key
	•	        ↓
	•	obtain source-native row
	•	        ↓
	•	identify canonical text field
	•	        ↓
	•	identify audio field/reference
	•	        ↓
	•	perform any required secondary resolution
	•	        ↓
	•	normalize text + audio into Media[] Each network/file operation required by that chain should be explicit. 
	•	3.25 Separate source fetch, parse, and reference resolution conceptually A real source adapter should expose clear responsibilities equivalent to: catalog
	•	    → lightweight selectable rows
	•	
	•	acquire row
	•	    → source-native record
	•	
	•	parse row
	•	    → direct media + unresolved references
	•	
	•	resolve references
	•	    → actual normalized media
	•	
	•	normalize
	•	    → SourceRecord Media[] These may share implementation code internally, but the architectural stages must remain distinguishable. 
	•	3.26 Preserve raw source information where useful Source acquisition should retain enough raw metadata/request information to diagnose parsing/resolution errors without forcing the normalized Media model to contain arbitrary source-native fields.
	•	3.27 SourceRecord becomes the stable resolved-media cache unit The existing shared (source_id, source_row_key) cache remains the stable boundary. Once the first source’s selected row has been fully acquired and its required media resolved, the resulting normalized source record is persisted/reused so later selections of the same source row do not unnecessarily repeat source/API/media-resolution work.
	•	3.28 Media persistence strategy is chosen from real source characteristics Do not prematurely require all audio bytes to live inside SQLite. After analyzing the first source, choose the concrete persistence representation based on: media size
	•	source delivery mechanism
	•	browser/server requirements
	•	export requirements
	•	cache behavior
	•	deployment environment SQLite may store metadata/references while binary media may use an application-controlled file/blob/object representation if that is cleaner. 
	•	3.29 Cached records must be self-consistent A SourceRecord is not considered ready merely because its transcript was parsed. For the Point 11 text+audio experience, readiness means every media item required for that observation’s presentation has been resolved or otherwise made available according to the normalized Media contract.
	•	3.30 Live queue semantics remain unchanged during real-source integration Real source acquisition must preserve the existing: target future queue = 10
	•	fixed queue order
	•	sequential live preparation
	•	one-for-one replenishment
	•	Back/Forward history behavior
	•	timing behavior Source latency or secondary audio resolution must never reorder selected observations. 
	•	3.31 Export and live preparation continue sharing SourceRecord cache If Export resolves the first real source’s audio before live viewing needs it, the live observation should reuse that resolved SourceRecord. If live acquisition resolves it first, Export should reuse it. Media integration must not create separate live/export caches.
	•	3.32 First-source implementation is completed before onboarding the next source The first real source is considered integrated only when the following work as one path:
	•	3.33 Additional sources repeat the same onboarding pipeline Each later source follows: inspect metadata
	•	    ↓
	•	identify total/selectable rows
	•	    ↓
	•	identify row key
	•	    ↓
	•	identify Unicode text field
	•	    ↓
	•	compute compatible intrinsic complexity
	•	    ↓
	•	generate catalog
	•	    ↓
	•	analyze media representation
	•	    ↓
	•	implement source-specific parser/resolver
	•	    ↓
	•	normalize into the same Media model
	•	    ↓
	•	validate/cache/test New sources must not require changes to the global selection or observation architecture merely because their raw schemas differ. 
	•	3.34 Cross-source complexity requires a compatible measurement domain Sources participating in one global percentile reference must expose complexity values with the same semantic measurement definition/version. For the initial text-based sources, prefer the shared unicode_grapheme_count_v1 measure when they all provide Unicode transcript text. A source requiring a fundamentally different complexity measure must not be silently pooled into the same reference.
	•	3.35 Adding a source changes the complexity-reference version Once additional real sources are added to the globally pooled population, regenerate the global reference and increment its version. Existing acquisition/export snapshots retain the reference version under which they were selected.
	•	3.36 Remove mock sources only deliberately Real-source onboarding must not accidentally change or remove the existing deterministic mock fixtures/tests. Mocks remain useful for fast deterministic testing until the committee explicitly retires them from runtime configuration.
	•	3.37 Point 11 begins only after normalized text+audio exists The precision audio UI should not be built against fake source-specific structures. Begin Point 11 once at least the first real source reliably produces: TextMedia
	•	+
	•	AudioMedia through the generic Media and SourceRecord pipeline. 
	•	3.38 Initial observation renderer supports text plus audio Although the Media model permits text, image, audio, video, and reference, Iteration 3’s user-facing observation renderer is required to display only: Unicode text
	•	audio Other normalized media kinds may remain unsupported by the UI until later iterations. 
	•	3.39 Existing randomized text presentation remains active with audio Adding audio must preserve the current text behavior: random font on observation activation
	•	all curated Telugu fonts
	•	continuous length-based preferred sizing
	•	fit-to-container measurement
	•	Back/Next reroll behavior
	•	Settings return reroll behavior The audio player is added below the rendered text rather than replacing the existing presentation system. 
	•	3.40 Audio player is a separate observation component Audio behavior should live behind a modular component/service boundary rather than being implemented directly inside the main observation component. Conceptually:
	•	3.41 Use the browser audio engine behind application state Actual playback may use the browser’s native audio element/API internally, but native browser controls are not the product UI. The application owns:
	•	3.42 Audio timeline supports direct seeking The timeline below the rendered text displays playback progress and lets the user directly seek by touching/clicking anywhere on the timeline or dragging its playhead.
	•	3.43 Seek state uses millisecond-scale values Timeline calculations and bookmark positions should be represented at millisecond precision or equivalent fractional-second precision internally. The application must not round user-selected positions to whole seconds. Actual decoder playback may resolve to the nearest timestamp supported by the browser/media encoding.
	•	3.44 Slow dragging activates precision-seek mode During an ordinary timeline drag, detect sufficiently slow/fine pointer movement and immediately enter a precision-seek mode. Precision mode is a product interaction state, not a different audio file or playback mode.
	•	3.45 Precision mode displays a magnified timeline overlay When precision mode activates, display a magnifier overlay centered around the current seek region. The magnifier maps a much smaller time interval onto a much larger visual width, allowing small finger movements to correspond to much smaller time changes.
	•	3.46 Precision magnifier has deterministic time mapping The magnifier must define explicitly: magnified time window
	•	center timestamp
	•	visual width
	•	pointer-to-time mapping
	•	clamping at start/end of audio so seeking behavior is testable rather than depending on ad hoc CSS movement. 
	•	3.47 Precision seek exits predictably Releasing/canceling the pointer commits the selected target time and dismisses the magnifier. Ordinary UI rerenders must not unexpectedly reset an active drag.
	•	3.48 Play/pause is available directly on the audio timeline UI The audio player provides an explicit play/pause control associated with the displayed observation’s audio.
	•	3.49 Playback-speed control supports at least 0.3× The audio player provides a playback-rate control whose supported range reaches at least: 0.3× Slower playback must preserve timeline/bookmark timestamps in source-audio time rather than multiplying stored bookmark positions by playback rate. 
	•	3.50 Playback-rate changes do not change observation timing semantics Changing audio speed affects only audio playback. It does not alter the existing application measurement of how long the observation itself has been visible.
	•	3.51 Bookmark control is positioned at the right end of the timeline The dedicated bookmark control remains visually associated with the audio timeline and has two distinct interactions.
	•	3.52 Double activation creates a bookmark A double click/double tap on the bookmark control stores a bookmark at the current audio timestamp. The stored timestamp uses the same millisecond-scale representation as seeking.
	•	3.53 Single activation jumps to the most recent prior bookmark A single click/tap on the bookmark control seeks to the bookmark with the greatest timestamp strictly before the current audio position. bookmarks: 2.000s, 5.200s, 8.750s
	•	current:   7.100s
	•	
	•	single tap
	•	→ 5.200s If no prior bookmark exists, the control performs no seek. 
	•	3.54 Single versus double bookmark activation must be disambiguated intentionally Implement a short double-activation recognition window so that the first tap of a double tap is not immediately executed as the single-tap “jump backward” action. Pointer/touch behavior must work on iOS as well as mouse-based desktop browsers.
	•	3.55 Bookmark ownership is tied to the viewed acquisition/audio experience Bookmarks represent the user’s interaction with the displayed acquisition’s audio. They must not become global bookmarks shared across unrelated observations merely because two acquisitions happen to refer to the same cached SourceRecord.
	•	3.56 Bookmark persistence is explicit Iteration 3 should persist bookmarks with the user’s observation/acquisition state so navigating away, returning through history, or reopening the profile restores the bookmarks associated with that viewed acquisition.
	•	3.57 Back/Next stops or transitions audio safely Navigating away from an observation must stop playback from the old observation. Audio from an off-screen history entry must never continue playing underneath another observation unless that behavior is explicitly introduced later.
	•	3.58 Returning through history restores audio state conservatively Returning to a prior acquisition restores its audio and persisted bookmarks. Playback itself resumes paused rather than unexpectedly auto-playing. Its last playback position may be restored if persisted by the Point 11 interaction state.
	•	3.59 Settings pauses audio playback Opening full-page Settings stops/pauses the current observation’s audio. Closing Settings returns to the observation without automatically starting audio playback.
	•	3.60 Point 11 controls must coexist with observation navigation reveal behavior The existing: tap ordinary observation surface
	•	→ reveal Back / Next / Settings behavior remains. Interacting with audio controls, timeline, magnifier, speed control, or bookmark control must stop propagation so those interactions do not accidentally hide/reveal observation navigation controls. 
	•	3.61 Audio UI follows the existing visual language The audio player uses the same grey-gradient page and restrained monochrome interface. Normal observation UI remains Telugu-only according to the established product rule. Development diagnostics may continue to expose English when selected through the Settings-language mode.
	•	3.62 Point 11 media state is separate from selection probability state Playback position, bookmarks, speed, and play/pause state must never influence:
	•	3.63 ExportResponse evolves to carry normalized media required by the viewer Export must carry the same normalized text/audio presentation information needed to reconstruct each exported observation without recontacting the original source after the export has completed.
	•	3.64 Export generation resolves required audio before artifact readiness HTML/EPUB Download must not become available until every exported observation’s required text/audio media has been resolved and is available for packaging. An export cannot be marked ready while some audio still requires an external source request.
	•	3.65 Standalone viewers incorporate Point 11 behavior HTML and EPUB viewers must eventually provide the same core exported text/audio experience: rendered randomized-font text
	•	play / pause
	•	normal timeline seeking
	•	precision magnifier seeking
	•	playback speed down to 0.3×
	•	bookmark creation
	•	previous-bookmark jump
	•	Back / Next
	•	Diagnostic Container-specific limitations may require separate acceptance testing, but the application should share viewer logic wherever practical. 
	•	3.66 Exported audio is offline-capable The self-contained/offline export contract means the artifact must contain or package the audio required for its N observations rather than depending on the original dataset URL at viewing time. The exact packing representation is chosen after first-source audio-size and format analysis.
	•	3.67 HTML audio packaging must account for artifact size If HTML remains a single-file artifact, audio may need to be embedded as binary-to-text/data content inside the HTML. Before freezing that representation, measure realistic first-source audio sizes and resulting export growth rather than assuming the existing font-only strategy will scale unchanged.
	•	3.68 EPUB audio packaging uses package resources For EPUB, resolved audio should be included as local EPUB resources and referenced by the viewer rather than base64-duplicated into XHTML/JavaScript when normal EPUB resource packaging is sufficient.
	•	3.69 Standalone viewer code remains shared where behavior is identical Audio interaction logic should follow the same modular principle already used for text presentation: canonical audio interaction model
	•	            ↓
	•	    shared standalone runtime
	•	        ↙             ↘
	•	     HTML            EPUB Do not independently implement different bookmark, magnifier, speed, or seek semantics for each export format. 
	•	3.70 Exported bookmarks are viewer-local unless explicitly imported from live history A newly generated export begins with a defined bookmark state. If Iteration 3 chooses to include existing live acquisition bookmarks for exported history-derived material, that must be explicit; fresh Export selections should not fabricate user bookmarks.
	•	3.71 First-source tests must cover the real metadata contract without requiring full corpus download Add tests or fixtures proving: metadata schema recognized
	•	correct text column used
	•	stable row key extracted
	•	total/selectable row counts calculated
	•	NFC + grapheme complexity calculated correctly
	•	invalid/missing text excluded deterministically
	•	catalog deterministic using a small representative fixture where practical. 
	•	3.72 Unicode complexity tests include Telugu combining sequences Complexity tests must include Telugu strings where: UTF-16 length
	•	Unicode code-point count
	•	grapheme-cluster count differ, proving that unicode_grapheme_count_v1 measures the intended user-perceived text units rather than JavaScript string length. 
	•	3.73 Source-resolution tests mirror the real first-source mechanism Once analysis determines whether first-source audio is a URL, blob, shard, API reference, archive entry, etc., tests should exercise that concrete chain with controlled fixtures/mocks and verify that the final normalized SourceRecord contains correct TextMedia and AudioMedia.
	•	3.74 Media-model tests are source-independent Add contract tests proving that normalized text/audio objects produced by the first source satisfy the same generic Media model that every later source must use.
	•	3.75 Audio-control tests are separated by concern Point 11 tests should independently validate: play/pause state
	•	rate changes
	•	normal seek mapping
	•	slow-drag precision activation
	•	magnifier time mapping
	•	start/end clamping
	•	bookmark double activation
	•	previous-bookmark single activation
	•	bookmark persistence
	•	navigation stops playback
	•	Settings pauses playback rather than relying only on one broad browser interaction test. 
	•	3.76 Export tests expand to text+audio parity HTML/EPUB export tests should verify that packaged observations contain their audio resources, viewer code has no runtime dependency on source APIs, and Point 11 presentation/interaction semantics are represented in the artifact.
	•	3.77 Iteration 3 completion gate for the first real source Before declaring the first-source portion complete, the committee must be able to answer concretely:
	•	3.78 Iteration 3 completion gate for additional sources Each additional source must answer the same questions and produce the same normalized catalog/Media boundaries before being enabled in source weighting. A source is not “integrated” merely because its metadata can be listed.
	•	3.79 Iteration 3 completion gate for Point 11 Point 11 is complete only when at least one real source can be selected through the normal weighted/complexity pipeline and displayed as actual Telugu text plus actual resolved audio with: play/pause
	•	seek
	•	precision magnifier
	•	millisecond-scale target representation
	•	bookmarks
	•	0.3× playback
	•	persistent history/bookmark behavior
	•	navigation safety
	•	Settings safety while preserving all frozen Iteration 1 and Iteration 2 selection, queue, timing, cache, diagnostics, typography, and export semantics. 
	•	3.80 Iteration 3 staged acceptance Implementation should proceed and be reviewed in explicit stages: Stage A
	•	first-source metadata + complexity analysis
	•	
	•	Stage B
	•	generic Media model
	•	
	•	Stage C
	•	first-source parsing/audio-resolution implementation
	•	
	•	Stage D
	•	repeat source onboarding for remaining sources
	•	
	•	Stage E
	•	live Point 11 text+audio experience
	•	
	•	Stage F
	•	HTML/EPUB Point 11 export parity Do not begin later stages by guessing unresolved facts that an earlier dataset-analysis stage is intended to establish. 

ALTERATIONS
we need sliders in settings for overall font size standards
We need option in settings to disable certain fonts like a checkbox where we can uncheck the specific font 
The epub versions should not have the (i) information or settings on it
Add option change the gradient colors and font color and also a option randomize (a separate random button for each of them)
As the user goes next or back the gradient direction between the two colors changes in a non linear way
