# Jiso — Product Requirements & Technical Specification

**Version:** 0.1 (Draft)
**Status:** Design specification for v1, with staged roadmap through v3
**Audience:** Framework implementers, early adopters, AI app-builder integrators

---

## 1. Vision

Jiso is a web-platform-native framework for building multi-page applications that are **interactive at first paint, legible at every layer, and statically verifiable end-to-end.**

It takes resumability from Qwik, server-driven UI from htmx/LiveView, tag-based invalidation from RTK Query, rebase-based optimism from Replicache, and document-first architecture from the platform itself — and composes them around one organizing constraint: _every artifact the system produces (compiled output, HTML, wire traffic, dependency graphs) must be readable by a human in devtools and checkable by a machine without executing a browser._

### 1.1 Thesis statement

> An application's complete behavior — every handler wiring, form field, mutation contract, data dependency, and optimistic prediction — should be provable by TypeScript static checking plus static graph queries, and auditable by reading the page source and the Network panel.

### 1.2 Who it's for

- **Teams building content-and-CRUD products** (commerce, SaaS dashboards, marketplaces, internal tools) — the structural majority of the web — who want SPA-feeling UX without owning a client-state architecture.
- **AI app builders and code-generation systems.** Jiso is designed to be the most machine-auditable compilation target an agent can emit: generated apps fail TypeScript static checking if wiring is wrong, and intent can be verified against printed dependency graphs without headless browsers.
- **Anyone debugging at 11pm.** The framework's promise: debugging always proceeds _down_ into plainer code, never _up_ into compiler internals.

### 1.3 Explicit non-goals

- **Figma-class shared-workspace apps.** Long-lived client sessions over one mutable heap (collaborative canvases, video editors, DAWs) are outside the sweet spot. Jiso islands can host rich widgets, but the framework will not grow a client router or global client store to serve this segment.
- **Offline-first.** Server truth is unconditionally authoritative; Jiso does not ship a sync engine.
- **Persistent cross-navigation media** (audio playing across page loads) in v1. See §13.4 for the honest position.
- **Browser support parity for enhancements.** Speculation Rules and invoker commands are Chromium-led; Jiso degrades gracefully (real navigations, real forms) but does not polyfill them.

---

## 2. The Constitution (Design Tests)

Every feature proposal is evaluated against five tests. A feature failing any test is redesigned or rejected. These are normative.

| #   | Test                                                                                                                                               | Consequence                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | **Legibility is load-bearing.** Names appear in HTML attributes and wire traffic, so they structurally cannot be mangled.                          | Minifiers cannot rename handler exports; debugging never requires decompiling the framework.  |
| 2   | **No global knowledge at local sites.** Any API requiring the author to enumerate distant call sites from memory is a bug factory and is rejected. | Killed manual fragment targets, manual per-island optimism, query-side mutation registration. |
| 3   | **Sugar must lower to authorable IR.** Every compiler feature emits valid Jiso source. Compiling the output is a no-op (CI-enforced fixpoint).     | Any component can be ejected. Source maps are a nicety, not life support.                     |
| 4   | **The wire is the documentation.** Named POSTs, schema-shaped JSON, readable HTML fragments.                                                       | An app's behavior surface is auditable from the Network panel or `tcpdump`.                   |
| 5   | **Server truth always wins.** No client cache to invalidate; reconciliation is "morph the authority in."                                           | Optimistic predictions are throwaway sketches; there is no consistency protocol.              |

---

## 3. Architecture Overview

```
                        AUTHORING                    COMPILED IR                  RUNTIME
┌──────────────────┐   ┌──────────────────────────┐   ┌──────────────────────────────────┐
│  cart.tsx        │   │ cart.server.js           │   │ Self-describing HTML             │
│  (JSX, inline    │──▶│   render fns, queries    │──▶│  • plain elements, fw-c stamps   │
│   closures,      │   │ cart.client.js           │   │  • on:click="cart.js#Cart$remove"│
│   single file)   │   │   named handler exports, │   │  • <script fw-query="cart"> JSON │
│                  │   │   derives, transforms    │   │  • fw-deps="cart" stamps         │
└──────────────────┘   └──────────────────────────┘   └──────────────────────────────────┘
        │                        │                                  │
        │ fixpoint:              │ 1:1 file mapping,                │ ~1KB loader: global event
        │ compile(IR) ≡ IR       │ source-derived names             │ delegation + import() on
        ▼                        ▼                                  ▼ first interaction
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ MPA SPINE: real navigations + opt-in Speculation Rules prerender + cross-document View   │
│ Transitions + bfcache. No client router. No hydration.                                   │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ DATA PLANE: queries (typed reads) ← invalidation graph → mutations (typed writes)        │
│ derived from domain layer / Drizzle AST. Optimistic transforms hand-written (v1);        │
│ compiler-derived transforms arrive in v2.                                                │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ WIRE: one fragment/query-JSON vocabulary, transport-agnostic:                            │
│ document load · enhanced fetch (mutations) · SSE live queries (v2)                       │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Inherited from prior art

| Kept from                  | What                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Qwik                       | Resumability, global event delegation, attribute-encoded handler refs, serialized state, execute-nothing-until-interaction |
| htmx / LiveView            | Server-rendered fragments as the mutation response; HTML over the wire                                                     |
| RTK Query / Next tags      | Keyed invalidation intersected with declared dependencies                                                                  |
| Replicache / Zero          | Snapshot → predict → rebase log → authoritative reconcile                                                                  |
| Rails (touch/Russian-doll) | Writes through the data layer drive derived-view freshness                                                                 |
| Convex / Noria             | The asymptote: inferred read/write sets — reached statically via Drizzle ASTs instead of at runtime                        |

### 3.2 Rejected from prior art

Client router and SPA navigation; hydration; hash-named heuristic chunks; load-bearing semantic optimizer; single global state blob; **runtime signal graphs in the core client — proprietary or TC39** (the client dependency graph is compile-time-known, so the compiler emits a per-query update plan instead; a TC39 Signals interop adapter is v2); opaque closure capture (`useLexicalScope`); client-side cache with invalidation lifecycle; manual invalidation calls as the primary mechanism; **shadow DOM** (tree-scoped IDREFs, form participation, and ARIA all break at the boundary — fatal to L0 platform behaviors and the no-JS form contract; style scoping comes from the compiler instead, §13.1); **custom-element registration** (resumability comes from delegation + `import()`, never from `customElements.define`; component identity is the `fw-c` stamp, dashed tags survive as inert sugar, and native hosts like `<tr fw-c="cart-row">` end the table-nesting papercut); **load-bearing import maps** (the compiler and server emit full module URLs with cache-busting they control; import maps remain an optional deployment strategy).

---

## 4. Component Model & Authoring

### 4.1 Anatomy of a component

```tsx
// cart-badge.tsx — what you write
import { component } from '@jiso/core';
import { cartQuery } from './cart.queries.js';

