# SQLite Support

Add SQLite as a second blessed Drizzle dialect alongside Postgres, so an app can be authored against
`sqliteTable` + a SQLite Drizzle database and still get the full Kovo guarantee surface (touch-graph
extraction, runtime cross-check, derived query shapes/keys, optimism).

`SPEC.md` §10 (data plane) and §11 (static analysis & verification) are normative.
`rules/data-layer-policy.md` is the standing adapter policy.
This ledger tracks the dialect-portability work; it extends `plans/data-layer-roadmap.md` (the v1
blessed adapter shipped Postgres-only).

## Why this is mostly an implementation change, not a SPEC change

- `SPEC.md` §11.1 (line 1206) already states the static pass keys on **"receiver's TYPE originates in
  drizzle-orm — type identity, not variable names"**, and names `pgTable` only as the "90%+" example
  (lines 1201, 1209). The normative property is dialect-agnostic; today's *implementation* hardcodes
  Postgres.
- `rules/data-layer-policy.md` already frames Kovo core as "a capability interface, not a portability
  promise" with `@kovojs/drizzle` as a "pinned, conformance-tested subset of Drizzle's surface." Adding
  SQLite means widening that pinned subset, not changing the contract.
- The one normative Postgres mention that must be revisited is `SPEC.md` §11.2 (line 1254): runtime
  cross-check parses observed SQL with **`pgsql-ast-parser`**. SQLite needs either a compatible parser
  path or a documented dialect-aware parser seam (see Stage D + Risks).
- `packages/drizzle/src/static.ts:2461-2463` already carries the marker: *"project receiver proof is
  restricted to known Postgres Drizzle database types. SQLite/MySQL conformance is deferred to late
  hardening."* This plan is that hardening for SQLite.

## Decisions (defaults — adjustable)

- **Blessed SQLite driver(s):** recognize the Drizzle SQLite database type names
  `BaseSQLiteDatabase`, `LibSQLDatabase`, `BetterSQLite3Database`, `SQLJsDatabase`, `BunSQLiteDatabase`.
  Default the **scaffold + harness** to `better-sqlite3` (synchronous, mirrors today's PGlite sync
  ergonomics in `packages/create-kovo/templates/src/db.ts`). LibSQL/Turso recognized but not scaffolded
  in v1.
- **Dialect is per-app, not per-table.** One app authors against one dialect. The analyzer accepts
  either dialect's surface by type identity and need not be told which app is which — detection stays
  structural.
- **Postgres stays the default dialect everywhere** (scaffold, examples, docs). SQLite is opt-in.
- **No new migration system.** Migrations remain author-owned DDL, exactly as today (raw DDL strings in
  `db.ts`/test fixtures). SQLite DDL differs (no `serial`, no `now()`, `integer` PK rowid); the SQLite
  scaffold supplies SQLite DDL.

## Stages

### Stage A — Dialect surface allowlist (`@kovojs/drizzle`)

The central seam. `packages/drizzle/src/drizzle-surface.ts` is the single allowlist file.

- [x] **Widen database-type and table-factory allowlists.**
      `drizzle-surface.ts:1` `DRIZZLE_TABLE_FACTORY_NAMES` (`{'pgTable'}`) → add `sqliteTable`.
      `drizzle-surface.ts:3-8` `DRIZZLE_DATABASE_TYPE_NAMES` → add the SQLite database type names above.
      `isDrizzleDatabaseTypeName`/`isDrizzleTableFactoryName` (`drizzle-surface.ts:99-105`) read these.
      - Evidence: `pnpm exec vitest --run packages/drizzle/src/index.serialization.test.ts` verifies all
        blessed SQLite database type names resolve as Drizzle receivers; `drizzle-surface.ts` now lists
        `sqliteTable`.
- [x] **Decide whether the `kovo()` annotation surface (`KovoColumnRef`, `KovoTableAnnotation`, view
      annotation) is fully dialect-agnostic** (it appears to be — `drizzle-surface.ts:19-122` references
      no pg type), and record that the annotation is shared verbatim across dialects.
      - Evidence: `packages/drizzle/src/drizzle-surface.ts` annotation types remain unchanged and still
        reference no dialect-specific Drizzle type.

