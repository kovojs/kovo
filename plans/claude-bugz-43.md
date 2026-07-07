# Round-22 Bugz 43

Created 2026-07-07. Source of truth remains `SPEC.md`. Round-22 FRESH-SURFACE dogfood of the FIRST line — the
request→identity→authorization→mutation pipeline ABOVE the converged DB floor (the 6 approved axes A1–A6 from
`plans/fundamental-fixes-followup-18.md`). Hygiene / refuted items are in `plans/claude-papercuts-41.md`. Dogfooded in an
isolated worktree at main HEAD `58df770b1`; `/Users/mini/kovo` untouched. Line numbers cite that HEAD.

## The round-22 headline: the first line is mostly SOUND; one real gap — the authz AUDIT is decoupled from ENFORCEMENT

Five of the six first-line axes came back clean or sound — a strong result for a never-swept surface, and notably the
3×-recurring auth-adapter wound (M2) is clean this round:

- **A1 CSRF — clean.** State-changing verbs are default-CSRF, token-based, not SameSite-reliant. (matrix: Wire × Au)
- **A2 session — clean.** Entropy/rotation/invalidation/cookie posture sound. (matrix: Auth × Au)
- **A4 wire integrity — sound.** Positive schema allowlist + null-proto decode + reserved prototype-pollution keys; no
  mass-assignment above the floor. Only a LOW display-echo hygiene note (`papercuts-41`). (matrix: Wire × I)
- **A5 auth flows + M2 — clean.** No request-reachable unboxed cross-user credential path found; the M2 non-egress proof
  holds. (matrix: **Auth × C/Au — the OPEN cell can close**)
- **A6 task/capability — clean.** Capability-URL signing binds the canonical object/method/scope + expiry; no
  forge/scope-confusion/replay. (matrix: Runtime × Au)

The ONE substantive finding is on **A3 (function-level authz)** — and it is exactly the C17/DEC-C gap
followup-18 was written around.

## Issue

