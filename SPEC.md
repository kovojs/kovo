# Jiso — Product Requirements & Technical Specification

**Version:** 0.2 (Draft)
**Status:** Design specification for v1, with staged roadmap through v3
**Audience:** Framework implementers, early adopters, AI app-builder integrators

---

## 1. Vision

Jiso is a web-platform-native framework for building multi-page applications that are **interactive at first paint, legible at every layer, and statically verifiable end-to-end.**

It takes resumability from Qwik, server-driven UI from htmx/LiveView, tag-based invalidation from RTK Query, rebase-based optimism from Replicache, and document-first architecture from the platform itself — and composes them around one organizing constraint: _every artifact the system produces (compiled output, HTML, wire traffic, dependency graphs) must be readable by a human in devtools and checkable by a machine without executing a browser._

### 1.1 Thesis statement

> An application's complete behavior — every handler wiring, navigation target, form field, mutation contract, data dependency, and optimistic prediction — should be provable by TypeScript static checking plus static graph queries, and auditable by reading the page source and the Network panel.

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
        │ fixpoint:              │ 1:1 file mapping,                │ 4KB loader: global event
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

### 3.1 Rejected from prior art

Client router and SPA navigation; hydration; hash-named heuristic chunks; load-bearing semantic optimizer; single global state blob; **runtime signal graphs in the core client — proprietary or TC39** (the client dependency graph is compile-time-known, so the compiler emits a per-query update plan instead; a TC39 Signals interop adapter is v2); opaque closure capture (`useLexicalScope`); client-side cache with invalidation lifecycle; manual invalidation calls as the primary mechanism; **shadow DOM** (tree-scoped IDREFs, form participation, and ARIA all break at the boundary — fatal to L0 platform behaviors and the no-JS form contract; style scoping comes from the compiler instead, §13.1); **custom-element registration** (resumability comes from delegation + `import()`, never from `customElements.define`; component identity is the `fw-c` stamp, dashed tags survive as inert sugar, and native hosts like `<tr fw-c="cart-row">` end the table-nesting papercut); **load-bearing import maps** (the compiler and server emit full module URLs with cache-busting they control; import maps remain an optional deployment strategy); **portals and runtime context APIs** (composition is lexical at render time and the DOM tree is the runtime context, §4.5 — framework code never reparents islands, so `closest('[fw-c]')` resolution stays sound; native top-layer promotion (`<dialog>`, popover) does not reparent, which is exactly why no portal is needed).

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
      🛒 <span>{cart.count}</span> {/* compiler derives data-bind="cart.count" (§4.8) */}
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

Components render to **light DOM** as plain, never-registered elements — no shadow roots, no `customElements.define`, no upgrade step (§3.1). The load-bearing identity is the `fw-c` stamp; the compiler omits it when the host tag already spells the component name (`<cart-badge>` — dashed tags are inert sugar for Elements-panel readability) and emits it explicitly on native hosts (`<tr fw-c="cart-row">`, so content-model nesting like tables just works). Co-located CSS is compiler-scoped to the host (`@scope`, donut-scoped to exclude nested islands) and deduped into one per-page stylesheet (§13.1). Because there is no shadow boundary, IDREF wiring (`commandfor`, `for`, `aria-*`), native form participation, and find-in-page work document-wide — the L0 layer and the no-JS form fallback depend on exactly this. The compiler also validates JSX nesting against the HTML content model (**FW225**): markup the parser would re-parent (`<div>` in `<p>`, `<tr>` outside a table) makes the served HTML and the parsed DOM disagree, silently breaking morph identity and fragment targets — so it is a compile error, not a runtime surprise.

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

**Capture channels (exhaustive):** component/query state (via `ctx`), element params (`data-p-*`, typed — attribute values arrive as strings, so non-string params declare coercion once, schema-style, exactly like form fields §6.3), module scope (shared, not captured). Anything else is compile error `FW201`, whose message shows what the closure _would have_ compiled to and the three fixes.

### 4.4 The loader

A 4KB inline script. Responsibilities: global event delegation (capture phase) for all `on:*` events — including chained refs (space-separated, invoked left-to-right, §4.6) and the three execution triggers (`on:visible` via one shared IntersectionObserver, `on:idle`, `on:load` — §4.7); parse `url#export` refs, `import()` the URL, invoke the export with `(event, ctx)`; per-island `AbortSignal`s (`ctx.signal`, aborted when the morph layer removes the island, §4.7); enhanced form interception (§9); query-data hydration from `fw-query` scripts; running the update plan (bindings → named derives → stamps, §4.8) when a query value or island state changes — executed by walking the self-describing attributes, no separate plan artifact; refetch-on-focus/visibility over the typed read endpoint (§9.3, §9.4); morph application — the morph layer itself accounts for islands it patches in and aborts the signals of islands it removes (nothing is registered; there is no upgrade step or lifecycle callback). Nothing else lives in the always-loaded path.

### 4.5 Composition: children, slots, layouts

Composition is **render-time function composition** — there is no client re-render, so projection happens exactly once, on the server. Three rules:

**1. Children are a render-time value.** JSX children lower to an opaque `Html`-typed argument; named slots are just named `Html`-typed props. The lowered IR is a plain function call — fixpoint-trivial:

