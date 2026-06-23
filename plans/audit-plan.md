# First-Principles SPEC Compliance Audit Plan

**Date:** 2026-06-23
**Goal:** identify important framework bugs and non-`SPEC.md`-compliant behavior across the codebase from first principles, then record confirmed findings in a compact, mechanically trackable ledger.

## Execution Status

- [x] First parallel audit wave completed from first principles across compiler/generated artifacts, server/request/wire, browser/runtime, data/verifier, UI/examples, and public API/package gates.
  - Evidence: five read-only sub-agent lanes completed in this session, plus main-thread public API/package gate audit.
- [x] Existing plans were used only after first-principles source/SPEC inspection for dedupe and context.
  - Evidence: lane reports cite direct `SPEC.md`, `rules/`, source, test, and generated-declaration evidence before prior-plan notes.
- [x] Confirm or refute the remaining suspected findings below with focused repros.
  - Evidence: SUS-001 was promoted to AUD-016 by a temporary Vitest repro; SUS-002 was promoted to AUD-017 by production-call-site inspection.

## Confirmed Findings - First Wave

- [ ] **AUD-001 - Critical - anonymous/pre-auth CSRF is missing.** `SPEC.md` requires anonymous CSRF bound to a framework-owned signed-cookie secret when `req.session` is null. Current CSRF token creation requires a session id and rendered mutation CSRF fields are omitted when `sessionId()` is empty.
  - Evidence: `SPEC.md:735`; `packages/server/src/csrf.ts:33`, `packages/server/src/csrf.ts:63`, `packages/server/src/csrf.ts:101`; `packages/server/src/csrf.test.ts:31`.
  - Verification: add an anonymous enhanced/no-JS mutation fixture; expected result is a CSRF token minted and validated without an app session.

- [ ] **AUD-002 - Critical - app-level mutation dispatch parses bodies before CSRF.** `SPEC.md` requires CSRF validation before replay reservation, input parsing/coercion, and guards. `handleAppMutationRequest()` reads/parses JSON/FormData before CSRF, and current tests encode that inverse order.
  - Evidence: `SPEC.md:735`, `SPEC.md:1062`; `packages/server/src/app-mutation-request.ts:48`; `packages/server/src/app-mutation-request.test.ts:244`; lower-level direct paths validate earlier at `packages/server/src/mutation.ts:725` and `packages/server/src/mutation.ts:1373`.
  - Verification: change or add app-boundary tests so malformed unauthenticated mutation bodies fail CSRF before schema/body diagnostics.

- [ ] **AUD-003 - High - raw SQL write declarations lack the SPEC-mandated `tables:` allowlist and fail-closed executor.** `SPEC.md` and `rules/data-layer-policy.md` require raw writes to declare both affected tables and touch domains. The app-facing `write()` surface exposes only `touches`; fixtures model unresolved raw writes without a table allowlist.
  - Evidence: `SPEC.md:1046`, `SPEC.md:1060`, `SPEC.md:1254`; `rules/data-layer-policy.md:26`; `packages/server/src/mutation.ts:259`, `packages/server/src/mutation.ts:267`; `tests/integration/fixtures/manual-touches-raw-write/app.tsx:24`, `tests/integration/fixtures/manual-touches-raw-write/app.tsx:74`; runtime verifier domain checks at `packages/test/src/verifier-diagnostics.ts:98`.
  - Verification: add raw SQL mutation tests for declared `tables:` success and undeclared-table fail-closed behavior.

- [ ] **AUD-004 - High - inline enhanced mutation apply lacks build-token and delta-miss recovery.** `SPEC.md` requires prod deltas and deploy-skew mismatches to validate the build token and never merge cross-build data. The modular path validates tokens, but the inline submit path reads the body and applies chunks without reading `Kovo-Build`.
  - Evidence: `SPEC.md:852`, `SPEC.md:1433`; `packages/browser/src/inline-loader-build.ts:549`, `packages/browser/src/inline-loader-build.ts:665`; modular path at `packages/browser/src/apply-mutation-response.ts:96` and `packages/browser/src/mutation-submit.ts:199`.
  - Verification: inline-loader browser test for stale `Kovo-Build`, delta miss, and full reload/refetch recovery.

