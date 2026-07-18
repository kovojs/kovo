# Type System (SPEC §6)

This file is incorporated by reference from [../SPEC.md](../SPEC.md) and is normative for Kovo framework behavior.
The root spec remains the entry point and cross-reference index; this module owns the detailed contract below.

## 6. Type System

One pattern, applied everywhere: **declare facts once → derive every surface → validate residual strings against generated registries.** The only codegen is trivial registry `.d.ts` files; all wiring checks are TypeScript static checks over code that runs as written. Residual strings live in emitted IR and are derived from TSX authoring facts (§4.8); every load-bearing attribute the IR carries (`on:*`, `data-bind*`, `kovo-deps`, `kovo-c`, `kovo-key`, `kovo-fragment-target`, `href`, IDREFs) has a named validator in §11.3, so "all residual strings are validated" is a checkable claim, not an aspiration.

### 6.1 The registries (generated)

```ts
// generated/registries.d.ts (excerpt)
interface HandlerModules {
  '#cart': typeof import('../components/cart/cart.client.js'); /* … */
}
// '#cart' is a compile-time alias only — emission resolves it to a full URL (§4.3)
interface FragmentTargets {
  'components/cart-badge/cart-badge': CartBadgeProps; /* … */
}
interface ComponentRegistry {
  'components/cart-badge/cart-badge': typeof import('../components/cart-badge.js').CartBadge; /* … */
}
interface QueryRegistry {
  cart: typeof cartQuery;
  product: typeof productQuery;
}
interface MutationRegistry {
  'cart/add': typeof addToCart;
}
interface RouteRegistry {
  '/products/:id': typeof productRoute; /* … */
}
interface InvalidationSets {
  'cart/add': 'cart' | 'product'; // from the touch graph (§11.1); OptimisticFor demands a
  // transform (or 'await-fragment') per invalidated query in tsc (§10.6)
}
// also: DomainKey (schema domains), PageIds (per-page element ids, §6.4/KV221),
// ComponentPackagePrefixes + ComponentPackageRegistry (§6.1.1)
```

`FragmentTargets` is generated from inferred server-refreshable query components, not from an
author-written `fragmentTarget` option. Singleton targets use the component registry key as the type
identity and the derived DOM leaf as the ordinary wire target; repeated targets add their typed
instance identity at the wire edge (`cart-row:p1`) while the registry records the serializable prop
shape required to reconstruct any instance. `disableServerRefresh: true` suppresses target generation
for that component and appears in explain output.

Component registry keys are derived as `<module path relative to the package src root>/<dom leaf>`, with
`tests/integration/fixtures/` used as the fixture root in the integration suite. The DOM leaf remains
the exported binding's kebab-case form; the generated registry key is for TypeScript, fragment targets,
graph facts, and uniqueness diagnostics only.

The same source-derived registry rule applies to app-authored webhooks, mutations, queries, domains,
and tags: their module-relative exported binding identity is the generated graph key unless the
primitive declares an external address string instead (§4.1). Routes and endpoints keep explicit path
strings because those strings are the public HTTP addresses.

### 6.1.1 Package component prefixes

Component packages declare their HTML namespace once in their package manifest:

```json
{
  "name": "@acme/primitives",
  "kovo": {
    "prefix": "acme-"
  }
}
```

The field is required for any dependency that exports Kovo component primitives intended to define a
package-owned public HTML vocabulary. A package prefix is lowercase ASCII, dash-terminated, and
becomes part of that package vocabulary: package behavior attributes use the effective prefix
(`acme-menu="account-menu"`), `kovo explain component <name>` uses it for provenance, and packages
should encode it in their exported component binding names (`AcmeCartBadge` -> `acme-cart-badge`)
because component DOM leaves are always derived from bindings (§4.1). App-local components may remain
bare-named; vendored source such as `@kovojs/ui` installed by `kovo add` is app source, not a
component package, so its names are the app's names.

Prefix uniqueness is app-wide. During registry generation the compiler collects every imported component package, applies app aliases, and requires that no two packages have the same effective prefix. The alias escape hatch is app-side and explicit:

```ts
// kovo.config.ts
export default {
  packagePrefixes: {
    '@acme/primitives': 'acme-primitives-',
  },
};
```

Aliases affect only the consuming app's effective package behavior/provenance prefix; they do not
rewrite component binding-derived DOM leaves, the package manifest, or the package's documentation.
They are for package-vocabulary collision repair, not style preferences, because changing prefixes
changes the HTML behavior-attribute vocabulary an app serves.

The `kovo-` prefix family is reserved for first-party packages. Only packages whose manifest `name` is in the `@kovojs/*` scope may declare or be aliased to a prefix beginning with `kovo-`; `@kovojs/ui` declares `kovo-ui-`. This is a reservation check inside the same general prefix-registration rule, not a separate first-party naming mechanism.

Package behavior attributes ride the effective package prefix: `kovo-tooltip="pricing-tip"`, `acme-menu="account-menu"`, and so on. The `kovo-*` attribute namespace is reserved for framework-owned attributes and future loader/compiler growth. Package behavior attributes are compiler-known attributes supplied by the owning package; when a behavior value is an IDREF, it participates in the same page/component id registry as `commandfor`, `popovertarget`, `for`, and `aria-*` and is validated by KV221.

A duplicate prefix, invalid prefix, missing prefix on an imported component package, or non-`@kovojs/*` attempt to use `kovo-*` is **KV234**. The teaching error names both packages when there is a collision, shows the effective prefix that would have been emitted into package behavior attributes and component explain provenance, and prints the alias fix:

```text
ERROR KV234 package component prefix conflict.
  prefix: acme-
  packages:
    @acme/primitives (package.json kovo.prefix)
    @other/acme-widgets (package.json kovo.prefix)
  emitted names would collide: acme-tooltip="..."
  fix: add an app alias, for example packagePrefixes["@other/acme-widgets"] = "other-acme-"
```

### 6.2 Typed surfaces (summary table)

