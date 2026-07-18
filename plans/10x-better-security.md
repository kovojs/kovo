# 10x Better Security — Convergence Plan

Status: ACTIVE (revised 2026-07-18). This is the class-kill and convergence roadmap layered on
top of `plans/threat-matrix-plan.md`, which owns the scoped coverage matrix. Transient bug ledgers
may reproduce individual findings, but this plan accepts work only when it removes a class of
bypass, builds a forcing gate, or adds an independent oracle.

## Authority, scope, and honesty boundary

`SPEC.md` and its incorporated `spec/*.md` modules remain normative. This plan may propose a
SPEC change, but it must identify that change explicitly and land the normative text with the
implementation. Security-classifier migrations obey
`rules/security-classifier-refactors.md` C13; compiler work obeys
`rules/compiler-hard-rules.md`; v1 claims obey `rules/v1-acceptance.md`.

The scoped threat model is ordinary framework exposure: remote users, hostile request/body/header
values, browser and intermediary differentials, deployment/adaptor mistakes, compromised
untrusted data reaching app logic, and supported framework integrations. Intentionally malicious
same-process app/host code, pre-bootstrap loader compromise, and hostile same-realm intrinsic
poisoning are outside the app-level proof described by SPEC §6.6. Runtime floors may reduce their
impact, but Kovo does not claim to be a JavaScript process sandbox.

The exit state is **scoped v1 security signoff**, not a claim that no vulnerability can ever exist.
Every residual and out-of-scope cell must remain explicit in the threat matrix.

## Diagnosis

Kovo's guarantee is categorical—unsafe classes should be inexpressible or fail closed—but several
load-bearing analyzers still buy one syntactic case at a time. The largest current example,
`packages/drizzle/src/trust-escapes-static.ts`, is 38,479 lines. The egress IP corpus and
imperative-DOM sink lexicon similarly grow with newly observed encodings or names. Repeated
Better Auth, CSRF, request-authority, and authorization findings show that regression tests alone
do not establish door completeness.

The 2026-07-17 seed audit recorded 29 vulnerability-exposing commits under an uncontrolled audit
budget. That number is historical context, not a comparable KPI. Phase 0 must rebase every premise
on an exact commit: `test:authz-paranoid`, the grant-shape fuzzer,
`egress.allowDestinations`, the response-lifecycle CSRF sink, and the C9 inventory already exist
in some form, while their docs and finding ledgers are not consistently reconciled.

What should not be rebuilt without a reproduced gap: the core CSRF token/Origin floor, engine
authorization posture, request-carrier reconstruction, and existing framework-owned
`allowDestinations` egress path. The work below first proves their current state, then replaces
only the remaining enumerative or incomplete boundary.

## Architectural decision: layered closure

No single JavaScript analyzer is the security architecture. Kovo uses four layers, in order:

1. **Capability-closed module graph.** Untrusted-data-reachable modules cannot acquire raw network,
   filesystem, process, worker, VM, or database-driver authority. Reviewed framework capabilities
   are the normal doors. Transitive imports, re-exports, dynamic loading, conditional exports,
   globals, and reviewed package summaries are part of the graph.
2. **Finite compiler-owned security IR.** Security-critical browser and structured server effects
   lower from app-authored TSX/JSX into a small reviewed operation set. Apps do not hand-author
   lowered IR (SPEC §5.2). An operation outside the set fails closed or uses a named audited escape.
3. **Narrow abstract interpretation.** Cross-helper provenance that cannot be expressed by the
   first two layers runs over normalized semantic IR/SSA-like facts, not an expanding collection
   of raw-AST patterns. Its supported semantics, summaries, resource budgets, and closed verdicts
   are explicit. Opaque calls, unsupported constructs, and exhausted budgets fail closed.
4. **Runtime sink floors.** DNS/IP resolution, SQL engine posture, header/cookie reconstruction,
   response lifecycles, and similar facts that cannot be statically established are classified and
   pinned or reconstructed at the real sink. TypeScript brands and sentinels are ergonomics and
   defense-in-depth, never the enforcement proof.

The module graph removes capabilities that should never exist; finite IR covers the ordinary safe
path; abstract interpretation is the last static resort; runtime floors own unavoidable dynamic
facts. A “covers 90%” result is not a proof. Every prior closed verdict must remain closed under
C13, and every residual must have a named door or explicit out-of-scope disposition.

