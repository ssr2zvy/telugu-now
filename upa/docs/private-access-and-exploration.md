# Private access and upward exploration

This patch is based on `grammar` commit `e12fa583edf1a47ce6e4345452a2533544564ab9`. It preserves the previously applied comparison-navigation fixes. It does not deploy anything or contain an access phrase.

## Apply

From the repository root, with your existing work committed or otherwise saved:

```sh
git apply --check /path/to/extracted/changes.patch
git apply /path/to/extracted/changes.patch
```

The ZIP also includes replacement files under `files/`, preserving their repository paths. Use either the patch or replacement files, not both. If the patch check fails on a newer branch, reconcile the changes rather than overwriting newer work.

## Configure access before deploying

The application intentionally stays locked when its access secrets are absent or malformed. Install the patch, stage both secrets, and then deploy the frontend and backend together using your normal workflow.

On your own computer, in an interactive Bash terminal at the repository root, with Node 20+, Python 3 and the Fly CLI installed:

```sh
set -o pipefail
node upa/scripts/create-access-secret.mjs | fly secrets import --stage --app YOUR_APP
```

Replace `YOUR_APP` with the Fly app name. The helper privately prompts twice for your chosen Telugu sentence. Pasting is allowed. Use at least four words; choose an unpredictable phrase, not a familiar quotation. The plaintext is not placed in a command argument, shell history, file or repository. Only a salted scrypt verifier and a separate random session-signing secret go to Fly via standard input:

- `ACCESS_PASSPHRASE_HASH`
- `ACCESS_SESSION_SECRET`

Do not run the helper by itself when screen sharing: its standard output contains deployment secrets. Run the complete pipeline above. Python's private prompt requires an interactive terminal; on Windows use a suitable terminal/WSL with `python3` available.

The helper and server normalize Unicode to NFC and trim outer whitespace. Internal spaces remain significant. Maximum phrase size is 1024 UTF-8 bytes.

After staging succeeds, deploy as usual. The first page asks for the access phrase with Telugu-only wording and a native password field that supports paste and browser password autofill. After access succeeds, the existing profile-code screen appears as before. The access phrase does not create, reset or replace a profile.

Each device/browser needs to sign in initially. A secure, HttpOnly, SameSite cookie remembers that device for 30 days; clearing browser data or using a private session may require signing in again. A password manager may sync the saved phrase, depending on its settings. Use **Sign out** on the settings entry page to clear access on that browser. Run the setup command again and deploy the new secrets to invalidate all existing access sessions or recover from a forgotten phrase. No recovery phrase is stored in the repository.

## Protection and operational behavior

The server checks access before serving application routes, static assets, audio, images, parser operations, exports and profile APIs. Public exceptions are a minimal health response and the service-worker retirement script. Failed or missing configuration returns 503 rather than exposing the app. Mutating browser requests are checked for same origin.

Login verification is limited to five attempts per minute and thirty per hour across the app database, with only one expensive verification at a time per server process. Counters survive restarts in the existing application SQLite database. These limits do not throttle an already authenticated session. A hostile visitor can temporarily exhaust login attempts; these limits are not a network-level DDoS or billing cap.

The verifier uses scrypt with N=131072, r=8, p=1. Session signatures use a separate random key. Rotating either secret invalidates sessions. Logging out clears the current browser cookie; rotating secrets is the way to revoke copies of a session token.

Private responses are marked no-store. The old offline service worker is retired and its `telugu-now-` caches are removed. Previously open tabs may need a refresh after deployment to pick up the new gate; the new server still rejects their unauthenticated API calls. Offline application caching is intentionally removed. No existing profile, corpus, frequency or chain data is deleted.

Local Vite development proxies `/access` to the backend. Set the same two environment variables on the backend for local testing; development cookies work on local HTTP. Production uses Secure cookies and requires HTTPS. Do not commit environment files containing secrets.

References: [Fly secrets import](https://fly.io/docs/flyctl/secrets-import/), [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Reader behavior

Outside exploration, down continues to reveal the audio bar and then its associated controls. Up dismisses associated controls and then the bar. With the bar closed, up enters exploration when the observation text is available. Recording, microphone permission requests and pending recording saves must finish first.

For a three-word observation the sequence is:

1. Each complete Telugu grapheme of word one, then word one.
2. Each grapheme of word two, then word two, then words one and two together.
3. Each grapheme of word three, then word three.
4. The original complete observation returns with its audio bar restored when audio is available.

A one-word observation returns directly from its final grapheme to the original whole-word observation. Punctuation and spacing are retained in cumulative phrases. Graphemes keep combining marks together rather than exposing individual Unicode code units.

Down during exploration retraces these steps. Going backward past the first step returns to the original observation. Up/down touch gestures, mouse/trackpad scrolling and arrow keys use the same progression; wheel momentum is coalesced so one gesture does not race through several steps. Horizontal observation navigation retains the existing rules.

Exploration hides the audio bar, recording icon and comparison switch. Settings remain available. Copy and double-tap focus still work; a focused letter or word retains its original transcript offsets. Existing alignment endpoints and audio playback are reused for letter, word and cumulative phrase clips. Exploration never autoplays; a single click can play/pause the current snippet. Audio loading does not block moving between text steps, and stale responses are ignored. Alignment quality remains that of the existing service.

Exploration is temporary presentation state. It does not mark an answer, change the chain, advance core progress or alter the existing user profile. Leaving the observation resets exploration.

## Validation

Production build and TypeScript checking passed. Twenty-one focused tests passed across access control, actual Telugu scrypt verification, cookie validation/expiry/rotation, rate limits, exploration ordering and reverse traversal, wheel coalescing, existing alignment, comparison gestures, next-chain reset and request deadlines. Patch application is checked against the exact base commit.

Physical iPhone interaction, visual rendering and password-manager autofill are not device-tested here. Before using the deployment, verify: anonymous API requests are blocked; signing in then entering the profile code works; up/down reverses the exploration sequence; returning to the original observation restores its audio; and comparison forward/back remains functional.
