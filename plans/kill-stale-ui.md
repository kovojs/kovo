# Plan: Kill stale UI — close the gaps in "stale UIs are a build error"

Created 2026-06-18. Behavioral source of truth is `SPEC.md` (§4.8/§4.9 update
coverage, §10 data plane, §11 static analysis). Policy: `rules/data-layer-policy.md`.
Roadmap alignment: `plans/data-layer-roadmap.md` (T1-RUNTIME here is the v1.5
verification layer; cross-session liveness stays a v2 roadmap item, out of scope
for this plan — see "Why").

## Why

Kovo's headline promise — _stale UIs are a build error_ — is **narrower than the
slogan, and currently false even inside its own scope**. The static graph
(`write() → domain → invalidated queries §11.1 → DOM positions KV310/KV311`)
only covers staleness whose cause is **(a) this deploy's own `write()`, (b) in
statically-analyzable Drizzle, (c) observed by this client, in this document.**
SPEC.md:387 claims the coverage holds _"unconditionally"_; this plan makes that
word true (or scopes it honestly where it cannot be).

This ledger covers the Tier 0/1/2 gaps from the 2026-06-18 stale-UI audit. Two
audit items are deliberately **out of scope** here: cross-session / multi-user
freshness (the focus-refetch + BroadcastChannel floor already ships in v1; true
liveness — `<kovo-live>` SSE + bus + CDC — is a v2 roadmap item in
`plans/data-layer-roadmap.md`, deferred 2026-06-18), and Tier 3 deploy-skew
framing (already loud-recoverable via the render-plan token, §9.1.1).

## Cross-cutting levers (referenced by the items below)

- **X1 — always-on runtime change-record cross-check.** Promote the opt-in test
  verifier to dev-server middleware + `kovo check --instrument` CI gate: parse
  every executed statement, diff observed `tables→domains` against the committed
  touch graph, fail on `observed ⊄ static ∪ KV406-annotated`. = the v1.5 roadmap
  line. Backstops T0, T1-ENGINE, T2-KEYS, and every manual-assertion seam.
- **X2 — schema/DDL as static truth.** Extend the extractor from TS-program-only
  to TS-program + schema: derive FK-cascade edges and `pgView` read-sets with
  zero annotation ("the schema _is_ the registry").
- **X3 — uniform "declare-the-blind-spot" annotation family** (KV406-shaped):
  `fans:`, `view:`, `volatile:`. ERROR-to-omit at a _detected_ blind spot,
  notice elsewhere, runtime-verified by X1, never the primary path.
- **X4 — clock as a first-class input.** One coverage check (KV312) + one shared
  coalesced tick-bus closes the whole temporal cluster. Two surfaces: client time
  is a component input (`clocks: { name: spec }` → `now.<name>`); server-value
  freshness is a per-query modifier (`query.refresh({…})`).
- **X5 — cross-altitude static joins.** Wire KV311 against KV310, the touch
  graph, and the §10.5 punt list — all facts the compiler already emits.

## Proposed diagnostics

| Code  | Severity | Meaning                                                                         |
| ----- | -------- | ------------------------------------------------------------------------------- |
| TBD   | error    | Proven Drizzle write in a write() body yielded zero touches and zero unresolved |
| KV312 | error    | Position reads a clock builtin / time-volatile value with no declared cadence   |
| KV315 | warn     | Untracked clock read (`Date.now()`/`new Date()`); use a declared `clocks` input |
| KV412 | error    | Query reads an unmodeled relation (view / materialized view) with no domain     |
| KV413 | error    | Write reaches a declared trigger/cascade fan-out that must union extra domains  |
| KV314 | error    | `renderOnce`/'never' position reads a query a modeled write invalidates         |

(Final code numbers TBD against the §11.3 registry; placeholders here.)

---

## Tier 0 — the promise is literally false in its dead-center case

