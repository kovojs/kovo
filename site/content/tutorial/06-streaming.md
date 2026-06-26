---
title: '6. Streaming & defer'
description: Ship the shell now, stream the slow part later in the same response — with the wire vocabulary you already know.
order: 6
---

# Streaming & defer

Suppose the product list gets expensive — a slow join, a recommendations service. Blocking the
whole document on it would trade away the MPA's instant first paint. In this chapter you author
`<Defer>` in TSX so the shell can paint now and the product list can stream later in the same
response. Step state: `site/tutorial/steps/06-streaming/`.

## Defer an expensive fragment

Import `Defer` from `@kovojs/server`, give it a stable target, render an honest fallback, and put
the slow region behind `render`:

```tsx
import { Defer } from '@kovojs/server';

const products = (
  <Defer
    target="product-list"
    fallback={<section aria-busy="true">Loading products...</section>}
    render={() => <ProductList />}
  />
);
```

Then place that boundary in the page shell:

```tsx
export function ShopPage() {
  return (
    <main>
      <CartBadge />
      {products}
    </main>
  );
}
```

Deferred content reuses a mechanism you already have. The chunks that arrive after the shell are
the same `<kovo-query>` and `<kovo-fragment>` elements the mutation wire used in chapters 4 and 5.
The emitted placeholder is `<kovo-defer>`, but app code authors `<Defer>`.

{{snippet:06-streaming/src/app.test.ts#deferred-stream}}

The shell carries the cart badge, which is cheap and rendered inline. Kovo emits a `<kovo-defer>`
wire placeholder with your fallback content. The stream then appends the products query value and
the product-list fragment; the loader morphs the fragment over the placeholder exactly as it would
morph a mutation response.

## Assert the stream as a string

A streamed response is still text in order, so the guarantees are string assertions. First: the
shell precedes the fragment. Paint now, fill in later:

{{snippet:06-streaming/src/app.test.ts#defer-test}}

Second, the ordering guarantee that keeps the client coherent: deferred query JSON arrives
**before or with** its consumers, so a fragment can never render against data the document does
not hold yet:

{{snippet:06-streaming/src/app.test.ts#query-order-test}}

## When to defer

`<Defer>` is the relief valve for expensive subtrees, and it's the only lazy-content
mechanism — projected children otherwise ship in the initial HTML, which is the MPA model, not an
oversight. Reach for it when a fragment's render cost would delay first paint; skip it
when the data is cheap, because a placeholder that flashes for 10ms is worse than content.

## Multiple defers in one response

A page can hold more than one `<Defer>`, and each is independent: a slow recommendations rail
and a slow reviews block can both stream while the shell — and everything cheap in it — paints
immediately. Split them when their costs differ, so a 50ms fragment isn't held behind a 2s one;
each chunk arrives and morphs in as its own work finishes. Don't over-split, though. Every defer
adds a placeholder that flashes, so group content that resolves together behind one boundary rather
than scattering a dozen tiny defers across the page. Priority — which late region the server should
flush first — is declared on the route/component surface that owns it, not inferred.

## The HTTP/1.1 head-of-line caveat

The whole streamed response is one ordered byte stream, so the transport matters. Over HTTP/2 (or
HTTP/3), the connection multiplexes — other requests on the page, like a client island's first
import or a navigation prefetch, interleave with the in-flight stream and don't wait behind it.
Over HTTP/1.1 there is no multiplexing on a single connection: a long-running deferred response can
hold the line, and a browser limited to a handful of parallel HTTP/1.1 connections per origin can
stall other requests behind your slow fragment. This is a property of the transport, not of
`<Defer>` — but it changes the calculus. On HTTP/1.1, a defer that takes seconds can cost you
more in blocked sibling requests than it saves in first paint, so prefer fewer, coarser defers and
make sure your hosting terminates HTTP/2. Finer priority semantics and query-JSON placement under
HTTP/1.1 fallbacks are still open design areas; the before-or-with ordering guarantee below is the
contract you can depend on regardless of transport. The [streaming guide](/guides/streaming/)
covers priority and HTTP/1.1 considerations in full.

## How defer interacts with invalidation

A deferred query is still a real query — it carries the same `kovo-deps` stamps and the same read
set as one rendered inline. So once the fragment lands, it is a full participant in the
invalidation loop from chapter 5: if a later mutation touches a domain the deferred query reads,
that query re-runs and the deferred island updates exactly like any other dependent island. Nothing
special is needed because the defer arrived late — the loader has already wired its bindings by the
time the mutation's response comes back. The one ordering rule that protects this is the guarantee
you assert above: a deferred query's JSON arrives **before or with** the fragment that binds to it,
so the document never holds a binding whose data hasn't landed. A mutation that fires while a defer
is still streaming sees a coherent document either way: it refreshes whatever query values are
present, and the deferred chunk, when it arrives, carries the freshest server value.

The app now paints fast, updates instantly, and degrades gracefully. What remains is the
framework's biggest claim: proving all of this behavior, mechanically, without a browser.

<details>
<summary>Spec & diagnostics</summary>

`<Defer>` and streaming within first render: SPEC §8. Reused fragment protocol and morph over the
framework-emitted `<kovo-defer>` placeholder: SPEC §9.1. Deferred query JSON ordered before or with
its consumers: SPEC §8. Projected children ship in initial HTML; Defer is the only lazy-content
mechanism: SPEC §4.5. Priority and HTTP/1.1 considerations: SPEC §13.3. App-authored `defer(...)`
as a JSX child is **KV244**.

</details>
