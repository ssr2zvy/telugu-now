Implementation Iteration 2
Foundation: Implementation Iteration 1 is accepted and frozen. Its profile persistence, history, timing, future-observation queue, continuous one-for-one replenishment, sequential preparation, SQLite persistence, caching boundary, and source-adapter boundary remain unchanged except where explicitly altered below.
Implements original concepts: Points 3, 4, 7, and 12.
Still mocked: Actual external datasets and their network APIs.
Mock latency: 1–15 seconds for an actual uncached dummy-source retrieval.
 Note: we will also be renaming control-project.sh to control.sh in this iteration 
⸻
 
2.1 — Fixed dummy data sources
	•	Iteration 2 contains exactly three dummy sources:
	•	source1
	•	source2
	•	source3
	•	The dummy datasets are literal deterministic files committed to the repository.
	•	They are temporary Iteration 2 data and may later be removed when real source implementations replace them.
	•	The datasets contain:
	•	source1: 12 rows
	•	source2: 24 rows
	•	source3: 36 rows
	•	Every row contains:
	•	a stable source-row key;
	•	a fixed Telugu sentence.
	•	The mock sentences may contain up to approximately six words. This is only a characteristic of the dummy data and is not a restriction of the complexity system.
	•	The dummy sources should deliberately have different distributions of sentence lengths so that global-complexity behavior can be meaningfully observed.
	•	Fetching the same source-row key always returns the same underlying source record.
	•	Previously selected or previously displayed rows remain selectable.
 
⸻
 
Selection catalogs and global complexity reference
2.2 — Lightweight source selection catalog
Each source exposes a lightweight selection catalog through its source implementation.
For every selectable row, the catalog contains at minimum:
	•	source ID;
	•	stable source-row key;
	•	intrinsic complexity measurement.
For Iteration 2, the intrinsic complexity measurement is:
word count of the Telugu text
Word count is an internal measurement. The user does not configure preferred word counts.
The selection catalog exists separately from fully retrieving the source record.
Conceptually:
selection catalog
    ↓
choose source/row
    ↓
source adapter
    ↓
retrieve full selected record if necessary
Future real sources may build this catalog from manifests, metadata APIs, Parquet columns, TSV/JSONL metadata, or another source-specific mechanism.
 
⸻
 
2.3 — Global complexity reference population
Complexity is calibrated against one global reference population shared by all sources.
For Iteration 2:
all selectable rows from source1
+
all selectable rows from source2
+
all selectable rows from source3
form the global complexity reference.
Every source row contributes exactly once.
Profile source weights do not affect this reference population.
Therefore changing:
source1 weight
source2 weight
source3 weight
does not change what a 70th-percentile complexity means.
The reference is versioned:
complexity_reference_version = 1
If the reference population changes materially later, a new version is created rather than silently redefining the existing percentile scale.
 
⸻
 
2.4 — Global percentile intervals
Because word count is discrete, many rows may share exactly the same intrinsic complexity.
For each distinct word count k:
	•	n_k = global number of rows having exactly k words;
	•	N = total number of rows in the global reference;
	•	n_{<k} = global number of rows having fewer than k words.
Define:
a_k=\frac{n_{<k}}{N}
b_k=\frac{n_{<k}+n_k}{N}
The intrinsic complexity value k therefore occupies:
\boxed{I_k=[a_k,b_k]}
on the global percentile scale.
For example, if:
43% of global rows contain fewer than 10 words
8% contain exactly 10 words
then:
10-word rows occupy global percentile interval 43%–51%
This prevents tied rows from being given arbitrary individual percentile ranks.
 
⸻
 
Source selection
2.5 — Profile source weights
Every source has one profile-specific weight:
0\le w_i\le1
At least one configured source must have weight exactly:
1
Therefore:
\boxed{\max_i(w_i)=1}
Rules:
	•	0 gives a source zero selection probability.
	•	Multiple sources may equal 1.
	•	All weights below 1 is invalid.
	•	Invalid configurations are rejected rather than silently normalized.
This gives one canonical representation for each relative source preference.
 
⸻
 
2.6 — Exact source-selection formula
For each source S_i:
	•	N_i = number of selectable source rows;
	•	w_i = profile source weight.
Source mass:
M_i=N_iw_i
Source-selection probability:
\boxed{ P(S_i)= \frac{N_iw_i} {\sum_jN_jw_j} }
If all weights equal 1:
P(S_i)=\frac{N_i}{\sum_jN_j}
Source complexity distributions do not alter source-selection probability.
The two controls remain conceptually separate:
source weights
    ↓
choose source

global complexity preference
    ↓
choose row from that source
 
⸻
 
Global complexity preference
2.7 — Profile complexity settings
Each profile has exactly two complexity settings:
complexity_percentile_target
complexity_percentile_spread
Both operate on the global percentile scale, not a source-specific percentile scale and not an absolute word-count scale.
Target
\boxed{0\le T\le1}
Example:
T = 0.70
means:
Center the desired complexity distribution around the global 70th percentile.
Spread
The profile also stores:
\boxed{R>0}
in percentile units.
For example:
T = 0.70
R = 0.15
defines a reference interval:
55th percentile ← 70th percentile → 85th percentile
 
⸻
 
2.8 — Normal complexity preference
The desired complexity preference is represented by a normal distribution over the global percentile coordinate.
The configured spread R is defined as the half-width corresponding to the central 98% reference interval of the underlying normal distribution.
Therefore:
\boxed{ \sigma=\frac{R}{2.326347874} }
The underlying normal has:
\mu=T
and:
\sigma=\frac{R}{2.326347874}
The percentile target and spread therefore completely define the complexity preference.
There is no additional configurable complexity-strength parameter.
 
