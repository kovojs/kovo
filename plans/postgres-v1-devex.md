# Postgres v1 DevEx — connect to, provision, and evolve a real Postgres

Created 2026-07-03. Self-standing. Source of truth for behavior is `SPEC.md`. Depends on
`plans/fundamental-fixes-followup-6.md` (SQLite quarantined to experimental single-principal; Postgres is the sound,
supported default; DEC-C a′ narrows the writer grant). This plan is **Postgres-only** and additive — it does not change
how enforcement works, only how the database is connected, provisioned, and evolved.

## 1. Why this plan exists (the Tier-1 gap)

"Kovo on Postgres" today means "Kovo on an in-process embedded PGlite file." The generated runtime hardcodes
`new PGlite(process.env.KOVO_DATA_DIR ?? '.kovo/pglite')` (`packages/create-kovo/templates/src/_kovo/app-runtime-db.ts:62`),
runs **all** schema + role + policy DDL at module load on that one superuser connection (`initializeAppDb`, `:74-85`),
and has no migration story (`CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS` only, `:158/:162`). None of SPEC,
the template, or the docs describe connecting to Supabase/Neon/RDS. A managed Postgres forbids exactly what boot does:
the app's runtime role cannot `CREATE ROLE` (`:282`) or `FORCE ROW LEVEL SECURITY`.

**Root cause — one connection does three jobs that real Postgres separates by privilege:**

| Job               | Current (all at boot, one superuser conn)                                                                                | Privilege it actually needs                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| **Provision**     | `CREATE ROLE` (`:282`), `CREATE TABLE` (`:158`), `FORCE RLS` + `CREATE POLICY` (`:332-339`), `REVOKE/GRANT` (`:296-317`) | DDL owner + `CREATEROLE` (an admin)         |
| **Runtime write** | `SET LOCAL ROLE kovo_writer` + query (`managed-db.ts:1289`)                                                              | `kovo_writer`, RLS-subject, least-privilege |
| **Runtime read**  | `SET LOCAL ROLE kovo_reader` + query                                                                                     | `kovo_reader`, RLS-subject, least-privilege |

Split these into **two connections and three phases** and all of Tier 1 falls out. The hard part — per-request
`SET LOCAL ROLE` + transaction-local `set_config('kovo.principal', …, true)` + single-statement confinement
(`managed-db.ts:1252-1293`) — already exists and is driver-agnostic. This plan swaps the client constructor, moves the
privileged DDL out of boot into a command, and re-asserts the (already idempotent) policy functions after migrations.

## 2. Design invariants

- **I1 — Provisioning and runtime are different identities.** Runtime connects as a least-privilege login role that is a
  member of `kovo_reader`/`kovo_writer`, holds no direct table grants, and is `NOBYPASSRLS`/non-superuser. Provisioning
  uses a separate admin connection and is never reachable at request time.
- **I2 — Data-bearing DDL is migrated; declarative security DDL is re-asserted.** Table structure holds data → real
  up/down migrations. RLS policies, column grants, role grants are _derived from `schema.ts`_ and re-applied idempotently
  after every migration (the `applyPglite*` functions already use `DROP POLICY IF EXISTS` + `CREATE POLICY` and
  idempotent `REVOKE/GRANT`, `:334-339`), so policies are never diffed — they are re-asserted to match the schema.
- **I3 — Never serve an unverified security posture (soundness, not just DX).** On managed PG an un-provisioned or
  stale table has RLS _off_ and the runtime role may still hold a grant ⇒ **fail open** (full-table read). Boot must
  verify FORCE RLS + `kovo_owner_scope` presence for every owner table and refuse to serve otherwise. The engine choke
  holds only if provisioning is _verified present_, never assumed. (Extends `SPEC.md` §10.3.)
- **I4 — Enforcement lives in one framework-owned module, not a per-app copy.** The 423-line
  `_kovo/app-runtime-db.ts` + hand-maintained `SCHEMA_TABLES` (`:36`) becomes a `@kovojs/server` module the app imports
  with config; the app supplies schema + connection config + seed only. Kills `plans/claude-papercuts-29.md` P4 and
  shrinks the TCB.

