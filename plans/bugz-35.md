# Security Bug Ledger (`bugz-35`)

<!-- kovo-security-ledger: transient -->

**Date:** 2026-07-21
**Status:** CLOSED — remediation complete; publication and required CI pending
**Baseline:** `cc1463f2451c7d5275e09a70df4f25fe1af39b7c`
**Lifecycle:** `closed-pending-publication`; archive by 2026-08-18 to
`plans/history/bugz-35.md` after the verified closing tip is published and required CI is green.

**Scope:** Distinct security and security-evidence defects found while closing the three 10x
security roadmaps. The tutorial findings affect the checked-in teaching application and its gate,
not Kovo's runtime enforcement. A full search across `plans/` found no prior instance of the same
roots. Generic test-process cleanup and a non-security `<Defer>` documentation mismatch were
excluded.

## Severity summary

| Severity | Open | Closed |
| -------- | ---: | -----: |
| High     |    0 |      0 |
| Medium   |    0 |      2 |
| Low      |    0 |      2 |

## Medium

- [x] **M1 — The analysis-time TCB closure silently omitted security gates moved behind the
      reviewed cost-runner registry.**
  - The root package script named only `security-cost-budget-runner.mjs`; the real gate commands in
    `security/plan3-security-gate-commands.json` were invisible to entrypoint discovery. The closure
    therefore stayed green after losing Better Auth gate roots and their transitive packages from
    the integrity-pinned analysis subject. This weakened plan 2 §1.3's supply-chain evidence; it was
    not a remotely exploitable runtime path.
  - **Dedup:** distinct from the original plan 2 §1.3 closure implementation: this is the later
    command-registry indirection regression, not a new analyzer dependency or a previously reported
    runtime module-loading bypass.
  - **Closure:** `dcdc55d73` makes discovery parse the fixed registry/schema fail closed, validate
    each non-self-check argv, and feed the recovered script/test roots through normal executable and
    dependency closure.
  - **Evidence:** `node scripts/check-analysis-time-closure.mjs` reports 168 roots and 421
    optional-inclusive integrity-pinned package subjects; the focused analysis-closure suite passes
    10/10 and proves registry-hidden Better Auth entrypoints are discovered.

- [x] **M2 — The final tutorial application exposed one authenticated user's cart and orders to
      another authenticated user.** _(tutorial/example only)_
  - Step 07 authenticated the add-to-cart mutation, but cart rows carried no principal, the cart
    query summed every row, and order history returned every order. The route also rendered both
    private consumers without an authenticated-session branch. Direct tutorial execution therefore
    exposed a real cross-principal read and shared-cart write, and copying the logic would reproduce
    it. Kovo's runtime guard machinery was not bypassed, and a production gate that saw the missing
    access facts could reject the app; the example and its own verification had omitted the required
    guard and scope decisions from SPEC §6.5/§10.2.
  - **Dedup:** prior cross-user findings concern framework caches, SQL/runtime authority, or secret
    boundaries. This root is confined to the checked-in tutorial's authored data model and queries.
  - **Closure:** `f66f606d2` binds cart/order rows and writes to the parsed session user, guards both
    private queries, filters each read by that same principal, and omits private components for an
    anonymous request.
  - **Evidence:** `site/tutorial/steps/07-verification/src/app.test.ts` exercises victim/attacker and
    anonymous controls through route rendering plus real query execution (10/10 focused tests);
    `node site/tutorial/run-steps.mjs` passes the complete seven-step tutorial gate.

## Low

- [x] **L1 — The tutorial gate claimed compiler and access coverage while compiling zero route
      pages and using a hand-built graph with no producer-owned access facts.**
  - The runner compiled component files only. Route callbacks returned helper calls, so the public
    route compiler would emit no lowered route file or route-page/access facts even if invoked.
    Step 07 then asked `kovo explain --unguarded` about a hand-built graph lacking the producer-owned
    access inventory and reported zero, making the tutorial's SPEC §5.2/§10.2 verification claim a
    false green.
  - **Dedup:** `bugz-2` H3 fixed aliased/namespace route recognition in the framework scanner, and
    `bugz-21` B5 covered production evidence proved only in a test harness. Here the canonical
    compiler works; the tutorial's own gate did not invoke it at the claimed layer.
  - **Closure:** `ffa23c8e2` migrated the route modules to authored TSX, and `f66f606d2` puts direct
    TSX in every route callback, adds explicit producer-owned access decisions, requires the exact
    nine-route inventory from `kovo compile route`, and feeds real app access facts to the explain
    assertion.
  - **Evidence:** `node site/tutorial/run-steps.mjs` reports 7 steps, 9 routes, 12 components, and
    35 passing tests; the Step 07 regression separately asserts its compiler-owned page/access fact.

- [x] **L2 — A historical convergence `snapshotSha256` was accepted without any snapshot bytes to
      hash, so the digest is decorative rather than a binding.**
  - `security/security-convergence-baseline.json` stores a 64-hex `snapshotSha256`, while
    `scripts/security-convergence-baseline.mjs` checks only its spelling. Replacing it with any
    other 64-hex value leaves the convergence verdict unchanged because no canonical historical
    snapshot is retained or recomputed. The separately stored audit-round file digest and audited
    code SHA remain real bindings; this finding is limited to the misleading snapshot digest.
  - **Dedup:** no other plan records this field/check pair. It is distinct from the verified
    `auditRound.sha256` join and from current-snapshot source hashes, both of which are recomputed.
  - **Closure:** `89223e541` removes the unverified field and requires exact historical-row and
    audit-round shapes, so a decorative or otherwise surplus stamp now turns the gate red instead
    of masquerading as joined evidence.
  - **Evidence:** the focused convergence suite passed 3/3, including a regression that inserts a
    valid-looking 64-hex `snapshotSha256` and requires rejection:
    `pnpm exec vitest --run scripts/security-convergence-baseline.test.mjs -t 'rejects decorative fields|mechanically separates|binds the current convergence label'`.
    The closing diff check is clean.

## Latest verification

- `node scripts/check-analysis-time-closure.mjs`
- `pnpm exec vitest --run scripts/check-analysis-time-closure.test.mjs --reporter=dot`
- `node site/tutorial/run-steps.mjs`
- `pnpm --dir site exec vitest --run tutorial/steps/07-verification/src/app.test.ts --reporter=dot`
- `pnpm exec vitest --run scripts/security-convergence-baseline.test.mjs -t 'rejects decorative fields|mechanically separates|binds the current convergence label'`
- `pnpm run check:security-ledger-index`
- `git diff --check`