- [ ] **AUD-005 - High - visible-return `/_q/` refetch can merge cross-build data unless callers pass a token.** `refetchQueries()` enforces build-token mismatch only when `expectedBuildToken` is provided; `installKovoLoader()` does not default it from `<meta name="kovo-build">`.
  - Evidence: `SPEC.md:906`, `SPEC.md:1431`; `packages/browser/src/query-refetch.ts:121`; `packages/browser/src/loader.ts:158`; `packages/browser/src/query-visible-return.ts:139`; explicit-token-only coverage at `packages/browser/src/query-refetch.test.ts:259`.
  - Verification: browser/runtime test proving visible-return refetch reads the document build token and rejects mismatched responses.

- [ ] **AUD-006 - High - `/_q/` non-200 responses omit the build token.** `SPEC.md` requires every typed read response to carry the render-plan token. Current server code stamps `Kovo-Build` on success only; guard/error responses omit it.
  - Evidence: `SPEC.md:460`, `SPEC.md:906`; success path `packages/server/src/query.ts:401`; non-200 paths `packages/server/src/query.ts:341`, `packages/server/src/query.ts:363`; success-only test at `packages/server/src/query-endpoint.test.ts:307`.
  - Verification: extend query endpoint tests to assert `Kovo-Build` on 422, 500, guard-denied, and redirect read responses.

- [ ] **AUD-007 - High - deploy-skew retention floor and KV417 are not enforced.** `SPEC.md` requires at least 24 hours of prior immutable `/c/__v/...` modules and prior-token `/_q` support, with KV417 if unsupported. Current memory registry is count-based and can evict immediately via `maxVersionsPerPath`; builds warn rather than gate.
  - Evidence: `SPEC.md:1435`; `packages/server/src/client-modules.ts:291`; `packages/server/src/build.ts:310`.
  - Verification: build/server test that simulates redeploy bursts and asserts 24-hour retention or KV417 failure.

- [ ] **AUD-008 - High - compiler diagnostic registry diverges from SPEC for KV415-KV417.** `SPEC.md` lists KV415, KV416, and KV417 as shared diagnostic codes and says the diagnostic registry owns severity. `DiagnosticCode` skips KV415-KV417; KV416 is thrown as a raw compiler `Error`.
  - Evidence: `SPEC.md:1314`, `SPEC.md:1320`; `packages/core/src/diagnostics.ts:58`; `packages/compiler/src/compile.ts:670`.
  - Dedupe: related architectural split is noted in `plans/bugs-and-testing.md`.
  - Verification: either add registry entries/non-compiler diagnostic tier or update `SPEC.md` so release-gate errors are not represented as shared diagnostics.

- [ ] **AUD-009 - High - compiler-emitted handler refs are versioned from client-source hash, not the render-plan token.** `SPEC.md` requires prod emitted module URLs to carry the render-plan version token. Compiler output computes `clientHref` from `clientModuleVersion(clientSource)`, and tests assert source-hash behavior.
  - Evidence: `SPEC.md:440`, `SPEC.md:459`; `packages/compiler/src/compile.ts:153`; `packages/compiler/src/lower/handlers.ts:164`; `packages/compiler/src/handler-lowering.test.ts:350`; server token includes render fingerprints at `packages/server/src/client-modules.ts:48`.
  - Verification: production build repro where query/render-plan shape changes without client-byte changes, then inspect served `on:*` refs and module URLs.

- [ ] **AUD-010 - High - primitive-owned ARIA can freeze when an authored prop is present.** `SPEC.md` says primitive-updated state `aria-*` is primitive-wins and reactive positions must stay live. The compiler skips primitive reactive stamps when an authored attribute with the same name exists; tests currently expect stale static `aria-checked` for `Switch`.
  - Evidence: `SPEC.md:283`, `SPEC.md:345`; `rules/accessibility-conformance.md`; `packages/compiler/src/lower/structural-jsx.ts:719`; `packages/compiler/src/primitive-reactive-attributes.test.ts:283`.
  - Verification: update compiler tests so contradictory static state ARIA gets KV317/KV232 behavior and reactive control props still emit live ARIA bindings.

