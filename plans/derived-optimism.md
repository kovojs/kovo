# Derived Optimism (v2) Plan

Status: **closing 2026-06-14** — all phases implemented and verified on
`agent/derived-optimism`; `pnpm run acceptance` EXIT=0. Created 2026-06-13.

`SPEC.md` is the normative source of truth. This plan implemented the **derived
optimism** half of the v2 stage (`SPEC.md` §14): compiler-generated optimistic
transforms via the §10.5 derivation algebra, property-tested for soundness, with
named punts — superseding hand-written transforms pair by pair. Live queries
(L4 / SSE) and the CDC adapter remain out of scope (see Non-Goals).

## Architecture (as built)

- **Shared IR contract** (`packages/core/src/derivation.ts`, exported from
  `@kovojs/core`): `SymbolicValue`/`SymbolicEffect` (Stage 1),
  `AlgebraicQueryShape`/`Rowset`/`AlgebraicField` incl. `cursor` (Stage 2),
  `PatchProgram`/`PatchOp` (Stage 3), `DerivationResult`, `PuntReason` +
  `puntReasonLabel`, and a pure reference interpreter `applyPatchProgram`.
- **Source-agnostic deriver** (`@kovojs/drizzle/derive` `deriveOptimistic`): pushes
  effects through a shape → patch program or named punt. The Drizzle extractor and
  the commerce hand-authored facts drive the _same_ rules.
- **Drizzle populators** (`@kovojs/drizzle/static`
  `extractSymbolicEffectsFromProject` / `extractAlgebraicShapesFromProject`):
  project-mode ts-morph, reusing the existing write/predicate/table/column/opaque
  extraction; conservative (anything untraceable ⇒ Opaque/punt).
- **Codegen** (`@kovojs/drizzle/derive` `serializeDerivedOptimistic`/`lowerTransform`):
  PatchProgram → committed `(current,$input)=>Value` transforms in an
  `OptimisticFor`-shaped plan, DO-NOT-EDIT header, override precedence.
- Commerce is not Drizzle-backed (custom `CommerceDb`), so it authors its
  effect/shape facts in `emit-graph.mjs` exactly as it authors the touch graph;
  the Drizzle path is proven by `conformance/drizzle-pin` + the pglite suite.

## Checklist (all verified this session)

- [x] **Phase 0 — IR contract + fixtures.** `core/derivation.ts` + interpreter +
      `@kovojs/test/derivation-fixtures` canonical contract. Evidence:
      `packages/core/src/derivation.test.ts`, `packages/test/src/derivation-fixtures.test.ts`.
- [x] **Phase 1 — Write → symbolic row-effects (Stage 1).** `extractSymbolicEffectsFromProject`
      (Param/Const/ColRef/Arith/Opaque values; eq-key match else Opaque punt; UPSERT).
      Evidence: `conformance/drizzle-pin/src/index.derivation-subset.test.ts` (24 tests),
      `npx vitest --run packages/drizzle` (246).
- [x] **Phase 2 — Effect-through-shape derivation (Stage 2+3).** `extractAlgebraicShapesFromProject`
      (Scalar/COUNT/SUM/AGG/cursor + opaque punts) + `deriveOptimistic` with the full
      §10.5 PUNT list. Evidence: `packages/drizzle/src/derive.test.ts` (positive rules + 8 negative punt surfaces), the conformance subset, contract fixtures.
- [x] **Phase 3 — Codegen `generated/optimistic/*.ts`.** `serializeDerivedOptimistic`
      satisfies `OptimisticFor`, override precedence (hand-written suppresses derived;
      delete ⇒ re-emit). Evidence: `packages/drizzle/src/derive-codegen.test.ts` +
      codegen≡interpreter parity for every contract fixture.
- [x] **Phase 4 — Runtime integration.** Derived transforms ride the unchanged
      `OptimisticRebaser` (snapshot→apply→rebase→settle→discard) with proven parity
      to hand-written; INSERT×AGG placeholder reconcile. No IR fork needed (`tempId`/`now`
      added to `@kovojs/runtime`). Evidence: `packages/runtime/src/optimism-derived.test.ts`.
