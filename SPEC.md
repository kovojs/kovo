# Kovo — Technical Specification

**Version:** 0.2 (Draft)
**Status:** Normative specification for v1, with staged roadmap through v3
**Audience:** Framework implementers and AI app-builder integrators

---

## 1. Vision

Kovo is a web-platform-native framework for building multi-page applications that **never show stale or inconsistent UI** and are **interactive at first paint with minimal JS and CSS** — achieved by making the whole system legible at every layer and statically verifiable end-to-end.

It composes ideas from prior systems (Qwik, htmx/LiveView, RTK Query, Replicache; full prior-art table in the README) around one organizing constraint: _every artifact the system produces (compiled output, HTML, wire traffic, dependency graphs) must be readable by a human in devtools and checkable by a machine without executing a browser._

### 1.1 Primary goals

Kovo exists to deliver three outcomes, in priority order, all produced by one technique — machine-auditable generation (§1.3). Every other property of the framework — legibility, static verifiability, the auditable wire — is a _means_ to these ends.

1. **Secure by construction.** Whole vulnerability classes — cross-site scripting, SQL injection, broken access control and IDOR, confidential-data exposure, mass assignment, SSRF, request forgery, lost-update races — are not runtime hazards to test for but build/check errors that never ship, or fail-closed runtime floors where static proof is impossible. Kovo makes the insecure pattern _inexpressible_ wherever the same static analysis that proves data freshness can prove it, and forces the residue into declared, audited, suppressible-in-source decisions visible to `kovo explain`. The distinctive claim is not "secure" — every framework says that — but **secure by the same machine-auditable construction that eliminates stale UI**: one substrate, checked without a browser.
2. **Eliminate stale-UI bugs at compile time.** Inconsistent UI states — a badge that disagrees with the cart, a list that didn't reflect its own mutation, two views of one fact drifting apart — are not runtime races to debug but build/check errors that never ship. Kovo makes the staleness it can statically model (§1.2) a `tsc`/check failure, and forces the residue it cannot prove into declared, suppressible-in-source decisions.
3. **Make loading instant.** First paint is interactive, and the bytes to get there are minimal: little-to-no JavaScript on the critical path (global delegation + `import()` on first interaction, not hydration), compiler-scoped CSS with no runtime style engine, and named incremental wire deltas in prod. Performance is a budget the compiler enforces, not a guideline.

### 1.2 Thesis statement

> An application's complete behavior — every handler wiring, navigation target, form field, mutation contract, data dependency, and optimistic prediction — should be provable by TypeScript static checking plus static graph queries, and auditable by reading the page source and the Network panel.

For v1 data freshness, that proof covers staleness caused by this client's own
statically analyzable, modeled writes. Kovo turns those stale-UI paths into build
or check errors, and turns freshness gaps it cannot statically prove — raw-SQL
seams, database-engine side effects, the wall clock — into declared, checked,
suppressible-in-source decisions. Cross-session liveness is an explicit
out-of-guarantee boundary for v1 and belongs to the opt-in live tier (§9.3), not
to the core mutation proof.

### 1.3 Design driver: machine-auditable generation

Kovo is built to be the most machine-auditable compilation target a code-generation agent can emit: generated apps fail TypeScript static checking if wiring is wrong, and intent is verifiable against printed dependency graphs without headless browsers. Where a design choice trades author convenience for machine-checkability, machine-checkability wins. The corollary holds for every reader, not just agents: debugging always proceeds _down_ into plainer code, never _up_ into compiler internals. Machine-auditable generation is the chief _technique_ by which the three primary goals (§1.1) are reached: the same static analysis that lets an agent's output be checked without a browser is what makes whole vulnerability classes inexpressible (the Prime Principle, §2), turns stale-UI paths into build errors, and lets the compiler hold the byte budget.

### 1.4 Explicit non-goals

- **Figma-class shared-workspace apps.** Long-lived client sessions over one mutable heap (collaborative canvases, video editors, DAWs) are outside the sweet spot. Kovo islands can host rich widgets, but the framework will not grow a client router or global client store to serve this segment.
- **Offline-first.** Server truth is unconditionally authoritative; Kovo does not ship a sync engine.
- **App-authored persistent navigation state** in v1. Enhanced navigation may preserve unchanged compiler-stamped layout DOM when JS is present (§8), but the canonical behavior is still real URLs and server-rendered documents.
- **Browser support parity for enhancements.** Speculation Rules and invoker commands are Chromium-led; Kovo degrades gracefully (real navigations, real forms) but does not polyfill them.
- **A sanctioned JSON/REST public API in v1.** Typed public APIs need their own token-auth and schema-reuse story. Until that exists, ad-hoc JSON APIs live only behind declared `endpoint()` entries (§9.1), where their auth and CSRF posture stay visible to audits; `respond.json()` is not a route outcome.

---

## 2. The Constitution (Design Tests)

The framework's overriding commitment is the **Prime Principle**, which precedes and is served by every test below:

> **Security is by construction.** A feature crossing a trust boundary — data coming _in_, data going _out_, _who_ may act, _how much_ — makes the unsafe state inexpressible at compile time wherever static analysis can prove it (over AST symbol-identity provenance, never a branded type or runtime taint, both unsound here; §6.6), falls back to a fail-closed runtime floor where it cannot, and routes every exception through an audited escape hatch surfaced in `kovo explain`. **Default-deny over default-allow; brands are defense-in-depth, not the mechanism; runtime floors are labeled as floors, never sold as proofs.** This turns XSS, SQL injection, IDOR/broken access control, confidential-data exposure, mass assignment, SSRF, and lost-update races into build errors or fail-closed floors — checkable without a browser, by the same machine-auditable generation (§1.3) that eliminates stale UI. It is the first primary goal (§1.1) and the lead gate here precisely because it is the highest-stakes property _and_ is delivered by the legibility, declare-once, and static-auditability the tests below enforce.

Every feature proposal is then evaluated against five design tests. A feature failing the Prime Principle or any test is redesigned or rejected. These are normative. The objectives are the three primary goals (§1.1); the tests are how those goals — security included — are kept honest under pressure.

