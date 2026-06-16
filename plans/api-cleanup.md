# API Surface Cleanup — Execution Plan

**Status:** open (6 / 24 slices closed — Phases 1–2 done; Phase 3 enforcement+stability done, dist-exports flip carved out as a separate slice)
**Findings source:** 2026-06-15 multi-agent API audit (memory `api-surface-audit`). The audit holds the per-finding what/why/`file:line` evidence and mature-framework contrasts; this file is the compact execution ledger — one checkbox per coherent slice, sequenced by leverage and dependency.
**Behavior source of truth:** `SPEC.md` (cited per item). When a fix and the SPEC conflict, follow SPEC and record the conflict; do not code through it.

Mark `- [x]` only when this session verifies the cited proving command for the exact item (CLAUDE.md Progress Discipline). Nest proving evidence under the item when you close it.

---

## Locked decisions (2026-06-15)

1. **Distribution:** published packages ship built `dist` + rolled-up `.d.ts`. Raw-source resolution stays only behind a `development`/`source` export condition for the workspace. This is the prerequisite that makes `@internal` enforceable (no `.d.ts` strip step = inert tags).
2. **`@kovojs/ui`:** `private: true` — **not** an external dependency. External apps copy components in shadcn-style (registry, "you own the code"); in-repo apps (examples, site) import it via the workspace as a `@/components/ui` convenience. Corollary: **`@kovojs/headless-ui` IS an external public dependency** (copied `ui` code imports it) and must be documented + fenced.
3. **Scope:** internal/external delineation + questionable-shape fixes + the 2 confirmed bugs. The docs-dogfooding _feature_ gaps (markdown/prose `Html` ctor, nested layouts, route-awareness, catch-all routes, canonical meta — see memory `kovo-docs-dogfood-rewrite`) are **out of scope**; track separately.

### Corrected audit recommendations (do NOT re-introduce the originals)

