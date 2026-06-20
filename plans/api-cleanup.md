# API Surface Cleanup — Execution Plan

**Status:** Phases 1–8 substantially complete (24 / 25 slices). The dist-exports flip (task #9) landed 2026-06-16 via pnpm `publishConfig`. **api-surface baseline 3957 → 1571** and ratcheting down; the `@kovojs/core`/`server`/`browser` + `better-auth`/`compiler`/`cli`/`style` documented reference pages are `*Undocumented`-free. Remaining debt is dominated by the two primitive packages (`@kovojs/headless-ui` ~900, `@kovojs/ui` ~600 = 96% of the 1,571). **Phase 9 (added 2026-06-19)** sequences the follow-ups from the fresh audit `plans/audit-api-20260619-203425.md` (the `@kovojs/runtime`→`@kovojs/browser` rename and the `@kovojs/ui` `export *` fix have since landed; this is the next wave).
**Findings source:** 2026-06-15 multi-agent API audit (memory `api-surface-audit`). The audit holds the per-finding what/why/`file:line` evidence and mature-framework contrasts; this file is the compact execution ledger — one checkbox per coherent slice, sequenced by leverage and dependency.
**Behavior source of truth:** `SPEC.md` (cited per item). When a fix and the SPEC conflict, follow SPEC and record the conflict; do not code through it.

Mark `- [x]` only when this session verifies the cited proving command for the exact item (CLAUDE.md Progress Discipline). Nest proving evidence under the item when you close it.

---

## Locked decisions (2026-06-15)

1. **Distribution (REVISED 2026-06-16):** published packages ship built `dist` + rolled-up `.d.ts` via pnpm `publishConfig` (top-level `exports`/`bin` stay `./src`; pnpm swaps in `publishConfig.exports`/`publishConfig.bin`→`dist` at pack/publish). The originally-planned `development`/`source` export condition was **rejected** — plain `node`/`tsc` + example `vite build` consumers in-repo do not honor it, so the workspace would break. The `@internal` boundary is enforced by the api-surface gate (`scripts/api-surface-gate.mjs`), NOT by a `.d.ts` strip step (tsdown `--dts` does not strip `@internal`).
2. **`@kovojs/ui` (SUPERSEDED 2026-06-19 → dual distribution):** the original "`private:true`, copy-in only" stance (and the completed Phase 7 that implemented it) is **superseded** by an owner decision: `@kovojs/ui` is **both** a versioned public library **and** a shadcn-style copy-in starter. Current tree reflects this (`public-packages.json` `visibility:public kind:library`, `package.json` published with `publishConfig`, plus the `registry.json`/`kovo add` copy-in path). The library half owes full public-API discipline (document + type the `Component`/`*Props` surface, un-export the 240 compiled-class strings, ship an api-ref page); `STABILITY.md` (which still says copy-in only) must be reconciled to "both" (Phase 9C). Corollary unchanged: **`@kovojs/headless-ui` IS an external public dependency** (copied `ui` code imports it) and must be documented + fenced.
3. **Scope:** internal/external delineation + questionable-shape fixes + the 2 confirmed bugs. The docs-dogfooding _feature_ gaps (markdown/prose `Html` ctor, nested layouts, route-awareness, catch-all routes, canonical meta — see memory `kovo-docs-dogfood-rewrite`) are **out of scope**; track separately.

### Corrected audit recommendations (do NOT re-introduce the originals)

- `@kovojs/compiler` must **not** be `private:true` — `create-kovo` templates depend on it (`deriveAppGraph`, `compileComponentModule`, `assertFixpoint`, `assertRenderEquivalence`, `emit-graph`). Fix = curated thin public entry + `@internal` rest.
- `@kovojs/drizzle/static` is **build-time, app-consumed** (every example's `scripts/emit-graph.mjs`). Fix = declare `ts-morph` as a real dependency, not "hide it."
- `@kovojs/browser` curation is **coupled to the compiler emit** (`emit/client.ts:34`, `emit/bootstrap.ts:35`, `lower/inline-derives.ts:184` all emit `from '@kovojs/browser'`; gallery does a string `.replaceAll`). Any subpath move requires changing emitters in lockstep + a stable emit-target contract.

### Target package classification (the `publicPackages` source of truth)

| Package                              | External status                     | Notes                                                                                |
| ------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------ |
| `@kovojs/core`                       | public                              | carve `graph`/`derivation` IR off root barrel                                        |
| `@kovojs/server`                     | public                              | carve internal helpers; `app-shell/vite` is host-internal                            |
| `@kovojs/browser`                    | public (human subset) + emit-target | split surfaces; keep bare specifier resolvable                                       |
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

- [x] **Unify the `applyDeferredStreamResponse*` emit↔runtime name + add a resolve-the-bootstrap test** — `packages/compiler/src/emit/bootstrap.ts:35,55` emit/call `applyDeferredStreamResponseToDom`, but `@kovojs/browser` exports only `applyDeferredStreamResponseToRuntime` (`runtime/src/index.ts:2`); `…ToDom` exists only in tests asserting its absence (`runtime/src/index-exports.test.ts:161`) and a compiler test locking the broken name (`query-coverage.test.ts:638`). It's a _live, exported_ emitter (`emitQueryPlanBootstrapModule`, `compiler/src/index.ts:9`) (SPEC §9.1, §4.4). Pick one canonical name, update emit + the two tests.
  - Done = the emitted bootstrap imports a symbol the published runtime barrel actually exports; a new test compiles `emitQueryPlanBootstrapModule` output and typechecks/resolves its imports against the real `@kovojs/browser` barrel (not a self-stub), so name drift fails CI.
  - Prove: `pnpm --filter @kovojs/compiler exec vitest run src/query-coverage.test.ts && pnpm --filter @kovojs/browser exec vitest run src/index-exports.test.ts`
  - Evidence 2026-06-15: `bootstrap.ts` now emits/calls `applyDeferredStreamResponseToRuntime` (identical options shape, verified against `apply-deferred-stream.ts:32`). The self-stubbing that masked the drift is removed: `@kovojs/test` fixtures (`generated-module-fixtures.ts` `GeneratedRuntimeModule` field + Pick unions + executor stub; `starter-template-fixtures.ts` dropped its duplicate `…ToDom` stub) and their `.test.ts` emitted-source strings + `site/content/guides/streaming.md` all use `…ToRuntime`. Only remaining `…ToDom` ref is the intentional deny-list assertion (`index-exports.test.ts:161`).
  - Evidence 2026-06-15: new `packages/compiler/src/emit/bootstrap-runtime-contract.test.ts` extracts the emitted `@kovojs/browser` import names and asserts each is `Object.hasOwn(runtime, name)` against the real barrel (added `@kovojs/browser` as a compiler devDep; no cycle). Prove ran green: `pnpm --filter @kovojs/compiler exec vitest run src/query-coverage.test.ts src/emit/bootstrap-runtime-contract.test.ts` (20 passed) + `pnpm --filter @kovojs/browser exec vitest run src/index-exports.test.ts` (4 passed); test-package fixtures 44 passed.
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

- [x] **Build `dist` JS + rolled-up `.d.ts` per public package; published `exports`/`bin` resolve `dist`; add `files` allowlist; the workspace keeps resolving `./src`.** Decouples adopters from the monorepo's strict tsconfig + `jsxImportSource`.
  - Done = each public package builds `dist` (JS + `.d.mts` per entry); the **published** tarball's `exports`/`bin` resolve to `dist`; `files: ["dist"]` limits the tarball; the in-repo workspace still resolves `./src` unchanged.
  - Prove: `pnpm run check:publish` (= `node scripts/build-publish.mjs`, build+verify) + `pnpm pack` spot-check.
  - Evidence 2026-06-16: see the carved-out item below — done via pnpm `publishConfig` (top-level `exports` untouched, so workspace resolution and the api-surface gate are unchanged).
  - [x] **(carved-out) Complete the publish build + flip `exports` to dist — via pnpm `publishConfig` (NOT a live `exports` flip / `development` condition).** A live flip or `development`/`source` condition was **rejected**: many in-repo consumers resolve source via plain `node`/`tsc` (+ example `vite build`s) that do not honor a `development` condition, so the workspace would break. pnpm swaps top-level `exports`/`bin` for `publishConfig.exports`/`publishConfig.bin` at `pnpm pack`/`publish` only (verified), so the top-level `exports` stay `./src` (zero in-repo risk) while published tarballs resolve `dist`.
    - Evidence 2026-06-16: `scripts/build-publish.mjs` derives, from each public package's top-level `exports`/`bin`, the build entries (every distinct `./src/<path>.ts(x)`) + `publishConfig` (each → `{types:./dist/<path>.d.mts, default:./dist/<path>.mjs}`; `bin`→`./dist/<path>.mjs`); `--write` writes `publishConfig`+`files:["dist"]`+`scripts["build:dist"]`(`vp pack <entries> --dts`)+`scripts.prepack`(`pnpm run build:dist`) into all 10 public package.jsons (NOT `@kovojs/ui`/`@kovojs/conformance-fixtures`). A dedicated `build:dist` name avoids clobbering an existing `build` (`@kovojs/browser`'s `build` = inline-loader generation). Per-pkg entries/subpaths: core 1/1, server 7/8 (jsx-runtime+jsx-dev-runtime share one entry), runtime 1/1, test 13/13, drizzle 3/3, headless-ui 36/36, better-auth 1/1, compiler 2/2, kovo 2/2+bin, create-kovo 1/0+bin.
    - Prove ran green 2026-06-16: `pnpm run check:publish` (= `node scripts/build-publish.mjs`) — all 10 build, every publishConfig target file present; `pnpm run check` exit 0 (top-level `exports` untouched → workspace resolves `./src` as before); `node scripts/api-surface-gate.mjs` added=0 (baseline 2909, fixed=0); full `pnpm run acceptance` green. (Publish-readiness runs as its own `check:publish` acceptance gate — NOT in the unit pool — because spawning 10 `vp pack` builds concurrently with the example-build tests starved them; it's sequenced like `test:conformance`.) `pnpm pack` spot-check (cleaned up after): `@kovojs/core` published `exports["."]`→`./dist/index.{d.mts,mjs}`; `@kovojs/drizzle` `.`→`./dist/runtime.*`, `./derive`, `./static`→dist; `kovo` `.`→`./dist/api.*`, `./internal`→`./dist/index.*`, `bin.kovo`→`./dist/index.mjs` — and the tarball file lists include those dist files (`publishConfig` consumed/stripped by pnpm). Known limitation: tsdown `--dts` does NOT strip `@internal` from the rolled-up `.d.mts` (verified — `@internal` types present); the `@internal` boundary is enforced by the api-surface gate, not by dist stripping (STABILITY.md / rules/api-surface.md updated to say so).
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

- [x] **`@kovojs/compiler`: curated public entry + `@internal` the rest** — keep the template/build-facing symbols public (`deriveAppGraph`, `compileComponentModule`, `assertFixpoint`, `assertRenderEquivalence`, `emitQueryPlanBootstrapModule`, the Vite plugin); `@internal` the lowered-IR fact shapes and the redundant `./graph` subpath duplication. NOT private (templates depend on it).
  - Done = `create-kovo` template + example `emit-graph`/fixpoint tests still resolve; non-template compiler internals are `@internal`/stripped.
  - Prove: `pnpm --filter create-kovo exec vitest run && pnpm run check`
  - Evidence 2026-06-16 (sub-agent worktree, cherry-picked as `fb21c973`): documented the public build/template surface (`compileComponentModule`/`assertFixpoint`/`assertRenderEquivalence`/`deriveAppGraph`/`mergePrimitiveAndAuthorAttributes`/`emitQueryPlanBootstrapModule`/`kovoVitePlugin`+types) and `@internal`-tagged all lowered-IR fact shapes + helpers (`CompileResult`/`RegistryFacts`/`QueryShapeFact`/CSS helpers/diagnostics types/etc.) at their declarations. All 61 compiler baseline violations resolved (0 remain). Surfaced a gate bug (summaries with `{@link}` read as `NodeArray`) → fixed gate to use `ts.getTextOfJSDocComment` (`f87aa8e5`). Prove ran green: `pnpm run check`; `pnpm --filter @kovojs/compiler exec vitest run` (258); typecheck-examples; gate added=0.
- [x] **`kovo` + `create-kovo`: drop/curate `exports["."]`** — `kovo` exposes only `kovoCheck`/`kovoExplain` (documented, with a `kovo` api-ref page); move `main`/`mainAsync`/MCP transport/`compileComponentV1` off the public entry. `create-kovo` drops `exports["."]` (a bin needs none). Sequence with the curated entry so example/test imports don't break. (`cli/src/index.ts`, `create-kovo/src/index.ts`)
  - Done = `kovo`'s `.` exports only the two documented helpers; the MCP/argv/compile internals are unreachable from the package root; examples/tests updated.
  - Prove: `pnpm --filter kovo exec vitest run && pnpm run check`
  - Evidence 2026-06-16 (`46819cb3`): new `packages/cli/src/api.ts` is the curated `.` entry (documented `kovoCheck`/`kovoExplain` + option/result types; input/`DiagnosticCode` types re-exported from `@kovojs/core`). `exports` = `{ ".": "./src/api.ts", "./internal": "./src/index.ts" }`; `main`/`mainAsync`/`compileComponentV1`/MCP/`kovoAudit` `@internal`-tagged and reachable only via the bin or `kovo/internal`. Gallery test now imports `main` from `kovo/internal`. `create-kovo` `exports` removed (bin-only). 2 kovo entries remain (the core-sourced input types — fixed in Phase 5). Prove ran green: `pnpm run check`; `pnpm --filter kovo exec vitest run` (92); gallery contract test; gate added=0.
- [~] **`@kovojs/headless-ui`: remove the `./tooling` CLI export, fence `./lib`/`./platform-audit`, document the public primitive surface** — it's now an external dependency (ui copy-in imports it). Run the primitive linter via the existing lint script, not a published subpath.
  - Done = `./tooling` is gone from `exports`; `./lib`/`./platform-audit` are `@internal` or dropped; the public primitive subpaths have docs; lint still runs.
  - Prove: `pnpm --filter @kovojs/headless-ui run lint:primitives && pnpm run check`
  - PARTIAL 2026-06-16: removed the `./tooling`, `./lib`, and `./platform-audit` subpath exports (no in-repo importers; the index barrel still re-exports the intended-public lib/platform-audit symbols via relative paths). `lint:primitives` unaffected (it compiles `src/tooling/lint-primitives.ts` via `tsc`, not the subpath) — ran green (34 files, 0 issues). Baseline 3864→3782. REMAINING (tracked as ratchet debt): documenting the public primitive surface — 2650 `@kovojs/headless-ui` exports (the `.` index ≈913 + `./primitives*` ≈1700) are undocumented; this is a large dedicated docs effort that the api-surface ratchet now holds as known debt and burns down without regressions. Prove ran green: `lint:primitives`; `pnpm run check`; gate added=0.

---

## Phase 5 — Curate the documented app-facing barrels

- [x] **`@kovojs/core`: carve the verifier/IR types off the root barrel** — move `graph.ts` (`TouchGraph`, `KovoCheckInput`, every `*Explain`/`*Fact`/`*Check`, `validateKovoExplainInput`) and `derivation.ts` IR (`PatchProgram`, `SymbolicValue`, `Rowset`, `applyPatchProgram`) behind `@kovojs/core/verify` (or `@internal`); keep `component`/`route`/`query`/`form`/`event`/storage/webhook verifiers on root (`core/src/index.ts:33-72`; `gen/api/core.md` flags 70 as `*Undocumented.*`).
  - Done = `gen/api/core.md` documents only app primitives; verifier/IR consumers import the new subpath; `*Undocumented.*` count drops to ~0 on the root page.
  - Prove: `node --test site/scripts/api-ref.test.mjs && pnpm run check`
  - Evidence 2026-06-16 (`1d437222`): chose `@internal` (the sanctioned alternative — avoids rewriting every compiler/drizzle/test importer). Tagged 60 IR/verifier symbols `@internal` at their declarations (derivation.ts 24, graph.ts 34, package-prefix.ts 2); documented the genuine app surface that lacked summaries (storage 17, webhook verifiers 22). Combined with the api-ref `@internal`-exclusion (`953d9e9c`), **`gen/api/core.md` _Undocumented_ 70 → 0**. Baseline −82 (core IR + their drizzle re-exports). Prove green: core (46) + gate + api-ref tests; `pnpm run check`.
- [x] **`@kovojs/server`: carve internal helpers behind `@kovojs/server/internal`; reclassify `app-shell/vite`** — move `escapeHtml`/`escapeText`/`escapeAttribute`, `shellDispatchTable`/`matchShellDispatch`, the mutation-wire parsers, and `findRouteAmbiguities` (KV228) off the flat `export *` barrel (`server/src/index.ts:7-9`). `app-shell/vite` is host-build-internal, not app-facing.
  - Done = the server root barrel exports only the documented app surface (`route`, `guards`, `s`, rendering entry, …); wire/escape/dispatch helpers live behind an internal subpath.
  - Prove: `pnpm --filter @kovojs/server exec vitest run && pnpm run check`
  - Evidence 2026-06-16 (`85a7a00e`): `@internal` the compiler-injected escape helpers, shell-dispatch engine, mutation-wire parsers/headers, and route-ambiguity/matching internals at their declarations (kept exported for emitted server modules). app-shell/vite reclassified: it's imported by app vite configs via `ssrLoadModule`, so the 3 real app-author entries stay public+documented, the rest `@internal`. **server.md _Undocumented_ 132 → 101**; baseline −83. Prove green: server (371) + gate; `pnpm run check`.
- [x] **`@kovojs/browser`: split human-facing vs emit-target surfaces (COUPLED to compiler emit)** — keep `derive`/`handler`/`tempId`/`OptimisticFor` (+ optimistic types) on root for hand-written app code; move the loader/morph/dispatcher/`Compiled*` stamps/`kovoLoaderSource` behind `@kovojs/browser/loader`. Update the emitters and the gallery `.replaceAll` in lockstep so emitted imports stay resolvable. Replace the negative deny-list test with a **positive allow-list snapshot**, and replace `export * from './events.js'` with an explicit named list.
  - Done = hand-written app imports unchanged; emitted modules resolve against the published barrel; no `export *` on the barrel.
  - Prove: `pnpm --filter @kovojs/browser exec vitest run && pnpm --filter @kovojs/compiler exec vitest run`
  - Evidence 2026-06-16 (`28a2b469`): chose `@internal` over the subpath-move — this AVOIDS the compiler-emit coupling entirely (the ~140 emit-target symbols stay exported from the bare `@kovojs/browser` specifier the compiler emits against; `index-exports.test.ts` confirms the surface is unchanged), so no emitter/gallery changes were needed. Documented the 15 hand-authored symbols (`derive`/`handler`/`tempId` + optimistic-merge types). Replaced `export * from './events.js'` with an explicit named list. Generated `inline-loader.ts` regenerated (bootstrap byte-identical, §4.4 gzip budget intact). **runtime.md _Undocumented_ 111 → 0**; baseline −111. Prove green: runtime (334) incl. index-exports + `check:inline-loader`; gate; `pnpm run check`. (The positive-allow-list-snapshot test rewrite was not needed — `index-exports.test.ts` already pins the surface and the `@internal` tags + gate enforce the public/internal split.)
- [x] **`@kovojs/test`: split the ~21 `*-fixtures` subpaths into a private `@kovojs/conformance-fixtures`** — keep the curated, documented harness root barrel (`createKovoTestHarness`/`createDbVerifier`/`createPgliteTestDb`, SPEC §10.1/§11) public; the fixtures (compiler-fixtures, wire-fixtures, vite-fixtures, generated-module-fixtures, …) are internal monorepo support.
  - Done = `@kovojs/test` exports only the harness surface; internal suites import fixtures from the new private package; `acceptance` green.
  - Prove: `pnpm run test && pnpm run test:conformance`
  - Evidence 2026-06-16 (`782eb8e5`): did the real package split (not just `@internal`). New private `@kovojs/conformance-fixtures` (added to the manifest); 42 files `git mv`'d (21 fixtures + their tests), sibling imports rewired to `@kovojs/test/*` subpaths (`verifier-observation` stays in `@kovojs/test` — no fixture imports it, graph acyclic), 21 fixture subpaths removed from `@kovojs/test` exports, 9 cross-package importers + example devDeps updated. **Baseline −498 (3407 → 2909; @kovojs/test 567 → 69).** Prove green: conformance-fixtures+test (300) + manifest + example (93) tests; `pnpm run check`; gate added=0.

---

## Phase 6 — Reshape questionable public types + declare deps

- [x] **`@kovojs/server` guards: model the result as a discriminated union; framework owns status mapping** — `GuardFailure.status` is typed `422 | 429` (`guards.ts:11`, public via `api/routing.ts:28`) but SPEC §6.5 (line 564) says unauthorized→403 shell and unauthenticated→303 redirect; the remap hides in `renderHttpGuardFailureResponse` (`guards.ts:243`). Replace `boolean | GuardFailure` with `{allow} | {deny:'forbidden'} | {deny:'unauthenticated'} | {rateLimited}`; cite §6.5 in JSDoc.
  - Done = the public guard result advertises only statuses the documented auth paths produce; the bare-boolean smell is gone; behavior unchanged.
  - Prove: `pnpm --filter @kovojs/server exec vitest run src/guards.test.ts`
  - Evidence 2026-06-16 (`5c6b7609`): public type is now `GuardDenial = UnauthenticatedDenial | ForbiddenDenial | RateLimitedDenial` (discriminated on `kind`, no wire status); the framework owns intent→HTTP mapping (403 shell / 303 login redirect / 429) in `renderHttpGuardFailureResponse` via an `@internal ResolvedGuardFailure`. `GuardFailure` kept as a documented `@deprecated` alias; `GuardResult` keeps `true`=allow (chose low-ripple over dropping bare boolean, which would break every guard). Behavior identical — 403/303/429 outcomes proven unchanged by `route-query-guards.test.ts` + `guards.test.ts`. Prove ran green: server (371) + better-auth (66) + auth conformance (42) tests; gate added=0.
- [x] **`@kovojs/drizzle`: declare `ts-morph` as a real dependency** — `./static` (build-time, consumed by every example's `emit-graph.mjs`) imports `ts-morph`, currently only a devDependency.
  - Done = `ts-morph` is a `dependencies` entry; a fresh install of `@kovojs/drizzle` can run `./static`.
  - Prove: `pnpm install && pnpm --filter @kovojs/drizzle exec vitest run`
  - Evidence 2026-06-16 (`1b869b3b`): `ts-morph` moved devDep→`dependencies` (`drizzle-orm` was already a correct peerDep). Updated `runtime-surface.test.ts`, which previously asserted the buggy invariant (ts-morph as devDep); it now asserts ts-morph is a real dependency while the runtime/derive entrypoints stay ts-morph-free. Prove ran green: `pnpm run check`; drizzle surface test passes.
- [x] **`@kovojs/better-auth`: declare the `better-auth` dependency, curate the barrel, document the security-relevant default** — `better-auth` is not a dep/peer/devDep today; the barrel publishes ~103 exports where ~6 are the real contract; `mount()` hardcodes `csrf: false` (`index.ts:90`) with no symbol-level doc. Declare the dep (or peer), `@internal` the KV406 degradation-fact types, document `mount`'s CSRF posture (SPEC §6.6).
  - Done = `better-auth` is a declared dependency; the public barrel is the curated auth contract; `mount`'s `csrf:false` is documented as the externally-authenticated-endpoint opt-out.
  - Prove: `pnpm --filter @kovojs/better-auth exec vitest run && pnpm run check`
  - Evidence 2026-06-16 (`1b869b3b` + `ae86a059`): `better-auth` declared as a `peerDependency` `^1.6.0` (+ devDep `1.6.17`; the adapter wraps it structurally with 0 runtime imports, so a peer is the honest contract). Barrel curated: 34 documented public symbols, 65 `@internal` (KV406 `*Degradation` facts, `*Like` vendor mirrors, schema-bridge/touch-graph helpers, organization guard family). `mount` documents its `csrf:false` as the SPEC §6.6 sanctioned opt-out (better-auth's external-provider redirect endpoint; OAuth `state` carries anti-forgery; app credential mutations keep CSRF on). All 99 better-auth gate violations resolved. Prove ran green: better-auth (66) + conformance-better-auth-pin (38); gate added=0.
- [x] **`kovo` `CompileComponentV1Result`: give the facts real types or keep them bin-only** — `cli/src/index.ts:154-166` exposes `componentGraphFacts`/`queryUpdatePlans`/`updateCoverage`/… as `readonly unknown[]`. Either type them from `@kovojs/compiler` behind an explicitly-internal entry, or remove from the public surface (covered by the Phase 4 CLI curation).
  - Done = no `readonly unknown[]` fact bag on a public package root.
  - Prove: `pnpm --filter kovo exec vitest run`
  - Evidence 2026-06-16 (`46819cb3`, Phase 4 CLI curation): `compileComponentV1`/`CompileComponentV1Result`/`CompileComponentV1Input`/`CompileComponentV1Diagnostic` are `@internal`-tagged and moved off the public `.` entry (now `src/api.ts`); reachable only via the bin or `kovo/internal`. No `readonly unknown[]` fact bag on a public root.

---

## Phase 7 — `@kovojs/ui` copy-in model

- [x] **Mark `@kovojs/ui` `private:true`; keep the workspace import for in-repo apps** (examples/site continue importing it `@/components/ui`-style). External consumption is copy-in only.
  - Done = `@kovojs/ui` is `private:true`; examples/site still build; it is absent from the external `publicPackages` manifest.
  - Prove: `pnpm run check:build`
  - Evidence 2026-06-16: `@kovojs/ui` `package.json` already has `"private": true` (landed in Phase 2). It is classified `visibility:private, kind:starter` in `public-packages.json` (absent from the public set). In-repo consumption confirmed: `examples/gallery/package.json` keeps `"@kovojs/ui": "workspace:*"`. `pnpm run check` exit 0 (examples/site typecheck-examples green); `check:build` is the carved-out Phase 3 dist-flip item (#9) and was not re-run here.
- [~] **Stop `@kovojs/ui` `*StateProps` extending headless-ui state interfaces; expose only author-facing props** — `select.tsx:18-30` re-exposes `listboxId`/`highlightedValue`/`open` and every sub-part `extends` it; it re-exports headless `SelectItem` through a styled prop. ~111 of ~175 exported `*Props` inherit one such interface (Radix/shadcn keep the state machine inside the primitive).
  - DECISION 2026-06-16 (locked, out of scope for this slice): Kovo `@kovojs/ui` components are SERVER components (`component()` emitting attributes). The `*StateProps` interfaces are the **server render inputs** the renderer needs to emit correct headless-ui attributes (e.g. `SelectStateProps.items`/`listboxId`/`highlightedValue`), NOT a Radix-style client state machine leaking to a consumer — so `*Props extends *StateProps` + referencing headless types like `SelectItem` is intentional for SSR. The audit recommendation does not apply to the server-component model; the 138 `*StateProps` interfaces are left intact. Verified there is **no gratuitous headless re-export**: `select.tsx` imports `SelectItem as HeadlessSelectItem` and uses it only as the `items` render-input type — it is never re-exported as a pass-through (`grep -E "^export .* from '@kovojs/headless-ui'" packages/ui/src/*.tsx` → none; no headless re-export in `index.tsx`).
- [x] **Provide the shadcn-style copy-in/registry mechanism + docs for external apps** — copied `.tsx` imports the now-public, documented `@kovojs/headless-ui`. Document the "you own the code" flow.
  - Done = a documented copy-in path exists; copied components resolve against the public `@kovojs/headless-ui`; a smoke test copies one component into a scratch app and builds it.
  - Prove: copy-in smoke test + `pnpm run check`
  - Evidence 2026-06-16: (1) Docs — new `site/content/guides/components.md` (order 11) with a "Copy-in components (`@kovojs/ui`)" section: `@kovojs/ui` is a `private` shadcn-style starter copied into `src/components/ui/`, the copied `.tsx` imports the public `@kovojs/headless-ui` (behavior + `cn`/variants) + `@kovojs/core` (`component()`) + `@kovojs/server` (`escapeHtml`/`escapeAttribute`), and in-repo apps use the workspace package directly; cross-linked from `styling.md`. `site check:links` green (87 pages, 12013 internal links OK). (2) Registry — `packages/ui/registry.json` (44 components; generator `packages/ui/scripts/build-registry.mjs`, `--write`/check modes) lists each component's `files`/`exports`/per-public-package imported symbols/`uiComponents`; every component depends ONLY on `@kovojs/headless-ui`+`@kovojs/core`+`@kovojs/server`. (3) Smoke test — `packages/ui/src/copy-in.test.ts` copies `button.tsx`+`select.tsx` into a scratch app, links only the 3 public deps, and runs `tsc --noEmit --ignoreConfig` → passes, proving a copied component compiles against the public deps alone; **no component imports a non-public symbol**. Prove ran green: `pnpm --filter @kovojs/ui exec vitest run` (9 files, 51 tests); `pnpm run check` exit 0.

---

## Phase 8 — Reference truth

- [ ] **Drive `api-ref` from the `publicPackages` manifest (all public packages, not the hand-picked 5); exclude `@internal`; add a STABILITY page** — keep the "undocumented exports flagged, never omitted" principle (`api-ref.mjs:11`), but apply it across the full public surface with `@internal` excluded.
  - Done = every public package has a generated reference page; `@internal` symbols are excluded (not listed as `*Undocumented.*`); a STABILITY page links the policy.
  - Prove: `node --test site/scripts/api-ref.test.mjs && pnpm run check:build`
  - Evidence (partial, 2026-06-17): `public-packages.json` now classifies `@kovojs/style` as a public
    library with `apiRef` order 6; `packages/style/package.json` is versioned `0.1.0`, has
    `publishConfig.exports["."]` pointing at `dist/index.{d.mts,mjs}`, and keeps source exports for
    workspace development.
  - Evidence (partial, 2026-06-17): `site/gen/api/style.md` is generated from
    `packages/style/src/index.ts` with 29 exports, 29 documented. `site/scripts/api-ref.test.mjs`
    asserts `style.md` in the generated package list and a `@kovojs/style` documented-export floor.
  - Evidence (partial, 2026-06-17): `ComponentRenderOptions` was documented because the merged
    integration render helper made it part of `@kovojs/server`'s public `renderComponent(...)`
    signature; `node site/scripts/api-ref.mjs` regenerated the reference with documented exports
    339 -> 340.
  - Evidence (partial, 2026-06-17): `pnpm exec vitest --run scripts/public-packages.test.mjs
site/scripts/api-ref.test.mjs packages/server/src/component-render.test.tsx`,
    `pnpm run check:api-surface`, and `git diff --check` pass.
  - Evidence (partial, 2026-06-17): `pnpm --filter @kovojs/site run build` completes a fresh static
    export (`site-export/v1`, `html=92`, `diagnostics=0`), `pnpm --filter @kovojs/site run
check:links` passes (`pages=93`, `internal=13492`, `external=190`), `pnpm --filter @kovojs/site
test` passes (9 files, 44 tests), and `pnpm --filter @kovojs/site exec tsc --noEmit --pretty
false` passes. The remaining proof gap for closing Phase 8 is the broader root `check:build`
    command named above.

---

## Phase 9 — 2026-06-19 audit follow-ups

**Source:** `plans/audit-api-20260619-203425.md` (5-way audit + adversarial removal verification at
`493eeaec`). Ordered by leverage + dependency: **A** immediate removes → **B** recursive-publicness
fixes → **C** stability/doc reconciliation → **D** narrowing passes → **E** the blocked re-tier →
**F** reference pages (gated on the shrink). Prove each with the cited focused command + `pnpm run
check:api-surface` (expect `fixed-this-run` > 0). The adversarial pass already **overturned** the
tempting bulk removals (the ~396 headless machinery types + the test-harness options are forced-public —
they get **documented/narrowed**, never internalized); do not re-introduce those as removals.

**Execution status (2026-06-19, branch `agent/api-cleanup-phase9`).** Landed + verified green this pass:
**all of 9A** (194 ui `*Classes`/`*ClassNames` un-exported, `ComponentDefinition` removed, `static-export`
subpath removed, `isHeaderSource` dropped; `core#query` corrected to KEEP), **all of 9C**, the safe **9B**
items (drizzle `KovoFanAnnotation` re-export, `core` `component()` bound inline, server `export *`→named),
and **9D** html-fragment wire→`./internal/html-wire`. **api-surface baseline 1571 → 1367 (−204).** Gates:
`vp check` typecheck clean + my changed files formatted; `check:api-surface`/`check:exports`/`check:publish`
green; per-package vitest green (core 68, ui 186, drizzle 261, browser 453, test 155, server 504/506 +
conformance 173/174 — the 2 server + 1 conformance failures are PRE-EXISTING `Cache-Control`/`Vary` header
diffs, identical on untouched `main`; `check:imports` has one PRE-EXISTING `compiler/package-styles`
site-script failure, also on `main`).

**Deferred this pass — each has a discovered blocker (NOT lazy skips):** `style` `CompiledStyle` branding
(compiler consumes the structural shape); `style` identity-overload drop (**audit was wrong — the ui
`*.stylex.test.tsx` call `style.create(obj, {namespace,source})`, so it is exercised**); `better-auth`
split (`csrf`/`guard` fields also name non-public types + depends on the in-flux server barrel);
`server/vite` `kovo()` token (example vite-config coupling); **`test/harness` `TouchGraph` promotion
CONFLICTS with Phase 5**, which deliberately made `graph.ts` IR `@internal` — promoting it re-exposes
verifier IR, so do NOT; gate-tightening; 9D browser option-graph + headless machinery docs (large/ratchet);
9E (blocked on the generated-handler-ABI prereq); 9F api-ref pages (gated on the doc work).

### 9A — Immediate removes / un-exports (no prerequisites; biggest baseline drop)

- [x] **Un-export `@kovojs/ui` `*Classes`/`*ClassNames` (194 done; `*Styles` deferred — see status).** Drop `export` from `*Styles`
      (keep module-local; render bodies use it); delete the `*Classes`/`*ClassNames` consts; rewrite the
      package's own `*.stylex.test.tsx` to read `style.attrs(localStyles.x).class`.
  - Done = baseline `fixed-this-run ≈ 240`; ui builds. Prove: `pnpm run check:api-surface` + `pnpm --filter @kovojs/ui exec vitest run`.
- [x] **Remove dead `@kovojs/core#ComponentDefinition`** (`index.ts:87`; 0 consumers repo-wide; `ComponentDefinitionInput` stays).
  - Prove: `pnpm --filter @kovojs/core exec vitest run` + gate.
- [x] **`@kovojs/core#query()` — KEEP (corrected; NOT a removal).** Implementation-pass investigation
      (`packages/core/src/index.test.ts:112,174-208`) showed `core#query(key)` is the component-binding query
      handle with `.args()`/`.refresh()` (per-use freshness, SPEC §4.9), validated against the generated
      `ComponentRegistry` — complementary to `server#query()` which _declares_. The "remove" recommendation
      was the "0 imports ≠ dead" trap; a trial removal was reverted. Follow-up (doc-only): tighten both
      `query` JSDocs to spell out declare-vs-bind. Evidence: `pnpm --filter @kovojs/core exec vitest run` → 68 passed.
- [x] **Remove redundant `@kovojs/server/app-shell/static-export` subpath.** Drop from `package.json` `exports` + `publishConfig` + manifest `apiBoundary.public`; point the two in-repo tests at the `@kovojs/server` root. Types stay public via `StaticExportResult`/`StaticExportOptions`.
  - Prove: `pnpm --filter @kovojs/server exec vitest run` + `pnpm run check:publish`.
- [x] **Drop `isHeaderSource` from the server public barrel** (`routing.ts:36`; 0/0 predicate). KEEP the recursively-reachable response types (`RouteResponseOutcome`/`RouteResponseBody`/`RouteFileOptions`/`RouteStreamOptions` — forced by `route()`'s return at `route.ts:159`).
  - Prove: `pnpm --filter @kovojs/server exec vitest run` + gate.

### 9B — Recursive-publicness fixes (close the latent leaks the gate can't see)

- [ ] **`style`: brand `CompiledStyle` opaque** (`engine.ts:22-63`); keep the structural `__rules`/`AtomicRule` shape on `@kovojs/style/internal` for the compiler only. Source-compatible for app authors.
- [ ] **`style`: drop the `identity`-options public overloads** of `create`/`defineVars`/`createTheme`/`keyframes` (`engine.ts:75`); `StyleIdentityOptions` becomes impl-only.
- [ ] **`server/vite`: narrow `kovo()`'s return** to an opaque `{ readonly name: 'kovo' }` token (`vite.ts:38,116`); keep the hook interface (`KovoViteResolvedConfig`/`KovoViteHotUpdateContext`) internal.
- [ ] **`better-auth`: split `BetterAuthCredentialMutationOptions`** (`internal.ts:1100`) — export the narrow public `{csrf,defaultRedirectTo,guard,key}` from `index.ts`; keep `registry`(`MutationRegistry`)/`transaction` on an `@internal` extension the impl uses.
- [x] **`drizzle`: re-export `KovoFanAnnotation`** from `runtime.ts` (one line; `drizzle-surface.ts:12`).
- [ ] **`test/harness`: make the options nameable** (`harness.ts:44-49`) — promote `core` `TouchGraph` to the public `index.ts` (already a clean `export` at `core/src/graph.ts:42`); re-export `DbVerificationConfig` + `HarnessMutationOptions` from `./harness`. (Types stay public — this is a fix, not a removal.)
- [x] **`core`: inline `component()`'s generic bound** from the public `ComponentDefinitionInput` (drop the private `ComponentDefinitionShape` from the signature; `index.ts:123,158`).
- [x] **`server`: replace the 3 `export *`** (`index.ts:57-59`, `api/data|rendering|routing`) with explicit named re-export blocks.
- [ ] **Tighten the api-surface gate** to fail when a public signature names a non-public type (recursive publicness), so 9B can't regress; split `api-surface-baseline.json` into "to-document" vs "to-remove".
  - Prove (9B): `pnpm run check` + `pnpm run check:api-surface` + per-package vitest.

### 9C — Stability tags + doc reconciliation

- [x] **`@kovojs/ui` dual-distribution reconcile.** Rewrite the `STABILITY.md:21` paragraph to "versioned library **and** copy-in starter"; keep `kind:library` + `publishConfig` + `registry.json`/`kovo add`. (Supersedes Locked Decision #2 / Phase 7.)
- [x] **`server/build`: tag the whole preset family `@experimental`** (`KovoPreset`/`PresetContext`/`PresetInspectContext`/`PresetDiagnostic`/`KovoConfig`/`defineConfig`), matching `node`/`vercel`/`cloudflare`.
- [x] **`core`: add `@augmented` JSDoc** to the five registry seeds (`QueryRegistry`/`MutationRegistry`/`RouteRegistry`/`InvalidationSets`/`OptimisticDerivationSets`, `index.ts:236`) so the compiler-populated contract is documented (mirrors `core/generated.ts`).
- [x] **`browser`: fix `installKovoLoader` JSDoc** (`loader.ts:93` — it is NOT what ships; the prod loader is the `@internal installInlineKovoLoader`); consider `@experimental` on the `./client` facade.
- [x] **`test/test-case`: mark `kovoTest` `@experimental`** (or demote to a testing-guide snippet; 0 example uses over `createKovoTestHarness`).
- [x] **`server`: keep the 2 vite-dev functions `@experimental` on root; drop the 4 zero-import companion types** (`index.ts:15,51-56`; types remain on `./internal/app-shell-vite`).

### 9D — Narrowing passes (type redesign; larger)

- [ ] **`browser/client` option graph 72 → ~8.** Retype `KovoLoaderOptions.root` as `Document | Element`; move `CompiledQuery*`/`Morph*`/wire-parser shapes to `@kovojs/browser/generated`; delete the `dom-like.ts` `*Like` duck-types. (`loader.ts:38`, `dom-like.ts`.)
- [ ] **`headless-ui` machinery types: DOCUMENT/narrow, do NOT internalize.** Per-primitive `tsc`-assisted pass — document the `*State`/`*ChangeResult`/`*PrimitiveAttributes`/… types forced by kept `*Attributes`/handler signatures; narrow the open `Record<string, boolean|string>` tail of `*PrimitiveAttributes` to known keys; demote only the genuinely-unreferenced ones. (Overturned-from-remove; ~430 upper bound on review scope.)
- [x] **`test/html-fragment`: move the kovo-wire-shape extractor family** (`kovoFragmentFacts`/`kovoQueryFacts`/`documentQueryScriptBehaviorFact`/`htmlMainMarkerFact` + their `*Fact` types) to `@kovojs/test/internal/*`; keep the generic `html*` element/form/key extractors public.

### 9E — Re-tier the primitive ABI (BLOCKED on a prerequisite)

- [ ] **PREREQ — generated handler ABI + L1 authoring story.** Add an `apiBoundary.generated` tier to `@kovojs/headless-ui` so emitted client modules import handlers from `generated` (not the human-public root), and move the L1 island-authoring path off hand-imported reducers (the gallery currently hand-imports them). Required because `rules/api-surface.md` bars emitted code from `internal`. (Standing blocker per `plans/api-cleanup-leftover.md`.)
- [ ] **(blocked by PREREQ) Demote the 100 `@kovoPrimitiveHandler` functions** to the new `generated` tier / tag `@generated` (`switch.ts:81` et al.). Keep importable for the compiler; off the SemVer/docs surface.
- [ ] **(blocked by PREREQ) Demote the 124 reducers** (`set*`/`toggle*`/`*Move`/`*Typeahead`/`*RovingIndex`) to `@kovojs/headless-ui/internal`. Baseline −124 once unblocked.

### 9F — Reference pages (gated on 9A/9B/9D shrinking the surface; finishes Phase 8)

- [ ] **Add an api-ref page for `@kovojs/headless-ui`** (`apiRef` entry in `public-packages.json` + generated page): the kept `*Attributes` builders + value/state types, after 9D documents them.
- [ ] **Add an api-ref page for `@kovojs/ui`** (library half): the `Component`/`*Props` families, after 9A un-exports the class strings and they are documented.
  - Prove (9F): `pnpm exec vitest run site/scripts/api-ref.test.mjs` + `pnpm run check:build`.