- [x] **T0-CLOSURE — closure-nested writes silently drop invalidation.**
      A Drizzle write reachable only through an array-method / `Promise.all`
      closure contributes **zero touches and zero KV406**, so a query reading
      that domain is never invalidated — green build, green test, silent stale
      UI. Falsifies SPEC.md:387 for the most idiomatic bulk-write pattern.
  - Confirmed gap (this session, by direct read + running the extractor →
    `graph = {}`): the gate `isTouchBodyNode` (`packages/drizzle/src/static.ts:1665-1675`)
    returns `false` for any write whose first function-like ancestor is not a
    `transaction()` callback (`isInlineTransactionCallback`, `static.ts:1685-1691`).
    All body extractors share the gate via `touchBodyCallExpressions`
    (`static.ts:1653-1655`), so the call falls out of touches **and** every
    unresolved/KV406 surface at once. Drops `Promise.all(items.map(...))`,
    `forEach`, a per-row helper called inside `.map`, and
    `db.transaction(tx => Promise.all(items.map(...)))`. A **passing test
    encodes the silent behavior**: `packages/drizzle/src/index.write-callbacks-carriers.test.ts:271-284`.
  - [x] Widen `isTouchBodyNode` to DESCEND through a closed allowlist of
        loop/promise combinators (`map`/`forEach`/`reduce`/`flatMap`/`filter`,
        `Promise.all`/`allSettled` over a `.map`), composing per-ancestor
        (continue, not early-return) so transaction + iteration nesting works;
        fold touches through the existing tx receiver-alias proof.
    - Evidence 2026-06-19: `packages/drizzle/src/static.ts` now continues through
      inline transaction callbacks plus the closed iteration callback allowlist;
      the Drizzle carrier test passed and covers `Promise.all(...map)`,
      `forEach`, transaction + nested map, and local helper-in-map touches.

  - [x] For any UNRECOGNIZED closure containing a proven-db write, route into the
        unresolved path → loud **KV406** ("write inside opaque callback — confirm
        touches"), never a silent drop.
    - Evidence 2026-06-19: the same Drizzle test asserts direct writes and a
      local helper carrying `db` inside opaque `withRetry(async () => …)`
      callbacks produce KV406 unresolved sites instead of disappearing.
  - [x] Add the structural backstop: a write() body whose AST contains a proven
        insert/update/delete (or in-project helper carrying a proven db receiver)
        inside an unrecognized callback produces KV406 unresolved coverage rather
        than `{0 folded summary, 0 touch, 0 unresolved}`. The original KV407
        placeholder conflicts with SPEC.md §11.3, where KV407 already means query
        read-set coverage failure; keep final code assignment for the diagnostic
        registry phase.
    - Evidence 2026-06-19: `extractOpaqueClosureProjectReceiverCallsFromBody`
      scans call expressions outside `isTouchBodyNode` coverage and emits
      unresolved KV406 for proven direct Drizzle writes or helper calls carrying a
      proven receiver.
  - [x] Replace `index.write-callbacks-carriers.test.ts:271-284` so it asserts
        the touch is captured (or KV406 raised) — and add fixtures for all four
        drop shapes above.
    - Evidence 2026-06-19: `packages/conformance-fixtures/src/touch-graph-fixtures.test.ts`
      locks closure-nested writes through the conformance fixture seam; the
      conformance touch-graph test passed.

  - Acceptance: the four shapes each yield a touch or a KV406; fixpoint + render
    gates still green (`SPEC.md` §5.2); a new conformance fixture in
    `packages/conformance-fixtures` locks the captured behavior.

---

## Tier 1 — in-scope, common, largely fixable

- [x] **T1-RUNTIME — the runtime cross-check is unbuilt, so the static extractor
      is the _whole_ guarantee.** KV402 ("write touched an undeclared domain")
      has no static emitter; it fires only from the opt-in test verifier. So a
      wrong manual `touches`, a wrong-domain typo, or an untested conditional
      write branch is silent with green build _and_ green CI.
  - Resolved gap: `plans/data-layer-roadmap.md` now marks the v1.5 verification
    layer complete. The implemented surface is the SPEC.md §11.2/§11.4 pglite
    harness and integration fixture verifier, plus `kovo check` consumption of
    `verificationDiagnostics` / `verificationCoverage` facts. There is no
    standalone `kovo check --instrument` flag in the current command contract.
  - [x] Implement **X1**: wrap framework-owned pglite/integration DB handles and
        emit observed operations that cross-check the static touch/read graph.
    - Evidence 2026-06-19: `packages/test/src/verifier.ts` wraps table, Drizzle,
      and SQL seams; `packages/test/src/integration/fixture-instance.ts` captures
      request operations and verifies mutation/query endpoints against the scoped
      graph.
  - [x] Fail loud on `observed ⊄ static ∪ KV406-annotated` (KV402 as the §11.2
        CI failure); keep KV405 at SPEC §11.3 warn severity while blocking
        unobserved verifier coverage through `ERROR VERIFY`.
    - Evidence 2026-06-19: focused unit/conformance run passed
      `packages/test/src/verifier.test.ts`,
      `packages/test/src/mutation-verifier.test.ts`,
      `packages/test/src/query-verifier.test.ts`,
      `packages/test/src/harness-verifier.test.ts`,
      `packages/cli/src/index.kovo-check.test.ts`, and
      `packages/conformance-fixtures/src/verification-fixtures.test.ts` (102
      tests).
  - [x] Reconcile declared KV406 `touches:[…]` against parsed observed statements
        at raw-SQL and opaque seams that execute under the verifier.
    - Evidence 2026-06-19: the same verifier suite covers scoped KV406 domains,
      raw SQL writes outside coverage failing KV402, row-key KV408, read-set
      KV407/KV411, and KV410 output-shape verification.
  - Acceptance: focused integration run passed
    `specs/touch-graph-runtime-crosscheck.spec.ts` and
    `specs/query-readset-runtime-crosscheck.spec.ts` (4 browser tests), proving
    wrong-domain mutation writes fail loud with KV402 and undeclared query reads
    fail loud with KV407 on the request path.

- [ ] **T1-ENGINE — DB-engine side-effects invisible to the AST.** Triggers,
      `ON DELETE CASCADE`, generated columns, and `pgView`/`pgMaterializedView`
      reads change data behind a modeled write; the touch/read graph never
      connects them. Trigger denormalization and cascade ghost rows are
      true-silent-stale; a view read resolves to `reads:[]` (no edge at all).
  - Gap (per audit; verify against `static.ts` table-resolution + `§10.1`/`§10.2`):
    `§11.1` resolves `pgTable` identifiers only; `pgView`/`pgMaterializedView`
    resolve to empty read sets; FK/trigger effects are engine-side.
  - [ ] **X2 static derive (zero annotation):** parse `references()/onDelete`
        into a cascade graph — a `delete(parent)`/key-update auto-unions
        cascade/set-null child domains into the touch set; run the existing query
        extractor over `pgView('n').as((qb)=>…)` to derive view read-sets. - Partial evidence 2026-06-19: `pnpm --filter @kovojs/drizzle exec vitest --run src/index.writes-receivers.test.ts`
        covers project-mode `references(() => products.id, { onDelete:
"cascade", onUpdate: "set null" })`; parent `delete(products)` and
        `update(products)` now also touch the child `cart` domain. View read-set
        derivation remains open.
  - [ ] **X3 declared seam:** `kovo({ fans:[{ via, domain, when }] })` for opaque
        PL/pgSQL triggers (**KV413** if a detected trigger source lacks it);
        `kovo({ view:{ of, refresh } })` for matviews — async-`REFRESH` matviews
        force optimistic status `await-fragment`.
  - [x] **KV412** build error when a query's resolved `.from()`/join target is a
        view/matview with no derived or declared domain.
    - Evidence 2026-06-19: `packages/drizzle/src/static.ts` detects
      `pgView(...).as(...)` and `pgMaterializedView(...).as(...)` query reads as
      unmodeled relations, `packages/core/src/diagnostics.ts` registers KV412,
      and `SPEC.md` §11.3 lists the diagnostic. Focused tests passed:
      Drizzle query-shapes, core diagnostics, CLI kovo-check, and `tsc --noEmit`.
  - [ ] Backstop all of the above with **X1** (observed per-table affected-row
        deltas after COMMIT vs the static graph).
  - Acceptance: cascade/trigger/view fixtures each produce the correct
    invalidation edge or a teaching KV412/KV413; matview read forces
    `await-fragment`.

- [ ] **T1-RENDERONCE — suppression hatches silence KV311 on positions a modeled
      write actually invalidates.** `renderOnce` is the path-of-least-resistance
      KV311 silencer and §4.9's fix menu lures authors to it; declaring it on a
      mutated query path leaves the position permanently un-updatable. Sibling
      leaks: `disableServerRefresh` over a PUNTed position, an `isomorphic` render
      reading a module global, an `await-fragment` whose guard the actor's own
      mutation revokes.
  - [x] **X5 / KV314:** a `renderOnce`/'never' position may not read a query path
        in the union of any modeled write's invalidation set (intersect
        `UpdateCoverageFact.query` × touch-graph invalidation sets, §4.9 × §11.1);
        hard error naming the conflicting mutation(s).
    - Evidence: `pnpm exec vitest --run packages/cli/src/index.kovo-check.test.ts packages/core/src/diagnostics.test.ts` covers `kovo check coverage` emitting `ERROR KV314` for a `renderOnce` query path invalidated by modeled mutation/touch domains and allowing non-overlapping modeled writes.
  - [x] Extend the render-input ⊆ (queries ∪ stamped props ∪ state) check
        (currently gated on fragment targets) to `isomorphic` islands.
    - Evidence 2026-06-19: `pnpm exec vitest --run packages/compiler/src/fragment-targets.test.ts`
      covers isomorphic islands accepting declared query/prop/state/static render
      inputs and emitting KV303 for undeclared render inputs or non-static module
      globals.
  - [x] A PUNTed/Opaque position under `disableServerRefresh:true` must carry its
        own non-fragment status — do not let a same-path sibling's `plan` coverage
        satisfy it (use the §10.5 punt list, already named in
        `kovo explain --optimistic`).
    - Evidence 2026-06-19: `pnpm exec vitest --run packages/compiler/src/query-coverage.test.ts packages/compiler/src/state-bindings.test.ts`
      covers a `disableServerRefresh:true` component where `data-bind` plan
      coverage for `cart.count` no longer hides a same-path class expression;
      the unstamped position emits `UNHANDLED` coverage and KV311.
  - [x] Make "guard rerun produced no server truth for an await-fragment
        position" a visible dev/CI diagnostic (reuse the §10.4 missing-server-truth
        channel).
    - Evidence 2026-06-19: `pnpm exec vitest --run packages/browser/src/mutation-optimistic-failure.test.ts`
      covers an `await-fragment` optimistic position reporting missing server
      truth through the existing optimistic diagnostic channel, while legitimate
      await-fragment truth passes.
  - Acceptance: each hatch fixture that hides a live position fails the relevant
    check; legitimate uses (genuinely immutable / force-off) still pass.

