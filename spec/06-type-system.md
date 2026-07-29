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

App-scoped handles are the authoring identity and generated registry keys are compiler/runtime IR.
An application does not augment `QueryRegistry`, `MutationRegistry`, or `InvalidationSets` by hand
and does not read a query key to wire optimism. Registry generation resolves each proved handle's
exported binding and assembly membership in one snapshot; an orphan or duplicate handle prevents
emission rather than producing a partial registry.

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

#### 6.2.1 App-scoped declaration contract

An app declares its runtime context exactly once with `defineKovo({...})`. The returned
`KovoContract` is a declaration owner, not a mutable application aggregate. Its receiver methods
`route`, `layout`, `query`, `mutation`, `endpoint`, and `task` are the ordinary authoring factories;
each returns a named, declaration-emit-stable opaque handle interface. Request, validated session,
managed read-only or transactional DB posture, declared environment projection, query input/result,
mutation error/payload, route params/search, task input, and endpoint request/result types flow from
that one contract. Authors MUST NOT need to name `AppRequest`, `Reader`, `QueryLoadContext`,
`MutationContext`, `ComponentRenderSlots`, registry augmentations, or explicit app generics for an
ordinary declaration.

`defineKovo` snapshots provider descriptors and callbacks but MUST NOT invoke a DB, session/auth,
environment, CSRF, replay, client-module, or other live provider. Provider evaluation and
environment parsing begin only when `app.assemble({...})` closes the graph (or when an explicitly
documented provider's existing contract requires a later request-time call). Importing the contract
or any declaration module is therefore provider-inert. A provider throw during assembly fails that
assembly before a `KovoApp` is returned; it cannot leave a partially registered application.

Every declaration handle is registered by exact object identity in module-private state owned by
the `KovoContract` that minted it. A module-private `unique symbol` may make accidental structural
construction a TypeScript error, but the runtime proof is exact private-map membership. A handle
from another contract, a copied/spread object, a structurally similar value, or a handle from a
duplicate `@kovojs/server` package instance MUST fail assembly with an actionable diagnostic that
names the declaration kind and the two resolved package identities when available. Public
structural brand fields and `Symbol.for()` are forbidden. The compiler additionally detects
duplicate Kovo package instances before authored evaluation; the runtime check is the fail-closed
floor for direct/custom hosts.

`app.assemble({...})` is the sole public application assembly operation and succeeds at most once
for one contract identity. Its declaration arrays are dense, finite, snapshotted in authored order,
and contain only handles minted by that exact contract. The result is an opaque minimal `KovoApp`
token; normalized options, providers, route/query/mutation registries, runtime authorities, DB
carriers, and generated registries remain framework-private. Public `CreateAppOptions` and a
structural `createApp()` aggregate are not app API. A custom adapter accepts the same opaque token
through a focused adapter entrypoint and cannot inspect or reconstruct its private state.

Assembly membership is compiler-checked, not merely a hand-maintained runtime convention. For each
proved `defineKovo` receiver, every compiled declaration handle reachable from that receiver MUST
appear exactly once in the single proved `assemble` call. A missing handle, duplicate membership,
dynamic/spread declaration list, second assembly, unresolved handle, or cross-contract handle is a
build diagnostic before output. The diagnostic for a missing handle includes one deterministic
source edit that appends the exported handle to the matching kind array; applying the edit twice is
a no-op. Runtime assembly repeats the membership and duplicate checks for uncompiled/custom hosts.
There is no ambient registration, import-order discovery, process-global pending registry, or
fallback from the closed application inventory.

Development HMR constructs a fresh contract and closed graph for the new module generation, then
atomically swaps it only after compile and assembly succeed. It discards the old generation's
private membership and provider references after in-flight requests release them; late declarations
cannot join either generation. A failed update keeps the prior closed graph. HMR never invokes
`assemble` twice on one contract or accumulates process-global registrations.

The app-scoped access algebra reuses the executable self-naming guards of §10.2. The contract exposes
`app.authenticated`, plus parameterized `app.role(...)`, `app.rateLimit(...)`,
`app.owns(keyOf, ownsRow)`, and `app.all(...)`; these return the same guard values runtime dispatch
executes and preserve their request refinements. They are not type markers or audit-only labels.
`access: [guard, ...]`, `publicAccess(reason)`, and verified machine access remain the mutually
exclusive §10.2 decisions, and missing or mixed decisions remain KV436. Binding a guard to a
contract narrows its request/session type but does not change the authorization proof boundary:
compiler census plus the exact runtime guard chain remain authoritative.

Factory results expose only purpose-specific operations. In particular, a query handle exposes its
inferred input/result types, component binding, and the §10.4 `optimistic` constructor; it does not
expose a writable registry key. A mutation handle exposes its inferred input/result/error union for
forms and tests without exposing private runtime callbacks. A component that binds a mutation
handle receives its form failure and field-error slots from that handle (§6.3), so a parallel
author-maintained slot registry is not part of the public contract. Public handle types keep
conditional machinery behind named interfaces and errors must anchor on the offending definition
property rather than expand private witness types.

The compiler recognizes an app-scoped declaration only when the call receiver is proven by exact
TypeScript symbol identity to originate from one direct `defineKovo` result under the receiver
provenance rules in §5.2. A same-named local, cast, wrapper, destructured method, computed property,
mutable/ambiguous alias, duplicate package identity, or structurally copied receiver does not mint
factory provenance. Once proven, the factory lowers to the same finite declaration and
`server.handler.root` facts as the corresponding primitive; the facade never replaces the
AST/provenance gate or a runtime sink check.

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
Under the app contract, `<mutation handle>.form` and component mutation binding infer this surface
directly from the handle; `ComponentRenderSlots` and a separately authored form-state map are not
public prerequisites.

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

`Link` is JSX-only: `<Link to={productRoute} params={...}>...</Link>` renders an anchor and has no
imperative overload or descriptor result. `href(productRoute, { params, search })` is the sole
imperative URL-string constructor. GET-form helpers infer their public record directly from the
route's search schema and expose only the form and typed control builders; their conditional helper
families are private implementation types.

`redirect(productRoute, { params })` types the POST-redirect-GET path (§9.1) the same way. Residual literal `href`s in hand-authored IR are validated against the route table at compile time (KV220); full-origin URLs and an `external` marker opt out. The propagation property of §6.2 holds for navigation too: renaming a route path turns every `<Link>`, GET form, and `redirect()` in the app red under `kovo check`.

Two more route-level affordances close the request shell: **guards** — `guard:` on a `route()` runs the same combinator chain as mutations (§10.3) before `page`, refines `req.session` identically, and enrolls the page in the `kovo explain unguarded` audit; and **`notFound()`** — returning `notFound()` from `page` renders the app's 404 page with the correct status, so status codes stay part of the typed surface rather than ad-hoc response construction. `redirect()` and `notFound()` are the sanctioned non-200 page outcomes in v1.

Routes may also return two sanctioned non-HTML 200/304 outcomes: `respond.file(body, { contentType, filename?, etag?, headers? })` and `respond.stream(body, { contentType, filename?, etag?, disposition?, headers? })`. These are still ordinary `route()`s: params/search schemas, guards, typed links, KV220 validation, the unguarded audit, and the `owner:`-powered `unscoped` audit all apply before the body is served. `Content-Type` is required, `Content-Disposition` is declared (`respond.file()` defaults to attachment; `respond.stream()` defaults to attachment unless `inline` is requested), and a matching `If-None-Match` answers 304 without rendering HTML. Upload filename metadata and every final live/generated `Content-Disposition` filename sink MUST neutralize Unicode directional-formatting controls U+061C, U+200E/U+200F, U+202A–U+202E, and U+2066–U+2069 before constructing either `filename` or RFC 8187 `filename*`; browser-visible filenames cannot retain display-direction authority from a remote uploader. Range/resumable downloads are out of scope for v1; large exports that exceed a request/response window belong to a later background-jobs design.

`respond.stream()` and raw `endpoint()` responses are the escape hatch for app-owned streaming protocols. They do not participate in enhanced mutation application, query truth, mutation failure rendering, CSRF/replay semantics, or final fragment reconciliation unless the app builds that protocol itself.

### 6.5 Session schema

Sessions are a declared `s.object` schema, not an `any` bag: `req.session` is fully typed everywhere it appears. This is core, not a nicety — query instance keys (§10.2) and guard refinements (`req.session.user` non-null under `authed`, §6.2) are load-bearing on session fields, so an untyped session would be a hole directly under the proof surface.

Session provenance is an application capability, not a framework-owned identity system. The app declares a `sessionProvider` in the server request shell; Kovo runs it once before route, query, or mutation guards and exposes the returned value as `req.session`. `session(schema).provider(provider)` MUST snapshot the exact schema and runtime-validate every non-null provider result through it before the value reaches guards or handlers. This applies to synchronous and asynchronous providers and to both plain values and `{ value, setCookies }` envelopes; envelope cookies keep their independently snapshotted forwarding semantics. The validated session is an owned framework value, so undeclared properties, inherited/accessor fields, Proxies, and later provider-object mutation cannot create session authority. TypeScript assignability remains an author-time guardrail, not the proof. A provider returning `null` or `undefined` means "anonymous"; guard combinators must treat that as unauthenticated rather than as a malformed request.

Route and query guard failures have fixed outcomes so auth remains part of the typed surface. `authed` failures run the app's `onUnauthenticated` handler, whose default is a 303 redirect to the configured login route with the original URL available as `next`. `next` is framework-validated: it MUST be a same-origin, single-leading-slash absolute path (no `//`, no scheme, no host) that resolves against the route table (§6.4); a value failing that check is stripped to a safe default. The framework re-validates `next` both where it is captured and again wherever it hands `next` to the post-login redirect, so app-authored login code cannot consume an open-redirect target. Authenticated-but-unauthorized failures render the app's 403 shell with status 403. Mutation guard failures distinguish **authentication** failure from **authorization/validation** failure. An _unauthenticated_ mutation guard failure (an `authed` guard failing because `req.session` is null/anonymous, §6.5 — e.g. a session that expired between page render and submit) is a distinct outcome from a validation or app-`fail()` error (§9.2): the enhanced path returns **HTTP 401** with a `Kovo-Reauth` directive carrying the login route and a same-origin `next` (the original document URL), which the loader follows to re-authenticate exactly as a page route would for the same expired session; the no-JS path returns a **303** redirect to the configured login route with `next`, mirroring the route/query `onUnauthenticated` contract. An _authenticated-but-unauthorized_ mutation guard failure (a `role()`/ownership refinement failing on a valid session) keeps the §9.2 typed-error path — **HTTP 403** with `forms.<mutation>.failure` carrying an `unauthorized` code — and introduces no redirect body. Only the unauthenticated case crosses into the auth-redirect vocabulary; this prevents a routine session-expiry on submit from surfacing as a generic validation-style error with no path to re-auth.

### 6.6 Soundness boundary (normative)

The §1.2 proof claims are claims about TypeScript programs that stay inside the sound subset. The starter therefore ships — and the docs state as a precondition — `strict` everything plus lint bans on `any`, non-null assertions, and `as` casts in app code. Three boundaries are runtime-validated regardless, by design: the **wire** (every mutation input passes its `s.*` schema — types-without-validators, raw-tRPC style, was rejected); **deploy skew** (a long-lived document POSTing yesterday's form shape is answered by schema validation and the 422 path, §9.2 — never undefined behavior); and **CSRF** — `kovo-csrf` (§9.1) is a synchronizer token stamped into every emitted form and verified before schema parsing, replay lookup, and the guard chain on every mutation POST. When `req.session` is present the token is bound to it; when it is null/anonymous (§6.5) the token is bound instead to a **framework-owned signed-cookie secret** that exists independent of `sessionProvider`, so pre-auth forms (login, signup, password reset) are CSRF-protected even with no session to bind to — anonymous-CSRF is mandatory, not optional. `CsrfOptions.sessionId` MUST return a stable opaque 1..1,024-character rotation id for a framework-resolved session and `undefined` only for a genuinely anonymous request; non-string, missing, empty, oversized, anonymous-with-id, and unresolved-session results fail closed. The rotation id has no reserved textual spellings: exact length framing and a separate kind frame distinguish even `anonymous`-shaped session text from an anonymous cookie. The signing payload domain-separates that session/anonymous kind and, for a framework lifecycle request, both the rotation id and the independently pinned authorization principal, so a shared or namespace-shaped app id cannot cross-bind two principals. On a successful authenticating submit the framework rotates the anonymous token's binding to the new principal; apps should rotate their own session identity on auth (Kovo does not own session identity, §6.5). CSRF is default-on for server-rendered mutation endpoints; an explicit `csrf: false` is the only per-mutation opt-out and is reserved for non-browser or externally authenticated endpoints. A `csrf: false` mutation MUST NOT use browser authority: it is compile error **KV418** for such a mutation to read `req.session`, `Cookie`, `Authorization`, or `Proxy-Authorization`; escape an unproven request carrier; run a session/cookie-derived guard (e.g. `authed`, `role()`, `owns()`); or call a browser-state response sink (`setCookie`, `forwardSetCookie`, or `setSessionRevocationClearSiteData`). Skipping CSRF while riding the victim's ambient credential is forgeable, and minting an attacker session or clearing victim storage is login/logout CSRF even when the handler never reads ambient state. The exemption is sound only by construction: a `csrf: false` mutation is served with no ambient session/browser credential headers and cannot emit `Set-Cookie` or `Clear-Site-Data`. Machine callers use an explicit non-ambient custom signature header; browser credential flows keep the anonymous synchronizer token. Raw endpoints may separately declare executable verifier auth. Truly non-browser writes belong in `endpoint()`/`webhook()`. Every mutation's CSRF posture (`checked` or `exempt:<justification>`) is listed in `kovo explain endpoints` (§11.4) alongside endpoints and webhooks. The `Kovo-Idem` replay token (§9.1) is a per-submit, high-entropy value minted fresh by the client on each logical submit and refreshed in the enhanced success response (§10.3) — a freshly stamped hidden field, never a form-instance constant — so re-editing and re-submitting a form is a new mutation rather than a silent replay of the first response. Deploy skew also covers handler modules, normatively: emitted module URLs are immutable and versioned, and the serving layer retains prior versions — an old document's `on:*` refs keep resolving after a deploy; first interaction on a still-open tab never 404s. Generated ABI subpaths (for example `@kovojs/browser/generated`) may change when the compiler and runtime ship together because app source regenerates those imports, but already-emitted immutable modules remain governed by the same versioned-module retention rule: old generated modules must keep resolving to the runtime symbols they were emitted against for the supported deploy-skew window.

When replay storage is configured, a `csrf: false` mutation MUST declare
`machineReplayPrincipal(request)`. Kovo invokes it exactly once per request, only after
parse/coerce and the guard/access decision succeed, against the pinned post-guard request. It MUST
return a primitive non-empty string of at most 1,024 JavaScript code units. Missing declarations,
throws/rejections, wrappers, and malformed values collapse to the sanitized 422 idempotency
conflict before replay-store or handler authority. A CSRF-protected mutation MUST reject this
machine-only declaration. The returned public caller/tenant id is canonically length-framed under a
versioned domain and committed by applying the boot-pinned SHA-256 control to the exact UTF-16LE
encoding of every JavaScript code unit before it enters replay scope. The encoding MUST preserve
lone surrogates rather than replacing them with U+FFFD; the raw value MUST NOT enter replay keys,
store metadata, errors, or diagnostics. Enhanced and no-JavaScript delivery share this scope. A
retry that changes response vocabulary conflicts under the existing claim and MUST NOT execute the
handler again.

**Persistent principal revocation epochs (normative).** A `PrincipalEpochStore` is the authoritative
identity-lifecycle capability for one persistent, monotone `{ epoch, changedAtMs, status }` row per
proven principal, independent of any session. `initialize(principal)` atomically creates active
epoch 1 or returns the existing row without changing it; it never reactivates a tombstone.
`advance(principal, reason)` and `tombstone(principal, reason)` accept only the finite reason unions
exported by Kovo and MUST increase both epoch and change time. Tombstones are permanent. Better
Auth bindings supplied this store initialize the row from the provider's sanitized authenticated
user id before the session reaches app code. Other identity providers MUST initialize at account
creation or authenticated resolution and call `advancePrincipalEpoch`/`tombstonePrincipalEpoch`
for password, role, tenant, administrative, provider-revocation, and deletion events, including
out-of-band changes.

Every persistent credential derived from a principal MUST carry the current epoch at its mint door
and compare it with an authoritative current row at every release door. Kovo's closed census owns
the capability-URL mint and verify doors plus mutation replay-receipt reservation, response
release, handler admission, in-transaction completion, and settlement doors. The
`exactly-once-continuation` callback is explicitly inapplicable: it is
closed before its adapter frame returns and never becomes a durable credential. Missing,
malformed, unavailable, timed-out, contradictory, stale, or tombstoned state fails closed. The
default has no positive application cache; each lookup has a 1,000 ms ceiling, so there is zero
successful-lookup staleness beyond the one authoritative read/action race. Expiry remains a second
floor and is never freshness evidence. Production accepts only the module-private durable store
provenance exposed by `createPostgresAppRuntimeDb().principalEpochStore`; structural fields or a
global symbol cannot forge that provenance. §10.3 defines replay scoping and the explicit mutation
transition declaration.

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
already-present anonymous cookie can remain valid only from the exact supplied credential carrier;
they do not inherit canonical response authority from a settled ambient frame. An authored raw
stream therefore must retain and use its exact handler `Request` when it needs the response receipt;
a reconstructed or otherwise derived request after owner settlement cannot recover that receipt.
CSRF validation and replay resolution always use the exact supplied ingress request and never
inherit response-generation authority.

Every deployable `AsyncLocalStorage` authority cell is governed by the versioned
`kovo.async-context-confinement/v1` census and one framework-owned confinement contract. Cells stay
separate and least-authority; the contract does not merge request, response, provenance, egress,
build, credential, or module-load values into one ambient bag. A cell is an opaque exact identity
whose storage remains module-private. Each store is bound to an exact framework lifecycle witness
and generation. A read exposes a value only when the cell, current lifecycle, and open-generation
identities all match; missing, inherited-foreign, forged, or stale state yields no authority and
never falls back to another ambient store. Entering a cell from a detached descendant of a closed
lifecycle fails. `createRequestHandler()` establishes a fresh authority-empty lifecycle before any
pre-dispatch callback; nested request cells share that exact lifecycle, while build evaluation,
generated-module loading, and cloud-credential access deliberately open isolated roots. The owner
closes its lifecycle on synchronous return, throw, asynchronous fulfillment, or rejection, so work
not awaited by the owner cannot retain or reacquire its cells. Exact retained response-lifecycle
receipts remain the separately specified identity bridge above and never turn an unrelated ambient
cell into authority. The sole framework-owned post-settlement re-entry is deferred-region JSX
rendering: `Defer` captures the same exact JSX context object that registered the region and runs its
success, rejection, and timeout rendering in a fresh isolated lifecycle containing only that cell.
Each captured re-entry capability is one-shot, and success, rejection, and timeout select one winner
before opening a fallback lifecycle. Timeout explicitly revokes an unfinished success lifecycle
before rendering the error fallback, so a never-settling or late-rejecting authored promise cannot
retain or re-mint even JSX authority. The exact retained request inside that context may resolve its
already-sealed response receipt;
sibling request, provenance, egress, credential, build, and module-load cells remain absent. Critical
and non-collected regions stay in their current owner lifecycle, authored raw streams receive no
ambient re-entry, and the census gate rejects any additional consumer of this finite bridge. The
`@kovojs/test` SQL observation carrier is a censused, non-deployable observer rather than app
authority; it retains its independent exact-scope revocation so observation can span the request
boundary without weakening runtime isolation.

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

**Security soundness (normative).** The Prime Principle (§2) rests on the same sound-subset discipline, bounded by six rules. (1) **The compiler performs no TypeScript type inference of its own** — security classification is carried by AST symbol-identity provenance, sink classification, and fail-closed runtime checks; a branded type (`Secret<T>`, a `public()` brand, and the like) is `tsc`-time ergonomics and defense-in-depth, never the enforcement. (2) **Runtime taint is unsound** — JS string operations and template literals produce fresh primitives with no surviving metadata, so request-derived provenance for confidentiality, write-eligibility, and input shape is proven _statically_ at the AST (where the path is still code), never by runtime value-tracking; runtime contributes only _sink validation_ (checking a final value's grammar, shape, or resolved IP, which survives transforms). (3) **By-construction and defense-in-depth are distinguished and labeled.** Where static analysis can prove the unsafe state inexpressible, the guarantee is by-construction (output-safety §5.2 rule 10, the confidentiality boundary, default-deny authorization, write-provenance). Where it cannot — outbound egress, a read-only-handle runtime proxy, Content-Security-Policy / Trusted Types, log redaction — the control is a fail-closed runtime floor: sound at its sink but bypassable by privileged same-process code, and it MUST be documented as defense-in-depth rather than a proof. (4) **Advanced TypeScript types are preferred when they narrow author mistakes without becoming the trust boundary.** Validated branded constructors are appropriate for strong signing material; module-private `unique symbol` brands are appropriate for framework-owned sentinels; branded escaped/trusted/rendered HTML values are appropriate for UI composition; exact header-bag and discriminated-union types are appropriate for preserving multi-value headers and explicit posture choices. Public structural brands, casts, and type-only assertions MUST NOT be accepted as security evidence unless a runtime constructor, AST/provenance gate, or fail-closed sink also enforces the invariant. (5) **Boundary decisions over caller-owned carriers must classify-and-pin or reconstruct.** Once a runtime boundary classifies, normalizes, or validates a caller-owned value, the sink MUST consume either an immutable framework-owned pinned carrier for that exact classified value or a reconstructed fixed output; the sink MUST NOT re-read mutable caller bytes after classification and still claim the earlier decision. Browser sinks MUST classify platform behavior that depends on a tuple of attributes from the same pinned element snapshot, not validate each string in isolation; hidden `_charset_` substitution is the canonical HTML example (§13.2). Spec §10.3 C15 names the concrete sink obligations. (6) **Authority-bearing controls have a framework-owned bootstrap trust root.** Every supported Kovo compiler, dev, build, export, generated-server, worker, and test runner MUST evaluate the framework security bootstrap before any authored app module, Vite/plugin module, generated module, or other caller-controlled dependency in that realm. The bootstrap eagerly captures the ambient bindings, prototypes, framework controls, and reviewed dependency objects used by later security decisions; ordinary late replacement of those captured controls can therefore affect only unused public bindings. This is not a claim that deliberately hostile same-realm code cannot instrument a dependency, discover a module-private object that was not reachable at bootstrap, and mutate that object later; that is privileged application compromise under the trusted application-code boundary below. A security claim that must remain independent of app code MUST run in a fresh process or genuinely isolated realm that never evaluates the app graph; in-process parser/control reconciliation is defense-in-depth only. Function source text, names/arity, native-looking descriptors, and finite positive/negative probe corpora are health diagnostics only and MUST NOT be accepted as provenance for a control captured after caller code ran. A host preload (`NODE_OPTIONS`, embedding code, loader hook, VM setup, or equivalent) that executes before the supported Kovo entry is privileged same-process host compromise and outside the app-level framework claim; a platform that cannot guarantee bootstrap order MUST move authority computation into a genuinely pristine isolate with a fail-closed typed RPC boundary. Tests for import-order mutation MUST enter through the same bootstrap-first runner and poison controls only after that boundary, including the first entropy/hash/command use rather than relying on second-use detection.

**Capability-bounded agent mediation and honesty (normative).** Kovo does not claim prompt-injection
immunity: an application that lets a model read adversarial text can still receive an
authorized-but-undesired decision. In the supported subset, a model-selected application action can
reach an effect only by naming a framework-owned `tool()` declaration. Each tool names one exact
compiler-visible mutation binding; the compiler derives its effect closure from the same finite L2
operation IR used for HTTP roots and installs that closure as generated runtime evidence. An opaque
model callback, dynamic tool collection, unresolved tool-to-mutation link, or model invocation with
raw authority is a KV448/KV449 build error, not a warning. The model receives frozen inert tool
descriptors and the exact framework `ctx.fetch` egress door, never an executable mutation, request,
database handle, or ambient principal.

A selected tool executes the exact mutation's input parser, access decision and guard chain,
managed-database SQL write policy, RLS principal pinning, and transaction path. The invocation
principal is an immutable framework session-provider snapshot established before the model runs;
structural request fields and caller-supplied service-principal overrides cannot establish agent
authority. Internal agent calls do not impersonate a browser form and therefore do not replay the
browser CSRF protocol, but they MUST NOT bypass the mutation's authorization or data-plane policy.

An agent session carries the closed integrity order
`untrusted < retrieved < validated < principal`. Every admitted content value is an exact immutable
`agentContent()` carrier with an explicit integrity, and every tool result is unconditionally
classified as `untrusted` or `retrieved`; no prose/content classifier participates. The session
updates by the lattice meet only, rejects concurrent turns, and filters the next offered tool set by
the compiler-derived minimum integrity of each tool's effect closure. Thus, once injected or
retrieved content is admitted below `principal`, it cannot raise the session's integrity or regain a
removed high-authority tool for the rest of that session. `kovo explain agent` MUST print the same
model effects, per-tool mutation/effect/minimum/result-integrity facts, and retained closure at every
integrity level that runtime enforcement consumes. This proves only that no model-selected action
exceeds the invoking principal and that admitted lower-integrity content cannot raise authority. It
does not prove that an authorized action was intended, that an app classified direct input honestly,
or that malicious prompts and retrieved content are harmless.

**Cryptographic authority and lifecycle (normative).** Raw secret-crypto acquisition is a capability,
not an authority-free implementation detail. The capability-closure vocabulary distinguishes
`crypto-acquisition` from `digest`. An exact named import of a reviewed non-keyed SHA-256 digest
primitive may classify as `digest`; a namespace/default crypto import, WebCrypto/global crypto,
entropy, keyed hashing, password hashing, signing, encryption, or an ambiguous import MUST classify
as `crypto-acquisition`. Either capability reached from an untrusted root closes with KV448 unless
the exact framework export is a reviewed door. Kovo's repository gate separately records every
remaining production direct acquisition by exact path, class, and operation. That high-authority
path set MUST be a non-increasing ratchet: adding or widening a row requires an explicit reviewed
architecture change, while deleting or narrowing one requires no compatibility mode.

`kovo.certificate/v1` MUST carry the exact same nine-member raw-capability domain:
`crypto-acquisition`, `database-driver`, `digest`, `dynamic-loader`, `filesystem`, `network`,
`process`, `vm`, and `worker`. Its search-side analyzer and disjoint checker MUST preserve the
binding-sensitive distinction between an exact reviewed digest import and broader crypto acquisition;
neither kind may be downgraded to an opaque external import or omitted from post-fixpoint closure.

The authority posture for that certificate belongs to a distinct, canonical
`kovo.certificate-policy/v1` reviewer policy. The policy MUST own the exact sorted
`{path, sha512}` set of packed `@kovojs/*/dist/*.mjs` modules, the complete installed manifest for
every package in scope, and the complete roots, doors, and opaque-assumption rows. The certificate
MUST contain only the corresponding sorted artifact paths, the fixed capability domain, capability
summaries, import edges, exact copies of the policy's roots/doors/opaque rows, and `policySha512`
computed over the exact canonical policy bytes. A checker MUST require exact equality for every
copied posture row and artifact path before checking coverage, stability, or closure. The policy is
an independently obtained review decision: a copy emitted beside an application build is an audit
convenience only and MUST NOT become a trust root. Fetching policy, certificate, and artifacts from
one mutable location does not establish independent review. A detached signature over a certificate
authenticates only those certificate bytes and MUST NOT substitute for obtaining and reviewing the
policy bytes named by `policySha512`.

The standalone directory checker MUST derive the actual `@kovojs/*` package census from the supplied
packed tree and require it to equal the policy package census. It MUST compare each installed
`package.json` as a complete JSON object with the reviewer-owned manifest, reject `publishConfig` and
`browser` remapping, and reject every non-empty automatic package-manager lifecycle hook named
`dependencies`, `install`, `postinstall`, `preinstall`, `prepack`, `postpack`, `prepare`,
`preprepare`, `postprepare`, `prepublish`, or `prepublishOnly`. Every non-types conditional export,
fallback, `main`, `module`, or `bin` arm MUST collapse to one canonical listed runtime target.
Package `imports` aliases MUST be exact non-wildcard `#name` keys whose non-types arms collapse to
one canonical relative target; any alias used by packed runtime code MUST resolve to a listed packed
module. Source-only aliases are inert only when the complete packed-tree census proves the source
files are absent.

The packed-tree census MUST admit only regular, non-symlink files: the installed manifest, canonical
`.mjs` runtime modules below `dist/`, reviewed declaration/source-map companions below `dist/`, and
the package README. Root or `dist/` JavaScript with any other suffix, extensionless executable
files, JSON runtime payloads, native addons, WASM, special files, unexpected documentation, and
unreviewed siblings fail coverage. Certificate and policy input files and every manifest/runtime
module MUST be read through a no-follow descriptor after path and descriptor identity agree; the
checker MUST read through a fixed maximum-plus-one buffer rather than an EOF-growing convenience
read, compare size and file identity before and after that same-descriptor read, bind each read to the
initial file/directory census, and repeat the complete census after verification. An added, removed,
replaced, grown, or otherwise mutated file or directory at any of those boundaries fails closed.

The v1 checker budgets are part of the denial-of-service boundary: policy bytes are at most 1 MiB,
CLI certificate bytes at most 2 MiB, one runtime module at most 4 MiB, all runtime modules together
at most 32 MiB, the policy may name at most 32 packages, the packed tree at most 4,096 files and
depth 16, and certificate plus policy JSON together at most 262,144 nodes and depth 64. After parsing
each complete runtime module, reference extraction may consume at most 32,768 reference units for
that module and 131,072 across the packed tree. Each import, re-export, or dynamic-import occurrence
costs one unit, plus one unit for each raw imported or re-exported binding it names; an export-all or
dynamic-import occurrence also costs one wildcard-target unit. Deduplication MUST NOT reduce the
charged units. Artifact analysis may retain at most 1,024 findings. Exceeding a
reference or artifact-analysis finding limit MUST discard every partial graph, summary, and finding
and return exactly one fixed fail-closed budget finding; a syntax error beyond the extraction limit
MUST still be observed because complete parsing precedes extraction. The checker MUST snapshot
caller-owned JSON and policy bytes once before validation and MUST NOT re-read them after making a
decision.

The published `@kovojs/verify` package is the runtime-independent front door to this checker. Its
human-public root MUST retain the certificate family as one coherent 11-declaration surface:
`KOVO_CERTIFICATE_CAPABILITY_DOMAIN`, `KovoCertificateCapabilityKind`,
`KovoCertificateRootKind`, `KovoCertificateV1`, `KovoCertificatePolicyV1`,
`KovoCertificateFinding`, `KovoCertificateArtifactSource`,
`KovoCertificateVerificationResult`, `verifyCertificate`, `verifyCertificateDirectory`, and
`formatCertificateVerification`. The packed package MUST bundle its reviewed parser bytes and MUST
have no production dependency on a Kovo compiler, analyzer, server, or runtime package.

The package bin is `kovo-verify`. `-h`, `--help`, and `--version` MUST write to stdout and exit 0.
The verification grammar is one certificate path plus the required `--policy <path>` and
`--artifacts <root>` flag groups and optional `--format <human|json>`; those groups may appear in
any order. A completed verification with no findings exits 0. A completed verification with one or
more certificate findings exits 1. Invalid/ambiguous usage, duplicate or unknown options, file I/O,
text decoding, and JSON parsing failures are indeterminate rather than certificate findings and
MUST write to stderr and exit 2. Human reports remain `kovo-verify/v1`. JSON reports MUST carry
schema `kovo.verify-report/v1`, status, `ok`, the same stats, and the exact same ordered
`{obligation, code, message}` findings as the human report. A JSON-mode indeterminate error uses
`kovo.verify-command-error/v1`; it MUST NOT be shaped like a completed verification report.

Every non-dry release from the authorized `main` commit MUST publish separate GitHub artifact
attestations for the exact committed reviewer-policy and certificate files. The attestation job MUST
perform no dependency installation or repository script execution, and dry runs MUST receive no
attestation or OIDC authority. Consumers MUST verify those attestations against the intended release
workflow and commit, or obtain the exact policy bytes through another independently authenticated
channel; the committed SHA-512 joins evidence but does not create that channel.

Certificate doors remain coarse module-plus-capability approvals. Their `site` field is a reviewer
label, not a source-location proof. The checker re-derives lexical import edges and the modeled raw
capability vocabulary, but it does not prove the behavior of host globals, `eval`, `new Function`,
computed runtime loading, or every native/WASM execution route beyond explicit rejection and the
reviewed opaque ledger. Those residual limitations remain honesty obligations under §4.6 and the
trusted application-code boundary below.

The server runtime has one primitive-owning crypto authority. It captures its Node crypto and byte
controls during the bootstrap-before-app boundary and runs known-answer checks for RFC 5869
HKDF-SHA256, HMAC-SHA256, fixed-width equality, and AES-256-GCM before serving. It MUST NOT expose a
generic signer, sealer, primitive table, or derived key. Each consumer receives an exact
framework-witnessed frozen handle containing only the operations for one registered purpose. The
environment-neutral webhook verifier uses the corresponding core-realm WebCrypto authority because
core cannot import the Node server runtime; that authority is verify-only, boot-captured, and keeps
provider signing material out of public verifier metadata. Types and private brands are ergonomics;
the runtime witness, closed registry, and acquisition gates are the enforcement.

The runtime-posture Ed25519 trust anchor also verifies detached privileged-write reviews from
§10.3 and detached Metric E escape-root reviews from §11. An escape-review signature is
domain-separated by the exact
`kovo.escape-obligation-review/v1` subject and binds one scanner-owned call-span identity, one
structured obligation, and one reviewed artifact subject. This reuses the runtime-attestation
fingerprint; a second review root is forbidden. A Metric E signature is separately domain-separated
by `kovo.escape-census-review/v1` and binds the exact reviewed artifact, closed door, counted root,
and complete canonical producer-site set. Build emits only unsigned subjects, and its import graph
plus the app-facing/internal execution surface expose verification but no signing handle.
Signing authority belongs to the out-of-band review/deployment process and is absent from the build
environment and coding-agent capability set. A valid signature is evidence that the pinned key
holder approved those exact bytes. It is not evidence that the asserted guard or policy exists,
that the cited evidence is sufficient, or that a human reviewer was independent; those are retained
operational obligations.

The closed registry is `kovo-crypto-purpose-registry/v1`. Every framework derivation is
HKDF-SHA256 over its root with public salt `kovo-crypto-authority-v1`. Its fixed-width info is the
SHA-256 commitment of the injective, length-framed tuple
`(registry-version, purpose, audience, algorithm)`; no bounded audience bytes are truncated to meet
provider-specific HKDF info limits. A row fixes the literal purpose, algorithm, allowed operation
set, root source, and bounded audience grammar. An absent,
dynamic, malformed, algorithm-mismatched, or operation-mismatched row fails before derivation.
HMAC-SHA256 is the v1 symmetric signature/PRF algorithm; SHA-256 is the v1 non-keyed digest;
AES-256-GCM with a fresh 96-bit IV and 128-bit tag is the v1 confidential-at-rest algorithm. A
provider-owned webhook HMAC is verified with the provider's raw protocol key through a verify-only
handle and is not HKDF-derived, because changing that key would break the external wire protocol.

Framework key rings are opaque configuration carriers, not generic signing objects. Exactly one
entry is `active`; `previous` entries require a finite `acceptUntil` epoch-millisecond deadline;
`revoked` entries carry no usable secret. New signatures and seals use only the active key.
Verification and opening may use the active key or a previous key strictly before its deadline;
unknown, expired, and revoked ids fail closed. On expiry/revocation the authority overwrites its own
retained Buffer copy on a best-effort basis. This is memory hygiene, not a JavaScript zeroization
guarantee: caller strings/buffers, VM and native-library copies, allocator snapshots, crash dumps,
and keys already copied into a crypto implementation can remain.

The confidential-at-rest envelope is unconditionally
`kovo-aes256gcm-v2.<key-id>.<iv-base64url>.<tag-base64url>.<ciphertext-base64url>`; v1 has no
compatibility fallback. The key id is chosen by the active ring, never by the caller. The authority
derives the key for registered purpose `confidential-at-rest` and the bounded declared string
audience, then authenticates the exact envelope version, key id, purpose, audience, and caller AAD
as one length-framed AES-GCM AAD value. Opening performs a bounded canonical parse, selects only an
eligible ring key by the authenticated id, and authenticates before returning plaintext. Tampered
version, id, IV, tag, ciphertext, audience, or AAD; an unknown/revoked/expired key; and a raw-key
call shape all fail closed.

**Trusted application-code boundary (normative).** Kovo does not sandbox app-authored server modules or third-party packages that execute in the server realm. The public-import and provenance rules in §5.2 prevent unsupported or accidental authority use inside the supported authoring subset; they are not a claim that deliberately hostile same-realm code cannot recover ambient JavaScript authority through `Function`, dynamic loading, reflection, native addons, or equivalent language/host facilities. Such code is privileged application compromise, not a remote-input framework boundary. Deployments that execute mutually untrusted plugins or generated server code MUST place that code in a separate process or genuinely isolated realm and expose only a fail-closed typed RPC capability surface. Finite syntax deny-lists and intrinsic pinning may remain defense-in-depth, but MUST NOT be described or tested as a sandbox proof.

**Capability-closed untrusted roots (normative, supported-subset static gate).** Before evaluating
authored app modules, `kovo build` MUST scan the immutable app-source snapshot and census every
proved `defineKovo()` contract and its single `assemble()` closure (including lifecycle callbacks),
route, layout,
query, mutation, endpoint or low-level request adapter, webhook, durable or scheduled task,
serialized browser handler, and supported agent/tool callback as an untrusted-data root. For each
root, Kovo computes a transitive module/callback graph across eager imports, re-exports, local aliases
and wrappers, literal `import()`/`require()` edges, conditional local targets, and callbacks or
callback-bearing containers transferred through a local wrapper. A non-literal loader, unresolved
local target, or reachable raw filesystem, network, process, worker, VM/dynamic-loader, or
database-driver capability fails the pre-evaluation build gate with **KV448** and a root-to-terminal
provenance path. Reviewed
framework APIs are the only nodes that may terminate such a path as a capability door; app or
package metadata cannot mint a framework door.

A custom Node adapter is privileged host wiring, not request-handler code. Its entry module MUST
import `@kovojs/server/runtime-bootstrap` as its exact literal first side-effect import and MUST pass
one directly imported handler from a separate local module to `toNodeHandler()`. Capability closure
starts at that handler module, while the adapter entry retains only the host listener boundary.
Inlining `createRequestHandler(app)`, importing the handler before the bootstrap, or importing the
bootstrap from the handler graph is unsupported and fails closed with KV448. Generated runners own
the equivalent compiler-created separation and bootstrap order.

**TASK B layered routing (normative).** The pre-evaluation request/process check MUST consume the
capability-closure result, dependency manifest, finite-operation diagnostics, and normalized
semantic graphs derived from the same immutable source snapshot; running those analyzers beside an
unbound legacy pass is not sufficient. The internal `kovo-task-b-closure/v2` carrier repeats the
exact source census, capability root rows, and `kovo-app-dependency-capabilities/v1` manifest. It
also carries one immutable `kovo-task-b-finite-verdict/v1` snapshot taken at the compiler-result
boundary. That snapshot MUST retain every KV449, KV450, and KV452 diagnostic with its exact site,
start, length, message, and severity, and MUST bind the complete diagnostic census plus normalized
semantic-source carrier with a canonical SHA-256 digest. TASK B accepts only an empty diagnostic
census, an `accepted` status consistent with that census, and a digest recomputed over the exact
carrier it consumes. Omitting or substituting any diagnostic or semantic trace after the snapshot
fails KV424. This transport-integrity proof does not replace the independent compiler soundness
oracles and does not claim resistance to coherent same-realm forgery outside the trusted
application-code boundary above. TASK B
MUST reconstruct each enrolled `createApp`, endpoint, layout, mutation, query, route, task, and
webhook invocation from its independent parser view and require exactly one capability root at the
same module and call site plus the same root kind in that module's dependency-manifest entries. A
missing, duplicate, byte-mismatched, or differently rooted row fails KV424 with a stable
`root -> transfers -> sink -> closed verdict` trace; it never falls back to a syntax-only allow.

For endpoint, mutation, query, task, and webhook effect handlers, TASK B MUST additionally require
one exact `kovo-security-semantic-graph/v3` root whose factory call span, callable span, callback,
root identity, all-path verdict, helper summaries, and terminal inventory match the authored root.
A missing graph, closed trace, closed helper summary, unknown transfer, or terminal mismatch is
KV424 even when the residual analyzer would otherwise find no named sink. KV448 remains the primary
diagnostic for raw/module/package authority and KV449 remains the primary diagnostic for a finite-IR
operation that cannot lower; the KV424 correspondence check prevents either result from being
silently omitted between compiler phases. KV450 and KV452 are likewise authoritative closed
verdicts for scoped-key and derived-dataset provenance and MUST remain in the same finite verdict.
Existing request/process predicates may remain as a
conservative residual and independent C13 oracle until their exact root-and-terminal
correspondence is proved, but they MUST NOT discharge a missing L1/L2/L3 proof or mint an allow
verdict. The specialized Drizzle KV406/owner-predicate proof remains a separate data-plane
correspondence responsibility under §10.3 and §11.1.

Reachable package code requires a least-authority verdict for the exact installed package name,
version, security-relevant manifest fingerprint, requested subpath, imported export, and complete
conditional-export arm set. Every manifest-public Kovo runtime export and every public subpath's
`<module>` initializer MUST appear exactly once in the compiler-owned, versioned framework export
posture ledger with an explicit raw-authority disposition, root kind or `none`, security role,
implementation binding, manifest-target/condition fingerprint, and threat-matrix posture. A
posture that can produce an authority-free or framework-door verdict MUST bind the exact installed
implementation digest. A package whose complete public runtime surface is explicitly
`request-closed` MAY instead use the `unconditional-request-closure` binding: after the exact
installed package name, requested specifier/export status, reviewed version, and security-relevant
manifest fingerprint match, the compiler rejects that package without consulting implementation
identity. Such a binding is invalid if any public initializer or export is missing or has a
disposition other than `request-closed`; widening the package therefore restores the
exact-implementation requirement rather than inheriting a digest-free allow path. A new,
missing, duplicate, stale, or unclassified first-party export fails closed; absence from a shorter
door list is never an authority-free verdict. Compiler-emitted private ABI edges may bypass public
subpath membership only through one compiler-owned exact table that classifies the initializer and
every admitted member separately; that table is consulted only after the installed first-party
manifest fingerprint and implementation digest match. A vocabulary match alone cannot mint an
authority-free verdict. Explicitly reviewed framework companions use the same compiler-owned,
version-pinned verdict model. Other packages use the committed
`kovo.capabilities.json` `kovo-package-capability-summaries/v1` ledger, whose entries are versioned
independently and may classify exports only as pure or raw. A side-effect-only import is the reserved
`<module>` entry. Every package import, including a named, default, or namespace import, evaluates
that initializer and MUST consume one exact `<module>` verdict in addition to every requested export;
an export wildcard cannot stand in for the initializer. An absent, stale, duplicate,
contradictory, malformed, export-incomplete, condition-incomplete, or unresolved verdict fails
closed with KV448. `kovo explain capabilities` prints the root census, reviewed doors, exact
package-summary versions/fingerprints, and every closed fact with the same provenance used by the
diagnostic. This is a conservative proof about accidental authority in Kovo's supported static
authoring subset; consistent with the trusted application-code boundary above, it is not a
same-realm JavaScript sandbox or a claim about deliberately hostile dependencies.

`@kovojs/compiler` is a deliberate zero-public-surface instance of unconditional request closure.
It has no app-facing public runtime subpath, so an authored or request-reachable import of its exact
package name or any subpath is rejected before installed resolution, version, manifest fingerprint,
or implementation digest is consulted. The analyzer executable that makes this decision is a
trusted release/install subject: its bytes are authenticated externally by verified release-tarball
provenance, package-manager integrity, a certificate, or equivalent host provenance. The analyzer
does not and cannot self-authenticate by comparing its running bytes with a digest embedded in
those same bytes.
Accordingly, this app-level proof does not detect arbitrary post-install mutation of the analyzer;
such mutation is release/install or privileged-host compromise, outside the application-level
claim. If the compiler ever gains an app-public runtime subpath, the zero-public closure is invalid
and the posture gate fails until that surface receives an explicit non-circular classification.

For every authored or compiler-derived package edge, including an initializer in a malformed or
currently rootless module, the compiler MUST also derive one
`kovo-app-dependency-capabilities/v1` loader manifest row containing the exact installed identity,
specifier and conditional-export arms, retained export dispositions/capabilities, exact importer
and sites, and the reachable root kinds. A loader-census-only row uses an explicit empty
`rootKinds` array; that row does not invent a request root or explain fact, but its package
initializer still cannot execute by omission. Every supported production Vite path that loads or
bundles an approved app source MUST re-resolve that exact package identity before admitting its bare
import and reject an absent/duplicate or malformed row, identity drift, a closed package row, or a
retained `raw` or `request-closed` export. Pre-evaluation SSR MUST force complete dependency
traversal and parse every admitted third-party module before execution; every bare child edge,
including a Node builtin, and every non-literal module edge fails closed before Vite can externalize
it. A relative child edge from a reviewed package MUST retain that package's exact nearest owning
package root; physical containment does not admit a nested `package.json` or `node_modules` package
identity, including one reached through a symlink or package-main redirect. Application aliases MUST
NOT match a reviewed package child edge, and reviewed dependencies require Kovo's fixed Vite
extension-resolution order; same-root retargeting invalidates the reviewed summary just as an escape
does. Every direct reviewed export and resolved relative child MUST have one exact case-sensitive
JavaScript/TypeScript module suffix — `.cjs`, `.cts`, `.js`, `.jsx`, `.mjs`, `.mts`, `.ts`, or
`.tsx` — in both its lexical resolver identity and canonical realpath. Extensionless modules, JSON,
CSS, SVG/HTML, WASM/native modules, and image/font/media resources remain closed until a separate
pinned semantic and provenance lane admits them; Vite cannot reinterpret reviewed bytes as an
asset, stylesheet, executable document, or worker payload. Query/fragment variants fail closed at
the pre-evaluation module-edge census. Direct `Worker`/`SharedWorker` construction, dynamic-code or
timer-handler recovery, and every retained `new URL(..., import.meta.url)` executable-asset carrier
from a reviewed package MUST fail closed in the complete build-client artifact before that artifact
can be published or executed. Vite MAY transform or stage bytes during an ultimately rejected build;
tree-shaken source that is absent from the retained artifact creates no executable secondary graph.
This retained-artifact rule does not weaken the earlier pre-evaluation package/module-edge census. An
external module edge from a loaded HTML entry MUST resolve to the immutable approved-source
snapshot or one exact framework-owned Vite bootstrap virtual; inline HTML module proxies remain
outside the supported source graph. Before Vite resolution, Kovo MUST parse raw HTML with one
exact-pinned standards-compatible parser in both the build tool's scripting-disabled state and the
browser's ordinary scripting-enabled state. Every script source must be an exact HTML-namespace
module URL in the immutable approved-source snapshot; inline scripts other than explicit JSON data
blocks, foreign-namespace scripts, raw `on*` event attributes, JavaScript URL attributes, SVG SMIL
execution primitives, and any `iframe`/`frame`/`frameset`/`object`/`embed` carrier fail closed with
KV448. Raw element controls consume §4.8's finite static-value policy, including target-keyword,
no-opener, and `meta[http-equiv=refresh]` automatic-navigation rules. Raw `<base href>` and
`<base target>` also fail closed because they can retarget emitted modules or later navigation at
browser consumption. Public-asset shadows, `vite-ignore`, browser-only module-type spellings, and
post-resolution aliases cannot weaken the same approved-file binding. An exact
framework host-tool external is permitted only when no
app dependency manifest row overlaps that package or subpath. Artifact checks distinguish
bundle-owned chunk filenames from true unresolved externals without weakening the earlier source
and module-graph checks: only a relative runtime specifier normalized from its importing chunk may
bind a bundle-owned file, while Rollup file-name metadata is checked separately and cannot bless a
bare runtime specifier. Retained non-literal module edges fail closed. Relative artifact specifiers
with percent encoding, query/fragment syntax, backslashes, ASCII whitespace/control bytes, or empty
path segments fail closed before ownership comparison because browser/Node URL resolution can map
those spellings to a different file. Only `OutputChunk` names — never `OutputAsset` names — satisfy
executable bundle ownership. The same manifest is emitted in `graph.json`; an explicit empty manifest
means the compiler proved that the app graph has no dependency edge. This loader check turns the
pre-evaluation census into a fail-closed runtime/build bound for supported production artifacts, but
it is defense-in-depth under rule (3): it does not sandbox deliberately hostile same-realm package
code or prevent privileged host loaders from bypassing Kovo.

Supported browser event handlers MUST be authored as TSX/JSX event attributes and lowered through
the compiler-owned finite browser operation vocabulary. App-authored imperative registration — an
`on*` property write, `addEventListener`, or an equivalent opaque protocol/call transfer — is outside
the supported subset and MUST fail closed with KV424 before authored modules are evaluated. That
verdict is rooted in the registration's reachable authority, not in a deny-list of names found in
the callback body; adding or renaming a dangerous browser API therefore cannot reopen the raw
registration path. Compiler-owned JSX handlers remain governed by KV449 and the finite operation IR.

**Compiler-derived browser response posture (normative).** Supported build and dev runners MUST
derive one `kovo-browser-posture/v1` manifest from the immutable project source snapshot and
register its reconstructed generated carrier before authored app evaluation. The compiler census
uses the final effective intrinsic element/attribute tuple after static spread and primitive
composition lowering. It records canonical absolute HTTP(S) origins, CSP directive, file, and
source span for `script[src]`, sandboxed `iframe[src]`, `img[src|srcset]`, SVG
`image[href|xlink:href]` and `feImage[href|xlink:href]`, `audio[src]`, `video[src|poster]`,
`source[src|srcset]`, `track[src]`, `input[type=image][src]`, and fetch-bearing `link[href]` relations
(`stylesheet`, `modulepreload`, icons, and typed preloads). Relative/path-only and fragment URLs
remain same-origin and add no origin. A computed URL at one of those positions is KV236 unless it
is the exact framework `trustedUrl(value, { reason: auditedReason, source? })` call with a non-empty
static reason. That
escape is recorded as opaque audit evidence; it does not invent an origin or establish isolation.
A computed `link[rel]`, opaque spread that could introduce an asset position, unclassifiable
external URL, raw browser fetch/worker authority, frame, or popup likewise prevents a positive
isolation verdict. Local spelling, structural copies, missing reasons, and self-consistent manifest
fields cannot mint compiler provenance.

Framework-rendered page hints are re-witnessed at the document sink. An absolute HTTP(S)
stylesheet, modulepreload, or bootstrap-script hint prevents the optional isolation posture because
the compiler cannot establish the remote response's CORP/CORS behavior; build-generated
same-origin hint paths remain eligible.

Document CSP assembly consumes that registered manifest. Census origins are admitted only to their
derived fetch directive. An authored `CspAllowlist` string MUST be a canonical origin already in
the same directive's census; a non-static origin requires the structured `{ origin, rationale }`
escape with a non-empty audited rationale. An unused unmatched string is a build/check error, not a
silent widening. The manifest and authored config are snapshotted from stable own data before use,
and generated registry reconstruction rejects unknown kinds, malformed spans, noncanonical origins,
accessors, sparse arrays, and schema drift.

`Permissions-Policy` has exactly one response assembler with one exhaustive decision for every
`BrowserSecurityOperationKind`; adding an operation without a decision fails the build. Both normal
and reporting header bytes come from that assembler. The default document posture remains
`Cross-Origin-Opener-Policy: same-origin-allow-popups` and makes no cross-origin-isolation claim.
`document.csp.crossOriginIsolation: true` is accepted only with the exact generated manifest and no
external or opaque resource, dynamic/opaque browser call, frame, popup, or authored origin whose
CORP/CORS behavior is unproved. The isolated response is exact: COOP `same-origin`, COEP
`require-corp`, and document CORP `same-origin`, plus the derived CSP and Permissions Policy. A
route response cannot replace or weaken those selected headers. Missing or contradictory evidence
fails before a deployable artifact or document response; Kovo never silently weakens isolation to
preserve OAuth, popup, embed, or third-party-resource compatibility.

**Finite operation closure (normative, supported-subset static gate).** Capability closure answers
which code and reviewed doors are reachable; the finite security-operation IR answers which
security-relevant effects a supported handler can perform. Its browser vocabulary is closed in
§4.3. Its structured-server vocabulary is exactly: principal-scope acquisition; managed database
read/write; justified trusted SQL; framework egress; justified trusted HTML; cookie/header/outcome,
raw-response, and redirect response effects; storage read/write; task composition; plus the
typed `server.data.declassify` effect; plus the compiler-control records `server.handler.root` and
`server.helper.call`. The root record enrolls each
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

**Typed declassification door (normative).** A secret or untrusted value may be unboxed only with an
exact nominal `DeclassifyPolicy` constructed by the door-specific static constructor exported from
`@kovojs/core/security`: `forRevealSecret({ purpose, ownerScope })`,
`forSecretValue({ purpose, ownerScope })`, `forTrustedReveal({ ownerScope })`,
`forRevealUntrusted({ ownerScope })`, or `forUntrustedValue({ ownerScope })`. There is no generic
public constructor that accepts a caller-selected door. The policy vocabulary is closed.
`ownerScope` is one of `application`, `current-principal`, `current-tenant`, or `framework`.
`forTrustedReveal` fixes purpose to `public-projection`; the two untrusted-value constructors fix it
to `request-validation`; and the two secret-value constructors accept only `credential-use` or
`server-computation`. Free-form strings, structural object literals, copied fields, casts,
subclasses, surplus fields, an unknown tuple, or a policy created for another door MUST NOT
authorize release. TypeScript's nominal shape is an author-time guardrail; the module-private
constructor token, exact runtime registry membership, closed option validation, and exact-door
check own the runtime floor.

The finite compiler IR admits `trustedReveal` as `server.data.declassify` only for exact direct
named imports of `trustedReveal` and `DeclassifyPolicy` from `@kovojs/core/security` and the inline
exact spelling `DeclassifyPolicy.forTrustedReveal({ ownerScope: <closed literal> })`. The released
expression and every finite enclosing enabling condition MUST both have integrity strictly above
request input.
If either is request-derived, foreign executable, unresolved, or otherwise unknown, the operation
MUST fail closed with KV449; an attacker-chosen condition may not select release of an otherwise
constant secret. This is a robustness judgment over the existing normalized provenance relation,
not a claim to interpret general JavaScript. Independently, declassification is an L1 capability:
`DeclassifyPolicy`, `revealSecret`, `revealUntrusted`, and `trustedReveal` are request-closed public
exports. A module reachable from any untrusted-data root, including through a transitive helper or
re-export, MUST fail capability closure with KV448 if it imports the constructor or a reveal door.
Closing policy construction also closes `.reveal(policy)` use without prohibiting creation of a
poison box. A module with no such root does not gain a trusted root merely by importing the door.

This layer deliberately does not claim general JavaScript interpretation or same-realm isolation.
The emitted operation lists are immutable, inspectable audit evidence consumed by component graphs
and `kovo explain`; they are not an opcode sandbox and do not replace the actual C9 sink checks.
For an app-scoped declaration, the factory root includes the receiver proof from §6.2.1. The
compiler follows ordinary immutable local import/re-export aliases back to the exact
`defineKovo()` result and binds the declaration to that contract's one `assemble()` closure before
authored evaluation. A destructured factory, computed property, wrapper result, structural copy,
cast, mutable or ambiguous alias, duplicate package identity, or declaration omitted from assembly
is an unresolved root. The facade cannot make a same-named callback or structurally similar object
trusted; successful receiver proof only enrolls the existing finite root analysis below.

Every supported factory root MUST resolve from an inline definition object to either an inline
function or one exact immutable same-file function. Definition spreads/computed root keys, missing
roots, imported/aliased/reassigned roots, and dynamic definition carriers are KV449. This includes
`query({ load })`: query roots appear in the emitted manifest even when the loader is effect-free,
and a directly reached managed DB write from a query remains KV449. Value-flow beyond the closed
alias/receiver and explicit local-call-edge rules above belongs only to the normalized abstract
interpreter defined next; the edge preserves that obligation rather than guessing its downstream
verdict.

**Normalized helper provenance (normative, narrow abstract interpreter).** The compiler MUST
discharge every `server.helper.call` over `kovo-security-semantic-graph/v3`, a normalized graph whose
nodes are enrolled handler roots, exact same-file callables, finite operations, and explicit closed
verdicts. This is not a JavaScript evaluator, SSA optimizer, or type-inference engine. Its complete
value lattice is: plain local data; request/context authority; managed database, structured-header,
storage, response-constructor, response-outcome, principal-scope, and exact module-constant
`derived()` dataset authority; one exact `operation:<securityOperationKind>` terminal;
non-authority `governed-data` carried by managed database and derived-dataset reads; and absorbing
unknown authority. `governed-data` survives reviewed calls, static member projection, containers,
aliases, destructuring, binary/conditional joins, and same-file helper arguments so a persistent
non-engine sink cannot erase owner/governed provenance merely by reshaping a value. The scanner is
the only raw-syntax boundary; validation, emission, graph, and explain consumers decide from these
typed facts (SPEC §5.2 rule 10).

Version 3 is unconditional; consumers MUST reject versions 1 and 2 rather than enter a compatibility
posture. Every semantic root carries an exact binding to its full root identity, factory family,
callback name, factory-call `[start,end)` span, and callback-callable `[start,end)` span in the same
UTF-16 source snapshot. Every proved terminal additionally carries the SHA-256 hash of the exact
UTF-16LE source slice selected by its JavaScript code-unit `[start,end)` span. Every helper transfer
carries its exact invocation and ordered argument
spans, callable name and declaration span, complete ordered root-to-helper transfer prefix, authority-input vector,
terminal-operation inventory, and verdict. A consumer may admit a helper summary only when an exact
invocation fact has the same callable identity and span, authority-input vector, terminal inventory,
and verdict; the invocation span and root binding must also match the authored call and root being
classified. The terminal inventory MUST equal the unique finite sink kinds reached by proved traces
under that complete transfer prefix. A downstream consumer MUST independently reconstruct the exact
root, argument authority, and every terminal-operation family on which its own admission decision
depends; self-consistent carrier fields are not authentication. A consumer-specific gate MAY project
the complete graph onto only the terminal families it owns, but unverified families confer no
authority in that gate. A missing or contradictory relevant fact, a root/trace identity mismatch, an
omitted or extra relevant terminal kind, a closed trace, or a closed sibling summary/invocation for
the same callable span closes that consumer proof. Source bytes, callable identity, and all-path
closure remain mandatory; these carrier checks do not turn semantic facts into app-authored
authority.

Transfer semantics are finite. An exact immutable alias preserves its lattice value. Static object
destructuring applies the reviewed member transition one property at a time. Results of finite
operations are plain data, except the explicit principal-scope acquisition that returns a scoped
context and managed database/derived-dataset reads that return `governed-data`. Passing authority or
governed data to an exact immutable same-file helper maps each positional argument to
that helper's parameter binding and computes a context-sensitive summary keyed by the complete
authority-input vector. Summaries are computed callee-first and merged back into the caller; nested
helper operations retain the source root and ordered transfer path. Returning or throwing
authority, placing it in an opaque container, mutating an authority alias/member, using a mutable or
ambiguous join, capturing it in an unsummarized nested callable, recovering it through `arguments`
or a rest/spread mapping, invoking an operation through `call`/`apply`/`bind`, or using an imported,
computed, aliased, reassigned, unresolved, or otherwise foreign callable is unsupported and MUST
remain KV449. A query root's no-managed-write posture propagates unchanged through every summary.

<!-- BEGIN GENERATED ANALYZABLE FRAGMENT -->

#### Closed analyzable-fragment prohibitions (generated)

This table is generated from [`security/analyzable-fragment.json`](../security/analyzable-fragment.json). The classification describes the general prohibition; each fixture is a minimal compiler-verdict witness, not an impossibility proof.

| Prohibition                                                              | Classification | KV449 closed reason         | Witness                                                                                                 |
| ------------------------------------------------------------------------ | -------------- | --------------------------- | ------------------------------------------------------------------------------------------------------- |
| Returning authority                                                      | `DELIBERATE`   | `unsupported-authority-use` | [fixture](../packages/compiler/src/fixtures/analyzable-fragment/returning-authority.tsx.txt)            |
| Throwing authority                                                       | `DELIBERATE`   | `unsupported-authority-use` | [fixture](../packages/compiler/src/fixtures/analyzable-fragment/throwing-authority.tsx.txt)             |
| Opaque authority container                                               | `FUNDAMENTAL`  | `opaque-transfer`           | [fixture](../packages/compiler/src/fixtures/analyzable-fragment/opaque-container.tsx.txt)               |
| Mutating an authority alias or member                                    | `FUNDAMENTAL`  | `unsupported-authority-use` | [fixture](../packages/compiler/src/fixtures/analyzable-fragment/mutating-authority-alias.tsx.txt)       |
| Mutable or ambiguous join                                                | `FUNDAMENTAL`  | `opaque-transfer`           | [fixture](../packages/compiler/src/fixtures/analyzable-fragment/mutable-ambiguous-join.tsx.txt)         |
| Unsummarized nested callable                                             | `DELIBERATE`   | `opaque-transfer`           | [fixture](../packages/compiler/src/fixtures/analyzable-fragment/unsummarized-nested-callable.tsx.txt)   |
| `arguments`, rest, or spread recovery                                    | `DELIBERATE`   | `opaque-transfer`           | [fixture](../packages/compiler/src/fixtures/analyzable-fragment/arguments-rest-spread-recovery.tsx.txt) |
| `call`, `apply`, or `bind` invocation                                    | `DELIBERATE`   | `opaque-transfer`           | [fixture](../packages/compiler/src/fixtures/analyzable-fragment/call-apply-bind.tsx.txt)                |
| Imported, computed, aliased, reassigned, unresolved, or foreign callable | `FUNDAMENTAL`  | `opaque-transfer`           | [fixture](../packages/compiler/src/fixtures/analyzable-fragment/foreign-callable.tsx.txt)               |

The ledger also records the current real-root budget-binding measurement. Its [reviewed hand argument](06-analyzable-fragment-hand-argument.md) states the compositionality claim, adequacy claim, and limits.

<!-- END GENERATED ANALYZABLE FRAGMENT -->

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

**Application config-secret door (normative).** `defineKovo({ env: s.object(...) })` is the sole
public operator-environment projection. The runtime MUST admit only a genuine framework `s.object`
schema, parse the bootstrap-pinned source once, retain only declared own fields, freeze that parsed
record, and expose it only through the precisely inferred read-only declaration/request context.
The opaque public `KovoApp` token has no structural `env` field. The raw operator snapshot and
undeclared keys remain framework-internal. A declared env schema failure refuses boot in every
mode: development may warn for a weak framework signing secret, but it cannot return a typed
`app.env` whose value never validated. `kovo build` is not runtime boot and MUST NOT require or
receive the production values for this declared projection. While it evaluates the app only to
derive the closed build graph, every declared field MUST instead be a framework-owned,
non-coercible unavailable sentinel: the schema shape is still provenance-checked, but no operator
value is read, parsed, rendered, serialized, cloned, or copied into an artifact. Observing or
exporting a sentinel MUST fail closed. The emitted server then evaluates the app outside that build
posture and MUST parse the real bootstrap-pinned source before it can serve a request.
`s.secret(schema)` MUST return a runtime `SecretValue`, not a
type-only `Secret<T>` cast, so interpolation, template/string coercion, JSON and wire encoding,
structured cloning, SSR output, and artifact capture encounter the existing fail-closed
confidentiality doors. The box's module-private runtime registration owns this invariant; its type
is author-time ergonomics only. A dependency credential should be revealed exactly once inside its
boot-time credential factory through `revealSecret(value,
DeclassifyPolicy.forRevealSecret({ purpose: 'credential-use', ownerScope: 'application' }))`; the
static call site
remains an audit-grade row in the existing
`kovo explain revealed` fact graph (and therefore also in its folded `capabilities` view), while
the bounded runtime reveal collector is observational evidence, not a complete process-lifetime
proof. The audit collector MUST recognize direct `@kovojs/core` named imports, bind each reveal to
its exact policy tuple, and accept those literal policy fields in any order. A call with dynamic or
otherwise unrecordable policy MUST emit error-severity KV426 instead of disappearing from the audit. When
the typed query analyzer and runtime audit analyzer observe the same reveal, their facts may be
deduplicated only by the exact call span/AST identity; a shared `file:line` label is insufficient.
These audit rules do not relax the request security classifier's stricter exact matcher. This
pattern does not claim arbitrary JavaScript string
comparison is constant-time; use `SecretValue.equals` only for fixed token/verifier comparisons
whose operands fit that contract.

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

The fixed credential rate limiter MUST domain-separate each admitted raw Better Auth identity by
HMACing the canonical `ScopedKey` frame under the finite `better-auth-rate-limit` system posture,
not a bespoke delimiter prefix. Its bounded 16-bit bucket is itself a runtime-witnessed key under
that same posture, and the SQLite/Postgres consumer MUST authenticate the witness, exact posture,
and four-lowercase-hex app-key before persisting the complete canonical frame. Raw IP/path input,
bare strings, structural forgeries, public/principal keys, and other system postures fail before the
database statement. HMAC collisions deliberately share the same bucket and aggregate attempts, so
the fixed 65,536-bucket bound fails closed rather than granting additional credential guesses.

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

**Better Auth lifecycle ownership and non-claims (normative).** The fixed SQLite/Postgres bindings
own exactly four Kovo-owned identity transitions: the CSRF-protected `signIn` mutation, the
CSRF-protected `signOut` mutation, development-only seed `signUp` (which provisions a credential
with `autoSignIn: false`), and the feature-conditional CSRF-protected `requestPasswordReset`
mutation. The fourth transition exists only when the binding receives a constructor-minted,
purpose-closed password-reset mail door, an explicit public/pre-auth access decision, and one
canonical same-origin reset path. For an accepted provider request, the mutation MUST expose one
generic accepted result for account-present and account-absent worlds, MUST discard the provider
response and cookies, and MUST invoke the registered sender exactly once with only
`{ to, resetUrl }` in either world. Rate-limit or provider failure MUST stop before mail dispatch.
The absent world uses a same-shape decoy URL minted before provider work. The real token MUST reach
only that mail sender inside the validated same-origin URL; the standalone token, provider user
record, request, and other dependency values MUST NOT cross the door. Mail-provider delivery and
its attacker-visible behavior are deployment egress outside Kovo's HTTP-equivalence claim. No
other direct Better Auth lifecycle API is exposed. The opaque provider mount accepts only `GET`, so
provider lifecycle operations requiring an unsafe
method are structurally unreachable through that mount. This is not a claim that every dependency
lifecycle route is unreachable: the redirect/callback mount can reach dependency-defined `GET`
handlers that change identity state, including provider or token callback flows. That reachable GET
callback lifecycle is delegated and unsupported by Kovo guarantees; only the origin, non-egress,
redirect-response, and cookie-posture boundaries above apply. Session expiry, rolling update,
freshness, cookie-cache posture, and sign-in rotation behavior are inherited from the exact-pinned
provider and MUST remain characterized by the provider-pin conformance test. Reset-token minting,
expiry, single use, and reset completion remain exact-pinned Better Auth protocol behavior rather
than a Kovo guarantee. `kovo explain auth-lifecycle` MUST print the inherited values, the four
owned transitions (including the feature condition), the structurally unreachable unsafe-method
class, and the reachable delegated non-claim.

**Outbound egress: the positive framework capability (normative).** Untrusted-data-reachable framework code MUST have one supported positive HTTP network door: the exact framework-owned `ctx.fetch` supplied to durable/scheduled tasks, verified webhooks, and any supported agent-tool callback. A runner or app MUST NOT replace that function. Raw `fetch`, `node:http`, `node:https`, `net`, datagram, proxy-agent, database-driver, worker, process, native-socket, or dynamically loaded network authority remains unavailable from that graph unless a separately reviewed framework door explicitly owns it. `egress.allowDestinations` MUST be a dense list of exact HTTP(S) origins. Boot MUST reject an empty, malformed, credential-bearing, path/query/fragment-bearing, non-HTTP(S), or non-string entry instead of warning and widening or silently narrowing posture. Boot canonicalizes scheme, URL-normalized hostname (including Unicode, legacy IPv4, IPv6, case, and a DNS trailing dot), and effective port into one origin identity. The initial request and every redirect or pooled-request origin MUST match that canonical set **before DNS, proxy selection, pool reuse, or dial**. Every admitted hostname request/hop MUST resolve all candidate addresses and classify all of them; any closed answer closes the whole request. Every new TCP dial MUST classify the exact resolver result that Node may select and pin that immutable result into the dial, so DNS rotation is admitted only when the origin remains declared and every new answer remains safe. A declared private origin additionally needs the ambient `allowInternal` posture below. A framework-created database socket is a separate, module-private exact-endpoint capability: it may follow DNS rotation for its registered Postgres host/port without opening that endpoint to unrelated sockets. Arbitrary application proxy/dispatcher configuration is unsupported and MUST fail boot or be stripped from `ctx.fetch`; an operator-controlled transparent proxy remains deployment authority outside this application-level origin proof and does not turn the private-network floor into a sandbox. Future agent-tool APIs MUST supply this same contextual door before they are supported. Same-process deliberately malicious code or intrinsic poisoning is outside this construction proof, as stated by the capability-closure boundary above.

**Outbound egress: the private-network deny floor (normative, runtime defense-in-depth — NOT a proof).** The threat is the **SSRF network position**: a reflected or forged inbound request coaxes the server into making an _outbound_ request to an address it must never reach — cloud instance-metadata (`169.254.169.254` and the AWS ECS/EKS variants `169.254.170.2`/`169.254.170.23`, the AWS IMDSv6 `fd00:ec2::254`, Azure's IMDS plus its `IDENTITY_ENDPOINT` loopback, GCP's `metadata.google.internal`), localhost sidecars, or internal-only services on RFC1918 / link-local / unique-local / CGNAT ranges. The payoff is managed-identity credential theft off the metadata endpoint, or an internal-service pivot. Kovo installs the floor when `app.assemble()` closes the `defineKovo` contract and accepts explicit operator config through `defineKovo({ egress: { allowInternal: ['otel:4318', '10.0.5.2:6379'] } })` with the following normative behavior. **All public/external egress is UNRESTRICTED at this ambient process floor** — the positive framework capability above is the separate control that closes public destinations reached through `ctx.fetch`. **Private / loopback / link-local / unique-local / CGNAT / IANA-special destinations are DENIED by default in production and whenever an explicit `egress` object is supplied**, reachable only when the exact `host:port` is in the operator's narrow `allowInternal` allowlist (broad CIDR entries are flagged and warned). In development, an omitted `egress` option still installs both enforcement layers and still denies cloud metadata, but permits non-metadata private-network destinations so localhost DB/Redis/OTel/Ollama sidecars do not brick ordinary local boot; pass `egress: { allowInternal: [] }` in development to exercise production empty-allowlist semantics. A blocked connection throws a typed 502-class `EgressBlockedError` naming the destination and the remediation. **The cloud instance-metadata endpoint is DENIED by default and is NEVER reachable via `allowInternal`** — it is reachable only inside a module-private `metadataAllowed` `AsyncLocalStorage` frame entered ONLY by the per-cloud credential factories `awsCredential()` / `gcpCredential()` / `azureCredential()`, which wrap the cloud SDK's credential provider so a token _refresh_ re-enters the frame. There is deliberately no generic `withMetadataAccess` helper. A reflected SSRF never calls a factory, so it never enters the frame, so metadata stays denied at the very same IP — provenance-as-current-frame, unforgeable by SSRF (it survives the `await`/timer boundaries that destroy stack frames) yet still runtime-DiD, not a proof. **DNS64/NAT64 topology is explicit operator authority.** Kovo always decodes RFC 6052's well-known `64:ff9b::/96` carrier. A deployment using any Network-Specific Prefix MUST list every active translator prefix in `egress.nat64Prefixes`; automatic RFC 7050 discovery or A/AAAA correlation is not accepted as the policy root. Only `/32`, `/40`, `/48`, `/56`, `/64`, and `/96` are valid. Boot MUST reject malformed CIDRs, set host bits, a non-zero `/96` u octet, duplicate/overlapping configured prefixes, and any configured prefix that overlaps the implicit well-known decoder. The framework snapshots and canonicalizes the resulting prefix set as process-global posture. At the sink, a matching configured prefix is decoded using RFC 6052 Table 1 before the context-free IPv6 registry verdict: the u octet MUST be zero for layouts shorter than `/96`, suffix bits are ignored, and the embedded IPv4 destination is classified normally. This explicit topology may expose public IPv4 through RFC 8215's local-use `64:ff9b:1::/48`, but embedded metadata remains metadata and can never be reopened by `allowInternal`. The decision rule runs **per request and per redirect hop, at BOTH enforcement layers**: resolve the host → normalize (IPv4-mapped `::ffff:`, decimal/octal/hex, well-known NAT64, and configured Network-Specific Pref64) → pin the exact validated resolver result from which Node may select a dial address → public IP allow; metadata IP allow iff the `metadataAllowed` frame is active; other non-public IP allow iff the development omitted-config posture permits it or `host:port ∈ allowInternal`; anything not confidently classified as public fails **closed**. Enforcement is **dual-layer because a single layer fails open**: (a) a custom undici dispatcher at the per-request `dispatch()` level — pooled-socket reuse skips the per-connection hook, so a connect-only check would pass the _second_ request to an origin; and (b) the `node:http`/`node:https` + `net.Socket.prototype.connect` layer — AWS IMDS via `@smithy` uses raw `node:http` and bypasses undici entirely — which also injects a pinning `lookup` so a TOCTOU DNS-rebind cannot swap a public answer for a private one between check and dial. Bootstrap installs both layers at the assembly chokepoint and runs a **loud startup self-probe** that warns unmissably when the floor is not installed; production refuses boot when the floor is missing, partial, tampered, or disabled without an audited non-empty opt-out justification. Because monkeypatches do not cross `Worker`/`child_process` boundaries, every worker/child bootstrap that serves requests MUST re-install (the self-probe is the safety net). Prototype-freezing is **opt-in / off by default** (it breaks Datadog/OTel/nock). This control is **labeled everywhere as a fail-closed runtime defense-in-depth floor, never a by-construction proof**. Residual fail-open holes (enumerated, by design): same-process app code can re-patch `net.Socket.prototype.connect` or call `setGlobalDispatcher` after the floor; `Worker`/`child_process`/native-socket paths the JS layer never sees; arbitrary raw per-call dispatchers/proxy agents outside the supported capability graph; and provider-shape drift in a future undici/node internal. The floor is **redundant on Lambda/PaaS/Workload-Identity-Federation** where IMDSv2 / hop-limits already close the metadata path; it earns its keep on long-lived managed-identity VMs and against the internal-service pivot.

**Scoped keys for non-database state (normative, fail-closed runtime authority).** Every
app-addressable key that reaches a non-database stateful sink MUST be a runtime-opaque `ScopedKey`,
not a string or structural brand. Its canonical physical identity is the exact length-prefixed frame
`(kovo-scoped-key-v1, posture, authority, app-key)`. Length framing is over JavaScript code units and
MUST distinguish delimiter, slash, NUL, and ill-formed-surrogate placements without concatenation
ambiguity. `posture` is exactly one of `principal`, `public`, or `system`: principal authority comes
only from the framework-installed request session snapshot (`scopedKey(request, key)`) or an audited
task `actAs(id).stateKey(key)` scope; public authority comes only from the named
`publicScopedKey(key)` capability; system authority comes only from a finite framework-owned posture
registered in the C9 census. App-authored principal ids and free-form system reason strings are not
key authority. Authority components and every public/principal app-key are non-empty strings of at
most 1,024 code units. The finite `mutation-replay` system posture alone may carry the already-
bounded canonical `(scope, idem)` subframe as its app-key beyond 1,024 code units; its complete outer
`ScopedKey` frame MUST remain at most 4,096 code units. No app-facing constructor or other system
posture inherits that composite-key exception.

The public TypeScript type is ergonomics, not the proof. A module-private runtime witness owns the
frame and exact posture facts; storage, signed-URL, stored-file-response, durable-task queue,
mutation-replay, bounded rate-limit, and derived-dataset doors MUST authenticate that witness before
reading any fields or deriving a namespace. Bare strings,
casts, object literals, copied properties, proxies, malformed/non-canonical persisted frames, and
unregistered system postures fail **KV450**. A validated key remains opaque to app code; framework
internals may restore a persisted frame only through the same canonical parser and finite-posture
check. Storage object results may expose the normalized app-key string as descriptive metadata, but
that string carries no authority back into a sink.

The compiler MUST also fail **KV450** at every statically visible storage key, signed-URL `key`,
stored-file-response key, and durable-schedule coalescing `key` unless every finite branch derives
the value through the exact `scopedKey`, `publicScopedKey`, task `stateKey`, or task
`systemStateKey` constructor. Casts, structural lookalikes, runtime-selected options, computed
properties, and option spreads do not establish provenance. This compile gate is an author-facing
early closure only; the module-private runtime witness remains the enforcing authority at the sink.

**Derived vector datasets inherit authorization (normative).** The only supported transition from
managed owner-scoped/governed database data into a persistent non-engine vector/RAG artifact is the
exact module-constant `derived(adapter, { key: <non-empty static string>, kind: 'vector' })` door.
Every `query(request, query)` and `upsert(request, records)` operation MUST receive the exact
framework request carrier. The runtime re-runs `scopedKey(request, 'derived/vector/' + key)` for
every operation and constructs the physical namespace as
`kovo-derived-vector-v1/<sha256(complete-canonical-ScopedKey-frame)>`; neither an app call site nor a
query/write payload can provide or replace that namespace. Query results and upsert arrays are
dense, bounded, immutable snapshots at the adapter boundary, and adapter callables are pinned at
construction. Equal logical keys under different principals therefore produce different physical
artifact identities, while reads under the same principal reconstruct the identity used by writes.

The compiler tracks managed DB and derived reads as `governed-data` and emits **KV452** when that
provenance reaches storage `put`, framework egress, or a durable-task payload outside the exact
`derived()` door; transforms, aliases, containers, conditionals, and exact same-file helpers do not
erase the label. A derived read/write with a missing, forged, or non-request first argument is also
KV452. A same-spelled local, imported lookalike, alias, dynamic options object, spread, surplus key,
unsupported kind, or request-time constructor does not acquire derived-dataset authority and remains
inside the ordinary KV449 fail-closed rules.

The adapter is a deployment boundary, not an authorization proof: Kovo guarantees that it supplies
only the reconstructed opaque namespace, but the selected adapter/service MUST faithfully isolate
that namespace. An adapter that ignores, truncates, aliases, or externally broadens the namespace
invalidates the derived-artifact isolation claim and is a retained deployment obligation. Deliberate
same-process code that captures the adapter input and performs another raw write remains outside the
app-level proof per the capability-closure boundary above.

Memory storage keys by the complete frame. Filesystem storage hashes the complete frame with SHA-256
for its bounded physical slot and atomically records the exact frame in the sidecar, refusing a
digest collision. S3-compatible storage uses a framework-owned `kovo-storage-v1/<sha256(frame)>`
namespace. Consequently equal app keys in different principal/public/system postures never address
the same physical object. This is an unconditional technical-preview contract: no legacy string-key
fallback or compatibility namespace exists.

**Capability URLs for storage downloads (normative, by-construction at the verify sink).** A download URL for a stored object is signed, short-lived, and scope-bound so the object is _un-dereferenceable without a valid token_. `signCapability` mints a token over the canonical, length-prefixed tuple `(version, signing-key-id, method, scoped-key-frame, expiry, scope, one-time, nonce)` (canonicalize-before-sign, so no field-confusion collision or unsigned replay/key-selection field) using the framework signing secret; the framework-owned download route MUST restore the runtime-witnessed `ScopedKey` from the request path, then `verifyCapability` — re-canonicalizing the exact frame/method/scope it derives _from the request_ and comparing the HMAC in constant time — **before any storage read**. Because the route supplies the expected claims rather than trusting the token's, a token for object `a` cannot authorize reading object `b`, or the same app key in a different owner posture, even with a valid signature. Verification is fail-closed and ordered (bounded frame parse → token parse → constant-time signature → expiry → claim match → one-time burn); rejection reasons are never leaked to the client. This is **by-construction at the verify sink** (an object cannot be read without a verifying token), with one honestly-labeled limit: the URL is a **bearer credential** whose _leakage_ via `Referer`/logs/CDN is mitigated (short expiry by default, narrow scope, and an optional one-time token posture) but **not proven**. The framework storage **download route** that hosts the sink is **shipped**: `createStorageDownloadEndpoint` builds a prefix-mounted GET/HEAD `endpoint()` whose handler re-derives the expected scoped frame/method/scope from the request and runs `verifyCapability` before any storage read (a generic, reason-free 404 on any failure), and `ctx.signUrl({ key, method?, scope?, expiresIn?, oneTime? })` accepts only a witnessed `ScopedKey` and mints a URL pointing at that route (canonicalize-before-sign; short-expiry default). Capability signing and verification MUST reject before unbounded decode, parsing, canonicalization, or audit retention: complete scoped-key frames are limited to 4,096 code units, scopes and audiences to 1,024 each, decoded payloads to 12,000 bytes, complete wire tokens to 16,384 code units, and TTL to at most one hour. Production MUST refuse a missing, custom, or volatile download replay store and accept only the opaque durable store exposed by `createPostgresAppRuntimeDb().capabilityReplayStore`, even when the app currently mints only ordinary tokens; this keeps one-time posture from becoming a deployment-time footgun and makes replica/restart truth mandatory before the sink can serve. Production signing, verification, signer construction, and download-route construction MUST also refuse caller-injected clocks, so expiry is measured only against the framework-owned wall clock (and durable one-time insertion is additionally guarded by the database clock). Every mint records the normalized app key plus exact key posture in a capability fact surfaced by `kovo explain capabilities`.

Capability token `v4` supersedes the base tuple above by signing
`(version, signing-key-id, method, scoped-key-frame, expiry, scope, principal-epoch, one-time,
nonce)`, with the epoch field empty only for an unscoped token. A principal-scoped mint requires an
active authoritative epoch; verification requires the same current epoch after signature, expiry,
and request-derived claim matching but before a one-time replay burn or storage read. `v3` and all
older versions are intentionally rejected rather than accepted through a compatibility path.

---
