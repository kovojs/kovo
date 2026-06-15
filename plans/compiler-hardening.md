# Compiler & Framework Hardening — Execution Plan

**Status:** open (16 / 32 findings closed)
**Findings source:** [`plans/compiler-improvements.md`](./compiler-improvements.md) — the audit holds the per-hack what/why/fix and the exact `file:line` evidence. This file is the compact execution ledger: one checkbox per coherent fix slice, sequenced by leverage.
**Behavior source of truth:** `SPEC.md` (cited per item). When a fix and the SPEC conflict, follow SPEC and record the conflict; do not code through it.

Each checkbox is a closure-oriented slice (a module / runtime path / diagnostic family) including production change + tests + evidence. **Mark `- [x]` only when this session verifies the cited proving command for the exact item** (CLAUDE.md Progress Discipline). Nest the proving evidence under the item when you close it.

---

## Phase 1 — Compile-time safety holes (CRITICAL) — ship-unsafe output today

Self-contained, no cross-deps; do first.

- [x] **FW201: invert the unserializable-capture denylist to channel-membership** — `packages/compiler/src/lower/handlers.ts:225` (SPEC §4.3). Replace `capturesUnserializableReferences` (8-name denylist) with: for each free identifier in the closure, emit FW201 **unless** it is (1) `ctx`/`state`-rooted, (2) captured as a serializable `data-p-*` element param, or (3) a proven serializable module-scope binding. The parser already gives a clean free-identifier set (`references`, locals excluded at `parse.ts:1690`). Update the FW201 help text (`@jiso/core` diagnostics) to stop advertising the denylist.
  - Done = FW201 fires for `fetch` / `localStorage` / a captured outer-closure local; passes for the legitimate channels. New negative fixtures added.
  - Prove: `pnpm test handler-lowering`
  - Evidence 2026-06-15: `packages/compiler/src/scan/parse.ts` records typed static module-scope bindings, `packages/compiler/src/lower/handlers.ts` validates handler references against the explicit §4.3 channels, and `packages/compiler/src/emit/client.ts` emits referenced static constants into generated client modules.
  - Evidence 2026-06-15: `packages/compiler/src/handler-lowering.test.ts` covers `fetch`, `localStorage`, captured outer locals, and allowed state/event/element-param/import/static-constant channels; `packages/core/src/diagnostics.ts` no longer advertises the old name denylist.
  - Evidence 2026-06-15: `pnpm --filter @jiso/compiler exec vitest run src/handler-lowering.test.ts src/compile-component.test.ts src/scan/parse.test.ts src/fragment-targets.test.ts`, `pnpm --filter @jiso/compiler exec tsc --noEmit`, and `pnpm --filter @jiso/core exec vitest run src/diagnostics.test.ts` passed.

- [x] **Platform substitution: prove handler ≡ platform feature before dropping the handler** — `packages/compiler/src/lower/platform.ts:64` (SPEC §5.2 rule 4). Before returning any dialog/popover substitution, prove from typed model facts that (a) the host tag is a valid invoker host (`button`) and (b) the resolved target id refers to the required element kind (`<dialog>` for show-modal/close/request-close; a `popover`-bearing element for popover actions), resolved via the same component id registry FW221 uses — not the raw `getElementById` string. On failure return `null` (preserve the JS handler); optionally emit a teaching note (rule 5).
  - Done = non-`button` hosts, non-`<dialog>` show-modal targets, and popover actions aimed at non-popover elements keep their handler and emit no inert platform attribute.
  - Prove: `pnpm test platform-lowering`
  - Evidence 2026-06-15: `packages/compiler/src/lower/platform.ts` now requires a `button` host plus a same-model literal `<dialog id=...>` target for dialog commands or a literal `id` element with `popover` for popover actions before emitting platform attributes; failed proofs return `null` so the JS handler remains.
  - Evidence 2026-06-15: `packages/compiler/src/platform-lowering.test.ts` covers proven dialog/popover lowering plus non-button, non-dialog, and non-popover-target preservation cases.
  - Evidence 2026-06-15: `pnpm --filter @jiso/compiler exec vitest run src/platform-lowering.test.ts src/id-content-model.test.ts src/handler-lowering.test.ts` and `pnpm --filter @jiso/compiler exec tsc --noEmit` passed.

---

## Phase 2 — Make the runtime update plan real (CRITICAL) — faked since launch

The keyed morph and template-stamp reconciler exist but no production seam constructs them. Highest leverage: Phase 2a is mostly wiring of code that already passes isolated tests.

