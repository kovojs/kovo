---
title: '6. Streaming & defer'
description: Ship the shell now, stream the slow part later in the same response — with the wire vocabulary you already know.
order: 6
---

# Streaming & defer

Suppose the product list gets expensive — a slow join, a recommendations service. Blocking the
whole document on it would trade away the MPA's instant first paint. In this chapter you use
`<fw-defer>` to render a fallback in the shell and stream the real fragment later, in the same
response. Step state: `site/tutorial/steps/06-streaming/`.

## Defer an expensive fragment

Deferred content reuses a mechanism you already have. The chunks that arrive after the shell are
the same `<fw-query>` and `<fw-fragment>` elements the mutation wire used in chapters 4 and 5 —
the fragment protocol, reused within first render. Nothing new ships in the loader, and nothing
new needs auditing on the wire.

{{snippet:06-streaming/src/app.ts#deferred-stream}}

The shell carries the cart badge (cheap, rendered inline) and a `<fw-defer>` placeholder with
declared fallback content. The stream then appends the products query value and the product-list
fragment; the loader morphs the fragment over the placeholder exactly as it would morph a
mutation response.

## Assert the stream as a string

A streamed response is still text in order, so the guarantees are string assertions. First: the
shell precedes the fragment. Paint now, fill in later:

{{snippet:06-streaming/src/app.test.ts#defer-test}}

Second, the ordering guarantee that keeps the client coherent: deferred query JSON arrives
**before or with** its consumers, so a fragment can never render against data the document does
not hold yet:

{{snippet:06-streaming/src/app.test.ts#query-order-test}}

## When to defer

`<fw-defer>` is the relief valve for expensive subtrees, and it's the only lazy-content
mechanism — projected children otherwise ship in the initial HTML, which is the MPA model, not an
oversight. Reach for it when a fragment's render cost would delay first paint; skip it when the
data is cheap, because a placeholder that flashes for 10ms is worse than content. The [streaming
guide](/guides/streaming/) covers priority and HTTP/1.1 considerations.

The app now paints fast, updates instantly, and degrades gracefully. What remains is the
framework's biggest claim: proving all of this behavior, mechanically, without a browser.

<details>
<summary>Spec & diagnostics</summary>

`<fw-defer>` and streaming within first render: SPEC §8. Reused fragment protocol and morph over
the placeholder: SPEC §9.1. Deferred query JSON ordered before or with its consumers: SPEC §8.
Projected children ship in initial HTML; `<fw-defer>` is the only lazy-content mechanism: SPEC
§4.5. Priority and HTTP/1.1 considerations: SPEC §13.3.

</details>
