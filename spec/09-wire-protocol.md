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
Kovo-Build: <app-build-token>
Kovo-Targets: cart-badge=cart; cart-drawer=cart; recommendations=%21product%21product%3Ap1
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

**Framework wire-input registry (normative).** Every framework-owned header, cookie, or URL-search
input belongs to one core-owned typed registry that declares its carrier, canonical name, and finite
grammar. Kovo's browser encoder and server decoder for a structured wire value MUST be derived from
the same exact codec; independent handwritten implementations of the grammar are not conforming.
The codec is covered by a seeded `decode(encode(value)) ≡ value` oracle, including delimiter,
escaping, Unicode, size, and malformed-input cases.

`Kovo-Build-Skew` is a framework-reserved, response-only field. Its sole valid value is the exact
ASCII token `true`, and it is meaningful only on an admitted HTTP 409 response that also carries
the selected app's `Kovo-Build`, the inline fragment media envelope, and the private/no-store
posture. An ordinary unmarked application 409 (including a typed stale-version conflict) is not a
deploy-skew verdict. Application response headers cannot mint, replace, or override this marker.
Intermediaries serving enhanced Kovo traffic MUST preserve it; if they instead alter or remove the
coupled build stamp, the unequal/missing-token recovery rule still forces a full reload.

Identity tokens use one canonical percent codec: RFC 3986 unreserved bytes remain literal and every
other UTF-8 byte is `%HH` with uppercase hex. Decoders reject raw delimiters, lowercase/non-minimal
escapes, invalid UTF-8, NUL, CR, and lone surrogates; they never trim ordinary data. `kovo-deps`
stores exact query-dependency tokens separated only by ASCII spaces. An unkeyed dependency is the
canonical query-name token. A keyed dependency is `!<canonical-name>!<canonical-full-key>`; `!` is
reserved as the structural delimiter and is `%21` inside an ordinary identity, so `{name, key}` is
injective and can never collide with an unkeyed name equal to the full key. Component identities are
encoded like target identities. A present empty DOM identity (for example `kovo-key=""`) remains distinct
from an absent attribute, but header/query names and instance identities are non-empty. DOM token
decoding is linear and has no HTTP-size ceiling; the 4,096-character ceiling belongs only to each
HTTP form/list encoder.

Every target-bearing browser request carries a required fragment-free `Kovo-Current-Url` of at most
1,536 ASCII characters and the exact immutable document app build token in `Kovo-Build`. The
framework headers together have an exact 9,216-byte HTTP/1 line budget,
counting each name, `: `, value, and trailing CRLF. A present form target is required to fit; target
and live-target lists truncate only at complete entries and empty list headers are omitted. Delegated
submit performs this preflight before `preventDefault()` and leaves the native submit untouched when
the URL, form target, or required lines cannot fit. Direct programmatic fetch fails explicitly.
Mutation, HMR, and lifecycle target refreshes use `Referrer-Policy: origin`; malformed responses or
refresh failures trigger the owning full-document recovery path rather than leaving stale truth.

Every framework-owned read of a registered carrier MUST pass through a named canonical reader and
be present in the exact TypeScript-symbol census enforced by `check:wire-input-boundary`. A literal
read binds the exact carrier and canonical name in the registry. Only an explicitly reviewed
dynamic door may bind the registry's `*` name, and that door remains responsible for applying the
selected entry's grammar before the value reaches framework behavior. Same-named lookalikes do not
satisfy the census. App-owned reads and reviewed third-party adapters are outside this registry
unless their value enters a named framework protocol door; at that point the normal registry and
reject-by-default rules apply.

- `Kovo-Targets` is read off the live DOM (`kovo-deps` stamps), so islands patched in after page load participate. Its semantic dependencies are exact `{name, key?}` facts, not colon-split strings. The header encodes the target and each complete dependency token through the canonical identity codec: for query `product` at full instance key `product:p2`, the physical entry is `product-form%3Ap2=%21product%21product%3Ap2`. The server holds **no session of what's on screen** — it answers a stateless question.
- `Kovo-Live-Targets` is the structured reconstruction companion for server-refreshable component targets. Each entry names the live target, its generated component registry key, and the serialized props/key identity the compiler proved sufficient to reconstruct the component instance. Every entry MUST carry a server-minted attestation over that canonical descriptor, the canonical source-document URL (origin, path, and query; never the fragment), the exact §5.2.1 app build token, the CSRF session binding (including the framework-minted anonymous CSRF cookie when there is no app session), the independently resolved framework principal, and a separate app authority audience. A mutation or HMR sink MUST same-origin validate that source URL, match it to one canonical app route, rerun the route's complete layout/route guard chain, and use only the resulting authorized source-route request for response-side query and component rendering; the mutation or HMR endpoint request is never a substitute render context. A typed failure may select only the compiler-owned component renderer that both matches the submitted form target and declares the submitted mutation key. `defineKovo({ appId })` supplies the replica-stable app part of the audience when its single `assemble()` closes the contract; `appId` MUST be a canonical UUIDv4 generated once per distinct app. `create-kovo` generates it and migrations preserve it. A production app with live-target renderers MUST declare it, and distinct apps MUST use distinct UUIDs and signing secrets even across processes or isolates. A rendererless production app or development app that omits `appId` receives only a boot-local audience, never distributed authority. The app build token is deploy-skew identity and MUST NOT be treated as the app security principal merely because two apps can share the same render contract and active module set; both values are signed independently. Dev mode keeps the descriptor explicit and inspectable; prod may replace the JSON with a versioned token only when `kovo explain` can recover the same value. App authors never construct this header, import target constants, or route mutations to fragments by hand.
- The synchronizer token, replay scope, and live-target attestation consume one exact CSRF binding. On a framework lifecycle request, `CsrfOptions.sessionId` MUST return an opaque non-empty string of at most 1,024 characters for a resolved session and `undefined` only for a genuinely anonymous request. A non-string, missing, empty, or oversized authenticated value, an unresolved framework session, or an anonymous framework posture paired with a defined id fails closed; it never falls back to the anonymous cookie. Standalone CSRF helper inputs without framework lifecycle posture continue to treat the callback as their declared session/anonymous authority. Session ids and anonymous-cookie secrets occupy separately labeled, canonical length-framed domains, and the framework-resolved authorization principal is independently framed into authenticated bindings, so shared or namespace-shaped rotation ids cannot validate or replay across principals. Every authorization principal and source-derived mutation identity entering that replay scope is non-empty and at most 1,024 JavaScript code units. An inbound anonymous-cookie secret is 32..1,024 base64url characters (framework minting produces 43); a present malformed or oversized cookie fails closed instead of being silently replaced.
- A `csrf: false` mutation never derives replay authority from a session field or a mutation-wide
  fallback. With replay storage active it MUST declare `machineReplayPrincipal(request)`, evaluated
  exactly once after parse/coerce and the successful guard/access decision. The callback receives
  that pinned post-guard request and MUST return a primitive 1..1,024-code-unit caller/tenant id.
  Missing, malformed, thrown, or rejected results produce the generic 422 idempotency conflict
  before replay-store or handler work. Kovo length-frames the value under a versioned
  machine-replay domain and SHA-256 commits the exact UTF-16LE encoding of every JavaScript code
  unit, including lone surrogates; raw identity bytes never enter store keys or diagnostics.
  Protected-CSRF declarations reject this field. Enhanced and no-JavaScript requests use the same
  claim namespace, while their response classifiers stay closed: a cross-mode retry conflicts and
  cannot execute under a second namespace. Buffered and streaming enhanced requests likewise share
  one claim. The endpoint first normalizes the requested mode to what the dispatched mutation can
  actually produce (a mutation without a stream hook is buffered), then binds the committed replay
  record and live response to that delivery vocabulary. A streaming record/response carries the
  exact framework-owned own-data header `Kovo-Stream: true`; a buffered one omits every casing of
  that name. The final framework response and replay-settlement seals remove app-authored marker
  attempts before minting that vocabulary. Replay release requires a stable header-name snapshot,
  at most one exact-cased marker, the exact string value `true`, and equality with the current
  normalized delivery mode. Missing stream markers, injected buffered markers, duplicates, wrong
  casing/value, accessors, and buffered-to-stream or stream-to-buffer retries produce the same
  sanitized 422 idempotency conflict before stored bytes are returned and without rerunning the
  handler. Same-mode streaming replay stores the complete settled body, including `<kovo-done>`.
