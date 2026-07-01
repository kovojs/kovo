# Fundamental Fixes — make the verifier fail-closed by construction

Created 2026-06-30. Strategic plan + committed program. Source of truth remains `SPEC.md` (§5 compiler,
§11 static analysis & verification, §6.6 soundness boundary, §1.3 "machine-auditable generation"). This
plan diagnoses the recurring ROOT behind the `claude-bugz-22/23/24` + `bugz-1..21` soundness findings and
commits the framework-level program that converts the verification layer from _enumerate-and-allow,
fail-open_ to _prove-or-fail-closed_.

**These are not options to choose between. All seven workstreams (A–G) are committed.** The diagnosis
below is the _why_; the workstreams are the _what_; "Phased delivery" is the _order_, driven by
dependencies (B before A; E from the start; C as the migration target).

## TL;DR

- **~80% of the soundness bugz reduce to ONE meta-defect:** the verifier is an _enumerate-and-allow_
  pattern-matcher over the **authored source AST** that **fails OPEN** on any spelling it doesn't
  enumerate. A secondary root: the same contracts are **duplicated across code paths** (dev/prod,
  SSR/`_q`, sync/async, default-hook/override-hook), so a fix to one path misses its siblings.
- **Evidence:** 65 analyzer sites recognize framework constructs by literal callee text / import
  specifier / alias name / AST node kind; 121 `KV406`/fail-closed sites already exist (the idiom is real
  but applied unevenly). The round-3 _residuals_ prove a point-fix only fills one cell of the
  `(source spelling × sink × code path)` matrix.
- **The program:** B makes recognition spelling-invariant → A flips the default to fail-closed → D
  collapses path duplication → F shrinks the sink surface → C migrates gates onto the lowered IR (where
  spelling-invariance is free) → E fuzzes every gate so residuals can't ship → G brands the safe values
  as defense-in-depth. Together they make "we keep finding new spellings" stop being true.

## Diagnosis

### Root 1 — fail-open syntactic recognition (enumerate-and-allow over the source AST)

The analyzer recognizes a fixed list of `(construct-shape × location)` pairs and proves _those_ safe;
anything unrecognized produces **no fact → no diagnostic → green build**. Evidence:

- `grep` of `packages/compiler/src` + `packages/drizzle/src`: **65 sites** key on literal
  `node.text === '<name>'` / `getText() === '<name>'` / `importedName === '<name>'` /
  `moduleSpecifier === '@kovojs/...'` / a specific `ts.isX` AST-kind gate. The exact lines that caused
  findings are in this set.
- The codebase is _self-aware_ of the hazard: `packages/drizzle/src/static.ts:1063` warns against "the
  way a literal `expression.getText() === 'query'`" erasing the security surface — and `kovo()`/`route()`
  were alias-hardened — but the hardening was applied **per-site**, leaving ~60 others syntactic.
- The fail-closed idiom **already exists and is heavily used**: **121** `KV406` / `un-analyzable` /
  `UNCLASSIFIED` / `degrade` sites in `packages/drizzle` alone. The bugs are precisely where it is _not_
  applied — inconsistency, not absence, of the fail-closed pattern.

Findings that are this root, with the recognizer that failed:

| Finding                                                                                | Failing syntactic recognizer                                                                                                                                   |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude-bugz-22` B1 (task write-audit bypass)                                          | `parse.ts:139` collects only `node.text === 'mutation'` → `task()` bodies never modeled                                                                        |
| `claude-bugz-24` B2 (KV426 XSS gate bypass)                                            | `trusted-html-provenance.ts:88` keys on `moduleSpecifier === '@kovojs/browser'` → the `@kovojs/server` re-export (the guide's recommended import) is invisible |
| `claude-bugz-23` B1 (read-set IDOR/secret leak)                                        | `Reader<Db>` recognized only when the alias symbol name `=== 'Reader'`                                                                                         |
| `claude-bugz-24` B1 (closure read-set erasure)                                         | `project-receivers.ts:1233-1245` `isTouchBodyNode` descends only into _enumerated_ callbacks (`.map`/transaction), not ordinary closures                       |
| `claude-bugz-24` B4 (frozen island UI)                                                 | `parse.ts:1836` alias capture gated on `ts.isIdentifier` (+ `:1840` `accesses.length>0`) → destructuring/chaining invisible                                    |
| Historical alias class (`bugz.md` H4, `bugz-2` H2/H3, `bugz-3` H1/H4/L11, `bugz-4` L6) | `sql`/`kovo()`/`route()`/`domain()` recognized by literal callee text → aliasing erases the security surface                                                   |

The shared failure mode: **un-analyzable / unrecognized input emits NOTHING (fail open) instead of a
fail-closed diagnostic.** (22 B1, 23 B1/B4, 24 B1/B3.)

### Root 2 — the same contract duplicated across code paths (no chokepoint)

| Finding                                          | Duplicated contract                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `claude-bugz-22` B2 (inert runaway backstops)    | two `ctx.schedule` impls; prod overrides `hooks.schedule`, the backstopped default is dead code with a passing unit test |
| `claude-bugz-23` B2 (silent SSR truncation)      | warnings surfaced on the `/_q` path, **discarded** on the SSR render path (`jsx-runtime.ts:681`)                         |
| `claude-bugz-23` B3 (file MIME bypass)           | server-sniff runs only on the `.store()/parseAsync` path, not on sync `parse`                                            |
| `bugz-16` B1 → `bugz-17` B2 (empty success body) | dev path fixed, the production `kovo build` artifact still shipped the broken behavior                                   |

### Why point-fixes cannot converge

The search space is `(source spelling × sink × code path)`, combinatorial. Each point-fix fills one cell;
the _design_ guarantees neighboring cells stay empty. Proof: `claude-bugz-24` B1 is the closure-shaped
sibling of the fixed `claude-bugz-23` B1; `claude-bugz-24` B4 is the destructure/chain sibling of the
fixed `bugz-13` B2 / `bugz-19` B1. Same sink, adjacent spelling, still open. As long as the gates
pattern-match authored source, the next dogfood (or attacker) finds the next spelling — hence the program.

## Coverage: which workstream closes which class

| Workstream                            | Root             | Findings it closes as a class                                                                                           |
| ------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **A** fail-closed-on-unprovable       | 1                | 22 B1, 23 B1/B4, 24 B1/B3 (everything that "vanished instead of diagnosed")                                             |
| **B** one identity resolver           | 1                | 24 B2, 23 B1, 22 B1, the whole historical alias class                                                                   |
| **C** verify the lowered IR           | 1+2              | nearly all: closure/task/webhook writes, unbundled-helper derive (24 B5), import-path XSS, _and_ SSR-vs-`_q` divergence |
| **D** one chokepoint per contract     | 2                | 22 B2, 23 B2/B3, the dev-vs-prod class (bugz-16/17)                                                                     |
| **E** metamorphic recognition fuzzing | process          | the residual class (24 B1/B4) before it ships                                                                           |
| **F** capability-narrow the sinks     | 1+2 (source)     | 22 B1, 24 B3 (deletes the `appDb` write sink); shrinks what A/C must police                                             |
| **G** branded provenance types        | defense-in-depth | hardens the author surface on top of A/C (not a gate itself)                                                            |

## The program (all committed)

- [ ] **A. Invert the default to fail-CLOSED on un-analyzable input ("no fact = error").**
      Make the invariant normative: _anything an analyzer touches but cannot fully prove emits a KV
      diagnostic, never silence._ Read-extraction that can't traverse a loader (closure / unrecognized
      receiver) emits `KV406 "un-analyzable read; declare reads:"` instead of an empty set; an unclassifiable
      write → `KV406`; an unresolved trust/brand construct → fail closed. Leverages the **existing 121
      `KV406`/`UNCLASSIFIED` sites** — policy + plumbing, not new analysis. Requires an _audited_
      declare-or-justify escape hatch (itself provenance-checked, per the `bugz-21` B2 `trustedSql`-shadow
      lesson). Depends on B (so it doesn't fire on aliased-but-safe constructs).
  - Done when: a closure-scoped secret/owner read, a `task`/webhook `appDb` write, and a `recordChange`
    to an undeclared domain each FAIL the build, while the existing green-path apps still build; every
    analyzer entry point has a proven-or-`KV406` exit (no silent empty-set return).

- [ ] **B. One semantic identity resolver, not 65 syntactic checks.**
      Replace every `text === 'sql'` / `moduleSpecifier === '@kovojs/browser'` / alias-name check with a
      single resolver that follows imports → re-exports → aliases → assignments to the canonical framework
      export identity (TS symbol resolution + a provenance graph). Every gate keys on resolved identity,
      immune to aliasing / re-export / shadowing; the resolver fails closed (composes with A) when it cannot
      resolve.
  - Done when: the 65 syntactic recognizers route through the resolver; aliased / re-exported `sql`,
    `trustedHtml`, `Reader`, `mutation`, `task`, `domain`, `route` are all recognized; the import-path and
    callee-alias bug classes cannot reproduce (verified by E).

- [ ] **C. Verify the lowered IR / emitted artifact, not the source AST (the migration target).**
      A sink is a sink in the IR regardless of source spelling _or_ which path produced it. Enumerate every
      sink in the generated output — raw-HTML writes, SQL executions, owner-table mutations, secret-column
      projections, client-derive free identifiers — and require each to carry a provenance proof ("verify the
      output, not the input"; the §5.2 render-equivalence gate is the precedent). Migrate gates incrementally
      onto the IR; the IR schema is extended to carry provenance where needed; each flagged IR sink maps back
      to an actionable source location.
      Mechanics, the extract-once model, the soundness triangle, and the before/after gate are in
      _How workstream C works_ below.
  - Done when: the closure read, task/webhook write, unbundled-helper derive, import-path XSS, and the
    SSR-vs-`_q` divergence are caught by IR-level passes; a _new authored spelling_ of a known sink cannot
    bypass the gate (verified by E). Spike first: map secret-to-wire (KV435) onto the IR to size the work.

- [ ] **D. One chokepoint per contract + assert against the production artifact.**
      Collapse the dev/prod/SSR/sync-async duplications: one `runQuery` both paths call that _always_ carries
      warnings; one file-parse that _always_ sniffs; one `schedule()` whose backstops the runtime cannot
      override away. Generalize the durable-tasks close-out rule: contract tests run against `dist/server`
      (the deploy artifact), not a unit proxy. Inventory and explicitly mark any _intentional_ dev/prod
      divergence.
  - Done when: each listed contract has exactly one implementation path; the regression tests assert on
    the prod artifact (so a `bugz-16`→`17`-class dev-only fix is impossible).

- [ ] **E. Metamorphic recognition-fuzzing in CI (institutionalized from the start).**
      For each security gate, maintain a "known-unsafe seed" and auto-generate semantically-equivalent
      variants — alias the import, wrap the call in a closure, destructure the binding, re-export the symbol,
      helper-indirect — and assert the gate fires on ALL of them (or fails closed). Build the harness in
      Phase 0; thereafter every gate ships with its metamorphic suite. This is the regression net that proves
      A/B/C/D hold and catches the residual class before it lands.
  - Done when: the harness exists with a seed corpus covering KV414/KV435/KV422/KV426/KV407/KV311; a new
    gate cannot merge without its suite; a fix that closes shape X but not X′ fails CI.

- [ ] **F. Capability-narrow the APIs so the unsafe construction is impossible, not merely policed.**
      Remove the importable write handle that the analyzer must chase: tasks get only `ctx.runMutation`,
      webhooks only a managed tx handle, and there is a sanctioned _read-only_ alternative for the legitimate
      endpoint-read case; module-level `appDb` no longer exposes write verbs to non-mutation surfaces. Provide
      a migration for existing apps.
  - Done when: no importable handle can write outside the audited channel, so 22 B1 / 24 B3 are
    _unconstructable_ rather than diagnosed; the legit endpoint-read path has a blessed read-only handle.

- [ ] **G. Branded provenance types (defense-in-depth on top of A/C — never the proof).**
      Make `Reader<Db>`, trusted HTML/URL, and the Tx-db genuine module-private `unique symbol` brands so the
      _type_ carries provenance and the safe value is awkward to forge casually (CLAUDE.md type-ergonomics).
      Per §6.6 the honesty boundary, runtime validation / IR-provenance (A/C) remain the enforcer; G only
      makes the unsafe shape awkward at author time. (`bugz.md` H6 forgeable brands and `bugz-21` B2 name-
      shadow are the cautionary cases the runtime gate must still cover.)
  - Done when: the unsafe call shapes are awkward to write, while the runtime/IR gate still owns
    enforcement and a forged/aliased brand is caught by A/C regardless of the type.

## How workstream C works (extract-once, then check the model)

Kovo already has the IR and a fact-store; the gates just don't use them. The pipeline
(`spec/05`) is `cart.tsx → parse → analyze → lower → cart.{server,client}.js` plus the emitted
build graph (`dist/.kovo/graph.json` / `generated/touch-graph.ts`), which the SPEC calls "the runtime
authority for derived query reads and mutation touches." Its real fact shape:

```jsonc
// queries[]: the READ set (domains a loader touches)
{ "query": "queries/contacts-query", "domains": ["model/contact"],
  "access": { "kind": "guard-chain", "guards": [{ "name": "appAuthed" }] } }
