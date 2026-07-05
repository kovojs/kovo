---
title: Pagination
description: Page a query with a cursor, keep DOM identity stable, and ship only the new rows on the wire.
order: 1.1
---

# Pagination

Use this when a list should grow a page at a time without losing the first page you already rendered.
Reach for a cursor query when the browser should keep one held list instance and append or prepend
new rows into it.

## Add the cursor query

Start with `after`, `limit`, and a `nextCursor`:

```text
// Source-verified shape from examples/commerce/src/queries.ts
export const productGridQuery = query({
  access: publicAccess('public storefront browsing'),
  async load(input, context) {
    const { after, limit = 2 } = (input ?? {}) as { after?: string; limit?: number };
    const items = await context.db.select(...).from(products).where(after ? gt(products.id, after) : undefined).limit(limit);
    return { items, nextCursor: items.at(-1)?.id ?? null };
  },
});
```

The important shape is the return value. Kovo needs the current page rows plus the cursor for the
next page.

## Keep row identity stable

Key the rendered rows and carry the cursor in markup:

```text
// Source-verified shape from examples/commerce/src/components/product-grid.tsx
export const ProductGrid = component({
  queries: { productGrid: productGridQuery },
  render: ({ productGrid }) => (
    <section data-page-cursor={productGrid.nextCursor ?? ''}>
      {productGrid.items.map((item) => <article kovo-key={item.id}>{item.name}</article>)}
    </section>
  ),
});
```

`kovo-key` is the DOM identity. `data-page-cursor` is the next-page handoff.

## Run it

The commerce example proves the wire shape end to end. A new page is sent as a delta chunk, not a
full re-ship of page one:

```text
<kovo-query name="productGrid" delta>{"lists":{"items":{"key":"id","upsert":[{"id":"p3"},{"id":"p4"}]}}}</kovo-query>
```

That exact shape is asserted in `packages/server/src/wire-html.test.ts`, and the commerce pagination
test checks that re-applying the same page does not duplicate rows because the client reconciles by
`kovo-key`.

## Add the production shape

If another mutation can add rows to the same collection, declare the keyed list delta on the query:

```text
// Source-verified shape from examples/commerce/src/queries.ts
export const orderHistoryQuery = query({
  async load() {
    return { items: [] };
  },
  delta: [{ domain: order.key, key: 'id', path: 'items' }],
});
```

That tells Kovo how one changed row fits back into the held list. Without it, the safe fallback is
to re-send or re-render more than you wanted.

Use `mode: 'prepend'` on the page wire when the product is "load older" instead of "load more".

## Handle failure

Two mistakes show up fast:

- If you forget `kovo-key`, the browser has no stable row identity for merge-time reconciliation.
- If you forget to thread the cursor, the next fetch repeats the first page because nothing tells
  the server where page two begins.

When the framework cannot prove a keyed delta shape, it falls back to the coarser safe path instead
of guessing.

## Next

- [Queries & invalidation](/guides/queries/) - the read model that pagination builds on.
- [Live queries](/guides/live-queries/) - keep a held list fresh after the first page loads.

<details>
<summary>Spec & diagnostics</summary>

Commerce source of truth: `examples/commerce/src/queries.ts`,
`examples/commerce/src/components/product-grid.tsx`, and `examples/commerce/src/pagination.test.ts`.
Delta wire shape: `packages/server/src/wire-html.ts` and `packages/server/src/wire-html.test.ts`.
List delta merge contract: `packages/core/src/query-delta.ts`. Keyed reconciliation and held-list
accumulation: SPEC `spec/09-wire-protocol.md` and `spec/04-component-model.md` section 13.2.

API reference: [@kovojs/core](/api/core/), [@kovojs/server](/api/server/).

</details>