- Principal-derived durable authority carries the §6.6 persistent epoch without making it a
  caller-selected wire knob. A capability URL payload uses version `v4` and includes signed `p`
  (the positive integer epoch) whenever signed `s` (the principal scope) is present; a scoped token
  missing either field, an unscoped token carrying `p`, and every older version are malformed. The
  route checks signature, expiry, request-derived key/method/scope, and authoritative epoch before
  burning one-time replay truth or reading storage, and exposes only the existing generic 404 on
  failure. Mutation `Kovo-Idem` remains the canonical `v1` client token: the server-minted durable
  replay receipt, not this untrusted header/field, appends the current epoch to its principal-bound
  replay namespace. Response release, handler admission, in-transaction completion, and settlement
  each recheck current epoch; stale receipts are never released or silently moved into the new
  namespace.
- The compiler's enhanced-form completeness check follows HTML successful-control semantics rather
  than treating every matching JSX element as one simultaneous value. A single checkbox is a
  supported scalar boolean: checked submits its string value (`on` when omitted), while absence
  coerces to `false` only through a declared `s.boolean()` schema. Same-name radio controls are one
  mutually exclusive scalar group, and same-name submit buttons are one mutually exclusive
  submitter field whose selected button supplies the value. Disabled controls and
  `button`/`input[type=button|reset]` do not participate. Repeated same-name controls that are not
  one radio group or one submitter group remain **KV242** until an authored array/multivalue
  primitive declares their semantics. `input[type=image]` remains KV242 because the browser derives
  coordinate-suffixed names (`name.x`/`name.y`), and submitter `form`/`formaction`/`formmethod`/
  `formenctype`/`formtarget`/`formnovalidate` controls cannot replace or escape the compiler-owned
  mutation transport. Direct, reactive, spread, composed, or externally associated overrides are
  KV242 and must not survive into `data-bind:*` or emitted update-plan stamps. A control `type` that is not a
  static string (or statically absent) is also KV242 because changing it at runtime could change
  successful-control and submitter-override semantics after compilation. The browser runtime is
  the fail-closed floor: once `data-mutation` identifies a typed form, any effective method/action
  that is not the exact same-origin `POST /_m/<mutation-key>` transport is prevented, marked
  `INVALID_MUTATION_TRANSPORT`, and never allowed to fall through to native submission. In
  particular, a tampered `formmethod="get"` cannot serialize CSRF, idempotency, or form-field values
  into a URL. Ordinary native forms without compiler-owned `data-mutation` retain native behavior.
- **Browser response-body disposition (normative).** Every framework-owned fetch path whose response bytes can become live document, fragment, stream, or query truth MUST snapshot `Content-Disposition` with the other response facts and admit the body only when the field is absent or is one structurally valid, unambiguous `inline` value. `attachment`, extension dispositions, comma-combined or duplicate field values, controls, and malformed parameters fail closed before the body is read or a stream reader is acquired. Enhanced navigation performs the normal full GET so the browser retains download behavior; an already-dispatched mutation performs source-document reconciliation without applying the response; lifecycle recovery reloads; and a background typed-read refetch discards and reports the response. The readable/generated inline loader and modular runtime use the same classifier.
- `Kovo-Changes` is the sanitized wire summary of committed writes: each entry is `{domain, keys}`. It never includes mutation input, user-provided values, failure reasons, stack traces, or internal diagnostic detail; richer typed change records are internal compiler/runtime artifacts.
- `<kovo-query>` replaces the client's query value and runs that query's update plan — bindings, named derives, stamps — across every dependent island. No runtime dependency tracking: the plan is the DOM itself (§4.8). Query JSON serialized inline MUST be encoded for the exact context it lands in so attacker-controlled JSON string content cannot end the host element early. A `<script type="application/json" kovo-query="…">` initial-page island is HTML **script-data** (entities are not decoded), so its JSON MUST escape `<` as the JSON unicode escape `\u003c` — `&lt;` would not decode there and would corrupt the value. A post-mutation `<kovo-query>{…}</kovo-query>` element has **parsed** content, so its JSON MUST HTML-escape (`<`→`&lt;`, `>`→`&gt;`, `&`→`&amp;`). Both neutralize the `</script`/`<!--`/`<script` break-out; JSON quoting alone escapes neither and is insufficient. This is a normative renderer rule with a conformance test (`tests/integration/specs/xss-escaping.spec.ts`), and it binds every transport that re-emits an island — including the §9.3 BroadcastChannel rebroadcast, which forwards already-encoded bytes and never re-serializes raw values.
- `<kovo-fragment>` is **DOM-morphed** by default (idiomorph-class algorithm): user-agent and DOM-resident state — focus, scroll position, selection, in-flight CSS transitions, and `<details>`/media element UA state — survives. The morph carries **no serialization of island-local `kovo-state`**, so a refreshed parent re-emits any nested island at its render-time default state (§4.5 rule 3 re-renders the full subtree from declared queries ∪ stamped props); island-private local state is therefore **not** preserved across a fragment morph of an enclosing target. The compiler forbids the position that would silently lose it: an island declaring local `state` may not render inside another component's server-refreshable fragment target (**KV420**, §4.5). `mode="append"` is the explicit append vocabulary for pagination ("load more") and streams; `mode="prepend"` is its companion for "load older" feeds, inserting the patch at the **start** of the target. Both are ordered keyed inserts: a row whose `kovo-key` is already present is **deduped** (matched/skipped, never re-inserted) per §13.2, so a re-shipped page never duplicates rows. `mode="prepend"` additionally carries a **normative scroll-anchor guarantee** — the runtime treats the patched target as the scroll container and adjusts its `scrollTop` by the inserted height so previously-visible content stays fixed (no viewport jump when older content lands above). This is a framework guarantee, not an app knob. The read-side companion is a keyed-delta `<kovo-query … delta>` whose `lists.<path>` upsert merges the page into the SAME held query instance (§9.1.1) — `prepend`-flagged so new rows accumulate at the front of the held array — so "load more"/"load older" fetch only the new page and never re-ship prior rows. Patched-in islands are inert-until-touched like everything else — _a fragment update is a tiny navigation, not a different programming model._
- A streaming enhanced mutation response may be applied incrementally from a `ReadableStream` as complete wire elements arrive. User message rows and assistant shells still use `<kovo-fragment mode="append">`; token text uses `<kovo-text target="..." mode="append">escaped text</kovo-text>` against a compiler/runtime-declared stream source such as `data-stream-text="assistant-message:a1"`. `<kovo-text>` appends text, not HTML. `mode="checkpoint"` replaces the accumulated source text for that target with server-confirmed text so far. A stream source may declare an app-authored sink renderer for presentation, but Kovo owns the escaped source buffer and never inserts model output as raw HTML. The sink-renderer signature is constrained so this guarantee survives app code: a sink renderer is `(escaped: string) => string | TrustedHtml` — it receives the framework's already-escaped source text (never the raw model bytes) and MUST return either further-escaped text, which Kovo appends as text, or an explicit `trustedHtml(…)` value (§4.8) whose escaping it has itself discharged. A sink that returns a plain string is treated as text and re-escaped at the append boundary; only a `trustedHtml` brand is inserted as markup, so a markdown/rich sink reintroducing model-output XSS is an explicit, audit-visible KV236 trust decision rather than a silent default. The streaming text path is governed by the same §5.2 #10 output-safety contract as bindings. The final successful chunk must reconcile the affected assistant message or message list with ordinary `<kovo-fragment>` or `<kovo-query>` server truth; streamed text is progressive rendering, not a new authority.
- Streaming mutations run the same lifecycle before any user-visible assistant chunks are emitted: CSRF, schema parsing, guards, replay/idempotency reservation, and transaction policy. Interruption, abort, validation failure, guard/session failure, renderer failure, missing target, or deploy/build-token skew must either mark the submitted form/message failed or refetch/navigate to server truth. The runtime must not silently present a partial assistant answer as confirmed. Without JS, or when the form is not opted into streaming, the endpoint remains the existing POST-redirect-GET or buffered enhanced mutation path.
- **Without JS:** the same endpoint sees no `Kovo-Fragment` header and answers POST-redirect-GET with errors re-rendered into the full page. One handler, two response modes. A deterministic declared application failure settles its fully rendered response for same-mode replay. Validation, 429/rate-limit, and 409 retryable failures release the reservation. Response-policy or failure-rendering errors also release it, so a retry may render again rather than inheriting incomplete response truth.

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
- **Base-version validation (mandatory).** A delta assumes a base — the client's held query value — that is present and was produced by the same build. Two ways it can be unsafe: the client has **no base** for that query (an island patched in after first paint, or a cold store), or a **build skew** (a long-open tab or stale prerender against a redeployed server whose query shape or active module set moved). Every page render, every delta response, and every `/_q/` read response carries the build's **app build token** (§5.2.1); the client applies a delta only when the token matches _and_ a base is present, and treats any token-mismatched read or delta as a §14 build-skew event. On either failure it does not guess — it discards the delta and **refetches the full value over the typed read endpoint** (`/_q/<key>`, §9.4), a cheap GET. The client may also send its token up on the mutation request so a skew-aware server emits full directly and saves the extra round-trip. Deploy skew goes from silently-wrong to loud-and-recoverable — see §14 for the version-recovery contract and the mandatory prior-version retention window.
- **Automatic full-vs-delta selection.** The runtime ships whichever is smaller and sound: a query with no delta-eligible collection, a tiny value, the first render of a patched-in island, or a build-token mismatch all ship full. The rule is deterministic so the fixpoint and render-equivalence gates (§5.2.2) stay sound — the prod gate is `apply_delta(base, render_prod(Δ)) ≡ render_dev(full)` over the corpus.
- **Reconstruction for debugging.** `kovo explain`/MCP reconstructs the full query value from a prod delta + the held base, so an owner or agent handed a prod frame recovers dev-equivalent legibility. This is a convenience, not load-bearing: names are intact and the partial payload is already named and schema-shaped.

