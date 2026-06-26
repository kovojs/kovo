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

A mutation is a named POST with a schema-validated input. Start with the write the form needs:

```ts
import { mutation, s } from '@kovojs/server';

export const addToCart = mutation('cart/add', {
  input: s.object({ productId: s.string(), quantity: s.number().int().min(1).default(1) }),
  handler(input, request) {
    return request.db.cart.add(input);
  },
});
```

That is enough to get a typed form posting to one endpoint. `quantity` arrives from `FormData` as a
string; the schema says how it becomes a number. The handler writes through the data layer, so the
same write can feed invalidation, testing, and optimistic proof.

## Add CSRF and guards

Browser forms carry ambient cookies, so mutation endpoints are CSRF-checked by default. In a
server-rendered form, Kovo stamps a `kovo-csrf` hidden field and verifies it before parsing input or
running guards:

```ts
import { csrfField } from '@kovojs/server';

const csrf = csrfField(request, commerceCsrf);
```

Set `csrf: false` only for non-browser or externally authenticated writes. If a write uses browser
session authority, keep CSRF on and express authorization as a guard:

```ts
import { guards } from '@kovojs/server';

export const addToCart = mutation('cart/add', {
  csrf: commerceCsrf,
  guard: guards.all(
    guards.authed<CommerceRequest>(),
    guards.rateLimit<CommerceRequest>({ max: 10, per: 'session' }),
  ),
  input: addToCartInput,
  handler: addToCartHandler,
});
```

`authed` refines `req.session` before the handler runs. The rate limiter belongs in the same chain,
so the audit can print the whole browser-reachable posture.

## Add typed errors

Expected failures are part of the mutation contract. Declare them once, then return them from the
handler:

```ts
export const addToCart = mutation('cart/add', {
  input: addToCartInput,
  errors: { OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }) },
  handler(input, request, context) {
    const found = request.db.products.get(input.productId);
    if (!found || found.stock < input.quantity) {
      return context.fail('OUT_OF_STOCK', { availableQuantity: found?.stock ?? 0 });
    }
    return request.db.cart.add(input);
  },
});
```

Validation failures and declared failures return typed form state. The enhanced path morphs the
submitted form. The no-JS path re-renders the page with the same failure.

## Add transaction and queueing

Use `transaction` when the handler needs a real commit/rollback boundary:

```ts
export const addToCart = mutation('cart/add', {
  input: addToCartInput,
  transaction(request: CommerceRequest, run) {
    return request.db.transaction((db) => run({ ...request, db }));
  },
  handler: addToCartHandler,
});
```

Use `queue` when multiple submissions from the same client must stay ordered. The client applies
optimistic transforms when each submit is enqueued, sends only the queue head, and then rebases
remaining predictions over server truth:

```ts
export const addToCart = mutation('cart/add', {
  input: addToCartInput,
  queue: 'cart',
  handler: addToCartHandler,
});
```

## Add optimism

Optimism is keyed to queries, not components. Each entry predicts the query value that the server
will send after commit:

```ts
export const addToCart = mutation('cart/add', {
  input: addToCartInput,
  optimistic: {
    cart(draft, input) {
      draft.count = (draft.count ?? 0) + input.quantity;
    },
    productGrid: 'await-fragment',
  },
  handler: addToCartHandler,
});
```

`'await-fragment'` is honest: this query should wait for server truth because the app has not
declared a safe prediction for it.

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
`authed`, `role()`, or `owns()` because the mutation would skip CSRF while still riding ambient
browser authority. Truly non-browser writes belong in [endpoints and webhooks](/guides/endpoints-webhooks/).
Any opt-out shows up in the `kovo explain --endpoints` audit with its justification.

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
  every dependent island. When bindings cover the affected output, query JSON or prod deltas
  are preferred over a full fragment.
- **`<kovo-fragment>`** chunks are DOM-morphed in by default, so focus, scroll, selection, and
  browser-owned element state survive. The morph carries no serialization of island-local
  `kovo-state`: an island declaring local `state` inside another component's server-refreshable
  target is rejected because refreshing the parent would clobber the child's private state. They are
  sent for affected live targets whose output is not fully covered by the query update plan.
  `mode="append"` is the explicit vocabulary for pagination and streams.
