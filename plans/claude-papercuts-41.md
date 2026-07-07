# Round-22 Papercuts 41

Created 2026-07-07. Source of truth remains `SPEC.md`. LOW hygiene / refuted items from the Round-22 first-line dogfood.
The one substantive finding (function-level authz audit/enforcement decoupling) is in `plans/claude-bugz-43.md`.
Isolated worktree at `58df770b1`; `/Users/mini/kovo` untouched. Line numbers cite that HEAD.

## Issues

- [ ] **P1 — Wire input integrity above the DB floor is SOUND (positive schema allowlist + null-prototype decode +
      reserved `__proto__`/`constructor`/`prototype` handling), with only a display-only echo hygiene note.** (LOW,
      framework/hygiene; `wire-display-echo` A4-wire-01; REFUTED — negative security result + a cosmetic note)
  - Recorded as a POSITIVE: the A4 attacker confirmed no prototype pollution, no mass-assignment above the governed-
    column floor (the wire decode is a positive schema allowlist, not a permissive merge), and no forgeable/omittable
    render-plan token path. The residual is a display-only quirk (a value echoed back in a diagnostic/response surface),
    not a validation or integrity bypass — both verifiers REFUTED it as a security issue.
  - Acceptance (optional): if the echoed value reaches a human-facing diagnostic, ensure it is escaped/bounded at that
    surface; otherwise no action. This is the Wire × I matrix control's evidence, not an open gap.

## Refuted / Not Carried Forward (strong positive signal — the first line held)

- **A1 CSRF — 0 findings.** State-changing verbs default-CSRF, token-based, not SameSite-reliant. Named control for
  Wire × Au.
- **A2 session — 0 findings.** Token entropy / rotation / invalidation / cookie posture sound. Named control for
  Auth × Au.
- **A5 auth flows + M2 — 0 findings.** No request-reachable unboxed cross-user credential; the M2 non-egress proof
  holds — the 3×-recurring wound is clean this round. Advances the OPEN matrix cell M2.
- **A6 task / capability — 0 findings.** Capability-URL signature binds the canonical object/method/scope + expiry; no
  forge / scope-confusion / replay. Named control for Runtime × Au.

## Note

Round 22 is a strong-positive fresh-surface round: 5 of 6 first-line axes clean/sound, and the one gap
(`bugz-43` B1 — the `access`-audit vs `guard`-enforcement decoupling) is squarely the C17/DEC-C item followup-18
targets. The negatives above are matrix-control evidence, not open work. Throwaway probes under
`/Users/mini/kovo-dogfood-round22-apps/`; `/Users/mini/kovo` untouched.
