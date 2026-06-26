---
title: Routing & navigation
description: Declare routes as typed values, link to them with the path's literal type, and let renaming a path turn every stale link red under check.
order: 0.5
---

# Routing & navigation

Declare a route once, then use that same route shape for links, redirects, GET forms, metadata,
guards, and static export. Rename a path and `vp check` points at every stale consumer before you
ship.

## Declare a route

A `route()` couples a literal path, optional param/search schemas, per-route config, and a `page`
function. From the CRM reference app's parameterized detail route:

```tsx
import { route, s } from '@kovojs/server';

export const dealDetailRoute = route('/deals/:id', {
  meta: { description: 'CRM deal detail.', title: 'Deal · Atlas CRM' },
  params: s.object({ id: s.string() }), // coercion declared once, like FormData
  staticPaths: crmStaticDealPaths,
  page({ params }: { params: { id: string } }) {
    return <DealDetailRegion dealId={params.id} />;
  },
  layout: PipelineLayout,
  stylesheets: crmStylesheets,
});
```

Singleton routes look the same without the param schema. From the commerce app:

```tsx
export const commerceHomeRoute = route('/', {
  meta: { description: 'Browse products and checkout.', title: 'Kovo Commerce' },
  layout: CommerceCartLayout,
  page(_context, request: CommerceRouteRequest) {
    return <CommerceCartPage request={request} />;
  },
  stylesheets: commerceStylesheets,
});
```

Routes are registered on the closed `createApp()` aggregate the request shell owns:

```tsx
const app = createApp({
  routes: [commerceHomeRoute, commerceCartRoute, commerceLoginRoute],
  mutations: [addToCart, commerceSignIn, commerceSignOut],
  db: () => db,
  sessionProvider: () => demoSession,
});
```

Route matching is static-first at each path segment; two routes that can match the same canonical
request path is a **compile error, KV228**, not a runtime precedence footnote. Trailing slashes
normalize to one canonical path with a 308 before matching, and a page path answers `GET`/`HEAD`
(other methods are 405, because mutations own POST under `/_m/`).

## Add route metadata

`meta` writes the document head for that route. Static metadata covers the common page-head fields,
including the Open Graph image:

```tsx
export const productRoute = route('/products/:id', {
  meta: {
    title: 'Product detail',
    description: 'View price, inventory, and shipping windows.',
    image: '/images/products/default-card.png',
  },
  params: s.object({ id: s.string() }),
  page: ProductPage,
});
```

When the title or image comes from query data, derive it from the query instead of duplicating a
loader in the route:

```tsx
import { metaFromQuery, route, s } from '@kovojs/server';

export const productRoute = route('/products/:id', {
  params: s.object({ id: s.string() }),
  queries: { product: productQuery.args(({ params }) => ({ id: params.id })) },
  meta: metaFromQuery(productQuery, (product) => ({
    title: `${product.name} · Kovo Shop`,
    description: product.summary,
    image: product.imageUrl,
  })),
  page: ProductPage,
});
```

`meta.image` is a URL sink. Kovo scheme-checks it before emitting `<meta property="og:image">`, so
query-derived image URLs go through the same output rules as authored attributes.

## Type the path params

Path params are extracted from the literal by template-literal types: `PathParams<'/deals/:id'>`
resolves to `'id'`. The compiler proves the `params` schema matches the literal, the `params`
argument exists only when the route declares params, and — critically — every link to the route must
supply exactly those params:

```tsx
// authoring sugar — params demanded by the route's literal type
<Link to="/deals/:id" params={{ id: deal.id }}>
  View deal
</Link>
```

Missing or extra params are a compile error. Form values and URL segments arrive as strings, so the
`params` schema declares coercion once (`s.number()`, `s.string()`), exactly like a mutation's input
schema.

## Type the search params (the URL coordination channel)

Search params are the typed URL channel — the canonical way islands coordinate without shared client
state (see [interactive islands](/guides/islands/)). Declare a `search` schema and read it off the
page context, coerced:

```tsx
export const productsRoute = route('/products', {
  search: s.object({ max: s.number().optional() }), // typed URL state, coercion declared once
  page({ search }) {
    return <ProductGrid maxPrice={search.max} />;
  },
});
```

The commerce login route reads `next` straight off `context.search` to drive its post-login
redirect (declaring a `search` schema is the typed form; reading `context.search` defensively, as
here, is what you do when a param is loosely shaped):