- [ ] **AUD-011 - High - public API recursive-publicness is not enforced and current public signatures name internal/generated shapes.** `rules/api-surface.md` requires every public signature's referenced helper types to be public recursively. `scripts/api-surface-gate.mjs` only classifies exported top-level symbols and does not walk parameter/return/property types. Current public declarations expose compiler/provenance internals in `@kovojs/style` and internal graph/verifier types in `@kovojs/test`.
  - Evidence: rule at `rules/api-surface.md:40`; gate export-only loop at `scripts/api-surface-gate.mjs:121`; `@kovojs/style` public re-exports at `packages/style/src/index.ts:1`, internal/provenance fields at `packages/style/src/engine.ts:28`, `packages/style/src/engine.ts:37`, `packages/style/src/engine.ts:71`, public identity overload at `packages/style/src/engine.ts:150`; `@kovojs/test` imports `@kovojs/core/internal/graph` and exposes it on public options at `packages/test/src/harness.ts:1`, `packages/test/src/harness.ts:46`.
  - Generated declaration evidence: `/tmp/kovo-style-dts/engine.d.ts:20`, `/tmp/kovo-style-dts/engine.d.ts:24`, `/tmp/kovo-style-dts/engine.d.ts:54`; `/tmp/kovo-test-dts/harness.d.ts:1`, `/tmp/kovo-test-dts/harness.d.ts:26`.
  - Verification: add recursive type-reachability checks to `scripts/api-surface-gate.mjs`; then narrow/promote the referenced public types.

- [ ] **AUD-012 - Medium-high - optimistic snapshots are unbounded whole-value clones.** `SPEC.md` requires touched-subset structural-sharing snapshots. The query store and rebaser clone whole query values/baselines.
  - Evidence: `SPEC.md:1129`; `packages/browser/src/query-store.ts:67`; `packages/browser/src/optimism.ts:190`, `packages/browser/src/optimism.ts:393`.
  - Verification: add a large untouched subtree test proving optimistic/rebase operations do not clone or rewrite untouched data.

- [ ] **AUD-013 - Medium-high - named mutation queues lack the full SPEC timeout/depth/revalidation contract.** `SPEC.md` requires bounded timeout/abort, failed-head tail revalidation, and bounded queue depth. Current `MutationQueue` is only a per-name promise tail.
  - Evidence: `SPEC.md:1137`; `packages/browser/src/mutation-queue.ts:5`; ordering-only tests at `packages/browser/src/mutation-optimistic-queue.test.ts:81`.
  - Verification: queue tests for hung head timeout, abort, max depth, and failed-head tail revalidation.

- [ ] **AUD-014 - High - replay `maxPending` overflow falls through to unreserved execution.** The in-memory replay store refuses excess pending reservations, and `reserveMutationReplayBeforeRun()` eventually returns `{ kind: 'disabled' }`; enhanced mutation execution then proceeds with no reservation. The no-JS path similarly proceeds when `reserve()` returns undefined.
  - Evidence: `SPEC.md:1075`; `packages/server/src/replay.ts:130`, `packages/server/src/replay.ts:313`; enhanced caller at `packages/server/src/mutation.ts:791`, `packages/server/src/mutation.ts:793`, `packages/server/src/mutation.ts:798`; no-JS caller at `packages/server/src/mutation.ts:1454`, `packages/server/src/mutation.ts:1458`.
  - Verification: saturate `maxPending`, submit a distinct stable idempotency key, and assert the framework fails closed or sheds instead of running unreserved.

