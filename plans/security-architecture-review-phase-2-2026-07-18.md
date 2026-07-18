# Independent Phase 2 security architecture review — 2026-07-18

## Review identity and scope

- Reviewed commit: `a9ab6cc8527740ec1e6cef7e674cad56782029e2`.
- Review scope: `plans/10x-better-security.md` Phases 2A–2D and the preconditions for
  Phase 3C production-classifier deletion.
- Normative basis: `SPEC.md`, especially `spec/05-compiler.md`,
  `spec/06-type-system.md` §6.6, `spec/10-data-plane.md` §10.3,
  `spec/11-diagnostics.md`, `spec/11-verification.md`, and
  `rules/security-classifier-refactors.md`.
- Independence: this review forked the exact commit above into a separate worktree. The reviewer did
  not implement or amend the reviewed production code. Reproduction-only tests were created, run,
  and deleted; this report is the branch's only retained change.

## Verdict

**REJECT for Phase 2A–2D architecture approval and for production classifier deletion at this
commit.** Do not use this review to check the Phase 2D independent-review item or to delete TASK B.

The capability graph, finite compiler-owned IR, bounded semantic engine, and C9 inventory are sound
foundations and their focused gates pass. The integrated architecture is nevertheless not closed:
two Drizzle provenance consumers still treat unknown or app-declared provenance as positive proof,
and TASK B still runs through its old handler-shape/name classifier rather than through the shared
substrate. The first defect can suppress an IDOR finding; the second can suppress the governed-column
mass-assignment gate. Those are security-proof failures, not documentation residue.

## Ranked findings

### 1. High — an app-authored private-scope summary launders request input into OPP-28 proof

`KovoAnalyzerFunctionSummary` permits app code to declare `guard`, `session`, or `tenant` return
provenance even though the public API explicitly says the helper body is not inspected
(`packages/drizzle/src/drizzle-surface.ts:35-52`).
`sessionProvenanceContextForNodes` installs that declaration as helper provenance
(`packages/drizzle/src/static/session-provenance.ts:31-77`). The owner-predicate path then accepts a
summarized call directly (`packages/drizzle/src/static/summaries.ts:1491-1506` and
`:2105-2174`) and promotes `guard:<owner>` to owner scope
(`packages/drizzle/src/static/summaries.ts:592-641`).

The following exact-tip review probe was classified `scope: "session"` with the detail
`owner column compared to guard:userId`:

```ts
function claimedGuardPrincipal(input: { userId: string }) {
  return input.userId;
}
kovoAnalyzerSummary(claimedGuardPrincipal, {
  returns: { kind: 'guard', path: 'userId' },
});

query('load', {
  load(input, db) {
    const userId = claimedGuardPrincipal(input);
    return db.select().from(orders).where(eq(orders.userId, userId));
  },
});
```

This contradicts the OPP-28 honesty boundary in `spec/06-type-system.md:401-409`: the positive
verdict requires the exact private principal symbol, exact owner column, equality-equivalent
predicate, and the same accepted guard principal. Unknown correspondence must remain
`scope: unknown` and must not be promoted by a permissive helper summary.

Impact: KV414/static IDOR evidence can claim owner scope for a client-controlled key. Supported
Postgres RLS may still deny the actual cross-owner read, but that engine floor does not repair a
false by-construction verdict; SQLite's owner enforcement is advisory. The static claim and any
consumer that trusts it are unsound.

Blocking repair:

- Private-scope summaries may contribute positive OPP-28 evidence only when compiler-derived
  normalized semantics prove the exact principal origin and its correspondence to an accepted guard.
- An app-authored assertion, imported/opaque helper, ambiguous symbol, unsupported transfer, or
  budget closure must produce `scope: unknown`.
- Enroll the probe above and alias/wrapper/branch variants in C13, and add a mutation that restores
  summary-only promotion.

### 2. High — KV438 accepts unknown helper provenance and unaudited app-declared server provenance

There are two fail-open routes in one governed-write trust boundary.

First, `governedValueVerdict` documents that opaque helper output must reject, but the
`serverValue` branch checks only whether the recursive verdict's provenance equals `input`.
`unknown` therefore becomes `{ ok: true }` (`packages/drizzle/src/static/derivation.ts:1440-1474`):

```ts
function opaqueHelper(value: string) {
  return value;
}

db.update(accounts).set({
  role: serverValue(opaqueHelper(input.role), 'claimed server role'),
});
```

The exact-tip mass-assignment probe returned no facts. A separate mutation-root probe through
`collectUnregisteredSinksFromProject` also returned no unregistered sink for this expression. This
violates `spec/10-data-plane.md:486`, which permits `serverValue` only for a value proven not to be
request input and requires unknown provenance to fail closed.

Second, an app can declare `{ returns: { kind: "server" } }` for a helper whose body simply returns
request input. The analyzer records the helper symbol without inspecting its body
(`packages/drizzle/src/static/symbol-provenance.ts:330-365`) and every call becomes positive server
provenance regardless of its arguments (`packages/drizzle/src/static/symbol-provenance.ts:190-207`).
Both the retained production test at `packages/drizzle/src/index.mass-assignment.test.ts:363-378`
and an independent exact-tip probe demonstrate that such a helper suppresses all KV438 facts.

The SPEC acknowledges author assertions as escapes, but the current API describes `kind: "server"`
as **no request-input provenance**, uses it to discharge a by-construction gate, and does not surface
`kovoAnalyzerSummary` in the capability-escape collector. If this declaration remains an assertion,
it cannot also count as structural proof.

Impact: request-controlled `role`, `balance`, owner, or key values can reach governed columns without
KV438. Row-level RLS does not generally constrain which value may be written to a governed column,
so this can become privilege escalation or integrity loss rather than merely a false report.