- `@kovojs/compiler` must **not** be `private:true` — `create-kovo` templates depend on it (`deriveAppGraph`, `compileComponentModule`, `assertFixpoint`, `assertRenderEquivalence`, `emit-graph`). Fix = curated thin public entry + `@internal` rest.
- `@kovojs/drizzle/static` is **build-time, app-consumed** (every example's `scripts/emit-graph.mjs`). Fix = declare `ts-morph` as a real dependency, not "hide it."
- `@kovojs/runtime` curation is **coupled to the compiler emit** (`emit/client.ts:34`, `emit/bootstrap.ts:35`, `lower/inline-derives.ts:184` all emit `from '@kovojs/runtime'`; gallery does a string `.replaceAll`). Any subpath move requires changing emitters in lockstep + a stable emit-target contract.

### Target package classification (the `publicPackages` source of truth)

| Package                              | External status                     | Notes                                                                                |
| ------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------ |
| `@kovojs/core`                       | public                              | carve `graph`/`derivation` IR off root barrel                                        |
| `@kovojs/server`                     | public                              | carve internal helpers; `app-shell/vite` is host-internal                            |
| `@kovojs/runtime`                    | public (human subset) + emit-target | split surfaces; keep bare specifier resolvable                                       |
| `@kovojs/drizzle`                    | public                              | `.`=runtime, `./derive`/`./static` build-time; declare `ts-morph`                    |
| `@kovojs/test`                       | public harness only                 | split ~21 `*-fixtures` to a private pkg                                              |
| `@kovojs/headless-ui`                | public                              | now a real dep (ui copy-in); document + fence `./tooling`/`./lib`/`./platform-audit` |
| `@kovojs/better-auth`                | public adapter                      | declare `better-auth` dep; curate ~6 exports                                         |
| `@kovojs/compiler`                   | public (curated entry)              | NOT private; `@internal` the rest                                                    |
| `kovo` (CLI)                         | bin + tiny curated `.`              | only `kovoCheck`/`kovoExplain` importable                                            |
| `create-kovo`                        | bin only                            | drop `exports["."]`                                                                  |
| `@kovojs/ui`                         | **private**                         | shadcn copy-in for external; workspace dep internally                                |
| `@kovojs/conformance-fixtures` (new) | **private**                         | split out of `@kovojs/test`                                                          |

---

## Phase 1 — Two concrete bugs (independent, low-risk, do first)

- [x] **Unify the `applyDeferredStreamResponse*` emit↔runtime name + add a resolve-the-bootstrap test** — `packages/compiler/src/emit/bootstrap.ts:35,55` emit/call `applyDeferredStreamResponseToDom`, but `@kovojs/runtime` exports only `applyDeferredStreamResponseToRuntime` (`runtime/src/index.ts:2`); `…ToDom` exists only in tests asserting its absence (`runtime/src/index-exports.test.ts:161`) and a compiler test locking the broken name (`query-coverage.test.ts:638`). It's a _live, exported_ emitter (`emitQueryPlanBootstrapModule`, `compiler/src/index.ts:9`) (SPEC §9.1, §4.4). Pick one canonical name, update emit + the two tests.
  - Done = the emitted bootstrap imports a symbol the published runtime barrel actually exports; a new test compiles `emitQueryPlanBootstrapModule` output and typechecks/resolves its imports against the real `@kovojs/runtime` barrel (not a self-stub), so name drift fails CI.
  - Prove: `pnpm --filter @kovojs/compiler exec vitest run src/query-coverage.test.ts && pnpm --filter @kovojs/runtime exec vitest run src/index-exports.test.ts`
  - Evidence 2026-06-15: `bootstrap.ts` now emits/calls `applyDeferredStreamResponseToRuntime` (identical options shape, verified against `apply-deferred-stream.ts:32`). The self-stubbing that masked the drift is removed: `@kovojs/test` fixtures (`generated-module-fixtures.ts` `GeneratedRuntimeModule` field + Pick unions + executor stub; `starter-template-fixtures.ts` dropped its duplicate `…ToDom` stub) and their `.test.ts` emitted-source strings + `site/content/guides/streaming.md` all use `…ToRuntime`. Only remaining `…ToDom` ref is the intentional deny-list assertion (`index-exports.test.ts:161`).
  - Evidence 2026-06-15: new `packages/compiler/src/emit/bootstrap-runtime-contract.test.ts` extracts the emitted `@kovojs/runtime` import names and asserts each is `Object.hasOwn(runtime, name)` against the real barrel (added `@kovojs/runtime` as a compiler devDep; no cycle). Prove ran green: `pnpm --filter @kovojs/compiler exec vitest run src/query-coverage.test.ts src/emit/bootstrap-runtime-contract.test.ts` (20 passed) + `pnpm --filter @kovojs/runtime exec vitest run src/index-exports.test.ts` (4 passed); test-package fixtures 44 passed.
- [x] **api-ref reads each package's real `exports["."]` target, not hard-coded `src/index.ts`** — `site/scripts/api-ref.mjs:443` hard-codes `src/index.ts` for every package, but `@kovojs/drizzle`'s published `.` is `src/runtime.ts` (`drizzle/package.json:5`) — docs generated from the wrong file, will drift. Resolve each entry from `package.json` `exports`.
  - Done = the generated `gen/api/drizzle.md` is built from `runtime.ts`; the generator errors if a documented package's `.` target is missing.
  - Prove: `node --test site/scripts/api-ref.test.mjs` (or `pnpm --filter @kovojs/site test`)
  - Evidence 2026-06-15: added `resolvePackageEntry()` to `api-ref.mjs` — reads each package's `exports["."]` (string or conditional object, preferring `source`/`development` for the source-reading generator), errors on a missing/unresolvable `.` target. `renderPage` now prints the resolved entry. Regenerated `gen/api/drizzle.md` header = `Generated from \`packages/drizzle/src/runtime.ts\` — 10 exports, 5 documented`. Prove ran green via vitest (the suite uses vitest, not node:test): `pnpm exec vitest run site/scripts/api-ref.test.mjs` (8 passed; drizzle ≥4-documented threshold holds).

---

## Phase 2 — Public-surface source of truth (cheap, gates enforcement)

- [x] **Add a repo-root `publicPackages` manifest** encoding the classification table above, consumed by `api-ref.mjs` (replacing its hand-edited 5-element array, `api-ref.mjs:18-59`) and by the Phase 3 CI gate.
  - Done = one machine-readable manifest is the single source; `api-ref.mjs` imports it; a test asserts every package is classified and every non-public package sets `private:true`.
  - Prove: `node --test site/scripts/api-ref.test.mjs`
  - Evidence 2026-06-15: `public-packages.json` (repo root) classifies all 11 packages (visibility/kind, + `apiRef` order/slug/description for the documented 5). `scripts/public-packages.mjs` exposes `loadPublicPackages`/`publicPackages`/`privatePackages`/`documentedPackages`. `api-ref.mjs` now does `const PACKAGES = documentedPackages()` (hand-edited array deleted). `scripts/public-packages.test.mjs` asserts every `packages/*` is classified exactly once, names match, private→`private:true`, public→not-private, and the documented set is well-formed. Prove ran green: `pnpm exec vitest run scripts/public-packages.test.mjs site/scripts/api-ref.test.mjs` (13 passed; api-ref still emits core/server/runtime/test/drizzle in order).
- [x] **Adopt the `@public`/`@internal` tag convention** — document it in `rules/` (what is public surface, how subpaths are tagged, that `export *` is banned on public barrels). Mark the private packages `private:true` (`@kovojs/ui`, new `@kovojs/conformance-fixtures`). Do NOT mark `@kovojs/compiler` private.
  - Done = `rules/api-surface.md` exists; private packages set `private:true`; `vp check` green.
  - Prove: `pnpm run check`
  - Evidence 2026-06-15: `rules/api-surface.md` documents the manifest-as-source-of-truth, `@public`/`@internal` defaults, the no-`export *`-on-public-barrels rule, and bins-are-not-importable. `@kovojs/ui` now sets `"private": true` (workspace consumers unaffected — confirmed `pnpm install` clean). `@kovojs/conformance-fixtures` does not exist yet (created in Phase 5; it will be added to the manifest as private then). `@kovojs/compiler` deliberately left public. Prove ran green: `pnpm run check` exit 0 (format + typecheck + typecheck-examples).

---

## Phase 3 — Build & distribution pipeline (gating prerequisite)

- [~] **Build `dist` JS + rolled-up `.d.ts` per public package; point `exports`/`types` at `dist`; add `files` allowlist; keep raw source behind a `development`/`source` condition.** Decouples adopters from the monorepo's strict tsconfig + `jsxImportSource`.
  - Done = each public package emits `dist` + a single rolled-up `.d.ts`; `exports`/`types` resolve to `dist`; `files` limits the publish tarball; the workspace still resolves source via the `development` condition; `pnpm run check:build` green.
  - Prove: `pnpm run check:build`
  - PARTIAL / DEFERRED 2026-06-15 (investigated; live `exports` flip intentionally NOT done yet). Findings: a build already exists (`vp pack`, `vite.config.ts:162` `dts:true`) emitting `dist/<pkg>/src/index.mjs` + `.d.mts`, but it (a) only covers `packages/*/src/index.ts` + server app-shell — NOT the subpath surfaces (drizzle `derive`/`static`, headless-ui `primitives/*`, test `*-fixtures`, etc.), and (b) builds `dist/drizzle/src/index.mjs` from `index.ts` though drizzle's real `.` is `runtime.ts`. The whole workspace is source-coupled (NodeNext `exports`→`src`; the compiler reads source; some example tests run real `vite build`). So flipping live `exports`→`dist` safely first requires: expand `pack.entry` to every public export target (matching each `exports` map), add `customConditions:["development"]` to tsconfigs + `resolve.conditions:['development']` to the vite configs so in-repo dev **and** production builds keep resolving source, then conditional `{development:src, types/default:dist}` exports + `files`. That is a large, separable packaging slice; tracked as its own item below. It does NOT block Phases 4–8 (they operate on source + the gate/manifest, both landed).
  - [ ] **(carved-out) Complete the publish build + flip `exports` to dist.** Expand `vp pack` entry coverage to all public export targets; fix the drizzle entry; add `development` conditions (tsconfig `customConditions` + vite `resolve.conditions`); conditional exports + `files`. Prove: `pnpm run check:build` + every example `vite build` + `pnpm run test:p10-perf` (imports `dist/`) green.
- [x] **Move public packages to a real `0.x` line + publish `STABILITY.md`** with a SemVer + deprecation-cycle policy and an `experimental_`/`@experimental` convention for unfrozen surface. (`0.0.0` today says "nothing promised" but nothing states it.)
  - Done = `STABILITY.md` defines public surface + deprecation cadence; public packages versioned `0.x`.
  - Prove: link-check + `pnpm run check`
  - Evidence 2026-06-15: `STABILITY.md` defines what is public (manifest + documented-not-`@internal`), the `0.x` SemVer rule (minor may break until 1.0), the `experimental_`/`@experimental` exemption, the deprecation cycle, and the dist/`@internal`-stripped distribution promise. The 10 public packages bumped `0.0.0`→`0.1.0` (private `@kovojs/ui` + examples/conformance stay `0.0.0`). Prove: `pnpm run check` exit 0.
- [x] **CI gate: fail on untagged-reachable or leaked-`@internal` symbols** — api-extractor (or a custom `.d.ts` checker) driven by the `publicPackages` manifest. This is what makes the boundary binding rather than conventional.
  - Done = a deliberately-leaked `@internal` symbol and a deliberately-untagged public export both fail the gate in a fixture; the gate runs in `acceptance`.
  - Prove: `pnpm run acceptance` (gate step)
  - Evidence 2026-06-15: `scripts/api-surface-gate.mjs` enumerates every symbol reachable from each public package's `exports` map (resolved to source) via the TS checker and flags those neither documented nor `@internal`. Repo starts with **3957** such exports (quantifies the audit's systemic finding), so the gate is a RATCHET against `api-surface-baseline.json` — fails only on NEW leaks; Phases 4–8 shrink the baseline (regenerate with `--write`). Wired into `acceptance` as `pnpm run check:api-surface` (`package.json`). `scripts/api-surface-gate.test.mjs` proves the ratchet flags a new leak and recognizes a fixed one, and that the baseline stays in sync. Prove ran green: gate exit 0; `pnpm exec vitest run scripts/api-surface-gate.test.mjs` (3 passed).

