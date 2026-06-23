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
guard-owned, and natural-key applications. A patch that only quiets the Stack Overflow fixture,
matches its local helper names, or hard-codes its query/target layout does not satisfy this plan.

## Design Goals

- [x] **Represent request/session/guard provenance as first-class symbolic values.**
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
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts`
    covers session, tenant, and guard provenance, nullable guard dominance, and degradation cases.

- [x] **Normalize predicates into a typed predicate algebra before invalidation or optimism.**
  - The analyzer should lower Drizzle predicates into `and` / `or` / `not` / `eq` / range /
    `inArray` / `isNull` / opaque nodes with table-column identity and symbolic value provenance.
  - Evidence target: no post-parse analyzer decision depends on `getText()` except diagnostic
    rendering, preserving `rules/compiler-hard-rules.md` rule 9.
  - Evidence: `packages/drizzle/src/static.ts` defines `predicatePnf(...)` and `chainMatch(...)`;
    `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts packages/drizzle/src/derive.test.ts packages/drizzle/src/derive-codegen.test.ts`
    covers typed PNF extraction, local opaque degradation, and codegen from typed facts.

- [x] **Prove row identity separately from row membership.**
  - Row identity answers: “does this write address exactly one row under the table key?”
  - Row membership answers: “does this write affect the query's filtered rowset?”
  - This avoids conflating a session/tenant scope predicate with a non-key filter and lets composite
    keys, partial indexes, and filtered lists get precise but conservative behavior.
  - `exact-row` requires every declared row-key column to be covered by traceable equality predicates.
  - `scoped-rowset` proves only private scope such as session/tenant/guard ownership; it is not a
    single-row proof and must not be used to emit a single-row optimistic patch.
  - Membership filters may derive exits only when the transition is decidable from write values plus
    shipped query data; entry remains a named punt unless the full row can be constructed soundly.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts packages/drizzle/src/derive.test.ts packages/core/src/derivation.test.ts`
    covers exact-row scoped updates, scoped-rowset erasure, filtered-list exits, `partial-key`, and
    `membership-entry` degradation.

- [x] **Forbid private-scope leakage by construction.**
  - `session(...)`, `tenant(...)`, and `guard(...)` values may participate in server-side proof only.
  - They must never appear in browser-visible query instance keys, `kovo-deps`, `Kovo-Targets`,
    generated optimistic module exports, generated transform inputs, or lowered browser code.
  - Leak checks are required fixtures, not manual review notes.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts packages/drizzle/src/derive-codegen.test.ts`
    covers private-scope leak checks across query keys, `kovo-deps`, `Kovo-Targets`, exports,
    transform inputs, and lowered browser code.

- [x] **Keep failures named and useful.**
  - `KV409` should remain a non-blocking table-level degradation notice for valid but imprecise
    predicates.
  - Punts should carry structured reasons such as `untraceable-session`, `disjunctive-row-identity`,
    `partial-key`, `membership-entry`, `range-filter`, or `raw-sql-boundary`, not generic opaque text.
  - Evidence: `pnpm exec vitest --run packages/cli/src/index.kovo-explain.test.ts packages/cli/src/index.kovo-check.test.ts packages/drizzle/src/derive.test.ts packages/core/src/derivation.test.ts`
    covers named optimistic proof/punt output and stable reason labels.

## Proposed Analyzer Architecture

### Layer 1: Symbolic Provenance

- [x] **Extend `SymbolicValue` with request/session scope.**
  - Add value kinds equivalent to `input(path)`, `session(path)`, `guard(path)`, `const`,
    `column`, `arith`, `sql-placeholder`, and `opaque`.
  - Recognize common lifecycle shapes: `request.session.id`, `req.session.user.id`,
    lifecycle-request aliases, destructuring (`const { id } = request.session`), and guarded
    nullable checks immediately preceding use.
  - Keep absence explicit: nullable session access without a guard remains an analyzable
    conditional only if the code throws/returns before the write.
  - Evidence: `packages/core/src/derivation.ts` declares `session`, `tenant`, and `guard`
    `SymbolicValue` kinds; `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts`
    covers guarded and unguarded request/session extraction.

- [x] **Track value equality classes within one mutation handler.**
  - If `const sessionId = request.session?.id; if (!sessionId) throw ...`, subsequent
    `sessionId` comparisons should be equivalent to `session.id`.
  - Equality-class promotion requires a dominating guard when the source is nullable. Reassignment,
    mutation, alias escape, capture into an opaque callback, or use before the guard invalidates the
    equality class for the affected use.
  - If `const tenantId = await lookupTenant(request.session.id)`, keep it opaque unless the helper
    has an analyzer summary.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts`
    covers repeated alias uses, server-side Drizzle write payload uses, reassignment, mutation,
    alias escape, and async helper opacity.

