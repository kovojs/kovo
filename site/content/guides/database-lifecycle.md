---
title: Database lifecycle
description: Start with PGlite, define the schema, seed dev data, and move the same app to reviewed Postgres migrations.
order: 2.1
---

# Database lifecycle

Use this when your app has crossed from "one query" to "real tables and migrations." Start local
with PGlite, keep the schema in Drizzle, and use `kovo db` to move to reviewed Postgres posture.

## Start with PGlite

Local development starts with a real SQL engine and no external service:

```ts
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

export async function createDb() {
  const client = new PGlite('.kovo/pglite');
  await client.waitReady;
  return drizzle({ client });
}
```

The default starter path stores that database under `.kovo/pglite` unless you override it with
`KOVO_DATA_DIR`.

## Define the schema

Keep domain ownership on the table definition:

```ts
import { kovo } from '@kovojs/drizzle';
import { integer, pgTable, text } from 'drizzle-orm/pg-core';

export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    stock: integer('stock').notNull(),
  },
  kovo({ domain: 'product' }),
);
```

That domain annotation is what lets the rest of the framework connect writes to query refreshes.

## Seed dev data

The examples keep seeding simple: create the tables, then insert the rows you want to demo:

```ts
export const SCHEMA_DDL = `
  create table if not exists products (
    id text primary key,
    name text not null,
    stock integer not null
  );
`;

export const SEED_PRODUCTS = `
  insert into products (id, name, stock)
  values ('p1', 'Aero Wireless Keyboard', 5);
`;
```

Run the DDL once, then seed the rows your local app needs. The commerce and CRM examples use this
same pattern for fast demo data.

## Generate and run migrations

Once the schema stops being throwaway, move to reviewed SQL files:

```sh
kovo db generate --schema src/schema.ts --migrations migrations
kovo db migrate --schema src/schema.ts --driver pglite --data-dir .kovo/pglite --migrations migrations
```

`generate` writes additive `*.sql` files you review. `migrate` applies them and records whether
each file was applied or skipped.

## Move to Postgres

When the app needs the real runtime posture, switch the URLs instead of rewriting the app:

```sh
KOVO_ADMIN_DATABASE_URL=postgres://admin@db:5432/app?sslmode=verify-full \
KOVO_RUNTIME_DATABASE_URL=postgres://app@db:5432/app?sslmode=verify-full \
kovo db provision --schema src/schema.ts --migrations migrations
```

Use the admin URL for setup and only as a check fallback, never in the app process. Give the live
app the ordinary runtime URL plus a dedicated `KOVO_DB_SYSTEM_URL` for framework replay/auth
storage. Your DBA can pre-create `kovo_system` as a least-privilege login; provision adopts it and
installs its exact grants. `kovo db check` prefers that system authority. Reader and writer roles
default to `kovo_reader` and `kovo_writer`, or you can override them with
`KOVO_DB_READER_ROLE` and `KOVO_DB_WRITER_ROLE`.

Every Postgres URL must explicitly name its login, database, and decimal port. Remote URLs must use
a DNS hostname and exact `sslmode=verify-full`; Kovo refuses IP literals, every query user/database
override, remote query host/port overrides, weaker TLS modes, and ambient `PG*` destination or
identity fallback before it opens a pool. This keeps credentials off plaintext or
certificate-unverified connections. Only exact `127.0.0.1`, an exact query-host `::1`, and validated
Unix-socket URLs may omit TLS for local development. Write the IPv6 control as
`postgres://app@localhost:5432/app?host=%3A%3A1`; bracketed authority `[::1]` is rejected because
pinned `pg` passes those brackets to DNS. Express a Unix socket as a URL with explicit identity and
port, for example
`postgres://app@localhost:5432/app?host=%2Fvar%2Frun%2Fpostgresql`.

## Check the posture

Make the live database prove it matches the schema and grants:

```sh
KOVO_DB_SYSTEM_URL=postgres://kovo_system@db:5432/app?sslmode=verify-full \
KOVO_RUNTIME_DATABASE_URL=postgres://app@db:5432/app?sslmode=verify-full \
kovo db check --schema src/schema.ts
```

On a healthy database the command reports `STATUS ok` with `issues=0`. On an empty or drifted
database it fails closed with a posture report instead of guessing. The check also proves both URLs
reach the same database on the same writable primary. Use `KOVO_ADMIN_DATABASE_URL` instead when a
deployment cannot expose a dedicated system login to CI.

## Handle failure

The common failures are operational:

- `check` against an unprovisioned database fails.
- `migrate` rejects a changed migration file instead of silently reapplying it.
- `provision` fails when the admin URL or roles are wrong for the target database.

Treat those as contract failures between schema, migrations, and the live database. Fix the drift.
Do not edit history out from under an applied migration.

## Next

- [Postgres authz policy](/guides/postgres-authz-policy/) — see the runtime posture the DB commands install.
- [Configuration & environment](/guides/configuration-environment/) — keep the DB URLs and roles straight across environments.

<details>
<summary>Spec & diagnostics</summary>

`kovo db` behavior and env precedence: `packages/cli/src/commands/db.ts` and
`packages/cli/src/commands-manifest.ts`. PGlite/Postgres runtime config and default role names:
`packages/server/src/postgres-runtime.ts`. Example seed patterns: `examples/commerce/src/db.ts`,
`examples/crm/src/db.ts`, and `examples/crm/src/demo-data.ts`. The posture and migration failure
family is the KV433 set surfaced by `kovo db check`, `provision`, and `migrate`.

API reference: [@kovojs/drizzle](/api/drizzle/).

</details>
