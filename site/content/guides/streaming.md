---
title: Streaming & defer
description: Out-of-order streaming with fw-defer — fallbacks, morph-in, deferred query ordering, and stylesheet hints for late fragments.
order: 8
---

# Streaming & defer

`<fw-defer>` lets a page answer immediately with everything cheap and stream the expensive parts
later **in the same response**: the shell renders with a fallback, the real fragment arrives as a
later chunk, and the morph layer patches it in. It is the fragment protocol reused within first
render — not a second mechanism (SPEC §8).

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
<!doctype html><html><body><main class="min-h-dvh bg-slate-50 p-6">
<fw-defer target="product-grid" state="pending"></fw-defer>
--jiso-boundary
<fw-query name="productGrid">{"items":[…],"nextCursor":"p2"}</fw-query>
<fw-fragment target="product-grid"><link rel="stylesheet" href="/assets/tailwind.css">
  <section fw-c="product-grid" fw-deps="product">…</section>
</fw-fragment>
--jiso-boundary--
</main></body></html>
```

The vocabulary is exactly the mutation response's — `<fw-query>` then `<fw-fragment>` — arriving
during first render instead of after a POST (SPEC §8, §9.1). Readable top to bottom in view-source,
like everything else on the wire.

## Fallback → morph-in

The `<fw-defer>` element *is* the fallback: whatever you render inside it (a skeleton, a spinner,
a static placeholder) paints with the shell at first byte. When the matching
`<fw-fragment target="…">` chunk arrives, it is morphed in (SPEC §8). Morph semantics mean the
swap preserves what a replace would destroy: focus, scroll position, selection, CSS transitions,
and the state of any islands nested in the fallback (SPEC §9.1). Patched-in islands are
inert-until-touched like everything else, and `on:visible` observers attach to them normally —
the morph layer accounts for islands it patches in (SPEC §4.7).

`mode="append"` is available on deferred fragments as the explicit append vocabulary, same as
mutation fragments — useful for streaming list pages (SPEC §9.1).

## Deferred query ordering

The normative guarantee: **deferred query JSON arrives before or with its consumers** (SPEC §8).
That is why `renderDeferredStream` couples `queries` and `fragments` per chunk — the
`<fw-query name="productGrid">` value lands in the same chunk as the fragment whose `data-bind`
attributes read it, so a deferred island never renders against missing data. When you build chunks
by hand, keep a fragment's queries in its own chunk or an earlier one; never a later one.

Chunks and fragments accept a `priority` (`'high' | 'normal' | 'low'` or a number), and emission
order follows priority with declaration order as the tiebreaker — declared hinting within the
stream, with finer priority semantics an open design area (SPEC §13.3). Query-JSON placement under
HTTP/1.1 fallbacks is part of the same open area; the before-or-with guarantee is the contract to
rely on.

## Stylesheets for late fragments

A deferred fragment may use classes the shell never referenced. Fragment chunks therefore declare
their stylesheets, and the links ride inside the fragment — present before the content paints,
deduped by `href` within the response (SPEC §13.1):

```ts
fragments: [
  {
    target: 'product-grid',
    html: renderProductGrid(productGrid),
    stylesheets: ['/assets/tailwind.css'],
  },
]
```

The same Tailwind rule applies as everywhere: classes in deferred HTML must be statically
discoverable or safelisted, because they must already exist in the generated CSS — see
[styling with Tailwind](/guides/styling/).

## The client side

On a server-rendered stream the loader handles this; the runtime primitive it uses is exported,
and the starter's `client.ts` wires it for programmatic use:

```ts
import {
  applyDeferredStreamResponseToDom,
  createQueryStore,
  installJisoLoader,
} from '@jiso/runtime';

const store = createQueryStore();
installJisoLoader({ importModule: (s) => import(s), root: document, queryStore: store });

applyDeferredStreamResponseToDom({
  body,            // the streamed document text
  root: document,
  store,           // <fw-query> chunks land here and run their update plans
});
```

Each applied chunk behaves exactly like a mutation response landing: query values update their
bindings, fragments morph into their targets.

## When to reach for it

`<fw-defer>` is the relief valve for a deliberate posture: projected children all ship in the
initial HTML — every tab panel, dialog body, accordion content. There is no client-side lazy
mount (SPEC §4.5). So the decision is about **server render cost at first paint**, not payload
hygiene:

**Use it when** a subtree is expensive to *produce* and the rest of the page isn't —
recommendations behind a slow model, an analytics panel aggregating wide tables, third-party-data
sections with unpredictable latency. The cheap 95% of the page paints at first byte; the slow
section streams in seconds later with no client round-trip.

**Don't use it for:**

- *Big-but-cheap subtrees.* Streaming doesn't shrink HTML; it reorders it. A long static page is
  fine as a long static page.
- *Below-the-fold JS deferral.* That's `on:visible` — execution triggers defer *JavaScript*, not
  HTML (SPEC §4.7).
- *Data that updates after load.* That's a query with refetch or a mutation response (SPEC §9.3,
  §9.1). Defer is strictly a first-render mechanism.
- *Navigation.* Pages are complete documents; defer streams within one response, it does not
  splice between pages (SPEC §8).

A reasonable default: render everything inline until a route's server time is dominated by one
identifiable subtree, then defer exactly that subtree. The wire stays readable either way, and
`fw explain page` keeps listing the route's queries — deferred or not — as one surface
(SPEC §5.3).

## Degradation

The stream is one HTML response, so the no-JS story degrades the same way the rest of the
framework does: the document still arrives and completes; the fallback content is what a non-JS
visitor keeps for deferred regions. Keep fallbacks honest — a meaningful placeholder or summary,
not an empty box — for the same reason the no-JS form path stays a real form (SPEC §8).

## Next

- [Styling with Tailwind](/guides/styling/) — the stylesheet contract these chunks use.
- [Queries & invalidation](/guides/queries/) — the query values deferred chunks deliver.
