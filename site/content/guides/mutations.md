---
title: Mutations & forms
description: Write to the server through real forms, with typed inputs, typed errors, and a round-trip you can read in the Network panel.
order: 2
---

# Mutations & forms

A mutation is a named, schema-validated POST. Its no-JS form is the contract; the enhanced
JavaScript path is an upgrade of the same endpoint, not a different one. One handler, two
response modes. By the end of this guide you'll have followed one mutation from declaration to
the bytes on the wire — including what happens when it fails. SPEC §9.1

## Declare a mutation

```ts
// app.ts — the commerce reference app's shape
import { guards, mutation, s } from '@jiso/server';

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
    // writes go through the domain layer — direct db access in handlers is lint FW330
    return { productId: input.productId, quantity: input.quantity };
  },
});
```

Everything here is declared exactly once and derived everywhere else. SPEC §6.3

- **`input`** is the single source of truth for field names, types, _and_ FormData coercion.
  Attribute and form values arrive as strings; `s.number().int().min(1).default(1)` says how
  `quantity` becomes a number, once, schema-style. The same schema validates the wire at runtime —
  types-without-validators was rejected. SPEC §6.6
- **`errors`** declares the failure vocabulary. `context.fail('OUT_OF_STOCK', …)` is typed against
  it, and consumers receive an exhaustive discriminated union. SPEC §9.2
- **`guard`** composes combinators; `authed` refines `req.session` so the user is non-null inside
  the handler, and every mutation joins the `fw explain --unguarded` audit — the report of
  everything reachable without authentication. SPEC §10.3

## The form is the output

The rendered form is a real form. This is what the commerce app serves:

```html
<form method="post" action="/_m/cart/add" enhance>
  <input type="hidden" name="fw-csrf" value="…" />
  <input type="hidden" name="productId" value="p1" />
  <input name="quantity" type="number" min="1" value="1" />
  <button type="submit">Add</button>
</form>
```

With JavaScript disabled, this form simply posts. Nothing about it is framework-flavored except
the `enhance` marker the loader uses to intercept submission when JS _is_ present.

On the authoring side, field names and completeness are type-checked against the mutation's input
schema — a missing required field or a typo'd `name` is a compile error, not a silent validation
failure in production. SPEC §6.3

```ts
import { form, formFields } from '@jiso/core';

const f = form('cart/add'); // key validated against MutationRegistry; input type inferred
formFields(f, ['productId', 'quantity']); // ✗ compile error if a required field is missing
```

## CSRF is on by default

`fw-csrf` is a session-bound synchronizer token stamped into every emitted mutation form and
verified before anything else happens — before schema parsing, before replay lookup, before
guards. In app code that means rendering the field: SPEC §6.6

```ts
import { csrfField } from '@jiso/server';

const csrf = csrfField(request, commerceCsrf); // → <input type="hidden" name="csrf" value="…">
```

CSRF is default-on for server-rendered mutation endpoints. The only opt-out is an explicit
`csrf: false` per mutation, reserved for non-browser or externally authenticated endpoints —
and that posture is visible in the `fw explain --endpoints` audit. SPEC §11.4

## The request lifecycle

Every mutation POST runs the same fixed pipeline. SPEC §10.3

```
CSRF validation → replay lookup by idempotency key → parse + coerce input (schema)
→ guard chain → BEGIN tx → handler (Tx-typed db; escaping the tx is a type error)
→ COMMIT → re-run invalidated queries (post-commit) → render <fw-query>/<fw-fragment> → respond
                     ↘ on fail(): ROLLBACK → typed error fragment, 422
```

Queries re-run _after_ commit, so a response can never render pre-commit data — which would
visibly revert the user's optimistic update. The `FW-Idem` hidden field makes duplicate
submissions replayable: the server answers a duplicate with the stored response instead of
re-executing the handler. SPEC §10.3, §9.1

## The enhanced round-trip

With JS present, the loader intercepts the submit and turns it into a fetch. The wire is designed
to be read in the Network panel. SPEC §9.1

```http
POST /_m/cart/add HTTP/1.1
Content-Type: application/x-www-form-urlencoded
FW-Fragment: true
FW-Targets: cart-badge=cart; product-grid=product; order-history=order
FW-Idem: 7f3a-…

productId=p1&quantity=2&fw-csrf=…
```

