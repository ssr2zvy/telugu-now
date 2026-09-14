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
| `FLY_API_TOKEN` | Codespaces secret, exposed to the Codespace environment | Authorize manual Fly deployments from the Codespaces machine |
| `API_TOKEN` | Repository GitHub Actions secret, populated from the Codespaces `FLY_API_TOKEN` | Authorize GitHub Actions deployment when that workflow is enabled |

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

## Deployment secret setup (pending task)

The GitHub Actions deployment workflow is disabled scaffolding. Before it can
ever be enabled, the repository needs an Actions secret named `API_TOKEN`, whose
value is the same Fly deploy token already present in the Codespace as
`FLY_API_TOKEN`.

- **Source:** `FLY_API_TOKEN`, a Codespaces secret exposed to the Codespace
  environment.
- **Destination:** `API_TOKEN`, a repository GitHub Actions secret.
- **The names deliberately differ.** `API_TOKEN` is only the *storage name* of
  the GitHub Actions secret; it is a placeholder label, not a second credential.
  The value is the Fly deploy token, and the variable the deployment actually
  consumes is `FLY_API_TOKEN`. `.github/workflows/deploy.yml` therefore maps
  `secrets.API_TOKEN` onto the `FLY_API_TOKEN` environment variable that
  `ci-cd/deploy.sh` reads, so the two names should not be conflated.

Run the transfer so the value moves directly from the environment into the
GitHub CLI's standard input:

```bash
printf '%s' "$FLY_API_TOKEN" | gh secret set API_TOKEN --repo ssr2zvy/telugu-now
```

The value must never be read, inspected, printed, logged, written to a file, or
passed as a command-line argument, and it must never be retrieved through a tool
and then passed back in. `printf` is a shell builtin, so the value does not
appear in the process list; keep shell tracing (`set -x`) off while running it.

Setting this secret does **not** authorize enabling the disabled workflow and
does **not** authorize a deployment. It is a pending setup step only.

## Rotation and scope

- Fly secrets are set with `fly secrets set` and take effect on the next
  deployment of the app.
- The Fly deploy token should be app-scoped rather than organization-wide.
- Rotating `ACCESS_PASSWORD_HASH` changes the shared password; rotating
  `ACCESS_SESSION_SECRET` invalidates every existing gate session.
- All app users' generation, speech, and search requests use the server's single
  Pollinations and Serper keys, so usage and cost accrue to those accounts rather
  than to individual app profiles. See `costs.md`.
