# Phase 2C analyzer-summary independent review — 2026-07-18

## Review identity

- Reviewed commit: `800bcefa5fa956b713bb98b2e19fb9ee0f8a2c46`.
- Worktree/branch: `kovo-agent-phase2c-adversarial-review-800b-20260718` /
  `agent/phase2c-adversarial-review-800b-20260718`.
- Scope: analyzer-summary declaration/body proof, aliases and mutation, carrier roles, imported and
  opaque calls, principal/path correspondence, and the Drizzle consumers of private provenance.
- Independence: no reviewed production file was modified. This branch retains only adversarial
  regression tests and this report.

## Verdict

**REJECT.** Commit `800bcefa5` must not close Phase 2C or authorize Phase 3C migration. The exact tip
correctly rejects `this`, renamed leading inputs, imported helpers, malformed declarations, opaque
calls, and app-declared general server provenance. It still contains one critical end-to-end KV438
bypass and two additional false-private proof families.

## Ranked findings

### 1. Critical — positional fallback launders validated mutation input through KV438

`privateScopeHelperCarrierBindingIsProven` treats every parameter after a Drizzle-typed parameter as
private context and, outside a recognized framework callback, treats every parameter after index
zero the same way (`packages/drizzle/src/static/session-provenance.ts:509-558`). Neither rule proves
the argument at the invocation site.

The retained regression creates an exact `mutation.handler(input, context)`, then calls a nested
function as `nestedWrite(context.db, input)`. The nested function names its second parameter
`request` and passes it to a structurally valid summarized helper:

```ts
async function nestedWrite(db, request) {
  await db.update(accounts).set({
    ownerId: serverValue(exactGuard(request), 'claimed private owner'),
  });
}
await nestedWrite(context.db, input);
```

Expected: a KV438 mass-assignment fact for governed `ownerId` (input or unknown is closed). Actual:
`extractMassAssignmentFromProject` returns `[]`. This is an executable input-to-governed-owner write,
not a precision-only report issue. `governedValueVerdict` recursively accepts the summarized call as
private provenance (`packages/drizzle/src/static/derivation.ts:1457-1478`).

### 2. High — mutable summarized bindings and post-mutation aliases retain private proof

The structural body is checked once, but the helper binding is not proven immutable. A function
declaration can be reassigned before its summarized call. `addLocalHelperSummaryAliases` also grants
the same proof to any `const` initialized from the summarized symbol without checking source order
or prior writes (`packages/drizzle/src/static/session-provenance.ts:177-204`).

Both retained probes are classified `scope: "session"` instead of `unknown`:

```ts
mutableGuard = () => targetId;
eq(orders.userId, mutableGuard(ctx));

aliasGuard = () => targetId;
const capturedAfterMutation = aliasGuard;
eq(orders.userId, capturedAfterMutation(ctx));
```

These are exploitable false-private KV414/OPP-28 verdicts: the runtime predicate uses an ordinary
argument while the audit claims an accepted private principal. As a useful control, reassignment of
an object method (`guardFns.current = ...`) remained `scope: "unknown"` at this tip.

### 3. High — an arbitrary prefix before `guard`/`session`/`tenant` is accepted

`exactLocalPrivateScopeHelperProvenance` selects the first private-looking segment anywhere in the
returned path (`packages/drizzle/src/static/session-provenance.ts:101-139`). Therefore this helper is
accepted as `guard:userId`:

```ts
function prefixedGuard(ctx) {
  return ctx.input.guard.userId;
}
```

The retained owner-predicate probe receives `scope: "session"`, expected `unknown`. The prefix is
not a proven framework carrier projection; it may be an input/body/container field. This is a
structural-proof soundness hole, not merely an over-rejection or diagnostic-quality issue.

## Consumer review

- KV438 is directly defeated by Finding 1 through `privateScopeForExpression` in the governed-value
  recursion.
- KV414/OPP-28 owner audits are directly defeated by Findings 1–3 through
  `summarizedStaticCallPrivateScope` (`packages/drizzle/src/static/summaries.ts:2106-2116`).
- Query-key, invalidation, accepted-guard, symbolic-effect, and explain paths consume the same
  `SessionProvenanceContext.helpers` map and the same call admission function. Code inspection found
  no independent validation that repairs these false-private values downstream.
- No surviving app `server` summary or opaque-symbol-call promotion was found. Imported summaries,
  mismatched paths, multi-statement/default/rest/generator helpers, a leading input renamed
  `request`, and `this` all remained closed in focused controls.

## Blocking repairs

- [ ] Remove both positional fallbacks. A summarized invocation must bind its argument to an exact
      enrolled framework carrier role, including nested/local helper call-site argument mapping;
      unresolved roles close.
- [ ] Restrict structural prefixes before the private segment to the finite supported grammar (for
      example no prefix or exactly `request`), and reject input/body/container prefixes.
- [ ] Prove helper identity immutable for the whole analyzed interval. Reject mutable function or
      method bindings, reflective writes, and aliases captured after an unresolved/prior write.
- [ ] Retain the two regression tests in this branch, enroll their exact snippets in C13, and add
      mutations for positional fallback, arbitrary-prefix acceptance, mutable helper identity, and
      post-mutation alias propagation.
- [ ] Rerun the full classifier corpus, mutation gate, focused owner/mass-assignment suites, starter
      production builds, and an independent exact-tip review before Phase 2C can close.

## Evidence

- `pnpm exec vitest --run packages/drizzle/src/index.mass-assignment.test.ts -t "adversarial review rejects nested mutation input"`
  — expected closed KV438 fact; failed because actual result was `[]` (1 failed, 36 skipped).
- `pnpm exec vitest --run packages/drizzle/src/index.scope-audits.test.ts -t "adversarial review rejects unproven positional"`
  — expected `unknown`; failed with `session` for positional, arbitrary-prefix, mutable-binding, and
  post-mutation-alias probes. The object-property mutation control stayed `unknown` (1 failed,
  101 skipped).
- Existing closed controls passed: the exact malformed/private-summary scope test (1/1) and opaque
  `serverValue` mass-assignment test (1/1).
- `pnpm run check:security-gate-mutations` passed with 77/77 mutants killed. The existing mutants do
  not cover the four transitions above.

The full C13 command was not rerun after retaining the deliberately failing regressions: both test
files are already enrolled, so the focused failures are sufficient to establish the rejection and
the full corpus cannot be green until the production defects are repaired.
