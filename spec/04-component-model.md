# Component Model & Authoring (SPEC §4, §13.1-§13.2)
This file is incorporated by reference from [../SPEC.md](../SPEC.md) and is normative for Kovo framework behavior.
The root spec remains the entry point and cross-reference index; this module owns the detailed contract below.
Owns component identity, authored TSX, rendered IR, handler loading, composition, primitive merging, update coverage, registry-bounded dynamic rendering, StyleX/theme-token extraction, and keyed runtime identity.

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

**Address strings vs registry identities (normative).** A first positional string argument is reserved
for externally meaningful addresses or protocol paths: route paths, endpoint mounts, capability URL
mounts, and webhook receiver paths. Framework registry identities are source-derived whenever the
compiler can prove an exported binding plus module path: components, webhooks, mutations, queries,
domains, and tags follow this rule. The derived identity is the stable name printed by explain output
and carried by generated registries and internal wire references (`/_m/*`, `/_q/*`, `kovo-deps`,
`<kovo-query>`, replay scopes, touch graphs). App-authored TSX and server modules do not write
registry-name strings merely to repeat facts the compiler can derive; emitted IR may retain residual
strings only when those strings are validated against the generated graph (§4.8, §6.1, §11.3).
Explicit strings remain appropriate for conceptual groupings that intentionally span declarations and
are not one declaration's identity, such as a shared mutation queue (§10.4).

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

A gzip-capped inline bootstrap is the only always-loaded JavaScript. Its enforced
ceiling lives in `inlineKovoLoaderGzipByteBudget` (currently 10,500 gzip bytes).
The bootstrap captures first interactions, queues or falls back safely while the
runtime loads, promotes deferred styles, and imports the versioned Kovo deferred
runtime module from the framework-owned `/c/` module registry. The deferred
runtime module is not part of the first-paint byte budget and has no SPEC gzip
cap; it is versioned, cacheable, and loaded by `import()` after the bootstrap's
first-interaction or post-paint trigger.

Deferred runtime responsibilities:

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
shows the hoisted component that _would have_ been generated and the fixes.
Because the full subtree re-renders on every fragment patch from (declared queries ∪ stamped props)
and island-local `state` rides neither channel nor any morph-preserved serialization (§9.1, §4.9),
an island declaring local `state` (or carrying `kovo-state`) inside another component's inferred
server-refreshable fragment target is compile error **KV420**. The fixes are: lift the child's state
into a declared query, mark the child `isomorphic: true` (§4.8), set `disableServerRefresh: true` on
the enclosing component, move the stateful island outside the refreshable target, or declare genuinely
document-lifetime-immutable state as `renderOnce`. If the component has `disableServerRefresh: true`,
the hoist requirement applies only to positions that still need a server fragment; ordinary §4.8 query
bindings remain valid. Fragment responses must fully describe the DOM they produce; prod may encode
that refresh as a version-validated delta (§9.1.1), but there are no morph-preserved slot holes.

**Layouts are first-class route chrome.** v1 has explicit `layout()` declarations, not a file-system
route-tree convention. A layout is still render-time function composition over `children`, but
authors attach it to routes instead of wrapping every page by hand. Layouts may be nested with an
explicit `parent`, may declare `queries`, `guard`, and per-segment `boundaries`, and are shown by
`kovo explain page <path> --layouts`. They are page chrome, not document assembly; documents are
owned by the request shell (§9.5). Runtime persistence is not part of v1: every navigation still
renders a full document, so later enhanced-navigation layers must preserve the same authored layout
declarations. Authoring examples live in `site/content/guides/layouts.md`.

Routes may declare **parallel layout regions** at the route boundary with `regions`, for sibling
chrome that a layout positions beside the main page without app-authored runtime stamps:

```tsx
const DocsLayout = layout({
  render: (_queries, _state, { regions }) => (
    <DocsShell page={regions.page} sidebar={regions.sidebar} />
  ),
});

route('/guides/:slug', {
  layout: DocsLayout,
  regions: {
    page: ({ params }) => <GuidePage slug={params.slug} />,
    sidebar: ({ params }) => <DocsSidebar activeSlug={params.slug} />,
  },
});
```

