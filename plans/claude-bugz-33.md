# Round-12 Soundness Bugz 33

Created 2026-07-03. Source of truth remains `SPEC.md`. Security fail-opens found dogfooding AFTER
`plans/fundamental-fixes-followup-7.md` (closure audit + capability token + grant/policy atomicity) landed on
`origin/main` (`318810411`). Focus: Postgres. Over-blocks/DevEx/API-coherency in `plans/claude-papercuts-31.md`.
Dogfooded in an isolated worktree at `origin/main`; `/Users/mini/kovo` untouched. Line numbers cite `origin/main`.

**Meta-theme — the arc's recurring bug reproduced ON THE MECHANISM DESIGNED TO END IT. followup-7's closure audit
(DEC-C) was supposed to be "complete by construction" because it "enumerates EVERY object the app roles can actually
access FROM THE ENGINE CATALOG (`pg_class`, `pg_proc`, `aclexplode`…)". The implementation instead queries
`information_schema.role_table_grants` — the SQL-standard view, which is NEITHER complete over object types NOR over
effective privilege.** It has two blind spots that are each a cross-owner + secret fail-open on a GREEN
`kovo db check` / boot gate:

1. **Object types `information_schema` doesn't model** — a MATERIALIZED VIEW (relkind `m`) over an owner table,
   granted to `kovo_reader`, never enters the reachable set (B1). Matviews cannot carry RLS, so it leaks every owner's
   rows + secret columns. Foreign tables have the same shape.
2. **`PUBLIC` grants** — `WHERE grantee IN (readerRole, writerRole, adminRole)` never sees a `GRANT … TO PUBLIC`, which
   every app role inherits. A table/view/matview granted to `PUBLIC` over owner data leaks (B2).

The intended fail-closed backstop — the `KV433_REACHABLE_OBJECT` "unsupported relkind" catch-all
(`postgres-runtime.ts:818`) — is DEAD CODE, because objects the enumeration never lists can never reach it. The audit
that reads `information_schema` instead of `pg_class`/`aclexplode` is the enumerate-and-allow pattern one level up: it
enumerates a proper subset of the actual reachable closure and passes everything outside it. Both are the SOLE backstop
for out-of-band grants (`kovo db migrate` is a first-class hand-written-SQL path), so both are true fail-opens.

Baseline: default Postgres/PGlite starters at `origin/main`, exercised against the REAL framework boot/`kovo db check`
gate (`checkPostgresAppDbPosture`). Each finding independently reproduced by a skeptical verifier; B1/B2's root
verified first-hand in source and the engine mechanism reproduced first-hand on raw PGlite.

## Issues

