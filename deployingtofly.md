# Deploying `telugu-now` to Fly.io

This document reconstructs, from the actual Copilot CLI session history for
this repository, how the app is built, how branches get merged, and how a
deploy actually happens on Fly.io — including what Fly does and does not do
automatically.

## 1. The workflow used in every session

Every deployment session in this repo's history follows the same pattern:

1. Work happens on a dedicated `copilot/<topic>` branch created from `main`
   (never directly on `main`).
2. Changes are typechecked, built, and tested locally
   (`npm run typecheck`, `npm run build`, `npm test` inside `upa/`).
3. The branch is committed, then **merged into `main`** — either via a GitHub
   pull request (e.g. PR #36, #37, #38, #39, #40, #41) or, when working
   offline, merged locally into `main` and pushed once network/auth access is
   available.
4. `main` is pushed to `origin` (`git push origin main`).
5. A deploy is triggered **manually** by running `flyctl` against the
   repository root.

Nothing in this repo automates step 5 from step 4. There is no
`.github/workflows/*.yml` in this repository, so **pushing or merging to
`main` on GitHub does not, by itself, deploy anything.** Fly does not watch
the GitHub repo. Every deploy in the session history was invoked explicitly
by the assistant/user running `flyctl` from a terminal after the merge.

## 2. How the merge happens

- Feature work happens on `copilot/*` branches.
- Merges into `main` are done either through a GitHub PR (normal case) or a
  local `git merge` into `main` followed by `git push origin main` when a PR
  isn't practical in the moment. Either way, `main` is always the source of
  truth that gets deployed — feature branches are never deployed directly to
  the production Fly app (this was corrected once: a branch,
  `copilot/user-eons`, had been deployed straight to Fly without first being
  merged into `main`, and was reconciled into `main` after the fact).
- No branch protection/required-status-check automation exists in this repo;
  the discipline is enforced by convention (typecheck/build/test before
  every merge), not by CI.

## 3. How a deploy is actually triggered (manual, from `main`)

After merging, the deploy sequence used throughout the session history is:

```bash
# from the repository root, on the checked-out main branch
flyctl auth login          # one-time per machine/environment
flyctl deploy . --config fly.toml --ha=false
```

- `fly deploy` is run **from the repository root**, not from `upa/`, because
  the Docker build context must include `upa/`, `ci-cd/`, and
  `container-scripts/` together (this is a "monorepo" layout: application
  source lives under `upa/`, but the root `Dockerfile`, `fly.toml`, and
  `ci-cd/` sit above it).
- `--config fly.toml` selects the config file; it does **not** change the
  build context — the working directory argument (`.`) does that.
- `--ha=false` is used because this app has a mounted volume: Fly's
  redundancy-by-default behavior gives volume-backed process groups a single
  Machine on first deploy anyway, but `--ha=false` makes that explicit rather
  than relying on the default.

## 4. What Fly does automatically once `fly deploy` runs

`fly deploy` is the only thing that "detects" code changes — Fly has no
passive integration with this GitHub repo. When invoked, flyctl:

1. Reads `fly.toml` (`[build] dockerfile = "Dockerfile"`) to find the
   Dockerfile.
2. Builds the image **remotely** on Fly's remote builder by default (not
   your local Docker daemon, unless `--local-only` is passed). The Dockerfile
   here is a multi-stage build:
   - `dependencies` — installs npm deps (with Python/make/g++ for native
     SQLite compilation).
   - `build` — copies `upa/` and `ci-cd/make-artifacts.sh`, then runs it
     (`make-artifacts.sh` just runs `npm run build`, which typechecks,
     builds the Vite frontend, and bundles the Node backend + availability
     worker with `tsup`).
   - `production-dependencies` — `npm prune --omit=dev`.
   - `runtime` — final slim image: installs `gosu`/`ffmpeg`, copies
     production `node_modules`, the built `dist/`, and
     `container-scripts/entrypoint.sh`, and sets
     `ENTRYPOINT ["/usr/local/bin/telugu-now-entrypoint"]` /
     `CMD ["node", "dist/server/index.js"]`.
   - `.dockerignore` allow-lists exactly the files each stage needs so the
     build context stays small and never includes `node_modules`, `dist`,
     local data, secrets, or `.git`.
3. Pushes the built image to **Fly's internal registry** — there is no
   separate Docker Hub/manual `docker push` step.
4. Updates/creates Fly Machines running that image for the `telugu-now` app,
   attaching the existing `telugu_now_data` volume (3 GB, region `iad`) to
   the single Machine.
5. Injects environment variables from `fly.toml`'s `[env]` block plus
   Fly secrets (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
   `pollinations_api_key`, etc. — set out-of-band via `flyctl secrets set`,
   never committed) into the Machine's runtime environment.
6. Runs the container's `ENTRYPOINT`
   (`container-scripts/entrypoint.sh`): as root it validates and
   creates/chowns `/data`, `/data/corpus`, `/data/user`,
   `/data/word-images`, then re-execs itself as the unprivileged `node`
   user via `gosu`, which finally `exec`s `node dist/server/index.js`.
   (Dockerfile `chown` alone would not affect a Fly volume — the volume is
   only mounted at Machine start, so ownership must be fixed by the
   entrypoint at runtime, not at build time.)
7. Runs the app's health check (`GET /api/health`, 1 min grace period,
   30 s interval) before routing traffic to the new Machine, then retires
   the old one.
8. Because `CORPUS_BACKEND=tigris`, on startup the app downloads
   `corpus.sqlite` from Tigris only if missing, and — because
   `CORPUS_AVAILABILITY_WORKER_ENABLED=false` /
   `CORPUS_AVAILABILITY_REBUILD_ON_STARTUP=true` — rebuilds
   `availability.sqlite` from the Tigris object listing before serving
   traffic, with no ongoing background worker.
9. The app is reachable at the Fly-assigned hostname `telugu-now.fly.dev`
   with managed HTTPS; first deploy also provisioned a dedicated IPv6 and a
   shared IPv4 automatically.

## 5. What Fly does *not* do

- It does **not** poll or watch the GitHub repository for new commits.
- It does **not** auto-build on `git push` or on PR merge. (Setting that up
  would require adding a `.github/workflows/*.yml` using Fly's official
  "Continuous Deployment with GitHub Actions" recipe — a workflow, a
  `FLY_API_TOKEN` deploy secret, `actions/checkout`, then a `flyctl deploy`
  step. This repo does not have that workflow yet, so every deploy so far
  has been manual.)
- Fly volumes do not replicate; the app intentionally runs as a single
  Machine (`--ha=false`) because SQLite (`corpus.sqlite`,
  `users.sqlite`) lives on one attached volume.

## 6. Summary

| Step | Trigger | Tool |
|---|---|---|
| Feature work | Manual | `copilot/*` branch |
| Merge to `main` | Manual (PR or local merge + push) | `git` / GitHub PR |
| Build image | Manual, run after merge | `fly deploy .` (remote builder) |
| Push image to registry | Automatic, part of `fly deploy` | Fly internal registry |
| Roll out Machine(s) | Automatic, part of `fly deploy` | flyctl / Fly platform |
| Health check + cutover | Automatic, part of `fly deploy` | `/api/health` |

**In short: merging to `main` on GitHub is necessary but not sufficient. A
human (or the assistant, on request) must explicitly run
`flyctl deploy . --config fly.toml --ha=false` from the repository root
after the merge for Fly to build and roll out the new code.**
