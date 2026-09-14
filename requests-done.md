# Implemented requests

Each entry records how a point from `requests.md` was implemented. Points stay
listed in `requests.md`, marked done there rather than removed. Source code only;
tests and Playwright specs are handled in a separate final phase.

## Batch 1

### Reading-page copy and blacklist menu — done

- Desktop right-click on the reading text opens a menu: `onContextMenu` on the
  reader shell in `frontend/src/observation/ObservationView.tsx` calls
  `preventDefault()` and opens `ReaderTextMenu` at the pointer position. Presses
  on buttons, the audio bar, or the word profile are excluded so their own
  context behaviour is untouched.
- Mobile long hold opens the equivalent menu: `useLongPressMenu` in
  `frontend/src/observation/ReaderTextMenu.tsx` (500 ms hold, 10 px move
  tolerance, touch/pen pointers only). It replaces native long-press selection
  rather than preserving it — `@media (hover: none)` in
  `frontend/src/styles/observation-layout.css` sets `user-select: none` and
  `-webkit-touch-callout: none` on `.observation-text`, so the native copy
  callout no longer appears on touch. Desktop selection is unchanged.
  `consumedClick()` swallows the click that follows a completed hold.
- Copy and Blacklist icons with no visible action text: `Copy` and `Ban` lucide
  icons only. Accessible names are given via `aria-label`/`title`
  ("Copy sentence", "Blacklist sentence"); the menu is `role="menu"` with
  `role="menuitem"` actions and an accessible name of "Sentence actions".
- Copy copies the entire displayed sentence: `navigator.clipboard.writeText(observation.text)`,
  not any selected fragment.
- Copying one word from a longer sentence uses the word view: a Copy control was
  added to `frontend/src/observation/word/WordProfile.tsx` header, copying
  `analysis.word`. The word view is still entered by double-click/double-tap on
  the word, per the recorded clarification.
- Settings blacklist listing sentences that must not appear again: new
  `frontend/src/settings/pages/BlacklistPage.tsx`, registered as the
  `blacklist` page in `settings/types.ts`, `settings/navigation.ts`
  (label, `Ban` icon, listed under `index`) and `settings/SettingsView.tsx`.
  It lists every blocked sentence and allows removing entries.
- Blacklisting applies to entire sentences, not words within them: entries are
  keyed by `(profile_code, source_id, source_key)` and carry the full sentence
  text. A word is only ever blocked when it is itself the whole sentence,
  because only whole sentences are ever stored. This is stated in the page's
  description text.
- The menu's Blacklist icon adds the displayed sentence: `addBlacklistEntry` posts
  the current observation's `sourceId`, `sourceKey` and `text`, then advances to
  the next observation.
- Server side (per-profile, server-stored, per the user's answer that a blacklist
  blocks only that user): new `server/src/services/blacklist-service.ts` creates
  `profile_blacklist`, exposes `GET`/`POST`/`DELETE /api/profiles/:code/blacklist`
  with the same origin and profile-code guards as the preferences routes, and is
  mounted in `server/src/app.ts`. `server/src/services/queue-service.ts` redraws a
  bounded number of times when the sampler picks a blacklisted row, and posting a
  blacklist entry purges already-queued observations with that sentence through
  `replaceRejectedQueuedObservation`. Contracts `BlacklistEntry` and
  `BlacklistResponse` were added to `shared/contracts.ts`.
- The later mobile-menu clarification superseding native mobile selection is what
  the touch CSS above implements.

### Magnifier seeking and playback state — done

- Clicking a position in the magnifier seeks directly to that position:
  `handleMagnifierPointerDown` in
  `frontend/src/observation/audio/AudioScrubber.tsx` now converts the pointer's
  x within the magnifier track into a time inside the magnified window
  (`windowStart + ratio * (windowEnd - windowStart)`) and seeks there, instead of
  the previous pause-then-relative-drag behaviour.
- A click-to-seek preserves whether playback was playing or paused: the previous
  `onPrecisionSeek` handler in `AudioPlayerBar.tsx` called `player.pause()` on
  every magnifier press; it now only closes the speed popover, so the transport
  state is untouched by a click.
- Dragging beyond a threshold temporarily pauses playback:
  `AUDIO_PLAYER_PRESENTATION.magnifierDragPausePx` (8 px) in
  `audio-player-presentation.ts`. Once exceeded, `onScrubBegin` →
  `player.beginScrub()` suspends the transport without recording a user pause.
