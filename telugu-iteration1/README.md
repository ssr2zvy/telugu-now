# Implementation Iteration 1

This repository contains only Implementation Iteration 1 of the Telugu observation app.

## Stack

- TypeScript
- React + Vite
- Hono + Node.js
- SQLite (`better-sqlite3`)

## Local development

Install dependencies:

```bash
npm install
```

Start the controlled development server:

```bash
./control-project.sh dev
```

Or non-interactively:

```bash
./control-project.sh dev --option start
```

The browser app is served by Vite at `http://127.0.0.1:5173` in development.
The Hono API runs at `http://127.0.0.1:8787`.

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

The Iteration 1 automated tests validate the persistent application core: profile validation, ordered queue readiness, history navigation, timing semantics, queue persistence behavior, and launch/rolling queue sizing. They intentionally do **not** test `MockDataSource` response content, randomness, or artificial delay because that source is temporary and will be replaced by real data-source adapters.

## Persistence

The default SQLite file is `./data/app.sqlite`. Override it with `DATABASE_PATH`.

The mock source delay defaults to 1–60 seconds. The defaults can be overridden for local manual development with `MOCK_DELAY_MIN_MS` and `MOCK_DELAY_MAX_MS`; production-equivalent behavior is the documented default.