---

## Phase 4 — Fence the build/CLI/internal-leaning packages

- [ ] **`@kovojs/compiler`: curated public entry + `@internal` the rest** — keep the template/build-facing symbols public (`deriveAppGraph`, `compileComponentModule`, `assertFixpoint`, `assertRenderEquivalence`, `emitQueryPlanBootstrapModule`, the Vite plugin); `@internal` the lowered-IR fact shapes and the redundant `./graph` subpath duplication. NOT private (templates depend on it).
  - Done = `create-kovo` template + example `emit-graph`/fixpoint tests still resolve; non-template compiler internals are `@internal`/stripped.
  - Prove: `pnpm --filter create-kovo exec vitest run && pnpm run check`
- [ ] **`kovo` + `create-kovo`: drop/curate `exports["."]`** — `kovo` exposes only `kovoCheck`/`kovoExplain` (documented, with a `kovo` api-ref page); move `main`/`mainAsync`/MCP transport/`compileComponentV1` off the public entry. `create-kovo` drops `exports["."]` (a bin needs none). Sequence with the curated entry so example/test imports don't break. (`cli/src/index.ts`, `create-kovo/src/index.ts`)
  - Done = `kovo`'s `.` exports only the two documented helpers; the MCP/argv/compile internals are unreachable from the package root; examples/tests updated.
  - Prove: `pnpm --filter kovo exec vitest run && pnpm run check`