---

## Tier 2 — the boundary the slogan quietly narrows

- [ ] **T2-TEMPORAL — wall-clock staleness ("time is not an input").** Relative
      timestamps, countdowns, "open now", "expires in N days" decay with the
      clock with no row change and no mutation, so the graph never fires. A
      `now`-reading derive lowers to `plan`, is considered covered, and freezes
      forever; the client-now case is truly silent and refetch cannot help it.

  Authoring surface (proposed). Two non-overlapping surfaces — client time is a
  component-level input; server-value freshness is a per-query modifier. Clocks
  are **always named** (no single form, so cadence keys never collide with clock
  names) and `now` is **always** an object keyed by clock name:

  ```tsx
  // Client clock — injected as now.<name>, never a bare scalar.
  export const MessageRow = component({
    queries: { messages: messagesQuery },
    clocks: { ago: { every: '30s' } },          // map of name → spec
    render: ({ messages, now }) =>
      <time>{relativeTime(now.ago, messages.createdAt)}</time>,
  });

  // Deadlines live inside the named spec (until/at unambiguous — only valid there):
  clocks: { count: { every: '1s', until: ({ auction }) => auction.endsAt } }
  clocks: { gate:  { at: ({ sub }) => sub.trialEndsAt } }   // one-shot at the instant
  clocks: { pub:   { renderOnce: true } }                  // inject once, never tick

  // Server-value freshness — co-located on the query, chains with .args();
  // the at/until deadline fn receives the query's OWN value:
  queries: {
    business: businessQuery.refresh({ every: '5m' }),
    sub:      subscriptionQuery.refresh({ at: (sub) => sub.trialEndsAt }),
  }
  ```

  - [ ] **X4 / KV312 — clock as a tracked input.** Extend the §4.9 classifier
        (`packages/core` graph): a clock builtin is a synthetic input. A position
        reading `now.<name>` must resolve to a declared `clocks` entry, and a
        position reading a `volatile:'time'` query field must have a `.refresh({…})`
        on its binding — else KV312. `clocks` is always a `name → spec` map;
        `now` is always an object keyed by clock name.
  - [ ] Co-locate freshness on the query: a `.refresh({ every | at | until })`
        binding modifier parallel to `.args()` (returns a per-use binding, so the
        shared query object is untouched); `at`/`until` receive the query's value.
  - [ ] Ship one shared coalesced rAF/interval tick-bus (mirroring the §4.7
        shared IntersectionObserver) driving every `clocks` derive on the page;
        lint-gated and budget-printed in `kovo explain` (clock inputs + cadences).
  - [ ] Extend KV410 with the `volatile:'time'` output facet for raw-SQL `now()`
        projections (`req.now`); extend the §11.1/§10.2 read-set deriver to flag
        time-predicate WHEREs (`expiresAt > req.now`) as time-volatile rowsets.
  - [x] **KV315 (warn):** a raw `Date.now()`/`new Date()` read in a derive is an
        untracked clock; teaching message redirects to a declared `clocks` input.
    - Evidence 2026-06-19: `packages/compiler/src/scan/parse.ts` emits typed
      temporal-read facts for `Date.now()` / zero-arg `new Date()` and
      `packages/compiler/src/validate/temporal.ts` emits warning KV315 for those
      facts in exported `derive()` bodies; focused tests passed
      `packages/compiler/src/scan/parse.test.ts`,
      `packages/compiler/src/query-coverage.test.ts`, and
      `packages/core/src/diagnostics.test.ts`.
  - Acceptance: relative-timestamp / countdown / `isOpen` fixtures each raise
    KV312 absent a cadence; `clocks: { … }` (client) or `.refresh({ … })` (server)
    clears it; `renderOnce` is an accepted, recorded suppression.