- [ ] **AUD-015 - High - inline streaming mutation failure applies partial truth without rollback.** The inline streaming path applies parsed query/fragment/text chunks before checking `<kovo-done>`, marks only stream-text targets as error on non-complete done, and applies any trailing pending body when no terminal done appears. The modular path tracks query revert state and throws on missing/non-complete done.
  - Evidence: `SPEC.md:810`; inline path at `packages/browser/src/inline-loader-build.ts:601`, `packages/browser/src/inline-loader-build.ts:609`, `packages/browser/src/inline-loader-build.ts:612`, `packages/browser/src/inline-loader-build.ts:627`; modular rollback/rejection at `packages/browser/src/apply-mutation-response.ts:222`, `packages/browser/src/apply-mutation-response.ts:230`.
  - Verification: inline-loader browser test with partial query/fragment chunks followed by missing or error `<kovo-done>`; expected behavior is rollback/refetch/failure parity with the modular runtime.

- [ ] **AUD-016 - High - raw query receiver declarations ignore explicit `reads:` and `output`.** `SPEC.md` frames opaque reads as requiring declared `reads:` plus an output schema. A temporary first-principles repro using the Drizzle test harness showed `db.execute(sql select ...)` with explicit `reads` and `output` still produces KV406, empty reads, and empty shape.
  - Evidence: `SPEC.md:1020`; existing raw receiver test at `packages/drizzle/src/index.query-shapes.test.ts:1194`; temporary command `pnpm exec vitest --run --root /tmp /tmp/kovo-raw-query-*.test.ts --reporter=dot` passed with output showing `diagnostics[0].code === "KV406"`, `reads: []`, `shape: {}` for explicit `reads` plus `output`.
  - Verification: add a committed Drizzle static test for explicit raw-read declarations, then either accept them as declared opaque reads or emit a dedicated teaching diagnostic aligned with `SPEC.md`.

- [ ] **AUD-017 - High - KV416 render-plan token/delta gate is test-only or partially wired.** `assertRenderPlanTokenMonotonicity()` exists and is tested, but source search found no production caller outside exports/tests. The component compile path emits semantic render-equivalence checks, but the inspected gates do not prove the `apply_delta(base, render_prod(delta)) == render_dev(full)` production-delta invariant.
  - Evidence: `SPEC.md:463`; semantic component check at `packages/compiler/src/compile.ts:246`; token monotonicity helper at `packages/compiler/src/compile.ts:659`; helper export at `packages/compiler/src/index.ts:47`; tests at `packages/compiler/src/compile-component.test.ts:1162`; boundary test at `packages/compiler/src/render-equivalence-boundary.test.ts:34`.
  - Verification: add a production build/delta fixture that would fail if a dropped-field delta can pass; wire KV416 or equivalent release-gate failure into the build path.

- [ ] **AUD-018 - High - inline loader aborts removed island `ctx.signal` by component-name substring instead of island identity.** `SPEC.md` requires island signals to survive keyed reorders and abort when the morph layer removes the island. The modular path compares `kovo-c` plus `kovo-key`/`id`, but the inline loader stores the controller on the element and preserves every existing island whose component name appears anywhere in replacement HTML. In a keyed list replaced from rows `row-1,row-2` to only `row-2`, row 1 can be disconnected without aborting its signal because `<li kovo-c="cart-row" kovo-key="row-2">` still contains `cart-row`.
  - Evidence: `SPEC.md:196`, `SPEC.md:343`, `SPEC.md:1421`; inline signal storage at `packages/browser/src/inline-loader-build.ts:380`; inline cleanup at `packages/browser/src/inline-loader-build.ts:556`, `packages/browser/src/inline-loader-build.ts:560`, `packages/browser/src/inline-loader-build.ts:561`; generated-source snapshot currently locks the substring algorithm at `packages/browser/src/inline-loader-artifact-minifier.test.ts:79`; modular identity cleanup uses component plus key/id at `packages/browser/src/handler-context.ts:143` and has keyed coverage at `packages/browser/src/delegated-island-signal-abort.test.ts:159`.
  - Verification: add an inline-loader browser/runtime test that creates two same-component keyed islands, registers both signals, applies a replacement fragment retaining only the second key, and asserts the first signal aborts while the second remains alive.

## Suspected Findings Needing Repro

