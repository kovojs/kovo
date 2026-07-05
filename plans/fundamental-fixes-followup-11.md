# Fundamental Fixes Followup 11 — capabilities are not values: mint once, freeze before use, verify the deployment graph

Created 2026-07-04. Self-standing. Source of truth for behavior is `SPEC.md`. Continues the engine-choke and
retain-and-prove line (`fundamental-fixes-followup-{6,7,8,9,10}.md` + `postgres-v1-devex.md`). Responds to
`plans/bugz-24.md` A1-A2 and the external-role findings in `plans/codex-pg-1.md`. Line numbers cite the current local
worktree after the 2026-07-04 dogfood pass.

## 1. The one foundational issue (codex-pg restatement)

The codex-pg pass found two security bugs that look different but share the same root: **security-critical framework
authority is represented as ordinary, reusable app values after the point where the framework has reasoned about it.**
Once a capability is just an exported DB object or a mutable `{ text, values }` object, app code can route it through a
different path than the one the framework intended.

| Finding            | The ordinary value that crossed the boundary                             | What bypassed the proof                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `bugz-24` A1       | `appRuntimeAuthDb`, a generated `AppDb` export backed by `systemDb(...)` | allowlisted `src/auth.ts` can read Better Auth secret columns as plain strings; the readonly secret-boxing choke never sees the read            |
| `bugz-24` A2       | separated SQL carrier `{ text, values }`                                 | validation reads one mutable `.text`; the driver executes the same object after `.text` changes                                                 |
| `codex-pg-1` B1-B3 | role topology inferred from env booleans / URLs                          | provision/check can say OK while the runtime login cannot assume adopted roles, or `db check` audits embedded PGlite instead of the external DB |

**The unifying principle this plan enforces: security capabilities are not app values.** They are framework-owned,
lineage-bearing capabilities with a single consumer path, a scope, and a lifecycle. If a capability must cross a public
or app-authored boundary, it crosses as a narrowed facade, not as the raw authority. If executable SQL crosses a managed
handle boundary, the framework snapshots it into an immutable statement artifact before any check, and the exact same
artifact is executed. If an external database is the security engine, its role topology is an explicit manifest that
provision, check, boot, and docs all validate from the same facts.

## 2. The architectural moves

**Move 1 — remove privileged generated exports from app source.** The auth adapter needs a system DB, but app modules
must not import or re-export it. Better Auth wiring should receive an opaque framework-owned adapter capability (or a
factory callback consumed only inside framework construction), not an `AppDb` value in `src/_kovo/app-runtime-db.ts`.

**Move 2 — split DB authority by facade, not comments.** App-authored request code gets only request-scoped read/write
facades whose methods are enrolled in the managed chokes. System/auth/provision capabilities are module-private and
non-structural. A comment like "do not import this" is never a boundary.

**Move 3 — canonicalize SQL at the first managed boundary.** Any accepted SQL input becomes an immutable
`ManagedSqlStatement` snapshot `{ text, values, dialect, provenance }`. Validation, table allowlisting, instrumentation,
and driver execution consume that same snapshot. Mutable getters, object identity reuse, and late driver reads cannot
change the statement after proof.

**Move 4 — make deployment role topology a manifest, then verify it everywhere.** Role adoption is not "skip CREATE
ROLE." It is a declared topology: reader, writer, admin, system, runtime login, membership edges, and who owns each
edge (Kovo vs DBA). `provision`, `check`, and boot must all validate the same topology and must never silently switch
to embedded PGlite when an external URL is present.

## 3. Meta-invariant (extends followup-10 C8)

- [ ] **C9 — Security capabilities must have one framework-owned mint, one narrowed consumer path, and one immutable
      proof artifact. A raw capability (system DB, privileged role, raw SQL statement, secret-readable handle) must never
      be exported as an ordinary app value; a checked SQL statement must be frozen before validation and the frozen artifact
      must be what executes; a deploy role graph must be declared and verified from one manifest across provision/check/boot.
      Corollary: every exception to the ordinary request DB surface is either unexportable module-private framework code or
      an audited, branded facade whose use appears in `kovo explain --capabilities`.**

## 4. Decisions / work items

### DEC-A — Privileged DB capabilities are framework-owned, not generated app exports (fixes `bugz-24` A1)

- [ ] **A1 — Remove `appRuntimeAuthDb` as an exported `AppDb` value from generated `src/_kovo/app-runtime-db.ts`.**
      Better Auth should receive a framework-owned adapter capability, not a general DB handle. Options, in preference
      order: (1) `createBetterAuthDatabaseAdapter({ runtime, schema, reason })` from `@kovojs/better-auth` / server internals
      consumes `systemDb` inside framework-owned code; (2) generated `_kovo` keeps the system DB in a module-private closure
      and exports only `createAuthAdapter()` with no raw DB return; (3) a branded `AuthAdapterDb` facade exposes only the
      exact Better Auth adapter operations, with secret reads boxed/refused. No option may export `AppDb`.
  - Acceptance: `rg "export const appRuntimeAuthDb|export .*systemDb" packages/create-kovo/templates src` finds no
    generated public raw system DB export; `src/auth.ts` cannot import a DB value from `_kovo`; Better Auth sign-in/out
    still work in dev, test, and production artifact.

