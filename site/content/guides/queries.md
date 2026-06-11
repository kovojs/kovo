---
title: Queries & invalidation
description: Declare reads once, get the invalidation graph derived — instance keys, fw-deps, and the touch graph.
order: 1
---

# Queries & invalidation

A query is a typed, named read. You declare what it reads; the framework derives everything
downstream — which mutations refresh it, which islands depend on it, and what the server must
re-render after a write. There is no `invalidate()` call in the happy path and no client cache
lifecycle to manage (SPEC §10.2, §10.3).

## Declare a query

A query couples a key, a loader, and a read set of domains:

```ts
// app.ts — the commerce reference app's shape
import { domain, query } from '@jiso/server';

export const cart = domain('cart');
export const product = domain('product');
export const order = domain('order');

export const cartQuery = query('cart', {
  load: (_input: unknown) => loadCartQuery(db),
  reads: [cart],
});

export const productGridQuery = query('productGrid', {
  load: (input: unknown) => loadProductGrid(db, input as ProductGridInput),
  reads: [product],
});
```

The `reads` list names the domains this query depends on. Any committed write that touches the
`cart` domain invalidates `cartQuery` — the server re-runs it post-commit and ships the fresh
value back in the same mutation response (SPEC §10.3). Components consume queries by declaring
them:

```tsx
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  fragmentTarget: true,
  queries: { cart: cartQuery },
  state: () => ({}),
  render: () => (
    <button class="badge">
      Cart <span>{cart.count}</span>
    </button>
  ),
});
```

You write the JSX; the compiler derives the wiring and stamps it into the rendered HTML
(SPEC §4.8):

```html
<button class="badge" fw-deps="cart">Cart <span data-bind="cart.count">2</span></button>
```

Two derived attributes carry the whole dependency story into the HTML itself:

- **`fw-deps="cart"`** — this island depends on the `cart` query. Mutations read these stamps off
  the live DOM to decide which fragments to ask for (SPEC §9.1).
- **`data-bind="cart.count"`** — when the `cart` query value changes, the loader writes the new
  `count` into this element. The path is typed against the query's result shape; binding paths
  that traverse nullable segments must mark it `?.` or they are compile error FW227 (SPEC §4.8).

The page ships the query value once, as shared client data:

```html
<script type="application/json" fw-query="cart">{ "count": 2 }</script>
```

Open view-source on any Jiso page and you can read its complete data-dependency story — that is
the point ([the mental model](/docs/mental-model/) covers why).

## Where invalidation comes from: the touch graph

Mutations never list the queries they invalidate. Writes flow through `domain` writes, and the
static pass extracts which tables each write touches — on the Drizzle-blessed path, directly from
the Drizzle call ASTs (SPEC §11.1). The chain is:

```
write body          →  touched tables       (extracted from insert/update/delete ASTs)
touched tables      →  domains              (schema annotations, SPEC §10.1)
domains             →  invalidated queries  (each query's read set)
invalidated queries →  consumers            (every island with that query declared)
```

On the schema side, tables are annotated once:

```ts
// schema.ts — Drizzle-blessed path (SPEC §10.1)
export const cartItems = pgTable('cart_items', { /* … */ }, jiso({ domain: 'cart' }));
export const products = pgTable(
  'products',
  { id: text('id').primaryKey(), stock: integer('stock').notNull() },
  jiso({ domain: 'product', key: (t) => t.id }), // row-level invalidation key
);
```

Tables default to a same-named domain; the `key` annotation declares row-level granularity so a
write to product `p1` invalidates `product:p1`, not every product on the site. A table can opt
out with `jiso({ exempt: true })`, but exemption is write-side only — a query reading an exempt
table is error FW411, because nothing could ever invalidate it (SPEC §10.1).

The extraction output is a committed, reviewable artifact, so invalidation-graph changes appear
as diffs in code review (SPEC §11.1):

