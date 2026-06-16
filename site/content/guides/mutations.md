---
title: Mutations & forms
description: Write to the server through one real form that works with or without JavaScript, with typed inputs and typed errors.
order: 2
---

# Mutations & forms

You need an "Add to cart" button that posts to the server, validates its input, refreshes the
badge, and shows a typed error when the item is out of stock. You write that once, as a single
mutation. The no-JS form posts it; the enhanced path fetches the same endpoint and morphs the
result in. This guide follows one mutation from declaration to the bytes on the wire, including
what happens when it fails.

## Declare a mutation

A mutation is a named POST with a schema-validated input. Here is the one the commerce reference
app uses:

```ts
// app.ts — the commerce reference app's shape
import { guards, mutation, s } from '@kovojs/server';

export const addToCart = mutation('cart/add', {
  csrf: commerceCsrf,
  input: s.object({
    productId: s.string(),
    quantity: s.number().int().min(1).default(1), // FormData coercion declared here
  }),
  errors: {
    OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
  },
  guard: guards.all(
    guards.authed<CommerceRequest>(),
    guards.rateLimit<CommerceRequest>({ max: 10, per: 'session' }),
  ),
  transaction(request: CommerceRequest, run) {
    return request.db.transaction((db) => run({ ...request, db }));
  },
  handler(input, request, context) {
    const found = request.db.products.get(input.productId);
    if (!found || found.stock < input.quantity) {
      return context.fail('OUT_OF_STOCK', { availableQuantity: found?.stock ?? 0 });
    }
    // writes go through the domain layer — direct db access in handlers is a lint error
    return { productId: input.productId, quantity: input.quantity };
  },
});
```

You declare each part once, and the framework derives the rest from it:

- **`input`** names the fields, their types, and their FormData coercion. Form values arrive as
  strings; `s.number().int().min(1).default(1)` says how `quantity` becomes a number. The same
  schema validates the wire at runtime.
- **`errors`** is the failure vocabulary. `context.fail('OUT_OF_STOCK', …)` is typed against it,
  and callers receive an exhaustive discriminated union.
- **`guard`** composes from combinators. `authed` refines `req.session` so the user is non-null
  inside the handler, and every mutation shows up in the `kovo explain --unguarded` audit — the
  report of everything reachable without authentication.

## Render the form

The rendered form is an ordinary form. This is what the commerce app serves:

```html
<form method="post" action="/_m/cart/add" enhance>
  <input type="hidden" name="kovo-csrf" value="…" />
  <input type="hidden" name="productId" value="p1" />
  <input name="quantity" type="number" min="1" value="1" />
  <button type="submit">Add</button>
</form>
```

With JavaScript disabled, this form posts. The only framework-specific part is the `enhance`
marker, which the loader uses to intercept submission when JS is present.

Field names are type-checked against the mutation's input schema. A missing required field or a
typo'd `name` is a compile error, so you find out at build time instead of in production:

```ts
import { form, formFields } from '@kovojs/core';

const f = form('cart/add'); // key validated against MutationRegistry; input type inferred
formFields(f, ['productId', 'quantity']); // ✗ compile error if a required field is missing
```

## CSRF is on by default

`kovo-csrf` is a session-bound token stamped into every emitted mutation form. The server verifies
it before anything else — before schema parsing, before replay lookup, before guards. In app code,
you render the field:

```ts
import { csrfField } from '@kovojs/server';

const csrf = csrfField(request, commerceCsrf); // → <input type="hidden" name="csrf" value="…">
```

CSRF stays on for server-rendered mutation endpoints unless you set `csrf: false` on a mutation,
which you reserve for non-browser or externally authenticated endpoints. Any opt-out shows up in
the `kovo explain --endpoints` audit.

## The request lifecycle

Every mutation POST runs the same pipeline:

```
CSRF validation → replay lookup by idempotency key → parse + coerce input (schema)
→ guard chain → BEGIN tx → handler (Tx-typed db; escaping the tx is a type error)
→ COMMIT → re-run invalidated queries (post-commit) → render <kovo-query>/<kovo-fragment> → respond
                     ↘ on fail(): ROLLBACK → typed error fragment, 422
```

Queries re-run after commit, so a response never renders pre-commit data — which would visibly
revert the user's optimistic update. The `Kovo-Idem` hidden field makes duplicate submissions
replayable: the server answers a duplicate with the stored response instead of running the handler
again.

## The enhanced round-trip

With JS present, the loader intercepts the submit and turns it into a fetch. You can read the whole
exchange in the Network panel:

```http
POST /_m/cart/add HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Kovo-Fragment: true
Kovo-Targets: cart-badge=cart; product-grid=product; order-history=order
Kovo-Idem: 7f3a-…

productId=p1&quantity=2&kovo-csrf=…
```