- [ ] **B1 — The closure audit is blind to MATERIALIZED VIEWS: a matview over an owner table granted to `kovo_reader` leaks every owner's rows + secret columns while `kovo db check`/boot report OK (ok=true, issues=[]).** (HIGH, framework/security, architectural; converged from `pg-closure-audit-completeness` CA-1 + `pg-realistic-multiowner-e2e` F1; reproduced + engine-mechanism self-verified)
  - Observed: provision PGlite, then apply a hand-migration `CREATE MATERIALIZED VIEW user_report AS SELECT id,"ownerId",secret FROM "user"; GRANT SELECT ON user_report TO kovo_reader`. `checkPostgresAppDbPosture(...)` → `ok=true, issues=[]`. But `pg_class.relkind='m'` for `user_report`, `information_schema.role_table_grants` for `kovo_reader` returns `[]` (matview absent), and `SET ROLE kovo_reader; SELECT * FROM user_report` returns BOTH owners' rows (Alice + Bob) including the secret column. Matviews cannot carry RLS, so this is an unconditional cross-owner read on a green audit.
  - Root cause (self-verified in source + raw PGlite): `packages/server/src/postgres-runtime.ts:729-737` enumerates the app-role reachable set from `information_schema.role_table_grants`, which per SQL standard does not model PostgreSQL materialized views (relkind `m`) or foreign tables — so such objects never enter the `reachable` map. The relkind catch-all `KV433_REACHABLE_OBJECT` (`:818`), the intended fail-closed backstop for unknown object types, is dead code because such objects are never enumerated. First-hand raw-PGlite probe (`scratchpad/closure-audit-probe.mjs`): the audit's `role_table_grants` query returns `[]`; `SET ROLE kovo_reader; SELECT … FROM user_mv` returns `[{alice,ALICE-SECRET},{bob,BOB-SECRET}]`.
  - Why it matters: **the entire followup-7 thesis (SPEC §10.3 C4/C5) is that the engine is the sole door BECAUSE the closure audit is complete-by-construction and fails closed on the unproven.** A reporting matview granted to the app's own reader role is the single most natural thing an author does, needs no `PUBLIC` grant, and leaks on a green gate — falsifying completeness and re-instantiating the arc's meta-bug on the mechanism built to end it. The audit is always-on (independent of `KOVO_PARANOID`), so the leak has no static-gate dependency; it is proven at the engine + real-runtime-gate layer.
  - Repro evidence: `/Users/mini/kovo-dogfood-round12/pg-closure` (`src/closure-audit-matview.test.ts`): `MV-READER ok=true issues=[]`; `user_report in role_table_grants = []`; `relkind = [{"m"}]`; reader reads both owners. A plain definer VIEW granted to reader IS caught (`KV433_REACHABLE_VIEW`), isolating relkind `m` as the specific hole. Root: `postgres-runtime.ts:729-737`, dead catch-all `:818`.
  - Acceptance: the audit enumerates the reachable closure from the ENGINE catalog — `pg_class` over ALL relkinds (`r`,`v`,`m`,`f`,`p`,…) joined to effective privilege via `aclexplode`/`has_table_privilege(role, oid, 'SELECT'|'INSERT'…)` — and FAILS CLOSED on any reachable relkind that cannot carry RLS (matview, foreign table) unless it is on the explicit public/vetted allowlist. A test: a reader-granted matview over an owner table makes `kovo db check`/boot REFUSE.

- [ ] **B2 — The closure audit is blind to `PUBLIC` grants: any table/view/matview granted `TO PUBLIC` over owner/secret data is reachable by every app role yet never audited — cross-owner/secret leak on a GREEN audit.** (HIGH, framework/security, architectural; `pg-closure-audit-completeness` CA-2; reproduced + engine-mechanism self-verified)
  - Observed: seed a definer view, a matview, and an unprotected secret-bearing table over owner data, each `GRANT SELECT … TO PUBLIC`. `checkPostgresAppDbPosture` → `ok=true, issues=[]`; `SET ROLE kovo_reader; SELECT …` reads them all (the reader inherits `PUBLIC`). First-hand: `SELECT * FROM leak_tbl` as `kovo_reader` returned `PUBLIC-SECRET` while the audit's grant query returned `[]`.
  - Root cause (self-verified): same enumeration, `postgres-runtime.ts:729-737` — `WHERE grantee IN ($readerRole,$writerRole,$adminRole)`. A `GRANT … TO PUBLIC` produces a `role_table_grants` row with `grantee='PUBLIC'`, not the named roles, so it is filtered out; yet every role inherits `PUBLIC`, so the object IS reachable. `information_schema.role_table_grants` also does not expand `PUBLIC`/role-membership into effective privilege. The audit checks _named-role direct grants_, not _effective reachability_.
  - Why it matters: `GRANT … TO PUBLIC` is a common (if blunt) migration action and the default grantee for some tooling; it makes an object readable by the app roles without naming them, so it slips the audit entirely. Same fail-open class as B1 through a different catalog gap; both stem from querying `information_schema` filtered to named roles instead of computing effective privilege.
  - Repro evidence: `scratchpad/closure-audit-probe.mjs` — audit's `role_table_grants` query = `[]`; `SET ROLE kovo_reader; SELECT * FROM leak_tbl` = `[{secret:'PUBLIC-SECRET'}]`. Track app `/Users/mini/kovo-dogfood-round12/pg-closure`.
  - Acceptance: enumerate effective privilege with `has_table_privilege`/`aclexplode` (which resolves `PUBLIC` + role membership), not `information_schema` filtered to named roles; any object effectively reachable by an app role that is not a proven-safe base table/`security_invoker` view fails the audit. Shares B1's fix (audit from the engine catalog + effective privilege).

