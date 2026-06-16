---
title: Queries & invalidation
description: Declare what a component reads, and the framework figures out which writes refresh it — no invalidate() calls, no client cache.
order: 1
---

# Queries & invalidation

Your cart badge shows an item count. When someone adds an item, the badge should update — but you
never want to be the one wiring "add to cart" to "refresh the badge." In Kovo you aren't.

You write two things: a query that loads the cart, and a component that says it reads that query.
That's the whole connection. Add an item anywhere in the app and this badge refreshes, because Kovo
traced the path from the write back to the badge for you. This guide shows how that tracing works,
and how to check it.

## Declare a query

A query couples a name, a loader, and the domains it reads:

```ts
import { domain, query } from '@kovojs/server';

export const cart = domain('cart');
export const product = domain('product');

export const cartQuery = query('cart', {
  load: (_input) => loadCart(db),
  reads: [cart],
});

export const productGridQuery = query('productGrid', {
  load: (input) => loadProductGrid(db, input),
  reads: [product],
});
```

The `reads` list is the dependency declaration. Any committed write that touches the `cart` domain
refreshes `cartQuery` — the server re-runs it after the write and sends the fresh value back in the
same response. You don't list those writes anywhere.

## Read it from a component

A component declares the queries it uses and renders with their values:

```tsx
import { component } from '@kovojs/core';

export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <cart-badge>
      Cart: <span>{cart.count}</span>
    </cart-badge>
  ),
});
```

You write the JSX. The compiler derives the wiring and stamps it into the rendered HTML:

```html
<cart-badge kovo-deps="cart">Cart: <span data-bind="cart.count">2</span></cart-badge>
```

Two attributes carry the whole dependency story:

- `kovo-deps="cart"` — this element depends on the `cart` query. Mutations read these stamps off the
  live DOM to decide which fragments to refresh.
- `data-bind="cart.count"` — when the `cart` value changes, the loader writes the new `count` here.
  The path is checked against the query's result type, so binding a field that doesn't exist is a
  compile error.

The value itself ships once per page, as JSON:

```html
<script type="application/json" kovo-query="cart">
  { "count": 2 }
</script>
```

Open View Source on any Kovo page and its complete data-dependency story is right there.

## Where invalidation comes from

You never tell a mutation which queries to refresh. Instead, the framework keeps a touch graph — a
derived map from each write to the tables it touches, and from there to the queries that go stale.
The chain is:

```
write body          →  touched tables       (read from the insert/update/delete code)
touched tables      →  domains              (a one-time annotation on each table)
domains             →  invalidated queries  (each query's reads list)
invalidated queries →  components           (every element that declared that query)
```

You annotate each table's domain once:

```ts
export const cartItems = pgTable(
  'cart_items',
  {
    /* … */
  },
  kovo({ domain: 'cart' }),
);

export const products = pgTable(
  'products',
  { id: text('id').primaryKey(), stock: integer('stock').notNull() },
  kovo({ domain: 'product', key: (t) => t.id }), // row-level granularity
);
```

A table defaults to a same-named domain. The `key` annotation makes invalidation row-level, so a
write to product `p1` refreshes `product:p1`, not every product on the site.

On the Drizzle-on-Postgres path, the framework reads which tables a write touches straight from the
write's code, and writes the result to a committed file you can review:

```ts
// generated/touch-graph.ts — generated, do not edit
export const touchGraph = {
  'cart.addItem': {
    touches: [
      { domain: 'cart', via: 'cart_items', keys: null },
      { domain: 'product', via: 'products', keys: 'arg:productId' },
    ],
  },
} as const;
```

Because the join _is_ the declaration, the classic staleness bug — forgetting that a query also
reads a joined table — can't happen here. The read set comes from the query expression, not from
memory. When the analyzer genuinely can't see through a write (raw SQL, a helper buried in
`node_modules`), you declare the touches by hand at the write site, and a runtime check confirms
they're complete.

## Ask the graph instead of tracing the code

The derived graph is queryable as plain text. This is real output from the commerce reference app:

```sh
kovo explain query cart graph.json
```

```txt
QUERY cart
reads: cart
consumers: component:CartBadge,page:/cart
invalidated-by: cart/add
domain-writes: cart.addItem
```

Four lines answer what usually needs a debugger: what this query reads, who shows it, which mutations
refresh it, and which write is behind that. When a product rule matters — "every component showing
cart data must refresh when the cart changes" — you assert it in a graph query and CI holds the line.

## One query, many instances

A parameterized query declares its arguments once:

```ts
export const productQuery = query('product', {
  args: s.object({ id: s.string() }),
  guard: authed,
  load: (input) => loadProduct(db, input.id),
  reads: [product],
});
```

Each instance has one canonical key — `name:value`, like `product:p1` — and that one string keys
everything: the client store, the `kovo-deps` stamps, the mutation's refresh targets, and optimistic
transforms. A component binds its arguments from its own props, so any page that renders it satisfies
the dependency without the page knowing anything about it. No call site ever enumerates query
dependencies.

## Reading a query over the network

Every query is addressable over GET. The loader uses this for refetch-on-focus (re-running a query
when a stale tab comes back), and GET forms use it for fragment responses:

```http
GET /_q/product?id=p1
Kovo-Fragment: true
```

```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8

<kovo-query name="product:p1">{ "name": "Mug", "stock": 4 }</kovo-query>
```

Arguments arrive as search params through the query's `args` schema, and the query's `guard` runs on
every read.

## How an update reaches the DOM

When a fresh query value arrives — from a mutation response or a refetch — the loader walks the
self-describing attributes under each `kovo-deps` element and applies the update: path bindings first,
then derived values, then keyed list stamps. There's no separate plan to keep in sync; the DOM is the
plan. Anything too complex for that grammar falls back to a server-rendered fragment.

## What you never write

Each of these is a bug class in other stacks:

- **No `invalidate()` calls.** Refreshes are derived from the write code; the manual call survives
  only as a linted escape hatch for external systems.
- **No tag lists on queries.** The read set is the domains behind the query.
- **No refresh targets at mutation sites.** Targets are read off the live DOM's `kovo-deps` stamps at
  request time, so a component added later participates automatically.
- **No client cache to evict.** Server truth is morphed in; there's no consistency protocol.

A teammate who ships a new component with `queries: { cart: cartQuery }` next month gets correct
refresh behavior from every cart mutation ever written, with nothing to remember.

## Next

- [Mutations & forms](/guides/mutations/) — the write side of this graph.
- [Optimistic updates](/guides/optimistic/) — predicting results before the server confirms.
- [Reading kovo check & kovo explain](/guides/kovo-explain/) — asserting these facts in CI.

<details>
<summary>Spec & diagnostics</summary>

Queries and the touch graph: SPEC §10.1–10.3, §11.1. Derived stamps (`kovo-deps`, `data-bind`):
SPEC §4.8. Binding a path through a nullable segment without `?.` is **KV227**. A query reading an
`exempt` table is **KV411** (nothing could invalidate it). Manual touches at an opaque write are
**KV406**, verified by `observed ⊆ static ∪ declared` in tests. Update-status coverage on every
query-dependent position is **KV311**. The typed read endpoint: SPEC §9.4. Reconciliation by morph:
SPEC §2 (design test 5).

</details>
