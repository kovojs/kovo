# Data-Layer Dialects

`SPEC.md` §10 and §11 define the data-plane contract. `rules/data-layer-policy.md`
defines which Drizzle surfaces Kovo pins and tests for that contract.

## Supported Dialects

Postgres remains the default scaffold and reference path. The starter uses
PGlite through `@electric-sql/pglite` and `drizzle-orm/pglite`, with tables from
`drizzle-orm/pg-core`.

SQLite is an opt-in scaffold dialect. The starter uses `better-sqlite3` through
`drizzle-orm/better-sqlite3`, with tables from `drizzle-orm/sqlite-core`.

Kovo's analysis is dialect-independent where it follows Drizzle table identity,
domain annotations, query/mutation structure, and Better Auth schema bridge
metadata. Dialect-specific handling is pinned to the Drizzle table factory,
database type, column builder, and runtime SQL parser/observation surfaces.

## Blessed Drivers

The scaffolded, tested drivers are:

- Postgres: `@electric-sql/pglite` with `drizzle-orm/pglite`.
- SQLite: `better-sqlite3` with `drizzle-orm/better-sqlite3`.

The SQLite static surface is intentionally wider than the scaffold: LibSQL/Turso,
SQL.js, and Bun SQLite database types may be recognized by the analyzer when the
SQLite hardening stages are complete, but they are not starter defaults.

## SQLite Type Mapping

SQLite has dynamic storage classes, so the blessed scaffold uses explicit Drizzle
modes where Kovo needs stable shape facts:

- Booleans: `integer('field', { mode: 'boolean' })`.
- JSON: `text('field', { mode: 'json' })` when app code adds JSON fields.
- Timestamps: ISO text columns, not Postgres `timestamp()` / `defaultNow()`.
- DDL defaults: SQLite expressions such as `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  replace Postgres `now()`.

Better Auth follows the same mapping in generated SQLite schema source and in the
SQLite scaffold: the Drizzle adapter is configured with `provider: 'sqlite'`.