- [x] No suspected findings remain from the first wave.
  - Evidence: initial suspected items were promoted to AUD-014, AUD-015, AUD-016, and AUD-017.

## Coverage Gaps - First Wave

- [ ] Add anonymous/pre-auth CSRF tests.
- [ ] Add app-boundary tests for CSRF-before-body-parse ordering.
- [ ] Add query endpoint tests asserting `Kovo-Build` on all non-200 typed-read responses.
- [ ] Add KV417/deploy-skew retention-floor tests.
- [ ] Add inline loader build-skew, delta, and delta-miss tests.
- [ ] Add visible-return refetch tests for default document build-token wiring.
- [ ] Add manifest-enforced accessibility state matrix coverage for every claimed primitive/state in `rules/accessibility-conformance.md`.
- [ ] Replace Commerce and CRM hand-built enhanced-mutation live-target headers with DOM-derived or browser-observed headers.
  - Evidence: `examples/commerce/src/app-test-helpers.ts:173`, `examples/commerce/src/app-test-helpers.ts:283`, `examples/crm/src/interactive-app.test.ts:36`.
- [ ] Strengthen engine-side-effect runtime coverage beyond row-count deltas so update-only trigger effects are independently observable.
  - Evidence: row-count observation at `packages/test/src/sql-observer.ts:73`, `packages/test/src/sql-observer.ts:91`; static KV413 extraction at `packages/drizzle/src/static.ts:6305`.
- [ ] Upgrade site example health checks from liveness-only to behavior-level checks where they are used as release confidence.
  - Evidence: `site/scripts/example-health.mjs:24`.
- [ ] Add inline-loader keyed island `ctx.signal` cleanup parity coverage.
  - Evidence: AUD-018.

## Refuted or Supported High-Risk Areas

- [x] Scanner/parser boundary and post-parse raw-source-string guard have current coverage.
  - Evidence: `packages/compiler/src/scan/parse.ts:89`, `packages/compiler/src/scan/parse.ts:111`, `packages/conformance-fixtures/src/source-fixtures.ts:558`, `packages/compiler/src/source-reparse-boundary.test.ts:22`.
- [x] TSX-only authoring and generated/internal import separation are enforced for app-authored source.
  - Evidence: `packages/compiler/src/validate/authoring-surface.ts:15`, `packages/compiler/src/compile-component.test.ts:1128`.
- [x] Source-derived handler names and compiler capture-channel constraints are implemented.
  - Evidence: `packages/compiler/src/lower/handlers.ts:52`, `packages/compiler/src/lower/handlers.ts:294`.
- [x] HMR and incremental compiler cache checks use facts/hashes rather than raw source-string heuristics for the inspected cases.
  - Evidence: `packages/compiler/src/hmr-impact.ts:31`, `packages/compiler/src/hmr-impact.test.ts:65`, `packages/compiler/src/compile-cache.ts:90`, `packages/compiler/src/compile-cache.test.ts:24`.
- [x] Core data-plane diagnostic severities for KV405, KV406, KV408, KV410, and KV411 are currently `error`.
  - Evidence: `packages/core/src/diagnostics.ts:638`.
- [x] Runtime verifier coverage exists for KV408 row-key mismatch, KV410 output-schema failures, and KV411 exempt-table reads.
  - Evidence: `packages/test/src/verifier-diagnostics.ts:157`, `packages/test/src/query-verifier.test.ts:257`, `packages/test/src/verifier-diagnostics.ts:273`.
- [x] Query result serialization covers `bigint` and `Date` through the shared wire codec in inspected paths.
  - Evidence: `packages/server/src/wire-html.ts:30`, `packages/server/src/wire-html.ts:105`, `packages/server/src/wire-html.test.ts:118`.
- [x] Modular keyed morphing, removed-island aborts, and BroadcastChannel principal isolation have source/test evidence.
  - Evidence: `packages/browser/src/morph.ts:121`, `packages/browser/src/morph.ts:389`, `packages/browser/src/broadcast.ts:141`.
