# Worked Example: Add to Cart

One feature traversing every layer:

```text
schema.ts          products(domain:'product', key:id), cart_items(domain:'cart')
cart.domain.ts     cart.addItem - upsert cart_items + decrement products.stock
                   => touch-graph: {cart, product:productId}            [STATIC, SPEC §11.1]
cart.queries.ts    cartQuery (count, jsonAgg) reads {cart, product}    [JOIN = declaration]
cart.mutations.ts  addToCart: guard authed, schema input, OUT_OF_STOCK error
                   => invalidates {cart, product:productId}             [DERIVED]
                   => optimistic: 2 transforms                          [HAND-WRITTEN, SPEC §10.4;
                                                                        derived in v2, SPEC §10.5]
products.routes.ts route('/products/:id') - params/search schemas; <Link>s and
                   redirect() targets type-checked vs RouteRegistry            [SPEC §6.4]
product.tsx        <f.Form> - fields type-checked & completeness-checked vs schema
cart-badge.tsx     {cart.count} => data-bind="cart.count" stamp         [DERIVED, SPEC §4.8;
                   kovo-deps="cart"; coverage: plan ok                  KV311 SPEC §4.9 - no code]
```

User click with JavaScript loaded:

```text
snapshot -> badge ticks instantly (kovo-pending) ->
POST /_m/cart/add (Kovo-Targets from live DOM) -> tx commits ->
<kovo-query name="cart"> + <kovo-fragment target="recommendations"> ->
morph reconciles (no-op if prediction was right)
```

User click with no JavaScript:

```text
form POSTs -> redirect -> fresh page. Same handler.
```

When a teammate later ships `<mini-cart>` with `queries:{cart}`, it is
optimistically updated by every cart mutation already written.

## Typed mutation and form

The mutation value is the type source for form fields, failure rendering, programmatic submit, and
the emitted wire metadata:

```ts
// cart.mutations.ts
export const addToCart = mutation('cart/add', {
  guard: authed,
  input: s.object({
    productId: s.string(),
    quantity: s.number().int().min(1).default(1),
  }),
  errors: { OUT_OF_STOCK: s.object({ availableQuantity: s.number() }) },
  async handler(input, req, { fail }) {
    const ok = await cart.addItem(req.db, req.session.cartId, input.productId, input.quantity);
    if (!ok) return fail('OUT_OF_STOCK', { availableQuantity: ok.available });
    // No invalidate() call: cart.addItem's touch set drives invalidation (SPEC §11).
  },
});
```

```tsx
// product.tsx
export const AddToCartForm = component({
  queries: { product: productQuery.args((p) => ({ id: p.productId })) },
  props: s.object({ productId: s.string() }),
  mutations: { addToCart },
  render: ({ product }, _state, { productId }) => (
    <form enhance mutation={addToCart} key={productId}>
      <input type="hidden" name="productId" value={productId} />
      <input name="quantity" type="number" min={1} defaultValue={1} />
      <FieldError name="quantity" />
      <FormError
        code="OUT_OF_STOCK"
        message={(failure) => `Only ${failure.payload.availableQuantity} left.`}
      />
      <button disabled={product.stock <= 0}>Add to cart</button>
    </form>
  ),
});
// Emits a real form action such as:
// <form method="post" action="/_m/cart/add" enhance data-mutation="cart/add" kovo-key="p1">
```

Programmatic submit uses the same exhaustive error union:

```ts
ctx.submit(addToCart, {
  input: { productId: ctx.params.productId, quantity: 1 },
  onError: (err) => {
    if (err.code === 'OUT_OF_STOCK') toast(`Only ${err.payload.availableQuantity} left`);
  },
});
```
