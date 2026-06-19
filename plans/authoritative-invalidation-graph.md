# Authoritative Invalidation Graph

`SPEC.md` §10.1–10.3 and §11.1 are the normative source: a query's read set and a
mutation's touch set are **derived from the Drizzle AST** ("the JOIN _is_ the
declaration", "forgetting a joined entity's dependency is unrepresentable",
"calling `cart.addItem` _is_ the invalidation declaration"). This ledger closes the
gap between that promise and what ships: today the derivation exists but is **not
authoritative**, and the cross-check that protects the promise is **coverage-dependent
test instrumentation**, not a static/CI gate. Relates to `plans/data-layer-roadmap.md`
(v1.5 verification layer, still open) and Constitution #2 (no global knowledge at
local sites) / #5 (server truth, never-stale UI).

## Disambiguation findings (2026-06-18)

Traced against implementation, not SPEC claims.

| Question                                                | Answer                                               | Evidence                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is AST extraction implemented?                          | **Yes**, for writes and reads                        | `packages/drizzle/src/static.ts` `extractTouchGraphFromProject`; CLI `kovo compile drizzle-static` (`packages/cli/src/index.ts`); generated `examples/*/src/generated/touch-graph.ts` carry `site:` provenance (e.g. `crm/.../mutations.ts:143`).                                                                                                                     |
| Query `reads`: derived or hand-declared?                | **Hand-declared fallback; optional at author sites** | `packages/server/src/query.ts` defaults omitted `reads` to `[]` and structural app guards accept missing `reads`; compiler derivation is not wired yet. Examples still hand-write `reads: [contact]` (`examples/crm/src/queries.ts`).                                                                                                                                 |
| Mutation `touches`: derived or hand-declared?           | **Hand-declared at runtime**                         | `packages/server/src/change-record.ts:60-72`: runtime uses `registry.touches`, else `registry.inferredTouches`. Compiler does **not** populate `inferredTouches` (no reference in `packages/compiler/src`); examples hand-author it inline (`examples/commerce/src/domain.ts:211`) or use explicit `touches` (`examples/crm/src/mutations.ts:159`).                   |
| Is the generated touch-graph wired into the runtime?    | **No**                                               | The generated `touch-graph.ts` feeds `kovo explain`/devtools/conformance only; example `graph.ts` imports the `TouchGraph` _type_, not the runtime invalidation path.                                                                                                                                                                                                 |
| Is there a mismatch cross-check?                        | **Yes, but test-instrumentation only**               | `packages/test/src/verifier.ts` `assertObservedReadsCovered` (KV407 "Query read from undeclared domain") / `assertObservedWritesCovered` (KV404/KV406/KV408). Proven by `tests/integration/specs/query-readset-runtime-crosscheck.spec.ts` — `/_q/readset-bad` → HTTP 500 + KV407. The verifier lives in `@kovojs/test`; `@kovojs/server` (prod) does **not** run it. |
| Static / compile-time enforcement of read-set coverage? | **No**                                               | No KV407/readset check in `packages/compiler/src`. KV411 (`Query read set includes an exempt table`) checks declared `reads` against _exempt_ tables only (`packages/drizzle/src/static.ts:86`), not against the `load` AST.                                                                                                                                          |
| Roadmap status                                          | v1.5 cross-check **open**                            | `plans/data-layer-roadmap.md`: v1 floor + blessed adapter `[x]`; "v1.5 verification layer. Runtime instrumentation as CI cross-check for KV402-KV409" `[ ]`.                                                                                                                                                                                                          |

**Bottom line:** Not a fully silent prod staleness hole — derivation + a runtime
verifier both exist, and test coverage catches most drift. But the guarantee is weaker
than SPEC promises in three concrete ways:

1. **Not authoritative.** Runtime invalidation reads hand-declared `reads`/`touches`;
   the derived graph is a parallel artifact. Two sources that can drift.
2. **Coverage-dependent, not static.** A too-narrow `reads`/`touches` is only caught
   when that exact code path executes under the `@kovojs/test` harness. Untested
   paths (or prod) ship the staleness; SPEC's "unrepresentable to forget" is
   currently "caught if a test happens to run it."