Mutation handlers may attach response headers through a narrow context channel. The channel is for transport metadata such as `Set-Cookie` and cache headers; it does not let handlers replace the body, status vocabulary, query reruns, fragment rendering, or PRG redirect contract. Header values emitted on the enhanced and no-JS paths are merged with framework headers after CSRF, replay, parsing, guards, and transaction commit complete.

**Header-channel transport safety (normative).** Structured app response authoring is settable only through typed surfaces; it is not a raw string map. The direct `headers` bags on `respond.file()`/`respond.stream()` and configured error shells accept only `Cache-Control`, `Last-Modified`, and `Vary`, under case-insensitive runtime comparison; any other direct name is rejected with **KV415**. File/stream `Content-Type`, `ETag`, and `Content-Disposition` travel through the `contentType`, `etag`, and `filename`/`disposition` options. The shared live/generated filename serializer MUST replace Unicode bidirectional formatting controls before constructing both the ASCII fallback and RFC 8187 `filename*`, even when earlier upload ingestion already sanitized its metadata. The `Content-Disposition` filename serializer and raw `forwardSetCookie` reserializer MUST return only after the same fail-closed whole-value postcondition accepts the output: CR, LF, NUL, a reverse solidus outside a quoted field, an unterminated quote/escape, a quoted-pair other than `\"` or `\\`, or a second quote/escape after the field closes is a framework error. The emitted Node filename path MUST execute the exact same five-state transition and terminal-verdict functions as the live runtime. `Location` is minted by `redirect()`. The HTTP `Refresh` response header is forbidden under every casing and for every value: browsers treat it as navigation, so accepting it would bypass the typed `Location` redirect posture and origin allowlist. Statically visible `Response` init occurrences close at compile time, and the complete structured/raw response finalizers plus direct and generated Node, Vercel, and Cloudflare boundaries reject any remaining occurrence with **KV415** before it becomes browser-visible. This prohibition does not change the existing `Location` redirect contract. `Set-Cookie` is built only through the typed mutation cookie builder (`context.setCookie(name, value, options)`), which percent-encodes the value, validates the name against the cookie-name grammar, forbids CR/LF/NUL/`;` in name and value, and serializes attributes structurally so a user-supplied value can neither inject a second cookie nor add unintended attributes. `Kovo-*` names remain framework-only. Raw endpoint `Response` values and operator-owned static metadata may carry other end-to-end integration headers, but they remain subject to the adapter-owned transport floor below. Every name and every value a structured channel emits MUST be rejected if it contains CR (`\r`), LF (`\n`), NUL, or any control character outside the printable header grammar; the channel never strips-and-continues. The same rejection rule applies identically to enhanced and no-JS mutation paths. This is the header-channel analogue of the `<kovo-text>` and `Kovo-Changes` injection discipline (§9.1): values flowing out a header are contextually safe by construction, never by author care.

**Browser-state cache floor (normative).** `Set-Cookie` does not itself prevent an HTTP shared cache from storing and replaying a response. Final wire reconstruction therefore MUST replace any authored or declared cache policy with `Cache-Control: private, no-store` and merge `Cookie` into `Vary` whenever a structured or raw response carries `Set-Cookie`. The same floor applies to `Clear-Site-Data`: replaying a cached clear instruction can destroy an unrelated visitor's browser state without reaching the endpoint verifier. It also applies whenever a document or raw response emits a synchronizer token or live-target attestation derived from the anonymous-CSRF cookie, including when that binding already existed and the response carries no `Set-Cookie`; those body bytes are cookie-personalized authority and cannot be reused for another visitor. A streaming document with any pending deferred region MUST conservatively select this posture before headers cross the wire, because a callback can first emit mutation-local CSRF authority after the initial shell and that future path is not knowable from the shell. Before committing those headers, the framework MUST pre-mint every registered anonymous-CSRF binding that a deferred framework form or live-target descriptor can use, deliver its cookie, and share that exact binding with the later region render; this preflight MUST NOT invoke app-authored session extractors for unrelated registered mutations. A token whose binding cookie was minted only after header commit is invalid output and MUST fail closed. The same pre-header conservative floor applies to every raw endpoint backed by the framework's private browser-credential delegation and to every route outcome carrying a live `ReadableStream`: raw `Response` hides whether its source executes lazily, and a route stream's `pull()` can first consume request authority or mint anonymous-CSRF bytes after finalization. Credential-neutral raw endpoints and eager route bodies do not select this floor merely because their transport uses a Web `Response`. This floor is unconditional across typed mutation output, raw `endpoint()` responses, redirects, errors, direct Node adapter calls, emitted Node/Vercel runtimes, and future response channels; endpoint `cache` posture remains useful audit metadata but cannot relax it. Static export rejects both `Set-Cookie` and `Clear-Site-Data` because a durable artifact has no response-specific browser-state channel.

During the framework-managed response lifecycle, CSRF token-generation calls made with cloned, reconstructed, or otherwise derived `Request` values use the canonical response request and share its anonymous-CSRF binding/posture state and header-commit boundary. An exact framework-retained request remains a lifecycle receipt when an external callback loses async context. An arbitrary detached derivative is not such a receipt and MUST NOT first mint anonymous authority; without proof that the binding cookie can still reach the browser, the helper fails closed. This response-only canonicalization MUST NOT apply to CSRF validation or replay resolution, which consume the exact ingress request.

**Standalone CSRF response capture (normative).** A first-anonymous response helper MUST record its
exact binding cookie in the private lifecycle before exposing the token. The final route/raw sink
synchronously seals that lifecycle, snapshots and injects every pending distinct-name cookie,
deduplicates an exact authored copy, and rejects any non-identical plain/`__Host-`/`__Secure-`
alias under the same logical name. A safe-method or CSRF-exempt raw endpoint may receive that
injection only after its exact browser-state auth proof executed; direct `runEndpoint()` and direct
internal `renderRoutePageResponse()` have no managed cookie sink and reject pending authority.
Sealing precedes the snapshot, so queued work
either completes before that single boundary and is included or observes committed headers and
fails closed. An exact retained request context takes precedence over an ambient outer lifecycle;
nested dispatches MUST NOT cross-bind canonical authority, personalization witnesses, pending
cookies, or seal state. Each `createRequestHandler()` call is a distinct response boundary and MUST
clear an ambient caller lifecycle before pre-dispatch callbacks run. If a nested handler receives
the caller's exact retained `Request`, it MUST first reconstruct a detached native ingress carrier;
the inner success path and every auth, CSRF, access, error, or method early return therefore cannot
seal or consume the outer response's cookie channel.

Endpoint dispatch MUST combine raw-response posture verification and an immediate fresh header
snapshot in one synchronous choke. App code may continue producing an authorized body stream, but
a later microtask cannot add `Set-Cookie`, `Clear-Site-Data`, or any other header to the already
classified carrier. A privately captured anonymous-CSRF cookie consumes the same executed/private
browser-state proof as an authored cookie on every safe-method or CSRF-exempt endpoint.

**Adapter-owned framing and hop-by-hop fields (normative).** Application response channels MUST NOT supply `Content-Length`, `Connection`, `Keep-Alive`, `Proxy-Connection`, `TE`, `Trailer`, `Transfer-Encoding`, `Upgrade`, `Proxy-Authenticate`, `Proxy-Authorization`, or `HTTP2-Settings`, under any casing. Reject them with **KV415** at the complete response-header boundary; never silently strip them. Rejecting `Connection` rejects the field and every header name it could nominate before any nominated field can acquire hop-by-hop meaning. This floor applies equally to structured framework responses, `respond.file()`/`respond.stream()`, raw endpoint `Response` values, static-export header metadata, direct Node adapter calls, and emitted Node/Vercel runtimes, for HTTP/1.0, HTTP/1.1, and HTTP/2 compatibility paths. Only after that validation may a framework adapter attach or replace its own framing/connection metadata (for example exact static-file `Content-Length`, compression-derived `Content-Encoding`, or `Connection: close`). Thus an app-controlled length or transfer field can never disagree with the bytes Kovo writes or turn a keep-alive response body into a queued-response prefix.

