# Fundamental Hardening & Refactoring 2 — invert fail-open to fail-closed, structurally

Created 2026-07-01. **Self-standing:** every item carries its own root-cause (file:line), the *inversion* it makes,
the in-plan decision, single-commit scope, and a generative acceptance test — no other file needs reading. Source
of truth for behavior is `SPEC.md` (§10.2/§10.3 audited escape, §11.1 type-identity, §11.2 `observed ⊆ declared`).
Fixes the round-6 findings (`plans/claude-bugz-27.md` B1–B4, `plans/claude-papercuts-25.md` P1–P2) that survived
`plans/fundamental-hardening-and-refactor.md`.

## Why this plan exists (the meta-lesson, in one paragraph)

The previous plan marked three "fail closed" items `[x]` — **J.2** (read-only SQL floor), **K.2** (KV426 recognizer),
**L.1** (DEC7 off-wire prover) — but each was implemented as a *denylist extension* ("recognize one more shape"),
not the promised inversion. Round 6 walked straight through them one shape deeper: a `SELECT setval()` write
(bugz-27 B1), four un-resolved KV426 callee shapes (B2), an array-binding secret launder (B3). Two structural
reasons let this pass CI green: (1) the fail-closed-classifier lint (`scripts/check-fail-closed-classifiers.mjs`,
old DEC2) only flagged `switch default:` / `?? permissive`, **never the recognition-skip pattern**
`if (recognized === null) return /*skip=allow*/` — which is the actual shape of all three fail-opens; and (2) the
gates were proved by *enumerated* fixture lists, so patching the reported shape turned them green. This plan makes
fail-closed **structural and self-proving**: classifiers become 3-valued with an unskippable `UNPROVEN` verdict, the
lint is extended to catch recognition-skip (and will *retroactively flag the three offending sites* — that is the
forcing function), and every recognition gate is proved by a **generative** shape fuzzer instead of a fixed list.

## Meta-invariants (nothing is "done" until all hold)

- **N1 — Three-valued classifiers.** Every security classifier returns `{PROVEN_SAFE, PROVEN_UNSAFE, UNPROVEN}` (a
  shared discriminated union), where `UNPROVEN` is a *distinct* value from `PROVEN_SAFE`. "Empty write-set",
  "sink === null", "resolver returned undefined", "could not analyze" all map to `UNPROVEN`, never to `PROVEN_SAFE`.
- **N2 — UNPROVEN is fail-closed at the sink and unskippable.** At every enforcement site, `UNPROVEN` routes to the
  closed action (throw / KV diagnostic), never to the allow/skip action. A lint proves no enforcement site maps
  `UNPROVEN → allow`.
- **N3 — The anti-fail-open lint catches recognition-skip.** The classifier lint flags, in any branded classifier:
  `switch default:` returning non-closed, `?? / || <permissive>`, **and** `if (<recognition> == null/undefined/0 or
  .length === 0) return <allow/skip/empty>` where `<recognition>` is a recognizer/resolver result. Landing this lint
  is Phase 0 and MUST light up the current J.2/K.2/L.1 sites.
- **N4 — Gates are proved generatively, not by a fixed list.** Every recognition/off-wire/read-only gate has a
  metamorphic **generator** that emits *novel* shapes (random callee wrappings, random binding patterns, random SQL
  function calls) and asserts the gate fails closed on all of them. A hardcoded shape list is insufficient evidence.
- **N5 — Runtime twin actually enforces (§11.2).** The SQL read-only floor's twin is execute-and-diff (or a proven-
  pure-function allowlist); the raw-HTML/URL sink's twin is the SSR renderer refusing an unproven brand; the wire's
  twin is `emitToWire` refusing a secret-tagged value. Each static gate has a runtime enforcement that catches what
  static misses; a test deletes the static arm and shows the runtime twin still closes.
- **N6 — Completeness denominators are reachability-derived.** The "must be branded / must have a census row" set is
  computed from call-graph reachability (from the driver-method choke / `emitToWire` / enforcement sinks), not from
  name/file allowlists; a planted-canary sink makes the gate fail.

## Decisions register (made here; no deferral)

