# Independent final Phase 2 / Phase 3C security architecture review — 2026-07-18

## Review identity and scope

- Reviewed commit: `4326cd096f5a63e5291795789edec6e463dbe74b`.
- Review worktree / branch:
  `/Users/mini/kovo-agent-security-architecture-final-review-20260718` /
  `agent/security-architecture-final-review-20260718`.
- Scope: `plans/10x-better-security.md` Phases 2A–2D and 3C, against SPEC §6.6,
  `rules/security-classifier-refactors.md`, and the prior initial review, follow-up review, and
  narrow repair retest. The later Phase 2C analyzer-summary review was also checked because its
  carrier-laundering findings are part of the exact-tip OPP proof.
- Independence: the worktree was forked from the exact commit above. No reviewed production, test,
  SPEC, rule, or active-plan file was modified; this report is the only retained change.

## Verdict

**REJECT Phase 2A–2D closure and Phase 3C classifier-retirement approval at `4326cd096`.**

The architecture is materially stronger than the previously rejected tips. The historical OPP-28
declaration/body, positional-carrier, mutable-helper, arbitrary-prefix, extra-argument, and alias-
chain laundering routes now close in the focused evidence. Semantic graph v2 binds the Drizzle
admission to exact source bytes, authored spans, root identity, authority inputs, and operation
inventory. The finite reviewed doors are deliberately narrow, and the JSX name scan was retired
only after its historical reject corpus was committed.

Approval is still blocked by one normative first-party identity gap, non-forcing mutation evidence
for the new semantic boundaries, a C13 ordering violation in the early-bypass deletion, two
deterministic integration regressions, and the still-unretired/incompletely inventoried Phase 3C
survivors. No new fail-open OPP or semantic-carrier exploit was reproduced at this exact tip; the
rejection distinguishes missing proof and incomplete retirement from a demonstrated new bypass.

## Ranked blockers

### 1. High — compiler verdicts do not bind the exact installed first-party implementation digest

SPEC §6.6 requires each manifest-public Kovo export and `<module>` initializer to have an
implementation digest in the compiler-owned posture verdict
(`spec/06-type-system.md:318-326`). The repository gate computes `sourceTreeSha256` and rejects a
stale reviewed checkout (`scripts/framework-export-posture-gate.mjs:93-97,198-218`). Its generated
compiler registry then drops that field: `FrameworkExportPosturePackage` contains only package
name, version, and manifest variants (`scripts/framework-export-posture-gate.mjs:271-315` and
`packages/compiler/src/security/framework-public-runtime-export-posture.generated.ts:12-19`). The
compiler consequently compares only installed version, manifest fingerprint, subpath, and
conditions (`packages/compiler/src/security/capability-closure.ts:152-181,674-726`) before applying
the reviewed export verdict.

Result: the monorepo gate authenticates the source tree from which the ledger was refreshed, but a
same-version first-party installation with the same manifest and changed implementation receives
the old authority disposition. That is not a claim that Kovo must sandbox a deliberately hostile
same-realm dependency; it is a direct gap in the narrower exact-installed-identity contract the
SPEC chose to require.

Required repair: carry the reviewed implementation identity into the compiler-owned registry,
derive a deterministic digest for the exact installed conditional target(s) before app evaluation,
and fail KV448 on a mismatch. Enroll same-version/same-manifest implementation substitution and
`<module>`-initializer substitution as behavioral negative tests and forcing mutants.

### 2. High proof gap — semantic-v2 admission and the reviewed migrations lack behavioral mutants

The plan requires mutations that delete or invert each new semantic rule
(`plans/10x-better-security.md:217-222`). The exact-tip Drizzle consumer has important independent
checks for byte identity and schema v2 (`packages/drizzle/src/trust-escapes-static.ts:1580-1602`),
root/factory/callback and span binding (`:1640-1662`), invocation and ordered argument spans,
authority inputs, transfer prefix, and operation inventory (`:1671-1708`), and the final authored
root/call/callable/authority/database-operation correspondence (`:32310-32361`). Focused adversarial
tests for synchronized field relabeling pass.

