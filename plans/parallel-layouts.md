# Parallel Layout Regions

## Goal

Add a public framework primitive for route pages with parallel/sibling layout regions, then migrate
the docs site off hand-authored navigation segment stamps and internal compiled-route metadata.

The immediate bug is architectural: the docs site currently models its shell with internal
`kovo-nav-segment` attributes in app TSX and `defineCompiledRoutePage()` metadata in
`site/src/app.tsx`. `SPEC.md` §8 says segment persistence is compiler-derived and app TSX never
authors navigation segment stamps. This plan closes that API gap instead of normalizing the escape
hatch.

## Current State

- Docs routes render a sibling shell: page content + right TOC in one region, left docs sidebar in a
  separate rail.
- Enhanced navigation needs route-boundary metadata so it can morph changed page content while
  preserving compatible layout regions.
- The public route/layout API does not currently expose a way to declare that sibling-region shape.
- The docs site works around this by hand-stamping `kovo-nav-segment`, `kovo-nav-kind`, and
  `kovo-nav-name` in `site/src/components/docs-layout.tsx`.
- The docs site also calls internal `defineCompiledRoutePage()` from `site/src/app.tsx` to feed the
  request shell route metadata that the compiler would normally own.

## Desired API Shape

The final API must let app code express region intent at the route/layout boundary without naming
runtime marker attributes. Route-level regions are the required public model; JSX marker components
are not an acceptable fallback because they would make persistence policy feel like local markup
rather than part of the route shell contract.

Possible end state:

```tsx
const DocsLayout = layout({
  render: (_queries, _state, { regions }) => (
    <DocsShell page={regions.page} sidebar={regions.sidebar} />
  ),
});

route('/guides/:slug', {
  layout: DocsLayout,
  regions: {
    page: () => <GuidePage />,
    sidebar: () => <DocsSidebar />,
  },
});
```

No fallback JSX region-marker API is allowed. If route-level regions are too large for one slice,
split the implementation into compiler/server/runtime phases, but keep the public API direction
route-level throughout.

## Constraints

- Follow `SPEC.md` §8: full server documents remain canonical; enhanced navigation is progressive
  enhancement over real URLs.
- Do not introduce navigation partial responses.
- Do not let app code author raw persistence policy or runtime marker attributes.
- Do not introduce public JSX region marker components as a substitute for route-level regions.
- Keep the fallback behavior conservative: missing region proof falls back to full navigation.
- Preserve no-JS/full-load and enhanced-navigation render equivalence.
- Keep inline loader budget movement explicit if runtime logic grows.

## Implementation Plan

- [ ] Define the public route-level parallel-region API and update `SPEC.md` §8.
  - Evidence needed: SPEC text describes the app-facing primitive, states that runtime stamps remain
    compiler-owned, and defines how route/page/layout regions degrade to full navigation when
    compatibility is unproven.

- [ ] Add compiler metadata for named route/layout regions.
  - Evidence needed: compiler tests prove app-authored region declarations lower to
    `CompiledRouteNavigationSegment` metadata, including stable region ids, kind/name fields, and
    component/query dependencies where present.

- [ ] Teach the server route shell to stamp derived region metadata.
  - Evidence needed: server route JSX tests show public region declarations render internal
    `kovo-nav-segment`, `kovo-nav-kind`, and `kovo-nav-name` attributes without app-authored marker
    attributes in source.

- [ ] Reject app-authored navigation marker attributes in app TSX.
  - Evidence needed: compiler/source-sink diagnostic tests reject `kovo-nav-segment`,
    `kovo-nav-kind`, `kovo-nav-name`, `kovo-nav-queries`, and `kovo-nav-components` outside generated
    output, with a teaching message pointing to the public region API.

- [ ] Update enhanced-navigation segment reconciliation for parallel regions.
  - Evidence needed: browser/runtime tests cover sibling regions where the page region changes, a
    layout region is compatible and preserved, and a route-dependent region changes and is morphed
    rather than patched by site-specific client code.

- [ ] Migrate the docs site to the public region API.
  - Evidence needed: `site/src/components/docs-layout.tsx` no longer contains hand-authored
    `kovo-nav-*` attributes; `site/src/app.tsx` no longer imports or calls
    `defineCompiledRoutePage()`; docs enhanced navigation still keeps the left rail stable and
    updates current page/section correctly.

- [ ] Remove docs-site sidebar navigation sync that only compensates for preserved stale markup.
  - Evidence needed: `site/src/client/sidebar.js` is removed or narrowed to scroll-only behavior;
    active/current sidebar state comes from the server-rendered target document through framework
    morphing.

- [ ] Verify static export and browser navigation with the docs site as the proving app.
  - Evidence needed: `pnpm --filter @kovojs/site run build`; focused Playwright navigation probe
    across `/guides/` pages shows enhanced navigation, no full reload, no FOUC, and current sidebar
    section/page visible.

- [ ] Run focused framework gates and update public docs.
  - Evidence needed: relevant compiler/server/browser tests pass; docs explain the public region API
    without exposing internal marker attributes.

## Open Design Questions

- What exact route-level `regions` shape gives layout render functions typed access to named region
  output without creating a client-router mental model?
- Are route regions allowed to be independently guarded/query-dependent, or must they share the
  route's request shell for v1?
- Does a route-dependent sidebar count as a page region, a layout region with dependencies, or a
  named route region that can be morphed independently?
- Should region names be globally stable per layout, or scoped to the declaring route/layout?
- Can this fully replace the docs sidebar client sync, or do we still need a small scroll-into-view
  behavior after framework-owned morphing?

## Latest Verification

None yet. This is a new active implementation ledger.
