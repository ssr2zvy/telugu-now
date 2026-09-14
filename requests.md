# Requested changes

Captured on 2026-09-14 from the discussion and `requests-raw.md`. These are
pending requests, not a record of completed implementation.

The organized requirements below incorporate the user's clarifications. The
complete original raw notes are preserved verbatim at the end, including
parenthetical remarks and references to other features. Where the raw notes or
earlier discussion conflict with a later clarification, the clarification takes
precedence; the original wording remains available for context.

This document does not authorize implementing the features or deploying them.

## Reading-page copy and blacklist menu — done

Implemented; see `requests-done.md`.

- In desktop browsers, right-clicking the reading text opens a modal/menu.
- On mobile, a long hold opens the equivalent menu. This replaces native
  long-press text selection and its copy mechanism, rather than preserving them.
- The original copy-only modal request is expanded to include Copy and
  Blacklist icons, with no visible action text. Give icons accessible names.
- Copy here copies the entire displayed sentence, not a selected word.
- To copy one word from a longer sentence, double-click/double-tap it to enter
  the word view and use that view's copy control.
- Add a Settings blacklist listing sentences that must not appear again.
- Blacklisting applies to entire sentences, not words occurring within them.
  A word can be blocked as a sentence only when it comprises the whole sentence.
- The menu's Blacklist icon adds the displayed sentence to this blacklist.

The later mobile-menu clarification explicitly supersedes the earlier request
to leave native mobile selection unchanged.

## Magnifier seeking and playback state — done

Implemented; see `requests-done.md`.

- Clicking a position in the magnifier should seek directly to that position.
- A click-to-seek should preserve whether playback was playing or paused.
- Dragging the magnifier beyond a threshold should temporarily pause playback.
- When dragging finishes, restore the playback state from before the drag:
  resume if it was playing, remain paused if it was deliberately paused.
- To confirm: the drag threshold and how a cancelled drag should finish.

## Seeking after natural completion — done

Implemented; see `requests-done.md`.

- Distinguish playback stopping naturally at the end from a deliberate user
  pause, including a deliberate pause at that exact endpoint.
- Clicking a bookmark or seeking to an earlier position after natural
  completion should resume playback.
- Seeking while deliberately paused should remain paused. Natural completion
  is not a user-selected paused state.
- Keep this behavior consistent with magnifier click and drag seeking.
- The new autoplay preference only affects entering an observation. It does
  not disable automatic resume when seeking backward after natural completion.

## Loop button and bookmark loops — done

Implemented; see `requests-done.md`.

- Add a Loop button next to the playback-speed button.
- Single-clicking Loop toggles looping of the entire audio without restarting
  playback, moving the cursor, or jumping back to a bookmark.
- Double-clicking Loop uses the closest bookmark before the playback cursor as
  the loop's start and moves playback there.
- That bookmark loop ends at the next bookmark, or the end of the audio when
  there is no next bookmark.
- If there is no earlier bookmark, double-clicking moves playback to the start
  and toggles looping.
- Include Loop with the speed and bookmark controls in the gesture visibility
  rules below.

## Reader gestures and control visibility — done

Implemented; see `requests-done.md`.

- Remove the reader's Settings button.
- Triple-tapping anywhere toggles opening Settings directly.
- Left- and right-region double-taps keep their existing observation-navigation
  behavior.
- Middle double-tap no longer performs its old action. If the audio bar is
  visible, it toggles the speed, bookmark, and loop controls together.
- This middle double-tap does not open the magnifier.
- Keep the existing hold/hard-press trigger on the main audio scrubber to open
  the magnifier. The user's phrase "little scroll part" refers to this existing
  trigger, not a newly specified scroll gesture.
- Opening the magnifier also shows the speed, bookmark, and loop controls.
- If the magnifier and those controls are open, middle double-tap closes the
  magnifier and all three controls together.
- This is the only gesture for closing an opened magnifier; remove the old
  single-tap dismissal behavior. Left/right double-taps still navigate.
- If neither the audio bar nor its associated controls is available, middle
  double-tap has no new action.
- The question-page toggle-trigger behavior is also specified separately below;
  preserve those contextual requirements when implementing reader gestures.

## Settings overview navigation

- All top-level sections in the left-hand overview should start collapsed.
- The overview itself should also start collapsed.
- Opening the overview from the top-level Settings screen should make it occupy
  the whole screen.