```tsx
export const Card = component('card', {
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

**2. Compound components coordinate through lexical scope and the DOM — there is no context API.** At render time, sub-parts are functions sharing scope (a `Dialog.Root` generates ids and passes them down as ordinary arguments; FW221 validates the IDREF wiring). Ids are **unique by construction**: generated ids are keyed to the render site, and a static `id` in a component the compiler cannot prove renders at most once per page is **FW224** (derive it from `fw-key`/props instead) — FW221 proves an id _exists_; FW224 keeps that proof meaningful by forbidding duplicates, including under list stamping and fragment patch-in. At runtime, the tree is the context: a sub-part's handler resolves its island via `closest('[fw-c]')`, which `ctx` already does. This is sound because **framework code never reparents islands** (normative; dev mode asserts it). Native top-layer promotion (`<dialog>`, popover) does not reparent — exactly why Jiso needs no portal.

**3. Fragment-target children must remain server-renderable.** A `fragmentTarget: true` component's subtree must be reconstructible from (declared queries ∪ stamped props) — and call-site children are part of that subtree. They are therefore **lowered to component references**: the compiler hoists JSX children into a named component (`Parent$slot_children`) when their free variables fit the stamped-prop channels (the same lowering discipline as handlers, §4.3), records the reference + props in the target's stamps, and re-renders the full subtree on fragment patch. Children that cannot be hoisted (unserializable captures) are compile error **FW230**, whose message shows the hoisted component that _would_ have been generated and the fixes. Morph-preserved "slot holes" were considered and **rejected**: a fragment response must fully describe the DOM it produces (Constitution #4, #5) — there is no region the server cannot refresh.

**Layouts are function composition — a stated position.** v1 has no nested-layout convention. A layout is a component with children, applied in `route().page` (`page: () => Shell({ children: ProductPage(…) })`). Every navigation is a full document, so there is no persistent-layout state to manage; cross-document View Transitions carry the visual continuity. A route-tree convention may arrive later as sugar lowering to exactly these calls (Constitution #3).

**Payload posture, stated plainly:** projected children ship in the initial HTML — all tab panels, dialog bodies, accordion contents. There is no client-side lazy mount; `<fw-defer>` (§8) is the relief valve for expensive subtrees. This is the MPA posture, chosen, not overlooked.

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

**Behavior attributes (trigger-shaped cases):** annotate instead of wrap — `<a href="/pricing" fw-tooltip="pricing-tip">` — the invoker-commands idiom (`commandfor`/`command`) extended upward from L0; the IDREF is validated by FW221. This is also the only spelling that works on markup Jiso didn't render (CMS content, markdown).

**Rejected:** a polymorphic `as` prop — it composes only with intrinsic tags, and polymorphic typing is the heaviest TS pattern known (§15 type-perf risk) for the weakest payoff.

**Merge rules (normative).** Merging happens once, at render; conflicts resolve per attribute class:

| Attribute class                                                                | Rule                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `class`                                                                        | Concatenate (primitive first, author last), dedupe, stable order                                                                                                                                                                                                                                                        |
| `style`                                                                        | Concatenate; author declarations last (later wins per property)                                                                                                                                                                                                                                                         |
| `on:<event>`                                                                   | **Chain**: space-separated refs, author's first, then primitive's; the loader invokes left-to-right, sequentially awaited; `defaultPrevented` does **not** stop the chain (platform semantics) — primitive handlers contractually no-op when `event.defaultPrevented` (linted in the primitive package, not the loader) |
| `id`                                                                           | Author wins; the primitive rewires its IDREF references to the surviving id (FW221 validates the result)                                                                                                                                                                                                                |
| IDREF attrs (`commandfor`, `popovertarget`, `for`, `aria-controls`, …)         | Both set → **error FW231** (double-wired relationships are ambiguity, not composition)                                                                                                                                                                                                                                  |
| `aria-*`, `role`                                                               | Author wins, **lint FW232** (the escape hatch stays open; the override stays visible)                                                                                                                                                                                                                                   |
| `data-state` & primitive-owned `data-*` state attrs                            | Primitive wins, **lint FW232** (runtime-updated values; a static override would be clobbered on first state change)                                                                                                                                                                                                     |
| `data-p-*` (handler params)                                                    | Same param from both → **error FW231**                                                                                                                                                                                                                                                                                  |
| Binding attrs (`data-bind`, `data-bind:*`)                                     | Same target slot → **error FW233**; distinct targets compose                                                                                                                                                                                                                                                            |
| `disabled`, `aria-disabled`, `required`, `readonly`                            | Logical OR                                                                                                                                                                                                                                                                                                              |
| Other scalars (`type`, `href`, `tabindex`, `value`, `view-transition-name`, …) | Author wins; the primitive value is a default (used only when the author is silent)                                                                                                                                                                                                                                     |
| `fw-deps`                                                                      | Union                                                                                                                                                                                                                                                                                                                   |
| `fw-c`, `fw-state`                                                             | Both present → **error FW231** (one element = one island)                                                                                                                                                                                                                                                               |

### 4.7 Execution triggers

"Execute nothing until interaction" is a proxy for the real invariant: **execute nothing the page didn't declare, and make every trigger legible in markup.** Interaction is the default trigger; three declared alternatives extend the same `on:*` → delegate → `import()` → named-export model:

```html
<sales-chart on:visible="/c/chart.client.js#SalesChart$mount" fw-deps="sales"></sales-chart>
<search-index on:idle="/c/search.client.js#Search$warm"></search-index>
<stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
<!-- lint-gated -->
```

- **`on:visible`** — one shared IntersectionObserver; fires once on first intersection. Charts, maps, carousels, lazy embeds.
- **`on:idle`** — `requestIdleCallback`; warm-up work.
- **`on:load`** — fires at parse. The honest escape hatch: it reintroduces eager JS, so lint **FW211** requires a justification comment, and `grep 'on:load'` is the app's eager-JS budget.

The set is closed — `on:media` is CSS's job; timers belong inside handlers. Islands patched in by morph are observed like everything else (the morph layer already accounts for islands it patches in, §4.4).

**Lifecycle is one primitive:** `ctx.signal`, an `AbortSignal` aborted when the morph layer removes the island (or the document tears down). Long-running handlers (autoplay loops, map instances, observers) register cleanup on it; there are no mount/unmount callbacks.

### 4.8 The update plan: bindings, derives, stamps

**The DOM is the plan.** There is no separate compiled-plan artifact: binding attributes are self-describing, the loader executes them by walking the tree under `fw-deps` islands, and compile-time knowledge is used for _typing_ only. When a query value — or island-local state; same machinery, two data sources — changes, the loader runs, in order:

**1. Bindings — path writes.** `data-bind="cart.count"` sets text content; `data-bind:<attr>` sets attributes (`data-bind:value`, `data-bind:hidden`). Grammar: dot paths only — no expressions, no indexing (arrays are stamps' job). Paths type-check against the query's inferred shape (§6.2).

**2. Named derives — the expression layer.** A derive is a named, exported, pure function with declared inputs — exactly parallel to handlers:

```ts
// cart.client.js — authorable IR
export const Cart$isEmpty = derive(['cart'], (cart) => cart.count === 0);
```

```html
<button data-bind:disabled="/c/cart.client.js#Cart$isEmpty">Checkout</button>
```

Declared inputs tell the loader which query changes re-run it — no dependency tracking — and the module loads lazily on the first relevant change, preserving resumability. Inline JSX expressions in bound positions lower to named derives (the FW210 naming nudge applies). Minification cannot rename them (Constitution #1); `fw explain component` lists every derive with its inputs.

**3. Template stamps — keyed list reconciliation.**

```html
<ul data-bind-list="cart.items" fw-key="productId">
  <template fw-stamp>
    <li><span data-bind=".qty"></span> × <span data-bind=".name"></span></li>
  </template>
  <li fw-key="p1"><span data-bind=".qty">2</span> × <span data-bind=".name">Mug</span></li>