```ts
// generated/touch-graph.ts — DO NOT EDIT
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

For SQL the analyzer cannot see through (raw SQL, helpers in `node_modules` receiving a `db`),
manual `touches` are required at the write site and runtime-verified — that is FW406, and the
verification invariant `observed ⊆ static ∪ declared` is enforced in tests (SPEC §11.2, and the
[testing guide](/guides/testing/)).

Because the JOIN *is* the declaration, the classic staleness bug — forgetting that a query also
reads a joined table — is unrepresentable on the blessed path: the read set is derived from the
query expression, not recalled from memory (SPEC §10.2).

## Ask the graph, don't trace the code

The derived graph is queryable as stable text. This is real output from the commerce reference
app's committed graph:

```sh
fw explain query cart graph.json
```

```txt
fw-explain/v1
QUERY cart
reads: cart
consumers: component:CartBadge,page:/cart
invalidated-by: cart/add
domain-writes: cart.addItem
```

Four lines answer the questions that need a debugger in other stacks: what this query reads,
who consumes it, which mutations refresh it, and which domain writes are behind that. The
[fw explain guide](/guides/fw-explain/) covers asserting these facts in CI.

## Instance keys: many instances of one query

A parameterized query declares its args once, schema-style; the same coercion serves props, route
params, and the read endpoint (SPEC §10.2):

```ts
export const productQuery = query('product', {
  args: s.object({ id: s.string() }),
  guard: authed, // checked at page render AND at every typed read
  load: (input) => loadProduct(db, input.id),
  reads: [product],
});
```

The instance key has one canonical encoding — `name:keyValue`, like `product:p1` — and that one
string keys everything: the client store (`<script fw-query="product:p1">`), `fw-deps` stamps,
the `FW-Targets` mutation header, optimistic transform keys, and (v2) live-push routing
(SPEC §10.2). Two instances of one query coexist on a page; `data-bind` inside an island resolves
against that island's instance.

Components bind args from their own props — `productQuery.args((p) => ({ id: p.productId }))` —
so any page that renders the component satisfies the dependency without call-site knowledge
(SPEC §10.2). No call site enumerates query dependencies, ever; that rule killed manual fragment
targets and RTK-style mutation registration (SPEC §2).

## Every query is addressable over GET

The typed read endpoint serves refetch-on-focus, GET-form fragment responses, and async reads
(SPEC §9.4):

```http
GET /_q/product?id=p1 HTTP/1.1
FW-Fragment: true
```

```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8

<fw-query name="product:p1">{ "name": "Mug", "stock": 4 }</fw-query>
```

Args arrive as search params through the query's `args` schema; the query's `guard` runs on every
read, and reads participate in the `--unguarded` audit (SPEC §9.4). The loader uses this endpoint
for refetch-on-focus/visibility — a per-query opt-out behavior that re-runs queries when a stale
tab returns (SPEC §9.3).

## How an update reaches the DOM

When a mutation response (or a refetch) delivers a new query value, the loader runs that query's
update plan: path bindings, then named derives, then keyed template stamps — by walking the
self-describing attributes under each `fw-deps` island. There is no runtime dependency tracking
and no separate plan artifact; the DOM is the plan (SPEC §4.8). Positions that exceed the plan
grammar flip to server fragments, and every query-dependent position must have a declared update
status or it is FW311 (SPEC §4.9).

## What you never write

Worth stating as a checklist, because each item is a bug class elsewhere:

- **No `invalidate()` calls** — derived from write ASTs; the call survives only as a linted escape
  hatch for external-system effects (SPEC §10.3).
- **No tag lists on queries** — the read set is the domains behind the query expression
  (SPEC §10.2).
- **No fragment-target enumeration at mutation sites** — `FW-Targets` is read off the live DOM's
  `fw-deps` stamps at request time, so islands added to a page later participate automatically
  (SPEC §9.1).
- **No client cache to evict** — server truth is morphed in; there is no consistency protocol
  (SPEC §2).

A teammate who ships a new component with `queries: { cart: cartQuery }` next month gets correct
refresh behavior from every cart mutation ever written. Nothing to remember (SPEC Appendix A).

## Next

- [Mutations & forms](/guides/mutations/) — the write side of this graph.
- [Optimistic updates](/guides/optimistic/) — instant predictions over query values.
- [Reading fw check & fw explain](/guides/fw-explain/) — auditing the graph in CI.