- [x] **T2-KEYS — cross-table key collision under a shared domain.** Two
      row-key-annotated tables in one domain + a mutation that writes only one →
      the other's query instances are silently skipped (under-invalidation),
      violating "any write to D invalidates any query reading D."
  - Resolved gap: keyed routing no longer treats source-less row keys as
    comparable across every same-domain query instance. Server change records can
    carry optional source-table identity (`via`) for `domain:via:key` precision;
    when `via` is absent or differs, same-domain keyed instances over-invalidate
    instead of silently skipping, preserving SPEC.md §10.1's domain currency.
  - [x] Thread source-table identity into routing (`domain:via:key`) and over-invalidate
        same-domain instances when source-table identity is missing or differs.
    - Evidence: `packages/server/src/change-record.ts` carries optional `via`
      through inferred touch records; `changeRecordTouchesQueryInstance` preserves
      same-table row narrowing and over-invalidates cross-table/legacy same-domain
      keys per SPEC.md §10.1.
  - [x] Add the missing fixture coverage: two keyed tables sharing a domain,
        mutation writes one, assert the other's instance still invalidates.
    - Evidence: `packages/server/src/change-record.test.ts` covers
      table-scoped routing plus fragment rendering for same-domain cross-table
      invalidation; focused run `pnpm exec vitest --run packages/server/src/change-record.test.ts packages/server/src/mutation.test.ts packages/server/src/mutation-endpoint.test.ts` passed (36 tests).
  - Acceptance: focused server fixture is green; source-less same-domain keyed
    changes now over-invalidate instead of silently skipping, preserving the safe
    whole-domain fallback.