</ul>
```

On change, the loader keys existing `[fw-key]` children against the new array: clone the template for inserts, remove exits, reorder by key, then run item-relative bindings (`.qty`, typed against the array element type). **`fw-key` is the single keyed-identity contract** — written once (spike S3) and shared verbatim by stamps, morph, and optimistic reordering (§13.2).

**Stamps are derived, never required in sugar.** `{cart.count}` and `data-bind="cart.count"` are one fact; the author writes the typed expression, the compiler emits the stamp. Classification: an expression that is an element's sole text child stamps that element; an expression in mixed content gets a synthesized `<span data-bind>` (reported in `fw explain component` — wrap it yourself if the extra element matters); an expression in attribute position lowers to a named derive (above). Hand-written stamps remain valid input — ejected IR is made of them (Constitution #3) — but in sugar they are redundant (lint **FW223**), and a stamp that disagrees with the expression it wraps is an error (**FW222**): server-renders-one-thing-loader-patches-another drift is unrepresentable. The general rule, normative framework-wide: **a residual string may be _required_ only in ejected IR; sugar never demands a string the compiler can derive from a typed expression.**

**The ceiling is explicit, and the relief valve is defined.** Anything beyond paths, derives, and keyed lists flips to a server fragment — or to an **isomorphic island**: `isomorphic: true` on a component also emits its render function into the client module; on query/state change the island re-renders itself and self-morphs. It is the _same_ render function the server uses (partials cannot drift), and it is lint-gated (**FW302**: justification comment required) — this is the sanctioned SPA-creep escape named in §15.

### 4.9 Update coverage (exhaustiveness)

§10.6 proves every invalidated query has an optimistic story; this is the same theorem one hop further down the dataflow: **every query-dependent position in rendered output must have a declared update status**, or the page renders data it will never refresh — the silent-staleness bug §10.6 exists to kill, recurring on the client side of the wire. The framework rejected runtime dependency tracking (§3.1), and the thing removed was also the thing that guaranteed coverage in SPA frameworks; a static plan needs a static completeness proof.

During lowering, the compiler classifies every render-output position that reads query data:

| Status       | Meaning                                                                         | Latency                           |
| ------------ | ------------------------------------------------------------------------------- | --------------------------------- |
| `plan`       | lowered to a binding, derive, or stamp (§4.8)                                   | instant; participates in optimism |
| `isomorphic` | island self-renders on change (§4.8, FW302)                                     | instant; costs the render module  |
| `fragment`   | inside a `fragmentTarget` — server re-renders it on mutation responses (§9.1)   | 1 RTT — **no optimistic update**  |
| `renderOnce` | declared immutable for the document's lifetime (suppression recorded in source) | never                             |

A position fitting none of these is **FW311**. The teaching error shows the classification, why the position exceeds the plan grammar, and the fix menu — extract a derive, lower to a CSS/attribute toggle, `fragmentTarget: true`, `isomorphic: true`, or declare `renderOnce`:

```
fw check coverage
query cart:
  cart-badge   span text          plan: binding ✓
  cart-badge   button class       plan: derive (CartBadge$button_class) ✓
  cart-badge   conditional <dot>  UNHANDLED ⚠ FW311
     → derive + [hidden] toggle, fragmentTarget, isomorphic, or renderOnce
  mini-cart    (subtree)          fragment ✓ — no optimistic update (declared)