- [ ] **Wire the idiomorph-class morph into all three production fragment-apply seams** — `packages/runtime/src/inline-loader.ts` (`replaceHtmlResponseFragment` = `innerHTML`), `packages/runtime/src/response-fragment-apply.ts:62`, `packages/create-jiso/templates/src/client.ts:75` (overrides `replaceWithHtml` with `innerHTML`) (SPEC §9.1, §4.4). Route all three through `morph.ts` (`DomMorphRoot` / `keyedDomMorph`): capture activeElement focus/selection/scroll, keyed child reconcile by `fw-key`, restore. The inline-loader port must stay within the §4.4 4KB budget. Fix the bad `applyDeferredStreamResponseToDom` import in the starter template (real export is `applyDeferredStreamResponseToRuntime`).
  - Done = an integration test drives a fragment apply through the _actually-installed_ loader (not a hand-built `DomMorphRoot`) and asserts focus + text selection survive; `innerHTML` no longer appears on any production fragment-replace path.
  - Prove: `pnpm run check:inline-loader && pnpm test morph response-fragment && pnpm run test:browser`
  - Progress 2026-06-15: `packages/create-jiso/templates/src/client.ts` now imports
    `applyDeferredStreamResponseToRuntime` and returns `DomMorphTarget` from the starter browser root,
    removing that template's raw `innerHTML` replacement override.
  - Gap 2026-06-15: the runtime `response-fragment-apply.ts`/inline-loader replacement seam remains
    open. A direct inline keyed-morph port exceeded the SPEC §4.4 gzip budget, so this checkbox stays
    open until the inline-safe design is compact enough and proven by the full done criteria.

- [x] **Implement a DOM-backed keyed template-stamp reconciler** — `packages/runtime/src/query-bindings.ts:190` (the `isTemplateStampHost` guard) + `emit/client.ts` template-stamp plan (SPEC §4.8 step 3, §13.2). Invoke a real reconciler directly from `applyCompiledQueryUpdatePlan` (or at loader setup) instead of depending on a `reconcileTemplateStamp` method that only test fakes implement: index existing `[fw-key]` children, clone `<template fw-stamp>` for inserts, remove exits, reorder by key, run item-relative bindings — **reusing the same `fw-key` helper the morph uses** (§13.2 single keyed-identity contract). Keep the host-method interface only as an optional override seam.
  - Done = a jsdom test asserts a plain `<ul data-bind-list>` inserts / removes / reorders `<li fw-key>` and re-runs item-relative bindings after a query update — with no test-fake host.
  - Prove: `pnpm test query-bindings stamps`
  - Evidence 2026-06-15: `packages/runtime/src/query-bindings.ts` now falls back from the optional
    `reconcileTemplateStamp` test seam to a real DOM reconciler for `<template fw-stamp>` hosts,
    reusing `morphDomElement` for keyed identity and applying item-relative `data-bind`/
    `data-bind:*` paths after insert/reorder.
  - Evidence 2026-06-15: `packages/runtime/src/query-bindings.browser.test.ts` covers a plain
    `<ul data-bind-list>` inserting `p2`, preserving and reordering existing `p1`, removing `p3`,
    assigning `fw-key`, and updating item-relative text/attribute bindings without a fake host.
  - Evidence 2026-06-15: `pnpm --filter @jiso/runtime exec vitest run src/query-bindings.test.ts`,
    `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/query-bindings.browser.test.ts`, `pnpm --filter @jiso/runtime exec tsc
--noEmit`, and `pnpm --filter @jiso/runtime run check:inline-loader` passed.

---

## Phase 3 — Restore the §4.9 completeness proof & auto-lowering coverage (HIGH)

Localized to `analyze/query-updates.ts`, `lower/inline-derives.ts`, `lower/view-transitions.ts`; unblocks authors immediately.

