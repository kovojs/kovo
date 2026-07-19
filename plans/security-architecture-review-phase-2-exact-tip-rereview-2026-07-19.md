# Independent Phase 2 / Phase 3C exact-tip security re-review — 2026-07-19

## Review identity and scope

- Reviewed commit: `2b1875e7aafce6c470624abac6a22aa5b9b2f7ac`.
- Reviewed integration branch at that commit: `agent/security-plan-integration-20260718-0325`.
- Independent worktree / branch:
  `/Users/mini/kovo-agent-phase2-final-rereview-20260719` /
  `agent/phase2-final-rereview-20260719`.
- Scope: the OPP-28 repair in `2b1875e7a`, all of `plans/10x-better-security.md`
  Phases 2A–2D and 3C, TASK B deletions and survivors, C13, mutation forcing, C9,
  green-corpus, and convergence evidence.
- Normative basis: `spec/06-type-system.md` §6.6, especially the
  Authorization-gates-DATA honesty boundary at lines 443–451; `spec/10-data-plane.md`
  §10.3; and `rules/security-classifier-refactors.md`.
- Independence: this reviewer did not implement the reviewed code. Reproduction-only tests and one
  strict-TypeScript authorability probe were created, executed, and deleted. No production code,
  active plan, generated posture/pack/convergence artifact, or baseline was edited. This report is
  the only retained change.
- Same-process intrinsic poisoning was deliberately out of scope. No finding below requires it.

## Verdict

**REJECT Phase 2A–2D architecture approval, REJECT the OPP-28 Phase 2C checkbox, and REJECT
declaring Phase 3C complete at `2b1875e7a`.**

The repair correctly closes every previously requested key-level defect: absent or mismatched
accepted guards, opaque siblings before and after the summarized leaf, two-hop accepted-guard
aliases, whole-carrier `serverValue` laundering, and absent/mismatched keys at final read and write
consumers. Distinct independently body-proved helpers for the same key remain positive. Both
prime→current and current→poison remain real runtime counterexamples, but the static OPP verdict now
closes them. The five new OPP mutants and the independently integrated PostgreSQL authorization
mutant coexist in a 256-name unique denominator and all six are killed in isolation.

That repair proves **key identity**, not the accepted **value** that reaches the data predicate. A
single exact summarized guard over a live accessor-backed private field can return exact `true` to
the guard and a different value to the loader. The analyzer nevertheless reports `scope: session`,
suppresses KV414, and makes `kovo check` succeed. The real `runQuery` path then reaches the loader
with the changed value. This is the same guard-to-predicate correspondence failure without any
opaque sibling.

In addition, the exact-tip C13, full mutation, and convergence gates are red. The active plan's
evidence and blocker text describe older tips rather than this implementation. Both production
survivors MUST remain:

1. `requestProcessSinksForProject` remains the request/process KV424 owner.
2. `static/session-provenance.ts`, `static/summaries.ts`, and the write analyzer remain the
   specialized Drizzle KV406/OPP owner. Finding 1 prevents deleting or claiming replacement of this
   survivor.

## Ranked findings

### 1. High — OPP-28 preserves a principal key but not the value accepted by the guard

The repair's accepted-guard collector returns only `guard:<path>` strings
(`packages/drizzle/src/static/summaries.ts:976-1031`). The owner operand consumer checks only that
same string (`:1509-1580`). Neither stage creates an immutable receipt for the value that actually
returned exact `true`.

The runtime then evaluates the guard and loader at different times over the same live nested value:

- `runGuard` accepts only exact `true` (`packages/server/src/guards.ts:1196-1203`);
- `runQuery` awaits the guard at `packages/server/src/query.ts:532-539`, then invokes the loader at
  `:548-552`;
- `pinnedRequestCarrier` snapshots top-level property values, not a recursively reconstructed
  private scalar (`packages/server/src/request-carrier.ts:437-531`). A nested accessor, Proxy, or
  mutable object therefore remains live. A query with no lifecycle additions may retain the
  original request directly.