- When the drag finishes the pre-drag state is restored: `endScrub()` resumes if
  the drag began while playing, and stays paused if playback was deliberately
  paused. Drag end is handled for `pointerup`, `pointercancel` and
  `lostpointercapture` alike, so a cancelled drag restores the pre-drag state
  exactly as a normal drag end does (the user's answer on cancellation).
- Threshold open detail: the user asked for "the same drag move we used as the
  trigger for the magnifier". No drag-distance trigger exists — the magnifier is
  opened by hold duration and pen pressure — so an explicit 8 px constant was
  introduced and is flagged for confirmation.

### Seeking after natural completion — done

- Natural completion is distinguished from a deliberate pause:
  `endedNaturallyRef` in `frontend/src/observation/audio/useAudioPlayer.ts` is
  set by a dedicated `ended` listener and cleared by `pause()`, which is the
  deliberate path. A deliberate pause at the exact endpoint therefore clears the
  flag and is not treated as natural completion.
- Clicking a bookmark or seeking earlier after natural completion resumes:
  `seek()` restarts playback when `endedNaturallyRef` is set and the target is
  before the end. The bookmark button seeks through the same `seek()`, so a
  single bookmark click after the audio finished resumes.
- Seeking while deliberately paused remains paused, because `pause()` cleared the
  flag.
- Consistency with magnifier click and drag seeking: magnifier clicks use the
  same `seek()`. During a drag, `scrubRef` suppresses the auto-resume so the
  position does not start playing mid-drag; `beginScrub()` records
  `playing || endedNaturally` so `endScrub()` resumes afterwards.
- The autoplay preference is untouched: no autoplay setting is consulted in any
  of this logic, so it continues to affect only entering an observation.

### Loop button and bookmark loops — done

- Loop button added next to the playback-speed button: `loopButton` prop on
  `AudioScrubber`, rendered immediately before `speedButton` in the scrubber row,
  with a new `loop` shape in `AUDIO_ICON_SHAPES`
  (`frontend/src/components/icons.tsx`) drawn through `AudioGlassIcon` to match
  the other transport controls.
- Single click toggles looping of the entire audio without restarting playback,
  moving the cursor or jumping to a bookmark: `clickLoopButton` resolves a click
  run using the existing `bookmarkClickWindowMs`; one click sets
  `{ enabled: !enabled, start: 0, end: null }` and performs no seek.
- Double click uses the closest bookmark before the cursor as the loop start and
  moves playback there: `nearestPriorBookmark` on the player-time bookmarks,
  followed by `seek(start)`.
- The bookmark loop ends at the next bookmark, or the end of the audio when there
  is none: `end` is the smallest bookmark greater than `start`, or `null` meaning
  the end of the clip.
- With no earlier bookmark, double click moves playback to the start and toggles
  looping: `seek(0)` plus a toggle of `enabled`.
- Loop enforcement wraps on the animation frame while playing and on
  `timeupdate`/`ended` otherwise, so short bookmark loops are not overshot, and a
  loop that reaches the end restarts instead of stopping.
- Loop is included with the speed and bookmark controls in the gesture
  visibility rules: it is rendered under the same `controlsOpen` condition as
  those two controls.

### Reader gestures and control visibility — done

- The reader's Settings button is removed: the `.settings-trigger` button and its
  `SettingsIcon` import are gone from `ObservationView.tsx`, along with the
  now-dead `settingsVisible` state, the `settings-visible` class and the
  `.settings-trigger`/`.settings-visible` CSS rules.
- Triple-tapping anywhere toggles opening Settings directly:
  `frontend/src/observation/reader-taps.ts` was reworked to count a run of taps
  and dispatch `onSingle`/`onDouble`/`onTriple` when the run ends; the reader's
  `onTriple` calls `onOpenSettings()`.
- Left- and right-region double taps keep their existing navigation behaviour:
  `region.double === 'back' | 'next'` still calls `move()`.
- Middle double tap no longer performs its old action (opening the local settings
  overlay). When the audio bar is visible it toggles the speed, bookmark and loop
  controls together via `playerRef.current.toggleTransportControls()`.
- The middle double tap does not open the magnifier: `toggle-controls` in
  `frontend/src/observation/audio/precision-controls.ts` moves to the new
  `'controls'` mode, which shows the three buttons without the magnifier panel.
- The existing hold/hard-press trigger on the main scrubber still opens the
  magnifier: `magnifierHoldMs` and `magnifierPressureThreshold` handling in
  `AudioScrubber` is unchanged.
- Opening the magnifier also shows the speed, bookmark and loop controls:
  `precisionControlsVisible` is true for `'magnifier'` and `'speed'` as well as
  `'controls'`.
- With the magnifier and those controls open, middle double tap closes the
  magnifier and all three controls together: `toggleTransportControls()` calls
  `closePrecision()` whenever anything is open, returning the reducer to
  `'closed'`.
- This is now the only gesture that closes an opened magnifier: the old
  single-tap dismissal was removed from the reader's `onSingle` handler, which no
  longer calls `dismissPrecision()`.
- Left/right double taps still navigate while the magnifier is open, because the
  double handler is unchanged for those regions.
- If neither the audio bar nor its controls are available, middle double tap has
  no new action: `toggleTransportControls()` returns `false` when
  `!controlsVisible || !audio`, and nothing else runs.
- The question-page toggle-trigger requirements are recorded separately in
  `requests.md` and are not contradicted by this change; they are implemented
  with the question observations point.

## Batch 2

### Settings overview navigation

- **All top-level sections in the left-hand overview start collapsed.**
  `SettingsShell.tsx` seeds `collapsedGroups` from `settingsGroups.index`, so every
  group with children is collapsed on first render.
- **The overview itself starts collapsed.** The former `railCollapsed` state was
  inverted to `railOpen`, defaulting to `false`.
- **Opening the overview from the top-level Settings screen occupies the whole
  screen.** `railMode` is `'full'` when `page === 'index'`; the
  `[data-rail-mode='full']` rules make the rail a full-viewport panel.
- **Opening it from a nested section shows a left-side popup/overlay.**
  `railMode` is `'popup'` otherwise; `[data-rail-mode='popup']` renders the rail as
  a left-anchored overlay over a `.settings-rail-scrim` dismiss button. Escape also
  closes it, and choosing any destination closes it.
- **Applies to the overview toggle after Settings is opened with the new triple-tap
  gesture.** The rail rules were moved out of the `@media (min-width: 960px)` block
  so the toggle and overlay behave identically at every width, including the phone
  layout the triple-tap opens. The reader's Settings button was already removed in
  batch 1.

### Settings structure and consistent presentation

- **Playback Settings, Appearance, and Image Generation are separate Settings
  sections.** `settingsGroups.display` was deleted, the `display` page was removed
  from `SettingsPage`, and `playback`, `appearance`, `images` are now entries of
  `settingsGroups.index`. `SettingsIndex` gained its own summary line for each of
  them (plus Blacklist), and the palette preview swatch moved from the old Display
  entry to Appearance.
- **Playback Settings contains Playback Speed and a new disable-autoplay setting.**
  The page label key is now `playbackSettings` ("Playback Settings"), the numeric
  field is `Default Speed (x)`, and a new `Disable Audio Autoplay` switch was added.
  It is backed by `autoplayAudio` in `shared/appearance.ts` (default `true`,
  validated in `parseAppearance`) and passed into `useAudioPlayer` as the initial
  value of `wantsPlaybackRef`.
- **Does not change seek-after-natural-completion.** That resume path is driven by
  `endedNaturallyRef` inside `seek()`, which never consults `autoplay`; a comment in
  `useAudioPlayer.ts` records the boundary. Only the entry path and the
  clip-change reset use the preference.
- **Every word capitalized in multiword English Settings titles.** `COPY.en` now has
  `Source Weights`, `Data Sources`, `Source Repository`, `Catalog Version`,
  `Accepted Rows`, `Rejected Rows`, `Complexity Metric`, `Development Fixture`,
  `Reset Queue`, `Playback Settings`, `Playback Speed`, `Default Speed (x)`,
  `Initial Fill`, `Observation Consumed`, `Choose Export Format`, `Switch Language`,
  and `Image Generation` (in `navigation.ts`). Telugu strings are untouched.
- **Breadcrumb text removed.** The `.settings-context` element was deleted from
  `SettingsShell.tsx` and its two now-dead CSS rules were removed.
- **Export and Download share cohesive spacing.** `.export-page` gap and
  `.export-actions` gap were aligned (20px), and `.export-actions` now shares the
  same trailing-edge placement and 24px lead-in as every other action group.
- **Action design and positioning standardized.** A single rule gives
  `margin-top: 24px; justify-self: end;` to the Sampling/Complexity/Source-Weights
  Save actions, Playback Save, Reset Queue, Stop Eon, Start Eon, the Image
  Generation actions, and the Export/Download pair, so all of them sit at the
  trailing edge with identical spacing. Stop Eon and Reset Queue therefore read as
  buttons in the same position as Sampling's Save rather than as a checkbox and as
  unbounded text.
- **Language control's apparent selected highlight resolved.** The cause was the
  sticky `:hover` background that a touch leaves behind on `.language-toggle`. All
  hover rules in `settings-layout.css` were moved into `@media (hover: hover)`, so
  they only apply to real pointers. Removing the reader Settings button in batch 1
  does not reintroduce the symptom.
- **Navigation highlights no longer carry into the destination page.** The same
  `@media (hover: hover)` change removes the stuck entry/rail-link highlight, and
  both `SettingsIndex` entries and `SettingsShell` rail links now `blur()` the
  clicked button so no focus ring lands on a differently labeled control occupying
  the same position on the next screen.
- **Sampling > Data Sources uses the Diagnostic format.** `DataSourcesPage` was
  rewritten from `<dl>` cards to the `.diagnostic-sections` / `.diagnostic-section`
  / `.diagnostic-table` structure used by `DiagnosticPage`, with the source name as
  a visible section title and the upstream repository as a final table row.

### Appearance organization

- **Split into subsections organized by visual element.** The page is now five
  element sections — Background, Text & Icons, Audio Controls, Settings & Popovers,
  Reader Gestures — instead of eight setting-type sections.
- **Color, position, and other settings grouped consistently within each element.**
  A shared `subsection()` helper renders every group with the same heading row,
  body, and note, and the groups always appear in the order Color, Position, Other.
  Type size, fonts, spacing gaps, magnifier position, timestamp/highlight switches,
  scroll mode, and auto-fade were all moved under the element they affect.
- **Background's three circles versus the lone circles elsewhere.** Text & Icons and
  the Settings surface now use the same `.appearance-colors` swatch grid as the
  Background gradient — swatch above, name, hex output — so one circle and three
  circles are the same component at different counts. The old
  `.appearance-color-role` row layout and its CSS were deleted.
- **Automatic Surface addressed rather than silently kept or dropped.** It was kept
  but reframed: it is renamed `Derive from background`, placed directly beneath the
  surface swatch it governs, and while it is on the swatch is `disabled` and styled
  read-only. The accompanying note explains both states.
- **Explanatory text standardized.** Every subsection renders an optional
  `.appearance-note` paragraph in one style, and notes were written for all of them,
  so Control Darkness is no longer the only setting with an explanation.
- **Typography and heading hierarchy standardized.** `.appearance-section h2` is
  .95rem/600 in the foreground color, `.appearance-subsection h3` is .75rem
  uppercase muted, and field labels — including the former "Text vertical offset",
  now "Vertical offset" under Text & Icons > Position — are .82rem regular, so a
  field can never out-rank its parent heading.
- **Applied to every element, not just the called-out examples.** Each element
  section also gained a scoped reset action covering exactly its own settings
  (text color/scale/offset/fonts; audio darkness/highlight/timestamp/offset/
  position/gaps; surface; gestures), replacing the previous per-setting reset
  buttons that were attached to setting-type sections.

### Magnifier size and highlight background

- **Magnifying bar made smaller overall.** `.audio-magnifier-track` height went from
  44px to 28px and the audio bar's second grid row from 116px to 100px, with the
  `.audio-scrubber-window` inset adjusted from 19px to 21px so the highlight still
  centers on the track.
- **Appearance setting to enable or disable the highlight background.** New
  `showMagnifierHighlight` field in `shared/appearance.ts`, surfaced as
  `Show magnifier highlight` in Appearance > Audio Controls > Other, threaded to
  `AudioScrubber` as `showHighlight`, which now gates rendering of
  `.audio-scrubber-window`. The Appearance audio preview reflects the toggle.
- **Confirmed details.** Dimensions: 28px track height (confirmed by the user).
  The setting controls the `.audio-scrubber-window` shading drawn on the main bar to
  mark the region the magnifier is showing. Default: enabled, which keeps the
  current look (confirmed by the user).

### Directional audio-bar animation

- **The bar slides into and out of a slit in the swipe direction.** The hidden state
  is now `clip-path: inset(0 0 0 100%)` — zero width at the trailing edge — so the
  bar unfurls from a slit rather than growing from its middle.
- **The center-collapse effect was replaced.** The previous `inset(0 50%)` hidden
  state was removed.
- **Entry and exit follow the gesture direction.** `ObservationView` records the
  `ScrollDirection` that revealed the controls in new `revealDirection` state and
  publishes it as `data-reveal-direction` on the observation screen;
  `[data-reveal-direction='-1']` flips the slit to the opposite edge and flips the
  inner `translateX(56px)` offset. Because the attribute is only updated when the
  controls are hidden, the exit animation reverses the same slide.
