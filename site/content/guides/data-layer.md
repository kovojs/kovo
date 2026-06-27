---
title: Domains, writes & data access
description: Route every write through a domain, let invalidation derive from the SQL you actually run, and grow from a plain in-memory store to real Drizzle without rewiring.
order: 1.5
---

# Domains, writes & data access

Use this guide when a mutation needs to change data. Put the write behind a domain first. Kovo can
then connect that write to the queries that read the same domain, whether the backing store is a
plain object, PGlite, SQLite, or hosted Postgres.

## Declare a domain and its writes

A domain is an invalidation identity. In ordinary app source the compiler derives that identity from
the exported binding and module path. Queries read it; mutations write it. Start with one domain and
one insert:

```ts
import { domain, write } from '@kovojs/server';
import { cartItems } from './schema.js';

export const cart = domain();
export const addItem = write({
  key: 'cart/add-item',
  touches: [cart],
  run: (db, productId: string, qty: number) => db.insert(cartItems).values({ productId, qty }),
});
```

You never call `invalidate()` here. Calling `addItem` is the invalidation declaration. With a plain
store or an opaque helper, `touches` is the explicit promise. On the Drizzle path, Kovo can extract
the touched table from the SQL and map it back to a domain.

## Share a domain name deliberately

Use `domain()` and `tag()` for ordinary app declarations. Their names come from the exported binding
and module path, so a local rename is visible to the compiler and the graph.

Reach for an explicit string only when the name is shared vocabulary outside one declaration. A
billing adapter, a generated schema bridge, or a package boundary may need several files to speak the
same invalidation word:

```ts
export const billing = domain('billing');
export const invoice = tag('billing:invoice');
```

If one module owns the concept, keep the string out of source. If several modules intentionally share
the concept, make the shared name short, stable, and reviewed like an external API.

## The `db.<domain>.<write>` access shape

Handlers never reach for raw tables. They go through the domain namespace on the request's `db`, so
the call site reads as "this mutation writes to the cart":

```ts
import { mutation, s } from '@kovojs/server';

export const addToCart = mutation({
  input: s.object({ productId: s.string(), quantity: s.number().int().min(1).default(1) }),
  handler(input, request) {
    // writes go through the domain layer: `request.db.cart.add(...)`, never
    // `request.db.insert(...)` in the handler body.
    return request.db.cart.add(input);
  },
});
```

This is the rule, not a style preference. Direct `insert`/`update`/`delete` in a mutation handler
triggers the raw-db access lint. The lint pushes the write into a domain where the static pass can
summarize it and the invalidation graph stays honest. The handler decides _whether_ and _what_ to
write; the domain write decides _how_, in one analyzable place.

## Manual `touches`: the explicit escape hatch

When a write does something the static pass can't follow — raw SQL, a CTE, a helper that lives in
`node_modules` — you declare its touch set by hand, and a runtime check confirms the declaration is
complete:

```ts
export const merge = write({
  key: 'cart/merge',
  touches: ['cart'], // REQUIRED here: the body is statically un-analyzable
  run: async (db /* … */) => {
    await db.execute(sql`/* gnarly CTE the analyzer can't read */`);
  },
});
```

A statically un-analyzable write site without `touches` is rejected. The declaration isn't taken on
faith: at test and dev time the verifier parses every executed statement and enforces
`observed ⊆ static ∪ declared`. Declare a domain the write never touches and you get a warning;
touch a domain you didn't declare and you get an error. See [testing](/guides/testing/) for running
the verifier.

Copyable rule: **never interpolate request, form, or query data into SQL text**. Use Drizzle
builders or `sql\`\`` placeholders so scalar values bind as parameters, and use typed allowlists or
schema facts for identifiers and sort directions.

## Keep raw db access out of handlers

The raw-db access lint keeps the touch graph trustworthy. If handlers could call `db.insert(...)`
directly, every handler would be a write site the static pass would have to chase, and a forgotten
one would silently render stale UI. Routing through `db.<domain>.<write>` means:

- there is exactly one analyzable place per logical write,
- the handler stays about decisions (`fail('OUT_OF_STOCK')`, branching), not SQL,
- and the invalidation set is derived from the write's body, not re-declared at each call.

The lint is not a hard error, but treat it as load-bearing. Suppressing it moves a write out of the
analyzed set, and the verifier will flag the resulting `observed ⊄ static` violation as a CI failure
anyway.

## Start with a plain store

You do not need a database to start. A plain in-memory object satisfies the same write contract — the
handler calls a domain write, the write mutates the store, and you declare `touches` by hand because
there's no SQL for the analyzer to read:

```ts
// in-memory store — fine for a prototype or a fixture
interface Store {
  cartItems: { productId: string; qty: number }[];
  products: Map<string, { id: string; stock: number }>;
}

export const addItem = write({
  key: 'cart/add-item',
  touches: [cart, product], // declared by hand: no SQL to extract from
  run: (store: Store, productId: string, qty: number) => {
    const existing = store.cartItems.find((i) => i.productId === productId);
    if (existing) existing.qty += qty;
    else store.cartItems.push({ productId, qty });
    const p = store.products.get(productId);
    if (p) p.stock -= qty;
  },
});
```

Everything above the data access — queries, components, mutations, optimistic transforms, the
`kovo explain` graph — works identically. The only thing the plain store gives up is automatic touch
extraction: every write is an explicit-touch site, so you carry the `touches` lists by hand and the
runtime verifier still holds you to them. That's the trade you retire by moving to Drizzle.

## The Drizzle path: invalidation extracted from real SQL

On the Drizzle-on-Postgres path, the `kovo({ domain, key })` annotation on each table is what lets the
compiler stop trusting your hand-written `touches` and start deriving them from the SQL you actually
write. You annotate each table once, in the schema:

```ts
// schema.ts — verified against examples/commerce/src/schema.ts
import { kovo } from '@kovojs/drizzle';
import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core';

export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    stock: integer('stock').notNull(),
    unitPrice: integer('unit_price').notNull(),
  },
  kovo({ domain: 'product', key: 'id' }), // row-level invalidation key
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: serial('id').primaryKey(),
    productId: text('product_id').notNull(),
    qty: integer('qty').notNull(),
    unitPrice: integer('unit_price').notNull(),
  },
  kovo({ domain: 'cart', key: 'id' }),
);

export const orders = pgTable(
  'orders',
  {
    id: text('id').primaryKey(),
    productId: text('product_id').notNull(),
    qty: integer('qty').notNull(),
    total: integer('total').notNull(),
    userId: text('user_id').notNull(),
  },
  kovo({ domain: 'order', key: 'id' }),
);
```

`kovo({ domain })` groups a table into a logical domain; `key` makes invalidation row-level so a write
to `product p1` refreshes `product:p1`, not every product on the site. A table with no annotation
defaults to a same-named domain. The table annotation also carries the security and concurrency facts
Kovo needs later: `owner`, `governed`, `secret`, `confidentialAtRest`, `atomic`, `version`, and
`fans`. Use `{ exempt: true }` only for tables that no query reads. Views use the separate
`kovo({ view })` form.

With the schema annotated, the `touches` on a Drizzle write become redundant. The static pass rests on
one property — **Drizzle's table argument is always an imported identifier with a known declaration
site** — so it follows each `insert`/`update`/`delete` back to its `pgTable`, reads the `kovo` domain
off it, and traces eq-predicates in the `.where()` to a write argument for the row key:

```ts
// generated/touch-graph.ts — generated, DO NOT EDIT
export const touchGraph = {
  'cart.addItem': {
    touches: [
      { domain: 'cart', via: 'cart_items', site: 'cart.domain.ts:8', keys: null },
      { domain: 'product', via: 'products', site: 'cart.domain.ts:12', keys: 'arg:productId' },
    ],
    unresolved: [],
  },
} as const;
```

