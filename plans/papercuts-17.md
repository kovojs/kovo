# Papercuts 17

Created 2026-06-29. Source of truth remains `SPEC.md`; this ledger captures framework/template/docs/dev-tooling papercuts found while dogfooding local Kovo after `plans/papercuts-16.md` was implemented.

## Scope

Exhaustive post-fix dogfood ran against local monorepo commit `1de291a95` in `/Users/mini/kovo-dogfood-postfix-20260629`: baseline scaffold, state/islands, files/capabilities, Drizzle/optimistic, navigation/deploy-skew, and auth/access/error tracks. Each app was scaffolded from the rebuilt local `create-kovo` dist, linked with `scripts/link-local-kovo.mjs`, installed, and exercised with the relevant `check`, `test`, `build:prod`, `tsc`, dev HTTP, and/or built-server smoke gates.

## Issues

### A. Multi-component state and deploy-gate shape facts still leak first-pass assumptions

- [ ] **A1 — Multi-component state modules validate later components against the first component's state shape.** (high, framework; found by `t1-state-islands`, verifier `Ptolemy`)
  - Observed behavior: a module containing inline, `satisfies JsonValue`, and interface-shaped state components fails `kovo compile component --check` with KV302 for `state.summary` and `state.steps`, even though those paths belong to the second and third components' own declared state shapes. The same state shapes work when split into one component per module.
  - Root cause: `packages/compiler/src/scan/parse.ts:303-304` exposes `firstComponentModel(model)`; `componentStateReturnObjectModel` at `packages/compiler/src/scan/parse.ts:410-413` reads only that first component's `stateReturnObject`; `validateStateBindingPath` at `packages/compiler/src/validate/bindings.ts:188-199` builds allowed `state.*` roots from that single object. The parsed compile phase also threads a module-wide `componentName`/`componentNames` from `packages/compiler/src/compile.ts:238-239` through lowering and validation.
  - Why it matters: SPEC §4.1 and §4.8 make local JSON state and state bindings normal L1 authoring. A natural multi-component module false-fails valid bindings and keeps the compiler's multi-component support uneven after the query-shape side of this class was fixed in `plans/bugz-14.md` B3.
  - Repro evidence: `cd /Users/mini/kovo-dogfood-postfix-20260629/t1-state-islands && pnpm exec kovo compile component repro/multi-state-module.tsx --out .kovo/repro/main-verify-multi-state-module.server.tsx --check` exits 1 with KV302 for `state.summary` and `state.steps`.
  - Acceptance: state binding validation considers the declaring component's state shape for every component in a module. Prove with a compiler test where a second and third component bind their own `state.*` keys without KV302, plus a negative for a missing key in a later component.

- [ ] **A2 — Build graph derivation still drops Drizzle output-schema facts for direct computed-field bindings.** (high, framework deploy-gate regression; found by `t3-drizzle-optimistic`, verifier `Zeno`; regression of `plans/papercuts-16.md` C1 / `plans/papercuts-super-5.md` A1)
  - Observed behavior: an app query declares `output: s.object({ total, withCompany, emptyCompany })` and `reads: [contact]`, then binds `{stats.total}`, `{stats.withCompany}`, and `{stats.emptyCompany}` directly through a component query alias. `pnpm exec tsc --noEmit` and `pnpm run test` pass, but `pnpm run build:prod` fails KV302 for all three fields.
  - Root cause: `packages/cli/src/commands/build-export.ts:394` loads the app under `KOVO_BUILD_GRAPH_DERIVATION=1`; `packages/server/src/vite.ts:806-810` returns empty `outputQueryShapeFacts`/`staticFacts` under that flag; `collectCompilerQueryShapeFacts` depends on that analysis; `packages/compiler/src/vite.ts:775-780` preserves empty facts instead of creating local query aliases; `packages/compiler/src/validate/bindings.ts:50-57` then emits KV302.
  - Why it matters: SPEC §6.2 and §10.2 make declared query output shape the binding contract. A green `tsc`/test path still does not predict a green deploy for a common stats/dashboard shape, and the regression reopens a previously checked-off dogfood issue.
  - Repro evidence: `cd /Users/mini/kovo-dogfood-postfix-20260629/t3-drizzle-optimistic && pnpm exec tsc --noEmit && pnpm run build:prod` reaches `build:prod` and exits 1 with KV302 for `stats.total`, `stats.withCompany`, and `stats.emptyCompany`.
  - Acceptance: graph derivation either supplies the compiler query-shape facts needed for component transforms or avoids validating with an empty fact set. Prove with a build/data-plane test that a Drizzle query with declared computed `output` fields bound directly through a local alias passes `build:prod` while invalid fields still fail.

