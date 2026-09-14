# Credentials

This file documents **what each credential is for, who consumes it, and where it
is stored**. It deliberately contains **no token values, secret keys, hashes, or
credential-bearing examples**, and none should ever be added to it or to any
other file in this repository. Read values only from the platform that stores
them.

## Credential table

| Credential | Storage location | Purpose |
|---|---|---|
| `pollinations_api_key` | Fly secrets | Server-side Pollinations image generation and letter text-to-speech |
| `SERPER_API_KEY` | Fly secrets | Server-side Serper.dev web image search for the word view |
| `ACCESS_PASSWORD_HASH` | Fly secrets | Verifies the shared access password before user-ID selection |
| `ACCESS_SESSION_SECRET` | Fly secrets | Signs the access-gate session cookie issued after a correct password |
| Tigris AWS-compatible credentials: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` if temporary credentials are used | Fly secrets | Access to the app's Tigris object storage |
| `FLY_API_TOKEN` | Repository GitHub Actions secret only | Authorize the Fly deployment that GitHub Actions runs on every push to `main` |

## Tigris: secret credentials versus non-secret configuration

Only the credentials above are secret. The rest of the Tigris configuration
identifies *which* bucket and endpoint to use and is not credential material:

| Setting | Storage location | Secret? |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | Fly secrets | Yes |
| `AWS_SECRET_ACCESS_KEY` | Fly secrets | Yes |
| `AWS_SESSION_TOKEN` (only when temporary credentials are used) | Fly secrets | Yes |
| `AWS_ENDPOINT_URL_S3` | Fly app environment configuration | No |
| `AWS_REGION` | Fly app environment configuration; defaults to `auto` | No |
| `BUCKET_NAME` | Fly app environment configuration | No |
| Object prefix / key layout within the bucket | Application configuration in this repository | No |

Creating a Tigris bucket through Fly sets several of these at once, which is why
they are easy to confuse. Treat only the access key, secret key, and session
token as secret; the endpoint, region, bucket name, and object prefix are
ordinary configuration and may appear in documentation and code.

## Access gate

The password gate uses a single shared password rather than per-user
credentials. The server stores only a verifier derived from that password in
`ACCESS_PASSWORD_HASH`, in the form `scrypt$<salt>$<derived key>`; the password
itself is never stored anywhere. `ACCESS_SESSION_SECRET` is an independent random
value used to sign the `tn_gate` session cookie, so a leaked cookie cannot be
forged without it. Both live in Fly secrets. When either is unset the gate is
inert, which is what allows local development to run without them.

## Deployment secret

`FLY_API_TOKEN` is stored **only** as a repository GitHub Actions secret. The
copy that used to exist as a Codespaces secret has been revoked, so the token is
no longer present in any development environment.

- **The name is the same everywhere.** The Actions secret is named
  `FLY_API_TOKEN`, and `ci-cd/deploy.sh` reads an environment variable of the
  same name. `.github/workflows/deploy.yml` passes
  `FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}` into the deploy step's
  environment. An earlier scheme stored the token under the placeholder label
  `API_TOKEN` and mapped one name onto the other; that indirection is gone.
- **Nothing reads the value.** GitHub exposes Actions secrets to workflow steps
  and masks them in logs, and the value cannot be read back out of the API. It
  must never be printed, logged, written to a file, passed as a command-line
  argument, or retrieved through a tool and passed back in. Keep shell tracing
  (`set -x`) off in any step that has it in scope.
- **Consequence for this repository's development environments.** Because the
  Codespaces copy is revoked, `./ci-cd/deploy.sh deploy` can no longer be run
  from the Codespace; it will fail with `FLY_API_TOKEN is missing`. Deployment
  happens through GitHub Actions. To deploy from a personal machine, export an
  app-scoped Fly deploy token into the shell first.
- **Rotation.** Create a new app-scoped Fly deploy token, update the repository
  Actions secret, then revoke the old token. No other location needs updating.

## Rotation and scope

- Fly secrets are set with `fly secrets set` and take effect on the next
  deployment of the app.
- The Fly deploy token should be app-scoped rather than organization-wide.
- Rotating `ACCESS_PASSWORD_HASH` changes the shared password; rotating
  `ACCESS_SESSION_SECRET` invalidates every existing gate session.
- All app users' generation, speech, and search requests use the server's single
  Pollinations and Serper keys, so usage and cost accrue to those accounts rather
  than to individual app profiles. See `costs.md`.
