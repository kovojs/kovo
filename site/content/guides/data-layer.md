---
title: Data layer
description: Annotate Drizzle tables, load through read handles, and declare opaque mutation touches only when analysis cannot see the write.
order: 1.5
---

# Data layer

Use the data layer when you want Kovo to prove that a write refreshes every query it can make stale.
The shipped path is Drizzle-first: annotate tables once, read through query loaders, and write in
mutations with analyzable Drizzle calls. Reach for manual registry declarations only when the write
is opaque.

## Annotate tables

Put the domain facts next to the table definition:

```ts
import { kovo } from '@kovojs/drizzle';
import { pgTable, text } from 'drizzle-orm/pg-core';

export const products = pgTable(
  'products',
  { id: text('id').primaryKey(), name: text('name').notNull() },
  kovo({ domain: 'product', key: (t) => t.id }),
);
```

`domain` is the invalidation currency. `key` makes invalidation row-level when the analyzer can trace
the predicate. Tables without an annotation default to a same-named domain. Use `exempt: true` only
for write-side tables that no query reads.

## Load through `context.db`

Query loaders receive a managed read handle:

```ts
import { publicAccess, query, s } from '@kovojs/server';
import { eq } from 'drizzle-orm';

export const cartSummary = query({
  access: publicAccess('cart badge is visible to anonymous shoppers'),
  load: (_input, { db }) =>
    db.select({ productId: cartItems.productId, quantity: cartItems.quantity }).from(cartItems),
});

export const productDetail = query({
  args: s.object({ id: s.string() }),
  guard: productCanBeViewed,
  load: (input, { db }) => db.select().from(products).where(eq(products.id, input.id)),
});
```

The loader's `FROM` and `JOIN` clauses are the read declaration. A raw projection needs a declared
output schema and `reads` set.

## Write with analyzable Drizzle calls

Mutations write through the managed mutation request DB:

```ts
export const addToCart = mutation({
  access: publicAccess('demo cart mutation'),
  csrf: cartCsrf,
  input: s.object({ productId: s.string(), quantity: s.number().int().min(1) }),
  async handler(input, request) {
    await request.db.insert(cartItems).values({
      productId: input.productId,
      quantity: input.quantity,
    });
    await request.db
      .update(products)
      .set({ stock: sql`${products.stock} - ${input.quantity}` })
      .where(eq(products.id, input.productId));
    return { ok: true };
  },
});
```

The analyzer extracts the touched tables from the Drizzle calls. The table annotations map those
tables to `cart` and `product`, so visible queries reading either domain rerun after commit.

## Declare opaque writes

If the write hides its table set, declare the registry facts on the mutation:

```ts
export const mergeCart = mutation({
  access: publicAccess('demo cart merge mutation'),
  csrf: cartCsrf,
  input: s.object({ cartId: s.string() }),
  registry: {
    tables: ['cart_items'],
    touches: [cart],
  },
  async handler(input, request) {
    await request.db.execute(sql`/* merge cart ${input.cartId} */`);
    return { ok: true };
  },
});
```

`tables` lists the physical tables the raw SQL may mutate. `touches` lists the domains to rerun.

## Keep request surfaces explicit

Every request-reachable surface needs access posture:

```ts
export const adminProducts = query({
  guard: guards.role('admin'),
  load: (_input, { db }) => db.select().from(products),
});

export const publicProducts = query({
  access: publicAccess('catalog is public'),
  load: (_input, { db }) => db.select().from(products),
});
```

The decision is a graph fact. `publicAccess` is not a guard; it is a reviewed declaration that the
surface is intentionally public.

## Check the data plane

```sh
vp check
```

The check compares query reads, mutation writes, registry declarations, access posture, and runtime
verification facts. If the analyzer cannot prove a write and you did not declare it, the build fails.

## Next

- [Queries & invalidation](/guides/queries/) — render query-backed UI.
- [Mutations & forms](/guides/mutations/) — post writes and refresh fragments.
- [Security](/guides/security/) — add owners, governed columns, and public-read decisions.

<details>
<summary>Spec & diagnostics</summary>

Schema/domain annotations: SPEC §10.1. Queries: SPEC §10.2. Mutations and writes: SPEC §10.3.
Runtime verification: SPEC §11.2. Access posture: KV436. Opaque projection schemas: KV410. Exempt
table reads: KV411. Opaque writes: KV406. KV330 covers direct write-capable DB access in
app-authored request code at the static data-plane boundary. The unshipped SPEC §10.3 domain-write
helper remains an open design decision until enforcement lands with it.

</details>