- **DEC1 — Shared verdict type.** Add `packages/core/src/internal/classifier-verdict.ts`: `type ClassifierVerdict<T>
  = {kind:'proven-safe'} | {kind:'proven-unsafe', detail:T} | {kind:'unproven', reason:string}`; a helper
  `enforceOrThrow(verdict, closedError)` that throws on `proven-unsafe` **and** `unproven`. Security classifiers
  return this; enforcement sites call `enforceOrThrow`. This makes N1/N2 structural.
- **DEC2 — SQL read-only is an allowlist of proven-read-only, not a denylist of writes.** `writeTablesForStatement`
  is replaced/wrapped by `classifyStatement(sql, dialect): ClassifierVerdict<WriteTargets>`: `proven-safe` ONLY for a
  `SELECT`/`VALUES`/`SHOW`/`WITH`-read whose every function call is in `PROVEN_PURE_SQL_FUNCTIONS` (per-dialect
  curated allowlist of side-effect-free builtins) and that contains no data-modifying node; `proven-unsafe(tables)`
  for a DML/DDL write with resolvable targets; **`unproven`** for any statement with an unknown/volatile function
  call (`setval`, `nextval`, any non-allowlisted or user function), an unresolvable target, a parse ambiguity, or a
  DDL/write with no resolvable table. The read-only floor and the declared-table allowlist both fail closed on
  `unproven` (no more `writeTables.length === 0 → return`).
- **DEC3 — Raw-HTML/URL sink requires PROVEN provenance; unresolved callee ⇒ KV426 at the sink.** The soundness
  choke moves to the sink: a value reaching a `rawHtml`/trusted-URL sink must trace to a `proven-safe` provenance
  (a static literal, or a `trustedHtml`/`trustedUrl` construction whose argument provenance is proven, or the audited
  `reason` escape per SPEC §10.2/§10.3). A `TrustedHtml`/`TrustedUrl`-typed value whose brand-construction the
  compiler cannot fully resolve is `unproven` ⇒ KV426. The callee resolver (`framework-identity.ts`) improvements are
  **ergonomics/defense-in-depth only**, not the proof.
- **DEC4 — DEC7 off-wire prover proves OFF-wire, defaults KV435.** The wire/secret prover proves a returned/emitted
  value is off-wire ONLY for the DEC7 allowlist shapes (plan-1 DEC7: direct non-secret select projection; literal
  whose leaves are non-secret columns/literals/non-secret scalars; `.map` of same). Every other binding/assignment/
  accumulator shape — array/object binding patterns, computed writes, spreads, closures, `reduce`/`flatMap`,
  `Object.*` — is `unproven` ⇒ KV435/KV406, dischargeable only by the provenance-checked `declareOffWire`.
- **DEC5 — Declared-table comparison is schema-qualified.** Compare `schema.name` (unqualified side defaults to the
  connection search-path / `public`); a write to `otherschema.contacts` is not admitted by `tables:['contacts']`.
- **DEC6 — KV310 fragment-dead-transform fires in the real build path.** `staticBuildCheckGraph` computes
  `updateCoverage` (or the consumer walk consults `component.fragments`) so the fragment-only downgrade is reachable
  outside the unit test; the DEFAULT `create-kovo` scaffold is the canary.
- **DEC7 — Census/brand denominators are call-graph reachability.** `check-security-brands` + the census gate derive
  their "must be branded / must have a row" set from reachability from the driver-method choke / `emitToWire` /
  enforcement sinks; a committed canary sink (unbranded, reachable) MUST make the gate fail.
- **DEC8 — Generative fuzzers are first-class CI.** Each inversion ships a seeded deterministic generator (varied by
  index, never `Math.random`) that emits ≥200 novel shapes; the gate must fail closed on 100% of the unsafe class and
  stay green on the proven-safe class. Wire into `check`.

## Scope discipline / anti-goals

- Do NOT fix B1/B2/B3 by adding cases to the existing recognizers and calling it done — that is the exact trap. The
  acceptance for each is the **inversion + a generative fuzzer**, and the N3 lint flagging the old site.
- Fail-closed defaults may raise false positives on un-analyzable-but-legitimate flows; the intended discharge is the
  audited escape (`trustedHtml(x, {reason})` per SPEC §10.2/§10.3; `declareOffWire`; a proven-pure SQL function added
  to the allowlist with review). Tech-preview bias: keep the stronger default, document the escape.