- [x] **A2 — Make system DB capabilities non-structural and non-readable by default.** `systemDb(...)` returns a
      module-private capability or narrowed facade, not `KovoPostgresRuntimeDb`. Where a system path genuinely needs reads,
      those reads pass through the same secret-boxing/confidentiality boundary as readonly reads, or through a named
      `declareSecretReadCapability(...)` reason surfaced in `kovo explain --capabilities`.
  - Acceptance: a system/auth capability cannot be assigned to `AppDb`; a read of `session.token` / `account.password`
    through any public system facade either throws `KV435`/returns boxed `Secret` or requires an audited capability row.
  - Evidence: `pnpm exec vitest --run packages/server/src/postgres-runtime.test.ts packages/create-kovo/src/index.test.ts packages/drizzle/src/static-analysis-context.test.ts --config ./vite.config.ts` passed; `postgres-runtime.test.ts` includes a `@ts-expect-error` assignment from `KovoPostgresSystemDb` to `KovoPostgresRuntimeDb`, and `pnpm run check:api-surface` plus `pnpm run check:capability-surface-census` passed.

- [x] **A3 — Move the `_kovo/app-runtime-db` import ban from a contributor script into production build/static analysis,
      and make allowlists operation-specific.** `src/auth.ts` may import the auth adapter factory, not raw runtime DB
      values. Request-authored modules, tests enrolled in the starter security surface, and transitive re-exports are all
      rejected when they carry raw runtime DB value bindings.
  - Acceptance: the throwaway `dogfoodReadAuthToken()` endpoint shape from `/Users/mini/kovo-dogfood-codex-pg-20260704`
    fails `kovo build` with a first-class diagnostic before endpoint-posture; direct tests importing `_kovo` fail the
    same way unless they import types only.
  - Evidence: `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts --config ./vite.config.ts -t "blocks request-authored runtime DB imports"` passed with a KV414 production-build failure, and `pnpm exec vitest --run packages/drizzle/src/sql-safety-static.test.ts --config ./vite.config.ts` passed.

### DEC-B — SQL statement proof uses immutable snapshots (fixes `bugz-24` A2)

- [x] **B1 — Introduce `ManagedSqlStatement`, the only value managed DB handles pass to drivers.** At the first managed
      boundary, snapshot accepted carriers into `{ text: string, values: readonly unknown[], dialect, provenance }`, freeze
      it, validate it, classify tables/functions, and execute the snapshot. The original object is never passed onward.
  - Acceptance: a getter-backed `{ text, values }` carrier cannot present different SQL to validation and execution;
    the driver's observed statement is the validated text.
  - Evidence: `pnpm exec vitest --run packages/core/src/sql-safety.test.ts packages/server/src/managed-db.test.ts packages/test/src/pglite-harness.test.ts packages/test/src/sqlite-harness.test.ts packages/server/src/postgres-runtime.test.ts packages/server/src/postgres-external-probe.test.ts packages/cli/src/index.kovo-db.test.ts --config ./vite.config.ts` passed with 201 tests.

- [x] **B2 — Treat separated carriers as input syntax, not trusted statement identity.** `isSeparatedSqlCarrier` may
      admit only plain data properties whose descriptors are non-accessor, or it may snapshot accessors exactly once before
      any validation. Either way, mutable getters/proxies are rejected or made harmless.
  - Acceptance: object with `get text()` fails closed or executes the first snapped text; `Object.freeze`/descriptor
    tests cover `.text`, `.sql`, `.values`, and Drizzle/Kovo SQL object paths.
  - Evidence: `pnpm exec vitest --run packages/core/src/sql-safety.test.ts packages/server/src/managed-db.test.ts packages/test/src/pglite-harness.test.ts packages/test/src/sqlite-harness.test.ts --config ./vite.config.ts` covered accessor rejection, proxy snapshotting, frozen snapshots, PGlite, and SQLite execution.

- [x] **B3 — Enroll statement snapshotting in the security census and mutation gates.** Add a "statement identity"
      axis to the managed-SQL matrix: plain object, getter object, proxy, Drizzle SQL, Kovo `sql`, `trustedSql`, unknown
      method carrier, transaction/webhook/task carrier. Deleting snapshotting or passing the original object to the driver
      must turn the gate red.
  - Acceptance: a mutant that changes driver execution back to the original object is killed; the census has no open
    managed-SQL carrier rows.
  - Evidence: `pnpm run check:capability-surface-census` rejects managed SQL wrappers that pass `statement` instead of `snapshot`, and `pnpm exec vitest --run packages/core/src/sql-safety.test.ts packages/server/src/managed-db.test.ts packages/test/src/pglite-harness.test.ts packages/test/src/sqlite-harness.test.ts --config ./vite.config.ts` passed.