| Surface               | Source of truth                                             | What TypeScript proves                                                                                                                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handler refs          | client module exports                                       | `cart.remove` exists; params required & typed; typo = error                                                                                                                                                                                                                  |
| Form fields           | mutation input schema                                       | names ∈ schema; types match; **completeness** (missing required field = error); coercion declared once (KV242)                                                                                                                                                               |
| Fragment targets      | component registry                                          | target exists; patched with the right component's props                                                                                                                                                                                                                      |
| Query data / bindings | Drizzle select shape (`$infer`) + `JsonValue` boundary      | `data-bind` paths exist; column rename propagates to every template; nullable traversal requires `?.` or a derive (KV227, §4.8); query values are serializable client wire payloads, so `Date`, `Map`, functions, class instances, and other non-JSON values are type errors |
| Invalidations         | domain layer / touch graph                                  | invalidated keys exist; optimistic exhaustiveness in `tsc` via emitted invalidation sets (§10.6)                                                                                                                                                                             |
| Errors                | declared error codes                                        | `onError` receives exhaustive discriminated union                                                                                                                                                                                                                            |
| Guards                | guard combinators                                           | `req.session.user` non-null under `authed`; guards receive the validated args/instance key (§10.3) so ownership is expressible; static audit of unguarded mutations, routes, and queries, and IDOR audit (KV414) over `owner:` tables                                        |
| State                 | `JsonValue` constraint                                      | serializability by construction                                                                                                                                                                                                                                              |
| Routes / links        | `route()` declarations (§6.4)                               | `href`/`<Link>`/`redirect()` target exists; path params required & typed; search params typed; route rename propagates to every link                                                                                                                                         |
| GET forms / URL state | route `search` schema                                       | field names ∈ search schema; coercion declared once; the §7 URL channel is typed                                                                                                                                                                                             |
| IDREFs (L0 wiring)    | compiler id registry                                        | `commandfor`/`popovertarget`/`for`/`aria-*` reference an id that exists in scope (KV221)                                                                                                                                                                                     |
| Sessions              | declared session schema (§6.5)                              | `req.session` fully typed; instance keys (§10.2) and guard refinements rest on typed fields                                                                                                                                                                                  |
| Derives               | declared inputs (§4.8)                                      | derive inputs exist in `QueryRegistry`; input types match query shapes; bound attribute targets type-checked                                                                                                                                                                 |
| Stamp lists           | query result element type                                   | `data-bind-list` paths are arrays; item-relative paths exist on the element type; `kovo-key` names a real field (§4.8)                                                                                                                                                       |
| Slots / children      | hoisted component refs (§4.5)                               | fragment-target children lower to component references with serializable props (KV230)                                                                                                                                                                                       |
| Component props       | first `render` parameter (§4.1)                             | call sites may pass exactly the annotated render-input props after query result keys are removed; unannotated/`any` render input means no ordinary props; `props` metadata must match this derived shape                                                                     |
| Query args            | first `render` parameter + query `args` schema (§4.1/§10.2) | components bind args from their own derived call-site props; mappers cannot invent props outside the render annotation; coercion declared once; instance keys typed end-to-end (store, wire, optimism)                                                                       |
| Update coverage       | render-output classification (§4.9)                         | every query/state-dependent DOM position has a status — `plan` / `isomorphic` / `fragment` / `renderOnce`; none is KV311                                                                                                                                                     |
| Opaque projections    | declared output schema (§10.2)                              | `sql<T>`/raw projections carry `s.*` output schemas + a `reads:` table set (KV410); `reads:` checked against exemption, folded into the read set; result shape runtime-verified (§11.2)                                                                                      |
| SQL statement safety  | managed DB-handle contract (§10.2/§10.3)                    | executable SQL text reaches framework-managed DB handles only as typed builders, parameterized SQL values, or audited `trustedSql(...)`; scalar request data binds as parameters, while identifiers/keywords come from schema facts or typed allowlists (KV422)              |
| Output safety         | binding sink + value brand (§4.8)                           | every binding/derive into an unsafe output context (raw HTML, URL-scheme attr, `on*`, `style`, `srcdoc`, script/JSON) is `trustedHtml`/`trustedUrl`-branded or it is KV236                                                                                                   |

Client-handler publication has a deliberately narrower value grammar than the general JSON wire.
`publishToClient(value, { reason })` accepts exactly `string | number | boolean | null`. It rejects
every object, array, symbol, bigint, undefined, and function at runtime using only primitive
classification, without reflecting over or coercing caller-owned values; its TypeScript signature
exposes the same finite union as an author-time guardrail. In client-handler source, the compiler
accepts only a unique, pristine same-file `const` initialized directly from that literal grammar and
snapshots the literal into the generated module. An imported value, re-export, alias to an import,
mutable binding, duplicate/shadowed binding, array, or object is refused even when wrapped, because
evaluating its source module or carrier could itself execute authority. Only the finite reviewed
client-handler import registry grants executable authority (§5.2, §6.6).

### 6.3 Mutation typing contract

Where the mutation value is importable — server-rendered templates always can — `mutation={addToCart}`
is the preferred form authoring spelling: inference comes straight off the value, no registry hop.
The compiler emits the concrete `action="/_m/<key>"`, mutation key metadata, input coercion metadata,
CSRF field, idempotency token, and submitted-form target. The string-keyed `form('<key>')` helper
survives for sites that cannot import the value, but author TSX should not hard-code mutation URLs.
An end-to-end add-to-cart walkthrough lives in `docs/worked-example-add-to-cart.md`.

The typed `mutation={definition}` path is the **sole complete public mutation-form bundle**: the
framework emits the mutation-audience CSRF field and canonical `Kovo-Idem` field together, from one
proven definition, before authored controls. An exact compiler-recognized
`{...mutationFormAttributes(definition)}` JSX spread is an equivalent typed spelling and receives
the same generated field bundle. Standalone CSRF token/field construction is not a mutation-form
authoring API because it cannot establish the idempotency half of the protocol. TypeScript prevents
the ordinary partial call shape, while compiler provenance and the runtime request lifecycle remain
the enforcement boundaries.

Enhanced form failures use the same render function as the no-JS full-page path. Expected failures
are typed mutation results: schema validation maps to `<FieldError name="...">`, declared
application codes map to `<FormError code="...">`, and both helpers are compiler-bound to the
enclosing enhanced mutation form. The third render argument still carries typed form state as the
escape hatch for custom UI, with each bound mutation exposing
`forms.<mutation>.failure: null | { code; payload; fieldErrors? }`. The failure value is scoped to
the submitted form instance for that render and is cleared by the next successful render of that
instance. `ctx.submit(mutation, { input, onError })` receives the same exhaustive typed-error union.

Repeated forms must provide stable identity through authored `key` or serializable keyed component
props; the compiler lowers it to `kovo-key` and derives the submitted-form fragment target. Hidden
inputs are submitted data, not identity. An enhanced form in a repeatable position with no stable key
is a teaching diagnostic because the server cannot know which live form to re-render.

### 6.4 Routes & links (typed navigation)

Navigation is the inter-page wiring of an MPA, and it is typed with the same declare-once pattern — a TanStack-Router-style type layer with none of its runtime, because the server owns navigation (§8). Routes are declared values whose path strings are captured as literal types:

```ts
// products.routes.ts
export const productRoute = route('/products/:id', {
  params: s.object({ id: s.string() }), // coercion declared once, like FormData (§6.3)
  guard: authed, // same combinators as mutations (§10.3); pages join the unguarded audit
  search: s.object({ max: s.number().optional() }), // the §7 URL channel, typed
  prefetch: 'conservative', // Speculation Rules config lives here (§8)
  meta: ({ params }, queries) => ({
    /* … */
  }), // §13.5 head/meta, typed, fed by queries
  page: async ({ params, search }, req) => {
    /* rendered page */
  },
});
```

Path params are extracted from the literal by template-literal types (`PathParams<'/products/:id'> = 'id'`), so links demand exactly the right params — missing or extra is a compile error, and the params argument exists only when the route has params:

```tsx
// Authoring (sugar)
<Link to="/products/:id" params={{ id: item.productId }} search={{ max: 500 }}>
  View
</Link>;

// GET forms — the §7 coordination channel — validate against the route's search schema
const f = form.get('/products');
<f.Form>
  <f.input name="max" type="number" />
</f.Form>;
// ✗ compile error: field name not in search schema — same machinery as mutation forms (§6.3)
```

```html
<!-- Lowered IR / wire: a plain anchor. No client router, no link runtime —
     Constitution #1 (legible), #3 (a string href is valid Kovo source), #4. -->
<a href="/products/p1?max=500">View</a>
```