- Compiler items stay AST/fact-string based per `rules/compiler-hard-rules.md`; lowering stays fixpoint-stable.

---

## Phase 0 — The structural substrate (land FIRST; it forces the rest)

- [ ] **0.1 — Shared 3-valued verdict + fail-closed enforcer (DEC1, N1/N2).**
  - Add `packages/core/src/internal/classifier-verdict.ts` with `ClassifierVerdict<T>` and
    `enforceOrThrow(verdict, () => Error)` that throws on BOTH `proven-unsafe` and `unproven`. Unit-test that
    `unproven` throws.
  - Acceptance: importing modules can express "I could not prove safe" as a first-class value distinct from safe.
- [ ] **0.2 — Extend the fail-closed-classifier lint to catch recognition-skip (N3); it MUST flag J.2/K.2/L.1.**
  - `scripts/check-fail-closed-classifiers.mjs` currently flags only `switch default:` / `?? permissive`. Add a rule:
    inside a `securityClassifier`/enforcement-branded function, flag `if (<x> === null | undefined | 0 | <x>.length === 0)
    return <allow/skip/empty/undefined>` where `<x>` is a recognizer/resolver call result — i.e. "unrecognized ⇒
    allow". Add the same for an early `return null`/`return;` reached when a resolver returned nothing.
  - Acceptance: running the extended lint on the CURRENT tree flags exactly the three known sites —
    `packages/server/src/sql-safe-handle.ts:552/568/606` (empty write-set → return),
    `packages/compiler/src/validate/trusted-html-provenance.ts:60-61` (sink === null → skip), and
    `packages/drizzle/src/static/query-shapes.ts` off-wire default — proving the lint would have caught the last
    plan's false-completions. Commit the lint RED against these three (they are fixed in Phase 1). Add a committed
    canary classifier with a recognition-skip that the lint flags (N3 negative test).
- [ ] **0.3 — Enforcement-site UNPROVEN-routing lint (N2).**
  - Add a check that every call site consuming a `ClassifierVerdict` routes `unproven` through `enforceOrThrow` (or an
    explicit closed action), never to the allow branch. Fail on any `if (verdict.kind === 'proven-unsafe')` that lacks
    an `unproven` companion closing branch.
  - Acceptance: a fixture that handles only `proven-unsafe` (dropping `unproven`) fails the lint.

## Phase 1 — The three inversions (each: invert + generative fuzzer + old lint goes green)

- [ ] **B1 — Invert the SQL read-only floor + declared-table allowlist to fail closed on non-proven-read (DEC2, N5).**
  - Root: `packages/server/src/sql-write-allowlist.ts:141-146` returns `[]` for `select/show/union/values`;
    `packages/server/src/sql-safe-handle.ts:552,568,606` treat `writeTables.length === 0` as allowed. So
    `readonlyDb.execute(sql`select setval('seq',N)`)` writes on a green build; a `tables:['contacts']` handle admits
    it too.
  - Fix (single commit): implement `classifyStatement → ClassifierVerdict<WriteTargets>` (DEC2) with a per-dialect
    `PROVEN_PURE_SQL_FUNCTIONS` allowlist; a `SELECT`/`VALUES` containing any non-allowlisted or unknown function call
    is `unproven`. The read-only floor (`assertReadSqlStatement`) and the declared-table allowlist
    (`assertSqlWriteTablesAllowed`) call `enforceOrThrow`, closing on `unproven` (KV433 / KV406). Legitimate DDL still
    runs on the un-managed provider (plan-1 DEC12).
  - Runtime twin (N5): wire the DEC3 execute-and-diff oracle (`packages/server/src/sql-write-oracle.ts`) as a CI cross-
    check whose corpus is GENERATED (DEC8) to include volatile/unknown-function `SELECT`s; a static/oracle mismatch
    fails CI. (Optional stretch: consult the oracle at runtime in dev.)
  - Acceptance: `readonlyDb.execute(sql`select setval('probe',1)`)` throws KV433; `select nextval(...)` throws; a plain
    `select now()`/arithmetic stays green; the generative SQL-function fuzzer (≥200 shapes: known-pure vs unknown/
    volatile wrappers) is 100% closed on the unknown class, green on the pure class; the 0.2 lint no longer flags
    `sql-safe-handle.ts`.
