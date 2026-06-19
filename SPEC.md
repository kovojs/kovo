# Kovo — Technical Specification

**Version:** 0.2 (Draft)
**Status:** Normative specification for v1, with staged roadmap through v3
**Audience:** Framework implementers and AI app-builder integrators

---

## 1. Vision

Kovo is a web-platform-native framework for building multi-page applications that are **interactive at first paint, legible at every layer, and statically verifiable end-to-end.**

It composes ideas from prior systems (Qwik, htmx/LiveView, RTK Query, Replicache; full prior-art table in the README) around one organizing constraint: _every artifact the system produces (compiled output, HTML, wire traffic, dependency graphs) must be readable by a human in devtools and checkable by a machine without executing a browser._

### 1.1 Thesis statement

> An application's complete behavior — every handler wiring, navigation target, form field, mutation contract, data dependency, and optimistic prediction — should be provable by TypeScript static checking plus static graph queries, and auditable by reading the page source and the Network panel.

### 1.2 Design driver: machine-auditable generation

Kovo is built to be the most machine-auditable compilation target a code-generation agent can emit: generated apps fail TypeScript static checking if wiring is wrong, and intent is verifiable against printed dependency graphs without headless browsers. Where a design choice trades author convenience for machine-checkability, machine-checkability wins. The corollary holds for every reader, not just agents: debugging always proceeds _down_ into plainer code, never _up_ into compiler internals.

### 1.3 Explicit non-goals

- **Figma-class shared-workspace apps.** Long-lived client sessions over one mutable heap (collaborative canvases, video editors, DAWs) are outside the sweet spot. Kovo islands can host rich widgets, but the framework will not grow a client router or global client store to serve this segment.
- **Offline-first.** Server truth is unconditionally authoritative; Kovo does not ship a sync engine.
- **App-authored persistent navigation state** in v1. Enhanced navigation may preserve unchanged compiler-stamped layout DOM when JS is present (§8), but the canonical behavior is still real URLs and server-rendered documents.
- **Browser support parity for enhancements.** Speculation Rules and invoker commands are Chromium-led; Kovo degrades gracefully (real navigations, real forms) but does not polyfill them.
- **A sanctioned JSON/REST public API in v1.** Typed public APIs need their own token-auth and schema-reuse story. Until that exists, ad-hoc JSON APIs live only behind declared `endpoint()` entries (§9.1), where their auth and CSRF posture stay visible to audits; `respond.json()` is not a route outcome.

---

## 2. The Constitution (Design Tests)

Every feature proposal is evaluated against five tests. A feature failing any test is redesigned or rejected. These are normative.