// mutations[]: the WRITE set + invalidation edges
{ "key": "mutations/add-contact", "writes": ["model/contact"],
  "invalidates": ["queries/contacts-query"], "csrf": "checked" }
```

The architectural shift is **separate fact extraction from policy checking**:

- **Today (fail-open):** each gate re-derives its own facts from the source AST. KV435/KV414 re-walk the
  loader body (`project-receivers.ts:1233` `isTouchBodyNode`) looking for `.select().from(secretTable)`;
  an unenumerated shape (closure, helper, destructure) → the walk finds nothing → empty set → gate passes.
  The `claude-bugz-24` B1 closure read, `22` B1 task write, and `24` B4 destructure are the _same line_.

```ts
// BEFORE — gate re-extracts from source, fails open on the unenumerated shape
const reads = touchBodyCallExpressions(loader).filter(isSelect).map(resolveTable);
for (const t of reads) if (isSecret(t)) error('KV435'); // reads=[] for a closure → silent pass
```

- **Workstream C (extract-once):** ONE extraction pass owns over-approximation + fail-closed (this is
  literally §11.1 step 2.E / step 5: an un-traversable read → `UNRESOLVED → KV406`, never an empty set).
  Every gate then reads the model fact (`query.reads`) — which is _either_ a complete set _or_ a KV406 —
  and is a trivial set-operation (§11.4 #3: "graph queries over `kovo explain`… as set operations").

```ts
// AFTER — model carries the canonical fact OR KV406; the gate never sees a misleading empty set
function checkSecretToWire(q: QueryModel) {
  if (q.reads === UNRESOLVED) return; // already KV406'd at extraction (fail-closed)
  for (const d of q.reads)
    if (d.classification === 'secret' && !q.provenProtected) error('KV435', q.span);
}
```

Spelling-invariance is the payoff: inline / closure / destructured / helper reads all lower to the SAME
`query.reads = {auth/account}` (or `UNRESOLVED`), so the gate is immune to spelling _for free_ — the
variety the dogfood (and an attacker) exploits only exists in the source, not the IR.

**The soundness triangle** (all three already exist in spec; C extends the first to security gates):

1. **Static over-approximates + KV406-on-doubt** (§11.1) — the extraction pass catches all branches and
   fails closed on the unprovable.
2. **Render-equivalence + fixpoint** (§5.2 #3) — `render(src) ≡ render(compile(src))` and
   `compile(compile(src)) === compile(src)` already verify the lowered IR preserves behavior, so checking
   the IR is checking the app.
3. **Runtime cross-check** (§11.2) — the executor asserts `observed ⊆ static ∪ declared`; any residual
   static gap (a fail-open the extractor still misses) surfaces as a CI failure under instrumentation.

**The cost is the IR schema, not the gates.** `graph.json` today carries domain-level `domains`/`writes`;
moving KV435/KV414 fully onto it needs **column-level + provenance** facts (e.g. "this read projects
`account.password`, classified `secret`, key-scoped by `arg:id`") and reliable IR→TSX spans for actionable
errors. Sizing that extension is the Phase-0 KV435 spike.

## The escape hatch (A's load-bearing sub-requirement): `declare reads:`/`touches:` must be provenance-checked

Fail-closed (A) means genuinely un-analyzable code now errors, so authors need an escape: the
`reads:`/`touches:` declarations §10.2/§10.3 already define for opaque projections (KV410) and unresolved
writes (KV406). **The trap is that an escape hatch is an author _assertion_, and an assertion that the
analyzer trusts by name/shape is a universal bypass** — exactly the `bugz-21` B2 failure, where a local
`function trustedSql(s){ return s }` shadow matched the waiver's callee _name_ and silently disabled the
KV414 (IDOR) + KV438 (mass-assignment) gates.

So the hatch must be provenance-checked on **two** axes, or it becomes the next trustedSql-shadow:

- **Identity provenance (via B):** the `reads:`/`touches:` declaration must resolve to the _real_
  framework construct, not a local shadow / alias with the same name. (Kills the `bugz-21` B2 class.)
- **Content provenance (via §11.2):** the declaration is a _claim to be cross-checked_, never trusted.
  The runtime executor enforces `observed ⊆ static ∪ declared` — a loader that declares `reads: []` but
  executes a read of `account` produces `account ∉ []` → CI failure under instrumentation, and in prod
  the raw-SQL path fails closed (conservatively invalidates every `touches` domain) rather than dropping
  the unexpected table.

This is what makes the hatch safe where the old `trustedSql` waiver was not. The key asymmetry:
**over-declaring is safe (excess = warning), under-declaring is caught (observed ⊄ declared → CI fail),
so the only sound declaration is a _superset_ of reality.** An author therefore cannot use the hatch to
re-create the fail-open we are killing: declaring `reads: []` to silence the gate is itself caught the
moment the loader runs. Contrast the original `trustedSql`, which _disabled_ the gate (granted a blanket
pass) with neither identity-resolution nor a runtime claim to verify against. The rule for every A escape
hatch: **declare-and-verify (narrow the unknown to an asserted, runtime-policed set), never
name-and-bypass (turn the gate off).**

## Phased delivery

- [x] **Phase 0 — Foundation.** Build the E harness + seed corpus; inventory the 65 syntactic-recognition
      sites and the 121 existing `KV406` sites; **spike C** by extending `graph.json`/`touch-graph.ts` with
      column-level secret + key-scope provenance and porting secret-to-wire (KV435) to read it (with IR→TSX
      spans), to size the IR migration and prove the closure-read case fails closed.
  - Evidence: `node scripts/fundamental-fixes-inventory.mjs`;
    `pnpm exec vitest --run scripts/fundamental-fixes-inventory.test.mjs