## 3. Decisions / work items

### DEC-A — Driver-selecting connection layer (Tier-1 #1)

- [ ] **A1 — `createAppRuntimeDb` branches on config instead of hardcoding `new PGlite`. No `KOVO_DATABASE_URL` ⇒ embedded PGlite (unchanged dev default). A `postgres://…` URL ⇒ a real driver via Drizzle's existing adapters (`drizzle-orm/node-postgres` Pool, `postgres-js`, or Neon HTTP for serverless).** `createPostgresScopedClient`'s transaction logic is dialect/driver-agnostic and is reused verbatim.
  - Acceptance: an app with `KOVO_DATABASE_URL=postgres://…` connects to an external Postgres and serves owner-scoped reads/writes; with the var unset the same app runs on embedded PGlite. Driver inferred from URL scheme (+ optional `KOVO_DB_DRIVER` override).
  - [x] Verified partial: `createPostgresAppRuntimeDb` now selects embedded PGlite by default and node-postgres Pool when a URL/driver requests it; the generated Postgres scaffold calls that helper instead of constructing PGlite directly.
    - Evidence: `packages/server/src/postgres-runtime.ts`, `packages/create-kovo/templates/src/_kovo/app-runtime-db.ts`; `pnpm exec vitest --run packages/server/src/postgres-runtime.test.ts packages/server/src/postgres-authz.test.ts packages/server/src/managed-db.test.ts --config ./vite.config.ts`.
  - [x] Verified partial: a local external Postgres cluster driven through a real `pg.Pool` serves owner-scoped reads/writes for separate principals over the node-postgres runtime path.
    - Evidence: `packages/server/src/postgres-external-probe.test.ts`; `pnpm exec vitest --run packages/server/src/postgres-external-probe.test.ts --config ./vite.config.ts`.
  - [ ] Remaining: scaffolded app env-var serve probe against external Postgres.
- [x] **A2 — Document + test pool safety: `SET LOCAL ROLE` and `set_config(…, true)` are transaction-local, so a returned pooled connection carries no residual role/principal.** Kovo already wraps every scoped statement in a transaction (`postgresTransaction`, `managed-db.ts:1264-1275`), so RLS-on-a-pool is safe by construction — no per-checkout reset needed.
  - Acceptance: a probe (see §5) proves N interleaved requests as different principals over a shared `pg` Pool never leak another principal's rows; docs state statement-mode poolers (PgBouncer statement mode) are unsupported and transaction-mode poolers (incl. Supabase's) are supported.
  - Evidence: `packages/server/src/postgres-external-probe.test.ts`, `site/content/guides/cli.md`; `pnpm exec vitest --run packages/server/src/postgres-external-probe.test.ts --config ./vite.config.ts`.

### DEC-B — Split provisioning from runtime (Tier-1 #3)

- [ ] **B1 — Lift `initializeAppDb`'s privileged DDL out of module-load into a `kovo db provision` command that connects via `KOVO_ADMIN_DATABASE_URL`.** Runtime boot does nothing privileged. Provision: ensure roles → run pending migrations → re-assert all derived policies/grants (idempotent). The narrowed writer grant from followup-6 DEC-C a′ (unclassified/reference tables un-granted ⇒ engine default-deny) is applied here.
  - Acceptance: `kovo db provision` against a fresh external Postgres (admin URL) creates roles + tables + policies; the runtime app (least-priv URL) then serves; re-running provision is a no-op (idempotent). The runtime login role cannot `CREATE ROLE`/`ALTER … FORCE RLS` (proven by attempting it → permission denied).
  - [x] Verified partial: the CLI now dispatches `kovo db provision|migrate|check`, loads `src/schema.ts`, routes external provision/migration through `KOVO_ADMIN_DATABASE_URL` / `--admin-database-url`, and proves the command contract on PGlite without doing DDL from runtime boot.
    - Evidence: `packages/cli/src/commands/db.ts`, `packages/cli/src/index.kovo-db.test.ts`; `pnpm exec vitest --run packages/cli/src/index.kovo-db.test.ts packages/cli/src/commands-manifest.test.ts packages/cli/src/index.kovo-check.test.ts site/scripts/cli-ref.test.mjs --config ./vite.config.ts`.
  - [x] Verified partial: external Postgres provisioning is idempotent, the least-privilege runtime serves owner-scoped reads/writes after provision, and the runtime login cannot `CREATE ROLE` or `ALTER TABLE ... FORCE ROW LEVEL SECURITY`.
    - Evidence: `packages/server/src/postgres-external-probe.test.ts`; `pnpm exec vitest --run packages/server/src/postgres-external-probe.test.ts --config ./vite.config.ts`.
  - [ ] Remaining: real migration runner integration.
