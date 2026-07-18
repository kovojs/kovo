# Independent Phase 2 security architecture re-review follow-up — 2026-07-18

## Review identity and scope

- Reviewed commit: `56a3d969a4fe2dfde6098619ac90cf6a3712b74f`.
- Scope: `plans/10x-better-security.md` Phases 2A–2D, the three blockers in
  `plans/security-architecture-review-phase-2-2026-07-18.md`, and whether Phase 3C may begin
  deleting production classifier predicates.
- Normative basis: `SPEC.md` §2; `spec/05-compiler.md`; `spec/06-type-system.md` §6.6;
  `spec/10-data-plane.md` §10.3; and `rules/security-classifier-refactors.md` C13.
- Independence: the review ran in a separate worktree forked exactly from the reviewed commit.
  Reproduction-only tests and a strict-TypeScript probe were not retained in this report commit.

## Superseding verdict

**REJECT at `56a3d969a`. Production-classifier deletion may not proceed from this tip.**

The original unverified-body and general-server-summary defects have been materially repaired, and
the compiler semantic graph is now wired into the real build and standalone static-extraction paths.
The positive private-summary boundary is still not closed, however: a strict-TypeScript-valid direct
alias can widen the callable signature and use an extra argument's evaluation to mutate the exact
carrier immediately before the proved helper reads it. The same defect suppresses KV438. A second
C13 defect lets a two-hop alias chain acquire positive private provenance despite the normative
one-direct-alias limit. The exact-tip C13 command is also red because the newly routed finite IR
rejects ordinary starter operations; therefore no superset/deletion claim is available.

## Status of the original three blockers

1. **Original Finding 1 — improved but not closed end to end.** Candidate summaries now require an
   exact same-file one-parameter/one-return projection whose declared kind/path matches the helper
   body. Property/method/imported/mutable targets and non-carrier arguments are covered by focused
   rejects. The invocation check at `static/session-provenance.ts:554-556` examines only argument
   zero, so the required sole-carrier correspondence is still bypassable (Finding 1 below).
2. **Original Finding 2 — its two exact routes are closed.** `serverValue` now requires positive
   literal/private proof and rejects missing/opaque values; the public summary union has no
   `server` kind and app-declared server summaries stay unknown. The new carrier-evaluation defect
   nevertheless reopens KV438 through otherwise valid private provenance (Finding 1).
3. **Original Finding 3 — routing exists; deletion readiness does not.** Real `kovo build` parses the
   immutable snapshot through capability closure/finite IR and passes byte-bound semantic sources
   to Drizzle (`build-export.ts:885-918`); standalone `drizzle-static` does the same
   (`compile.ts:1168-1179`). The Drizzle bridge checks exact bytes/span/callable/root family,
   authority categories, terminal inventory, closed siblings, and root traces. Handler-only TASK B
   predicates have not yet been surgically deleted/inventoried, and the exact C13 gate is red.

## Blocking findings

### 1. High — extra argument evaluation breaks helper/principal correspondence and KV438

`privateScopeHelperCallCarrierIsProven` accepts any call whose first argument is the exact enrolled
carrier; it does not require exactly one non-spread argument. TypeScript's direct-call arity check is
not a defense: the explicitly permitted direct immutable alias can be given a wider call signature
without a cast, `any`, an ignore directive, or a runtime wrapper.

The independent probe used this shape (the standalone `tsc --strict` check passed):

```ts
function current(context: Context) {
  return context.guard.userId;
}
kovoAnalyzerSummary(current, { returns: { kind: 'guard', path: 'userId' } });

const widened: (context: Context, ...ignored: unknown[]) => string = current;
const owner = widened(context, poison(context.guard, input.ownerId));
```

JavaScript evaluates `poison(...)` before invoking `current`, so the returned value is attacker
input. The owner-read probe reported `scope: "session"`, not `unknown`; the governed write
`serverValue(widened(...), "private owner")` produced no KV438 fact. Whole-callback integrity does
not repair this because the side-effecting reference is nested inside the call treated as the
audited use.

