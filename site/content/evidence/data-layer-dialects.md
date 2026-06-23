---
title: Data-layer dialects
description: Supported Drizzle dialects, blessed drivers, and the SQLite type-mapping caveats.
order: 2
---

# Data-layer dialects

Kovo's data-plane contract comes from SPEC section 10 and section 11: queries and writes are checked
through domains, table identity, static graph extraction, and runtime verification. The public
[data-layer guide](/guides/data-layer/) teaches the common path. This note records the dialect
boundary from [`docs/data-layer-dialects.md`](https://github.com/kovojs/kovo/blob/main/docs/data-layer-dialects.md).

## Supported dialects

Postgres remains the default scaffold and reference path. The starter uses PGlite through
`@electric-sql/pglite` and `drizzle-orm/pglite`, with tables from `drizzle-orm/pg-core`.

SQLite is an opt-in scaffold dialect:

```sh
create-kovo my-app --dialect sqlite
```

The SQLite starter uses `better-sqlite3` through `drizzle-orm/better-sqlite3`, with tables from
`drizzle-orm/sqlite-core`.

## What is universal

Kovo's analysis is dialect-independent where it follows Drizzle table identity, `kovo({ domain,
key })` annotations, query/mutation structure, and Better Auth schema bridge metadata. The app model
is the same: annotate tables, write queries and mutations, let the graph derive reads/touches, and
run the verifier.

## What is dialect-specific

The pinned dialect surface is the table factory, database receiver type, column builder, and runtime
SQL observation/parser path. SQLite has dynamic storage classes, so the blessed scaffold uses stable
Drizzle modes:

- Booleans: `integer('field', { mode: 'boolean' })`.
- JSON: `text('field', { mode: 'json' })` when app code adds JSON fields.
- Timestamps: ISO text columns rather than Postgres `timestamp()` / `defaultNow()`.
- Defaults: SQLite expressions such as `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`.

Better Auth follows the same mapping in the SQLite scaffold and configures Drizzle with
`provider: 'sqlite'`.
