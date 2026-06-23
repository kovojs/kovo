# Advanced Optimistic & Invalidation Analyzer

**Date:** 2026-06-23

**Status:** Draft implementation roadmap.

**Normative anchors:** `SPEC.md` §10.2 query instance keys, §10.4 optimistic updates,
§10.5 derivation algebra, §10.6 exhaustiveness, §11.1 touch-set extraction, §11.2 runtime
verification, and `rules/compiler-hard-rules.md` rule 9.

## Problem

The current analyzer is sound but too shallow for common production patterns. It can parse many
conjunctive `eq(...)` predicates, but values are mostly traceable only to mutation input params.
That means a safe real-world predicate such as:

```ts
where(and(eq(questions.sessionId, request.session.id), eq(questions.id, input.questionId)));
```

is degraded to table-level invalidation and punts derived optimism, even when the table key is
`sessionId,id` and the query is scoped by the same session. The Stack Overflow shared-PGlite demo
hit exactly this case: the runtime behavior is correct, but the static proof cannot yet represent
session-derived scope.

The target is not “derive everything.” The target is a richer proof engine that can classify
real-world predicates precisely, explain why a proof did or did not hold, and preserve the existing
fail-closed posture when it cannot prove safety.

This roadmap is intentionally framework-general. The Stack Overflow shared-db demo is the motivating
fixture, not a special case: any implementation that recognizes only that source shape, helper name,
table name, or file layout is incomplete. Proofs must be expressed through typed provenance, PNF, row
identity, row membership, and private-scope erasure rules that apply equally to session, tenant,
guard-owned, and natural-key applications.

## Design Goals

- [ ] **Represent request/session/guard provenance as first-class symbolic values.**
  - Current gap: `SymbolicValue` handles params/constants/columns/arithmetic, while request-derived
    scope values collapse to opaque. This is the root cause behind the Stack Overflow `sessionId,id`
    table-level notices.
  - Desired proof: `eq(t.sessionId, request.session.id)` is a stable per-request scope predicate,
    not an opaque predicate, and can participate in composite-key coverage.
  - Nullable request/session values are traceable only after a dominating guard proves control cannot
    continue without the value. Accepted exits are `if (!x) throw`, `if (!x) return`, framework
    `fail(...)`, redirect/notFound-style exits, and equivalent typed no-return exits.
  - The guard must dominate the Drizzle predicate/write use. Use before guard, reassignment, mutation,
    alias escape, capture into an opaque callback, or an async helper boundary makes the value
    conditional/opaque for that use.

- [ ] **Normalize predicates into a typed predicate algebra before invalidation or optimism.**
  - The analyzer should lower Drizzle predicates into `and` / `or` / `not` / `eq` / range /
    `inArray` / `isNull` / opaque nodes with table-column identity and symbolic value provenance.
  - Evidence target: no post-parse analyzer decision depends on `getText()` except diagnostic
    rendering, preserving `rules/compiler-hard-rules.md` rule 9.

- [ ] **Prove row identity separately from row membership.**
  - Row identity answers: “does this write address exactly one row under the table key?”
  - Row membership answers: “does this write affect the query's filtered rowset?”
  - This avoids conflating a session/tenant scope predicate with a non-key filter and lets composite
    keys, partial indexes, and filtered lists get precise but conservative behavior.
  - `exact-row` requires every declared row-key column to be covered by traceable equality predicates.
  - `scoped-rowset` proves only private scope such as session/tenant/guard ownership; it is not a
    single-row proof and must not be used to emit a single-row optimistic patch.
  - Membership filters may derive exits only when the transition is decidable from write values plus
    shipped query data; entry remains a named punt unless the full row can be constructed soundly.

- [ ] **Forbid private-scope leakage by construction.**
  - `session(...)`, `tenant(...)`, and `guard(...)` values may participate in server-side proof only.
  - They must never appear in browser-visible query instance keys, `kovo-deps`, `Kovo-Targets`,
    generated optimistic module exports, generated transform inputs, or lowered browser code.
  - Leak checks are required fixtures, not manual review notes.