```

Like FW310, the check runs at two altitudes off one derived set: in the compiler during lowering (editor-visible) and as `fw check coverage` (CI/agents). Together with §10.6 and the touch graph, a mutation's full dataflow is exhaustiveness-checked edge by edge: write → invalidated queries (§11.1) → optimistic prediction (FW310) → every dependent DOM position (FW311) → fragment reconcile (§9.1). No edge may be silently uncovered — Appendix A's "nothing to remember" promise holds _unconditionally_, not just inside the plan grammar.

---

## 5. Compiler

### 5.1 Pipeline

```
cart.tsx ──parse──▶ analyze ──lower──▶ cart.server.js + cart.client.js ──(prod only)──▶ minify*
                       │
                       ├─▶ generated/registries/*.d.ts   (module aliases, fragment targets, query keys, domains,
                       │                                  routes, element ids, invalidation sets)
                       ├─▶ generated/touch-graph.ts      (§11.3 — committed, reviewable)
                       └─▶ generated/optimistic/*.ts     (§10.4 — v2; committed, overridable)
```

\* Minification may never rename exported handler symbols or anything appearing in HTML attributes (Constitution #1 — enforced because those names are load-bearing at runtime).

### 5.2 Hard rules (normative)

1. **Source-derived names.** Extracted handlers are named `Component$fnName`, or `Component$element_event` when anonymous (lint `FW210` nudges naming). Content hashes appear only in cache-busting query strings on the emitted module URLs (or ETag-driven — a deployment choice the framework controls server-side).
2. **1:1 file mapping.** `x.tsx` → exactly `x.server.js` + `x.client.js`. No heuristic chunking. A prod-only merge pass for tiny modules is opt-in (`jiso.config: mergeClientModules`), defaulting off.
3. **Fixpoint invariant.** `compile(compile(src)) === compile(src)`; the IR is valid input. CI test ships in the starter template. Paired with a **semantic gate**: `render(src) ≡ render(compile(src))` — authored and lowered components must produce byte-identical HTML over the test corpus (a browser-free differential suite), so the fixpoint proves behavior preservation, not merely syntactic idempotence.
4. **Platform-behavior emission.** Where the compiler proves a handler equivalent to a declarative platform feature (dialog open/close → invoker commands; popovers; `<details>`; pure-CSS state via `:has()`), it emits the attribute and drops the handler. `fw explain` reports each substitution.
5. **Teaching errors.** Every diagnostic shows the lowering: what would have been generated, why it can't be, and the fix menu.
6. **Registry atomicity.** Registry `.d.ts` emission is part of every compile; `vp dev` and `vp check` regenerate registries before type-checking runs. A stale registry is unrepresentable, not just unlikely — the typegen failure modes (fresh clone red until first generation, watch-mode races) are designed out.

### 5.3 `fw explain`

The compiler's decision tree, on demand. Sub-commands (all output stable, diffable text — agents consume the same artifact humans read):

```bash
fw explain component cart        # lowerings: extracted handlers, derives, capture channels, platform substitutions, attribute merges, triggers
fw explain mutation cart/add     # writes → domains → invalidated queries → consumers; guard chain
fw explain mutation cart/add --optimistic   # transform coverage per query; v2 adds derivation traces + punts (§10.5)
fw explain query cart            # read set, consumers, every mutation that invalidates it
fw explain page /products/:id    # emitted modulepreloads, per-route prefetch config, param/search schemas, query payloads
```

---

## 6. Type System

One pattern, applied everywhere: **declare facts once → derive every surface → validate residual strings against generated registries.** The only codegen is trivial registry `.d.ts` files; all wiring checks are TypeScript static checks over code that runs as written. Residual strings are only ever **required** in ejected IR (§4.8) — sugar derives them from typed expressions; every load-bearing attribute the IR carries (`on:*`, `data-bind*`, `fw-deps`, `fw-c`, `fw-key`, `href`, IDREFs) has a named validator in §11.3, so "all residual strings are validated" is a checkable claim, not an aspiration.

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
interface RouteRegistry {
  '/products/:id': typeof productRoute;
  '/cart': typeof cartRoute;
}
interface PageIds {
  /* 'cart-drawer' | … — every compiler-known element id, scoped per page (§6.4, FW221) */
}
interface InvalidationSets {
  'cart/add': 'cart' | 'product'; // emitted from the touch graph (§11.1) so OptimisticFor
  // can demand a transform (or 'await-fragment') per invalidated query in tsc (§10.6)
}
```

### 6.2 Typed surfaces (summary table)

| Surface               | Source of truth                     | What TypeScript proves                                                                                                               |
| --------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Handler refs          | client module exports               | `cart.remove` exists; params required & typed; typo = error                                                                          |
| Form fields           | mutation input schema               | names ∈ schema; types match; **completeness** (missing required field = error); coercion declared once                               |
| Fragment targets      | component registry                  | target exists; patched with the right component's props                                                                              |
| Query data / bindings | Drizzle select shape (`$infer`)     | `data-bind` paths exist; column rename propagates to every template                                                                  |
| Invalidations         | domain layer / touch graph          | invalidated keys exist; optimistic exhaustiveness in `tsc` via emitted invalidation sets (§10.6)                                     |
| Errors                | declared error codes                | `onError` receives exhaustive discriminated union                                                                                    |
| Guards                | guard combinators                   | `req.session.user` non-null under `authed`; static audit of unguarded mutations, routes, and queries                                 |
| State                 | `JsonValue` constraint              | serializability by construction                                                                                                      |
| Routes / links        | `route()` declarations (§6.4)       | `href`/`<Link>`/`redirect()` target exists; path params required & typed; search params typed; route rename propagates to every link |
| GET forms / URL state | route `search` schema               | field names ∈ search schema; coercion declared once; the §7 URL channel is typed                                                     |
| IDREFs (L0 wiring)    | compiler id registry                | `commandfor`/`popovertarget`/`for`/`aria-*` reference an id that exists in scope (FW221)                                             |
| Sessions              | declared session schema (§6.5)      | `req.session` fully typed; instance keys (§10.2) and guard refinements rest on typed fields                                          |
| Derives               | declared inputs (§4.8)              | derive inputs exist in `QueryRegistry`; input types match query shapes; bound attribute targets type-checked                         |
| Stamp lists           | query result element type           | `data-bind-list` paths are arrays; item-relative paths exist on the element type; `fw-key` names a real field (§4.8)                 |
| Slots / children      | hoisted component refs (§4.5)       | fragment-target children lower to component references with serializable props (FW230)                                               |
| Query args            | query `args` schema (§10.2)         | components bind args from their own props; coercion declared once; instance keys typed end-to-end (store, wire, optimism)            |
| Update coverage       | render-output classification (§4.9) | every query-dependent DOM position has a status — `plan` / `isomorphic` / `fragment` / `renderOnce`; none is FW311                   |
| Opaque projections    | declared output schema (§10.2)      | `sql<T>`/raw projections carry `s.*` output schemas (FW410); observed result shape runtime-verified (§11.2)                          |

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

Where the mutation value is importable — server-rendered templates always can — `form(addToCart)` is the preferred spelling: inference straight off the value, no registry hop. The string-keyed form survives for sites that can't import the value.

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
     Constitution #1 (legible), #3 (a string href is valid Jiso source), #4. -->
<a href="/products/p1?max=500">View</a>
```