`redirect('/products/:id', { params })` types the POST-redirect-GET path (§9.1) the same way. Residual literal `href`s in hand-authored IR are validated against the route table at compile time (KV220); full-origin URLs and an `external` marker opt out. The propagation property of §6.2 holds for navigation too: renaming a route path turns every `<Link>`, GET form, and `redirect()` in the app red under `vp check`.

Two more route-level affordances close the request shell: **guards** — `guard:` on a `route()` runs the same combinator chain as mutations (§10.3) before `page`, refines `req.session` identically, and enrolls the page in the `kovo explain --unguarded` audit; and **`notFound()`** — returning `notFound()` from `page` renders the app's 404 page with the correct status, so status codes stay part of the typed surface rather than ad-hoc response construction. `redirect()` and `notFound()` are the sanctioned non-200 page outcomes in v1.

Routes may also return two sanctioned non-HTML 200/304 outcomes: `respond.file(body, { contentType, filename?, etag?, headers? })` and `respond.stream(body, { contentType, filename?, etag?, disposition?, headers? })`. These are still ordinary `route()`s: params/search schemas, guards, typed links, KV220 validation, the unguarded audit, and the `owner:`-powered `--unscoped` audit all apply before the body is served. `Content-Type` is required, `Content-Disposition` is declared (`respond.file()` defaults to attachment; `respond.stream()` defaults to attachment unless `inline` is requested), and a matching `If-None-Match` answers 304 without rendering HTML. Upload filename metadata and every final live/generated `Content-Disposition` filename sink MUST neutralize Unicode directional-formatting controls U+061C, U+200E/U+200F, U+202A–U+202E, and U+2066–U+2069 before constructing either `filename` or RFC 8187 `filename*`; browser-visible filenames cannot retain display-direction authority from a remote uploader. Range/resumable downloads are out of scope for v1; large exports that exceed a request/response window belong to a later background-jobs design.

`respond.stream()` and raw `endpoint()` responses are the escape hatch for app-owned streaming protocols. They do not participate in enhanced mutation application, query truth, mutation failure rendering, CSRF/replay semantics, or final fragment reconciliation unless the app builds that protocol itself.

### 6.5 Session schema

Sessions are a declared `s.object` schema, not an `any` bag: `req.session` is fully typed everywhere it appears. This is core, not a nicety — query instance keys (§10.2) and guard refinements (`req.session.user` non-null under `authed`, §6.2) are load-bearing on session fields, so an untyped session would be a hole directly under the proof surface.

Session provenance is an application capability, not a framework-owned identity system. The app declares a `sessionProvider` in the server request shell; Kovo runs it once before route, query, or mutation guards and exposes the returned value as `req.session`. `session(schema).provider(provider)` MUST snapshot the exact schema and runtime-validate every non-null provider result through it before the value reaches guards or handlers. This applies to synchronous and asynchronous providers and to both plain values and `{ value, setCookies }` envelopes; envelope cookies keep their independently snapshotted forwarding semantics. The validated session is an owned framework value, so undeclared properties, inherited/accessor fields, Proxies, and later provider-object mutation cannot create session authority. TypeScript assignability remains an author-time guardrail, not the proof. A provider returning `null` or `undefined` means "anonymous"; guard combinators must treat that as unauthenticated rather than as a malformed request.

Route and query guard failures have fixed outcomes so auth remains part of the typed surface. `authed` failures run the app's `onUnauthenticated` handler, whose default is a 303 redirect to the configured login route with the original URL available as `next`. `next` is framework-validated: it MUST be a same-origin, single-leading-slash absolute path (no `//`, no scheme, no host) that resolves against the route table (§6.4); a value failing that check is stripped to a safe default. The framework re-validates `next` both where it is captured and again wherever it hands `next` to the post-login redirect, so app-authored login code cannot consume an open-redirect target. Authenticated-but-unauthorized failures render the app's 403 shell with status 403. Mutation guard failures distinguish **authentication** failure from **authorization/validation** failure. An _unauthenticated_ mutation guard failure (an `authed` guard failing because `req.session` is null/anonymous, §6.5 — e.g. a session that expired between page render and submit) is a distinct outcome from a validation or app-`fail()` error (§9.2): the enhanced path returns **HTTP 401** with a `Kovo-Reauth` directive carrying the login route and a same-origin `next` (the original document URL), which the loader follows to re-authenticate exactly as a page route would for the same expired session; the no-JS path returns a **303** redirect to the configured login route with `next`, mirroring the route/query `onUnauthenticated` contract. An _authenticated-but-unauthorized_ mutation guard failure (a `role()`/ownership refinement failing on a valid session) keeps the §9.2 typed-error path — **HTTP 403** with `forms.<mutation>.failure` carrying an `unauthorized` code — and introduces no redirect body. Only the unauthenticated case crosses into the auth-redirect vocabulary; this prevents a routine session-expiry on submit from surfacing as a generic validation-style error with no path to re-auth.

### 6.6 Soundness boundary (normative)

