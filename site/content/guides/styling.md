---
title: Styling with Tailwind
description: Keep Tailwind classes statically discoverable so pages, mutation fragments, and streamed content all arrive styled.
order: 4
---

# Styling with Tailwind

You style a Jiso app with Tailwind, the way you'd style any Tailwind app — with one rule that earns
its keep here: every class that can appear in served HTML has to be statically discoverable at build
time. The reason is that Jiso produces HTML in places your browser build never runs: SSR pages,
mutation fragments, and deferred streams. This guide shows how to keep classes discoverable, and how
every render path declares the stylesheets it needs so nothing arrives unstyled.

## Set up Tailwind

The starter wires Tailwind through Vite+ and declares its sources in `src/styles.css`:

```css
@import 'tailwindcss';

@source "../index.html";
@source "./**/*.{ts,tsx,html}";
@source inline("bg-emerald-50 text-emerald-700 border-emerald-200 bg-amber-50 text-amber-700 border-amber-200");

@theme {
  --color-jiso-ink: #17202a;
  --color-jiso-accent: #0f8b8d;
}
```

- `@source` rules cover your templates and HTML so Tailwind sees every literal class.
- `@source inline("…")` is the explicit safelist for classes that can't be discovered statically
  (Tailwind v4.1+).
- Design tokens are plain CSS custom properties under `@theme`. Theming stays document CSS, because
  there's no shadow boundary to tunnel through.

## Why discoverability matters here

In an SPA, a missing utility class shows up the first time a component renders client-side, in
development. In Jiso, HTML is produced three ways that never execute in your browser build:

1. **SSR pages** — the full-page render.
2. **Mutation fragments** — `<fw-fragment>` chunks the server sends after a write.
3. **Deferred streams** — `<fw-defer>` content that streams in after the shell.

All three reference the same generated stylesheet. If a class only ever appears in a fragment the
server renders after a mutation — an error state, say — and Tailwind never saw it, the fragment
arrives unstyled in production with no build error. So the rule is to keep classes visible to the
scan.

**Keep utility classes as literal strings in your JSX.**

```tsx
function ProductCard({ item }: { item: { id: string; stock: number } }) {
  return (
    <article fw-key={item.id} class="rounded border border-slate-200 bg-white p-4">
      <h2 class="font-semibold">{item.id}</h2>
      <p>{item.stock} in stock</p>
    </article>
  );
}
```

**Don't compute class names.** This class never appears in any source Tailwind scans:

```tsx
// ✗ undiscoverable — produces "text-red-700" only at runtime
const tone = severity === 'error' ? 'red' : 'amber';
return <output class={`text-${tone}-700`}>…</output>;
```

Write the full literals and pick between them:

```tsx
// ✓ both classes are statically visible
const toneClass = severity === 'error' ? 'text-red-700' : 'text-amber-700';
return <output class={toneClass}>…</output>;
```

**Safelist what you genuinely can't make literal.** When a fragment must emit a class that no
scanned source contains — classes assembled from data, or emitted by a helper outside `@source`
coverage — declare it once in the safelist:

```css
@source inline("bg-emerald-50 text-emerald-700 bg-amber-50 text-amber-700");
```

The safelist is greppable, reviewed, and lives next to the `@theme` tokens.

This fits how Jiso binds dynamic state in the first place: prefer a `data-state` attribute or a
`[hidden]` toggle driven by a derive, and style states with CSS selectors, instead of swapping class
strings at runtime. The update-plan grammar pushes you toward this anyway.

## Declare stylesheets for pages

Jiso owns the framework CSS contract. An emitted page lists its required stylesheet assets once, and
the same hints serve full-page renders, mutation fragments, and deferred fragments. The commerce app
declares its stylesheets as part of its page hints:

```ts
import { renderPageHints } from '@jiso/server';

export const commerceStylesheets = ['/assets/tailwind.css'] as const;

const hints = renderPageHints(
  { meta: commerceMeta, stylesheets: commerceStylesheets },
  { queries: { cart } },
);
// hints.html       → <link rel="stylesheet" …> + meta + modulepreloads, for <head>
// hints.earlyHints → the same assets shaped for 103 Early Hints
```

Each stylesheet entry can carry `preload` and `criticalCss`, and the hint renderer dedupes assets in
page order.

## Declare stylesheets for fragments and streams

A mutation fragment can patch into a long-lived document that predates the fragment's styles — or,
with code-split CSS, into a page that never loaded them. So fragment renderers declare their
stylesheets, and the response carries the links with the fragment:

```ts
return renderMutationEndpointResponse(addToCart, {
  fragmentRenderers: [
    {
      target: 'cart-badge',
      render: () => CartBadge.definition.render(),
      stylesheets: commerceStylesheets,
    },
  ],
  // …
});
```

Deferred chunks do the same — this is the commerce app's streamed product grid:

```ts
import { renderDeferredStream } from '@jiso/server';

renderDeferredStream({
  shell:
    '<!doctype html><html><body><main><fw-defer target="product-grid" state="pending"></fw-defer>',
  chunks: [
    {
      queries: [{ name: 'productGrid', value: productGrid }],
      fragments: [
        {
          target: 'product-grid',
          html: renderProductGrid(productGrid),
          stylesheets: commerceStylesheets,
        },
      ],
    },
  ],
  closeHtml: '</main></body></html>',
});
```

The streamed chunk arrives as a fragment whose first child is its stylesheet link:

```html
<fw-fragment target="product-grid"
  ><link rel="stylesheet" href="/assets/tailwind.css" />
  <section fw-c="product-grid" fw-deps="product">…</section>
</fw-fragment>
```

Stylesheet assets are deduped by `href` within each response, in page order, and a re-referenced
stylesheet resolves from the browser's HTTP cache — so a late fragment never flashes unstyled. When
fragment targets map to split stylesheets, `stylesheetsForTargets(manifest, targets)` selects
exactly the assets a fragment response needs from a build manifest whose entries carry
`fragmentTargets` metadata.

## Co-located component CSS

For component CSS that isn't Tailwind, the compiler extracts co-located rules, wraps them in
`@scope` keyed to the component's host (the dashed tag or the `[fw-c=…]` stamp), donut-scopes nested
islands out, emits a tag-prefixed fallback for older engines, and dedupes assets in page order —
preserving fragment-target metadata so late fragments can request their styles. Scoping comes from
the compiler rather than shadow DOM, because shadow boundaries break IDREF wiring, form
participation, and ARIA.

Practical summary:

- App styling: Tailwind utilities, statically discoverable, safelist via `@source inline`.
- Design tokens: CSS custom properties in `@theme`; theming is document CSS.
- Component packages: compiler-scoped co-located CSS.
- Every render path — page, fragment, deferred chunk — declares its stylesheets; the framework
  dedupes and delivers.

## Next

- [Streaming & defer](/guides/streaming/) — the deferred streams these hints serve.
- [Mutations & forms](/guides/mutations/) — fragment responses end to end.

<details>
<summary>Spec & diagnostics</summary>

Static discoverability, the stylesheet contract across render paths, dedup, and compiler-scoped
co-located CSS: SPEC §13.1. The data-attribute / `[hidden]` binding posture and the update-plan
grammar: SPEC §4.8. Why shadow DOM was rejected: SPEC §3.1.

</details>