- [x] **Classify every query-dependent position, including compound expressions** — `packages/compiler/src/analyze/query-updates.ts:186` (SPEC §4.9). `jsxQueryExpressionPaths` emits a coverage fact only for a bare `solePropertyAccessPath`; enumerate **all** query property-access reads (mirror `jsxStateExpressionPaths`) so a read inside a ternary/template/binary in a lowerer-skipped position (e.g. `className={cart.x > 5 ? …}`) reaches the UNHANDLED → FW311 fallback instead of vanishing from the proof.
  - Done = FW311 fires for `className={cart.x > 5 ? 'a':'b'}`. Prove: `pnpm test query-coverage`
  - Evidence 2026-06-15: `packages/compiler/src/analyze/query-updates.ts` now mirrors state
    coverage by enumerating every parsed query property access in non-handler JSX expressions instead
    of only `solePropertyAccessPath`.
  - Evidence 2026-06-15: `packages/compiler/src/query-coverage.test.ts` covers
    `className={cart.count > 5 ? 'full' : 'empty'}` reaching UNHANDLED coverage and FW311.
  - Evidence 2026-06-15: `pnpm --filter @jiso/compiler exec vitest run
src/query-coverage.test.ts` and `pnpm --filter @jiso/compiler exec tsc --noEmit` passed.

- [x] **Produce the `fragment` coverage status** — `packages/compiler/src/analyze/query-updates.ts:122`, `validate/component-contracts.ts:191` (SPEC §4.9 status table). Add a `fragment` branch (gated on `fragmentTarget: true`, mirroring the `isomorphic` branch) before the UNHANDLED sweep so query positions inside a fragment target are covered (1 RTT, declared) instead of emitting a spurious build-blocking FW311. Restrict to **query** paths — state reads still fall to UNHANDLED.
  - Done = a `fragmentTarget: true` component with a query read reports `status:'fragment'` and no FW311; existing fragment-target tests stop wrapping reads in `renderOnce(...)` to dodge it. Prove: `pnpm test query-coverage fragment-targets`
  - Evidence 2026-06-15: `packages/compiler/src/analyze/query-updates.ts` now emits `fragment`
    coverage for query expression paths when `fragmentTarget: true` before the UNHANDLED sweep, while
    leaving state expression paths to the existing UNHANDLED logic.
  - Evidence 2026-06-15: `packages/compiler/src/query-coverage.test.ts` covers a fragment-target
    `className={cart.count > 5 ? ...}` query read producing `status: 'fragment'` without FW311 and a
    fragment-target `state.open` expression still producing FW311.
  - Evidence 2026-06-15: `pnpm --filter @jiso/compiler exec vitest run
src/query-coverage.test.ts` and `pnpm --filter @jiso/compiler exec tsc --noEmit` passed.

