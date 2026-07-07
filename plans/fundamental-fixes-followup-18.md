# Fundamental Fixes Followup 18 — the FIRST line: prove request-authenticity, function-level authz, and wire integrity above the DB floor

Created 2026-07-07. Self-standing. Source of truth for behavior is `SPEC.md`. Continues the C10–C16 line
(`fundamental-fixes-followup-{6..17}.md`) and advances `plans/threat-matrix-plan.md` (the OPEN **M2** cell + the
under-swept **Auth** and **Wire × Au/I** cells). This is a FRESH-SURFACE, threat-model-first plan: the round-22 dogfood
(6 approved axes A1–A6) adversarially VERIFIES it, and any confirmed hole becomes a concrete work item under the matching
DEC below.

## 1. Why this plan exists — attack the first line, not the last line

Rounds 6–21 hardened the DB FLOOR (engine RLS, secret boxing, sink inventory, the regex/egress classifiers) to
convergence — the framework's LAST line of defense. But the arc's recurring wound (the Better Auth adapter, 3×:
`bugz-24` A1 / round-15 B4 / round-16 B3) and the matrix's one named-OPEN cell (**M2, Auth × C/Au**) point at the FIRST
lines, which the arc never swept as a primary target: **is the request authentic (CSRF), is the identity sound
(session), can a principal invoke what it must not (function-level authz), and does untrusted wire input corrupt server
state BEFORE it reaches the hardened floor?** RLS scopes ROWS; it does not authenticate the request, gate which
OPERATION you may invoke, or stop prototype pollution. Those are separate controls, and they live in `app-dispatch.ts` /
`csrf.ts` / `access.ts` / `keyring.ts` / `app-mutation-request.ts` / `better-auth/internal/*` — real code, never
adversarially proven.

## 2. Meta-invariant (extends the fail-closed line)

- **C17 — Every state-changing operation requires, by DEFAULT and FAIL-CLOSED, BOTH an authenticity proof (the request
  was intentionally issued by the authenticated principal) AND an explicit access decision (this principal may invoke
  this operation). An operation with no declared authenticity posture or no declared access decision is DENIED, not
  run.** This is the DB floor's default-deny lifted to the first line: just as an unclassified table is default-deny at
  the engine, an un-annotated mutation must be default-deny at dispatch — RLS row-scoping is NOT a substitute for
  invoke-time authorization (a delete/aggregate/admin/side-effecting op may have no row to scope), and SameSite is NOT a
  substitute for an authenticity proof (it is browser-dependent and Lax-permissive for top-level navigation).

## 3. Decisions / work items (each = AUDIT the current control → ESTABLISH/PROVE it → fix any gap the round-22 dogfood confirms)

### DEC-A — Request authenticity / CSRF is default-on and not SameSite-reliant (axis A1; Wire × Au)

- [ ] **A1 — AUDIT the CSRF control (`app-dispatch.ts:105/174-199`, `csrf.ts validateCsrfToken`) and PROVE: (i) every
      unsafe/state-changing verb is CSRF-checked by DEFAULT (`endpoint()` default-CSRF is confirmed at
      `app-dispatch.ts:179`; verify `mutation` is too, and that the "no-CSRF read path" at `:59` is provably
      side-effect-free); (ii) the check is a real token bound to the session, not SameSite-reliance alone; (iii) the
      `csrf: false` / `exempt` escape (`app-guards.ts:170-202`) is audited + justified + surfaced in `kovo explain`;
      (iv) a defense-in-depth Origin/Sec-Fetch check backstops the token. A cross-origin form-POST / GET-mutation /
      method-override must be REFUSED.** See **O1**.
  - Acceptance: a cross-origin state-changing request without a valid token is refused; `csrf:false` requires
    justification and is `kovo explain`-visible; a test forges the cross-site request and asserts refusal.

### DEC-B — Session & cookie integrity (axis A2; Auth × Au)

