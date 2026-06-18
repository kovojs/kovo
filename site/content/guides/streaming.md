---
title: Streaming & defer
description: Answer immediately with the cheap parts of a page and stream the expensive parts into the same response with kovo-defer.
order: 8
---

# Streaming & defer

A product page where recommendations come from a slow model shouldn't make the whole page wait on
them. With `<kovo-defer>` the page answers immediately with everything cheap, and the expensive subtree
streams into the same response: the shell renders with a fallback, the real fragment arrives as a
later chunk, and the morph layer patches it in. It reuses the fragment protocol within first render
rather than adding a second mechanism.

## The app shape

From the commerce reference app, the app authors declare the route and the query-backed component.
The app shell owns the deferred document wire:

```tsx
import { component } from '@kovojs/core';
import { route } from '@kovojs/server';

export const ProductGrid = component({
  queries: { productGrid },
  render: ({ productGrid }) => <section>{productGrid.items.map(renderProduct)}</section>,
});

export const productPage = route('/products', {
  page: () => <ProductGrid />,
  stylesheets: commerceStylesheets,
});
```

The response is one chunked HTML document. Internally, the wire stays ordered like this:

```html
<!doctype html>
<html>
  <body>
    <main class="product-page">
      <kovo-defer target="product-grid" state="pending"></kovo-defer>
      --kovo-boundary
      <kovo-query name="productGrid">{"items":[…],"nextCursor":"p2"}</kovo-query>
      <kovo-fragment target="product-grid"
        ><link rel="stylesheet" href="/assets/site.css" />
        <section kovo-c="product-grid" kovo-deps="product">…</section>
      </kovo-fragment>
      --kovo-boundary--
    </main>
  </body>
</html>
```

The vocabulary is the mutation response's — `<kovo-query>` then `<kovo-fragment>` — arriving during first
render instead of after a POST. It reads top to bottom in view-source, like everything else on the
wire.

## How the fallback gets replaced

The `<kovo-defer>` element is the fallback. Whatever you render inside it — a skeleton, a spinner, a
static placeholder — paints with the shell at first byte. When the matching
`<kovo-fragment target="…">` chunk arrives, the morph layer patches it in. Because it morphs rather
than replaces, the swap preserves focus, scroll position, selection, CSS transitions, and the state
of any islands nested in the fallback. Patched-in islands are inert-until-touched like everything
else, and `on:visible` observers attach to them normally.

`mode="append"` is available on deferred fragments as the explicit append vocabulary, the same as
mutation fragments — useful for streaming list pages.

## Keep deferred queries ahead of their consumers

The guarantee to rely on: deferred query JSON arrives before or with its consumers. That's why
Kovo emits a fragment's query values in the same chunk as the fragment whose `data-bind` attributes
read them, so a deferred island never renders against missing data.

Priority is declared on the route/component surface that owns the late region. Finer priority
semantics and query-JSON placement under HTTP/1.1 fallbacks are still open design areas. The
before-or-with guarantee is the contract you can depend on.

## Stylesheets for late fragments

A deferred fragment may use StyleX atoms or document CSS the shell never referenced. Fragment chunks
declare their stylesheets, and the links ride inside the fragment — present before the content
paints, deduped by `href` within the response:

```ts
fragments: [
  {
    target: 'product-grid',
    html: renderProductGrid(productGrid),
    stylesheets: ['/assets/site.css'],
  },
];
```

The same Kovo stylesheet contract applies as everywhere: StyleX rules are extracted from source at
build time, document CSS is shipped as a declared asset, and the fragment lists the stylesheet it
needs. See [styling with StyleX](/guides/styling/).

## The client side

On a server-rendered stream the loader handles this. The runtime primitive it uses is exported, and
the starter's `client.ts` wires it for programmatic use:

```ts
import {
  applyDeferredStreamResponseToRuntime,
  createQueryStore,
  installKovoLoader,
} from '@kovojs/runtime/client';

const store = createQueryStore();
installKovoLoader({ importModule: (s) => import(s), root: document, queryStore: store });

applyDeferredStreamResponseToRuntime({
  body, // the streamed document text
  root: document,
  store, // <kovo-query> chunks land here and run their update plans
});
```

Each applied chunk behaves exactly like a mutation response landing: query values update their
bindings, fragments morph into their targets.

## When to reach for it

Projected children all ship in the initial HTML — every tab panel, dialog body, accordion content.
There's no client-side lazy mount. So the question `<kovo-defer>` answers is about server render cost at
first paint, not payload size.

**Use it when** a subtree is expensive to produce and the rest of the page isn't: recommendations
behind a slow model, an analytics panel aggregating wide tables, third-party-data sections with
unpredictable latency. The cheap 95% of the page paints at first byte, and the slow section streams in
seconds later with no client round-trip.

**Don't use it for:**

- _Big-but-cheap subtrees._ Streaming reorders HTML; it doesn't shrink it. A long static page is fine
  as a long static page.
- _Below-the-fold JS deferral._ That's `on:visible`, which defers executing JavaScript, not HTML.
- _Data that updates after load._ That's a query with refetch or a mutation response. Defer is a
  first-render mechanism only.
- _Navigation._ Pages are complete documents; defer streams within one response, it doesn't splice
  between pages.

A reasonable default: render everything inline until a route's server time is dominated by one
identifiable subtree, then defer exactly that subtree. The wire stays readable either way, and
`kovo explain page` keeps listing the route's queries — deferred or not — as one surface.

## Degradation

The stream is one HTML response, so the no-JS story degrades the way the rest of the framework does:
the document still arrives and completes, and the fallback content is what a non-JS visitor keeps for
deferred regions. Keep fallbacks honest — a meaningful placeholder or summary, not an empty box — for
the same reason the no-JS form path stays a real form.

## Next

- [Styling with StyleX](/guides/styling/) — the stylesheet contract these chunks use.
- [Queries & invalidation](/guides/queries/) — the query values deferred chunks deliver.

<details>
<summary>Spec & diagnostics</summary>

Defer as a first-render reuse of the fragment protocol, morph survival, the before-or-with ordering
guarantee, and no-JS degradation: SPEC §8. The shared `<kovo-query>`/`<kovo-fragment>` wire vocabulary and
`mode="append"`: SPEC §9.1. `on:visible` and inert-until-touched islands: SPEC §4.7. Projected
children shipping in initial HTML: SPEC §4.5. Priority hinting and open stream-ordering areas:
SPEC §13.3. Stylesheets for late fragments: SPEC §13.1. Defer vs. post-load data updates: SPEC §9.3.
`kovo explain page` as one surface: SPEC §5.3.

</details>
