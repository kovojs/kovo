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

## Render segment failures

Use `boundaries` when a route segment needs its own 404, 403, or error body instead of the app-level
shell:

```tsx
const AccountLayout = layout({
  boundaries: {
    unauthorized: ({ status }) => <AccountDenied status={status} />,
  },
  render: (_queries, _state, { children }) => <AccountShell>{children}</AccountShell>,
});

export const invoiceRoute = route('/account/invoices/:id', {
  layout: AccountLayout,
  boundaries: {
    notFound: ({ request }) => <MissingInvoice user={request.session.user.id} />,
    error: ({ error }) => <InvoiceError error={error} />,
  },
  page: ({ params }) => <InvoicePage id={params.id} />,
});
```

Resolution is nearest-first: the route boundary wins, then the route's layout, then each parent
layout, then the app shell. Boundary renderers receive `{ error, request, status }`; `error` is only
present for the `error` boundary.

## Add parallel regions

Use route-level `regions` when a layout needs sibling areas such as a docs page plus a sidebar rail.
The layout decides placement; the route decides what each named region renders.

```tsx
const DocsLayout = layout({
  render: (_queries, _state, { regions }) => (
    <DocsShell page={regions.page} sidebar={regions.sidebar} />
  ),
});

export const guideRoute = route('/guides/:slug', {
  layout: DocsLayout,
  regions: {
    page: ({ params }) => <GuidePage slug={params.slug} />,
    sidebar: ({ params }) => <DocsSidebar activeSlug={params.slug} />,
  },
});
```

`regions.page` is the route leaf region. Additional names are scoped to that route/layout contract.
The framework renders every region from the target full document and owns any navigation metadata it
needs for enhanced navigation, so app TSX stays ordinary JSX.

## No persistent layout state

In v1, every navigation is still a full document GET. Enhanced navigation may preserve unchanged
compiler-stamped layout segments as an optimization, but app authors do not author persistence
policy and should not put route-lifetime assumptions in layout-local state. If chrome state must
survive reloads and links, put it in the URL or in server query truth. If it is purely local, treat it
like any other island state and keep server-refreshable boundaries in mind; a stateful island inside
a refreshable target is rejected by the boundary checker.

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

First-class layouts, route-level regions, nesting with `parent`, layout `queries`, `guard`,
boundaries, stylesheets, and `kovo explain page --layouts`: SPEC §4.5 and §6.4. Documents are owned
by the request shell: SPEC §9.5. Navigation is full-document first; layout persistence is not an
app-authored v1 contract: SPEC §8. KV420 stateful-island boundary: SPEC §4.5 and §9.1.

</details>
