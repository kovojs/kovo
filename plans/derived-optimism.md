# Derived Optimism (v2) Plan

Status: active. Created 2026-06-13. Scope decisions locked 2026-06-13 (see below).

`SPEC.md` is the normative source of truth. This plan implements the **derived optimism** half of
the v2 stage (`SPEC.md` §14): compiler-generated optimistic transforms via the §10.5 derivation
algebra, property-tested for soundness, with named punts — superseding hand-written transforms pair
by pair. The v2 stage also bundles **live queries (L4 / SSE)** and the **CDC adapter**; those are a
separate workstream and are explicitly **out of scope** for this plan (see Non-Goals).

## Prerequisites & Baseline

- **`plans/v1-cleanup.md` is assumed closed** before this plan starts. In particular the Drizzle
  source-mode removal (project-mode extraction only) and the runtime parser/apply consolidation are
  load-bearing for derivation: the deriver reads typed model facts, never source strings.
- The v1 groundwork the deriver builds on already exists and is treated as a stable foundation
  (verified by Explore on 2026-06-13):
  - Hand-written transform IR + exhaustiveness type: `OptimisticFor`, `OptimisticTransform`,
    `OptimisticPlan`, `OptimisticRebaser` in `packages/runtime/src/optimism.ts`.
  - `InvalidationSets` registry + FW310 emission: `packages/compiler/src/emit/registry.ts`,
    `packages/core/src/index.ts`, `packages/core/src/diagnostics.ts`.
  - ts-morph write/read/key/shape extraction: `packages/drizzle/src/static.ts`,
    `packages/drizzle/src/graph.ts`, committed output `examples/commerce/src/generated/touch-graph.ts`.
  - Runtime snapshot/apply/rebase protocol: `OptimisticRebaser` (`optimism.ts:105-213`).
  - The v1.5 verification layer is **already in v1** — runtime instrumentation (FW402–411),
    the unified typed change record `{domain, keys, input}` (`packages/server/src/change-record.ts`,
    `MutationChangeRecord` in `optimism.ts`), and the pglite harness (`packages/test/src/pglite.ts`,
    `verifier.ts`). No separate v1.5 prerequisite remains.
- **The gap is the algebra itself.** Today `QueryShape` (`packages/drizzle/src/static.ts:118-134`)
  and `packages/compiler/src/analyze/query-shapes.ts` carry only raw inferred shapes — there is **no**
  `Scalar/COUNT/SUM/AGG`-over-rowset classification, no write→row-effect IR, no effect-through-shape
  deriver, no `generated/optimistic/*.ts` emission, and `OptimisticCoverage.status`
  (`packages/core/src/graph.ts:165-168`) has no `derived` member or separate punt metadata. There is
  zero v2 scaffolding by design (§10.5 phasing note, `SPEC.md:847`).

## Scope Decisions (locked 2026-06-13)

- **Disposition: release-blocking, full feature in one plan.** The plan covers the entire §10.5
  algebra (Stages 1–3), codegen, runtime integration, the diagnostics surface, the soundness
  property suite, and the commerce migration. Phases below are execution sequencing, not a coverage
  cut — "skeleton only" is not an acceptable stopping point. Every checkbox closes with cited
  evidence per `CLAUDE.md` evidence discipline.
- **Coverage bar: full shape-grammar coverage.** Every (mutation × invalidated-query) pair whose
  write effect and query shape fall **within** the §10.5 grammar must derive. A pair may be a named
  punt **only** when it is genuinely outside the grammar (the §10.5 PUNT list: Opaque SET, non-key
  match predicates, window/GROUP BY+HAVING/DISTINCT shapes, interprocedural FW406 opacity, params
  untraceable to input/session-key, Opaque orderBy/insertion point). 70% (the §16.1 figure) is a
  floor we expect to clear comfortably, not the gate.
- **Commerce migration: delete and let derivation take over.** Hand-written transforms in
  `examples/commerce` are deleted for every pair derivation covers, proving the §10.4 "pair by pair"
  incremental-takeover ergonomics and measuring real coverage. Hand-written transforms survive only
  where the pair is an out-of-grammar punt, as the sanctioned override.
- **Dialect: Postgres-only.** Derivation targets the pinned Drizzle Postgres subset (`SPEC.md:1070`,
  §14). SQLite/MySQL derivation is deferred with v1's dialect deferral; out-of-subset surfaces punt.
- **All-or-nothing per field; wrong predictions are worse than none** (§10.5). A field that cannot be
  soundly derived punts the whole field rather than emitting a best-effort patch.

## Non-Goals (this plan)