⸻
 
2.9 — Percentile-domain boundaries
The actual percentile domain is:
[0,1]
A normal distribution centered near either end may mathematically extend outside this interval.
Iteration 2 therefore uses the desired normal distribution truncated and renormalized to [0,1].
Define:
Z= \Phi\left(\frac{1-T}{\sigma}\right) - \Phi\left(\frac{-T}{\sigma}\right)
where \Phi is the standard-normal CDF.
This allows, for example:
target = 0.95
spread = 0.15
without prohibiting a preference near the extreme end of the global complexity spectrum.
 
⸻
 
2.10 — Complexity mass for a percentile interval
For word-count value k, whose global percentile interval is:
[a_k,b_k]
the desired probability mass assigned to that complete tied interval is:
\boxed{ G_k= \frac{ \Phi\left(\frac{b_k-T}{\sigma}\right) - \Phi\left(\frac{a_k-T}{\sigma}\right) }{ Z } }
There are:
	•	no short/medium/long buckets;
	•	no hard complexity thresholds;
	•	no configured target word count.
The user’s normal-shaped preference simply overlaps different portions of the global empirical complexity distribution.
 
⸻
 
2.11 — Per-row global complexity mass
If n_k global rows have complexity value k, each tied row receives:
\boxed{ m_k=\frac{G_k}{n_k} }
This prevents a sentence length from becoming more desirable merely because that sentence length happens to be very common in the source corpora.
 
⸻
 
Row selection within selected source
2.12 — Selected-source normalization
Once source S_i has been selected, its rows inherit their globally calibrated per-row complexity masses.
Let:
	•	N_{i,k} = number of rows in source i having word count k;
	•	m_k = global per-row complexity mass.
Define:
D_i= \sum_kN_{i,k}m_k
Then a particular source row r having intrinsic complexity k(r) receives:
\boxed{ P(r\mid S_i)= \frac{m_{k(r)}}{D_i} }
This is the exact conditional probability of selecting that row once its source has already been chosen.
 
⸻
 
2.13 — Efficient row selection
The application does not need to loop through every individual source row on every acquisition.
The probability of selecting intrinsic-complexity class k from selected source S_i is:
\boxed{ P(k\mid S_i)= \frac{N_{i,k}m_k}{D_i} }
Therefore selection may proceed as:
choose source
    ↓
choose intrinsic complexity value
    ↓
uniformly choose one source row
having that value
This yields exactly the same per-row distribution as assigning probabilities individually to every row.
 
⸻
 
2.14 — Overall row probability
The probability of the complete source+row selection event is:
\boxed{ P(r)=P(S_i)P(r\mid S_i) }
The implementation and diagnostics keep separate:
source probability

row probability given selected source

overall source+row probability
 
⸻
 
Independent selection behavior
2.15 — Independent acquisition events
Every acquisition event is independent.
Previously selected rows:
	•	remain eligible;
	•	retain their normal probability;
	•	may be selected again.
No without-replacement logic is introduced.
 
⸻
 
2.16 — Source record vs acquisition
A stable:
SourceRecord
is distinct from an:
Acquisition
Example:
source2 / row17
identifies one stable source record.
If it is selected three different times, there are three distinct acquisitions referring to the same source record.
Each acquisition keeps its own:
	•	acquisition number;
	•	trigger metadata;
	•	source weights used;
	•	complexity settings used;
	•	complexity-reference version;
	•	exact probabilities;
	•	history/queue relationship.
 
⸻
 
Source retrieval and caching
2.17 — Source-record cache
After selecting a source and row, the app checks whether that stable source record has already been fully retrieved and normalized.
Cache identity is:
source_id + source_row_key
If uncached:
	•	source adapter retrieves it;
	•	dummy source applies its artificial delay;
	•	source row is normalized;
	•	normalized record is cached persistently.
If cached:
	•	cached normalized record is reused;
	•	dummy source is not called;
	•	artificial delay is skipped.
A repeated selection remains a new acquisition even when its source record is served from cache.
 
⸻
 
2.18 — Dummy-source latency
Every actual uncached dummy retrieval waits an independently generated random duration between:
1 second
and:
15 seconds
before returning the stable source record.
Cache hits have no artificial delay.
The Iteration 1 live queue continues to prepare at most one unresolved source record at a time.
 
⸻
 
Profile settings
2.19 — Application defaults
Application defaults exist for:
	•	source1 weight;
	•	source2 weight;
	•	source3 weight;
	•	global complexity percentile target;
	•	global complexity percentile spread.
Iteration 2 defaults:
source1 = 1.0
source2 = 1.0
source3 = 1.0

complexity target = 0.50
complexity spread = 0.25
 
⸻
 
2.20 — Profile-specific settings
Selection settings are stored persistently per profile in SQLite.
Profile settings override application defaults.
Changing them requires:
	•	no recompilation;
	•	no redeployment;
	•	no application restart.
 
⸻
 
2.21 — Effect of settings changes
Saved changes apply only to selections made after the save completes.
They do not modify:
	•	history;
	•	previously selected acquisitions;
	•	the existing unseen queue;
	•	currently preparing observations;
	•	already-pending preparation work.
The existing future queue is not discarded or resampled.
 
⸻
 
Acquisition snapshot
2.22 — Persist selection conditions
Every normal profile acquisition stores the exact conditions under which it was selected.
Source information
	•	source ID;
	•	source row count;
	•	source weight;
	•	source mass;
	•	total source mass;
	•	source probability.