- [ ] **B1 — AUDIT session/cookie posture (`keyring.ts`, `cookies.ts`, `auth-principal.ts`) and PROVE: token entropy is
      CSPRNG; the cookie carries `__Host-`/`HttpOnly`/`Secure`/`SameSite`; the session identifier ROTATES on login /
      privilege change (fixation) and is INVALIDATED on logout + password change; a tampered/forged/replayed cookie
      fails closed. Name which of these the framework OWNS vs delegates to Better Auth (a TCB-surface, `security/TCB.md`).**
      See **O4**.
  - Acceptance: a fixation attempt (pre-auth token still valid post-auth) fails; logout/password-change kills the
    session; a tampered signed cookie is rejected; the owned-vs-delegated split is documented.

### DEC-C — Function-level authorization is MANDATORY and fail-closed (axis A3; Auth × C/I) — likely the biggest DEC

- [ ] **C1 — AUDIT the guard/access model (`access.ts`, `guards.ts`, `app-dispatch.ts`) and PROVE invoke-time authz is
      MANDATORY: a mutation/query/endpoint with NO declared access decision (`guard`/`auth`/`verify`/`publicAccess`) is
      DENIED at dispatch, not run (C17). Confirm the access decision runs BEFORE the handler and that RLS is not treated
      as a substitute for it. Attack BFLA: a non-admin invoking an admin/system-only op; a principal invoking another
      module's op; an operation with no row to scope (bulk delete, aggregate, side-effecting action).** See **O2**.
  - Acceptance: an un-annotated mutation fails closed (build-time gate or runtime deny); an admin-only op invoked by a
    non-admin is refused independent of RLS; a `publicAccess` op names its justification and is `kovo explain`-visible.

### DEC-D — Wire input integrity: no prototype pollution, no mass-assignment above the floor (axis A4; Wire × I)

- [ ] **D1 — AUDIT the mutation/query input decode (`app-mutation-request.ts`, `core` decode + `json-clone.ts:173-184`)
      and PROVE: untrusted wire JSON cannot pollute a prototype (`__proto__`/`constructor`/`prototype` keys are dropped
      or the object is null-proto), cannot mass-assign a field the schema/form did not declare (the wire layer is a
      positive allowlist, distinct from and ABOVE the DB governed-column floor), and the render-plan/build token cannot
      be forged or replayed to smuggle a handler input. Type-confusion (array-for-object, etc.) fails closed.** See **O3**.
  - Acceptance: a payload with `__proto__`/`constructor.prototype` does not pollute; an extra undeclared field is
    rejected/ignored (not silently assigned); a forged/replayed render-plan token is refused.

### DEC-E — Auth protocol flows + the M2 auth-adapter TCB (axis A5; Auth × C/Au — the OPEN matrix cell)

- [ ] **E1 — AUDIT the Better Auth surface (`better-auth/internal/*`, `mount.ts`, `credential.ts`, `non-egress-proof.ts`)
      and PROVE: (i) the M2 non-egress proof is GREEN — no request-reachable path reads an unboxed cross-user credential
      (the 3×-recurring wound; followup-13 DEC-C mechanism); (ii) password-reset / email-verification tokens are CSPRNG,
      single-use, expiring, and DO NOT enable user-enumeration (uniform response + timing, per M4); (iii) 2FA / backup
      codes cannot be replayed; (iv) account-linking cannot bind an attacker identity. Enroll the adapter as a
      first-class TCB-manifest module and close M2.**
  - Acceptance: M2 flips to green in the threat matrix with a reachability-based non-egress proof + the flow controls
    tested; user-enumeration and replay attempts fail.

### DEC-F — Task/capability principal integrity (axis A6; Runtime × Au)

- [ ] **F1 — AUDIT the durable-task/cron principal path + the capability-URL signing (`capability-route.ts createSignUrl`
      / `deriveDownloadKey`) and PROVE: a task runs under its intended principal with no cross-tenant bleed; a task
      payload cannot be forged/injected to run as another principal; a signed capability URL cannot be forged, scope-
      confused, or replayed past expiry (the signature binds object/method/scope, `capability-route.ts:66-105`).**
  - Acceptance: a forged/scope-swapped/expired capability URL is refused; a task's principal is bound and cross-tenant
    isolation holds.

## 4. Open design decisions (flagged for review — NOT yet decided)