- [x] **Lower every derivable attribute per element; handle dynamic `viewTransitionName`** — `packages/compiler/src/lower/inline-derives.ts:62` and `packages/compiler/src/lower/view-transitions.ts:18` (SPEC §4.8 #2, §4.2). Drop the `candidates.length !== 1` cap so two bound attributes on one element both lower to named derives. In view-transitions, handle the `expression` form (not just string `value`): lower a dynamic name to the `view-transition-name` **style** channel (one merged `style`, never a duplicate attribute and never a bogus `viewTransitionName` attr), or emit an explicit diagnostic if out of v1 scope — never silently leak raw JSX.
  - Done = `<button aria-expanded={…} aria-busy={…}>` emits two `data-bind:*`; `viewTransitionName={q.slug}` produces a stamp or a diagnostic, not leaked JSX. Prove: `pnpm test query-update-plans view-transitions`
  - Evidence 2026-06-15: `packages/compiler/src/lower/inline-derives.ts` now lowers all
    derivable attributes on an element and uses `data-bind:*` selector stamps when multiple query
    stamps would otherwise collide on `data-derive`; `packages/compiler/src/analyze/query-updates.ts`
    recognizes those `data-bind:*` query derive stamps.
  - Evidence 2026-06-15: dynamic `viewTransitionName={query.path}` is handled by
    `packages/compiler/src/lower/inline-derives.ts` as a compiled `style` query-update stamp with a
    `view-transition-name` CSS expression, while `packages/compiler/src/lower/view-transitions.ts`
    remains the static registry-stamp path for string values.
  - Evidence 2026-06-15: `packages/compiler/src/query-coverage.test.ts` covers two derived query
    attributes on one element; `packages/compiler/src/view-transitions.test.ts` covers dynamic
    view-transition style stamps with and without an existing static style and asserts no FW311/raw
    `viewTransitionName` leak.
  - Evidence 2026-06-15: `pnpm --filter @jiso/compiler exec vitest run
src/query-coverage.test.ts src/view-transitions.test.ts src/query-update-plans.test.ts`, `pnpm
--filter @jiso/compiler exec tsc --noEmit`, and `pnpm exec vp check --fix` passed.

---

## Phase 4 — Replace heuristic-for-proof gates with typed/dataflow checks (HIGH/MED)

Shared pattern: carry the typed parser fact instead of matching a name/string. Sequence the two real soundness holes (FW302, FW235) first, then the lint-precision items.

- [x] **FW302: validate `state.*` binding paths against the declared state shape** — `packages/compiler/src/validate/bindings.ts:48` (SPEC §4.8). Remove the `query !== 'state'` exemption: build a `QueryShape` from `componentStateReturnObjectModel().entries` and run `validatePathInQueryShapes` on `state.*` paths. Scope first cut to top-level key existence; follow with nested-shape FW227 parity.
  - Done = `<output data-bind="state.doesNotExist">` emits FW302. Prove: `pnpm test state-bindings bindings`
  - Evidence 2026-06-15: `packages/compiler/src/validate/bindings.ts` now validates `state.*`
    bindings even when query-shape metadata is absent, using typed `componentStateReturnObjectModel`
    entries for top-level state keys and allowing compiler-generated exported state derives.
  - Evidence 2026-06-15: `packages/compiler/src/state-bindings.test.ts` covers a valid
    `state.profile.name` binding, invalid `state.doesNotExist` FW302, and keeps generated
    state-derive bindings diagnostic-free.
  - Evidence 2026-06-15: `pnpm --filter @jiso/compiler exec vitest run
src/state-bindings.test.ts src/query-bindings.test.ts`, `pnpm --filter @jiso/compiler exec tsc
--noEmit`, and `pnpm exec vp check --fix` passed.

- [x] **FW235: fire from the typed string-render fact, not the HTML-tag regex** — `packages/compiler/src/validate/authoring-surface.ts:51` (SPEC §5.2 rule 7). Drop the `firstHtmlTagName ?` filter so every `StringRenderModel` (any string/template-literal render, tag or not) triggers FW235; keep `firstHtmlTagName` only for the teaching message.
  - Done = FW235 fires for tagless `` render: () => `Total items` `` and tagless `renderSource(){ return 'Total: 2'; }`. Prove: `pnpm test compile-component authoring`
  - Evidence 2026-06-15: `packages/compiler/src/validate/authoring-surface.ts` now maps every
    typed `StringRenderModel` to FW235 and uses `firstHtmlTagName` only to tailor the help text.
  - Evidence 2026-06-15: `packages/compiler/src/compile-component.test.ts` covers tagless
    component string renders and tagless app-authored `renderSource()` returns, alongside the
    existing HTML-tag string-render fixtures.
  - Evidence 2026-06-15: `pnpm --filter @jiso/compiler exec vitest run
src/compile-component.test.ts src/scan/parse.test.ts`, `pnpm --filter @jiso/compiler exec tsc
--noEmit`, and `pnpm exec vp check --fix` passed.

- [x] **FW301: decide "server fact in local state" by initializer dataflow, not key-name prefix** — `packages/compiler/src/validate/component-contracts.ts:36` (SPEC §11.3). Surface each state-return entry's initializer references as parser facts (reuse `PropertyAccessPathModel` — do **not** re-parse `value` in validate, §5.2 rule 8). Flag FW301 only when an initializer reads a path rooted in a declared query, regardless of key spelling. Also fix the drifted FW301 span (thread `sourceOffsetMap`, emit against original source like FW311).
  - Done = `accountNameDraft` stops firing; `{ saved: cart.count }`-via-alias starts firing; span points at authored TSX. Prove: `pnpm test state-events`
  - Evidence 2026-06-15: `packages/compiler/src/scan/parse.ts` records
    `valuePropertyAccesses` on state-return object entries using the existing typed
    `PropertyAccessPathModel`, and `packages/compiler/src/validate/component-contracts.ts` uses
    those facts instead of the old state-key prefix heuristic.
  - Evidence 2026-06-15: FW301 diagnostics now map state-initializer property-access spans through
    `sourceOffsetMap` to authored TSX coordinates.
  - Evidence 2026-06-15: `packages/compiler/src/state-events.test.ts` covers
    `{ saved: cart.count }` firing FW301 through an offset-map-producing lowering and
    `accountNameDraft` remaining clean; `packages/compiler/src/scan/parse.test.ts` covers the new
    parser fact.
  - Evidence 2026-06-15: `pnpm --filter @jiso/compiler exec vitest run
src/state-events.test.ts src/scan/parse.test.ts`, `pnpm --filter @jiso/compiler exec tsc
--noEmit`, and `pnpm exec vp check --fix` passed.

- [x] **FW320: drive event-payload overlap from value provenance, not bare leaf names** — `packages/compiler/src/validate/component-contracts.ts:114`, `analyze/query-shapes.ts:171` (SPEC §6.4/§7). Flag an emit field only when its **value** resolves to a property access rooted in a real query in scope; drop the unprefixed bare-leaf branch in `queryShapePaths`.
  - Done = a renamed server value (`{ snapshotTotal: order.total }`) fires; a same-named client-intent key (`quantity`) does not. Prove: `pnpm test state-events`
  - Evidence 2026-06-15: `packages/compiler/src/validate/component-contracts.ts` now checks
    `emit(...)` payload value property accesses from the typed call model instead of object-literal
    key paths, and `packages/compiler/src/analyze/query-shapes.ts` no longer expands query shapes
    into unprefixed bare child paths.
  - Evidence 2026-06-15: `packages/compiler/src/state-events.test.ts` covers a renamed
    `{ snapshotTotal: order.total }` server value producing FW320 and a same-named `{ quantity }`
    client-intent payload remaining clean.
  - Evidence 2026-06-15: `pnpm --filter @jiso/compiler exec vitest run
src/state-events.test.ts src/query-bindings.test.ts src/registry.test.ts`, `pnpm --filter
@jiso/compiler exec tsc --noEmit`, and `pnpm exec vp check --fix` passed.

- [x] **FW221: scope IDREF resolution per component, not the module-wide flat id set** — `packages/compiler/src/validate/markup.ts:32` (SPEC §4.5). Resolve ids within each component's render-body span (iterate `model.components`) instead of over module-wide `model.jsxElements`. Requires tagging each `JsxElementModel` with its owning component (parser) or partitioning by render-body span.
  - Done = component A's `popovertarget="x"` is **not** satisfied by component B's `id="x"`. Prove: `pnpm test id-content-model`
  - Evidence 2026-06-15: `packages/compiler/src/validate/markup.ts` now partitions JSX elements by
    each component render host and validates FW221 IDREFs against literal ids in that component
    scope instead of one module-wide id set.
  - Evidence 2026-06-15: `packages/compiler/src/id-content-model.test.ts` covers an IDREF in one
    component that is only satisfied by another component's `id`, producing FW221.
  - Evidence 2026-06-15: `pnpm --filter @jiso/compiler exec vitest run
src/id-content-model.test.ts src/platform-lowering.test.ts`, `pnpm --filter @jiso/compiler exec
tsc --noEmit`, and `pnpm exec vp check --fix` passed.

---

## Phase 5 — Drizzle extraction precision (HIGH/MED) — §11.1 soundness

`packages/drizzle/src/static.ts` + `drizzle-surface.ts`. Independent of the compiler phases; parallelizable.

- [x] **db-receiver provenance gate (originate-in-`drizzle-orm`), not type-name match** — `static.ts` `isDrizzleDatabaseType`, `drizzle-surface.ts:51` (SPEC §11.1 step 1). Resolve the receiver type's symbol/base symbols to declarations and require a declaration originating in `drizzle-orm` (mirror the table-factory path's `isDrizzleOrmDeclaration`) before the name disambiguates db flavor. Drop the `getText()` name fallback; unresolved receiver ⇒ FW406 (manual touches), §11.1 step 2E.
  - Evidence 2026-06-15: `packages/drizzle/src/static.ts` now requires Drizzle database type
    names to be backed by declarations originating in `drizzle-orm`, including base/apparent type
    declarations and import/module declaration provenance for unresolved `TypeReference` annotations;
    the old `type.getText()` name extraction fallback was removed.
  - Evidence 2026-06-15: `packages/drizzle/src/index.writes-receivers.test.ts` covers an
    app-local `class PgDatabase` with a Drizzle-shaped `insert()` method producing no touch graph
    facts, while query-loader receiver fixtures now supply a real Drizzle-origin type declaration
    instead of depending on bare name matching.
  - Evidence 2026-06-15: `pnpm --filter @jiso/drizzle exec vitest run` and
    `pnpm --filter @jiso/drizzle exec tsc --noEmit` passed.
  - Done = a `class PgDatabase` in app code with no drizzle import is **not** accepted as a db; its writes don't produce authoritative touches. Prove: `pnpm test --dir packages/drizzle` (or the drizzle static suite)

