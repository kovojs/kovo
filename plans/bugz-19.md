# Bugz 19

Created 2026-06-30 from an exhaustive multi-agent `dogfood` pass against
`main` commit `1417b8037`. Source of truth remains `SPEC.md`; this ledger
records verified soundness defects not already carried by earlier bugz/papercuts
ledgers.

## Scope

Five fresh SQLite apps under `/Users/mini/kovo-dogfood-exhaustive-20260629-182057`
exercised islands, Drizzle/optimistic/idempotency, auth/cache/error shells,
static export/Defer/navigation, and endpoints/storage/webhooks. Data, auth,
Defer, export, and endpoint candidates were independently verified before
synthesis.

## Issues

- [x] **B1 — State-dependent conditional text in client islands is silently stale when the same element has reactive attribute derives.** (high, framework soundness; found by `t1-interaction-ladder`, verified independently)
  - Observed behavior: clicking a production-built island updates `kovo-state`, `data-state`, `aria-pressed`, and simple `state.clicks` text, but direct conditional text using `state.urgentOnly` stays at the server-rendered value (`all` / `Show urgent only`) in both `vp dev` and `node dist/server/server.mjs`.
  - Root cause: state-derived attributes mark the expression's state path as plan-covered, so KV311 coverage does not fire, while text lowering skips the same element once it already has binding attributes (`packages/compiler/src/lower/structural-jsx.ts`; verified around the direct conditional text in emitted `priority-toggle-island.client.js`). The result violates `SPEC.md` §4.8/§4.9 update coverage.
  - Why it matters: shipped islands can commit local state and update some DOM while leaving adjacent visible text stale, a false-green production artifact rather than a compile-time diagnostic.
  - Repro evidence: T1 app `/Users/mini/kovo-dogfood-exhaustive-20260629-182057/t1-interaction-ladder`: Playwright against `NODE_ENV=production node dist/server/server.mjs` observed host state `false/0 -> true/1`, attribute derives updating, and conditional text unchanged; the independent verifier reproduced the same in dev.
  - Acceptance: compiler either stamps state-dependent conditional text independently from same-element attribute derives, or fails closed with KV311; a browser/prod-artifact regression proves the text updates after click.
  - Evidence: `pnpm exec vitest run packages/compiler/src/state-bindings.test.ts packages/browser/src/query-bindings.test.ts packages/browser/src/inline-loader-delegated.test.ts packages/cli/src/index.kovo-build-browser.test.ts --run --reporter=dot` proves same-element state-derived text and attributes update in a prod-built island.

## Latest Verification

- `pnpm --filter create-kovo run build:dist`; fresh baseline scaffold `check`, `test`, `build:prod`, and dev HTTP smoke passed before fan-out.
- `gh run list --branch main --limit 6`: CI, GitHub Pages, and Race-Prone Integration Repeats were green for pushed commit `1417b8037`.