The §1.2 proof claims are claims about TypeScript programs that stay inside the sound subset. The starter therefore ships — and the docs state as a precondition — `strict` everything plus lint bans on `any`, non-null assertions, and `as` casts in app code. Three boundaries are runtime-validated regardless, by design: the **wire** (every mutation input passes its `s.*` schema — types-without-validators, raw-tRPC style, was rejected); **deploy skew** (a long-lived document POSTing yesterday's form shape is answered by schema validation and the 422 path, §9.2 — never undefined behavior); and **CSRF** — `kovo-csrf` (§9.1) is a synchronizer token stamped into every emitted form and verified before schema parsing, replay lookup, and the guard chain on every mutation POST. When `req.session` is present the token is bound to it; when it is null/anonymous (§6.5) the token is bound instead to a **framework-owned signed-cookie secret** that exists independent of `sessionProvider`, so pre-auth forms (login, signup, password reset) are CSRF-protected even with no session to bind to — anonymous-CSRF is mandatory, not optional. `CsrfOptions.sessionId` MUST return a stable opaque 1..1,024-character rotation id for a framework-resolved session and `undefined` only for a genuinely anonymous request; non-string, missing, empty, oversized, anonymous-with-id, and unresolved-session results fail closed. The rotation id has no reserved textual spellings: exact length framing and a separate kind frame distinguish even `anonymous`-shaped session text from an anonymous cookie. The signing payload domain-separates that session/anonymous kind and, for a framework lifecycle request, both the rotation id and the independently pinned authorization principal, so a shared or namespace-shaped app id cannot cross-bind two principals. On a successful authenticating submit the framework rotates the anonymous token's binding to the new principal; apps should rotate their own session identity on auth (Kovo does not own session identity, §6.5). CSRF is default-on for server-rendered mutation endpoints; an explicit `csrf: false` is the only per-mutation opt-out and is reserved for non-browser or externally authenticated endpoints. A `csrf: false` mutation MUST NOT use browser authority: it is compile error **KV418** for such a mutation to read `req.session`, `Cookie`, `Authorization`, or `Proxy-Authorization`; escape an unproven request carrier; run a session/cookie-derived guard (e.g. `authed`, `role()`, `owns()`); or call a browser-state response sink (`setCookie`, `forwardSetCookie`, or `setSessionRevocationClearSiteData`). Skipping CSRF while riding the victim's ambient credential is forgeable, and minting an attacker session or clearing victim storage is login/logout CSRF even when the handler never reads ambient state. The exemption is sound only by construction: a `csrf: false` mutation is served with no ambient session/browser credential headers and cannot emit `Set-Cookie` or `Clear-Site-Data`. Machine callers use an explicit non-ambient custom signature header; browser credential flows keep the anonymous synchronizer token. Raw endpoints may separately declare executable verifier auth. Truly non-browser writes belong in `endpoint()`/`webhook()`. Every mutation's CSRF posture (`checked` or `exempt:<justification>`) is listed in `kovo explain --endpoints` (§11.4) alongside endpoints and webhooks. The `Kovo-Idem` replay token (§9.1) is a per-submit, high-entropy value minted fresh by the client on each logical submit and refreshed in the enhanced success response (§10.3) — a freshly stamped hidden field, never a form-instance constant — so re-editing and re-submitting a form is a new mutation rather than a silent replay of the first response. Deploy skew also covers handler modules, normatively: emitted module URLs are immutable and versioned, and the serving layer retains prior versions — an old document's `on:*` refs keep resolving after a deploy; first interaction on a still-open tab never 404s. Generated ABI subpaths (for example `@kovojs/browser/generated`) may change when the compiler and runtime ship together because app source regenerates those imports, but already-emitted immutable modules remain governed by the same versioned-module retention rule: old generated modules must keep resolving to the runtime symbols they were emitted against for the supported deploy-skew window.

Anonymous-CSRF cookie names are logical unprefixed names; Kovo alone applies the effective
`__Host-`/`__Secure-` prefix. Across the app-wide and every mutation-local CSRF configuration, one
logical anonymous-cookie name MUST have exactly one Path, Max-Age, SameSite, and Secure posture.
App construction rejects conflicting or prefixed aliases because Cookie request headers omit those
attributes: multiple same-name secrets would otherwise collapse to a browser last-wins value or
arrive as indistinguishable duplicate-name pairs and make another emitted form unverifiable.
Standalone `mintCsrfToken`/`mintCsrfField` calls made during one framework-managed response lifecycle
MUST likewise reuse one anonymous binding and one identical `Set-Cookie` value per logical cookie
posture. A conflicting same-name posture or authored browser-prefix alias fails before a second token
can be emitted, so a raw response containing multiple forms cannot silently invalidate an earlier
form. While that lifecycle is active, token-generation calls through cloned, reconstructed, or other
derived `Request` values resolve browser/session authority from the canonical lifecycle request and
share its binding/posture state and response-header commit boundary. An exact framework-retained
request can identify that lifecycle after async context is lost. That exact retained context takes
precedence over any ambient outer lifecycle: nested dispatches cannot cross-bind canonical
authority, personalization witnesses, pending cookies, or seal state. Every
`createRequestHandler()` invocation is a distinct response boundary: it clears an ambient caller
frame before pre-dispatch callbacks run and, when passed the caller's exact retained `Request`,
reconstructs a detached native ingress carrier before the nested dispatcher can finalize anything.
An arbitrary detached derivative cannot identify a lifecycle. A first-anonymous mint therefore
requires an active lifecycle or an exact retained lifecycle receipt. The lifecycle privately records
the exact standalone `Set-Cookie`; finalization atomically seals and snapshots that record before
delivering it through the route/document sink or an endpoint response authorized to emit browser
state. An exact authored duplicate is emitted once;
a non-identical plain/`__Host-`/`__Secure-` alias under the same logical name fails closed. Direct
`runEndpoint()` and direct internal `renderRoutePageResponse()` have no managed cookie sink and
reject a first-anonymous mint, while a truly late
post-seal mint cannot enter the snapshot. Detached session-bound generation and generation from an
already-present anonymous cookie do not mint a cookie and remain valid. CSRF validation and replay
resolution always use the exact supplied ingress request and never inherit response-generation
authority.

The public `mintCsrfToken` and `mintCsrfField` helpers serve only a verified raw endpoint protocol
with an explicit custom audience. They reject mutation targeting. The lower-level
`csrfToken` and `csrfField` helpers are internal/test-only; exposing either at the package root would
make an incomplete handwritten mutation form look supported while omitting canonical `Kovo-Idem`.
The closed mint/deliver/validate/rotate/replay surface and its proof anchors are recorded in
`security/csrf-mint-delivery.json`; adding a response or bootstrap surface requires adding a closed
matrix row before release.

Every independently resolved authorization principal entering a CSRF or replay identity, and every
source-derived mutation identity, MUST likewise be a non-empty string of at most 1,024 JavaScript
code units. An inbound anonymous-CSRF cookie secret is accepted only when it is 32..1,024 base64url
characters; the framework mints a 43-character secret. A present malformed or oversized credential
fails closed and is never replaced by an anonymous fallback within that request.

`s.string()` rejects raw C0 control characters (`U+0000` through `U+001F`), `U+007F` DEL, and the JavaScript line-terminator code points (`U+000A`, `U+000D`, `U+2028`, `U+2029`) by default before any format, pattern, or unsafe-regex refinement runs. This is defense-in-depth for every request-derived string sink: an embedded NUL, CR/LF, tab, or other control character cannot survive validation by relying on a loose or parity-sensitive author regex. Authors who are intentionally accepting textarea-style content must opt in with `s.string().multiline()`, which admits line terminators while still rejecting the other raw C0 controls and DEL. Authors who intentionally accept arbitrary raw controls must opt in with `s.string().allowControlChars()`. These opt-ins alter only the base string hygiene gate; all existing chained format/pattern/optional/default behavior still applies normally.

**Security soundness (normative).** The Prime Principle (§2) rests on the same sound-subset discipline, bounded by six rules. (1) **The compiler performs no TypeScript type inference of its own** — security classification is carried by AST symbol-identity provenance, sink classification, and fail-closed runtime checks; a branded type (`Secret<T>`, a `public()` brand, and the like) is `tsc`-time ergonomics and defense-in-depth, never the enforcement. (2) **Runtime taint is unsound** — JS string operations and template literals produce fresh primitives with no surviving metadata, so request-derived provenance for confidentiality, write-eligibility, and input shape is proven _statically_ at the AST (where the path is still code), never by runtime value-tracking; runtime contributes only _sink validation_ (checking a final value's grammar, shape, or resolved IP, which survives transforms). (3) **By-construction and defense-in-depth are distinguished and labeled.** Where static analysis can prove the unsafe state inexpressible, the guarantee is by-construction (output-safety §5.2 rule 10, the confidentiality boundary, default-deny authorization, write-provenance). Where it cannot — outbound egress, a read-only-handle runtime proxy, Content-Security-Policy / Trusted Types, log redaction — the control is a fail-closed runtime floor: sound at its sink but bypassable by privileged same-process code, and it MUST be documented as defense-in-depth rather than a proof. (4) **Advanced TypeScript types are preferred when they narrow author mistakes without becoming the trust boundary.** Validated branded constructors are appropriate for strong signing material; module-private `unique symbol` brands are appropriate for framework-owned sentinels; branded escaped/trusted/rendered HTML values are appropriate for UI composition; exact header-bag and discriminated-union types are appropriate for preserving multi-value headers and explicit posture choices. Public structural brands, casts, and type-only assertions MUST NOT be accepted as security evidence unless a runtime constructor, AST/provenance gate, or fail-closed sink also enforces the invariant. (5) **Boundary decisions over caller-owned carriers must classify-and-pin or reconstruct.** Once a runtime boundary classifies, normalizes, or validates a caller-owned value, the sink MUST consume either an immutable framework-owned pinned carrier for that exact classified value or a reconstructed fixed output; the sink MUST NOT re-read mutable caller bytes after classification and still claim the earlier decision. Browser sinks MUST classify platform behavior that depends on a tuple of attributes from the same pinned element snapshot, not validate each string in isolation; hidden `_charset_` substitution is the canonical HTML example (§13.2). Spec §10.3 C15 names the concrete sink obligations. (6) **Authority-bearing controls have a framework-owned bootstrap trust root.** Every supported Kovo compiler, dev, build, export, generated-server, worker, and test runner MUST evaluate the framework security bootstrap before any authored app module, Vite/plugin module, generated module, or other caller-controlled dependency in that realm. The bootstrap eagerly captures the exact compiler/runtime controls later used by security decisions; late mutation can therefore only replace unused public bindings, not the pinned controls. Function source text, names/arity, native-looking descriptors, and finite positive/negative probe corpora are health diagnostics only and MUST NOT be accepted as provenance for a control captured after caller code ran. A host preload (`NODE_OPTIONS`, embedding code, loader hook, VM setup, or equivalent) that executes before the supported Kovo entry is privileged same-process host compromise and outside the app-level framework claim; a platform that cannot guarantee bootstrap order MUST move authority computation into a genuinely pristine isolate with a fail-closed typed RPC boundary. Tests for import-order mutation MUST enter through the same bootstrap-first runner and poison controls only after that boundary, including the first entropy/hash/command use rather than relying on second-use detection. **Agent/LLM honesty:** Kovo does not claim prompt-injection immunity (OWASP LLM01-class attacks remain possible when an app lets a model read adversarial text or call tools). The framework claim is narrower: default-deny guards, the outbound-egress deny floor, structured sinks, and future capability-bounded tool adapters reduce the blast radius of a compromised model action, but they do not make malicious prompts or retrieved content harmless.

**Trusted application-code boundary (normative).** Kovo does not sandbox app-authored server modules or third-party packages that execute in the server realm. The public-import and provenance rules in §5.2 prevent unsupported or accidental authority use inside the supported authoring subset; they are not a claim that deliberately hostile same-realm code cannot recover ambient JavaScript authority through `Function`, dynamic loading, reflection, native addons, or equivalent language/host facilities. Such code is privileged application compromise, not a remote-input framework boundary. Deployments that execute mutually untrusted plugins or generated server code MUST place that code in a separate process or genuinely isolated realm and expose only a fail-closed typed RPC capability surface. Finite syntax deny-lists and intrinsic pinning may remain defense-in-depth, but MUST NOT be described or tested as a sandbox proof.

**Capability-closed untrusted roots (normative, supported-subset static gate).** Before evaluating
authored app modules, `kovo build` MUST scan the immutable app-source snapshot and census every
route, layout, query, mutation, endpoint, webhook, durable or scheduled task, serialized browser
handler, and supported agent/tool callback as an untrusted-data root. For each root, Kovo computes a
transitive module/callback graph across eager imports, re-exports, local aliases and wrappers,
literal `import()`/`require()` edges, conditional local targets, and callbacks or callback-bearing
containers transferred through a local wrapper. A non-literal loader, unresolved local target, or
reachable raw filesystem, network, process, worker, VM/dynamic-loader, or database-driver capability
fails the pre-evaluation build gate with **KV448** and a root-to-terminal provenance path. Reviewed
framework APIs are the only nodes that may terminate such a path as a capability door; app or
package metadata cannot mint a framework door.

Reachable package code requires a least-authority verdict for the exact installed package name,
version, security-relevant manifest fingerprint, requested subpath, imported export, and complete
conditional-export arm set. Kovo packages and explicitly reviewed framework companions use a
compiler-owned, version-pinned verdict. Other packages use the committed
`kovo.capabilities.json` `kovo-package-capability-summaries/v1` ledger, whose entries are versioned
independently and may classify exports only as pure or raw. A side-effect-only import is the reserved
`<module>` entry and MUST classify package initialization explicitly rather than relying on an empty
export list. An absent, stale, duplicate,
contradictory, malformed, export-incomplete, condition-incomplete, or unresolved verdict fails
closed with KV448. `kovo explain --capabilities` prints the root census, reviewed doors, exact
package-summary versions/fingerprints, and every closed fact with the same provenance used by the
diagnostic. This is a conservative proof about accidental authority in Kovo's supported static
authoring subset; consistent with the trusted application-code boundary above, it is not a
same-realm JavaScript sandbox or a claim about deliberately hostile dependencies.

**Finite operation closure (normative, supported-subset static gate).** Capability closure answers
which code and reviewed doors are reachable; the finite security-operation IR answers which
security-relevant effects a supported handler can perform. Its browser vocabulary is closed in
§4.3. Its structured-server vocabulary is exactly: principal-scope acquisition; managed database
read/write; justified trusted SQL; framework egress; justified trusted HTML; cookie/header/outcome,
raw-response, and redirect response effects; storage read/write; task composition; plus the
compiler-control records `server.handler.root` and `server.helper.call`. The root record enrolls each
supported query, mutation, endpoint, webhook, and task body even when it has no terminal effects.
The helper-call record names an exact immutable same-file callable that received authority and
carries the source-derived handler root on the edge. The normalized interpreter below MUST
discharge that edge before the build can treat the root as closed. The inventory in
`securityOperationKinds` is the canonical union. C9 assigns terminal effects to one real boundary
owner and the two control records to capability closure. Adding a kind without exactly one owner, or
an inventory row that names an unknown/duplicate kind, fails `check:c9-sink-inventory`.

Classification follows symbol identity and monotone receiver provenance, not variable spelling.
Endpoint/query/task context is the declared context parameter; a mutation's request and context are
the second and third parameters respectively. Context, principal scope, database, headers, storage,
`Response`, and their destructured method aliases retain authority through direct immutable aliases.
An ambiguous/mutable join, computed terminal method, raw database client member, authority-bearing
container or constructor, or return of authority is unsupported and MUST fail closed with
**KV449**. Authority may pass to an exact immutable same-file function only by emitting a
`server.helper.call` edge with its local identity. Imported, foreign, computed, aliased, reassigned,
or unresolved helpers remain KV449. The finite edge enrollment itself does not guess about the
helper body; the normalized interpreter MUST produce an explicit bottom-up summary before Kovo can
claim cross-helper effect closure. A helper may always consume plain data returned by a reviewed
operation, or the capability-closed module graph may terminate at an exact reviewed framework door.
Namespace and named imports of the three exceptional operations preserve exact
framework identity: `trustedSql` and `trustedHtml` require a static justification, and raw
`Response` use is admitted only where the declared endpoint posture supplies the compiler-owned
justification. App spelling, a same-named local, a cast, or a generated manifest cannot mint a door.

This layer deliberately does not claim general JavaScript interpretation or same-realm isolation.
The emitted operation lists are immutable, inspectable audit evidence consumed by component graphs
and `kovo explain`; they are not an opcode sandbox and do not replace the actual C9 sink checks.
Every supported factory root MUST resolve from an inline definition object to either an inline
function or one exact immutable same-file function. Definition spreads/computed root keys, missing
roots, imported/aliased/reassigned roots, and dynamic definition carriers are KV449. This includes
`query({ load })`: query roots appear in the emitted manifest even when the loader is effect-free,
and a directly reached managed DB write from a query remains KV449. Value-flow beyond the closed
alias/receiver and explicit local-call-edge rules above belongs only to the normalized abstract
interpreter defined next; the edge preserves that obligation rather than guessing its downstream
verdict.

**Normalized helper provenance (normative, narrow abstract interpreter).** The compiler MUST
discharge every `server.helper.call` over `kovo-security-semantic-graph/v1`, a normalized graph whose
nodes are enrolled handler roots, exact same-file callables, finite operations, and explicit closed
verdicts. This is not a JavaScript evaluator, SSA optimizer, or type-inference engine. Its complete
value lattice is: plain local data; request/context authority; managed database, structured-header,
storage, response-constructor, response-outcome, and principal-scope authority; one exact
`operation:<securityOperationKind>` terminal; and absorbing unknown authority. The scanner is the
only raw-syntax boundary; validation, emission, graph, and explain consumers decide from these
typed facts (SPEC §5.2 rule 10).

Transfer semantics are finite. An exact immutable alias preserves its lattice value. Static object
destructuring applies the reviewed member transition one property at a time. Results of finite
operations are plain data, except the explicit principal-scope acquisition that returns a scoped
context. Passing authority to an exact immutable same-file helper maps each positional argument to
that helper's parameter binding and computes a context-sensitive summary keyed by the complete
authority-input vector. Summaries are computed callee-first and merged back into the caller; nested
helper operations retain the source root and ordered transfer path. Returning or throwing
authority, placing it in an opaque container, mutating an authority alias/member, using a mutable or
ambiguous join, capturing it in an unsummarized nested callable, recovering it through `arguments`
or a rest/spread mapping, invoking an operation through `call`/`apply`/`bind`, or using an imported,
computed, aliased, reassigned, unresolved, or otherwise foreign callable is unsupported and MUST
remain KV449. A query root's no-managed-write posture propagates unchanged through every summary.

The resource contract is deterministic and has no app-authored widening knob: at most 16 helper
edges on one path, 50,000 interpreted AST nodes, 4,096 finite operations, and 256 helper summaries
per root. A repeated active summary key is a recursion cycle, not a fixpoint guess. The only closed
reasons are `helper-cycle`, `opaque-transfer`, `unknown-operation`,
`unsupported-authority-use`, and the four named `budget-*` reasons. A cycle, unsupported construct,
or exhausted call-depth/node/operation/summary budget MUST produce KV449 before output, with
`root`, ordered `transfers`, `sink`, and `verdict=closed:<reason>` in the diagnostic. Successful
generated server manifests and `kovo explain` expose the same root-to-transfer-to-sink trace and
bottom-up summaries. These artifacts are audit evidence; they neither grant runtime authority nor
replace the C9 sink owner.

**Authorization-gates-DATA scope (normative honesty boundary).** The normalized substrate may
contribute to OPP-28 only when the data analyzer has an exact private principal symbol, an exact
owner-column identity, and an equality-equivalent predicate (`eq` or singleton membership) whose
accepted guard principal is the same symbol. That structurally proven subset may be reported as
owner-scoped. Arbitrary JavaScript guard correctness, semantic equivalence between general
predicates, multi-principal policy composition, database policy correctness, and whether an opaque
helper actually enforces the intended business rule are not proved by this interpreter. They remain
an explicit database-engine/runtime-policy and audit responsibility; unknown correspondence stays
`scope: unknown` and MUST NOT be promoted by naming, types, or a permissive helper summary.

**Analyzer-summary proof boundary (normative).** `kovoAnalyzerSummary` is a candidate marker, not
an app-authored provenance assertion. A private-scope marker contributes to any invalidation,
owner-scope, accepted-guard, write, or diagnostic verdict only when the analyzer independently
resolves a bare helper identifier to exactly one declaration in the same source file. The only
accepted declaration forms are a direct function declaration or a `const` binding initialized
directly by an arrow or function expression. Object-literal properties and methods, class members,
property-access targets, imports, alias bindings presented as the marker target, destructured
bindings, `let`/`var` bindings, reassigned bindings, and otherwise opaque or multiply declared
callables remain unknown. No alias or container may stand between the marker and the proven
declaration.

The direct helper MUST have one non-default, non-rest identifier parameter and no generator body.
Its body MUST be either an expression-bodied arrow or a block containing exactly one return, and
that expression MUST be a literal property chain rooted in the parameter. The first private-scope
segment MUST be `guard`, `session`, or `tenant` (for example, `parameter.guard.userId` or
`parameter.request.session.id`), and the declared kind and path MUST exactly equal that segment and
the literal suffix after it. A provenance-bearing invocation MUST call that exact helper identifier
or one direct same-file immutable `const alias = provenHelper` identifier and pass the exact
framework request/context parameter (`req`, `request`, `ctx`, or `context`), proven by its
callback/receiver position rather than its spelling, as the sole argument. That one-hop alias may
preserve an already-proven identity but cannot be the marker target or widen the proof. Property or
element access, destructured/container aliases, alias chains, and imported, opaque, or mutable
aliases remain unknown. Multi-statement/general bodies, computed returns, mismatched principals,
unresolved symbols, and calls with client input or opaque/container arguments also remain unknown.
No `server` summary kind exists: general server provenance and KV438 cannot be discharged by an app
declaration. These restrictions apply uniformly to every consumer of session provenance; a looser
invalidation or explain path MUST NOT become a security side door.

**Build-preset capability boundary (normative).** `KovoPreset` is an opaque, framework-owned
selection token, not a public structural deployment descriptor. `node()`, `vercel()`, and
`cloudflare()` mint exact frozen tokens registered by identity in a framework-private `WeakMap`;
`kovo build` resolves only those exact objects through the matching internal module instance.
Copying or spreading a token, reconstructing its symbol-shaped type, or supplying an object with
`name`/`emit`/`inspect`/`capabilities` fields MUST fail closed. Emission callbacks, inspection
callbacks, and capability records remain internal build authority and MUST NOT be reflectively
reachable from the public token. The module-private `unique symbol` type is only author-time
ergonomics; exact runtime registry membership and config preflight own enforcement.

**Classifier-intrinsic lockdown (normative).** Rule 6 unconditionally pins the finite global bindings and direct namespace members that the request classifier recognizes, and guards their language/Web intrinsic prototypes before caller-controlled evaluation; the classifier corpus gate MUST keep that runtime inventory exact. A custom runner MUST import `@kovojs/server/runtime-bootstrap` as its literal first import, while generated runners establish the same order themselves. The public dispatch refusal detects an omitted bootstrap, but cannot authenticate earlier evaluation in the same mutable realm: importing authored/package code first and bootstrapping later is unsupported privileged-host misuse, not a repair path. This unconditional intrinsic lockdown does **not** freeze or claim provenance for egress/transport instrumentation prototypes such as undici, `node:http`, `net.Socket`, Datadog, OTel, or nock hooks. The separate outbound-egress prototype-freezing option below therefore remains off by default.

**Operator-environment trust root (normative).** Bootstrap MUST pin operator environment names and values before authored evaluation, and later security lookup MUST preserve the host's name semantics. In particular, Windows names are case-insensitive: the pinned authority MUST resolve every case spelling equivalently and fail closed if an injected source contains case-fold-colliding names, while app env-schema snapshots retain the operator's original key spellings.

**Authentication request-origin binding (normative).** A framework-owned Better Auth binding MUST
normalize and pin the configured `baseURL` origin when the binding is constructed. Before parsing a
request cookie, delegating to a Better Auth handler, consuming a credential, revoking a session, or
reading or writing auth storage, it MUST require the request's exact normalized scheme, hostname,
and effective port to equal that pinned origin. A mismatch fails before cookie parsing, rate-limit
storage, credential verification, session lookup/mint/revocation, or response-cookie forwarding; it
does not fall back to the request `Host`, an untrusted forwarded header, or a less-secure cookie
name. URL paths do not relax this comparison. Case, Unicode hostname spelling, IPv6 spelling, and
default ports are compared only after URL normalization, while non-default ports remain exact.
Kovo's fixed SQLite/Postgres binding constructor MUST validate the base URL, construct the complete
host-only cookie posture, and privately register the exact Better Auth object with that canonical
origin before creating session, credential, or mount operations. Those private consumers admit only
an exact registry member; structural compatibility, a dependency `$context`, and an arbitrary
safe-looking cookie configuration are not construction proof. Caller-created `betterAuth()` objects
are unsupported and MUST fail before auth handler/API, cookie parsing/minting, or database access.
The ordinary HTTPS `__Secure-` default is insufficient: a sibling subdomain can plant that name with
`Domain` and browser duplicate-cookie ordering can place the attacker value first. On HTTPS, fixed
bindings therefore construct `__Host-` cookies with `Secure`, `HttpOnly`, `Path=/`, and no `Domain`,
and keep cookie-cache state inside the same fixed posture or disabled. Plaintext is admitted only for
an exact loopback origin (`localhost`, IPv4 `127/8`, or `[::1]`) in non-production local development;
those bare development cookies have no sibling-domain security guarantee. Production and every
non-loopback origin require HTTPS unconditionally.

**Better Auth credential-consumer non-egress door (normative).** Every supported fixed-binding
consumer of Better Auth signing material, submitted or stored credentials, request/session
cookies, password hash/verify values, session records, and dependency results MUST be enumerated
in one complete package-private contract census and invoked through the same runtime gate. Each
contract binds a stable consumer id to the M2 secret paths it may receive and the only result shape
that may reach its reviewed next sink. The gate MUST admit only an exact runtime-registered
consumer token, validate the result, seal it, and permit exactly one consume by that same token;
structural forgeries, unknown consumers, cross-consumer swaps, replayed results, invalid result
shapes, and dependency-thrown secret-bearing errors fail closed. Only an exact dependency
400/401/403 verdict from a credential operation may become Kovo's opaque invalid-credential
outcome, and that verdict is itself one-shot. A module-private `unique symbol` or validated secret
brand is author-time ergonomics only: the runtime registry, complete path/consumer and source-use
censuses, and hostile-value/sink tests own enforcement. The static census proves coverage but is
not itself runtime authority (SPEC §10.3 C9-C10).

Every captured external Better Auth credential source—including handler/API callables, constructors,
password functions, rate-limit construction, and cookie extraction—MUST be invoked inside that
runtime gate after exact consumer/source validation. Passing an owner-supplied callback through a
generic gate while the callback itself retains raw dependency call authority is not the sole-door
construction; generic callbacks are limited to package-owned transforms such as sanitized session
reconstruction. The package source-use census MUST resolve aliases, destructuring, literal computed
access, `.call`/`.apply`, and local imports/re-exports by symbol/value flow; printed callee spelling
or a fixed method-name regex is not coverage evidence.

**Better Auth redirect mount response boundary (normative).** The opaque Better Auth mount is a
redirect-protocol adapter, not a public proxy for the dependency router. After the exact request
origin check, Kovo MUST admit only status `301`, `302`, `303`, `307`, or `308` with exactly one
nonempty `Location` that resolves to the pinned origin over HTTP(S). Missing, duplicate/ambiguous,
protocol-relative, credential-bearing, non-HTTP(S), or off-origin locations fail inside the opaque
boundary. Kovo MUST canonicalize an admitted location to its same-origin path, query, and fragment,
then reconstruct an empty response containing only that `Location` and reviewed `Set-Cookie`
values plus Kovo's own `Cache-Control: no-store` floor. It MUST NOT forward the dependency response
body, status text, content headers, or arbitrary headers. In particular, dependency routes such as
`get-session` and error pages MUST fail closed rather than exposing session JSON, bearer material,
or HTML through the mount (SPEC §6.6/§9.1).

**Outbound egress: the positive framework capability (normative).** Untrusted-data-reachable framework code MUST have one supported positive HTTP network door: the exact framework-owned `ctx.fetch` supplied to durable/scheduled tasks, verified webhooks, and any supported agent-tool callback. A runner or app MUST NOT replace that function. Raw `fetch`, `node:http`, `node:https`, `net`, datagram, proxy-agent, database-driver, worker, process, native-socket, or dynamically loaded network authority remains unavailable from that graph unless a separately reviewed framework door explicitly owns it. `egress.allowDestinations` MUST be a dense list of exact HTTP(S) origins. Boot MUST reject an empty, malformed, credential-bearing, path/query/fragment-bearing, non-HTTP(S), or non-string entry instead of warning and widening or silently narrowing posture. Boot canonicalizes scheme, URL-normalized hostname (including Unicode, legacy IPv4, IPv6, case, and a DNS trailing dot), and effective port into one origin identity. The initial request and every redirect or pooled-request origin MUST match that canonical set **before DNS, proxy selection, pool reuse, or dial**. Every admitted hostname request/hop MUST resolve all candidate addresses and classify all of them; any closed answer closes the whole request. Every new TCP dial MUST classify the exact resolver result that Node may select and pin that immutable result into the dial, so DNS rotation is admitted only when the origin remains declared and every new answer remains safe. A declared private origin additionally needs the ambient `allowInternal` posture below. A framework-created database socket is a separate, module-private exact-endpoint capability: it may follow DNS rotation for its registered Postgres host/port without opening that endpoint to unrelated sockets. Arbitrary application proxy/dispatcher configuration is unsupported and MUST fail boot or be stripped from `ctx.fetch`; an operator-controlled transparent proxy remains deployment authority outside this application-level origin proof and does not turn the private-network floor into a sandbox. Future agent-tool APIs MUST supply this same contextual door before they are supported. Same-process deliberately malicious code or intrinsic poisoning is outside this construction proof, as stated by the capability-closure boundary above.

**Outbound egress: the private-network deny floor (normative, runtime defense-in-depth — NOT a proof).** The threat is the **SSRF network position**: a reflected or forged inbound request coaxes the server into making an _outbound_ request to an address it must never reach — cloud instance-metadata (`169.254.169.254` and the AWS ECS/EKS variants `169.254.170.2`/`169.254.170.23`, the AWS IMDSv6 `fd00:ec2::254`, Azure's IMDS plus its `IDENTITY_ENDPOINT` loopback, GCP's `metadata.google.internal`), localhost sidecars, or internal-only services on RFC1918 / link-local / unique-local / CGNAT ranges. The payoff is managed-identity credential theft off the metadata endpoint, or an internal-service pivot. Kovo installs the floor at `createApp()` by default and accepts explicit operator config through `createApp({ egress: { allowInternal: ['otel:4318', '10.0.5.2:6379'] } })` with the following normative behavior. **All public/external egress is UNRESTRICTED at this ambient process floor** — the positive framework capability above is the separate control that closes public destinations reached through `ctx.fetch`. **Private / loopback / link-local / unique-local / CGNAT / IANA-special destinations are DENIED by default in production and whenever an explicit `egress` object is supplied**, reachable only when the exact `host:port` is in the operator's narrow `allowInternal` allowlist (broad CIDR entries are flagged and warned). In development, an omitted `egress` option still installs both enforcement layers and still denies cloud metadata, but permits non-metadata private-network destinations so localhost DB/Redis/OTel/Ollama sidecars do not brick ordinary local boot; pass `egress: { allowInternal: [] }` in development to exercise production empty-allowlist semantics. A blocked connection throws a typed 502-class `EgressBlockedError` naming the destination and the remediation. **The cloud instance-metadata endpoint is DENIED by default and is NEVER reachable via `allowInternal`** — it is reachable only inside a module-private `metadataAllowed` `AsyncLocalStorage` frame entered ONLY by the per-cloud credential factories `awsCredential()` / `gcpCredential()` / `azureCredential()`, which wrap the cloud SDK's credential provider so a token _refresh_ re-enters the frame. There is deliberately no generic `withMetadataAccess` helper. A reflected SSRF never calls a factory, so it never enters the frame, so metadata stays denied at the very same IP — provenance-as-current-frame, unforgeable by SSRF (it survives the `await`/timer boundaries that destroy stack frames) yet still runtime-DiD, not a proof. **DNS64/NAT64 topology is explicit operator authority.** Kovo always decodes RFC 6052's well-known `64:ff9b::/96` carrier. A deployment using any Network-Specific Prefix MUST list every active translator prefix in `egress.nat64Prefixes`; automatic RFC 7050 discovery or A/AAAA correlation is not accepted as the policy root. Only `/32`, `/40`, `/48`, `/56`, `/64`, and `/96` are valid. Boot MUST reject malformed CIDRs, set host bits, a non-zero `/96` u octet, duplicate/overlapping configured prefixes, and any configured prefix that overlaps the implicit well-known decoder. The framework snapshots and canonicalizes the resulting prefix set as process-global posture. At the sink, a matching configured prefix is decoded using RFC 6052 Table 1 before the context-free IPv6 registry verdict: the u octet MUST be zero for layouts shorter than `/96`, suffix bits are ignored, and the embedded IPv4 destination is classified normally. This explicit topology may expose public IPv4 through RFC 8215's local-use `64:ff9b:1::/48`, but embedded metadata remains metadata and can never be reopened by `allowInternal`. The decision rule runs **per request and per redirect hop, at BOTH enforcement layers**: resolve the host → normalize (IPv4-mapped `::ffff:`, decimal/octal/hex, well-known NAT64, and configured Network-Specific Pref64) → pin the exact validated resolver result from which Node may select a dial address → public IP allow; metadata IP allow iff the `metadataAllowed` frame is active; other non-public IP allow iff the development omitted-config posture permits it or `host:port ∈ allowInternal`; anything not confidently classified as public fails **closed**. Enforcement is **dual-layer because a single layer fails open**: (a) a custom undici dispatcher at the per-request `dispatch()` level — pooled-socket reuse skips the per-connection hook, so a connect-only check would pass the _second_ request to an origin; and (b) the `node:http`/`node:https` + `net.Socket.prototype.connect` layer — AWS IMDS via `@smithy` uses raw `node:http` and bypasses undici entirely — which also injects a pinning `lookup` so a TOCTOU DNS-rebind cannot swap a public answer for a private one between check and dial. Bootstrap installs both layers at the `createApp` chokepoint and runs a **loud startup self-probe** that warns unmissably when the floor is not installed; production refuses boot when the floor is missing, partial, tampered, or disabled without an audited non-empty opt-out justification. Because monkeypatches do not cross `Worker`/`child_process` boundaries, every worker/child bootstrap that serves requests MUST re-install (the self-probe is the safety net). Prototype-freezing is **opt-in / off by default** (it breaks Datadog/OTel/nock). This control is **labeled everywhere as a fail-closed runtime defense-in-depth floor, never a by-construction proof**. Residual fail-open holes (enumerated, by design): same-process app code can re-patch `net.Socket.prototype.connect` or call `setGlobalDispatcher` after the floor; `Worker`/`child_process`/native-socket paths the JS layer never sees; arbitrary raw per-call dispatchers/proxy agents outside the supported capability graph; and provider-shape drift in a future undici/node internal. The floor is **redundant on Lambda/PaaS/Workload-Identity-Federation** where IMDSv2 / hop-limits already close the metadata path; it earns its keep on long-lived managed-identity VMs and against the internal-service pivot.

**Capability URLs for storage downloads (normative, by-construction at the verify sink).** A download URL for a stored object is signed, short-lived, and scope-bound so the object is _un-dereferenceable without a valid token_. `signCapability` mints a token over the canonical, length-prefixed tuple `(version, signing-key-id, method, key, expiry, scope, one-time, nonce)` (canonicalize-before-sign, so no field-confusion collision or unsigned replay/key-selection field) using the framework signing secret; the framework-owned download route MUST `verifyCapability` — re-canonicalizing the key/method/scope it derives _from the request_ and comparing the HMAC in constant time — **before any storage read**. Because the route supplies the expected claims rather than trusting the token's, a token for object `a` cannot authorize reading object `b` even with a valid signature. Verification is fail-closed and ordered (parse → constant-time signature → expiry → claim match → one-time burn); rejection reasons are never leaked to the client. This is **by-construction at the verify sink** (an object cannot be read without a verifying token), with one honestly-labeled limit: the URL is a **bearer credential** whose _leakage_ via `Referer`/logs/CDN is mitigated (short expiry by default, narrow scope, and an optional one-time token posture) but **not proven**. The framework storage **download route** that hosts the sink is **shipped**: `createStorageDownloadEndpoint` builds a prefix-mounted GET/HEAD `endpoint()` whose handler re-derives the expected key/method/scope from the request and runs `verifyCapability` before any storage read (a generic, reason-free 404 on any failure), and `ctx.signUrl({ key, method?, scope?, expiresIn?, oneTime? })` mints a URL pointing at that route (canonicalize-before-sign; short-expiry default). Capability signing and verification MUST reject before unbounded decode, parsing, canonicalization, or audit retention: keys are limited to 4,096 code units, scopes and audiences to 1,024 each, decoded payloads to 12,000 bytes, complete wire tokens to 16,384 code units, and TTL to at most one hour. Production MUST refuse a missing, custom, or volatile download replay store and accept only the opaque durable store exposed by `createPostgresAppRuntimeDb().capabilityReplayStore`, even when the app currently mints only ordinary tokens; this keeps one-time posture from becoming a deployment-time footgun and makes replica/restart truth mandatory before the sink can serve. Production signing, verification, signer construction, and download-route construction MUST also refuse caller-injected clocks, so expiry is measured only against the framework-owned wall clock (and durable one-time insertion is additionally guarded by the database clock). Every mint records a capability fact surfaced by `kovo explain --capabilities`.

---
