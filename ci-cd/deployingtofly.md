# Deploying telugu-now to Fly.io

## Repository layout

```text
.github/workflows/deploy.yml       Manual-only GitHub Actions deployment
local-machine/control_local.sh    Push main and dispatch with the deploy command
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

## GitHub Actions authentication

The controller's `deploy` command requires `git`, `gh`, permission to push to
`origin/main`, and GitHub CLI authentication with Actions write permission for
this repository. Authenticate with `gh auth login` or an appropriate `GH_TOKEN`.
Follow any branch-protection rules; the controller does not bypass them.

The workflow requires a repository **Actions secret** named `FLY_API_TOKEN`
containing an app-scoped Fly deploy token. A Codespaces secret alone is not
available to GitHub-hosted runners. The workflow installs `flyctl` itself;
the controller does not require a local Fly CLI or Fly token and does not load
`local-machine/dev.env` or `local-machine/dev-secrets.env` for deployment. Keep
file-based local dev secrets in the latter, Git-ignored file, not in tracked files.

## Direct Fly CLI authentication

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

## Push and explicitly deploy

1. Work on a dedicated `copilot/*` branch created from `main`.
2. Validate the changes, commit, push, and merge the pull request into `main`.
3. Check out `main` and bring it up to date, for example with `git pull --ff-only`.
   Preserve local edits first; do not discard them to make the checkout clean.
4. From the repository root, explicitly request deployment:

```bash
bash local-machine/control_local.sh deploy
```

From `local-machine/`, use `bash control_local.sh deploy`. The command resolves
the repository regardless of the current directory. `deploy --help` prints usage
without pushing or dispatching anything. There is no interactive menu or
`--option` argument for deployment.

The command requires a clean working tree on `main`, including no staged or
untracked changes. It does not stage, commit, merge, switch branches, or force
push. Stop local dev and deliberately checkpoint/commit changed dummy SQLite
data before deploying if that test data is part of the intended commit.

After checking prerequisites it runs exactly these remote operations, in order:

```bash
git push origin main &&
gh workflow run deploy.yml --ref main -f action=deploy
```

If the push fails, no workflow is requested. If dispatch fails, the push remains
completed; fix GitHub authentication or workflow availability and retry only the
`gh workflow run` command. Successful dispatch means the deployment was requested,
not that the build or rollout succeeded. Inspect it with:

```bash
gh run list --workflow deploy.yml --branch main
gh run watch RUN_ID --exit-status
```

The workflow deploys the `main` revision captured at dispatch time; the controller
does not pin a separate commit SHA if another push advances `main` between push
and dispatch. GitHub checks out the triggering revision and serializes deploy/stop
runs without cancelling an earlier run. The Codespace can close after dispatch.

Ordinary pushes and merges to `main` do not deploy. The workflow has only a
`workflow_dispatch` trigger and accepts runs only from `main`. This policy takes
effect once the workflow change reaches remote `main`; it does not cancel runs
already queued or running. Fly does not watch GitHub itself.

To deploy code already on `main` without another push, run the `gh workflow run`
command directly or select **Actions > Fly deployment > Run workflow**, choose
`main`, and select `deploy`. Select `stop` to stop Machines instead. A local
environment variable such as `DEPLOY=true git push` does not trigger deployment.

## Direct deployment alternative

`bash ci-cd/deploy.sh deploy` still deploys the current checkout directly using
the local `flyctl` and `FLY_API_TOKEN`, without a Git push or GitHub workflow.
It checks app access, then runs:

```bash
flyctl deploy . --config fly.toml --remote-only --ha=false --wait-timeout 5m
```

Keep the Codespace running until a direct deployment completes. Once deployed,
the app runs on Fly independently. Direct commands do not share the Actions
concurrency queue; do not overlap them with other local or Actions deploy/stop
operations. The container build typechecks and builds the application; validate
changes before merging as usual.

If the token is absent or app access fails, the script exits before modifying
the existing deployment.

## Direct commands and cancellation

These commands work from any current directory when the script path is correct:

```bash
./ci-cd/deploy.sh deploy
./ci-cd/deploy.sh stop
./ci-cd/deploy.sh cancel 123456789
```

The direct script's `deploy` builds the current local checkout, including uncommitted changes.
For production, use a clean checkout of the merged `main` revision; the
deployment script does not update or switch Git branches for you.

`stop` lists the app's Machines and stops them without destroying Machines,
volumes, or Tigris data. Storage charges continue. The current `fly.toml` sets
`auto_start_machines = false`, so traffic does not restart the stopped app.
A subsequent manual deployment can start it again. A push to `main` alone
will not restart it. Cancel any pending/active Actions runs before stopping;
removing a workflow file does not cancel runs that were already queued.
If stopping multiple Machines fails partway through, some may already be stopped;
the command reports failure rather than claiming success.

`cancel RUN_ID` requests cancellation of a GitHub deployment run. It uses
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