- [x] **Add summarized pure helper support for provenance.**
  - Summaries should be explicit and typed, not inferred from arbitrary source strings.
  - Same-package helpers are allowed only when they match a declared analyzer summary or a small typed
    summary form maintained by the analyzer. Arbitrary helper source text must not be mined for proof.
  - Initial typed summary scope: helpers that return a property of input/session, simple object
    projectors, and guard combinators such as `owns(...)`.
  - Unsummarized helpers that return tenant/session/request/guard values must produce a named punt or
    table-level degradation such as `unsummarized-helper`, not a guessed proof.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts`
    covers declared `kovoAnalyzerSummary` provenance and unsummarized-helper degradation.

### Layer 2: Predicate Normal Form

- [x] **Introduce a Predicate Normal Form (PNF) IR.**
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
  - Evidence: `packages/drizzle/src/static.ts` defines `PredicatePnf`, `predicatePnf(...)`, and
    `pnfExactConjuncts(...)`; `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts packages/drizzle/src/derive.test.ts`
    covers PNF conjunction, bounded disjunction, local opaque, and mixed-disjunction behavior.

- [x] **Classify predicate proof levels.**
  - `exact-row`: predicates cover every declared row-key column with traceable symbolic values.
  - `scoped-rowset`: predicates prove a tenant/session/owner scope but not a single row.
  - `membership-filter`: predicates affect whether a row appears in a query rowset.
  - `table-level`: valid write/read, but precision is intentionally degraded.
  - `opaque`: unresolved table/value boundary requiring existing KV406-style declaration where
    applicable.
  - Evidence: `pnpm exec vitest --run packages/cli/src/index.kovo-explain.test.ts packages/cli/src/index.kovo-check.test.ts packages/drizzle/src/derive.test.ts`
    covers `exact-row`, `scoped-rowset`, `table-level`, and `opaque` proof levels.

- [x] **Support composite keys and scoped keys as first-class.**
  - Composite `kovo({ key: 'sessionId,id' })` must be satisfied by an `and()` of both equality
    conjuncts, regardless of conjunct order.
  - A scoped single-row proof should be valid when `sessionId` is session-derived and `id` is
    mutation-input-derived.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts examples/stackoverflow/src/kovo-graph.test.ts`
    covers scoped composite keys for Stack Overflow, tenant, and cart/natural-key fixtures.

### Layer 3: Query Shape & Scope Alignment

- [x] **Thread query scope predicates into algebraic query shapes.**
  - Query shapes should carry rowset filters with provenance, not just columns.
  - If a query is scoped by `sessionId = request.session.id`, a mutation scoped by the same symbolic
    value can update that query instance precisely.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts packages/drizzle/src/derive.test.ts`
    covers session, tenant, and cart scope predicates carried into algebraic rowsets.

- [x] **Differentiate public query args from private scope.**
  - Query instance keys stay client-visible only for declared args (`SPEC.md` §10.2).
  - Private session/tenant scope participates in proof but should not be exposed in browser
    instance keys or `Kovo-Targets`.
  - This is an erasure invariant over all emitted/browser-visible surfaces: query keys, `kovo-deps`,
    `Kovo-Targets`, generated optimistic module exports, generated transform inputs, and lowered
    browser code.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts packages/drizzle/src/derive-codegen.test.ts`
    covers public-key-only transforms and private-scope erasure from browser-visible surfaces.

