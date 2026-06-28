# Papercuts 9

Created 2026-06-28. Source of truth remains `SPEC.md`; this ledger captures
framework/template/dev-tooling papercuts found while dogfooding the local Kovo
monorepo after `plans/papercuts-8.md` and `plans/bugz-9.md` were implemented.

Meta-theme: the endpoint-posture hardening from papercuts 8 made the fresh
starter's own baseline gates order-dependent.

## Scope

Dogfooded a fresh linked SQLite scaffold at
`/Users/mini/kovo-dogfood-20260628e/base-pristine`, generated from local
`packages/create-kovo/dist/index.mjs` after rebuilding `create-kovo`.

The standalone production build passed. A fresh `pnpm run check` and a fresh
`pnpm run test` exposed the generated endpoint-posture test issue below.

## Issues

### A. Starter Endpoint Posture

- [ ] **Fresh starter endpoint-posture test fails before a production build and violates the starter sound-subset gate.** (high, template/dev-tooling; found by `base-pristine`)
  - Observed behavior: a newly scaffolded linked app fails `pnpm run check` at
    `check:sound-subset` because generated `src/endpoint-posture.test.ts` uses
    an unchecked cast; `pnpm run test` also fails on a fresh tree because the
    same generated test reads `dist/.kovo/graph.json` before any build has
    created it.
  - Root cause: `packages/create-kovo/templates/src/endpoint-posture.test.ts:70`
    parses the graph with `as unknown`, which the generated
    `scripts/check-sound-subset.mjs` rejects, and
    `packages/create-kovo/templates/src/endpoint-posture.test.ts:22` requires
    `dist/.kovo/graph.json`. The package `check` script builds before
    `check:endpoint-posture`, but the generated `test` script runs the posture
    test directly before any build.
  - Why it matters: the fresh starter's baseline commands are supposed to be
    green and order-independent. A generated app should not need authors to know
    that `build:prod` must run before `test`, and generated test source should
    satisfy its own sound-subset policy.
  - Repro evidence: in
    `/Users/mini/kovo-dogfood-20260628e/base-pristine`, fresh `pnpm run check`
    failed with `src/endpoint-posture.test.ts:70 ... bans unchecked casts`, and
    fresh `pnpm run test` failed with `ENOENT: no such file or directory, open
'dist/.kovo/graph.json'`. `pnpm run build:prod` then passed, and rerunning
    `pnpm run test` passed.
  - Acceptance: a fresh linked scaffold passes `pnpm run check`, `pnpm run test`,
    and `pnpm run build:prod` in any normal first-run order, while endpoint
    posture still reconciles observed facts against declared graph endpoints.

## Refuted / Not Carried Forward

- The production build itself is not broken: `pnpm run build:prod` passed in the
  fresh baseline app and wrote `dist/.kovo/graph.json`.

## Latest Verification

- 2026-06-28 in `/Users/mini/kovo-dogfood-20260628e/base-pristine`: fresh
  `pnpm run check` failed at generated sound-subset, fresh `pnpm run test`
  failed before build due missing `dist/.kovo/graph.json`, `pnpm run build:prod`
  passed, and `pnpm run test` passed after the build.
