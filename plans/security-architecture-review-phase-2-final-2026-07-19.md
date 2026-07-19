# Independent Phase 2 / Phase 3C security architecture re-review — 2026-07-19

## Review identity and scope

- Reviewed commit: `8e51a2bb34c60791ee3f5933b91748dcb1e14316`.
- Reviewed branch: `agent/security-plan-integration-20260718-0325` at the exact commit above.
- Independent worktree: `/Users/mini/kovo-agent-phase2-final-review-20260719`, branch
  `agent/phase2-final-review-20260719`.
- Scope: `plans/10x-better-security.md` Phases 2A–2D and 3C, especially OPP-28,
  every `kovoAnalyzerSummary` consumer, the compiler semantic carrier, TASK B predicate
  deletions, the two survivor families, and current C13/M/P/G evidence.
- Normative basis: `spec/06-type-system.md` §6.6, `spec/10-data-plane.md` §10.3,
  `rules/security-classifier-refactors.md`, and the active plan's own forcing-gate rules.
- Independence: this reviewer did not implement the reviewed production code and did not edit an
  active plan. Reproduction-only probes were authored in this worktree, executed, and deleted. This
  report is the only retained change.

## Verdict

**REJECT Phase 2A–2D architecture approval as a whole, REJECT the OPP-28 Phase 2C checkbox, and
REJECT declaring Phase 3C complete at this commit.**

The earlier summary-declaration laundering and `serverValue(unknown)` defects are repaired. The
capability graph, finite IR, normalized semantic graph v2, and C9 inventory remain sound foundations.
The reviewed TASK B name-predicate deletions may also remain deleted: raw registrations and unknown
calls/constructors still close through structural authority boundaries.

The integrated OPP-28 consumer is nevertheless unsound. It reports `scope: session`, suppresses
KV414, and lets `kovo check` return `OK` when there is no accepted guard, when the accepted guard is
a different principal, and when a later guard mutates the accepted principal from validated remote
input. The compiler emits no diagnostic for the query reproductions. The real query runner confirms
that the mutation reaches the loader. This is a supported-path ordinary-remote false authorization,
not merely stale prose.

Both production survivors MUST remain:

1. `requestProcessSinksForProject` remains the request/process KV424 owner.
2. `static/session-provenance.ts`, `static/summaries.ts`, and the write analyzer remain the
   specialized Drizzle KV406/OPP owner. This review found its positive authorization verdict
   unsound, so it is not eligible for deletion or replacement claims.

## Ranked findings

### 1. High — OPP-28 does not require the same accepted guard, and a later guard can replace the principal

The normative OPP-28 subset requires an exact private principal, exact owner column,
equality-equivalent predicate, and **the same accepted guard principal**
(`spec/06-type-system.md:443-451`). The implementation does not make that last condition part of
the verdict:

- `queryPrivateScopeKeyOperand` accepts a structurally summarized guard call directly
  (`packages/drizzle/src/static/summaries.ts:1489-1500`).
- `privateScopeMatchesOwner` treats `guard:<owner>` as owner proof without consulting the accepted
  guard set (`packages/drizzle/src/static/summaries.ts:622-649`).
- owner read and write facts promote that key to `scope: session`
  (`packages/drizzle/src/static.ts:408-421`, `:4013-4038`, and `:5358-5366`).
- `acceptedGuardPrivateKeys` changes only the human-readable suffix
  (`packages/drizzle/src/static.ts:598-610`); it is not a prerequisite for the positive verdict.

Three independent fail-closed probes all produced `scope: "session"`, `kovo-check/v1 OK`, and no
compiler diagnostic:

1. a summarized `guard:userId` owner predicate on a query with no `guard` property;
2. the same owner predicate when `guards.all(currentActor)` accepts `guard:actorId` instead;
3. this ordered composition, where validated remote input replaces the principal after the exact
   summarized guard returned `true`:

```ts
function current(request: Request) {
  return request.guard.userId;
}
kovoAnalyzerSummary(current, { returns: { kind: 'guard', path: 'userId' } });

function prime(request: Request) {
  request.guard.userId = true;
  return true;
}
function poison(request: Request) {
  request.guard.userId = request.args.userId;
  return true;
}

export const list = query({
  args: s.object({ userId: s.string() }),
  guard: guards.all(prime, current, poison),
  async load(_input, context) {
    return context.db
      .select()
      .from(docs)
      .where(eq(docs.userId, context.request.guard.userId));
  },
});
```

An equivalent runtime probe through the real `runQuery` path completed successfully and the loader
observed the attacker-selected `userId`. `guards.all` executes left-to-right and requires exact
`true` (`packages/server/src/guards.ts:691-710`); the sequence above primes that result, then mutates
the same live nested object before the loader. The query runner threads the post-guard request into
the loader (`packages/server/src/query.ts:525-558`).

Impact: an ordinary authorization bug can select another owner's rows while the static gate claims
owner scope and suppresses KV414. PostgreSQL RLS may independently deny some deployments, but it
does not make the by-construction verdict honest, and it does not cover every supported engine or
policy shape. The same missing accepted-guard prerequisite exists in write-side `kovo check`
classification; a direct-DB mutation probe was reported `scope: session`/`OK`, although the compiler
separately rejected that particular source with KV330.

Blocking repair:

- A `guard:*` owner proof must be intersected with the exact accepted-guard key before any read or
  write fact becomes owner-scoped. Missing or mismatched keys remain `scope: unknown`.
- Preserve the accepted principal's value across the guard-to-handler boundary. Either snapshot a
  framework-owned immutable principal before arbitrary sibling guards can mutate it, or admit only a
  composition grammar whose complete ordered chain proves that the principal cannot be rewritten.
- Add the no-guard, mismatched-guard, prime/accept/poison, and real-runner cases to C13, plus
  behavioral mutants that remove the accepted-key intersection and the mutation barrier.

### 2. Medium, architecture-blocking — the accepted-guard consumer admits a second helper alias hop

The shared helper map correctly contains the exact declaration and at most one direct immutable
alias (`packages/drizzle/src/static/session-provenance.ts:58-84`, `:224-248`). The ordinary static
call consumer also deliberately refuses another hop
(`packages/drizzle/src/static/summaries.ts:1902-1924`).

The accepted-guard collector bypasses that boundary. After checking the shared helper map, it
recursively follows any local `const` initializer to depth four
(`packages/drizzle/src/static/summaries.ts:948-1011`, `:1104-1114`). Therefore:

```ts
const firstAlias = current;
const secondAlias = firstAlias;
query({ guard: guards.all(secondAlias), load: /* owner predicate */ });
```

was reported `scope: session`; `kovo check` passed and the compiler emitted no diagnostic. This
contradicts the explicit one-alias and uniform-consumer boundary in
`spec/06-type-system.md:453-479`.

The alias chain alone preserves the same function identity and is not the remote exploit in Finding
1. It is still a fail-open proof-language expansion. It also shows why the current mutation count is
misleading: `drizzle-analyzer-summary/allow-opp-alias-chain` kills recursive expansion in the
ordinary static callable consumer, but does not exercise this accepted-guard consumer, which already
has the forbidden behavior.

Blocking repair: resolve accepted guard callables only through the shared exact helper map. Do not
recursively expand `localConstInitializer` in that consumer. Add a consumer-level behavioral mutant
and C13 case so every summary consumer enforces the same finite grammar.

### 3. Medium, compiler-mitigated — `serverValue` can launder the exact framework carrier in the specialized analyzer

The whole-callback carrier scan treats exact framework `serverValue` as a reviewed consumer
(`packages/drizzle/src/static/session-provenance.ts:642-675`, `:734-759`, `:857-861`). Because the
runtime helper returns its input, this creates an untracked identity alias:

```ts
const carrierAlias = serverValue(context, 'server carrier');
poison(carrierAlias, input.userId);
// later: eq(docs.userId, current(context))
```

The standalone owner audit still reported `scope: session` after the opaque mutation. This violates
the exact-carrier/all-consumer promise: the integrity walk sees the reviewed `serverValue` call but
does not relate later uses of its returned alias back to the framework carrier.

The integrated compiler did emit KV449 for this source (`serverValue` cannot receive server
authority), so this exact shape does not ship through the official compiler path. It remains an
audit-side false proof and demonstrates that the specialized survivor is not independently closed.

Repair: `serverValue` may consume a proved immutable scalar projection, never the request/context
carrier itself or a private object branch. Enroll the analyzer-only and compiler-integrated outcomes
in one cross-consumer test and mutant.

### 4. Blocking readiness gap — exact-tip C13, mutation, and convergence gates are red

The relevant Phase 2/3C focused suites pass, but the required repository gates do not:

- `pnpm run check:security-classifier-corpus` failed with 21 corpora: 5 files failed, 81 passed;
  6 tests failed and 3,052 passed. Deterministic failures include four stale framework source-tree
  digests, the production environment-authority test, and two replay-policy tests. The production
  starter build also failed from the stale digests. One header-oracle date mismatch passed on an
  immediate isolated rerun and is recorded as a flake, not as a security finding.
- `pnpm run check:security-gate-mutations` produced 247 killed / 249 total. Two mutants failed in the
  harness before their killer assertion: `compiler-finite-ir/drop-random-uuid-stability` had a
  non-unique mutation target, and `server-egress/drop-task-context-fetch-seal` could not find its
  target.
- `pnpm run check:security-convergence-baseline` failed because the committed snapshot is stale.
  Current deterministic structure is M=249, P=8,112, G=18, C13=21 corpora / 219 anchors / 91 test
  files; the committed snapshot expects M=114, P=8,021, G=18, C13=21 / 198 / 80.

These failures independently keep the Phase 3C full-gate checkbox open. A focused green subset is
not authority to declare the treadmill retired.

## Accepted architecture and repaired prior blockers

The following portions pass this review and do not need to be rolled back:

- **Candidate-marker structural proof.** The analyzer now proves one exact same-file declaration,
  one parameter, one return, exact private prefix/path, immutable binding, and one direct alias
  snapshot (`packages/drizzle/src/static/session-provenance.ts:58-248`). The public summary kind is
  limited to `guard | session | tenant`; no app-declared `server` kind remains
  (`packages/drizzle/src/drizzle-surface.ts:32-51`). The prior arbitrary-body and declared-server
  laundering findings are closed.
- **Positive `serverValue` provenance.** The previous unknown-to-safe path is covered by the current
  provenance corpus and focused mass-assignment tests. Finding 3 is a different exact-carrier return
  alias inconsistency, not restoration of the old unknown-value defect.
- **Semantic carrier v2.** Drizzle requires byte-identical source arrays and graph v2, reconstructs
  factory/root/callback identity and spans, exact invocation and argument spans, authority vectors,
  summary/invocation equality, terminal inventory, doors, and closed root/sibling quarantine
  (`packages/drizzle/src/trust-escapes-static.ts:1555-1754`). Focused compiler, CLI, and adversarial
  semantic-bridge tests passed. No self-consistent-carrier-only admission was reproduced.
- **C9 runtime floor.** The inventory passed 28/28 and still rejects brands, sentinels, proxies, or
  static diagnostics as the dynamic enforcement mechanism.

## TASK B deletion and survivor assessment

### Deletions that may remain

1. `35d4ebb8f` removed compiler-owned JSX handlers from the older Drizzle per-name scan. Finite
   browser IR/KV449 owns those handlers.
2. `3c3eba9d2` removed the raw imperative callback-body dangerous-name lexicon. Raw `on*` writes and
   `addEventListener` calls close at registration as opaque protocol/call authority.