- Opening it from any nested Settings section should show a left-side popup
  or overlay rather than replace the entire screen.
- Apply this behavior to the overview toggle after Settings is opened with the
  new triple-tap gesture; the reader's old Settings button is being removed.

## Settings structure and consistent presentation

- Playback Settings, Appearance, and Image Generation should be separate
  Settings sections.
- Playback Settings contains Playback Speed and a new setting to disable audio
  autoplay when entering a normal observation. This does not change the
  seek-after-natural-completion behavior described above.
- Capitalize every word in multiword English Settings section titles, such as
  "Playback Speed".
- Remove the tiny parent/origin/breadcrumb text shown alongside or beneath the
  current nested Settings page title.
- Make Export and Download controls use cohesive vertical and horizontal
  spacing: both their distance from page borders and their distance from one
  another should follow the same layout conventions.
- Standardize action design and positioning throughout Settings. The examples
  motivating this are Stop Eon looking like a checkbox, Reset Queue looking
  like unbounded text, and Sampling's Save/check action being in the bottom
  right while the others occupy different positions.
- Resolve the language control's apparent selected highlight on entering
  Settings. The notes suggest its old overlap with the reader's Settings button
  may be responsible; removing that button must not leave the symptom.
- Resolve navigation highlights that carry into a destination page where the
  same screen position now represents a differently labeled control.
- Sampling > Data Sources should present information using the same
  standardized format as Diagnostic, since both are information displays.

## Appearance organization

- Split Appearance into further subsections organized by visual element.
- Within each visual element, group its color settings, position settings, and
  other applicable settings using consistent formats and structures.
- Preserve the motivation and examples from the raw notes: Background's three
  color circles seem reasonable on their own, but differ from Text & Icons and
  Settings & Popovers, each with a lone circle at the far right.
- Address the inconsistency and unclear purpose of the Automatic Surface
  control under Settings & Popovers rather than silently assuming it should
  remain in its present form or be removed.
- Standardize explanatory text: Control Darkness currently has an explanation
  while other settings do not.
- Standardize typography and heading hierarchy: "Text vertical offset" currently
  appears larger than "Position", its parent heading.
- Apply coherent organizing decisions to every Appearance element, not only
  the specific examples called out in the notes.

## Magnifier size and highlight background

- Make the magnifying bar smaller overall.
- Add an Appearance setting to enable or disable its highlight background.
- To confirm: the new dimensions, which highlight/background the setting
  controls, and whether it should be enabled by default.

## Directional audio-bar animation

- The audio bar should feel as though it slides into and out of a slit in the
  swipe direction.
- Replace the current effect that appears to collapse the bar toward its center.
- Keep the entry and exit motion consistent with the direction of the gesture.

## Question observations and sampling

- Introduce questions as another type of displayed observation.
- Display normal observations, as already defined, with 70% probability and
  questions with 30% probability.
- For questions, use observations the user has seen before 75% of the time and
  observations the user has not seen before 25% of the time.
- Within either the seen or unseen pool, use the existing source-weight plus
  complexity sampling strategy.
- Choose an audio-given question with 60% probability and a text-given question
  with 40% probability.
- Audio-given questions ask the user to type the audio; text-given questions ask
  the user to speak the text.
- Redefine the existing Scroll Mode setting as Toggle Trigger, with two options:
  Scroll Mode and Tap Mode.

### Audio-given question

- Show the normal observation audio bar, including all its features, by default.
- The chosen Toggle Trigger brings in an on-screen virtual keyboard.
- Select the keyboard with equal one-third probabilities from Windows InScript,
  Mac Standard, and Chromebook Dictation keyboards.
- A text-entry area above the keyboard displays what the user has typed.
- Entered text remains even when the keyboard is swiped away.
- The user can then click Next to reach the answer page.

### Text-given question

- Display the text like a normal observation.
- The raw notes describe scrolling to bring in a Record button, within the
  broader Scroll Mode / Tap Mode Toggle Trigger requirement.
- Clicking Record turns it red and starts recording audio.
- After the initial recording, show an audio bar with the same features as the
  normal observation audio bar.
- Pressing Record again overwrites/begins recording from the current cursor
  position rather than always starting a new recording at the beginning.
- Toggle Trigger removes the Record button and toggles off the magnifier/icons,
  but keeps the audio bar and the ability to use the magnifier and all other
  audio-bar features afterward.
