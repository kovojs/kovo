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
  (lines 1201, 1209). The normative property is dialect-agnostic; today's _implementation_ hardcodes
  Postgres.
- `rules/data-layer-policy.md` already frames Kovo core as "a capability interface, not a portability
  promise" with `@kovojs/drizzle` as a "pinned, conformance-tested subset of Drizzle's surface." Adding
  SQLite means widening that pinned subset, not changing the contract.
- The one normative Postgres mention that must be revisited is `SPEC.md` §11.2 (line 1254): runtime
  cross-check parses observed SQL with **`pgsql-ast-parser`**. SQLite needs either a compatible parser
  path or a documented dialect-aware parser seam (see Stage D + Risks).
- `packages/drizzle/src/static.ts:2461-2463` already carries the marker: _"project receiver proof is
  restricted to known Postgres Drizzle database types. SQLite/MySQL conformance is deferred to late
  hardening."_ This plan is that hardening for SQLite.

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

- [x] **Widen database-type and table-factory allowlists.** `drizzle-surface.ts` now lists
      `sqliteTable` plus the blessed SQLite database type names.
      Evidence: `pnpm exec vitest --run packages/drizzle/src/index.serialization.test.ts`.
- [x] **Decide whether the `kovo()` annotation surface is fully dialect-agnostic.**
      `KovoColumnRef`, table annotations, and view annotations remain shared across dialects.
      Evidence: `packages/drizzle/src/drizzle-surface.ts` references no dialect-specific Drizzle type.

### Stage B — Static analyzer dialect-awareness (`packages/drizzle/src/static.ts`)

Several checks hardcode `drizzle-orm/pg-core` and pg column-builder/relation-factory names. Make each
recognize the SQLite equivalents (`drizzle-orm/sqlite-core`) so extraction, column typing, and view
detection work for SQLite tables.

- [x] **Module-specifier checks accept `drizzle-orm/sqlite-core`.** The pg-core-only helpers are now
      dialect-core helpers for `pg-core` and `sqlite-core`.
      Evidence: `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts packages/drizzle/src/index.query-shapes.test.ts packages/drizzle/src/index.serialization.test.ts`.
- [x] **Column-builder classification is dialect-aware.** SQLite `integer(...,{ mode: "boolean" })`
      maps to boolean and `text(...,{ mode: "json" })` maps to object.
      Evidence: `packages/drizzle/src/index.columns-keys-predicates.test.ts`.
- [x] **Unmodeled-relation (view) factories.** `sqliteView` is recognized as a normal view, not a
      materialized view.
      Evidence: `packages/drizzle/src/index.query-shapes.test.ts`.
- [x] **Receiver-proof type identity.** The receiver proof covers `BaseSQLiteDatabase`,
      `LibSQLDatabase`, `BetterSQLite3Database`, `SQLJsDatabase`, and `BunSQLiteDatabase`.
      Evidence: `packages/drizzle/src/index.serialization.test.ts`.
- [x] **Audit remaining `pg`-named identifiers in `static.ts`.** No old pg-core helper names remain;
      the only `drizzle-orm/pg-core` mention is the dialect-core allowlist entry.
      Evidence: `rg -n "projectPgCore|isDrizzlePgCore|pgCore|drizzle-orm/pg-core" packages/drizzle/src/static.ts`.

### Stage C — Conformance fixtures (`packages/conformance-fixtures`, `packages/drizzle` tests)

Per `rules/data-layer-policy.md`: "the suite must fail loudly on API drift." Mirror the Postgres
conformance corpus for SQLite so dialect drift is caught.

- [x] **Add SQLite touch-graph / source / verification fixtures** alongside the pg fixtures. The fixture
      includes `sqliteTable`, `kovo()`, a write/query pair, boolean/json modes, and `sqliteView`.
      Evidence: `pnpm exec vitest --run packages/conformance-fixtures/src/source-fixtures.test.ts packages/conformance-fixtures/src/touch-graph-fixtures.test.ts packages/conformance-fixtures/src/verification-fixtures.test.ts`.
- [x] **Add `@kovojs/drizzle` unit coverage** for SQLite database-type receiver proof and SQLite
      column-builder classification.
      Evidence: `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts packages/drizzle/src/index.query-shapes.test.ts packages/drizzle/src/index.serialization.test.ts`.

### Stage D — Runtime verification cross-check (`packages/test`)

`SPEC.md` §11.2: observed SQL is parsed and checked against the static set. Today the parser and db
handle are Postgres-specific.

- [x] **SQL parser dialect seam.** SQLite uses dialect-selected placeholder normalization before the
      structural SQL parser; covered syntax includes `INSERT ... ON CONFLICT`, subquery reads,
      `RETURNING`, and `?` placeholders.
      Evidence: `packages/test/src/verifier-sql.test.ts`.
- [x] **DB-handle recognition.** The verifier recognizes better-sqlite3-style prepared statements and
      libsql-style `execute` handles.
      Evidence: `packages/test/src/verifier.test.ts`.
- [x] **SQLite test harness.** `createSqliteTestDb()` exists beside `pglite.ts` and works through the
      Kovo test harness with `sqlDialect: "sqlite"`.
      Evidence: `packages/test/src/sqlite-harness.test.ts`.
- [x] **SPEC §11.2 note.** §11.2 now describes dialect-selected parsing while preserving
      `observed ⊆ static ∪ KV406`.
      Evidence: `SPEC.md`.

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
