# 10x Better Security 3 — Decide, Certify, and Bound the Trusted Periphery

Status: ACTIVE (created 2026-07-19). Third roadmap, layered on `plans/10x-better-security.md`
(structural closure) and `plans/10x-better-security-2.md` (derive-and-re-witness). It accepts work
only when it replaces a test with a decision procedure over a provably finite domain, produces
evidence a third party can check without running Kovo's analyzer, converts a silently-trusted party
into a bounded machine-checked construct, or discharges a security-program obligation the framework
owes downstream. Everything else is in the kill list at the bottom, and the kill list is normative.

## Authority, scope, and honesty boundary

`SPEC.md` and its `spec/*.md` modules stay normative; any item that changes a guarantee lands the
SPEC text with the implementation. Classifier migrations obey `rules/security-classifier-refactors.md`
C13; compiler work obeys `rules/compiler-hard-rules.md`; dependency and TCB work obeys
`rules/dependency-policy.md`; v1 claims obey `rules/v1-acceptance.md`.

Two honesty rules govern this plan specifically, because it trades in the word "proof":

1. **Every decision procedure states its domain and its extraction gap.** A decided transition
   relation says nothing about whether `ts.Node → State` extraction is faithful; a decided policy
   algebra compares two denotations _we wrote_, not JavaScript-the-language against
   Postgres-the-engine. This plan does not close the extraction gap. It makes it **local, named, and
   enumerable** (§4.5 precision-grant register, §4.6 undecidability ledger) — that is the deliverable,
   and it must be stated wherever a Phase-1 result is published.
2. **Detection is not proof.** §5 (advisories, incident scope, residency) and §2's certificates are
   integrity/detection machinery. A green `kovo check advisories` means "no advisory we published
   matches your artifact", never "you are not vulnerable". The CLI must say exactly that.

Scope remains plan-1's ordinary-framework-exposure threat model. Plan-3 adds one axis: the parties
whose cooperation the existing guarantees silently assume — the app author (increasingly an AI agent
optimizing for green CI), a co-principal in an org graph, a model reading attacker-controlled text,
the app's own dependency graph, the deployment environment, derived copies of the data, and the
future incident responder.

## Relationship to plans 1 and 2

