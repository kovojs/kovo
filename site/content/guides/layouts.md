---
title: Layouts
description: Declare nested route chrome with layout queries, guards, stylesheets, and explainable boundaries.
order: 0.6
---

# Layouts

Layouts are first-class route chrome. They are not a filesystem convention and they are not a client
router feature. A layout is a declared value that composes around a page's `children`, and routes opt
into it explicitly.

## Declare a layout

```tsx
export const AppShell = layout({
  render: (_queries, _state, { children }) => (
    <main class="app-shell">
      <Sidebar />
      <section>{children}</section>
    </main>
  ),
});

export const dealsRoute = route('/deals', {
  layout: AppShell,
  page: () => <DealsPage />,
});
```

The route still renders a full document. The layout is page chrome inside that document; the request
shell owns the outer document template, loader, query scripts, and error shells.

## Nest layouts with `parent`

Use `parent` when a route segment adds chrome inside a broader shell:

```tsx
export const AccountLayout = layout({
  parent: AppShell,
  guard: guards.authed(),
  queries: { viewer: viewerQuery },
  render: ({ viewer }, _state, { children }) => (
    <section>
      <h1>{viewer.name}</h1>
      {children}
    </section>
  ),
});

export const settingsRoute = route('/account/settings', {
  layout: AccountLayout,
  page: () => <SettingsPage />,
});
```

Layouts may declare `queries`, `guard`, stylesheets, and per-segment boundaries. Guards refine the
request before the layout renders, just like route and mutation guards. Layout queries are normal
queries: they appear in `kovo explain page`, carry update plans, and observe the same cache and guard
rules as page queries.

## No persistent layout state

In v1, every navigation is still a full document GET. Enhanced navigation may preserve unchanged
compiler-stamped layout segments as an optimization, but app authors do not author persistence
policy and should not put route-lifetime assumptions in layout-local state. If chrome state must
survive reloads and links, put it in the URL or in server query truth. If it is purely local, treat it
like any other island state and keep server-refreshable boundaries in mind; a stateful island inside
a refreshable target is **KV420**.

## Explain the resolved chain

Use the layouts mode when a route's chrome gets hard to reason about:

```sh
kovo explain page /account/settings --layouts graph.json
```

The output lists the resolved layout chain, guards, queries, boundaries, stylesheets, and the route
leaf. That makes changes to shared chrome reviewable in CI instead of discovered by clicking around.

## Next

- [Routing & navigation](/guides/routing/) — typed routes, links, guards, and navigation.
- [Request shell](/guides/request-shell/) — the document assembly layer around layouts.
- [Interactive islands](/guides/islands/) — local state and refreshable boundaries.

<details>
<summary>Spec & diagnostics</summary>

First-class layouts, nesting with `parent`, layout `queries`, `guard`, boundaries, stylesheets, and
`kovo explain page --layouts`: SPEC §4.5 and §6.4. Documents are owned by the request shell:
SPEC §9.5. Navigation is full-document first; layout persistence is not an app-authored v1 contract:
SPEC §8. KV420 stateful-island boundary: SPEC §4.5 and §9.1.

</details>