The independent reproduction used the ordinary, one-leaf closed form:

```ts
type Request = { guard: { ownerFlag: boolean } };

function current(request: Request): boolean {
  return request.guard.ownerFlag;
}
kovoAnalyzerSummary(current, {
  returns: { kind: 'guard', path: 'ownerFlag' },
});

export const list = query({
  guard: guards.all(current),
  async load(_input, context: Context) {
    return context.db
      .select({ id: docs.id })
      .from(docs)
      .where(eq(docs.ownerFlag, context.request.guard.ownerFlag));
  },
});
```

For static analysis this produced `scope: "session"` and `kovo-check/v1 OK`. The same runtime
definition received this valid request value:

```ts
class DriftGuard {
  private reads = 0;

  get ownerFlag(): boolean {
    return this.reads++ === 0;
  }
}

await runQuery(definition, undefined, { guard: new DriftGuard() });
// => { ok: true, value: false, ... }
```

The first read returns exact `true`, so the guard accepts. The loader's read returns `false`, which
can select a different owner partition. A getter can equivalently read request-specific remote
state. A class getter structurally satisfies the ordinary boolean property type without a cast, and
the app shape uses exact supported APIs. A separate minimal required-context definition passed
strict TypeScript, so this is not an invalid callback signature, hostile dependency behavior,
hand-authored IR, or intrinsic poisoning.

This violates SPEC §6.6's requirement that the accepted guard principal and predicate principal be
the same exact symbol **under an honest value correspondence**. A static key match does not prove
that two dynamic property reads produce the same value. The SPEC explicitly forbids promotion by
types when correspondence is unknown.

Blocking repair:

- Create a framework-owned immutable accepted-principal receipt by reading/reconstructing the exact
  scalar once, and require the data predicate to consume that receipt; or restrict OPP positives to
  framework-owned reconstructed scalar sources whose descriptors/value are pinned across the
  guard-to-handler boundary. A closed list of helper/key names alone is insufficient.
- Apply the same invariant before read and write facts become owner-scoped.
- Add direct and one-leaf `guards.all` accessor/Proxy/value-drift negatives, a real-runner hostile
  case, final read/write cases, C13 enrollment, and executable mutants that delete the runtime
  receipt or static receipt correspondence.

### 2. Blocking forcing/readiness gap — C13, the full mutation gate, and convergence are red

The new repair evidence itself is useful but not sufficient:

- The five new OPP mutants plus
  `postgres-authorization-correspondence/allow-null-owner-via-edge` were selected from the exact
  integrated array and killed 6/6. The array has exactly 256 entries and 256 unique names.
- The full `pnpm run check:security-gate-mutations` gate nevertheless failed with four non-killed
  results:
  - `compiler-finite-ir/drop-authored-executable-reference-provenance` baseline-failed because the
    bundled module did not expose `compileComponentModule`;
  - `drizzle-analyzer-summary/drop-static-call-carrier-proof` survived;
  - `drizzle-analyzer-summary/allow-property-callable-invocation` survived;
  - `drizzle-analyzer-summary/allow-conditional-authority-mutation` survived.

The three Drizzle survivors are deterministic expectation/fixture drift caused by the new accepted-
guard prerequisite. Their behavioral fixtures have no accepted guard, so both the baseline and
mutated implementations now return `undefined`; the weakening cannot change the verdict. This does
not demonstrate that those production branches are unsound, but it removes the forcing proof the
plan claims. A targeted rerun reproduced the same one baseline failure and three survivors.

`pnpm run check:security-classifier-corpus` also failed:

- the main 21-corpus matrix had 84 passing / 4 failing files and 3,070 passing / 7 failing tests;
- seven first-party source-tree posture digests are stale, producing one posture-gate failure,
  three capability-package failures, and a downstream starter client-IP build failure;
- `index.summary-callable-stability.test.ts` has two stale positives which omit `guard:` but still
  expect `scope: session`; the repair correctly returns `unknown` for both;