- [x] **B2 — Role adoption for locked-down providers via optional `KOVO_DB_READER_ROLE` / `KOVO_DB_WRITER_ROLE`.** When set, provision SKIPS `CREATE ROLE` and does only the table-ownership-level DDL (`FORCE RLS`, `CREATE POLICY`, `REVOKE/GRANT`); the roles are pre-created by a DBA/IaC. Required in environments that forbid `CREATE ROLE` (Supabase/some Neon/enterprise), that centrally own roles, or that run multiple Kovo apps on one cluster (name collision). The runtime login role must be `GRANT`ed membership of both roles (framework does this in the default path; the DBA must in the adopted path) — documented.
  - Acceptance: with the two vars set and `CREATE ROLE` revoked from the admin identity, `kovo db provision` still succeeds using the pre-created roles; with them unset and `CREATEROLE` present, the framework creates `kovo_reader`/`kovo_writer` and grants the login role membership.
  - [x] Verified partial: env-provided reader/writer roles are adopted without `CREATE ROLE`; missing adopted roles fail closed instead of silently creating or falling back to defaults; the CLI guide documents the adopted-role contract.
    - Evidence: `packages/server/src/postgres-runtime.ts`, `packages/server/src/postgres-runtime.test.ts`, `site/content/guides/cli.md`; `pnpm exec vitest --run packages/server/src/postgres-runtime.test.ts --config ./vite.config.ts`; `pnpm exec tsc --ignoreConfig --noEmit --pretty false --target ES2024 --module NodeNext --moduleResolution NodeNext --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --skipLibCheck --allowImportingTsExtensions --types node,vitest packages/server/src/postgres-runtime.ts packages/server/src/postgres-runtime.test.ts`.
  - [x] Verified external: an external Postgres admin identity without `CREATEROLE` adopts pre-created reader/writer roles and the runtime login serves owner-scoped reads/writes through those roles.
    - Evidence: `packages/server/src/postgres-external-probe.test.ts`; `pnpm exec vitest --run packages/server/src/postgres-external-probe.test.ts --config ./vite.config.ts`.

### DEC-C — Migrations: migrate tables, re-assert policies (Tier-1 #2)

- [ ] **C1 — `kovo db migrate` generates/applies table-structure migrations from `schema.ts` (drizzle-kit table diff or Kovo-generated up/down), applied transactionally.** Data-bearing structure changes (ALTER TYPE, drop/rename column, backfills) are hand-authorable migrations; the framework does not silently `ADD COLUMN IF NOT EXISTS` against a real DB.
  - Acceptance: adding a column + a data backfill to `schema.ts` produces a reviewable migration that applies cleanly and is reversible; the boot posture check (I3/DEC-D) recognizes the new schema version.
  - [x] Verified partial: `kovo db migrate` loads sorted reviewed `.sql` files from `migrations/` / `--migrations`, records checksums in `_kovo_migrations`, idempotently skips already-applied files, and fails if an applied file changes.
    - Evidence: `packages/server/src/postgres-runtime.ts`, `packages/cli/src/commands/db.ts`, `packages/cli/src/index.kovo-db.test.ts`; `pnpm exec vitest --run packages/cli/src/index.kovo-db.test.ts packages/cli/src/commands-manifest.test.ts site/scripts/cli-ref.test.mjs --config ./vite.config.ts`.
  - [ ] Remaining: automatic migration generation/diffing from `schema.ts`, reversible down migration ergonomics, and an external Postgres migration probe.