## Convergence measurements

Measurements are versioned and reproducible:

- **R — new root-cause findings per fixed audit charter.** Record the exact SHA, scope, prompts,
  investigator/agent count, elapsed budget, severity, and deduplication decision. Seeded canaries
  verify that the round was capable of finding known defects.
- **M — forcing-gate strength.** Record seeded-canary recall and the security mutation kill rate.
  A missing regression anchor is never rewarded; new C13 anchors remain positive evidence.
- **P — enumerative proof obligations.** Track the number of remaining per-syntax/per-name
  classifier branches and opaque allow paths across the complete implementation, not LOC in one
  file. LOC remains informational only.
- **G — green-corpus usability.** Record accepted real apps/fixtures, build time, peak memory, and
  the number of unjustified closed verdicts so fail-closed analysis does not become unusable.

## Phase 0 — Exact-state reconciliation and stable starting point

- [x] Record the exact implementation baseline SHA and reconcile code, SPEC/rules,
      `docs/v1-acceptance-ledger.md`, `plans/claude-bugz-32.md`,
      `plans/bugz-33.md`, and the threat matrix. Classify each apparent open item as fixed with
      current proof, still open, superseded, or honestly out of scope.
  - Evidence: baseline `a6dae7223`; the reconciled ledgers close stale B1–B4/M1–M34 claims, retain
    external audit/retest and matrix-liveness work as open, and align gate 16.9 with current code.
- [x] Run `pnpm run test:authz-paranoid` against a real external Postgres toolchain and record
      which cases executed or skipped. A green run containing skipped required Postgres cases is
      not acceptance evidence.
  - Evidence: clean `a6dae7223`, local PostgreSQL toolchain, 2 files and 7/7 tests passed in 653.48s;
    all three real-Postgres served-artifact cases executed and zero tests skipped.
- [x] Reproduce or close every unintegrated ordinary-threat finding at the baseline, including the
      HTTP/2 method-case differential currently carried by test-only commit `6abd0f36b`, and
      route confirmed findings through the threat matrix before architectural work proceeds.
  - Evidence: `1a943de8d` closes M34 across real HTTP/2, live/generated Node, and Vercel; SPEC §9.5,
    `plans/bugz-33.md`, and `docs/security-threat-matrix.md` record the rule and proof. The ensuing
    fixed-charter audit found M35 (`R=1` at `e5f613be9`); `766aa8c57` closes its authority-identity
    root cause across the same real-wire/live/generated surfaces and enrolls the verdict in C13.
- [ ] Restore the exact baseline to green local gates and `origin/main` CI/Pages, integrating the
      already-verified fixture/runtime checkpoints without weakening production classifiers.
- [x] Consolidate completed security plans through an explicit security-ledger index. Update the
      dogfood/find-bugz workflows to permit transient finding ledgers with an archive deadline;
      do not enforce “exactly two files” through filename guessing.
  - Evidence: `333d22909`; `pnpm run check:security-ledger-index` validates five explicit active
    roadmaps, transient lifecycle/deadlines, and four deduplication series; its focused suite passes
    9/9, and the three security workflow skills use the registry instead of filename counts.
- [x] Add a reproducible baseline command/report for R, M, P, G, classifier-corpus anchors, and
      informational LOC. Record the first comparable row in the table below.
  - Evidence: `f7a82a75c` adds the fixed charter, exact audit-round record, deterministic collector,
    six-test gate, and report; `b3de9e512` preserves the immutable e5 row while refreshing the
    post-M35 structural snapshot; `497f6eee6` refreshes it after the bounded-diamond repair.
    `pnpm run check:security-convergence-baseline` passes with M=37, P=5,958, G=18, and
    C13=17/144. The immutable comparable e5 row remains P=5,956 below.

## Phase 1 — Make the forcing gates non-skippable

- [x] Convert v1 gate 16.9 from a partially conditional harness into a fail-closed acceptance gate:
      missing real Postgres tooling or a skipped required case fails `test:authz-paranoid`.
  - Evidence: `4ce67820f`; the dedicated runtime-gate suite passes 3/3, a deliberately stripped
    PostgreSQL toolchain exits nonzero under `KOVO_PARANOID=1`, and all three required served-
    artifact cases must report completion before the suite can pass.