- [ ] **B2 — Move the raw-HTML/URL soundness choke to the sink: unproven brand-provenance ⇒ KV426 (DEC3, N2/N5).**
  - Root: `packages/compiler/src/validate/trusted-html-provenance.ts:130-144` recognizes a trust sink only via the
    resolver / element-access / same-file-wrapper; an unresolved callee returns `null` and the call is SKIPPED at
    `:60-61` (fail-open). Resolver gaps: `packages/core/src/internal/framework-identity.ts:517,534-535,918-919` have
    no arm for spread / array-literal / call / new receivers. Round-6 shipped raw `<script>` via `{...t}.html`,
    `[trustedHtml][0]`, `(()=>trustedHtml)()`, `new R().h`, and the `trustedUrl` family.
  - Fix (single commit): invert to a sink-provenance verdict — a `TrustedHtml`/`TrustedUrl`-typed value reaching a
    `rawHtml`/trusted-URL sink whose brand-construction the compiler cannot trace to a `proven-safe` provenance
    (static literal, or `trustedHtml/trustedUrl` with proven arg-provenance, or the audited `reason` escape) is
    `unproven` ⇒ KV426 via `enforceOrThrow`. The unresolved-callee case is now UNPROVEN, not skipped — independent of
    callee shape.
  - Ergonomics (same commit, defense-in-depth): teach the resolver the spread / array-element / class-field /
    function-return arms so common safe patterns don't need the escape.
  - Runtime twin (N5): the SSR raw-HTML/URL renderer refuses a value not carrying the proven-brand marker (plan-1 K.3
    twin); a test deletes the static gate and shows the renderer still closes.
  - Acceptance: all five round-6 shapes fire KV426 in a real `kovo build`; direct `trustedHtml(literal)` and a
    resolver-traced helper stay green; the generative callee-shape fuzzer (≥200 novel wrappings of a brand over tainted
    args) is 100% closed; the 0.2 lint no longer flags `trusted-html-provenance.ts`.
- [ ] **B3 — Invert the DEC7 off-wire prover: prove off-wire, default KV435 on any un-analyzable binding (DEC4, N2).**
  - Root: `packages/drizzle/src/static/query-shapes.ts:799` `wireElementAliasRoots()` registers a wire alias only when
    `Node.isIdentifier(name)`; an array/object binding pattern (`const [firstItem]=items`) is skipped, so
    `taintedValueReachesWire()` (`:487`) misses a secret write into it. Round-6 laundered `contacts.ssn` to `/_q`.
  - Fix (single commit): the returned/emitted wire value is proven off-wire ONLY for DEC7 shapes; every other binding/
    assignment/accumulator (array/object binding pattern, computed member write, spread, closure capture,
    `reduce`/`flatMap`, `Object.*`) is `unproven` ⇒ KV435/KV406 via `enforceOrThrow`, dischargeable only by
    provenance-checked `declareOffWire`.
  - Acceptance: the array-binding launder + object-pattern + reduce/flatMap variants all fail closed; a legitimate
    non-secret literal/`.map` return stays green (plan-1 DEC10 corpus); the generative binding-shape fuzzer is 100%
    closed on secret-carrying shapes; the 0.2 lint no longer flags the off-wire default.

## Phase 2 — Mechanical fixes (single commit each; decisions already made)

- [ ] **B4 — Schema-qualify the declared-table comparison (DEC5).**
  - Root: `packages/server/src/sql-write-allowlist.ts:333` `tableName()` returns `identifier.name` (drops
    `identifier.schema`); compared bare at `packages/server/src/sql-safe-handle.ts:575-577`. `tables:['contacts']`
    admits `otherschema.contacts`.
  - Fix: compare `schema.name` (unqualified side → search-path/`public`).
  - Acceptance: a mutation `tables:['contacts']` writing `otherschema.contacts` throws KV406; `public.contacts` still
    admitted; test on the pglite dialect.