- [ ] **`@kovojs/headless-ui`: remove the `./tooling` CLI export, fence `./lib`/`./platform-audit`, document the public primitive surface** — it's now an external dependency (ui copy-in imports it). Run the primitive linter via the existing lint script, not a published subpath.
  - Done = `./tooling` is gone from `exports`; `./lib`/`./platform-audit` are `@internal` or dropped; the public primitive subpaths have docs; lint still runs.
  - Prove: `pnpm --filter @kovojs/headless-ui run lint:primitives && pnpm run check`

---

## Phase 5 — Curate the documented app-facing barrels

- [ ] **`@kovojs/core`: carve the verifier/IR types off the root barrel** — move `graph.ts` (`TouchGraph`, `KovoCheckInput`, every `*Explain`/`*Fact`/`*Check`, `validateKovoExplainInput`) and `derivation.ts` IR (`PatchProgram`, `SymbolicValue`, `Rowset`, `applyPatchProgram`) behind `@kovojs/core/verify` (or `@internal`); keep `component`/`route`/`query`/`form`/`event`/storage/webhook verifiers on root (`core/src/index.ts:33-72`; `gen/api/core.md` flags 70 as `*Undocumented.*`).
  - Done = `gen/api/core.md` documents only app primitives; verifier/IR consumers import the new subpath; `*Undocumented.*` count drops to ~0 on the root page.
  - Prove: `node --test site/scripts/api-ref.test.mjs && pnpm run check`