- [x] **Default same-name domain for un-annotated `pgTable`; emit FW404 at compile time** — `static.ts:2556` (SPEC §10.1, §11.3). Recognize any module-verified `pgTable()` as a table regardless of `jiso()` annotation; synthesize a default domain from the table-name literal. Route only genuinely unmappable writes to FW406; emit FW404 statically for writes to a resolved table with no domain and not `exempt`.
  - Evidence 2026-06-15: `packages/drizzle/src/static.ts` now treats verified `pgTable()`
    initializers as table facts without requiring `jiso()`, synthesizes a default domain from the
    static table-name literal, and keeps dynamically named unannotated tables as resolved-but-FW404
    unmapped table writes instead of FW406.
  - Evidence 2026-06-15: `packages/core/src/graph.ts` and `packages/drizzle/src/graph.ts` allow
    serialized touch-graph unresolved diagnostics to carry FW404 as well as FW406.
  - Evidence 2026-06-15: `packages/drizzle/src/index.writes-receivers.test.ts` covers
    `pgTable("carts", {})` + `db.insert(carts)` producing a `cart` touch and dynamic unannotated
    `pgTable(tableName, {})` writes producing FW404.
  - Evidence 2026-06-15: `pnpm --filter @jiso/drizzle exec vitest run`,
    `pnpm --filter @jiso/drizzle exec tsc --noEmit`, and
    `pnpm --filter @jiso/core exec tsc --noEmit` passed.
  - Done = bare `pgTable("carts", {})` + `db.insert(carts)` yields a `cart` touch (not FW406); an unmapped non-exempt write emits FW404 at compile time. Prove: drizzle static suite with bare-table fixtures.