Those new consumer checks have no delete/invert mutants in
`scripts/security-gate-mutations.mjs`. In particular, there is no mutant for removing source-byte
equality, accepting v1, dropping factory-call/callable/call/argument span identity, trusting a
self-consistent root relabel, deleting authority-vector reconstruction, omitting/adding a database
terminal kind, or ignoring a closed sibling/root.

The reported 127/127 mutation result also overstates forcing strength for the nearby OPP, TASK B,
finite-door, and normalized-engine entries. They are marked `sourceOnly`; the harness gives the
mutated text directly to a custom assertion (`scripts/security-gate-mutations.mjs:2586-2606`), and
the relevant killers merely require that the original source string still be present (for example
`:2777-2852` and `:3092-3169`). A mutation is therefore “killed” because its exact replacement text
no longer contains the branch it replaced, without executing the security classifier or an
enrolled regression. This is a structural anti-drift sentinel, not evidence that the corpus catches
the weakened behavior.

Required repair: retain structural sentinels if useful, but add executable mutants that patch the
production classifier/consumer, run the relevant C13/adversarial fixture, and observe the expected
closed-to-open or open-to-closed failure. The semantic-v2 carrier checks above need individual or
carefully grouped behavioral mutants; the repaired OPP sole-carrier/one-hop/body checks and the two
TASK B deletions need the same forcing evidence.

### 3. Blocking conformance — the authoritative TASK B corpus did not precede bypass deletion

The C13 rule requires the old closed/consistency corpus to be committed before replacement
(`rules/security-classifier-refactors.md:8-22`). Commit `c1d73eb1e674499a89e85dc4948717d029998372`
simultaneously:

- added and enrolled the five `matches standalone TASK B facts` consistency cases for a barrel
  re-export, namespace alias, computed callback property, spread config, and conditional root;
- added the corresponding mutation sentinel; and
- removed the early empty-result prefilter and its 260-line syntax/name machinery.

The exact-tip C13 command is green, so current behavior is covered. The commit history nevertheless
does not prove that the replacement passed a previously frozen corpus, which is the point of the
ordering rule. Repair without rewriting shared history requires restoring the old prefilter in one
checkpoint, committing the complete behavioral corpus/mutants while it is live, and deleting it in
a later checkpoint (or an equivalent clean red-test-before-fix history before integration).

The JSX retirement has the correct C13 order: `d8a9a215e` committed the eight compiler-IR reject
cases plus both raw-imperative survivor matrices before `35d4ebb8f` deleted the JSX attribute walk.
That narrow deletion is approved, subject to replacing its source-only mutation sentinel as noted
above. The authored-source semantic emission repair at `e70c85f10` added its specific structural-
lowering regression in the production-fix commit rather than a prior checkpoint; treat that as a
second, narrower ordering gap when rebuilding the semantic carrier proof chain.

### 4. Blocking readiness — the broader Drizzle integration slice is red

The focused architecture suite, C13, C9, and green applications pass. A broader existing Drizzle
integration slice deterministically reports 235 passed / 2 failed:

- `advanced-analyzer.scoped-pipeline.test.ts:105` expects the Stack Overflow composite update key
  `arg:targetId`; the exact tip emits `null`.
- `advanced-analyzer.scoped-pipeline.test.ts:1193` expects the structurally proved cart-session
  equality; the exact tip degrades it to `op: "non-eq"`.

Both failures are conservative loss of proof/usability, not observed fail-open security behavior.
They still block the Phase 3C requirement to run the full integration gates before declaring the
treadmill retired (`plans/10x-better-security.md:322-323`). Do not weaken the OPP carrier grammar to
make them green; either map the legitimate framework role through the exact grammar or update the
fixture only if the formerly supported shape is now explicitly outside the normative subset.

