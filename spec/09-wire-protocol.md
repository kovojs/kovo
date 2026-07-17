# Wire Protocol (SPEC §9)

This file is incorporated by reference from [../SPEC.md](../SPEC.md) and is normative for Kovo framework behavior.
The root spec remains the entry point and cross-reference index; this module owns the detailed contract below.

## 9. Wire Protocol

One vocabulary, transport-agnostic: document load, enhanced fetch, and SSE live updates all carry the same fragment/query chunks (§9.3). All payloads are human-readable (Constitution #4).

### 9.1 Enhanced mutation round-trip

```http
POST /_m/cart/add HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Kovo-Fragment: true
Kovo-Targets: cart-badge=cart; cart-drawer=cart; recommendations=product:p1
Kovo-Live-Targets: cart-badge#cart-badge@<attestation>:{}; recommendations#recommendations@<attestation>:{"productId":"p1"}
Kovo-Idem: 7f3a-…                          ← stamped hidden field; server replays duplicates

productId=p1&quantity=2&kovo-csrf=…
```

```http
HTTP/1.1 200 OK
Content-Type: text/vnd.kovo.fragment+html; charset=utf-8
Kovo-Changes: [{"domain":"cart","keys":["cart"]},{"domain":"product","keys":["p1"]}]

<kovo-query name="cart">{"count": 3, "items": […]}</kovo-query>
<kovo-fragment target="recommendations">
  <!-- server-rendered HTML, produced by Recommendations.render(…) — the SAME
       render function full page loads use; partials cannot drift from pages -->
</kovo-fragment>
```

- `Kovo-Targets` is read off the live DOM (`kovo-deps` stamps), so islands patched in after page load participate. The wire format is `target=queryInstance queryInstance`; singleton targets use the derived leaf (`cart-badge=cart`), and repeated targets include their stable keyed suffix (`product-form:p2=product:p2`). The server holds **no session of what's on screen** — it answers a stateless question.
- `Kovo-Live-Targets` is the structured reconstruction companion for server-refreshable component targets. Each entry names the live target, its generated component registry key, and the serialized props/key identity the compiler proved sufficient to reconstruct the component instance. Every entry MUST carry a server-minted attestation over that canonical descriptor, the canonical source-document URL (origin, path, and query; never the fragment), the exact §5.2.1 render-plan/build token, the CSRF session binding (including the framework-minted anonymous CSRF cookie when there is no app session), the independently resolved framework principal, and a separate app authority audience. A mutation or HMR sink MUST same-origin validate that source URL, match it to one canonical app route, rerun the route's complete layout/route guard chain, and use only the resulting authorized source-route request for response-side query and component rendering; the mutation or HMR endpoint request is never a substitute render context. A typed failure may select only the compiler-owned component renderer that both matches the submitted form target and declares the submitted mutation key. `createApp({ appId })` supplies the replica-stable app part of the audience; it MUST be a canonical UUIDv4 generated once per distinct app. A production app with live-target renderers MUST declare it, and distinct apps MUST use distinct UUIDs and signing secrets even across processes or isolates. A rendererless production app or development app that omits `appId` receives only a boot-local audience, never distributed authority. The render-plan/build token is deploy-skew identity and MUST NOT be treated as the app security principal merely because two apps can share the same render contract; both values are signed independently. Dev mode keeps the descriptor explicit and inspectable; prod may replace the JSON with a versioned token only when `kovo explain` can recover the same value. App authors never construct this header, import target constants, or route mutations to fragments by hand.
- `Kovo-Changes` is the sanitized wire summary of committed writes: each entry is `{domain, keys}`. It never includes mutation input, user-provided values, failure reasons, stack traces, or internal diagnostic detail; richer typed change records are internal compiler/runtime artifacts.
- `<kovo-query>` replaces the client's query value and runs that query's update plan — bindings, named derives, stamps — across every dependent island. No runtime dependency tracking: the plan is the DOM itself (§4.8). Query JSON serialized inline MUST be encoded for the exact context it lands in so attacker-controlled JSON string content cannot end the host element early. A `<script type="application/json" kovo-query="…">` initial-page island is HTML **script-data** (entities are not decoded), so its JSON MUST escape `<` as the JSON unicode escape `\u003c` — `&lt;` would not decode there and would corrupt the value. A post-mutation `<kovo-query>{…}</kovo-query>` element has **parsed** content, so its JSON MUST HTML-escape (`<`→`&lt;`, `>`→`&gt;`, `&`→`&amp;`). Both neutralize the `</script`/`<!--`/`<script` break-out; JSON quoting alone escapes neither and is insufficient. This is a normative renderer rule with a conformance test (`tests/integration/specs/xss-escaping.spec.ts`), and it binds every transport that re-emits an island — including the §9.3 BroadcastChannel rebroadcast, which forwards already-encoded bytes and never re-serializes raw values.
- `<kovo-fragment>` is **DOM-morphed** by default (idiomorph-class algorithm): user-agent and DOM-resident state — focus, scroll position, selection, in-flight CSS transitions, and `<details>`/media element UA state — survives. The morph carries **no serialization of island-local `kovo-state`**, so a refreshed parent re-emits any nested island at its render-time default state (§4.5 rule 3 re-renders the full subtree from declared queries ∪ stamped props); island-private local state is therefore **not** preserved across a fragment morph of an enclosing target. The compiler forbids the position that would silently lose it: an island declaring local `state` may not render inside another component's server-refreshable fragment target (**KV420**, §4.5). `mode="append"` is the explicit append vocabulary for pagination ("load more") and streams; `mode="prepend"` is its companion for "load older" feeds, inserting the patch at the **start** of the target. Both are ordered keyed inserts: a row whose `kovo-key` is already present is **deduped** (matched/skipped, never re-inserted) per §13.2, so a re-shipped page never duplicates rows. `mode="prepend"` additionally carries a **normative scroll-anchor guarantee** — the runtime treats the patched target as the scroll container and adjusts its `scrollTop` by the inserted height so previously-visible content stays fixed (no viewport jump when older content lands above). This is a framework guarantee, not an app knob. The read-side companion is a keyed-delta `<kovo-query … delta>` whose `lists.<path>` upsert merges the page into the SAME held query instance (§9.1.1) — `prepend`-flagged so new rows accumulate at the front of the held array — so "load more"/"load older" fetch only the new page and never re-ship prior rows. Patched-in islands are inert-until-touched like everything else — _a fragment update is a tiny navigation, not a different programming model._
- A streaming enhanced mutation response may be applied incrementally from a `ReadableStream` as complete wire elements arrive. User message rows and assistant shells still use `<kovo-fragment mode="append">`; token text uses `<kovo-text target="..." mode="append">escaped text</kovo-text>` against a compiler/runtime-declared stream source such as `data-stream-text="assistant-message:a1"`. `<kovo-text>` appends text, not HTML. `mode="checkpoint"` replaces the accumulated source text for that target with server-confirmed text so far. A stream source may declare an app-authored sink renderer for presentation, but Kovo owns the escaped source buffer and never inserts model output as raw HTML. The sink-renderer signature is constrained so this guarantee survives app code: a sink renderer is `(escaped: string) => string | TrustedHtml` — it receives the framework's already-escaped source text (never the raw model bytes) and MUST return either further-escaped text, which Kovo appends as text, or an explicit `trustedHtml(…)` value (§4.8) whose escaping it has itself discharged. A sink that returns a plain string is treated as text and re-escaped at the append boundary; only a `trustedHtml` brand is inserted as markup, so a markdown/rich sink reintroducing model-output XSS is an explicit, audit-visible KV236 trust decision rather than a silent default. The streaming text path is governed by the same §5.2 #10 output-safety contract as bindings. The final successful chunk must reconcile the affected assistant message or message list with ordinary `<kovo-fragment>` or `<kovo-query>` server truth; streamed text is progressive rendering, not a new authority.
- Streaming mutations run the same lifecycle before any user-visible assistant chunks are emitted: CSRF, schema parsing, guards, replay/idempotency reservation, and transaction policy. Interruption, abort, validation failure, guard/session failure, renderer failure, missing target, or deploy/build-token skew must either mark the submitted form/message failed or refetch/navigate to server truth. The runtime must not silently present a partial assistant answer as confirmed. Without JS, or when the form is not opted into streaming, the endpoint remains the existing POST-redirect-GET or buffered enhanced mutation path.
- **Without JS:** the same endpoint sees no `Kovo-Fragment` header and answers POST-redirect-GET with errors re-rendered into the full page. One handler, two response modes.

Success response selection is deterministic and generated. After commit, the server intersects
`Kovo-Changes` with the submitted live `Kovo-Targets`. For each affected server-refreshable target,
the generated live-target registry supplies the component render function, serializable props,
declared queries, and query-arg bindings. The first v1 implementation reloads **all declared queries
for each selected target** in the same request context and returns a complete `<kovo-fragment>` for
that target. Query JSON and prod deltas are optimizations layered on this registry when §4.8 update
coverage and change-record scoping prove they are smaller and equivalent; they are not app-authored
configuration knobs. If a target cannot be reconstructed from declared queries plus serializable
props, the compiler emits KV311/KV303 before the response path can be relied on.

There is no ordinary app-authored `mutationResponse` switch, `fragmentRenderers` list, generated
target constant import, or `render*RegionFromDb` hook in the success path. Raw endpoints/webhooks,
downloads, auth redirects, and other non-component responses use their own declared framework
surfaces rather than a general mutation-response body override. Mutation failure does not run the
success selector: it re-renders only the submitted enhanced form target with typed failure state
(§9.2), while the no-JS path re-renders the full page with the same state.

The round-trip above is the **dev** (and no-JS) form: complete `<kovo-query>` JSON and full self-describing `<kovo-fragment>` HTML. Prod ships the same vocabulary delta-encoded, described next.

#### 9.1.1 Prod delta encoding (dev ships full)

Shipping a full subtree re-render or an entire query value on every mutation is content-proportional waste — it does not compress away because it is real content, not repeated symbols. In prod the framework therefore sends the **minimal change**, automatically. There is **no knob**: the dev/prod build mode is the only switch (Constitution #2 — no per-call-site configuration), and within prod the runtime picks delta-vs-full _per response_. Names are **never** mangled in either mode; #1 is untouched.

The delta is **scoped by the change record, not diffed against client state.** This is what keeps the server stateless (§9.1 — it holds no session of what's on screen): the server never asks "what does the client currently have?" It emits only what the committed write provably touched — the `Kovo-Changes` record carries the changed `{domain, keys}` (§9.1) — and everything outside that scope is, by server truth (#5), unchanged. Every server-truth chunk additionally carries a **settlement set**: the `Kovo-Idem` tokens of the commits whose effects that chunk's re-run already reflects (the triggering mutation's own token plus any prior committed mutation whose effect is present in the post-commit query re-run). The client uses the settlement set to drop already-committed transforms before re-applying pending ones (§10.4), so a transform whose write is already folded into arriving truth is never double-counted. A delta is therefore sound _by construction_, not by reconciling two states the server would have to remember.

- **Delta query JSON.** A `<kovo-query delta>` carries only the change-record-scoped portion of the value, not the whole value. The client deep-merges it into the held query value under the **deep-merge semantics (normative)** below, then runs the **same** update plan (§4.8) — bindings, named derives, stamps.

Deep-merge semantics (normative). The merge of a delta `Δ` into a held base value is defined field-by-field, and the §5.2.1 prod gate is tied to these exact rules:

- **Non-keyed scalar fields** (numbers, strings, booleans, null) present in `Δ` **replace** the base field wholesale; the delta carries the field's new value verbatim, never a partial.
- **Non-keyed object fields** present in `Δ` **replace** the whole object subtree wholesale — the merge does not recurse into a non-keyed object to retain base sub-keys. A non-keyed object the change could have touched is sent whole (objects are cheap); an absent non-keyed field leaves the base field unchanged, and the **only** way to drop a non-keyed field is to send its parent object whole with the field omitted.
- **Keyed collections** (arrays bound with `data-bind-list` + `kovo-key`, §4.8) are the sole structures that **merge by identity, not position**: `Δ` sends only the touched rows (upsert, matched by `kovo-key` per §13.2) plus an explicit **removed-key list**. A row absent from both the upsert set and the removed-key list is left unchanged; a row is dropped **only** by appearing in the removed-key list — never by mere absence. Within an upserted keyed row, each field follows the scalar/object replace rules above against that row's prior value.
- **Deletion vocabulary.** The removed-key list is the only deletion primitive. There is no per-field tombstone and no "set to absent" merge: to remove a keyed row, name its key; to drop a non-keyed field, resend its parent object whole without it. This forbids the stale-sub-key hazard where a partially-merged object retains a key the server meant to drop.

A collection is delta-eligible only when its `kovo-key` corresponds to a domain the change record scopes with explicit keys; otherwise that collection ships whole. JSON stays schema-shaped; a frame reads as "these keyed rows of `cart` changed."

- **Smaller fragments.** The primary fragment win is _not_ sending a server-computed DOM diff (that would require the client state the stateless server refuses to hold). It is: **prefer a query delta + the client update plan over full `<kovo-fragment>` HTML** wherever the plan grammar (§4.8) covers the subtree, and for list fragments the change record can bound, send only keyed `mode="append"`/upsert rows rather than the whole list. A subtree the plan cannot express and the change record cannot bound ships as full fragment HTML — the §9.1 form, unchanged. The morph stays the same client path; it is simply fed query-driven updates or keyed rows instead of a whole subtree.
- **Base-version validation (mandatory).** A delta assumes a base — the client's held query value — that is present and was produced by the same build. Two ways it can be unsafe: the client has **no base** for that query (an island patched in after first paint, or a cold store), or a **build skew** (a long-open tab or stale prerender against a redeployed server whose query shape moved). Every page render, every delta response, and every `/_q/` read response carries the build's **render-plan version token** (§5.2.1); the client applies a delta only when the token matches _and_ a base is present, and treats any token-mismatched read or delta as a §14 build-skew event. On either failure it does not guess — it discards the delta and **refetches the full value over the typed read endpoint** (`/_q/<key>`, §9.4), a cheap GET. The client may also send its token up on the mutation request so a skew-aware server emits full directly and saves the extra round-trip. Deploy skew goes from silently-wrong to loud-and-recoverable — see §14 for the version-recovery contract and the mandatory prior-version retention window.
- **Automatic full-vs-delta selection.** The runtime ships whichever is smaller and sound: a query with no delta-eligible collection, a tiny value, the first render of a patched-in island, or a build-token mismatch all ship full. The rule is deterministic so the fixpoint and render-equivalence gates (§5.2.2) stay sound — the prod gate is `apply_delta(base, render_prod(Δ)) ≡ render_dev(full)` over the corpus.
- **Reconstruction for debugging.** `kovo explain`/MCP reconstructs the full query value from a prod delta + the held base, so an owner or agent handed a prod frame recovers dev-equivalent legibility. This is a convenience, not load-bearing: names are intact and the partial payload is already named and schema-shaped.

Mutation handlers may attach response headers through a narrow context channel. The channel is for transport metadata such as `Set-Cookie` and cache headers; it does not let handlers replace the body, status vocabulary, query reruns, fragment rendering, or PRG redirect contract. Header values emitted on the enhanced and no-JS paths are merged with framework headers after CSRF, replay, parsing, guards, and transaction commit complete.

**Header-channel transport safety (normative).** The channel is settable only through a typed surface; it is not a raw string map. Settable names are confined to a typed allowlist (`Set-Cookie`, `Cache-Control`, `Vary`, `ETag`, `Last-Modified`, `Content-Disposition`, `Location` for the declared redirect path, and the framework's own reserved `Kovo-*` names which apps may not write); any other name is rejected with **KV415**. Every name and every value the channel emits MUST be rejected if it contains CR (`\r`), LF (`\n`), or NUL, or any control character outside the printable header grammar — the channel never strips-and-continues, because a stripped value silently changes meaning; it fails the response with **KV415** so a CRLF-bearing value can never split or inject a header. `Set-Cookie` is not a free string: it is built only through the typed cookie builder (`ctx.cookies.set(name, value, { maxAge, path, domain, httpOnly, secure, sameSite, expires })`), which percent-encodes the value, validates the name against the cookie-name grammar, forbids CR/LF/NUL/`;` in name and value, and serializes attributes structurally so a user-supplied value can neither inject a second cookie nor add unintended attributes. The same rejection rule applies identically to the enhanced merge path and the no-JS PRG merge path. This is the header-channel analogue of the `<kovo-text>` and `Kovo-Changes` injection discipline (§9.1): values flowing out a header are contextually safe by construction, never by author care.

**Adapter-owned framing and hop-by-hop fields (normative).** Application response channels MUST NOT supply `Content-Length`, `Connection`, `Keep-Alive`, `Proxy-Connection`, `TE`, `Trailer`, `Transfer-Encoding`, `Upgrade`, `Proxy-Authenticate`, `Proxy-Authorization`, or `HTTP2-Settings`, under any casing. Reject them with **KV415** at the complete response-header boundary; never silently strip them. Rejecting `Connection` rejects the field and every header name it could nominate before any nominated field can acquire hop-by-hop meaning. This floor applies equally to structured framework responses, `respond.file()`/`respond.stream()`, raw endpoint `Response` values, static-export header metadata, direct Node adapter calls, and emitted Node/Vercel runtimes, for HTTP/1.0, HTTP/1.1, and HTTP/2 compatibility paths. Only after that validation may a framework adapter attach or replace its own framing/connection metadata (for example exact static-file `Content-Length`, compression-derived `Content-Encoding`, or `Connection: close`). Thus an app-controlled length or transfer field can never disagree with the bytes Kovo writes or turn a keep-alive response body into a queued-response prefix.

Raw HTTP integrations use declared `endpoint()` entries, not ad-hoc server escape hatches. An endpoint is registry-visible, receives `Request -> Response`, requires an explicit HTTP `method` (there is no implicit any-method endpoint), requires an endpoint-level `reason`/`purpose`, and is enrolled in the endpoint and unguarded audits with the same auth metadata as routes, queries, and mutations. Prefix mounts require a `mountJustification` because they enlarge the routed surface beyond one path. Endpoint declarations also carry raw response posture metadata for the audit row: body class (`html`, `json`, `text`, `bytes`, `stream`, or `redirect`), cache posture, and whether app code owns body encoding plus response-header safety. That app-owned posture never transfers message-framing or hop-by-hop authority: the framework still reconstructs raw response headers and applies the adapter-owned-field KV415 floor above. The closed safe-method set is `GET`, `HEAD`, and `OPTIONS`; every other method, including an extension method unknown to Kovo, is unsafe and receives the default synchronizer-token check unless the endpoint explicitly opts out of CSRF with a named justification. A safe-method endpoint receives only a managed DB Reader from `ctx.actAs()` and MUST NOT emit `Set-Cookie` or `Clear-Site-Data`; an executable non-ambient verifier that actually succeeds for the exact request (or an equivalent private framework-owned self-verifying receipt) may authorize those browser-state effects. The runtime enforces both known capability boundaries even if application types are bypassed. App-owned side effects outside Kovo's capability and response sinks remain the application's responsibility, so authors MUST use an unsafe method for a state-changing operation. Endpoint handlers receive the raw `Request` before body parsing so signature verification can use wire bytes; exact and prefix mounts are declared; cookies are not interpreted and no ambient `req.session` is passed. A CSRF exemption is sound only because endpoint/webhook auth does not ride ambient browser authority. OAuth/SAML callbacks and adapter-owned mounts belong here; browser credential forms should still prefer typed `mutation()` flows so they keep schema validation, no-JS behavior, and the normal response vocabulary.

An endpoint `auth` declaration MAY carry an executable verifier from the webhook verifier kit. When present, the dispatcher MUST verify cloned raw wire bytes `{ headers, payload }` before CSRF validation and before the handler runs; verifier `false`, malformed input, or thrown verifier errors fail closed with `401 Unauthorized`, and the original request body remains readable by the handler after a successful check. Name-only endpoint auth declarations remain audit metadata. `webhook()` continues to emit name-only endpoint auth because it self-enforces raw-byte verification in its own lifecycle before parsing.

`webhook()` is the shaped machine-endpoint primitive for third-party POSTs that write Kovo-owned data. Shape: `webhook('/provider/path', { verify, input, idempotency, handler })`, lowering to a registry-visible endpoint with a source-derived webhook identity (§4.1) and `auth=verifier:<resolved scheme>` unless an explicitly justified custom/none verifier is used. The first string is the public HTTP receiver path, not the webhook registry name. The lifecycle is fixed: capture one request clock and the raw bytes → verify → parse/coerce a loose input schema (unknown provider fields pass through) → construct and validate an authenticated provider-event replay identity → atomically reserve/replay under the source-derived webhook identity → optional framework transaction wrapper → handler receives a machine-ingress context with no ambient session and dispatches Kovo-owned writes through `context.runMutation(mutation, input)` → the called mutation owns the audited DB write, touch set, and static diagnostics → commit/store the response and emit the unified change record `{domain, keys, input}` derived from the called mutation's committed changes.

`idempotency(input)` MUST return either `undefined` or the exact opaque value created by `webhookReplayIdentity(key, occurredAtMs)`. `key` is the non-empty provider event id (1..1,024 visible ASCII characters), and `occurredAtMs` MUST be the event's own occurrence time from the authenticated provider payload. Local receipt time, `Date.now()` inside the callback, an HTTP delivery timestamp, and an HMAC freshness timestamp are not event occurrence and MUST NOT be substituted. The constructor derives an immutable `expiresAtMs = occurredAtMs + 30 days`; its private TypeScript brand is only an authoring guardrail, while module-private runtime provenance rejects casts, structural copies, and forged objects. After verification and parsing but before any replay-store call or handler execution, the runtime validates the canonical identity against the one captured request clock: `expiresAtMs <= now` is stale, and `occurredAtMs > now + 5 minutes` is future-dated. Either temporal failure is a sanitized 422. Because asynchronous verification or parsing can cross the horizon after that captured-clock check began, the replay store MUST also reject fresh reservation at its current clock when `expiresAtMs <= now`; that refusal is a retry/unavailable response and the handler does not run. Settlement that crosses the horizon MUST leave the already-held claim pending and fail closed rather than create immediately removable committed truth. An invalid key, timestamp, unproven return value, callback throw, or otherwise malformed result is an internal posture failure answered with a sanitized 500 at that same boundary. The callback is evaluated exactly once per delivery.

The replay store receives the canonical `{ key, occurredAtMs, expiresAtMs }` facts intact, never a raw string or store-local TTL. A redelivery of the exact live identity replays the stored response and must not re-execute the handler or dispatched mutation. Reuse of a live `(webhook scope, key)` with different occurrence or expiry facts is an integrity conflict answered with sanitized 422, never an alternate event admitted alongside the first. Committed truth retires only at the exact authenticated expiry under §10.3; pending truth never expires automatically. `recordChange()` remains a narrow compatibility/manual-change bridge and is checked against declared `writes`; it is not the primary audit source for arbitrary raw transaction writes. Direct DB writes from webhook handlers remain KV330/KV406. `fail()` rolls back and answers the declared 4xx/5xx response so provider retry semantics are explicit.

The verifier kit is part of the normative surface for `webhook()`: `hmacSignature({ header, payload, encoding, tolerance, multiSig })` is the generic form, and `standardWebhooks({ secret })` is the shared non-vendor preset that resolves to printed generic HMAC configuration. Provider-specific HMAC recipes live in app/example code on top of `hmacSignature`, not in framework package exports. Verification is over raw bytes, uses constant-time comparison, enforces timestamp tolerance, and supports rotated secrets/multiple signatures. Non-HMAC providers use a custom `verify(request)` escape that appears as custom auth in the audit; `verify: 'none'` requires a named justification and appears as unauthenticated machine ingress.

### 9.2 Errors

Validation failures (schema, with field paths) and declared error codes return HTTP 422. The enhanced
path infers the submitted form instance from the request's compiler-emitted form target and returns a
`<kovo-fragment>` for that form only; the no-JS path re-renders the full page. Both paths call the
same component render function with the same typed failure state in `forms.<mutation>.failure`, so
expected failure UI is normal TSX (`<FieldError>`, `<FormError>`, or direct `forms` reads) rather
than a separate response template. `ctx.submit`'s `onError` receives the same typed union. Expected
failure responses never use committed invalidation or `Kovo-Targets` success selection.

Declared `fail()` payloads are client-bound wire values and MUST satisfy the same `JsonValue`
vocabulary as query values and island state: JSON primitives, arrays, and plain objects only. An
error schema may parse richer server-side values for internal use, but `context.fail(code, payload)`
rejects `Date`, `Map`, functions, class instances, and other non-JSON payloads at the TypeScript
boundary before they can enter `forms.<mutation>.failure` or the enhanced/no-JS error wire.

An **unauthenticated** mutation guard failure is not part of this typed validation union (§6.5). It does not render a `forms.<mutation>.failure` fragment: the enhanced path answers **HTTP 401** with a `Kovo-Reauth` directive (login route + same-origin `next`) the loader follows to re-authenticate, and the no-JS path answers a **303** redirect to the login route with `next`. An **authenticated-but-unauthorized** mutation guard failure answers **HTTP 403** and carries an `unauthorized` code in `forms.<mutation>.failure` so authorization-denied UI is typed and distinguishable from schema/app validation failures.

Unexpected server failures are not part of the typed union and must not leak internals. The typed query endpoint (§9.4) returns HTTP 500 with JSON `{"code":"SERVER_ERROR","payload":{}}`. Full-page route rendering returns HTTP 500 with the app's stable error shell or the fallback body `Internal Server Error`. Enhanced mutation responses that fail while rendering post-commit queries/fragments return a render-error fragment with HTTP 500 and `data-error-code="RENDER_ERROR"`; any `Kovo-Changes` header on that response remains sanitized to `{domain, keys}` for writes that already committed.

### 9.3 Liveness and Live

Kovo separates low-cost liveness from explicit live subscriptions:

- **BroadcastChannel rebroadcast** — a mutation's `<kovo-query>` response is rebroadcast to the user's other tabs; same-user multi-tab sync at zero server cost. Because BroadcastChannel is **origin-scoped, not principal-scoped**, every rebroadcast envelope MUST carry a **session/principal fingerprint** derived from the sender's `req.session` identity. A receiving tab MUST discard any message whose fingerprint ≠ its own current `req.session` identity, and MUST drop the channel on session change — so one user's private query data can never be morphed into a different user's UI on a shared or fast-user-switched device. This receive-side principal check is normative to the same degree as the SSE per-push guard re-check below; rebroadcast must not become a cross-principal disclosure side channel.
- **Refetch on focus/visibility** — a loader behavior (per-query opt-out) that re-runs queries (over the typed read endpoint, §9.4) when a stale tab returns; it fakes an embarrassing share of "live" UX for one conditional in the loader.
- **Live queries (roadmap; not shipped in v1 technical preview)** — `<kovo-live query="cart">` will subscribe over SSE to the identical `<kovo-query>`/`<kovo-fragment>` chunks; guards must be re-checked at subscription **and** at each push (a guard that passed at render must pass at patch time — fragments must not become a privilege-escalation side channel); in-process emitter (single node) or Redis pub/sub (multi-node); instance-key routing; `live: true` opt-in per query. Until this transport ships, `live: true` is not a valid `query()` definition field and `<kovo-live>` is not an implemented authoring primitive; accepting either as a silent no-op would violate the no-op-field contract.

The vocabulary is transport-agnostic by construction, so SSE is an additive transport, not a rearchitecture.

### 9.4 Typed reads: the query endpoint

Every query is addressable over GET — one read surface serving refetch-on-focus (§9.3), GET-form fragment responses (§7), async option/search reads, and the future SSE subscription key:

```http
GET /_q/product?id=p1 HTTP/1.1
Kovo-Fragment: true
```

```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8

<kovo-query name="product:p1">{ "name": "Mug", "stock": 4 }</kovo-query>
```

Every `/_q/` response MUST carry the build's render-plan version token (§5.2.1) so a refetch into a stale tab is detected like a delta is: a client whose document token differs from the response token discards the in-place merge and performs §14 recovery rather than merging a foreign-shape value. Args arrive as search params through the query's `args` schema (§10.2) — the same `s.*` coercion machinery as forms. The query's `guard` (§10.2) is checked on **every** read, and reads are part of the unguarded audit. The instance key in the response (`product:p1`) is the §10.2 canonical encoding — the single currency shared across client store, wire, and optimism.

**Caching contract (normative).** `/_q/<key>` is a credentialed GET whose body varies by identity, so a URL that differs only by args is a shared-cache key collision waiting to leak one principal's data to another. A `/_q/` response for a guarded or otherwise session-dependent query (a query with a `guard`, or whose instance key or `load` reads `req.session.*`) MUST carry `Cache-Control: private, no-store` and `Vary: Cookie`, so no shared (CDN/proxy) cache can store it and a browser cache cannot serve it across the guard. This holds for every transport that hits `/_q/` — loader fetch, refetch-on-focus (§9.3), GET-form fragment responses (§7), and async option/search reads. The directives may be relaxed (to a cacheable posture) only for a query the compiler proves session-independent — no guard and no `req.session` read in its key or `load` — mirroring the export session-dependence proof (§9.5/KV229); such a query may set an explicit `Cache-Control` through its declared read config. A guarded query may never be served from a shared cache: the guard-at-every-read invariant must not be bypassable by an intermediary.

### 9.5 Request shell

The request shell is the server-owned composition point for routing, document assembly, dev serving, and export. Apps declare a closed `createApp()` aggregate: routes, mutations, queries, endpoints, the client-module registry, document options, unexpected-error shells, CSRF config, the `db` provider, the §6.5 `sessionProvider`, and a replica-stable `appId` used to distinguish live-target authority between apps with identical render contracts (required when production apps own live-target renderers). Generated route IR and live-target registry artifacts are wired by the compiler/build integration, not by app-authored `createApp({ generated, refresh })` options. The loader MUST establish an app-owned registry scope before evaluating generated modules; concurrent or top-level-await app graphs may not share a process-global pending registry, unscoped late/HMR registration is not runtime authority, and mutation/HMR sinks may not fall back from their closed app inventory to a process registry. Vite/dev integration points at an authored app entry, for example `kovo({ app: '/src/app.tsx' })` from `@kovojs/server/vite`; the entry must default-export a `KovoApp` and must not point into `src/generated/*`. Compiler-owned plugins resolve route IR, live-target registries, and generated client modules internally. The public handler currency is web-standard `Request -> Response`; adapters such as `node:http` convert at the edge.

Dispatch order is normative and printable: `/_m/<mutation-key>` mutations, `/_q/<query-key>` typed reads, `/c/__v/<version>/<module>` immutable client modules, declared `endpoint()` exact/prefix mounts, route table, then the 404 shell. There is no user middleware chain in v1. Extension points that can affect control flow are declared surfaces — `sessionProvider`, guards, `endpoint()`, `webhook()` — so audits can print them and no request behavior is registered from a distance.

**Pre-dispatch load shed (normative).** Because there is no user middleware chain, the request shell/adapter itself owns a coarse limiter that runs **ahead of** replay lookup, schema parse/coercion, and the guard chain (§10.3) — guard combinators such as `rateLimit({ per: 'session' })` shed load only after CSRF, replay, and parse have already paid out, and `per: 'session'` cannot distinguish a flood of null-session attackers, so they are insufficient as the only chokepoint. Before any `/_m/`, `/_q/`, `endpoint()`, or route dispatch the shell MUST enforce: (1) a maximum request/body size — a request exceeding it is rejected with **413** before the body is parsed; streamed bodies additionally have a hard 4,096-chunk budget and exceeding it is the same 413-class body-limit failure even when the byte count remains below the configured maximum, so adversarial transfer fragmentation cannot turn the byte limit into unbounded per-chunk work; (2) a serialized request-target ceiling of 65,536 JavaScript string code units and a 10,000-entry URL-query ceiling — Node/Vite/generated adapters MUST scan the raw target before constructing a Web `Request`, `URL`, or `URLSearchParams`, and a direct Web handler MUST scan `Request.url` before constructing `URL`/`URLSearchParams`; either target violation is rejected with **414**, including for static and not-found paths; (3) URL-encoded body segments and multipart parts share the same default KV430 breadth ceiling of 10,000 entries, counted before record reconstruction, split, or part adoption, so a compact separator-heavy carrier cannot amplify into an unbounded parser graph; and (4) a coarse per-IP and global request-rate budget — a request over budget is rejected with **429** carrying `Retry-After`, before replay+parse. `createApp({ requestLimits })`, its body-size gate, and every base or per-surface rate budget are mandatory finite postures and MUST NOT accept `false`; author-supplied maxima are bounded to 67,108,864 body bytes, 100,000 query/list result items, 1,000,000 requests per rate window, 100,000 retained rate keys, and an 86,400,000 ms rate window. These limits are normative defaults configured on `createApp()` (per-IP and global `/_m/` and `/_q/` request rates, max body size, and a bound on fragment-targets reconstructed per response, §9.1); the coarse limiter is identity-blind on purpose so it survives the anonymous flood the session-scoped limiter cannot. This pre-dispatch posture is enrolled in and printed by the `--endpoints` audit. The fine-grained `rateLimit` guard combinator still runs in the guard chain for per-principal policy. It admits a `per: 'ip'` (and global) dimension in addition to `per: 'session'`, so an anonymous or per-IP budget can also be expressed at the guard layer; the coarse shell limiter and the guard combinator compose rather than replace each other.

Route matching is static-first at each path segment, and ambiguity is a compile error **KV228** rather than a runtime precedence footnote. Trailing slashes normalize to one canonical path with a 308 redirect before matching. Page routes answer GET and HEAD; other methods on a page path are 405 because mutations own POST via `/_m/`.

The shell owns document assembly. The default document contains the doctype, `<html lang>`, route/query meta, page hints (stylesheet links, modulepreloads, optional speculation rules), initial `<kovo-query>` scripts before consumers, the page body, and the inline loader. Apps may provide `createApp({ document: { template } })`, but the template receives assembled parts rather than a blank canvas, so it cannot silently drop loader or hydration contracts. Deferred streams use the same assembled shell parts; partials must not drift from full documents.

Unexpected-error shells are app config with safe defaults: 404, 403, and 500 documents may be supplied by the app, while unexpected failures still use the stable no-internals bodies from §9.2 when no shell is provided. The shell resolves `db` and `sessionProvider` once before route, query, or mutation guards; route/query guard failures use the §6.5 unauthenticated redirect and 403 contract.

Static export replays synthetic GET `Request`s through the same handler. An exportable route writes `.html`, referenced immutable `/c/` modules, and static assets; there is no second render path. Export is L0/L1 only: a route with a guard, unproven session dependence, mutation-only interaction, or a param path without explicit static-path enumeration fails or skips loudly with **KV229** according to the configured export policy. Exported documents disable server refetch assumptions; the no-JS document is the artifact.

#### 9.5.1 Dev HMR

Hot module reloading is a dev-only request-shell enhancement over Vite transport. It is not a
client render graph, hydration mode, or router. Vite's websocket may carry Kovo `custom` events,
but every DOM-changing hot action still asks the app shell for server-owned route, query, or
fragment output before morphing. Unsupported or unproven edits delegate to Vite's full reload.

The app-facing dev API is a convenience wrapper around the compiler plugin and the app-shell dev
plugin. App authors should not hand-wire generated refresh registries, HMR endpoints, or client
module maps into `createApp()`: the request shell remains the owner of dev serving, diagnostics,
and refresh dispatch. The wrapper wires compiler diagnostics into the same dev diagnostic ledger
used by page, fragment, and mutation requests, so a failed hot update and a failed direct request
render the same teaching document.

HMR impact classification is compiler-owned and fact-based. After parsing, impact decisions must use
typed lowering facts (§5.2 rule 9), not source-string heuristics. The impact ladder is:
server fragment/query refresh for a proven compatible live target; current-route document refresh
when the route shell is still compatible; `kovo:diagnostics` for compiler errors; and
`kovo:full-reload` for route table, app shell, query-plan, render-plan token, generated-registry,
bootstrap, stylesheet topology, pending optimistic work, missing fact, or any other unsafe change.

The stable dev event vocabulary is:
`kovo:component-render`, `kovo:route-shell`, `kovo:diagnostics`, and `kovo:full-reload`. Events carry
the source file, old/new client module hrefs when known, the impacted component/live-target ids when
proven, diagnostics summary when present, and old/new render-plan tokens when available. Stale
events whose token does not match the current document are rejected and escalate to full reload.

The dev-only browser entry is served or injected only by the Vite dev stack. It must be absent from
production builds and static export artifacts. Dev refresh endpoints are likewise Vite-dev-only and
must reuse existing app-shell render, query, live-target renderer, and fragment-wire code; production
`createRequestHandler()` never exposes HMR endpoints. Live-target refresh accepts POST only. Every
route or live-target refresh response, including method and authorization failures, MUST carry
`Cache-Control: private, no-store` and `Vary: Cookie`, because the bytes can depend on the resolved
session, route guards, queries, and component render context even in development.

### 9.6 Durable tasks and scheduling

`task()` is the durable background-function primitive for non-transactional side effects. A task is a
typed registry entry with an `input` schema and a `run(args, ctx)` body; no opaque closures cross the
boundary. Task code may perform external I/O, but task DB writes must go through `ctx.runMutation(...)`
and reads through `ctx.runQuery(...)`, so every data change still reuses the audited mutation/query
surfaces (§10.2, §10.3). A task context may schedule more tasks, use external `fetch`/storage/secrets
capabilities, and receive a stable job id for external idempotency keys; it does not receive the
caller mutation's transactional `db`.

`request.schedule(task, args, opts?)` is the only built-in way for a mutation handler to arrange
post-commit work. Scheduling writes a durable job row in the same transaction as the mutation's data:
commit means the job is ready to run, rollback means the job was never enqueued. The scheduled args
are validated by the task's `input` schema and serialized data, not captured process state.
`opts.afterMs` / `opts.at` set `run_at`; `opts.key` gives a logical pending-job identity. The default
keyed behavior is debounce: a ready job with the same key has its `run_at` and args replaced by the
latest schedule. `coalesce: 'throttle'` keeps the earliest ready job and its first args. A running or
already-finished job is never mutated; re-scheduling creates a new ready job. `request.schedule`
returns a typed handle, and `request.cancel(handle)` transactionally cancels a still-ready job and
returns whether cancellation happened.

The default node `JobRunner` drains the queue from Postgres with `FOR UPDATE SKIP LOCKED`, leases,
retry/backoff, and dead-letter rows. Multiple nodes may run the same drainer; row locks make claims
disjoint. A lease reaper returns expired `running` jobs to `ready`, so delivery is at-least-once.
Exactly-once effects are obtained by idempotency: Kovo derives a stable idempotency key per scheduled
job and exposes the job id as the key a task passes to non-idempotent external APIs. A retry must not
double-charge, double-send, or otherwise commit an effect without an idempotency key.

Every preset that supports `task()` MUST declare a `JobRunner` capability. The node preset's
in-process runner is on by default; a runner-only mode may drain jobs without serving HTTP. A preset
with no runner capability MUST fail closed at build time when `task()`/`schedule()` is used, with an
actionable diagnostic; it must never silently enqueue work that no deployed artifact can run. Runner
capacity is bounded by the DB pool, per-task concurrency, priority lanes, and task timeouts/leases.
Delayed self-reschedule carries a lineage generation counter with a conservative default ceiling and
a delay floor, so polling/saga loops are explicit and runaway loops dead-letter instead of hammering
the database.

The capability declaration above is framework-internal build authority. The public value returned by
a built-in preset factory is only the opaque selection token defined by §6.6: it exposes neither the
`JobRunner` record nor any inspection/emission callback. Build preflight resolves the exact token and
checks the internal capability; app-authored structural or copied preset objects cannot declare a
runner and cannot bypass the missing-runner diagnostic.

---