### DEC-C — Role adoption is a verified topology manifest (fixes `codex-pg-1` B1-B3)

- [x] **C1 — Replace `createReaderRole` / `createWriterRole` booleans with a resolved `PostgresRoleTopology`.** The
      topology records role names, whether Kovo creates or adopts each role, runtime login, required membership edges,
      grant ownership, and whether DBA-owned edges are expected. Reader, writer, admin, and system roles all participate;
      no role creation path is implicit.
  - Acceptance: an adopted reader/writer topology still validates/grants runtime membership when Kovo owns that edge;
    if DBA owns the edge, provision/check/boot verify it and fail with an actionable diagnostic when missing.
  - Evidence: `pnpm exec vitest --run packages/server/src/postgres-runtime.test.ts packages/server/src/postgres-external-probe.test.ts --config ./vite.config.ts` passed with adopted-role membership and missing-membership coverage.

- [x] **C2 — Add system/admin role adoption or explicit preflight refusal.** A locked-down provider path that adopts
      reader/writer must not unexpectedly attempt `CREATE ROLE kovo_admin` or `kovo_system`. Either expose
      `KOVO_DB_ADMIN_ROLE` and `KOVO_DB_SYSTEM_ROLE` (or config equivalents) as first-class adoption inputs, or preflight
      with "this config still requires CREATEROLE for admin/system" before any DDL.
  - Acceptance: a `NOCREATEROLE` admin with all roles pre-created can provision; with missing admin/system adoption,
    provision fails before partial DDL and names the missing role/config.
  - Evidence: `pnpm exec vitest --run packages/server/src/postgres-runtime.test.ts packages/server/src/postgres-external-probe.test.ts --config ./vite.config.ts` passed; `postgres-runtime.test.ts` verifies missing adopted system-role preflight leaves schema objects unapplied.

- [x] **C3 — `kovo db check` chooses the same target-resolution logic as provision/migrate.** An admin URL is an
      external-Postgres signal; runtime URL absence may be an error, not permission to check embedded PGlite. `DRIVER`
      output must include the selected URL source (`runtime`, `admin`, `pglite`, or explicit `--driver`).
  - Acceptance: `KOVO_ADMIN_DATABASE_URL=postgres://bad@127.0.0.1:1/nope kovo db check` attempts/diagnoses the external
    target or asks for `KOVO_DATABASE_URL`; it never reports local PGlite posture silently.
  - Evidence: `pnpm exec vitest --run packages/cli/src/index.kovo-db.test.ts --config ./vite.config.ts` passed; the admin-URL check asserts no `DRIVER pglite` fallback and reports the external connection failure.

- [x] **C4 — Make role topology visible in `kovo explain --capabilities` / `kovo db check`.** Print adopted vs created
      roles, runtime membership edges, and DBA-owned edges. This converts external deployment security from hidden env
      inference into a diffable fact reviewers can audit.
  - Acceptance: a generated external-Postgres report shows `readerRole`, `writerRole`, `adminRole`, `systemRole`,
    `runtimeLogin`, and membership status; missing membership is a blocking check issue.
  - Evidence: `pnpm exec vitest --run packages/cli/src/index.kovo-db.test.ts packages/server/src/postgres-runtime.test.ts packages/server/src/postgres-external-probe.test.ts --config ./vite.config.ts` passed; `kovo db` output asserts all role lines, while Postgres runtime/probe tests cover runtime membership status and blocking missing membership diagnostics.

### DEC-D — Capability-surface census: no raw authority leaves framework ownership

- [x] **D1 — Add a raw-capability export census over generated starters and public packages.** Rows include system DB,
      auth adapter DB, readonly DB, request DB provider, raw driver clients, storage signer, webhook transaction DB,
      `ManagedSqlStatement`, principal posture, and role topology. Each row records: mint site, public/exported status,
      allowed consumers, build diagnostic, and prod-artifact proof.
  - Acceptance: `pnpm run check:capability-surface-census` fails if a raw authority is exported as a value without a
    branded/narrowed facade and a proof row.
  - Evidence: `pnpm run check:capability-surface-census` validates `scripts/capability-surface-census.manifest.json` rows and rejects generated raw auth/system DB exports.