- Clicking Next goes to the answer page.

### Answer page

- The answer page looks like the normal observation page for that observation.

## Telugu letter-modification highlighting

- Add an Appearance setting named Highlight Mods and enable it by default.
- Identify the base letter and leave it in its existing text color.
- Render modifications, such as the "i" and "a" additions, with increased
  saturation of the font color.
- The user's tentative terminology is "gunintahly hacchlau and vathulu";
  retain this uncertainty rather than treating the precise linguistic scope as
  already resolved.

## Custom cursor

- Add a custom cursor wherever the site uses a cursor, mainly applicable to
  desktop browsers.
- Derive its color from the gradient and choose a pragmatically appropriate
  darker or lighter variant so it is distinguishable.

## Password gate

- Add a password gate before the user-ID selection/entry step.
- Store the required password's verification configuration in Fly secrets,
  never in client code or committed documentation.
- Support normal browser password-manager detection during initial setup,
  including iPhone Safari prompting to save the entered password.
- On later visits, iPhone Safari and other browsers should recognize the site
  and offer the saved password.

## Word view and image catalog

- Double-clicking/double-tapping a word opens a full-page word view, with the
  word alone at the top.
- Include an icon to copy the word's text.
- Beneath the word/copy area, provide image-related actions: an icon-only
  Generate action and an icon-only Search action.
- Generated and searched image views open the pages and controls described
  here, rather than abandoning the app's standardized navigation/layout.
- Replace the regeneration system with a catalog of images for each word.
- If a clicked word already has a generated image, show it and offer Next.
  Next shows another existing generated image when available; otherwise it
  opens the normal image-generation page to create another image.
- Add newly generated images to that word's catalog rather than treating them
  as replacements for the prior image.
- Each image has an information `(i)` control for metadata such as generation
  time and the sentence that was present when it was generated.
- Next, Back, and information controls appear only when the image is clicked;
  clicking/tapping the image toggles their visibility.
- The later raw clarification also includes Exit among the image-view controls,
  with a single tap toggling those controls into view.
- Use the whole page for the image view, preserving appropriate spacing and
  the same standardized design principles used across Settings, the reader,
  and the rest of the app.

### Image-generation prompt placeholders

- Make `<core word>` optional rather than required, while keeping it available
  as a supported placeholder.
- Also support `<sentence>`, meaning the full sentence present when the word
  was clicked for the generation request. The raw notes say "regeneration"
  here while also requesting that regeneration be replaced by the image catalog.

### Individual-letter view and TTS

- Each letter at the top of the word view is double-clickable/double-tappable.
- Double-clicking/double-tapping a letter opens an observation-like page with
  only that letter and an audio recording speaking that letter.
- Generate the letter's TTS using the Pollinations API.
- Include a back control in the top left returning to the word page.
- The later raw reference to clicking a single letter was clarified to mean
  double-click/double-tap, not single-click activation.

### Web image search and shared storage

- Integrate generic web image search on the word page through Serper.dev.
- Add Serper.dev credential documentation to `tokens.md` and its costs to
  `costs.md`; the secret's exact name/location still needs to be specified.
- Permanently store all images and TTS in a database common to all users, as
  requested in the raw notes.
- When any user requests the same TTS or image search, reuse already retrieved
  results rather than repeating the external request.

## Complexity scoring

- Extend complexity scoring beyond grapheme count with a Common Word Inclusion
  metric.
- A common word lowers the complexity score, making observations with more
  graphemes more probable when they contain a common word.
- Provide a separate editable number for this metric in Complexity settings.
- Retain the source-weight plus complexity selection strategy, including its
  use within seen/unseen question pools.

## Source removal

- Remove Dummy Source 1, Dummy Source 2, and Dummy Source 3.

## Version information in Settings

- Add a Telugu Now version section showing the latest deployment date/time
  and related version/deployment information.

## Cost documentation

- Add GitHub Codespaces usage as a platform in `costs.md`, specifically the
  Codespace holding the Fly deployment token and used for deployments.
- Add Serper.dev costs for the new image-search integration.
- Keep the established per-platform organization: overall cost/usage link,
  followed by possible component costs and relevant links for each.
- Retain existing Fly and Pollinations coverage; include the requested
  Pollinations TTS feature when documenting the expanded usage.

## Credential documentation: tokens.md