- [x] No shadow DOM or custom-element dependency was found in scoped UI/headless/examples/browser implementation paths.
- [x] Top-layer/modal behavior and styled control form participation have real-browser gallery coverage.
  - Evidence: `examples/gallery/src/interactive-gallery.interactions-a.browser.test.ts:92`, `examples/gallery/src/interactive-gallery.interactions-b.browser.test.ts:158`, `examples/gallery/src/interactive-gallery.native.browser.test.ts:10`, `examples/gallery/src/interactive-gallery.native.browser.test.ts:41`.

## Completed Audit Procedure

- [x] Ground rules followed: `SPEC.md` and `rules/` were treated as normative, prior plans were used only after first-principles inspection, confirmed findings require direct evidence, and this pass stayed in audit mode rather than implementing repairs.
  - Evidence: Execution Status plus direct source/SPEC/rule citations on AUD-001 through AUD-018.
- [x] Finding ledger normalized: confirmed findings use severity-ranked AUD ids, current source/rule evidence, and a focused verification or repro sketch; refuted areas are closed separately.
  - Evidence: Confirmed Findings, Coverage Gaps, Refuted or Supported High-Risk Areas, and Latest Verification sections.
- [x] First-principles invariant map completed.
  - Evidence: SPEC Invariant Coverage Map below.
- [x] Independent audit lanes completed across compiler/generated artifacts, server/request/wire, browser/runtime, data/verifier, UI/examples, public API/package gates, and examples/conformance apps.
  - Evidence: Execution Status plus sub-agent and main-thread verification entries in Latest Verification.
- [x] Adversarial cross-cuts were applied for stale truth, authority/isolation, wire parser safety, generated-vs-authored boundaries, a11y/platform contracts, and resource bounds.
  - Evidence: AUD-001 through AUD-018 cover security, stale truth, deploy skew, public API, raw data seams, inline/modular parity, a11y state, replay, queue/snapshot bounds, and island-signal cleanup.
- [x] Prior-plan dedupe pass completed after first-principles audit.
  - Evidence: AUD-008 records a duplicate context link; refuted entries cite current source/tests instead of preserving stale plan history.
- [x] Verification strategy applied with narrow commands and artifacts where useful.
  - Evidence: Latest Verification lists focused Vitest, API-surface, declaration-generation, temporary repro, and sub-agent reported checks.
- [x] Deliverables completed in this compact ledger.
  - Evidence: this file now holds the ranked confirmed backlog, coverage gaps, refuted areas, invariant map, and latest verification; no separate dated findings ledger is needed yet.

## SPEC Invariant Coverage Map

- [x] Component model, execution triggers, DOM identity, morphing, and island lifecycle were mapped to `compiler`, `browser`, `server`, examples, and conformance fixtures.
  - Evidence: AUD-010, AUD-015, AUD-018; refuted scanner/parser, handler-name, morph, and top-layer entries.
- [x] Compiler lowering, generated artifacts, render-plan tokens, diagnostics, HMR, and cache invariants were mapped to `compiler`, `core`, `server`, and generated output.
  - Evidence: AUD-008, AUD-009, AUD-017; refuted TSX-only authoring, source-derived handler names, HMR/cache facts, and scanner boundary entries.
- [x] Navigation, mutation/query wire protocol, deploy skew, replay, CSRF, typed reads, streaming, and inline/modular loader parity were mapped to `server` and `browser`.
  - Evidence: AUD-001, AUD-002, AUD-004, AUD-005, AUD-006, AUD-007, AUD-014, AUD-015.
- [x] Data-plane, static analysis, Drizzle extraction, raw SQL declarations, runtime verifier, serialization, and optimistic algebra were mapped to `drizzle`, `server`, `test`, `browser`, and integration fixtures.
  - Evidence: AUD-003, AUD-012, AUD-013, AUD-016; refuted KV405/KV406/KV408/KV410/KV411 severity and wire serialization entries.
- [x] Public API, package boundaries, manifest surfaces, generated/internal imports, and release gates were mapped to scripts and public packages.
  - Evidence: AUD-011 plus `check:api-surface` and generated declaration inspection.