- [x] **Composite key derivation: unwrap `and(eq…)` and prove RHS is a write param** — `static.ts:8491`, `:8569` (SPEC §11.1 step 4, FW408). In `extractParameterizedKey`, unwrap a top-level `and(...)` (share the helper with the v2 `keyEqMatchesFromPredicate` to prevent drift) and record `arg:` keys for eq conjuncts. Record a key **only** when the RHS identifier resolves to a `ParameterDeclaration` of the enclosing write (stop hardcoding `input`, stop fabricating `arg:<anyLocal>`); otherwise degrade to table-level (FW409).
  - Evidence 2026-06-15: `packages/drizzle/src/static.ts` now threads callback parameter
    symbols into write predicate extraction, uses a shared `eq`/`and` conjunct walker for
    touch-graph and symbolic-effect extraction, and records `arg:*` keys only for identifiers or
    property accesses rooted in actual callback parameters.
  - Evidence 2026-06-15: `packages/drizzle/src/index.columns-keys-predicates.test.ts` covers
    `and(eq(users.id, id), eq(users.tenantId, tenantId))` producing
    `arg:id,arg:tenantId` and `eq(products.id, randomLocal)` degrading to table-level FW409.
  - Evidence 2026-06-15: with `pnpm --filter @jiso/drizzle exec`, the commands
    `vitest run src/index.columns-keys-predicates.test.ts`, `vitest run`, and `tsc --noEmit`
    passed.
  - Done = `where(and(eq(T.id,arg), eq(T.tenant,t)))` records both keys; `eq(T.id, randomLocal)` records `null`. Prove: drizzle static suite with composite + non-param fixtures.

---

## Phase 6 — Make the verification gates real (HIGH) — they give false confidence

Do before/alongside the broad refactors so subsequent changes are actually checked.

- [ ] **Render-equivalence: a real authored-vs-lowered differential** — `packages/compiler/src/emit/server.ts:39`, `compile.ts:151` (SPEC §5.2 rule 3). Produce the lowered-side HTML by executing `renderSource()` (as today) and the authored-side HTML from a separate reference render over the _originally parsed_ model (available pre-lowering), then diff byte-for-byte allowing only provably HTML-preserving deltas (`fw-c`, `fw-deps`, `fw-state`, versioned handler values). Until an authored renderer exists, **stop labeling it the rule-3 gate** and stop letting `fw check` report the invariant as enforced.
  - Done = a lowering that changes emitted HTML makes the gate fail (a regression test proves it can fail). Prove: `pnpm test compile-component && pnpm run check:fw`
  - Progress 2026-06-15: `packages/compiler/src/compile.ts` no longer emits the previous generated render-equivalence fact from the lowered `renderSource()` round trip; compile/MCP output now reports an empty `renderEquivalenceChecks` list until a real authored-vs-lowered differential supplies facts.
  - Gap 2026-06-15: the SPEC §5.2 authored renderer still does not exist, so this checkbox remains open; no regression yet proves that a lowering which changes emitted HTML fails the semantic gate.
  - Evidence 2026-06-15: `pnpm --filter @jiso/compiler exec vitest run src/compile-component.test.ts`, `pnpm --filter fw exec vitest run src/index.compile-mcp.test.ts src/index.fw-check.test.ts`, `pnpm --filter @jiso/compiler exec tsc --noEmit`, and `pnpm --filter fw exec tsc --noEmit` passed.

