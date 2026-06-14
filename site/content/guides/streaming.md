---
title: Streaming & defer
description: Answer immediately with the cheap parts of a page and stream the expensive parts into the same response with fw-defer.
order: 8
---

# Streaming & defer

A product page where recommendations come from a slow model shouldn't make the whole page wait on
them. With `<fw-defer>` the page answers immediately with everything cheap, and the expensive subtree
streams into the same response: the shell renders with a fallback, the real fragment arrives as a
later chunk, and the morph layer patches it in. It reuses the fragment protocol within first render
rather than adding a second mechanism.

## The shape of a deferred response

From the commerce reference app, deferring the product grid:

```ts
import { renderDeferredStream } from '@jiso/server';

export function renderProductGridDeferredStream(db: CommerceDb) {
  const productGrid = loadProductGrid(db);

  return renderDeferredStream({
    shell:
      '<!doctype html><html><body><main class="min-h-dvh bg-slate-50 p-6"><fw-defer target="product-grid" state="pending"></fw-defer>',
    chunks: [
      {
        queries: [{ name: 'productGrid', value: productGrid }],
        fragments: [
          {
            target: 'product-grid',
            html: renderProductGrid(productGrid),
            stylesheets: commerceStylesheets,
          },
        ],
      },
    ],
    closeHtml: '</main></body></html>',
  });
}
```

The response is one chunked HTML document. On the wire, in order:

```html
<!doctype html>
<html>
  <body>
    <main class="min-h-dvh bg-slate-50 p-6">
      <fw-defer target="product-grid" state="pending"></fw-defer>
      --jiso-boundary
      <fw-query name="productGrid">{"items":[…],"nextCursor":"p2"}</fw-query>
      <fw-fragment target="product-grid"
        ><link rel="stylesheet" href="/assets/tailwind.css" />
        <section fw-c="product-grid" fw-deps="product">…</section>
      </fw-fragment>
      --jiso-boundary--
    </main>
  </body>
</html>
```

The vocabulary is the mutation response's — `<fw-query>` then `<fw-fragment>` — arriving during first
render instead of after a POST. It reads top to bottom in view-source, like everything else on the
wire.

## How the fallback gets replaced

The `<fw-defer>` element is the fallback. Whatever you render inside it — a skeleton, a spinner, a
static placeholder — paints with the shell at first byte. When the matching
`<fw-fragment target="…">` chunk arrives, the morph layer patches it in. Because it morphs rather
than replaces, the swap preserves focus, scroll position, selection, CSS transitions, and the state
of any islands nested in the fallback. Patched-in islands are inert-until-touched like everything
else, and `on:visible` observers attach to them normally.

`mode="append"` is available on deferred fragments as the explicit append vocabulary, the same as
mutation fragments — useful for streaming list pages.

## Keep deferred queries ahead of their consumers

The guarantee to rely on: deferred query JSON arrives before or with its consumers. That's why
`renderDeferredStream` couples `queries` and `fragments` per chunk — the
`<fw-query name="productGrid">` value lands in the same chunk as the fragment whose `data-bind`
attributes read it, so a deferred island never renders against missing data. When you build chunks by
hand, keep a fragment's queries in its own chunk or an earlier one, never a later one.

Chunks and fragments accept a `priority` (`'high' | 'normal' | 'low'` or a number), and emission
order follows priority with declaration order as the tiebreaker. That's declared hinting within the
stream; finer priority semantics and query-JSON placement under HTTP/1.1 fallbacks are still open
design areas. The before-or-with guarantee is the contract you can depend on.

## Stylesheets for late fragments

A deferred fragment may use classes the shell never referenced. So fragment chunks declare their
stylesheets, and the links ride inside the fragment — present before the content paints, deduped by
`href` within the response:

```ts
fragments: [
  {
    target: 'product-grid',
    html: renderProductGrid(productGrid),
    stylesheets: ['/assets/tailwind.css'],
  },
];
```

The same Tailwind rule applies as everywhere: classes in deferred HTML must be statically
discoverable or safelisted, because they have to already exist in the generated CSS. See
[styling with Tailwind](/guides/styling/).

## The client side

On a server-rendered stream the loader handles this. The runtime primitive it uses is exported, and
the starter's `client.ts` wires it for programmatic use:

```ts
import {
  applyDeferredStreamResponseToDom,
  createQueryStore,
  installJisoLoader,
} from '@jiso/runtime';

const store = createQueryStore();
installJisoLoader({ importModule: (s) => import(s), root: document, queryStore: store });

applyDeferredStreamResponseToDom({
  body, // the streamed document text
  root: document,
  store, // <fw-query> chunks land here and run their update plans
});
```

Each applied chunk behaves exactly like a mutation response landing: query values update their
bindings, fragments morph into their targets.

## When to reach for it

Projected children all ship in the initial HTML — every tab panel, dialog body, accordion content.
There's no client-side lazy mount. So the question `<fw-defer>` answers is about server render cost at
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
`fw explain page` keeps listing the route's queries — deferred or not — as one surface.

## Degradation

The stream is one HTML response, so the no-JS story degrades the way the rest of the framework does:
the document still arrives and completes, and the fallback content is what a non-JS visitor keeps for
deferred regions. Keep fallbacks honest — a meaningful placeholder or summary, not an empty box — for
the same reason the no-JS form path stays a real form.

## Next

- [Styling with Tailwind](/guides/styling/) — the stylesheet contract these chunks use.
- [Queries & invalidation](/guides/queries/) — the query values deferred chunks deliver.

<details>
<summary>Spec & diagnostics</summary>

Defer as a first-render reuse of the fragment protocol, morph survival, the before-or-with ordering
guarantee, and no-JS degradation: SPEC §8. The shared `<fw-query>`/`<fw-fragment>` wire vocabulary and
`mode="append"`: SPEC §9.1. `on:visible` and inert-until-touched islands: SPEC §4.7. Projected
children shipping in initial HTML: SPEC §4.5. Priority hinting and open stream-ordering areas:
SPEC §13.3. Stylesheets for late fragments: SPEC §13.1. Defer vs. post-load data updates: SPEC §9.3.
`fw explain page` as one surface: SPEC §5.3.

</details>