Raw HTTP integrations use declared `endpoint()` entries, not ad-hoc server escape hatches. An endpoint is registry-visible, receives `Request -> Response`, requires an explicit HTTP `method` (there is no implicit any-method endpoint), requires an endpoint-level `reason`/`purpose`, and is enrolled in the endpoint and unguarded audits with the same auth metadata as routes, queries, and mutations. Prefix mounts require a `mountJustification` because they enlarge the routed surface beyond one path. Endpoint declarations also carry raw response posture metadata for the audit row: body class (`html`, `json`, `text`, `bytes`, `stream`, or `redirect`), cache posture, and whether app code owns body encoding plus response-header safety. That app-owned posture never transfers message-framing or hop-by-hop authority: the framework still reconstructs raw response headers and applies the adapter-owned-field KV415 floor above. The closed safe-method set is `GET`, `HEAD`, and `OPTIONS`; every other method, including an extension method unknown to Kovo, is unsafe and receives the default synchronizer-token check unless the endpoint explicitly opts out of CSRF with a named justification. A safe-method endpoint receives only a managed DB Reader from `ctx.actAs()` and MUST NOT emit `Set-Cookie` or `Clear-Site-Data`; an executable non-ambient verifier that actually succeeds for the exact request (or an equivalent private framework-owned self-verifying receipt) may authorize those browser-state effects. The runtime enforces both known capability boundaries even if application types are bypassed. App-owned side effects outside Kovo's capability and response sinks remain the application's responsibility, so authors MUST use an unsafe method for a state-changing operation. Endpoint handlers receive the raw `Request` before body parsing so signature verification can use wire bytes; exact and prefix mounts are declared; cookies are not interpreted and no ambient `req.session` is passed. A CSRF exemption is sound only because endpoint/webhook auth does not ride ambient browser authority. OAuth/SAML callbacks and adapter-owned mounts belong here; browser credential forms should still prefer typed `mutation()` flows so they keep schema validation, no-JS behavior, and the normal response vocabulary.

Runtime response-posture verification compares the parsed media-type essence, not a substring or
top-level-type approximation: `text` admits only `text/plain`, `html` only `text/html`, and `json`
only `application/json` or a structured `+json` subtype. `bytes` and `stream` deliberately leave the
media type unconstrained because a raw `Response` does not retain their authored representation;
declaring either therefore makes that union's media-type branch opaque. A redirect posture is
selected by a 3xx status and the separately validated `Location` contract. These classes are not
aliases: in particular, active `text/html` bytes never satisfy a declaration that names only
`text`.

An endpoint that legitimately streams or long-polls beyond the app deadline MAY declare
`response.longLived: { deadlineMs, justification }`. This is the only request-deadline escape: it
selects one endpoint-scoped finite deadline from 1 through 300,000 ms, requires a non-empty audited
justification, and is printed as `deadline=long-lived:<milliseconds>:<justification>` by
`kovo explain --endpoints`. It does not disable or enlarge the app's occupancy budget, does not
apply to another endpoint or route, and does not exempt the response from adapter write-out
cancellation. Omitting the declaration uses the app deadline.

An endpoint `auth` declaration MAY carry an executable verifier from the webhook verifier kit. When present, the dispatcher MUST verify cloned raw wire bytes `{ headers, payload }` before CSRF validation and before the handler runs; verifier `false`, malformed input, or thrown verifier errors fail closed with `401 Unauthorized`, and the original request body remains readable by the handler after a successful check. Name-only endpoint auth declarations remain audit metadata. `webhook()` continues to emit name-only endpoint auth because it self-enforces raw-byte verification in its own lifecycle before parsing.

`webhook()` is the shaped machine-endpoint primitive for third-party POSTs that write Kovo-owned data. Shape: `webhook('/provider/path', { verify, input, idempotency, handler })`, lowering to a registry-visible endpoint with a source-derived webhook identity (§4.1) and `auth=verifier:<resolved scheme>` unless an explicitly justified custom/none verifier is used. The first string is the public HTTP receiver path, not the webhook registry name. The lifecycle is fixed: capture one request clock and the raw bytes → verify → parse/coerce a loose input schema (unknown provider fields pass through) → construct and validate an authenticated provider-event replay identity → atomically reserve/replay under the source-derived webhook identity → optional framework transaction wrapper → handler receives a machine-ingress context with no ambient session and dispatches Kovo-owned writes through `context.runMutation(mutation, input)` → the called mutation owns the audited DB write, touch set, and static diagnostics → commit/store the response and emit the unified change record `{domain, keys, input}` derived from the called mutation's committed changes.

`idempotency(input)` MUST return either `undefined` or the exact opaque value created by `webhookReplayIdentity(key, occurredAtMs)`. `key` is the non-empty provider event id (1..1,024 visible ASCII characters), and `occurredAtMs` MUST be the event's own occurrence time from the authenticated provider payload. Local receipt time, `Date.now()` inside the callback, an HTTP delivery timestamp, and an HMAC freshness timestamp are not event occurrence and MUST NOT be substituted. The constructor derives an immutable `expiresAtMs = occurredAtMs + 30 days`; its private TypeScript brand is only an authoring guardrail, while module-private runtime provenance rejects casts, structural copies, and forged objects. After verification and parsing but before any replay-store call or handler execution, the runtime validates the canonical identity against the one captured request clock: `expiresAtMs <= now` is stale, and `occurredAtMs > now + 5 minutes` is future-dated. Either temporal failure is a sanitized 422. Because asynchronous verification or parsing can cross the horizon after that captured-clock check began, the replay store MUST also reject fresh reservation at its current clock when `expiresAtMs <= now`; that refusal is a retry/unavailable response and the handler does not run. Settlement that crosses the horizon MUST leave the already-held claim pending and fail closed rather than create immediately removable committed truth. An invalid key, timestamp, unproven return value, callback throw, or otherwise malformed result is an internal posture failure answered with a sanitized 500 at that same boundary. The callback is evaluated exactly once per delivery.

The replay store receives the canonical `{ key, occurredAtMs, expiresAtMs }` facts intact, never a raw string or store-local TTL. A redelivery of the exact live identity replays the stored response and must not re-execute the handler or dispatched mutation. Reuse of a live `(webhook scope, key)` with different occurrence or expiry facts is an integrity conflict answered with sanitized 422, never an alternate event admitted alongside the first. Committed truth retires only at the exact authenticated expiry under §10.3; pending truth never expires automatically. `recordChange()` remains a narrow compatibility/manual-change bridge and is checked against declared `writes`; it is not the primary audit source for arbitrary raw transaction writes. Direct DB writes from webhook handlers remain KV330/KV406. `fail()` rolls back and answers the declared 4xx/5xx response so provider retry semantics are explicit.

The verifier kit is part of the normative surface for `webhook()`: `hmacSignature({ header, payload, encoding, tolerance, multiSig })` is the generic form, and `standardWebhooks({ secret })` is the shared non-vendor preset that resolves to printed generic HMAC configuration. Provider-specific HMAC recipes live in app/example code on top of `hmacSignature`, not in framework package exports. Verification is over raw bytes, uses constant-time comparison, enforces timestamp tolerance, and supports rotated secrets/multiple signatures. Non-HMAC providers use a custom `verify(request)` escape that appears as custom auth in the audit; `verify: 'none'` requires a named justification and appears as unauthenticated machine ingress.

### 9.2 Errors

#### Rejection equivalence and observation policy (normative)

Every remotely reachable surface for which account existence, resource existence/ownership, a
secret, or a governed value can change the response MUST have an explicit
`kovo-response-observation/v1` policy. Schema `owner:`, `secret:`, and `governed` facts nominate
surfaces for this review; they do not choose a product policy or prove equivalence. A nominated
surface without a policy is a build refusal. A policy names the two worlds being compared and one
of the canonical classes below. The only canonical world pairs are `exists-not-owned` versus
`absent`, `account-present` versus `account-absent`, and `unexpected-cause-a` versus
`unexpected-cause-b`; a product-specific pair requires a separately reviewed class rather than an
alias to one of these names.

