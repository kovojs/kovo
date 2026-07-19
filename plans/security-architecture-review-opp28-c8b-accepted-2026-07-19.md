# Independent OPP-28 bounded-closure review — 2026-07-19

## Identity and verdict

- Reviewed production commit: `c8b638178b0c4f2aee248045d20cd0190ce2fb45`.
- Normative basis: SPEC §6.6, SPEC §10.3 C15, and the Authorization-gates-DATA honesty boundary.
- Threat scope: ordinary remotely selected supported query/mutation input. Same-process intrinsic
  replacement is outside scope; the previously blocking exploit used the unchanged native
  `Date.prototype.setTime` and therefore remained in scope.

**ACCEPT the bounded OPP-28 query/mutation subset. Do not generalize this verdict to arbitrary
JavaScript predicates, route params, or mutable temporal objects.**

The exact body-proved Drizzle subset now requires the same accepted private-principal symbol at the
producer and final owner-predicate consumer. App-authored `kovoAnalyzerSummary` metadata is only a
candidate: the analyzer independently resolves a direct same-file immutable helper, verifies its
closed property-chain body, carrier role, ordered guard composition, and exact accepted-principal
intersection. Unknown, mismatched, opaque-sibling, aliased-too-far, or absent correspondence stays
unknown and receives KV414 rather than owner-scoped authority.

At runtime, query and mutation inputs are reconstructed once before providers run. Guards and final
loaders/handlers consume that same receipt. The accepted graph is deliberately finite: primitives,
plain own-data records, dense arrays, detached file receipts, and exact witnessed `ScopedKey` /
`Secret` leaves. Accessors, unstable descriptors, Proxy read drift, and caller-retained source
mutation fail closed or become invisible.

## Closure of the blocking `Date` counterexample

The prior receipt cloned and froze a real `Date`, but this remained mutable through:

```ts
Date.prototype.setTime.call(receipt, replacement.getTime());
```

That call changed the key after `guards.owns` accepted it and before both final consumers. The
reviewed implementation no longer attempts an unsound membrane. It rejects any `Date` leaf before
session providers, guards, loaders, or handlers execute, with a diagnostic directing authors to an
ISO string or epoch number. This is the stronger and honest technical-preview contract: a Proxy
cannot simultaneously preserve native Date brand, borrowed reads, and structured-clone behavior
while serving as the security mechanism.

The red-first query and mutation cases now require precise rejection, zero provider calls, and zero
final-consumer calls. The stale Proxy-drift reproducer now requires the detached value (`owned`), not
the historical fail-open value (`victim`).

## Retained boundaries

- Arbitrary JavaScript guard semantics, general predicate equivalence, multi-principal policy
  composition, and database policy correctness remain engine/runtime-policy and review duties.
- Route `params` use a separate carrier path and are not accepted by this review. No query/mutation
  receipt evidence may be relabeled as route-param coverage.
- Exact witnessed `Secret` identity does not prove deep immutability of an object-valued revealed
  payload.
- The specialized Drizzle producer/consumer analysis and runtime C15 receipt remain required. This
  verdict authorizes no deletion merely because the normalized graph exists.

## Evidence

- `pnpm exec vitest --run packages/drizzle/src/index.phase2c-exact-tip-adversarial.test.ts packages/drizzle/src/index.summary-callable-stability.test.ts packages/drizzle/src/index.query-loader-receivers.test.ts packages/server/src/guard-args-receipt-security.test.ts packages/server/src/opp28-runtime-rereview.test.ts --reporter=dot`
  — 5 files, 138 tests passed.
- Five selected behavioral mutants were killed:
  `drop-owner-accepted-guard-intersection`, `allow-opaque-accepted-guard-sibling`,
  `drop-final-accepted-guard-consumer`, `drop-guard-args-receipt`, and
  `allow-mutable-date-guard-args-receipt`.
- The implementation worker independently reported 144/144 focused static/runtime tests, 28/28 C9
  inventory tests, and an 18-row green corpus before this review.

The full repository security corpus still needs one integration-tip rerun after all concurrent
source branches and generated proof artifacts settle. That integration obligation does not widen
or weaken this bounded architectural verdict.
