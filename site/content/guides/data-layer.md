---
title: Domains, writes & data access
description: Route every write through a domain, let invalidation derive from the SQL you actually run, and grow from a plain in-memory store to real Drizzle without rewiring.
order: 1.5
---

# Domains, writes & data access

Every tutorial chapter that mentions "the database" points here. A query says which domains it reads;
a mutation calls a write that touches those domains; the framework reruns the right queries. The whole
contract is the domain — a named unit of cache currency that connects writes to reads. This guide
shows the write side of that contract, the `db.<domain>.<write>` access shape, and the one progression
that matters: how a plain in-memory store maps onto the real Drizzle path, where invalidation stops
being something you declare and starts being something the compiler extracts from your SQL.

## Declare a domain and its writes

A domain is a name. Queries `read` it; mutations `touch` it. A write is the only place data changes:

```ts
import { domain, write } from '@kovojs/server';
import { eq, sql } from 'drizzle-orm';
import { cartItems, products } from './schema.js';

export const cart = domain('cart');
export const product = domain('product');

// ALL writes flow through here — direct db access in a handler is lint KV330.
export const addItem = write({
  key: 'cart/add-item',
  touches: [cart, product],
  run: async (db, productId: string, qty: number) => {
    await db
      .insert(cartItems)
      .values({ productId, qty })
      .onConflictDoUpdate({
        target: [cartItems.productId],
        set: { qty: sql`${cartItems.qty} + ${qty}` },
      });
    await db
      .update(products)
      .set({ stock: sql`${products.stock} - ${qty}` })
      .where(eq(products.id, productId));
  },
});
```

You never call `invalidate()` here. Calling `addItem` _is_ the invalidation declaration: the static
pass reads the insert/update targets out of the body, maps `cart_items → cart` and `products →
product`, and reruns every query whose `reads` list names those domains (SPEC §10.3, §11.1). The
manual `touches: [cart, product]` above is the explicit form — useful and required when the analyzer
can't see through the write, and the path the next section replaces with extraction.

## The `db.<domain>.<write>` access shape

Handlers never reach for raw tables. They go through the domain namespace on the request's `db`, so
the call site reads as "this mutation writes to the cart":

```ts
import { mutation, s } from '@kovojs/server';

export const addToCart = mutation('cart/add', {
  input: s.object({ productId: s.string(), quantity: s.number().int().min(1).default(1) }),
  handler(input, request) {
    // writes go through the domain layer — `request.db.cart.add(...)`, never
    // `request.db.insert(...)` in the handler body (KV330).
    return request.db.cart.add(input);
  },
});
```

This is the rule, not a style preference. **Direct `insert`/`update`/`delete` in a mutation handler
is KV330** — a lint that pushes the write into a domain where the static pass can summarize it and
the invalidation graph stays honest. The handler decides _whether_ and _what_ to write; the domain
write decides _how_, in one analyzable place.

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

A statically un-analyzable write site without `touches` is **KV406** (SPEC §11.1). The declaration
isn't taken on faith: at test and dev time the verifier parses every executed statement and enforces
`observed ⊆ static ∪ KV406-declared` (SPEC §11.2). Declare a domain the write never touches and you
get **KV403** (a warning — over-invalidation is wasteful but correct); touch a domain you didn't
declare and you get **KV402** (an error — that's the silent-stale-UI bug this whole layer exists to
kill). See [testing](/guides/testing/) for running the verifier.

## The raw-db access ban (KV330)

`KV330` is the lint that keeps the touch graph trustworthy. If handlers could call `db.insert(...)`
directly, every handler would be a write site the static pass would have to chase, and a forgotten
one would silently render stale UI. Routing through `db.<domain>.<write>` means:

- there is exactly one analyzable place per logical write,
- the handler stays about decisions (`fail('OUT_OF_STOCK')`, branching), not SQL,
- and the invalidation set is derived from the write's body, not re-declared at each call.