- [ ] **C2 — After every migration, provision re-derives and re-applies the FULL policy/grant set from the current schema (idempotent re-assertion, no policy diff).** Adding a `secret:` column or changing an `owner:`/`ownerVia` annotation needs no bespoke policy migration — the re-assert step (existing `applyPgliteOwnerPolicies`/`…ReaderColumnPrivileges`/narrowed-writer, made driver-generic) picks it up.
  - Acceptance: changing a column from public to secret in `schema.ts` + provision ⇒ the column is `REVOKE`d from `kovo_reader` at the engine (a reader `SELECT` of it errors) with no hand-written policy migration; changing an owner column ⇒ `kovo_owner_scope` predicate updates via `DROP/CREATE POLICY`.
  - [x] Verified partial: the migration/provision path runs pending migrations first, then reasserts derived RLS policies, grants, and the schema fingerprint; the PGlite migration CLI test finishes with posture `STATUS ok`.
    - Evidence: `packages/server/src/postgres-runtime.ts`, `packages/cli/src/index.kovo-db.test.ts`; `pnpm exec vitest --run packages/cli/src/index.kovo-db.test.ts packages/cli/src/commands-manifest.test.ts site/scripts/cli-ref.test.mjs --config ./vite.config.ts`.

### DEC-D — Fail-closed boot posture verification (Tier-1 #3, soundness — I3)

- [ ] **D1 — At boot the runtime (least-priv) runs a cheap posture check and fails fast if the DB is un-provisioned or stale: every owner/ownedVia table has `FORCE ROW LEVEL SECURITY` + a live `kovo_owner_scope` policy, secret columns are `REVOKE`d, and a `_kovo_schema_version` + policy fingerprint matches the built schema.** On mismatch: refuse to serve with "run `kovo db provision`" — never serve an unprotected table.
  - Acceptance: a fresh external Postgres with tables but no policies (or a table added without re-provision) causes the app to refuse startup (non-zero, actionable message), NOT serve cross-owner rows. `kovo db check` runs the same verification standalone for CI/pre-deploy.
  - [x] Verified partial: the server runtime writes a schema/policy fingerprint during PGlite provisioning; standalone posture check passes after provisioning and reports `KV433_SCHEMA_FINGERPRINT` on an unprovisioned store.
    - Evidence: `packages/server/src/postgres-runtime.test.ts`; `pnpm exec vitest --run packages/server/src/postgres-runtime.test.ts packages/server/src/postgres-authz.test.ts packages/server/src/managed-db.test.ts --config ./vite.config.ts`.
  - [x] Verified partial: standalone `kovo db check` runs the same posture report and exits nonzero on an unprovisioned PGlite store.
    - Evidence: `packages/cli/src/index.kovo-db.test.ts`; `pnpm exec vitest --run packages/cli/src/index.kovo-db.test.ts packages/cli/src/commands-manifest.test.ts packages/cli/src/index.kovo-check.test.ts site/scripts/cli-ref.test.mjs --config ./vite.config.ts`.
  - [x] Verified external: a real Postgres database with the table present but missing Kovo RLS posture reports `KV433_*` issues and `createPostgresAppRuntimeDb(...).ready` rejects before serving.
    - Evidence: `packages/server/src/postgres-external-probe.test.ts`; `pnpm exec vitest --run packages/server/src/postgres-external-probe.test.ts --config ./vite.config.ts`.

### DEC-E — Framework-owned enforcement module (I4; kills papercuts-29 P4)

