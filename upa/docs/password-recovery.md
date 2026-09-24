# One-time password recovery

Base: grammar 99cec0c94d05aae4c37f9dbdde83112b7e1a2c9c.

## Use this recovery patch first

Apply `changes.patch` from the repository root using `git apply --check /path/to/changes.patch` then `git apply /path/to/changes.patch`. Deploy grammar with your existing deployment workflow. No console command, old password or new Fly secret is needed.

Open the website. The generation page reopens even though a password is already stored. Generate or enter a new phrase, COPY AND SAVE IT in your password manager, then press the confirmation arrow. Generation alone does not overwrite anything. Confirmation atomically replaces the password verifier and session-signing key, signs this browser in, and closes setup immediately. The previous password and sessions cease to work. Profile codes, progress, corpus and images are untouched.

This is the expressly requested temporary public recovery: the first successful confirmation claims the replacement password. A volume marker makes the replacement one-time across server restarts and repeated deployments of this patch. Competing confirmations cannot overwrite the winner. The old credentials remain stored until confirmation succeeds; failed writes roll back both the replacement and recovery marker.

The page removes default input focus outlines, shadows and tap highlighting, retains an underline focus indication, and styles WebKit autofill. Generating no longer forcibly focuses the input or opens the mobile keyboard. Copy/paste and password autofill remain enabled. Native browser/password-manager popovers and deliberate text-selection highlighting are controlled by the browser.

## After saving the replacement

Apply the accompanying **recovery-finalize** ZIP and deploy again. Use this revised cleanup ZIP instead of the older permanent-login ZIP, whose gate file predates this recovery patch.

The cleanup removes public generation/setup and the recovery implementation. It preserves the new verifier, session key and volume marker. Missing or malformed credentials fail closed. The normal login page keeps the input styling fix.

For replacement-file installation instead of git apply, copy `files/` over the repository and delete every path listed in `deleted-files.txt`. Do not use both installation methods. Neither patch changes deployment YAML, Fly configuration or live data by itself.

## Verification

Recovery build/typecheck and 15 focused tests passed, including concurrent replacement, old-session rejection, profile preservation, persistence across reopening, rollback on failed updates, setup closure and real Telugu password verification. Cleanup is built/typechecked and tested separately. Physical iPhone rendering is not device-tested here.