- [x] **Handle common filtered-list transitions.**
  - `UPDATE status = 'closed' WHERE sessionId = session.id AND id = input.id` against
    `WHERE sessionId = session.id AND status = 'open'` should derive a row removal.
  - Entry into a filtered list still punts unless the written row carries all fields needed to
    construct the row.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts packages/drizzle/src/derive.test.ts`
    covers filtered-list exits and `membership-entry` punts.

### Layer 4: Deriver Integration

- [x] **Teach the deriver that row-key coverage is over symbolic proof, not raw predicate text.**
  - `match.kind === 'keys'` should include a proof object: covered columns, symbolic values,
    private scope columns, and query-scope compatibility.
  - The current `non-key-match` punt should remain for true non-key matches, not for traceable
    scoped composite keys.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts examples/stackoverflow/src/kovo-graph.test.ts packages/drizzle/src/derive.test.ts`
    covers scoped composite `match.kind === 'keys'` extraction and preserves named non-key punts.

- [x] **Emit guarded patches for scoped exact-row updates.**
  - For row lists, generated patches should find by the public row key if private scope is already
    guaranteed by the query instance.
  - For shared browser data that includes scope columns, the match may include both scope and id.
  - The generated code must not leak private session values into browser-visible keys.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts packages/drizzle/src/derive-codegen.test.ts examples/stackoverflow/src/kovo-graph.test.ts`
    covers generated public-key-only scoped exact-row patches and private-scope leak checks.

- [x] **Support bounded disjunctions only when each arm is independently derivable.**
  - Example: `where(or(eq(id, a), eq(id, b)))` may derive as two guarded row updates.
  - Mixed derivable/opaque arms degrade or punt as a whole, with a named reason.
  - Evidence: `pnpm exec vitest --run packages/core/src/derivation.test.ts packages/drizzle/src/derive.test.ts packages/drizzle/src/index.columns-keys-predicates.test.ts packages/drizzle/src/derive-codegen.test.ts` covers typed OR extraction, two-arm guarded row updates, partial composite-key degradation, and named `mixed-disjunction` punts.

## Proof Acceptance Rules

These rules are acceptance requirements for every implementation phase below. They do not narrow the
roadmap to a subset of cases; they define the proof standard required before any case can graduate
from table-level fallback to scoped or exact optimism.

### Nullable private-scope guards

- Nullable request/session/tenant/guard values may participate in row identity or membership proof
  only after a guard proves control cannot continue without the value.
- Accepted guards are limited to dominating exits: `if (!x) throw`, `if (!x) return`, framework
  `fail(...)`, redirect/notFound-style exits, and equivalent typed no-return exits where control
  does not continue in the current handler.
- The guard must dominate the Drizzle predicate or write use it justifies. A later guard cannot prove
  an earlier predicate, write, query-scope comparison, or helper argument.
- Use before guard, reassignment, mutation, alias escape, capture by an opaque callback, or traversal
  through an async helper without a typed analyzer summary makes the value conditional/opaque for the
  affected use.
- Alias promotion is per-use, not global: a previously proved alias loses proof only for uses whose
  dataflow crosses a reassignment, mutation, escape, or opaque boundary.

### Helper provenance summaries

- Helper provenance must come from explicit typed analyzer summaries, not arbitrary helper source
  text. Source snippets may be retained for diagnostics only.
- Same-package helpers are allowed only when they match a declared analyzer summary or a small typed
  summary form owned by the analyzer, such as direct property projection, object projection, or a
  typed guard combinator.
- Unsummarized helpers returning or transforming tenant/session/request/guard values must produce a
  stable named degradation such as `unsummarized-helper:<name>` or `helper-provenance-opaque`; they
  must not be guessed into `exact-row`, `scoped-rowset`, or membership proof.
- A helper summary must declare its input provenance requirements, output provenance kind, nullable
  behavior, and whether it preserves control-flow narrowing.

### Private-scope erasure

- `session(...)`, `tenant(...)`, and `guard(...)` values are server-side proof facts only.
- They must never appear in browser-visible query instance keys, `kovo-deps`, `Kovo-Targets`,
  generated optimistic module exports, generated transform inputs, or lowered browser code.
- Required leak-check fixtures must exercise every browser-visible surface above for session, tenant,
  and guard-derived values. A leak on any one surface fails the acceptance fixture, even when the
  leaked value would be redundant with server authorization.
- Browser patches may use public row keys and shipped row data. They may not receive private scope as
  an argument or bake it into generated names, keys, or match predicates.

### Typed PNF and proof degradation

- After parsing, analyzer decisions must consume typed PNF/provenance facts: table identity, column
  identity, comparison kind, symbolic value kind, alias resolution, proof level, and local opaque
  nodes.
- `getText()`, source snippets, regexes, or string slicing are allowed only for diagnostics and must
  not decide proof level, row identity, membership, or optimistic transform shape.
- Unsupported predicate children should remain local opaque nodes when the surrounding proof is still
  sound. Any uncertainty that affects row identity or row membership must degrade only the relevant
  proof level instead of silently preserving `exact-row` or `membership-filter`.
- Mixed derivable/opaque disjunctions degrade or punt as a whole with a named reason unless every arm
  independently proves the same required row identity or membership transition.

### Row identity versus membership

- `exact-row` requires all declared row-key columns to be covered by traceable equality predicates.
  Private scope can cover a declared key column only as a server-side proof fact and only after the
  erasure checks above.
- `scoped-rowset` proves private scope over a rowset. It is not a single-row proof and cannot be used
  to emit a single-row optimistic patch.
- Membership filters can derive exits only when the transition is decidable from write values and
  shipped query data. Membership entry requires enough write data to construct the entering row;
  otherwise it must degrade to `membership-entry` or another stable named punt.
- Partial composite-key coverage is never `exact-row`, even when the missing key column appears to be
  implied by private scope or a query target name.

## Required Acceptance Fixtures

- [x] **Stack Overflow shared-db fixture.**
  - Table key: `sessionId,id`.
  - Query scope: `questions.sessionId = request.session.id`.
  - Mutations: `postAnswer` and `voteUp` update `questions` by `sessionId + id`.
  - Expected: no `KV409`, no `non-key-match` punt, and derived or explicitly justified optimistic
    status for `questionList` / `questionScore` where the shape is otherwise derivable.
  - Evidence: `pnpm exec vitest --run` on `advanced-analyzer.scoped-pipeline.test.ts` and
    `index.columns-keys-predicates.test.ts` extracts `postAnswer` and `voteUp` as exact
    session-scoped composite-key writes, derives public-key-only transforms for `questionList` and a
    same-row-witness `questionScore`, rejects `KV409`/`non-key-match`, and verifies generated
    optimistic source omits private `sessionId` material.

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

- [x] **Helper-summary fixture.**
  - Session/tenant id flows through a same-package helper before the Drizzle predicate.
  - Expected: summary-recognized helper is precise; unsummarized helper gives a named punt or KV409
    without silently dropping invalidation.
  - Helper precision must come from declared typed summaries or the analyzer-owned small summary form;
    same-package source text is not proof input.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts`
    extracts `invoiceList` and `markPaid` through a declared `kovoAnalyzerSummary`, derives a
    public-key-only row update, and verifies unsummarized `hiddenSessionId` degrades to `KV409` plus
    `unsummarized-helper:hiddenSessionId` without dropping invalidation coverage.

