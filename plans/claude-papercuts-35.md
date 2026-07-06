# Round-16 Papercuts 35

Created 2026-07-06. Source of truth remains `SPEC.md`. Hygiene / proof-completeness items from the Round-16 Postgres
security dogfood AFTER `plans/fundamental-fixes-followup-12.md`. Security fail-opens are in `plans/claude-bugz-37.md`.
Dogfooded in an isolated `origin/main` worktree; `/Users/mini/kovo` untouched. Line numbers cite `origin/main`.

## Issues

- [ ] **P1 — The DEC-D "prove-non-egress" test statically scans only `internal/trusted-plaintext.ts` and does NOT model the request-reachable auth adapter / `systemRole` surface, so the guarantee that auth secrets never egress the trusted zone is verified against the wrong file — which is why the unboxed cross-user secret read (`bugz-37` B3) slips through green.** (LOW→root-of-a-bugz, framework/test-completeness; `pg-auth-trusted-zone` pgtz-2; reproduced)
  - Observed: the non-egress proof asserts properties of the `trusted-plaintext.ts` module, but the adapter's actual secret-reading surface (the `systemRole` handle, the request-reachable adapter hooks) is not in the scanned set, so an unboxed cross-user credential read is not caught.
  - Root cause: the DEC-D acceptance was implemented as a scan of the named trusted file rather than a proof over the ACTUAL boundary (the request-reachable adapter surface). This is the C9 proxy pattern in the PROOF itself — the test checks a model-chosen file, not the entity (the adapter surface) that actually handles the secret.
  - Why it matters: a "prove-non-egress" guarantee that checks the wrong surface is worse than none — it reads as a control while missing the leak (`bugz-37` B3). The proof must enumerate the request-reachable paths that touch a secret and assert each is confined.
  - Acceptance: the non-egress proof enumerates every request-reachable path that reads an auth secret (the `systemRole`/`systemDb` handle, adapter hooks, error/log paths) and asserts each is boxed or confined; a test that a secret reaching a new adapter path turns the proof RED. (Fixes the root of `bugz-37` B3.)

- [ ] **P2 — The plain `{ text, values }` separated carrier reaches the DB-driver sink through the reconstruct with only a bind-marker heuristic and NO justification, whereas the equivalent raw-text capability via `sql.raw(...)` requires an audited `trustedSql(..., { justification })` — an audit-asymmetry for the same capability.** (LOW, framework/API-hygiene; `pg-sink-inventory-completeness` SINK-1; refuted as a fail-open — the carrier goes through the reconstruct + KV406/KV435 + the engine RLS/role floor, and reaching injection requires the app to hand-concatenate untrusted input into `.text`, an app-author mistake)
  - Observed: `validateManagedSqlStatement` accepts an unbranded `{ text, values }` as `plain-separated-carrier` when `hasSqlBindMarker(text)` is true (`packages/core/src/internal/sql-safety.ts:339-341/481-493`); the reconstructed snapshot then reaches the driver. `sql.raw(...)` for the same raw-text capability requires a justified `trustedSql` brand.
  - Why NOT a fail-open (verifier-confirmed): the carrier is the INTENDED sole reconstruct door (KV422); the driver receives the frozen reconstructed snapshot (not the app object); KV406 table-allowlist + KV435 secret-bind run on the snapshot; text-without-values is fail-closed rejected; the engine reader/writer-role + RLS + secret-REVOKE floor bounds the blast radius. Injection requires app-author string concatenation (an app mistake), and the framework ships `sql.identifier`/`staticSql`/`sql\`\`` as the safe doors.
  - Why it matters (hygiene): the audit story "raw text requires a justification" has a gap — an app can execute equivalent raw text via the plain carrier with zero justification, so a reviewer scanning for `trustedSql` justifications misses the plain-carrier raw-text uses.
  - Acceptance: either the plain-separated carrier's `.text` provenance is tracked (a hand-concatenated `.text` without a safe-construction brand is flagged/justified like `sql.raw`), or SPEC documents that the separated carrier is a first-class safe door equivalent to parameterized builder SQL and the `trustedSql` justification applies only to unparameterized `sql.raw`. A `kovo explain` note listing plain-carrier raw-text sites would close the review gap.

## Refuted / Not Carried Forward (strong positive signal)

- See `claude-bugz-37.md` "Refuted" — this was the strongest acceptance round of the arc: the DEC-F sink inventory is complete (XSS/redirect/identifier/headers/cookies/egress all sound), the DEC-A wrapped-client reconstruct is unescapable (13 attack angles, 0 findings), and the round-15 fixes (Submittable, view triggers, adopted BYPASSRLS) all held. The residual `bugz-37` findings are entirely on the Move-2 enumeration axes (write-propagation, the REPLICATION attribute, the login identity, the adapter proof surface).

## Latest Verification

- P1 reproduced (the non-egress test scans `trusted-plaintext.ts`, not the request-reachable adapter surface — the root of `bugz-37` B3). P2 self-verified/refuted as a fail-open (`sql-safety.ts:339-341/481-493`; the carrier goes through the reconstruct + engine floor). Throwaway apps under `/Users/mini/kovo-dogfood-round16/` — safe to delete. `/Users/mini/kovo` untouched; no servers left running.