```tsx
export const commerceLoginRoute = route('/login', {
  page(context) {
    const next = typeof context.search.next === 'string' ? context.search.next : '/cart';
    return <LoginForm next={next} />;
  },
});
```

A GET form is the no-JS-friendly writer of that channel, and its field names are validated against
the same `search` schema — the identical machinery that checks mutation form fields:

```tsx
const f = form.get('/products');
<f.Form>
  <f.input name="max" type="number" />
</f.Form>;
// ✗ compile error: a field name not in the route's search schema
```

## Typed links and `href()`

`<Link>` and `href()` are compile-time sugar. They carry the path's literal type and lower to a plain
`<a href>` — there is no link runtime, and a bare string href is valid Kovo source:

```tsx
<Link to="/products/:id" params={{ id: item.productId }} search={{ max: 500 }}>
  View
</Link>
```

```html
<!-- lowered IR / wire: an ordinary anchor, no client router -->
<a href="/products/p1?max=500">View</a>
```

The reference apps author the lowered form directly when they don't need param substitution — a plain
`<a href="/">` for back-links is idiomatic and equally typed:

```tsx
// crm/src/components/deal-detail.tsx
<a style={dealDetailStyles.backLink} href="/">
  Back to pipeline
</a>
```

Residual literal `href`s in emitted IR are validated against the route table at compile time
(**KV220**). Full-origin URLs and an explicit `external` marker opt out.

## `redirect()` — including POST-redirect-GET

`redirect('/deals/:id', { params })` types the redirect target the same way links do, so the
no-JS POST-redirect-GET path stays inside the type system. A successful no-JS mutation answers 303
with a `Location` the route table validates, and the next GET renders the updated page:

```ts
import { redirect } from '@kovojs/server';

export async function createDeal() {
  const created = await db.deals.create(formData);
  return redirect('/deals/:id', { params: { id: created.id } });
}
```

Renaming `/deals/:id` turns this `redirect()` red exactly like it turns every `<Link>` red — the
PRG destination is not a magic string.

## `notFound()` — a page outcome, not ad-hoc status

Returning `notFound()` from `page` renders the app's 404 shell with the correct status, so status
codes stay part of the typed surface rather than hand-constructed responses:

```tsx
export const dealDetailRoute = route('/deals/:id', {
  params: s.object({ id: s.string() }),
  page({ params }, req) {
    const deal = loadDeal(req.db, params.id);
    if (!deal) return notFound(); // → app 404 shell, status 404
    return <DealDetailRegion deal={deal} />;
  },
});
```

`redirect()` and `notFound()` are the two sanctioned non-200 page outcomes in v1. (Routes may also
return `respond.file()` / `respond.stream()` for non-HTML 200/304 bodies; those are still ordinary
routes with params, guards, KV220 validation, and the audits applied. See
[endpoints and webhooks](/guides/endpoints-webhooks/) for raw machine ingress.)

## Route guards

`guard:` on a `route()` runs the **same combinator chain as mutations** before `page` executes, and
refines `req.session` identically — so `req.session.user` is non-null inside the page under `authed`:

```tsx
export const productRoute = route('/products/:id', {
  params: s.object({ id: s.string() }),
  guard: authed, // same combinators as mutations (§10.3)
  page({ params }, req) {
    // req.session.user is non-null here, refined by the guard
    return <ProductPage id={params.id} owner={req.session.user.id} />;
  },
});
```

The reference app guards routes with the same combinators it uses on mutations — `authed<Req>()` for
"signed in" and `role<Req>('admin')` for authorization:

```tsx
export const accountRoute = route('/account', {
  guard: authed<ReferenceRequest>(),
  page(_in, req) {
    /* req.session.user typed */
  },
});
export const adminRoute = route('/admin', {
  guard: role<ReferenceRequest>('admin'),
  page(_in, req) {
    /* … */
  },
});
```

Guarded pages enroll in the **`kovo explain --unguarded` audit** — the report of everything reachable
without authentication — alongside mutations and queries. Guard outcomes are fixed so auth stays
typed: an `authed` failure runs the app's `onUnauthenticated` handler (default: 303 to the login
route with the original URL as `next`), and an authenticated-but-unauthorized failure renders the
app's 403 shell. Sessions themselves are a declared `s.object` schema resolved once by the app's
`sessionProvider` before any route, query, or mutation guard runs.

## The propagation property

