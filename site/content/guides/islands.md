---
title: Interactive islands & client state (L1)
description: Author interactivity as pure client islands — local state plus a derived update plan — and let the compiler lower your inline closures to named handlers.
order: 3.5
---

# Interactive islands & client state (L1)

Most interactivity isn't a write to the server — it's a toggle, a tab, a filter, a carousel. Kovo's
Interaction Ladder says to use the **lowest layer that suffices**, and for client-only UI that layer
is **L1: a pure client island** — local state plus the update plan (bindings, derives, stamps). You
author an inline closure that flips a state field; the compiler lowers it to a named handler that
loads on first touch and updates the DOM by walking self-describing attributes. No re-render, no
virtual DOM, no eager JavaScript.

This guide is about _authoring_ that interactivity. (For copy-in primitive components — the headless
UI library — see [components](/guides/components/).)

## The Interaction Ladder

Reach for the lowest layer that does the job:

| Layer  | Mechanism                                                              | Example                | JS shipped                    |
| ------ | ---------------------------------------------------------------------- | ---------------------- | ----------------------------- |
| **L0** | Platform behavior: invoker commands, `<details>`, `<dialog>`, `:has()` | Open a drawer          | 0                             |
| **L1** | Pure client island: local state + update plan (this guide)             | Tabs, toggle, filter   | handler module on first touch |
| **L2** | Mutation: real form + enhanced fetch → fragment/query patch            | Add to cart            | loader + form module          |
| **L3** | Optimistic: transform over query values                                | Instant badge tick     | transform module              |
| **L4** | Roadmap live transport over the same fragment/query chunks             | Order status, presence | Not in technical preview      |

If a `<details>` element or `commandfor`/`command` does it, write that and ship zero JS — the
compiler enforces L0 substitutions. L1 is for state the platform can't express on its own: a pressed
toggle, a checked-vs-indeterminate checkbox, a selected tab.

## Author local state

A component declares its private, client-owned state with `state: () => ({...})`. The return value
must satisfy `JsonValue` — no `Date`, `Map`, functions, or class instances — so serializability is a
compile error, not a runtime surprise. The smallest island is a state value plus a button that
changes it:

```tsx
export const Toggle = component({
  state: () => ({ pressed: false }),
  render: (_queries, state) => (
    <button aria-pressed={String(state.pressed)} onClick={() => (state.pressed = !state.pressed)} />
  ),
});
```

Here is the gallery's toggle island, authored TSX verbatim:

```tsx
import { component } from '@kovojs/core';

export interface GalleryToggleDemoState {
  pressed: boolean;
}

export const GalleryToggleDemo = component({
  state: () => ({ pressed: false }), // local, JsonValue-constrained
  render: (_queries, state: GalleryToggleDemoState) => (
    <section data-gallery-interactive="toggle">
      <button
        aria-pressed={String(state.pressed)}
        data-state={state.pressed ? 'pressed' : 'off'}
        onClick={() => {
          state.pressed = !state.pressed; // mutate state; the compiler lowers this closure
        }}
        type="button"
      >
        Dense rows
      </button>
      <output data-demo-state="pressed">{state.pressed ? 'pressed' : 'off'}</output>
    </section>
  ),
});
```

Local state and query data are different channels and the compiler keeps them separate:

- **Query data** is shared and server-owned. It lives in `<kovo-query>` and refreshes when a mutation
  invalidates it. See [queries](/guides/queries/).
- **Local state** is private and client-owned. It never touches the server.

Putting a server fact in local state is **lint KV301** — if a value comes from the database, it
belongs in a query (and, if you want instant feedback, an optimistic transform), not in `state`.

## Named handler exports `(event, ctx)`

You author inline closures; the compiler extracts each into a named, exported handler with the
signature `(event, ctx)`. This is the contract the loader invokes. The gallery toggle above lowers to
this generated client module:

```js
// generated — but valid, authorable Kovo source
import { handler } from '@kovojs/browser';

export const GalleryToggleDemo$button_click = handler((event, ctx) => {
  ctx.state.pressed = !ctx.state.pressed;
});
```

```html
<button on:click="/c/toggle-demo.client.js#GalleryToggleDemo$button_click">Dense rows</button>
```

Names are source-derived (`Component$fnName`, or `Component$element_event` when anonymous — lint
KV210 nudges you to name it) and **minification never renames them**, because they are load-bearing
in the HTML. `ctx` carries the island's state, typed element params, and an `AbortSignal`
(`ctx.signal`) the loader aborts when the morph layer removes the island — that's the whole
lifecycle, no mount/unmount callbacks. Handlers unit-test as plain `(event, ctx)` functions.

A closure may only capture three channels: component/query state (via `ctx`), element params
(`data-p-*`, typed — non-string params declare coercion once, schema-style), and module scope.
Anything else is compile error **KV201**, whose message shows what the closure _would have_ compiled
to and the three fixes.

## The update plan: bindings, derives, stamps

