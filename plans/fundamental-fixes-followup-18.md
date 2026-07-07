# Fundamental Fixes Followup 18 — the first line is sound; make the authz AUDIT the same object as the ENFORCEMENT

Created 2026-07-07. Self-standing. Source of truth for behavior is `SPEC.md`. Continues the C10–C16 line
(`fundamental-fixes-followup-{6..17}.md`). **Findings-driven**: responds to the Round-22 fresh-surface dogfood of the
first line (`plans/claude-bugz-43.md` B1, `plans/claude-papercuts-41.md`). Advances `plans/threat-matrix-plan.md` (the
OPEN **M2** cell + the Auth / Wire × Au/I cells). Line numbers cite `main` (`58df770b1`).

## 1. What round-22 actually found

Round-22 adversarially swept the request→identity→authorization→mutation pipeline ABOVE the converged DB floor (6 axes
A1–A6). Result: **five of six axes are clean or sound** — a strong outcome for a never-swept surface — and the ONE gap
is a single, precise defect.

**Verified sound (→ record as matrix controls, §3.2):** A1 CSRF (default-CSRF, token-based, not SameSite-reliant),
A2 session (entropy/rotation/invalidation/cookie posture), A4 wire integrity (positive schema allowlist + null-proto
decode; no mass-assignment above the floor), A5 auth flows + **M2** (no request-reachable unboxed cross-user credential —
the 3×-recurring wound is clean), A6 task/capability (signature binds canonical object/method/scope + expiry).

**The one gap (B1):** invoke-time authorization's AUDIT is decoupled from its ENFORCEMENT. The `access` decision drives
`kovo explain`, the KV436 build gate, and the `guarded` posture; the SEPARATE `guard` field enforces at runtime. A
`GuardAccessStep`'s executable `guard` is accepted-but-IGNORED (`access.ts:3-7`), and runtime never reads
`definition.access` (self-verified). So an op declared `access: guardChain([{ guard: requireAdmin }])` with the top-level
`guard:` omitted builds green, reports `guarded: true` in `kovo explain`, and runs NO guard — `kovo explain`
misrepresents an unguarded side-effecting op (charge/email/provision, which RLS cannot row-scope) as guarded.

## 2. Meta-invariant (refines the C17 the finding disproved)

- **C17 — The AUDITED security decision must BE the ENFORCED one; the review artifact (`kovo explain`) must never diverge
  from what runs.** The arc's C9 ("decide on the entity, not a proxy") applied to authorization: an `access` audit field
  that is a PROXY for enforcement — decoupled from the `guard` that actually runs — lets the audit report a control the
  runtime does not apply. A security posture derived from a field the enforcement path never reads is a lie by
  construction. Corollary: invoke-time authorization is fail-closed only if the thing you declare (and that `kovo
explain` shows) is the thing that executes.

## 3. Decisions / work items

### 3.1 DEC-A — Collapse authz to ONE self-describing object: the guard that RUNS is the access decision (fixes B1)

**Decision (O1, resolved — fork (a) refined; land at once):** the fix is not to "bind two fields" — it is to make there
be only ONE. A guard becomes a NAMED, self-describing value that enforces, names itself, AND emits its audit facts, and
`access` becomes the guards themselves. This eliminates BOTH decouplings the finding exposed: the `access`-vs-`guard`
field split (B1) and the `{name}`-vs-`guard` label split (a hand-written step name can lie about what its guard does).

- [ ] **A1 — Guards are self-naming; `access` = the enforced guards.** New guard constructor
      `guard(name, fn)` attaches the audit name to the guard (guards already carry
      `GuardAuditFact`/`GuardPrincipalKeyAudit`/`GuardResourceKeyAudit` for KV414, so the name is one more fact on the
      same object). Change `AccessDecision` to `readonly Guard[] | PublicAccess | VerifiedMachineAccess` and DELETE
      `GuardAccessStep` (both its hand-written `name` and its accepted-but-ignored executable `guard?`). Runtime runs the
      `access` guards through the existing `runGuard` path; `publicAccess(reason)` / `verifiedAccess` remain as the
      explicit "nothing runs, and here is why" sentinels. `kovo explain --access` PROJECTS names/posture from the
      enforced guards, so it cannot report anything the runtime does not run. The old audit-only
      `access: guardChain([{name, guard}])` form is removed — the misconfiguration (`access` names a guard the runtime
      never runs) becomes UNREPRESENTABLE.
  - Shape:
    ```ts
    const requireAdmin = guard(
      'admin-only',
      (req) => req.principal.role === 'admin' || forbidden(),
    );
    mutation('billing.chargeCard', { input, access: [requireAdmin], handler }); // enforces AND names itself
    // or: access: publicAccess('public checkout')  |  access: verifiedAccess
    ```
  - Migration: fold the existing `guard`/`auth`/`verify` runtime fields into the guard primitives `access` composes (or
    treat them as the low-level guards a self-named guard wraps); there is no longer a separate top-level `guard:` that
    can diverge from `access`. KV436 is unchanged as the declare-or-deny gate: an op with NO `access` (no guards, not
    `publicAccess`/`verifiedAccess`) is `missing` → build fails.
  - Acceptance: (i) it is IMPOSSIBLE to declare an `access` guard that does not run (the ignored-executable trap is
    deleted from the type); (ii) `kovo explain --access` names derive from the enforced guards (a guard named
    `admin-only` cannot be labeled `owner-only`); (iii) `publicAccess`/`verifiedAccess` stay explicit + justified +
    `kovo explain`-visible, and a `publicAccess` op still surfaces its no-guard posture honestly; (iv) a regression test
    pins that the explained access names EQUAL the enforced guard names (C13 superset-corpus), so a future refactor
    cannot re-introduce a divergent label; (v) the side-effecting/no-row op (charge/email/provision) with no guard fails
    `kovo check` (KV436). SPEC §6.5/§9.1 states C17 — the audited decision IS the enforced one, a single self-describing
    object.
  - Scope note: this is a bounded, land-at-once refactor — a guard constructor + name field, an `AccessDecision` type
    change, deleting `GuardAccessStep`, folding the runtime read to iterate `access` guards, and updating the graph/
    explain projection to read guard names. No interim half-measure.

