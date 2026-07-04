# Round-13 Papercuts 32

Created 2026-07-03. Source of truth remains `SPEC.md`. DevEx + over-block + robustness items from the Round-13
Postgres security dogfood AFTER `plans/fundamental-fixes-followup-8.md` landed on `origin/main` (`5b8d3c1b1`).
Security fail-opens are in `plans/claude-bugz-34.md`. Dogfooded in an isolated `origin/main` worktree;
`/Users/mini/kovo` untouched. Line numbers cite `origin/main`.

**Meta-theme — the least-privilege runtime is not yet turn-key: the two highest-impact papercuts both BLOCK a normal
Postgres deploy (the runtime can't set its own principal; a serial-PK table fails `kovo db check`), and both are the
fail-closed shadow of the followup-6/8 hardening.** The security direction is right; the operational edges around
least-priv roles + the new closure audit still reject legitimate, ordinary setups.

## Issues

- [ ] **P1 — The least-privilege runtime login role is never granted `EXECUTE` on `set_config` after followup-6 REVOKEd it FROM PUBLIC, so on a real (non-superuser) managed Postgres the runtime cannot set `kovo.principal` and every owner-scoped request fails.** (HIGH severity, over-block, framework; `pg-auth-session-security` PGAUTH-2; reproduced, paranoid-confirmed)
  - Observed: `REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text,text,boolean) FROM PUBLIC` (`postgres-runtime.ts:582`) removes `set_config` from every role, and provision never `GRANT EXECUTE … TO <runtimeLoginRole>`. On PGlite (superuser) it still works; on a least-priv managed Postgres the runtime's `SELECT set_config('kovo.principal', …)` raises `permission denied for function set_config`, so no principal is set and owner reads return 0 / owner writes fail.
  - Root cause: the REVOKE (a followup-6 hardening so app SQL can't forge the principal) has no compensating `GRANT EXECUTE ON FUNCTION set_config … TO <runtimeLoginRole>` in the provisioning path. It fails CLOSED (no leak — the principal is simply unset), but the app cannot function on the exact deploy target (least-priv managed PG) the whole architecture targets.
  - Why it matters: the least-priv runtime is the security boundary (followup-6/7/8); if it cannot call the one function it needs to set the principal, the supported production configuration does not run. PGlite dev hides it (superuser).
  - Repro evidence: `postgres-runtime.ts:582` REVOKE with no matching runtime GRANT; a least-priv role `SELECT set_config('kovo.principal','x',true)` → permission denied.
  - Acceptance: provision grants `EXECUTE ON FUNCTION pg_catalog.set_config(text,text,boolean)` to the runtime login role (only) after the PUBLIC revoke; a least-priv runtime sets `kovo.principal` and serves owner data; app SQL (a different path) still cannot call it. A test on a least-priv external role.

- [ ] **P2 — A normal table with a serial/identity primary key fails `kovo db check`: its backing sequence (relkind `S`) is flagged `KV433_REACHABLE_OBJECT 'unsupported relkind S'` because the writer legitimately needs `USAGE` on it for INSERTs.** (MED, over-block, framework; `pg-realistic-multitenant-round2` SERIAL-SEQ-OVERBLOCK; reproduced, paranoid-confirmed)
  - Observed: an owner table with `id serial PRIMARY KEY` (or GENERATED … AS IDENTITY) provisions a sequence the `kovo_writer` role must have `USAGE` on to INSERT; the followup-8 relkind catch-all treats the reachable sequence as an "unsupported relkind" and refuses, so `kovo db check` FAILS for an ordinary schema.
  - Root cause: the closure audit's fail-closed-by-category catch-all (`postgres-runtime.ts` relkind handling) does not special-case sequences that back serial/identity columns of protected tables — it refuses any reachable non-r/v relkind. (Dual of `bugz-34` B4, where a USAGE-only sequence ESCAPES read-audit — sequences need coherent handling for both.)
  - Why it matters: serial/identity PKs are the most common Postgres primary-key pattern; a green build then a failing `kovo db check` on a normal table is a hard adoption wall.
  - Acceptance: framework-owned sequences backing serial/identity columns of protected tables are allowlisted (the writer's `USAGE` is expected); a non-framework sequence reachable by an app role is still audited (`has_sequence_privilege`) per B4; a serial-PK owner table passes `kovo db check` and INSERTs.

- [ ] **P3 — Reviewed migrations run BEFORE the framework roles are created and OUTSIDE the role/policy transaction, so a migration that `GRANT`s to `kovo_reader`/`kovo_writer` fails (roles don't exist yet) or is not atomic with provisioning.** (MED, dev-tooling/framework; `pg-provision-migrate-security` PMS-4; reproduced)
  - Observed: `kovo db provision`/`migrate` applies user migrations before ensuring roles, and outside the transaction that creates roles/policies/grants; a migration referencing `kovo_reader` errors, and a mid-provision failure can leave a partially-provisioned DB.
  - Root cause: ordering — role creation and the policy/grant transaction do not wrap migration application; the "make the DB usable + protected" step is not one atomic unit.
  - Acceptance: roles are ensured before migrations that may reference them (or a clear error tells the author to use framework classification, not a raw role GRANT), and provisioning is transactional so a failure rolls back cleanly.

- [ ] **P4 — `postureCheckOnBoot: false` is a bare public boolean that disables the ENTIRE boot-time closure audit wholesale, with no justification field or type-guard.** (LOW→MED, api-coherency/security-adjacent; `pg-provision-migrate-security` PMS-3; refuted as a bugz but a real footgun)
  - Observed: a single `postureCheckOnBoot: false` in the app runtime config turns off the boot audit entirely, so a drifted/leaky DB serves with no gate. (Refuted as a fail-open finding because it is a documented, author-chosen config, not a silent bypass — but it is a dangerous shape.)
  - Root cause: the option is a plain boolean, contrary to the CLAUDE.md type-security guidance that a security-posture opt-out should be a discriminated union carrying its justification (e.g. `csrf: false` + reason). A reviewer scanning for the flag sees no rationale.
  - Why it matters: the one switch that disables the sole runtime authorization backstop should be hard to flip casually and self-documenting; a bare boolean invites a careless disable.
  - Acceptance: replace the boolean with a justification-carrying shape (`postureCheck: { onBoot: false, justification: '…' }` or similar) surfaced in `kovo explain`; disabling it in production is loud.

- [ ] **P5 — Under `KOVO_PARANOID=1`, the production egress floor blocks the app's OWN loopback Postgres connection, and does so non-uniformly (the boot-time pool connection escapes the floor while per-request connections are blocked).** (LOW, over-block/dev-tooling; `pg-auth-session-security` PGAUTH-3; reproduced, paranoid-confirmed)
  - Observed: with the strict egress floor, an app configured against `postgres://…@127.0.0.1` has its per-request DB connections blocked as outbound egress, while the boot pool connection is already established and escapes — inconsistent, and it breaks a loopback-Postgres dev/test setup under paranoid.
  - Root cause: the egress floor does not exempt the app's own configured database host, and applies at a different layer for boot vs per-request connections.
  - Acceptance: the app's configured DB host is exempt from the egress floor uniformly (boot and per-request); a loopback/managed Postgres works under `KOVO_PARANOID=1`.

- [ ] **P6 — `structuredClone` of a value containing a `Secret` box silently strips the box to `{}` instead of throwing `KV435` like every other coercion channel.** (LOW, robustness/consistency; `pg-egress-wire-secret-channels` EGRESS-1; reproduced)
  - Observed: passing a boxed secret through `structuredClone` yields `{}` (the box's internals are dropped) rather than the `KV435` throw that `JSON.stringify`/template-literal/`Response`/header coercion produce. Not a leak (the secret is stripped, not exposed), but an inconsistent channel.
  - Root cause: the `Secret` box relies on coercion traps (toString/toJSON) that `structuredClone`'s structured-clone algorithm bypasses (it walks own enumerable properties), so it neither throws nor carries the value.
  - Acceptance: `structuredClone` of a boxed secret throws `KV435` (make the box non-structured-cloneable, or add a clone trap) for channel consistency; a test covers it alongside the other coercion channels.

## Refuted / Not Carried Forward

- See `claude-bugz-34.md` "Refuted" — the strong positive signal: followup-8's round-12 fixes held (matview/PUBLIC/definer-view/reference-membership refuse), auth is largely sound (CSRF/cookies/session-lifecycle/verification-default-deny), and secret egress is largely sound across non-DB channels (only `structuredClone`, P6, slipped).

## Latest Verification

- P1 self-verified in source (`postgres-runtime.ts:582` REVOKE, no matching runtime GRANT of `set_config EXECUTE`). P2 reproduced (serial-PK sequence flagged `KV433_REACHABLE_OBJECT`). P3/P4/P5/P6 reproduced by verifiers. P4 refuted as a bugz (documented config) but recorded as a footgun papercut.
- Throwaway apps under `/Users/mini/kovo-dogfood-round13/` — safe to delete. No framework source or `SPEC.md` changed; `/Users/mini/kovo` untouched; no servers left running.