- [x] **Runtime cross-check fixture.**
  - Instrumented PGlite observes scoped writes and reads.
  - Expected: `observed ⊆ static` still holds; no production behavior relies solely on runtime
    observation for an unexercised branch.
  - Evidence: `pnpm exec vitest --run packages/test/src/advanced-analyzer-runtime.test.ts`
    extracts a tenant-scoped `tickets` read/write graph, verifies observed PGlite reads and writes
    against those static facts, and reports `KV405` for a declared static branch that runtime did not
    exercise.

- [x] **Negative proof fixtures.**
  - [x] Unguarded nullable session/request access is conditional/opaque and cannot prove row
        identity.
    - Evidence: `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts packages/core/src/derivation.test.ts packages/drizzle/src/derive.test.ts packages/drizzle/src/derive-codegen.test.ts packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts` covers unguarded nullable aliases and direct session access degrading to non-eq/opaque.
  - [x] Guarded aliases that are later reassigned or mutated lose the original scope proof.
    - Evidence: same command covers reassigned and compound-mutated session aliases degrading from
      scoped row identity.
  - [x] Unsummarized helpers returning a tenant/session id produce `unsummarized-helper` or an
        equivalent named degradation.
    - Evidence: same command covers unsummarized private-scope helpers producing
      `unsummarized-helper:*` opaque matches and non-key degradation.
  - [x] Partial composite keys do not classify as `exact-row`.
    - Evidence: same command covers partial composite-key extraction and `partial-key` derivation
      punts.
  - [x] Mixed derivable/opaque disjunctions degrade or punt as a whole with a named reason.
    - Evidence: same command covers mixed OR arms producing named `mixed-disjunction` punts.
  - [x] Private-scope leakage in generated keys, targets, optimistic exports, transform inputs, or
        lowered browser code fails a leak-check fixture.
    - Evidence: same command covers the scoped-pipeline leak fixture for public query keys,
      `kovo-deps`, `Kovo-Targets`, generated optimistic export names, transform inputs, and lowered
      browser code.
  - [x] Guard/request/session/tenant private-scope leakage fails on every browser-visible surface,
        not only Stack Overflow query targets.
    - Evidence: `pnpm exec vitest --run packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts`
      covers session, tenant, and guard scoped leak fixtures for query keys, `kovo-deps`,
      `Kovo-Targets`, generated optimistic export names, transform inputs, and lowered browser code.