An attacker observation is the tuple
`(status, redirect, selected end-to-end headers, normalized cookies/tokens, body relation,
connection behavior, work-factor class, timing distribution)`. Header names are compared
case-insensitively and order-independently after adapter-owned framing fields are removed.
`Set-Cookie` is compared by cookie name, security attributes, expiry class, and token
presence/shape; fresh random token bytes are never required to be equal. The body relation names
media type, encoding, length relation, and content relation. Connection behavior distinguishes a
complete response, reset/abort, and timeout. Work factor names the finite operation class and count.
Timing is a distribution checked against a versioned statistical budget; this is not a claim of
constant-time execution. An oracle compares the declared tuple fields and relations, not raw
response bytes. Provider delivery and other effects outside the framework-controlled HTTP boundary
are excluded unless the policy explicitly includes and measures them.

| Canonical class         | Required worlds                                                          | Required attacker-visible relation                                                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input-validation`      | validly parsed but rejected inputs selected by the declared error schema | HTTP 422; no redirect or credential token; declared typed body vocabulary. Error codes and field paths may differ, so this class does not conceal which submitted field failed.                                                                                                                           |
| `authentication-needed` | enhanced versus no-JS transport for the same unauthenticated request     | The transport difference is intentional: enhanced HTTP 401 plus `Kovo-Reauth`; no-JS HTTP 303 to the same-origin login route with the same canonical `next`. Neither response establishes a session.                                                                                                      |
| `authorization-denied`  | authenticated principals denied by the same guard                        | HTTP 403 and the declared `unauthorized` failure body. This class does not conceal resource existence; a surface that must do so selects `resource-concealment`.                                                                                                                                          |
| `resource-concealment`  | `exists-not-owned` versus `absent`                                       | Identical 404 status, no redirect, `Cache-Control: private, no-store`, credential-varying headers, no cookie/token mutation, the same fixed body media type/bytes/length, complete connection behavior, equivalent storage/verification work class, and a timing distribution within the declared budget. |
| `account-creation`      | `account-present` versus `account-absent`                                | The same generic accepted status/redirect/body relation; no account-dependent cookie or token. A surface claiming this class cannot auto-establish a session in only one world. Framework-controlled lookup/write/credential work is normalized and its timing stays within budget.                       |
| `account-recovery`      | `account-present` versus `account-absent`                                | The same generic accepted status/redirect/body relation and no account-dependent cookie/token. Framework-controlled token-generation, lookup, queueing/decoy work, and timing are normalized; delivery by an external mail provider is outside the claim unless separately measured.                      |
| `unexpected-failure`    | `unexpected-cause-a` versus `unexpected-cause-b`                         | The surface-specific stable sanitized HTTP 500 tuple defined below; no cause-derived header, cookie/token, body content/length, connection behavior, or work-class difference before the response is committed.                                                                                           |

The table is a minimum floor. A surface may declare a stricter relation, but MUST NOT claim a class
while omitting one of the tuple axes or silently treating a raw-byte mismatch as acceptable. The
versioned policy and its dual-world oracle are release evidence; a passing unit fixture is not a
timing guarantee for every deployment.

Validation failures (schema, with field paths) and declared error codes return HTTP 422. The enhanced
path infers the submitted form instance from the request's compiler-emitted form target and returns a
`<kovo-fragment>` for that form only; the no-JS path re-renders the full page. Both paths call the
same component render function with the same typed failure state in `forms.<mutation>.failure`, so
expected failure UI is normal TSX (`<FieldError>`, `<FormError>`, or direct `forms` reads) rather
than a separate response template. `ctx.submit`'s `onError` receives the same typed union. Expected
failure responses never use committed invalidation or `Kovo-Targets` success selection.

**KV430 request-body posture (normative).** After successful JSON decoding, Kovo MUST enforce the
iterative depth/breadth/node budget before provenance decoration, schema traversal, CSRF-token field
extraction, or handler dispatch. URL-encoded segment and multipart-part ceilings enter the same
posture. Provenance decoration MUST keep every app-visible scalar read non-coercible and untrusted,
including reads through own-property descriptors, `Reflect.get`, `Object.assign`, and serialization,
but MUST NOT eagerly allocate one persistent poison object per scalar leaf; the validation-only raw
container view is module-private and unforgeable. A CSRF-exempt mutation that exceeds one of these
ceilings answers **422** with `{"code":"VALIDATION","payload":{"reason":"shape-budget"}}`. A
CSRF-protected mutation or endpoint cannot safely recover its submitted token from an over-budget
carrier and therefore fails through the ordinary CSRF response without exposing the body verdict.
After webhook authentication, malformed JSON remains **400** `Invalid JSON webhook body`, while a
valid JSON body that exceeds KV430 answers **422** with
`{"error":{"code":"VALIDATION","payload":{"reason":"shape-budget"}},"ok":false}`. None of
these expected input refusals calls the app's unexpected-error hook or handler.

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
Kovo-Build: <app-build-token>
Kovo-Fragment: true
```

```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8

<kovo-query name="product" key="product:p1">{ "name": "Mug", "stock": 4 }</kovo-query>
```

Every enhanced `/_q/` request MUST carry its immutable document app build token as `Kovo-Build`, and every `/_q/` response MUST carry the selected build's token (§5.2.1). The current app rejects a missing or unequal enhanced-request token before decoding the query key or entering the query registry. A client compares the response token before generic failure-status handling, so the stamped 409 skew response triggers §14 recovery rather than becoming a silently skipped background failure. An admitted enhanced read whose guard now denies the current principal MUST return an exact, non-redirecting HTTP 401 (unauthenticated) or 403 (forbidden), `text/html`, and the selected build token; native query navigation retains the ordinary 303 login redirect. The enhanced client uses Fetch `redirect: 'error'` and treats only that exact-URL, same-build, admitted 401/403 envelope as revocation: it applies none of the fetched batch and performs a full navigation recovery of the current route, whose native guard then redirects or renders forbidden. A Fetch rejection alone is only a transport failure and MUST NOT be inferred to prove revocation. Args arrive as search params through the query's `args` schema (§10.2) — the same `s.*` coercion machinery as forms. A query with no declared `args` schema MUST reject a non-empty search input with 422 before running lifecycle providers, guards, or its loader; an absent schema is not an unvalidated-input mode. The query's `guard` (§10.2) is checked on **every** admitted read, and reads are part of the unguarded audit. Query `name` and optional canonical full instance `key` are separate exact facts: a raw string containing `:` is an unkeyed name, never something to split. A present raw empty `key` is malformed, while `name:` is a valid canonical instance identity with an empty value. Refetch dispatch uses the exact name for `/_q/<name>` and derives the search value only from the separately retained key fact (stripping `${name}:` when it is that key's prefix and otherwise preserving the domain-owned full key). The instance key in the response (`product:p1`) remains the §10.2 single currency shared across client store, wire, and optimism.

**Caching contract (normative).** `/_q/<key>` is a credentialed GET whose body may vary by identity, so a URL that differs only by args is a shared-cache collision waiting to disclose one principal's data to another. Every compiler-emitted app graph with query or raw-endpoint roots therefore carries one versioned `kovo-cache-influence/v1` manifest. Each query or raw-endpoint root records URL path and search as cache-key axes, each statically named request-header read as a possible `Vary` axis, and cookies, Authorization, principal/session facts, secrets, framework state, declared external-data versions, and unclassified influence as distinct axes. A declared external-data version is cacheable only when its version has a manifest-visible URL or named-request-header key contribution. Framework state without complete keyed external versions, a dynamic header name, an opaque call, or any influence outside the finite reviewed language closes shared caching. One observed execution is never positive evidence. A named audited escape may retain an explicit operator obligation, but it remains distinguishable from `public-proved` compiler evidence.

The build MUST compare the evaluated cache declaration with the exact compiler manifest and fail closed on a missing public root or any intent, external-version, axis, `Vary`, or verdict drift. Runtime observations are rejection-only: a missing or closed compiler verdict cannot be widened by an anonymous-looking request. A typed query may emit its declared public `Cache-Control` only when the registered manifest has the exact root, surface, declaration, and a `public-proved` or named `audited-escape` verdict, and the current request has no Cookie, Authorization, resolved principal/session, or opaque request carrier. Otherwise it MUST emit `Cache-Control: private, no-store` and `Vary: Cookie`. Document execution applies the same current-response rejection floor for Cookie, Authorization, unresolved/resolved principal state, late executable bodies, and other existing personalization witnesses. These floors hold for every transport that hits `/_q/` — loader fetch, refetch-on-focus (§9.3), GET-form fragment responses (§7), and async option/search reads — and for document responses through every adapter.

`Vary` MUST be derived only from normalized, statically named request-header axes in the manifest. URL path/search already participate in the cache key and MUST NOT be encoded as `Vary`; principal/session state, Cookie, Authorization, secrets, framework state, and unclassified influence close shared caching rather than becoming attacker-controlled `Vary` tokens. A guarded or otherwise principal-dependent query may never be served from a shared cache: the guard-at-every-read invariant must not be bypassable by an intermediary.