- the subsequent server build corpus had 53 passing / 1 failing / 1 skipped because the generated
  route diagnostic now contains `severity: "error"` while the fixture expectation does not.

The repair cases are at least wired into C13: `index.phase2c-exact-tip-adversarial.test.ts` is in the
`finite-security-operation-ir` corpus, and the final-consumer/summary suites are under
`drizzle-analyzer-provenance`. The new accessor/value-drift root cause is not enrolled.

`pnpm run check:security-convergence-baseline` failed on deterministic drift. The live structural
collector at this tip reports `M=256`, `P=8,003`, `G=18`, and C13=`21 corpora / 223 anchors / 93
test files`; the committed record does not match.

These are independent reasons to keep Phase 3C's full-gate checkbox open even after Finding 1 is
repaired.

### 3. Medium design-honesty gap — ordinary string owner extractors are positive statically but cannot accept at runtime

An independent string-owner probe used a body-verified `guard:userId` helper as the sole
`guards.all` leaf and the same owner key in the query predicate. Static analysis reported
`scope: session` and `kovo check` returned OK. At runtime the helper returns a string, while
`guards.all` and `runGuard` require exact `true`; the query was denied and its loader was not
called. `Guard<Request>` also types the return as `boolean | GuardDenial`, so an ordinary string
extractor is outside the type-valid guard API.

The exact-`true` boolean positive control is real: two distinct independently body-proved helpers
for the same boolean `ownerFlag` key were statically admitted, and a real runner reached the loader.
The current positive language is therefore not wholly vacuous, but it is much narrower than the
string `userId` examples and evidence imply. Today it is practically a boolean-owner proof.

The plan/SPEC should make one of two decisions explicit after Finding 1 is fixed:

1. state that OPP guard-derived positives are limited to an exact runtime-accepting boolean
   principal and stop citing string-owner fixtures as usable positives; or
2. introduce a separate guard verdict plus immutable principal-receipt/extractor design so normal
   string/number owner identities can be both runtime-accepted and used by the predicate.

Treating statically positive but runtime-unreachable string examples as evidence of ordinary owner-
ID usability would overstate the supported subset.

### 4. Plan evidence is stale and Phase 2D's dynamic-floor claim is overbroad

`plans/10x-better-security.md` still records:

- the already-repaired declaration-laundering finding as the Phase 2C blocker;
- C13=20, M=68/68, P=8,112, C9=23/23, and 28 analyzer-summary mutants;
- the older independent REJECT as the latest Phase 2D review.

Current exact-tip evidence is C13=21/223/93 structurally (but red at runtime), M=256 with four
non-killed full-gate results, P=8,003, G=18, C9=28/28, and 32
`drizzle-analyzer-summary/*` entries. More importantly, Phase 2D says every remaining dynamic fact
has a real sink and reconstruct/box/own owner. Finding 1 shows the guard-to-predicate live value has
no such runtime receipt, so that checkbox is substantively overbroad, not merely numerically stale.

The plan should keep OPP-28 and full Phase 3C gates open, replace the obsolete blocker with the live-
value correspondence requirement, record the executable-type narrowness, and refresh evidence only
after all authoritative gates pass. This review did not edit the active plan.

## Requested adversarial matrix

| Case | Exact-tip result |
| --- | --- |
| No accepted guard | `scope: unknown`, KV414, check exit 1 |
| Pure mismatched accepted principal (no matching sibling) | `scope: unknown`, KV414, check exit 1 |
| Opaque sibling before summarized leaf | `scope: unknown`, KV414, check exit 1 |
| Opaque sibling after summarized leaf | `scope: unknown`, KV414, check exit 1 |
| Two distinct independently body-proved same-key helpers | `scope: session`, check exit 0 |
| Two-hop alias as direct guard | `scope: unknown`, KV414, check exit 1 |
| Two-hop alias inside `guards.all` | `scope: unknown`, KV414, check exit 1 |
| `serverValue(context)` whole-carrier returned alias | `scope: unknown`, check exit 1 |
| Final read consumer with absent / mismatched accepted key | both `scope: unknown` |
| Final write consumer with absent / mismatched accepted key | both `scope: unknown` |
| Prime→current boolean runtime sequence | runner accepts attacker-selected `true`; static closes |
| Current→poison boolean runtime sequence | runner accepts, loader observes poisoned `false`; static closes |
| Exact-`true` boolean positive | static admits and real runner reaches loader |
| Ordinary string principal extractor | static admits; runtime denies and loader is not called |
| One-leaf accessor value drift | **static admits; runtime accepts then loader observes different value** |