This file is committed, so adding a write to a mutation shows up as a changed invalidation set in the
same PR. Because invalidation now derives from the SQL that runs, the classic staleness bug — adding a
join to a query and forgetting to invalidate the joined table — can't happen: the read set comes from
the query expression, not from memory.

## Choose a scaffold dialect

Postgres remains the default scaffold and reference path. The starter uses PGlite through
`@electric-sql/pglite` and `drizzle-orm/pglite`, with tables from `drizzle-orm/pg-core`, so tests run
against real Postgres semantics in-process. Hosted Postgres is a driver swap to
`drizzle-orm/node-postgres`.

SQLite is an opt-in scaffold dialect:

```sh
create-kovo my-app --dialect sqlite
```

The SQLite starter uses `better-sqlite3` through `drizzle-orm/better-sqlite3`, with tables from
`drizzle-orm/sqlite-core`. Kovo's dataflow analysis is dialect-independent where it follows Drizzle
table identity, domain annotations, query/mutation structure, and Better Auth schema bridge
metadata. Dialect-specific handling stays pinned to the table factory, database type, column
builders, and runtime SQL parser/observation surface.

### SQLite type mapping

SQLite has dynamic storage classes, so the scaffold uses explicit Drizzle modes where Kovo needs
stable shape facts:

| App shape | SQLite scaffold mapping                                     |
| --------- | ----------------------------------------------------------- |
| Boolean   | `integer('field', { mode: 'boolean' })`                     |
| JSON      | `text('field', { mode: 'json' })` when app code adds JSON   |
| Timestamp | ISO text columns, not Postgres `timestamp()`/`defaultNow()` |
| DDL now   | `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`                     |

Better Auth follows the same mapping in generated SQLite schema source, and its Drizzle adapter is
configured with `provider: 'sqlite'`. The blessed scaffolded drivers are PGlite for Postgres and
`better-sqlite3` for SQLite; LibSQL/Turso, SQL.js, and Bun SQLite may be recognized by analyzer
stages, but they are not starter defaults.

## Provision and evolve the schema

PGlite examples can create their schema at startup because they are in-process fixtures. A persistent
Postgres database needs an operator-owned schema step before the app starts serving traffic:

```ts
await pool.query(`
  CREATE TABLE IF NOT EXISTS cart_items (
    id serial PRIMARY KEY,
    product_id text NOT NULL,
    qty integer NOT NULL
  )
`);
```

Kovo does not scaffold `drizzle-kit`, `drizzle.config.ts`, or a migrations folder. The runtime
database is ordinary Drizzle, so you can add drizzle-kit yourself, use a managed migration service,
or keep hand-written DDL checked into your app. The important part is operational: run migrations
before the new app version receives requests, and keep the Drizzle schema source in lockstep with
the database objects those migrations create.

Treat schema changes like deploys, not like request-time work. Add nullable or defaulted columns
before code reads them, backfill separately when needed, then tighten constraints in a later deploy.
When you rename a table, column, domain, or row key, update the Drizzle schema and re-run the Kovo
checks so query reads, write touches, typed links, and optimistic transforms move together.

## Protect single-row counters

When one row carries a contested fact such as stock, mark that fact in the schema:

```ts
export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    stock: integer('stock').notNull(),
    version: integer('version').notNull(),
  },
  kovo({ domain: 'product', key: 'id', atomic: 'stock', version: 'version' }),
);
```

A write that subtracts from `stock` should include the check in the same `UPDATE ... WHERE` statement.
Guard either the `atomic` column itself or a declared `version` column that the statement increments:

```ts
import { compareAndSet } from '@kovojs/drizzle';
import { StaleVersionError } from '@kovojs/server';
import { and, eq, sql } from 'drizzle-orm';

const cas = await compareAndSet(
  db
    .update(products)
    .set({ stock: sql`${products.stock} - ${qty}`, version: sql`${products.version} + 1` })
    .where(and(eq(products.id, id), eq(products.version, input.version))),
);
if (!cas.ok) throw new StaleVersionError();
```

