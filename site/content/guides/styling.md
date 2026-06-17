---
title: Styling with StyleX
description: Use typed StyleX objects for component styling, plain document CSS for page chrome, and one stylesheet contract for pages, fragments, and streams.
order: 4
---

# Styling with StyleX

Kovo's default component styling path is `@kovojs/style`, the Kovo-owned StyleX fork. Components
author typed style objects in TSX, the compiler extracts deterministic atomic CSS, and rendered HTML
keeps readable `kv-*` classes plus `data-style-src` provenance for `kovo explain`.

Use plain document CSS for global page chrome, resets, fonts, and document-level theme tokens.
Because Kovo renders light DOM, tokens are ordinary CSS custom properties and theming does not cross
shadow boundaries.

## Component styles

Import the style package as `style`, define style groups near the component, and compose them through
`style.attrs(...)` or the compiler-lowered `style={[...]}` JSX prop:

```tsx
/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const cardStyles = style.create({
  root: {
    backgroundColor: 'var(--surface)',
    borderColor: 'var(--edge)',
    borderStyle: 'solid',
    borderWidth: 1,
    padding: 16,
  },
  lowStock: {
    borderColor: 'var(--warning)',
    color: 'var(--warning)',
  },
});

export const ProductCard = component({
  render({ item }: { item: { id: string; stock: number } }) {
    return (
      <article kovo-key={item.id} {...style.attrs(cardStyles.root, item.stock < 3 && cardStyles.lowStock)}>
        <h2>{item.id}</h2>
        <p>{item.stock} in stock</p>
      </article>
    );
  },
});
```

Style objects can be selected with normal TypeScript conditionals. The compiler sees every referenced
object, extracts the CSS at build time, and routes state/query-driven style toggles through the same
attribute update plan as other Kovo bindings. That means late mutation fragments and deferred chunks
can only reference classes already present in the app stylesheet.

## Overrides

Public styled components expose typed `style` or `styles` override props. Put overrides last so the
caller wins by StyleX's property-level merge order:

```tsx
import * as style from '@kovojs/style';
import { Button } from '@kovojs/ui/button';

const toolbarStyles = style.create({
  saveButton: { minWidth: 112 },
});

export function Toolbar() {
  return <Button style={toolbarStyles.saveButton}>Save</Button>;
}
```

Use document CSS for page layout classes such as `.site-bar` or `.docs-shell`; use StyleX for
component-local styles and component override surfaces.

## Declare stylesheets for pages

Kovo owns the framework CSS contract. An emitted page lists its required stylesheet assets once, and
the same hints serve full-page renders, mutation fragments, and deferred fragments. The docs site
declares its stylesheet as part of its page hints:

```ts
import { renderPageHints } from '@kovojs/server';

export const siteStylesheets = ['/assets/site.css'] as const;

const hints = renderPageHints(
  { meta: siteMeta, stylesheets: siteStylesheets },
  { queries: { cart } },
);
// hints.html       -> <link rel="stylesheet" ...> + meta + modulepreloads, for <head>
// hints.earlyHints -> the same assets shaped for 103 Early Hints
```

Each stylesheet entry can carry `preload` and `criticalCss`, and the hint renderer dedupes assets in
page order.

## Declare stylesheets for fragments and streams

A mutation fragment can patch into a long-lived document that predates the fragment's styles or, with
split CSS, into a page that never loaded them. Fragment renderers declare their stylesheets, and the
response carries the links with the fragment:

```ts
return renderMutationEndpointResponse(addToCart, {
  fragmentRenderers: [
    {
      target: 'cart-badge',
      render: () => CartBadge.definition.render(),
      stylesheets: siteStylesheets,
    },
  ],
  // ...
});
```

Deferred chunks do the same:

```ts
import { renderDeferredStream } from '@kovojs/server';

renderDeferredStream({
  shell:
    '<!doctype html><html><body><main><kovo-defer target="product-grid" state="pending"></kovo-defer>',
  chunks: [
    {
      queries: [{ name: 'productGrid', value: productGrid }],
      fragments: [
        {
          target: 'product-grid',
          html: renderProductGrid(productGrid),
          stylesheets: siteStylesheets,
        },
      ],
    },
  ],
  closeHtml: '</main></body></html>',
});
```

The streamed chunk arrives as a fragment whose first child is its stylesheet link:

```html
<kovo-fragment target="product-grid"
  ><link rel="stylesheet" href="/assets/site.css" />
  <section kovo-c="product-grid" kovo-deps="product">...</section>
</kovo-fragment>
```

Stylesheet assets are deduped by `href` within each response, in page order, and a re-referenced
stylesheet resolves from the browser's HTTP cache. When fragment targets map to split stylesheets,
`stylesheetsForTargets(manifest, targets)` selects exactly the assets a fragment response needs from
a build manifest whose entries carry `fragmentTargets` metadata.

## Co-located raw CSS

Prefer StyleX for component styles. Raw co-located CSS remains an escape hatch for rules that need
plain CSS syntax; the compiler can scope those rules to the component host and preserve
fragment-target metadata so late fragments can request their styles. Scoping comes from the compiler
rather than shadow DOM, because shadow boundaries break IDREF wiring, form participation, and ARIA.

Practical summary:

- Component styling: typed `@kovojs/style` objects compiled to readable atomic CSS.
- Document styling: plain CSS for resets, fonts, page chrome, and CSS custom-property themes.
- Every render path — page, fragment, deferred chunk — declares its stylesheets; the framework
  dedupes and delivers.

## Next

- [Components & copy-in UI](/guides/components/) — styled `@kovojs/ui` components and their typed override surfaces.
- [Streaming & defer](/guides/streaming/) — the deferred streams these hints serve.
- [Mutations & forms](/guides/mutations/) — fragment responses end to end.

<details>
<summary>Spec & diagnostics</summary>

Style scoping, tokens, stylesheet hints, and late fragment delivery: SPEC §13.1. The
data-attribute / `[hidden]` binding posture and the update-plan grammar: SPEC §4.8. Why shadow DOM
was rejected: SPEC §3.1.

</details>