```http
HTTP/1.1 200 OK
Content-Type: text/vnd.jiso.fragment+html; charset=utf-8
FW-Changes: [{"domain":"cart","keys":["cart"]},{"domain":"product","keys":["p1"]}]

<fw-query name="cart">{"count": 3, "items": […]}</fw-query>
<fw-fragment target="cart-badge">
  <!-- server-rendered HTML — the SAME render function full page loads use -->
</fw-fragment>
```

The pieces:

- **`FW-Targets`** is read off the live DOM's `fw-deps` stamps at submit time. The server holds no
  session of what's on screen — it answers a stateless question. This matters for
  [deployment](/guides/deployment/).
- **`<fw-query>`** chunks replace the client's query values and run each query's update plan across
  every dependent island. SPEC §4.8
- **`<fw-fragment>`** chunks are DOM-morphed in by default, so focus, scroll, selection, and nested
  island state survive; `mode="append"` is the explicit vocabulary for pagination and streams.
- **`FW-Changes`** is the sanitized summary of committed writes — `{domain, keys}` only, never
  mutation input or failure detail.

A fragment update is a tiny navigation, not a different programming model: fragments are rendered
by the same functions as full pages, so partials cannot drift from pages. SPEC §9.1

## The no-JS path: POST-redirect-GET

The same endpoint, seeing no `FW-Fragment` header, answers PRG. From the commerce app's tests:
a successful no-JS `cart/add` returns `303` with `Location: /cart` and `Cache-Control: no-store`,
and the next GET renders the updated page. Errors re-render the full page with messages in place.
You do not write this twice — the server helper renders both modes from one declaration. SPEC §9.1

```ts
import { renderMutationEndpointResponse } from '@jiso/server';

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
  headers, // FW-Fragment / FW-Targets, when present
  request,
});
```

## When a mutation fails: the 422 path

Failures get the same one-endpoint treatment. Validation failures (schema, with field paths) and
declared error codes return HTTP 422 with a fragment that re-renders the form with messages; the
enhanced path morphs just the form, the no-JS path re-renders the page. The commerce app's
out-of-stock failure on the enhanced path is exactly: SPEC §9.2

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: text/vnd.jiso.fragment+html; charset=utf-8

<fw-fragment target="product-form:p2">
  <form method="post" action="/_m/cart/add" enhance>…
    <output role="alert" data-error-code="OUT_OF_STOCK">Only 2 available.</output>
  </form>
</fw-fragment>
```

Because the form is morphed (not replaced), the user's field values and focus survive the error.
Programmatic submission gets the same union, typed:

```ts
ctx.submit(addToCart, {
  input: { productId, quantity: 1 },
  onError: (err) => {
    if (err.code === 'OUT_OF_STOCK') toast(`Only ${err.data.availableQuantity} left`);
    // err is the exhaustive union of declared codes plus VALIDATION (SPEC §6.3)
  },
});
```

Unexpected server failures stay outside the typed union and never leak internals: rendering
failures after commit return a render-error fragment with HTTP 500 and a sanitized `FW-Changes`
header for writes that already committed. SPEC §9.2

## Audit what you built

This is real output from the commerce reference app's committed graph:

```sh
fw explain mutation cart/add graph.json
```

```txt
fw-explain/v1
MUTATION cart/add
guards: authed,rateLimit:session
session: commerceSession
input-fields: productId,quantity
writes: cart,product,order
invalidates: cart,product,order
manual-invalidates: -
updates: cart->component:CartBadge,page:/cart; orderHistory->component:OrderHistory,page:/cart; productGrid->component:ProductGrid,page:/cart
```

Guard chain, input surface, write set, derived invalidations, and every consumer that updates —
one diffable artifact. See [reading fw check & fw explain](/guides/fw-explain/). SPEC §5.3

## Next

- [Optimistic updates](/guides/optimistic/) — make the round-trip feel instant.
- [Queries & invalidation](/guides/queries/) — where `invalidates:` comes from.
- [Testing](/guides/testing/) — mutations as request/response assertions, no browser.