Create a repository-root `tokens.md` documenting credential purposes, consumers,
and storage locations. Do not include actual token values, secret keys, or
credential-bearing examples.

| Credential | Storage location | Purpose |
|---|---|---|
| `pollinations_api_key` | Fly secrets | Server-side Pollinations image generation |
| Tigris AWS-compatible credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` if temporary credentials are used) | Fly secrets | Access to the app's Tigris object storage |
| `FLY_API_TOKEN` | Codespaces secret, exposed to the Codespace environment | Authorize manual Fly deployments from the Codespaces machine |
| `API_TOKEN` | Repository GitHub Actions secret, populated from the Codespaces `FLY_API_TOKEN` | Authorize GitHub Actions deployment when that workflow is enabled |
| Password-gate verification configuration | Fly secrets; exact name/design to confirm | Verify access before user-ID selection |
| Serper.dev API key | Exact secret name and storage location to confirm | Server-side web image search |

Distinguish secret Tigris credentials from non-secret configuration such as
endpoint, region, bucket name, and object prefix. Describe the actual
configuration locations without implying that all Tigris configuration is secret.

## GitHub deployment secret setup

- Add a setup task to run `gh secret set API_TOKEN` for this repository using
  the existing `FLY_API_TOKEN` in the Codespaces environment.
- The agent must never read, inspect, print, log, or receive the variable's
  value. Transfer it directly from the environment to the GitHub CLI's standard
  input without exposing it in command arguments, files, shell tracing, or tool
  output. Do not retrieve the value through a tool and then pass it back.
- Document this setup and the source/destination secret names in `tokens.md`,
  without including credential values.
- The destination name is `API_TOKEN`, not `FLY_API_TOKEN`. Update the workflow
  scaffold to map `secrets.API_TOKEN` to the `FLY_API_TOKEN` environment variable
  expected by `ci-cd/deploy.sh`, so the two names are not confused.
- Setting the secret does not itself authorize enabling the disabled workflow
  or deploying. This is a pending setup request, not a completed secret transfer.

## Controls Guide

- Create a **Controls Guide** documenting all application behavior and control
  behavior, not only the newly added controls.
- Cover the reader, audio playback/seeking/looping, magnifier, Settings and its
  overview, question and answer pages, keyboard/recording interactions, word
  and letter views, image generation/search/catalog navigation, and copy and
  blacklist menus.
- Explain desktop and mobile differences, every interaction and gesture,
  contextual meanings and precedence, visibility/open/close rules, defaults,
  relevant settings, and playback-state transitions.
- Include the cross-feature behavior and exceptions specified in this request
  document, such as deliberate pause versus natural completion, temporary
  drag-pause restoration, and the distinct meanings of middle double-tap.
- Keep the guide aligned with implemented behavior as changes land, clearly
  distinguishing pending requests from available features.

## Icon and text conventions

- New action controls outside Settings should be icons only, without visible
  text inside or alongside those action icons; keep accessible names.
- The user clarified that Settings can retain its existing icon-and-text
  patterns because descriptive text is needed for essentially all of it.
- The bottom-right language control remains icon-only.
- Keep section titles and field labels readable and preserve the multiword
  title-capitalization request. Standardize Settings action design and
  positioning without incorrectly stripping all Settings text.

## Details to settle before implementation

- Magnifier drag threshold and cancellation behavior.
- Magnifier dimensions.
- Exact highlight-background scope and its default setting.
- Question-pool behavior when a seen or unseen pool has no eligible observations.
- Exact layouts/input behavior for the three named virtual keyboards.
- Recording overwrite boundaries and permission/error handling.
- Precise Telugu modification categories and rendering behavior.
- Password-gate/session design and secret naming.
- Common-word list, score formula, and configurable numeric range.
- Image/TTS cache identity, database storage design, and image-search result
  reuse boundaries.
- Blacklist scope and management behavior.
- Exact additional version/deployment information to display.

These are open implementation details, not permission to replace the requested
behavior with assumptions. Ask the user when resolving them.

## Recorded clarifications

- Mobile selection: "Replace native selection with the long-hold Copy/Blacklist menu".
- Letter activation: "Double-click / double-tap a letter".
- Double-tap precedence: "left and right double taps remain. middle double tap toggles speed and bookmark loop buttons to be on or off. for the magnifier to get triggered, we do the little scroll part. when the magnifier gets triggered, the speed and bookmark loops will also get added. at that point when the magnifier, speed and bookmark and loop buttons are there, then doubel tapping from here will toggle the speed and bookmark and loop icons be turned off as well as magnifier toggled off with them. thats the only way to close magnifier once its opened."
- Autoplay scope: "auto play only affects entering an observation".
- Magnifier activation, in response to whether to keep the existing hold/hard-press on the main audio scrubber: "yes thats the existing one".
- Bookmark looping: "the loop should end when its another bookmark or it hits the end. if no earlier bookmark exists, it to just moves it to the start and toggles loop. if its single click it doesnt restart/move back to bookmark, it just toggles loop while keeping the playback where it is."
- Reading-page copy target: "Copy the entire displayed sentence".
- Settings text exception: "yes the patterns in settings can remain as it is (icons, but yes we need to text for basically all of it except the language icon in the bottom right), but all of the addiitons outside of it".

## Original requests-raw.md (verbatim)

The following is the original source text, not a second set of overriding
requirements. Use the recorded clarifications above to resolve conflicts.

<!-- BEGIN VERBATIM REQUESTS-RAW -->
we will be adding another types of displayed observation -- questions. 
so we will have 70% be normal obs as we have defined them and 30 will be these new questions.
75% of the questions will user observations which we have seen before, 25% will be user observations not seen before. When picking out of the pool or seen before or not seen before, it uses the same source weight + complexity sampling strategy. Next, a question can be either an audio-given question (where user types out the audio) or text-given question (where user speaks out the text). It will be 60% chance a question is an audio-given question and a 40% chance it is a text-given question. for audio-given questions, the page will have the audio bar with all its features of the normal observation, and this audio bar will by default by here. And we have scroll mode right but we should redefine that as toggle trigger has two options -> scroll mode and tap mode. so here, whatever the toggle trigger is, will bring in an onscreen virtual keyboard. this keyboard has 1/3 probability of either being a windows inscript keyboard, mac standard keyboard, or chromebook dictation keyboard. Above the keyboard will be a text entry which displays what has been typed. Once a text has been typed, it will stay even when the keyboard is swiped away. From here, they can click next to the answer page. The text-given page has the text displayed like normal. scroll brings in a record button. clicking record turns it red and begins audio recording. once initial recording done, audio bar pops ups with the same features as normal. except now, when we press record again it will overwrite/begin recording from where the cursor was placed. toggle trigger will remove the record button and toggle of magniying/icons but it will keep the audio bar and the ability for the magnifying and all the other audio bar features to be used. clicking next takes to the answer page. the answer page is just the normal looking page for the observation. 

can we have a setting in appearance called highlight mods which identifies the base letter, keeps its color, and then the the modification like the "i" addition, the "a" addition, those all get satured in the font color. I thin kthey are called like gunintahly hacchlau and vathulu I believe, but the letter part stays the same color in the text. turn setting on by default

custom cursor: only applicable in browser really, but a cursor is used on this site, it should be a color determined by the gradient, a bit darker or lighter (whichever one of those it is also pragmatically understood)

add a loop button: next to the playback speed button a loop button which loops the entire audio. double clicking the loop button would loop the closest bookmark before where the playback cursor currently is.

there is no more settings button. triple tap anywhere will toggle opening the settings page directly. double tap in the middle will now have no affect, except if the audio bar is up, it will serve as a trigger to toggle the playback, bookmark, and loop buttons. (the magnifier trigger will still also open all these, as well as the magnifier, but this double tap trigger wont open the magnifier)

when an audio reaches the end naturally (not having been paused at that exact moment at the end) and we then click the bookmark or seek back to an earlier part, it should actually automatically play instead of pause, because the stop in media was not due to a pause status, just the video ending. 

lets make the toggle to close the magnifying be a double tap instead of a single tap

when we click the settings button, we see the language button having a highlight around it like it been recently selected. this could be due to being shared space with the settings button, but this should be resolved as we changed that. 

lets remove the dummy source1, source2, source3

in the export page of the settings, we see theexoprt and download buttons be oddly spaced because vertically why are they that far away, I mean they could but the design is not cohesive and their hortizonal spacing is also like random in the page from the border and also between each other distance, and then also when we are within a certain settings page we see the setting we are on in then in tiny text its parent or where it came from, we dont like that tiny text anymore 

Any settins section which is multiple word like "playback speed", both words should be capitalized. 

why is the stop eon button a check box? and then you have the reset queue button which is random in text no button or border, and then you have the sampling one which is save with a check in the bottom right. and yea in terms of positioning all are different. they should all be standardized through all of them in the same design, same positioning. 

and when we navigate around settings, sometimes the buttons have this weird highlight color on the page you go to which highlights the button you clicked to get there but now that label has a different meaning. 

the same way which diagnostic shows within its section is the same way that sampling -> data sources should show information. both of these are showing information but, again, not in a standardized format. 

appearance should have further sub sections within it. 
for the colors, the background has the three circles under it, which seems fine, but then you look under and you see text and icons under it with its far right one, and this seems like a lack of a standardize dformat. and then you see settings and popover with its circle and then for some reason this hone has automatic surface as a button, which is highly unstandardized and what do this even do. and then control darkness has an explanation when none other ones do. and then under position we have "Text vertical pffset" being bigegr in size than "position itself". its literally every single element in this appearance page is not organized into a standardsized format. make it can be split by visual elements and each of those have their own color settings, position settings, and additional settings applying to that, with consistent organizing decisions and formats/structures used throughout. 

we need to add a password gating before the user id is clicked. the verification for what the required password is will be in fly secrets. we should be integrating this so that on a one time set up even in a iPhone mobile, it will detect a password typed and prompt to save in iPhone safari password and when visiting again, iPhone safari or any browser should auto detect the site and prompt to enter saved password

for the image generation prompt we should make <core word> optional actually, but a possible choice to be used. we can also used <sentence> which is the full sentence that was there when the word was clicked for the regeneration. instead of having a regen system, when a word is clicked and an image was already gen, there should just be an option to click next which if there was another image gen will show that, or if not will show the same image gen page as normal for the image to be generated, and it will add it to the catalogue of images for that word. and each image has an (i) for when it was generated, what sentence was there, etc. the option to go next or back or to see the (i) will only appear when an image is clicked, that is what toggles those controls to show. also when a word is double clicked and the image opens, the entire page should be used to display, while retain best pratcie spacing/standardization and remembering the principle of standardized forms throughout the app between settings, main page, etc. 

can we add codespaces usage as platform (the codespace which has the token to make deployments) to the costs.md as well?

can we have the settings have a telugu-now version section as well which gives the most recent deployment timestamp/date and some information like that.

complexity score should not only include grapheme count but also introduce a new metric, common word inclusion. common word inclusion makes a word have a lower complexity score, which skews ones with more graphemes to be more probable if they have a common word, and this can be a separate number edited in the complexity settings. 

when we double click a word, each letter at the top should be double clickable. when a letter is double clicked, it opens like a normal observation but with just that letter and then a tts recording in the audio for just that latter using pollinations api, except there is a back bar in the top left which takes back to the page for the word. one the word page, we will also be adding a generic web image search which will connect to serper.dev -- seprer.dev api key should be added to tokens.md and the costs should be added to costs.md. all images and tts will be stored permantly in database common to all users so if any user requests that same tts or image search it will use the already retrieved ones.

can we add a blacklist in the settings which holds sentences which we do not want to appear again. entire sentences not just words within sentences. you can block words if they are the only part comprising the entire "sentence". and the way to do this will be the right click we have to do the copy we will also have this have an icon which blacklists. and we will add mobile support for the equivalent to right click by doing a long hold to trigger that. and we will remove the option to copy just by holding and selecting, only through the hold we get this menu and from here you can copy. if someone wanted to copy only one word out of a longer sentence, they would double click first to open the word view, and there should be an option here to copy the text. and so when we open the word view by double clicking the word, it should actually be like this: we double click and we go to an entire full page with the word only at the top. then, we have icon for copy and then under that we have image which has option to generate (icon only) and then one to search (icon only), these will open the pages and controls as discussed earlier (like where the image has next and back options and exit options triggered to show by doing a single tap). and from this page when we click on a single letter we have the image we have discussed of opening the page where it has a normal observation view for a single letter. 

In settings, playback settings, appearance, and image gen should be their own sections. in playback settings we have playback speed and then also we should add a setting which disables the auto play of the audio when we go to a normal observations

remember, we never have text in the icons, just icons. 
<!-- END VERBATIM REQUESTS-RAW -->
