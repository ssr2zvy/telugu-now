# Two-stage volume-backed access rollout

Base: grammar ce52166cacc48d3f4048e6dc402fae6bd415eeb3 (PR #93).

## Order matters

1. Apply ZIP 1, **temporary-access-setup**, and deploy through your existing workflow.
2. Open the site immediately. Enter a phrase of at least four words or press the dice icon to generate ten Telugu words from Core 1–3 vocabulary. The eye shows/hides it. Copy it with the copy icon and save it in your password manager. The arrow confirms and claims access. Generation and copying alone do not claim access.
3. Confirm that you reach the normal profile-code screen. Keep your saved phrase. Optionally confirm a login in a separate private browser window before proceeding.
4. Apply ZIP 2, **permanent-access-login**, on top of ZIP 1, and deploy again. Do not apply ZIP 2 before you have successfully saved a password, unless valid legacy access secrets already exist.

You do not need to run a local password helper or create new Fly secrets for this flow. These patches do not change deployment YAML or fly.toml and do not themselves deploy anything.

Each ZIP includes `changes.patch`, replacement files under `files/`, a manifest and `deleted-files.txt`. From the repository root, use `git apply --check /path/to/changes.patch`, then `git apply /path/to/changes.patch`. Alternatively copy the replacements and delete exactly the listed files. Use one method, not both. The second patch is sequential, not an alternative to the first.

## What is saved

A singleton row in `access_credentials` in the application's existing volume-backed database stores a salted scrypt password verifier, random session-signing key and creation timestamp. Default Fly path: `/data/user/users.sqlite`; it follows the existing DATA_DIRECTORY/DATABASE_PATH configuration. It is separate from profile codes and profile progress. No plaintext passphrase is saved or logged. Back up and protect this database as credential-bearing data.

The row is inserted atomically, never replaced. Concurrent setup confirmations cannot overwrite the winner. Invalid existing data fails closed instead of reopening registration. A password is site-wide; entering your profile code remains a separate step after access.

For compatibility, if the volume has no credential row but both valid ACCESS_PASSPHRASE_HASH and ACCESS_SESSION_SECRET already exist, they are imported automatically without changing the password or sessions. Setup will not appear in that case. Partial or malformed old secrets fail closed. Once the row exists, it is authoritative: later edits to those environment secrets do not rotate the volume credentials. Keep old secrets untouched during this rollout; no secret changes are needed.

## Temporary setup

The first successful confirmation becomes the owner. Anyone reaching this temporary deployment first can claim it; this is the expressly chosen temporary setup model. A setup page visit or generation request does not reserve ownership. After a successful claim, setup and generation requests return 409 immediately, even before ZIP 2 is deployed.

The setup page has no heading, uses icons, and uses only brief Telugu labels/errors. It supports paste and browser new-password autofill. Generated phrases use ten independent cryptographically random selections, with replacement, from 827 unique single-word Telugu forms explicitly present in Core 1, 2 or 3 vocabulary in the parser graph. Multiword forms, non-Telugu forms and entries over 96 UTF-8 bytes are excluded. Repeated words are possible and valid. The static dictionary is public; randomness, not word-list secrecy, protects the generated phrase.

The ten-word generator has about 96.9 bits of selection entropy. Manually chosen phrases do not receive that guarantee. NFC normalization and outer trimming are applied; internal spacing remains significant. Keep the copied generated phrase intact.

Setup/generation and login are bounded by the existing per-database attempt limits (five per minute and thirty per hour). A visitor can temporarily exhaust attempts; this is not network-level DDoS protection. Copying does not send the phrase to a third-party service. Browser clipboard permissions may require manually selecting and copying the field.

## Permanent login-only deployment

ZIP 2 removes the setup UI, password generator, generation dictionary, and setup handlers. Requests to `/access/setup` and `/access/generate` return 404 regardless of authentication. The only normal access flow is password validation against saved credentials followed by the existing profile-code flow. If credentials are missing or invalid, the app stays locked; it never reopens public setup.

The saved session-signing key remains unchanged, so sessions issued by ZIP 1 continue to work after ZIP 2. Cookies keep the existing 30-day lifetime and sign-out behavior. If the credential database is lost, restore a trusted backup; there is no public password reset endpoint. No credentials or corpus data are deleted by either patch.

## Verification

Both builds are typechecked and production-built. Tests cover the real Telugu password verifier, generation membership/length, setup syntax, two-server claim races, immediate endpoint closure, persistence across database reopening, blocked anonymous requests, rate limits, and login-only behavior. A separate transition check reuses a database and session created through ZIP 1 with ZIP 2.

Physical iPhone appearance, clipboard permissions and password-manager behavior still require device verification. No real password, secret or user data is included in these ZIPs.