### B. Storage capability route method dispatch

- [ ] **B1 — Signed `HEAD` storage capability URLs 404 before reaching the framework download handler.** (med, framework; found by `t2-files-capabilities`, verifier `Helmholtz`)
  - Observed behavior: a URL minted with `ctx.signUrl({ key, method: 'HEAD' })` for `createStorageDownloadEndpoint` returns 404. The same object/key signed for `GET` returns 200.
  - Root cause: `createStorageDownloadEndpoint` is documented and implemented as GET/HEAD-capable, and its handler accepts `HEAD` at `packages/server/src/capability-route.ts:286-289` with a bodyless response path at `:319-340`; but the endpoint is mounted as `method: 'GET'` at `packages/server/src/capability-route.ts:345-347`. Shell dispatch filters endpoints before handler execution at `packages/server/src/shell.ts:166-170`, and `endpointMethodMatches` exact-matches the declared method at `packages/server/src/shell.ts:208-213`.
  - Why it matters: SPEC §6.6 says `createStorageDownloadEndpoint` builds a prefix-mounted GET/HEAD endpoint. This is fail-closed, not a data exposure, but it makes the shipped HEAD capability unusable in real app routing.
  - Repro evidence: `cd /Users/mini/kovo-dogfood-postfix-20260629/t2-files-capabilities && pnpm exec vitest run src/app.test.ts -t "stores uploads and serves them through capability URLs"` passes while asserting signed GET returns 200 and signed HEAD currently returns 404 at `src/app.test.ts:159-163`.
  - Acceptance: mounted storage capability endpoints dispatch signed HEAD requests to the handler and return 200 with the same headers and no body. Prove through the shell/app request path, not only direct endpoint handler tests; unsigned or method-mismatched HEAD still fails closed.

## Refuted / Not Carried Forward

- Baseline scaffold passed `pnpm run check`, `pnpm run test`, `pnpm run build:prod`, `pnpm exec tsc --noEmit`, and dev HTTP smokes for `/login` and `/api/health`.
- Navigation/deploy-skew found no mismatch: `/about?from=home` and `/api/health` returned 200 in both dev and built node server, while `/` redirected unauthenticated with 303 in both modes.
- The files/capabilities track refuted missing public storage constructors, missing multipart/`accept` form attributes, missing sniffed accept/maxBytes enforcement, broken ordinary body caps, and signed GET/unsigned rejection regressions.
- The state/islands track refuted single-component inline/`satisfies`/interface state failures, primitive reactive attribute rendering failures, and unresolved dev client-module imports. The production authored-client-island build failure was not carried because it is the known fail-closed behavior from `plans/papercuts-super-6.md` A1.
- The Drizzle/optimistic track refuted dev enhanced-mutation omissions and `Kovo-Changes` value leakage: dev returned fragment/query chunks and `kovo-changes: [{"domain":"model/contact"}]` without submitted field values.
- The auth/access/errors track found no new candidates: configured forbidden/not-found/error shells rendered, endpoint CSRF accepted a correctly audience-bound app token while missing token returned 422, verifier endpoints rejected bad tokens and stripped ambient cookies, and public/redirect routes behaved as expected.

## Latest Verification

- `cd /Users/mini/kovo-dogfood-postfix-20260629/t1-state-islands && pnpm exec kovo compile component repro/multi-state-module.tsx --out .kovo/repro/main-verify-multi-state-module.server.tsx --check`: reproduces A1 with KV302 for `state.summary` and `state.steps`.
- `cd /Users/mini/kovo-dogfood-postfix-20260629/t2-files-capabilities && pnpm run test`: passes 2 files / 10 tests, including the current signed-HEAD 404 assertion for B1.
- `cd /Users/mini/kovo-dogfood-postfix-20260629/t3-drizzle-optimistic && pnpm exec tsc --noEmit && pnpm run build:prod`: `tsc` passes, `build:prod` reproduces A2 with KV302 for `stats.total`, `stats.withCompany`, and `stats.emptyCompany`.
- `cd /Users/mini/kovo-dogfood-postfix-20260629/t4-nav-deploy-skew && pnpm run check && pnpm run test && pnpm exec tsc --noEmit --pretty false && pnpm run build:prod`: all pass; dev and built-server HTTP smokes match for `/about?from=home`, `/`, and `/api/health`.
- `cd /Users/mini/kovo-dogfood-postfix-20260629/t5-auth-access-errors && pnpm exec tsc --noEmit && pnpm run test && pnpm run build:prod && pnpm run check`: all pass; dev HTTP smokes confirm public, forbidden, and verifier endpoint behavior.