`redirect('/products/:id', { params })` types the POST-redirect-GET path (§9.1) the same way. Residual literal `href`s in hand-authored IR are validated against the route table at compile time (FW220); full-origin URLs and an `external` marker opt out. The propagation property of §6.2 holds for navigation too: renaming a route path turns every `<Link>`, GET form, and `redirect()` in the app red under `vp check`.

Two more route-level affordances close the request shell: **guards** — `guard:` on a `route()` runs the same combinator chain as mutations (§10.3) before `page`, refines `req.session` identically, and enrolls the page in the `fw explain --unguarded` audit; and **`notFound()`** — returning `notFound()` from `page` renders the app's 404 page with the correct status, so status codes stay part of the typed surface rather than ad-hoc response construction. `redirect()` and `notFound()` are the only sanctioned non-200 page outcomes in v1.

### 6.5 Session schema

Sessions are a declared `s.object` schema, not an `any` bag: `req.session` is fully typed everywhere it appears. This is core, not a nicety — query instance keys (§10.2) and guard refinements (`req.session.user` non-null under `authed`, §6.2) are load-bearing on session fields, so an untyped session would be a hole directly under the proof surface.

### 6.6 Soundness boundary (normative)

The §1.1 proof claims are claims about TypeScript programs that stay inside the sound subset. The starter therefore ships — and the docs state as a precondition — `strict` everything plus lint bans on `any`, non-null assertions, and `as` casts in app code. Three boundaries are runtime-validated regardless, by design: the **wire** (every mutation input passes its `s.*` schema — types-without-validators, raw-tRPC style, was rejected); **deploy skew** (a long-lived document POSTing yesterday's form shape is answered by schema validation and the 422 path, §9.2 — never undefined behavior); and **CSRF** — `fw-csrf` (§9.1) is a session-bound synchronizer token stamped into every emitted form and verified before the guard chain on every mutation POST. Deploy skew also covers handler modules, normatively: emitted module URLs are immutable and versioned, and the serving layer retains prior versions — an old document's `on:*` refs keep resolving after a deploy; first interaction on a still-open tab never 404s.

---

## 7. The Interaction Ladder

Interactions must use the lowest layer that suffices. The compiler enforces L0 substitutions; lints nudge the rest. Navigation between _places_ is always a real navigation (§8); the ladder governs interaction _within_ a place.

| Layer       | Mechanism                                                                                                                                  | Example                               | JS shipped                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | -------------------------------------- |
| **L0**      | Platform behaviors: invoker commands, Popover API, `<details>`, `<dialog>`, `:has()`, scroll-driven animations                             | Open cart drawer                      | 0                                      |
| **L1**      | Pure client islands: local state + the update plan (bindings/derives/stamps, §4.8); loaded on interaction or a declared trigger (§4.7)     | Price-range filter UI, tabs, carousel | handler module on first touch          |
| **L2**      | Mutations: real forms + enhanced fetch → fragment/query patch                                                                              | Add to cart                           | loader (already present) + form module |
| **L3**      | Optimistic: declared transforms over query values (compiler-derived in v2)                                                                 | Instant badge tick                    | transform module                       |
| **L4 (v2)** | Live: SSE pushing the same fragment/query vocabulary — v1 covers the common cases with BroadcastChannel tab sync + refetch-on-focus (§9.3) | Order status, presence                | `<fw-live>` subscriber (v2)            |

**Cross-island coordination**, in order of preference: (1) **the URL** — filter writes `?max=500`, or is a GET form whose fragment response is the grid, both typed against the route's `search` schema (§6.4); (2) **typed fire-and-forget events** — registry-checked `emit('cart:added', {…})`, payload types may not overlap query data (lint `FW320`: if you're sending server facts over an event, you wanted an optimistic transform); (3) **shared client state** — last resort, lint-gated with required justification comment.

---

## 8. MPA Spine & Navigation