packages/conformance-fixtures/src/metamorphic-recognition-fixtures.test.ts
packages/drizzle/src/index.query-shapes.test.ts packages/drizzle/src/index.query-loader-receivers.test.ts
packages/drizzle/src/index.serialization.test.ts packages/cli/src/index.kovo-check.test.ts`; and
    `pnpm run check:vp`.
- [ ] **Phase 1 — Spelling-invariant recognition (B).** Land the identity resolver; migrate the 65 sites;
      E proves the alias/re-export classes are closed.
- [ ] **Phase 2 — Fail-closed default (A).** Flip "no fact = `KV406`"; ship the audited escape hatch;
      B prevents false positives on aliased-but-safe constructs.
- [ ] **Phase 3 — Collapse duplication (D).** One chokepoint per contract; move regression tests onto the
      prod artifact.
- [ ] **Phase 4 — Shrink the sink surface (F).** Remove the importable write handle; ship the read-only
      alternative + migration.
- [ ] **Phase 5 — Migrate to IR verification (C, ongoing).** Move gates onto IR-level provenance, one sink
      family at a time, starting from the KV435 spike.
- [ ] **Cross-cutting — G + E.** Brand the safe values as each gate gains runtime/IR enforcement; every
      new or migrated gate ships with its metamorphic suite.

## Risks / questions to resolve during delivery

- [ ] A's author friction in real apps, and the exact escape-hatch shape (declare-`reads`/`touches` vs a
      justified attestation). The provenance + runtime-cross-check requirements are settled in _The escape
      hatch_ section above (declare-and-verify, never name-and-bypass); the open question is ergonomics — how
      often real apps hit the hatch and whether the declaration burden is acceptable.
- [ ] B must land before A so "fail closed on unprovable" doesn't fire spuriously on aliased-but-safe
      constructs — confirm TS symbol resolution gives a reliable "cannot resolve" signal across module
      boundaries and dynamic imports.
- [x] C's cost: does the lowered IR already carry enough provenance to attach sink proofs, or must the IR
      schema be extended? (Answered by the Phase-0 KV435 spike.)
  - Evidence: `packages/core/src/graph.ts`, `packages/drizzle/src/graph.ts`, and
    `packages/drizzle/src/static/query-shapes.ts` now carry/query column-level read provenance; verified by
    `pnpm exec vitest --run packages/drizzle/src/index.query-shapes.test.ts