export const CartBadge = component('cart-badge', {
  fragmentTarget: true, // registers in FragmentTargets registry
  queries: { cart: cartQuery }, // typed data dependencies
  state: () => ({ bouncing: false }), // LOCAL state: UI-only facts, JsonValue-constrained

  render: ({ cart }, state) => (
    <button
      commandfor="cart-drawer"
      command="show-modal" // L0: platform behavior, zero JS
      class={state.bouncing ? 'bounce' : ''}
    >
      🛒 <span data-bind="cart.count">{cart.count}</span>
    </button>
  ),
});
```

**Rules enforced by the type system:**

- `state` must satisfy `JsonValue` (no `Date`, `Map`, functions, class instances) — serializability is a compile error, not a runtime surprise.
- A `fragmentTarget: true` component's render inputs must be ⊆ (declared queries ∪ stamped props) — otherwise the server cannot re-render it as a fragment.
- Query data is **shared and server-owned**; local state is **private and client-owned**. A lint (`FW301`) rejects server facts in local state.

### 4.2 Rendered output (the IR's runtime form)

```html
<cart-badge fw-deps="cart">
  <button commandfor="cart-drawer" command="show-modal">
    🛒 <span data-bind="cart.count">2</span>
  </button>
</cart-badge>

<!-- Query data ships ONCE per page, as shared client data -->
<script type="application/json" fw-query="cart">
  { "count": 2, "items": [{ "productId": "p1", "qty": 2, "unitPrice": 1499 }] }
</script>
```

Components render to **light DOM** as plain, never-registered elements — no shadow roots, no `customElements.define`, no upgrade step (§3.2). The load-bearing identity is the `fw-c` stamp; the compiler omits it when the host tag already spells the component name (`<cart-badge>` — dashed tags are inert sugar for Elements-panel readability) and emits it explicitly on native hosts (`<tr fw-c="cart-row">`, so content-model nesting like tables just works). Co-located CSS is compiler-scoped to the host (`@scope`, donut-scoped to exclude nested islands) and deduped into one per-page stylesheet (§13.1). Because there is no shadow boundary, IDREF wiring (`commandfor`, `for`, `aria-*`), native form participation, and find-in-page work document-wide — the L0 layer and the no-JS form fallback depend on exactly this.

Everything is inspectable in the Elements panel: dependencies (`fw-deps`), data (the JSON), behavior (`on:*` attributes), pending mutations (`fw-pending`, §10.3).

### 4.3 Handlers and closures

You author inline closures; the compiler lowers them (§5). The lowered form is the contract:

```tsx
// Authoring (sugar)
<button onClick={() => removeItem(state, item.id)}>×</button>
```

```js
// cart.client.js — GENERATED, but valid authorable Jiso source
import { handler } from '@jiso/runtime';

/** captures: item.id → element params */
export const Cart$removeItem = handler<CartState, { itemId: string }>((e, ctx) => {
  ctx.state.items = ctx.state.items.filter(i => i.id !== ctx.params.itemId);
});
```

```html
<button on:click="/c/cart.client.js#Cart$removeItem" data-p-item-id="i_42">×</button>
<!-- full URL + #export: no import-map indirection; cache-busting via query
     strings/ETags the server controls. '#cart'-style aliases exist only at
     the authoring/type level (§6.1); import maps are an optional deployment
     strategy, never load-bearing. -->
```

**Capture channels (exhaustive):** component/query state (via `ctx`), element params (`data-p-*`, typed), module scope (shared, not captured). Anything else is compile error `FW201`, whose message shows what the closure _would have_ compiled to and the three fixes.

### 4.4 The loader

A ~1KB inline script. Responsibilities: global event delegation (capture phase) for all `on:*` events; parse `url#export` refs, `import()` the URL, invoke the export with `(event, ctx)`; enhanced form interception (§9); query-data hydration from `fw-query` scripts; running each query's compiled update plan (bindings → named derives → stamps) when its value changes; refetch-on-focus/visibility (§9.3); morph application — the morph layer itself accounts for islands it patches in (nothing is registered; there is no upgrade step or lifecycle callback). Nothing else lives in the always-loaded path.

---

## 5. Compiler

### 5.1 Pipeline

```
cart.tsx ──parse──▶ analyze ──lower──▶ cart.server.js + cart.client.js ──(prod only)──▶ minify*
                       │
                       ├─▶ generated/registries/*.d.ts   (module aliases, fragment targets, query keys, domains)
                       ├─▶ generated/touch-graph.ts      (§11.3 — committed, reviewable)
                       └─▶ generated/optimistic/*.ts     (§10.4 — v2; committed, overridable)
```