This is the payoff of typing the path. Because every navigation surface — `<Link>`, `href()`, GET
form actions, and `redirect()` — is checked against the `route()` declarations, renaming a path is a
single edit whose every stale consumer surfaces as a type error:

```tsx
// rename the route…
export const dealDetailRoute = route('/deals/:dealId', {
  /* … */
});

// …and every one of these goes red under `vp check` until updated:
// <Link to="/deals/:id" params={{ id }}>…</Link>  // literal no longer in RouteRegistry
// redirect('/deals/:id', { params: { id } });     // same stale literal
// <a href="/deals/p1">…</a>                       // KV220: matches no declared route
```

There is no broken link to discover in production, and no grep-the-codebase migration — the type
system enumerates the work for you. This is the same declare-once → derive-every-surface property
that drives queries and mutations, applied to navigation.

## Navigation affordances

The MPA is fast as plain HTML; these layer on top of the same full-document GET as progressive
enhancements, never as an app mode:

- **Enhanced navigation.** The loader may intercept only eligible same-origin, unmodified, GET anchor
  clicks. It fetches the canonical full document, validates the render-plan version and segment
  metadata, and morphs only compatible changed segments — preserving focus, scroll, and island state.
  On any uncertainty (cross-origin, modified click, hash/download/target, version mismatch, parse
  failure) it falls back to a normal full GET. Safari and Firefox get ordinary navigations either way;
  there is no blank-screen failure mode.
- **View Transitions.** Cross-document View Transitions are opt-in per element pair via
  `view-transition-name`; the compiler stamps matching names across route templates (a duplicate
  static name is KV239).
- **Speculation Rules.** Opt-in per route via `prefetch: 'conservative' | 'moderate' | false`,
  declared on the `route()` object and **default off**. Auto-prerender has real hazards (analytics
  firing in prerendered pages, non-idempotent per-user renders), so apps opt in route-by-route where
  renders are idempotent and cheap.

```tsx
export const productRoute = route('/products/:id', {
  params: s.object({ id: s.string() }),
  prefetch: 'conservative', // Speculation Rules config lives on the route
});
```

<details>
<summary>Credentialed prerender on guarded routes</summary>

`prefetch: 'moderate'` may prerender the route's page, metadata, and queries with the user's
credentials on hover. Guarded, session-dependent, or not-proven-side-effect-free routes must stay on
`prefetch: 'conservative'` unless you add a named `prefetchJustification` explaining why the
credentialed prerender is safe:

```tsx
export const accountOverviewRoute = route('/account', {
  guard: authed,
  prefetch: 'moderate',
  prefetchJustification: 'Read-only account chrome; no analytics or write effects during render.',
  page: AccountOverviewPage,
});
```

Without that justification, `vp check` reports KV419.

</details>

All three count against the inline loader's 8KB gzip budget and must not break bfcache (no `unload`
handlers). Navigation partials are not a v1 protocol: enhanced navigation uses the full target
document as its oracle, and app TSX never authors navigation segment stamps or persistence policy.

## Next

- [Interactive islands & client state](/guides/islands/) — coordinating islands through the typed URL.
- [Layouts](/guides/layouts/) — nested route chrome, layout queries, guards, and boundaries.
- [Mutations & forms](/guides/mutations/) — the POST-redirect-GET write side of navigation.
- [The kovo & vp CLIs](/guides/cli/) — running `kovo explain --unguarded` and `kovo explain page`.

<details>
<summary>Spec & diagnostics</summary>

The MPA spine, enhanced navigation, View Transitions, Speculation Rules, and the degradation
contract: SPEC §8. Typed routes, params/search schemas, `<Link>`/`href()`, `redirect()`,
`notFound()`, guards on routes, static and query-driven metadata, and the propagation property:
SPEC §6.4. The session schema and fixed guard-failure outcomes: SPEC §6.5. The Interaction Ladder
and the typed URL coordination channel: SPEC §7. The request shell, dispatch order, static-first
matching, and static export: SPEC §9.5. OG image URL-sink checking for `meta.image` and
`metaFromQuery(...)`: SPEC §4.8 and §13.5. A literal `href`/form `action` that matches no declared
route is **KV220**; an ambiguous or duplicate route path is **KV228**; a route that cannot be
statically exported as L0/L1 is **KV229**; a duplicate static view-transition name is **KV239**;
unguarded credentialed prerender with `prefetch: 'moderate'` is **KV419**.

</details>
