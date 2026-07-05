---
title: Data layer
description: Annotate Drizzle tables, load through read handles, and declare opaque mutation touches only when analysis cannot see the write.
order: 1.5
---

# Data layer

Use the data layer when you want Kovo to prove that a write refreshes every query it can make stale.
The shipped path is Drizzle-first: annotate tables once, read through query loaders, and route
mutation writes through named helpers. Reach for manual registry declarations only when the write is
opaque.

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

## Declare Domain values

Table tags and mutation/query declarations use the same vocabulary, but they are not the same thing:
`kovo({ domain: 'cart' })` is schema metadata on a table, while `domain('cart')` creates the runtime
`Domain` value you pass to `registry.touches` or `reads`.

```ts
import { domain } from '@kovojs/server';

export const cart = domain('cart');
export const product = domain('product');
```

Use `tag()` when you want the same value shape for a narrower row-scoped invalidation key. The
[Queries & invalidation](/guides/queries/) guide stays at coarse domains; row-scoped tags are a later
optimization.

## Load through `context.db`

Query loaders receive a managed read handle:

```ts
// Source: examples/commerce/src/queries.ts
import { publicAccess, query, s } from '@kovojs/server';
import { eq } from 'drizzle-orm';

const cartSummaryDefinition = {
  access: publicAccess('cart badge is visible to anonymous shoppers'),
  output: s.object({ count: s.number() }),
  load: async (_input, context): Promise<{ count: number }> => {
    const rows = (await context?.db.select({ quantity: cartItems.quantity }).from(cartItems)) ?? [];
    return { count: rows.reduce((total, row) => total + row.quantity, 0) };
  },
};

export const cartSummary = query(cartSummaryDefinition);

const productDetailDefinition = {
  args: s.object({ id: s.string() }),
  guard: productCanBeViewed,
  output: s.array(s.object({ id: s.string(), name: s.string() })),
  load: async (input, context?: { db?: any }): Promise<{ id: string; name: string }[]> =>
    context?.db
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(eq(products.id, input.id)) ?? [],
};

export const productDetail = query(productDetailDefinition);
```

The loader's `FROM` and `JOIN` clauses are the read declaration. A raw projection needs a declared
output schema and `reads` set.

## Write through a named helper

The mutation handler may do reads, but the writes themselves belong in a named domain-layer helper:

```ts
// Source: examples/commerce/src/domain.ts
const commitAddToCartRows = async (_db: unknown, _input: unknown) => {};

export const addToCart = mutation({
  access: publicAccess('demo cart mutation'),
  csrf: cartCsrf,
  input: s.object({ productId: s.string(), quantity: s.number().int().min(1) }),
  registry: { touches: [cart, product] },
  async handler(input, request) {
    await commitAddToCartRows(request.db, {
      productId: input.productId,
      quantity: input.quantity,
    });
    return { ok: true };
  },
});
```

The helper owns the Drizzle write calls. The table annotations map those tables to `cart` and
`product`, so visible queries reading either domain rerun after commit.

```ts
// Source: examples/commerce/src/domain.ts
export async function commitAddToCartRows(
  db: { insert(table: unknown): { values(value: unknown): Promise<void> } },
  input: { productId: string; quantity: number },
) {
  await db.insert(cartItems).values({
    productId: input.productId,
    qty: input.quantity,
  });
}
```

## Run it

Make one table annotation change, then one helper-write change, and run the graph gate:

```sh
vp check
kovo check
```

The useful proof here is not a page click. It is the graph verdict changing when the read/write facts
change: annotated tables and named helpers keep the invalidation map explainable.

## Declare opaque writes

If the write hides its table set, declare the registry facts on the mutation:

```ts
// Source: examples/commerce/src/domain.ts
const mergeCartRows = async (_db: unknown, _cartId: string) => {};

export const mergeCart = mutation({
  access: publicAccess('demo cart merge mutation'),
  csrf: cartCsrf,
  input: s.object({ cartId: s.string() }),
  registry: {
    tables: ['cart_items'],
    touches: [cart],
  },
  async handler(input, request) {
    await mergeCartRows(request.db, input.cartId);
    return { ok: true };
  },
});
```

`tables` lists the physical tables the helper's raw SQL may mutate. `touches` lists the domains to
rerun.

## Handle failure

The failure mode for a direct handler write is a hard graph error, not a silent fallback:

```txt
ERROR KV330 cart.mutation.ts:12 Direct db access in a mutation handler; route through domain. handler addToCart receives db.
```

That is the positive case in `packages/compiler/src/direct-db.test.ts`. Keep reads in the handler,
move writes into a named helper, and reserve `registry.tables` for the truly opaque cases.

## Keep request surfaces explicit

Every request-reachable surface needs access posture:

```ts
// Source: examples/commerce/src/queries.ts
export const adminProducts = query({
  guard: guards.role('admin'),
  load: (_input, context) => context.db.select().from(products),
});

export const publicProducts = query({
  access: publicAccess('catalog is public'),
  load: (_input, context) => context.db.select().from(products),
});
```

The decision is a graph fact. `publicAccess` is not a guard; it is a reviewed declaration that the
surface is intentionally public.

## Check the data plane

```sh
vp check
kovo check
```

`vp check` covers the typed app wiring. `kovo check` compares query reads, mutation writes, registry
declarations, and runtime verification facts. If the analyzer cannot prove a write and you did not
declare it, that graph check fails.

## Next

- [Queries & invalidation](/guides/queries/) — render query-backed UI.
- [Mutations & forms](/guides/mutations/) — post writes and refresh fragments.
- [Security](/guides/security/) — add owners, governed columns, and public-read decisions.

<details>
<summary>Spec & diagnostics</summary>

Schema/domain annotations: SPEC §10.1. Queries: SPEC §10.2. Mutations and writes: SPEC §10.3.
Runtime verification: SPEC §11.2. Access posture: KV436. Opaque projection schemas: KV410. Exempt
table reads: KV411. Opaque writes: KV406. Direct mutation-handler writes are KV330: "Direct db
access in a mutation handler; route through domain."

API reference: [@kovojs/drizzle](/api/drizzle/), [@kovojs/server](/api/server/).

</details>