### Stage B — Static analyzer dialect-awareness (`packages/drizzle/src/static.ts`)

Several checks hardcode `drizzle-orm/pg-core` and pg column-builder/relation-factory names. Make each
recognize the SQLite equivalents (`drizzle-orm/sqlite-core`) so extraction, column typing, and view
detection work for SQLite tables.

- [x] **Module-specifier checks accept `drizzle-orm/sqlite-core`.** `static.ts:3285, 3294, 3326, 3340,
      3348` (and the namespace-import / import-specifier / export-specifier resolvers around
      `isDrizzlePgCoreNamespaceMember` and `projectPgCoreIdentifierExportName`) currently equal-check
      `'drizzle-orm/pg-core'`. Replace with a dialect-core matcher (`pg-core` | `sqlite-core`).
      - Evidence: `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts
        packages/drizzle/src/index.query-shapes.test.ts packages/drizzle/src/index.serialization.test.ts`
        verifies imported `sqlite-core` table, column, view, and database symbols.
- [x] **Column-builder classification is dialect-aware.** `static.ts:97-99` + `3091-3093` classify
      `boolean`→bool, `json`/`jsonb`→object, number builders. SQLite has **no** `boolean`/`json`/
      `timestamp`/`serial` builders — booleans are `integer(col,{mode:'boolean'})`, JSON is
      `text(col,{mode:'json'})`, numbers are `integer`/`real`. Add mode-aware classification for the
      SQLite `text`/`integer` builders so query-shape inference (KV302/KV410) stays correct.
      - Evidence: `packages/drizzle/src/index.columns-keys-predicates.test.ts` verifies
        `integer(...,{ mode: "boolean" })` as `boolean` and `text(...,{ mode: "json" })` as object.
- [x] **Unmodeled-relation (view) factories.** `static.ts:112` `DRIZZLE_UNMODELED_RELATION_FACTORY_NAMES`
      (`pgMaterializedView`, `pgView`) — SQLite has `sqliteView` and **no** materialized view. Add
      `sqliteView` (view kind only); ensure `static.ts:2624-2629` view/materialized-view discrimination
      handles the SQLite case.
      - Evidence: `packages/drizzle/src/index.query-shapes.test.ts` verifies `sqliteView` contributes a
        normal view read set without materialized-view diagnostics.
- [x] **Receiver-proof type identity.** Confirm `isDrizzleDatabaseType` /
      `drizzleDatabaseTypeNames` (`static.ts:2472-2504`) resolve `BaseSQLiteDatabase` base types the
      same way they resolve `PgDatabase` (base-type walk + `drizzle-orm` declaration origin). Flip the
      `static.ts:2461-2463` "deferred to late hardening" comment to reflect SQLite support.
      - Evidence: `packages/drizzle/src/index.serialization.test.ts` verifies `BaseSQLiteDatabase`,
        `LibSQLDatabase`, `BetterSQLite3Database`, `SQLJsDatabase`, and `BunSQLiteDatabase`.
- [x] **Audit remaining `pg`-named identifiers in `static.ts`** for any other hardcoded factory/type
      assumption (e.g. `IGNORED_LOCAL_CALL_NAMES`, parameterized-key `eq(...)` extraction — dialect-
      independent, but verify).
      - Evidence: `rg -n "projectPgCore|isDrizzlePgCore|pgCore|drizzle-orm/pg-core"
        packages/drizzle/src/static.ts` shows only the dialect-core allowlist entry remains.

### Stage C — Conformance fixtures (`packages/conformance-fixtures`, `packages/drizzle` tests)

Per `rules/data-layer-policy.md`: "the suite must fail loudly on API drift." Mirror the Postgres
conformance corpus for SQLite so dialect drift is caught.

