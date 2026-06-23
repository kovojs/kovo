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
  queue: 'cart',
  optimistic: {
    cart(draft, input) {
      draft.count = (draft.count ?? 0) + input.quantity;
    },
    productGrid: 'await-fragment',
  },
  transaction(request: CommerceRequest, run) {
    return request.db.transaction((db) => run({ ...request, db }));
  },
  handler(input, request, context) {
    const found = request.db.products.get(input.productId);
    if (!found || found.stock < input.quantity) {
      return context.fail('OUT_OF_STOCK', { availableQuantity: found?.stock ?? 0 });
    }
    // writes go through the domain layer (db.<domain>.<write>) — direct db access here is KV330.
    // See queries.md "Where invalidation comes from" and /guides/data-layer/ for write() authoring.
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
- **`optimistic`** is query-keyed prediction for the same write. Each transform mutates a cloned
  query draft; `'await-fragment'` records that this query should wait for server truth. `queue`
  names the FIFO lane for submissions that must stay ordered.

## Render the form

In TSX, bind the form to the mutation value and give repeated forms ordinary component identity:

```tsx
<form enhance mutation={addToCart} key={productId}>
  <input type="hidden" name="productId" value={productId} />
  <input name="quantity" type="number" min="1" defaultValue={1} />
  {forms.addToCart.failure ? <output role="alert">Unable to add this item.</output> : null}
  <button type="submit">Add</button>
</form>
```

The compiler emits the concrete action URL, mutation metadata, CSRF field, `kovo-key`, and the
submitted-form target. The served HTML is still an ordinary form:

```html
<form method="post" action="/_m/cart/add" enhance data-mutation="cart/add" kovo-key="p1">
  <input type="hidden" name="kovo-csrf" value="…" />
  <input type="hidden" name="productId" value="p1" />
  <input name="quantity" type="number" min="1" value="1" />
  <button type="submit">Add</button>
</form>
```

With JavaScript disabled, this form posts. The only author-facing framework-specific part is the
`enhance` marker, which the loader uses to intercept submission when JS is present.

Field names are type-checked against the mutation's input schema. A missing required field or a
typo'd `name` is a compile error, so you find out at build time instead of in production:

```ts
import { form } from '@kovojs/core';

const f = form(addToCart); // mutation value validated; input type inferred
// `f` carries the inferred input type, so the rendered form's field `name`s and
// its FieldError slots are checked against the schema — a renamed or missing
// required field is a compile error at every call site.
```

## CSRF is on by default

`kovo-csrf` is a session-bound token stamped into every emitted mutation form. The server verifies
it before anything else — before schema parsing, before replay lookup, before guards. In app code,
you render the field:

```ts
import { csrfField } from '@kovojs/server';

const csrf = csrfField(request, commerceCsrf); // → <input type="hidden" name="kovo-csrf" value="…">
```

CSRF stays on for server-rendered mutation endpoints unless you set `csrf: false` on a mutation,
which you reserve for non-browser or externally authenticated endpoints. When `req.session` exists,
the token is bound to that session. When the user is anonymous, it is bound to a framework-owned
signed-cookie secret, so pre-auth forms like login, signup, and password reset are CSRF-protected
before there is a session to bind to.

A `csrf: false` mutation may not read `req.session` or run a session/cookie-derived guard such as
`authed`, `role()`, or `owns()`; that is **KV418** because the mutation would skip CSRF while still
riding ambient browser authority. Truly non-browser writes belong in
[endpoints and webhooks](/guides/endpoints-webhooks/). Any opt-out shows up in the
`kovo explain --endpoints` audit with its justification.

## The request lifecycle

Every mutation POST runs the same pipeline:

```
pre-dispatch size/rate limits → CSRF validation → replay reservation by idempotency key
→ parse + coerce input (schema)
→ guard chain → BEGIN tx → handler (Tx-typed db; escaping the tx is a type error)
→ COMMIT → re-run invalidated queries (post-commit) → render <kovo-query>/<kovo-fragment> → respond
                     ↘ on fail(): ROLLBACK → typed error fragment, 422
```

Queries re-run after commit, so a response never renders pre-commit data — which would visibly
revert the user's optimistic update. The `Kovo-Idem` hidden field makes duplicate submissions
replayable: the server atomically reserves `(principal, mutation, idem-token)` before parsing input.
A concurrent submit carrying the same triple waits for the winning submit to settle and then replays
that stored response instead of running the handler again.

`Kovo-Idem` is per-submit, not per-form. The client mints a fresh high-entropy token for each
logical submit, and an enhanced success response refreshes the hidden field. Editing a form and
submitting again is therefore a new mutation rather than a replay of the first response.

## The enhanced round-trip

With JS present, the loader intercepts the submit and turns it into a fetch. You can read the whole
exchange in the Network panel:

```http
POST /_m/cart/add HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Kovo-Fragment: true
Kovo-Targets: cart-badge=cart; product-grid=product; order-history=order
Kovo-Live-Targets: cart-badge#components/cart-badge/cart-badge:{}; …
Kovo-Idem: 7f3a-…

productId=p1&quantity=2&kovo-csrf=…
```

```http
HTTP/1.1 200 OK
Content-Type: text/vnd.kovo.fragment+html; charset=utf-8
Kovo-Changes: [{"domain":"cart","keys":["cart"]},{"domain":"product","keys":["p1"]}]

<kovo-query name="cart">{"count": 3, "items": […]}</kovo-query>
<kovo-fragment target="recommendations">
  <!-- server-rendered HTML — the SAME render function full page loads use -->
</kovo-fragment>
```

What each piece does:

- **`Kovo-Targets`** and **`Kovo-Live-Targets`** are read off compiler-emitted DOM stamps at submit
  time. The server keeps no session of what's on screen; it answers a self-contained question.
  Singleton targets look like `cart-badge=cart`; repeated targets include their keyed suffix, such
  as `product-form:p2=product:p2`. `Kovo-Live-Targets` adds the generated component id and
  serializable props needed to reconstruct the visible component instance. This matters for
  [deployment](/guides/deployment/).
- **`<kovo-query>`** chunks replace the client's query values and run each query's update plan across
  every dependent island. When §4.8 bindings cover the affected output, query JSON or prod deltas
  are preferred over a full fragment.
- **`<kovo-fragment>`** chunks are DOM-morphed in by default, so focus, scroll, selection, and
  browser-owned element state survive. The morph carries no serialization of island-local
  `kovo-state`: an island declaring local `state` inside another component's server-refreshable
  target is **KV420**, because refreshing the parent would clobber the child's private state. They
  are sent for affected live targets whose output is not fully covered by the query update plan.
  `mode="append"` is the explicit vocabulary for pagination and streams.
- **`Kovo-Changes`** is the sanitized summary of committed writes — `{domain, keys}` only, never
  mutation input or failure detail.

Fragments are rendered by compiler-generated live-target renderers for the same query-backed
components your route pages compose, so a partial can't drift from the page it patches. App code
does not route ordinary success fragments by mutation key.

## The no-JS path: POST-redirect-GET

When the same endpoint sees no `Kovo-Fragment` header, it answers with PRG. In the commerce app's
tests, a successful no-JS `cart/add` returns `303` with `Location: /cart` and
`Cache-Control: no-store`, and the next GET renders the updated page. Errors re-render the full page
with messages in place. You don't write success fragment routing: query-backed components declare the
data they need, and Kovo reruns those queries after the mutation commits.

```ts
export const cartPage = route('/cart', {
  page: () => <CartPage />,
});

export const addToCart = mutation('cart/add', {
  csrf: commerceCsrf,
  input: addToCartInput,
  registry: { queries: [cartQuery, productGridQuery] },
  handler(input, request) {
    return request.db.cart.add(input);
  },
});
```

The app declares the page, mutation, input schema, and affected queries. Kovo's request shell owns
the endpoint response: PRG for no-JS success, typed 422 pages for failures, and fragment/query
chunks for enhanced submissions.

`registry.queries` isn't a refresh-target list — that contradiction is only apparent. _Which_
queries go stale is still derived from the touch graph (SPEC §10.3); `registry.queries` just hands
the runtime the query _definitions_ it needs to actually re-run after commit. In a fully compiled
app the build wires this for you (it merges the derived query set into `registry`), so you only spell
it out in hand-authored or partially-wired modules where the analyzer can't reach the definitions.
You never enumerate components or DOM targets here — those stay derived from the live `kovo-deps`
stamps at request time.

## Handle a failure: the 422 path

Failures use the same one endpoint. Validation failures (schema, with field paths) and declared
error codes return HTTP 422. The enhanced path infers the submitted form target and morphs just that
form with typed `forms.addToCart.failure` state; the no-JS path re-renders the page with the same
state. Here is the commerce app's out-of-stock failure on the enhanced path:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: text/vnd.kovo.fragment+html; charset=utf-8

<kovo-fragment target="product-form:p2">
  <form method="post" action="/_m/cart/add" enhance data-mutation="cart/add" kovo-key="p2">…
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

## Auth failures are not all form errors

Mutation guard failures distinguish "not signed in" from "signed in but not allowed."

An unauthenticated `authed` failure, such as an expired session on submit, is not part of the typed
422 form union. The enhanced path returns HTTP 401 with a `Kovo-Reauth` directive carrying the login
route and a same-origin `next` URL; the loader follows it so the user can re-authenticate. The no-JS
path returns a 303 redirect to the login route with the same validated `next` value.

An authenticated-but-unauthorized failure keeps the typed failure path: HTTP 403 with
`forms.<mutation>.failure` carrying an `unauthorized` code. That lets a permission-denied UI render
in the submitted form without confusing routine session expiry with validation.

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
- [Endpoints & webhooks](/guides/endpoints-webhooks/) — non-browser writes and CSRF exemptions.
- [Testing](/guides/testing/) — mutations as request/response assertions, no browser.

<details>
<summary>Spec & diagnostics</summary>

The mutation contract and the enhanced round-trip: SPEC §9.1. Declare-once derivation: SPEC §6.3.
Input schema and FormData coercion, plus CSRF default-on: SPEC §6.6. Typed errors and the 422 path:
SPEC §9.2. The guard chain, the unguarded audit, and the request lifecycle: SPEC §10.3. The
endpoints audit: SPEC §11.4. Anonymous CSRF and KV418: SPEC §6.6. Replay reservation and per-submit
`Kovo-Idem`: SPEC §10.3. Fragment morph state preservation and KV420: SPEC §9.1 and §4.5. Update
plans across dependent islands: SPEC §4.8. Direct db access in a handler is **KV330**. The
`kovo explain` artifact format: SPEC §5.3.

</details>
