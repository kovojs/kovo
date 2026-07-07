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

### 3.1 DEC-A — Unify the authz audit with runtime enforcement (fixes B1; the ONE real work item)

- [ ] **A1 — Bind the audited `access` decision to runtime enforcement so `kovo explain` cannot report an op guarded
      while it runs no guard.** The framework ALREADY does this on the sibling endpoint axis — `access:
  verified-machine-auth` is downgraded to `missing`/KV436 when no executable verifier exists
      (`access-graph.ts:60-67`); apply the same binding to the mutation/query guard-chain axis. Resolve via **O1**
      (which of three bindings). Confirm the fix on a scaffolded op: an `access` guard-chain with no runtime guard must
      either ENFORCE its steps or FAIL `kovo check`, and `kovo explain` must not show it guarded.
  - Acceptance: (i) a mutation with `access: guardChain([{guard: requireAdmin}])` and no top-level `guard:` is caught —
    it enforces `requireAdmin` at runtime, OR `kovo check` fails (KV436-style), OR `kovo explain` reports it UNGUARDED;
    (ii) `publicAccess` still explicitly names its justification and is `kovo explain`-visible; (iii) a genuinely-guarded
    op (runtime `guard` present) is unaffected; (iv) a test pins the `access`↔`guard` binding so a future refactor can't
    re-decouple them (C13 superset-corpus style). SPEC §6.5/§9.1 states C17 (audit == enforce).

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

## 4. Open design decision (flagged for review — sharpened by the finding)

- [ ] **O1 — How to bind the authz audit to enforcement (the DEC-A fix)?** Forks: **(a)** ENFORCE the audited decision —
      an `access` `guardChain` whose steps carry executable guards runs them at runtime (the declared decision IS the
      enforcement; strongest, single source of truth, but changes `access` from audit-only to executable and must
      compose with the existing `guard`/`auth`/`verify` fields without double-running); **(b)** BUILD-TIME DOWNGRADE —
      an `access` decision that declares an executable guard not wired to a runtime `guard` is downgraded to
      `missing`→KV436 fails (mirror `access-graph.ts:60-67` exactly; smallest change, keeps `access` audit-only, forces
      the developer to also set `guard:`); **(c)** POSTURE-ONLY — `guarded` derives only from an enforcing field so
      `kovo explain` never over-reports, but an un-enforced op still SHIPS (fixes the audit lie, NOT the enforcement
      gap). Lean: **(b)** as the minimum (it reuses the proven downgrade machinery and fails closed at build), with
      **(a)** as the better end-state if `access` becomes the one declared+enforced authz object (C17 in full). Reject
      (c) alone — it fixes the honesty but leaves the op unguarded. **Decision:** ship (b) now, or commit to (a) as the
      unified model?

## 5. Proving

- [ ] DEC-A: the `access`-guard-chain-without-runtime-guard op is enforced-or-rejected; `kovo explain` never shows an
      unenforced op guarded; genuinely-guarded ops unaffected; binding pinned by a regression test.
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