Complexity information
	•	complexity-reference version;
	•	complexity target;
	•	complexity spread;
	•	derived standard deviation;
	•	selected row word count;
	•	global percentile interval;
	•	global interval mass;
	•	number of global rows tied at that complexity;
	•	global per-row complexity mass;
	•	number of selected-source rows at that complexity;
	•	selected-source normalization denominator;
	•	row probability given source.
Combined selection
	•	overall source+row probability.
These are persisted snapshots and are never retrospectively recalculated using new settings.
 
⸻
 
2.23 — Existing Iteration 1 diagnostics
The following remain:
	•	acquisition number;
	•	initial-fill vs consumption-triggered replacement;
	•	triggering acquisition/history position;
	•	trigger time;
	•	jobs waiting ahead;
	•	preparation already in flight;
	•	request start;
	•	request end;
	•	request duration.
 
⸻
 
Observation-screen controls
2.24 — Hidden controls by default
On the normal observation screen:
	•	Back arrow is hidden;
	•	Next arrow is hidden;
	•	Settings icon is hidden.
The Telugu observation remains visually central.
 
⸻
 
2.25 — Single-tap control toggle
Single-tapping the ordinary observation surface toggles controls.
hidden
  ↓ tap
visible
  ↓ tap
hidden
Clicks/taps on actual controls do not count as background taps.
 
⸻
 
2.26 — Revealed controls
When revealed:
	•	Back appears on the left when available;
	•	Next appears on the right when available;
	•	Settings icon appears in the upper-right.
Iteration 1 navigation availability remains authoritative.
 
⸻
 
2.27 — Navigation hides controls
Selecting Back or Next performs the action.
After successful navigation:
controls hidden
The new observation must be tapped again to reveal controls.
 
⸻
 
Settings modal
2.28 — Opening Settings
The Settings icon appears only while controls are visible.
Opening it:
	•	does not navigate;
	•	does not consume an observation;
	•	does not create a replacement;
	•	does not toggle controls away before the modal opens.
 
⸻
 
2.29 — Modal structure
Settings contains exactly four collapsible sections:
	1.	Complexity
	2.	Source weights
	3.	Diagnostic
	4.	Export
All four begin collapsed whenever the Settings modal is newly opened.
Sections expand/collapse independently.
Interactions within the modal do not propagate to the observation-screen tap handler.
 
⸻
 
2.30 — Complexity settings section
The Complexity section exposes:
global complexity percentile target
global complexity percentile spread
These may be displayed as percentages.
Example:
target 70%
spread 15%
Internally:
0.70
0.15
The backend remains authoritative for validation.
 
⸻
 
2.31 — Source-weight settings section
Source Weights exposes:
1
2
3
for the three dummy sources.
Every weight must satisfy:
0\le w_i\le1
and the complete configuration must satisfy:
\max_i(w_i)=1
Invalid settings cannot be saved.
 
⸻
 
2.32 — Saving settings
Complexity and source weights are persisted as one profile-settings update.
A successful save affects only future selections.
Existing selected observations are untouched.
Closing without saving leaves persisted settings unchanged.
 
⸻
 
Diagnostic section
2.33 — Current Diagnostic
The Diagnostic collapsed section displays the complete persisted selection snapshot for the currently displayed acquisition.
It includes the existing Iteration 1 diagnostic plus:
	•	selected source;
	•	source weight;
	•	source probability;
	•	selected row key;
	•	intrinsic word count;
	•	global percentile interval;
	•	complexity target;
	•	complexity spread;
	•	complexity-reference version;
	•	row probability within source;
	•	overall row probability;
	•	cache-hit status.
The diagnostic is development instrumentation and may remain English.
 
⸻
 
Export
2.34 — Purpose of Export
Export does not export history.
Instead, Export generates a new standalone batch of future-style observations using the same source-selection and complexity-selection logic used by normal acquisitions.
The user chooses how many new selections should be generated.
This allows:
Generate N observations
without requiring the user to press Next N times.
 
⸻
 
2.35 — Export count
The Export section contains:
	•	one positive-integer input;
	•	one Download action.
The entered number N means:
Generate exactly N independent new source+row selections according to the profile’s current selection settings.
The implementation may define a reasonable maximum export size to protect the application from accidental extremely large requests.
 
⸻
 
2.36 — Export settings snapshot
When Export begins, the application takes one immutable snapshot of:
	•	current source weights;
	•	complexity percentile target;
	•	complexity percentile spread;
	•	complexity-reference version.
All N export selections use that snapshot.
If the user subsequently changes settings while export generation is occurring, the in-progress export does not change.
 
⸻
 
2.37 — Export selection algorithm
For each of the N export entries:
	1.	perform the exact source-selection algorithm defined in 2.6;
	2.	perform the exact global-complexity row-selection algorithm defined in 2.10–2.13;
	3.	permit repeated source rows;
	4.	record the complete probability snapshot for that selection.
Each exported selection is independent.
Therefore an export of:
N = 100
is mathematically equivalent to performing 100 independent future selection events under the same saved settings snapshot.
 
⸻
 
2.38 — Export bypasses normal Next triggers
Export selections are not produced by repeatedly invoking the normal Next/replenishment lifecycle.
They therefore do not:
	•	consume the current observation;
	•	advance the profile history cursor;
	•	append to profile history;
	•	remove observations from the live unseen queue;
	•	create one-for-one live replacement acquisitions;
	•	alter the current live queue;
	•	alter timing;
	•	trigger history-navigation behavior.
Export invokes the selection engine directly for N independent batch selections.
 
⸻
 
2.39 — Export is separate from live acquisitions
Export entries are not normal profile acquisitions.
They therefore do not consume the profile’s normal acquisition-number sequence.
Each exported item instead has:
export position 1..N
plus its source/row/probability snapshot.
This keeps:
normal app progression
and:
offline batch generation
semantically separate.
 