- [ ] **B3 — Reference join tables receive an UNCONDITIONAL global `SELECT` grant, so any authenticated principal can read the entire cross-tenant reference/membership graph (e.g. team-membership rows for every tenant).** (MED, framework/security; `pg-realistic-multiowner-e2e` F5; reproduced, paranoid-confirmed)
  - Observed: in a realistic team-workspace app, the documented reference-table pattern (a `team_members` join classified as reference/shared) is granted global `SELECT` to the reader role with no owner/tenant predicate, so an authenticated user of team A can enumerate team B's membership rows (who belongs to which team across all tenants).
  - Root cause: reference tables are provisioned as globally-readable (grant without an RLS scoping policy) on the assumption that reference data is non-sensitive — but the documented multi-tenant "membership" pattern (postgres-v1-devex DEC-I) is expressed as a reference/join table, making the tenancy graph itself global-readable. Root in the reference-table classification/grant path in `postgres-runtime.ts` provisioning.
  - Why it matters: cross-tenant metadata leak — the membership/relationship graph is often as sensitive as row data (it reveals org structure, who-works-with-whom). It is a smaller blast radius than B1/B2 (metadata, not arbitrary secret columns) but it is a real cross-tenant read on the framework's own documented team pattern.
  - Repro evidence: `/Users/mini/kovo-dogfood-round12/pg-realistic-*`; an authenticated non-member read of the reference membership table returned other tenants' rows. (Pairs with `papercuts-31` P6 — the same reference tables also have NO writer grant, so memberships are unwritable: the reference-table model is both too open on read and too closed on write.)
  - Acceptance: reference tables that encode tenancy/membership must be owner/tenant-scoped (RLS policy) OR the framework must distinguish "global reference data" (truly public within the app) from "tenant membership" (scoped) and refuse to globally-grant the latter. A test: a team-member read of the membership table returns only the caller's teams.

## Refuted / Not Carried Forward (encouraging — these held)

- **act-as posture forgery (F2)** — refuted: the act-as principal posture IS brand-checked (the capability/WeakSet brand holds); a forged posture is rejected. The DEC-A2 capability token is not app-forgeable.
- **`authzPolicy` typed `unknown` → public grant (PGAC-1)** — refuted as a NEW finding: it is a duplicate of the already-recorded `bugz-32` OV-2 / `papercuts-30` honesty-boundary item (custom-predicate correctness is app responsibility), not a regression.
- **Definer views, ownerVia-of-non-owner-parent, superuser-door re-export/dynamic-import (bugz-32 B1–B4)** — held: the closure audit catches the definer VIEW (`KV433_REACHABLE_VIEW`), ownerVia-of-non-owner-parent is a KV414 build error, and the runtime is least-priv on managed PG. followup-7 fixed what it targeted; B1/B2 here are the object-types/PUBLIC the enumeration still misses.
- **13-of-14 base-table query shapes + all cross-owner writes** — remain sound (carried from round 11): builder, `db.query.*`, raw sql, subquery, UNION, CTE, JOIN, `readonlyAppDb`, endpoint, task, webhook.

## Latest Verification

- B1/B2 root self-verified: `postgres-runtime.ts:729-737` enumerates from `information_schema.role_table_grants` filtered to named roles (misses matviews/foreign tables + `PUBLIC`); catch-all `:818` is dead code. Engine mechanism reproduced first-hand (`scratchpad/closure-audit-probe.mjs`): audit query returns `[]` while `kovo_reader` reads both owners via a matview and `PUBLIC-SECRET` via a PUBLIC grant.
- B3 reproduced in the realistic team app (cross-tenant membership read).
- Throwaway apps under `/Users/mini/kovo-dogfood-round12/` — safe to delete. No framework source or `SPEC.md` changed; `/Users/mini/kovo` untouched; no servers left running.
