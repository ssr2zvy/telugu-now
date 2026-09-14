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