| #   | Test                                                                                                                                                                                                                                                                                                                                                   | Consequence                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Legibility is load-bearing.** Names appear in HTML attributes and wire traffic, so they structurally cannot be mangled.                                                                                                                                                                                                                              | Minifiers cannot rename handler exports; debugging never requires decompiling the framework.                                                                                                                 |
| 2   | **No global knowledge at local sites.** Any API requiring the author to enumerate distant call sites from memory is a bug factory and is rejected.                                                                                                                                                                                                     | Killed manual fragment targets, manual per-island optimism, query-side mutation registration.                                                                                                                |
| 3   | **Sugar must lower to authorable IR.** Every compiler feature emits valid Kovo source. Compiling the output is a no-op (CI-enforced fixpoint).                                                                                                                                                                                                         | Output is auditable in devtools and mechanically checked; app authors still write TSX.                                                                                                                       |
| 4   | **The wire is the documentation.** Named POSTs and schema-shaped JSON in every environment; full self-describing HTML fragments in dev. In prod the framework may ship size-optimized deltas (change-record-scoped query JSON, keyed-row fragment updates) — still named and schema-shaped, but incremental against a version-validated base (§9.1.1). | A dev frame is a complete document auditable from the Network panel; a prod frame shows _what changed_, with the full value reconstructable via `kovo explain`. Names are never mangled in either mode (#1). |
| 5   | **Server truth always wins.** No client cache to invalidate; reconciliation is "morph the authority in."                                                                                                                                                                                                                                               | Optimistic predictions are disposable; there is no consistency protocol.                                                                                                                                     |

---

## 3. Architecture Overview

```
                        AUTHORING                    COMPILED IR                  RUNTIME
┌──────────────────┐   ┌──────────────────────────┐   ┌──────────────────────────────────┐
│  cart.tsx        │   │ cart.server.js           │   │ Self-describing HTML             │
│  (JSX, inline    │──▶│   render fns, queries    │──▶│  • plain elements, kovo-c stamps   │
│   closures,      │   │ cart.client.js           │   │  • on:click="cart.js#Cart$remove"│
│   single file)   │   │   named handler exports, │   │  • <script kovo-query="cart"> JSON │
│                  │   │   derives, transforms    │   │  • kovo-deps="cart" stamps         │
└──────────────────┘   └──────────────────────────┘   └──────────────────────────────────┘
        │                        │                                  │
        │ fixpoint:              │ 1:1 file mapping,                │ 8KB loader: global event
        │ compile(IR) ≡ IR       │ source-derived names             │ delegation + import() on
        ▼                        ▼                                  ▼ first interaction
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ MPA SPINE: real URLs + server documents + optional enhanced navigation over the full-doc │
│ oracle + Speculation Rules + cross-document View Transitions + bfcache. No client router.│
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ DATA PLANE: queries (typed reads) ← invalidation graph → mutations (typed writes)        │
│ derived from domain layer / Drizzle AST. Optimistic transforms may be hand-written        │
│ or compiler-derived.                                                                     │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ WIRE: one fragment/query-JSON vocabulary, transport-agnostic:                            │
│ document load · enhanced fetch (mutations) · SSE live queries                            │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Rejected from prior art

Client-owned routers and SPA navigation state; hydration; hash-named heuristic chunks; load-bearing semantic optimizer; single global state blob; **runtime signal graphs in the core client — proprietary or TC39** (the client dependency graph is compile-time-known, so the compiler emits a per-query update plan instead; Signals interop is outside the core client); opaque closure capture (`useLexicalScope`); client-side cache with invalidation lifecycle; manual invalidation calls as the primary mechanism; **shadow DOM** (tree-scoped IDREFs, form participation, and ARIA all break at the boundary — fatal to L0 platform behaviors and the no-JS form contract; style scoping comes from the compiler instead, `plans/open-design-areas.md`); **custom-element registration** (resumability comes from delegation + `import()`, never from `customElements.define`; component identity is the `kovo-c` stamp, dashed tags survive as inert sugar, and native hosts like `<tr kovo-c="cart-row">` avoid the table-nesting problem); **load-bearing import maps** (the compiler and server emit full module URLs with cache-busting they control; import maps remain an optional deployment strategy); **portals and runtime context APIs** (composition is lexical at render time and the DOM tree is the runtime context, §4.5 — framework code never reparents islands, so `closest('[kovo-c]')` resolution stays sound; native top-layer promotion (`<dialog>`, popover) does not reparent, which is exactly why no portal is needed). Enhanced navigation (§8) is not a client router: it starts from a real `<a href>`, fetches the canonical server document, and falls back to the browser's full GET on uncertainty.

---

## 4. Component Model & Authoring

### 4.1 Anatomy of a component

```tsx
// cart-badge.tsx — what you write
import { component } from '@kovojs/core';
import { cartQuery } from './cart.queries.js';

export const CartBadge = component({
  queries: { cart: cartQuery }, // typed data dependencies
  state: () => ({ bouncing: false }), // LOCAL state: UI-only facts, JsonValue-constrained

  render: ({ cart }, state) => (
    <button
      commandfor="cart-drawer"
      command="show-modal" // L0: platform behavior, zero JS
      class={state.bouncing ? 'bounce' : ''}
    >
      🛒 <span>{cart.count}</span> {/* compiler derives data-bind="cart.count" (§4.8) */}
    </button>
  ),
});
```

`component()` accepts the definition object only. The author never supplies a component name string:
the compiler derives the DOM wire leaf from the exported binding (`CartBadge` -> `cart-badge`) and the
registry/type key from the module path plus that leaf (`components/cart-badge/cart-badge`). This is the
component-name application of the §4.8 rule that TSX does not require strings the compiler can derive.
Implementation sequencing for the 2026-06-16 migration is tracked in `plans/name-derivation.md`.

Query-backed components are ordinary live refresh candidates: a component with `queries` gets
`kovo-deps` and a derived fragment target when the compiler can prove the root is addressable and
the subtree can be reconstructed from declared query data plus serializable stamped props. App
authors do not write `fragmentTarget: true` or `kovo-fragment-target="..."`; those are derived IR
facts. The component-level escape hatch is force-off only: `disableServerRefresh: true` opts a
query-backed component out of server fragment refresh while preserving query bindings and local
client updates. There is no force-on mode.

**Rules enforced by the type system:**

- `state` must satisfy `JsonValue` (no `Date`, `Map`, functions, class instances) — serializability is a compile error, not a runtime surprise.
- A query-backed component that is inferred as server-refreshable has render inputs ⊆ (declared queries ∪ stamped props); otherwise the compiler emits a diagnostic explaining why the target cannot be reconstructed, while §4.8 plan-covered positions may still update from query JSON.
- Repeated or prop-keyed inferred targets need stable instance identity from authored `key` or serializable keyed component props; duplicate or ambiguous target identities are compile errors.
- Query data is **shared and server-owned**; local state is **private and client-owned**. A lint (`KV301`) rejects server facts in local state.

### 4.2 Rendered output (the IR's runtime form)

```html
<cart-badge kovo-deps="cart" kovo-fragment-target="cart-badge">
  <button commandfor="cart-drawer" command="show-modal">
    🛒 <span data-bind="cart.count">2</span>
  </button>
</cart-badge>

<!-- Query data ships ONCE per page, as shared client data -->
<script type="application/json" kovo-query="cart">
  { "count": 2, "items": [{ "productId": "p1", "qty": 2, "unitPrice": 1499 }] }
</script>
```

Components render to **light DOM** as plain, never-registered elements — no shadow roots, no `customElements.define`, no upgrade step (rationale in §3.1). The load-bearing DOM identity is the derived `kovo-c` leaf; the compiler omits it when the host tag already spells the derived leaf (`<cart-badge>` — dashed tags are inert sugar) and emits it on native hosts (`<tr kovo-c="cart-row">`, so table content-model nesting works). Query-backed server-refreshable roots also carry a derived `kovo-fragment-target`; for singleton components this is the DOM leaf (`cart-badge`), while repeated instances append stable authored identity (`product-form:p2`). Registry and type identities are separately namespaced by module path (§6.1), so global uniqueness never lengthens the ordinary DOM leaf. If two distinct registry keys would put the same DOM leaf on one page, the composition pass derives a stable disambiguated `kovo-c` value from the registry key and reports it through component explain output; fragment target identities use the same disambiguated leaf before any instance suffix. StyleX-authored component styles compile to globally collision-free atomic classes and dedupe into declared stylesheet assets; raw co-located CSS remains an escape hatch scoped to the derived host leaf (`@scope`, donut-scoped out of nested islands) (§13.1). With no shadow boundary, IDREF wiring (`commandfor`, `for`, `aria-*`), native form participation, and find-in-page work document-wide — the L0 layer and no-JS form fallback depend on it. The compiler validates JSX nesting against the HTML content model (**KV225**): markup the parser would re-parent (`<div>` in `<p>`, `<tr>` outside a table) makes served HTML and parsed DOM disagree, silently breaking morph identity and fragment targets — a compile error, not a runtime surprise.

Everything is inspectable in the Elements panel: dependencies (`kovo-deps`), data (the JSON), behavior (`on:*` attributes), pending mutations (`kovo-pending`, §10.3).

### 4.3 Handlers and closures

You author inline closures; the compiler lowers them (§5). The lowered form is the contract:

```tsx
// Authoring (sugar)
<button onClick={() => removeItem(state, item.id)}>×</button>
```

```js
// cart.client.js — GENERATED, but valid authorable Kovo source
import { handler } from '@kovojs/browser';

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

**Capture channels (exhaustive):** component/query state (via `ctx`), element params (`data-p-*`, typed — attribute values arrive as strings, so non-string params declare coercion once, schema-style, exactly like form fields §6.3), module scope (shared, not captured). Anything else is compile error `KV201`, whose message shows what the closure _would have_ compiled to and the three fixes.

### 4.4 The loader

An 8KB gzip-capped inline script; nothing else lives in the always-loaded path. Responsibilities:

- **Event delegation** (capture phase) for all `on:*` events — including chained refs (§4.6) and the execution triggers `on:visible` (one shared IntersectionObserver) / `on:idle` / `on:load` (§4.7).
- **Ref resolution:** parse `url#export`, `import()` the URL, invoke with `(event, ctx)`.
- **Per-island `AbortSignal`** (`ctx.signal`), aborted when the morph layer removes the island (§4.7); no mount/unmount callbacks.
- **Enhanced form interception** (§9) and **query-data hydration** from `kovo-query` scripts.
- **Update plan** (bindings → derives → stamps, §4.8) on query/state change, by walking the self-describing attributes.
- **Refetch on focus/visibility** over the typed read endpoint (§9.3, §9.4).
- **Morph application:** the morph layer accounts for islands it patches in and aborts the signals of those it removes — nothing is registered.

### 4.5 Composition: children, slots, layouts

Composition is **render-time function composition** — there is no client re-render, so projection happens exactly once, on the server. Three rules:

**1. Children are a render-time value.** JSX children lower to an opaque `Html`-typed argument; named slots are just named `Html`-typed props. The lowered IR is a plain function call — fixpoint-trivial:

```tsx
export const Card = component({
  render: (_, state, { children, footer }) => (
    <div class="card">
      {children}
      <div class="card-footer">{footer}</div>
    </div>
  ),
});

// call site — lowers to Card.render(…, { children, footer })
<Card footer={<Totals />}>…</Card>;
```

**2. Compound components coordinate through lexical scope and the DOM — there is no context API.** At render time, sub-parts are functions sharing scope (a `Dialog.Root` generates ids and passes them down as ordinary arguments; KV221 validates the IDREF wiring). Ids are **unique by construction**: generated ids are keyed to the render site, and a static `id` in a component the compiler cannot prove renders at most once per page is **KV224** (derive it from `kovo-key`/props instead) — KV221 proves an id _exists_; KV224 keeps that proof meaningful by forbidding duplicates, including under list stamping and fragment patch-in. At runtime, the tree is the context: a sub-part's handler resolves its island via `closest('[kovo-c]')`, which `ctx` already does. This is sound because **framework code never reparents islands** (normative; dev mode asserts it). Native top-layer promotion (`<dialog>`, popover) does not reparent — exactly why Kovo needs no portal.

**3. Refreshable-target children must remain server-renderable.** An inferred server-refreshable
query component's subtree must be reconstructible from (declared queries ∪ stamped props) — and
call-site children are part of that subtree. They are therefore **lowered to component references**:
the compiler hoists JSX children into a named component (`Parent$slot_children`) when their free
variables fit the stamped-prop channels (the same lowering discipline as handlers, §4.3), records
the reference + props in the target's stamps, and re-renders the full subtree on fragment patch.
Children that cannot be hoisted (unserializable captures) are compile error **KV230**, whose message
shows the hoisted component that _would have_ been generated and the fixes. If the component has
`disableServerRefresh: true`, the hoist requirement applies only to positions that still need a
server fragment; ordinary §4.8 query bindings remain valid. Morph-preserved "slot holes" were
considered and **rejected**: a fragment response must fully describe the DOM it produces
(Constitution #4, #5) — there is no region the server cannot refresh. This "fully describes"
property is literal in dev, where the fragment is complete HTML. In prod the framework may refresh
the same region with a **delta** instead — a change-record-scoped query update the client applies
through the update plan (§4.8), or keyed-row fragment updates — against a version-validated base
(§9.1.1), when that is smaller. The delta is bounded by what the committed write touched, never by
diffing against client state the stateless server would have to remember; soundness shifts from
self-description to change-record scoping plus base-version validation (a missing or stale base
refetches full, §9.1.1). The server's _capability_ to refresh any region is unchanged, so the
rejection of slot holes stands: a prod delta still accounts for the entire target subtree, just
incrementally.

**Layouts are first-class route chrome.** v1 has explicit `layout()` declarations,
not a file-system route-tree convention. A layout is still render-time function
composition over `children`, but authors attach it to routes instead of wrapping
every page by hand:

```tsx
const ShellLayout = layout({
  render: (_queries, _state, { children }) => <Shell>{children}</Shell>,
});

route('/', {
  layout: ShellLayout,
  page: () => <ProductPage />,
});
```

Layouts may be nested with an explicit `parent`, may declare `queries`, `guard`,
and per-segment `boundaries`, and are shown by `kovo explain page <path>
--layouts`. They are page chrome, not document assembly; documents are owned by
the request shell (§9.5). Runtime persistence is not part of v1: every navigation
still renders a full document, so later enhanced-navigation layers must preserve
the same authored layout declarations.

Route pages that return JSX are **compiler-processed Kovo source**, not opaque runtime JSX. The
compiler lowers the route page into authorable server IR, records the component calls and
serializable props, runs the declared component queries for the initial document, and emits the
live-target registry used by enhanced mutation responses (§9.1). Dynamic route composition that
cannot be scanned receives a diagnostic rather than falling back to app-authored fragment routing.
Every navigation is a full document, so there is no persistent-layout state to manage;
cross-document View Transitions carry the visual continuity. A route-tree convention may arrive
later as sugar lowering to exactly these calls (Constitution #3).

**Payload posture:** projected children ship in the initial HTML — all tab panels, dialog bodies, accordion contents. There is no client-side lazy mount; `<kovo-defer>` (§8) is the escape hatch for expensive subtrees. This is the MPA posture by design.

### 4.6 Primitive composition & attribute merging

Headless primitives decorate author-owned elements through three spellings of one mechanism: the primitive computes a plain, serializable attribute record (ARIA, `data-state`, `on:*` refs, ids) at render time, and it **merges into the author's element before emission**. The wire shows only the result — a merged element is indistinguishable from one written by hand (Constitution #3, #4) — and merging is deterministic (stable ordering), so the fixpoint and byte-stable IR hold.

**Attrs-function children (the normative IR):**

```tsx
<Tooltip.Trigger>
  {(attrs) => (
    <a {...attrs} href="/pricing" class="nav-link">
      Pricing
    </a>
  )}
</Tooltip.Trigger>
```

`attrs` is typed; this is the render-prop pattern minus its runtime cost, because there is no re-render. An `Html`-returning function whose `attrs` parameter goes unused is a lint.

**`asChild` (sugar lowering to the attrs-function form):** requires a single, statically-known element child; the compiler merges and emits. Dynamic or multiple children → teaching error pointing at the attrs-function form to write instead.

**Behavior attributes (trigger-shaped cases):** annotate instead of wrap — `<a href="/pricing" kovo-tooltip="pricing-tip">` — the invoker-commands idiom (`commandfor`/`command`) extended upward from L0; the package prefix comes from §6.1.1 and the IDREF is validated by KV221. This is also the only spelling that works on markup Kovo didn't render (CMS content, markdown).

**Rejected:** a polymorphic `as` prop — it composes only with intrinsic tags, and polymorphic typing is the heaviest TS pattern known (§15 type-perf risk) for the weakest payoff.

**Merge rules (normative).** Merging happens once, at render; conflicts resolve per attribute class:

| Attribute class                                                                | Rule                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `class`                                                                        | Concatenate (primitive first, author last), dedupe, stable order                                                                                                                                                                                                                                                        |
| `style`                                                                        | Concatenate; author declarations last (later wins per property)                                                                                                                                                                                                                                                         |
| `on:<event>`                                                                   | **Chain**: space-separated refs, author's first, then primitive's; the loader invokes left-to-right, sequentially awaited; `defaultPrevented` does **not** stop the chain (platform semantics) — primitive handlers contractually no-op when `event.defaultPrevented` (linted in the primitive package, not the loader) |
| `id`                                                                           | Author wins; the primitive rewires its IDREF references to the surviving id (KV221 validates the result)                                                                                                                                                                                                                |
| IDREF attrs (`commandfor`, `popovertarget`, `for`, `aria-controls`, …)         | Both set → **error KV231** (double-wired relationships are ambiguity, not composition)                                                                                                                                                                                                                                  |
| `aria-*`, `role`                                                               | Author wins, **lint KV232** (the escape hatch stays open; the override stays visible)                                                                                                                                                                                                                                   |
| `data-state` & primitive-owned `data-*` state attrs                            | Primitive wins, **lint KV232** (runtime-updated values; a static override would be clobbered on first state change)                                                                                                                                                                                                     |
| `data-p-*` (handler params)                                                    | Same param from both → **error KV231**                                                                                                                                                                                                                                                                                  |
| Binding attrs (`data-bind`, `data-bind:*`)                                     | Same target slot → **error KV233**; distinct targets compose                                                                                                                                                                                                                                                            |
| `disabled`, `aria-disabled`, `required`, `readonly`                            | Logical OR                                                                                                                                                                                                                                                                                                              |
| Other scalars (`type`, `href`, `tabindex`, `value`, `view-transition-name`, …) | Author wins; the primitive value is a default (used only when the author is silent)                                                                                                                                                                                                                                     |
| `kovo-deps`                                                                    | Union                                                                                                                                                                                                                                                                                                                   |
| `kovo-c`, `kovo-state`                                                         | Both present → **error KV231** (one element = one island)                                                                                                                                                                                                                                                               |

### 4.7 Execution triggers

"Execute nothing until interaction" is a proxy for the real invariant: **execute nothing the page didn't declare, and make every trigger legible in markup.** Interaction is the default trigger; three declared alternatives extend the same `on:*` → delegate → `import()` → named-export model:

```html
<sales-chart on:visible="/c/chart.client.js#SalesChart$mount" kovo-deps="sales"></sales-chart>
<search-index on:idle="/c/search.client.js#Search$warm"></search-index>
<stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
<!-- lint-gated -->
```

- **`on:visible`** — one shared IntersectionObserver; fires once on first intersection. Charts, maps, carousels, lazy embeds.
- **`on:idle`** — `requestIdleCallback`; warm-up work.
- **`on:load`** — fires at parse. The escape hatch: it reintroduces eager JS, so lint **KV211** requires a justification comment, and `grep 'on:load'` is the app's eager-JS budget.

The set is closed — `on:media` is CSS's job; timers belong inside handlers. Islands patched in by morph are observed like everything else (the morph layer already accounts for islands it patches in, §4.4).

**Lifecycle is one primitive:** `ctx.signal`, an `AbortSignal` aborted when the morph layer removes the island (or the document tears down). Long-running handlers (autoplay loops, map instances, observers) register cleanup on it; there are no mount/unmount callbacks.

### 4.8 The update plan: bindings, derives, stamps

**The DOM is the plan.** There is no separate compiled-plan artifact: binding attributes are self-describing, the loader executes them by walking the tree under `kovo-deps` islands, and compile-time knowledge is used for _typing_ only. When a query value — or island-local state; same machinery, two data sources — changes, the loader runs, in order:

**1. Bindings — path writes.** `data-bind="cart.count"` sets text content; `data-bind:<attr>` sets attributes (`data-bind:value`, `data-bind:hidden`). Grammar: dot paths plus optional segments (`deal.contact?.name`) — no expressions, no indexing (arrays are stamps' job). Paths type-check against the query's inferred shape (§6.2), and the check is **null-aware**: a path traversing a nullable or optional segment — the routine shape of leftJoin projections — must mark the traversal `?.`, or it is compile error **KV227**; rendering `undefined` is unrepresentable, not a runtime surprise. `?.` has defined empty semantics shared by the server renderer and the loader (the two must not disagree — the KV222 drift rule applied to nullability): a text binding renders the empty string; an attribute binding removes the attribute. Sugar lowers `{deal.contact?.name}` to exactly this form; item-relative stamp paths (`.contact?.name`) and `data-bind-list` paths follow the same rule. When empty-on-null is the wrong rendering, the KV227 fix menu is the usual ladder: extract a named derive that handles `null` explicitly, or make the projection non-null in the query itself (`coalesce`), keeping the binding total.

**2. Named derives — the expression layer.** A derive is a named, exported, pure function with declared inputs — exactly parallel to handlers:

```ts
// cart.client.js — authorable IR
export const Cart$isEmpty = derive(['cart'], (cart) => cart.count === 0);
```

```html
<button data-bind:disabled="/c/cart.client.js#Cart$isEmpty">Checkout</button>
```

Declared inputs tell the loader which query changes re-run it — no dependency tracking — and the module loads lazily on the first relevant change, preserving resumability. Inline JSX expressions in bound positions lower to named derives (the KV210 naming nudge applies). Minification cannot rename them (Constitution #1); `kovo explain component` lists every derive with its inputs.

**3. Template stamps — keyed list reconciliation.**

```html
<ul data-bind-list="cart.items" kovo-key="productId">
  <template kovo-stamp>
    <li><span data-bind=".qty"></span> × <span data-bind=".name"></span></li>
  </template>
  <li kovo-key="p1"><span data-bind=".qty">2</span> × <span data-bind=".name">Mug</span></li>
</ul>
```

On change, the loader keys existing `[kovo-key]` children against the new array: clone the template for inserts, remove exits, reorder by key, then run item-relative bindings (`.qty`, typed against the array element type). **`key={...}` is the authored TSX identity; `kovo-key` is the lowered runtime identity contract** — written once and shared verbatim by stamps, morph, inferred fragment target suffixes, submitted-form identity, and optimistic reordering (§13.2). App source that hand-authors `kovo-key` where it can write `key` instead is hand-authored lowered IR under **KV235**; emitted IR keeps `kovo-key` so fixpoint validation can recompile it.

**Stamps are derived, never required in TSX.** `{cart.count}` and `data-bind="cart.count"` are one fact; the author writes the typed expression, the compiler emits the stamp. Classification: an expression that is an element's sole text child stamps that element; an expression in mixed content gets a synthesized `<span data-bind>` (reported in `kovo explain component` — wrap it yourself if the extra element matters); an expression in attribute position lowers to a named derive (above). Hand-written stamps remain valid compiler input so the fixpoint gate can recompile emitted IR (Constitution #3), but app-authored TSX must not carry derivable stamps: redundant stamps are lint **KV223**, and a stamp that disagrees with the expression it wraps is an error (**KV222**). The same rule covers `kovo-fragment-target`, `kovo-deps`, and `kovo-key`: app TSX writes typed queries and `key`; emitted IR carries residual strings and validates them. A component module in app source that hand-authors the lowered string/template IR instead of TSX is **KV235**. The general rule, normative framework-wide: **a residual string may be _validated_ in emitted IR, but TSX never requires a string the compiler can derive from a typed expression.**

**The ceiling is explicit, and the escape hatch is defined.** Anything beyond paths, derives, and keyed lists flips to a server fragment — or to an **isomorphic island**: `isomorphic: true` on a component also emits its render function into the client module; on query/state change the island re-renders itself and self-morphs. It is the _same_ render function the server uses (partials cannot drift), and it is lint-gated (**KV302**: justification comment required) — this is the sanctioned SPA-creep escape named in §15.

### 4.9 Update coverage (exhaustiveness)

§10.6 proves every invalidated query has an optimistic story; this is the same theorem one hop further down the dataflow: **every query- or island-local-state-dependent position in rendered output must have a declared update status**, or the page renders data it will never refresh — the silent-staleness bug §10.6 exists to kill, recurring on the client side of the wire. The framework rejected runtime dependency tracking (§3.1), and the thing removed was also the thing that guaranteed coverage in SPA frameworks; a static plan needs a static completeness proof.

During lowering, the compiler classifies every render-output position that reads query data or island-local state:

| Status       | Meaning                                                                                                                                                                                                                                   | Latency                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `plan`       | lowered to a binding, derive, or stamp (§4.8)                                                                                                                                                                                             | instant; participates in optimism |
| `isomorphic` | island self-renders on change (§4.8, KV302)                                                                                                                                                                                               | instant; costs the render module  |
| `fragment`   | inside an inferred server-refreshable query target — mutation success may re-render it after invalidation ∩ live targets (§9.1); not a state remedy unless a later SPEC defines how client-private state participates in server fragments | 1 RTT — **no optimistic update**  |
| `renderOnce` | declared immutable for the document's lifetime (suppression recorded in source)                                                                                                                                                           | never                             |

A position fitting none of these is **KV311**. The teaching error shows the classification, why the position exceeds the plan grammar, and the fix menu — extract a derive, lower to a CSS/attribute toggle, make the query-backed component reconstructible as an inferred target, remove `disableServerRefresh: true` if it is suppressing a valid target, use `isomorphic: true`, or declare `renderOnce`:

```
kovo check coverage
query cart:
  cart-badge   span text          plan: binding ✓
  cart-badge   button class       plan: derive (CartBadge$button_class) ✓
  cart-badge   conditional <dot>  UNHANDLED ⚠ KV311
     → derive + [hidden] toggle, inferred fragment target, isomorphic, or renderOnce
  mini-cart    (subtree)          fragment ✓ — no optimistic update (inferred target)
```

Like KV310, the check runs at two altitudes off one derived set: in the compiler during lowering (editor-visible) and as `kovo check coverage` (CI/agents). Together with §10.6 and the touch graph, a mutation's full dataflow is exhaustiveness-checked edge by edge: write → invalidated queries (§11.1) → optimistic prediction (KV310) → every dependent DOM position (KV311) → fragment reconcile (§9.1). No edge may be silently uncovered — Appendix A's "nothing to remember" promise holds _unconditionally_, not just inside the plan grammar.

---

## 5. Compiler

### 5.1 Pipeline

```
cart.tsx ──parse──▶ analyze ──lower──▶ cart.server.js + cart.client.js ──(prod only)──▶ minify*
                       │
                       ├─▶ generated/registries/*.d.ts   (module aliases, fragment targets, query keys, domains,
                       │                                  routes, element ids, invalidation sets)
                       ├─▶ generated/touch-graph.ts      (§11.3 — reproducible/checkable on demand)
                       └─▶ generated/optimistic/*.ts     (§10.4; emitted output; authored transforms override)
```

\* Minification may never rename exported handler symbols or anything appearing in HTML attributes (Constitution #1 — enforced because those names are load-bearing at runtime); this holds in prod too, where payloads are delta-encoded (§9.1.1) but names stay verbatim. The prod build additionally stamps a **render-plan version token** into emitted module URLs (alongside the cache-busting hash, §5.2.1) and into delta/patch responses, so §9.1.1 base-version validation can fail loud on deploy skew instead of patching stale DOM silently.

### 5.2 Hard rules (normative)

1. **Source-derived names.** Extracted handlers are named `Component$fnName`, or `Component$element_event` when anonymous (lint `KV210` nudges naming). Content hashes appear only in cache-busting query strings on the emitted module URLs (or ETag-driven — a deployment choice the framework controls server-side).
2. **1:1 file mapping.** `x.tsx` → exactly `x.server.js` + `x.client.js`. No heuristic chunking. A prod-only merge pass for tiny modules is opt-in (`kovo.config: mergeClientModules`), defaulting off.
3. **Fixpoint invariant.** `compile(compile(src)) === compile(src)`; the IR is valid input. CI test ships in the starter template. Paired with a **semantic gate**: `render(src) ≡ render(compile(src))` — authored and lowered components must produce byte-identical HTML over the test corpus (a browser-free differential suite), so the fixpoint proves behavior preservation, not merely syntactic idempotence.
4. **Platform-behavior emission.** Where the compiler proves a handler equivalent to a declarative platform feature (dialog open/close → invoker commands; popovers; `<details>`; pure-CSS state via `:has()`), it emits the attribute and drops the handler. `kovo explain` reports each substitution.
5. **Teaching errors.** Every diagnostic shows the lowering: what would have been generated, why it can't be, and the fix menu.
6. **Registry atomicity.** Registry `.d.ts` emission is part of every compile; `vp dev` and `vp check` regenerate registries before type-checking runs. A stale registry is unrepresentable, not just unlikely — the typegen failure modes (fresh clone red until first generation, watch-mode races) are designed out.
7. **TSX-only authoring.** TSX is the sole app-authoring surface. The lowered IR is an output format: valid Kovo source for fixpoint/render-equivalence gates and readable artifacts, but not something app code hand-authors or vendors. Hand-authored lowered IR in app source is **KV235** with a teaching message that shows the TSX equivalent. There is no suppression pragma or ejection workflow in v1; a front-end gap is fixed in the compiler or recorded as a SPEC conflict.
8. **Public imports in app source.** App-authored source may import Kovo packages only through documented public entrypoints. Imports from framework-maintenance subpaths (`@kovojs/*/internal`, `kovo/internal`) and compiler-emitted ABI subpaths (`@kovojs/*/generated`) are invalid in app source and must produce a teaching diagnostic. Compiler-emitted modules may import generated ABI subpaths such as `@kovojs/browser/generated`; those imports are compiler-owned artifacts, not app-authored API. Generated app artifacts are reproducible outputs, not app dependencies: app-authored modules MUST NOT import app-local generated modules such as `src/generated/*`, and app-local generated artifacts MUST NOT be checked in. App-facing tests and scripts use authored entry points plus public `kovo emit`/`kovo explain`/`kovo check` flows; direct generated reads are reserved for compiler/build internals and on-demand verification artifacts that are created during the command.
9. **Post-parse decisions use typed facts, not source strings.** After parsing, the compiler's post-parse phases (`lower/**`, `validate/**`, `analyze/**`, `emit/**`, and `graph.ts`) MUST decide from typed model facts and spans, never from raw source snippets, regexes, `getText()`/`getFullText()`, or ad hoc string slicing; the scanner/parser is the sole boundary that reads source text into typed facts. Permitted source-text uses elsewhere are narrow: diagnostic source-frame rendering, span-based source-patch application by known offsets, generated-artifact body carry and `renderSource()` emission, generated-artifact verification, IR-header provenance checks (`source.startsWith(compilerIrHeader)`), binding-path grammar parsing on typed `.path` fields, URL/route parsing of an extracted literal `attribute.value`, import-specifier boundary validation for the public/generated/internal Kovo subpath rule above, and name-formatting of model-derived identifiers. A mechanical kovo-check guard enforces this.

### 5.3 `kovo explain`

The compiler's decision tree, on demand. Sub-commands (all output stable, diffable text — agents consume the same artifact humans read):

```bash
kovo explain component cart        # lowerings: extracted handlers, derives, capture channels, platform substitutions, attribute merges, triggers
kovo explain mutation cart/add     # writes → domains → invalidated queries → consumers; guard chain
kovo explain mutation cart/add --optimistic   # transform coverage per query; derivation traces + punts (§10.5)
kovo explain query cart            # read set, consumers, every mutation that invalidates it
kovo explain page /products/:id    # emitted modulepreloads, per-route prefetch config, param/search schemas, query payloads
```

---

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

| Surface               | Source of truth                     | What TypeScript proves                                                                                                               |
| --------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Handler refs          | client module exports               | `cart.remove` exists; params required & typed; typo = error                                                                          |
| Form fields           | mutation input schema               | names ∈ schema; types match; **completeness** (missing required field = error); coercion declared once (KV242)                       |
| Fragment targets      | component registry                  | target exists; patched with the right component's props                                                                              |
| Query data / bindings | Drizzle select shape (`$infer`)     | `data-bind` paths exist; column rename propagates to every template; nullable traversal requires `?.` or a derive (KV227, §4.8)      |
| Invalidations         | domain layer / touch graph          | invalidated keys exist; optimistic exhaustiveness in `tsc` via emitted invalidation sets (§10.6)                                     |
| Errors                | declared error codes                | `onError` receives exhaustive discriminated union                                                                                    |
| Guards                | guard combinators                   | `req.session.user` non-null under `authed`; static audit of unguarded mutations, routes, and queries                                 |
| State                 | `JsonValue` constraint              | serializability by construction                                                                                                      |
| Routes / links        | `route()` declarations (§6.4)       | `href`/`<Link>`/`redirect()` target exists; path params required & typed; search params typed; route rename propagates to every link |
| GET forms / URL state | route `search` schema               | field names ∈ search schema; coercion declared once; the §7 URL channel is typed                                                     |
| IDREFs (L0 wiring)    | compiler id registry                | `commandfor`/`popovertarget`/`for`/`aria-*` reference an id that exists in scope (KV221)                                             |
| Sessions              | declared session schema (§6.5)      | `req.session` fully typed; instance keys (§10.2) and guard refinements rest on typed fields                                          |
| Derives               | declared inputs (§4.8)              | derive inputs exist in `QueryRegistry`; input types match query shapes; bound attribute targets type-checked                         |
| Stamp lists           | query result element type           | `data-bind-list` paths are arrays; item-relative paths exist on the element type; `kovo-key` names a real field (§4.8)               |
| Slots / children      | hoisted component refs (§4.5)       | fragment-target children lower to component references with serializable props (KV230)                                               |
| Query args            | query `args` schema (§10.2)         | components bind args from their own props; coercion declared once; instance keys typed end-to-end (store, wire, optimism)            |
| Update coverage       | render-output classification (§4.9) | every query/state-dependent DOM position has a status — `plan` / `isomorphic` / `fragment` / `renderOnce`; none is KV311             |
| Opaque projections    | declared output schema (§10.2)      | `sql<T>`/raw projections carry `s.*` output schemas (KV410); observed result shape runtime-verified (§11.2)                          |

### 6.3 Example: end-to-end mutation typing

```ts
// cart.mutations.ts
export const addToCart = mutation('cart/add', {
  guard: authed,
  input: s.object({
    productId: s.string(),
    quantity: s.number().int().min(1).default(1), // FormData coercion declared here
  }),
  errors: { OUT_OF_STOCK: s.object({ availableQuantity: s.number() }) },
  async handler(input, req, { fail }) {
    //          ^? { productId: string; quantity: number }   — inferred from schema
    const ok = await cart.addItem(req.db, req.session.cartId, input.productId, input.quantity);
    if (!ok) return fail('OUT_OF_STOCK', { availableQuantity: ok.available });
    // NO invalidate() call — derived from cart.addItem's touch set (§11)
  },
});
```

```tsx
// product.tsx — consuming form; the no-JS fallback IS the output
export const AddToCartForm = component({
  queries: { product: productQuery.args((p) => ({ id: p.productId })) },
  props: s.object({ productId: s.string() }),
  mutations: { addToCart },
  render: ({ product }, _state, { productId, forms }) => (
    <form enhance mutation={addToCart} key={productId}>
      <input type="hidden" name="productId" value={productId} />
      <input name="quantity" type="number" min={1} defaultValue={1} />
      <FieldError name="quantity" />
      <FormError
        code="OUT_OF_STOCK"
        message={(failure) => `Only ${failure.payload.availableQuantity} left.`}
      />
      <button disabled={product.stock <= 0}>Add to cart</button>
    </form>
  ),
});
// Emits: <form method="post" action="/_m/cart/add" enhance data-mutation="cart/add" kovo-key="p1"> …

// programmatic, with the exhaustive typed-error union:
ctx.submit(addToCart, {
  input: { productId: ctx.params.productId, quantity: 1 },
  onError: (err) => {
    if (err.code === 'OUT_OF_STOCK') toast(`Only ${err.payload.availableQuantity} left`);
    // err: { code:'OUT_OF_STOCK', payload:{availableQuantity:number} }
    //    | { code:'VALIDATION', fieldErrors: Record<FieldPath,string> }   — exhaustive
  },
});
```

Where the mutation value is importable — server-rendered templates always can — `mutation={addToCart}`
is the preferred form authoring spelling: inference straight off the value, no registry hop. The compiler
emits the concrete `action="/_m/cart/add"`, mutation key metadata, input coercion metadata, CSRF field,
and submitted-form target. The string-keyed `form('cart/add')` helper survives for sites that cannot
import the value, but author TSX should not hard-code mutation URLs.

Enhanced form failures use the same render function as the no-JS full-page path. Expected failures
are typed mutation results: schema validation maps to `<FieldError name="...">`, declared
application codes map to `<FormError code="...">`, and both helpers are compiler-bound to the
enclosing enhanced mutation form. The third render argument still carries typed form state as the
escape hatch for custom UI, with each bound mutation exposing
`forms.<mutation>.failure: null | { code; payload; fieldErrors? }`. The failure value is scoped to
the submitted form instance for that render and is cleared by the next successful render of that
instance. Repeated forms must provide stable identity through authored `key` or serializable keyed
component props; the compiler lowers it to `kovo-key` and derives the submitted-form fragment target.
Hidden inputs are submitted data, not identity. An enhanced form in a repeatable position with no
stable key is a teaching diagnostic because the server cannot know which live form to re-render.

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

Routes may also return two sanctioned non-HTML 200/304 outcomes: `respond.file(body, { contentType, filename?, etag?, headers? })` and `respond.stream(body, { contentType, filename?, etag?, disposition?, headers? })`. These are still ordinary `route()`s: params/search schemas, guards, typed links, KV220 validation, the unguarded audit, and the `owner:`-powered `--unscoped` audit all apply before the body is served. `Content-Type` is required, `Content-Disposition` is declared (`respond.file()` defaults to attachment; `respond.stream()` defaults to attachment unless `inline` is requested), and a matching `If-None-Match` answers 304 without rendering HTML. Range/resumable downloads are out of scope for v1; large exports that exceed a request/response window belong to a later background-jobs design.

### 6.5 Session schema

Sessions are a declared `s.object` schema, not an `any` bag: `req.session` is fully typed everywhere it appears. This is core, not a nicety — query instance keys (§10.2) and guard refinements (`req.session.user` non-null under `authed`, §6.2) are load-bearing on session fields, so an untyped session would be a hole directly under the proof surface.

Session provenance is an application capability, not a framework-owned identity system. The app declares a `sessionProvider` in the server request shell; Kovo runs it once before route, query, or mutation guards and exposes the returned value as `req.session`. The provider return type must be assignable to the declared session schema under TypeScript static checking, while browser input still crosses the normal runtime validators. A provider returning `null` or `undefined` means "anonymous"; guard combinators must treat that as unauthenticated rather than as a malformed request.

Route and query guard failures have fixed outcomes so auth remains part of the typed surface. `authed` failures run the app's `onUnauthenticated` handler, whose default is a 303 redirect to the configured login route with the original URL available as `next`; authenticated-but-unauthorized failures render the app's 403 shell with status 403. Mutation guard failures keep the §9.2 typed-error path: no redirect body vocabulary is introduced for enhanced mutation responses.

### 6.6 Soundness boundary (normative)

The §1.1 proof claims are claims about TypeScript programs that stay inside the sound subset. The starter therefore ships — and the docs state as a precondition — `strict` everything plus lint bans on `any`, non-null assertions, and `as` casts in app code. Three boundaries are runtime-validated regardless, by design: the **wire** (every mutation input passes its `s.*` schema — types-without-validators, raw-tRPC style, was rejected); **deploy skew** (a long-lived document POSTing yesterday's form shape is answered by schema validation and the 422 path, §9.2 — never undefined behavior); and **CSRF** — `kovo-csrf` (§9.1) is a session-bound synchronizer token stamped into every emitted form and verified before schema parsing, replay lookup, and the guard chain on every mutation POST. CSRF is default-on for server-rendered mutation endpoints; an explicit `csrf: false` is the only per-mutation opt-out and is reserved for non-browser or externally authenticated endpoints. Deploy skew also covers handler modules, normatively: emitted module URLs are immutable and versioned, and the serving layer retains prior versions — an old document's `on:*` refs keep resolving after a deploy; first interaction on a still-open tab never 404s. Generated ABI subpaths (for example `@kovojs/browser/generated`) may change when the compiler and runtime ship together because app source regenerates those imports, but already-emitted immutable modules remain governed by the same versioned-module retention rule: old generated modules must keep resolving to the runtime symbols they were emitted against for the supported deploy-skew window.

---

## 7. The Interaction Ladder

Interactions must use the lowest layer that suffices. The compiler enforces L0 substitutions; lints nudge the rest. Navigation between _places_ is always a real URL and server route (§8); enhanced navigation may intercept eligible clicks only as a progressive enhancement over that same full-document GET. The ladder governs interaction _within_ a place.

| Layer  | Mechanism                                                                                                                               | Example                               | JS shipped                             |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------- |
| **L0** | Platform behaviors: invoker commands, Popover API, `<details>`, `<dialog>`, `:has()`, scroll-driven animations                          | Open cart drawer                      | 0                                      |
| **L1** | Pure client islands: local state + the update plan (bindings/derives/stamps, §4.8); loaded on interaction or a declared trigger (§4.7)  | Price-range filter UI, tabs, carousel | handler module on first touch          |
| **L2** | Mutations: real forms + enhanced fetch → fragment/query patch                                                                           | Add to cart                           | loader (already present) + form module |
| **L3** | Optimistic: compiler-derived or declared transforms over query values                                                                   | Instant badge tick                    | transform module                       |
| **L4** | Live: SSE pushing the same fragment/query vocabulary; BroadcastChannel tab sync + refetch-on-focus cover common lower-cost cases (§9.3) | Order status, presence                | `<kovo-live>` subscriber               |

**Cross-island coordination**, in order of preference: (1) **the URL** — filter writes `?max=500`, or is a GET form whose fragment response is the grid, both typed against the route's `search` schema (§6.4); (2) **typed fire-and-forget events** — registry-checked `emit('cart:added', {…})`, payload types may not overlap query data (lint `KV320`: if you're sending server facts over an event, you wanted an optimistic transform); (3) **shared client state** — last resort, lint-gated with required justification comment.

---

## 8. MPA Spine & Navigation

- **No client router.** Each page has a complete server document; route handlers are server functions declared with `route()` (§6.4), which carries the path's literal type, param/search schemas, and per-route config. `<Link>`/`href()` are compile-time sugar lowering to plain `<a href>` — typed links whose native URL remains the canonical behavior.
- **Enhanced navigation is a progressive enhancement, not an app mode.** The loader may intercept only eligible same-origin, unmodified, GET anchor navigations. It fetches the canonical full HTML document, validates render-plan/version and compiler-derived segment metadata, updates or validates document-shell state, and morphs only compatible changed segments. The current document's layout chain is an optimization hint only; the target server document decides the route, guard outcome, layout chain, head, and body. On unsupported content type, cross-origin URL, modified click, target/download/hash-only navigation, redirect/guard uncertainty, shell drift, version mismatch, parse/morph failure, or any missing proof, the loader performs the normal full GET.
- **Navigation partials are not a v1 protocol.** Enhanced navigation uses the full target document as its oracle. Header-selected navigation fragments, target-chain hints, or route-partial responses remain a possible optimization only after no-JS/full-load versus enhanced-navigation render-equivalence is proven over the corpus; app authors cannot opt into or hand-author a navigation partial response.
- **Segment persistence is derived.** Only unchanged compiler-stamped layout segments may keep DOM identity. Changed layouts, changed route leaves, active nav/search/auth/query-dependent chrome, inserted islands, removed islands, and route boundaries are morphed from the target document or fall back to full navigation. App TSX never authors navigation segment stamps or persistence policy.
- **Navigation state emulates the browser.** Enhanced navigation owns `pushState`/`replaceState`, `popstate`, scroll restoration, hash scrolling, focus movement, and route-change announcements only for navigations it successfully completes. A newer navigation aborts older fetch/morph work. Pending optimistic state is reconciled from the target server document or discarded by full GET; it must not silently survive into an incompatible document.
- **bfcache and loader budget stay load-bearing.** Enhanced navigation must not add `unload` handlers or global session heaps that block bfcache. Its code counts against the inline loader's 8KB gzip budget unless the SPEC budget is explicitly changed with evidence.
- **Speculation Rules** are opt-in config, never auto-emitted: `prefetch: 'conservative' | 'moderate' | false` per route, declared on the `route()` object (§6.4), **default off**. Auto-prerender has real hazards — analytics firing inside prerendered pages, non-idempotent per-user renders, discarded-render server cost — so apps opt in route-by-route where renders are idempotent and cheap. The feature is one `<script type="speculationrules">` tag; the MPA is fast without it.
- **Cross-document View Transitions** opt-in per element pair via `view-transition-name` props; the compiler stamps matching names across route templates.
- **bfcache hygiene** is a framework guarantee: no `unload` handlers, `keepalive: true` on in-flight mutations at navigation, pending optimistic logs discarded on document teardown (stale-optimism-outliving-its-mutation is structurally impossible).
- **Out-of-order streaming:** `<kovo-defer>` renders a fallback, streams the real fragment later in the same response, morphs in — the fragment protocol reused within first render. Deferred query JSON is guaranteed to arrive before or with its consumers.
- **Degradation contract:** Safari/Firefox get normal navigations and normal forms. The MPA degrades to "a website" — where an SPA shows a blank screen on the same failure.

---

## 9. Wire Protocol

One vocabulary, transport-agnostic: document load, enhanced fetch, and SSE live updates all carry the same fragment/query chunks (§9.3). All payloads are human-readable (Constitution #4).

### 9.1 Enhanced mutation round-trip

```http
POST /_m/cart/add HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Kovo-Fragment: true
Kovo-Targets: cart-badge=cart; cart-drawer=cart; recommendations=product:p1
Kovo-Live-Targets: cart-badge#cart-badge:{}; recommendations#recommendations:{"productId":"p1"}
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
- `Kovo-Live-Targets` is the structured reconstruction companion for server-refreshable component targets. Each entry names the live target, its generated component registry key, and the serialized props/key identity the compiler proved sufficient to reconstruct the component instance. Dev mode keeps this explicit and inspectable; prod may replace the JSON with a build-versioned token only when `kovo explain` can recover the same value. App authors never construct this header, import target constants, or route mutations to fragments by hand.
- `Kovo-Changes` is the sanitized wire summary of committed writes: each entry is `{domain, keys}`. It never includes mutation input, user-provided values, failure reasons, stack traces, or internal diagnostic detail; richer typed change records are internal compiler/runtime artifacts.
- `<kovo-query>` replaces the client's query value and runs that query's update plan — bindings, named derives, stamps — across every dependent island. No runtime dependency tracking: the plan is the DOM itself (§4.8).
- `<kovo-fragment>` is **DOM-morphed** by default (idiomorph-class algorithm): focus, scroll, selection, CSS transitions, and nested island state survive. `mode="append"` is the explicit append vocabulary for pagination and streams. Patched-in islands are inert-until-touched like everything else — _a fragment update is a tiny navigation, not a different programming model._
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

The delta is **scoped by the change record, not diffed against client state.** This is what keeps the server stateless (§9.1 — it holds no session of what's on screen): the server never asks "what does the client currently have?" It emits only what the committed write provably touched — the `Kovo-Changes` record carries the changed `{domain, keys}` (§9.1) — and everything outside that scope is, by server truth (#5), unchanged. A delta is therefore sound _by construction_, not by reconciling two states the server would have to remember.

- **Delta query JSON.** A `<kovo-query delta>` carries only the change-record-scoped portion of the value, not the whole value. The client deep-merges it into the held query value, then runs the **same** update plan (§4.8) — bindings, named derives, stamps. Scalar/object fields the change could have touched are sent whole (they are cheap). **Keyed collections merge by identity, not position:** the delta sends only the touched rows (upsert) plus a removed-key list, over the existing `kovo-key` contract (§4.8, §13.2), so reorders and removals are unambiguous. A collection is delta-eligible only when its `kovo-key` corresponds to a domain the change record scopes with explicit keys; otherwise that collection ships whole. JSON stays schema-shaped; a frame reads as "these keyed rows of `cart` changed."
- **Smaller fragments.** The primary fragment win is _not_ sending a server-computed DOM diff (that would require the client state the stateless server refuses to hold). It is: **prefer a query delta + the client update plan over full `<kovo-fragment>` HTML** wherever the plan grammar (§4.8) covers the subtree, and for list fragments the change record can bound, send only keyed `mode="append"`/upsert rows rather than the whole list. A subtree the plan cannot express and the change record cannot bound ships as full fragment HTML — the §9.1 form, unchanged. The morph stays the same client path; it is simply fed query-driven updates or keyed rows instead of a whole subtree.
- **Base-version validation (mandatory).** A delta assumes a base — the client's held query value — that is present and was produced by the same build. Two ways it can be unsafe: the client has **no base** for that query (an island patched in after first paint, or a cold store), or a **build skew** (a long-open tab or stale prerender against a redeployed server whose query shape moved). Every page render and every delta response carries the build's **render-plan version token** (§5.1); the client applies a delta only when the token matches _and_ a base is present. On either failure it does not guess — it discards the delta and **refetches the full value over the typed read endpoint** (`/_q/<key>`, §9.4), a cheap GET. The client may also send its token up on the mutation request so a skew-aware server emits full directly and saves the extra round-trip. Deploy skew goes from silently-wrong to loud-and-recoverable (§15).
- **Automatic full-vs-delta selection.** The runtime ships whichever is smaller and sound: a query with no delta-eligible collection, a tiny value, the first render of a patched-in island, or a build-token mismatch all ship full. The rule is deterministic so the fixpoint and render-equivalence gates (§5.2.3) stay sound — the prod gate is `apply_delta(base, render_prod(Δ)) ≡ render_dev(full)` over the corpus.
- **Reconstruction for debugging.** `kovo explain`/MCP reconstructs the full query value from a prod delta + the held base, so an owner or agent handed a prod frame recovers dev-equivalent legibility. This is a convenience, not load-bearing: names are intact and the partial payload is already named and schema-shaped.

Mutation handlers may attach response headers through a narrow context channel. The channel is for transport metadata such as `Set-Cookie` and cache headers; it does not let handlers replace the body, status vocabulary, query reruns, fragment rendering, or PRG redirect contract. Header values emitted on the enhanced and no-JS paths are merged with framework headers after CSRF, replay, parsing, guards, and transaction commit complete.

Raw HTTP integrations use declared `endpoint()` entries, not ad-hoc server escape hatches. An endpoint is registry-visible, receives `Request -> Response`, may opt out of CSRF with a named justification, and is enrolled in the endpoint and unguarded audits with the same auth metadata as routes, queries, and mutations. Endpoint handlers receive the raw `Request` before body parsing so signature verification can use wire bytes; exact and prefix mounts are declared; cookies are not interpreted and no ambient `req.session` is passed. A CSRF exemption is sound only because endpoint/webhook auth does not ride ambient browser authority. OAuth/SAML callbacks and adapter-owned mounts belong here; browser credential forms should still prefer typed `mutation()` flows so they keep schema validation, no-JS behavior, and the normal response vocabulary.

`webhook()` is the shaped machine-endpoint primitive for third-party POSTs that write Kovo-owned data. Shape: `webhook(name, { path, verify, input, idempotency, handler })`, lowering to a registry-visible endpoint with `auth=verifier:<resolved scheme>` unless an explicitly justified custom/none verifier is used. The lifecycle is fixed: capture raw bytes → verify → parse/coerce a loose input schema (unknown provider fields pass through) → replay lookup by provider event id (`Kovo-Idem` machinery, via `idempotency(input)`) → `BEGIN` tx → handler receives a Tx-typed db/request context with no ambient session and must write through `domain()` writes (KV330/KV402/KV404 still apply) → `COMMIT` → emit the unified change record `{domain, keys, input}` and return the provider-appropriate 2xx. `fail()` rolls back and answers the declared 4xx/5xx response so provider retry semantics are explicit. A redelivered event id replays the stored response and must not re-execute the handler.

The verifier kit is part of the normative surface for `webhook()`: `hmacSignature({ header, payload, encoding, tolerance, multiSig })` is the generic form, and `standardWebhooks({ secret })` is the shared non-vendor preset that resolves to printed generic HMAC configuration. Provider-specific HMAC recipes live in app/example code on top of `hmacSignature`, not in framework package exports. Verification is over raw bytes, uses constant-time comparison, enforces timestamp tolerance, and supports rotated secrets/multiple signatures. Non-HMAC providers use a custom `verify(request)` escape that appears as custom auth in the audit; `verify: 'none'` requires a named justification and appears as unauthenticated machine ingress.

### 9.2 Errors

Validation failures (schema, with field paths) and declared error codes return HTTP 422. The enhanced
path infers the submitted form instance from the request's compiler-emitted form target and returns a
`<kovo-fragment>` for that form only; the no-JS path re-renders the full page. Both paths call the
same component render function with the same typed failure state in `forms.<mutation>.failure`, so
expected failure UI is normal TSX (`<FieldError>`, `<FormError>`, or direct `forms` reads) rather
than a separate response template. `ctx.submit`'s `onError` receives the same typed union. Expected
failure responses never use committed invalidation or `Kovo-Targets` success selection.

Unexpected server failures are not part of the typed union and must not leak internals. The typed query endpoint (§9.4) returns HTTP 500 with JSON `{"code":"SERVER_ERROR","payload":{}}`. Full-page route rendering returns HTTP 500 with the app's stable error shell or the fallback body `Internal Server Error`. Enhanced mutation responses that fail while rendering post-commit queries/fragments return a render-error fragment with HTTP 500 and `data-error-code="RENDER_ERROR"`; any `Kovo-Changes` header on that response remains sanitized to `{domain, keys}` for writes that already committed.

### 9.3 Liveness and Live

Kovo separates low-cost liveness from explicit live subscriptions:

- **BroadcastChannel rebroadcast** — a mutation's `<kovo-query>` response is rebroadcast to the user's other tabs; same-user multi-tab sync at zero server cost.
- **Refetch on focus/visibility** — a loader behavior (per-query opt-out) that re-runs queries (over the typed read endpoint, §9.4) when a stale tab returns; it fakes an embarrassing share of "live" UX for one conditional in the loader.
- **Live queries** — `<kovo-live query="cart">` subscribes over SSE to the identical `<kovo-query>`/`<kovo-fragment>` chunks; guards are re-checked at subscription **and** at each push (a guard that passed at render must pass at patch time — fragments must not become a privilege-escalation side channel); in-process emitter (single node) or Redis pub/sub (multi-node); instance-key routing; `live: true` opt-in per query.

The vocabulary is transport-agnostic by construction, so SSE is an additive transport, not a rearchitecture.

### 9.4 Typed reads: the query endpoint

Every query is addressable over GET — one read surface serving refetch-on-focus (§9.3), GET-form fragment responses (§7), async option/search reads, and the SSE subscription key:

```http
GET /_q/product?id=p1 HTTP/1.1
Kovo-Fragment: true
```

```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8

<kovo-query name="product:p1">{ "name": "Mug", "stock": 4 }</kovo-query>
```

Args arrive as search params through the query's `args` schema (§10.2) — the same `s.*` coercion machinery as forms. The query's `guard` (§10.2) is checked on **every** read, and reads are part of the unguarded audit. The instance key in the response (`product:p1`) is the §10.2 canonical encoding — the single currency shared across client store, wire, and optimism.

### 9.5 Request shell

The request shell is the server-owned composition point for routing, document assembly, dev serving, and export. Apps declare a closed `createApp()` aggregate: routes, mutations, queries, endpoints, the client-module registry, document options, unexpected-error shells, CSRF config, the `db` provider, and the §6.5 `sessionProvider`. Generated route IR and live-target registry artifacts are wired by the compiler/build integration, not by app-authored `createApp({ generated, refresh })` options. Vite/dev integration points at an authored app entry, for example `kovo({ app: '/src/app.tsx' })` from `@kovojs/server/vite`; the entry must default-export a `KovoApp` and must not point into `src/generated/*`. Compiler-owned plugins resolve route IR, live-target registries, and generated client modules internally. The public handler currency is web-standard `Request -> Response`; adapters such as `node:http` convert at the edge.

Dispatch order is normative and printable: `/_m/<mutation-key>` mutations, `/_q/<query-key>` typed reads, `/c/__v/<version>/<module>` immutable client modules, declared `endpoint()` exact/prefix mounts, route table, then the 404 shell. There is no user middleware chain in v1. Extension points that can affect control flow are declared surfaces — `sessionProvider`, guards, `endpoint()`, `webhook()` — so audits can print them and no request behavior is registered from a distance.

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
`createRequestHandler()` never exposes HMR endpoints.

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
  kovo({ domain: 'cart' }),
);
export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    stock: integer('stock').notNull(),
  },
  kovo({ domain: 'product', key: (t) => t.id }),
); // row-level invalidation key
```

Tables default to a same-named domain; annotations group tables into logical domains and declare key granularity. The reverse index (table → domain), the `DomainKey` type, and key extractors are all generated from this single file. An optional `owner:` annotation (`kovo({ domain: 'cart', owner: (t) => t.userId })`) names the column tying a table's rows to a principal — it powers the `--unscoped` audit (§10.3).

A table may opt out of domain mapping with `kovo({ exempt: true })` (silencing KV404 for writes — append-only logs, outbox tables), but **exemption is write-side only**. An exempt table has no domain, so no write can ever invalidate a query reading it; a query whose read set includes an exempt table is therefore error **KV411** — the silent-staleness bug §10.6 exists to kill, reintroduced through the exemption. The teaching error's fix is to map the table after all: for an append-only log this costs nothing — inserts then invalidate exactly the timelines reading it. `exempt` is reserved for tables nothing queries.

### 10.2 Queries

```ts
// cart.queries.ts — session-derived, no client-visible args (shorthand form)
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

// product.queries.ts — parameterized: args declared once, schema-style
export const productQuery = query('product', {
  args: s.object({ id: s.string() }), // coerced wherever args arrive: props, route params, /_q/ search params (§9.4)
  guard: authed, // optional — checked at page render AND at every typed read / live push
  load: (db, args, req) =>
    db
      .select({ name: products.name, stock: products.stock })
      .from(products)
      .where(eq(products.id, args.id)),
});
```

Derived from this one expression, statically:

- **Read set** `{cart, product}` — the JOIN _is_ the declaration (forgetting a joined entity's dependency is unrepresentable).
- **Result type** from the select shape — drives the client JSON, `data-bind` paths, derive inputs, and optimistic transform parameters. A column rename in `schema.ts` propagates through TypeScript static checking to every template. **Opaque projections are the read-side raw-SQL seam:** Drizzle's `sql<T>` generic is an unchecked assertion, so any `sql`/raw projection requires a declared `s.*` output schema (**KV410**), and the observed result shape is runtime-verified (§11.2). The inferred-type chain stays sound or the seam is visible; never both unsound and silent.
- **Instance key** from the WHERE eq-predicates, resolved to `args.*` or `req.session.*` — only args are client-visible. Canonical encoding: `name:keyValue` in declared arg order (`product:p1`). This one string keys the client store (`<script kovo-query="product:p1">`), `kovo-deps` stamps, `Kovo-Targets` (§9.1), optimistic transform keys (§10.4), and live-push routing. Two instances of one query coexist on a page; `data-bind` inside an island resolves against that island's instance.

**Args bind locally (Constitution #2).** A component declares how its args derive from its own props — `queries: { product: productQuery.args((p) => ({ id: p.productId })) }` — so any page rendering the component satisfies the dependency without call-site knowledge. Route params reach queries as ordinary props through `route().page`; no call site enumerates query dependencies.

**Queries are the UI data contract.** A query-backed component's declared queries must contain the
data needed to render that component. "Skinny" queries maintained only for optimistic derivation
plus separate page/region loaders for presentation are rejected for ordinary app code: they split the
server-truth render path from the statically declared dependency graph and force app authors back
into manual fragment routing. The compiler may derive optimistic transforms, deltas, or §4.8 update
plans for only the fields and query shapes it can prove; unproved presentation fields still travel
through the same declared query and refresh via full server fragments.

### 10.3 Mutations & writes

```ts
// cart.domain.ts — ALL writes flow through here (lint KV330 bans db access in handlers)
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

**No `touches` on `addItem`, no `invalidate()` in handlers.** The static pass (§11) extracts `{cart_items→cart, products→product}` from the AST; calling `cart.addItem` _is_ the invalidation declaration. `invalidate()` survives only as a linted escape hatch for external-system effects (e.g., a Stripe webhook changing data Kovo should refresh).

**Request lifecycle (normative):**

```
CSRF validation → replay lookup by session/idempotency key → parse+coerce input (schema)
→ guard chain → BEGIN tx → handler (receives Tx-typed db; escaping the tx is a type error)
→ COMMIT → re-run invalidated queries (post-commit, same request context)
→ render <kovo-query>/<kovo-fragment> → respond
                    ↘ on fail(): ROLLBACK → typed error fragment, 422
```

This ordering closes the read-your-writes hazard: responses can never render pre-commit data (which would visibly revert the user's optimistic update).

**Guards:**

```ts
export const adminRefund = mutation('admin/refund', { guard: role('admin') /*…*/ });
// composable: guard: all(authed, rateLimit({ per: 'session', max: 10 }))
// static audit: `kovo explain --unguarded` lists every mutation, route, and query reachable without `authed`
// static audit: `kovo explain --unscoped` lists every query/write touching an owner-annotated
// table (§10.1) whose key predicate is not traceable to req.session — the IDOR audit; the
// §11.1 predicate extractor already does the tracing
```

### 10.4 Optimistic updates

Optimism is keyed to **queries** (the data), never islands. One transform per (mutation × invalidated query); every island consuming the query updates from it — including islands written after the mutation (Constitution #2).

**Hand-written:** transforms are authored in the mutation file as pure `(data, input)` functions against the query's inferred result type. **Explicitly deferred:** `'await-fragment'` documents "considered; 1-RTT latency accepted here."

**Derived:** for writes whose dataflow is closed over `{mutation input, schema constants, data the query already ships}` and queries within the shape grammar `{scalar-from-keyed-row, COUNT, SUM(arith), jsonAgg, filtered-COUNT, membership transitions}`, the compiler generates the transform (full derivation algebra in §10.5). Hand-written transforms share the same IR, so an app can override generated transforms pair by pair.

```ts
// emitted optimistic/cart.add.ts — DO NOT EDIT (override in cart.mutations.ts)
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

**Runtime protocol:** snapshot affected query values (`structuredClone` — safe by the `JsonValue` constraint) → apply transforms to the shared query values and run their update plans (all dependent islands update at once; affected islands get `kovo-pending` + `aria-busy` automatically) → on success, `<kovo-query>`/morph reconciles over the prediction (right guess ⇒ near-no-op; wrong guess ⇒ silent correction) → on error, restore snapshots, render error fragment.

Successful enhanced mutation responses should include `<kovo-query>` chunks for every invalidated query instance the server can derive and rerun in the request (§10.3). The client treats missing server truth for an optimistic transform as a visible runtime diagnostic, then settles that transform without promoting the prediction to authoritative data; this preserves the no-silent-inconsistency rule while allowing explicitly fragment-only or temporarily uncovered responses during development.

**Concurrency:** a per-query pending-transform log; arriving server truth is morphed in, then still-pending transforms re-applied in order (rebase). Safe because transforms are pure `(data, input)` functions. Mutations needing serialization declare `queue: 'cart'` (named FIFO). Navigation is a free reconciliation point: in-flight requests complete via `keepalive`, the log dies with the document.

### 10.5 Derivation algebra

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
  (external packages receiving db — KV406 sites) · params untraceable to input/session-key
```

Every punt is named in `kovo explain --optimistic` with the exact expression and reason. **Soundness is property-tested:** for derivable pairs, generated-state tests assert `patch(clientShape(s), i) ≡ clientShape(apply(effect, s, i))` — the commuting diagram is the deriver's test suite.

### 10.6 Exhaustiveness

Per mutation, coverage = invalidated-query set (derived) × status. Valid statuses are `derived`, `hand-written`, and `await-fragment`:

```
kovo check optimistic
mutation cart/applyCoupon:
  cartQuery.items      hand-written ✓
  cartQuery.subtotal   hand-written ✓
  cartQuery.discount   UNHANDLED ⚠ KV310
     → hand-write in cart.mutations.ts, or declare 'await-fragment'
```

Punts report their reasons inline (e.g. `PUNTED (Opaque: compute_discount)`).

The check runs at two altitudes off the same derived set: the compiler emits each mutation's invalidated-query keys into the registries (§6.1 `InvalidationSets`), so `OptimisticFor<typeof addToCart>` requires an entry — transform or `'await-fragment'` — per invalidated query, making KV310 an editor-visible type error; `kovo check` remains the CI/agent surface.

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
     E. runtime-flowing value      → 'unresolved' → KV406 (manual touches REQUIRED there)
  3. Interprocedural: helpers receiving a Drizzle-typed value are summarized bottom-up
     (memoized fixpoint); calls into node_modules with a db arg → KV406.
     `update…from(R)` / `insert…select` contribute R to the READ set, not touches.
  4. Parameterized keys: extract eq(T.keyCol, expr) from .where(); expr traceable to a
     write param ⇒ key derivation recorded; ranges/IN ⇒ table-level (KV409 notice).
```

Output is **reproducible on demand** through `kovo emit` / `kovo explain` and mechanically proven
by fixpoint plus render-equivalence gates. The emitted graph is also the runtime authority for
derived query reads and mutation touches; manual `reads` / `touches` are checked overrides for
opaque sites, not the default authoring model. Invalidation-graph changes are inspected through
those commands and CI evidence, not by committing app-local generated files:

```ts
// emitted generated/touch-graph.ts — DO NOT EDIT
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

### 11.2 Runtime verification (independent cross-check)

Dev server and the test harness wrap `db`; every executed statement is parsed (`pgsql-ast-parser`) and checked. Static over-approximates (all branches); runtime under-approximates (executed branches). **Invariant: `observed ⊆ static ∪ KV406-annotated`** — violation means analyzer bug or smuggled SQL; either is a CI failure. Read-side gets identical treatment (query loaders' SELECT/JOIN tables vs. derived read sets, **and observed result shapes vs. declared/inferred types — the runtime half of KV410**, so an opaque projection's schema claim is tested against what the database actually returns). An observed read of an `exempt` table is the runtime half of **KV411** (§10.1) — the same CI failure whether the exempt read was statically visible or smuggled through raw SQL.

### 11.3 Diagnostic codes (registry)

| Code  | Severity   | Meaning                                                                                                                                                                        |
| ----- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| KV201 | error      | Closure captures unserializable value (shows lowering + fixes)                                                                                                                 |
| KV210 | lint       | Anonymous handler — name it for stable identity                                                                                                                                |
| KV211 | lint       | `on:load` eager trigger — justification comment required (the greppable eager-JS budget)                                                                                       |
| KV212 | lint       | Unknown `on:*` event or trigger name (DOM event names; the closed trigger set, §4.7)                                                                                           |
| KV220 | error      | Literal `href`/form `action` matches no declared route (full-origin URLs / `external` opt out)                                                                                 |
| KV221 | error      | IDREF (`commandfor`, `popovertarget`, `for`, `aria-*`) references an id not present in scope                                                                                   |
| KV222 | error      | Hand-written binding stamp disagrees with the typed expression it wraps (§4.8)                                                                                                 |
| KV223 | lint       | Redundant hand-written stamp in sugar — the compiler derives it (§4.8)                                                                                                         |
| KV224 | error      | Static `id` in a repeatable component / duplicate id in a page composition (§4.5)                                                                                              |
| KV225 | error      | JSX nesting violates the HTML content model — the parser would re-parent (§4.2)                                                                                                |
| KV226 | internal   | `kovo-deps`/`kovo-c` names an unknown query instance or component in emitted IR fixpoint validation                                                                            |
| KV227 | error      | Binding path traverses a nullable segment without `?.` or a null-handling derive (§4.8)                                                                                        |
| KV228 | error      | Ambiguous route table: two routes can match the same canonical request path or duplicate route path (§9.5)                                                                     |
| KV229 | error      | Static export constraint violation: route/session/mutation/param usage cannot be exported as L0/L1 (§9.5)                                                                      |
| KV230 | error      | Fragment-target children not lowerable to a component reference (shows the hoisting + fixes)                                                                                   |
| KV231 | error      | Unmergeable attribute conflict in primitive composition (shows both sources + the §4.6 rule)                                                                                   |
| KV232 | lint       | Author override of a primitive-owned ARIA/state attribute                                                                                                                      |
| KV233 | error      | Two writers for one binding target                                                                                                                                             |
| KV234 | error      | Package component prefix registration conflict or reservation violation (§6.1.1)                                                                                               |
| KV235 | error      | App source hand-authors lowered IR/string-rendered components or derivable runtime stamps; write TSX (`queries`, `key`, typed expressions) and let the compiler emit IR (§5.2) |
| KV236 | error      | Unsafe output context requires an explicit trusted Kovo escape hatch (§1, §5.2)                                                                                                |
| KV237 | error      | Duplicate derived component registry key (§4.2, §4.8, §6.1.1)                                                                                                                  |
| KV238 | error      | Duplicate derived fragment-target registry key (§4.5, §6.2, §9.1)                                                                                                              |
| KV239 | error      | Duplicate static view-transition name (§8)                                                                                                                                     |
| KV240 | error      | Duplicate query-shape fact for one query name (§4.8)                                                                                                                           |
| KV241 | warn       | Derived component registry key changed since the previous emitted graph (§4.2, §4.8)                                                                                           |
| KV242 | error      | Enhanced mutation form control names do not match the bound mutation input schema (§6.2, §6.3)                                                                                 |
| KV301 | lint       | Server fact in island-local state                                                                                                                                              |
| KV302 | error      | `data-bind` path is not present in the declared query shape (§4.8)                                                                                                             |
| KV303 | error      | Inferred refresh-target render input is not declared as query data or serializable stamped props (§4.5)                                                                        |
| KV304 | error      | Reserved query name such as `state` is not allowed (§4.8 binding roots)                                                                                                        |
| KV310 | warn       | Invalidated query lacks optimistic transform (write/defer/derive)                                                                                                              |
| KV311 | warn       | Query/state-dependent DOM position with no update status — plan/isomorphic/fragment/renderOnce (§4.9)                                                                          |
| KV320 | lint       | Event payload overlaps query data — use a transform                                                                                                                            |
| KV330 | lint       | Direct db access in a mutation handler — route through domain                                                                                                                  |
| KV402 | error      | Write touched a domain not covered by the derived or declared mutation touch set (silent stale UI)                                                                             |
| KV403 | warn       | Declared domain never observed written (stale claim / untested branch)                                                                                                         |
| KV404 | error      | Write to unmapped table (map it or mark `exempt`, e.g. append-only logs — write-side only, §10.1)                                                                              |
| KV405 | warn       | Conditional writes on branches never executed under instrumentation                                                                                                            |
| KV406 | warn/error | Statically un-analyzable write site — manual `touches` required, runtime-verified                                                                                              |
| KV407 | error      | Query read from a domain not covered by the derived or declared query read set (missed invalidations)                                                                          |
| KV408 | error      | Declared row key ≠ observed row predicate                                                                                                                                      |
| KV409 | notice     | Non-eq predicate — degraded to table-level invalidation                                                                                                                        |
| KV410 | error      | Opaque query projection (`sql<T>`, raw SQL) — declared output schema required, shape runtime-verified (§10.2)                                                                  |
| KV411 | error      | Query read set includes an `exempt` table — exemption is write-side only (§10.1), runtime-verified (§11.2)                                                                     |
| KV412 | error      | Query reads an unmodeled relation (view / materialized view) with no derived or declared domain (§10.1/§11.1)                                                                  |

The shared `diagnosticDefinitions` registry is the source of each diagnostic's severity; surfaces
must not override severity or invent local blocking policies. A diagnostic with `error` severity
blocks the Vite dev transform by throwing a teaching error rendered by Vite's overlay and terminal,
blocks build and static export before output is written, and makes dev-mode page, fragment, or
mutation requests that depend on the failed module return a server-rendered teaching-error
document with HTTP 500. `warn`, `lint`, and `notice` diagnostics are non-blocking on dev transform,
build, and static export; they may be summarized or streamed through the surface's non-blocking
diagnostic channel, but they do not trigger dev teaching-error documents. MCP tools expose the same
structured diagnostics (code, severity, message, help, and position when available) from the
compile/check/explain APIs; MCP is a rendering/query surface, not a second diagnostic channel.

### 11.4 The verification surface (the Keppo contract)

For a Kovo app, the following are checkable **without executing a browser**:

1. TypeScript static checking — all wiring (handlers, routes & links, forms, targets, bindings, IDREFs, transforms, guards).
2. `kovo check` — touch-graph consistency, optimistic exhaustiveness (KV310), update coverage (KV311), fixpoint + render-equivalence invariants, unguarded and unscoped audits.
3. Graph queries over `kovo explain` output — intent-level assertions ("every component displaying cart data is refreshed by cart/add") as set operations over printed, stable-format graphs.
4. Property suite — prediction ⊆ eventual-truth generative tests over hand-written transforms and derivation soundness (commuting diagrams).
5. HTTP-level integration tests — mutations as request/response assertions against pglite (real Postgres semantics, in-memory, no container).

`kovo explain --endpoints` is the stable machine-ingress audit. Its diffable table lists every declared endpoint and webhook plus every route that returns `respond.file()`/`respond.stream()`: name, method, path, mount mode, auth scheme (`session+guard`, `verifier:<resolved scheme>`, `custom:<name>`, or `none:<justification>`), CSRF posture (`checked` or `exempt:<justification>`), and for webhooks the write→domain chain. The command is snapshot-locked with the rest of P8 output so security review can answer "what can reach this app, and what can it touch?" without executing a browser.

Browser tests are a first-class part of the **framework's** own suite: morph runs on every mutation response, and its survival contract (focus, caret, scroll, transitions) plus L0 platform behaviors are irreducibly browser-bound. The reconciliation suite splits accordingly: a browser-free structural property suite (`morph(a, b) ≡ b` with keyed-node identity preserved — runs in jsdom-class DOM), and a named browser suite for the survival contract. The claim is bounded: **application wiring is proof-carrying**, so apps need few or no browser tests of their own — most SPA testing exists to compensate for unverifiable wiring, and Kovo removes that category, not testing itself.

---

## 12. Testing API

```ts
import { kovoTest } from '@kovojs/test/test-case';

const cartMutations = kovoTest('cart mutations', async ({ exec, page, db }) => {
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
it(cartMutations.name, cartMutations.run);

// transform soundness: prediction ⊆ eventual truth over generated states
// generated alongside derived transforms as the commuting-diagram suite
propertyTest(addToCart, cartQuery); // patch∘shape ≡ shape∘apply over generated states
```

Handlers unit-test as `(event, ctx)` functions; transforms as pure `(data, input)`; the wire as HTTP.

---

## 13. Related Rules and Roadmaps

`SPEC.md` is the normative source of framework behavior. The following files
carry standing conformance rules, release gates, implementation roadmaps, and
explanatory examples:

### 13.1 StyleX and Theme Tokens

Kovo component styles are authored as TSX/JSX source with `@kovojs/style`
objects. The compiler may extract static `style.create(...)`, `style.defineVars(...)`,
`style.createTheme(...)`, and compiler-known imported token references into
ordinary CSS assets, but it may not turn lowered style IR into a second
app-authoring surface (§5.2). Extracted rules are global atomic CSS with stable
provenance, not shadow-DOM scoped rules; components remain light DOM so form
participation, IDREFs, and accessibility relationships cross component
boundaries.

Theme tokens are document CSS custom properties. A seed-generated Kovo theme
emits reference palette variables such as `--kovo-theme-ref-palette-primary-40`
and Material system role variables such as `--kovo-theme-sys-color-primary` on
`:root` and dark-theme selectors. Component styles may reference typed public
tokens from `@kovojs/style`, but the runtime value is still a CSS custom property
resolved by the document. No core runtime theme store, hydration graph, or shadow
boundary is introduced for theme selection.

- Accessibility conformance: `rules/accessibility-conformance.md`
- Data-layer policy: `rules/data-layer-policy.md`
- v1 acceptance gates: `rules/v1-acceptance.md`
- Open design areas: `plans/open-design-areas.md`
- Data-layer roadmap: `plans/data-layer-roadmap.md`
- Risk register: `docs/risk-register.md`
- Worked add-to-cart example: `docs/worked-example-add-to-cart.md`