### 5. Blocking completion — Phase 3C still has legitimate but unowned enumerative survivors

The exact tip has removed two real treadmill pieces, but it has not retired TASK B end to end. The
following survivors are legitimate today and must not be deleted wholesale:

- `nonCompilerRawHandlerBodies` covers only raw `element.on* = callback` and
  `addEventListener(..., callback)` closures outside compiler-owned JSX
  (`packages/drizzle/src/trust-escapes-static.ts:38933-38973`). Its eight-name dangerous sink
  scanner remains a conservative KV424 backstop. It is an explicit P obligation, not finite-IR
  proof.
- The request/process KV424 analyzer still owns raw filesystem, process, network, worker, VM,
  dynamic-loader, database-driver, request-authority, opaque-call, and module-initializer closure.
  It consumes semantic-v2 proof only for the reviewed plain-data/static-column admissions. Its
  syntax-specific reachability and `dangerousCallSink` use remain separate owners, so
  `dangerousCallSink` cannot be deleted with the raw-handler scanner.
- Specialized Drizzle private-scope/write/query analysis remains the legacy KV406 owner explicitly
  preserved by `plans/10x-better-security.md:309-319`. Actual writes, shared/referenced mutation
  handlers, distinct keys, and target derivation still need this proof until a compiler carrier
  replaces it.

Phase 3C must record these as exact P rows with owner, covered roots, terminal families, C13 anchor,
mutation, and replacement/deletion condition. Until every root reaches capability closure, finite
IR, or normalized provenance on the production build path—and every survivor is explained—the open
items at `plans/10x-better-security.md:297-323` correctly remain open.

## Deleted predicates reviewed

Commit `c1d73eb1e` removed the unsound early-return decision and these classifier pieces:

- `STATIC_BUILD_TRUST_LEXICAL_SIGNAL`
- `STATIC_BUILD_REQUEST_PROPERTIES`
- `staticBuildTrustAnalysisRequired`
- `staticBuildTrustSourceRequiresAnalysis`
- `staticBuildTrustImportMeta`
- `isStaticBuildImportMeta`
- `staticBuildTrustBareModuleRequiresAnalysis`
- `staticBuildTrustFactoryForCall`
- `staticBuildTrustHandlerPropertyRequiresAnalysis`
- `staticBuildTrustHandlerBodyRequiresAnalysis`
- `staticBuildTrustElementName`
- `staticBuildTrustScriptKind`

Commit `35d4ebb8f` removed the JSX-attribute branch from `handlerBodies`, renamed the surviving raw
collector to `nonCompilerRawHandlerBodies`, and deleted the unused `requestCallIsGovernedFetch`.
The behavior of both deletions is sound in the exact-tip focused/C13 evidence; the blockers are the
ordering and forcing-proof issues above, not a reproduced reopening of the deleted bypasses.

## Architecture accepted at this tip

- **First-party surface census:** all manifest-public subpaths and their `<module>` initializers are
  exhaustively compared with the reviewer ledger. The exact gate reports 11 packages, 1,838
  subpaths, and 2,315 runtime exports. The unresolved issue is installed implementation identity,
  not export membership.
- **OPP-28 / analyzer summaries:** candidate declarations require an exact same-file immutable
  callable, one parameter, a one-return literal private path, exact declared kind/path, a sole exact
  framework carrier, at most one direct alias from the proved snapshot, and whole-callback carrier
  integrity. The prior body, prefix, positional, mutation, extra-evaluation, and alias-chain routes
  were not reproduced. Arbitrary JavaScript predicate correctness remains honestly assigned to
  audit/database policy per SPEC §6.6.
- **Semantic graph v2:** authored source, root binding, helper invocation, authority vector,
  transfer prefix, operation inventory, and closed sibling/root checks are architecturally
  appropriate. The 324-test focused suite includes synchronized root/authority/operation relabels
  and passes. Missing behavioral mutants prevent final proof approval.