- Live queries (L4), `<fw-live>`, SSE transport, guard-recheck-per-push, in-process/Redis bus.
- CDC adapter (Postgres logical replication / Supabase Realtime), out-of-band-write handling.
- Full runtime read/write tracking (v3, conditional — `SPEC.md:1071`).
- SQLite/MySQL derivation.

These remain owned by a future `plans/live-queries.md` / CDC plan. Where this plan touches the typed
change record or query addressing, it must not regress their forward-compatibility (§9.3, §14).

## Phase 0 — Query-shape algebra (Stage 2)

- [ ] Define the shared derivation contract before implementation fan-out:
      `AlgebraicQueryShape`, `SymbolicEffect`, `PatchProgram`, `DerivationResult`, and
      `PuntReason`.
      - `PuntReason` is derivation metadata, not optimistic coverage. A punt never satisfies
        `OptimisticFor` and never suppresses FW310 by itself; it explains why the pair still needs a
        hand-written transform or `'await-fragment'`.
      - Serialize these IRs in formatting-resistant fixtures so shape, effect, derivation, codegen,
        diagnostics, and property-suite slices share one contract instead of inventing local enums.
      - Done when the exported types and fixture helpers are covered by unit tests and consumed by
        at least one existing fixture path without changing runtime behavior.

- [ ] Classify each invalidated query's result shape into the §10.5 algebra:
      `field ::= Scalar(keyed-row col) | COUNT(R[, pred]) | SUM(R, arith) | AGG(R, projection)`
      where `R = rowset(filter chain, key, orderBy)`.
      - Build on / extend the existing shape extraction in `packages/drizzle/src/static.ts`
        (`QueryShape`, `QueryFact`) and `packages/compiler/src/analyze/query-shapes.ts`; do not
        replace the raw shapes the binding-path validators already depend on — add the algebraic
        classification as a derived layer over them.
      - Record the rowset's filter chain, instance key, and `orderBy` (with per-column opacity) so
        Stage 3 can decide insertion points and membership transitions.
      - Record a **client-data availability witness** for aggregate derivation: the concrete result
        path(s) proving that a `COUNT`/`SUM` field's contributing rows and contribution columns are
        already shipped by the same query instance. If no witness exists, aggregate deletions/updates
        punt rather than guessing.
      - Shapes outside the grammar (window functions, `GROUP BY`+`HAVING`, `DISTINCT`, opaque
        `sql<T>` projections / FW410 sites) classify as `Opaque` and carry their punt reason.
      - Done when a fixture suite asserts the algebraic class (and punt reason for out-of-grammar
        shapes) for every commerce query plus a grammar-coverage fixture set, against project-mode
        ts-morph facts only.

## Phase 1 — Write → symbolic row-effects (Stage 1)

- [ ] Lower each write body to the symbolic effect IR over the existing project-mode extraction:
      `value ::= Param(path) | Const | ColRef(t.c) | Arith(op,v,v) | Opaque`;
      `effect ::= INSERT{vals} | UPDATE{match, sets} | DELETE{match} | UPSERT{…}`.
      - Reuse the ts-morph write-site resolution already in `packages/drizzle/src/static.ts`
        (`db.insert/update/delete`, table-identifier resolution, `eq()` key extraction, FW406
        interprocedural summaries). Effect IR is a typed projection of those facts, not a new parse.
      - `match` is eq-predicates on keys; range / `IN` / server-time predicates ⇒ `Opaque match`
        ⇒ punt (consistent with the existing FW409 table-level degradation).
      - Params must be traceable to mutation input or session key (the §11.1 predicate extractor);
        untraceable ⇒ `Opaque` value.
      - Done when the effect IR is emitted for every commerce mutation and a grammar-coverage write
        fixture set, with punts named for each Opaque value/match.

## Phase 2 — Effect-through-shape derivation (Stage 3)

