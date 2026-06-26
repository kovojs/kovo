---
title: Wire protocol
description: Read Kovo's mutation, query, fragment, text, defer, and delta frames when debugging a page.
order: 4.8
---

# Wire protocol

Your cart form posts, the badge changes, the drawer morphs, and another tab catches up. On the
wire, that flow is a small set of readable headers and HTML-like frames. This page names those
pieces so you can inspect a network trace, understand what the loader will apply, and compare prod
delta frames with dev's full values.

The vocabulary is shared across enhanced mutations, typed reads, first-render defer streams, and
live/refetch transports. The server does not keep a session of what is on screen; the browser sends
the stamped targets it currently has, and the response carries server truth for those targets.

## Enhanced mutation request

An enhanced form posts to the generated mutation endpoint with ordinary form data plus framework
headers derived from the live DOM:

```http
POST /_m/cart/add HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Kovo-Fragment: true
Kovo-Targets: cart-badge=cart; cart-drawer=cart
Kovo-Live-Targets: cart-badge#cart-badge:{}
Kovo-Idem: cart-submit-01

productId=p1&quantity=2&kovo-csrf=csrf-token
```

- `Kovo-Fragment: true` asks for an enhanced response instead of the no-JS POST-redirect-GET path.
- `Kovo-Targets` is read from `kovo-deps` stamps in the current DOM. It tells the server which
  visible targets depend on which query instances.
- `Kovo-Live-Targets` carries the reconstructable component target identity and serialized props
  the compiler proved sufficient to render a server-refreshable fragment.
- `Kovo-Idem` is the replay token. Duplicate submissions replay the stored result instead of
  re-running the write.
- `kovo-csrf` stays in form data so the same mutation endpoint works with and without JavaScript.

App code does not construct these headers. The compiler and loader derive them from declared
queries, mutations, components, guards, and DOM stamps.

## Enhanced mutation response

After the mutation commits, the server intersects the committed changes with the submitted targets
and sends query values, fragments, or both:

```http
HTTP/1.1 200 OK
Content-Type: text/vnd.kovo.fragment+html; charset=utf-8
Kovo-Changes: [{"domain":"cart","keys":["cart"]}]
Kovo-Idem: cart-submit-01
```

```html
<kovo-query name="cart">{"count":3,"items":[{"id":"p1","qty":2}]}</kovo-query>
<kovo-fragment target="cart-drawer">
  <aside kovo-c="cart-drawer" kovo-deps="cart">...</aside>
</kovo-fragment>
```

`Kovo-Changes` is intentionally small: changed domains and keys only. It must not include input
values, validation detail, stack traces, or other internal state.

`<kovo-query>` replaces the held query value, then the loader runs that query's generated update
plan across bindings, named derives, and stamps.

`<kovo-fragment>` morphs the target DOM. Focus, selection, scroll position, CSS transitions, and
user-agent state survive where the morph algorithm can preserve them. `mode="append"` is the
explicit append vocabulary for list pagination and streams.

## Typed reads

Every query instance is also addressable as a GET. The loader uses this endpoint for focus
refetches, GET-form fragment responses, async option reads, and recovery from an unsafe delta:

```http
GET /_q/product?id=p1 HTTP/1.1
Kovo-Fragment: true
```

```html
<kovo-query name="product:p1">{"name":"Mug","stock":4}</kovo-query>
```

`/_q/<query-key>` responses carry the build's render-plan version token. If a long-open tab has a
different token, the client discards the in-place merge and follows the build-skew recovery path
instead of merging a foreign query shape.

Guarded or session-dependent query reads are credentialed private reads. They must carry
`Cache-Control: private, no-store` and `Vary: Cookie`; only compiler-proved session-independent
queries can opt into a cacheable read posture.

## Streaming frames

First-render `<Defer>` and streaming mutation responses reuse the same readable frame vocabulary:

```html
<kovo-defer target="product-grid" state="pending"></kovo-defer>
<kovo-query name="productGrid">{"items":[...]}</kovo-query>
<kovo-fragment target="product-grid">...</kovo-fragment>
```

`<kovo-defer>` is framework-emitted. App TSX authors the public `<Defer>` primitive; the wire
placeholder is an implementation frame.

Streaming mutation text uses a narrow text source, not raw HTML:

```html
<kovo-fragment target="messages" mode="append">
  <article data-stream-text="assistant:a1"></article>
</kovo-fragment>
<kovo-text target="assistant:a1" mode="append">Escaped token text</kovo-text>
<kovo-text target="assistant:a1" mode="checkpoint">Server-confirmed text so far</kovo-text>
```

`<kovo-text>` appends or checkpoints text. It does not insert model output as markup. Rich rendering
has to pass through an explicit trusted-HTML boundary, which keeps model-output XSS visible to
audits.

## Prod delta frames

Development responses favor full values because they are easiest to read. Production may send a
smaller frame when the compiler and runtime can prove it is equivalent. There is no per-call-site
knob; prod picks full or delta per response.

Delta frames are scoped by the committed change record, not by a server-side memory of the client:

```html
<kovo-query name="cart" delta settlement="cart-submit-01">
  {"items":{"upsert":[{"id":"p1","qty":3}],"removedKeys":["p2"]}}
</kovo-query>
```

The settlement set names the idempotency tokens whose committed effects are already reflected in
the arriving server truth. The client drops matching optimistic transforms before re-applying any
still-pending predictions, so confirmed writes are not counted twice.

Deep-merge semantics are fixed:

- Non-keyed scalar fields present in the delta replace the base field.
- Non-keyed object fields present in the delta replace the whole object subtree.
- Keyed collections merge by `kovo-key`: touched rows are upserted by identity, and rows are
  deleted only when their key appears in the removed-key list.
- The removed-key list is the only deletion primitive. There is no field tombstone vocabulary.

A collection is delta-eligible only when its `kovo-key` maps to domains and explicit keys in the
change record. Otherwise the response ships the whole value or a full fragment.

The client applies a delta only when it already has a base value for that query and the render-plan
version token matches. Missing base, long-open-tab skew, or stale prerender skew all fall back to a
full read over `/_q/<query-key>`.

## Live scope

The same `<kovo-query>` and `<kovo-fragment>` vocabulary is designed to work over live transports,
but `<kovo-live>` is not part of the shipped guide surface yet. Treat live subscriptions as
technical-preview roadmap material until the live-query guide and implementation evidence say
otherwise.

## Next

- [Mutations & forms](/guides/mutations/) - the authoring surface that produces enhanced mutation
  requests.
- [Queries & invalidation](/guides/queries/) - query instances, DOM stamps, and update plans.
- [Streaming & defer](/guides/streaming/) - first-render defer and streaming mutation examples.
- [Request shell](/guides/request-shell/) - dispatch order for `/_m/`, `/_q/`, client modules,
  endpoints, and routes.

<details>
<summary>Spec & diagnostics</summary>

Enhanced mutation request and response headers, target selection, `text/vnd.kovo.fragment+html`,
`Kovo-Changes`, query/frame escaping, fragment morphing, streaming mutation text, and no-JS
degradation: SPEC §9.1. Prod delta encoding, deep-merge semantics, removed-key lists, settlement
sets, base-version validation, full-vs-delta selection, and `kovo explain` reconstruction:
SPEC §9.1.1. BroadcastChannel, refetch, and live transport vocabulary: SPEC §9.3. Typed reads,
guarded read cache posture, and canonical query instance keys: SPEC §9.4. Build-skew recovery:
SPEC §14.

</details>