- [ ] **Keep failures named and useful.**
  - `KV409` should remain a non-blocking table-level degradation notice for valid but imprecise
    predicates.
  - Punts should carry structured reasons such as `untraceable-session`, `disjunctive-row-identity`,
    `partial-key`, `membership-entry`, `range-filter`, or `raw-sql-boundary`, not generic opaque text.

## Proposed Analyzer Architecture

### Layer 1: Symbolic Provenance

- [ ] **Extend `SymbolicValue` with request/session scope.**
  - Add value kinds equivalent to `input(path)`, `session(path)`, `guard(path)`, `const`,
    `column`, `arith`, `sql-placeholder`, and `opaque`.
  - Recognize common lifecycle shapes: `request.session.id`, `req.session.user.id`,
    lifecycle-request aliases, destructuring (`const { id } = request.session`), and guarded
    nullable checks immediately preceding use.
  - Keep absence explicit: nullable session access without a guard remains an analyzable
    conditional only if the code throws/returns before the write.

- [ ] **Track value equality classes within one mutation handler.**
  - If `const sessionId = request.session?.id; if (!sessionId) throw ...`, subsequent
    `sessionId` comparisons should be equivalent to `session.id`.
  - Equality-class promotion requires a dominating guard when the source is nullable. Reassignment,
    mutation, alias escape, capture into an opaque callback, or use before the guard invalidates the
    equality class for the affected use.
  - If `const tenantId = await lookupTenant(request.session.id)`, keep it opaque unless the helper
    has an analyzer summary.

- [ ] **Add summarized pure helper support for provenance.**
  - Summaries should be explicit and typed, not inferred from arbitrary source strings.
  - Same-package helpers are allowed only when they match a declared analyzer summary or a small typed
    summary form maintained by the analyzer. Arbitrary helper source text must not be mined for proof.
  - Initial typed summary scope: helpers that return a property of input/session, simple object
    projectors, and guard combinators such as `owns(...)`.
  - Unsummarized helpers that return tenant/session/request/guard values must produce a named punt or
    table-level degradation such as `unsummarized-helper`, not a guessed proof.

### Layer 2: Predicate Normal Form

- [ ] **Introduce a Predicate Normal Form (PNF) IR.**
  - Shape: conjunctions of column comparisons plus bounded disjunctions where each arm is itself a
    provable key predicate.
  - Preserve table aliases and Drizzle alias resolution.
  - Record every unsupported node as a local opaque child, not as a collapse of the whole predicate
    unless precision would become unsound.
  - Analyzer decisions after parsing must consume typed PNF/provenance facts, never `getText()`,
    source snippets, regexes, or string slicing except for diagnostic rendering
    (`rules/compiler-hard-rules.md` rule 9).
  - Unsupported predicate children should remain local opaque nodes when the surrounding proof stays
    sound. If uncertainty affects row identity or membership, degrade the relevant proof level rather
    than preserving a stronger classification.

- [ ] **Classify predicate proof levels.**
  - `exact-row`: predicates cover every declared row-key column with traceable symbolic values.
  - `scoped-rowset`: predicates prove a tenant/session/owner scope but not a single row.
  - `membership-filter`: predicates affect whether a row appears in a query rowset.
  - `table-level`: valid write/read, but precision is intentionally degraded.
  - `opaque`: unresolved table/value boundary requiring existing KV406-style declaration where
    applicable.

- [ ] **Support composite keys and scoped keys as first-class.**
  - Composite `kovo({ key: 'sessionId,id' })` must be satisfied by an `and()` of both equality
    conjuncts, regardless of conjunct order.
  - A scoped single-row proof should be valid when `sessionId` is session-derived and `id` is
    mutation-input-derived.

### Layer 3: Query Shape & Scope Alignment

