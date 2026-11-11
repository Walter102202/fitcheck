# CLAUDE.md

Guidance for Claude Code (and anyone else) working in this repository. The product story is in
[README.md](README.md); deploying is in [docs/deploy.md](docs/deploy.md); the measurement is in
[docs/measurement.md](docs/measurement.md).

## Rules that never bend

- Money is integer cents everywhere. It is formatted only by `formatUsd` in `@fitcheck/contracts`.
- The model never decides a pass. Claude turns the request into an intent with verbatim quotes and
  proposes citations; code verifies every quote and every value.
- Fail closed. If the review cannot run, nothing is captured and the purchase goes back to the
  agent with "Fitcheck could not check this listing."
- PayPal calls are idempotent: the `PayPal-Request-Id` is derived from ids (`cap:<capId>:authorize`,
  `capture:<purchaseId>`, `void:<capId>`). A purchase is captured at most once.
- Every model and API call has a mock or recorded path, so `pnpm test` and `pnpm dev` need no key.
- English only in the repo. `docs/hackathon/` is git-ignored and never committed. Never commit
  `.env` or print a key.
- The held-out cases are frozen by hash. After the held-out run, the reviewer changes only for
  program bugs, recorded in `eval/cases/errata.md`.

## Commands

pnpm workspaces, Node 22, pnpm 10. Everything runs from the repo root.

```bash
pnpm install
pnpm dev          # backend :3000 (tsx watch) + Vite :5173; open http://localhost:5173
pnpm test         # every Vitest project: contracts, checklists, backend, web, eval, tests (e2e)
pnpm lint         # Biome (formatter, linter, import sorting); pnpm lint:fix writes fixes
pnpm typecheck
pnpm build        # backend (tsc) and web (vite build); the backend serves apps/web/dist
pnpm measure      # see docs/measurement.md
```

Single tests: `pnpm vitest run <file>`, `pnpm vitest run --project @fitcheck/backend`, or
`pnpm vitest run -t "<name>"`. To run a TypeScript file by hand: `tsx --conditions=development <file>`.

Database: `pnpm --filter @fitcheck/backend exec drizzle-kit generate` after editing
`apps/backend/src/db/schema.ts`; commit the SQL in `apps/backend/drizzle/`. The server migrates on
boot. CI fails if the schema and the committed migrations differ.

## Layout

- `packages/contracts`: Zod schemas shared by the API and the web app (runs, reviews, payments,
  results, config, `API` paths). Consumed from source through the `development` export condition.
- `packages/checklists`: the requirement lists as data: `common.json`, `tv.json`,
  `hair_dryer.json`.
- `apps/backend/src`:
  - `index.ts` loads the root `.env`, validates it (`env.ts`), builds `Deps` and serves the app;
    `app.ts` mounts the routes and the static web build.
  - `api/`: Hono routes (`config`, `scenarios`, `cap`, `runs`, `results`, `webhooks`) and the
    anonymous session cookie.
  - `runs/`: run orchestration. `ports.ts` (`createPorts`) is the single switch point between the
    real review/Channel3 and test doubles.
  - `review/`: the review engine. It covers the intent (`intent.ts`), the checks (`evaluate.ts`,
    `common-checks.ts`, `facts.ts`, `normalize.ts`), the decision and card (`decide.ts`), the
    answers (`answers.ts`) and citations (`citations.ts`). `model/` holds the Vercel AI SDK port
    with record and replay; `recordings/` holds the recorded intents.
  - `channel3/`: the gateway (live REST, recorded fallback, daily search cap) and the fixtures.
  - `paypal/`: the `PaypalGateway` with `sandbox.ts` (real) and `mock.ts` (tests and the
    simulated fallback). Cents become PayPal amount strings only here.
  - `ledger/`: caps, holds, captures, voids, webhooks and the idle sweep. Postgres enforces the
    ledger rules.
  - `agent/`: the scripted shopping agent and the four scenarios.
  - `db/`: Drizzle schema and client (`pglite://memory`, `pglite://<dir>`, `postgres://`).
- `apps/web/src`: React 19 screens (home, cap approval, run, results), components and CSS
  Modules with design tokens. `api/http.ts` parses every response with the contracts; `api/fixtures`
  is an in-browser fake API (`VITE_API_MODE=fixtures`).
- `eval/`: cases, harness, recordings and results (docs/measurement.md).
- `tests/e2e`: the real app over HTTP with mock PayPal, recorded Channel3 and recorded intents,
  one cookie per visitor.
- `fixtures/channel3`: 118 product records recorded on 2026-11-10.

## Testing patterns

- Backend: `createHarness()` in `apps/backend/src/runs/harness.ts` gives in-memory PGlite with
  migrations, a fixed clock, a silent logger, sequential ids and the mock PayPal gateway.
  `activeCap(deps)` gives a session with an active cap.
- Backend, eval and e2e projects run with `maxWorkers: 2` because parallel PGlite startups blow
  the timeout. Each has its own `sequence.groupOrder` (1, 2, 3). Do not raise timeouts instead.
- Web: jsdom and Testing Library; `renderApp` from `apps/web/src/test/render.tsx`.

## Gotchas

- TypeScript runs with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`: omit optional
  fields rather than passing `undefined`.
- Imports between `.ts` files use `.js` extensions (NodeNext).
- One `.env` at the repo root serves the backend and Vite; copy `.env.example`.
- With `CHANNEL3_MODE=live` and no key, boot fails on purpose.