- [ ] **O1 — CSRF: what is the DEFAULT authenticity proof, and is `csrf: false` ever acceptable?** Forks: **(a)** a
      session-bound CSRF token required by default for every state-changing op, `csrf:false` only via an audited +
      justified + `kovo explain`-visible escape (matches the existing escape-hatch philosophy); **(b)** token PLUS a
      mandatory Origin/`Sec-Fetch-Site` check as defense-in-depth so a token leak alone isn't sufficient and SameSite
      is never load-bearing; **(c)** allow SameSite-reliance for same-site deployments. Lean: (b) — SameSite is
      browser-dependent + Lax-permissive; a token + origin check is the fail-closed default, and `csrf:false` stays an
      audited escape. **Decision:** is the default token-only, or token+origin, and is `csrf:false` retained?
- [ ] **O2 — Function-level authz: MANDATORY-deny for un-annotated ops, or opt-in guards?** Forks: **(a)** an operation
      with no access decision is a BUILD-TIME error / runtime DENY (C17, forces every op to declare access — strongest,
      but a hard break for any existing un-guarded op); **(b)** runtime deny only; **(c)** default-run and rely on RLS
      (status quo if that is what it is — fails for non-row-scoped ops). Lean: (a) build-time mandatory declaration, per
      the technical-preview stronger-default bias and the DB floor's default-deny analogy. **Decision:** mandatory
      declared access at build time, or runtime-only, or keep opt-in?
- [ ] **O3 — Wire input: reject dangerous keys, null-proto parse, or strict schema-allowlist?** Forks: **(a)** parse to
      null-prototype objects + strict schema allowlist (drop any key not in the declared input schema) — closes both
      prototype pollution AND mass-assignment in one move; **(b)** reject payloads containing `__proto__`/`constructor`/
      `prototype` (denylist — C11-fragile); **(c)** rely on the DB governed-column floor alone (insufficient for
      non-DB mutation state). Lean: (a) — a positive schema allowlist at the wire layer is the C11-safe, class-closing
      fix. **Decision:** strict-allowlist-and-null-proto, or a denylist?
- [ ] **O4 — Session lifecycle: which invalidation guarantees does KOVO own vs delegate to Better Auth?** Rotation-on-
      login, kill-on-password-change, logout-invalidation. Forks: **(a)** Kovo OWNS and tests these as framework
      guarantees (strongest, but wraps/constrains Better Auth); **(b)** delegate to Better Auth and record them as
      TCB-surface dependency assumptions (`security/TCB.md`, M6) with a review trigger. **Decision:** own-and-test, or
      delegate-and-document?

## 5. Proving

- [ ] DEC-A: cross-origin state-change refused; `csrf:false` audited + explain-visible.
- [ ] DEC-B: fixation + logout/password-change invalidation + tampered-cookie rejection tested.
- [ ] DEC-C: un-annotated op fails closed; admin-only op refused for non-admin independent of RLS.
- [ ] DEC-D: proto-pollution + mass-assignment + token-replay refused.
- [ ] DEC-E: M2 non-egress proof green; reset/verify enumeration + 2FA replay fail.
- [ ] DEC-F: forged/expired capability URL + cross-tenant task refused.
- [ ] Root gates unaffected: `check:tcb-boundary`, `check:capability-surface-census`, `check:wire-output-boundary`,
      `check:single-choke`, `check:sink-policy`, `vp check`, `git diff --check`.
- [ ] `plans/threat-matrix-plan.md`: M2 → green; the Auth and Wire×Au/I cells gain named controls + tests.

## 6. Meta

The regex/egress/data-plane surfaces are converged (round 21: zero fail-opens). Followup-18 pivots to the FIRST line —
the request→identity→authorization→mutation pipeline above the floor — because that is where the matrix is still open
(M2) and where the arc's recurring auth wound lives. The unifying invariant C17 (fail-closed authenticity + authorization
by default) is the DB floor's default-deny applied one layer up. Round-22 (approved: A1–A6) is the adversarial
verification pass; a clean round here closes the last named-open matrix cell and clears the path to the external audit
(threat-matrix A1).