- [ ] **Thread query scope predicates into algebraic query shapes.**
  - Query shapes should carry rowset filters with provenance, not just columns.
  - If a query is scoped by `sessionId = request.session.id`, a mutation scoped by the same symbolic
    value can update that query instance precisely.

- [ ] **Differentiate public query args from private scope.**
  - Query instance keys stay client-visible only for declared args (`SPEC.md` §10.2).
  - Private session/tenant scope participates in proof but should not be exposed in browser
    instance keys or `Kovo-Targets`.
  - This is an erasure invariant over all emitted/browser-visible surfaces: query keys, `kovo-deps`,
    `Kovo-Targets`, generated optimistic module exports, generated transform inputs, and lowered
    browser code.

- [ ] **Handle common filtered-list transitions.**
  - `UPDATE status = 'closed' WHERE sessionId = session.id AND id = input.id` against
    `WHERE sessionId = session.id AND status = 'open'` should derive a row removal.
  - Entry into a filtered list still punts unless the written row carries all fields needed to
    construct the row.

### Layer 4: Deriver Integration

- [ ] **Teach the deriver that row-key coverage is over symbolic proof, not raw predicate text.**
  - `match.kind === 'keys'` should include a proof object: covered columns, symbolic values,
    private scope columns, and query-scope compatibility.
  - The current `non-key-match` punt should remain for true non-key matches, not for traceable
    scoped composite keys.

- [ ] **Emit guarded patches for scoped exact-row updates.**
  - For row lists, generated patches should find by the public row key if private scope is already
    guaranteed by the query instance.
  - For shared browser data that includes scope columns, the match may include both scope and id.
  - The generated code must not leak private session values into browser-visible keys.

- [x] **Support bounded disjunctions only when each arm is independently derivable.**
  - Example: `where(or(eq(id, a), eq(id, b)))` may derive as two guarded row updates.
  - Mixed derivable/opaque arms degrade or punt as a whole, with a named reason.
  - Evidence: `pnpm exec vitest --run packages/core/src/derivation.test.ts packages/drizzle/src/derive.test.ts packages/drizzle/src/index.columns-keys-predicates.test.ts packages/drizzle/src/derive-codegen.test.ts` covers typed OR extraction, two-arm guarded row updates, partial composite-key degradation, and named `mixed-disjunction` punts.

## Required Acceptance Fixtures

- [ ] **Stack Overflow shared-db fixture.**
  - Table key: `sessionId,id`.
  - Query scope: `questions.sessionId = request.session.id`.
  - Mutations: `postAnswer` and `voteUp` update `questions` by `sessionId + id`.
  - Expected: no `KV409`, no `non-key-match` punt, and derived or explicitly justified optimistic
    status for `questionList` / `questionScore` where the shape is otherwise derivable.

- [x] **Tenant-scoped SaaS fixture.**
  - Tables keyed by `tenantId,id`; session carries `tenantId`.
  - Mutations update by `tenantId + id`; list queries filter by tenant and secondary status.
  - Expected: exact-row invalidation inside the tenant, no cross-tenant instance key exposure.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts`
    extracts an `openTickets` tenant-scoped rowset from `session.tenantId`, proves
    `closeTicket` by `tenantId + id`, derives a filtered-list exit, asserts no client-visible query
    instance key is created from tenant scope, and verifies generated optimism omits tenant material.

- [x] **Composite natural key fixture.**
  - Table key: `cartId,productId`.
  - Mutation updates quantity by both columns, one from session cart and one from input.
  - Expected: list row update and aggregate count/sum derivation where query ships the needed row
    witness.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts`
    extracts a `cartSummary` rowset keyed by `cartId,productId`, erases private `session.cartId`
    from visible keys, derives `updateQuantity` as a public `productId` row update plus SUM resum,
    and derives `removeLine` as row removal plus COUNT recount and SUM resum from the shipped rows.