- **No client router.** Each page is a complete document; route handlers are server functions declared with `route()` (§6.4), which carries the path's literal type, param/search schemas, and per-route config. `<Link>`/`href()` are compile-time sugar lowering to plain `<a href>` — TanStack-Router-class link typing with zero router runtime.
- **Speculation Rules** are opt-in config, never auto-emitted: `prefetch: 'conservative' | 'moderate' | false` per route, declared on the `route()` object (§6.4), **default off**. Auto-prerender owns a real footgun matrix — analytics firing inside prerendered pages, non-idempotent per-user renders, discarded-render server cost — so apps opt in route-by-route where renders are idempotent and cheap. The feature is one `<script type="speculationrules">` tag; the MPA is fast without it.
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
- `<fw-query>` replaces the client's query value and runs that query's update plan — bindings, named derives, stamps — across every dependent island. No runtime dependency tracking: the plan is the DOM itself — self-describing binding attributes typed at compile time (§4.8); there is no separate plan artifact.
- `<fw-fragment>` is **DOM-morphed** (idiomorph-class algorithm): focus, scroll, selection, CSS transitions, and nested island state survive. Patched-in islands are inert-until-touched like everything else — _a fragment update is a tiny navigation, not a different programming model._
- **Without JS:** the same endpoint sees no `FW-Fragment` header and answers POST-redirect-GET with errors re-rendered into the full page. One handler, two response modes.

### 9.2 Errors

Validation failures (schema, with field paths) and declared error codes return a fragment re-rendering the form with messages (default generated from schema paths; overridable per-form), HTTP 422. The enhanced path morphs just the form; the no-JS path re-renders the page. `ctx.submit`'s `onError` receives the typed union.

### 9.3 Liveness (v1) and Live (L4 — v2)

**v1 ships liveness only where the server stays stateless:**

- **BroadcastChannel rebroadcast** — a mutation's `<fw-query>` response is rebroadcast to the user's other tabs; same-user multi-tab sync at zero server cost.
- **Refetch on focus/visibility** — a loader behavior (per-query opt-out) that re-runs queries (over the typed read endpoint, §9.4) when a stale tab returns; it fakes an embarrassing share of "live" UX for one conditional in the loader.

**The full L4 moves to v2**, arriving alongside the CDC adapter (§14): `<fw-live query="cart">` subscribing over SSE to the identical `<fw-query>`/`<fw-fragment>` chunks; guards re-checked at subscription **and** at each push (a guard that passed at render must pass at patch time — fragments must not become a privilege-escalation side channel); in-process emitter (single node) or Redis pub/sub (multi-node); instance-key routing; `live: true` opt-in per query. The vocabulary is transport-agnostic by construction, so SSE is an additive transport, not a rearchitecture — and the v1 server stays stateless, full stop.

### 9.4 Typed reads: the query endpoint

Every query is addressable over GET — one read surface serving refetch-on-focus (§9.3), GET-form fragment responses (§7), async option/search reads, and (v2) the SSE subscription key:

```http
GET /_q/product?id=p1 HTTP/1.1
FW-Fragment: true
```

```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8

<fw-query name="product:p1">{ "name": "Mug", "stock": 4 }</fw-query>
```

Args arrive as search params through the query's `args` schema (§10.2) — the same `s.*` coercion machinery as forms. The query's `guard` (§10.2) is checked on **every** read, and reads are part of the unguarded audit. The instance key in the response (`product:p1`) is the §10.2 canonical encoding, so the client store, `fw-deps`, `FW-Targets`, optimistic keys, and (v2) live routing all speak one currency.

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