- [ ] **`@kovojs/server`: carve internal helpers behind `@kovojs/server/internal`; reclassify `app-shell/vite`** — move `escapeHtml`/`escapeText`/`escapeAttribute`, `shellDispatchTable`/`matchShellDispatch`, the mutation-wire parsers, and `findRouteAmbiguities` (KV228) off the flat `export *` barrel (`server/src/index.ts:7-9`). `app-shell/vite` is host-build-internal, not app-facing.
  - Done = the server root barrel exports only the documented app surface (`route`, `guards`, `s`, rendering entry, …); wire/escape/dispatch helpers live behind an internal subpath.
  - Prove: `pnpm --filter @kovojs/server exec vitest run && pnpm run check`
- [ ] **`@kovojs/runtime`: split human-facing vs emit-target surfaces (COUPLED to compiler emit)** — keep `derive`/`handler`/`tempId`/`OptimisticFor` (+ optimistic types) on root for hand-written app code; move the loader/morph/dispatcher/`Compiled*` stamps/`kovoLoaderSource` behind `@kovojs/runtime/loader`. Update the emitters (`emit/client.ts`, `emit/bootstrap.ts`, `lower/inline-derives.ts`) and the gallery `.replaceAll` in lockstep so emitted imports stay resolvable. Replace the negative deny-list test (`index-exports.test.ts`) with a **positive allow-list snapshot**, and replace `export * from './events.js'` (`index.ts:8`) with an explicit named list.
  - Done = hand-written app imports unchanged; emitted modules import from the new subpath and resolve against the published barrel; a positive allow-list snapshot guards the surface; no `export *` on the barrel.
  - Prove: `pnpm --filter @kovojs/runtime exec vitest run && pnpm --filter @kovojs/compiler exec vitest run && pnpm run test:browser`
- [ ] **`@kovojs/test`: split the ~21 `*-fixtures` subpaths into a private `@kovojs/conformance-fixtures`** — keep the curated, documented harness root barrel (`createKovoTestHarness`/`createDbVerifier`/`createPgliteTestDb`, SPEC §10.1/§11) public; the fixtures (compiler-fixtures, wire-fixtures, vite-fixtures, generated-module-fixtures, …) are internal monorepo support.
  - Done = `@kovojs/test` exports only the harness surface; internal suites import fixtures from the new private package; `acceptance` green.
  - Prove: `pnpm run test && pnpm run test:conformance`

---

## Phase 6 — Reshape questionable public types + declare deps

- [ ] **`@kovojs/server` guards: model the result as a discriminated union; framework owns status mapping** — `GuardFailure.status` is typed `422 | 429` (`guards.ts:11`, public via `api/routing.ts:28`) but SPEC §6.5 (line 564) says unauthorized→403 shell and unauthenticated→303 redirect; the remap hides in `renderHttpGuardFailureResponse` (`guards.ts:243`). Replace `boolean | GuardFailure` with `{allow} | {deny:'forbidden'} | {deny:'unauthenticated'} | {rateLimited}`; cite §6.5 in JSDoc.
  - Done = the public guard result advertises only statuses the documented auth paths produce; the bare-boolean smell is gone; behavior unchanged.
  - Prove: `pnpm --filter @kovojs/server exec vitest run src/guards.test.ts`