\* Minification may never rename exported handler symbols or anything appearing in HTML attributes (Constitution #1 — enforced because those names are load-bearing at runtime).

### 5.2 Hard rules (normative)

1. **Source-derived names.** Extracted handlers are named `Component$fnName`, or `Component$element_event` when anonymous (lint `FW210` nudges naming). Content hashes appear only in cache-busting query strings on the emitted module URLs (or ETag-driven — a deployment choice the framework controls server-side).
2. **1:1 file mapping.** `x.tsx` → exactly `x.server.js` + `x.client.js`. No heuristic chunking. A prod-only merge pass for tiny modules is opt-in (`jiso.config: mergeClientModules`), defaulting off.
3. **Fixpoint invariant.** `compile(compile(src)) === compile(src)`; the IR is valid input. CI test ships in the starter template.
4. **Platform-behavior emission.** Where the compiler proves a handler equivalent to a declarative platform feature (dialog open/close → invoker commands; popovers; `<details>`; pure-CSS state via `:has()`), it emits the attribute and drops the handler. `fw explain` reports each substitution.
5. **Teaching errors.** Every diagnostic shows the lowering: what would have been generated, why it can't be, and the fix menu.

### 5.3 `fw explain`

The compiler's decision tree, on demand. Sub-commands (all output stable, diffable text — agents consume the same artifact humans read):

```bash
fw explain component cart        # lowerings: extracted handlers, capture channels, platform substitutions
fw explain mutation cart/add     # writes → domains → invalidated queries → consumers; guard chain
fw explain mutation cart/add --optimistic   # transform coverage per query; v2 adds derivation traces + punts (§10.5)
fw explain query cart            # read set, consumers, every mutation that invalidates it
fw explain page /products/:id    # emitted modulepreloads, per-route prefetch config, query payloads
```

---

## 6. Type System

One pattern, applied everywhere: **declare facts once → derive every surface → validate residual strings against generated registries.** The only codegen is trivial registry `.d.ts` files; all wiring checks are TypeScript static checks over code that runs as written.

### 6.1 The registries (generated)

```ts
// generated/registries.d.ts (excerpt)
interface HandlerModules {
  '#cart': typeof import('../components/cart/cart.client.js'); /* … */
}
// '#cart' is a compile-time alias only — emission resolves it to a full URL (§4.3)
interface FragmentTargets {
  'cart-badge': CartBadgeProps;
  'cart-drawer': CartDrawerProps;
}
interface QueryRegistry {
  cart: typeof cartQuery;
  product: typeof productQuery;
}
interface DomainKey {
  /* 'cart' | 'product' | 'order' — from schema annotations */
}
interface MutationRegistry {
  'cart/add': typeof addToCart;
}
```

### 6.2 Typed surfaces (summary table)

| Surface               | Source of truth                 | What TypeScript proves                                                                                 |
| --------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Handler refs          | client module exports           | `cart.remove` exists; params required & typed; typo = error                                            |
| Form fields           | mutation input schema           | names ∈ schema; types match; **completeness** (missing required field = error); coercion declared once |
| Fragment targets      | component registry              | target exists; patched with the right component's props                                                |
| Query data / bindings | Drizzle select shape (`$infer`) | `data-bind` paths exist; column rename propagates to every template                                    |
| Invalidations         | domain layer / touch graph      | invalidated keys exist; optimistic exhaustiveness (§10.6)                                              |
| Errors                | declared error codes            | `onError` receives exhaustive discriminated union                                                      |
| Guards                | guard combinators               | `req.session.user` non-null under `authed`; static audit of unguarded mutations                        |
| State                 | `JsonValue` constraint          | serializability by construction                                                                        |

### 6.3 Example: end-to-end mutation typing

```ts
// cart.mutations.ts
import { mutation, s } from '@jiso/server';
import { cart } from './cart.domain.js';

export const addToCart = mutation('cart/add', {
  guard: authed,
  input: s.object({
    productId: s.string(),
    quantity: s.number().int().min(1).default(1), // FormData coercion declared here
  }),
  errors: {
    OUT_OF_STOCK: s.object({ availableQuantity: s.number() }),
  },
  async handler(input, req, { fail }) {
    //          ^? { productId: string; quantity: number }   — inferred from schema
    const ok = await cart.addItem(req.db, req.session.cartId, input.productId, input.quantity);
    if (!ok) return fail('OUT_OF_STOCK', { availableQuantity: ok.available });
    // NO invalidate() call — derived from cart.addItem's touch set (§11)
  },
});
```

```tsx
// product.tsx — the consuming form
const f = form('cart/add'); // key validated against MutationRegistry; input type inferred

<f.Form>
  {' '}
  {/* ✗ compile error if a required field is missing */}
  <f.hidden name="productId" value={props.productId} />
  <f.input name="quantity" type="number" min={1} />
  <button>Add to cart</button>
</f.Form>;
// Emits: <form method="post" action="/_m/cart/add" enhance> … — the no-JS fallback IS the output
```

```ts
// programmatic + typed errors
ctx.submit(addToCart, {
  input: { productId: ctx.params.productId, quantity: 1 },
  onError: (err) => {
    if (err.code === 'OUT_OF_STOCK') toast(`Only ${err.data.availableQuantity} left`);
    // err: { code: 'OUT_OF_STOCK', data: {availableQuantity: number} }
    //    | { code: 'VALIDATION', fields: Record<FieldPath, string> }   — exhaustive
  },
});
```

---

## 7. The Interaction Ladder

Interactions must use the lowest layer that suffices. The compiler enforces L0 substitutions; lints nudge the rest. Navigation between _places_ is always a real navigation (§8); the ladder governs interaction _within_ a place.

| Layer       | Mechanism                                                                                                                                  | Example                               | JS shipped                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | -------------------------------------- |
| **L0**      | Platform behaviors: invoker commands, Popover API, `<details>`, `<dialog>`, `:has()`, scroll-driven animations                             | Open cart drawer                      | 0                                      |
| **L1**      | Pure client islands: local state + bindings                                                                                                | Price-range filter UI, tabs, carousel | handler module on first touch          |
| **L2**      | Mutations: real forms + enhanced fetch → fragment/query patch                                                                              | Add to cart                           | loader (already present) + form module |
| **L3**      | Optimistic: declared transforms over query values (compiler-derived in v2)                                                                 | Instant badge tick                    | transform module                       |
| **L4 (v2)** | Live: SSE pushing the same fragment/query vocabulary — v1 covers the common cases with BroadcastChannel tab sync + refetch-on-focus (§9.3) | Order status, presence                | `<fw-live>` subscriber (v2)            |

**Cross-island coordination**, in order of preference: (1) **the URL** — filter writes `?max=500`, or is a GET form whose fragment response is the grid; (2) **typed fire-and-forget events** — registry-checked `emit('cart:added', {…})`, payload types may not overlap query data (lint `FW320`: if you're sending server facts over an event, you wanted an optimistic transform); (3) **shared client state** — last resort, lint-gated with required justification comment.

---

## 8. MPA Spine & Navigation

- **No client router.** Each page is a complete document; route handlers are server functions returning rendered pages.
- **Speculation Rules** are opt-in config, never auto-emitted: `prefetch: 'conservative' | 'moderate' | false` per route, **default off**. Auto-prerender owns a real footgun matrix — analytics firing inside prerendered pages, non-idempotent per-user renders, discarded-render server cost — so apps opt in route-by-route where renders are idempotent and cheap. The feature is one `<script type="speculationrules">` tag; the MPA is fast without it.
- **Cross-document View Transitions** opt-in per element pair via `view-transition-name` props; the compiler stamps matching names across route templates.
- **bfcache hygiene** is a framework guarantee: no `unload` handlers, `keepalive: true` on in-flight mutations at navigation, pending optimistic logs discarded on document teardown (stale-optimism-outliving-its-mutation is structurally impossible).
- **Out-of-order streaming:** `<fw-defer>` renders a fallback, streams the real fragment later in the same response, morphs in — the fragment protocol reused within first render. Deferred query JSON is guaranteed to arrive before or with its consumers.
- **Degradation contract:** Safari/Firefox get normal navigations and normal forms. The MPA degrades to "a website"; this asymmetry vs. SPA blank-screen failure is a feature, not an apology.

---

## 9. Wire Protocol

One vocabulary, transport-agnostic: document load and enhanced fetch in v1; SSE joins as a third transport in v2 (§9.3). All payloads are human-readable (Constitution #4).

### 9.1 Enhanced mutation round-trip

```http
POST /_m/cart/add HTTP/1.1
Content-Type: application/x-www-form-urlencoded
FW-Fragment: true
FW-Targets: cart-badge=cart; cart-drawer=cart; recommendations=product:p1
FW-Idem: 7f3a-…                          ← stamped hidden field; server replays duplicates

productId=p1&quantity=2&fw-csrf=…
```

```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8

<fw-query name="cart">{"count": 3, "items": […]}</fw-query>
<fw-fragment target="recommendations" strategy="morph">
  <!-- server-rendered HTML, produced by Recommendations.render(…) — the SAME
       render function full page loads use; partials cannot drift from pages -->
</fw-fragment>
```

- `FW-Targets` is read off the live DOM (`fw-deps` stamps), so islands patched in after page load participate. The server holds **no session of what's on screen** — it answers a stateless question.
- `<fw-query>` replaces the client's query value and runs that query's compiled update plan — bindings, named derives, stamps — across every dependent island. No runtime dependency tracking: the plan is known at compile time and emitted with the page.
- `<fw-fragment>` is **DOM-morphed** (idiomorph-class algorithm): focus, scroll, selection, CSS transitions, and nested island state survive. Patched-in islands are inert-until-touched like everything else — _a fragment update is a tiny navigation, not a different programming model._
- **Without JS:** the same endpoint sees no `FW-Fragment` header and answers POST-redirect-GET with errors re-rendered into the full page. One handler, two response modes.

### 9.2 Errors

Validation failures (schema, with field paths) and declared error codes return a fragment re-rendering the form with messages (default generated from schema paths; overridable per-form), HTTP 422. The enhanced path morphs just the form; the no-JS path re-renders the page. `ctx.submit`'s `onError` receives the typed union.

### 9.3 Liveness (v1) and Live (L4 — v2)

**v1 ships liveness only where the server stays stateless:**

- **BroadcastChannel rebroadcast** — a mutation's `<fw-query>` response is rebroadcast to the user's other tabs; same-user multi-tab sync at zero server cost.
- **Refetch on focus/visibility** — a loader behavior (per-query opt-out) that re-runs queries when a stale tab returns; it fakes an embarrassing share of "live" UX for one conditional in the loader.

**The full L4 moves to v2**, arriving alongside the CDC adapter (§14): `<fw-live query="cart">` subscribing over SSE to the identical `<fw-query>`/`<fw-fragment>` chunks; guards re-checked at subscription **and** at each push (a guard that passed at render must pass at patch time — fragments must not become a privilege-escalation side channel); in-process emitter (single node) or Redis pub/sub (multi-node); instance-key routing; `live: true` opt-in per query. The vocabulary is transport-agnostic by construction, so SSE is an additive transport, not a rearchitecture — and the v1 server stays stateless, full stop.

---

## 10. Data Plane

### 10.1 Schema as domain registry (Drizzle-blessed path)

```ts
// schema.ts
export const carts = pgTable('carts', { id: text('id').primaryKey() /*…*/ });
export const cartItems = pgTable(
  'cart_items',
  {
    /*…*/
  },
  jiso({ domain: 'cart' }),
);
export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    stock: integer('stock').notNull(),
  },
  jiso({ domain: 'product', key: (t) => t.id }),
); // row-level invalidation key
```

Tables default to a same-named domain; annotations group tables into logical domains and declare key granularity. The reverse index (table → domain), the `DomainKey` type, and key extractors are all generated from this single file.

### 10.2 Queries

```ts
// cart.queries.ts
export const cartQuery = query('cart', (db, req) =>
  db
    .select({
      count: count(cartItems.id),
      items: jsonAgg(cartItems),
    })
    .from(carts)
    .leftJoin(cartItems, eq(cartItems.cartId, carts.id))
    .leftJoin(products, eq(products.id, cartItems.productId))
    .where(eq(carts.id, req.session.cartId)),
);
```

Derived from this one expression, statically:

- **Read set** `{cart, product}` — the JOIN _is_ the declaration (forgetting a joined entity's dependency, RTK Query's endemic bug, is unrepresentable).
- **Result type** from the select shape — drives the client JSON, `data-bind` paths, derive inputs, and optimistic transform parameters. A column rename in `schema.ts` propagates through TypeScript static checking to every template.
- **Instance key** from the WHERE eq-predicate — `cart:{cartId}`; scopes row-level invalidation (and, in v2, live pushes) to holders of that key.

### 10.3 Mutations & writes

```ts
// cart.domain.ts — ALL writes flow through here (lint FW330 bans db access in handlers)
export const cart = domain({
  addItem: write(async (db, cartId: string, productId: string, qty: number) => {
    await db.insert(cartItems).values({ cartId, productId, qty })
      .onConflictDoUpdate({ target: [cartItems.cartId, cartItems.productId],
                            set: { qty: sql`${cartItems.qty} + ${qty}` } });
    await db.update(products)
      .set({ stock: sql`${products.stock} - ${qty}` })
      .where(eq(products.id, productId));
  }),
  // Statically un-analyzable writes REQUIRE declaration, runtime-verified:
  merge: write({ touches: ['cart'] }, async (db, …) => {
    await db.execute(sql`/* gnarly CTE */`);
  }),
});
```

**No `touches` on `addItem`, no `invalidate()` in handlers.** The static pass (§11) extracts `{cart_items→cart, products→product}` from the AST; calling `cart.addItem` _is_ the invalidation declaration. `invalidate()` survives only as a linted escape hatch for external-system effects (e.g., a Stripe webhook changing data Jiso should refresh).

**Request lifecycle (normative):**

```
parse+coerce input (schema) → guard chain → BEGIN tx → handler (receives Tx-typed db;
escaping the tx is a type error) → COMMIT → re-run invalidated queries (post-commit,
same request context) → render <fw-query>/<fw-fragment> → respond
                                    ↘ on fail(): ROLLBACK → typed error fragment, 422
```

This ordering closes the read-your-writes hazard: responses can never render pre-commit data (which would visibly revert the user's optimistic update).

**Guards:**

```ts
export const adminRefund = mutation('admin/refund', { guard: role('admin') /*…*/ });
// composable: guard: all(authed, rateLimit({ per: 'session', max: 10 }))
// static audit: `fw explain --unguarded` lists every mutation reachable without `authed`
```

### 10.4 Optimistic updates

Optimism is keyed to **queries** (the data), never islands. One transform per (mutation × invalidated query); every island consuming the query updates from it — including islands written after the mutation (Constitution #2).

**Hand-written (v1):** transforms are authored in the mutation file as pure `(data, input)` functions against the query's inferred result type — the same IR derivation will later emit. **Explicitly deferred:** `'await-fragment'` documents "considered; 1-RTT latency accepted here."

**Derived (v2, preferred once available):** for writes whose dataflow is closed over `{mutation input, schema constants, data the query already ships}` and queries within the shape grammar `{scalar-from-keyed-row, COUNT, SUM(arith), jsonAgg, filtered-COUNT, membership transitions}`, the compiler generates the transform (full derivation algebra in §10.5). Because hand-written transforms share the IR, v2 adoption is incremental: deleting a hand-written transform lets derivation take over, pair by pair.

```ts
// generated/optimistic/cart.add.ts (v2) — DO NOT EDIT (override in cart.mutations.ts)
export const derived = {
  [cartQuery.key]: (cart, $input) => {
    const r = cart.items.find((i) => i.productId === $input.productId);
    if (!r) cart.count += 1;
    if (r) r.qty += $input.quantity;
    else cart.items.push({ productId: $input.productId, qty: $input.quantity, pending: true });
  },
  [productQuery.key(($i) => ({ id: $i.productId }))]: (p, $input) => {
    p.stock -= $input.quantity;
  },
} satisfies OptimisticFor<typeof addToCart>;
```

**Runtime protocol:** snapshot affected query values (`structuredClone` — safe by the `JsonValue` constraint) → apply transforms to the shared query values and run their update plans (all dependent islands update at once; affected islands get `fw-pending` + `aria-busy` automatically) → on success, `<fw-query>`/morph reconciles over the prediction (right guess ⇒ near-no-op; wrong guess ⇒ silent correction) → on error, restore snapshots, render error fragment.

**Concurrency:** a per-query pending-transform log; arriving server truth is morphed in, then still-pending transforms re-applied in order (rebase). Safe because transforms are pure `(data, input)` functions. Mutations needing serialization declare `queue: 'cart'` (named FIFO). Navigation is a free reconciliation point: in-flight requests complete via `keepalive`, the log dies with the document.

### 10.5 Derivation algebra (v2 — summary)

> **Phasing note:** everything in this subsection ships in v2 (see §14). It is specified now because the v1 transform IR, query shape inference, and runtime rebase protocol are designed to be derivation-compatible — v1 must not paint v2 into a corner.

```
Stage 1  write  →  symbolic row-effects
         value ::= Param(path) | Const | ColRef(t.c) | Arith(op,v,v) | Opaque
         effect ::= INSERT{vals} | UPDATE{match, sets} | DELETE{match} | UPSERT{…}
         (match = eq-predicates on keys; ranges/server-time ⇒ Opaque match ⇒ punt)

Stage 2  query  →  shape mapping
         field ::= Scalar(keyed row col) | COUNT(R[, pred]) | SUM(R, arith)
                 | AGG(R, projection)    where R = rowset(filter chain, key, orderBy)

Stage 3  push effect through shape  →  JSON-patch program over client data
         INSERT × AGG   ⇒ push (defaults from schema; Opaque cols ⇒ tempId()/now()
                          placeholders, pending-styled, content-matched on reconcile;
                          orderBy decides insertion point — Opaque orderBy col ⇒ punt)
         UPSERT × AGG   ⇒ find-then-update-else-push (branchiness reproduced client-side)
         DELETE × COUNT ⇒ −(matched count, computable iff client holds rows)
         DELETE × SUM   ⇒ −Σ contribution iff query also ships the rows; else punt
         SET on filtered col ⇒ membership transition: Const vs filter ⇒ exit derivable,
                               entry punts (client lacks the row's other columns)
         row possibly outside client's rowset ⇒ emit guard (find-or-no-op), not punt

PUNT (all-or-nothing per field; wrong predictions are worse than none):
  Opaque SET (SQL functions, subqueries, server computation) · non-key match predicates ·
  window functions / GROUP BY+HAVING / DISTINCT in shape · interprocedural opacity
  (external packages receiving db — FW406 sites) · params untraceable to input/session-key
```

Every punt is named in `fw explain --optimistic` with the exact expression and reason. **Soundness is property-tested:** for derivable pairs, generated-state tests assert `patch(clientShape(s), i) ≡ clientShape(apply(effect, s, i))` — the commuting diagram is the deriver's test suite.

### 10.6 Exhaustiveness

Per mutation, coverage = invalidated-query set (derived) × status. Ships in v1; the valid statuses in v1 are `hand-written` and `await-fragment`:

```
fw check optimistic
mutation cart/applyCoupon:
  cartQuery.items      hand-written ✓
  cartQuery.subtotal   hand-written ✓
  cartQuery.discount   UNHANDLED ⚠ FW310
     → hand-write in cart.mutations.ts, or declare 'await-fragment'
```

In v2, `derived ✓` joins the status set and punts report their reasons inline (e.g. `PUNTED (Opaque: compute_discount)`).

Forgetting an optimistic update is a visible, suppressible diagnostic with the suppression recorded in source — never a silent UI inconsistency.

---

## 11. Static Analysis & Verification

### 11.1 Touch-set extraction (the static pass)

Rests on one property: **Drizzle's table argument is always an imported identifier with a statically known declaration site.**

```
For each write() body (ts-morph over the program):
  1. Find CallExpressions where callee.name ∈ {insert, update, delete}
     AND receiver's TYPE originates in drizzle-orm        ← type identity, not variable names;
                                                            renames/destructuring irrelevant
  2. Resolve argument 0:
     A. imported identifier        → follow symbol → pgTable declaration   (90%+)
     B. namespace/re-export chains → getAliasedSymbol loop
     C. alias(T, …)                → recurse on T
     D. conditional initializer    → union both branches (over-approximation is safe:
                                     missing = bug, excess = warning)
     E. runtime-flowing value      → 'unresolved' → FW406 (manual touches REQUIRED there)
  3. Interprocedural: helpers receiving a Drizzle-typed value are summarized bottom-up
     (memoized fixpoint); calls into node_modules with a db arg → FW406.
     `update…from(R)` / `insert…select` contribute R to the READ set, not touches.
  4. Parameterized keys: extract eq(T.keyCol, expr) from .where(); expr traceable to a
     write param ⇒ key derivation recorded; ranges/IN ⇒ table-level (FW409 notice).
```

Output is **committed and reviewable** — invalidation-graph changes appear as diffs in code review:

```ts
// generated/touch-graph.ts — DO NOT EDIT
export const touchGraph = {
  'cart.addItem': {
    touches: [
      { domain: 'cart', via: 'cart_items', site: 'cart.domain.ts:8', keys: null },
      { domain: 'product', via: 'products', site: 'cart.domain.ts:12', keys: 'arg:productId' },
    ],
    unresolved: [],
  },
} as const;
```

### 11.2 Runtime verification (belt and suspenders)

Dev server and the test harness wrap `db`; every executed statement is parsed (`pgsql-ast-parser`) and checked. Static over-approximates (all branches); runtime under-approximates (executed branches). **Invariant: `observed ⊆ static ∪ FW406-annotated`** — violation means analyzer bug or smuggled SQL; either is a CI failure. Read-side gets identical treatment (query loaders' SELECT/JOIN tables vs. derived read sets).

### 11.3 Diagnostic codes (registry)

| Code  | Severity   | Meaning                                                                           |
| ----- | ---------- | --------------------------------------------------------------------------------- |
| FW201 | error      | Closure captures unserializable value (shows lowering + fixes)                    |
| FW210 | lint       | Anonymous handler — name it for stable identity                                   |
| FW301 | lint       | Server fact in island-local state                                                 |
| FW310 | warn       | Invalidated query lacks optimistic transform (write/defer; v2 adds derive)        |
| FW320 | lint       | Event payload overlaps query data — use a transform                               |
| FW330 | lint       | Direct db access in a mutation handler — route through domain                     |
| FW402 | error      | Write touched an undeclared domain (silent stale UI)                              |
| FW403 | warn       | Declared domain never observed written (stale claim / untested branch)            |
| FW404 | error      | Write to unmapped table (map it or mark `exempt`, e.g. append-only logs)          |
| FW405 | warn       | Conditional writes on branches never executed under instrumentation               |
| FW406 | warn/error | Statically un-analyzable write site — manual `touches` required, runtime-verified |
| FW407 | error      | Query read from undeclared domain (missed invalidations)                          |
| FW408 | error      | Declared row key ≠ observed row predicate                                         |
| FW409 | notice     | Non-eq predicate — degraded to table-level invalidation                           |

### 11.4 The verification surface (the Keppo contract)

For a Jiso app, the following are checkable **without executing a browser**:

1. TypeScript static checking — all wiring (handlers, forms, targets, bindings, transforms, guards).
2. `fw check` — touch-graph consistency, optimistic exhaustiveness, fixpoint invariant, unguarded-mutation audit.
3. Graph queries over `fw explain` output — intent-level assertions ("every component displaying cart data is refreshed by cart/add") as set operations over printed, stable-format graphs.
4. Property suite — prediction ⊆ eventual-truth generative tests over hand-written transforms; v2 adds derivation soundness (commuting diagrams).
5. HTTP-level integration tests — mutations as request/response assertions against pglite (real Postgres semantics, in-memory, no container).

Browser tests are a first-class part of the **framework's** own suite — no pretense otherwise: morph runs on every mutation response, and its survival contract (focus, caret, scroll, transitions) plus L0 platform behaviors are irreducibly browser-bound. The reconciliation suite splits accordingly: a browser-free structural property suite (`morph(a, b) ≡ b` with keyed-node identity preserved — runs in jsdom-class DOM), and a named browser suite for the survival contract. The pitch is narrower and honest: **application wiring is proof-carrying**, so apps need few or no browser tests of their own — most SPA testing exists to compensate for unverifiable wiring, and Jiso removes that category, not testing itself.

---

## 12. Testing API

```ts
import { jisoTest } from '@jiso/test';

jisoTest('cart mutations', async ({ exec, page, db }) => {
  await db.seed({ products: [{ id: 'p1', stock: 5 }] });

  // mutations as functions — touch-checking automatic on every exec
  const res = await exec(addToCart, { productId: 'p1', quantity: 2 });
  expect(res.queries.cart.count).toBe(1);
  expect(res.queries.cart.items[0].qty).toBe(2);

  // typed error paths
  const fail = await exec(addToCart, { productId: 'p1', quantity: 99 });
  expect(fail.error.code).toBe('OUT_OF_STOCK');

  // wire-level: render a page, assert HTML, no browser
  const html = await page('/cart');
  expect(html.fragment('cart-badge')).toContain('data-bind="cart.count"');
});

// transform soundness: prediction ⊆ eventual truth over generated states
// (v2: generated alongside derived transforms as the commuting-diagram suite)
propertyTest(addToCart, cartQuery); // patch∘shape ≡ shape∘apply over generated states
```

Handlers unit-test as `(event, ctx)` functions; transforms as pure `(data, input)`; the wire as HTTP.

---

## 13. Open Design Areas (named, not hand-waved)

These ship with v1 only if resolved; otherwise they are explicitly punted with documented workarounds.

**13.1 CSS.** Direction: compiler-extracted co-located CSS, each component's rules wrapped in `@scope` keyed to its host (dashed tag or `[fw-c=…]` stamp; donut-scoped so nested islands are excluded), deduped into one per-page stylesheet with critical CSS inlined. Design tokens are ordinary custom properties — no boundary to cross. Scoping is a compiler-enforced convention, not an encapsulation wall: external/theming CSS is just CSS. Must solve: extraction/dedupe pipeline, style delivery for late-arriving fragments (§9.1) and `<fw-defer>` streams, theming contract, `@scope` fallback for older engines (tag-prefixed selector rewrite). **Status: needs a design pass before v1 freeze — materially smaller since dropping shadow DOM (no FOUC waterfall, no per-root stylesheet plumbing).**

**13.2 Lists at scale.** Template stamps cover insertion; required design: cursor pagination flowing through URL params, infinite scroll as fragment appends, keyed reordering under simultaneous optimistic updates + morphing (stable-key contract between stamps and morph).

**13.3 Streaming details.** `<fw-defer>` exists (§8); remaining: priority hints between deferred fragments, query-JSON placement guarantees under HTTP/1.1 fallbacks.

**13.4 Persistent cross-navigation elements.** Position: **Jiso does not support media/state surviving real navigations in v1.** Documented escape hatches (SharedWorker for sockets, popout windows for players) rather than a half-iframe architecture. Revisit if the platform ships pagewide persistent elements.

**13.5 Adopt-don't-invent list:** head/meta (typed per-route `meta()` from queries), file uploads (`s.file()` + multipart + pending-mechanism progress), per-island error boundaries, sessions as a typed schema, i18n (server-rendered message catalogs — easier than SPA i18n), rate limiting as guard middleware.

---

## 14. Data-Layer Strategy & Roadmap

Jiso-core defines a **capability interface** — `(writes → touch sets, queries → read sets + result types + instance keys)` — not a portability promise. Adapters implement what they can; the floor is universal.

| Stage            | Ships                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Mechanism                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| **v1**           | Core model: domain layer with declared `touches` (#3) + flat tags as low-ceremony on-ramp (#2) + `invalidate()` escape hatch (#1, linted)                                                                                                                                                                                                                                                                                                                                                                    | Works with ANY data access                                                         |
| **v1 (blessed)** | `@jiso/drizzle`: touches **inferred** from ASTs, schema-as-registry, query shapes/keys derived; optimism hand-written against the transform IR (§10.4)                                                                                                                                                                                                                                                                                                                                                       | Postgres-first via Drizzle; MySQL/SQLite conformance deferred to late hardening    |
| **v1.5**         | Verification layer: runtime instrumentation as CI honesty check (FW402–409); unified typed change record `{domain, keys, input}` feeding optimism now and the v2 live bus later (CQRS's payload without its architecture)                                                                                                                                                                                                                                                                                    | pglite harness                                                                     |
| **v2**           | **Derived optimism**: compiler-generated transforms via the §10.5 algebra, property-tested soundness, named punts; supersedes hand-written transforms pair by pair. **Live queries (L4)**: `<fw-live>` over SSE, guard-recheck-per-push, in-process/Redis bus — the design's first stateful infrastructure, deferred until something needs it. CDC adapter (Postgres logical replication / Supabase Realtime) as live-query transport + the answer to out-of-band writes (cron, admin tools, other services) | Derivation over the pinned Drizzle subset; live/CDC opt-in, per `live: true` query |
| **v3**           | Full runtime read/write tracking (Convex-style precision) **only if** a managed data product exists; never the default — it trades static printability away                                                                                                                                                                                                                                                                                                                                                  | Conditional                                                                        |

**Drizzle coupling, managed:** the extraction pass targets a pinned, conformance-tested subset of Drizzle's surface (tables as first-argument identifiers); the suite fails loudly on API drift. Raw SQL is a marked second-class citizen (FW406 annotation + runtime verification, excluded from derived optimism) — acceptable if the seam is visible, and it is.

---

## 15. Risks & Honest Costs

| Risk                                                        | Mitigation / Position                                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Chromium-led enhancements (speculation rules, invokers)     | Graceful degradation is structural; baseline is a working website                                                                           |
| Cold-cache first-interaction latency                        | `modulepreload` from rendered attributes, 103 Early Hints, HTTP/3; measure, don't hide                                                      |
| Drizzle API drift breaks inference                          | Pinned conformance suite; declared-`touches` floor always works                                                                             |
| Over-invalidation storms (coarse domains)                   | Row-level keys via schema annotations; FW403 surfaces excess                                                                                |
| `derive`/shared-client-state creep toward SPA heap          | Lints with required justifications; isomorphic opt-in as the sanctioned escape                                                              |
| Derived-optimism wrong predictions (v2)                     | All-or-nothing derivation; property-tested soundness; punts are loud; deferred to v2 so v1 ships the proven hand-written path first         |
| Two-file IR + explicit data channels feel austere vs. React | Single-file sugar + editor tooling (cheap because everything is static); day-100 > day-1                                                    |
| Query-binding layer moves some rendering clientward         | Bounded: paths/stamps/named derives only — a compiled update plan, no runtime signal graph; complex rendering flips to fragments/isomorphic |
| Live bus introduces stateful infra                          | Deferred to v2 wholesale — the v1 server is stateless; BroadcastChannel + refetch-on-focus cover the interim (§9.3)                         |
| Prerender discards cost server renders                      | Off by default; per-route opt-in where renders are idempotent, plus response caching                                                        |

---

## 16. Success Criteria (v1)

1. **Perf:** TTI ≡ FCP on first load (no hydration gap); prerendered navigations render in <50ms perceived on routes that opt in; zero session-length memory growth across 100 navigations.
2. **Legibility:** a developer who has never seen the codebase can identify what any button does, what data any island holds, and what any mutation changed — from devtools alone — in under a minute. (Run this as an actual usability study.)
3. **Verifiability:** the demo app's full behavior surface passes TypeScript static checking + `fw check` + graph assertions with **no app-level browser tests** — browser testing lives in the framework-owned L0 and morph-survival suites; an agent given only `fw explain` output answers "what updates when X is clicked" with 100% accuracy.
4. **Constitution holds:** fixpoint CI green; no feature shipped without an authorable lowering; `grep -r "invalidate(" app/` returns only documented escape-hatch sites.
5. **Coverage:** every (mutation × query) pair in the reference commerce app has an explicit optimistic status — hand-written transform or declared `'await-fragment'` — with zero unhandled FW310s. (The v2 target: derivation handles ≥70% of pairs, every punt naming its reason.)

---

## Appendix A: Worked Example — End-to-End "Add to Cart"

One feature traversing every layer:

```
schema.ts          products(domain:'product', key:id), cart_items(domain:'cart')
cart.domain.ts     cart.addItem — upsert cart_items + decrement products.stock
                   ⇒ touch-graph: {cart, product:productId}            [STATIC, §11.1]
cart.queries.ts    cartQuery (count, jsonAgg) reads {cart, product}    [JOIN = declaration]
cart.mutations.ts  addToCart: guard authed, schema input, OUT_OF_STOCK error
                   ⇒ invalidates {cart, product:productId}             [DERIVED]
                   ⇒ optimistic: 2 transforms                          [HAND-WRITTEN, §10.4;
                                                                        derived in v2, §10.5]
product.tsx        <f.Form> — fields type-checked & completeness-checked vs schema
cart-badge.tsx     fw-deps="cart", data-bind="cart.count"              [no code for updates]

USER CLICKS (JS loaded):  snapshot → badge ticks instantly (fw-pending) →
  POST /_m/cart/add (FW-Targets from live DOM) → tx commits →
  <fw-query name="cart"> + <fw-fragment target="recommendations"> →
  morph reconciles (no-op if prediction was right)

USER CLICKS (no JS):      form POSTs → redirect → fresh page. Same handler.

TEAMMATE, NEXT MONTH:     ships <mini-cart> with queries:{cart} —
  it is optimistically updated by every cart mutation ever written. Nothing to remember.
```

## Appendix B: Name

"Jiso" — short, pronounceable, no known collisions in the framework space. Pre-launch: trademark screen, domain (jiso.dev), npm scope `@jiso`, and the usual Placek-style linguistic screen across major markets.
