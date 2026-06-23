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

Kovo has three different streaming surfaces:

- `respond.stream()` and raw `endpoint()` responses are app-owned protocols for downloads, exports,
  webhooks, or custom integrations. They do not run the enhanced mutation apply path.
- `<kovo-defer>` is first-render streaming. It replaces a fallback inside the document response.
- Streaming mutations are post-submit streams. They keep the normal mutation lifecycle and stream
  Kovo wire chunks back through the enhanced form response.

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
import { createQueryStore, installKovoLoader } from '@kovojs/browser/client';
import { applyDeferredStreamResponseToRuntime } from '@kovojs/browser/generated';

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
- _Chat token rendering._ That's a streaming mutation response: one enhanced form POST whose chunks
  append fragments, append escaped text, and then reconcile to server truth.
- _Navigation._ Pages are complete documents; defer streams within one response, it doesn't splice
  between pages.

A reasonable default: render everything inline until a route's server time is dominated by one
identifiable subtree, then defer exactly that subtree. The wire stays readable either way, and
`kovo explain page` keeps listing the route's queries — deferred or not — as one surface.

## Streaming mutation responses

Use a streaming mutation when the user has submitted a real form and the response should render
progressively, such as a chat assistant answer. It is not an SSE subscription and it is not
`<kovo-defer>`; it is one enhanced mutation POST response. The server still runs CSRF, input schema
validation, guards, replay/idempotency, and the mutation transaction before user-visible assistant
chunks are emitted.

The wire remains the mutation vocabulary plus one narrow text-source primitive:

```html
<kovo-fragment target="messages" mode="append">
  <article class="message user">How do I ship this?</article>
</kovo-fragment>

<kovo-fragment target="messages" mode="append">
  <article class="message assistant">
    <div data-stream-text="assistant:a1" aria-live="polite" aria-atomic="true"></div>
  </article>
</kovo-fragment>

<kovo-text target="assistant:a1">Start with the typed mutation path.</kovo-text>
<kovo-text target="assistant:a1" mode="checkpoint">Start with the typed mutation path.</kovo-text>

<kovo-fragment target="messages">
  <section kovo-fragment-target="messages">...canonical server-rendered messages...</section>
</kovo-fragment>
```

`<kovo-text>` appends escaped text to a declared `data-stream-text` source. HTML-looking model output
stays text. If the UI wants Markdown, citations, tables, or code highlighting while the answer is
arriving, declare a renderer for the source and let that app-owned renderer transform the accumulated
text into presentation. Kovo still owns the source buffer and the final server-rendered fragment or
query reconciliation.

Use `mode="checkpoint"` on long streams when the server wants to replace the accumulated source text
with canonical text so far. Use a final `<kovo-fragment>` or `<kovo-query>` update to reconcile the
message or message list with server truth. A partial text stream is never the final authority.

For accessible chat shells, put live-region semantics on the assistant message container or source
element, not on each token. Prefer `aria-live="polite"` and a stable status/message element so screen
readers receive coalesced updates instead of one announcement per token. Keep the submitted user
message and assistant shell as ordinary fragments, so no-JS users still get the normal mutation
fallback and the final page remains meaningful.

If the stream aborts, validation fails, a guard/session check fails, a stream target is missing, or a
deploy build token is stale, the runtime must recover to server truth: mark the submitted UI failed,
refetch the affected target, or navigate through the normal form path. Do not leave a partial answer
presented as confirmed.

## Degradation

The stream is one HTML response, so the no-JS story degrades the way the rest of the framework does:
the document still arrives and completes, and the fallback content is what a non-JS visitor keeps for
deferred regions. Keep fallbacks honest — a meaningful placeholder or summary, not an empty box — for
the same reason the no-JS form path stays a real form.

## Next

- [Styling with StyleX](/guides/styling/) — the stylesheet contract these chunks use.
- [Mutations](/guides/mutations/) — the typed form lifecycle streaming mutations preserve.
- [Queries & invalidation](/guides/queries/) — the query values deferred chunks deliver.
- [Package import surfaces](/guides/package-imports/) — when an app entry should import
  `@kovojs/browser/client`.

<details>
<summary>Spec & diagnostics</summary>

Defer as a first-render reuse of the fragment protocol, morph survival, the before-or-with ordering
guarantee, and no-JS degradation: SPEC §8. The shared `<kovo-query>`/`<kovo-fragment>` wire vocabulary,
`mode="append"`, streaming mutation responses, `<kovo-text>`, checkpoints, interruption behavior, and
server-truth reconciliation: SPEC §9.1. `respond.stream()` as an app-owned escape hatch: SPEC §6.4.
`on:visible` and inert-until-touched islands: SPEC §4.7. Projected children shipping in initial HTML:
SPEC §4.5. Priority hinting and open stream-ordering areas: SPEC §13.3. Stylesheets for late
fragments: SPEC §13.1. Defer vs. post-load data updates: SPEC §9.3. `kovo explain page` as one
surface: SPEC §5.3.

</details>