3. `7dc57a045` removed parallel spelling predicates for dynamic module resolution,
   `Function.constructor`, `import()`, `Function`, and dangerous calls after exact raw capability or
   the generic opaque-call/opaque-constructor boundary took ownership.

The complete `trust-escapes-static.test.ts` suite passed in the focused run. Independent computed
`element["onclick"]`, computed `addEventListener`, detached method, and `Reflect.set` probes all
closed structurally. All 28 `drizzle-analyzer-summary/*` mutants plus the two
`drizzle-task-b/*` mutants were killed in a targeted 30/30 run.

One evidence improvement remains: add a behavioral mutant that deletes the generic unknown-call or
unknown-constructor closure used by the `7dc57a045` collapse. The current TASK B mutants prove the
authoritative pass is always reached and raw registrations stay closed, but neither directly removes
that generic terminal boundary. This is a forcing-gate coverage gap, not a reproduced open terminal.

### Survivors that must remain

- **Request/process KV424:** keep `requestProcessSinksForProject` and its complete root census,
  module-initializer scan, raw authority facts, package closure, opaque protocol/call/constructor
  boundaries, budget, and retained-config checks. Its current behavioral mutants are necessary but
  should be supplemented as noted above.
- **Specialized Drizzle KV406/OPP:** keep the session-provenance, summary/predicate, write, target,
  and operation mapping. Findings 1–3 must be repaired inside or below this survivor before any
  normalized-graph replacement or deletion claim. The compiler semantic graph currently proves
  helper effect reachability; it does not yet prove the accepted-principal value correspondence that
  OPP-28 needs.

## Ordinary-remote scope and residual risks

- Finding 1 does not require a hostile dependency, same-realm intrinsic poisoning, hand-authored IR,
  or privileged host misuse. It requires an ordinary app authorization mistake plus remote control
  of a validated query argument, which is inside the reviewed threat scope.
- Deliberately malicious application code remains outside the same-realm sandbox claim. That does
  not excuse a positive static authorization verdict for an ordinary mutable guard chain; unknown
  correspondence must remain unknown under the normative honesty boundary.
- PostgreSQL RLS and runtime policies remain essential dynamic floors. They are not proof that a
  static OPP/KV414 result is sound, and engine/policy coverage varies.
- Package summaries and generated manifests remain audit evidence, not runtime authority. This
  review did not retest hostile third-party dependencies, external PostgreSQL matrices, browsers,
  GitHub Actions, or release fuzzers.

## Exact-tip evidence executed

- Focused Phase 2/3C suite over Drizzle OPP, summary stability, carrier mutations, TASK B,
  compiler semantic IR, response provenance, and CLI semantic bridge: 8 files, 824 tests passed.
- Targeted analyzer/TASK B mutation harness: 30/30 killed (28 analyzer-summary plus 2 TASK B).
- Full mutation harness: 247/249 killed; 2 harness failures described in Finding 4.
- `pnpm run check:security-classifier-corpus`: failed; 3,052 passed / 6 failed across the 21-corpus
  run. The OPP/TASK B files in that run passed; failures are listed in Finding 4.
- `pnpm run check:green-corpus`: 18/18 rows passed.
- `pnpm run check:c9-sink-inventory`: 2 files, 28/28 tests passed.
- Deterministic convergence collector: M=249, P=8,112, G=18, C13=21/219/91; committed baseline gate
  failed on snapshot drift.
- TASK B reproduction-only probes: 4/4 structural variants closed; file deleted.
- OPP reproduction-only probes: no guard, mismatched guard, two-hop accepted-guard alias, composed
  principal mutation, write-side missing guard, and exact-carrier `serverValue` alias all reproduced
  the fail-open specialized verdicts described above; file deleted.
- Real query-runner reproduction: the ordered guard mutation completed and the loader observed the
  validated attacker-selected principal; file deleted.

All commands ran in the independent worktree at the reviewed SHA before this report commit.
