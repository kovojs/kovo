# Independent OPP-28 / runtime-receipt exact-tip re-review — 2026-07-19

## Identity and scope

- Exact reviewed commit: `e53284896b57a5b26ad2a89cff2dd6cc4b40aa72`.
- Independent worktree / branch:
  `/Users/mini/kovo-agent-opp28-exact-rereview-e532-20260719` /
  `review/opp28-exact-tip-e532-20260719`.
- Normative basis: SPEC §2, SPEC §6.6's security-soundness and classify-and-pin rules,
  Authorization-gates-DATA's exact accepted-principal/predicate correspondence, SPEC §10.3's
  arg-aware guard and KV414 contracts, and `rules/security-classifier-refactors.md`.
- Prior counterexamples retested: all cases in
  `security-architecture-review-phase-2-final-2026-07-19.md`,
  `security-architecture-review-phase-2-exact-tip-rereview-2026-07-19.md`, and
  `security-architecture-review-opp28-runtime-receipt-exact-tip-2026-07-19.md`.
- Review-only discipline: two throwaway runtime suites were created, run, strict-checked, and
  deleted. No production source, existing test, active plan, goal, generated artifact, or posture
  ledger was changed. This report is the only retained change.
- Same-process intrinsic poisoning was out of scope. The blocking reproduction below neither
  replaces nor mutates an intrinsic; it invokes the unchanged native `Date.prototype.setTime`.

## Verdict

**REJECT the complete OPP-28/runtime-receipt closure at `e53284896`.**

The integrated repair **does close the prior ordinary plain-data failures**. I accept the following
bounded subset, with `Date` and route params expressly excluded:

- exact static accepted-guard key correspondence for the finite, body-proved Drizzle subset;
- deep post-provider reconstruction of private `guard`, `session`, and `tenant` roots;
- query and mutation args made from bounded primitives, plain records, dense arrays, committed file
  receipts, and exact framework-minted `ScopedKey` / `Secret` capability leaves;
- rejection of schema-returned accessors and unstable descriptors, plus detachment from a
  schema-returned Proxy's `get` behavior and from caller-retained plain sources;
- final query-loader and mutation-handler consumption of the detached plain-data receipt.

That bounded acceptance is not enough to close the plan item. `s.datetime()` still yields a real
`Date`, and the attempted immutable Date receipt can be changed after an ownership guard accepts it.
Both final consumers then observe a remote-selected replacement timestamp.

## Ranked findings

### 1. High — a borrowed native Date mutator changes the accepted key before both final consumers

`snapshotGuardArgsReceipt` promises one exact bounded value for the guard chain and loader/handler
(`packages/server/src/guard-args-receipt.ts:47-68`). Its Date branch clones the timestamp, shadows
the ordinary mutator names with throwing own properties, freezes the object, and registers it as a
receipt (`:82-98`). This blocks `receipt.setTime(...)`, but `Object.freeze()` does not freeze a
Date's internal `[[DateValue]]` slot. An unchanged native method can still target that slot:

```ts
Date.prototype.setTime.call(receipt, replacement.getTime());
```

The independent strict-TypeScript probe used validated args
`{ authorized: s.datetime(), selected: s.datetime() }` and an authenticated `guards.owns` guard.
The ownership predicate accepted only `authorized === 2025-07-20T00:00:00.000Z`. A later guard
applied the separately remote-validated `selected` timestamp with the call above and returned exact
`true`. Results on the real runners were:

- query: the loader returned remote-selected `1970-01-01T00:00:00.000Z`;
- mutation: the handler returned the same remote-selected replacement.

The query path intentionally gives the loader the same receipt used by the guards
(`packages/server/src/query.ts:529-554`). The mutation path likewise retains that receipt through
the guard and tracked-input dispatch (`packages/server/src/mutation.ts:442-470`). Consequently, a
successful ownership decision no longer corresponds to the value used by the final read/write
consumer. This can become an IDOR whenever the Date participates in resource selection.

This is within the ordinary-remote charter: the attacker supplies supported validated values and
triggers ordinary app guard/helper logic. It does not require a hostile dependency, hand-authored
IR, intrinsic replacement, or deliberately malicious host code. The prerequisite is a later helper
which uses the standard borrowed-call form—less common than `date.setTime`, but valid JavaScript and
exactly the mutation the receipt claims to prevent.

Required repair: make the authorization correspondence consume an actually immutable canonical
timestamp receipt, not the mutable Date object. Viable designs include a framework-owned accepted-
key scalar that both authorization and the data predicate must consume, or a new immutable temporal
value API whose runtime representation has no Date internal slot. Merely adding more own throwing
methods or freezing the Date cannot repair this class. Add query, direct mutation, enhanced mutation
lifecycle, call/apply/`Reflect.apply`, and every native Date mutator to C13, plus a behavioral mutant
that removes the immutable temporal/accepted-key door.

### 2. Medium proof-integrity defect — a tracked pre-fix reproducer still requires the old fail-open

`packages/server/src/opp28-runtime-rereview.test.ts:9-10` says its expectations describe the
current unsound result. Its query and mutation assertions still require `value: "victim"`
(`:42-68`). At this exact tip both tests fail because production correctly returns `owned`.

This is not a surviving Proxy-drift vulnerability; it is stale retained evidence. Nevertheless it
makes a broad server/root Vitest run red and leaves the repository carrying a test which asserts the
opposite of the repaired contract. Replace both expectations with fail-closed/`owned` assertions,
update the description, and enroll or consolidate the case with
`guard-args-receipt-security.test.ts`. This review did not edit it.