- **`Kovo-Changes`** is the sanitized summary of committed writes — `{domain, keys}` only, never
  mutation input or failure detail.

Fragments are rendered by compiler-generated live-target renderers for the same query-backed
components your route pages compose, so a partial can't drift from the page it patches. App code
does not route ordinary success fragments by mutation key.

## The no-JS path: POST-redirect-GET

When the same endpoint sees no `Kovo-Fragment` header, it answers with PRG. A successful no-JS
submit returns `303`, `Cache-Control: no-store`, and a `Location` header. The next GET renders the
updated page. Errors re-render the full page with messages in place.

```ts
export const cartPage = route('/cart', {
  page: () => <CartPage />,
});

export const addToCart = mutation('cart/add', {
  csrf: commerceCsrf,
  defaultRedirectTo: '/cart',
  input: addToCartInput,
  handler(input, request) {
    return request.db.cart.add(input);
  },
});
```

`defaultRedirectTo` is the static success target. Use it when every successful submit lands on the
same page.

## Choose the PRG target

Use `redirectTo` when the handler result decides where the browser goes. A plain string works, but a
typed `redirect()` value is better for routes with params:

```ts
import { redirect } from '@kovojs/core';

export const createOrder = mutation('order/create', {
  input: createOrderInput,
  redirectTo: (result) => redirect('/orders/:id', { params: { id: result.value.id } }),
  handler(input, request) {
    return request.db.orders.create(input);
  },
});
```

That is the create-then-navigate path: the order id is only known after the handler runs, and the
redirect target is still checked against the route table. Rename `/orders/:id`, or change its params,
and the redirect call turns red with the links and GET forms.

`defaultRedirectTo` is common and static. `redirectTo` is mutation-local and can be static or a
function of the success result. Both affect the no-JS PRG success path; enhanced submissions still
receive query and fragment truth unless the loader chooses a full navigation.

## Prevent lost updates on one row

The dangerous stock check is "read stock, decide it is enough, then update later." Two users can pass
the read before either write lands. Mark the contended column in the schema, then fold the check and
the write into one SQL statement:

```ts
export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    stock: integer('stock').notNull(),
    version: integer('version').notNull(),
  },
  kovo({ domain: 'product', key: 'id', atomic: 'stock', version: 'version' }),
);
```

Then update with a compare-and-set predicate. The predicate can guard the atomic value itself, or a
separate version column that you also increment:

```ts
const cas = await compareAndSet(
  db
    .update(products)
    .set({ stock: sql`${products.stock} - ${qty}`, version: sql`${products.version} + 1` })
    .where(and(eq(products.id, id), eq(products.version, input.version))),
);
if (!cas.ok) throw new StaleVersionError();
```

On conflict, return the typed stale-version outcome. The enhanced client refetches fresh truth and
can retry with the new version; no-JS users see the same typed failure page. Use a declared 422 error
for ordinary validation such as "you asked for more than the current available quantity." Use the
409 conflict when the user's version was stale even though the request shape was valid.

This is a single-row ceiling. It protects stock counters, account balances, and row versions where
one row carries the contested fact. Multi-row reservations, range constraints, and cross-table
invariants still need database constraints, serializable transactions, advisory locks, or an
application-specific reservation table. Kovo makes the missing single-row compare-and-set loud; it
does not replace the database's isolation model.

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

## Worked add-to-cart path

The smallest complete Kovo dataflow is the add-to-cart path:

1. The cart badge component declares the cart query it reads.
2. The product list renders a form that posts a named `cart/add` mutation.
3. The mutation validates input, checks CSRF/idempotency, runs guards, and writes through a domain.
4. The data-layer graph maps the write to touched domains and row keys.
5. Kovo intersects those touched domains with visible query-backed targets.
6. The response sends query JSON, a fragment, or a prod delta, depending on what the update plan can
   cover.

Every advanced app repeats this pattern with more domains, guards, and layouts. When something
drifts, the verifier points at the missing read, write, target, or optimistic transform instead of
making you debug the browser after a stale render ships.

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
`kovo explain` artifact format: SPEC §5.3. Typed `redirect()` targets and route-rename propagation:
SPEC §6.4 and KV220. Single-row lost-update gates: SPEC §10.1 and §10.3; missing compare-and-set on
`kovo({ atomic, version })` is **KV429**.

</details>