## Implementation Sequence

- [x] **Phase 0: Baseline current behavior.**
  - Add red tests for the Stack Overflow `sessionId,id` predicate in `@kovojs/drizzle` static
    extraction, derivation, and `kovo check` output.
  - Evidence: `git show 820bf4bf:examples/stackoverflow/src/kovo-graph.test.ts` preserves the
    original baseline expectation for `KV409` notices on Stack Overflow scoped composite writes;
    current `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts examples/stackoverflow/src/kovo-graph.test.ts`
    proves the replacement regression now expects public-key extraction and `kovo check` `OK`.

- [x] **Phase 1: Symbolic provenance IR.**
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
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts`
    covers extractor facts with structured `session`, `tenant`, and `guard` provenance instead of
    opaque values.

- [x] **Phase 2: Predicate Normal Form.**
  - Replace ad hoc predicate matching with PNF for write matches and query rowset filters.
  - Preserve existing behavior for simple `eq(id, input.id)` and direct non-eq KV409 cases.
  - Add local opaque-child tests and mixed-disjunction negative tests so row identity/membership
    degrade only at the affected proof level.
  - [x] Write-side predicate matching consumes an internal typed PNF tree for exact conjunctions,
        bounded disjunctions, and local opaque children.
    - Evidence: `pnpm exec vitest --run packages/core/src/derivation.test.ts packages/drizzle/src/derive.test.ts packages/drizzle/src/index.columns-keys-predicates.test.ts packages/drizzle/src/index.query-shapes.test.ts packages/drizzle/src/derive-codegen.test.ts` covers typed PNF write extraction, local opaque-child degradation, mixed-disjunction punts, and partial composite-key `partial-key` punts.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts packages/drizzle/src/derive.test.ts packages/drizzle/src/derive-codegen.test.ts packages/core/src/derivation.test.ts`
    keeps old predicate tests green and classifies scoped composite/session predicates as exact-row
    where all key columns are covered.