3. **Constitution #2 burden.** Authors hand-maintain the sets — the global-knowledge
   chore the spec says should not exist. Examples are inconsistent (`touches` vs
   `inferredTouches`), evidence of the friction.

## Goal

Make the AST-derived graph the **authoritative** invalidation source and promote the
existing coverage-dependent cross-check into a **static/CI gate**, so a forgotten
dependency is a compile error — not a latent prod bug or a hand-maintained list.

## Completed slices

- [x] **Runtime prefers derived touch sites when present.** `inferredTouches` now
      drive post-commit change records ahead of hand-declared `touches`; manual
      `touches` remains the fallback for opaque/KV406 sites that have no derived
      entry.
  - Evidence: `pnpm exec vitest --run packages/server/src/change-record.test.ts
packages/server/src/mutation.test.ts` passed 25 tests; the regression test
    `keeps inferred touch sites authoritative over declared fallback touches`
    proves derived touch sites rerun the derived domain instead of the narrower
    declared fallback.
- [x] **Drizzle static facade emits mutation touch registries.** The static graph
      layer now derives a mutation-keyed `inferredTouches` registry from the
      extracted touch graph and serializes it as TypeScript next to invalidation
      sets; `kovo compile drizzle-static` includes both JSON facts and source.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/index.serialization.test.ts
