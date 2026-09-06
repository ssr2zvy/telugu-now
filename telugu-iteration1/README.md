# Implementation Iteration 1

This repository contains Implementation Iteration 1 of the Telugu observation app.

## Stack

- TypeScript
- React + Vite
- Hono + Node.js
- SQLite (`better-sqlite3`)

## Project controller

The root `control-project.sh` is the normal development entry point.

Install dependencies on a new checkout:

```bash
./control-project.sh deps --option install
```

Once a `package-lock.json` exists, dependency installation uses `npm ci`. An installed dependency tree can be reinstalled with:

```bash
./control-project.sh deps --option reinstall
```

Start the development server:

```bash
./control-project.sh dev
```

Choose `start`. Dev runs in the foreground and keeps the normal Vite/Hono output attached to the terminal; press Ctrl+C to stop it. A second terminal can run the same `dev` command and choose `stop` to terminate the running dev process group.

The browser app is served by Vite on port `5173`. The Hono API runs on `127.0.0.1:8787`. Vite binds to `0.0.0.0` so development-container/Codespaces port forwarding can expose the UI port.

The configured Iteration 1 profile code is `001`.

## Build

```bash
./control-project.sh build --option start
```

Build status can be inspected by running:

```bash
./control-project.sh build
```

## Tests

```bash
./control-project.sh test --option start
```

The automated tests validate the persistent application core. They deliberately disable background mock preparation and do not test `MockDataSource` response content, randomness, or artificial delay.

## Queue behavior

When a profile is loaded, the app restores its persistent future queue and fills it to a target of 10 selected unseen observations if necessary.

After that, replenishment is continuous and one-for-one. Each time a previously unseen observation is displayed for the first time, that observation moves into history and exactly one replacement is selected at the end of the future queue. Consumption and replacement reservation happen inside the same SQLite transaction.

The target of 10 includes observations that are ready, currently preparing, or pending preparation. Iteration 1 prepares observations sequentially, one at a time. If the user consumes ready observations faster than preparation completes, their replacement jobs accumulate in selection order and are prepared when the worker reaches them.

## Development diagnostic

The temporary diagnostic shown beneath each mock Telugu observation includes:

- acquisition number;
- initial-fill vs consumption-triggered acquisition;
- the triggering observation/history position for replacements;
- trigger timestamp;
- number of pending preparation jobs already waiting ahead when selected;
- whether another preparation was in flight at selection time;
- request start/end timestamps; and
- request duration.

This diagnostic UI is temporary and is not part of the final no-English user interface.

## Persistence

The default SQLite file is `./data/app.sqlite`. Override it with `DATABASE_PATH`.

The schema keeps compatibility fields from the earlier five-at-a-time Iteration 1 queue implementation so an existing local Iteration 1 database can be opened without destructive migration. New canonical acquisition diagnostics are stored in `observation_acquisitions`.

The mock source delay defaults to 1–60 seconds. The defaults can be overridden for local manual development with `MOCK_DELAY_MIN_MS` and `MOCK_DELAY_MAX_MS`.