```http
HTTP/1.1 200 OK
Content-Type: text/vnd.kovo.fragment+html; charset=utf-8
Kovo-Changes: [{"domain":"cart","keys":["cart"]},{"domain":"product","keys":["p1"]}]

<kovo-query name="cart">{"count": 3, "items": […]}</kovo-query>
<kovo-fragment target="cart-badge">
  <!-- server-rendered HTML — the SAME render function full page loads use -->
</kovo-fragment>
```

What each piece does:

- **`Kovo-Targets`** is read off the live DOM's `kovo-deps` stamps at submit time. The server keeps no
  session of what's on screen; it answers a self-contained question. This matters for
  [deployment](/guides/deployment/).
- **`<kovo-query>`** chunks replace the client's query values and run each query's update plan across
  every dependent island.
- **`<kovo-fragment>`** chunks are DOM-morphed in by default, so focus, scroll, selection, and nested
  island state survive. `mode="append"` is the explicit vocabulary for pagination and streams.
- **`Kovo-Changes`** is the sanitized summary of committed writes — `{domain, keys}` only, never
  mutation input or failure detail.

Fragments are rendered by the same functions as full pages, so a partial can't drift from the page
it patches.

## The no-JS path: POST-redirect-GET

When the same endpoint sees no `Kovo-Fragment` header, it answers with PRG. In the commerce app's
tests, a successful no-JS `cart/add` returns `303` with `Location: /cart` and
`Cache-Control: no-store`, and the next GET renders the updated page. Errors re-render the full page
with messages in place. You don't write this path twice — one server helper renders both modes from
the same declaration:

```ts
import { renderMutationEndpointResponse } from '@kovojs/server';

return renderMutationEndpointResponse(addToCart, {
  csrf: commerceCsrf,
  fragmentRenderers: [
    { target: 'cart-badge', render: () => CartBadge.definition.render() },
    { target: 'order-history', render: () => renderOrderHistory(request.db) },
  ],
  rawInput,
  redirectTo: '/cart', // the PRG destination for the no-JS mode
  renderFailureFragment: (failure) => renderAddToCartForm(item, failure, request),
  renderFailurePage: (failure) => renderCartPage(request.db, { failure }, request),
  headers, // Kovo-Fragment / Kovo-Targets, when present
  request,
});
```

## Handle a failure: the 422 path

Failures use the same one endpoint. Validation failures (schema, with field paths) and declared
error codes return HTTP 422 with a fragment that re-renders the form with messages. The enhanced
path morphs just the form; the no-JS path re-renders the page. Here is the commerce app's
out-of-stock failure on the enhanced path:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: text/vnd.kovo.fragment+html; charset=utf-8

<kovo-fragment target="product-form:p2">
  <form method="post" action="/_m/cart/add" enhance>…
    <output role="alert" data-error-code="OUT_OF_STOCK">Only 2 available.</output>
  </form>
</kovo-fragment>
```

Because the form is morphed rather than replaced, the user's field values and focus survive the
error. A programmatic submission gets the same typed union:

```ts
ctx.submit(addToCart, {
  input: { productId, quantity: 1 },
  onError: (err) => {
    if (err.code === 'OUT_OF_STOCK') toast(`Only ${err.data.availableQuantity} left`);
    // err is the exhaustive union of declared codes plus VALIDATION
  },
});
```

Unexpected server failures stay outside the typed union and don't leak internals. A render failure
after commit returns a render-error fragment with HTTP 500 and a sanitized `Kovo-Changes` header for
the writes that already committed.

## Audit what you built

This is real output from the commerce reference app's committed graph:

```sh
kovo explain mutation cart/add graph.json
```

```txt
kovo-explain/v1
MUTATION cart/add
guards: authed,rateLimit:session
session: commerceSession
input-fields: productId,quantity
writes: cart,product,order
invalidates: cart,product,order
manual-invalidates: -
updates: cart->component:CartBadge,page:/cart; orderHistory->component:OrderHistory,page:/cart; productGrid->component:ProductGrid,page:/cart
```

One diffable artifact gives you the guard chain, the input surface, the write set, the derived
invalidations, and every consumer that updates. See
[reading kovo check & kovo explain](/guides/kovo-explain/).

## Next

- [Optimistic updates](/guides/optimistic/) — make the round-trip feel instant.
- [Queries & invalidation](/guides/queries/) — where `invalidates:` comes from.
- [Testing](/guides/testing/) — mutations as request/response assertions, no browser.

<details>
<summary>Spec & diagnostics</summary>

The mutation contract and the enhanced round-trip: SPEC §9.1. Declare-once derivation: SPEC §6.3.
Input schema and FormData coercion, plus CSRF default-on: SPEC §6.6. Typed errors and the 422 path:
SPEC §9.2. The guard chain, the unguarded audit, and the request lifecycle: SPEC §10.3. The
endpoints audit: SPEC §11.4. Update plans across dependent islands: SPEC §4.8. Direct db access in a
handler is **KV330**. The `kovo explain` artifact format: SPEC §5.3.

</details>