KV330 is a lint, not a hard error — but treat it as load-bearing. Suppressing it moves a write out of
the analyzed set, and the verifier will flag the resulting `observed ⊄ static` violation as a CI
failure anyway.

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
extraction: every write is effectively a KV406 site, so you carry the `touches` lists by hand and the
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
defaults to a same-named domain. The annotation takes `{ domain, key? }` or `{ exempt: true }` and
nothing else (verified against `@kovojs/drizzle`'s `kovo()` surface).

With the schema annotated, the `touches` on a Drizzle write become redundant. The static pass rests on
one property — **Drizzle's table argument is always an imported identifier with a known declaration
site** — so it follows each `insert`/`update`/`delete` back to its `pgTable`, reads the `kovo` domain
off it, and traces eq-predicates in the `.where()` to a write argument for the row key (SPEC §11.1):

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

## Set up Drizzle over Postgres (or PGlite)

The runtime `db` is ordinary Drizzle. The commerce reference app runs on real Postgres semantics
in-process via PGlite, the same engine the [test harness](/guides/testing/) uses:

```ts
// db.ts — verified against examples/commerce/src/db.ts
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from './schema.js';

export type CommerceDb = PgliteDatabase<typeof schema>;

export function createCommerceDb(): CommerceDb {
  const client = new PGlite();
  void client.exec(SCHEMA_DDL); // PGlite runs operations FIFO, so DDL lands first
  void client.exec(SEED_PRODUCTS);
  return drizzle(client, { schema });
}
```

Swapping PGlite for a hosted Postgres is a driver change — `drizzle(pool, { schema })` over
`drizzle-orm/node-postgres` — with the schema, domains, writes, queries, and the entire derived graph
unchanged. The request shell resolves the `db` provider once per request before any guard runs
(SPEC §9.5).

## What carries over from store to Drizzle

The progression is additive — moving from a plain store to Drizzle changes only the data access, and
in exchange the compiler takes over work you were doing by hand:

| Concern               | Plain store                           | Drizzle path                                   |
| --------------------- | ------------------------------------- | ---------------------------------------------- |
| Domains & writes      | `domain(...)` / `write(...)`          | identical                                      |
| Handler access        | `db.<domain>.<write>` (KV330 ban)     | identical                                      |
| Touch set             | hand-declared `touches` (KV406 sites) | extracted from SQL via `kovo({ domain, key })` |
| Row-level keys        | not available                         | `key` annotation → `product:p1`                |
| Runtime verification  | `observed ⊆ static ∪ declared`        | same invariant, fewer manual declarations      |
| Optimistic derivation | hand-written transforms only          | compiler can derive from the SQL shape         |

The handler you wrote against the store keeps working; you delete `touches` lines as the analyzer
takes over, and the verifier confirms nothing slipped.

## Next

- [Queries & invalidation](/guides/queries/) — the read side: `reads`, instance keys, and stamps.
- [Mutations & forms](/guides/mutations/) — the request lifecycle around a write.
- [Optimistic updates](/guides/optimistic/) — transforms derived from the same SQL shape.
- [Testing](/guides/testing/) — running the `observed ⊆ static ∪ declared` verifier.

<details>
<summary>Spec & diagnostics</summary>

Domains, writes, and the guard chain: SPEC §10.3. Schema as domain registry and the `kovo({ domain,
key })` / `exempt` annotation: SPEC §10.1 (verified against `examples/commerce/src/schema.ts` and
`@kovojs/drizzle`'s `kovo()`). Touch-set extraction from Drizzle SQL and the committed
`touch-graph.ts`: SPEC §11.1. Runtime cross-check `observed ⊆ static ∪ KV406-declared`: SPEC §11.2.
Direct db access in a handler is **KV330**; a statically un-analyzable write needs manual `touches`
or it is **KV406**; a write touching an undeclared domain is **KV402**, a declared-but-never-written
domain is **KV403**, a write to an unmapped table is **KV404**, and an `exempt` table read by a query
is **KV411** (SPEC §10.1, §11.3). The `db` provider and per-request resolution: SPEC §9.5.

</details>
</content>
</invoke>
