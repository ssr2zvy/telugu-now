# Controls Guide

Everything Telugu Now does and every way you can make it do it. This covers all
application behaviour, not only recently added controls.

Each feature notes its desktop and mobile differences, the gestures that reach
it, when it is visible, and the settings that change it. Pending requests that
are not yet implemented are marked **Pending** and are listed at the end;
everything else described here is available behaviour.

---

## 1. Getting in

### Password gate

When the server has an access password configured, a password gate appears
before user-ID selection. It is a real username-and-password form — the username
field is present but hidden — so browser password managers, including iPhone
Safari, offer to save the password on first use and offer to fill it on later
visits.

| Control | Where | What it does |
|---|---|---|
| Password field | Centre of the gate | Accepts the shared password. `Enter` submits. |
| Unlock (arrow icon) | Below the field | Submits the password. Icon only, with an accessible name. |

A correct password issues a signed session cookie, so the gate does not reappear
until that session expires. A wrong password marks the field invalid and clears
nothing, so you can correct a typo. When no password is configured on the server
the gate never appears.

### User ID selection

After the gate, you choose or enter a profile code. Every setting, queue,
blacklist, eon and history described below is per profile.

---

## 2. The reader

The reader shows one observation at a time: its Telugu text, and an audio bar
when the observation has audio.

### Navigation and page gestures

| Gesture | Desktop | Mobile | Result |
|---|---|---|---|
| Double-click / double-tap, left third | Yes | Yes | Previous observation |
| Double-click / double-tap, right third | Yes | Yes | Next observation |
| Double-click / double-tap, middle third | Yes | Yes | Toggles the speed, bookmark and loop controls — see below |
| Triple-tap anywhere | Yes | Yes | Opens Settings |
| Double-click / double-tap on a word | Yes | Yes | Opens the word view for that word |
| Right-click on the text | Yes | — | Opens the sentence menu |
| Long press on the text | — | Yes | Opens the sentence menu |

The reader has **no Settings button**. Triple-tap is the way in.

**Precedence.** A double-tap that lands on a word opens the word view; a
double-tap on empty space in the left or right third navigates. The middle third
never navigates. A long press that becomes a drag is not a long press, so
scrolling never opens the menu.

The mobile sentence menu **replaces** native long-press text selection and its
copy mechanism, rather than coexisting with it.

### Middle double-tap: the three meanings

The middle double-tap means different things depending on what is on screen, and
this is deliberate:

1. **Audio bar visible, extra controls hidden** — shows the speed, bookmark and
   loop controls together.
2. **Extra controls visible (however they were opened, including by the
   magnifier)** — hides them. If the magnifier is open, this closes the magnifier
   *and* all three controls together. This is the **only** way to close an opened
   magnifier; the old single-tap dismissal was removed.
3. **No audio bar and no associated controls** — does nothing.

The middle double-tap never opens the magnifier.

### Sentence menu (right-click / long press)

Two icon-only controls, with accessible names and no visible action text:

| Icon | Action |
|---|---|
| Copy | Copies the **entire displayed sentence**, not a selected word |
| Blacklist | Adds the displayed sentence to this profile's blacklist |

To copy a single word from a longer sentence, double-tap the word and use the
word view's copy control instead.

Blacklisting applies to **whole sentences**. A single word can only be
blacklisted when that word is the entire sentence. Blacklisting also removes the
sentence from anything already queued — including copies of the same text drawn
from a different source row — so you never see it again. Blacklisted sentences
are listed and removable under **Settings → Blacklist**.

### Reader appearance

Text size, vertical offset, colours, background and gesture behaviour all come
from **Settings → Appearance**. Two reader-specific appearance settings:

- **Highlight Mods** (default **on**) renders Telugu letter modifications —
  matras, anusvara/visarga, and virama-subjoined consonants (vattus) — in a more
  saturated variant of the text colour, leaving base letters in the normal
  colour.
- **Custom cursor** (desktop only) draws the pointer in a colour derived from the
  background gradient, picking a lighter or darker variant so it stays visible.
  Touch devices are unaffected.

---