- [ ] **D2 — Capability use is explainable.** Any privileged facade use (`system`, auth adapter, cross-owner read,
      secret read, trusted SQL, role topology opt-out) emits a capability fact. Absence from explain is a bug unless the
      capability is wholly module-private framework code with no app-authored call site.
  - Acceptance: `kovo explain --capabilities` prints auth adapter/system DB posture without exposing the handle, managed
    SQL trust sites, and external role topology; the dogfood secret endpoint would either fail build or print an
    unacceptable raw system capability row.

### DEC-E — SPEC and docs name the real boundaries

- [ ] **E1 — SPEC §10.3 / §11.2 state three boundaries explicitly: capability ownership, immutable statement identity,
      and role-topology verification.** The `set_config`/RLS engine boundary from followup-10 remains; this followup adds
      that system/auth DB handles are not public app capabilities, and that runtime SQL validation proves the exact bytes
      sent to the driver.
  - Acceptance: SPEC says a checked statement artifact, not the original JS object, is the runtime verification unit;
    generated runtime DB docs no longer rely on comments as boundaries.

- [ ] **E2 — Update the external Postgres docs to match the topology manifest.** Docs should say which roles must
      exist, who grants runtime membership, how admin/system adoption works, and what `db check` targets.
  - Acceptance: the `site/content/guides/cli.md` role-adoption section no longer promises memberships that the code
    does not verify; examples show `kovo db check` with external target selection.

## 5. Resolved design decisions (initial)

- **Export raw `AppDb` vs framework-owned auth adapter** — choose FRAMEWORK-OWNED ADAPTER. Better Auth needs database
  operations, not ambient app authority. A narrowed adapter can be audited; a raw `AppDb` cannot.
- **Secret-box system DB vs make system DB unexportable** — choose BOTH: system DB is unexportable by default, and any
  system read path that remains public must still pass the secret-read boundary. Defense in depth is cheap here.
- **Snapshot SQL carriers vs require only trusted classes** — choose SNAPSHOT FIRST. Kovo should accept ordinary
  parameterized `{ text, values }` driver shapes, but once accepted they become immutable framework-owned artifacts.
- **Reject accessors/proxies vs snapshot them once** — either is acceptable if the exact executed statement is the
  checked artifact. Prefer rejecting accessors/proxies for smaller TCB unless ecosystem compatibility requires
  one-time snapshotting.
- **Role adoption as docs contract vs runtime manifest** — choose RUNTIME MANIFEST. Docs cannot be the enforcement
  boundary for external database topology.

## 6. Probes before committing

- [x] **DEC-A:** recreate the `bugz-24` A1 endpoint shape (helper in `src/auth.ts`, public endpoint serializing
      `session.token`) and prove `kovo build` or `check:sound-subset` fails before serving.
  - Evidence: `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts --config ./vite.config.ts -t "blocks request-authored runtime DB imports"` injects `dogfoodReadAuthToken` and proves `kovo build` fails with KV414.
- [ ] **DEC-A:** Better Auth sign-in/sign-out still pass in fresh Postgres starter dev, production artifact, and
      external-Postgres provisioned artifact without exporting `appRuntimeAuthDb`.
- [x] **DEC-B:** getter/proxy separated SQL carrier cannot execute a different statement than the one validated;
      existing plain `{ text, values }`, Drizzle SQL, Kovo `sql`, and `trustedSql` still work.
- [x] **DEC-B:** mutation testing kills a change that passes the original mutable carrier to the driver.
  - Evidence: `pnpm run check:capability-surface-census` rejects original-statement driver calls, and the DEC-B focused Vitest command above passed.
- [x] **DEC-C:** adopted reader/writer/admin/system roles on a `NOCREATEROLE` external database provision/check/boot
      successfully when memberships are correct, and fail with named diagnostics when any membership is missing.
- [x] **DEC-C:** `KOVO_ADMIN_DATABASE_URL`-only `kovo db check` no longer reports embedded PGlite posture silently.
  - Evidence: `pnpm exec vitest --run packages/cli/src/index.kovo-db.test.ts packages/server/src/postgres-runtime.test.ts packages/server/src/postgres-external-probe.test.ts --config ./vite.config.ts` passed.
- [ ] **DEC-D:** capability-surface census has rows for every raw authority and fails if `appRuntimeAuthDb` or an
      equivalent system DB value is exported.

## 7. Expected verification bundle

- [ ] `pnpm exec vitest --run packages/server/src/managed-db.test.ts packages/server/src/sql-safe-handle.test.ts packages/server/src/guards.test.ts --config ./vite.config.ts`
- [ ] `KOVO_PARANOID=1 pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts --config ./vite.config.ts`
- [ ] `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.postgres-external.test.ts packages/server/src/postgres-external-probe.test.ts packages/cli/src/index.kovo-db.test.ts --config ./vite.config.ts`
- [ ] `pnpm run check:api-surface`
- [ ] `pnpm run check:vp`
- [ ] `pnpm run check:capability-surface-census` (new)
