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

## Design Goals

- [ ] **Represent request/session/guard provenance as first-class symbolic values.**
  - Current gap: `SymbolicValue` handles params/constants/columns/arithmetic, while request-derived
    scope values collapse to opaque. This is the root cause behind the Stack Overflow `sessionId,id`
    table-level notices.
  - Desired proof: `eq(t.sessionId, request.session.id)` is a stable per-request scope predicate,
    not an opaque predicate, and can participate in composite-key coverage.

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
  - If `const tenantId = await lookupTenant(request.session.id)`, keep it opaque unless the helper
    has an analyzer summary.

- [ ] **Add summarized pure helper support for provenance.**
  - Summaries should be explicit and typed, not inferred from arbitrary source strings.
  - Initial scope: same-package helpers that return a property of input/session, simple object
    projectors, and guard combinators such as `owns(...)`.

### Layer 2: Predicate Normal Form

- [ ] **Introduce a Predicate Normal Form (PNF) IR.**
  - Shape: conjunctions of column comparisons plus bounded disjunctions where each arm is itself a
    provable key predicate.
  - Preserve table aliases and Drizzle alias resolution.
  - Record every unsupported node as a local opaque child, not as a collapse of the whole predicate
    unless precision would become unsound.

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

- [ ] **Support bounded disjunctions only when each arm is independently derivable.**
  - Example: `where(or(eq(id, a), eq(id, b)))` may derive as two guarded row updates.
  - Mixed derivable/opaque arms degrade or punt as a whole, with a named reason.

## Required Acceptance Fixtures

- [ ] **Stack Overflow shared-db fixture.**
  - Table key: `sessionId,id`.
  - Query scope: `questions.sessionId = request.session.id`.
  - Mutations: `postAnswer` and `voteUp` update `questions` by `sessionId + id`.
  - Expected: no `KV409`, no `non-key-match` punt, and derived or explicitly justified optimistic
    status for `questionList` / `questionScore` where the shape is otherwise derivable.

- [ ] **Tenant-scoped SaaS fixture.**
  - Tables keyed by `tenantId,id`; session carries `tenantId`.
  - Mutations update by `tenantId + id`; list queries filter by tenant and secondary status.
  - Expected: exact-row invalidation inside the tenant, no cross-tenant instance key exposure.

- [ ] **Composite natural key fixture.**
  - Table key: `cartId,productId`.
  - Mutation updates quantity by both columns, one from session cart and one from input.
  - Expected: list row update and aggregate count/sum derivation where query ships the needed row
    witness.

- [ ] **Filtered membership fixture.**
  - Mutation changes `status`; query filters by `status`.
  - Expected: derivable exit, named punt for entry when the client lacks row fields, and precise
    fragment refresh fallback.

- [ ] **Helper-summary fixture.**
  - Session/tenant id flows through a same-package helper before the Drizzle predicate.
  - Expected: summary-recognized helper is precise; unsummarized helper gives a named punt or KV409
    without silently dropping invalidation.

- [ ] **Runtime cross-check fixture.**
  - Instrumented PGlite observes scoped writes and reads.
  - Expected: `observed ⊆ static` still holds; no production behavior relies solely on runtime
    observation for an unexercised branch.

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
  - Evidence when complete: extractor facts show `session:id` or equivalent structured provenance
    instead of opaque values.

- [ ] **Phase 2: Predicate Normal Form.**
  - Replace ad hoc predicate matching with PNF for write matches and query rowset filters.
  - Preserve existing behavior for simple `eq(id, input.id)` and direct non-eq KV409 cases.
  - Evidence when complete: old predicate tests stay green; new composite/session predicates
    classify as `exact-row`.

- [ ] **Phase 3: Scope alignment between writes and queries.**
  - Carry private query scope through algebraic shapes and compare it against write scope.
  - Ensure private scope never becomes a browser-visible query instance key.
  - Evidence when complete: tenant/session fixture proves precise invalidation without target-key
    leakage.

- [ ] **Phase 4: Deriver support for scoped exact-row matches.**
  - Update `deriveOptimistic` and codegen to consume match proof objects.
  - Re-enable derived optimism for scoped row updates where query shape already ships the affected
    data.
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

- [ ] **Do not weaken KV406.**
  - Interprocedural and raw-SQL opacity still requires explicit declarations and runtime
    verification. This plan broadens what can be proven; it does not make opaque writes acceptable.

- [ ] **Do not introduce source-text heuristics.**
  - The parser may capture spans for diagnostics, but analyzer decisions must be made from typed
    facts and symbols.

## Definition of Done

- [ ] Stack Overflow's shared-db server can keep session-scoped composite predicates without
      `KV409` notices for those exact-row updates.
- [ ] Derived optimism works for at least one scoped composite-key update whose query shape is
      otherwise inside the §10.5 grammar.
- [ ] Punts remain named, stable, and visible in `kovo explain --optimistic`.
- [ ] Runtime cross-checks still enforce `observed ⊆ static ∪ declared`.
- [ ] No private session/tenant key material appears in browser-visible query instance keys,
      `kovo-deps`, `Kovo-Targets`, or generated optimistic module exports.
