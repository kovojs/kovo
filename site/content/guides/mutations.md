---
title: Mutations & forms
description: Post a typed form, write through the managed request DB, and refresh stale query-backed UI after commit.
order: 2
---

# Mutations & forms

Use a mutation when a browser form or enhanced submit changes server data. The same declaration works
with JavaScript disabled and with the enhanced client. The handler writes, Kovo commits, then Kovo
reruns the invalidated queries and sends fresh fragments back.

## Add the mutation

Start with the smallest useful POST:

```ts
import { publicAccess, mutation, s } from '@kovojs/server';

export const addToCart = mutation({
  access: publicAccess('demo cart is intentionally public'),
  csrf: cartCsrf,
  input: s.object({ productId: s.string(), quantity: s.number().int().min(1) }),
  async handler(input, request: { db: any }) {
    await request.db.insert(cartItems).values(input);
    return { ok: true };
  },
});
```

The input schema parses form data. The access decision is explicit. CSRF stays on for browser forms.
The Drizzle writes are analyzable, so the data-plane graph can derive which domains were touched.

## Render the form

```tsx
<form enhance mutation={addToCart}>
  <input type="hidden" name="productId" value={product.id} />
  <input name="quantity" type="number" min="1" defaultValue={1} />
  <button type="submit">Add to cart</button>
</form>
```

The served HTML is still a real form:

```html
<form method="post" action="/_m/cart/add-to-cart" enhance>
  <input type="hidden" name="kovo-csrf" value="..." />
  <input type="hidden" name="productId" value="p1" />
  <input name="quantity" type="number" min="1" value="1" />
  <button type="submit">Add to cart</button>
</form>
```

No JavaScript path gets a different server contract. Enhancement only changes how the response is
applied.

## Return typed failures

Expected failures belong in the mutation contract:

```ts
export const addToCart = mutation({
  access: publicAccess('demo cart is intentionally public'),
  csrf: cartCsrf,
  input: addToCartInput,
  errors: {
    OUT_OF_STOCK: s.object({ available: s.number().int().min(0) }),
  },
  async handler(input, request: { db: any }, context) {
    const [row] = await request.db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, input.productId));
    if (!row || row.stock < input.quantity) {
      return context.fail('OUT_OF_STOCK', { available: row?.stock ?? 0 });
    }
    await request.db.insert(cartItems).values(input);
    return { ok: true };
  },
});
```

The enhanced response morphs the submitted form with the failure state. The no-JS response rerenders
the page with the same typed failure.

## Declare opaque writes

Most Drizzle `insert`, `update`, and `delete` calls are extracted from the handler. Raw SQL and helper
calls that hide the write need registry facts:

```ts
export const mergeCart = mutation({
  access: publicAccess('demo cart merge mutation'),
  csrf: cartCsrf,
  input: s.object({ cartId: s.string() }),
  registry: {
    tables: ['cart_items'],
    touches: [cart],
  },
  async handler(input, request: { db: any }) {
    await request.db.execute(sql`/* opaque merge for ${input.cartId} */`);
    return { ok: true };
  },
});
```

`tables` is checked at the SQL execution boundary. If production SQL mutates a table outside the
allowlist, the runtime fails closed and invalidates the declared `touches` domains conservatively.

## Add optimism only after the write is clear

Optimism is keyed to queries:

```ts
export const addToCart = mutation({
  access: publicAccess('demo cart is intentionally public'),
  csrf: cartCsrf,
  input: addToCartInput,
  optimistic: {
    cartSummary(draft, input) {
      draft.count += input.quantity;
    },
    productDetail: 'await-fragment',
  },
  handler: addToCartHandler,
});
```

Use `'await-fragment'` when the safe prediction is not obvious. Server truth still wins after commit.

## Check it

```sh
vp check
```

The check verifies that request-reachable surfaces have access posture, form input matches the schema,
and write invalidation is covered by analyzed Drizzle writes or explicit registry declarations.

## Next

- [File uploads & storage](/guides/file-uploads-storage/) — accept multipart files and serve them back safely.
- [Queries & invalidation](/guides/queries/) — see how visible queries refresh after a mutation.
- [Optimistic updates](/guides/optimistic/) — predict a query while the mutation is in flight.

<details>
<summary>Spec & diagnostics</summary>

Mutation lifecycle: SPEC §9.1 and §10.3. Access decisions: SPEC §10.2/KV436. CSRF and replay order:
SPEC §10.3 request lifecycle. Opaque write declarations: KV406. Direct write-capable DB access in
app-authored request code is **KV330** where the static data-plane gate owns that boundary. Stale
version conflicts use KV429.

</details>