## 3. Audio playback

### The audio bar

The audio bar sits at the bottom of the reader. It slides in and out of a slit
**in the direction of the gesture** that revealed or dismissed it — it does not
collapse toward its centre.

| Control | Gesture | Result |
|---|---|---|
| Play / pause | Tap | Starts or deliberately pauses playback |
| Scrubber | Tap a position | Seeks there |
| Scrubber | Drag | Scrubs |
| Scrubber | Hold / hard press | Opens the magnifier |

The **audio timestamp is hidden by default**; it can be shown again from
**Settings → Appearance → Audio Controls**.

**Autoplay.** By default audio starts playing when you enter a normal
observation. **Settings → Playback Settings → Disable Audio Autoplay** turns that
off. This setting affects *only* entering an observation; it never disables the
automatic resume described under playback state.

### Playback state: deliberate pause versus natural completion

The app distinguishes two ways audio can be stopped, and they behave differently
when you then seek:

| Stopped because | Seeking backward (scrubber, magnifier, or bookmark) |
|---|---|
| You pressed pause — a **deliberate pause** | Stays paused |
| The audio reached its end on its own — **natural completion** | Resumes playing |

Pressing pause at the exact endpoint is a deliberate pause, not natural
completion, so seeking afterwards stays paused. Natural completion is not a
user-selected paused state, which is why it resumes. This rule is identical for
the scrubber, magnifier clicks, magnifier drags and bookmark clicks.

### Magnifier

The magnifier is opened by a **hold / hard press on the main audio scrubber** —
the existing trigger, not a scroll gesture — and it is closed by a **middle
double-tap**. Opening it also shows the speed, bookmark and loop controls.

| Gesture | Result |
|---|---|
| Click a position in the magnifier | Seeks directly there, **preserving** whether playback was playing or paused |
| Drag past the drag threshold | Temporarily pauses playback while you drag |
| Release the drag | Restores the playback state from **before** the drag: resumes if it was playing, stays paused if it was deliberately paused |
| Cancelled drag (pointer cancel) | Finishes exactly like a released drag — the pre-drag state is restored |

The magnifier track is 28 px. **Settings → Appearance → Audio Controls** has a
toggle for the magnifier's **highlight background** (default **on**), which
controls the highlighted window drawn behind the magnified region. The magnifier
seeker over the glass is drawn darker than the surrounding controls so it stays
locatable.

### Speed, bookmarks and loop

These three controls appear and disappear **together**, via the middle
double-tap or by opening the magnifier.

**Playback speed** opens a popover for the playback rate, which is stored per
profile.

**Bookmarks** mark positions in the audio. Clicking a bookmark seeks to it,
following the deliberate-pause / natural-completion rule above.

**Loop** sits next to the playback-speed control:

| Gesture | Result |
|---|---|
| Single click | Toggles looping of the **entire** audio. Playback is not restarted, the cursor does not move, and it does not jump back to a bookmark |
| Double click | Uses the closest bookmark **before** the playback cursor as the loop start and moves playback there. The loop ends at the **next** bookmark, or at the end of the audio if there is no next bookmark |
| Double click with no earlier bookmark | Moves playback to the start and toggles looping |

---

## 4. Questions

30% of displayed observations are questions; the other 70% are normal
observations. For a question, the sentence comes from observations you have seen
before 75% of the time and ones you have not seen 25% of the time. Within either
pool, the normal source-weight plus complexity sampling applies. If a pool has no
eligible observations at all, selection falls back to whatever is allowed rather
than failing.

A question is **audio-given** 60% of the time and **text-given** 40% of the time.
The chosen kind, pool and keyboard are stored with the observation, so reloading
does not reroll the question.

### Toggle Trigger

**Settings → Appearance → Reader Gestures → Toggle Trigger** replaces the old
Scroll Mode switch and has two options:

- **Scroll Mode** — scrolling brings the question's input in and out.
- **Tap Mode** — tapping brings the question's input in and out.

### Audio-given question (type what you hear)

The normal observation audio bar is shown by default, with all of its features.
The Toggle Trigger brings in an on-screen **virtual keyboard**, chosen with equal
one-third probability from:

| Keyboard | Behaviour |
|---|---|
| Windows InScript | The real InScript key positions |
| Mac Standard | The real Mac Telugu layout |
| Chromebook Dictation | Phonetic; keystrokes are buffered and transliterated, so multi-key sequences resolve as they do in the real input method |

Each is an authentic reproduction of the real layout's functionality, drawn in
the app's own minimal style. All three support shift and backspace; space and
newline flush any pending phonetic buffer.

A text area above the keyboard shows what you have typed. **Typed text is kept
when the keyboard is swiped away**, so you can listen again and bring the
keyboard back. Next opens the answer page.

### Text-given question (speak what you read)

The text is displayed like a normal observation. The Toggle Trigger brings in a
**Record** control.

| Control | Result |
|---|---|
| Record | Turns red and starts recording |
| Record again | **Overwrites from the current cursor position** rather than restarting from the beginning — the earlier part of the take is kept and the new audio continues from the playhead |
| Audio bar (after the first recording) | The same audio bar as a normal observation, with all the same features |
| Toggle Trigger | Removes the Record control and toggles off the magnifier and icons, but keeps the audio bar and the ability to use the magnifier and every other audio-bar feature afterwards |
| Next | Opens the answer page |

Recordings live **only in your browser** and are discarded when you leave the
observation. Nothing is uploaded.

### Answer page

The answer page is a **split screen**, not a normal observation:

- The **real observation occupies three quarters** of the screen — on desktop the
  right three quarters — with the full normal-observation UI and all of its
  functionality intact.
- **Your own answer occupies the remaining quarter** — on desktop the left
  quarter. If the question was text-given, this is an audio bar with the same
  feature set, playing your recording. If the question was audio-given, it is
  your typed text in the same font formatting as the observation.
- On **mobile and other vertical displays** the quarter moves to the **top** and
  the three quarters sit **below** it.

---

## 5. Word view

Double-tapping a word in the reader opens the **full-page** word view. The word
sits alone at the top.

| Control | Type | Result |
|---|---|---|
| Copy | Icon | Copies the word |
| Generate | Icon | Opens the word's image catalog, or generates the first image if the catalog is empty |
| Search | Icon | Opens web image search for the word |
| Close | Icon | Returns to the reader |

All action controls here are **icons only**, with accessible names and no visible
text. `Escape` steps back one page rather than closing the whole view outright.

### Individual letters

Each letter at the top of the word view is **double-clickable / double-tappable**
— a single tap does nothing. Double-tapping a letter opens an observation-like
page showing only that letter with an audio recording speaking it, generated
through Pollinations text-to-speech. A **back control in the top left** returns to
the word page.

Letter speech is cached in a table shared by all users, so any given letter is
normally generated once and then reused for everyone.

### Image catalog

Every image ever produced for a word is kept in that word's catalog. Generating
does **not** replace the previous image — the regeneration system was removed and
images accumulate instead.

The image view uses the whole page, with the same spacing and design conventions
as Settings and the reader. **Tapping the image toggles its controls** in and out
of view:

| Control | Result |
|---|---|
| Back | Previous image in the catalog |
| Next | Next image in the catalog; when you are on the last image, Next **generates another one** and appends it |
| (i) | Shows that image's metadata: when it was added, whether it was generated or found by search, the sentence that was on screen when it was requested, the rendered prompt, and the upstream page for searched images |
| Exit | Leaves the image view |

Images stored before the catalog existed are adopted into it automatically, so
nothing is lost.

### Image prompt placeholders

**Settings → Image Generation** holds the prompt. Both placeholders are
**optional**:

| Placeholder | Meaning |
|---|---|
| `<core word>` | The word's root form |
| `<sentence>` | The full sentence that was on screen when the word was tapped |

### Web image search

Search queries Serper.dev for images of the word. Tapping a result downloads it
server-side and saves it permanently into the same catalog alongside generated
images. Search results are cached in a table shared by all users, so when anyone
searches the same word again the stored results are reused and no external
request is made.