When state (or query data — same machinery, two sources) changes, the loader runs three steps in
order by walking self-describing attributes. **The DOM is the plan** — there is no separate compiled
artifact. The author writes typed expressions; the compiler emits the residual strings.

**1. Bindings — path writes.** `{state.pressed}` as an element's sole text child lowers to
`data-bind`; an expression in attribute position lowers to a named derive. Binding paths type-check
against the state/query shape and are null-aware: traversing a nullable segment without `?.` is
**error KV227**.

**2. Named derives — the expression layer.** The toggle's `aria-pressed={String(state.pressed)}` and
`data-state={...}` expressions lower to named, exported, pure derives with declared inputs:

```js
export const GalleryToggleDemo$button_aria_pressed_derive = derive(['state'], (state) =>
  String(state.pressed),
);
export const GalleryToggleDemo$button_data_state_derive = derive(['state'], (state) =>
  state.pressed ? 'pressed' : 'off',
);
export const GalleryToggleDemo$output_text_derive = derive(['state'], (state) =>
  state.pressed ? 'pressed' : 'off',
);
```

The declared inputs (`['state']`) tell the loader which changes re-run the derive — no dependency
tracking — and the module loads lazily on the first relevant change.

**3. Template stamps — keyed list reconciliation.** Lists lower to a `data-bind-list` with a
`kovo-key` and a `<template kovo-stamp>`; on change the loader keys existing children against the new
array, cloning/removing/reordering by key.

**Stamps are derived, never hand-written.** `{cart.count}` and `data-bind="cart.count"` are one fact;
you write the expression, the compiler emits the stamp. A hand-written stamp that disagrees with the
expression it wraps is **error KV222**; a redundant hand-written stamp the compiler could derive is
**lint KV223**. Author TSX (`queries`, `key`, typed expressions); the IR carries the residual strings.

Every query- or state-dependent DOM position must have a declared update status — `plan` /
`isomorphic` / `fragment` / `renderOnce`. A position fitting none is **KV311**, and the fix menu is
the ladder: extract a derive, lower to a CSS/attribute toggle, make the component a server-refreshable
fragment target, or mark `isomorphic: true` (lint-gated escape hatch for logic beyond paths/derives/
keyed lists).

## Declare clocks for time-dependent UI

Relative time, countdowns, and expiring badges need a cadence. Do not call `Date.now()` or
`new Date()` inside a derive. Declare a `clocks` input and read it through `now`:

```tsx
import { component } from '@kovojs/core';

export const MessageTime = component({
  queries: { message: messageQuery },
  clocks: { ago: { every: '30s' } },
  render: ({ message, now }) => (
    <time dateTime={message.createdAt}>{formatRelative(now.ago, message.createdAt)}</time>
  ),
});
```

Kovo lowers `now.ago` to the shared browser tick bus and reruns only the derives that declared that
clock input. The server-rendered text is still useful without JavaScript; the clock just keeps it
fresh while the document stays open.

For time-dependent query data, put the cadence on the query binding so Kovo knows when to ask the
server for fresh truth:

```tsx
export const TrialBadge = component({
  queries: {
    trial: trialQuery.refresh({ every: '1m' }),
  },
  render: ({ trial }) => <strong>{trial.daysLeft} days left</strong>,
});

export const AuctionBadge = component({
  queries: {
    auction: auctionQuery.refresh({ at: (auction) => auction.endsAt }),
  },
  render: ({ auction }) => <strong>{auction.status}</strong>,
});

export const QueueBadge = component({
  queries: {
    queue: queueQuery.refresh({ until: (queue) => queue.done }),
  },
  render: ({ queue }) => <strong>{queue.position}</strong>,
});
```

Use `renderOnce(...)` when freezing a clock value for the document lifetime is intentional, such as a
published date that should not tick while the page is open:

```tsx
import { component } from '@kovojs/core';

export const PublishedAt = component({
  queries: { post: postQuery },
  clocks: { published: { renderOnce: true } },
  render: ({ post, now }) => (
    <time dateTime={post.publishedAt}>{renderOnce(formatDate(now.published))}</time>
  ),
});
```

`renderOnce` is an escape hatch, not a freshness tool. If the value should change while the page is
open, declare a clock or query refresh cadence instead.

## Execution triggers: `on:click`, `on:visible`

Interaction is the default trigger. Three declared alternatives extend the same
`on:*` → delegate → `import()` → named-export model, and each is legible in markup:

- **`on:visible`** — one shared IntersectionObserver, fires once on first intersection. Charts, maps,
  carousels, lazy embeds.
- **`on:idle`** — `requestIdleCallback`; warm-up work.
- **`on:load`** — fires at parse. Reintroduces eager JS, so it requires a justification comment
  (**lint KV211**) — `grep 'on:load'` is the app's eager-JS budget.

The devtool reference app bootstraps its pan/zoom canvas island on first visibility. The server-
rendered graph is fully usable with the module absent (selection is real `<a href>` navigation); the
island only enhances:

