---
title: Mutations & forms
description: Post a typed form, keep reads in the handler, route writes through a named domain helper, and refresh stale query-backed UI after commit.
order: 2
---

# Mutations & forms

Use a mutation when a browser form or enhanced submit changes server data. The same declaration works
with JavaScript disabled and with the enhanced client. The handler validates input and can do reads.
The writes themselves live in a named domain helper. Kovo commits, then reruns the invalidated
queries and sends fresh fragments back.

## Add the mutation

Start with the smallest useful POST:

```ts
import { domain, publicAccess, mutation, s } from '@kovojs/server';

const cart = domain('cart');
const addCartRow = async (_db: unknown, _input: unknown) => {};

export const addToCart = mutation({
  access: publicAccess('demo cart is intentionally public'),
  csrf: cartCsrf,
  input: s.object({ productId: s.string(), quantity: s.number().int().min(1) }),
  registry: { touches: [cart] },
  async handler(input, request) {
    await addCartRow(request.db, input);
  },
});
```

The input schema parses form data. The access decision is explicit. CSRF stays on for browser forms.
`registry.touches` names the invalidation domain. The write goes through `addCartRow(...)`, not a
direct `request.db.insert(...)` inside the handler body.

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
const addCartRow = async (_db: unknown, _input: unknown) => {};

export const addToCart = mutation({
  access: publicAccess('demo cart is intentionally public'),
  csrf: cartCsrf,
  input: addToCartInput,
  registry: { touches: [cart] },
  errors: {
    OUT_OF_STOCK: s.object({ available: s.number().int().min(0) }),
  },
  async handler(input, request, context) {
    const [row] = await request.db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, input.productId));
    if (!row || row.stock < input.quantity) {
      return context.fail('OUT_OF_STOCK', { available: row?.stock ?? 0 });
    }
    await addCartRow(request.db, input);
    return { ok: true };
  },
});
```

The enhanced response morphs the submitted form with the failure state. The no-JS response rerenders
the page with the same typed failure.

## Put the write in the domain layer

Here's the helper shape the compiler accepts:

```ts
import { domain } from '@kovojs/server';

export const cart = domain('cart');

export async function addCartRow(
  db: { insert(table: unknown): { values(value: unknown): Promise<void> } },
  input: { productId: string; quantity: number },
) {
  await db.insert(cartItems).values({
    productId: input.productId,
    qty: input.quantity,
  });
}
```

This is the contract from `packages/compiler/src/direct-db.test.ts`: mutation handlers may read
through `request.db`, but writes in the handler body fail the graph check. Route the write through a
named helper or domain operation instead.

## Declare opaque writes

Raw SQL and helper calls that hide the write need registry facts:

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

The helper may use raw SQL internally. `tables` is checked at the SQL execution boundary. If
production SQL mutates a table outside the allowlist, the runtime fails closed and invalidates the
declared `touches` domains conservatively.

## Handle failure

If you write directly in the handler body, `kovo check` reports the real diagnostic:

```txt
ERROR KV330 cart.mutation.ts:12 Direct db access in a mutation handler; route through domain. handler addToCart receives db.
```

That wording comes from the compiler's direct-db coverage. The fix is always the same: keep reads in
the handler, move writes into a named helper or domain module, and point `registry.touches` at the
Domain values those writes affect.

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
kovo check
```

`vp check` covers the type/lint side of the form and handler wiring. `kovo check` is the graph gate
that reports direct handler writes, opaque writes, and the invalidation coverage facts.

## Next

- [Queries & invalidation](/guides/queries/) — see how visible queries refresh after a mutation.
- [Optimistic updates](/guides/optimistic/) — predict a query while the mutation is in flight.

<details>
<summary>Spec & diagnostics</summary>

Mutation lifecycle: SPEC §9.1 and §10.3. Access decisions: SPEC §10.2/KV436. CSRF and replay order:
SPEC §10.3 request lifecycle. Opaque write declarations: KV406. Direct handler writes are KV330:
"Direct db access in a mutation handler; route through domain." Stale version conflicts use KV429.

</details>