- [ ] **E1 — Move role setup, policy derivation, scoped-client construction, migration runner, and posture check from the copied `_kovo/app-runtime-db.ts` into `@kovojs/server`; the generated app imports it and passes { schema, connection config, seed }.** `SCHEMA_TABLES` is derived from the app's schema export, not a hand-list.
  - Acceptance: adding an owner table to `schema.ts` requires NO edit to any `_kovo/*` file; `grep SCHEMA_TABLES` in the generated app returns 0 hand-maintained entries; the enforcement code is in one `@kovojs/server` module enrolled in `security/TCB.md`.
  - [x] Verified partial: role setup, policy derivation, grants, scoped-client construction, schema-module table discovery, seed execution, and posture checking now live in `@kovojs/server`; generated Postgres `_kovo/app-runtime-db.ts` passes `{ schema, seedSql }` and contains no `SCHEMA_TABLES`.
    - Evidence: `packages/server/src/postgres-runtime.ts`, `packages/create-kovo/templates/src/_kovo/app-runtime-db.ts`; `pnpm exec vitest --run packages/create-kovo/src/index.test.ts --config ./vite.config.ts`; `pnpm exec vitest --run packages/create-kovo/src/index.build.runtime.test.ts packages/create-kovo/src/index.build.prod-artifact.contacts.test.ts --config ./vite.config.ts`.
  - [ ] Remaining: migration runner and any TCB enrollment/docs required for the moved module.

### DEC-F — RLS silent-deny diagnostic (Tier-2 #4)

- [x] **F1 — A dev-only diagnostic at the scoped-read boundary that distinguishes the three empty-result causes: (a) principal unset (`current_setting('kovo.principal')` NULL) — detectable with zero extra queries, the common case; (b) principal set + 0 rows + table non-empty — dev-only re-count via the internal/privileged handle reports "`kovo_owner_scope` filtered N rows for principal X"; (c) genuinely empty — silent.** Surfaced through a framework-owned diagnostic drain because there is no suitable request-runtime diagnostic channel yet. Prod (least-priv, no superuser handle) never runs the second query.
  - Acceptance: a dev read that returns empty because the request is unauthenticated emits the "no principal" diagnostic; a read empty because RLS filtered a non-empty table emits the "filtered N rows" diagnostic; a read of a truly empty table is silent. No diagnostic path exists in the prod least-priv runtime.
  - Evidence: `pnpm exec vitest run packages/server/src/postgres-authz.test.ts packages/server/src/api/app.test.ts` proves principal-unset/no-recount, filtered-row recount, genuinely-empty silence, production disablement, and the public drain export.
  - Evidence: `pnpm exec tsc --ignoreConfig --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --lib ES2022,DOM --types node,vitest --noEmit --skipLibCheck packages/server/src/managed-db.ts packages/server/src/postgres-authz.test.ts packages/server/src/api/data.ts packages/server/src/index.ts` type-checks the touched runtime/API files.

### DEC-G — Audited cross-owner read (Tier-2 #5)

