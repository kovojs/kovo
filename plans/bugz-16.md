# Bugz 16

Created 2026-06-29. Source of truth remains `SPEC.md`. One confirmed soundness defect escalated
from the postgres-template dogfood sweep (companion papercuts ledger: `plans/papercuts-super-7.md`),
reproduced first-hand by the main thread against a clean `create-kovo` (default postgres) **prod
build** (`kovo build` + `NODE_ENV=production node dist/server/server.mjs`).

It is a **production-only reopen of `bugz-14` B2**: B2 (enhanced-mutation success path ships no
usable refresh → committed row invisible) was marked `[x]` fixed on dev/unit-test evidence, but the
`kovo build` **production artifact still ships it broken** — and worse than dev, the success body is
now entirely empty. Shares its root cause with `papercuts-super-7` A1 (the prod-bundle reentry guard
skips registry-wrapped authored components).

## Scope

- App: a fresh `create-kovo` default (postgres/PGlite) scaffold, link-local to the monorepo, built
  with `pnpm run build:prod` and run as the README-documented prod command.
- Out of scope: the islands/nav/endpoint/a11y/theme papercuts (in `papercuts-super-7.md`).

## Issues

- [x] **B1 — In the production `kovo build` artifact, an enhanced-mutation SUCCESS ships an EMPTY response body, so the committed row never renders (silent stale UI) and the §9.3 multi-tab rebroadcast carries 0 bytes — a production reopen of `bugz-14` B2 (which the dev path now fixes but the deploy gate does not).** (HIGH, framework; found by `t2-liveness`)
  - Observed / impact: on the **unmodified default scaffold**, prod build, signed in, submitting the shipped enhanced add-contact form returns `200` with `Content-Type: text/vnd.kovo.fragment+html` and `Kovo-Changes: [{"domain":"model/contact"}]`, but the **response body is empty** — no `<kovo-query>` and no `<kovo-fragment>`. The DOM stays at the pre-submit rows; the committed contact is invisible until a full reload. Because the rebroadcast envelope is built from that same (empty) body, same-user multi-tab sync also publishes nothing. Decisive contrast: the 422 failure path still emits a full `<kovo-fragment target="contacts-region">`, so the renderer exists — only the prod success path produces nothing. Dev works (the `bugz-14` B2 fix is dev-only).
  - Root cause: the prod bundle never lowers/registers the fragment region's live-target renderer, so `renderSuccessfulMutationWireResponse` (`packages/server/src/mutation.ts:551-614`) joins `queryChunks + fragmentChunks` that are **both empty** for `contacts-region`. The upstream cause is the same as `papercuts-super-7` A1: `packages/cli/src/commands/build-export.ts:2078-2083` runs `sourceDerivedRegistryVitePlugin` (which wraps `component(...)` in `__kovoAssignDerived(...)`) **before** `kovoPlugin`, and the reentry guard `isKovoGeneratedServerModuleReentry` (`packages/compiler/src/vite.ts:489-492`) returns true when the source contains `__kovoAssignDerived` **or** `componentLiveTargetRenderer`, so the kovo transform early-returns `null` and never lowers the registry-wrapped fragment component. An island (with `onClick`) trips the fail-closed island assertion (build fails — A1); a fragment region (no island hooks) silently bundles with no renderer → empty success body (build succeeds).
  - Why it matters: `build:prod` is the only deploy path, and the affected region is the **canonical starter pattern** (a server component rendered as a server-refreshable fragment target — the idiomatic non-island interactive region). Every deployed Kovo app's core "submit a mutation, see the result" flow silently fails, and the §10.6/KV311 update-coverage theorem the framework markets is violated in the artifact that ships — with a green build. It is the production half of a defect whose dev half was already fixed and closed, so the regression is invisible to the dev loop and unit tests.
  - Repro evidence (self-verified, clean base scaffold, prod): `pnpm run build:prod` (exit 0) → `NODE_ENV=production KOVO_DATA_DIR=/tmp/prodpg7 KOVO_DEMO_PASSWORD=… node dist/server/server.mjs`; Playwright login + submit add-contact → success response body **empty**, `has <kovo-fragment>` = false, final DOM unchanged (`3 rows / "3 contacts"`); the 422 path emits a fragment and morphs.
  - Fix / acceptance: the prod `kovo build` pipeline must lower/register registry-wrapped fragment (and island) components (fix the plugin ordering / reentry-guard interaction per A1), so the production success path emits the same `<kovo-fragment>`/`<kovo-query>` the dev path does. Prove with an **end-to-end prod-artifact** test (not a unit test of the renderer): build a starter, run the prod server, submit a mutation, assert the success response carries a non-empty fragment and the DOM updates. (Re-link `bugz-14` B2's acceptance to require a prod-artifact assertion.)
  - Fixed evidence: `pnpm exec vitest run packages/cli/src/index.kovo-build.test.ts packages/server/src/vite-data-plane-gate.test.ts --reporter=dot` passes 50 tests / 1 skipped, including production enhanced mutation success chunks for registry-wrapped authored fragments.

## Latest Verification

- **B1 fixed:** `pnpm exec vitest run packages/cli/src/index.kovo-build.test.ts packages/server/src/vite-data-plane-gate.test.ts --reporter=dot` passes the prod enhanced-mutation success-body regression, authored-island build lowering, and graph-derivation output-shape coverage.