- [x] **FW228: wire route-ambiguity detection into a blocking pipeline** — `packages/server/src/match.ts:100` (`findRouteAmbiguities`, currently zero callers) (SPEC §9.5, §11.3 severity=error). Invoke during `createApp` / route-table compile; register FW228 at severity `error` so it blocks dev serving, vite build, and static export (mirror FW229's wiring). Drop the "planned 9.5 shell dispatch" hedge in the message.
  - Done = an ambiguous route table is rejected end-to-end with FW228 instead of resolving by declaration order. Prove: `pnpm test match && pnpm run check:fw`
  - Evidence 2026-06-15: `packages/core/src/diagnostics.ts` registers FW228 as `error`; `packages/server/src/app.ts` stores route-table diagnostics from `findRouteAmbiguities`; `packages/server/src/app-request.ts`, `vite-build.ts`, `static-export.ts`, and `static-export-replay.ts` block on shared-registry error diagnostics before route dispatch, build output, or export replay.
  - Evidence 2026-06-15: `packages/server/src/app.test.ts`, `vite-dev.test.ts`, `vite-build-wiring.test.ts`, `static-export-diagnostics.test.ts`, and `static-export-replay.test.ts` prove ambiguous `/products/:id` vs `/products/new` routes fail with FW228 across request dispatch, dev serving, Vite build, and static export; `match.test.ts` verifies the non-hedged message.
  - Evidence 2026-06-15: `pnpm --filter @jiso/core exec vitest run src/diagnostics.test.ts`, `pnpm --filter @jiso/server exec vitest run src/match.test.ts src/app.test.ts src/vite-dev.test.ts src/vite-build-wiring.test.ts src/static-export-diagnostics.test.ts src/static-export-replay.test.ts`, `pnpm --filter @jiso/server exec vitest run`, `pnpm --filter @jiso/core exec vitest run`, `pnpm --filter @jiso/server exec tsc --noEmit`, `pnpm --filter @jiso/core exec tsc --noEmit`, and `pnpm exec vp check` passed.

---

## Phase 7 — §4.6 attribute-merge engine (HIGH) — largest single slice

The full merge-rules implementation currently lives only in `examples/gallery/src/merge-fixtures-oracle.tsx`; FW231/232/233 only detect literal duplicate attributes on one element. Plan-tracked in `fix-ui.md` Phase 2. Land as one coherent slice after the safety/coverage criticals.

- [x] **Implement §4.6 composition merge as a compiler lower-phase** — consume the primitive's computed attribute record + the author element (`asChild` as sugar lowering to the attrs-function form), emit one merged element applying the full normative rule table (class/style concat, `on:*` chain, IDREF FW231, aria FW232, data-state precedence, `data-p` FW231, `data-bind` FW233, disabled/required logical-OR, `fw-deps` union, `fw-c`/`fw-state` FW231). (SPEC §4.6)
  - Done = a primitive `attrs`-function trigger merges into the author element with the rule-table result on the wire (no oracle).
  - Evidence 2026-06-15: `packages/compiler/src/lower/attribute-merge.ts` owns the SPEC §4.6 rule table, and `packages/compiler/src/lower/primitive-spreads.ts` now rewrites `asChild`/attrs-function primitive wrappers to a single merged child opening tag instead of appending primitive attrs.
  - Evidence 2026-06-15: `packages/compiler/src/attribute-merge.test.ts` proves an attrs-function primitive merges class/style, chains `on:click`, preserves author `id`/scalar defaults, lets primitive `data-state` win, ORs boolean attrs, unions `fw-deps`, and emits FW231/FW232/FW233 for primitive-vs-author conflicts.
  - Evidence 2026-06-15: `pnpm --filter @jiso/compiler exec vitest run src/attribute-merge.test.ts src/handler-lowering.test.ts`, `pnpm --filter @jiso/compiler exec vitest run`, `pnpm --filter @jiso/compiler exec tsc --noEmit`, and `pnpm exec vp check` passed.
- [ ] **Drive FW231/FW232/FW233 from the merged primitive-vs-author result; delete the gallery oracle** — extract the rule table into a shared compiler module feeding both the G5 gallery fixtures and the diagnostics; keep same-element literal-duplicate detection as a separate, clearly-scoped author-error check (stop presenting it as the §4.6 merge). (SPEC §4.6)
  - Done = FW232 fires on a genuine author-over-primitive override (not a duplicate-name shape); `mergePrimitiveAttrs` removed. Prove: `pnpm test attribute-merge && pnpm run test:browser` (gallery G5)

---

## Phase 8 — Hygiene & lower-risk precision (LOW/MED) — parallelizable

Independent; fan out opportunistically once higher-leverage slices integrate.

- [ ] **Fragment-target props type: never collapse to `{}`** — `packages/compiler/src/graph.ts:104` (SPEC §6.2). Emit each unrecognized prop's declared type (or `unknown`) instead of dropping; never emit `'{}'` when ≥1 prop was declared. Prove: `pnpm test fragment-targets`
- [ ] **CSS scope-fallback: depth-aware selector splitter** — `packages/compiler/src/css.ts:145` (SPEC §13.1). Replace `selector.split(',')` with a splitter that breaks only on top-level commas (track `()`/`[]`/quotes); recurse into nested `&` blocks with the same host-prefix + donut `:not(...)`. Prove: `pnpm test css` (add `:is()`/`[data-x="a,b"]`/`&`-nesting fixtures)
- [ ] **Thread validated coerced input onto `MutationSuccess`** — `packages/server/src/mutation.ts:746` (SPEC §10.3). Render reruns from the parsed input, not `change.input ?? rawInput`, so render-time and scheduled instance keys derive from the same coerced input. Prove: server mutation suite.
- [ ] **`<Link>` lowering: self-closing + dynamic-target** — `packages/compiler/src/lower/navigation.ts:13` (SPEC §6.4). Remove the `!selfClosing` filter; route static-`to` Links through FW220; lower non-static `to` to a resolved `<a href>` or diagnose. Prove: `pnpm test navigation-lowering`
- [ ] **JSX comment→attribute attachment: structural, not char-class gap** — `packages/compiler/src/scan/parse.ts:1503` (SPEC §5.2 rule 8). Associate a justification comment with the opening element it directly precedes via the ts tree, not `isAttachedJsxCommentGap`'s permissive regex. Prove: `pnpm test execution-triggers scan/parse`
- [ ] **Remove dead snippet-reparse exports; FW311 help text; FW224 message scope; FW232 placement; primitive-handler-lint default-on** — bundle the remaining audit lows (`scan/parse.ts:462`, `core/diagnostics.ts` FW311, `markup.ts` FW224/FW232, `headless-ui/.../primitive-handler-lint.ts`). Each: tighten the rule or wording to match SPEC; add the asserting test. Prove: `pnpm test` + `pnpm run check:fw`

---

## Proving gates

- **Per item:** the targeted `pnpm test <filter>` above. Add the positive **and** negative fixture named in "Done =" before checking the box — several of these hacks were green precisely because only the passing shape was tested.
- **Touching shared behavior / §5.2 rule 8:** `pnpm run check:fw` (the mechanical post-parse-source-string guard) + `pnpm run check`.
- **Runtime loader changes (Phase 2):** `pnpm run check:inline-loader` (4KB budget) + `pnpm run test:browser` (morph survival).
- **Phase exit / before checkpoint commit:** `pnpm test`; **release gate:** `pnpm run acceptance`.

## Execution notes

- **Critical path:** Phases 1 → 2 → 3 close silent-correctness/safety holes and should land first and in order. Phase 6 (real gates) is best done early so it protects Phases 4/5/7 from regressing behind a green-but-meaningless check.
- **Parallelizable (independent file ownership, good for sub-agent worktrees):** Phase 5 (drizzle), Phase 7 (attribute-merge / `ui`+`gallery`), and every Phase 8 item are non-overlapping with each other and with Phases 1–4. Keep one critical-path slice in the main worktree per CLAUDE.md and delegate bounded sidecars.
- **Shared contract to keep single-sourced:** the `fw-key` identity helper must be the _same_ code for morph (Phase 2a), template stamps (Phase 2b), and optimistic reordering (§13.2) — do not fork it.
- **Do not** mark a checkbox done without the cited proving evidence in the same session; if a check can't run, record why under the item.