A stale version is a typed conflict, so the client can refetch fresh query truth and retry. Ordinary
business validation, such as "only two are available," stays a declared form error. This check is
single-row by design. Multi-row reservations, uniqueness across ranges, and cross-table invariants
belong to database constraints, transaction isolation, locks, or a reservation table.

## Set up Drizzle over Postgres or SQLite

The runtime `db` is ordinary Drizzle. The commerce reference app runs on real Postgres semantics
in-process via PGlite, the same engine the [test harness](/guides/testing/) uses:

```ts
// db.ts — verified against examples/commerce/src/db.ts
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';

export type CommerceDb = PgliteDatabase;

export function createCommerceDb(): CommerceDb {
  const client = new PGlite();
  void client.exec(SCHEMA_DDL); // PGlite runs operations FIFO, so DDL lands first
  void client.exec(SEED_PRODUCTS);
  return drizzle({ client });
}
```

Swapping PGlite for a hosted Postgres is a driver change — `drizzle({ client: pool })` over
`drizzle-orm/node-postgres` — with the schema, domains, writes, queries, and the entire derived graph
unchanged. The request shell resolves the `db` provider once per request before any guard runs.

A SQLite scaffold has the same Kovo shape with the SQLite driver and schema core:

```ts
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type AppDb = BetterSQLite3Database<typeof schema>;

export function createAppDb(filename = ':memory:'): AppDb {
  const client = new Database(filename);
  return drizzle({ client, schema });
}
```

## What carries over from store to Drizzle

The progression is additive — moving from a plain store to Drizzle changes only the data access, and
in exchange the compiler takes over work you were doing by hand:

| Concern               | Plain store                    | Drizzle path                                   |
| --------------------- | ------------------------------ | ---------------------------------------------- |
| Domains & writes      | `domain(...)` / `write(...)`   | identical                                      |
| Handler access        | `db.<domain>.<write>`          | identical                                      |
| Touch set             | hand-declared `touches`        | extracted from SQL via `kovo({ domain, key })` |
| Row-level keys        | not available                  | `key` annotation → `product:p1`                |
| Runtime verification  | `observed ⊆ static ∪ declared` | same invariant, fewer manual declarations      |
| Optimistic derivation | hand-written transforms only   | compiler can derive from the SQL shape         |

The handler you wrote against the store keeps working; you delete `touches` lines as the analyzer
takes over, and the verifier confirms nothing slipped.

## Next

- [Queries & invalidation](/guides/queries/) — the read side: `reads`, instance keys, and stamps.
- [Mutations & forms](/guides/mutations/) — the request lifecycle around a write.
- [Optimistic updates](/guides/optimistic/) — transforms derived from the same SQL shape.
- [Testing](/guides/testing/) — running the `observed ⊆ static ∪ declared` verifier.
- [Installation](/getting-started/installation/) — scaffold options, including `--dialect sqlite`.

<details>
<summary>Spec & diagnostics</summary>

Domains, writes, and the guard chain: SPEC §10.3. Schema as domain registry and the `kovo({ domain,
key, owner, governed, secret, confidentialAtRest, atomic, version, fans })`, `kovo({ exempt })`, and
`kovo({ view })` annotations: SPEC §10.1 and `packages/drizzle/src/drizzle-surface.ts`. Dialect
support and SQLite type mapping are mirrored from `docs/data-layer-dialects.md`. Touch-set extraction
from Drizzle SQL and the committed `touch-graph.ts`: SPEC §11.1. Runtime cross-check
`observed ⊆ static ∪ KV406-declared`: SPEC §11.2. Direct db access in a handler is **KV330**; a
statically un-analyzable write needs manual `touches` or it is **KV406**; a write touching an
undeclared domain is **KV402**, a declared-but-never-written domain is **KV403**, a write to an
unmapped table is **KV404**, and an `exempt` table read by a query is **KV411** (SPEC §10.1, §11.3).
Single-row lost-update gates: SPEC §10.1 and §10.3; missing compare-and-set on
`kovo({ atomic, version })` is **KV429**. The `db` provider and per-request resolution: SPEC §9.5.

</details>