- [ ] **`@kovojs/drizzle`: declare `ts-morph` as a real dependency** — `./static` (build-time, consumed by every example's `emit-graph.mjs`) imports `ts-morph`, currently only a devDependency.
  - Done = `ts-morph` is a `dependencies` entry; a fresh install of `@kovojs/drizzle` can run `./static`.
  - Prove: `pnpm install && pnpm --filter @kovojs/drizzle exec vitest run`
- [ ] **`@kovojs/better-auth`: declare the `better-auth` dependency, curate the barrel, document the security-relevant default** — `better-auth` is not a dep/peer/devDep today; the barrel publishes ~103 exports where ~6 are the real contract; `mount()` hardcodes `csrf: false` (`index.ts:90`) with no symbol-level doc. Declare the dep (or peer), `@internal` the KV406 degradation-fact types, document `mount`'s CSRF posture (SPEC §6.6).
  - Done = `better-auth` is a declared dependency; the public barrel is the curated auth contract; `mount`'s `csrf:false` is documented as the externally-authenticated-endpoint opt-out.
  - Prove: `pnpm --filter @kovojs/better-auth exec vitest run && pnpm run check`
- [ ] **`kovo` `CompileComponentV1Result`: give the facts real types or keep them bin-only** — `cli/src/index.ts:154-166` exposes `componentGraphFacts`/`queryUpdatePlans`/`updateCoverage`/… as `readonly unknown[]`. Either type them from `@kovojs/compiler` behind an explicitly-internal entry, or remove from the public surface (covered by the Phase 4 CLI curation).
  - Done = no `readonly unknown[]` fact bag on a public package root.
  - Prove: `pnpm --filter kovo exec vitest run`

---

## Phase 7 — `@kovojs/ui` copy-in model

- [ ] **Mark `@kovojs/ui` `private:true`; keep the workspace import for in-repo apps** (examples/site continue importing it `@/components/ui`-style). External consumption is copy-in only.
  - Done = `@kovojs/ui` is `private:true`; examples/site still build; it is absent from the external `publicPackages` manifest.
  - Prove: `pnpm run check:build`
- [ ] **Stop `@kovojs/ui` `*StateProps` extending headless-ui state interfaces; expose only author-facing props** — `select.tsx:18-30` re-exposes `listboxId`/`highlightedValue`/`open` and every sub-part `extends` it; it re-exports headless `SelectItem` through a styled prop. ~111 of ~175 exported `*Props` inherit one such interface (Radix/shadcn keep the state machine inside the primitive).
  - Done = styled components expose only author-facing knobs; no `extends` of headless-ui state interfaces; no headless type re-exported through a styled prop.
  - Prove: `pnpm --filter @kovojs/ui exec vitest run && pnpm run test:browser`
- [ ] **Provide the shadcn-style copy-in/registry mechanism + docs for external apps** — copied `.tsx` imports the now-public, documented `@kovojs/headless-ui`. Document the "you own the code" flow.
  - Done = a documented copy-in path exists; copied components resolve against the public `@kovojs/headless-ui`; a smoke test copies one component into a scratch app and builds it.
  - Prove: copy-in smoke test + `pnpm run check`

---

## Phase 8 — Reference truth

- [ ] **Drive `api-ref` from the `publicPackages` manifest (all public packages, not the hand-picked 5); exclude `@internal`; add a STABILITY page** — keep the "undocumented exports flagged, never omitted" principle (`api-ref.mjs:11`), but apply it across the full public surface with `@internal` excluded.
  - Done = every public package has a generated reference page; `@internal` symbols are excluded (not listed as `*Undocumented.*`); a STABILITY page links the policy.
  - Prove: `node --test site/scripts/api-ref.test.mjs && pnpm run check:build`
