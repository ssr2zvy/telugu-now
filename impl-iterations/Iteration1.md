Implementation iteration 1
Hosting decided: Fly.io (not relevant in iteration)
Stack: TypeScript + React + Vite + Hono + Node.js + SQLite.
Undecided: backup mechanisms
1 — Persistent history and rolling observation queue
1.1 — Current observation and user history
At all times, the app maintains a persistent history of every observation the user has actually displayed. Each history entry records the observation, the presentation state needed to reproduce what the user saw, and the time associated with that viewing.
The user’s current position within that history is also persisted, so closing and reopening the app restores the exact observation and history position where the user left off.
1.2 — Time spent on the current observation
Q While an observation is current, the app persists when that viewing period began.
If the user leaves the app while still on that observation, the observation remains current. When the user later returns, the elapsed wall-clock time while away continues to count toward that observation, according to the intended behavior of the app.
The implementation should additionally retain visible/in-app elapsed time separately so that wall-clock time and actual visible time can be distinguished later without changing the current behavior.
1.3 — Relaunch behavior
When the app launches, it first restores the user’s persisted current observation and history position.
If the user had moved backward within their existing history before leaving, the app restores that position. Moving next from there walks forward through the already-existing history before consuming any new observations.
1.4 — Unseen observation queue
Separate from history, each user has an ordered queue of observations that have been selected but have not yet been displayed.
This queue is persistent across sessions.
Leaving the app does not discard the remaining unseen observations, and reopening the app does not randomly replace them.
1.5 — Initial queue size
The app aims to maintain 10 unseen observations ahead of the end of the user’s existing history.
For a first-time user, or when no unseen queue exists, the app selects 10 observations.
For a returning user with an existing queue, the existing unseen observations are restored. The app only selects enough additional observations to restore the queue to its required size if observations are missing.
The current displayed observation is not included in this count of 10.
1.6 — Selecting observations
When new observations are required, the app selects their data sources using the weighted source-selection process described later.
It then selects observations from those sources using the source-specific sampling and complexity rules described later.
An observation is one unit that can ultimately be displayed by the application. It is not necessarily equivalent to one row in an upstream dataset. A source-specific adapter is responsible for translating source-native rows or records into observations.
1.7 — Queue order
The order of newly selected observations is fixed when they are added to the queue.
Media downloading may complete in a different order, but completion order does not change the order in which observations will be displayed.
This prevents media size or network speed from unintentionally influencing which observations the user encounters first.
1.8 — Full observation preparation
For each queued observation, the source-specific adapter resolves the source record and determines the Unicode text and media required by that observation.
For the current implementation, an observation consists of rendered Unicode Telugu text together with its corresponding audio.
The required audio must be fully downloaded before that observation is considered ready for display. A remote audio URL by itself does not count as a prepared observation.
The downloaded media and parsed observation information are stored or cached in app-controlled storage and/or on the user’s device according to the storage design.
1.9 — Preparation of multiple observations
When the app is initially preparing 10 observations, or later preparing a replenishment group of 5, those observations may be resolved and downloaded concurrently.
The user does not have to wait for the entire group to finish.
As soon as the next observation in queue order has been completely resolved and its required media has been fully downloaded, that observation is ready.
1.10 — Availability of Next
The Next action is available whenever the next observation that should be shown is ready.
Therefore, while the system may still be downloading the other observations in the current group of 10 or 5, the user may continue as soon as the immediately following observation is fully prepared.
If the user catches up to the downloader and the next observation in sequence is not yet ready, Next temporarily becomes unavailable until that observation finishes preparing.
1.11 — Consuming observations
When the user advances beyond the end of their already-seen history, the first ready observation in the unseen queue becomes the new current observation.
At that point it is removed from the unseen queue and permanently appended to the user’s history.
Once an observation has been displayed, it is no longer speculative queued data; it is persistent history and can always be revisited with Back.
1.12 — Rolling replenishment
The queue is initially provisioned to approximately 10 unseen observations.
After the user has consumed 5 observations from that prepared-ahead set, the app begins selecting and fully preparing 5 additional observations.
For example:
Initially:

current
   ↓
 [1]

queued ahead:
2 3 4 5 6 7 8 9 10 11
After five have been consumed:
current
            ↓
1 2 3 4 5 [6]

remaining ahead:
7 8 9 10 11

begin preparing:
12 13 14 15 16
Once preparation finishes, the user again has approximately 10 unseen observations available ahead.
This process repeats in groups of 5.
1.13 — Leaving while preparation is in progress
If the user leaves while some queued observations are still downloading, their selection and queue positions are preserved.
Completed observations remain ready.
Observations whose media download was incomplete remain selected and are resumed or restarted when execution continues.
They are not replaced with newly randomized observations merely because the app was closed.
1.14 — Back and forward through existing history
Back moves to the preceding entry in persistent history.
If the user has moved backward, Next first moves forward through observations that already exist in history.
For example:
A B [C] D E
Next goes to D, then E.
It does not consume a new queued observation until the user reaches the existing history tail and advances beyond it.
1.15 — Overall flow
The resulting flow is:
launch
  ↓
restore profile + current history position
  ↓
restore persistent unseen queue
  ↓
top queue up to initial target if necessary
  ↓
fully prepare queued observations
  ↓
next required observation becomes ready
  ↓
Next enabled
  ↓
user advances
  ↓
observation moves from queue → persistent history
  ↓
after 5 new observations consumed
  ↓