### 9.5 Request shell

The request shell is the server-owned composition point for routing, document assembly, dev serving,
and export. Apps call `defineKovo()` once for provider/config context and call that contract's
`assemble()` once with explicit dense arrays of routes, layouts, mutations, queries, endpoints, and
tasks. Assembly closes those declarations together with an optional client-module **store**,
document options, unexpected-error shells, CSRF config, the lazy `db` provider, the §6.5 session/auth
provider, the frozen declared environment projection from §6.6, and the replica-stable `appId`.
The result is an opaque `KovoApp`, not that structural aggregate; only framework-owned functions may
resolve its private state.

The injected `VersionedClientModuleStore` exposes only `retain`, `readActiveSnapshot`, atomic
`replaceActiveSnapshot`, and retained-history `resolve`; assembly closes those methods behind a
framework-owned registry facade that alone derives representation hrefs and the direct app build
token (§5.2.1). Generated route IR and live-target registry artifacts are wired by the
compiler/build integration, not by app-authored generated/refresh options. The loader MUST establish
an app-owned registry scope before evaluating generated modules; concurrent or top-level-await app
graphs may not share a process-global pending registry, unscoped late/HMR registration is not
runtime authority, and mutation/HMR sinks may not fall back from their closed app inventory to a
process registry. Vite/dev integration points at an authored app entry, for example
`kovo({ app: '/src/app.tsx' })` from `@kovojs/server/vite`; the entry must default-export the opaque
`KovoApp` and must not point into `src/generated/*`. Compiler-owned plugins resolve route IR,
live-target registries, and generated client modules internally. The public handler currency is
web-standard `Request -> Response`; adapters such as `node:http` convert at the edge and receive
only that token.

The same bootstrap-first generated-registry channel carries the §6.6 browser response posture.
Vite/dev and production build scan the project source snapshot, serialize the exact
`kovo-browser-posture/v1` manifest into a framework-owned virtual/generated module, and execute its
registration before the app entry. Document assembly re-witnesses that carrier and derives CSP,
Permissions Policy, and optional COOP/COEP/CORP from it. App code cannot register, replace, or
release this boot fact, and a second non-identical registration is a boot error. Direct library
tests that omit the generated runner retain only the conservative non-isolated response posture;
they cannot opt into cross-origin isolation without an explicit compiler manifest.

Dispatch order is normative and printable: `/_m/<mutation-key>` mutations, `/_q/<query-key>` typed reads, `/c/__v/<representation-digest>/<module>` immutable client modules, declared `endpoint()` exact/prefix mounts, route table, then the 404 shell. There is no user middleware chain in v1. Extension points that can affect control flow are declared surfaces — `sessionProvider`, guards, `endpoint()`, `webhook()` — so audits can print them and no request behavior is registered from a distance.

**Generated Node public authority (normative).** A generated standalone Node entry MUST ignore
forwarded scheme and host headers by default. Behind TLS termination, the operator supplies either
`KOVO_NODE_ORIGIN` as one canonical absolute HTTP(S) origin or the exact opt-in
`KOVO_NODE_TRUSTED_PROXY=1`, never both. The fixed-origin posture reconstructs every Web `Request`
with the pinned scheme, hostname, and effective port and ignores forwarded authority. The
trusted-proxy posture accepts only the proxy-provided `X-Forwarded-Proto` scheme while retaining the
validated inbound `Host` authority; `X-Forwarded-Host` remains untrusted. These variables MUST be
snapshotted and validated before the authored handler graph is imported. Invalid, non-canonical,
ambiguous, or combined posture fails process boot. Authentication deployments MUST additionally
satisfy §6.6's exact configured-origin binding, so a trusted forwarded scheme paired with the wrong
host or port is rejected before auth state is read or changed.
The public Node adapter accepts only an absent origin or one fixed origin string. A per-request
origin callback is not a reviewed authority door: it could reinterpret `Origin`, forwarded, or other
hostile request fields as the trusted Web origin and is therefore rejected before it can run.
The deployment's proxy, TLS-edge, cache, cookie-domain, schema-writer, and bootstrap assumptions are
reported through the door-derived `kovo check env` contract in §11.4; configuring this adapter does
not by itself discharge facts the command cannot observe.

**Shared request-ingress decision (normative).** Transport-source selection and hostile-value
grammar are separate steps, and the supported source set is finite. An HTTP/1 Node source MUST
snapshot the exact method, authenticated transport encryption bit, normalized `Host`, and exact raw
`Host` count/value; it admits exactly one raw occurrence whose value is byte-identical to the
normalized field and rejects pseudo-headers. An HTTP/2 Node source MUST snapshot the exact method,
transport bit, `:authority`, and `:scheme`; it rejects ordinary `Host`, `X-Forwarded-Proto`, raw
HTTP/1 `Host` evidence, or a non-HTTP/2 version. `:scheme` is exact lowercase `http` or `https` and,
outside an explicit trusted-proxy posture, MUST match the authenticated transport bit. A generated
Vercel Node source is a distinct HTTP/1 posture: one exact raw/normalized `Host` plus mandatory,
canonical edge-overwritten `X-Forwarded-Proto` and `X-Vercel-Forwarded-For`; missing, ambiguous, or
non-canonical platform provenance has no fallback identity. Synthetic/custom carriers MUST declare
which enrolled source they emulate; a coincidental bag of fields is not source provenance.

A Fetch-native platform source instead consumes the exact method and canonical URL
scheme/authority selected by the named platform-owned HTTP-to-Fetch bridge; it cannot recover or
make claims about raw bytes that the platform normalized or discarded. Cloudflare's public edge
bridge is the supported Worker source; unauthenticated HTTP Service Binding ingress remains
unsupported. Unknown and mixed source postures fail closed before static serving or app import.

After source selection, live and emitted adapters MUST invoke the same finite classifier for method
token, authority, and scheme grammar. An absent verdict, unknown source posture, ambiguous value, or
lossy spelling is closed. The accepted verdict is immutable reconstruction input: one final target
object supplies the Web URL authority and app-visible `Host`, including when an operator-pinned
origin replaces the validated remote authority. No later sink may reread raw `Host`, `:authority`,
or forwarding fields to make a second decision, and a future adapter MUST enroll its source posture
and generated/source parity in the request-ingress C13 corpus before dispatching static or app code.

**Adapter request-target identity (normative).** The same classifier admits only (1) canonical
origin-form `path[?query]` beginning with exactly one `/`, or (2) a canonical absolute-form HTTP(S)
URL whose scheme and authority exactly match the selected ingress verdict. The accepted value is
reconstructed as canonical origin form before routing. Scheme-relative, authority-form,
non-HTTP(S) scheme-like (`javascript:`, `mailto:`), backslash, fragment, encoded dot/separator,
WHATWG-normalizing, mismatched-origin, and otherwise lossy targets MUST fail closed. Kovo assigns no
server-wide semantics to asterisk-form: `OPTIONS *` is explicitly unsupported and returns 400
before static or app dispatch. The 65,536-character and 10,000-query-entry ceilings apply before
target parsing on raw Node sources and on the platform-preserved absolute URL for Fetch-native
sources.

**Vercel pre-filesystem ingress (normative).** Every generated Vercel Build Output API v3 artifact,
including a static-only build, MUST route all paths through Kovo's generated Edge Routing
Middleware before `handle: filesystem`. That middleware applies the shared platform-Fetch
method/URL/target classifier and target ceiling, returns a closed 400/414 response on failure, and
uses `x-middleware-next: 1` only after acceptance. A mixed build then enters the Vercel Node
function's distinct platform-provenance posture. The function MUST prepare one immutable request
snapshot and accepted verdict before static/app dispatch, and both its pre-static metadata and final
Web `Request` MUST consume that same prepared value; carrier mutation after preparation cannot
trigger a second source, scheme, authority, method, or target decision.

**Adapter method identity (normative).** HTTP method tokens are case-sensitive (RFC 9110 §9.1),
while the Fetch `Request` constructor canonicalizes its standard methods and rejects several
others. A raw-capable adapter MUST reject before static serving or app dispatch whenever its raw
method token is invalid or cannot cross the Web `Request` boundary byte-for-byte unchanged. A
Fetch-native adapter applies the same verdict to the platform-preserved method and relies on the
named platform bridge—not Kovo—to preserve or reject the pre-Fetch raw token.
Thus raw `post` and `PoSt` are distinct unsupported methods and MUST NOT become `POST`; exact
`POST` remains valid, and a syntactically valid extension method is admitted only when Fetch
preserves that exact case-sensitive identity. Live and generated adapters MUST share one classifier.