| #   | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Consequence                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Legibility is load-bearing.** Names appear in HTML attributes and wire traffic, so they structurally cannot be mangled.                                                                                                                                                                                                                                                                                                                                                                                                                               | Minifiers cannot rename handler exports; debugging never requires decompiling the framework.                                                                                                                                                                                       |
| 2   | **No global knowledge at local sites.** Any API requiring the author to enumerate distant call sites from memory is a bug factory and is rejected.                                                                                                                                                                                                                                                                                                                                                                                                      | Killed manual fragment targets, manual per-island optimism, query-side mutation registration, call-site mass-assignment allowlists, and per-handler authorization — security facts (`secret`/`owner`/`governed`/`access`) are declared once and derived everywhere.                |
| 3   | **Sugar must lower to authorable IR.** Every compiler feature emits valid Kovo source. Compiling the output is a no-op (CI-enforced fixpoint).                                                                                                                                                                                                                                                                                                                                                                                                          | Output is auditable in devtools and mechanically checked; app authors still write TSX.                                                                                                                                                                                             |
| 4   | **The wire is the documentation.** Named POSTs and schema-shaped JSON in every environment; full self-describing HTML fragments in dev; size-optimized but still named/schema-shaped deltas against a version-validated base in prod (§9.1.1). The wire documents what the server **chose to send**, not all it knows: a `secret`-classified field is ineligible to reach the client wire or a client module, so legibility and confidentiality coexist by construction — the dual of output-safety (§5.2 rule 10, integrity), now for confidentiality. | A dev frame is a complete document auditable from the Network panel; a prod frame shows _what changed_, reconstructable via `kovo explain`. Names are never mangled in either mode (#1). A typed `secret` boundary keeps the readable wire from becoming an over-exposure channel. |
| 5   | **Server truth always wins.** No client cache to invalidate; reconciliation is "morph the authority in."                                                                                                                                                                                                                                                                                                                                                                                                                                                | Optimistic predictions are disposable; there is no consistency protocol.                                                                                                                                                                                                           |

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

**The ceiling is explicit, and the escape hatch is defined.** Anything beyond paths, derives, and keyed lists flips to a server fragment — or to an **isomorphic island**: `isomorphic: true` on a component also emits its render function into the client module; on query/state change the island re-renders itself and self-morphs. It is the _same_ render function the server uses (partials cannot drift), and it is lint-gated (**KV302**: justification comment required) — this is the sanctioned SPA-creep escape, bounded by KV302 and the §4.9 update-coverage proof.

The "partials cannot drift" guarantee holds only when the client self-render binds the **same arguments** the server bound. Projected children and named slots are `Html`-typed arguments supplied at the server render site and ship once in the initial HTML (§4.5); a client self-render has no slot/children arguments. To keep the self-render sound for a children- or slot-accepting isomorphic island, the self-morph **must preserve the projected-children DOM regions in place and re-render only the island's own positions** — the loader marks each projected-children/slot region (`kovo-slot="children"`, `kovo-slot="<name>"`) at server render, scopes the self-render's morph to the island's own attributes/text/structure, and treats the marked regions as morph-stable holes whose subtrees the self-render does not touch. The island's render therefore reads its slot arguments as the existing region contents, not as fresh `Html`. A children- or slot-accepting component whose render cannot be partitioned this way — where the island's own positions interleave with projected content such that the slot regions are not contiguous, statically locatable holes — cannot be made isomorphic without drift and is compile error **KV316**, whose message shows the interleaving position and the fix menu (lift the dynamic part above or below the slot, make the children a stamped-prop-hoistable inferred fragment target per §4.5/KV230, or drop `isomorphic: true` and use a server fragment).

### 4.9 Update coverage (exhaustiveness)

§10.6 proves every invalidated query has an optimistic story; this is the same theorem one hop further down the dataflow: **every query- or island-local-state-dependent position in rendered output must have a declared update status**, or the page renders data it will never refresh — the silent-staleness bug §10.6 exists to kill, recurring on the client side of the wire. The framework rejected runtime dependency tracking (§3.1), and the thing removed was also the thing that guaranteed coverage in SPA frameworks; a static plan needs a static completeness proof.

During lowering, the compiler classifies every render-output position that reads query data or island-local state:

| Status       | Meaning                                                                                                                                                                                                                                                                                                                                 | Latency                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `plan`       | lowered to a binding, derive, or stamp (§4.8)                                                                                                                                                                                                                                                                                           | instant; participates in optimism |
| `isomorphic` | island self-renders on change (§4.8, KV302); a children/slot-accepting island self-morphs in place over preserved projected-children regions, and a non-partitionable render is **KV316** (§4.8)                                                                                                                                        | instant; costs the render module  |
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

\* Minification may never rename exported handler symbols or anything appearing in HTML attributes (Constitution #1 — enforced because those names are load-bearing at runtime); this holds in prod too, where payloads are delta-encoded (§9.1.1) but names stay verbatim. The prod build additionally stamps a **render-plan version token** (defined in §5.2.1) into emitted module URLs (alongside the cache-busting hash) and into every delta/patch response, so §9.1.1 base-version validation can fail loud on deploy skew instead of patching stale DOM silently.

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
10. **Output safety is contextual and default-on.** The server renderer and the client update plan MUST contextually encode every interpolated query/state value for its sink — escaped text for text content, attribute-value escaping for attributes, the §9.1 script-data encoding for JSON islands — and MUST encode identically (bound by render-equivalence, rule #3). Plain bindings may reach only safe contexts; the unsafe output contexts and the URL-scheme allowlist are defined in §4.8 and gated by **KV236**. The only suppression is the typed trusted-HTML escape hatch (§4.8); there is no raw-string ejection. A sink renderer or any other app-authored presentation layer that consumes streamed/model output is bound by the same obligation (§9.1).

#### 5.2.1 Render-plan version token (normative)

The **render-plan version token** is a single opaque build-stable string that identifies the exact server/client render contract a payload was produced against. It is the currency §9.1.1 base-version validation compares.

1. **Inputs (mandatory).** The token MUST be a collision-resistant hash whose preimage includes, at minimum: (a) the **projected shape of every query** — the field set, nesting, nullability, and element type of each query value, including each `kovo-key` field per keyed collection (§4.8); and (b) the **update-plan grammar version** — the binding/derive/stamp lowering vocabulary and the delta deep-merge semantics (§9.1.1) the client runtime applies. A change to any projected query shape, to any keyed-collection identity field, or to the update-plan grammar MUST change the token. The token MUST NOT be derived from client-module content hashes alone: a query-shape change that leaves a module's bytes unchanged MUST still move the token.
2. **Stamping points (mandatory).** The prod build stamps the token into (a) emitted client-module URLs (alongside the cache-busting hash, §5.1), (b) every full page render (as document meta, §9.5), (c) every `<kovo-query>`/`<kovo-fragment>` delta or full response (§9.1.1), and (d) every `/_q/<key>` read response (§9.4) so a plain refetch into a stale tab is detected, not only mutation-driven deltas.
3. **Comparison (mandatory, server and client).** The client applies a delta only when the response token equals the token the held base was produced against (§9.1.1); on mismatch it discards and refetches full (§9.4). A `/_q/` response whose token differs from the receiving document's token MUST be treated as a build-skew event: the client discards the in-place merge and performs the §14 recovery. A skew-aware server that receives a stale token on a mutation or read request MAY emit full directly (§9.1.1). The token is opaque to app code; only equality is defined.

#### 5.2.2 Prod render-equivalence gate (normative)

The prod build is sound only if delta encoding reconstructs the dev full render. The gate, over the differential corpus (§5.2 rule 3): for every query and every change record, `apply_delta(base, render_prod(Δ)) ≡ render_dev(full)`, where `apply_delta` is the §9.1.1 deep-merge plus update plan and `base` is the prior full value. The gate MUST also assert token monotonicity: any corpus edit that changes a projected query shape or the update-plan grammar changes the §5.2.1 token. A prod build whose delta path fails this equivalence, or whose token fails to move on a shape change, fails the build (**KV416**).

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

| Surface               | Source of truth                                        | What TypeScript proves                                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handler refs          | client module exports                                  | `cart.remove` exists; params required & typed; typo = error                                                                                                                                                                                                                  |
| Form fields           | mutation input schema                                  | names ∈ schema; types match; **completeness** (missing required field = error); coercion declared once (KV242)                                                                                                                                                               |
| Fragment targets      | component registry                                     | target exists; patched with the right component's props                                                                                                                                                                                                                      |
| Query data / bindings | Drizzle select shape (`$infer`) + `JsonValue` boundary | `data-bind` paths exist; column rename propagates to every template; nullable traversal requires `?.` or a derive (KV227, §4.8); query values are serializable client wire payloads, so `Date`, `Map`, functions, class instances, and other non-JSON values are type errors |
| Invalidations         | domain layer / touch graph                             | invalidated keys exist; optimistic exhaustiveness in `tsc` via emitted invalidation sets (§10.6)                                                                                                                                                                             |
| Errors                | declared error codes                                   | `onError` receives exhaustive discriminated union                                                                                                                                                                                                                            |
| Guards                | guard combinators                                      | `req.session.user` non-null under `authed`; guards receive the validated args/instance key (§10.3) so ownership is expressible; static audit of unguarded mutations, routes, and queries, and IDOR audit (KV414) over `owner:` tables                                        |
| State                 | `JsonValue` constraint                                 | serializability by construction                                                                                                                                                                                                                                              |
| Routes / links        | `route()` declarations (§6.4)                          | `href`/`<Link>`/`redirect()` target exists; path params required & typed; search params typed; route rename propagates to every link                                                                                                                                         |
| GET forms / URL state | route `search` schema                                  | field names ∈ search schema; coercion declared once; the §7 URL channel is typed                                                                                                                                                                                             |
| IDREFs (L0 wiring)    | compiler id registry                                   | `commandfor`/`popovertarget`/`for`/`aria-*` reference an id that exists in scope (KV221)                                                                                                                                                                                     |
| Sessions              | declared session schema (§6.5)                         | `req.session` fully typed; instance keys (§10.2) and guard refinements rest on typed fields                                                                                                                                                                                  |
| Derives               | declared inputs (§4.8)                                 | derive inputs exist in `QueryRegistry`; input types match query shapes; bound attribute targets type-checked                                                                                                                                                                 |
| Stamp lists           | query result element type                              | `data-bind-list` paths are arrays; item-relative paths exist on the element type; `kovo-key` names a real field (§4.8)                                                                                                                                                       |
| Slots / children      | hoisted component refs (§4.5)                          | fragment-target children lower to component references with serializable props (KV230)                                                                                                                                                                                       |
| Query args            | query `args` schema (§10.2)                            | components bind args from their own props; coercion declared once; instance keys typed end-to-end (store, wire, optimism)                                                                                                                                                    |
| Update coverage       | render-output classification (§4.9)                    | every query/state-dependent DOM position has a status — `plan` / `isomorphic` / `fragment` / `renderOnce`; none is KV311                                                                                                                                                     |
| Opaque projections    | declared output schema (§10.2)                         | `sql<T>`/raw projections carry `s.*` output schemas + a `reads:` table set (KV410); `reads:` checked against exemption, folded into the read set; result shape runtime-verified (§11.2)                                                                                      |
| SQL statement safety  | managed DB-handle contract (§10.2/§10.3)               | executable SQL text reaches framework-managed DB handles only as typed builders, parameterized SQL values, or audited `trustedSql(...)`; scalar request data binds as parameters, while identifiers/keywords come from schema facts or typed allowlists (KV422)              |
| Output safety         | binding sink + value brand (§4.8)                      | every binding/derive into an unsafe output context (raw HTML, URL-scheme attr, `on*`, `style`, `srcdoc`, script/JSON) is `trustedHtml`/`trustedUrl`-branded or it is KV236                                                                                                   |

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
  access: guardAccess([{ guard: authed, name: 'authed' }]), // explicit audit decision (§10.2, KV436)
  params: s.object({ id: s.string() }), // coercion declared once, like FormData (§6.3)
  guard: authed, // executable combinator chain (§10.3)
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

Two more route-level affordances close the request shell: **guards** — `guard:` on a `route()` runs the same combinator chain as mutations (§10.3) before `page`, refines `req.session` identically, and enrolls the page in the `kovo explain --unguarded` audit; and **`notFound()`** — returning `notFound()` from `page` renders the app's 404 page with the correct status, so status codes stay part of the typed surface rather than ad-hoc response construction. Every route still carries an explicit `access:` decision for the default-deny completeness audit (KV436); `access` records reviewed intent, while `guard` is the executable enforcement hook. `redirect()` and `notFound()` are the sanctioned non-200 page outcomes in v1.

Routes may also return two sanctioned non-HTML 200/304 outcomes: `respond.file(body, { contentType, filename?, etag?, headers? })` and `respond.stream(body, { contentType, filename?, etag?, disposition?, headers? })`. These are still ordinary `route()`s: params/search schemas, guards, typed links, KV220 validation, the unguarded audit, and the `owner:`-powered `--unscoped` audit all apply before the body is served. `Content-Type` is required, `Content-Disposition` is declared (`respond.file()` defaults to attachment; `respond.stream()` defaults to attachment unless `inline` is requested), and a matching `If-None-Match` answers 304 without rendering HTML. Range/resumable downloads are out of scope for v1; large exports that exceed a request/response window belong to a later background-jobs design.

`respond.stream()` and raw `endpoint()` responses are the escape hatch for app-owned streaming protocols. They do not participate in enhanced mutation application, query truth, mutation failure rendering, CSRF/replay semantics, or final fragment reconciliation unless the app builds that protocol itself.

### 6.5 Session schema

Sessions are a declared `s.object` schema, not an `any` bag: `req.session` is fully typed everywhere it appears. This is core, not a nicety — query instance keys (§10.2) and guard refinements (`req.session.user` non-null under `authed`, §6.2) are load-bearing on session fields, so an untyped session would be a hole directly under the proof surface.

Session provenance is an application capability, not a framework-owned identity system. The app declares a `sessionProvider` in the server request shell; Kovo runs it once before route, query, or mutation guards and exposes the returned value as `req.session`. The provider return type must be assignable to the declared session schema under TypeScript static checking, while browser input still crosses the normal runtime validators. A provider returning `null` or `undefined` means "anonymous"; guard combinators must treat that as unauthenticated rather than as a malformed request.

Route and query guard failures have fixed outcomes so auth remains part of the typed surface. `authed` failures run the app's `onUnauthenticated` handler, whose default is a 303 redirect to the configured login route with the original URL available as `next`. `next` is framework-validated: it MUST be a same-origin, single-leading-slash absolute path (no `//`, no scheme, no host) that resolves against the route table (§6.4); a value failing that check is stripped to a safe default. The framework re-validates `next` both where it is captured and again wherever it hands `next` to the post-login redirect, so app-authored login code cannot consume an open-redirect target. Authenticated-but-unauthorized failures render the app's 403 shell with status 403. Mutation guard failures distinguish **authentication** failure from **authorization/validation** failure. An _unauthenticated_ mutation guard failure (an `authed` guard failing because `req.session` is null/anonymous, §6.5 — e.g. a session that expired between page render and submit) is a distinct outcome from a validation or app-`fail()` error (§9.2): the enhanced path returns **HTTP 401** with a `Kovo-Reauth` directive carrying the login route and a same-origin `next` (the original document URL), which the loader follows to re-authenticate exactly as a page route would for the same expired session; the no-JS path returns a **303** redirect to the configured login route with `next`, mirroring the route/query `onUnauthenticated` contract. An _authenticated-but-unauthorized_ mutation guard failure (a `role()`/ownership refinement failing on a valid session) keeps the §9.2 typed-error path — **HTTP 403** with `forms.<mutation>.failure` carrying an `unauthorized` code — and introduces no redirect body. Only the unauthenticated case crosses into the auth-redirect vocabulary; this prevents a routine session-expiry on submit from surfacing as a generic validation-style error with no path to re-auth.

### 6.6 Soundness boundary (normative)

The §1.2 proof claims are claims about TypeScript programs that stay inside the sound subset. The starter therefore ships — and the docs state as a precondition — `strict` everything plus lint bans on `any`, non-null assertions, and `as` casts in app code. Three boundaries are runtime-validated regardless, by design: the **wire** (every mutation input passes its `s.*` schema — types-without-validators, raw-tRPC style, was rejected); **deploy skew** (a long-lived document POSTing yesterday's form shape is answered by schema validation and the 422 path, §9.2 — never undefined behavior); and **CSRF** — `kovo-csrf` (§9.1) is a synchronizer token stamped into every emitted form and verified before schema parsing, replay lookup, and the guard chain on every mutation POST. When `req.session` is present the token is bound to it; when it is null/anonymous (§6.5) the token is bound instead to a **framework-owned signed-cookie secret** that exists independent of `sessionProvider`, so pre-auth forms (login, signup, password reset) are CSRF-protected even with no session to bind to — anonymous-CSRF is mandatory, not optional. On a successful authenticating submit the framework rotates the anonymous token's binding to the new principal; apps should rotate their own session identity on auth (Kovo does not own session identity, §6.5). CSRF is default-on for server-rendered mutation endpoints; an explicit `csrf: false` is the only per-mutation opt-out and is reserved for non-browser or externally authenticated endpoints. A `csrf: false` mutation MUST NOT reference ambient browser authority: it is a compile error **KV418** for a `csrf: false` mutation to read `req.session` or run a session/cookie-derived guard (e.g. `authed`, `role()`, `owns()`), because such a mutation would skip CSRF yet still ride the victim's ambient cookie — exactly the unsound exemption §9.1 forbids for endpoints. The exemption is sound only by construction: a `csrf: false` mutation is served with no ambient `req.session` (cookies are not interpreted), mirroring the §9.1 endpoint guarantee. Truly non-browser writes belong in `endpoint()`/`webhook()`. Every mutation's CSRF posture (`checked` or `exempt:<justification>`) is listed in `kovo explain --endpoints` (§11.4) alongside endpoints and webhooks. The `Kovo-Idem` replay token (§9.1) is a per-submit, high-entropy value minted fresh by the client on each logical submit and refreshed in the enhanced success response (§10.3) — a freshly stamped hidden field, never a form-instance constant — so re-editing and re-submitting a form is a new mutation rather than a silent replay of the first response. Deploy skew also covers handler modules, normatively: emitted module URLs are immutable and versioned, and the serving layer retains prior versions — an old document's `on:*` refs keep resolving after a deploy; first interaction on a still-open tab never 404s. Generated ABI subpaths (for example `@kovojs/browser/generated`) may change when the compiler and runtime ship together because app source regenerates those imports, but already-emitted immutable modules remain governed by the same versioned-module retention rule: old generated modules must keep resolving to the runtime symbols they were emitted against for the supported deploy-skew window.

**Security soundness (normative).** The Prime Principle (§2) rests on the same sound-subset discipline, bounded by three rules. (1) **The compiler performs no TypeScript type inference of its own** — security classification is carried by AST symbol-identity provenance, sink classification, and fail-closed runtime checks; a branded type (`Secret<T>`, a `public()` brand, and the like) is `tsc`-time ergonomics and defense-in-depth, never the enforcement. (2) **Runtime taint is unsound** — JS string operations and template literals produce fresh primitives with no surviving metadata, so request-derived provenance for confidentiality, write-eligibility, and input shape is proven _statically_ at the AST (where the path is still code), never by runtime value-tracking; runtime contributes only _sink validation_ (checking a final value's grammar, shape, or resolved IP, which survives transforms). (3) **By-construction and defense-in-depth are distinguished and labeled.** Where static analysis can prove the unsafe state inexpressible, the guarantee is by-construction (output-safety §5.2 rule 10, the confidentiality boundary, default-deny authorization, write-provenance). Where it cannot — outbound egress, a read-only-handle runtime proxy, Content-Security-Policy / Trusted Types, log redaction — the control is a fail-closed runtime floor: sound at its sink but bypassable by privileged same-process code, and it MUST be documented as defense-in-depth rather than a proof.

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
- **bfcache and loader budget stay load-bearing.** Enhanced navigation must not add `unload` handlers or global session heaps that block bfcache. Its code counts against the inline loader's 8.25KB gzip budget. The budget was raised from 8KB on 2026-06-23 to keep reactive attribute writes behind the same XSS sink policy as the rest of the framework; future budget increases require comparable evidence.
- **Speculation Rules** are opt-in config, never auto-emitted: `prefetch: 'conservative' | 'moderate' | false` per route, declared on the `route()` object (§6.4), **default off**. Auto-prerender has real hazards — analytics firing inside prerendered pages, non-idempotent per-user renders, discarded-render server cost — so apps opt in route-by-route where renders are idempotent and cheap. `prefetch: 'moderate'` (which prerenders the route's `page`/`meta`/queries with the user's credentials on hover) is gated at compile time: it is **KV419** (`error`) to set `moderate` on a route that is guarded, session-dependent, or whose `page`/`meta`/queries are not proven side-effect-free, unless a named justification is supplied at the route (mirroring KV229 export gating and KV320). `conservative` (no eager render) is unaffected. The feature is one `<script type="speculationrules">` tag; the MPA is fast without it.
- **Cross-document View Transitions** opt-in per element pair via `view-transition-name` props; the compiler stamps matching names across route templates.
- **bfcache hygiene** is a framework guarantee: no `unload` handlers, `keepalive: true` on in-flight mutations at navigation, pending optimistic logs discarded on document teardown (stale-optimism-outliving-its-mutation is structurally impossible).

**bfcache hygiene is conditional on cache posture.** A bfcache restore is a history traversal that bypasses the loader and the network, so neither the route guard nor `sessionProvider` (§6.5) re-runs — a persisted authenticated document would otherwise reappear after logout, expiry, or revocation. Posture is computed from the same proof the export path uses (§9.5/KV229): a document is **session-dependent** when its route carries a guard or its render reads session-dependent query data, and **anonymous** otherwise. Guarded/session-dependent route documents MUST be emitted with `Cache-Control: no-store` so disk persistence and shared-cache reuse are forbidden. Independently — because some user agents still keep a `no-store` page in the in-memory bfcache — the loader MUST register a `pageshow` handler that, when `event.persisted` is true and the document was rendered under a guard or session dependence, revalidates by reloading from the server (a full GET, which re-runs `sessionProvider` and the guard) rather than presenting the restored DOM. Anonymous/exportable documents carry no such posture and remain fully bfcache-eligible; the `pageshow` handler is a no-op for them. The `pageshow` revalidation handler does not itself add an `unload` handler and counts against the §8 loader budget.

- **Out-of-order streaming:** App TSX uses the public `<Defer>` primitive from `@kovojs/server` to declare a server-rendered region whose fallback is ordinary JSX/text and whose real content streams later in the same response. The framework emits the owned `<kovo-defer>` placeholder, then streams the real fragment and morphs it in — the fragment protocol reused within first render. Deferred query JSON is guaranteed to arrive before or with its consumers. The internal `defer()` string helper is not an app-facing JSX child API; app-authored `{defer(...)}` is lint **KV244**.
- **Mutation response streaming:** chat-style post-submit streams are not SSE and do not reuse `<kovo-defer>`. They are one enhanced mutation POST response whose chunks use the §9.1 mutation vocabulary plus the narrow `<kovo-text>` text-source primitive below.
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
- `<kovo-query>` replaces the client's query value and runs that query's update plan — bindings, named derives, stamps — across every dependent island. No runtime dependency tracking: the plan is the DOM itself (§4.8). Query JSON serialized inline MUST be encoded for the exact context it lands in so attacker-controlled JSON string content cannot end the host element early. A `<script type="application/json" kovo-query="…">` initial-page island is HTML **script-data** (entities are not decoded), so its JSON MUST escape `<` as the JSON unicode escape `\u003c` — `&lt;` would not decode there and would corrupt the value. A post-mutation `<kovo-query>{…}</kovo-query>` element has **parsed** content, so its JSON MUST HTML-escape (`<`→`&lt;`, `>`→`&gt;`, `&`→`&amp;`). Both neutralize the `</script`/`<!--`/`<script` break-out; JSON quoting alone escapes neither and is insufficient. This is a normative renderer rule with a conformance test (`tests/integration/specs/xss-escaping.spec.ts`), and it binds every transport that re-emits an island — including the §9.3 BroadcastChannel rebroadcast, which forwards already-encoded bytes and never re-serializes raw values.
- `<kovo-fragment>` is **DOM-morphed** by default (idiomorph-class algorithm): user-agent and DOM-resident state — focus, scroll position, selection, in-flight CSS transitions, and `<details>`/media element UA state — survives. The morph carries **no serialization of island-local `kovo-state`**, so a refreshed parent re-emits any nested island at its render-time default state (§4.5 rule 3 re-renders the full subtree from declared queries ∪ stamped props); island-private local state is therefore **not** preserved across a fragment morph of an enclosing target. The compiler forbids the position that would silently lose it: an island declaring local `state` may not render inside another component's server-refreshable fragment target (**KV420**, §4.5). `mode="append"` is the explicit append vocabulary for pagination and streams. Patched-in islands are inert-until-touched like everything else — _a fragment update is a tiny navigation, not a different programming model._
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

Raw HTTP integrations use declared `endpoint()` entries, not ad-hoc server escape hatches. An endpoint is registry-visible, receives `Request -> Response`, requires an explicit HTTP `method` (there is no implicit any-method endpoint), requires an endpoint-level `reason`/`purpose`, and is enrolled in the endpoint and unguarded audits with the same auth metadata as routes, queries, and mutations. Prefix mounts require a `mountJustification` because they enlarge the routed surface beyond one path. Endpoint declarations also carry raw response posture metadata for the audit row: body class (`html`, `json`, `text`, `bytes`, `stream`, or `redirect`), cache posture, and whether app code owns body encoding plus response-header safety. An endpoint may opt out of CSRF with a named justification. Endpoint handlers receive the raw `Request` before body parsing so signature verification can use wire bytes; exact and prefix mounts are declared; cookies are not interpreted and no ambient `req.session` is passed. A CSRF exemption is sound only because endpoint/webhook auth does not ride ambient browser authority. OAuth/SAML callbacks and adapter-owned mounts belong here; browser credential forms should still prefer typed `mutation()` flows so they keep schema validation, no-JS behavior, and the normal response vocabulary.

An endpoint `auth` declaration MAY carry an executable verifier from the webhook verifier kit. When present, the dispatcher MUST verify cloned raw wire bytes `{ headers, payload }` before CSRF validation and before the handler runs; verifier `false`, malformed input, or thrown verifier errors fail closed with `401 Unauthorized`, and the original request body remains readable by the handler after a successful check. Name-only endpoint auth declarations remain audit metadata. `webhook()` continues to emit name-only endpoint auth because it self-enforces raw-byte verification in its own lifecycle before parsing.

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

Every `/_q/` response MUST carry the build's render-plan version token (§5.2.1) so a refetch into a stale tab is detected like a delta is: a client whose document token differs from the response token discards the in-place merge and performs §14 recovery rather than merging a foreign-shape value. Args arrive as search params through the query's `args` schema (§10.2) — the same `s.*` coercion machinery as forms. The query's `guard` (§10.2) is checked on **every** read, and reads are part of the unguarded audit. The instance key in the response (`product:p1`) is the §10.2 canonical encoding — the single currency shared across client store, wire, and optimism.

**Caching contract (normative).** `/_q/<key>` is a credentialed GET whose body varies by identity, so a URL that differs only by args is a shared-cache key collision waiting to leak one principal's data to another. A `/_q/` response for a guarded or otherwise session-dependent query (a query with a `guard`, or whose instance key or `load` reads `req.session.*`) MUST carry `Cache-Control: private, no-store` and `Vary: Cookie`, so no shared (CDN/proxy) cache can store it and a browser cache cannot serve it across the guard. This holds for every transport that hits `/_q/` — loader fetch, refetch-on-focus (§9.3), GET-form fragment responses (§7), and async option/search reads. The directives may be relaxed (to a cacheable posture) only for a query the compiler proves session-independent — no guard and no `req.session` read in its key or `load` — mirroring the export session-dependence proof (§9.5/KV229); such a query may set an explicit `Cache-Control` through its declared read config. A guarded query may never be served from a shared cache: the guard-at-every-read invariant must not be bypassable by an intermediary.

### 9.5 Request shell

The request shell is the server-owned composition point for routing, document assembly, dev serving, and export. Apps declare a closed `createApp()` aggregate: routes, mutations, queries, endpoints, the client-module registry, document options, unexpected-error shells, CSRF config, the `db` provider, and the §6.5 `sessionProvider`. Generated route IR and live-target registry artifacts are wired by the compiler/build integration, not by app-authored `createApp({ generated, refresh })` options. Vite/dev integration points at an authored app entry, for example `kovo({ app: '/src/app.tsx' })` from `@kovojs/server/vite`; the entry must default-export a `KovoApp` and must not point into `src/generated/*`. Compiler-owned plugins resolve route IR, live-target registries, and generated client modules internally. The public handler currency is web-standard `Request -> Response`; adapters such as `node:http` convert at the edge.

Dispatch order is normative and printable: `/_m/<mutation-key>` mutations, `/_q/<query-key>` typed reads, `/c/__v/<version>/<module>` immutable client modules, declared `endpoint()` exact/prefix mounts, route table, then the 404 shell. There is no user middleware chain in v1. Extension points that can affect control flow are declared surfaces — `sessionProvider`, guards, `endpoint()`, `webhook()` — so audits can print them and no request behavior is registered from a distance.

**Pre-dispatch load shed (normative).** Because there is no user middleware chain, the request shell/adapter itself owns a coarse limiter that runs **ahead of** replay lookup, schema parse/coercion, and the guard chain (§10.3) — guard combinators such as `rateLimit({ per: 'session' })` shed load only after CSRF, replay, and parse have already paid out, and `per: 'session'` cannot distinguish a flood of null-session attackers, so they are insufficient as the only chokepoint. Before any `/_m/`, `/_q/`, `endpoint()`, or route dispatch the shell MUST enforce: (1) a maximum request/body size — a request exceeding it is rejected with **413** before the body is read or parsed; and (2) a coarse per-IP and global request-rate budget — a request over budget is rejected with **429** carrying `Retry-After`, before replay+parse. These limits are normative defaults configured on `createApp()` (per-IP and global `/_m/` and `/_q/` request rates, max body size, and a bound on fragment-targets reconstructed per response, §9.1); the coarse limiter is identity-blind on purpose so it survives the anonymous flood the session-scoped limiter cannot. This pre-dispatch posture is enrolled in and printed by the `--endpoints` audit. The fine-grained `rateLimit` guard combinator still runs in the guard chain for per-principal policy and now admits a `per: 'ip'` (and global) dimension in addition to `per: 'session'`, so an anonymous or per-IP budget can also be expressed at the guard layer; the coarse shell limiter and the guard combinator compose rather than replace each other.

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
  access: guardAccess([{ guard: authed, name: 'authed' }]), // required explicit decision (KV436)
  args: s.object({ id: s.string() }), // coerced wherever args arrive: props, route params, /_q/ search params (§9.4)
  guard: authed, // checked at page render AND at every typed read / live push
  // guards receive the query's validated args/instance key (§10.3): guard: owns((a) => a.id, products.id)
  load: (db, args, req) =>
    db
      .select({ name: products.name, stock: products.stock })
      .from(products)
      .where(eq(products.id, args.id)),
});
```

Derived from this one expression, statically:

- **Read set** `{cart, product}` — the JOIN _is_ the declaration (forgetting a joined entity's dependency is unrepresentable).
- **Result type** from the select shape — drives the client JSON, `data-bind` paths, derive inputs, and optimistic transform parameters. Query results are `JsonValue`-bounded client wire payloads; app-authored `query().load` results may use named interfaces and readonly JSON arrays/objects, but they cannot carry `Date`, `Map`, functions, class instances, or other non-JSON values. A column rename in `schema.ts` propagates through TypeScript static checking to every template. **Opaque projections are the read-side raw-SQL seam:** Drizzle's `sql<T>` generic is an unchecked assertion, so any `sql`/raw projection requires a declared `s.*` output schema (**KV410**), and the observed result shape is runtime-verified (§11.2). An opaque projection also hides which tables it reads, so its output schema says nothing about source tables; a KV410 site MUST therefore additionally declare a `reads:` table set — the exhaustive set of tables/relations the raw read touches. The `reads:` set is statically checked against exemption (§10.1): a `reads:` entry naming an `exempt` table is **KV411**, exactly as a statically-visible join would be, so an opaque projection cannot smuggle an exempt/outbox read past the static pass. The declared `reads:` set is folded into the query's read set (§11.1) and drives invalidation; a KV410 projection with no `reads:` declaration is itself a KV410 error. A query whose opaque projection reads a table absent from `reads:` is a CI failure under runtime verification (§11.2). The inferred-type chain stays sound or the seam is visible; never both unsound and silent.
- **Instance key** from the WHERE eq-predicates, resolved to `args.*` or `req.session.*` — only args are client-visible. Canonical encoding: `name:keyValue` in declared arg order (`product:p1`). This one string keys the client store (`<script kovo-query="product:p1">`), `kovo-deps` stamps, `Kovo-Targets` (§9.1), optimistic transform keys (§10.4), and live-push routing. Two instances of one query coexist on a page; `data-bind` inside an island resolves against that island's instance.

**Args bind locally (Constitution #2).** A component declares how its args derive from its own props — `queries: { product: productQuery.args((p) => ({ id: p.productId })) }` — so any page rendering the component satisfies the dependency without call-site knowledge. Route params reach queries as ordinary props through `route().page`; no call site enumerates query dependencies.

**Queries are the UI data contract.** A query-backed component's declared queries must contain the
data needed to render that component. "Skinny" queries maintained only for optimistic derivation
plus separate page/region loaders for presentation are rejected for ordinary app code: they split the
server-truth render path from the statically declared dependency graph and force app authors back
into manual fragment routing. The compiler may derive optimistic transforms, deltas, or §4.8 update
plans for only the fields and query shapes it can prove; unproved presentation fields still travel
through the same declared query and refresh via full server fragments.

#### SQL statement safety on managed DB handles

Framework-managed DB handles — `req.db`, query loaders, mutation domains, endpoint/webhook request
handles, and blessed-adapter wrappers — treat executable SQL text as a typed surface, not an
arbitrary string channel. The ordinary accepted forms are: Drizzle query builders and native SQL
objects that keep text separate from bound parameters, Kovo tagged-template SQL values (`sql` and
`staticSql`), and the single audited `trustedSql(...)` escape hatch. KV406/KV410 remain the
freshness/read-write proof
diagnostics; **KV422** is distinct and answers how executable SQL text was constructed before it
reached a managed handle.

Scalar/runtime values MUST bind as parameters, never by interpolating bytes into SQL text.
Identifiers, operators, sort directions, and clause fragments are not scalar values; they MUST come
from static schema facts or typed allowlists such as `sql.identifier(..., { allow })` /
`sql.allow(...)`, never directly from request strings.

For the static analyzer and explain/audit surfaces, the source set is the request-derived boundary:
`input`, `req.search`, `req.params`, form bodies, headers, and cookies. The sink set is every
framework-managed SQL construction/execution boundary: `db.execute(...)`, `db.query(...)`,
`db.exec(...)`, `db.prepare(...)`, `sql.raw(x)`, `sql.identifier(x)`, and untagged template/string
assembly routed into SQL execution. A request-derived or otherwise unproven value that can become
executable SQL text at one of those sinks is **KV422**.

Non-goals are explicit. Kovo does not sanitize arbitrary SQL strings into safety; it requires
parameterization, a typed allowlist, or an explicit `trustedSql(...)` brand. It does not prove
safety for driver handles captured before the framework wraps them. **Second-order injection is out
of scope**: a value read back from the database and later re-used in another query is governed by
the same `sql\`\``/`trustedSql(...)` discipline at the second query site, not by request-taint
tracking across storage.

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
  // Statically un-analyzable writes REQUIRE declaration, runtime-verified.
  // Raw-SQL writes MUST enumerate every table they touch via `tables:` — a
  // structurally-parsed allowlist the executor enforces (§11.2); `touches:`
  // names the resulting domains. The executor parses each emitted statement
  // and FAILS CLOSED (conservative whole-domain invalidation of `touches`,
  // plus a CI failure) on any production write to a table outside `tables:`.
  merge: write({ tables: ['cart_items', 'carts'], touches: ['cart'] }, async (db, …) => {
    await db.execute(sql`/* gnarly CTE */`);
  }),
});
```

**No `touches` on `addItem`, no `invalidate()` in handlers.** The static pass (§11) extracts `{cart_items→cart, products→product}` from the AST; calling `cart.addItem` _is_ the invalidation declaration. `invalidate()` survives only as a linted escape hatch for external-system effects (e.g., a Stripe webhook changing data Kovo should refresh).

**`touches`/`tables` declarations on opaque writes are statically required, not best-effort.** A write site whose touch set is not fully statically resolved — an `'unresolved'` runtime-flowing table value (§11.1 step 2.E) or a call into `node_modules` carrying a `db` arg (§11.1 step 3) — is **error KV406** when it lacks a manual `touches`; the dev/build/export gate blocks until one is supplied. A raw-SQL write (`db.execute(sql`…`)` / opaque projection write) MUST additionally declare `tables:` — the exhaustive set of tables the statement mutates — which the runtime executor parses and enforces (§11.2). On a production write to a table outside the declared `tables:`, the executor MUST fail closed: invalidate every domain in `touches` conservatively (whole-domain, ignoring key granularity) so no reader is left silently stale, and record a CI-failing violation; it MUST NOT skip invalidation on the unexpected table. Dev/test instrumentation under-approximates (executed branches only, §11.2), so passing dev/test coverage **does not prove KV406 completeness** — an unexercised conditional raw-SQL arm that writes an undeclared table is exactly the case the `tables:` allowlist and the production fail-closed rule exist to catch, since the dev cross-check never observes it.

**Request lifecycle (normative):**

```
(pre-dispatch shell: max-body-size → 413 · coarse per-IP/global rate → 429 — §9.5)
CSRF validation → replay reservation by (principal, mutation-key, idem-token) → parse+coerce input (schema)
→ guard chain → BEGIN tx → handler (receives Tx-typed db; escaping the tx is a type error)
→ COMMIT (settle reservation, store response) → re-run invalidated queries (post-commit, same request context)
→ render <kovo-query>/<kovo-fragment> → respond
                    ⇘ on fail(): ROLLBACK → typed error fragment, 422
```

This ordering closes the read-your-writes hazard: responses can never render pre-commit data (which would visibly revert the user's optimistic update). A replay hit does not bypass authorization: the runtime MUST re-evaluate the session-bound guard chain against the **current** principal before re-serving a stored response, so a replay never re-serves a private response after the principal's authorization changed (role revoked, ownership lost). The replay store is keyed on (principal ∧ mutation-key ∧ idem-token), so a replay can only ever return to the same principal that produced it.

**Replay is an atomic reservation, not a lookup (normative).** The replay step MUST atomically claim the `(principal, mutation-key, idem-token)` triple before the guard chain — an `INSERT … ON CONFLICT` against the replay store (or an equivalent unique-key claim) inside the same serialization boundary that the commit settles. A submit that wins the claim proceeds; a concurrent or sequential submit carrying the same triple MUST block on the in-flight reservation and then replay the settled response, never re-execute the handler. This holds for **all** mutation paths — the enhanced and no-JS `mutation()` lifecycle, `webhook()` (§9.1, keyed by provider event id), and the streaming path — so concurrency, not merely strictly-sequential retries, is deduplicated. The store is scoped to the current principal (a different `req.session` identity never replays a prior principal's response) and to the specific mutation, so an idem-token reused across mutations cannot cross-replay.

**Idem-token minting and entropy (normative).** `Kovo-Idem` is a per-submit token, not a per-form constant. The client MUST mint a fresh high-entropy token (≥ 128 bits from a cryptographic source) for each logical submit and place it in the stamped hidden field; the enhanced success response MUST refresh the hidden field with a new token so an immediate re-submit of the same form instance carries a different token and is treated as a new logical mutation rather than replaying the first response. Because the replay step precedes input parsing, the token MUST NOT be derived from input. A re-submit that edits visible fields therefore produces a distinct token — eliminating the silent lost-update where an unchanged hidden field replayed the first commit. Token collision within `(principal, mutation-key)` is a server-detectable integrity fault answered as a 422 schema-class failure (§9.2), never a silent replay of an unrelated commit.

**Guards (arg-aware, normative).** A guard is a refinement run before `page`/`load`/`handler`. Beyond `req.session`, every guard receives the query's or mutation's **validated args / resolved instance key** — the same `s.*`-coerced values the loader and handler see (§9.4, §10.2). A guard may therefore express ownership over a client-visible key, not only session-wide roles. Guards run after schema parse/coerce so the args they inspect are already validated (§10.3 lifecycle).

**`owns()` ownership combinator.** `owns((args) => args.id, table.ownerColumn)` is the sanctioned ownership guard: it passes only when the principal (`req.session`, the column declared by the table's `owner:` annotation, §10.1) owns the row the key selects. `owns()` is composable with the other combinators (`all(authed, owns(...))`) and discharges the KV414 IDOR obligation for the key it covers. The shipped runtime contract is `guards.owns(keyOf, ownsRow)` where `ownsRow(req, key)` is an app-provided ownership predicate (so `@kovojs/server` stays decoupled from the data layer); the `table.ownerColumn` column-form above is the planned compile-time sugar that lowers to it.

```ts
export const adminRefund = mutation('admin/refund', {
  access: guardAccess([{ guard: role('admin'), name: 'admin' }]),
  guard: role('admin'),
  /* … */
});
export const orderQuery = query('order', {
  access: guardAccess([{ name: 'authed' }, { name: 'owns:orders.id' }]),
  args: s.object({ id: s.string() }),
  guard: all(
    authed,
    owns((a) => a.id, orders.id),
  ), // args.id ownership — discharges KV414
  load: (db, args) => db.select().from(orders).where(eq(orders.id, args.id)),
});
// composable: guard: all(authed, rateLimit({ per: 'session', max: 10 }))
// rateLimit also admits per: 'ip' and a global dimension; a coarse per-IP/global
// body-size + rate limiter runs PRE-DISPATCH (413/429) ahead of replay+parse (§9.5)
// static audit: `kovo explain --unguarded` lists every mutation, route, and query reachable without `authed`
// static audit: `kovo explain --unscoped` lists every query/write touching an owner-annotated
// table (§10.1) whose key predicate is not traceable to req.session and not authorized by an
// ownership guard — the IDOR audit; the §11.1 predicate extractor does the tracing
```

**KV414 — IDOR audit is a blocking gate, not advisory.** A query or write whose key predicate touches an `owner:`-annotated table (§10.1) MUST resolve that key to either `req.session.*` or an `owns()`-class ownership guard. A site that reaches an owner-table row through a client-visible `args.*` key with neither is **KV414** (`error`) — runtime-verified by the §11.2 cross-check against the executed read/write predicates and the §11.1 predicate extractor's session-traceability result, so a smuggled or branch-hidden arg-keyed owner read fails CI as loudly as silent staleness (KV407/KV411). The `--unscoped` audit prints the same set; KV414 is its enforced form. A genuinely public read suppresses KV414 only with a recorded justification at the site, which `kovo explain --unscoped` surfaces verbatim.

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

**Runtime protocol:** snapshot the affected query values → apply transforms to the shared query values and run their update plans (all dependent islands update at once; affected islands get `kovo-pending` + `aria-busy` automatically) → on success, `<kovo-query>`/morph reconciles over the prediction (right guess ⇒ near-no-op; wrong guess ⇒ silent correction) → on error, restore snapshots, render error fragment.

**Bounded snapshot (normative).** The snapshot MUST cover only the change-record-touched subset of each affected query value — the keyed rows, scalar fields, and aggregate inputs a transform can mutate — under structural sharing (copy-on-write of the touched path), not an unconditional deep `structuredClone` of the whole value. The `JsonValue` constraint bounds serializability, not size; cloning a large dataset per mutation or per rebase is forbidden. A transform may mutate only within its declared touch scope, so an untouched subtree is retained by reference and restored by reference on rollback.

Successful enhanced mutation responses should include `<kovo-query>` chunks for every invalidated query instance the server can derive and rerun in the request (§10.3). When server truth for an optimistic transform is missing, the client MUST emit a visible runtime diagnostic (**KV313**) and **discard** the prediction — roll the affected query back to its pre-transform snapshot (§10.4 bounded snapshot) or force a `/_q/<key>` refetch (§9.4) — never freeze the unconfirmed prediction on screen as authoritative-looking data. "Settle" here means "discard the transform and reconcile against server truth," not "promote the prediction." This is a development escape valve for explicitly fragment-only or temporarily uncovered responses: KV310 exhaustiveness (§10.6) makes a covered mutation that ships no truth for an invalidated query a build failure, so a missing-truth discard never reaches a production end user as the steady-state contract.

**Concurrency:** a per-query pending-transform log keyed by `Kovo-Idem` token (§9.1). On each arriving server-truth chunk the runtime first **settles** the log: it drops every pending transform whose token is in the chunk's settlement set (§9.1.1) — those commits are already reflected in the arriving truth — then morphs the truth in, then re-applies **only the not-yet-committed** transforms in log order (rebase). Purity gives determinism but not idempotency, so settlement-before-rebase is mandatory: re-applying an already-committed additive transform would double-count the write. A transform whose token is absent from every truth chunk remains pending until its own response settles it. The settlement-matching rule is exact token-set membership; a truth chunk that carries no settlement set is treated as settling its triggering mutation's token only.

**Named FIFO queues (`queue: 'cart'`, normative).** A queue serializes the mutations declaring the same name. Its semantics are pinned so two conforming implementations cannot diverge between "frozen cart" and "dropped actions":

- **Transform-apply timing.** A queued mutation applies its optimistic transform on **enqueue** (immediately, against the current optimistic value including earlier queued-but-unsent transforms), not on dequeue — so the UI reflects the full queued intent without waiting for the head to drain. Its network request is sent only when it reaches the head.
- **Head-of-line timeout/abort.** The in-flight head MUST carry a bounded timeout; on timeout or transport error the head is aborted, its transform is rolled back via its bounded snapshot, an error fragment is rendered, and the queue advances to the next entry. A hung head MUST NOT block the tail indefinitely.
- **Failed/hung-head drain.** When the head fails or times out, the tail is **not** silently dropped: each surviving entry is re-validated against the rolled-back optimistic value and either advances or is discarded with a visible KV313 diagnostic; ordering among survivors is preserved.
- **Queued-but-unsent fate on navigation.** Entries already in flight complete via `keepalive`; entries still queued-unsent at navigation are abandoned with the document (their optimistic transforms die with the log), exactly as for un-queued in-flight work — navigation is a reconciliation point, not a delivery guarantee.
- **Queue bound.** Each named queue has a bounded depth; enqueue past the bound is refused with a visible diagnostic rather than growing without limit.

Navigation is a free reconciliation point: in-flight requests complete via `keepalive`, the log dies with the document.

### 10.5 Derivation algebra

The compiler may derive an optimistic transform only when the write can be reduced to symbolic
row-effects over mutation input, schema constants, and columns already present in the affected query,
and the query shape fits the grammar named in §10.4. The derivation is all-or-nothing per affected
field: an opaque server computation, non-key match, unsupported aggregation/windowing shape,
interprocedural opacity, or untraceable parameter punts that field to `await-fragment` or a
hand-written transform. Every punt is named in `kovo explain --optimistic` with the exact expression
and reason.

**Soundness is property-tested:** for derivable pairs, generated-state tests assert
`patch(clientShape(s), i) ≡ clientShape(apply(effect, s, i))` — the commuting diagram is the
deriver's test suite. The expanded derivation grammar and examples live in
`site/content/guides/optimistic.md`.

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
     E. runtime-flowing value      → 'unresolved' → KV406 (error: manual touches REQUIRED;
                                     dev/build/export gate blocks until supplied — §10.3)
  3. Interprocedural: helpers receiving a Drizzle-typed value are summarized bottom-up
     (memoized fixpoint); calls into node_modules with a db arg → KV406 (error, same gate).
     `update…from(R)` / `insert…select` contribute R to the READ set, not touches.
     Opaque/raw query projections (KV410, §10.2) contribute their declared `reads:`
     table set to the READ set; a `reads:` entry naming an `exempt` table is KV411.
  4. Parameterized keys: extract eq(T.keyCol, expr) from .where(); expr traceable to a
     write param ⇒ key derivation recorded; ranges/IN ⇒ table-level (KV409 notice).
  5. Whenever a write site's touch set is not fully statically resolved (any 'unresolved'
     table at step 2.E, any node_modules db call at step 3, or any raw-SQL statement whose
     mutated tables cannot be read off the AST), it is **KV406 (error)** absent a manual
     `touches`/`tables` declaration, and an unexecuted conditional write on such a site is
     **KV405 (error, CI-gating)** — see §11.2. KV405 is no longer advisory: a write site
     whose touch set is not fully statically resolved and whose branches were not all
     observed under instrumentation blocks build and static export, because the runtime
     cross-check (§11.2) cannot have proven the unexecuted arm's touch set sound.
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

Dev server and the test harness wrap `db`; every executed statement is parsed by the configured dialect path (Postgres uses `pgsql-ast-parser`; SQLite normalizes `?` placeholders before the same structural walk) and checked. Static over-approximates (all branches); runtime under-approximates (executed branches). **Invariant: `observed ⊆ static ∪ KV406-annotated`** — violation means analyzer bug or smuggled SQL; either is a CI failure. For raw-SQL writes this invariant is enforced structurally: the executor parses each statement with the configured dialect path and checks its mutated-table set against the write's declared `tables:` allowlist (§10.3). A statement that mutates a table outside `tables:` is a CI failure under instrumentation and, in production where instrumentation is absent, fails closed — the executor conservatively invalidates every domain in the write's `touches` and records the violation, never silently dropping the unexpected table's invalidation. Because instrumentation under-approximates (executed branches only), passing dev/test runs do **not** establish KV406 completeness; an unexercised raw-SQL arm is proven sound only by its statically-declared `tables:`/`touches`, which is why those declarations are KV406-`error` (not advisory) and an unexecuted such branch is KV405-`error` (§11.1). Read-side gets identical treatment (query loaders' SELECT/JOIN tables vs. derived read sets, **and observed result shapes vs. declared/inferred types — the runtime half of KV410**, so an opaque projection's schema claim is tested against what the database actually returns; an opaque projection that reads a table absent from its declared `reads:` set (§10.2) is a CI failure on the same `observed ⊆ static ∪ declared` invariant, but the static `reads:` declaration — not this dev/test-only observation — is what proves an unexercised branch sound). An observed read of an `exempt` table is the runtime half of **KV411** (§10.1) — the same CI failure whether the exempt read was statically visible or smuggled through raw SQL.

### 11.3 Diagnostic codes (registry)

| Code  | Severity | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KV201 | error    | Closure captures unserializable value (shows lowering + fixes)                                                                                                                                                                                                                                                                                                                                                                                                    |
| KV210 | lint     | Anonymous handler — name it for stable identity                                                                                                                                                                                                                                                                                                                                                                                                                   |
| KV211 | lint     | `on:load` eager trigger — justification comment required (the greppable eager-JS budget)                                                                                                                                                                                                                                                                                                                                                                          |
| KV212 | lint     | Unknown `on:*` event or trigger name (DOM event names; the closed trigger set, §4.7)                                                                                                                                                                                                                                                                                                                                                                              |
| KV220 | error    | Literal `href`/form `action` matches no declared route (full-origin URLs / `external` opt out)                                                                                                                                                                                                                                                                                                                                                                    |
| KV221 | error    | IDREF (`commandfor`, `popovertarget`, `for`, `aria-*`) references an id not present in scope                                                                                                                                                                                                                                                                                                                                                                      |
| KV222 | error    | Hand-written binding stamp disagrees with the typed expression it wraps (§4.8)                                                                                                                                                                                                                                                                                                                                                                                    |
| KV223 | lint     | Redundant hand-written stamp in sugar — the compiler derives it (§4.8)                                                                                                                                                                                                                                                                                                                                                                                            |
| KV224 | error    | Static `id` in a repeatable component / duplicate id in a page composition (§4.5)                                                                                                                                                                                                                                                                                                                                                                                 |
| KV225 | error    | JSX nesting violates the HTML content model — the parser would re-parent (§4.2)                                                                                                                                                                                                                                                                                                                                                                                   |
| KV226 | internal | `kovo-deps`/`kovo-c` names an unknown query instance or component in emitted IR fixpoint validation                                                                                                                                                                                                                                                                                                                                                               |
| KV227 | error    | Binding path traverses a nullable segment without `?.` or a null-handling derive (§4.8)                                                                                                                                                                                                                                                                                                                                                                           |
| KV228 | error    | Ambiguous route table: two routes can match the same canonical request path or duplicate route path (§9.5)                                                                                                                                                                                                                                                                                                                                                        |
| KV229 | error    | Static export constraint violation: route/session/mutation/param usage cannot be exported as L0/L1 (§9.5)                                                                                                                                                                                                                                                                                                                                                         |
| KV230 | error    | Fragment-target children not lowerable to a component reference (shows the hoisting + fixes)                                                                                                                                                                                                                                                                                                                                                                      |
| KV231 | error    | Unmergeable attribute conflict in primitive composition (shows both sources + the §4.6 rule)                                                                                                                                                                                                                                                                                                                                                                      |
| KV232 | lint     | Author override of a primitive-owned ARIA/state attribute                                                                                                                                                                                                                                                                                                                                                                                                         |
| KV233 | error    | Two writers for one binding target                                                                                                                                                                                                                                                                                                                                                                                                                                |
| KV234 | error    | Package component prefix registration conflict or reservation violation (§6.1.1)                                                                                                                                                                                                                                                                                                                                                                                  |
| KV235 | error    | App source hand-authors lowered IR/string-rendered components or derivable runtime stamps; write TSX (`queries`, `key`, typed expressions) and let the compiler emit IR (§5.2)                                                                                                                                                                                                                                                                                    |
| KV236 | error    | Binding/derive/sink value reaches an unsafe output context (raw-HTML insertion; URL-scheme attribute against the javascript:/data: denylist for href/src/action/formaction/xlink:href/ping/poster/CSS url(); `on*`; style attribute or `<style>` text; srcdoc; `<script>`/`application/json` island text) without the typed trusted-HTML escape hatch (`trustedHtml`/`trustedUrl`, §4.8); contexts and URL-scheme allowlist defined in §4.8, contract in §5.2 #10 |
| KV237 | error    | Duplicate derived component registry key (§4.2, §4.8, §6.1.1)                                                                                                                                                                                                                                                                                                                                                                                                     |
| KV238 | error    | Duplicate derived fragment-target registry key (§4.5, §6.2, §9.1)                                                                                                                                                                                                                                                                                                                                                                                                 |
| KV239 | error    | Duplicate static view-transition name (§8)                                                                                                                                                                                                                                                                                                                                                                                                                        |
| KV240 | error    | Duplicate query-shape fact for one query name (§4.8)                                                                                                                                                                                                                                                                                                                                                                                                              |
| KV241 | warn     | Derived component registry key changed since the previous emitted graph (§4.2, §4.8)                                                                                                                                                                                                                                                                                                                                                                              |
| KV242 | error    | Enhanced mutation form control names do not match the bound mutation input schema (§6.2, §6.3)                                                                                                                                                                                                                                                                                                                                                                    |
| KV244 | lint     | `defer()` used directly as a JSX child; use the public `<Defer>` primitive so fallback/render output follows JSX escaping (§8)                                                                                                                                                                                                                                                                                                                                    |
| KV301 | lint     | Server fact in island-local state                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| KV302 | error    | `data-bind` path is not present in the declared query shape (§4.8)                                                                                                                                                                                                                                                                                                                                                                                                |
| KV303 | error    | Inferred refresh-target render input is not declared as query data or serializable stamped props (§4.5)                                                                                                                                                                                                                                                                                                                                                           |
| KV304 | error    | Reserved query name such as `state` is not allowed (§4.8 binding roots)                                                                                                                                                                                                                                                                                                                                                                                           |
| KV310 | warn     | Invalidated query lacks optimistic transform (write/defer/derive)                                                                                                                                                                                                                                                                                                                                                                                                 |
| KV311 | warn     | Query/state-dependent DOM position with no update status — plan/isomorphic/fragment/renderOnce (§4.9)                                                                                                                                                                                                                                                                                                                                                             |
| KV312 | error    | Time-dependent rendered position has no declared clock/query refresh cadence (§4.8/§4.9)                                                                                                                                                                                                                                                                                                                                                                          |
| KV315 | warn     | Raw `Date.now()`/`new Date()` read in a derive has no declared clock cadence; use a declared `clocks` input (§4.8/§4.9)                                                                                                                                                                                                                                                                                                                                           |
| KV320 | lint     | Event payload overlaps query data — use a transform                                                                                                                                                                                                                                                                                                                                                                                                               |
| KV330 | lint     | Direct db access in a mutation handler — route through domain                                                                                                                                                                                                                                                                                                                                                                                                     |
| KV402 | error    | Write touched a domain not covered by the derived or declared mutation touch set (silent stale UI)                                                                                                                                                                                                                                                                                                                                                                |
| KV403 | warn     | Declared domain never observed written (stale claim / untested branch)                                                                                                                                                                                                                                                                                                                                                                                            |
| KV404 | error    | Write to unmapped table (map it or mark `exempt`, e.g. append-only logs — write-side only, §10.1)                                                                                                                                                                                                                                                                                                                                                                 |
| KV405 | error    | Conditional/un-fully-resolved write site has branches never executed under instrumentation — CI-gating; static touch set is unproven (§11.1/§11.2)                                                                                                                                                                                                                                                                                                                |
| KV406 | error    | Statically un-analyzable write site (unresolved/node_modules; raw SQL) — manual `touches` (and `tables:` for raw SQL) required, executor-enforced + runtime-verified (§10.3/§11.1/§11.2)                                                                                                                                                                                                                                                                          |
| KV407 | error    | Query read from a domain not covered by the derived or declared query read set (missed invalidations)                                                                                                                                                                                                                                                                                                                                                             |
| KV408 | error    | Declared row key ≠ observed row predicate                                                                                                                                                                                                                                                                                                                                                                                                                         |
| KV409 | notice   | Non-eq predicate — degraded to table-level invalidation                                                                                                                                                                                                                                                                                                                                                                                                           |
| KV410 | error    | Opaque query projection (`sql<T>`, raw SQL) — declared output schema AND `reads:` table set required; `reads:` checked against exemption (KV411) and folded into the read set, shape runtime-verified (§10.2)                                                                                                                                                                                                                                                     |
| KV411 | error    | Query read set includes an `exempt` table — exemption is write-side only (§10.1), runtime-verified (§11.2)                                                                                                                                                                                                                                                                                                                                                        |
| KV412 | error    | Query reads an unmodeled relation (view / materialized view) with no derived or declared domain (§10.1/§11.1)                                                                                                                                                                                                                                                                                                                                                     |
| KV413 | error    | Database trigger / engine side-effect needs a declared fan-out edge before invalidation can be proven (§10.1/§11.1)                                                                                                                                                                                                                                                                                                                                               |
| KV313 | error    | Optimistic transform settled with missing server truth — prediction discarded/refetched, not frozen (§10.4); a covered mutation shipping no truth for an invalidated query is also caught by KV310 (§10.6)                                                                                                                                                                                                                                                        |
| KV420 | error    | Island declaring local state (`kovo-state`) nested inside another component's server-refreshable fragment target — the morph carries no local-state serialization and would clobber the child's live state on refresh (§4.5/§4.9/§9.1)                                                                                                                                                                                                                            |
| KV316 | error    | `isomorphic: true` on a children/slot-accepting component whose render cannot be partitioned into self-render positions plus preserved projected-children regions (client self-render has no slot arguments, would drift from server output) (§4.5/§4.8)                                                                                                                                                                                                          |
| KV317 | error    | Static state-bearing `aria-*` value contradicts the primitive's render-time state — frozen-vs-clobbered; distinct from the visible-override lint KV232 (§4.6)                                                                                                                                                                                                                                                                                                     |
| KV414 | error    | Query/write reaches an `owner:`-annotated table (§10.1) through a key predicate not traceable to `req.session` and not authorized by an ownership guard (`owns()`) — IDOR; runtime-verified (§11.2). Suppress only with a recorded public-read justification (§10.3).                                                                                                                                                                                             |
| KV415 | error    | Response header channel: forbidden header name (outside the typed allowlist) or CR/LF/NUL/control char in a header name or value; `Set-Cookie` must use the typed cookie builder (§9.1.1)                                                                                                                                                                                                                                                                         |
| KV416 | error    | Prod render-equivalence gate failed (§5.2.2): `apply_delta(base, render_prod(Δ)) ≢ render_dev(full)` over the corpus, or a corpus edit changing a projected query shape or the update-plan grammar that did not move the §5.2.1 render-plan version token. Build-failing.                                                                                                                                                                                         |
| KV417 | error    | Configured supported deploy-skew window (§6.6/§14) is below the required 24-hour prior-version retention floor, or the serving layer cannot retain prior immutable modules and per-token `/_q` reads for the window (§14).                                                                                                                                                                                                                                        |
| KV418 | error    | `csrf: false` mutation references ambient browser authority (reads `req.session` or runs a session/cookie-derived guard) — the CSRF exemption is unsound; route non-browser writes to `endpoint()`/`webhook()` (§6.6, §9.1)                                                                                                                                                                                                                                       |
| KV419 | error    | `prefetch: 'moderate'` set on a guarded, session-dependent, or not-proven-side-effect-free route without a named justification (§8)                                                                                                                                                                                                                                                                                                                               |
| KV421 | error    | Duplicate mutation key: generated mutation registry indexing and server dispatch would disagree (§6.1, §9.5)                                                                                                                                                                                                                                                                                                                                                      |
| KV422 | error    | Request-derived or otherwise unproven data reaches executable SQL text on a framework-managed DB handle; bind scalar values as parameters and choose identifiers/keywords from typed allowlists or schema facts (§10.2/§10.3)                                                                                                                                                                                                                                     |
| KV423 | error    | Raw `endpoint()` declaration lacks required audit metadata such as explicit method, reason, mount justification, response body posture, cache posture, or app-owned encoding/header-safety posture (§9.1)                                                                                                                                                                                                                                                         |
| KV424 | error    | App-authored dangerous sink is not registered or behind a safe Kovo helper/trust API; direct raw HTML, URL/navigation, selector, header, file/path, dynamic-code, process sinks must use the matching safe surface or audited escape hatch (§4.8, §5.2, §9.1)                                                                                                                                                                                                     |
| KV425 | error    | Source/sink drift detection found a framework sink token that is not in the shared registry and has no narrow repo-internal exclusion                                                                                                                                                                                                                                                                                                                             |
| KV426 | error    | Trust escape hatch such as `trustedHtml`, `trustedUrl`, raw endpoint, custom/no verifier, static export path override, or future trusted SQL lacks auditable provenance/source-span/justification (§4.8, §9.1)                                                                                                                                                                                                                                                    |
| KV427 | error    | Cloud SDK client imported from a declared metadata-cloud provider package is constructed without an explicit credential/auth option; pass the declared Kovo cloud credential or a provider-specific credential option so metadata refreshes stay inside the framework capability frame (§11.3)                                                                                                                                                                    |
| KV435 | error    | Secret-classified query result field, or an opaque/unresolved projection from a table carrying secret columns, reaches the client query wire; remove the field/opaque projection or use `trustedReveal(value, { justification: "..." })` in a statically analyzed Drizzle projection so `kovo explain --revealed` records the audit (§6.2, §10.2, §11.3)                                                                                                          |
| KV436 | error    | Query, mutation, route/page, endpoint, or webhook has no explicit access decision; add an access guard chain, `public("reason")`, or verified machine-auth decision and review the ledger with `kovo explain --access` (§10.2, §11.3)                                                                                                                                                                                                                             |

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

`kovo explain --endpoints` is the stable machine-ingress audit. Its diffable table lists every declared endpoint and webhook, every `mutation()`, plus every route that returns `respond.file()`/`respond.stream()`: name, method, path, mount mode, auth scheme (`session+guard`, `verifier:<resolved scheme>`, `custom:<name>`, or `none:<justification>`), CSRF posture (`checked` or `exempt:<justification>`), and for webhooks the write→domain chain. A `csrf: false` mutation appears here with posture `exempt:<justification>`; KV418 (§6.6) guarantees such a mutation references no ambient session. The pre-dispatch coarse limiter posture (§9.5) is enrolled and printed here too. The command is snapshot-locked with the rest of P8 output so security review can answer "what can reach this app, and what can it touch?" without executing a browser.

Browser tests are a first-class part of the **framework's** own suite: morph runs on every mutation response, and its survival contract (focus, caret, scroll, transitions) plus L0 platform behaviors are irreducibly browser-bound. The reconciliation suite splits accordingly: a browser-free structural property suite (`morph(a, b) ≡ b` with keyed-node identity preserved — runs in jsdom-class DOM), and a named browser suite for the survival contract. The claim is bounded: **application wiring is proof-carrying**, so apps need few or no browser tests of their own — most SPA testing exists to compensate for unverifiable wiring, and Kovo removes that category, not testing itself.

---

## 12. Testing API

The testing surface mirrors the framework proof surface. Mutations execute as functions with
touch-checking enabled, pages render to inspectable HTML without a browser, typed error paths expose
the declared error union, and generated optimistic transforms have property tests for
`patch(shape(s), input) ≡ shape(apply(effect, s, input))`. Handlers unit-test as `(event, ctx)`
functions; transforms as pure `(data, input)` functions; the wire as HTTP.

API examples and integration harness guidance live in `docs/integration-testing.md` and
`site/content/guides/testing.md`.

---

## 13. Related Rules and Roadmaps

`SPEC.md` is the normative source of framework behavior. The following files
carry standing conformance rules, release gates, implementation roadmaps, and
explanatory examples:

- Accessibility conformance: `rules/accessibility-conformance.md`
- Data-layer policy: `rules/data-layer-policy.md`
- v1 acceptance gates: `rules/v1-acceptance.md`
- Open design areas: `plans/open-design-areas.md`
- Data-layer roadmap: `plans/data-layer-roadmap.md`
- Risk register: `docs/risk-register.md`
- Worked add-to-cart example: `docs/worked-example-add-to-cart.md`
- Integration testing and browser-free test API examples: `docs/integration-testing.md`
- Layout authoring examples: `site/content/guides/layouts.md`
- Component authoring and copy-in UI examples: `site/content/guides/components.md`
- Optimistic derivation examples and expanded grammar: `site/content/guides/optimistic.md`
- StyleX, stylesheet, and theme-token guidance: `site/content/guides/styling.md`

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

## 14. Deploy Skew & Version Recovery

A long-open tab, a stale prerender, or a cached document may outlive the build it was produced by. Kovo makes this **loud and recoverable** rather than silently wrong (§9.1.1): a payload whose render-plan version token (§5.2.1) does not match the receiver is never merged.

**Recovery contract (normative).** On a token mismatch the client MUST NOT apply the delta, the `/_q/` read, or the fragment merge. It instead refetches the full value over the typed read endpoint (`/_q/<key>`, §9.4). If the refetch itself returns a token that still differs from the document token, the document is fundamentally skewed: the client performs a full navigation reload of the current route so the document, its modules, and its query bases are all reissued against one build. Optimistic state on a discarded delta is reconciled or rolled back per §10.4; recovery never promotes an unconfirmed prediction. Recovery is idempotent and side-effect-free: it issues GETs and, at most, one reload.

**Prior-version retention window (required minimum).** The serving layer MUST retain prior immutable artifacts so a skewed document can recover without a 404. For the **supported deploy-skew window** (§6.6) — a deployment-configured duration with a normative floor of **24 hours** of wall-clock retention across redeploys, configurable upward but not below the floor — the server MUST keep resolving: (a) every emitted immutable client-module URL `/c/__v/<version>/<module>` (§9.5) and its generated-ABI imports, and (b) the `/_q/<key>` read surface for every prior in-window token, returning a token-tagged full value the stale document can recover from. An interaction or refetch from an in-window document MUST NOT 404 (§6.6). Artifacts older than the window MAY be evicted; a request for an out-of-window version is answered as a build-skew event that triggers the full navigation reload above, never a silent stale patch. A deployment that cannot meet the retention floor MUST surface the gap; shipping a window below the floor is **KV417**.