- [x] **Phase 3: Scope alignment between writes and queries.**
  - Carry private query scope through algebraic shapes and compare it against write scope.
  - Ensure private scope never becomes a browser-visible query instance key.
  - Add leak-check fixtures for `kovo-deps`, `Kovo-Targets`, generated optimistic exports,
    transform inputs, and lowered browser code.
  - [x] Optimistic transform codegen preflights patch programs for private-scope leaks.
    - Evidence: `pnpm exec vitest --run packages/drizzle/src/derive.test.ts packages/drizzle/src/derive-codegen.test.ts`
      covers scoped exact-row derivation erasing `sessionId` from lowered browser code and rejects
      `session`, `tenant`, or `guard` values before generated optimistic source is emitted.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts packages/drizzle/src/derive-codegen.test.ts`
    covers tenant/session/guard precise invalidation and private-scope erasure without target-key
    leakage.

- [x] **Phase 4: Deriver support for scoped exact-row matches.**
  - Update `deriveOptimistic` and codegen to consume match proof objects.
  - Re-enable derived optimism for scoped row updates where query shape already ships the affected
    data.
  - [x] Extracted session-scoped composite update facts derive a public-key-only row-list transform.
    - Evidence: `pnpm exec vitest --run packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts`
      extracts a session-scoped `questionList` rowset and `voteUp` update from source, derives an
      `update-row` patch matched only by public `id`, and verifies generated optimistic source omits
      private `sessionId` material.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts examples/stackoverflow/src/kovo-graph.test.ts`
    covers the real Stack Overflow `voteUp` and `postAnswer` guarded-session insert-then-update
    pattern extracting public keys instead of `KV409`, and `node examples/stackoverflow/scripts/emit-graph.mjs --check`
    verifies generated `voteUp` optimism derives `questionList` and `questionScore`.

- [x] **Phase 5: Explain and diagnostic polish.**
  - `kovo explain --optimistic` and `kovo check` should print proof levels, private scope, and named
    punts.
  - Update KV409 wording if needed to distinguish “valid table-level fallback” from “untraceable
    value.”
  - [x] `kovo explain --optimistic` renders typed derivation proof levels and private scope from
        optimistic facts.
    - Evidence: `pnpm exec vitest --run packages/cli/src/index.kovo-explain.test.ts packages/cli/src/index.kovo-compile.test.ts packages/core/src/derivation.test.ts` covers `OPTIMISTIC-PROOF` output for `exact-row`, `scoped-rowset`, `table-level`, and `opaque`, plus compile facts emitted with typed proof metadata.
  - [x] `kovo check` renders the same proof levels/private scope without depending on source-text
        snippets.
    - Evidence: `pnpm exec vitest --run packages/cli/src/index.kovo-check.test.ts packages/conformance-fixtures/src/kovo-check-fixtures.test.ts packages/conformance-fixtures/src/package-exports.test.ts` covers `kovo check optimistic` `OPTIMISTIC-PROOF` rows for `exact-row`, `scoped-rowset`, `table-level`, and `opaque`, including private scope and named punt reasons.
  - Evidence: `pnpm exec vitest --run packages/cli/src/index.kovo-explain.test.ts packages/cli/src/index.kovo-check.test.ts packages/conformance-fixtures/src/kovo-check-fixtures.test.ts packages/conformance-fixtures/src/package-exports.test.ts`
    covers exact-row, scoped-rowset, table-level, opaque, private-scope, and named punt output.

