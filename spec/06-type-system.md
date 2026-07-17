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

Every independently resolved authorization principal entering a CSRF or replay identity, and every
source-derived mutation identity, MUST likewise be a non-empty string of at most 1,024 JavaScript
code units. An inbound anonymous-CSRF cookie secret is accepted only when it is 32..1,024 base64url
characters; the framework mints a 43-character secret. A present malformed or oversized credential
fails closed and is never replaced by an anonymous fallback within that request.

`s.string()` rejects raw C0 control characters (`U+0000` through `U+001F`), `U+007F` DEL, and the JavaScript line-terminator code points (`U+000A`, `U+000D`, `U+2028`, `U+2029`) by default before any format, pattern, or unsafe-regex refinement runs. This is defense-in-depth for every request-derived string sink: an embedded NUL, CR/LF, tab, or other control character cannot survive validation by relying on a loose or parity-sensitive author regex. Authors who are intentionally accepting textarea-style content must opt in with `s.string().multiline()`, which admits line terminators while still rejecting the other raw C0 controls and DEL. Authors who intentionally accept arbitrary raw controls must opt in with `s.string().allowControlChars()`. These opt-ins alter only the base string hygiene gate; all existing chained format/pattern/optional/default behavior still applies normally.

**Security soundness (normative).** The Prime Principle (§2) rests on the same sound-subset discipline, bounded by six rules. (1) **The compiler performs no TypeScript type inference of its own** — security classification is carried by AST symbol-identity provenance, sink classification, and fail-closed runtime checks; a branded type (`Secret<T>`, a `public()` brand, and the like) is `tsc`-time ergonomics and defense-in-depth, never the enforcement. (2) **Runtime taint is unsound** — JS string operations and template literals produce fresh primitives with no surviving metadata, so request-derived provenance for confidentiality, write-eligibility, and input shape is proven _statically_ at the AST (where the path is still code), never by runtime value-tracking; runtime contributes only _sink validation_ (checking a final value's grammar, shape, or resolved IP, which survives transforms). (3) **By-construction and defense-in-depth are distinguished and labeled.** Where static analysis can prove the unsafe state inexpressible, the guarantee is by-construction (output-safety §5.2 rule 10, the confidentiality boundary, default-deny authorization, write-provenance). Where it cannot — outbound egress, a read-only-handle runtime proxy, Content-Security-Policy / Trusted Types, log redaction — the control is a fail-closed runtime floor: sound at its sink but bypassable by privileged same-process code, and it MUST be documented as defense-in-depth rather than a proof. (4) **Advanced TypeScript types are preferred when they narrow author mistakes without becoming the trust boundary.** Validated branded constructors are appropriate for strong signing material; module-private `unique symbol` brands are appropriate for framework-owned sentinels; branded escaped/trusted/rendered HTML values are appropriate for UI composition; exact header-bag and discriminated-union types are appropriate for preserving multi-value headers and explicit posture choices. Public structural brands, casts, and type-only assertions MUST NOT be accepted as security evidence unless a runtime constructor, AST/provenance gate, or fail-closed sink also enforces the invariant. (5) **Boundary decisions over caller-owned carriers must classify-and-pin or reconstruct.** Once a runtime boundary classifies, normalizes, or validates a caller-owned value, the sink MUST consume either an immutable framework-owned pinned carrier for that exact classified value or a reconstructed fixed output; the sink MUST NOT re-read mutable caller bytes after classification and still claim the earlier decision. Browser sinks MUST classify platform behavior that depends on a tuple of attributes from the same pinned element snapshot, not validate each string in isolation; hidden `_charset_` substitution is the canonical HTML example (§13.2). Spec §10.3 C15 names the concrete sink obligations. (6) **Authority-bearing controls have a framework-owned bootstrap trust root.** Every supported Kovo compiler, dev, build, export, generated-server, worker, and test runner MUST evaluate the framework security bootstrap before any authored app module, Vite/plugin module, generated module, or other caller-controlled dependency in that realm. The bootstrap eagerly captures the exact compiler/runtime controls later used by security decisions; late mutation can therefore only replace unused public bindings, not the pinned controls. Function source text, names/arity, native-looking descriptors, and finite positive/negative probe corpora are health diagnostics only and MUST NOT be accepted as provenance for a control captured after caller code ran. A host preload (`NODE_OPTIONS`, embedding code, loader hook, VM setup, or equivalent) that executes before the supported Kovo entry is privileged same-process host compromise and outside the app-level framework claim; a platform that cannot guarantee bootstrap order MUST move authority computation into a genuinely pristine isolate with a fail-closed typed RPC boundary. Tests for import-order mutation MUST enter through the same bootstrap-first runner and poison controls only after that boundary, including the first entropy/hash/command use rather than relying on second-use detection. **Agent/LLM honesty:** Kovo does not claim prompt-injection immunity (OWASP LLM01-class attacks remain possible when an app lets a model read adversarial text or call tools). The framework claim is narrower: default-deny guards, the outbound-egress deny floor, structured sinks, and future capability-bounded tool adapters reduce the blast radius of a compromised model action, but they do not make malicious prompts or retrieved content harmless.

**Trusted application-code boundary (normative).** Kovo does not sandbox app-authored server modules or third-party packages that execute in the server realm. The public-import and provenance rules in §5.2 prevent unsupported or accidental authority use inside the supported authoring subset; they are not a claim that deliberately hostile same-realm code cannot recover ambient JavaScript authority through `Function`, dynamic loading, reflection, native addons, or equivalent language/host facilities. Such code is privileged application compromise, not a remote-input framework boundary. Deployments that execute mutually untrusted plugins or generated server code MUST place that code in a separate process or genuinely isolated realm and expose only a fail-closed typed RPC capability surface. Finite syntax deny-lists and intrinsic pinning may remain defense-in-depth, but MUST NOT be described or tested as a sandbox proof.

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

**Outbound egress: the private-network deny floor (normative, runtime defense-in-depth — NOT a proof).** The threat is the **SSRF network position**: a reflected or forged inbound request coaxes the server into making an _outbound_ request to an address it must never reach — cloud instance-metadata (`169.254.169.254` and the AWS ECS/EKS variants `169.254.170.2`/`169.254.170.23`, the AWS IMDSv6 `fd00:ec2::254`, Azure's IMDS plus its `IDENTITY_ENDPOINT` loopback, GCP's `metadata.google.internal`), localhost sidecars, or internal-only services on RFC1918 / link-local / unique-local / CGNAT ranges. The payoff is managed-identity credential theft off the metadata endpoint, or an internal-service pivot. Kovo installs the floor at `createApp()` by default and accepts explicit operator config through `createApp({ egress: { allowInternal: ['otel:4318', '10.0.5.2:6379'] } })` with the following normative behavior. **All public/external egress is UNRESTRICTED** — this floor does **not** stop data exfiltration to an attacker host (that needs a _positive_ destination allowlist, a separate app-specific control, declared here as an explicit non-goal). **Private / loopback / link-local / unique-local / CGNAT / IANA-special destinations are DENIED by default in production and whenever an explicit `egress` object is supplied**, reachable only when the exact `host:port` is in the operator's narrow `allowInternal` allowlist (broad CIDR entries are flagged and warned). In development, an omitted `egress` option still installs both enforcement layers and still denies cloud metadata, but permits non-metadata private-network destinations so localhost DB/Redis/OTel/Ollama sidecars do not brick ordinary local boot; pass `egress: { allowInternal: [] }` in development to exercise production empty-allowlist semantics. A blocked connection throws a typed 502-class `EgressBlockedError` naming the destination and the remediation. **The cloud instance-metadata endpoint is DENIED by default and is NEVER reachable via `allowInternal`** — it is reachable only inside a module-private `metadataAllowed` `AsyncLocalStorage` frame entered ONLY by the per-cloud credential factories `awsCredential()` / `gcpCredential()` / `azureCredential()`, which wrap the cloud SDK's credential provider so a token _refresh_ re-enters the frame. There is deliberately no generic `withMetadataAccess` helper. A reflected SSRF never calls a factory, so it never enters the frame, so metadata stays denied at the very same IP — provenance-as-current-frame, unforgeable by SSRF (it survives the `await`/timer boundaries that destroy stack frames) yet still runtime-DiD, not a proof. The decision rule runs **per request and per redirect hop, at BOTH enforcement layers**: resolve the host → normalize (IPv4-mapped `::ffff:`, decimal/octal/hex, NAT64) → pin the exact validated IP → public IP allow; metadata IP allow iff the `metadataAllowed` frame is active; other non-public IP allow iff the development omitted-config posture permits it or `host:port ∈ allowInternal`; anything not confidently classified as public fails **closed**. Enforcement is **dual-layer because a single layer fails open**: (a) a custom undici dispatcher at the per-request `dispatch()` level — pooled-socket reuse skips the per-connection hook, so a connect-only check would pass the _second_ request to an origin; and (b) the `node:http`/`node:https` + `net.Socket.prototype.connect` layer — AWS IMDS via `@smithy` uses raw `node:http` and bypasses undici entirely — which also injects a pinning `lookup` so a TOCTOU DNS-rebind cannot swap a public answer for a private one between check and dial. Bootstrap installs both layers at the `createApp` chokepoint and runs a **loud startup self-probe** that warns unmissably when the floor is not installed; production refuses boot when the floor is missing, partial, tampered, or disabled without an audited non-empty opt-out justification. Because monkeypatches do not cross `Worker`/`child_process` boundaries, every worker/child bootstrap that serves requests MUST re-install (the self-probe is the safety net). Prototype-freezing is **opt-in / off by default** (it breaks Datadog/OTel/nock). This control is **labeled everywhere as a fail-closed runtime defense-in-depth floor, never a by-construction proof**. Residual fail-open holes (enumerated, by design): same-process app code can re-patch `net.Socket.prototype.connect` or call `setGlobalDispatcher` after the floor; `Worker`/`child_process`/native-socket paths the JS layer never sees; a per-`fetch(url, { dispatcher })` option that bypasses the global dispatcher (the `net.connect` layer still catches its _first_ dial); and provider-shape drift in a future undici/node internal. The floor is **redundant on Lambda/PaaS/Workload-Identity-Federation** where IMDSv2 / hop-limits already close the metadata path; it earns its keep on long-lived managed-identity VMs and against the internal-service pivot.

**Capability URLs for storage downloads (normative, by-construction at the verify sink).** A download URL for a stored object is signed, short-lived, and scope-bound so the object is _un-dereferenceable without a valid token_. `signCapability` mints a token over the canonical, length-prefixed tuple `(version, signing-key-id, method, key, expiry, scope, one-time, nonce)` (canonicalize-before-sign, so no field-confusion collision or unsigned replay/key-selection field) using the framework signing secret; the framework-owned download route MUST `verifyCapability` — re-canonicalizing the key/method/scope it derives _from the request_ and comparing the HMAC in constant time — **before any storage read**. Because the route supplies the expected claims rather than trusting the token's, a token for object `a` cannot authorize reading object `b` even with a valid signature. Verification is fail-closed and ordered (parse → constant-time signature → expiry → claim match → one-time burn); rejection reasons are never leaked to the client. This is **by-construction at the verify sink** (an object cannot be read without a verifying token), with one honestly-labeled limit: the URL is a **bearer credential** whose _leakage_ via `Referer`/logs/CDN is mitigated (short expiry by default, narrow scope, and an optional one-time token posture) but **not proven**. The framework storage **download route** that hosts the sink is **shipped**: `createStorageDownloadEndpoint` builds a prefix-mounted GET/HEAD `endpoint()` whose handler re-derives the expected key/method/scope from the request and runs `verifyCapability` before any storage read (a generic, reason-free 404 on any failure), and `ctx.signUrl({ key, method?, scope?, expiresIn?, oneTime? })` mints a URL pointing at that route (canonicalize-before-sign; short-expiry default). Capability signing and verification MUST reject before unbounded decode, parsing, canonicalization, or audit retention: keys are limited to 4,096 code units, scopes and audiences to 1,024 each, decoded payloads to 12,000 bytes, complete wire tokens to 16,384 code units, and TTL to at most one hour. Production MUST refuse a missing, custom, or volatile download replay store and accept only the opaque durable store exposed by `createPostgresAppRuntimeDb().capabilityReplayStore`, even when the app currently mints only ordinary tokens; this keeps one-time posture from becoming a deployment-time footgun and makes replica/restart truth mandatory before the sink can serve. Production signing, verification, signer construction, and download-route construction MUST also refuse caller-injected clocks, so expiry is measured only against the framework-owned wall clock (and durable one-time insertion is additionally guarded by the database clock). Every mint records a capability fact surfaced by `kovo explain --capabilities`.

---