- [ ] **G1 — Add `crossOwnerRead`, the read twin of the existing governed-column write escape (`managed-db.ts:819`): an audited capability that reads across owner boundaries, gated by a static `role('admin')` endpoint guard + runtime role check, logged with reason + principal, surfaced in `kovo explain --capabilities`.** (Named for the capability, per the escape family's convention — `rawRead`/`declarePublicRead`/`trustedSql` — not a persona.) Engine mechanism: a per-table permissive admin policy (`CREATE POLICY kovo_admin_scope ON t FOR SELECT TO kovo_admin USING (current_setting('kovo.role',true)='admin')`), NOT global `BYPASSRLS` — surgical, per-table opt-in, auditable. The handle does `SET LOCAL ROLE kovo_admin` + sets `kovo.role`; stays read-only and secret-column-`REVOKE`d unless the escape explicitly elevates those. The API name (`crossOwnerRead`) and the app's role string (`'admin'` in the predicate) are conceptually independent — document them separately.
  - Acceptance: an admin-guarded endpoint reads across all owners of an opted-in table; a non-admin (or a table without `kovo_admin_scope`) cannot; the cross-owner read is logged and appears in `kovo explain`. Reading _as_ one other principal remains `ctx.actAs(id)` (already exists, `endpoint.ts:108`).
  - [x] Verified partial: `Reader<Db>.crossOwnerRead(...)` is exposed through the managed read proxy, requires a passed runtime `guards.role('admin')` marker, provisions per-table `kovo_admin_scope` for opted-in owner/authz tables, sets `kovo.role = 'admin'` on the admin read role, keeps secret-column grants revoked, records reason + principal audit facts, and documents the API name separately from `role: 'admin'`.
    - Evidence: `packages/server/src/managed-db.ts`, `packages/server/src/guards.ts`, `packages/server/src/postgres-runtime.ts`, `site/content/guides/security.md`; focused G1 vitest command covering runtime, managed-db, guard, explain, and diagnostics tests; strict touched-file `tsc`.
  - [x] Verified partial: public API/export/docs surfaces accept the new audit drain/types and `kovo explain --capabilities` renders a `crossOwnerRead` capability fact.
    - Evidence: API/app/api-ref/public-packages vitest command; `pnpm run check:api-surface`; `node site/scripts/code-snippets-check.mjs`; `pnpm --filter @kovojs/site run build`; `pnpm --filter @kovojs/site run check:links`.
  - [x] Verified partial: static analysis requires authored `crossOwnerRead(...)` calls in endpoint/query bodies to be dominated by an explicit `guards.role("admin")` or `guards.all(...guards.role("admin")...)` guard, and fails closed for missing, non-admin, dynamic, aliased, shadowed, or helper-hidden cases.
    - Evidence: `packages/drizzle/src/static.ts`, `packages/drizzle/src/cross-owner-read-static.test.ts`; `pnpm exec vitest --run packages/drizzle/src/authz-census-static.test.ts packages/drizzle/src/cross-owner-read-static.test.ts --config ./vite.config.ts`; `pnpm exec vitest --run packages/cli/src/index.kovo-check.test.ts --config ./vite.config.ts`; `pnpm --filter @kovojs/drizzle run build:dist`.
  - [ ] Remaining: external managed-Postgres probe for the admin role/policy path.
- [x] **G2 (naming cleanup, separate from this plan's core) — rename the write escape `adminAssign(...)` → `trustedAssign(...)`, pairing it with `trustedSql` under a `trusted*` = "audited by-construction-guard bypass, provenance vouched-for" convention.** `adminAssign` is the lone persona-named escape in an otherwise capability/danger-named family (`trustedSql`/`unsafeRegex`/`rawRead`/`compareAndSet`/`accept.unverified`); the preview-bias rule (no legacy preservation) permits the rename. Hard break, no alias.
  - Acceptance: `grep adminAssign` returns 0 in shipped source; the escape is `trustedAssign`; docs + `kovo explain --capabilities` reflect it.
  - Evidence: `rg -n "adminAssign|AdminAssign|admin-assign|admin assignment" packages site spec docs public-packages.json` returned no matches; `pnpm exec vitest --run packages/server/src/write-governance.test.ts packages/server/src/managed-db.test.ts packages/drizzle/src/index.mass-assignment.test.ts packages/drizzle/src/index.identity-resolver.test.ts packages/core/src/diagnostics.test.ts --config ./vite.config.ts`; `pnpm run check:api-surface`; `pnpm run check:vp`.

### DEC-H — Principal-aware test helper (Tier-2 #6)

- [ ] **H1 — Expose the existing `createRequestScopedDb(client, principal)` (`app-runtime-db.ts:98`) as a test-blessed `withPrincipal(id, fn)` (+ `asSystem`, `asAdmin`) from a `@kovojs/server/testing` subpath, wired to an ephemeral provisioned PGlite.** Tests exercise the REAL RLS engine, not a mock.
  - Acceptance: a unit test writes rows as `user-a` and asserts `user-b` sees `[]` for an owner table, using only the test helper (no HTTP/auth). The subpath is forbidden in request code by the sole-door lint (followup-6 DEC-B).
  - [x] Verified partial: `@kovojs/server/testing` exposes `createPostgresTestRuntime(...).withPrincipal(id, fn)` over an ephemeral provisioned PGlite runtime; a focused test writes as `user-a` and proves `user-b` sees `[]` through real RLS.
    - Evidence: `packages/server/src/testing.ts`, `packages/server/src/postgres-testing.test.ts`; `pnpm exec vitest --run packages/server/src/postgres-testing.test.ts --config ./vite.config.ts`.
  - [x] Verified partial: `createPostgresTestRuntime({ crossOwnerReadTables }).asAdmin(id, fn)` exposes the runtime's read-only admin posture, passes the real `guards.role("admin")` marker, requires explicit table opt-in, and records the `crossOwnerRead` audit principal.
    - Evidence: `packages/server/src/testing.ts`, `packages/server/src/postgres-testing.test.ts`; `pnpm exec vitest --run packages/server/src/postgres-testing.test.ts --config ./vite.config.ts`; touched-file strict `tsc`; `pnpm run check:api-surface`; `pnpm run check:vp`.
  - [ ] Remaining: no `asSystem` helper is exposed until the runtime has an honest system Postgres posture.

### DEC-I — Custom-RLS-policy escape for team/org/RBAC (Tier-3 #7; concretizes followup-5 DEC-J)

- [x] **I1 — Wire the existing custom `authzPolicy` SQL predicate annotation into PG provisioning.**
      The annotation shape is `kovo({ authzPolicy: sql(...) })`; provisioning should emit `ENABLE/FORCE ROW LEVEL SECURITY`
      plus `CREATE POLICY ... USING(predicate) WITH CHECK(predicate)` from the predicate. Already parsed evidence:
      `runtime-metadata.test.ts:201`; census-classified `authzPolicy`: `static.ts:2180`. Distinguish the two
      `authzPolicy` modes: a **string** justification = guard-governed shared table (no RLS emitted, the starter's
      `contacts` `schema.ts:21`); a **`sql` predicate** = custom RLS policy. Close the latent gap: today
      `applyPgliteOwnerPolicies` handles `owner`/`ownerVia` but NOT the `authzPolicy` predicate form, so a custom-predicate
      table passes the census yet may get no policy (unprotected). The DEC-D posture check must verify FORCE RLS + policy
      presence for `authzPolicy(sql)` tables too.
  - Acceptance: a `documents` table with a team-membership predicate gets FORCE RLS + a policy at provision; a member of the team reads/writes team documents, a non-member sees `[]`; the posture check treats it as covered.
  - Evidence: `packages/server/src/postgres-runtime.ts`, `packages/server/src/postgres-runtime.test.ts`; `pnpm exec vitest --run packages/server/src/postgres-runtime.test.ts --config ./vite.config.ts`.
  - Residual risk: dependency grants for custom predicates are derived from Drizzle `usedTables`; predicates that mention dependency tables only as raw text may still fail closed with engine permission denial rather than inferred dependency grants.
- [x] **I2 — Ship the worked team/org example in the docs (the documented custom-RLS-policy escape).** State the honesty boundary explicitly: Kovo guarantees the table is FORCE-RLS + policy-present + census-covered; the **predicate's correctness is the app's responsibility**, exactly like any custom authz (SPEC §10.3 / followup-5 DEC-J). Show the many-to-many membership shape `ownerVia` cannot express in one hop.
  - Acceptance: a docs page under `site/content/guides/` demonstrates the membership-join `authzPolicy` end to end (schema annotation, provisioned policy, member vs non-member behavior) with the guarantee boundary called out; follows `rules/docs-style.md`.
  - Evidence: `site/content/guides/postgres-authz-policy.md`; worker `pnpm --filter @kovojs/site run build`; worker `pnpm --filter @kovojs/site run check:links`; worker `node site/scripts/code-snippets-check.mjs`.

## 4. Config surface (new)

- `KOVO_DATABASE_URL` — runtime least-privilege connection (login role, member of reader/writer, `NOBYPASSRLS`). Unset ⇒ embedded PGlite dev default.
- `KOVO_ADMIN_DATABASE_URL` — provisioning/migration connection (DDL + role rights). Only read by `kovo db provision`/`migrate`, never at request time.
- `KOVO_DB_READER_ROLE` / `KOVO_DB_WRITER_ROLE` — optional; adopt pre-created roles (skips `CREATE ROLE`). See DEC-B2.
- `KOVO_DB_ADMIN_ROLE` — optional; adopt the pre-created admin read role used only by `crossOwnerRead` tables. Unset + `crossOwnerReadTables` ⇒ provision creates `kovo_admin`.
- `KOVO_DB_DRIVER` — optional driver override when scheme is ambiguous (e.g. Neon HTTP vs TCP).
- Commands: `kovo db provision` (roles + migrate + re-assert policies), `kovo db migrate` (table migrations), `kovo db check` (drift + posture, = boot check standalone).

## 5. Probes to run before committing (verify the two load-bearing claims)

- [x] **Probe-1 — CREATE ROLE / FORCE RLS at boot genuinely fails as a non-superuser managed role** (motivates the provision/runtime split). Create a `NOSUPERUSER NOCREATEROLE` role in PGlite (or a real PG), `SET ROLE` to it, attempt `CREATE ROLE x` and `ALTER TABLE t FORCE ROW LEVEL SECURITY` ⇒ expect `permission denied`. Confirms DEC-B is necessary, not cosmetic.
  - Evidence: `packages/server/src/postgres-external-probe.test.ts`; `pnpm exec vitest --run packages/server/src/postgres-external-probe.test.ts --config ./vite.config.ts`.
- [x] **Probe-2 — transaction-local role+principal survives a real pooled checkout/return without leaking** (validates DEC-A2 / I1). Over a `pg` Pool (or PGlite proxy), interleave requests as principals A and B through `SET LOCAL ROLE` + `set_config(…, true)` in transactions; assert A never sees B's rows and a fresh checkout has no residual `current_setting('kovo.principal')`.
  - Evidence: `packages/server/src/postgres-external-probe.test.ts`; `pnpm exec vitest --run packages/server/src/postgres-external-probe.test.ts --config ./vite.config.ts`.

## 6. Acceptance (v1 Postgres-deployable)

- [ ] A scaffolded app deploys against an EXTERNAL managed Postgres: `kovo db provision` (admin URL) then serve (least-priv URL); owner-scoped isolation holds end-to-end; the runtime role cannot escalate.
- [ ] Schema evolution works on a DB with data: `kovo db migrate` applies a reviewable, reversible table migration; provision re-asserts policies; the posture check passes.
- [x] Un-provisioned / stale DB ⇒ the app refuses to serve (D1), never fails open.
  - Evidence: `packages/server/src/postgres-external-probe.test.ts`; `pnpm exec vitest --run packages/server/src/postgres-external-probe.test.ts --config ./vite.config.ts`.
- [ ] Adding an owner table touches only `schema.ts` (E1); no `_kovo/*` hand-edits.
- [ ] An empty scoped read is debuggable (F1 names principal-unset vs RLS-filtered vs empty); an admin-guarded endpoint reads across owners (G1); isolation is unit-testable via `withPrincipal` (H1).
- [ ] A team/org table via `authzPolicy: sql\`…\`` is FORCE-RLS + policy-provisioned and posture-verified, with the documented escape example shipped (I1/I2).

## 7. Scope & out of scope

**In scope:** DEC-A–E make Postgres _deployable_ (connect, provision, evolve, fail-closed, framework-owned);
DEC-F–I make the sound model _pleasant_ (RLS diagnostics, audited admin read, test helper, custom-policy escape +
doc). Together these are "Postgres v1 DevEx."

**Out of scope (follow-on):** a full first-class RBAC/ABAC framework beyond the `authzPolicy(sql)` escape (roles,
permission matrices, policy composition as typed API rather than raw predicate). DEC-I's documented custom-RLS-policy
escape is the v1 answer for team/org scoping; a richer typed authz DSL is post-v1.
