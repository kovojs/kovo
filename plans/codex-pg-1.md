# Codex PG 1

Created 2026-07-04. Source of truth remains `SPEC.md`; this ledger captures an exhaustive
local dogfood sweep focused on Postgres and security. Confirmed security/soundness defects are
filed in `plans/bugz-24.md`.

Meta-theme: the Postgres runtime's core RLS/cache/attached-code floors mostly held, but external
role adoption and two managed-capability chokes still have sharp edges.

## Scope

Baseline: fresh default Postgres `create-kovo` scaffold at `/Users/mini/kovo-dogfood-codex-pg-20260704/base`, linked to local packages. The baseline ran `check`, `test`, `build:prod`, and dev HTTP smoke; a later multi-app link-local install polluted package resolution as expected by the dogfood skill, and was repaired with `CI=true pnpm install` at repo root.

Tracks: attached-code closure audit, `/_q` cache/guard behavior, raw SQL runtime enforcement, external provisioning/role adoption/migrations, and secret egress. Throwaway apps live under `/Users/mini/kovo-dogfood-codex-pg-20260704/`.

## Issues

### A. Security Findings Routed To Bugz

- [ ] **See `plans/bugz-24.md` A1/A2.** (high, security/soundness)
  - Observed behavior: two confirmed security/soundness issues were escalated instead of being buried here: generated Better Auth system DB secret egress, and mutable separated SQL carrier TOCTOU.
  - Acceptance: close the two `bugz-24` items and add the focused paranoid/managed-SQL regression tests named there.

### B. External Postgres Role Adoption

- [ ] **Adopted reader/writer roles are not granted to the runtime login, while provision/check still report OK.** (high, framework/dev-tooling; found by `track-provision-roles-migrations`)
  - Observed behavior: with `KOVO_DB_READER_ROLE` / `KOVO_DB_WRITER_ROLE` set, `kovo db provision` and `kovo db check` return `STATUS ok`, but the runtime login has no membership in those roles and cannot `SET ROLE`.
  - Root cause: `packages/server/src/postgres-runtime.ts:1719-1721` sets `createReaderRole` / `createWriterRole` false when env roles are adopted; `grantPostgresRuntimeLoginRole` only grants memberships when those flags are true at `packages/server/src/postgres-runtime.ts:2199-2203`. This contradicts the docs promise at `site/content/guides/cli.md:184-187`.
  - Why it matters: this is the documented locked-down-provider path. A deploy can pass provision/check and then fail every scoped runtime read/write once it tries to assume reader/writer.
  - Repro evidence: verifier ran adopted roles with runtime URL: provision/check OK, but `pg_has_role('adopt_runtime','adopted_reader','USAGE')` and writer both false; `SET ROLE adopted_writer` returned permission denied.
  - Acceptance: adopted reader/writer roles are granted to the runtime login when `KOVO_DATABASE_URL` is present, or provision/check fail with an actionable diagnostic if membership is expected to be DBA-owned.

- [ ] **Reader/writer role adoption still requires `CREATEROLE` because default admin/system roles are created unconditionally.** (high, framework/dev-tooling; found by `track-provision-roles-migrations`)
  - Observed behavior: on a fresh locked-down cluster with only documented reader/writer roles pre-created and a `NOCREATEROLE` admin URL, `kovo db provision` fails with raw `permission denied to create role`.
  - Root cause: `packages/server/src/postgres-runtime.ts:1718` keeps `createAdminRole` true unless `KOVO_DB_ADMIN_ROLE` is also set, and `packages/server/src/postgres-runtime.ts:1720` hard-codes `createSystemRole: true`; provision calls role creation at `packages/server/src/postgres-runtime.ts:686-688`, with `CREATE ROLE` emitted at `packages/server/src/postgres-runtime.ts:2144-2146`.
  - Why it matters: the docs sell role adoption for providers/DBAs that own role creation, but the default scaffold can still require role-creation privilege for roles the app did not ask to use directly.
  - Repro evidence: verifier ran `KOVO_DB_READER_ROLE=adopted_reader KOVO_DB_WRITER_ROLE=adopted_writer pnpm exec kovo db provision --migrations migrations` against a `NOCREATEROLE` admin and got `permission denied to create role`.
  - Acceptance: role adoption covers every framework role that provision may create, including system/admin, or provision emits a preflight diagnostic naming the missing `KOVO_DB_ADMIN_ROLE` / system-role adoption requirement before attempting DDL.