Plan-1 proved things about the program's **shape** (structural closure at build time). Plan-2 proved
the proof **stays true** (derive-don't-author, re-witness-continuously). Both terminate in
falsification — mutation kill, corpora, property oracles, fuzzers, differential sampling — and both
assume a cooperative periphery: an author who wants the guarantee, a lone deployment, a database
that is the only copy of the data, dependencies that behave.

Every item here was checked against both plans' full text and their check-scripts. Nothing duplicates
a plan-1 or plan-2 checkbox. Several items are deliberately _one slice_ with a plan-2 item and are
marked as such — most importantly §1.1, which must be executed as a single piece of work with plan-2
§1.1's lattice/transfer census, because both extract rule-table-as-data from the same 5,365-line file.

**Never build a second one of anything plan-2 owns** — not a second security-event door, capability
census, escape ledger, or trust anchor. That is the fastest way to burn this plan's budget on merge
conflicts.

## Thesis

**Decide what is finite. Certify what must be trusted. Ledger what cannot be decided. Bound the
parties we assume are friendly.**

The decisive discovery of this audit is that Kovo's security-critical cores are **much smaller than
the code implementing them, and several are finite**:

- The server provenance relation is **37 states** (+20 browser), a member-name alphabet, four fixed
  budgets, and exactly **8 closed reasons** — and `serverExpressionProvenance` is _compositional_
  (a term's provenance depends only on its subterms' provenance **values**, never their syntax). So
  "can authority reach a sink with no operation record and no closed reason?" is not a program-analysis
  question over unbounded ASTs. It is reachability over a finite labelled transition system —
  **decidable by fixpoint closure in milliseconds**, not approximable by fuzzing.
- The shipped RLS policy fragment is **2 constructors** (`ownerColumn`, `ownerVia`) in one file, over
  a three-valued domain with a bounded recursion depth — **decidable by exhaustive enumeration**, no
  SMT solver required.
- The dangerous-character languages for `Set-Cookie` forwarding and `Content-Disposition` are ~5-state
  DFAs — **disjointness is decidable over all inputs**.

Kovo's design already paid the price that makes decision possible. Not collecting is waste. Where the
domain is not finite, the answer is not a bigger proof — it is an explicit, owned, monotonically
shrinking ledger of what is trusted and why.

## Dependency-driven execution order

The numbered sections are a reference taxonomy, not the implementation order. Execution uses these
trains; a train starts only when its entry gate is evidenced at the exact current SHA.

| Train                         | Work                                   | Entry gate                                                                            | Exit                                                                                                                    |
| ----------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A — zero-research debts       | §0 all                                 | None — every item is independently worth doing                                        | Defects fixed with regression tests; process artifacts live; hermetic stage green                                       |
| B — decide the finite         | §1.1–§1.3 provenance, policy, grammars | Plan-1 L2/L3 vocabularies are consumable data; §1.0 kill gate passed                  | A counterexample _path_ fails CI, not a flaky seed; diffable relation artifacts committed                               |
| C — ledger the trusted        | §4 all                                 | §1 has produced one decided result to bound                                           | Metric E ratcheting; precision-grant and undecidability registers have zero ownerless rows                              |
| D — certify                   | §2 all                                 | §0.6 hermetic stage + §0.4 provenance stamp landed; §2.0 kill gate passed             | An outside party validates a certificate with disjoint code; three negative controls fail on three distinct obligations |
| E — bound the periphery       | §3 all                                 | Plan-2 §3.1 ScopedKey landed (for §3.4); plan-1 L2 op set census-derivable (for §3.1) | Each bounded party has a fail-closed door plus a printed retained-obligation set                                        |
| F — program and answerability | §5                                     | §0 process half live; plan-2 §4.3 event door landed                                   | A fire drill returns AFFECTED → fixed → NOT-AFFECTED → UNKNOWN-fails-closed                                             |
| G — optional model checking   | §6                                     | Train B paid off                                                                      | One model, one faithfulness gate, or the item stops                                                                     |

Within a train: reproduced attacker-facing severity first, then dependency leverage, then cost.
**Do not start a certificate or a model while a reproduced defect in §0 is open.**

### Per-section completion contract

A section is complete only when its concise evidence names every applicable field. "Not applicable"
requires a reviewed reason. A unit test cannot close behavior observable only in a built or served
artifact.

| Field         | Required evidence                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Authority     | SPEC delta, threat-matrix cell, exact supported scope, explicit non-claims                        |
| Decidability  | The domain's finiteness argument, its bound, and what falls outside it                            |
| Trust delta   | What was trusted before, what is trusted after, and the register row recording the residue        |
| Forcing proof | Red reproduction, C13 anchor where applicable, behavioral mutant, fail-closed negative            |
| Real behavior | Production build / served artifact / real-Postgres / real-browser proof at the defect's own layer |
| Cost          | Versioned latency, memory, and build-time budget for every gate added                             |
| Completion    | Exact command, no required skips, clean checkout, intended CI job                                 |

---

## Phase 0 — Zero-research debts that are credibility defects today

No formal-methods content, no research risk, no dependency on plans 1–2 landing. Every item is worth
doing even if the rest of plan-3 is abandoned, and §0.4/§0.6 are **preconditions for the credibility
of every certificate later in this plan**. A certificate signed by a pipeline an app `postinstall`
can subvert is a rumor, not evidence.

### 0.1 Fix the task-lease fencing defect (found by reading, not modeling)

`packages/server/src/task-runner.ts:335` discards the heartbeat boolean while
`task-queue.ts` `reapExpiredLeases` flips `running → ready` on lease expiry, and `taskTimeoutMs`
permits `task.timeoutMs` to exceed `leaseMs`. A reaped worker keeps executing the body while a fresh
claimant runs the same job. (~0.1 pm)

- [ ] Make a false heartbeat abort the in-flight body through the existing `withTimeout`/`AbortSignal`
      path; add a regression test that asserts the reaped worker's body is aborted before the second
      claimant commits.
- [ ] Surface the discarded `markSucceeded`/`markFailed` booleans (`task-runner.ts:302,305`) as a
      diagnostic so a stale-lease commit is observable rather than silent.
- [ ] Add an attempt ceiling to `reapExpiredLeases` (`task-queue.ts:733`) so a process-killing task
      cannot redeliver forever; verify with a test that a task killing its runner reaches a terminal
      state.

### 0.2 Retire two false assurances

- [ ] `tests/integration/specs/concurrent-distinct-writes.spec.ts` is a **placebo**: it races
      `count = count + $1`, in-DB arithmetic that cannot lose an update under any isolation level. No
      app in the repo exercises `atomic:`/`version:`/`compareAndSet` at all, so the lost-update
      guarantee has never been raced. Replace with a real read-decide-write race on a declared
      `version:` column against **real Postgres** (PGlite is single-connection —
      `packages/test/src/pglite.ts:176-178` — and unfit for concurrency claims).
- [ ] Assert the mutation transaction's isolation level instead of assuming it: `mutation.ts:624-648`
      issues no `SET TRANSACTION`, yet KV429's normative ceiling (`spec/10-data-plane.md:482`) is
      stated _relative to_ READ COMMITTED and nothing detects a deployment that differs.
- [ ] Correct plan-1 line 405: `scripts/check-csrf-mint-delivery.mjs` is a frozen 18-surface × 5-stage
      label table plus grep anchors, not a "state model". Reword the claim; do not build a model
      (see kill list).

### 0.3 Reproduce or refute the `authzPolicy` string-form RLS gap

The claim reproduced as a HIGH-severity, authenticated cross-tenant read/write path: Postgres treated
the prose assertion as enough to grant reader/writer access while installing no RLS predicate.

- [x] Reproduce the red state through compiler, runtime, and real-Postgres provisioning paths; trace
      the predicate-free reader/writer admission; and record severity, attacker prerequisites, and
      the DB C/I/Au threat-matrix cell.
  - Evidence: the new cases in `static-analysis-context.test.ts` and `postgres-runtime.test.ts` failed
    on the old behavior; `postgres-external-probe.test.ts` exercises the real engine path, and
    `docs/security-threat-matrix.md` records the exploit chain.
- [x] Reject Postgres string assertions at compile time (`KV414`) and again at runtime before grants
      or listener startup (`KV433_AUTHZ_POLICY_UNSUPPORTED`); require compiler-bound literal SQL and
      retain string assertions only for SQLite's bounded authorizer posture.
  - Evidence: `pnpm exec vitest --run --no-file-parallelism packages/drizzle/src/static-analysis-context.test.ts packages/server/src/postgres-runtime.test.ts packages/server/src/postgres-external-probe.test.ts`; mutant
    `drizzle-authz-policy/allow-postgres-string-without-rls` is killed; the generated external
    Postgres starter test passes with FORCE RLS both without and with a transaction principal.

### 0.4 Artifact identity stamp (precondition for §2 and §5 and plan-2 §4.3)

`kovo build` already writes `graph.json` (`packages/cli/src/commands/build-export.ts:1145`). The
identity object every later certificate, advisory, and attestation needs does not exist. (~0.3 pm)

- [ ] Add a `provenance` block: resolved `@kovojs/*` versions, `pnpm-lock` content hash, graph schema
      version, and the `SECURITY.md` guarantee-register digest in force at build time. Verify byte
      stability across two no-op rebuilds and that it changes when any input changes.

### 0.5 Security process half (live credibility defect)

`SECURITY.md` is 100 lines of `kovo.security.guarantees/v1` register; grep across `SECURITY.md`,
`CONTRIBUTING.md`, `README.md`, `STABILITY.md` for disclosure/contact returns **zero hits**, and
`.github/` has no security policy. A framework selling security cannot carry "report privately to the
maintainers" with no SLA into v1. (~0.5 pm)

- [ ] Real reporting section in `SECURITY.md` (GitHub private vulnerability reporting enabled,
      monitored channel, ack ≤3 business days / triage ≤10 / coordinated release ≤90, embargo terms),
      written **outside** the ```json fence so `check:security-guarantee` still parses. Add a test that
      fails if the contact line disappears.
- [ ] `STABILITY.md` supported-version window, stated honestly for technical preview: latest minor
      only, no backports. Add `site/public/.well-known/security.txt` and a `Security response
readiness` row (status `pending`) to `rules/prelaunch-checklist.md`.
- [ ] Retraction closure in `scripts/check-security-guarantee.mjs`: withdrawn/superseded guarantee
      states plus a `retracts` binding, so a guarantee cannot be silently re-asserted over an open
      advisory. The register today only ever **adds**.

### 0.6 Hermetic proof stage (underwrites every certificate in this plan)

`package.json` sets `onlyBuiltDependencies` (good hygiene) but it is not a pipeline invariant.
(~0.5 pm, outsized return)

- [ ] `check:hermetic-proof-stage`: analysis, certificate generation, and signing run with no
      lifecycle-script execution, no network, and no reachability from the app dependency closure to
      signing material. Fail if the proof stage's process tree could have executed app-graph code.
      This is the difference between "this certificate is evidence" and "this certificate is a rumor".

---

## Phase 1 — Decide the finite

The three domains where the security question is provably finite and therefore decidable by
computation rather than approximable by sampling. Each produces a **diffable artifact** and fails with
a **counterexample path**, not a flaky seed.

### 1.0 Week-one kill-or-continue gate (do this before anything else in Phase 1)

- [ ] Enumerate the arms of `serverExpressionProvenance`
      (`packages/compiler/src/scan/security-operation-ir.ts:4331-4394`) and classify each as
      _compositional_ (depends only on subterm provenance values) or _syntax-dependent_. Expected:
      five compositional arms, one object-literal shape test, and two whole-subtree containment walks
      in the fallthrough. **Do not abandon on that result** — define the decided relation over the
      compositional core and model the fallthrough as one named nondeterministic oracle edge yielding
      `{local, foreign-executable, unknown-authority}`. If materially more arms inspect syntax, narrow
      the finite-state frame and record the narrowing in §4.5.

### 1.1 Reify and decide the provenance relation

**Execute as ONE slice with plan-2 §1.1's census — both extract rule-table-as-data from the same
file.** Today there is no declared partial order, no join, and no ⊑: joins are inlined per syntax form
(`:4366-4386`, `:4007-4017`), and `serverProvenanceCarriesAuthority` (`:4603-4612`) is a **5-element
negative denylist**, so a newly-added exempt constant silently widens the TCB with no test that would
notice. (~1.5 pm after §1.0)

- [ ] Emit `security-provenance-relation/v1.json`: the 37 server + 20 browser states
      (`scan/security-operation-ir.ts:72-104`), the **quotient** member alphabet (literal names +
      `databaseOperationKind` domain + `isRawDatabaseCapabilityMember` domain + `other`), the authority
      set, and the `State × MemberClass → State` table currently written as nested ifs (`:4456-4520`).
      Gate: the emitted state set equals the `ServerValueProvenance`/`BrowserValueProvenance` unions and
      `securityOperationKinds`; a new tag without a table row fails CI.
- [ ] Replace the authority denylist with a table-derived `p ⊑ authorityTop` test; verify with an
      exhaustive per-state test that old and new predicates agree element-by-element, then confirm a
      planted new element defaults to authority-bearing.
- [ ] **Exhaustive equivalence gate**: for every `(state, member-class)` pair assert
      `table[s][m] === serverMemberProvenance(s,m)`, asserting the executed pair count equals
      `|states| × |classes|` exactly, plus a mutated-cell negative test. Because the domain is finite
      this is a **proof** of table/implementation agreement, not a test of it.
- [ ] `check:provenance-closure`: least-fixpoint reachability from every authority state, asserting no
      path reaches a sink position except via an enrolled `operation:*` state with a C9 door owner, or
      via `unknown-authority` (which must always yield one of the 8 `SecuritySemanticClosedReason`
      values). Emit the reachability relation as a diffable artifact; fail with a counterexample path.

### 1.2 Decide the authorization correspondence for the shipped fragment

Guard and RLS are **two sources, and the framework knows it**. SQL is derived (`owner:` →
`col = current_setting('kovo.principal', true)` at `postgres-runtime.ts:7736`; `ownerVia:` → nested
EXISTS at `:7788-7833`). JS is not derived at all: `guards.owns(keyOf, ownsRow)` takes an arbitrary app
predicate and the framework stamps `staticProof: 'not-claimed'` (`guards.ts:860`). `guards.role()`
(`:791`) has **no SQL counterpart anywhere**, and `kovo.role` is written at `managed-db.ts:2912` and
**read by nothing** — exactly one non-test hit repo-wide. Exactly one hand-wired correspondence point
exists (`crossOwnerRead`'s admin `USING (true)` gated by `requestPassedRoleGuard`), proving the shape
is right and is currently hardcoded to one literal role. (~1–1.5 pm)

Confirmed divergence, expressible today, caught by nothing: `authzPolicy: sql\`org*id =
current_setting('kovo.principal', true) OR visibility = 'org'\``guarded by`all(authed, guards.role('billing'))`—`kovo.principal` is the \_user* id, so SQL admits by org while
the guard checks a role SQL never sees.

- [ ] **Freeze the emission door first** (cheap, pure anti-drift, worth doing standalone): a test
      enumerating the five and only five RLS-SQL emission sites — owner `:7736`, ownerVia `:7788-7833`,
      authzPolicy `:7767`, system `USING(true)` `:7877`, admin `USING(true)` `:7903`.
- [ ] **Ship the non-correspondence explain record second, not last**: place the generated RLS
      predicate text and the `explainGuard` audit facts side by side with status `unproven` for every
      table outside the decided fragment (hand `authzPolicy`, arbitrary `ownsRow`, system/admin
      `USING(true)`). Include the dead `kovo.role` fact as a first-class explain warning. Both halves
      already exist in the system and are simply never placed next to each other.
- [ ] Retarget `resolveProtectedPostgresTables` (`:7710-7778`) to build a 2-constructor algebra term
      and render SQL **from** the term; first proof obligation is byte-identity against today's
      predicate strings (already pinned by `postgres-runtime.test.ts` / `postgres-authz.test.ts`).
- [ ] Implement the three-valued Kleene denotation and an **exhaustive** enumerator over
      `{true,false,null}` per equality and `{present,absent,null}` per FK edge, up to the shipped
      recursion bound — a decision procedure, **no SMT solver**. Assert the model count equals the
      closed-form `3^k·3^e` per shape, and that it finds the injected NULL/unset over-permission case.
- [ ] Emit the framework-owned `ownsRow` from the same term and prove equivalence; a targeted
      regression must show the old hand-written mirror (`row.ownerId === req.session.userId`) reported
      as **divergent** under three-valued semantics.
- [ ] Close the SQL-side extraction gap against a real engine: a PGlite test materializes every
      enumerated model as rows under FORCE RLS with the actually-generated policy and asserts observed
      visibility equals the denotation for all models. Finite and enumerated, not sampled.

> Sequencing: the framework-generated `ownsRow` default is a **breaking change to a shipped public
> guard**. Land it as its own change _after_ the decision procedure is green — never bundled into it.

### 1.3 Grammar containment: a kABNF → DFA substrate

Build subset construction, complement, product, BFS emptiness, and shortest-counterexample extraction
on the existing `Ast`/`CharMatcher`/`CharRange` types in `internal/linear-regex`, with a hard state
budget that throws. (~0.5 pm for substrate + first obligation)

- [ ] **First obligation is disjointness, not SSRF**: prove
      `L(serializer output) ∩ L({CR, LF, NUL, quote-escape confusion}) = ∅` for `content-disposition.ts`
      and the `cookies.ts` `Set-Cookie` forwarding path — a 5-state dangerous DFA, no numeric grammar,
      no availability risk, retiring a review argument that today lives only in comments.
- [ ] **Then IPv4 only**: declare `rfc3986-IPv4address`, a hand-derived POSIX `inet_aton` grammar, and
      a declared model of what `parseLooseIpv4` accepts (`egress.ts:1101` knowingly accepts non-RFC
      spellings because the OS resolver does — currently a prose comment). Decide **both** directions,
      especially `L(inet_aton) \ L(kovo) = ∅`, the direct SSRF-to-metadata bypass nothing in the repo
      states today.
- [ ] Run as an **analysis gate against the declared model** for at least one green release before any
      generated recognizer is swapped into the SSRF floor. Swapping into the floor on an unproven
      substrate inverts the risk.

### 1.4 State the non-interference theorem Kovo actually intends

Kovo has three unrelated de facto label systems: confidentiality (`secret.ts` — a box with `map()` and
**no join**), integrity (`symbol-provenance.ts:12-19`, with a real `joinSymbolProvenance` at `:202`),
and authority (`security-operation-ir.ts:72/82`). SPEC states confidentiality purely as a sink rule
(`spec/10-data-plane.md:277`); there is no execution-level property anywhere. (~1.5 pm)

- [ ] Publish SPEC §10.x "label lattice + intended non-interference statement": define
      `L = Conf × Integ × Owner`, promote `joinSymbolProvenance` to the normative integrity join, and
      write the principal-indexed termination-insensitive sentence.
- [ ] `check:label-clause-map`: every confidentiality/integrity diagnostic (KV435, KV426, KV438,
      KV439, KV414, KV410, KV411) maps to a clause of the theorem; an unmapped one fails the gate.
      This converts "per-sink chokes" into "sinks that discharge a stated obligation".

---

## Phase 2 — Independently-checkable evidence

"1,247 tests passed" is not checkable by an outsider, and plan-2 §4.3's attestation proves _sameness_
over a digest, not correctness — it still requires trusting Kovo's analyzer. This phase exploits the
**search-vs-check asymmetry** (Abstraction-Carrying Code): finding an inductive invariant needs a
worklist, widening, budgets, and 39k lines; **checking that a supplied map is a post-fixpoint needs one
pass**. Requires §0.4 and §0.6 to mean anything.

### 2.0 Two-week kill gate — does module identity survive?

- [ ] Throwaway parser over the exact file list in `scripts/pack-security.files.json` for
      `@kovojs/better-auth` and `@kovojs/server`, reporting recovered module count and resolved import
      edges. **Target the published framework dist trees, not the app's bundled handler** — app-side
      module identity is destroyed by bundling. If edges do not resolve, **abandon the certificate
      entirely**.

### 2.1 `kovo.certificate/v1` and a standalone checker

- [ ] Freeze the schema over the published `@kovojs/*` dist trees:
      `{artifacts:[{path,sha512}], domain:<the 7 capability kinds>, cap:{module→kinds[]}, edges:[[m,n]],
roots:[{module,rootKind}], doors:[{module,site,escapeId}], opaque:[{module,reason}]}`, reusing
      verbatim the 7-member capability union already frozen at `packages/core/src/graph.ts:703-710` and
      the frozen `rootKind` union.
- [ ] Emit it alongside `dist/.kovo/graph.json`, with per-artifact sha512 computed exactly as
      `scripts/publish-packed-packages.mjs` computes tarball integrity.
- [ ] `@kovojs/verify` as a standalone checker: three linear obligations (coverage, post-fixpoint
      stability `cap[n] ⊆ cap[m]` per edge and `local(m) ⊆ cap[m]`, closure `cap[r] ⊆ doors(r)`) — no
      iteration, widening, budget, or recursion logic on the checker side. One pinned parser
      dependency, **zero Kovo imports**, mechanically enforced by extending `scripts/import-boundary.mjs`.
      Publish checker LOC and dependency closure as the honesty numbers.
- [ ] **Three negative controls that must fail on three distinct obligations**, checker importing zero
      Kovo code: (i) drop a capability from `cap[m]` that the module imports → _stability_ failure;
      (ii) inject `require('node:child_process')` into a shipped chunk without regenerating →
      _coverage_ failure; (iii) omit a real import edge → _coverage_ failure. If they do not fail
      cleanly, stop.
- [ ] Adequacy audit of the lexical authority table (the checker's true TCB): enumerate known-unmodeled
      authority routes (re-exported bindings, computed dynamic import, `eval`/`new Function`, host
      globals, native addons, WASM) and require each to be modeled or listed in §4.6.

### 2.2 Translation validation, folded into the same checker

Do not fund a second certificate format or a second checker.

- [ ] Re-derive the import-specifier set from the emitted `*.client.js` **text** and require it ⊆ the
      KV437 reviewed set (`packages/compiler/src/validate/client-capture.ts`). This closes the exact
      channel that gate's doc comment names ("lowering re-emits `import { STRIPE_SECRET_KEY }`
      verbatim"); the adversarial fixture already exists at `client-secret-capture.test.ts:38-50`. (~0.5 pm)
- [ ] Require the exact secret field names refused by `validateSecretQueryWire`
      (`compiler/src/validate/confidentiality.ts:16`) to be absent from emitted client and registry
      sources. (~0.5 pm)
- [ ] Emitted-artifact coverage guard: every file kind produced at `compiler/src/compile.ts:959-980`
      (server, client, css, registry) is covered by a relation or a reviewed exclusion list; a synthetic
      new kind fails the build until classified. (~0.25 pm)
- [ ] Serialization-integrity only (**not** body re-derivation): assert the operation-kind multiset in
      `__kovoSecurityOperationManifest_v1` (`emit/server-render.ts:107-127`) and each
      `securityHandler([...])` call (`emit/client.ts:957`) parses out of the emitted text as own-data
      JSON, is drawn only from the frozen vocabularies, and equals the decision record. (~0.5 pm)

### 2.3 Structural code emission

Three correct patterns already exist in isolation (`propertyKey` at `drizzle/src/derive-codegen.ts:425`,
`buildSecuritySourceLiteral` at `server/src/build-security-intrinsics.ts:511`, `quoteSqliteIdentifier`
at `server/src/sqlite.ts:1583`) but are not a shared door.

- [ ] **First, a hostile-emission oracle**: assert the emitted _parse tree_ confines each hostile value
      to one leaf. It must go red today on `derive-codegen.ts:179`, or the harness is wrong.
- [ ] Promote the three patterns into one module (`jsStringLiteral`/`jsIdentifier`/`tsPropertyKey`/
      `importSpecifier`), each grammar-validated and fail-closed with a KV; migrate
      `derive-codegen.ts:68/89/179` and `emit/registry.ts:284`; add `check:emission-constructor-closure`
      modeled on `source-reparse-boundary.test.ts:28`'s allowlist gate.

---

## Phase 3 — Bound the untrusted periphery

Every remaining guarantee is a conditional whose antecedent is a set of parties Kovo does not control.
This phase converts them into bounded, machine-checked, fail-closed constructs. These items carry the
largest gap between what Kovo says it is **for** (`site/PRODUCT.md` names AI-agent builders as a strong
secondary audience) and what it **proves** (`spec/06-type-system.md:292` explicitly disclaims
prompt-injection immunity and defers to "future capability-bounded tool adapters" — a named future
surface nobody owns, while `spec/04-component-model.md:480-507` already ships an LLM-authored-rich-text
path, so model output is **already** a live ingress).

### 3.1 Capability-bounded agent mediation (~2 pm)

- [ ] A framework-owned `tool()` door that is the **only** path from a model action to an effect,
      lowering to plan-1 L2's finite operation set so the tool vocabulary is census-derived (a
      hand-registered vocabulary drifts immediately and makes the theorem vacuous).
- [ ] Every tool call runs the **same** guard chain and RLS principal pinning as an HTTP mutation — the
      model never receives an ambient service principal, making cross-tenant model exfiltration
      _inexpressible_ rather than prompt-mitigated. Models invoked outside the door are a KV **compile
      error**, not a warning.
- [ ] Monotone attenuation over a 3–4 level integrity lattice: once low-integrity retrieved or
      tool-returned content enters context, high-authority tools are removed from the offered set for
      the rest of the session — a decidable per-turn check, **no content classifier**. Add
      `kovo explain --agent` printing the exact effect closure a session can reach.
- [ ] Honest claim, in SPEC: no action exceeds the invoking principal's authority and injected content
      cannot _raise_ authority. It does **not** prevent an authorized-but-undesired action.

### 3.2 Grant-graph safety (~1.5–2 pm)

§1.2 decides guard ≡ RLS for a **fixed** policy. But `spec/10-data-plane.md:193` requires team/org
membership to be modeled as an `owner`/`ownerVia`/`authzPolicy` table — so the policy **state is itself
app-mutable data**, and the hard part is handed to the app. Guard≡RLS can be perfectly proven while a
member-role principal executes a legal write that makes them an owner.

- [ ] Derive a grant model (principals, resources, right-kinds, delegation edges) from the annotations
      that already exist, so it cannot drift from the schema.
- [ ] Enumerate every mutation whose declared write scope intersects an authz-bearing table; those are
      the transition rules. Restrict to a monotone/attenuating fragment where the HRU safe-state
      question is decidable; bounded-model-check it; **fail closed to ⊤ for any write the analyzer
      cannot classify**.
- [ ] Delegation and impersonation as first-class **attenuating** constructs (`onBehalfOf` yielding a
      provably subset right-set, carrying plan-2 §3.3's epoch so revocation propagates) — `owns()` is
      explicitly single-hop today and impersonation/support-access appears nowhere in SPEC. Grant edges
      outside the fragment become named budgeted escapes in `kovo explain --grants`.

### 3.3 Assume-guarantee deployment contract (~1–1.5 pm)

`grep -i 'assumption' SPEC.md` returns nothing, yet the boundary is demonstrably shared:
`spec/09-wire-protocol.md:223-231` already carries an ad-hoc forwarded-scheme operator contract and
§6.6 rule (6) already carves out host preload / `NODE_OPTIONS`.

- [ ] Give every guarantee a machine-readable **antecedent**, derived from the doors that _consume_
      those environment facts (sole occupant of the registrable domain, exactly-N trusted proxy hops
      with a pinned edge, no non-Kovo writer on the schema, TLS terminator identity, no shared cache,
      bootstrap order) — plan-2's derive-don't-author rule applied to assumptions.
- [ ] `kovo check env`: discharge what is probeable, print the rest as **retained obligations** naming
      the exact guarantees they suspend.
- [ ] A composition operator for the two real cases: Kovo × Kovo on a shared registrable domain (cookie
      tossing defeats CSRF binding regardless of how well the mint door is proven), and Kovo mounted
      under a foreign host — with a `mounted` posture that refuses to claim what it cannot own.

### 3.4 Derived-dataset authorization inheritance (~1–1.5 pm; needs plan-2 §3.1 ScopedKey)

Kovo's confidentiality claim anchors on the database being **the** door, but data routinely leaves it
into artifacts carrying no predicate: search indexes, denormalized caches, CSV exports, error-tracker
payloads, warehouse tables, and — most acutely for Kovo's AI audience — vector/embedding stores.

- [ ] A compile-time KV: "owner-scoped/governed row reaches a persistent non-engine sink", fail-closed
      over plan-1's existing provenance engine using C9's sink inventory as the sink vocabulary — no
      new analysis machinery.
- [ ] A `derived()` door requiring the inherited scope key to be part of the artifact's identity
      (composing with ScopedKey), so a per-tenant vector/index namespace is the **default**, and reads
      are re-scoped by the same principal binding as a DB read. **Ship the RAG/vector-store case first.**

### 3.5 App-dependency authority attenuation (~1–1.5 pm)

`rules/dependency-policy.md` is well-built but governs **only** Kovo's own `trustedDependencySurfaces`.
The app's dependency graph — far larger, far less curated — has no policy at all.

- [ ] Derive a per-dependency capability manifest from plan-1 L1's module-graph census and enforce it
      at the loader/import path, so the build-time census becomes a **runtime bound**. Label as
      fail-closed floor / defense-in-depth per §6.6 rule (3), **never** by-construction.
- [ ] Deny-by-default lifecycle-script policy generated by `create-kovo`.

---

## Phase 4 — Ledger the trusted: erosion control and honest boundaries

**Proofs do not get falsified; they get escaped.** `packages/server/src/audit-justification.ts` is 53
lines and accepts any non-empty printable trimmed string ≤4096 chars free of control/bidi characters —
that is the **entire** semantic bar on `trustedAssign(input.x, reason)`, the KV438 escape that lands
raw request input on a governed column. An LLM agent under a "make check pass" objective clears that
bar on the first attempt. Nothing in plan-1 or plan-2 counts, trends, or ratchets escapes; no
`scripts/*escape*` gate exists.

### 4.1 Escape census and ratchet — metric E (**start here; ~0.5 pm**)

- [ ] Read-only script over the existing `securitySemanticGraph` on `ComponentExplain`
      (`packages/core/src/graph.ts`) plus the trust-escape rows already formatted by `trustEscapeLine`
      (`packages/cli/src/graph-explain-format.ts:755-765`), counting escaped **roots** reached per app
      and per door for `trustedHtml` / `trustedSql` / `ctx.fetch` plus `csrf: false` /
      `kovoAnalyzerSummary` / `allowControlChars`.
- [ ] Per-package escape budgets with a monotone ratchet, so escape growth is structurally impossible
      rather than merely graphed.

### 4.2 Structured obligations replacing free-text justifications

- [ ] At the `audit-justification.ts` chokepoint, replace prose with fields the analyzer can partially
      check — _which invariant, why it holds, what evidence_ — killing the prose-laundering path.
- [ ] Escape signatures over `(site identity, obligation text, artifact/emission hash)` from a key
      **not** present in the build environment or reachable by a coding agent, composing with plan-2
      §4.3's attestation anchor (**do not establish a second trust anchor** — if §4.3 has not landed,
      ship the census, ratchet, and structured obligations and defer the signature). Honest label: a
      process guarantee that a second party reviewed it, not a proof the justification is true.

### 4.3 Cost-to-green

- [ ] Measure `cost-to-green(safe) − cost-to-green(escape)` per diagnostic on an **agent-authored**
      corpus, and add `kovo fix` safe rewrites whose result the analyzer proves discharges the
      obligation. Any diagnostic where escaping is cheaper is a **framework defect with an owner**.
      Start with the two highest-traffic codes.

### 4.4 Declassification as a typed, robust, capability-gated door

`reveal(reason)` declassifies unconditionally; `validateRevealReason` requires only a non-empty trimmed
string. `trustedReveal` is self-declared `method:'arbitrary-fn'`. `drainSecretRevealAuditFacts` is
documented as a bounded (newest 256) **destructive** drain — explicitly not a complete record. (~2 pm)

- [ ] Versioned census of every declassification site (the 17 non-test `.reveal`/`revealSecret`/
      `trustedReveal`/`revealUntrusted` sites plus `serverValue`, `trustedAssign`, `publishToClient`),
      re-derived from source by a gate that fails on drift.
- [ ] Replace `SecretRevealReason` (a string) with a typed `DeclassifyPolicy = closed-registry purpose ×
door id × owner scope`; `reveal('some string')` must stop typechecking.
- [ ] Robustness rule over the existing security IR: a declassify node whose **enabling condition or
      released expression** carries `Integ ⊒ input` is an error, fail-closed on unknown. Two corpus
      fixtures (attacker-chosen condition, attacker-chosen value) must both be rejected.
- [ ] Make the declassification door an L1 capability so untrusted-reachable modules cannot import it.

### 4.5 Precision-grant register (the extraction-gap deliverable)

Replaces a `ts.SyntaxKind` totality sweep, which would be theatre.

- [ ] One row per site in the provenance extractor returning anything **other than**
      `unknown-authority` — required for the two fallthrough containment walks and the object-literal
      shape test — each carrying an owner and a written JS-semantics witness ("`context.header` cannot
      return a capability because…"). Gate on zero ownerless rows.
- [ ] Point plan-2 §1.1's generator at exactly this register: sampling is the right tool for the
      obligations a decision procedure cannot discharge.

### 4.6 Undecidability ledger (~0.75–1 pm)

- [ ] `security/analyzable-fragment.json`: one row per prohibition in SPEC §6.6's transfer-semantics
      paragraph (returning/throwing authority, opaque container, mutating an authority alias,
      mutable/ambiguous join, unsummarized nested callable, `arguments`/rest/spread recovery,
      `call`/`apply`/`bind`, imported/computed/aliased/reassigned/unresolved callable), each classified
      `FUNDAMENTAL | DELIBERATE | BUDGETED`, mapped to one of the exactly-8 closed reasons, each with a
      witness fixture that actually emits KV449 with that reason. **Generate the SPEC §6.6 prohibition
      table from this file.**
- [ ] Record budget-bindingness: do the 16 / 50 000 / 4 096 / 256 budgets (`:1511-1514`) ever bind on a
      real root?
- [ ] A reviewed prose compositionality/adequacy argument checked into `spec/`, explicitly labelled a
      **hand argument** — the deliberate substitute for a mechanized adequacy proof.

This ledger is the single sentence Kovo cannot say today: _"here is precisely what we will never prove,
and why each item is on that list."_ It is a prerequisite for honest publication of every Phase-1 result.

---

## Phase 5 — The security program owed downstream

Explicitly **not** proof. Deliberately last for the parts requiring key custody, because for a
technical-preview framework with essentially no downstream deployments the signed-feed machinery has
near-zero present value — while §0.5's process half is nearly free and is a live defect.

### 5.1 Retrospective answerability (~1 pm, mostly composition)

- [ ] State and enforce a **completeness property** for plan-2 §4.3's security-event record using the
      same single-door + emission-coverage-recorder technique plan-2 §1.2 applies to KV emission, so
      "an authorization decision without a record" is a **build failure**, not an ops gap. The record
      carries principal, epoch, build-stable decision-site identity, and resource scope — and **no
      payload data**.
- [ ] `kovo incident scope <advisory>`: replay an advisory's decision-site predicate against the
      append-only tamper-evident record to return the affected principal/tenant set. It must report
      "unanswerable within the covered doors" rather than "no impact" when an exploit never crossed a
      Kovo decision door.

### 5.2 Advisories (deferred until a real advisory exists or v1 freeze approaches)

- [ ] `kovo.security.advisory/v1` (id, severity, affectedRange, fixedIn, `retracts[]` naming the
      falsified `SECURITY.md` guarantees, `tcbChokes[]`, graphSchemaVersion) — **version ranges only**,
      no applicability predicates (see kill list).
- [ ] `kovo check advisories` returning AFFECTED / NOT-AFFECTED / UNKNOWN, exiting non-zero on
      AFFECTED-at-or-above-floor **and on every UNKNOWN condition** (unreachable feed, stale beyond
      `maxFeedAge`, epoch rollback, unverifiable signature).
- [ ] Fire drill: publish a test advisory, confirm a real example app reports AFFECTED, ship the fix,
      confirm NOT-AFFECTED, delete the feed and confirm UNKNOWN **fails closed**. Record all three exit
      codes. Do not start before the key-custody answer exists — OIDC/Sigstore keyless bound to the
      release workflow, never a long-lived team-held private key.

### 5.3 Inherited-auth honesty (~0.55 pm)

- [ ] `lifecycle-inheritance.test.ts` characterizing the Better Auth defaults Kovo silently accepts
      (`sqlite.ts:219-242` / `postgres.ts:253-270` declare no `session:` key at all): effective
      `expiresIn`/`updateAge`/`freshAge`/`cookieCache`, and whether the session identifier rotates
      across `signIn` with a pre-existing cookie. Narrow the peer range at
      `packages/better-auth/package.json:46` from `^1.6.0` to `=1.6.17` with a `check:auth-provider-pin`
      gate.
- [ ] Explicit non-claim in SPEC §6.6 and `kovo explain`: Kovo owns exactly **three** identity
      transitions (signIn, signOut, dev-only seed signUp); every other lifecycle event is structurally
      unreachable (`mount.ts:23-28` GET-only) and therefore **unsupported, not guaranteed**.

### 5.4 Residency and erasure (needs plan-2 §3.1 ScopedKey)

- [ ] A required `residency` field on `SourceSinkInventoryEntry`
      (`packages/core/src/internal/source-sink-registry.ts:20-38`) with values
      `none | db-owner | ledger | adapter-enumerable | unerasable:<reason>`, enforced fail-closed by the
      existing `check:c9-sink-inventory`, publishing the `unerasable` count as a metric that **must
      start non-zero**. Converts an unknown into a counted, named, spec-visible hole. (~2 weeks)
- [ ] `erasePrincipal(p)` with a signed receipt and a **mandatory absence probe** (re-enumerate the
      scope; non-empty **fails** the erasure, does not warn), for the three sinks that provably cannot
      self-enumerate today: blobs (`StorageCapability` has no list operation), `_kovo_jobs.args` (no
      principal column), and replay `response_body` (scoped by CSRF rotation binding, never by
      principal). The replay principal dimension must be a **non-authoritative additive index column**
      that never enters `mutationReplayScope()` composition.

---

## Phase 6 — Optional bounded model checking (fund only after Phase 1 pays)

One model, not three, and only for the protocol where a wrong interleaving means money moves twice.
TLA+ is a real learning cost nobody on the team has paid.

- [ ] `formal/ReplayReservation.tla` + `.cfg` at R=2 replicas, N=2 slots, 2 identities, one backward
      clock step, one crash point: no double execute; refuse-never-evict; monotone `reclaimedThrough` /
      no resurrection; bounded admission. (~0.75 pm)
- [ ] **Mandatory faithfulness gate in the same commit**: broken variants reproducing the historical
      hazards narrated at `packages/server/src/replay.ts:280-296` (evict-pending, A6/M4) and a
      naive-watermark variant vs the GREATEST advance at `postgres-replay.ts:299`, each yielding a
      committed counterexample under `formal/replay/counterexamples/`. **If those variants do not
      produce counterexamples, the model is not faithful and the item stops there.**
- [ ] `scripts/check-protocol-alphabet.mjs` (the cheap, high-certainty anti-rot half — ship it even if
      the model never does): every SQL string touching `_kovo_replay`, `_kovo_replay_reclaimed`,
      `_kovo_jobs` maps to a named model action, and the status literals equal the model's constants.
      Fails the build on a sixth CTE or a new job status. (~0.35 pm)
- [ ] Honesty-boundary gate: SPEC text + `kovo explain` listing the Postgres-atomicity axiom (each CTE
      modeled as one atomic action, justified by the `FOR UPDATE` on the watermark row — a **human
      assumption**, not a verified one), the bounded scope, and the explicit not-modeled list, with a
      gate asserting that list is the complement of the registered model set.

---

## Convergence measurements

Extends plan-1's R/M/P/G and plan-2's D/W with the two things this plan is actually about:

- **E — escape authority.** Escaped roots reached, per app and per door, with a monotone per-package
  ratchet. This is the cheapest instrument for the failure mode that governs every proof in all three
  plans: **proofs get escaped, not falsified**. Target: monotonically decreasing, zero unsigned escapes.
- **Δ — decided surface.** Fraction of each finite security domain closed by a decision procedure
  rather than a test: provenance transition pairs decided / total; policy-fragment models enumerated /
  closed-form count; grammar obligations decided. Target: 100% of each _declared_ fragment, with
  everything outside it carrying a row in §4.5 or §4.6.

Metric **F** (fragment coverage over `examples/*` with confidence intervals) is deliberately **not**
adopted: `examples/*` are written by the framework's own authors who have internalized the fragment, so
a within-corpus statistic published as coverage is dishonest.

## Exit

- [ ] §0 fully landed: defects fixed with real-Postgres regressions, process artifacts live, hermetic
      stage green, provenance stamp emitted.
- [ ] §1 produces at least two decided results with committed diffable relation artifacts, each
      publishing its domain, bound, and extraction gap.
- [ ] §4.5 and §4.6 have zero ownerless rows, and SPEC §6.6's prohibition table is **generated** from
      the undecidability ledger.
- [ ] Metric E ratcheting downward for three consecutive comparable rounds; Δ at 100% of every declared
      fragment.
- [ ] An outside party validates a `kovo.certificate/v1` with disjoint code, and the three negative
      controls fail on three distinct obligations.
- [ ] Each bounded periphery party (§3) has a fail-closed door plus a printed retained-obligation set;
      `kovo check env` discharges what it can and names what it suspends.
- [ ] A fire drill returns AFFECTED → fixed → NOT-AFFECTED → UNKNOWN-fails-closed.
- [ ] `rules/v1-acceptance.md` cites the decided fragments, the undecidability ledger, and metric E —
      without claiming immunity outside the scoped threat model.

## Kill list (normative — do not attempt)

Impressive-sounding work that would consume the budget and return little. A plan that cannot be
executed is worse than no plan.

- **Verifying the analyzer, compiler, or framework in Coq/Rocq/Lean.** 39k lines of raw-AST reasoning
  under active refactor is not a mechanization target for a small preview team.
- **A Lean 4 adequacy proof of a core calculus** (3–4 pm, requires real Lean experience nobody has).
  Replaced by §4.6's reviewed prose argument, explicitly labelled a hand argument. Revisit only if Lean
  competence ever exists.
- **Z3 or any SMT solver as a shipped/CI dependency.** The authorization fragment is EUF over string
  equalities with bounded existentials and a finite three-valued domain — **exhaustive enumeration is
  the decision procedure**. A solver collides head-on with plan-2 §1.3's analysis-time TCB shrink.
- **A TLA+ trace-conformance harness.** The least standard piece, likeliest to overrun, likeliest to end
  up vacuous — concurrency bugs live in rare interleavings and CI rarely produces rare interleavings.
  The alphabet lock (§6) delivers most of the drift protection for a fifth of the cost.
- **`TaskLease.tla` and a CSRF spec.** Converting `check:csrf-mint-delivery`'s enumerated table into a
  derived relation is a refactor of a _passing_ gate.
- **A second rule-table extraction parallel to plan-2 §1.1**, and the derivation-directed bounded
  enumerator — a sampling-strategy variant of an object plan-2 already owns.
- **The full automata/transducer library, per-build emission-derivation certificates, and a
  parse-tree-isomorphism verifier** (~3.5 pm). Duplicates §2's checker. Keep the shared emission
  constructor and, at most, one exhaustive finite-alphabet obligation.
- **Migrating `emitDerive`** (`lower/structural-jsx.ts:4738`) to the emission-constructor module. Its own
  doc comment documents byte-significant call-site shape differences; it is the hottest compiler path
  under a byte-exact corpus. A separate, later, explicitly-decided change.
- **Re-deriving operation sets from emitted handler body text**, and full server-side semantic-graph
  re-derivation. The emitted body language is not closed yet, and re-deriving the analyzer's own
  provenance is common-mode and therefore worthless as independent evidence.
- **Applicability predicates in advisories** (~2–3 pm). They depend on vocabularies neither plan has
  stabilized, and a mis-scoped predicate produces a **confident false negative** — strictly worse for
  users than "upgrade everything".
- **The signed advisory feed before v1 freeze.** Near-zero present value with no downstream deployments.
- **The end-of-request fact-watermark assertion.** It changes the per-statement transaction granularity
  at `managed-db.ts:2285` that the RLS `SET LOCAL` frame depends on — the most security-sensitive code
  in the repo.
- **A 6-archetype × 5-asset adversary-asset closure generating `docs/security-threat-matrix.md` from a
  reachability graph.** Inverting a 28-cell prose table that three plans and v1 gate 16.9 depend on,
  against a graph whose edge semantics are unproven.
- **An Alloy/TLA+ residency closure model**, and a `personal:`/`retention:` annotation vocabulary.
  Residency closure is finite graph reachability — a normal CI test. New annotations drag a full C13
  corpus per KV.
- **A formal identity-lifecycle model.** Kovo owns three identity transitions and structurally makes the
  rest unreachable; §5.3's characterization suite plus a version pin is the grounded core.
- **IPv6 grammars in the containment MVC.** RFC 4291/3986 IPv6 plus embedded-IPv4 tail plus %-scope is
  where DFA state blowup concentrates, and the known divergence lives entirely in IPv4.
- **Metric F** (see above).
- **A second security-event door, capability census, escape ledger, or trust anchor** parallel to
  anything plan-2 owns.
