---
title: Queries & invalidation
description: Load data through query loaders, declare access posture, and let Kovo connect Drizzle reads to mutation refreshes.
order: 1
---

# Queries & invalidation

Use a query when a component needs server data that should refresh after a mutation. You write the
loader once. Kovo reads the Drizzle tables it uses, maps those tables to domains, and refreshes the
components that depend on the query after a matching write commits.

## Add a query

Load through `context.db`. That handle is the framework-managed read handle for loaders.

```ts
import { publicAccess, query, s } from '@kovojs/server';

const cartSummaryDefinition = {
  access: publicAccess('cart badge is visible to anonymous shoppers'),
  output: s.object({ count: s.number() }),
  load: async (_input, context?: { db?: any }): Promise<{ count: number }> => {
    const rows = (await context?.db.select({ quantity: cartItems.quantity }).from(cartItems)) ?? [];
    return { count: rows.reduce((total, row) => total + row.quantity, 0) };
  },
};

export const cartSummary = query(cartSummaryDefinition);
```

Every request-reachable query needs an access decision. A guard counts. A public query uses
`publicAccess('reason')` so the public set is visible in `kovo explain --access`.

## Render it

Bind the query from the component that needs it:

```tsx
import { component } from '@kovojs/core';

export const CartBadge = component({
  queries: { cart: cartSummary },
  render: ({ cart }) => <span>Cart: {cart.count}</span>,
});
```

The rendered page carries the query value and the dependency stamp:

```html
<span kovo-deps="cartSummary">Cart: <span data-bind="cart.count">2</span></span>
<script type="application/json" kovo-query="cartSummary">
  { "count": 2 }
</script>
```

The stamp is what lets a mutation response target the right fragments without a client cache.

## Let writes refresh it

On the Drizzle path, invalidation comes from the SQL that actually runs:

```ts
const commitAddToCartRows = async (_db: unknown, _input: unknown) => {};

export const addToCart = mutation({
  access: publicAccess('demo cart mutation'),
  csrf: cartCsrf,
  input: s.object({ productId: s.string(), quantity: s.number().int().min(1) }),
  registry: { touches: [cart, product] },
  async handler(input, request) {
    await commitAddToCartRows(request.db, input);
    return { ok: true };
  },
});
```

The write still goes through a named helper. `kovo check` reads those helper writes, maps the tables
through the schema's `kovo({ domain })` annotations, intersects them with visible query read sets,
and reruns the stale queries after the transaction commits.

## Declare opaque writes

If the analyzer cannot see the tables, declare the mutation registry facts explicitly:

```ts
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

`tables` is the helper's raw-SQL table allowlist. `touches` is the domain set to invalidate if the
write is opaque.

## Check the graph

Run the graph check before you ship:

```sh
kovo check
```

That is the command that reports the data-plane graph verdict for opaque reads, exempt-table reads,
and opaque writes. Keep `vp check` in CI for type/lint wiring, but use `kovo check` when you want
the graph result itself.

## Next

- [Caching](/guides/caching/) — make a public typed read cacheable and verify the headers.
- [Data layer](/guides/data-layer/) — annotate tables and understand Drizzle extraction.
- [Mutations & forms](/guides/mutations/) — post forms and return fresh fragments.

<details>
<summary>Spec & diagnostics</summary>

Queries: SPEC §10.2 and §9.4. Access decisions: SPEC §10.2 default-deny access decisions and KV436.
Opaque reads: KV410. Exempt table reads: KV411. Opaque writes: SPEC §10.3 and KV406. Direct
mutation-handler writes are tracked by KV330: "Direct db access in a mutation handler; route through
domain."

</details>