- [ ] **`kovo db check` with only `KOVO_ADMIN_DATABASE_URL` silently checks embedded PGlite.** (med, CLI/dev-tooling; found by `track-provision-roles-migrations`)
  - Observed behavior: after external provision/migrate, `KOVO_ADMIN_DATABASE_URL=... pnpm exec kovo db check` chooses `DRIVER pglite` and reports local `.kovo/pglite` posture, not the external database the admin URL names.
  - Root cause: `packages/cli/src/commands/db.ts:332-336` forces PGlite when `shouldCheckEmbeddedPglite` is true; that helper only checks for a runtime URL at `packages/cli/src/commands/db.ts:423-427`, ignoring `KOVO_ADMIN_DATABASE_URL`.
  - Why it matters: a CI/predeploy check can report posture for the wrong database. This is distinct from normal provision/migrate, which already treat the admin URL as an external signal.
  - Repro evidence: verifier ran `KOVO_ADMIN_DATABASE_URL=postgres://admin:bad@127.0.0.1:1/nope KOVO_DATA_DIR=.kovo/verify-admin-only-check pnpm exec kovo db check` and saw `DRIVER pglite`; forcing `KOVO_DB_DRIVER=node-postgres` took the external path instead.
  - Acceptance: `db check` treats an admin URL as an external-Postgres signal, or refuses admin-only check configuration with a diagnostic that asks for `KOVO_DATABASE_URL` / `--driver`.

## Refuted / Not Carried Forward

- Attached-code closure audit held: CHECK/domain constraints, default/generated expressions, index expressions/predicates, rewrite rules, and trigger-attached functions produced `KV433_ATTACHED_CODE`; root source now scans `pg_trigger`, `pg_rewrite`, `pg_constraint`, `pg_attrdef`, and `pg_index` dependencies.
- `/_q` guarded/session-dependent cache leaks did not reproduce: dev and compiled artifact probes returned `Cache-Control: private, no-store` and `Vary: Cookie`; guard counters proved re-check on every typed read.
- External Postgres happy path passed in the provisioning track: generate, migrate, provision, check with runtime URL, `build:prod`, and production boot smoke all worked.
- Default external-role path held for prior `set_config` over-block: runtime login could not `CREATE ROLE` / `ALTER TABLE FORCE RLS` and could `SET ROLE kovo_writer` after provision.
- Default ACLs are audited: `ALTER DEFAULT PRIVILEGES ... GRANT SELECT ... TO kovo_reader` produced `KV433_UNEXPECTED_PRIVILEGE`.
- Serial/identity sequence over-block appears fixed by source: backed sequences are allowlisted, non-backed reachable sequences still fail closed.
- Migration ordering appears fixed: roles are ensured before migrations, and external provision skipped the already-applied migration idempotently.
- Fresh starter `vp check` now reports only the generated thenable warning at `src/_kovo/app-runtime-db.ts:70`; it did not fail after root install repair. A transient PGlite abort during multi-app runs was classified as link-local workspace pollution, not product behavior.

## Latest Verification

- `pnpm --filter create-kovo run build:dist`: rebuilt local scaffold bits.
- Baseline `/Users/mini/kovo-dogfood-codex-pg-20260704/base`: `pnpm run test` passed on rerun; dev smoke returned `/` -> `303` then `/login` 200 with CSRF form; `build:prod` passed before multi-app pollution.
- Track probes: attached-code verifier, query-cache verifier, provisioning verifier, secret-egress repro, and managed-carrier repro all completed with structured handoff.
- Root repair: `CI=true pnpm install`; `node -e "require.resolve('typescript'); require.resolve('vitest')"` resolved from `/Users/mini/kovo/node_modules`; `git status --short` was clean before writing these ledgers.