packages/cli/src/index.kovo-compile.test.ts` passed 21 tests, including the
    derived `mutationTouchRegistry` CLI output and generated
    `mutationInferredTouches` source.
- [x] **Server query authoring accepts omitted reads.** `query()` now defaults
      missing `reads` to `[]`, app-shell guards accept declarations without `reads`,
      and verifier reads coverage treats the omitted declaration as an empty
      derived-read placeholder.
  - Evidence: `pnpm exec vitest --run packages/server/src/query-endpoint.test.ts packages/server/src/api/app.test.ts packages/server/src/app.test.ts packages/server/src/mutation.test.ts`
    passed 49 tests; `pnpm exec vp check --fix` passed formatting, lint, and
    typecheck after the optional-read authoring change.
- [x] **Generated mutation touch registries are runtime-consumed.** Compiler-owned
      graph modules now emit `mutationInferredTouches` and call
      `registerGeneratedMutationTouchRegistry`; `createApp()` and direct mutation
      endpoint rendering merge registered `inferredTouches` by mutation key so
      `change-record.ts` sees compiler-derived touch sites ahead of manual
      fallbacks.
  - Evidence: `pnpm exec vitest --run packages/server/src/app.test.ts packages/server/src/mutation-endpoint.test.ts packages/server/src/mutation.test.ts packages/server/src/change-record.test.ts`
    passed 54 tests; `pnpm exec vitest --run packages/compiler/src/compiler-conformance.test.ts packages/cli/src/index.kovo-compile.test.ts packages/drizzle/src/index.serialization.test.ts`
    passed 27 tests, including generated Commerce `mutationInferredTouches` and
    registration source.
- [x] **Generated query read registries are runtime-consumed.** Compiler-owned
      graph modules now register extracted `queryDomains`; `createApp()` and direct
      mutation endpoint rendering merge registered reads into query definitions, so
      omitted `reads` can be populated from Drizzle query facts.
  - Evidence: `pnpm exec vitest --run packages/server/src/app.test.ts packages/server/src/mutation-endpoint.test.ts packages/server/src/mutation.test.ts packages/server/src/change-record.test.ts`
    passed 57 tests; `pnpm exec vitest --run packages/compiler/src/compiler-conformance.test.ts packages/cli/src/index.kovo-compile.test.ts packages/drizzle/src/index.serialization.test.ts`
    passed 27 tests, including generated Commerce
    `registerGeneratedQueryReadRegistry(commerceQueryDomains)` source.
- [x] **Static superset gate compares declared and derived domains.** `kovo check`
      now accepts optional `derivedQueries` / `derivedMutations` graph facts and
      fails when declared query reads or mutation domains are narrower than the
      derived domains, using KV407 for read-set misses and KV402 for touch-set
      misses.
  - Evidence: `pnpm exec vitest --run packages/cli/src/index.kovo-check.test.ts packages/core/src/graph.test.ts`
    passed 53 tests, including fixtures where declared `contactList` reads omit a
    derived `deal` read and declared `createDeal` domains omit a derived `contact`
    touch.
- [x] **Verifier coverage gaps are a `kovo check` gate.** `kovo check` now accepts
      `verificationCoverage` graph facts and fails unobserved query/mutation
      verifier targets, so read/write cross-check coverage can be reported even
      when a target produced no concrete KV402-KV410 diagnostic.
  - Evidence: `pnpm exec vitest --run packages/cli/src/index.kovo-check.test.ts packages/core/src/graph.test.ts`
    passed 54 tests, including an uncovered `productGrid` query producing
    `ERROR VERIFY ... has no verifier coverage`.

## Open work

- [x] **Migrate mutation definitions to generated touches.** Remove hand-authored
      `registry: { touches }` / `inferredTouches` from statically-analyzable
      commerce/crm/stackoverflow writes once their generated graph modules are
      loaded in the same app/runtime path (KV406 sites keep manual `touches` as the
      declared escape hatch). Evidence target: commerce/crm/stackoverflow mutation
      source no longer hand-lists touches for analyzable writes, generated graph
      artifacts still carry touch sites from `site:`-provenanced touch graph facts,
      and app mutation integration tests pass through `change-record.ts`.
  - Evidence: `rg -n "reads:|touches:|inferredTouches" examples/commerce/src examples/crm/src examples/stackoverflow/src --glob '!**/generated/**'`
    prints no matches; `corepack pnpm --filter @kovojs/example-commerce test`,
    `corepack pnpm --filter @kovojs/example-crm test`, and
    `corepack pnpm --filter @kovojs/example-stackoverflow test` pass after the
    Vitest setup emits/imports generated graph registries.
- [x] **Migrate query definitions to generated reads.** Remove hand-authored
      `reads` from statically-analyzable commerce/crm/stackoverflow queries once
      their generated graph modules are loaded in the same app/runtime path.
      Hand-declared `reads` becomes a checked override, not the default. Evidence
      target: a query with a multi-domain JOIN and no authored `reads` invalidates
      from every joined domain's mutation in an integration test.
  - Evidence: `corepack pnpm --filter @kovojs/example-commerce run emit-graph -- --check`,
    `corepack pnpm --filter @kovojs/example-crm run emit-graph -- --check`, and
    `corepack pnpm --filter @kovojs/example-stackoverflow run emit-graph -- --check`
    pass; `corepack pnpm exec playwright test --config tests/integration/playwright.config.ts tests/integration/specs/query-readset-runtime-crosscheck.spec.ts`
    passes 2/2 readset verifier cases.
- [x] **Migrate examples + docs to the derived-default model.** Remove hand-authored
      `reads`/`touches`/`inferredTouches` from commerce/crm/stackoverflow where the
      writes/reads are statically analyzable; align `site/content/guides/queries.md`
      so the taught model is "declare the JOIN, the dependency is derived." Evidence
      target: examples compile + pass invalidation integration tests with no
      hand-listed domains except at KV406 sites.
  - Evidence: the generated-domain scan above prints no example source matches,
    `site/content/guides/queries.md` now teaches Drizzle-derived query reads and
    on-demand graph inspection, and `corepack pnpm exec vp check --fix` passes.
- [ ] **Update SPEC cross-references + roadmap.** Reconcile §10.2/§10.3 wording with
      the override-and-gate model (derived authoritative; manual = checked escape
      hatch); flip `plans/data-layer-roadmap.md` v1.5 once the CI gate lands.

## Risks / open questions

- **KV406 interprocedural opacity.** Writes flowing `db` into node_modules can't be
  AST-derived; manual `touches` must remain a first-class, audited escape hatch, and
  the superset gate must exempt declared KV406 sites rather than fight them.
- **Override ergonomics.** Need a clear authored spelling for "I'm intentionally
  declaring touches because this is opaque" vs "I forgot one" — the gate must
  distinguish the two so the escape hatch stays usable (Constitution #2).
- **Query `load` analyzability parity.** Confirm `static.ts` read extraction covers
  the same Drizzle surface (subqueries, `sql` projections, CTEs) the write side
  handles, or that gaps degrade to a required-`reads` + KV410-style notice rather
  than a silent miss.

## Latest verification

- [x] `pnpm exec vitest --run packages/server/src/change-record.test.ts packages/server/src/mutation.test.ts`
  - Evidence: passed 25 server invalidation tests for the runtime precedence slice.
- [x] `pnpm exec vp check --fix`
  - Evidence: formatting, lint, and typecheck passed after the runtime precedence
    change.
- [x] `pnpm exec vp run kovo-check`
  - Evidence: passed 50/50 with `kovo-check/v1 OK` after the runtime precedence
    and Drizzle static registry source changes.
- [x] `pnpm exec vitest --run packages/drizzle/src/index.serialization.test.ts packages/cli/src/index.kovo-compile.test.ts`
  - Evidence: passed 21 Drizzle static serialization / CLI facade tests.
- [x] `pnpm exec vitest --run packages/server/src/query-endpoint.test.ts packages/server/src/api/app.test.ts packages/server/src/app.test.ts packages/server/src/mutation.test.ts`
  - Evidence: passed 49 server query/app/invalidation tests after query `reads`
    became optional at authoring sites.
- [x] `pnpm exec vitest --run packages/server/src/app.test.ts packages/server/src/mutation-endpoint.test.ts packages/server/src/mutation.test.ts packages/server/src/change-record.test.ts`
  - Evidence: passed 54 server tests after generated mutation touch registration
    was merged into `createApp()` and direct endpoint rendering.
- [x] `pnpm exec vitest --run packages/compiler/src/compiler-conformance.test.ts packages/cli/src/index.kovo-compile.test.ts packages/drizzle/src/index.serialization.test.ts`
  - Evidence: passed 27 compiler/CLI/Drizzle tests after generated graph modules
    started emitting `mutationInferredTouches` registration source.
- [x] `pnpm exec vitest --run packages/server/src/app.test.ts packages/server/src/mutation-endpoint.test.ts packages/server/src/mutation.test.ts packages/server/src/change-record.test.ts`
  - Evidence: passed 57 server tests after generated query-read registration was
    merged into app and direct endpoint query definitions.
- [x] `pnpm exec vitest --run packages/compiler/src/compiler-conformance.test.ts packages/cli/src/index.kovo-compile.test.ts packages/drizzle/src/index.serialization.test.ts`
  - Evidence: passed 27 compiler/CLI/Drizzle tests after generated graph modules
    started emitting `registerGeneratedQueryReadRegistry(...)` source.
- [x] `pnpm exec vitest --run packages/cli/src/index.kovo-check.test.ts packages/core/src/graph.test.ts`
  - Evidence: passed 53 CLI/core graph tests after adding
    `derivedQueries`/`derivedMutations` static superset failures.
- [x] `pnpm exec vitest --run packages/cli/src/index.kovo-check.test.ts packages/core/src/graph.test.ts`
  - Evidence: passed 54 CLI/core graph tests after adding
    `verificationCoverage` failure reporting for unobserved verifier targets.
- [x] Full Drizzle extraction test sweep for extraction changes; `@kovojs/drizzle`
      currently has no package `test` script, so use explicit Vitest file globs.
  - Evidence: `corepack pnpm exec vitest --run packages/drizzle/src/*.test.ts`
    passes 16 files / 252 tests; `corepack pnpm --filter @kovojs/drizzle exec vitest run src/index`
    passes 13 files / 234 tests from a package cwd.
- [x] Targeted `tests/integration/specs/query-readset-runtime-crosscheck.spec.ts`
      plus a static-gate fixture for read/write coverage promotion.
  - Evidence: `corepack pnpm exec playwright test --config tests/integration/playwright.config.ts tests/integration/specs/query-readset-runtime-crosscheck.spec.ts`
    passes 2/2 readset runtime cross-check cases; `corepack pnpm exec vp run
kovo-check` passes 50/50 with `kovo-check/v1 OK`.
- [x] `kovo check` on migrated examples.
  - Evidence: `corepack pnpm --filter @kovojs/example-commerce run emit-graph -- --check`,
    `corepack pnpm --filter @kovojs/example-crm run emit-graph -- --check`,
    `corepack pnpm --filter @kovojs/example-stackoverflow run emit-graph -- --check`,
    and `corepack pnpm exec vp run kovo-check` pass.
- [ ] `pnpm run acceptance` before flipping the roadmap checkbox.