`regions.page` is the route leaf region when present; additional names are scoped to the declaring
route/layout contract. The request shell renders every region from the same route params, search,
guard-refined request, and JSX context as the page, then passes the rendered map to
`layout().render` as `slots.regions`. The compiler owns the stable segment ids and dependency
metadata for those regions. JSX marker components or app-authored `kovo-nav-*` attributes are not
part of this API.

Route pages that return JSX are **compiler-processed Kovo source**, not opaque runtime JSX. The
compiler lowers the route page into authorable server IR, records the component calls and
serializable props, runs the declared component queries for the initial document, and emits the
live-target registry used by enhanced mutation responses (§9.1). Dynamic route composition that
cannot be scanned receives a diagnostic rather than falling back to app-authored fragment routing.
Every navigation is a full document, so there is no persistent-layout state to manage;
cross-document View Transitions carry the visual continuity. A route-tree convention may arrive
later as sugar lowering to exactly these calls (Constitution #3).

**Payload posture:** projected children ship in the initial HTML — all tab panels, dialog bodies, accordion contents. There is no client-side lazy mount; `<kovo-defer>` (§8) is the escape hatch for expensive subtrees. This is the MPA posture by design. Component authoring examples live in `site/content/guides/components.md`.

Because projected children ship once and never receive a client mount, an `isomorphic: true` island (§4.8) that composes children or named slots must, on self-render, leave those projected regions in place and re-render only its own positions (§4.8); a render whose own positions cannot be separated from the projected regions is **KV316**.

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

**Rejected:** a polymorphic `as` prop — it composes only with intrinsic tags, and polymorphic typing is the heaviest TS pattern known (type-perf risk; see `docs/risk-register.md`) for the weakest payoff.

**Merge rules (normative).** Merging happens once, at render; conflicts resolve per attribute class:

| Attribute class                                                                                                                                                                                                              | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `class`                                                                                                                                                                                                                      | Concatenate (primitive first, author last), dedupe, stable order                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `style`                                                                                                                                                                                                                      | Concatenate; author declarations last (later wins per property)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `on:<event>`                                                                                                                                                                                                                 | **Chain**: space-separated refs, author's first, then primitive's; the loader invokes left-to-right, sequentially awaited; `defaultPrevented` does **not** stop the chain (platform semantics) — primitive handlers contractually no-op when `event.defaultPrevented` (linted in the primitive package, not the loader)                                                                                                                                                                                                                                                                                                                                             |
| `id`                                                                                                                                                                                                                         | Author wins; the primitive rewires its IDREF references to the surviving id (KV221 validates the result)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| IDREF attrs (`commandfor`, `popovertarget`, `for`, `aria-controls`, …)                                                                                                                                                       | Both set → **error KV231** (double-wired relationships are ambiguity, not composition)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Descriptive `aria-*` (`aria-label`, `aria-labelledby`, `aria-describedby`, `aria-roledescription`), `role`                                                                                                                   | Author wins, **lint KV232** (the escape hatch stays open; the override stays visible). These are not runtime-driven, so author authority cannot freeze a live value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| State `aria-*` the primitive updates at runtime (`aria-expanded`, `aria-selected`, `aria-checked`, `aria-pressed`, `aria-current`, `aria-disabled` when state-driven, and any `aria-*` the primitive lists as state-bearing) | **Primitive wins, lint KV232** — same hazard as `data-state`: the primitive's runtime derive owns the attribute, so a static author override would be clobbered on first state change. The primitive's runtime updater keeps writing this attribute after the merge regardless of the static winner; the author's static value is used only as the initial server-rendered value when the primitive is silent at render. Authoring a static state `aria-*` whose value contradicts the primitive's render-time state is **error KV317** (a frozen-vs-clobbered ambiguity the author cannot have meant), distinct from the visible-escape-hatch override lint KV232. |
| `data-state` & primitive-owned `data-*` state attrs                                                                                                                                                                          | Primitive wins, **lint KV232** (runtime-updated values; a static override would be clobbered on first state change)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `data-p-*` (handler params)                                                                                                                                                                                                  | Same param from both → **error KV231**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Binding attrs (`data-bind`, `data-bind:*`)                                                                                                                                                                                   | Same target slot → **error KV233**; distinct targets compose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `disabled`, `aria-disabled`, `required`, `readonly`                                                                                                                                                                          | Logical OR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Other scalars (`type`, `href`, `tabindex`, `value`, `view-transition-name`, …)                                                                                                                                               | Author wins; the primitive value is a default (used only when the author is silent)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `kovo-deps`                                                                                                                                                                                                                  | Union                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `kovo-c`, `kovo-state`                                                                                                                                                                                                       | Both present → **error KV231** (one element = one island)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

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

**1. Bindings — path writes.** `data-bind="cart.count"` sets text content; `data-bind:<attr>` sets attributes (`data-bind:value`, `data-bind:hidden`). **Contextual encoding is mandatory and by default.** Every interpolated value MUST be contextually encoded for the sink it lands in before it reaches the DOM, and the server renderer and the loader MUST use byte-identical encoding (the §5.2 #3 render-equivalence gate binds them — divergent encoding is **KV222** drift). A `data-bind` text write is a `textContent`/escaped-text write, never an HTML parse: it never opens an element or comment. A `data-bind:<attr>` write is an attribute-value write with attribute-value escaping; it never opens a new attribute or tag. No binding ever inserts attacker-influenced markup as raw HTML, and no plain binding reaches an unsafe sink — those sinks are enumerated under **KV236** below and require the trusted-HTML escape hatch. Grammar: dot paths plus optional segments (`deal.contact?.name`) — no expressions, no indexing (arrays are stamps' job). Paths type-check against the query's inferred shape (§6.2), and the check is **null-aware**: a path traversing a nullable or optional segment — the routine shape of leftJoin projections — must mark the traversal `?.`, or it is compile error **KV227**; rendering `undefined` is unrepresentable, not a runtime surprise. `?.` has defined empty semantics shared by the server renderer and the loader (the two must not disagree — the KV222 drift rule applied to nullability): a text binding renders the empty string; an attribute binding removes the attribute. Sugar lowers `{deal.contact?.name}` to exactly this form; item-relative stamp paths (`.contact?.name`) and `data-bind-list` paths follow the same rule. When empty-on-null is the wrong rendering, the KV227 fix menu is the usual ladder: extract a named derive that handles `null` explicitly, or make the projection non-null in the query itself (`coalesce`), keeping the binding total.

**Unsafe output contexts and the trusted-HTML escape hatch (KV236).** A _safe_ binding context is one whose contextual encoding (above) provably neutralizes attacker-influenced bytes: HTML text content and ordinary attribute values. The following are **unsafe output contexts**, and a plain `data-bind`/`data-bind:<attr>`/derive value flowing into one is a compile error **KV236**:

- raw-HTML insertion (any binding that would parse its value as markup rather than set escaped text);
- URL-scheme attributes — `href`, `src`, `action`, `formaction`, `xlink:href`, `ping`, `poster`, and CSS `url(...)` — whose value's scheme is not on the allowlist `http`, `https`, `mailto`, `tel`, `ftp`, relative/path-only, or a fragment; in particular `javascript:` and `data:` are denied;
- event-handler attributes (`on*`);
- the `style` attribute and `<style>` element text;
- `srcdoc`;
- `<script>` element text and `<script type="application/json">` island bodies (§9.1 governs the byte-level encoding for the latter).

Every `data-bind:<attr>` write into a URL-scheme attribute MUST scheme-allowlist its resolved value at both render and loader update time; a value resolving to a denied scheme is dropped to the attribute's empty semantics (the attribute is removed, per the `?.` rule above), never written verbatim. A binding into an unsafe context with no escape hatch is **KV236** with the usual teaching menu: change the projection, extract a derive that returns a safe value, or — for genuinely author-trusted markup/URLs — opt in via the trusted-HTML escape hatch.

The escape hatch is a typed, named, public Kovo API (`trustedHtml(value)` / `trustedUrl(value)`, importable only from a documented public entrypoint per §5.2 #8) that brands its argument as author-vouched. A binding may reach an unsafe context only when its lowered value is a `trustedHtml`/`trustedUrl` brand; the brand is the only thing that suppresses KV236, it is visible in source and in `kovo explain component`, and it is never derivable by the compiler (so the author always writes it explicitly — the inverse of the "TSX never requires a string the compiler can derive" rule, applied to trust). A trusted value carries no escaping obligation onto the framework; producing it from unvalidated query data is the documented hazard the brand makes auditable.

**Live-property bindings (`data-bind-prop:<prop>`) — the property-authoritative addendum.** A handful of attributes are _property-authoritative_: once the live DOM property is dirtied by user interaction (or script), the browser stops reflecting the attribute onto the property, so an attribute-only `data-bind:<attr>` write silently fails to update the observed state — `FormData` reads `input.checked`, not the `checked` attribute; `.indeterminate`/`.scrollTop`/`.scrollLeft` are not HTML attributes at all. For a **closed, security-reviewed allowlist** — `checked`, `indeterminate`, `value` (form controls), `scrollTop`, `scrollLeft`, `selected`, `open` — the compiler additionally emits a companion `data-bind-prop:<prop>` stamp alongside the SSR attribute and `data-bind:<attr>`, and the loader applies it by **assigning the live element property** (`el[prop] = coerce(prop, value)`: boolean for `checked`/`indeterminate`/`selected`/`open`, number for `scrollTop`/`scrollLeft`, string for `value`) on hydration and after every derive/morph re-render — the property write runs _after_ the attribute patch. The SSR attribute is unchanged, so first paint and no-JS stay correct and render-equivalence (§5.2 #3) treats `data-bind-prop:*` as a non-attribute output (byte-identical visible HTML; the property write is the extra output). This is not an author surface: a component still writes `checked={…}`/`scrollTop={…}` and the compiler derives both stamps from the one fact. **The allowlist is the security boundary** — `data-bind-prop:*` is never emitted or applied for any other property, and the unsafe sinks (`innerHTML`/`outerHTML`/`srcdoc`/`on*`) stay forbidden (KV236); the runtime ignores a non-allowlisted property defensively.

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

**The ceiling is explicit, and the escape hatch is defined.** Anything beyond paths, derives, and keyed lists flips to a server fragment — or to an **isomorphic island**: `isomorphic: true` on a component also emits its render function into the client module; on query/state change the island re-renders itself and self-morphs. It is the _same_ render function the server uses (partials cannot drift), and it is lint-gated (**KV318**: justification comment required) — this is the sanctioned SPA-creep escape, bounded by KV318 and the §4.9 update-coverage proof.

The "partials cannot drift" guarantee holds only when the client self-render binds the **same arguments** the server bound. Projected children and named slots are `Html`-typed arguments supplied at the server render site and ship once in the initial HTML (§4.5); a client self-render has no slot/children arguments. To keep the self-render sound for a children- or slot-accepting isomorphic island, the self-morph **must preserve the projected-children DOM regions in place and re-render only the island's own positions** — the loader marks each projected-children/slot region (`kovo-slot="children"`, `kovo-slot="<name>"`) at server render, scopes the self-render's morph to the island's own attributes/text/structure, and treats the marked regions as morph-stable holes whose subtrees the self-render does not touch. The island's render therefore reads its slot arguments as the existing region contents, not as fresh `Html`. A children- or slot-accepting component whose render cannot be partitioned this way — where the island's own positions interleave with projected content such that the slot regions are not contiguous, statically locatable holes — cannot be made isomorphic without drift and is compile error **KV316**, whose message shows the interleaving position and the fix menu (lift the dynamic part above or below the slot, make the children a stamped-prop-hoistable inferred fragment target per §4.5/KV230, or drop `isomorphic: true` and use a server fragment).

### 4.9 Update coverage (exhaustiveness)

§10.6 proves every invalidated query has an optimistic story; this is the same theorem one hop further down the dataflow: **every query- or island-local-state-dependent position in rendered output must have a declared update status**, or the page renders data it will never refresh — the silent-staleness bug §10.6 exists to kill, recurring on the client side of the wire. The framework rejected runtime dependency tracking (§3.1), and the thing removed was also the thing that guaranteed coverage in SPA frameworks; a static plan needs a static completeness proof.

During lowering, the compiler classifies every render-output position that reads query data or island-local state:

| Status       | Meaning                                                                                                                                                                                                                                                                                                                                 | Latency                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `plan`       | lowered to a binding, derive, or stamp (§4.8)                                                                                                                                                                                                                                                                                           | instant; participates in optimism |
| `isomorphic` | island self-renders on change (§4.8, KV318); a children/slot-accepting island self-morphs in place over preserved projected-children regions, and a non-partitionable render is **KV316** (§4.8)                                                                                                                                        | instant; costs the render module  |
| `fragment`   | inside an inferred server-refreshable query target — mutation success may re-render it after invalidation ∩ live targets (§9.1); **not a state remedy** — the morph carries no island-local `kovo-state` serialization (§9.1), so a nested island declaring local `state` inside the target is **KV420** (§4.5), not a covered position | 1 RTT — **no optimistic update**  |
| `renderOnce` | declared immutable for the document's lifetime (suppression recorded in source)                                                                                                                                                                                                                                                         | never                             |

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

Like KV310, the check runs at two altitudes off one derived set: in the compiler during lowering (editor-visible) and as `kovo check coverage` (CI/agents). Together with §10.6 and the touch graph, a mutation's full dataflow is exhaustiveness-checked edge by edge: write → invalidated queries (§11.1) → optimistic prediction (KV310) → every dependent DOM position (KV311) → fragment reconcile (§9.1). No edge from this client's own statically analyzable modeled writes may be silently uncovered; raw-SQL seams, DB-engine fan-outs, wall-clock freshness, and cross-session liveness must be declared through their checked escape hatches or treated as outside the v1 automatic freshness guarantee.

### 4.10 Registry-bounded dynamic rendering

Some content is authored by an LLM or stored in a database as **rich text that embeds components**
— well-formed XML tags drawn from a fixed vocabulary (`<kovo-chart title="Q3">…</kovo-chart>`).
The tree's _shape_ is unknown until runtime, but the _set_ of renderable components is fixed ahead of
time. This is the one place the static composition model of §4.5 does not reach — the call graph
cannot be scanned because it is data — so v1 provides a bounded runtime primitive rather than an
app-authored dynamic dispatch (which remains KV230/§4.5).

`renderTree(registry, nodes)` renders such a tree **server-side and once** (the §4.5 posture: no
client re-render of the dynamic shape). It is framework code, not lowered app TSX, so the static
ban does not apply; the bound is the registry:

- **The registry is the pre-approval boundary.** `renderRegistry({...})` is a closed map of tag →
  `{ component, props }`. A tag with no entry can never render a component, so the approved set is
  structural, not conventional. Registered components must be server-renderable; an `isomorphic`
  component (§4.8) defeats the lazy posture (it ships its render module) and is not a valid entry.
- **Parsing is the trust boundary.** The untrusted string is parsed into a plain-data AST and is
  **never reconstituted into HTML** — there is no markup sink for an injection to reach.
  `parseComponentXml` is pure and side-effect-free, so validation may run at write time and the AST
  stored, leaving render-time on already-trusted data.
- **Output is safe by construction (§4.8).** The walker HTML-escapes every text node itself (the
  bare JSX runtime inserts a child verbatim — escaping dynamic text is otherwise the compiler's job),
  passes only schema-declared props to a component (attributes outside the `s.object` schema are
  dropped, never spread through), and never produces `trustedHtml`/`trustedUrl`. Attribute and URL
  emission still pass through the §4.8 attribute-escape, URL-scheme allowlist, and `on*`/`srcdoc`
  refusal. The XSS review therefore reduces to one invariant: no registered component binds untrusted
  data into a `trustedHtml`/`trustedUrl` sink.
- **Attributes validate against the component's own schema (§6.3).** The same `s.object({...})` that
  types the component validates the LLM-supplied attributes — one source of truth. Invalid attributes
  are dropped (and defaulted where the schema declares a default); a tag whose required attributes
  cannot be satisfied, or an unknown tag, renders its children with the wrapper dropped rather than
  failing the whole document.

Lazy loading needs no new mechanism: because the tree renders to light-DOM HTML on the server, an
unregistered-or-unused component ships no client JS, and a rendered component's handlers still load
on first interaction through the §4.4 loader.

---

### 13.1 StyleX and Theme Tokens

Kovo component styles are authored as TSX/JSX source with `@kovojs/style`
objects. The compiler may extract static `style.create(...)`, `style.defineVars(...)`,
`style.createTheme(...)`, `style.keyframes(...)`, and compiler-known imported token
references into ordinary CSS assets, but it may not turn lowered style IR into a
second app-authoring surface (§5.2). Extracted rules are global atomic CSS with
stable provenance, not shadow-DOM scoped rules; components remain light DOM so
form participation, IDREFs, and accessibility relationships cross component
boundaries. Static keyframes resolve to deterministic animation names and are emitted once.

Theme tokens are document CSS custom properties. Components may reference typed public tokens from
`@kovojs/style`, but the runtime value is still resolved by the document. No core runtime theme
store, hydration graph, or shadow boundary is introduced for theme selection. Expanded StyleX,
stylesheet, and theme-token guidance lives in `site/content/guides/styling.md`.

### 13.2 `kovo-key` runtime-identity contract (normative)

`kovo-key` is the single lowered runtime identity for a keyed row (§4.8): the same string is written once and shared verbatim by stamps, morph, inferred fragment-target instance suffixes, submitted-form identity, and optimistic reordering. This subsection pins the order-of-operations every consumer MUST follow so identity stays stable across reconciliation, delta merge, and optimism.

1. **Identity, not position.** A row's identity is its `kovo-key` value, never its array index or DOM order. A key value is stable for the lifetime of the row it names and unique within its `data-bind-list` (uniqueness is a render-site invariant, asserted in dev). The authored TSX identity is `key={...}`; the compiler lowers it to `kovo-key` (§4.8). The `kovo-key` field MUST be one of the projected query-shape fields that feed the version token (§5.2.1).
2. **Keyed reconciliation order-of-operations.** On any array change the loader reconciles existing `[kovo-key]` children against the new keyed set in a fixed order: (a) **match** existing children to new rows by key; (b) **remove** children whose key is absent from the new set (or named in a delta removed-key list, §9.1.1); (c) **insert** rows whose key is new by cloning the row template; (d) **reorder** matched children to the new key order, moving existing nodes rather than recreating them; (e) **bind** item-relative paths (`.qty`, …) on every surviving and inserted child. Steps run in this order so a moved row preserves its node identity (and its UA state — focus, selection, in-flight transition) instead of being destroyed and recreated.
3. **Morph identity.** A `<kovo-fragment>`/delta morph matches incoming keyed rows to live DOM by `kovo-key`, applying the same match/remove/insert/reorder/bind order as (2). The morph MUST NOT key by position; a row whose key is unchanged is morphed in place (same node, same island signal) even if its order moved.
4. **Submitted-form identity.** A keyed mutation form lowers its row key to `kovo-key` on the form element (§6.3), and the post-commit fragment target and any failure re-render (§9.2) resolve back to that same key — so the response patches the originating row, not a positional neighbor, even if the list reordered between submit and response.
5. **Optimistic reordering.** An optimistic transform (§10.4) that inserts, removes, or moves a keyed row predicts the new key order; the predicted rows reconcile by key under (2), so the optimistic prediction and the arriving server truth (§10.3) align on identity and a moved row is not double-rendered. Rebase (§10.4) re-applies pending transforms over the keyed identity, never over array indices, so a reorder that lands between prediction and truth does not misattribute a later transform to the wrong row.

The two prod-delta soundness claims that cite this contract — keyed-collection merge-by-identity and removed-key deletion (§9.1.1) — hold because every consumer above keys off this one stable identity.

---