prepare 5 more
So the fundamental state is now cleanly divided into persistent seen history, persistent ordered unseen queue, and fully prepared media associated with those observations.

1.16 — Initial empty-history state

For a first-time user with no existing history, the app begins with no current observation and a blank display state. Back is unavailable because no previous history entry exists.

The initial blank state is not treated as an observation and does not create a history entry or elapsed-time record. Once the first queued observation is fully prepared, the first Next action displays it and creates the user’s first history entry.

Whenever the user is positioned at the first entry in their existing history, Back remains unavailable because there is no earlier observation to navigate to.

6 — Global visual presentation

6.1 — Background

The application uses the same grey-gradient background across every application state and screen.

6.2 — User-facing language

The application contains no English in its user-facing interface.

Internal implementation details—including source metadata, database fields, logs, code, configuration keys, and internal identifiers—may use English because they are not displayed to the user.

⸻

8 — Initial entry and profile loading

8.1 — Initial screen

When the app/site first opens, no profile is loaded and no observation is current.

The screen displays only a blank 3-digit profile-code input bar centered on the page, against the application’s standard grey-gradient background.

This entry screen is not an observation and does not create history or timing data.

8.2 — Profile-code input

The input accepts a 3-digit profile code.

When the user enters a valid configured code, the application loads the persistent profile associated with that code.

8.3 — Meaning of the profile code

The three-digit code is intentionally a profile identifier and selector, not an authentication mechanism.

Anyone who knows a valid code can load that profile.

This is an accepted property of the application because the stored profile information is not treated as sensitive or private.

8.4 — Configured valid codes

The set of valid three-digit profile codes is predefined by the application.

For the prototype, these codes may be hardcoded in server-side application configuration or supplied through deployment environment configuration.

The server-side configuration is authoritative for determining whether a code is valid; the application should not depend on a client-side list as the authority.

8.5 — Invalid codes

If the entered 3-digit code is not valid, no profile is loaded and the application remains in the initial entry state.

Any indication that the code is invalid must follow the application’s no-English user-interface requirement.

8.6 — Returning profile

If the valid profile already has history, the application restores its persistent state according to Point 1, including:

	•	its exact current position in history;
	•	the observation that was current when the user last left;
	•	its timing state;
	•	its previously seen history;
	•	its persistent unseen observation queue; and
	•	the preparation/download state of queued observations where applicable.

The restored current observation is then displayed.

8.7 — Profile with no history

If the valid profile has never displayed an observation before, the application enters the initial empty-history state defined in Point 1.

The observation area is blank, Back is unavailable, and the first prepared observation is shown only after the user’s first Next action.

8.8 — Profile state persistence

The profile code identifies the same persistent profile across sessions and devices.

Entering the same code later therefore resumes that profile’s existing progress rather than creating a new session-specific progression.


MOCKING THE REST:
Mocking — Implementation Iteration 1
	•	Real source-selection path: The application’s actual source-selection logic is implemented normally. For Iteration 1, the only configured/enabled data source is MockDataSource, so every source selection resolves to that source.
	•	Mock source implementation: MockDataSource implements the same application-owned source interface that real sources such as FLEURS or IndicVoices will later implement. When the application requests an observation from it, the mock source calls an in-process mock data-returner instead of making an external network request. This keeps the test double at the boundary the application owns rather than embedding mock conditions throughout the core. 
	•	Mock response delay: Each call to the mock data-returner waits for an independently selected random duration between 1 and 60 seconds before completing.
	•	Mock observation data: After the delay, the mock data-returner returns a random valid Telugu string consisting of approximately two Telugu graphemes/characters, together with a unique mock observation/source identifier so different observations remain distinguishable even if they happen to contain the same Telugu text.
	•	Iteration 1 preparation policy: Observation requests are initiated one at a time in queue order for this iteration. This is an Iteration 1 execution policy, not part of the MockDataSource contract and not a permanent architectural requirement; bounded concurrent preparation may replace it later without changing the source interface, history, or queue model.
	•	Development-only diagnostic display: Beneath the Telugu text, the app temporarily displays diagnostic information showing:
	•	whether the observation was selected as part of a launch/initial queue fill or a five-observation rolling replenishment;
	•	the size of that preparation group;
	•	the observation’s position within that group;
	•	the mock request start time;
	•	the mock request completion time; and
	•	the total mock request duration.
	•	Diagnostic UI is temporary: The diagnostic subtext exists solely to verify Iteration 1 behavior and is removed from the final user-facing application.
	•	Prototype profile: The configured profile code for Iteration 1 is 001. It is registered and validated through the same actual profile-code mechanism that future profile codes use; there is no special-case 001 logic elsewhere in the application.

Yes. I’d add a section like this to the iteration spec.
Project control script — 
control-project.sh
	•	Single project-control entry point: The repository includes a root-level executable shell script named control-project.sh for controlling tests, builds, and the development server.
	•	Supported command domains: The script supports exactly these top-level commands for Iteration 1:
	•	test
	•	build
	•	dev
	•	Command-scoped status: Each invocation operates on only the requested command domain. Before taking any action, the script determines and reports the current status of that requested domain only.
	•	Status-driven options: After reporting status, the script computes the actions that are valid for the requested domain in its current state and displays only those available actions.
	•	Interactive operation: If no --option argument is supplied, the script prompts the user to choose one of the currently valid options.
	•	Noninteractive operation: The caller may provide --option

---

## Completion State
The implementation of Iteration 1 is complete as of commit hash: `bc2b42d762d3f38669da8231824433c388585d45`