The primary throwaway matrix passed 14/14. Separate one-leaf accessor, string-narrowness, and strict-
TypeScript authorability probes were then run and deleted.

## TASK B deletions and survivor assessment

The reviewed TASK B deletions may remain. No reopening was reproduced:

- a focused compiler/Drizzle TASK B run passed 23/23 cases (565 unrelated cases skipped), including
  raw `on*`, static-computed `on*`, member/static-computed/global `addEventListener`, historical
  callback bodies, standalone-vs-aggregate consistency, and finite-IR closure;
- `drizzle-task-b/restore-static-build-analysis-bypass` and
  `drizzle-task-b/drop-raw-registration-closure` were killed 2/2;
- the broader advanced analyzer, provenance, mass-assignment, TASK B, and capability slice passed
  439/439.

`requestProcessSinksForProject` must remain because it still owns raw capability, initializer,
request-authority, and opaque protocol/call/constructor closure. The specialized Drizzle survivor
must remain because Finding 1 is inside its positive authorization verdict. The normalized semantic
graph does not yet own this dynamic value receipt. No production-classifier deletion is authorized
by this review.

## Architecture portions that remain sound foundations

- Capability-closed module graph, finite compiler-owned security IR, and semantic graph v2 remain
  appropriate structural foundations in the focused evidence.
- The OPP repair's producer intersection, closed same-key guard tree, one-alias boundary,
  `serverValue` scalar-only rule, and final read/write consumer intersection all passed independent
  negatives and their five new selected mutants.
- C9 remains explicit about reconstruct/box/own rather than brands or diagnostics; its exact-tip
  gate passed 28/28. It simply does not yet own the OPP live-value correspondence.
- Green applications passed 18/18.
- The existing prime/current and current/poison runtime tests are valuable honesty evidence. They
  prove why a key-only static grammar needs a runtime value receipt; they do not themselves repair
  that gap.

## Exact-tip evidence executed

- Fresh install: `CI=true pnpm install --frozen-lockfile` — passed.
- Focused OPP/summary/final-consumer/compiler/CLI/server suite: 8 files passed, 1 failed; 604 passed,
  2 failed. Both failures are stale no-guard positive expectations in
  `index.summary-callable-stability.test.ts`.
- Independent requested OPP matrix: 14/14 passed; reproduction file deleted.
- Independent one-leaf `guards.all` accessor static+runtime reproduction: 1/1 passed; file deleted.
- Independent string static/runtime narrowness probe: 1/1 passed; file deleted.
- Minimal required query-loader context under strict TypeScript: passed; file deleted.
- Broader Drizzle/TASK B/capability slice: 5 files, 439/439 passed.
- Focused TASK B replacement suite: 3 files, 23 passed / 565 skipped.
- Targeted TASK B mutants: 2/2 killed.
- Targeted five OPP repair mutants plus PostgreSQL authorization mutant: 6/6 killed; integrated
  denominator exactly 256/256 unique names.
- Full mutation gate: failed with one baseline failure and three survivors listed in Finding 2.
- C13: failed as detailed in Finding 2.
- `pnpm run check:green-corpus`: passed 18/18.
- `pnpm run check:c9-sink-inventory`: 2 files, 28/28 passed.
- `pnpm run check:security-convergence-baseline`: failed; live structural metrics
  M=256, P=8,003, G=18, C13=21/223/93.
- `git diff --check`: passed before this report was added.

All commands ran in the fresh independent worktree at the exact reviewed commit. No command pushed
or changed the reviewed branch.