**Adapter authority identity (normative).** A Node or platform adapter MUST accept an inbound
`Host` or HTTP/2 `:authority` only when it is one canonical serialized `host[:port]` identity that
crosses URL parsing and the Web `Request` boundary byte-for-byte unchanged under either supported
HTTP scheme. Percent-encoded, Unicode-to-IDNA, case-folded DNS, non-canonical IP, non-canonical
bracketed IPv6, explicit default-port (`:80`/`:443`), user-info, path/query/fragment, duplicate, and
otherwise ambiguous spellings MUST be rejected before static serving or app dispatch. Canonical
lower-case DNS names, non-default decimal ports, and canonical bracketed IPv6 remain valid. The Web
URL authority and app-visible `Host` MUST therefore expose the same one remote identity. Live and
generated Node/Vercel adapters MUST share this rule. A Fetch-native Worker validates the canonical
serialized URL authority delivered by its named platform bridge and reconstructs app-visible
`Host` from that verdict; this is not evidence about a raw authority the platform already erased.

**Pre-dispatch load shed (normative).** Because there is no user middleware chain, the request shell/adapter itself owns a coarse limiter that runs **ahead of** replay lookup, schema parse/coercion, and the guard chain (§10.3) — guard combinators such as `rateLimit({ per: 'session' })` shed load only after CSRF, replay, and parse have already paid out, and `per: 'session'` cannot distinguish a flood of null-session attackers, so they are insufficient as the only chokepoint. Before any `/_m/`, `/_q/`, `endpoint()`, or route dispatch the shell MUST enforce: (1) a maximum request/body size — a request exceeding it is rejected with **413** before the body is parsed; streamed bodies additionally have a hard 4,096-chunk budget and exceeding it is the same 413-class body-limit failure even when the byte count remains below the configured maximum, so adversarial transfer fragmentation cannot turn the byte limit into unbounded per-chunk work; (2) a serialized request-target ceiling of 65,536 JavaScript string code units and a 10,000-entry URL-query ceiling — Node/Vite/generated adapters MUST scan the raw target before constructing a Web `Request`, `URL`, or `URLSearchParams`, and a direct Web handler MUST scan `Request.url` before constructing `URL`/`URLSearchParams`; either target violation is rejected with **414**, including for static and not-found paths; (3) URL-encoded body segments and multipart parts share the same default KV430 breadth ceiling of 10,000 entries, counted before record reconstruction, split, or part adoption, so a compact separator-heavy carrier cannot amplify into an unbounded parser graph; and (4) a coarse per-IP and global request-rate budget — a request over budget is rejected with **429** carrying `Retry-After`, before replay+parse. `defineKovo({ requestLimits })`, its body-size gate, and every base or per-surface rate budget are mandatory finite postures and MUST NOT accept `false`; author-supplied maxima are bounded to 67,108,864 body bytes, 100,000 query/list result items, 1,000,000 requests per rate window, 100,000 retained rate keys, and an 86,400,000 ms rate window. These limits are normative defaults closed by `assemble()` (per-IP and global `/_m/` and `/_q/` request rates, max body size, and a bound on fragment-targets reconstructed per response, §9.1); the coarse limiter is identity-blind on purpose so it survives the anonymous flood the session-scoped limiter cannot. This pre-dispatch posture is enrolled in and printed by the `--endpoints` audit. The fine-grained `rateLimit` guard combinator still runs in the guard chain for per-principal policy. It admits a `per: 'ip'` (and global) dimension in addition to `per: 'session'`, so an anonymous or per-IP budget can also be expressed at the guard layer; the coarse shell limiter and the guard combinator compose rather than replace each other.

Node-family bridges MUST also close the Fetch GET/HEAD body-erasure gap before Web `Request`
construction, static routing, Vite SSR/app loading, DB admission, task startup, or authored code. A
GET or HEAD carrying a positive `Content-Length`, any `Transfer-Encoding`, or HTTP/2 HEADERS without
`END_STREAM` is rejected with **413**; `Content-Length: 0` remains payload-free. A custom HTTP/2
carrier MUST provide an exact, pinned `END_STREAM` witness or fail closed for GET/HEAD. This grammar
is deliberately finite and synchronous: the bridge does not wait for or indefinitely drain body
bytes. When an HTTP/1 request is incomplete, it flushes the 413 response and closes the connection.
Live Node/Vite and emitted Node/Vercel adapters MUST apply the same verdict.

The same pre-dispatch door MUST acquire one app-local occupancy slot and mint one framework-owned
request deadline before any DB provider, request-body read, guard, transaction, or handler work.
`requestLimits.deadlineMs` defaults to 30,000 ms and is a finite integer from 1 through 300,000;
`requestLimits.maxInFlight` defaults to 256 and is a finite integer from 1 through 10,000. Neither
posture accepts `false`. A request at the occupancy ceiling is rejected with **503 Service
Unavailable** and `Retry-After: 1` before that work starts.

The admitted request's framework-owned `AbortSignal` MUST be the signal visible to authored request
code and consumed by every Kovo-owned request effect door: outbound fetch (including bounded DNS
wait), DB admission/provider wait and transaction checkpoints, deferred-region selection, response
stream flush, and an adapter-owned final transport where Kovo controls one. The response-mint door
MUST discard a handler result that loses the deadline/disconnect race. An unfinished response body
MUST error and cancel its source at expiry. The Node adapter MUST additionally destroy an unfinished
response transport at expiry and retain the occupancy slot through actual `finish` or `close`; its
backpressure-aware pipeline therefore cannot turn a slow reader into an unbounded write. A
Fetch-native adapter can bound only the Web response stream Kovo owns; the platform's post-handoff
client transport is outside Kovo's proof.

Occupancy release is one-shot. It occurs immediately on deadline or ingress disconnect, on an
exception before response mint, on direct-Web response-body completion/cancel/error, and for a
bodyless direct-Web response at mint because no later transport receipt exists. When an adapter
claims the final transport, body completion alone does not release the slot: actual transport
`finish`/`close` does. Deadline/disconnect release does not assert that arbitrary authored work has
stopped; it prevents that abandoned work from retaining admission forever and revokes the
framework-owned capabilities it could otherwise continue to use.

This is cooperative cancellation, not JavaScript preemption. Kovo does not claim to terminate an
arbitrary Promise, a synchronous loop, native extension work, an uncooperative third-party API, SQL
already issued to a driver without cancellation support, or a transaction already committed. Such
work may continue after its result becomes ineligible for the response. A hard guarantee over those
cases would require app execution in a terminable worker or process.

**Trusted-proxy per-IP identity (normative).** When `trustedProxy` enables Kovo's built-in
`X-Forwarded-For`, `X-Real-IP`, or RFC 7239 `Forwarded` source, the selected proxy-nearest hop MUST
produce one canonical, address-only IPv4 or IPv6 key. A syntactically valid optional transport port
is stripped (an IPv6 port requires bracketed address syntax), equivalent IPv6 spellings are
canonicalized, and IPv4-mapped IPv6 is keyed as the corresponding IPv4 address. Unknown,
obfuscated, malformed, duplicate, or otherwise ambiguous nodes MUST NOT mint a per-IP key; the
mandatory global budget still applies when no trustworthy per-IP key exists. This classifier does
not reinterpret the app-owned opaque key returned by an explicit `requestLimits.clientIp` callback.
If more than one of the three built-in client-IP header families is present, the ingress is
ambiguous and none of them supplies a key; this prevents an unstripped client-authored family from
shadowing the family an operator-owned proxy appended.

Route matching is static-first at each path segment, and ambiguity is a compile error **KV228** rather than a runtime precedence footnote. Trailing slashes normalize to one canonical path with a 308 redirect before matching. Page routes answer GET and HEAD; other methods on a page path are 405 because mutations own POST via `/_m/`.

The shell owns document assembly. The default document contains the doctype, `<html lang>`, route/query meta, page hints (stylesheet links, modulepreloads, optional speculation rules), initial `<kovo-query>` scripts before consumers, the page body, and the inline loader. Apps may provide `defineKovo({ document: { template } })`, but the template receives assembled parts rather than a blank canvas, so it cannot silently drop loader or hydration contracts. Deferred streams use the same assembled shell parts; partials must not drift from full documents.

Unexpected-error shells are app config with safe defaults: 404, 403, and 500 documents may be supplied by the app, while unexpected failures still use the stable no-internals bodies from §9.2 when no shell is provided. The shell resolves `db` and `sessionProvider` once before route, query, or mutation guards; route/query guard failures use the §6.5 unauthenticated redirect and 403 contract.

Static export replays synthetic GET `Request`s through the same handler. An exportable route writes `.html`, referenced immutable `/c/` modules, and static assets; there is no second render path. Export is L0/L1 only: a route with a guard, unproven session dependence, mutation-only interaction, or a param path without explicit static-path enumeration fails or skips loudly with **KV229** according to the configured export policy. Exported documents disable server refetch assumptions; the no-JS document is the artifact.