- [ ] Push each effect through each invalidated query's algebraic shape to produce a JSON-patch
      program over client data, implementing the §10.5 Stage-3 rules:
      - `INSERT × AGG` ⇒ push (schema defaults; Opaque cols ⇒ `tempId()`/`now()` placeholders,
        pending-styled, content-matched on reconcile; `orderBy` decides insertion point — Opaque
        orderBy col ⇒ punt).
      - `UPSERT × AGG` ⇒ find-then-update-else-push (branchiness reproduced client-side).
      - `DELETE × COUNT` ⇒ −(matched count), computable iff the client holds the rows.
      - `DELETE × SUM` ⇒ −Σ contribution iff the query also ships the rows; else punt.
      - `SET on filtered col` ⇒ membership transition: exit derivable (Const vs filter), entry
        punts (client lacks the row's other columns).
      - Row possibly outside the client's rowset ⇒ emit a find-or-no-op **guard**, not a punt.
      - **All-or-nothing per field**: any Opaque component punts the whole field with its named
        reason; never a best-effort patch.
      - Done when the deriver emits a patch program or a named punt for every pair in the
        grammar-coverage matrix and every commerce pair, with punt reasons matching the §10.5 list.

- [ ] Keep patch synthesis separate from TypeScript transform emission.
      - The derivation core returns `DerivationResult = derived(PatchProgram) | punt(PuntReason)`;
        Phase 3 is the only place that lowers `PatchProgram` into TS source.
      - Add negative fixtures for every "must not derive" surface: Opaque SET, non-key match,
        window/GROUP BY+HAVING/DISTINCT shape, FW406 interprocedural opacity, FW410/raw SQL
        projection, params untraceable to input/session-key, and Opaque orderBy/insertion point.
      - Done when negative fixtures prove no transform artifact is emitted for punted pairs and the
        punt is surfaced as metadata rather than silently skipped.

## Phase 3 — Codegen: `generated/optimistic/*.ts`

- [ ] Emit derived transforms as committed, reviewable, overridable artifacts (`SPEC.md:331`,
      §10.4 example):
      `export const derived = { keys: { … }, transforms: { [query.key]: (data, $input) => { … } } }
      satisfies OptimisticFor<…>`,
      `// DO NOT EDIT (override in *.mutations.ts)`.
      - Emit alongside the existing committed `generated/touch-graph.ts` path
        (`packages/compiler/src/emit/registry.ts`); invalidation-graph + derivation changes appear
        as code-review diffs, not opaque runtime behavior.
      - **Override precedence mechanism**: codegen suppresses the derived transform entry for any
        pair already covered by a hand-written transform or `'await-fragment'`; deleting the
        hand-written entry lets the next generation emit the derived entry (the §10.4 incremental-
        adoption contract). The emitted `satisfies OptimisticFor<…>` must resolve FW310 for the
        pairs it covers so editor + `fw check` agree.
      - Done when commerce emits `generated/optimistic/*.ts`, the files typecheck against
        `OptimisticFor`, and override precedence is unit-tested (hand-written present ⇒ derived
        suppressed; hand-written deleted ⇒ derived active).

## Phase 4 — Runtime integration

- [ ] Derived transforms flow through the **existing** `OptimisticRebaser` exactly like hand-written
      ones — they share the IR (the whole point of the v1 design, §10.4 / `SPEC.md:847`).
      - Verify no rebase/queue/placeholder path needs a parallel implementation; if the v1 IR cannot
        carry a derivation construct (e.g. tempId placeholders, content-matched reconcile, orderBy
        insertion), record it as a "v1 painted v2 into a corner" finding and fix at the IR seam, not
        with a fork.
      - Pending-styling (`fw-pending` + `aria-busy`), `structuredClone` snapshot, morph-over-
        prediction reconcile, and the per-query pending-transform log must behave identically for
        derived and hand-written transforms.
      - Done when a runtime/browser test exercises a derived transform end-to-end (snapshot → apply →
        server-truth morph/rebase → settle) and asserts parity with the hand-written path it replaces.

## Phase 5 — Diagnostics & explain surface

- [ ] Extend the coverage status set and the `fw` surfaces (§10.5, §10.6, `SPEC.md:353`, `:891`):
      - Add `derived` to `OptimisticCoverage.status`
        (`packages/core/src/graph.ts:165-168`); update producers/consumers in `packages/cli`,
        `packages/test/src/fw-*-fixtures.ts`.
      - Add derivation metadata separately from coverage, e.g. `derivation:
        { status: 'derived' } | { status: 'PUNTED'; reason: PuntReason }`. A `PUNTED` derivation
        leaves optimistic coverage `UNHANDLED` unless a hand-written transform or `'await-fragment'`
        covers the pair.
      - `fw check optimistic` shows `derived ✓` per covered pair; `fw explain --optimistic` and
        `fw explain mutation <m> --optimistic` report transform coverage **plus derivation traces +
        named punts** inline (e.g. `PUNTED (Opaque: compute_discount)`).
      - FW310 stays a `warn`/editor-visible type error but its meaning becomes "write/defer;
        **derive**" (`diagnostics.ts` FW310, `SPEC.md:969`) — only fires when no hand-written
        transform, emitted derivation, or `'await-fragment'` covers the pair. A derivation punt does
        not count as coverage.
      - MCP exposes the same structured status (§11.3 — MCP is a rendering surface, not a second
        diagnostic channel).
      - Done when explain/check fixtures show `derived ✓`, at least one named `PUNTED` reason for
        commerce, and a punted-uncovered pair still emits FW310; severities are unchanged, and the
        output stays snapshot-stable for graph-query asserts.

## Phase 6 — Soundness property suite (commuting diagrams)

- [ ] Property-test derivation soundness (§10.5 closing, §11.4 point 4, `SPEC.md:1002`/`:1035`):
      for every derivable pair, generated-state tests assert the commuting diagram
      `patch(clientShape(s), i) ≡ clientShape(apply(effect, s, i))`.
      - Run over the pinned Drizzle Postgres subset against the pglite harness
        (`packages/test/src/pglite.ts`) so `apply(effect, …)` uses real Postgres semantics.
      - Generated alongside derived transforms as the commuting-diagram suite (`SPEC.md:1035`);
        wire it into `pnpm run acceptance`.
      - Done when the suite covers every commerce derived pair and the grammar-coverage matrix, fails
        loudly on a deliberately-broken derivation, and is green in acceptance.

## Phase 7 — Commerce migration (delete & let derivation take over)

- [ ] Delete hand-written transforms in `examples/commerce/src/app.ts` (e.g. the `addToCart`
      `transforms` block, `app.ts:434`) for every pair derivation covers; regenerate
      `generated/optimistic/*.ts` and refresh `generated/touch-graph.ts`.
      - Hand-written transforms survive **only** for out-of-grammar punts (the sanctioned override);
        `'await-fragment'` declarations stay where 1-RTT latency is explicitly accepted.
      - Verify the migration is behavior-preserving via the Phase 6 commuting suite + existing
        commerce app tests (`examples/commerce/src/app.test.ts`).
      - Done when commerce reaches **full shape-grammar coverage**: every (mutation × invalidated-
        query) pair is `derived`, hand-written-override (out-of-grammar punt), or `'await-fragment'`,
        with **zero unhandled FW310** and every punt naming its reason in `fw explain --optimistic`.

## Phase 8 — Conformance & acceptance

- [ ] Prove the derivation subset against real `drizzle-orm` Postgres surfaces in
      `conformance/drizzle-pin`, and gate API drift loudly (§14 "Drizzle coupling, managed").
- [ ] Raw-SQL / FW406 sites are excluded from derivation by construction and must punt with a named
      reason (not silently skip).
- [ ] Rerun full `pnpm run acceptance` (EXIT=0) and the focused package suites for compiler,
      drizzle, runtime, core, cli, and test.

## Acceptance (plan closes when all hold)

- [ ] Stages 1–3 implemented; every in-grammar pair derives, every out-of-grammar pair is a named
      punt matching the §10.5 PUNT list.
- [ ] `generated/optimistic/*.ts` emitted, committed, typecheck against `OptimisticFor`, override
      precedence proven.
- [ ] Derived transforms run through the unchanged `OptimisticRebaser` with proven parity to the
      hand-written path.
- [ ] `fw check optimistic` / `fw explain --optimistic` report `derived ✓` and named `PUNTED`
      derivation reasons without treating punts as coverage; FW310 semantics updated; MCP parity.
- [ ] Commuting-diagram property suite green in acceptance over the pinned Postgres subset.
- [ ] Commerce migrated to derivation with full shape-grammar coverage and zero unhandled FW310.
- [ ] `conformance/drizzle-pin` proves the subset; `pnpm run acceptance` EXIT=0.

## Verification Rules

- For deriver/shape/codegen changes (compiler, drizzle, core): run the focused package tests plus
  `pnpm run check`; add formatting-resistant fixtures, not source-snapshot brittleness.
- For runtime/explain changes: run runtime + cli + test package suites, including the browser suite
  for the end-to-end derived-transform path.
- Soundness changes must run the commuting-diagram property suite against the pglite harness.
- Before closing this plan, rerun `pnpm run acceptance` and confirm zero unhandled FW310 in commerce
  via `fw check optimistic`.

## Risks

- **Derived-optimism wrong predictions** (`SPEC.md:1086`): mitigated by all-or-nothing per-field
  derivation, property-tested soundness (commuting diagrams), and loud named punts.
- **v1 IR insufficiency**: if a derivation construct cannot ride the v1 transform IR, fix it at the
  shared IR seam (Phase 4 finding), never with a derived-only fork — a fork would break the
  "delete hand-written ⇒ derivation takes over" contract.
- **Drizzle API drift** breaking Stage-1 extraction: pinned conformance suite fails loudly; the
  declared-`touches` floor and hand-written override always remain available.
- **Snapshot brittleness** in explain/check fixtures as status grows: keep output snapshot-stable and
  assert algebraic class / status, not incidental formatting.