```js
// devtool-pz.client.js — an on:visible bootstrap that owns a widget
export function Devtool$init(_event, ctx) {
  const root = document.querySelector('[data-pz-root]');
  if (!root || root.__pzInit) return; // idempotent — on:visible may re-fire after morph
  root.__pzInit = true;

  const signal = ctx && ctx.signal; // register cleanup on the island's AbortSignal
  const on = (el, ev, fn, opts) =>
    el.addEventListener(ev, fn, signal ? Object.assign({ signal }, opts || {}) : opts);

  on(window, 'resize', fit); // torn down automatically when the island is removed
  // …wheel zoom, drag-to-pan, hover highlight, keyboard a11y…
}
```

```html
<div
  class="canvas"
  data-pz-root
  kovo-c="dataflow-canvas"
  kovo-state="{}"
  on:visible="/c/devtool-pz.client.js#Devtool$init"
></div>
```

The trigger set is closed (`on:media` is CSS's job; timers belong inside handlers). Islands patched
in by a morph — from a mutation response or a deferred stream — are observed like everything else;
a fragment update is a tiny navigation, not a different programming model.

## Cross-island coordination

When one island's change must reach another, prefer them in this order (SPEC §7):

1. **The URL.** A filter writes `?max=500` or is a GET form whose fragment response is the grid, both
   typed against the route's `search` schema. See [routing](/guides/routing/). This is the default —
   it's shareable, bookmarkable, and survives reload.
2. **Typed fire-and-forget events.** Registry-checked `emit('cart:added', {…})`. The payload type may
   **not overlap query data** — if you're sending server facts over an event, you wanted an optimistic
   transform, and that's **lint KV320**.
3. **Shared client state.** Last resort, lint-gated with a required justification comment.

```ts
// preferred: server facts flow through queries + optimism, not events
emit('filter:changed', { max: 500 }); // ✓ UI intent, no query data
emit('cart:updated', { count: 3 }); // ✗ KV320 — count is server truth; use a transform
```

## State inside server-refreshable targets

Fragment morphs preserve browser-owned DOM state: focus, caret/selection, scroll position,
transitions, `<details>` state, and media element state. They do not serialize an island's private
`kovo-state`. If a parent component is an inferred server-refreshable fragment target, its subtree is
re-rendered from declared queries plus stamped props; a nested island's private state would be
re-emitted at the render-time default and clobbered.

The compiler rejects that position as **KV420**: an island declaring local `state` may not render
inside another component's server-refreshable target. Use one of the explicit fixes:

- Lift the value into a declared query so it travels in the server-refreshable channel.
- Mark the child `isomorphic: true` so it self-renders through the client update plan.
- Set `disableServerRefresh: true` on the enclosing component when that component should not be a
  server fragment target.
- Move the stateful island outside the refreshable region.
- Use `renderOnce` only for document-lifetime-immutable local state.

This is why the mutations guide says fragments preserve browser state but not nested island-local
state. The boundary keeps fragment responses fully describable by the server.

## The loader and the 8KB budget

One inline script — capped at **8KB gzip** — is the entire always-loaded path. It does event
delegation (capture phase) for all `on:*` events and triggers, resolves `url#export` and `import()`s
the handler module on first touch, owns each island's `AbortSignal`, runs the update plan on
state/query change, hydrates `<kovo-query>` data, and applies morphs. Nothing else lives in the
always-loaded path; handler and derive modules are fetched lazily, per island, on first interaction.
Enhanced navigation code counts against the same 8KB budget — it is not allowed to grow it without
explicit SPEC evidence.

## Next

- [Components](/guides/components/) — the copy-in headless primitives these islands compose.
- [Routing & navigation](/guides/routing/) — the typed URL channel islands coordinate through.
- [Optimistic updates](/guides/optimistic/) — L3, when an island needs to predict a server write.

<details>
<summary>Spec & diagnostics</summary>

Component anatomy, `state` / `JsonValue`, and the query-vs-local-state split: SPEC §4.1. Handler
lowering and capture channels: SPEC §4.3. The 8KB loader: SPEC §4.4. Execution triggers
(`on:visible`/`on:idle`/`on:load`): SPEC §4.7. The update plan (bindings, derives, stamps): SPEC §4.8.
Update coverage exhaustiveness: SPEC §4.9. The Interaction Ladder and cross-island coordination order:
SPEC §7. Server-refreshable fragment targets and KV420: SPEC §4.5 and §9.1. Server fact in local
state is **KV301**; unserializable closure capture is **KV201**;
hand-written stamp disagreement is **KV222**, redundant stamp is **KV223**; `on:load` without
justification is **KV211**; event payload overlapping query data is **KV320**; an uncovered
query/state-dependent position is **KV311**. Time-dependent rendered positions and derives require
declared `clocks`, query `.refresh({ every | at | until })`, or `renderOnce`: SPEC §4.8 and §4.9;
missing cadence is **KV312**, and raw clock reads in derives are **KV315**.

</details>