**Static subresource integrity (normative).** Once exact bytes are known, static export adds a
SHA-384 `integrity` value to first-party module-script, modulepreload, stylesheet, and style-preload
tags. An authored integrity assertion is accepted only when there is exactly one
ASCII-case-insensitive `integrity` attribute and its decoded value exactly equals the computed hash.
An empty placeholder, duplicate, malformed value, stale hash, or mismatch aborts export; the build
never hides a disagreement by deleting or replacing author text. A tag with no authored assertion
receives exactly one computed value before the artifact is published.

#### 9.5.1 Dev HMR

Hot module reloading is a dev-only request-shell enhancement over Vite transport. It is not a
client render graph, hydration mode, or router. Vite's websocket may carry Kovo `custom` events,
but every DOM-changing hot action still asks the app shell for server-owned route, query, or
fragment output before morphing. Unsupported or unproven edits delegate to Vite's full reload.

The app-facing dev API is a convenience wrapper around the compiler plugin and the app-shell dev
plugin. App authors should not hand-wire generated refresh registries, HMR endpoints, or client
module maps into `defineKovo()` or `assemble()`: the request shell remains the owner of dev serving, diagnostics,
and refresh dispatch. The wrapper wires compiler diagnostics into the same dev diagnostic ledger
used by page, fragment, and mutation requests, so a failed hot update and a failed direct request
render the same teaching document.

The supported `kovo dev` runner MUST bind the exact canonical HTTP origin of its owned loopback
listener after the socket is listening and before it loads the live app graph. A generated Better
Auth constructor with no explicit `BETTER_AUTH_URL` uses that one-shot framework fact, so an
ephemeral or conflict-shifted port remains identical to the Local URL printed by the runner. The
fact accepts only `localhost`, IPv4 `127/8`, or `[::1]` with the listener's actual effective port.
It MUST NOT be derived from `Host`, `Origin`, `Forwarded`, or `X-Forwarded-*` request fields, and app
code cannot replace it after binding. Outside the supported runner, a Better Auth app MUST
configure `BETTER_AUTH_URL` explicitly. An explicit development value remains fixed and validated;
every non-loopback value and every production value remains an explicit canonical HTTPS origin.

HMR impact classification is compiler-owned and fact-based. After parsing, impact decisions must use
typed lowering facts (§5.2 rule 9), not source-string heuristics. The impact ladder is:
server fragment/query refresh for a proven compatible live target; current-route document refresh
when the route shell is still compatible; `kovo:diagnostics` for compiler errors; and
`kovo:full-reload` for route table, app shell, query-plan, app build token, generated-registry,
bootstrap, stylesheet topology, pending optimistic work, missing fact, or any other unsafe change.

The stable dev event vocabulary is:
`kovo:component-render`, `kovo:route-shell`, `kovo:diagnostics`, and `kovo:full-reload`. Events carry
the source file, old/new client module hrefs when known, the impacted component/live-target ids when
proven, diagnostics summary when present, and old/new app build tokens and render-plan fingerprints when available. Stale
events whose token does not match the current document are rejected and escalate to full reload.

The dev-only browser entry is served or injected only by the Vite dev stack. It must be absent from
production builds and static export artifacts. Dev refresh endpoints are likewise Vite-dev-only and
must reuse existing app-shell render, query, live-target renderer, and fragment-wire code; production
`createRequestHandler()` never exposes HMR endpoints. Live-target refresh accepts POST only. Every
route or live-target refresh response, including method and authorization failures, MUST carry
`Cache-Control: private, no-store` and `Vary: Cookie`, because the bytes can depend on the resolved
session, route guards, queries, and component render context even in development.

An HMR live-target refresh carries the current document token in `Kovo-Build` like every other
target-bearing request. The Vite-dev-only endpoint may additionally accept the explicit `oldBuild`
URL parameter as the prior-render selector needed while an update is crossing builds. That exception
does not exist in production request dispatch. A malformed HMR snapshot, response envelope, missing
build token, or response-token mismatch is never partially applied; it escalates to full reload.

### 9.6 Durable tasks and scheduling

`task()` is the durable background-function primitive for non-transactional side effects. A task is a
typed registry entry with an `input` schema and a `run(args, ctx)` body; no opaque closures cross the
boundary. Task code may perform external I/O, but task DB writes must go through `ctx.runMutation(...)`
and reads through `ctx.runQuery(...)`, so every data change still reuses the audited mutation/query
surfaces (§10.2, §10.3). A task context may schedule more tasks, use external `fetch`/storage/secrets
capabilities, and receive a stable job id for external idempotency keys; it does not receive the
caller mutation's transactional `db`. The framework also exposes the current one-based claimed
attempt as immutable `ctx.attempt`. It is runner-owned retry metadata, not app authority: authored
code may pass the direct scalar through the compiler's finite plain-input grammar to an exact local
task/query/mutation declaration, while aliases, writes, computed access, proxies, and retention fail
closed.

`request.schedule(task, args, opts?)` is the only built-in way for a mutation handler to arrange
post-commit work. Scheduling writes a durable job row in the same transaction as the mutation's data:
commit means the job is ready to run, rollback means the job was never enqueued. The scheduled args
are validated by the task's `input` schema and serialized data, not captured process state.
`opts.afterMs` / `opts.at` set `run_at`; `opts.key` gives a witnessed `ScopedKey` pending-job
identity (§6.6). Principal work derives it from `ctx.actAs(id).stateKey(appKey)` (or the equivalent
framework request authority); deliberately shared work uses the named public posture, and framework
recurrence/system work uses only a finite registered posture. Strings, casts, proxies, forged
structures, malformed persisted frames, and reason-string system namespaces fail KV450 before the
queue is consulted. The queue persists the complete canonical scope frame in `logical_key`, and the
unique ready-job identity is `(task_key, scoped-key-frame)`. The default keyed behavior is debounce:
a ready job with the same complete frame has its `run_at` and args replaced by the latest schedule.
`coalesce: 'throttle'` keeps the earliest ready job and its first args. Equal app keys under different
principal/public/system authority never coalesce. A running or
already-finished job is never mutated; re-scheduling creates a new ready job. `request.schedule`
returns a typed handle, and `request.cancel(handle)` transactionally cancels a still-ready job and
returns whether cancellation happened.

The default node `JobRunner` drains the queue from Postgres with `FOR UPDATE SKIP LOCKED`, leases,
retry/backoff, and dead-letter rows. Multiple nodes may run the same drainer; row locks make claims
disjoint. Each job persists the declaration's positive `maxAttempts` ceiling. A lease reaper returns
an expired `running` job to `ready` only while its claimed-attempt count remains below that ceiling;
at the ceiling it moves the job to `dead`, so a task that repeatedly kills its worker cannot redeliver
forever. A false or failed heartbeat means the worker lost its lease: the runner aborts the
`AbortSignal` delivered as `ctx.signal`, propagates that signal through framework query/mutation
ingress, and refuses later framework state operations from that context. Task-authored external I/O
must likewise carry `ctx.signal`; arbitrary JavaScript cannot be forcibly preempted. Completion and
failure writes remain fenced by the claim's owner/token, and a rejected `markSucceeded` or
`markFailed` settlement is reported through task-runner diagnostics rather than silently discarded.
Delivery is therefore at-least-once. Exactly-once effects are obtained by idempotency: Kovo derives a
stable idempotency key per scheduled job and exposes the job id as the key a task passes to
non-idempotent external APIs. A retry must not double-charge, double-send, or otherwise commit an
effect without an idempotency key.

The in-process runner's lazy startup is itself pre-dispatch work. It MUST begin only after the
triggering request passes the coarse rate, target, and complete streamed-body admission gates from
§9.5; a rejected request MUST NOT resolve or provision the task database. Startup receives only a
request-free admission signal: the root queue database resolves through the app-root provider with
no request carrier. Every background `runQuery` / `runMutation` lifecycle and runner diagnostic uses
a newly constructed framework-owned, bodyless, credential-neutral `Request` at the exact non-public
URL `https://kovo.invalid/_kovo/task`; a remote request's scheme, authority, path, headers, body,
session, or other ambient browser/machine authority MUST NOT seed it. Task lifecycle MUST NOT call
the app's `sessionProvider`. Its only principal authority is the framework-minted explicit
`actAs(id)` or declared-system posture, attached before the per-operation `app.db` provider resolves;
the app-root queue handle is not substituted for that scoped provider resolution. A transient
startup failure may be retried by a later admitted request, but rejected traffic cannot drive that
retry loop.

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
