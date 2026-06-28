---
title: Queries & invalidation
description: Declare query loaders and writes; Kovo derives which domains refresh which components — no invalidate() calls, no client cache.
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

A query couples a source-derived identity and a loader. On the Drizzle path, the read domains come
from the loader's query expression:

```ts
import { query } from '@kovojs/server';

export const cartQuery = query({
  load: (_input, { request }) => request.db.select({ count: sum(cartItems.qty) }).from(cartItems),
});

export const productGridQuery = query({
  load: (input, { request }) =>
    request.db
      .select()
      .from(products)
      .limit(input.limit ?? 20),
});
```

The `FROM` / `JOIN` graph is the dependency declaration. Any committed write that
touches the derived `cart` domain refreshes `cartQuery` — the server re-runs it
after the write and sends the fresh value back in the same response. You don't
list those writes anywhere.

## Read it from a component

A component declares the queries it uses and renders with their values:

```tsx
import { component } from '@kovojs/core';

export const CartBadge = component({
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
domains             →  invalidated queries  (read from each query's FROM/JOIN expression)
invalidated queries →  components           (every element that declared that query)
```

The write body at the top of that chain is a `write()` — a named operation plus the exact domains it
touches. Mutations call writes instead of touching `db` directly, which is what makes the touch set
auditable:

```ts
import { domain, write } from '@kovojs/server';

export const cart = domain();
export const product = domain();

// One named write; its `touches` are the domains this operation can dirty.
export const addItem = write({
  key: 'cart/add-item',
  touches: [cart, product],
  run: (db: CommerceDb, productId: string, quantity: number) => {
    db.cart.insert({ productId, quantity });
    db.product.decrementStock(productId, quantity);
  },
});
```

A mutation handler then calls `db.<domain>.<write>` rather than issuing SQL inline, so every write
goes through a declared, touch-annotated path. On the Drizzle-on-Postgres path the analyzer reads the
touched tables straight from the write body and most writes need no explicit `touches` at all (see
the [data layer guide](/guides/data-layer/) for the full authoring surface). You annotate each
table's domain once:

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

On the Drizzle-on-Postgres path, the framework reads which tables a write
touches straight from the write's code and emits an on-demand graph you can
inspect:

```ts
// touch-graph.ts — emitted by `kovo emit` / example graph scripts, do not edit
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
`node_modules`), you declare the touches by hand at the write site as a checked opaque-write escape
hatch.
The verifier confirms observed reads/writes are covered by the static graph plus those declared
opaque sites.

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
export const productQuery = query({
  args: s.object({ id: s.string() }),
  guard: authed,
  load: (input, { request }) =>
    request.db.select().from(products).where(eq(products.id, input.id)).limit(1),
});
```

Each instance has one canonical key — `name:value`, like `product:p1` — and that one string keys
everything: the client store, the `kovo-deps` stamps, the mutation's refresh targets, and optimistic
transforms. A component binds its arguments from its own props, so any page that renders it satisfies
the dependency without the page knowing anything about it. No call site ever enumerates query
dependencies.

## Reading a query over the network

Every query is addressable over GET. The loader uses this for refetch-on-focus (re-running a query
when a stale tab comes back), GET forms use it for fragment responses, async option/search controls
can use it for reads, and live subscriptions use the same query instance key:

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
every read. The response's `name` is the canonical instance key (`product:p1`), the same currency
used by `kovo-deps`, optimistic transforms, live subscriptions, and graph output.

Refetch-on-focus is on by default. Turn it off only for a query whose value is intentionally
fixed for the document lifetime:

```ts
export const buildInfoQuery = query({
  refetchOnFocus: false,
  load: () => ({ version: process.env.KOVO_VERSION ?? 'dev' }),
  reads: [],
});
```

### Cache and version headers

Every `/_q/` response carries the build's render-plan version token. If a stale document asks for a
query and receives a token from another build, the loader does not merge it. It treats the response
as deploy skew: discard the in-place update, fetch a full value for the query if possible, and reload
the current route if the document and server cannot agree on a token. See
[deployment](/guides/deployment/) for the 24-hour prior-token retention requirement.

Guarded or session-dependent reads are credentialed GETs, so their default cache posture is private:

```http
Cache-Control: private, no-store
Vary: Cookie
```

That applies to every path through `/_q/`: loader fetches, refetch-on-focus, GET-form fragments,
async option/search reads, and SSE subscription recovery. The posture may be relaxed only for a query
the compiler proves session-independent: no guard, no `req.session` read in the instance key, and no
session read in `load`. A guarded query is never served from a shared cache, because the guard must
run on every read.

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

## Bind the projected shape

`data-bind` paths follow the query shape Kovo can prove. For Drizzle-backed queries, that is the
static projection shape extracted from the query builder. If your loader annotates a broader return
type, bindings still use the proven projection. Keep the projection shape aligned with the DOM path
you bind to, or extract a named derive that reshapes the value explicitly.

## Next

- [Mutations & forms](/guides/mutations/) — the write side of this graph.
- [Live queries](/guides/live-queries/) — subscribing to the same query instance keys over SSE.
- [Optimistic updates](/guides/optimistic/) — predicting results before the server confirms.
- [Reading kovo check & kovo explain](/guides/kovo-explain/) — asserting these facts in CI.

<details>
<summary>Spec & diagnostics</summary>

Queries and the touch graph: SPEC §10.1–10.3, §11.1. Derived stamps (`kovo-deps`, `data-bind`):
SPEC §4.8. Binding a path through a nullable segment without `?.` is **KV227**. A query reading an
`exempt` table is **KV411** (nothing could invalidate it). Manual touches at an opaque write are
**KV406**, verified by `observed ⊆ static ∪ declared` in tests. Update-status coverage on every
query-dependent position is **KV311**. The typed read endpoint, per-read guards, cache posture, and
render-plan version token: SPEC §9.4. Live subscriptions reuse query instance keys: SPEC §9.3.
Reconciliation by morph: SPEC §2 (design test 5).

</details>