- [x] Define and execute a deterministic, replayable authorization matrix across principal,
      ownership, operation, query family, `readonlyAppDb`, endpoint, durable-task, webhook,
      view/function, and raw-SQL surfaces. Persist failing seeds and minimized repros.
  - Evidence: `9ad7927de`; `pnpm run check:authorization-matrix` proves 28 cases, 34 required
    dimension values, five canaries, deterministic replay, and persisted minimized repros; the
    real-Postgres paranoid run executed all 28 cells with 7/7 tests and zero skips.
- [x] Prove the engine-closure and least-privilege invariants in the same served-artifact run:
      every app-role-reachable object is safe or boot refuses, and runtime authority is neither
      superuser nor `BYPASSRLS` nor able to assume the provision role.
  - Evidence: the same 7/7 served-artifact run exercises safe closure plus boot refusal for unsafe
    tables/views/functions and proves the runtime role is non-superuser, non-`BYPASSRLS`, and
    unable to assume the provision role.
- [x] Add seeded security mutations/canaries for the major class guarantees and make the gate fail
      when a canary survives. Record recall and mutation-kill results as M.
  - Evidence: `pnpm run check:security-gate-mutations` kills 42/42 mutants, including all five
    authorization canaries; the rebased focused forcing-gate suites pass 12/12.
- [x] Reconcile `rules/v1-acceptance.md`, `docs/v1-acceptance-ledger.md`, and the historical
      B1–B4 finding ledgers with current executed evidence.
  - Evidence: `e5f613be9`; gate 16.9, the acceptance ledger, `plans/claude-bugz-32.md`, and the
    threat-matrix plan now distinguish executed local proof from still-open external/freeze work.

## Phase 2 — Build the shared structural substrate

### 2A. Capability-closed module graph

- [x] Define the complete untrusted-data-reachable root census: routes, layouts, mutations,
      queries, endpoints, webhooks, durable/scheduled tasks, serialized browser handlers, and
      supported agent/tool callbacks.
  - Evidence: `159f1a141`; `capability-closure.security.test.ts` proves all ten root kinds, and the
    integrated six-file suite passes 134 tests with one intentional skip.
- [x] Build transitive capability closure across imports, re-exports, local wrappers, dynamic
      `import()`/`require()`, conditional package exports, globals, and callback/container
      transfers. Raw network, filesystem, process, VM, worker, and database-driver capabilities
      are unavailable unless a reviewed framework door explicitly supplies one.
  - Evidence: the same suite closes wrappers, re-exports, dynamic loading, globals, callback and
    container transfers across all seven raw capability kinds; C13 passes with 18 corpora.
- [x] Define versioned, least-authority package summaries. An absent, stale, contradictory, or
      unresolved summary fails closed; package upgrades cannot silently retain an old verdict.
  - Evidence: `capability-closure-packages.test.ts` pins schema/version, package version, canonical
    manifest fingerprint, conditional export arms, and fail-closed stale/absent verdicts.
- [x] Prove closure with adversarial wrapper/re-export/conditional/dynamic-loading fixtures and
      with positive fixtures for each supported framework capability. Emit a provenance path in
      diagnostics and `kovo explain`.
  - Evidence: `990f0c87a`; the adversarial/positive closure suite and `kovo explain
    --capabilities` provenance tests pass, alongside API/import/census/spec/pack/build gates.

### 2B. Finite compiler-owned security IR

- [x] Specify the finite operation set for serialized browser handlers and structured server
      effects, including ordinary DOM state/focus/dialog/form operations, framework egress,
      database actions, redirects, cookies, headers, and response outcomes.
  - Evidence: SPEC §4.3/§5.2/§6.6 defines the exact effect/control union; `pnpm run
    check:c9-sink-inventory` proves one C9 owner per operation.
- [x] Lower app-authored TSX/JSX to compiler-owned security IR while preserving authorable-source
      and fixpoint obligations. No public or hand-authored lowered-IR escape is introduced.
  - Evidence: `security-operation-ir.security.test.ts` proves generated browser/server manifests,
    all five server-root families, and inline plus exact same-file referenced handlers.
- [x] Reject unknown operations and raw capability/DOM escapes with stable diagnostics; route
      legitimate exceptional operations through named, justified, `kovo explain`-visible escapes.
  - Evidence: `pnpm run check:security-classifier-corpus` passes 20 corpora, including unknown/raw
    terminals, opaque roots, query writes, exceptional doors, and root-linked local-call edges.