### 3.2 DEC-B — Record the verified first-line controls into the threat matrix (advance M2 + Auth/Wire cells)

- [ ] **B1 — For each round-22-sound axis, write the named control + its test into `docs/security-threat-matrix.md` and
      flip the cell green:** A1→Wire×Au (CSRF token, not SameSite-reliant), A2→Auth×Au (session lifecycle + cookie
      posture), A4→Wire×I (positive schema allowlist + null-proto decode), A6→Runtime×Au (capability signature binding),
      and **A5→Auth×C/Au (M2): CLOSE the open cell** with the reachability-based non-egress proof — pending DEC-C's flow
      checks below. This is the round's threat-matrix payoff: a clean first-line sweep turns four cells green and closes
      the last named-open cell.

### 3.3 DEC-C — Confirm the auth-FLOW controls before flipping M2 green (completeness, not a found bug)

- [ ] **C1 — M2 closes only when the non-egress proof is paired with the flow controls A5 did not disprove but did not
      exhaustively execute:** password-reset / email-verification tokens are CSPRNG + single-use + expiring and DO NOT
      enable user-enumeration (uniform response + timing, per M4); 2FA / backup codes are replay-resistant;
      account-linking cannot bind an attacker identity. Where a flow is delegated to Better Auth, record it as a
      TCB-surface dependency assumption (`security/TCB.md`, M6) with a review trigger rather than claiming a Kovo
      guarantee. (No round-22 finding here; this is the evidence M2 needs to be signed off green, not open work against a
      bug.)

## 4. Resolved design decision (decided 2026-07-07)

- **O1 (how to bind the authz audit to enforcement) → RESOLVED into DEC-A: fork (a), REFINED — one self-describing
  object, landed at once.** Not "bind two fields" but "make there be one": self-naming guards, `access` = the enforced
  guards, `GuardAccessStep` (and its ignored executable + hand-written name) deleted. This is the full C17 — the audited
  decision IS the enforced one — and it also kills the second decoupling (a step `name` that can lie about its guard).
  - Rejected **(b)** build-time-downgrade: it fixes B1's field split but KEEPS the `{name}`-vs-`guard` label decoupling
    and leaves `access` a redundant restatement of the guard — a half-measure. Rejected **(c)** posture-only: fixes the
    audit lie but leaves the op unguarded. The refactor is bounded and lands at once (per the decision), so no interim.

## 5. Proving

- [ ] DEC-A: the ignored-executable trap is unrepresentable (deleted from the type); `access` = self-naming guards;
      `kovo explain --access` names derive from the enforced guards; `publicAccess`/`verifiedAccess` stay explicit; a
      no-guard side-effecting op fails `kovo check`; `explained-names == enforced-guard-names` pinned by a regression test.
- [ ] DEC-B: `docs/security-threat-matrix.md` — A1/A2/A4/A6 cells green with named control+test; M2 flipped per DEC-C.
- [ ] DEC-C: reset/verify enumeration + single-use + expiry, 2FA replay, account-linking tested (or delegated + recorded
      as TCB dependency).
- [ ] Root gates unaffected: `check:tcb-boundary`, `check:capability-surface-census`, `check:wire-output-boundary`,
      `check:single-choke`, `check:sink-policy`, `vp check`, `git diff --check`.

## 6. Meta

Round-22 is the strongest fresh-surface result of the arc: attacking the first line (never swept) turned up no CSRF,
session, wire-integrity, auth-flow, or capability fail-open, and the recurring M2 wound is clean — the arc's data-plane
hardening did not leave the layer above it open. The single defect is not a hole in a control but a decoupling between
the audit and the enforcement of a control that mostly works — C17: audit the object you enforce. Closing DEC-A + writing
the verified controls into the matrix (DEC-B) closes the last named-open cell (M2) and clears the path to the external
audit (`plans/threat-matrix-plan.md` A1).