Required repair: a positive summary call must contain exactly the sole direct carrier argument,
with no extra or spread evaluation channel, for every OPP/invalidation/KV438 consumer. Add a C13
anchor and a forcing mutant that deletes this exact-arity check.

### 2. Blocking C13 defect — private helper aliases propagate beyond one hop

`addLocalHelperSummaryAliases` reads and extends the same summary map
(`static/session-provenance.ts:225-244`). Consequently `const first = current; const second = first`
promotes `second(context)` to `scope: "session"`. SPEC §6.6 permits only the helper itself or one
direct immutable same-file alias and explicitly closes alias chains.

This is also a migration/superset violation independent of exploitability: the replacement cannot
widen a prior/default closed verdict outside the normative grammar. Snapshot the initially proved
helper map when deriving aliases (or otherwise track hop count), enroll direct-positive and
two-hop-negative fixtures in C13, and add a mutant that restores transitive promotion.

### 3. Deletion gate is red at the reviewed commit

`pnpm run check:security-classifier-corpus` ran 21 corpora and reported 2,833/2,835 tests passing.
One failure is a contention-only 60-second semantic-summary-budget timeout (the same focused test
passes alone in 27.76 seconds). The substantive failure is the real create-kovo production artifact:
the finite IR closes ordinary starter Drizzle chains, `crypto.randomUUID`, exact `trustedAssign`,
`new Error`, and query ordering with KV449. Until that green-corpus regression is repaired and the
complete C13 command passes from the integrated tip, C13 provides no authorization to delete a
production predicate.

## Layered architecture assessment

- Capability closure, exact package summaries, and the finite compiler-owned operation inventory
  remain sound foundations in the reviewed evidence.
- Normalized summaries remain finite, budgeted, closed on unsupported transfers, and visible in
  diagnostics/explain. The byte/span-bound Drizzle consumer is deliberately narrow rather than a
  general JavaScript interpreter.
- Specialized Drizzle private-scope/OPP and KV438 consumers remain legitimate survivors until their
  exact invariants are replaced; they must not be described as compiler-owned finite-IR proof.
- C9 continues to assign real dynamic facts to reconstruct/box/own runtime floors and does not
  treat brands, sentinels, proxies, or static diagnostics as runtime enforcement.

## Conditions before deletion

1. Close Findings 1 and 2 with focused OPP/KV414/KV438 tests, C13 enrollment, and forcing mutants.
2. Restore the exact integrated C13 and green-corpus production build to green without weakening
   unknown-operation closure.
3. Name each handler-only TASK B predicate to delete, preserve request/process authority survivors,
   and record P/G rather than deleting shared `dangerousCallSink` logic wholesale.
4. Run the full classifier/compiler/integration/browser/build/package/performance/memory gates on
   the deletion tip and obtain another independent exact-tip review.

## Exact-tip evidence executed

- Focused integrated architecture/provenance suite: 10 files, 424/424 tests passed.
- `pnpm run check:security-gate-mutations`: 99/99 mutants killed, but neither finding above had a
  forcing mutant.
- `pnpm run check:green-corpus`: 18/18 rows passed.
- `pnpm run check:c9-sink-inventory`: 2 files, 23/23 tests passed.
- Reproduction-only private-summary probes: 3/3 fail-closed expectations failed; observed results
  were OPP `session`, alias-chain OPP `session`, and an empty KV438 fact list.
- Strict standalone type check for the widened-alias reproducer: passed with `--strict`, no casts,
  `any`, or ignore directives.
- `pnpm run check:security-classifier-corpus`: 21 corpora, 2,833/2,835 tests passed; failed as
  described above. The isolated semantic-summary-budget case passed 1/1 in 27.76 seconds.

This verdict reviews only `56a3d969a`; a subsequent repair commit requires independent re-review
before it can satisfy the Phase 2D approval item.