> **Out of scope — cross-session / multi-user freshness (deferred 2026-06-18).**
> User A's write refreshing only A's tab is a real gap, but the v1 floor already
> ships the cheap rungs (refetch-on-focus §9.3 + BroadcastChannel tab sync), and
> the real fix (`<kovo-live>` SSE + in-process/Redis bus + CDC source, with
> guard-recheck-per-push and reconnect/version-token refetch) is a stateful v2
> tier that breaks the v1 stateless-server guarantee by design. Tracked in
> `plans/data-layer-roadmap.md`; not pursued here.

---

## Deferred SPEC changes (land only after this plan is approved)

- [ ] Scope SPEC.md:387 and §1.1/§4.9: the promise covers staleness from _this
      client's own, statically-analyzable, modeled writes_; the raw-SQL, DB-engine,
      and wall-clock gaps become **declared, checked, suppressible-in-source**
      decisions (not silent defaults), and **cross-session freshness is named as an
      explicit out-of-guarantee boundary** whose remedy is the v2 live tier
      (`plans/data-layer-roadmap.md`). Honest restatement to adopt: _"Kovo turns
      stale UI from your own modeled writes into a build error — and turns every
      freshness gap it can't statically prove (raw-SQL seams, DB triggers, the
      wall clock) from a silent surprise into a declared, checked,
      suppressible-in-source decision; cross-session liveness is an opt-in v2 tier,
      not a v1 promise."_
