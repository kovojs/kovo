# Round-15 Papercuts 34

Created 2026-07-06. Source of truth remains `SPEC.md`. Hygiene/over-privilege items from the Round-15 Postgres
security dogfood AFTER `plans/fundamental-fixes-followup-10.md` + `followup-11.md`. Security fail-opens are in
`plans/claude-bugz-36.md`. Dogfooded in an isolated `origin/main` worktree; `/Users/mini/kovo` untouched. Line
numbers cite `origin/main`.

## Issues

- [ ] **P1 — The DEC-B chokepoint lexer treats a double-quoted delimited IDENTIFIER (`"set_config"`) as a string literal and strips it, so the `set_config(` text-denylist (`managed-db.ts:1294`) never fires for `SELECT "set_config"('kovo.principal',…)` — a scanner-hygiene gap. NOT exploitable today: the engine EXECUTE-revoke on `set_config` blocks it for the app roles (defense-in-depth holds).** (LOW, framework/security-hygiene; `pg-statement-chokepoint` chokepoint-quoted-setconfig-principal-forge; refuted as a fail-open, self-verified first-hand)
  - Observed: `scanAppPostgresStatementShape` (`managed-db.ts:1189-1314`) returns `{command:'select', ok:true}` for `SELECT "set_config"('kovo.principal',$1,true)` while correctly rejecting the unquoted `SELECT set_config(...)`. The lexer's quoted-token branch (`:1240-1245`) strips a `"…"` delimited identifier to whitespace like a string literal, so the denylist regex `\b(?:pg_catalog\.)?set_config\s*\(` (`:1294`) does not match `"set_config"(`.
  - Why NOT a fail-open (self-verified `scratchpad/quoted-setconfig.mjs`): `SELECT set_config('kovo.principal','x')` as `kovo_reader` → `42501 permission denied for function set_config`. `set_config` EXECUTE is REVOKEd FROM PUBLIC (`postgres-runtime.ts:803`) and granted only to the login role (`:2566`); app SQL runs under `SET LOCAL ROLE kovo_reader/writer` which lacks EXECUTE. The quoted forge is caught by the engine before any GUC mutation. The text denylist is redundant defense-in-depth; the engine grant is the boundary.
  - Why it matters (hygiene): the denylist is dead weight that reads as a control; if the engine REVOKE were ever relaxed, or if a path ran app SQL as the login role, the lexer gap would become exploitable. A delimited-identifier lexer that treats `"x"` as a literal is also a latent hazard for any other identifier-based check.
  - Acceptance: the lexer distinguishes delimited identifiers (`"…"`) from string literals (`'…'`) and the denylist (or, better, the allowlist) reasons over the resolved identifier; OR the text denylist is removed and SPEC states the engine EXECUTE-revoke + role confinement is the sole `set_config` control. A test: `SELECT "set_config"(...)` is classified the same as `SELECT set_config(...)`.

- [ ] **P2 — `kovo_writer` is granted SELECT on the secret columns (`session.token`, `account.password`, `accessToken`, `refreshToken`) that `kovo_reader` is column-REVOKEd from, so the write role can read auth credentials the read role cannot.** (LOW, framework/security-asymmetry; `pg-auth-deep` pg-auth-deep-2; reproduced)
  - Observed: the reader-column-privilege step REVOKEs secret columns from `kovo_reader`, but the writer-privilege step grants `kovo_writer` full `SELECT` (needed for `RETURNING`/read-modify-write), so a mutation-path read as `kovo_writer` returns the secret columns unboxed at the engine level.
  - Root cause: the column-REVOKE confidentiality model (followup-6) is applied to the reader role only; the writer role has table-level `SELECT` including secret columns. The secret-boxing runtime box is the reader-path confidentiality control; the writer path relies on the mutation handler not projecting secrets, not on an engine REVOKE.
  - Why it matters: confidentiality asymmetry — a secret column is engine-unreadable by the reader but engine-readable by the writer. Not a direct leak (mutations don't project auth secrets by default), but the writer path lacks the engine-level column REVOKE the reader has, and pairs with `bugz-36` B4 (the adapter's unboxed secret read).
  - Acceptance: either the writer role is also column-REVOKEd on secret columns (with a narrow grant for the specific write it needs) or the secret-boxing box provably covers the writer read path; a test asserts a `kovo_writer` SELECT of a secret column is boxed/denied.

## Refuted / Not Carried Forward

- See `claude-bugz-36.md` "Refuted" — the DEC-B direct path, the round-14 fixes (GUC/role forge, pool bleed, table triggers), the object-reachability audits, and most of auth all held. The Round-15 findings are the driver-`Submittable` escape (B1), the view-trigger edge (B2), the adopted-`BYPASSRLS` edge (B3), and the auth-adapter unboxed read (B4).

## Latest Verification

- P1 self-verified first-hand (`scratchpad/quoted-setconfig.mjs`: quoted `set_config` as `kovo_reader` → permission denied; the lexer gap is real but the engine REVOKE catches it). P2 reproduced by the verifier. Throwaway apps under `/Users/mini/kovo-dogfood-round15/` — safe to delete. `/Users/mini/kovo` untouched; no servers left running.
