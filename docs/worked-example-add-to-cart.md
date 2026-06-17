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