Tables default to a same-named domain; annotations group tables into logical domains and declare key granularity. The reverse index (table → domain), the `DomainKey` type, and key extractors are all generated from this single file. An optional `owner:` annotation (`jiso({ domain: 'cart', owner: (t) => t.userId })`) names the column tying a table's rows to a principal — it powers the `--unscoped` audit (§10.3).

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
  guard: authed, // optional — checked at page render AND at every typed read / (v2) live push
  load: (db, args, req) =>
    db
      .select({ name: products.name, stock: products.stock })
      .from(products)
      .where(eq(products.id, args.id)),
});
```

Derived from this one expression, statically:

- **Read set** `{cart, product}` — the JOIN _is_ the declaration (forgetting a joined entity's dependency, RTK Query's endemic bug, is unrepresentable).
- **Result type** from the select shape — drives the client JSON, `data-bind` paths, derive inputs, and optimistic transform parameters. A column rename in `schema.ts` propagates through TypeScript static checking to every template. **Opaque projections are the read-side raw-SQL seam:** Drizzle's `sql<T>` generic is an unchecked assertion — a cast wearing a type's clothes — so any `sql`/raw projection requires a declared `s.*` output schema (**FW410**), and the observed result shape is runtime-verified (§11.2). The inferred-type chain stays sound or the seam is visible; never both unsound and silent.
- **Instance key** from the WHERE eq-predicates, resolved to `args.*` or `req.session.*` — only args are client-visible. Canonical encoding: `name:keyValue` in declared arg order (`product:p1`). This one string keys the client store (`<script fw-query="product:p1">`), `fw-deps` stamps, `FW-Targets` (§9.1), optimistic transform keys (§10.4), and (v2) live-push routing. Two instances of one query coexist on a page; `data-bind` inside an island resolves against that island's instance.

**Args bind locally (Constitution #2).** A component declares how its args derive from its own props — `queries: { product: productQuery.args((p) => ({ id: p.productId })) }` — so any page rendering the component satisfies the dependency without call-site knowledge. Route params reach queries as ordinary props through `route().page`; no call site enumerates query dependencies.

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
// static audit: `fw explain --unguarded` lists every mutation, route, and query reachable without `authed`
// static audit: `fw explain --unscoped` lists every query/write touching an owner-annotated
// table (§10.1) whose key predicate is not traceable to req.session — the IDOR audit; the
// §11.1 predicate extractor already does the tracing
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

The check runs at two altitudes off the same derived set: the compiler emits each mutation's invalidated-query keys into the registries (§6.1 `InvalidationSets`), so `OptimisticFor<typeof addToCart>` requires an entry — transform or `'await-fragment'` — per invalidated query, making FW310 an editor-visible type error; `fw check` remains the CI/agent surface.

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

Dev server and the test harness wrap `db`; every executed statement is parsed (`pgsql-ast-parser`) and checked. Static over-approximates (all branches); runtime under-approximates (executed branches). **Invariant: `observed ⊆ static ∪ FW406-annotated`** — violation means analyzer bug or smuggled SQL; either is a CI failure. Read-side gets identical treatment (query loaders' SELECT/JOIN tables vs. derived read sets, **and observed result shapes vs. declared/inferred types — the runtime half of FW410**, so an opaque projection's schema claim is tested against what the database actually returns).

### 11.3 Diagnostic codes (registry)

| Code  | Severity   | Meaning                                                                                                       |
| ----- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| FW201 | error      | Closure captures unserializable value (shows lowering + fixes)                                                |
| FW210 | lint       | Anonymous handler — name it for stable identity                                                               |
| FW211 | lint       | `on:load` eager trigger — justification comment required (the greppable eager-JS budget)                      |
| FW212 | lint       | Unknown `on:*` event or trigger name (DOM event names; the closed trigger set, §4.7)                          |
| FW220 | error      | Literal `href`/form `action` matches no declared route (full-origin URLs / `external` opt out)                |
| FW221 | error      | IDREF (`commandfor`, `popovertarget`, `for`, `aria-*`) references an id not present in scope                  |
| FW222 | error      | Hand-written binding stamp disagrees with the typed expression it wraps (§4.8)                                |
| FW223 | lint       | Redundant hand-written stamp in sugar — the compiler derives it (§4.8)                                        |
| FW224 | error      | Static `id` in a repeatable component / duplicate id in a page composition (§4.5)                             |
| FW225 | error      | JSX nesting violates the HTML content model — the parser would re-parent (§4.2)                               |
| FW226 | error      | `fw-deps`/`fw-c` names an unknown query instance or component (ejected-IR validation)                         |
| FW230 | error      | Fragment-target children not lowerable to a component reference (shows the hoisting + fixes)                  |
| FW231 | error      | Unmergeable attribute conflict in primitive composition (shows both sources + the §4.6 rule)                  |
| FW232 | lint       | Author override of a primitive-owned ARIA/state attribute                                                     |
| FW233 | error      | Two writers for one binding target                                                                            |
| FW301 | lint       | Server fact in island-local state                                                                             |
| FW302 | lint       | Isomorphic island — justification comment required (the sanctioned SPA-creep escape, §4.8)                    |
| FW310 | warn       | Invalidated query lacks optimistic transform (write/defer; v2 adds derive)                                    |
| FW311 | warn       | Query-dependent DOM position with no update status — plan/isomorphic/fragment/renderOnce (§4.9)               |
| FW320 | lint       | Event payload overlaps query data — use a transform                                                           |
| FW330 | lint       | Direct db access in a mutation handler — route through domain                                                 |
| FW402 | error      | Write touched an undeclared domain (silent stale UI)                                                          |
| FW403 | warn       | Declared domain never observed written (stale claim / untested branch)                                        |
| FW404 | error      | Write to unmapped table (map it or mark `exempt`, e.g. append-only logs)                                      |
| FW405 | warn       | Conditional writes on branches never executed under instrumentation                                           |
| FW406 | warn/error | Statically un-analyzable write site — manual `touches` required, runtime-verified                             |
| FW407 | error      | Query read from undeclared domain (missed invalidations)                                                      |
| FW408 | error      | Declared row key ≠ observed row predicate                                                                     |
| FW409 | notice     | Non-eq predicate — degraded to table-level invalidation                                                       |
| FW410 | warn/error | Opaque query projection (`sql<T>`, raw SQL) — declared output schema required, shape runtime-verified (§10.2) |

### 11.4 The verification surface (the Keppo contract)

For a Jiso app, the following are checkable **without executing a browser**:

1. TypeScript static checking — all wiring (handlers, routes & links, forms, targets, bindings, IDREFs, transforms, guards).
2. `fw check` — touch-graph consistency, optimistic exhaustiveness (FW310), update coverage (FW311), fixpoint + render-equivalence invariants, unguarded and unscoped audits.
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

**13.1 CSS.** Jiso v1 is Tailwind-first for app-authored styling. Starters and examples should install Tailwind through Vite+, include a static `@source` rule that covers templates and HTML, and keep utility classes statically discoverable; dynamic classes must be safelisted explicitly with Tailwind v4.1+ `@source inline("...")` so SSR pages, mutation fragments (§9.1), and `<fw-defer>` streams never reference missing CSS. Jiso still owns the framework CSS contract: emitted pages list required stylesheet assets once, preload first-party app styles when useful, and use the same stylesheet hints for full-page renders, mutation fragments, and deferred fragments. For non-Tailwind co-located component CSS, the compiler extracts rules, wraps them in `@scope` keyed to the host (dashed tag or `[fw-c=…]` stamp), donut-scopes nested islands out, emits a tag-prefixed fallback for older engines, dedupes assets in page order, and preserves fragment-target metadata so late fragments can request their styles. Design tokens are ordinary CSS custom properties; theming CSS remains document CSS because there is no shadow boundary.

**13.2 Lists at scale.** Template stamps and the shared `fw-key` identity contract are now normative (§4.8); remaining design: cursor pagination flowing through URL params, infinite scroll as fragment appends, and keyed reordering under simultaneous optimistic updates + morphing — torture-tested in the commerce grid.

**13.3 Streaming details.** `<fw-defer>` exists (§8); remaining: priority hints between deferred fragments, query-JSON placement guarantees under HTTP/1.1 fallbacks.

**13.4 Persistent cross-navigation elements.** Position: **Jiso does not support media/state surviving real navigations in v1.** Documented escape hatches (SharedWorker for sockets, popout windows for players) rather than a half-iframe architecture. Revisit if the platform ships pagewide persistent elements.

**13.5 Adopt-don't-invent list:** head/meta (typed per-route `meta()` riding the `route()` declaration, §6.4), file uploads (`s.file()` + multipart + pending-mechanism progress), per-island error boundaries, i18n (server-rendered message catalogs — easier than SPA i18n), rate limiting as guard middleware. Typed sessions graduated to core (§6.5).

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

| Risk                                                               | Mitigation / Position                                                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chromium-led enhancements (speculation rules, invokers)            | Graceful degradation is structural; baseline is a working website                                                                                 |
| Cold-cache first-interaction latency                               | `modulepreload` from rendered attributes, 103 Early Hints, HTTP/3; measure, don't hide                                                            |
| Drizzle API drift breaks inference                                 | Pinned conformance suite; declared-`touches` floor always works                                                                                   |
| Over-invalidation storms (coarse domains)                          | Row-level keys via schema annotations; FW403 surfaces excess                                                                                      |
| `derive`/shared-client-state creep toward SPA heap                 | Lints with required justifications; isomorphic opt-in (`isomorphic: true`, §4.8, FW302) as the sanctioned escape                                  |
| Derived-optimism wrong predictions (v2)                            | All-or-nothing derivation; property-tested soundness; punts are loud; deferred to v2 so v1 ships the proven hand-written path first               |
| Two-file IR + explicit data channels feel austere vs. React        | Single-file sugar + editor tooling (cheap because everything is static); day-100 > day-1                                                          |
| Query-binding layer moves some rendering clientward                | Bounded: paths/stamps/named derives only (§4.8) — no runtime signal graph; complex rendering flips to fragments or isomorphic islands (§4.8)      |
| Live bus introduces stateful infra                                 | Deferred to v2 wholesale — the v1 server is stateless; BroadcastChannel + refetch-on-focus cover the interim (§9.3)                               |
| Prerender discards cost server renders                             | Off by default; per-route opt-in where renders are idempotent, plus response caching                                                              |
| TypeScript unsoundness (`any`, casts) hollowing proof claims       | Starter ships strict config + lint bans in app code (§6.6); wire and deploy-skew boundaries are runtime-validated regardless                      |
| Deep template-literal types (params, `data-bind`) slow `tsc`       | Paths are shallow by construction (flat query shapes); TypeScript Go toolchain; registry types stay trivial lookups, not recursive solves         |
| Projected children all ship in initial HTML (no client lazy mount) | Stated posture (§4.5); `<fw-defer>` is the relief valve for expensive subtrees; payload measured under §16.1                                      |
| `on:*` chaining + trigger observers grow the loader                | Gated by the S2 4KB budget before the composition API freezes; the budget leaves room for clear control flow over compiler-synthesized shortcuts  |

---

## 16. Success Criteria (v1)

1. **Perf:** TTI ≡ FCP on first load (no hydration gap); prerendered navigations render in <50ms perceived on routes that opt in; zero session-length memory growth across 100 navigations.
2. **Legibility:** a developer who has never seen the codebase can identify what any button does, what data any island holds, and what any mutation changed — from devtools alone — in under a minute. (Run this as an actual usability study.)
3. **Verifiability:** the demo app's full behavior surface passes TypeScript static checking + `fw check` + graph assertions with **no app-level browser tests** — browser testing lives in the framework-owned L0 and morph-survival suites; an agent given only `fw explain` output answers "what updates when X is clicked" with 100% accuracy.
4. **Constitution holds:** fixpoint CI green; no feature shipped without an authorable lowering; `grep -r "invalidate(" app/` returns only documented escape-hatch sites.
5. **Coverage:** every (mutation × query) pair in the reference commerce app has an explicit optimistic status — hand-written transform or declared `'await-fragment'` — with zero unhandled FW310s. (The v2 target: derivation handles ≥70% of pairs, every punt naming its reason.)
6. **Navigation typed:** every literal href/redirect in the commerce app resolves against the route registry (zero FW220/FW221); renaming a route path turns every consumer red under `vp check` — the navigation mirror of the column-rename proof (§6.2).
7. **Declared execution only:** `grep -r "on:load" app/` returns only FW211-justified sites and isomorphic islands only FW302-justified ones — the eager-JS mirror of the `invalidate()` criterion (#4).
8. **Update coverage:** every query-dependent DOM position in the commerce app has an explicit status (`plan` / `isomorphic` / `fragment` / `renderOnce`) with zero unhandled FW311s — the client-side mirror of criterion 5.

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
products.routes.ts route('/products/:id') — params/search schemas; <Link>s and
                   redirect() targets type-checked vs RouteRegistry            [§6.4]
product.tsx        <f.Form> — fields type-checked & completeness-checked vs schema
cart-badge.tsx     {cart.count} ⇒ data-bind="cart.count" stamp         [DERIVED, §4.8;
                   fw-deps="cart"; coverage: plan ✓                     FW311 §4.9 — no code]

USER CLICKS (JS loaded):  snapshot → badge ticks instantly (fw-pending) →
  POST /_m/cart/add (FW-Targets from live DOM) → tx commits →
  <fw-query name="cart"> + <fw-fragment target="recommendations"> →
  morph reconciles (no-op if prediction was right)

USER CLICKS (no JS):      form POSTs → redirect → fresh page. Same handler.

TEAMMATE, NEXT MONTH:     ships <mini-cart> with queries:{cart} —
  it is optimistically updated by every cart mutation ever written. Nothing to remember.
```