- [ ] Register the new diagnostics (KV407/KV312/KV315/KV412/KV413/KV314) in the
      §11.3 table and `packages/core` diagnostic definitions with teaching
      messages + fix menus (per `SPEC.md` §5.2 rule 5).

## Sequencing

1. **T0-CLOSURE** — soundness bug; the slogan is false until it lands. Pure
   static; no SPEC change.
2. **X1 / T1-RUNTIME** — the backstop that makes every declared seam loud;
   unlocks the most leverage per unit work.
3. **Static fixes that need no runtime:** T1-RENDERONCE (X5), T2-KEYS — cheap
   joins/comparisons over facts already emitted.
4. **T1-ENGINE** (X2 derive first, then X3 declared seams) and **T2-TEMPORAL**
   (X4).
5. **SPEC scoping + diagnostic registration** — narrow SPEC.md:387/§1.1/§4.9 to
   the honest restatement and register the new KV codes; name cross-session as the
   explicit v2 boundary (no remedy in this plan).

## Latest verification

- T0-CLOSURE: read `static.ts:1665-1691` + ran the extractor on the four shapes
  (`graph = {}`); silent behavior locked by `index.write-callbacks-carriers.test.ts:271-284`.
- T1-RUNTIME: focused verifier/conformance run passed 102 tests; focused
  integration run passed 4 browser tests for mutation write and query read-set
  runtime cross-checks.
- T2-KEYS: `pnpm exec vitest --run packages/server/src/change-record.test.ts packages/server/src/mutation.test.ts packages/server/src/mutation-endpoint.test.ts` passed (36 tests); `pnpm exec tsc --noEmit --pretty false` and `git diff --check` passed.
- Remaining items (T1-ENGINE, T1-RENDERONCE residual hatches, T2-TEMPORAL) are
  validated against `SPEC.md`, not yet against a direct code read — confirm exact
  symbols before implementing each.