Blocking repair:

- Make the `serverValue` lattice distinguish proven literal/server-derived values from unknown;
  missing, opaque, unsupported, or budget-closed inner values must reject.
- Replace positive `{ kind: "server" }` proof with compiler-derived normalized helper semantics, or
  explicitly reclassify it as a loud audited assertion equivalent to `trustedAssign`, surface every
  affected call in `kovo explain --writes`, and stop claiming it as by-construction proof.
- Add both probes, cross-file/alias variants, and mutations for the unknown-to-safe and
  declared-server-to-safe transitions to the checked C13 corpus.

### 3. Blocking readiness gap — Phase 3C has not routed or retired TASK B

This is a deletion blocker rather than a newly discovered bypass. At the reviewed commit:

- `plans/10x-better-security.md` Phase 2C remains open, including normalized provenance consumers,
  C13-before-migration, superseded-predicate accounting, and OPP-28 honesty.
- The old TASK B handler collector is still called by
  `collectUnregisteredSinksFromProject` and `collectStaticBuildTrustFactsFromProject`
  (`packages/drizzle/src/trust-escapes-static.ts:347-470`). The real pre-evaluation build path
  consumes those facts (`packages/cli/src/commands/build-export.ts:876-915`), and the internal
  Drizzle compile command still emits them (`packages/cli/src/commands/compile.ts:1055-1173`).
- The finite browser IR rejects unknown DOM operations, but no integrated path currently replaces
  TASK B's production root discovery and reachability obligation with capability closure + finite IR
  + normalized provenance.
- `dangerousCallSink` is not handler-only: request/process authority analysis also calls it at
  `packages/drizzle/src/trust-escapes-static.ts:13973` and `:32587`. Deleting that helper wholesale
  would remove unrelated closure checks.

TASK B deletion therefore requires a surgical split after the new route is live. It cannot be
justified by the compiler IR unit tests alone.

## Architecture that passed review

- **Capability closure:** all ten root kinds are enumerated; relative imports, re-exports, literal
  dynamic loading, callbacks/containers, raw globals/capabilities, and exact-version package
  summaries are represented. Absent, stale, contradictory, or unresolved package facts close.
- **Finite IR and authored-source boundary:** the compiler-owned operation union has exact door
  ownership, unknown operations produce KV449, generated ABI imports are provenance-gated, and app
  source remains TSX/JSX rather than hand-authored lowered IR.
- **Normalized semantic engine:** exact same-file callable resolution, context-sensitive bottom-up
  summaries, authority propagation, query no-write propagation, recursion closure, and the fixed
  16-edge / 50,000-node / 4,096-operation / 256-summary budgets are implemented and mutation-tested.
  The defect is inconsistent adoption by the older Drizzle provenance consumers, not absence of the
  compiler engine.
- **C9 runtime floor:** the reviewed registry assigns finite operations to one sink owner and rejects
  brands, sentinels, proxies, and static diagnostics as runtime mechanisms. The inventory is
  structurally complete at this commit; it does not convert the static OPP/KV438 defects into proof.

## Conditions before classifier deletion

1. Close Findings 1 and 2 under committed C13 corpora and dedicated semantic mutations.
2. Route every TASK B root on the actual `kovo check` and build paths through capability closure,
   finite IR, and normalized provenance. Unknown root, transfer, package summary, operation, or sink
   must emit the closed verdict and actionable trace required by SPEC §6.6.
3. Freeze the old TASK B closed corpus before deleting predicates. Demonstrate the replacement is a
   superset per `rules/security-classifier-refactors.md`, including a never-listed DOM sink.
4. Split handler-only TASK B logic from shared request/process authority helpers. Delete only the
   predicates proven superseded; inventory and explain every survivor and record P and G.
5. Run the full classifier, compiler, integration, browser, build, package, performance, and memory
   gates on the integrated deletion tip. The focused gates below are necessary but not sufficient.
6. Obtain an independent re-review of that exact integrated tip. Approval must name the deleted
   predicates, surviving runtime/static owners, and residual risks.

## Residual risks and review limits

- Postgres RLS and C9 runtime sinks remain essential dynamic floors; they are not evidence that a
  static owner/value-provenance verdict is honest.
- Package summaries assume reviewed package metadata and the documented same-realm threat model;
  this review did not claim a hostile in-process dependency sandbox.
- Generated security manifests and `kovo explain` traces are audit artifacts, not runtime authority.
- This review did not rerun external Postgres matrices, cross-browser tests, GitHub Actions, or the
  full repository gate. Those remain required on the eventual deletion commit.

## Exact-tip evidence executed

- `pnpm exec vitest --run packages/compiler/src/capability-closure.security.test.ts packages/cli/src/capability-closure-packages.test.ts packages/compiler/src/security-operation-ir.security.test.ts packages/core/src/internal/source-sink-registry.test.ts --reporter=dot`
  — 4 files, 102 tests passed.
- `pnpm run check:security-classifier-corpus` — `corpora=20` passed.
- `pnpm run check:security-gate-mutations` — 68/68 mutants killed.
- `pnpm run check:green-corpus` — 18/18 rows passed.
- `pnpm run check:c9-sink-inventory` — 2 files, 23 tests passed.
- Reproduction-only OPP-28 probe — 1/1 passed and demonstrated `scope: "session"`; file deleted.
- Reproduction-only KV438 probes — 2/2 mass-assignment cases and 1/1 mutation-root request case
  passed with empty findings; files deleted.

All commands above ran from the independent worktree at
`a9ab6cc8527740ec1e6cef7e674cad56782029e2` before this report commit.