- [x] Run realistic green applications and browser workflows to prove the safe operation set is
      sufficient without weakening unknown-operation closure.
  - Evidence: `pnpm run check:green-corpus` passes 18 rows; gallery materialization and the generated
    command-dialog/toast browser workflow pass. Root-linked `server.helper.call` records preserve,
    but do not discharge, the Phase 2C bottom-up summary obligation.

### 2C. Narrow normalized abstract interpretation

- [ ] Define the normalized semantic graph and the minimum facts still requiring value-flow
      analysis after 2A/2B. Consume every root-linked `server.helper.call` with a bottom-up semantic
      summary; document transfer semantics, alias/mutation rules, recursion/state budgets, and the
      exact closed verdict for every unsupported condition.
- [ ] Implement provenance over normalized operations rather than raw syntax shapes. Diagnostic
      output must show the root, transfer path, sink, and reason an opaque/budget verdict closed.
- [ ] Commit the full C13 corpus before migration; preserve every historical reject/non-public/
      secret verdict and add security mutations that delete or invert each new semantic rule.
- [ ] Remove only predicates proven superseded by the normalized engine. Record P across all moved
      modules and G across real fixtures; do not claim success from moving LOC elsewhere.
- [ ] Apply the substrate to OPP-28 only where principal-to-predicate correspondence is structurally
      provable. Re-scope the remainder to an explicit audit/engine responsibility instead of
      overclaiming full JavaScript predicate correctness.

### 2D. Runtime floor integration

- [ ] For every remaining dynamic fact, identify the real sink, classify-and-pin or reconstruct
      its carrier, and enroll the door plus hostile-value evidence in the C9 inventory.
- [ ] Prove no TypeScript brand, module-private sentinel, proxy, or static diagnostic is treated as
      the runtime security mechanism.
- [ ] Obtain an independent architecture review of the 2A–2D design before deleting a production
      classifier family.

## Phase 3 — Migrate the three enumerative treadmills

### 3A. Egress: capability door plus declared destinations

- [ ] Make framework-owned egress capabilities the sole supported network door from
      untrusted-data-reachable code. Explicitly update SPEC §6.6: ambient transport hooks remain a
      private-network defense-in-depth floor, not a process sandbox or the positive-allowlist proof.
- [ ] Canonicalize declared HTTP origins at boot, but resolve, classify, and pin the selected IP at
      each dial and every redirect hop. Cover DNS rotation/rebinding, proxies, pooled sockets,
      private destinations, metadata capabilities, DB sockets, and task/webhook/agent-tool paths.
- [ ] Preserve the historical egress closed corpus under C13, then prove any generated origin not
      in the declared set is rejected before DNS/dial regardless of hostname/IP spelling.
- [ ] Prove supported declared origins and database endpoints remain usable under DNS rotation
      without widening the allowed origin or private-network posture.

### 3B. Imperative DOM: finite capability surface

- [ ] Replace the dangerous-name lexicon with the finite browser operation surface from 2B.
      Unrestricted DOM capability, string evaluation, unknown DOM receiver operations, and raw
      property sinks are unavailable in serialized handlers.
- [ ] Prove a never-before-listed dangerous DOM method is rejected because it is outside the
      finite capability set, not because its name was added to a denylist.
- [ ] Prove realistic form state, focus, dialog, scroll, selection, and event workflows remain
      expressible through reviewed operations across all supported browsers.

### 3C. Reachability: retire per-shape TASK B logic

- [ ] Route TASK B roots through capability closure, finite IR, and normalized provenance; unknown
      roots, package summaries, transfers, or sinks fail closed with actionable traces.
- [ ] Delete each superseded syntax/name predicate only after its C13 and mutation evidence passes.
      Record the remaining P obligations and explain every survivor.
- [ ] Run full classifier, compiler, integration, browser, build, package, performance, and memory
      gates before declaring the treadmill retired.

## Phase 4 — Close recurrent single-door families

- [ ] **Better Auth adapter TCB:** make the runtime credential/non-egress gate the sole enforcement
      door and cover every adapter secret/credential consumer. Use a module-private `unique symbol`
      and validating constructor only to make unsafe calls awkward; hostile-value/runtime tests,
      not the type shape, close threat-matrix M2.