- **Finite IR doors through `4326cd096`:** command, storage factory/stat, static trusted SQL,
  declared secret read and exact execution, `trustedReveal`, `secret`, Drizzle table alias,
  `innerJoin`, and `union` admissions are exact symbol/shape doors with adjacent negative tests.
  No permissive spelling-only door was found.
- **Runtime floors:** C9 assigns all 23 reviewed sink rows to reconstruct/box/own mechanisms; brands,
  sentinels, proxies, and static diagnostics are not substituted for the runtime boundary.

## Residual risks and review limits

- The supported-subset proof is not a same-realm JavaScript sandbox, and this review does not turn
  package digests into a hostile-dependency isolation claim.
- Semantic graphs and explain output remain audit evidence, not runtime authority. Drizzle's
  independent source/AST reconstruction is mandatory even after mutation coverage improves.
- Raw imperative callbacks and the legacy KV406/KV424 analyzers remain part of the security TCB.
  Their conservative behavior can hide usability regressions, while accidental widening can hide
  findings; both directions need independent executable oracles.
- Full browser, external Postgres, package, performance, memory, and complete repository gates were
  not run in this independent worktree. Phase 3C already requires them after the blockers above are
  repaired.

## Exact-tip evidence executed

- `pnpm run check:framework-export-posture` — 11 packages, 1,838 subpaths, 2,315 runtime exports;
  focused posture gate 6/6 passed.
- `pnpm exec vitest --run packages/compiler/src/capability-closure.security.test.ts packages/cli/src/capability-closure-packages.test.ts packages/compiler/src/security-operation-ir.security.test.ts packages/compiler/src/security-operation-ir.response-provenance.test.ts packages/cli/src/phase3c-semantic-bridge-adversarial.test.ts packages/drizzle/src/index.phase2c-exact-tip-adversarial.test.ts --reporter=dot`
  — focused capability/finite-IR/semantic/OPP/Drizzle adversarial suite, 6 files, 324/324 passed.
- `pnpm exec vitest --run packages/drizzle/src/capability-escapes-static.test.ts packages/drizzle/src/trust-escapes-static.test.ts packages/compiler/src/security-operation-ir.security.test.ts -t 'TASK B|non-compiler|matches standalone TASK B facts|aggregate closed' --reporter=dot`
  — 3 files, 18 passed (500 unrelated tests skipped by the focused name filter).
- `pnpm run check:security-gate-mutations` — 127/127 reported killed, with the forcing limitation
  described in Finding 2.
- `pnpm run check:security-classifier-corpus` —
  `check-security-classifier-corpus/v1 OK corpora=21`.
- `pnpm run check:green-corpus` — 18/18 rows passed.
- `pnpm run check:c9-sink-inventory` — 2 files, 23/23 passed.
- `pnpm exec vitest --run packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts packages/drizzle/src/index.columns-keys-predicates-provenance.test.ts packages/drizzle/src/index.mass-assignment.test.ts packages/drizzle/src/index.mutation-private-scope-transfers.test.ts packages/drizzle/src/index.query-loader-receivers.test.ts packages/drizzle/src/index.scope-audits.test.ts packages/drizzle/src/index.summary-callable-stability.test.ts --reporter=dot`
  — broader Drizzle analyzer/OPP/KV406 suite, 6 files passed, 1 failed; 235 passed, 2 failed.
- `pnpm exec vitest --run packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts -t 'derives Stack Overflow-style scoped composite-key updates from extracted facts' --reporter=verbose`
  — 1 failed / 9 skipped; expected `keys: "arg:targetId"`, received `null`.
- `pnpm exec vitest --run packages/drizzle/src/advanced-analyzer.scoped-pipeline.test.ts -t 'derives composite natural-key cart updates with same-scope aggregate witnesses' --reporter=verbose`
  — 1 failed / 9 skipped; expected session equality, received `op: "non-eq"`.

All commands ran in the independent worktree at the exact reviewed commit before this report was
added.