packages/drizzle/src/index.query-loader-receivers.test.ts packages/cli/src/index.kovo-check.test.ts`.
- [ ] D: which dev/prod divergences are _intentional_ (and must stay) vs accidental?
- [ ] F: the migration path for apps that legitimately import `appDb` for reads.

## Latest verification

- Inventory is now reproducible: `node scripts/fundamental-fixes-inventory.mjs` scans production
  compiler/drizzle sources and reports 79 literal/import syntactic candidates, 1,747 AST-kind gates, and
  92 KV406/fail-closed sites. Verified with
  `pnpm exec vitest --run scripts/fundamental-fixes-inventory.test.mjs` and `pnpm run check:vp`.
- Integrated Phase 0 foundation plus first B/D/F/G slices on
  `agent/implement-fundamental-fixes-20260630-171240`. Latest checks: `pnpm run check:vp`;
  `pnpm run check:api-surface`; focused Drizzle identity/KV435 suites; focused server runtime/prod-artifact
  chokepoint suites; and `git diff --check`.
- Current starter CI routing: `.github/workflows/ci.yml` enrolls the new runtime-contract prod-artifact test
  in the starter matrix, and `scripts/ci-shards.test.mjs` keeps it out of root Vitest shards.
- Integrated A/E slices: hidden Drizzle reads inside ordinary closures now fail closed with KV406, and
  metamorphic recognition has a dedicated CI gate outside generic root Vitest shards. Verified with
  `pnpm exec vitest --run packages/drizzle/src/index.query-loader-receivers.test.ts
packages/cli/src/index.kovo-check.test.ts`; and
  `pnpm exec vitest --run packages/conformance-fixtures/src/metamorphic-recognition-fixtures.test.ts
scripts/ci-shards.test.mjs`.