---

## 6. Settings

Settings is opened from the reader with a **triple-tap**.

### Overview navigation

- Every top-level section in the left-hand overview starts **collapsed**.
- The overview itself also starts **collapsed**.
- Opening the overview from the **top-level** Settings screen makes it occupy the
  **whole screen**.
- Opening it from any **nested** section shows it as a **left-side popup /
  overlay** instead of replacing the screen.
- `Escape`, or tapping the scrim, dismisses it.

There is no parent/origin breadcrumb text beneath nested page titles.

### Sections

| Section | Contains |
|---|---|
| Sampling | Complexity, Source Weights, Data Sources |
| Diagnostic | Trigger, Source, Complexity, Global information |
| Playback Settings | Playback Speed, Disable Audio Autoplay |
| Appearance | Per-visual-element appearance settings |
| Image Generation | Model, API key status, image prompt |
| Eons | Eon history and controls |
| Blacklist | Hidden sentences, removable |
| Export | Export and download |
| Telugu Now Version | Deployment and build information |
| Reset Queue | Clears the queue |

### Sampling → Complexity

| Field | Meaning |
|---|---|
| Target | The complexity percentile to centre selection on |
| Spread | How far selection strays from the target |
| Common Word Reduction | How strongly word commonality shifts complexity, 0–20, default 2 |

**Common Word Inclusion** derives each word's commonality from how often it
occurs across all observation text, excluding blacklisted sentences, producing
one fixed ranking. A word more common than average scales its own graphemes
down; a rarer word scales them up. The corpus is then rescaled so its mean is
unchanged, which keeps the metric in grapheme-count units and stops it biasing
everything downward. **0 disables the metric** and restores the plain grapheme
count. The metric applies inside the seen/unseen question pools too, because
those pools are redraws over the same sampler.

### Sampling → Data Sources

Presented in the same standardized information format as Diagnostic, since both
are information displays.

### Appearance

Appearance is split into subsections **by visual element** — Background, Text &
Icons, Audio Controls, Settings & Popovers, and Reader Gestures. Within each
element, its **colour**, **position**, and **other** settings are grouped in the
same consistent format, with explanatory notes applied consistently rather than
to only one setting, and a heading hierarchy where a subsection heading is never
smaller than the settings beneath it. Each element has its own scoped reset.

`Derive from background` replaces the old Automatic Surface control, so its
purpose is explicit.

**Control Darkness** darkens the controls while keeping their relative scale and
gradient colour positions, and starts somewhat darker than the original default.

### Telugu Now Version

Shows the app version, the deployed commit and its message, the branch, the
build time, the deployed Fly app, region and machine, the server start time and
uptime, and the client and server build versions. Anything not stamped into the
deployed image reads **Unknown**.

### Icon and text conventions

- Action controls **outside** Settings are **icons only**, with no visible text
  inside or beside them, and always with accessible names.
- **Settings keeps its icon-and-text patterns**, because essentially all of it
  needs descriptive text. Its actions are standardized in design and position
  rather than stripped of text.
- The bottom-right **language control is icon-only**.
- Section titles and field labels stay readable, and multiword English titles are
  capitalized on every word ("Playback Speed", "Image Generation").

---

## 7. Defaults at a glance

| Setting | Default |
|---|---|
| Audio autoplay on entering an observation | On |
| Magnifier highlight background | On |
| Highlight Mods | On |
| Audio timestamp | Hidden |
| Common Word Reduction | 2 |
| Toggle Trigger | Scroll Mode |
| Question probability | 30% |
| Seen-pool probability for questions | 75% |
| Audio-given question probability | 60% |
| Magnifier track size | 28 px |

---

## 8. Pending requests

These are requested but **not yet available**:

- **GitHub deployment secret setup** — the repository Actions secret `API_TOKEN`
  still needs to be set from the Codespaces `FLY_API_TOKEN`. Setting it does not
  authorize enabling the disabled deployment workflow or deploying. See
  `tokens.md`.

Keep this guide aligned with implemented behaviour as further changes land, and
keep pending requests clearly separated from available features.