- [x] **Phase 6: Property and integration verification.**
  - Expand commuting-diagram property tests over scoped composite keys, filtered rowsets, and
    aggregates.
  - [x] Derived advanced-analyzer patch programs commute with lowered browser transforms over scoped
        composite keys, filtered rowset exits, and aggregate recount/resum cases.
    - Evidence: `pnpm exec vitest --run packages/drizzle/src/derive-codegen.test.ts packages/drizzle/src/derive.test.ts packages/core/src/derivation.test.ts` covers derived scoped `sessionId,id` row updates, tenant filtered-list exits, and scoped natural-key aggregate update/delete programs by comparing lowered codegen output to `applyPatchProgram`.
  - [x] HTTP-level PGlite mutation responses reconcile derived optimism to committed query truth.
    - Evidence: `pnpm exec vitest --run examples/stackoverflow/src/interactive-app.test.ts` covers
      Stack Overflow `voteUp` over shared PGlite by parsing `questionList` and `questionScore`
      response query chunks, comparing them to the expected exact-row optimistic transition and
      committed PGlite vote totals, and asserting private session scope is not shipped in the wire.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts examples/stackoverflow/src/kovo-graph.test.ts examples/stackoverflow/src/interactive-app.test.ts packages/drizzle/src/derive-codegen.test.ts packages/drizzle/src/derive.test.ts packages/core/src/derivation.test.ts`
    passes the scoped predicate, graph, property/codegen, and HTTP integration proof set.

## Risks & Guardrails

- [ ] **Do not trade soundness for prettier optimism.**
  - Any proof gap must degrade to table-level invalidation or `await-fragment`, not a guessed patch.

- [ ] **Do not expose private scope in client keys.**
  - Session, tenant, and guard predicates are proof inputs; they are not automatically query args.
  - Treat every browser-visible private-scope occurrence as a failing leak, even if the value would be
    redundant with server-side authorization.
  - This includes query instance keys, `kovo-deps`, `Kovo-Targets`, generated optimistic module
    exports, generated transform inputs, and lowered browser code.

- [ ] **Do not weaken KV406.**
  - Interprocedural and raw-SQL opacity still requires explicit declarations and runtime
    verification. This plan broadens what can be proven; it does not make opaque writes acceptable.

- [ ] **Do not introduce source-text heuristics.**
  - The parser may capture spans for diagnostics, but analyzer decisions must be made from typed
    facts and symbols.
  - Helper provenance summaries are typed analyzer inputs; arbitrary helper source-body inference is
    not an acceptable substitute.

## Definition of Done

- [x] Stack Overflow's shared-db server can keep session-scoped composite predicates without
      `KV409` notices for those exact-row updates.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts examples/stackoverflow/src/kovo-graph.test.ts`
    verifies Stack Overflow `postAnswer` and `voteUp` scoped composite updates extract
    `arg:questionId`/`arg:targetId` touches and `kovo check` returns `OK`.
- [x] Derived optimism works for at least one scoped composite-key update whose query shape is
      otherwise inside the §10.5 grammar.
  - Evidence: `node examples/stackoverflow/scripts/emit-graph.mjs --check` verifies the real Stack
    Overflow `voteUp` generated optimistic module derives `questionList` and `questionScore` from
    the scoped `sessionId,id` update shape.
- [x] Punts remain named, stable, and visible in `kovo explain --optimistic`.
  - Evidence: `pnpm exec vitest --run packages/cli/src/index.kovo-explain.test.ts packages/cli/src/index.kovo-check.test.ts packages/conformance-fixtures/src/kovo-check-fixtures.test.ts packages/conformance-fixtures/src/package-exports.test.ts`
    covers `OPTIMISTIC-PROOF` rows and named punt reasons in explain/check/conformance outputs.
- [x] Runtime cross-checks still enforce `observed ⊆ static ∪ declared`.
  - Evidence: `pnpm exec vitest --run packages/test/src/advanced-analyzer-runtime.test.ts packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts packages/drizzle/src/derive-codegen.test.ts packages/drizzle/src/derive.test.ts packages/core/src/derivation.test.ts packages/drizzle/src/index.columns-keys-predicates.test.ts`
    includes the PGlite runtime cross-check and static proof suites.
- [x] No private session/tenant/guard key material appears in browser-visible query instance keys,
      `kovo-deps`, `Kovo-Targets`, generated optimistic module exports, generated transform inputs,
      or lowered browser code.
  - Evidence: same command covers scoped-pipeline leak fixtures for query keys, `kovo-deps`,
    `Kovo-Targets`, generated optimistic exports, transform inputs, and lowered browser code.
- [x] Nullable private-scope proofs require a dominating accepted exit guard and degrade on
      reassignment, mutation, alias escape, async-helper opacity, unsummarized helpers, or use before
      guard.
  - Evidence: same command covers nullable guard dominance, use-before-guard, reassignment, mutation,
    alias escape, async-helper opacity, and unsummarized-helper degradation.
- [x] Row identity, scoped rowset, and membership proofs remain separate: partial composite keys and
      scoped-rowset-only proofs cannot emit single-row patches, and membership exits require a
      decidable transition from write values plus shipped query data.
  - Evidence: same command covers partial composite-key `partial-key` punts, scoped-rowset/private
    scope erasure, and filtered membership exit versus `membership-entry` degradation.
