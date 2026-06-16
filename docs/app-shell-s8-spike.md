# App shell S8 spike

Date: 2026-06-11

Status: bounded proof passed for the request-shell wire path; R3 proceeded with the closed
`Request -> Response` shell shape from the archived `plans/app-shell.md` ledger listed in
`plans/archive.md`.

## What Was Proven

`conformance/app-shell-spike/src/index.test.ts` starts a real `node:http` server and exercises a prototype request shell through loopback HTTP. The shell is deliberately local to the conformance fixture: it imports no `@kovojs/server` internals, so this spike proves the boundary shape rather than implementing R3.

The prototype dispatch table follows the D8 order:

1. `/_m/<mutation-key>`
2. `/_q/<query-key>`
3. `/c/<module>?v=`
4. route table / shell fallback

The conformance test parses the pinned `fixtures/wire/*.http` transcripts and sends equivalent HTTP/1.1 requests over a raw socket. It compares the live response status line, fixture-declared headers, and decoded body bytes against the pinned transcripts for:

- enhanced mutation: `POST /_m/cart/add`
- no-JS PRG: `POST /cart/add` then `GET /cart`
- 422 validation fragment: `POST /_m/cart/add`
- typed read: `GET /_q/product?id=p1`
- deferred stream: `GET /products/p1`

The deferred stream test additionally inspects the raw chunked transfer body and requires two
application chunks: the shell before `--kovo-boundary`, then the deferred query/fragment payload.
This is the S8 evidence for the SPEC §13.3 placement concern named in the archived
`plans/app-shell.md` ledger.

The `/c/` path is covered by a versioned module request to `/c/cart.client.js?v=s8`, served through the same prototype dispatch path. The test fetches the module over real HTTP, verifies the immutable-module response headers, then imports the fetched source as a JavaScript module to prove the first-interaction load path. There is no existing pinned `fixtures/wire` transcript for `/c/`; R3/R5 should add one when the production module registry lands.

## Decision Gate

Proceed with R3's `createRequestHandler(app): (Request) => Promise<Response>` shape.

CSRF/session position: keep CSRF and session resolution inside the shell before renderer dispatch. SPEC §6.5 requires `sessionProvider` to run once before route, query, or mutation guards. SPEC §6.6 requires CSRF validation before schema parsing, replay lookup, and mutation guard execution. The prototype did not fake CSRF because the pinned P0 fixtures omit `kovo-csrf`; the R3 implementation should install the hook at the dispatch boundary before calling mutation renderers.

`RoutePageResponse` conversion: converting internal response-shaped objects to web `Response` is sufficient for fixture parity. Status, status text, content type with charset, framework headers (`Kovo-Changes`, `Kovo-Idem`), redirect `Location`, and empty PRG bodies survive the `Response` boundary. Raw Node responses add adapter-level fields such as connection handling, so conformance should compare fixture-declared protocol fields plus byte-exact bodies, not a full raw socket snapshot.

Deferred streaming: HTTP/1.1 chunked transfer preserves the application chunk order when the adapter writes each stream enqueue separately. R2/R4 should keep the deferred variant as a real stream and avoid buffering the whole body before writing to `ServerResponse`; otherwise the body may stay byte-identical while losing the placement guarantee the stream fixture is meant to prove.

Header ordering: R3 should not make observable semantics depend on header order. The current fixture contract already treats headers as named protocol metadata, while body order is byte-stable. This matches the platform `Headers` object and avoids a Node adapter-specific constraint.

## Remaining Work

- Add the normative SPEC §9.5 text for the request shell and diagnostics KV228/KV229.
- Replace the conformance-local prototype with `createApp()` and `createRequestHandler(app)` once R3 lands.
- Add a pinned `/c/` module-load wire transcript when the production versioned module registry is wired into R5.
- Move the deferred chunk-boundary assertion from the spike package into the R4 node adapter tests.