⸻
 
2.40 — Export source-record resolution
After each export source/row pair has been selected, its source record must be available so its Telugu content can be embedded into the exported file.
The normal persistent source-record cache is reused.
If the selected source record is cached:
	•	use the cached normalized record.
If uncached:
	•	resolve it through the same source adapter;
	•	the Iteration 2 dummy source applies its 1–15-second latency;
	•	cache the resulting stable source record.
Using Export may therefore populate the shared source-record cache.
It does not modify profile history or the live future queue.
 
⸻
 
2.41 — Export preparation order
For Iteration 2, export source-record resolution remains sequential.
If an export contains multiple uncached source records, they are resolved one at a time.
Duplicate rows within the same export can reuse the source-record cache after the first successful retrieval.
The export UI should communicate that generation is still in progress and prevent duplicate submission of the same export action while it is running.
 
⸻
 
2.42 — Export diagnostics
Every exported entry contains its own export-time selection snapshot, including:
	•	export position;
	•	selected source;
	•	selected source probability;
	•	source weight;
	•	selected row key;
	•	intrinsic complexity;
	•	global percentile interval;
	•	target;
	•	spread;
	•	row probability within selected source;
	•	overall row probability;
	•	cache-hit status.
Normal live acquisition trigger information such as:
triggered by acquisition #...
waiting ahead...
does not apply to export entries and should not be fabricated.
 
⸻
 
2.43 — Self-contained HTML/JavaScript export
After all N exported observations have been selected and resolved, the browser generates one standalone .html file.
The file contains:
	•	all N selected Telugu observations;
	•	their export-time diagnostic snapshots;
	•	inline JavaScript;
	•	inline CSS.
It requires:
	•	no application server;
	•	no SQLite;
	•	no Node.js;
	•	no API requests;
	•	no external JavaScript libraries.
The browser can generate the downloadable file using an in-memory Blob/object URL; browsers support blob URLs for locally generated downloads. 
 
⸻
 
2.44 — Export viewer behavior
The standalone file displays one exported observation at a time.
At minimum it supports:
	•	moving backward through the exported sequence;
	•	moving forward through the exported sequence;
	•	viewing the diagnostic snapshot for the displayed export entry.
The exported viewer cannot move outside its generated N entries.
It has no connection to the live application’s profile.
 
⸻
 
Iteration 1 queue invariants
2.45 — Live future queue remains unchanged
The live profile still targets:
10 selected unseen observations
Each first-time live consumption atomically creates one replacement acquisition.
Export does not contribute toward these ten slots.
Export does not consume these ten slots.
 
⸻
 
2.46 — Live sequential preparation remains unchanged
Normal profile preparation continues to process unresolved live source records one at a time.
Export is a separate batch-generation operation and must not alter live queue ordering.
 
⸻
 
2.47 — Live queue order remains authoritative
Once a normal acquisition has entered the live future queue:
	•	settings changes cannot move it;
	•	Export cannot move it;
	•	later selections cannot overtake it;
	•	cache-hit speed cannot move it;
	•	latency cannot reorder it.
 
⸻
 
Complexity-reference stability
2.48 — Reference versioning
Every live acquisition and every export selection records:
complexity_reference_version
Changing:
	•	source weights;
	•	target;
	•	spread;
does not change the reference version.
Changing the global reference population does.
 
⸻
 
Iteration 2 completion criteria
Iteration 2 is complete when all of the following are demonstrated:
	•	three deterministic dummy sources exist;
	•	each row has a stable source key;
	•	lightweight selection catalogs exist;
	•	intrinsic word counts are calculated deterministically;
	•	one global complexity reference is constructed from all three sources;
	•	tied intrinsic complexity values receive correct percentile intervals;
	•	source selection follows the exact canonical source-weight formula;
	•	source weights are profile-editable;
	•	invalid source-weight configurations are rejected;
	•	profile complexity target and spread are editable;
	•	target/spread define the globally calibrated truncated-normal preference;
	•	row probabilities are correctly normalized inside the selected source;
	•	source probability, row conditional probability, and overall probability are persisted;
	•	normal acquisitions retain complete immutable selection snapshots;
	•	repeated rows remain legal independent selections;
	•	stable source-record caching works;
	•	uncached dummy retrievals wait 1–15 seconds;
	•	cache hits skip artificial latency;
	•	single-tapping the observation reveals Back/Next/Settings;
	•	tapping again hides controls;
	•	navigation hides controls after success;
	•	Settings has four initially collapsed sections;
	•	Complexity settings work;
	•	Source Weight settings work;
	•	Current Diagnostic exposes the complete current acquisition snapshot;
	•	Export accepts a positive integer N;
	•	Export generates exactly N fresh independent selections using current source and complexity logic;
	•	Export does not consume history or the live queue;
	•	Export does not invoke normal one-for-one replenishment triggers;
	•	Export snapshots its settings once at generation start;
	•	Export resolves/cache-fetches the selected source records;
	•	Export produces one self-contained client-side HTML file containing those N newly generated observations;
	•	the standalone exported viewer works without the original application/server;
	•	all validated Iteration 1 timing, history, persistent queue, and replenishment behavior remains unchanged.