- [x] UI/headless/a11y primitives and example consumer behavior were mapped to `ui`, `compiler`, `browser`, gallery, Commerce, CRM, and site checks.
  - Evidence: AUD-010 plus Coverage Gaps for primitive accessibility matrix, hand-built live-target headers, and site example health checks.

## Initial Known Risk Areas to Re-Check From First Principles

- [x] Wire response scanner handling of nested or malformed `<kovo-fragment>`, `<kovo-query>`, and `<kovo-text>`-looking content received first-wave coverage for inline streaming failure.
  - Evidence: AUD-015; deeper malformed nested-tag parser fuzzing remains a possible follow-up.
- [x] Query store ordering when refetches, mutation responses, optimistic predictions, and visibility/focus refresh race received first-wave coverage.
  - Evidence: AUD-005, AUD-012, AUD-013, AUD-015.
- [x] Incremental compiler invalidation when a module previously observed absent registry facts that later appear was refuted for the inspected cache/HMR paths.
  - Evidence: `packages/compiler/src/compile-cache.ts:90`, `packages/compiler/src/compile-cache.test.ts:24`, `packages/compiler/src/hmr-impact.ts:31`.
- [x] Per-island `AbortController` cleanup for appended, reordered, or long-lived islands produced a confirmed inline-loader identity finding.
  - Evidence: AUD-018.
- [x] Exact numeric and `NaN` behavior in compiler-derived optimistic transforms received first-wave coverage for codegen parity.
  - Evidence: `packages/drizzle/src/derive-codegen.ts:108`, `packages/drizzle/src/derive-codegen.test.ts:173`.
- [x] Query-driven reactive attributes for headless/UI primitives and their compiled wiring produced a confirmed finding.
  - Evidence: AUD-010.
- [x] DOM-derived live-target header collection in real examples produced confirmed coverage gaps.
  - Evidence: Coverage Gaps section.
- [x] Public/generated/internal API boundaries where emitted code and human-authored app code need different import contracts produced a confirmed gate finding.
  - Evidence: AUD-011.

## Latest Verification

- [x] Server/public API focused checks passed where run locally.
  - Evidence: `pnpm exec vitest --run scripts/api-surface-gate.test.mjs scripts/public-packages.test.mjs scripts/exported-symbols.test.mjs` passed twice locally: 3 files, 24 tests.
  - Evidence: `pnpm run check:api-surface` passed with `public-exports-needing-attention=1338`.
- [x] Main-thread declaration inspection captured public type-shape evidence for AUD-011.
  - Evidence: `pnpm exec tsc --ignoreConfig --declaration --emitDeclarationOnly --outDir /tmp/kovo-style-dts ... packages/style/src/index.ts` succeeded; `pnpm exec tsc --ignoreConfig --declaration --emitDeclarationOnly --outDir /tmp/kovo-test-dts ... packages/test/src/harness.ts` emitted declarations while also reporting TS2209 project-root ambiguity.
- [x] Temporary raw-query repro confirmed AUD-016 without leaving repo files behind.
  - Evidence: `pnpm exec vitest --run --root /tmp /tmp/kovo-raw-query-*.test.ts --reporter=dot` passed and printed a KV406 fact with `reads: []` and `shape: {}` for explicit `reads` plus `output`.
- [x] Sub-agent verification commands completed for compiler and data/verifier lanes.
  - Evidence: compiler lane reported 5 Vitest files, 19 tests passed, plus `tests/kovo-check.node.mjs` run with 52 tests passed.
  - Evidence: data/verifier lane reported 7 files, 117 tests passed and 4 files, 56 tests passed.
- [x] Browser lane verification commands completed.
  - Evidence: browser lane reported `pnpm --filter @kovojs/browser test -- query-refetch.test.ts apply-mutation-response-delta.test.ts inline-loader-build.test.ts mutation-optimistic-queue.test.ts` and `pnpm --filter @kovojs/server test -- query-endpoint.test.ts mutation-delta.test.ts`, both successful.
