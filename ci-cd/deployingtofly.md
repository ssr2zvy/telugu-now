# Deploying telugu-now to Fly.io

## Repository layout

```text
.github/workflows/deploy.yml       GitHub Actions trigger and runner setup
ci-cd/deploy.sh                    Shared deploy, stop, and cancel commands
ci-cd/Containerfile                Multi-stage container build
ci-cd/make-artifacts.sh            Application build entry point
ci-cd/container-scripts/entrypoint.sh
fly.toml                          App configuration
local_machine/                    Local development and data tooling
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

Store the complete value in the repository's **Settings > Secrets and variables >
Actions** as `FLY_API_TOKEN`. Renew it before expiry. Never put the token in the
repository, build arguments, or workflow YAML. For local commands, securely
export it as `FLY_API_TOKEN`; the script deliberately requires this variable
rather than depending on a machine's cached login.

Deployment and stop commands require `flyctl`; stop also requires `jq`.
The Actions runner installs Fly CLI and includes `jq`. Missing tools, missing
tokens, or failed app-access checks exit nonzero before deployment or stopping.
Network failures and expired or insufficiently scoped tokens are not bypassed.
Runtime Tigris and image-generation credentials remain separate Fly secrets;
they are not supplied by the GitHub deployment token.

## Automatic deployment after merging

1. Work on a dedicated `copilot/*` branch created from `main`.
2. Validate the changes, commit, push, and merge the pull request into `main`.
3. A push to `main`, including a PR merge, triggers `.github/workflows/deploy.yml`.
4. Actions checks out the exact triggering revision, installs Fly CLI, and runs
   `bash ci-cd/deploy.sh deploy` with the secret token.
5. The script resolves its own repository root, checks prerequisites and app
   access, then runs:

```bash
flyctl deploy . --config fly.toml --remote-only --ha=false --wait-timeout 5m
```

The workflow has read-only repository permissions and pins its third-party
actions to commit revisions. Production operations share a concurrency group
with `cancel-in-progress: false`, so a new push does not interrupt an active
rollout. GitHub may replace an older pending run with the newest pending run.
Local invocations do not participate in GitHub's concurrency group; do not run
local deploy/stop commands while an Actions deployment is active.

All pushes to `main` trigger deployment, including documentation-only changes
and direct pushes. Feature branch pushes and unmerged PRs do not. This workflow
is not a required pre-merge test gate; the container build does typecheck and
build the application. Use branch protection if direct pushes must be forbidden.
The workflow can also be run manually from the Actions tab on `main`, selecting
`deploy` or `stop`.

Fly does not watch GitHub itself. Previously deployment required a manual
`flyctl deploy` after merging; GitHub Actions now supplies that invocation.
If the token secret is absent, the workflow fails clearly and leaves the
existing deployment untouched.

## Manual commands

These commands work from any current directory when the script path is correct:

```bash
./ci-cd/deploy.sh deploy
./ci-cd/deploy.sh stop
./ci-cd/deploy.sh cancel 123456789
```

`deploy` builds the current local checkout, including uncommitted changes.
For production, use a clean checkout of the merged `main` revision; the
automatic workflow supplies this consistently.

`stop` lists the app's Machines and stops them without destroying Machines,
volumes, or Tigris data. Storage charges continue. The current `fly.toml` sets
`auto_start_machines = false`, so traffic does not restart the stopped app.
A subsequent deployment can start it again. Stopping does not disable the
workflow: the next push to `main` will deploy again. To keep it offline, disable
the workflow in GitHub and cancel any pending/active runs before stopping.
Prefer the workflow's manual `stop` action to serialize it with CI deployments.
If stopping multiple Machines fails partway through, some may already be stopped;
the command reports failure rather than claiming success.

`cancel RUN_ID` uses GitHub CLI authentication (`gh auth login` or `GH_TOKEN`
with Actions read/write permissions), not `FLY_API_TOKEN`. It verifies that the
run belongs to this repository's deployment workflow on `main` before requesting
cancellation. Find IDs with:

```bash
gh run list --repo ssr2zvy/telugu-now --workflow deploy.yml
```

Cancellation is a request, not confirmation that all remote work has stopped.
Inspect the run and Fly app before issuing another production operation.
For a local foreground deployment, use Ctrl+C. Neither local interruption nor
Actions cancellation rolls back changes already applied, guarantees that a
remote build stops, or cancels other queued runs. It does not intentionally
stop the live app. To undo a deployed code change, revert it through a PR to
`main` and let the workflow deploy the reverted revision. No destructive
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
as a failed script/workflow; a failed rollout can have already modified remote
state and must be inspected rather than assumed to have rolled back.