- [ ] **B1 — Invoke-time authorization is not runtime-enforced through the AUDITED decision: the `access` decision (which
      drives `kovo explain`, the KV436 build gate, and the derived `guarded` posture) and the runtime `guard` field are
      DECOUPLED. A `GuardAccessStep`'s executable `guard` is accepted-but-IGNORED at runtime, so an operation declared
      `access: guardChain([{ name: 'admin', guard: requireAdmin }])` with the top-level `guard:` field omitted:
      builds GREEN (KV436), reports `guarded: true` in `kovo explain`, yet runs NO runtime guard — its handler executes
      for any principal (including anonymous, who can mint a CSRF token). For a side-effecting / no-row mutation
      (charge, send-email, provision, task-enqueue) RLS is no backstop, so `kovo explain` MISREPRESENTS an unguarded
      side-effecting op as guarded.** (MEDIUM, framework/authz-footgun+audit-honesty; `authz-access-guard-decoupling`
      A3-01; core mechanic self-verified first-hand; workflow votes UNCERTAIN/REFUTED on the clean-remote-bypass framing,
      carried per the reproduction bar)
  - Observed (self-verified first-hand): runtime NEVER consults `definition.access` (grep for `.access` in
    `mutation.ts`/`guards.ts`/`app-dispatch.ts` is empty); enforcement is `runGuard(definition.guard, …)`
    (`mutation.ts:220/410`) and `runGuard(undefined)` returns `null` → handler runs (`guards.ts:719-724`);
    `GuardAccessStep.guard` is documented "metadata only here; runtime enforcement still uses each definition's existing
    `guard`/`auth`/`verify` fields" (`access.ts:3-7`). So the executable guard placed inside an `access` chain step
    silently does nothing.
  - The audit/posture side (from the finding, code-path-confirmed by both verifiers): KV436 fires only on a `missing`
    decision (`graph-output.ts:744`), and `mutationAuthPostureFact.guarded` is true for ANY non-missing decision
    including `publicAccess` (`graph.ts:973-978,1023-1026`); a `guarded:true` posture suppresses the UNGUARDED warn
    (`graph-explain-format.ts:582`) and `publicAccess` additionally suppresses KV414 (`graph-output.ts:749-752`). So the
    only authz-CORRECTNESS gate (KV414) covers row-scoped IDOR only — the non-row side-effecting class has no correctness
    gate.
  - Why it is framework-owned (not merely an app mistake): the TYPE SYSTEM sets the trap — `GuardAccessStep.guard`
    accepts a real `Guard`, so a developer naturally puts the guard in the chain step where it is silently ignored, and
    `kovo explain` then affirmatively reports the op as guarded. The framework already does the RIGHT thing on the
    sibling endpoint axis — `access: verified-machine-auth` is DOWNGRADED to `missing`/KV436 when no executable verifier
    exists (`access-graph.ts:60-67`) — so the machinery to bind audit-to-enforcement exists; it is simply not applied to
    the mutation guard-chain axis. That inconsistency is the defect.
  - Honesty on severity: this is NOT a clean out-of-the-box remote bypass — it requires the developer to declare an
    `access` chain (with executable guards) while omitting the top-level `guard:`. So MEDIUM, framed as a framework
    footgun + audit-honesty gap, not HIGH. But it is exactly the C17 concern (invoke-time authz not mandatory-enforced)
    and it makes `plans/fundamental-fixes-followup-18.md` DEC-C / O2 a confirmed work item, not a hypothetical one.
  - Acceptance (C15/C17 — audit the entity you enforce): unify the audited `access` decision with runtime enforcement so
    the thing `kovo explain` shows is the thing that runs. Options (→ followup-18 O2): (a) an `access` `guardChain` whose
    steps carry executable guards ENFORCES them at runtime (the audit decision IS the enforcement); (b) build-time
    downgrade to `missing`/KV436 when an `access` decision declares an executable guard that is not wired to a runtime
    guard (mirror the `verified-machine-auth` downgrade at `access-graph.ts:60-67`); (c) `guarded` posture derives only
    from an ENFORCING field, so `kovo explain` never reports an op guarded unless a runtime guard runs. A test: an op
    with an `access` guard-chain but no runtime guard must FAIL `kovo check` (or enforce), and `kovo explain` must not
    show it guarded.

## Strong positives (record as matrix controls — this ROUND advances the threat matrix)

- **M2 (Auth × C/Au) can close:** A5 found no request-reachable unboxed cross-user credential; the followup-13 DEC-C
  non-egress proof holds. Enroll + record the control and flip M2 green (pending followup-18 DEC-E confirming the flow
  controls: reset/verify single-use+enumeration, 2FA replay).
- **CSRF (A1), session (A2), wire integrity (A4), capability signing (A6)** each have a named, verified control → the
  matrix's Auth/Wire × Au/I cells gain a control+note. Record in `docs/security-threat-matrix.md`.

## Latest Verification

- B1 core mechanic self-verified first-hand: runtime reads only `definition.guard`; `runGuard(undefined)`→handler runs;
  `GuardAccessStep.guard` is metadata-only (`access.ts:3-7`); the sibling `verified-machine-auth` downgrade
  (`access-graph.ts:60-67`) proves the fix pattern exists. Audit/posture claims code-path-confirmed by both workflow
  verifiers (which reproduced the graph.ts/graph-output.ts mechanics exactly; they split only on the remote-bypass
  framing).
- A1/A2/A5/A6 clean and A4 sound are the workflow attackers' negative results (cached in the run journal).
- Throwaway probes under `/Users/mini/kovo-dogfood-round22-apps/` — safe to delete. Isolated worktree
  `/Users/mini/kovo-dogfood-round22` (branch `agent/dogfood-round22`). `/Users/mini/kovo` untouched.