- [ ] **CSRF mint delivery:** census every anonymous mint path and prove the response-lifecycle sink
      owns mutation forms, raw endpoints, bootstraps, query/live channels, redirects, errors,
      streams, nested handlers, cloned/reused requests, and cache posture. Remove per-path bindings
      only when that exact matrix stays green.
- [ ] **Request method/authority:** separate trusted transport-source selection from strict grammar.
      Share one implementation across direct HTTP/1, direct HTTP/2, generated Node, trusted-proxy,
      Vercel, Cloudflare/worker, and future adapters; reject raw-to-Fetch method case changes,
      ambiguous Host/`:authority`, and scheme/forwarding differentials under a C13 corpus.
- [x] **C9 completeness:** mechanically compare the boundary/sink census with the single reviewed
      inventory. Every sink has mechanism, sole door, proof gate, hostile-value test, and owner;
      an unowned or missing row fails `pnpm run check`.
  - Evidence: `pnpm run check:c9-sink-inventory` (16/16) proves all 13 named sinks across the 12
    census families have executable ownership/evidence rows and fail closed on inventory drift;
    `pnpm run check:sink-policy` and `pnpm run check:imports` pass at merge `7bdd75a38`.

## Phase 5 — Independent oracles and external review

- [ ] Build executable property oracles rather than treating parser disagreement as truth:
      egress asserts undeclared means no DNS/dial and simulates rebinding; authority asserts the
      normative grammar/source-precedence matrix across adapters; CSRF uses a mint/deliver/
      validate/rotate/replay state model; ReDoS enforces a versioned work bound; headers round-trip
      through real HTTP implementations.
- [ ] Run deterministic seeded fuzzers in nightly CI with minimized repro persistence, execution
      and coverage budgets, mutation score, and an exact release-time command. Cross-implementation
      disagreement is triaged; only the normative property decides safe versus unsafe.
- [ ] Define a fixed weekly internal adversarial charter and seeded canaries, then record R without
      changing the scope, prompt family, investigator count, or elapsed budget between rounds.
- [ ] Record third-party audit owner, authorization/budget, selection criteria, frozen scope,
      deliverables, disclosure handling, and retest requirement. Perform a design review after
      Phase 2 and the implementation audit only after Phases 3–4 stabilize.
- [ ] Close every blocking external finding and obtain a retest over the exact release candidate.

## Phase 6 — Scoped v1 security signoff

- [ ] The threat matrix has no OPEN cell: each cell has a control+test, audited escape, or
      specifically owned and signed-off out-of-scope disposition.
- [ ] `pnpm run acceptance`, including required real-Postgres 16.9 cases, passes from a clean
      checkout at the intended SHA with zero required skips.
- [ ] Capability closure, finite IR, normalized provenance, runtime sink floors, and the complete
      C9 inventory pass their C13, mutation, green-corpus, performance, and package gates.
- [ ] R is zero across three consecutive comparable adversarial rounds; every seeded canary is
      detected and every release-significant security mutation is killed.
- [ ] Release-budget fuzzers have no unresolved normative-property violation, have run nightly for
      at least two weeks, and pass the deterministic release command at the intended SHA.
- [ ] Third-party implementation audit and exact-candidate retest are complete; all blocking
      findings are closed.
- [ ] Local `main` equals the reviewed commit pushed to `origin/main`; required CI, race,
      package, browser, integration, Pages, and acceptance checks are terminal green.
- [ ] `rules/v1-acceptance.md` and `docs/v1-acceptance-ledger.md` cite the threat matrix,
      architecture review, audit/retest, exact commands, and this plan's convergence table without
      claiming immunity outside the scoped threat model.

## Convergence table

| Week       | Baseline SHA                   | R (root causes / fixed charter) | M (canary recall / mutation kill) | P (enumerative obligations) | G (green corpus / cost)  | C13 anchors (informational) | Notes                                       |
| ---------- | ------------------------------ | ------------------------------- | --------------------------------- | --------------------------- | ------------------------ | --------------------------- | ------------------------------------------- |
| 2026-07-17 | uncontrolled historical sample | 29 raw findings; not comparable | —                                 | —                           | —                        | —                           | Seed audit only; not a convergence baseline |
| 2026-07-18 | `e5f613be9`                    | 1 / fixed remote-ingress round  | 2/2 / 37/37 killed                | 5,956                       | 18/18 / 2.350s / 447 MiB | 17 corpora / 143 anchors    | First exact-SHA comparable baseline         |