- [x] **Add SQLite touch-graph / source / verification fixtures** alongside the pg fixtures in
      `packages/conformance-fixtures/src/*` (`touch-graph-fixtures.test.ts`, `source-fixtures.ts`,
      `verification-fixtures.ts`) — at minimum: a `sqliteTable` domain with `kovo()`, a write+query pair,
      a boolean-mode and json-mode column, and a `sqliteView`.
      - Evidence: `pnpm exec vitest --run packages/conformance-fixtures/src/source-fixtures.test.ts
        packages/conformance-fixtures/src/touch-graph-fixtures.test.ts
        packages/conformance-fixtures/src/verification-fixtures.test.ts` verifies SQLite source,
        touch/read, mode, view, prepared-statement, and libsql-style verifier coverage.
- [x] **Add `@kovojs/drizzle` unit coverage** for SQLite database-type receiver proof and SQLite
      column-builder classification (new cases beside the existing pg cases in the drizzle package tests).
      - Evidence: `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts
        packages/drizzle/src/index.query-shapes.test.ts packages/drizzle/src/index.serialization.test.ts`
        passed with SQLite receiver, mode, and view cases.

### Stage D — Runtime verification cross-check (`packages/test`)

`SPEC.md` §11.2: observed SQL is parsed and checked against the static set. Today the parser and db
handle are Postgres-specific.

- [x] **SQL parser dialect seam.** `packages/test/src/verifier-sql.ts` hardcodes `pgsql-ast-parser`
      (`parseSqlOperations`, `verifier-sql.ts:26`). Investigate whether Drizzle-emitted SQLite SQL
      parses cleanly under `pgsql-ast-parser`; if not, introduce a dialect-aware parser seam (separate
      SQLite parser or a normalization shim). Record the decision + which SQLite syntaxes (e.g.
      `INSERT … ON CONFLICT`, `RETURNING`, `?`-placeholders) are covered.
      - Evidence: `packages/test/src/verifier-sql.test.ts` verifies dialect-selected SQLite placeholder
        normalization through `INSERT ... ON CONFLICT`, subquery reads, and `RETURNING`.
- [x] **DB-handle recognition.** `packages/test/src/verifier.ts:117, 238` sniff a `pglite` property to
      find the SQL handle. Add SQLite-driver handle recognition (better-sqlite3 / libsql) so the wrapper
      can observe executed statements.
      - Evidence: `packages/test/src/verifier.test.ts` verifies better-sqlite3-style prepared statement
        observation and libsql-style `execute` observation.
- [x] **SQLite test harness.** Add a `createSqliteTestDb()` beside `packages/test/src/pglite.ts`, and
      let the harness (`packages/test/src/harness.ts`) accept a SQLite db. Update `verifier-observation`
      strategy if the observation hook differs.
      - Evidence: `packages/test/src/sqlite-harness.test.ts` verifies `createSqliteTestDb()` in the
        Kovo test harness with `sqlDialect: "sqlite"`.
- [x] **SPEC §11.2 note.** Update line 1254 to state the parser is dialect-selected (pg vs. sqlite),
      keeping the `observed ⊆ static ∪ KV406` invariant dialect-independent.
      - Evidence: `SPEC.md` §11.2 now describes dialect-selected parsing while preserving the invariant.

### Stage E — Scaffold, examples, auth bridge, docs

- [x] **SQLite scaffold variant.** `packages/create-kovo/templates/src/db.ts` + `schema.ts` are
      Postgres-only (`PGlite`, `drizzle-orm/pglite`, `pgTable`, `pg-core`, `defaultNow()`, `boolean`,
      `timestamp`). Provide a SQLite template set (better-sqlite3, `sqliteTable`, `sqlite-core`,
      `integer({mode:'boolean'})`, text timestamps) and a `create-kovo` flag/prompt selecting the
      dialect. Keep Postgres default.
      Evidence: `pnpm exec vitest run packages/create-kovo/src/index.test.ts` proves Postgres remains
      default, `--dialect sqlite` emits the SQLite scaffold, and both generated default and SQLite apps
      typecheck.