Implementation 2 Alteration
	•	2.49 Settings control position Move the Settings control on the observation page from the upper-right to the bottom-right. Its interaction semantics remain unchanged: it is hidden by default, appears together with Back and Next after a single tap on the ordinary observation surface, and hides again after successful navigation or another background tap.
	•	2.50 Monochrome Settings and language controls The Settings icon and Settings-language icon must be monochrome grey controls, visually consistent with the Back/Next arrows and the rest of the interface. Do not use platform emoji glyphs such as ⚙ or 🌐, because their rendering and color vary by platform. Use application-controlled SVG/CSS icons that inherit the interface color through currentColor. The Settings icon remains bottom-right on the observation page; the language control remains bottom-right throughout the Settings hierarchy.
	•	2.51 Stable profile-code entry position while the software keyboard is open The initial three-digit profile-code input must remain at the same physical position on screen when it receives focus and the software keyboard opens. The entry screen must not recenter, shrink, jump upward, or otherwise reposition the input in response to changes in the mobile visual viewport. The initial bar’s position is determined from the normal full application viewport and remains visually fixed for that entry session while the keyboard is shown.
	•	2.52 Observation font size is derived from observation length Observation text size must automatically vary according to the amount of displayed text. Short observations should appear substantially larger, while progressively longer observations should use progressively smaller text. The sizing function should be continuous or sufficiently fine-grained rather than relying on a small number of arbitrary sentence-length buckets.
	•	2.53 Final font size must account for the selected font’s actual rendered dimensions Character/word length alone is only the initial sizing signal because different Telugu fonts can have materially different glyph widths and line heights. After choosing the desired size from observation length, the application must ensure that the actual text rendered in the selected font fits comfortably inside the observation area. If necessary, reduce the size until the observation fits without clipping or inappropriate overflow. Font fitting must not alter the underlying observation or selection data.
	•	2.54 Random observation font selection Each time an observation becomes the actively displayed observation, randomly choose its font from a fixed, curated, application-controlled Telugu font collection. Font selection is purely presentational and has no effect on source selection, complexity selection, acquisition identity, source-record identity, queue ordering, caching, probability snapshots, timing, or history semantics. Repeated selections of the same source row and repeated views of the same acquisition may therefore use different fonts.
	•	2.55 Font selection is activation-time presentation state, not persisted acquisition state The randomly selected font is not stored with the acquisition or history entry. Navigating away from an observation and later returning to it performs a new font selection. For example: Observation A
	•	→ Mandali
	•	
	•	Next → Observation B
	•	→ Peddana
	•	
	•	Back → Observation A
	•	→ Noto Serif Telugu
	•	
	•	Next → Observation B
	•	→ Ramabhadra History therefore preserves the observation and its timing, not the typography used during a particular viewing. 
	•	2.56 Random font selection must not occur on ordinary React rerenders “Render-time” font selection means when an observation enters the active displayed state, not every time the React component happens to rerender. Polling, timing refreshes, queue-readiness changes, unrelated state updates, or other rerenders while the same observation remains continuously visible must not change its font. The font stays fixed for that continuous viewing activation and is rerolled only after the observation leaves and later becomes active again.
	•	2.57 Returning from Settings counts as a new observation activation Because Settings is a separate full-page view, opening Settings removes the observation from the active displayed state. Closing Settings and returning to the observation therefore causes a new random font to be selected. For example: Observation A
	•	→ Mandali
	•	→ Settings
	•	→ close Settings
	•	→ Observation A
	•	→ possibly NTR Likewise, restoring an observation after a browser reload or new application session may select a new font. 
	•	2.58 Font-selection and sizing order Whenever an observation becomes active, typography is resolved in this order: observation becomes active
	•	        ↓
	•	randomly choose font
	•	        ↓
	•	derive desired font size from observation length
	•	        ↓
	•	measure/fit the text using that selected font
	•	        ↓
	•	reduce size only if necessary to fit the observation area
	•	        ↓
	•	display This ordering ensures that size fitting reflects the actual metrics of the randomly selected font. 
	•	2.59 Initial Telugu font collection Begin with a deliberately curated collection rather than every available Telugu font: Noto Sans Telugu
	•	Noto Serif Telugu
	•	Mandali
	•	Ramabhadra
	•	NTR
	•	Peddana
	•	Ramaraja
	•	Sree Krushnadevaraya
	•	Suranna
	•	Tenali Ramakrishna The collection should provide meaningful typographic variation while remaining readable enough for normal observation use. Additional fonts may be added later only deliberately rather than by depending on whatever fonts happen to exist on the user’s device. 
	•	2.60 Font assets are application-controlled The production application should bundle/self-host the selected Telugu font assets where their licenses permit it, instead of relying on device-installed fonts or remote font availability. This ensures that a selected font name maps to the same actual font across iOS, Android, desktop browsers, development environments, and other supported application contexts. Font licensing and attribution requirements must be retained with the bundled assets as required by each font’s license.

	•	2.61 Standalone export presentation parity The standalone exported HTML must reproduce the live observation presentation behavior rather than using a separate simplified typography implementation. Exported observations use the same font pool, randomization semantics, preferred-size calculation, font loading, rendered-text measurement, and fit-to-observation-area behavior as observations displayed in the live application.
	•	2.62 Complete ten-font export pool Every standalone export must contain the complete curated Telugu observation-font collection: Noto Sans Telugu
	•	Noto Serif Telugu
	•	Mandali
	•	Ramabhadra
	•	NTR
	•	Peddana
	•	Ramaraja
	•	Sree Krushnadevaraya
	•	Suranna
	•	Tenali Ramakrishna The exported viewer must not use a reduced export-only font subset. Every font variation available to the live observation viewer must also be available to the standalone viewer. 
	•	2.63 Fonts are embedded inside the single exported HTML file All required font binaries must be embedded directly in the generated .html, such as through embedded @font-face declarations backed by WOFF2 data URLs. Opening an export must not depend on Google Fonts, another remote font service, the Telugu fonts installed on the device, the Telugu Now server, or any other file alongside the HTML.
	•	2.64 Export remains completely self-contained and offline The existing one-file export contract remains unchanged. The generated artifact contains: observations
	•	diagnostics
	•	CSS
	•	JavaScript
	•	all ten Telugu fonts inside one .html file. After download it must operate without Node.js, SQLite, the Telugu Now application, APIs, external JavaScript libraries, external stylesheets, or network access. 
	•	2.65 Live application and export use the same font assets The repository should own the canonical font assets used by Telugu Now. The live application should use those application-controlled font binaries rather than independently obtaining equivalent fonts from Google Fonts, and the export generator should embed those same binaries into standalone HTML. This prevents font-version or rendering differences between the live viewer and exported viewer.
	•	2.66 Exported font selection occurs on observation activation Whenever an embedded export observation becomes the active displayed observation, randomly select one of the ten embedded fonts. Font selection is not stored permanently with the export entry. Export entry A
	•	→ random font: Mandali
	•	
	•	Next → entry B
	•	→ random font: Peddana
	•	
	•	Back → entry A
	•	→ random font: Noto Serif Telugu Returning to the same export entry therefore may produce a different font exactly as returning to an observation does in the live application. 
	•	2.67 Ordinary exported-viewer updates do not reroll the font Randomization occurs only when an export entry becomes active. Actions that leave the same observation continuously active must not select another font. This includes opening or closing its Diagnostic view, internal UI updates, font-size fitting, and viewport/layout recalculation.
	•	2.68 Exported font size follows the same length-based presentation rule After the export viewer chooses a font, it must derive the preferred font size using the same continuous observation-length sizing algorithm used by the live application. It must not retain the old fixed clamp(...) export-only font-size behavior or introduce export-specific length buckets.
	•	2.69 Exported text is measured using the selected embedded font The export viewer must wait until the selected embedded font is available before final sizing. It then measures the actual rendered observation and reduces the preferred size only as necessary to fit comfortably inside the available observation area. Different fonts may therefore result in slightly different final sizes for the same observation.
	•	2.70 Exported presentation activation order Every export observation activation follows:
	•	2.71 Export viewport changes refit without rerandomizing If the exported HTML’s available display area changes because of window resizing, mobile browser UI changes, orientation changes, or similar viewport changes, recompute the active observation’s fitted font size using its current selected font. Do not choose a new font merely because the viewport changed.
	•	2.72 Export reopening starts a new presentation session Closing and later reopening the standalone HTML creates a new presentation session. The initially displayed observation may therefore receive a newly randomized font. No presentation-font state needs to persist outside the lifetime of the currently open viewer.
	•	2.73 Shared presentation specification The live viewer and standalone export must derive their presentation behavior from one canonical application definition rather than maintaining independent hard-coded constants. The shared specification must include at least: font collection
	•	font-selection rules
	•	preferred-size formula
	•	minimum and maximum sizing limits
	•	fit behavior/constants The React renderer and standalone inline-JavaScript renderer may have different DOM integration code, but their observable presentation semantics must remain equivalent. 
	•	2.74 Export HTML generation serializes the canonical presentation specification export-html.ts must not independently redefine the font list or typography constants by hand. The export generator should obtain or serialize the same canonical presentation configuration used by the live application so future changes to the font collection or sizing rules cannot silently diverge between live and exported observations.
	•	2.75 Font binaries become repository/application assets The ten selected font binaries must exist as explicit application-owned assets with stable filenames and known versions. Runtime export creation reads those known assets and embeds them into the generated HTML. Export generation must not fetch font files from the internet at generation time.
	•	2.76 Font licensing travels with the implementation Only font versions whose licenses permit application redistribution and embedding may be included. Required license and copyright notices must remain in the repository/distribution and, where required by the applicable font license, travel with or be represented in the generated artifact. Font embedding must not strip legally required notices from the distributed font binaries.
	•	2.77 Larger standalone export size is accepted The standalone HTML may become several megabytes larger because all ten font binaries are embedded. This is an intentional tradeoff in favor of: one file
	•	full ten-font variation
	•	offline operation
	•	deterministic font availability
	•	cross-device portability
	•	live/export presentation parity Iteration 2 does not require font subsetting or reducing the font pool merely to minimize export file size. 
	•	2.78 Browser portability requirement The self-contained export should work in reasonably modern browsers across iOS/iPadOS Safari, Android browsers, current desktop Safari, Chrome, Edge, and Firefox without requiring the selected fonts to be installed on the operating system. The implementation should use broadly supported browser mechanisms such as embedded WOFF2 fonts, ordinary DOM measurement, CSS, and JavaScript rather than introducing a framework or runtime dependency into the exported artifact.

	•	2.79 Export format choice occurs after pressing Export On the Export page, the user first enters the desired positive integer N and presses Export. Pressing Export does not immediately begin source selection. It opens a small transient format-choice modal asking how the completed export should be packaged:
	•	2.80 Format choice modal is an intentional exception to page-based Settings navigation The format chooser is a modal because it represents a short-lived decision required to complete one Export action rather than a navigable application section. It must not introduce another Settings page or alter the page hierarchy. Tapping Cancel closes the chooser and returns to the unchanged Export page without generating selections or modifying export state.
	•	2.81 Format labels describe the supported usage rather than claiming universal platform support The EPUB option should be presented as: EPUB
	•	iPhone / iPad · Apple Books The HTML option should be presented as: HTML
	•	Browser / Desktop Do not label HTML as simply “everything else,” because local HTML scripting behavior varies between platforms. EPUB is the specifically supported offline-interactive iPhone/iPad path through Apple Books. 
	•	2.82 Export format choice must not affect source or row selection EPUB and HTML are presentation/container formats only. The selected format must never be passed into or influence: source selection
	•	complexity selection
	•	source weights
	•	row probability
	•	cache behavior
	•	acquisition probability snapshots
	•	repeat eligibility Given the same random stream and selection settings, choosing EPUB instead of HTML must not alter which observations would be selected. 
	•	2.83 Export generation begins only after a format is chosen The sequence becomes:
	•	2.84 One ExportResponse is the canonical generated export The completed ExportResponse remains the format-independent source of truth for the batch. It contains the selected observations, diagnostics, and immutable export settings snapshot. Packaging must happen downstream from that object:                 ExportResponse
	•	                     │
	•	           ┌─────────┴─────────┐
	•	           ↓                   ↓
	•	      HTML formatter       EPUB formatter Do not create separate HTML-selection and EPUB-selection workflows. 
	•	2.85 Retain the completed ExportResponse after generation After the N observations have been selected and resolved, retain the raw completed ExportResponse in client state rather than discarding it immediately after creating one artifact. This allows another supported representation of the same batch to be produced later without repeating selection or source retrieval.
	•	2.86 Repackaging the same export never performs another acquisition If a completed batch was originally packaged as EPUB and the user later requests HTML for that same completed batch, or vice versa, the application must reuse the retained ExportResponse. Export 100
	•	→ 100 selections happen once
	•	
	•	EPUB package
	•	→ no additional selection
	•	
	•	HTML package from same batch
	•	→ no additional selection Repackaging must not consume normal acquisition numbers, export positions, history, queue entries, or additional random source/row selections. 
	•	2.87 Prepared-artifact state records the selected format separately from the batch The application should distinguish: generated batch
	•	ExportResponse
	•	
	•	prepared artifact
	•	format + bytes/blob + filename Format is metadata about the artifact, not about the observations themselves. 
	•	2.88 Download remains disabled until packaging is complete After the user selects a format, the Export page enters its generating state. Download remains disabled while: observations are being selected
	•	records are being resolved
	•	fonts/assets are being prepared
	•	chosen container is being packaged Download becomes enabled only when the selected artifact is complete and ready locally. 
	•	2.89 HTML output retains the existing self-contained contract Choosing HTML produces the current standalone browser artifact: telugu-export-N.html It contains: all N observations
	•	diagnostics
	•	inline CSS
	•	inline JavaScript
	•	canonical presentation configuration
	•	all 10 embedded Telugu fonts
	•	font-license notices and requires no network connection after download. 
	•	2.90 EPUB output is a real EPUB 3 package Choosing EPUB produces: telugu-export-N.epub The file must conform to the EPUB 3 container structure rather than merely renaming HTML or ZIP bytes to .epub. 
	•	2.91 EPUB package structure The generated EPUB should contain the standard minimum package plus the Telugu Now viewer:
	•	2.92 EPUB container rules must be respected EPUB packaging must obey EPUB container requirements, including: mimetype file present
	•	mimetype contents exactly application/epub+zip
	•	mimetype stored uncompressed
	•	mimetype placed first in the ZIP package
	•	META-INF/container.xml points to package.opf
	•	package.opf declares every required resource Do not rely on a generic ZIP configuration that accidentally violates these requirements. 
	•	2.93 EPUB scripting is explicitly declared The EPUB package manifest must identify the interactive viewer content as scripted according to EPUB 3 packaging requirements. JavaScript must be packaged locally inside the EPUB; the interactive viewer must not fetch executable code from the network.
	•	2.94 EPUB is specifically tested and supported against Apple Books The Iteration 2 EPUB compatibility target is: Apple Books on iPhone
	•	Apple Books on iPad
	•	Apple Books on macOS where practical The application does not promise equivalent JavaScript behavior in every EPUB reader, Kindle implementation, Android reader, or third-party desktop EPUB application. 
	•	2.95 EPUB remains fully offline after download Once the .epub has been downloaded/opened in Apple Books, its interactive operation must require no connection to: Telugu Now
	•	Fly.io
	•	Codespaces
	•	Google Fonts
	•	APIs
	•	external JavaScript
	•	external CSS
	•	remote media All resources necessary for the exported viewer must exist inside the EPUB package. 
	•	2.96 EPUB contains the same complete ten-font collection The EPUB must package the same exact ten application-controlled WOFF2 font binaries used by the live application and standalone HTML export: Noto Sans Telugu
	•	Noto Serif Telugu
	•	Mandali
	•	Ramabhadra
	•	NTR
	•	Peddana
	•	Ramaraja
	•	Sree Krushnadevaraya
	•	Suranna
	•	Tenali Ramakrishna It must not rely on Apple Books or iOS having any of those fonts installed. 
	•	2.97 EPUB and HTML use the same canonical presentation configuration Both artifact renderers derive presentation constants from the same OBSERVATION_PRESENTATION definition used by the live viewer. Neither formatter may independently redefine: font list
	•	random-selection semantics
	•	font-size formula
	•	min/max sizes
	•	fit iterations
	•	fit reserve
	•	line height This preserves observable parity across live, HTML, and EPUB presentation. 
	•	2.98 Shared standalone viewer behavior HTML and EPUB should share one standalone-viewer implementation wherever possible rather than maintaining two copies of the observation runtime. The preferred conceptual boundary is: canonical presentation.ts
	•	           ↓
	•	standalone viewer runtime
	•	           ↓
	•	     ┌─────┴─────┐
	•	     ↓           ↓
	•	  HTML wrapper  EPUB wrapper Container-specific packaging may differ, but observation behavior must not. 
	•	2.99 EPUB observation activation semantics match live and HTML viewers Every EPUB observation activation performs:
	•	2.100 EPUB navigation rerolls fonts exactly like the live viewer Navigation semantics remain: A
	•	→ random font 1
	•	
	•	Next → B
	•	→ random font 2
	•	
	•	Back → A
	•	→ random font 3 Returning to an already-seen EPUB observation therefore creates a fresh typography activation. 
	•	2.101 EPUB non-navigation UI must not reroll typography Opening or closing Diagnostic, internal state updates, resizing, pagination-layout changes, or other events that leave the same export observation active must retain the current font.
	•	2.102 EPUB viewport/layout changes refit the same active font If Apple Books changes the available viewport because of device rotation or application layout, recompute the fitted size of the current observation while keeping its currently active font:
	•	2.103 Diagnostic presentation parity applies to EPUB EPUB uses the same clean mapping-table diagnostic representation as the live Settings Diagnostic page and standalone HTML viewer. It must not revert to raw JSON, free-form text, or a separate EPUB-specific diagnostic model.
	•	2.104 EPUB data must be immutable within the artifact The EPUB viewer can change transient presentation state such as: current entry
	•	current random font
	•	fitted size
	•	diagnostic visibility but the embedded observations, diagnostics, export positions, and selection snapshots are immutable and must not be rewritten by viewer interaction. 
	•	2.105 EPUB packaging should occur client-side from the completed ExportResponse Iteration 2 should continue treating Export as a client-produced artifact. EPUB generation should package the completed ExportResponse, viewer assets, and local fonts in the browser rather than requiring a new server-side export-storage system.
	•	2.106 EPUB ZIP implementation should use a small deterministic packaging boundary Do not embed ZIP mechanics throughout React components. EPUB creation should live behind a dedicated formatter/packager interface such as: prepareHtmlExport(...)
	•	prepareEpubExport(...) with ZIP/container construction isolated inside the EPUB implementation. If a ZIP library is used, it should be a small maintained dependency capable of controlling compression and entry ordering sufficiently to produce valid EPUB packages. 
	•	2.107 Format modal state belongs to the Export feature The transient state: format chooser open
	•	selected format
	•	generation state
	•	completed ExportResponse
	•	prepared artifact
	•	packaging error belongs to the Export controller/page boundary and must not be added to profile session, observation navigation, selection engine, or global application state. 
	•	2.108 Format modal follows the current Settings language Because Export is part of the Settings hierarchy, the format chooser’s static labels must use the currently selected Settings language. Switching Settings between English and Telugu changes the chooser labels only; it has no effect on the generated data or chosen artifact format.
	•	2.109 Choosing a format does not persist as a profile selection setting EPUB versus HTML is an output preference for a particular export action, not a profile property affecting future acquisitions. Iteration 2 does not store it in the profile selection-settings tables or include it in acquisition probability snapshots.
	•	2.110 Changing the count invalidates both the batch and prepared artifact If the user edits N after an export has completed, the retained ExportResponse and any prepared HTML/EPUB artifact for the old value become stale and Download is disabled until a new Export is performed.
	•	2.111 Saving complexity or source-weight settings invalidates the existing batch/artifact for future Export UI purposes After successfully saving new selection settings, any retained export batch or prepared artifact shown as current in the Export page must be invalidated so it cannot be presented as though it represents the newly saved settings. This does not undo any source-record caching performed by the previous batch.
	•	2.112 Export errors remain isolated from live observation state Failure while creating either HTML or EPUB—including font loading, ZIP packaging, artifact construction, or browser download preparation—must not modify: current observation
	•	history
	•	history cursor
	•	unseen queue
	•	replenishment
	•	acquisition numbering
	•	live preparation ordering
	•	timing
	•	profile selection settings The Export page reports the failure and allows another attempt. 
	•	2.113 Artifact filenames identify their container explicitly Generated filenames should be: telugu-export-N.html
	•	telugu-export-N.epub where N is the number of embedded export entries. No ambiguous generic extension or renamed ZIP should be exposed to the user. 
	•	2.114 Download behavior remains one user-visible artifact After packaging completes, Download transfers exactly one selected artifact to the device. EPUB does not require a companion folder, separate font files, separate JavaScript file, or subsequent network installation. HTML likewise remains one self-contained file.
	•	2.115 EPUB/HTML packaging becomes an explicit tested contract Automated tests must separately verify: one ExportResponse can feed either formatter
	•	format choice never invokes selection itself
	•	HTML remains self-contained
	•	EPUB has a valid container structure
	•	EPUB mimetype is first and uncompressed
	•	package.opf references required resources
	•	scripted viewer is declared
	•	all 10 fonts are packaged
	•	font/license files correspond to repository assets
	•	diagnostics are included
	•	presentation configuration matches live behavior
	•	no runtime network URLs are required
	•	changing format does not change the ExportResponse The EPUB package should also have at least one validation test that opens/parses the generated ZIP structure rather than testing only source-code strings. 
	•	2.116 Manual iOS acceptance criterion Before considering EPUB support complete, perform an actual-device acceptance test: generate EPUB on Telugu Now
	•	↓
	•	download/open it in Apple Books on iPhone
	•	↓
	•	enable airplane mode
	•	↓
	•	completely close and reopen Books
	•	↓
	•	open the EPUB
	•	↓
	•	verify Back / Next
	•	↓
	•	verify random font rerolls
	•	↓
	•	verify all 10 packaged fonts can render
	•	↓
	•	verify length-based sizing and fitting
	•	↓
	•	verify Diagnostic mapping table
	•	↓
	•	rotate device and verify refitting without font reroll Passing desktop EPUB generation alone is not sufficient because Apple Books is the explicit reason this format is being introduced. 

Completion State
The implementation of Iteration 2 is complete as of commit hash: 5f49447c0aed8b32b2648f378ba1bc5b4cb8d2ba