- [x] **Phase 5 — Diagnostics & explain.** `OptimisticCoverage.status += 'derived'` + separate `derivation` metadata; `kovo explain --optimistic` reports `derived` and
      `OPTIMISTIC-PUNT <q>: <reason>`; summary gains `derived=`/`PUNTED=`; KV310 fires only
      when uncovered (punt ≠ coverage); MCP inherits via kovoCheck/kovoExplain. Evidence:
      `packages/cli/src/index.kovo-explain.test.ts`, `packages/test/src/kovo-explain-fixtures.ts`.
- [x] **Phase 6 — Soundness commuting-diagram suite.** `patch(clientShape(s),i) ≡
clientShape(apply(effect,s,i))` for all 3 commerce derived pairs (real loaders +
      effect) and a Drizzle grammar matrix over **real Postgres (pglite)**; broken-derivation
      guards. Evidence: `examples/commerce/src/derivation-commuting.test.ts`,
      `packages/test/src/derivation-pglite.test.ts`. Runs under `pnpm run test`.
- [x] **Phase 7 — Commerce migration.** Hand-written `addToCartOptimistic` deleted;
      `generated/optimistic/cart-add.ts` emitted + committed (`emit-graph --check` gated).
      Full shape-grammar coverage: all 3 cart/add pairs `derived` (cart INSERT×SUM,
      productGrid UPDATE keyed-scalar guarded, orderHistory INSERT×AGG push), **zero
      unhandled KV310, zero punts**. Evidence: `examples/commerce/src/source-truth.test.ts`,
      `app.add-to-cart.test.ts`, commerce typecheck against `OptimisticFor`.
- [x] **Phase 8 — Conformance & acceptance.** Derivation subset proven against real
      `drizzle-orm` Postgres surfaces in `conformance/drizzle-pin` (raw-SQL/KV406 punt
      with named reason); `pnpm run acceptance` **EXIT=0** (check, test, test:browser,
      check:build, test:p10-perf, test:conformance, check:kovo all green).

## Acceptance (all hold)

- [x] Stages 1–3 implemented; every in-grammar pair derives, every out-of-grammar pair
      is a named punt matching the §10.5 PUNT list.
- [x] `generated/optimistic/*.ts` emitted, committed, typecheck against `OptimisticFor`,
      override precedence proven.
- [x] Derived transforms run through the unchanged `OptimisticRebaser` with proven parity.
- [x] `kovo check optimistic` / `kovo explain --optimistic` report `derived` and named
      `PUNTED` reasons without treating punts as coverage; KV310 semantics updated; MCP parity.
- [x] Commuting-diagram property suite green in acceptance over the pinned Postgres subset.
- [x] Commerce migrated to derivation with full shape-grammar coverage, zero unhandled KV310.
- [x] `conformance/drizzle-pin` proves the subset; `pnpm run acceptance` EXIT=0.

## Non-Goals (unchanged)

- Live queries (L4), `<kovo-live>`, SSE, the in-process/Redis bus; CDC adapter; full
  runtime read/write tracking (v3); SQLite/MySQL derivation. Owned by a future
  `plans/live-queries.md` / CDC plan.

## Notes / caveats

- Two **pre-existing** acceptance-gate failures (orthogonal to derived optimism, present
  on the branch base) were unblocked to reach EXIT=0: a markdown-fixtures §13 heading
  mismatch, and the §5.2 compiler-rule count (7 since the v1-cleanup §5.2 work). See the
  `chore:` + Phase-8 commits.
- `vp check --fix` reformatted a few unrelated `examples/gallery/src/interactive/*.tsx`
  demos (eslint autofixes) early on; left unstaged (a revert was permission-denied) and
  excluded from every derived-optimism commit. `.deepsec/` is security-tool data, also
  untouched/unstaged.

## Risks (mitigated)

- Wrong predictions: all-or-nothing per field, commuting-diagram soundness (commerce +
  pglite), loud named punts. v1 IR sufficiency: confirmed — derived transforms ride the
  unchanged rebaser (Phase 4). Drizzle API drift: pinned conformance fails loudly.
  Snapshot brittleness: facts assert algebraic class/status, not incidental formatting.