- [ ] **P1/O.2 — KV310 fragment-dead-transform fires in the real build path (DEC6); re-open O.2.**
  - Root: `packages/cli/src/commands/build-export.ts` `staticBuildCheckGraph` builds the check graph WITHOUT
    `updateCoverage` (persisted `graph.json` has `updateCoverage:null`); `packages/cli/src/graph-explain-format.ts`
    `optimisticClientQueryConsumers` short-circuits `if (updateCoverage.length === 0) return clientQueries;` and never
    consults `component.fragments`. The fragment-only downgrade is only reachable with hand-fed `updateCoverage`
    (`packages/cli/src/index.kovo-check.test.ts:1123`), so the DEFAULT scaffold's dead transform is certified live.
  - Fix (single commit): compute `updateCoverage` in `staticBuildCheckGraph` (or make the consumer walk consult
    `component.fragments`) so KV310 (`packages/core/src/diagnostics.ts:612`) warns for a hand-written transform whose
    only consumers are fragment-target regions.
  - Acceptance: the unmodified default `--sqlite` scaffold `build:prod` emits the KV310 fragment-only warning (the
    round-6 canary); a non-fragment client-store region with a live transform stays clean. Mark plan-1 O.2 as re-opened
    (it was not effective as shipped).

## Phase 3 — Completeness meta-fixes (make the proofs sound, not enumerated)

- [ ] **P2.1 — Reachability-derived brand denominator (DEC7, N6).**
  - Root: `scripts/check-security-brands.mjs` derives "must be branded" from name/import/file patterns, so a sink
    authored outside the pattern is invisible.
  - Fix: derive the required-branded set from call-graph reachability from the enforcement sinks / the driver-method
    choke (`enforceManagedSql`) / `emitToWire`. Commit a canary: an unbranded function reachable from an enforcement
    sink MUST fail the gate.
- [ ] **P2.2 — Reachability-derived census denominator (DEC7, N6).**
  - Root: `scripts/fundamental-fixes-census-gate.mjs` `--require-complete` derives write-handle/wire-sink denominators
    from enumerated construction-call names.
  - Fix: derive from reachability (every value that reaches the driver-method choke = a write-capable handle; every
    value that reaches `emitToWire` = a wire sink). A source-discovered sink with no manifest row fails
    `--require-complete`; add a committed reachable-but-unenrolled canary.
- [ ] **P3 — Runtime-twin deletion tests (N5) across all inverted gates.**
  - For each of B1/B2/B3, add a test that removes/stubs the static arm and asserts the runtime twin (SQL oracle/read
    floor; SSR sink; `emitToWire`) still closes — proving §11.2 `observed ⊆ static ∪ declared` is enforced at runtime,
    not only statically.

## Phase 4 — Proof (round-7 adversarial dogfood is the acceptance gate)

- [ ] **4.1 — Generative dogfood pass (N4, plan-1 M1).**
  - Run `/dogfood exhaustive` on the prod artifact, both dialects, by a non-implementer, driven by the DEC8
    generators (novel SQL-function / callee-shape / binding-shape / trust-URL shapes — NOT the fixed round-6 list).
    Acceptance: zero fail-opens in the B1/B2/B3/B4 classes; the three 0.2-lint sites are green; the census/brand
    reachability canaries are caught. Record the result and the generator seeds.

## Verification map

- Server (B1, B4, P3): `pnpm --filter @kovojs/server test`; `sql-write-allowlist.oracle.test.ts` with the generated
  volatile-function corpus; `check:fail-closed-classifiers` (0.2) green on `sql-safe-handle.ts`.
- Compiler (B2): focused `@kovojs/compiler` test; the callee-shape fuzzer; render-equivalence/fixpoint; `check:fail-
  closed-classifiers` green on `trusted-html-provenance.ts`.
- Drizzle (B3): `pnpm --filter @kovojs/drizzle test`; the binding-shape fuzzer; `pnpm run test:conformance`.
- CLI (P1/O.2, P2): `@kovojs/cli` test; default-scaffold build emits KV310 fragment warning; `check:security-brands`
  + census gate with reachability canaries.
- Program: `check:fail-closed-classifiers` (extended), the enforcement-site UNPROVEN-routing lint, the DEC8 generators
  wired into `check`, the round-7 dogfood record.

## Latest verification

- Round-6 findings reproduced first-hand before writing this plan: B1 `select setval` persisted through
  `readonlyDb` on real PGlite; B2 five shapes served reflected `<script>`/`javascript:`; B3 array-binding launder
  green; the read-only floor confirmed still `writeTables.length === 0 → return` (`sql-safe-handle.ts:552,568,606`).
  No framework source or `SPEC.md` changed by this document.