- [x] **Better Auth bridge.** `packages/better-auth` emits `pgTable` schema (e.g.
      `index.schema-materialize.test.ts`, `index.schema-bridge.test.ts`) and the template passes
      `drizzleAdapter(appDb,{provider:'pg'})` (`templates/src/auth.ts:80`). Add SQLite emission
      (`sqliteTable`, `provider:'sqlite'`) for the SQLite scaffold.
      Evidence: `pnpm --filter @kovojs/better-auth exec vitest run src/index.schema-materialize.test.ts`
      proves generated SQLite Better Auth schema uses `sqliteTable`, boolean integer mode, and text
      timestamps; `pnpm exec vitest run packages/create-kovo/src/index.test.ts` proves the SQLite
      scaffold passes `provider:'sqlite'`.
- [x] **Example (optional).** Decide whether to add a SQLite example or convert one; default is to keep
      `examples/commerce` on Postgres and add a small SQLite example only if it pays for itself.
      Evidence: Kept `examples/commerce` on Postgres; `packages/create-kovo/src/index.test.ts` covers
      the generated SQLite app instead of adding a second committed example.
- [x] **Docs.** Document the supported dialects, the blessed driver list, which analyses are universal
      vs. dialect-specific, and the SQLite type-mapping caveats (boolean/json/timestamp).
      Evidence: `docs/data-layer-dialects.md`.

### Stage F — Policy & roadmap reconciliation

- [x] **`rules/data-layer-policy.md`** — record SQLite as a blessed dialect and the widened pinned
      Drizzle surface (factories, db types, column-builder modes).
      Evidence: `rules/data-layer-policy.md`.
- [x] **`plans/data-layer-roadmap.md`** — cross-link this plan; note the v1 blessed adapter is now
      multi-dialect.
      Evidence: `plans/data-layer-roadmap.md`.
- [x] **`rules/api-surface.md` / `rules/accessibility-conformance.md`** as applicable if any public
      export shape changes (Stage A widens runtime exports only if new symbols are exported — confirm).
      Evidence: `public-packages.json` classifies `@kovojs/test/sqlite`; `pnpm run check:api-surface`
      and `pnpm run check:publish` passed in the runtime slice.

## Open risks / unknowns

- **SQLite SQL parser seam.** Implemented as dialect-selected SQLite placeholder normalization before
  the existing structural parser. Covered syntax includes `?`/`?NNN` placeholders, `INSERT ... ON
  CONFLICT`, mutation subquery reads, and `RETURNING`.
- **Column-type mapping fidelity.** SQLite's dynamic typing + mode-based booleans/JSON means query-shape
  inference (KV302/KV410 runtime shape verification, §11.2) must map modes correctly or shapes will
  mismatch at runtime. Covered by Stage B + Stage C fixtures.
- **SQLite trigger/cascade side effects.** Explicit SQLite SQL/prepared statements are observed; the
  better-sqlite3 synchronous handle does not participate in the async row-count side-effect backstop.

## Suggested sequencing

1. Spike Stage D's parser question (de-risks scope).
2. Stage A (allowlist) + Stage B (analyzer) together — the core enablement.
3. Stage C fixtures to lock the surface against drift.
4. Stage D harness + Stage E scaffold/auth.
5. Stage F policy/roadmap reconciliation.

## Latest Verification

- `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts packages/drizzle/src/index.query-shapes.test.ts packages/drizzle/src/index.serialization.test.ts`
- `pnpm exec vitest --run packages/conformance-fixtures/src/source-fixtures.test.ts packages/conformance-fixtures/src/touch-graph-fixtures.test.ts`
- `pnpm exec vitest --run packages/conformance-fixtures/src/verification-fixtures.test.ts`
- `pnpm vitest --run packages/test/src`
- `pnpm --filter @kovojs/test run build:dist`
- `pnpm exec vitest run packages/create-kovo/src/index.test.ts` — scaffold metadata, default Postgres
  emission, SQLite emission, and generated Postgres/SQLite app typechecks.
- `pnpm --filter @kovojs/better-auth exec vitest run src/index.schema-materialize.test.ts` — Better
  Auth generated schema materialization, including SQLite table factory and type mapping.
- `pnpm run check:api-surface`
- `pnpm run check:publish`
- `git diff --check` — whitespace check for the current Stage E/F slice.