- [x] **Filtered membership fixture.**
  - Mutation changes `status`; query filters by `status`.
  - Expected: derivable exit, named punt for entry when the client lacks row fields, and precise
    fragment refresh fallback.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts`
    extracts an `openTasks` filtered rowset, derives `closeTask` as a filtered-list exit, verifies
    `reopenTask` punts with `membership-entry`, and checks the generated fallback plan uses
    `openTasks: 'await-fragment'`.

- [ ] **Helper-summary fixture.**
  - Session/tenant id flows through a same-package helper before the Drizzle predicate.
  - Expected: summary-recognized helper is precise; unsummarized helper gives a named punt or KV409
    without silently dropping invalidation.

- [ ] **Runtime cross-check fixture.**
  - Instrumented PGlite observes scoped writes and reads.
  - Expected: `observed ⊆ static` still holds; no production behavior relies solely on runtime
    observation for an unexercised branch.

- [ ] **Negative proof fixtures.**
  - Unguarded nullable session/request access must be conditional/opaque and cannot prove row identity.
  - Guarded aliases that are later reassigned or mutated must lose the original scope proof.
  - Unsummarized helpers returning a tenant/session id must produce `unsummarized-helper` or an
    equivalent named degradation.
  - Partial composite keys must not classify as `exact-row`.
  - Mixed derivable/opaque disjunctions must degrade or punt as a whole with a named reason.
  - Private-scope leakage in generated keys, targets, optimistic exports, transform inputs, or lowered
    browser code must fail a leak-check fixture.

## Implementation Sequence

- [ ] **Phase 0: Baseline current behavior.**
  - Add red tests for the Stack Overflow `sessionId,id` predicate in `@kovojs/drizzle` static
    extraction, derivation, and `kovo check` output.
  - Evidence when complete: failing tests that currently show `KV409` and `non-key-match` for the
    session-scoped composite key.

- [ ] **Phase 1: Symbolic provenance IR.**
  - Extend core derivation types and Drizzle static extraction to represent session/request-derived
    values.
  - Add alias/destructure/narrowing tests for session values.
  - Add dominance tests for nullable values: accepted exits, use before guard, reassignment, mutation,
    alias escape, and async-helper opacity.
  - [x] Nullable private-scope alias guards enforce dominance for accepted exits and intervening
        alias opacity.
    - Evidence: `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts`
      covers `throw`/`return`/`fail(...)` guard exits, unguarded/use-before-guard aliases,
      reassignment and compound mutation, alias escape, async-helper opacity, declared helper
      summaries, unsummarized-helper degradation, and private-key erasure from touch keys.
  - [x] Direct nullable private-scope member access requires a dominating guard before proof use.
    - Evidence: `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts`
      covers `request.session.id` proving only after `if (!request.session?.id) throw`, while
      unguarded direct access and direct access used before its guard degrade to `non-eq`.
  - Evidence when complete: extractor facts show `session:id` or equivalent structured provenance
    instead of opaque values.

- [ ] **Phase 2: Predicate Normal Form.**
  - Replace ad hoc predicate matching with PNF for write matches and query rowset filters.
  - Preserve existing behavior for simple `eq(id, input.id)` and direct non-eq KV409 cases.
  - Add local opaque-child tests and mixed-disjunction negative tests so row identity/membership
    degrade only at the affected proof level.
  - [x] Write-side predicate matching consumes an internal typed PNF tree for exact conjunctions,
        bounded disjunctions, and local opaque children.
    - Evidence: `pnpm exec vitest --run packages/core/src/derivation.test.ts packages/drizzle/src/derive.test.ts packages/drizzle/src/index.columns-keys-predicates.test.ts packages/drizzle/src/index.query-shapes.test.ts packages/drizzle/src/derive-codegen.test.ts` covers typed PNF write extraction, local opaque-child degradation, mixed-disjunction punts, and partial composite-key `partial-key` punts.
  - Evidence when complete: old predicate tests stay green; new composite/session predicates
    classify as `exact-row`.

- [ ] **Phase 3: Scope alignment between writes and queries.**
  - Carry private query scope through algebraic shapes and compare it against write scope.
  - Ensure private scope never becomes a browser-visible query instance key.
  - Add leak-check fixtures for `kovo-deps`, `Kovo-Targets`, generated optimistic exports,
    transform inputs, and lowered browser code.
  - [x] Optimistic transform codegen preflights patch programs for private-scope leaks.
    - Evidence: `pnpm exec vitest --run packages/drizzle/src/derive.test.ts packages/drizzle/src/derive-codegen.test.ts`
      covers scoped exact-row derivation erasing `sessionId` from lowered browser code and rejects
      `session`, `tenant`, or `guard` values before generated optimistic source is emitted.
  - Evidence when complete: tenant/session fixture proves precise invalidation without target-key
    leakage.

- [ ] **Phase 4: Deriver support for scoped exact-row matches.**
  - Update `deriveOptimistic` and codegen to consume match proof objects.
  - Re-enable derived optimism for scoped row updates where query shape already ships the affected
    data.
  - [x] Extracted session-scoped composite update facts derive a public-key-only row-list transform.
    - Evidence: `pnpm exec vitest --run packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts`
      extracts a session-scoped `questionList` rowset and `voteUp` update from source, derives an
      `update-row` patch matched only by public `id`, and verifies generated optimistic source omits
      private `sessionId` material.
  - Evidence when complete: Stack Overflow `voteUp` can derive `questionList`/`questionScore` when
    query shape permits it, or punts only for a specific non-shape limitation.

- [ ] **Phase 5: Explain and diagnostic polish.**
  - `kovo explain --optimistic` and `kovo check` should print proof levels, private scope, and named
    punts.
  - Update KV409 wording if needed to distinguish “valid table-level fallback” from “untraceable
    value.”
  - Evidence when complete: snapshot tests cover exact-row, scoped-rowset, table-level, and opaque
    outputs.

- [ ] **Phase 6: Property and integration verification.**
  - Expand commuting-diagram property tests over scoped composite keys, filtered rowsets, and
    aggregates.
  - Add HTTP-level integration tests against PGlite for mutation response fragments and optimistic
    reconcile behavior.
  - Evidence when complete: property suite plus focused integration tests pass under the root gate.

## Risks & Guardrails

- [ ] **Do not trade soundness for prettier optimism.**
  - Any proof gap must degrade to table-level invalidation or `await-fragment`, not a guessed patch.

- [ ] **Do not expose private scope in client keys.**
  - Session and tenant predicates are proof inputs; they are not automatically query args.
  - Treat every browser-visible private-scope occurrence as a failing leak, even if the value would be
    redundant with server-side authorization.

- [ ] **Do not weaken KV406.**
  - Interprocedural and raw-SQL opacity still requires explicit declarations and runtime
    verification. This plan broadens what can be proven; it does not make opaque writes acceptable.

- [ ] **Do not introduce source-text heuristics.**
  - The parser may capture spans for diagnostics, but analyzer decisions must be made from typed
    facts and symbols.
  - Helper provenance summaries are typed analyzer inputs; arbitrary helper source-body inference is
    not an acceptable substitute.

## Definition of Done

- [ ] Stack Overflow's shared-db server can keep session-scoped composite predicates without
      `KV409` notices for those exact-row updates.
- [ ] Derived optimism works for at least one scoped composite-key update whose query shape is
      otherwise inside the §10.5 grammar.
- [ ] Punts remain named, stable, and visible in `kovo explain --optimistic`.
- [ ] Runtime cross-checks still enforce `observed ⊆ static ∪ declared`.
- [ ] No private session/tenant key material appears in browser-visible query instance keys,
      `kovo-deps`, `Kovo-Targets`, or generated optimistic module exports.