## Retested counterexample matrix

| Case | Exact-tip result |
| --- | --- |
| No accepted static guard | `scope: unknown`; KV414 |
| Mismatched accepted principal | `scope: unknown`; KV414 |
| Opaque sibling before / after summarized leaf | both close to `unknown` |
| Prime then current / current then poison | static verdict closes |
| Two independently body-proved same-key boolean helpers | bounded positive: `scope: session` |
| Two-hop helper or accepted-guard aliases | close to `unknown` |
| `serverValue(context)` whole-carrier laundering | closes |
| Final read/write consumer with absent or mismatched accepted key | all close to `unknown` |
| Schema Proxy `get` drift, query / mutation | detached; both consumers receive `owned`; zero `get` reads |
| Schema accessor, query / mutation | rejected before guard/consumer; zero getter reads |
| Schema descriptor drift, query / mutation | rejected before guard/consumer |
| Caller-retained raw args across `await` | detached on both paths |
| Private `guard` / provider `session` / `tenant` source drift | all remain pinned on query and mutation |
| Accessor in each private root | rejected with zero getter reads |
| Async provider and async custom-schema ordering | provider completes first; completed values are pinned |
| `ScopedKey` and `Secret` compatibility | exact witnessed identity preserved on query and mutation |
| File compatibility | metadata and bytes detached; source mutation is invisible |
| Date direct mutator compatibility | reads work and `receipt.setTime(...)` throws |
| Date borrowed native mutator | **remote-selected drift reaches query and mutation consumers** |
| Same-process intrinsic poisoning | not tested; out of scope |

The accepted static subset remains deliberately narrow. Arbitrary public `guards.owns` callbacks
still claim no SQL/static correspondence, and a string-valued owner extractor is not itself an
executable `Guard` because runtime access accepts exact `true`. The accepted positive is the exact
body-proved boolean/key grammar covered by the retained suite, not general JavaScript predicate
correctness.

## Retained TASK B and engine/audit duties

This review authorizes no classifier deletion and no plan checkbox:

1. Keep `requestProcessSinksForProject` as the request/process KV424 authority and reachability
   survivor until capability closure or finite IR proves the same roots and terminals.
2. Keep the specialized Drizzle KV406/OPP machinery in `static/session-provenance.ts`,
   `static/summaries.ts`, and the write analyzer. The normalized graph has not replaced its exact
   carrier/principal/predicate/operation mapping.
3. Keep arbitrary JavaScript predicate correctness as an explicit engine/audit responsibility.
   Static key equality alone must not be presented as dynamic value correspondence.
4. Keep the Phase 2C OPP item open until the Date receipt is repaired, the stale retained test is
   corrected, focused C13/mutants force the repair, and an independent exact-tip re-review accepts
   the resulting bounded claim.

## Residuals and acceptance conditions

- **Adjacent route params are not accepted by this report.** The requested probes covered query and
  mutation. `withGuardParams` still attaches parsed params without `snapshotGuardArgsReceipt`
  (`packages/server/src/guards.ts:1672-1682`), while a route page later receives the separate
  `routeRequest.params`. Review and pin that path before generalizing the receipt claim to routes.
- **`Secret<T>` compatibility is capability identity, not deep payload immutability.** The positive
  proves the exact module-private box survives. Object-valued secret payloads are not reconstructed
  by this receipt; do not derive an accepted ownership principal from mutable revealed payload and
  call it covered without a separate proof.
- The full classifier corpus was deliberately not started while the integration thread ran the DB
  gates. Focused C13-owned files, relevant mutants, C9, and green-corpus were run instead. A complete
  closure still requires the authoritative full gates on the repaired integration tip.
- A root `tsc --noEmit` attempt is not a usable green signal at this tip because the repository has
  broad unrelated existing type errors. Filtered strict output contained no diagnostics for either
  throwaway probe.
- Any integration after `e53284896` requires another exact-tip check; this verdict must not be
  carried forward by branch name.

## Evidence executed

- `pnpm install --frozen-lockfile` — passed.
- Independent requested runtime matrix — 9/9 passed; the two Date tests positively reproduced the
  borrowed-mutator drift; probe deleted.
- Independent remote-selected Date matrix — 2/2 reproduced query and mutation drift; probe deleted.
- Filtered strict TypeScript checks — no diagnostics for either throwaway probe.
- `pnpm exec vitest --run packages/server/src/guard-args-receipt-security.test.ts packages/drizzle/src/index.phase2c-exact-tip-adversarial.test.ts --reporter=dot`
  — 65/65 passed.
- `pnpm exec vitest --run packages/drizzle/src/index.summary-callable-stability.test.ts --reporter=dot`
  — 28/28 passed.
- Focused final-consumer/accepted-predicate cases in `index.scope-audits.test.ts` — 4/4 passed
  (100 unrelated tests skipped by name filter).
- Eleven selected runtime-private-root, validated-args, accepted-guard, alias, carrier, and final-
  consumer behavioral mutants — 11/11 killed.
- `pnpm run check:c9-sink-inventory` — 2 files, 28/28 passed.
- `pnpm run check:green-corpus` — `check-green-corpus/v1 OK rows=18`.
- `pnpm exec vitest --run packages/server/src/opp28-runtime-rereview.test.ts --reporter=dot`
  — 0/2 because both stale assertions expected `victim`; actual repaired result was `owned`.

Nothing was pushed.
