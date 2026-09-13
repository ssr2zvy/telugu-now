# Deploying telugu-now to Fly.io

## Repository layout

```text
.github/workflows/deploy.yml       Disabled GitHub Actions scaffolding
ci-cd/deploy.sh                    Shared deploy, stop, and cancel commands
ci-cd/Containerfile                Multi-stage container build
ci-cd/make-artifacts.sh            Application build entry point
ci-cd/container-scripts/entrypoint.sh
fly.toml                          App configuration
local-machine/                    Local development and data tooling
upa/                              Application source
```

The build context is always the repository root, not `ci-cd/` or `upa/`.
Fly reads `[build] dockerfile = "ci-cd/Containerfile"` in `fly.toml`.
`Containerfile` uses Dockerfile syntax; the configuration key remains
`dockerfile`. The root `.dockerignore` allowlists build inputs and excludes
credentials, local data, dependencies, and generated artifacts. Deployment
scripts and GitHub credentials are not copied into the application image.

## Authentication setup

Create an app-scoped deploy token from an authenticated Fly CLI:

```bash
flyctl tokens create deploy --app telugu-now --expiry 720h
```

Store the complete value as a **Codespaces secret** named `FLY_API_TOKEN`, with
access granted to this repository. Restart an existing Codespace after adding
or updating the secret so new processes receive it as an environment variable.
Renew it before expiry. Never put the token in the repository or build arguments.
Outside Codespaces, securely export it as `FLY_API_TOKEN`; the script deliberately
requires this variable rather than depending on a machine's cached login.

Deployment and stop commands require `flyctl`; stop also requires `jq`.
Install these tools in the Codespace if needed. Missing tools, missing
tokens, or failed app-access checks exit nonzero before deployment or stopping.
Network failures and expired or insufficiently scoped tokens are not bypassed.
Runtime Tigris and image-generation credentials remain separate Fly secrets;
they are not supplied by the Codespaces deployment token.

## Deploying from Codespaces after merging

1. Work on a dedicated `copilot/*` branch created from `main`.
2. Validate the changes, commit, push, and merge the pull request into `main`.
3. Update a clean deployment checkout to the merged `main` revision. Do not
   discard local edits or deploy an unmerged feature branch.
4. From that checkout, run `bash ci-cd/deploy.sh deploy` in the Codespaces terminal.
   The script receives `FLY_API_TOKEN` from the Codespace environment.
5. The script resolves its own repository root, checks prerequisites and app
   access, then runs:

```bash
flyctl deploy . --config fly.toml --remote-only --ha=false --wait-timeout 5m
```

There is no active automatic deployment: pushes and merges to `main` do not
deploy anything. Fly does not watch GitHub itself.
`.github/workflows/deploy.yml` is retained as disabled scaffolding: its push
trigger is commented out and its deployment job uses `if: ${{ false }}`.
Even manual dispatch skips the job. No Actions secret or self-hosted runner
is required for the current Codespaces deployment method.

To enable the scaffold later, configure an Actions secret named `FLY_API_TOKEN`,
replace the false job condition with `github.ref == 'refs/heads/main'`, and
uncomment the push-to-main trigger. A Codespaces secret is not available to
GitHub-hosted Actions runners. The scaffold preserves pinned action revisions,
read-only repository permissions, and serialized deploy/stop operations.

Keep the Codespace running until deployment completes. Once deployed, the app
runs on Fly independently of the Codespace. There is no local concurrency queue;
run one deployment or stop operation at a time, and ensure any legacy Actions
run is finished or cancelled first. The container build typechecks and builds
the application; validate changes before merging as usual.

If the token is absent or app access fails, the script exits before modifying
the existing deployment.

## Manual commands

These commands work from any current directory when the script path is correct:

```bash
./ci-cd/deploy.sh deploy
./ci-cd/deploy.sh stop
./ci-cd/deploy.sh cancel 123456789
```

`deploy` builds the current local checkout, including uncommitted changes.
For production, use a clean checkout of the merged `main` revision; the
deployment script does not update or switch Git branches for you.

`stop` lists the app's Machines and stops them without destroying Machines,
volumes, or Tigris data. Storage charges continue. The current `fly.toml` sets
`auto_start_machines = false`, so traffic does not restart the stopped app.
A subsequent manual deployment can start it again. A push to `main` alone
will not restart it. Cancel any legacy pending/active Actions runs before stopping;
removing a workflow file does not cancel runs that were already queued.
If stopping multiple Machines fails partway through, some may already be stopped;
the command reports failure rather than claiming success.

`cancel RUN_ID` is retained only for legacy GitHub deployment runs. It uses
GitHub CLI authentication (`gh auth login` or `GH_TOKEN`
with Actions read/write permissions), not `FLY_API_TOKEN`. It verifies that the
run belongs to this repository's deployment workflow on `main` before requesting
cancellation. Find IDs with:

```bash
gh run list --repo ssr2zvy/telugu-now
```

Cancellation is a request, not confirmation that all remote work has stopped.
Inspect the run and Fly app before issuing another production operation.
For a local foreground deployment, use Ctrl+C. Neither local interruption nor
Actions cancellation rolls back changes already applied, guarantees that a
remote build stops, or cancels other queued runs. It does not intentionally
stop the live app. To undo a deployed code change, revert it through a PR to
`main`, update the deployment checkout, and manually deploy the reverted revision. No destructive
automatic rollback is attempted on deployment failure.

## Build and runtime behavior

Fly builds `ci-cd/Containerfile` remotely and pushes the image to its internal
`registry.fly.io/telugu-now` registry. The stages install dependencies, build the
frontend/backend/worker with `ci-cd/make-artifacts.sh`, prune development
dependencies, and package the runtime with `gosu` and `ffmpeg`.

Fly updates the existing app Machines with the new image and configuration.
`--ha=false` avoids adding spare Machines; this app uses one persistent SQLite
volume and does not rely on replicated volume data. The `telugu_now_data`
volume remains mounted at `/data`; changing application images does not erase it.
A single-Machine rollout may briefly interrupt service.

The entrypoint prepares mounted directories, drops root privileges with `gosu`,
and executes the Node server. The server reuses an existing `corpus.sqlite`
(downloads it from Tigris only if missing) and rebuilds `availability.sqlite`
from Tigris inventory before serving, with the background availability worker
disabled. Fly monitors the `/api/health` check during deployment.

The app is served at https://telugu-now.fly.dev/. Deployment failures surface
as a failed script; a failed rollout can have already modified remote
state and must be inspected rather than assumed to have rolled back.
