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

## Seed themes

Use `defineTheme` when an app wants one seed color to drive the UI token system. The generated theme
returns concrete light/dark values plus deterministic CSS custom properties:

```ts
import { defineTheme } from '@kovojs/style';

export const theme = defineTheme({
  seed: '#6750A4',
  colors: {
    success: '#16a34a',
    warning: '#f59e0b',
  },
  shape: {
    cornerMedium: '0.625rem',
  },
});

export const themeCss = theme.css;
```

The CSS defines Material reference palette variables such as
`--kovo-theme-ref-palette-primary-40`, system role variables such as
`--kovo-theme-sys-color-primary`, and dark overrides under `:root[data-theme="dark"]`. Apps can
select a theme by setting document attributes or classes; Kovo does not add a runtime theme store.

When a theme needs precise overrides, compose from the generated base rather than using callbacks:

```ts
import { defineTheme } from '@kovojs/style';

const base = defineTheme({ seed: '#6750A4' });

export const theme = defineTheme({
  base,
  sys: {
    color: {
      outline: base.sys.color.primary,
    },
  },
  shape: {
    cornerSmall: '2px',
  },
});
```

## Component styles

Import the style package as `style`, define style groups near the component, and compose them through
the `style={...}` JSX prop:

```tsx
/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { tokens } from '@kovojs/style';
import * as style from '@kovojs/style';

const cardStyles = style.create({
  root: {
    backgroundColor: tokens.sys.color.surface,
    borderColor: tokens.sys.color.outlineVariant,
    borderStyle: 'solid',
    borderWidth: 1,
    color: tokens.sys.color.onSurface,
    padding: 16,
  },
  lowStock: {
    borderColor: tokens.customColor('warning').color,
    color: tokens.customColor('warning').color,
  },
});

export const ProductCard = component({
  render({ item }: { item: { id: string; stock: number } }) {
    return (
      <article kovo-key={item.id} style={[cardStyles.root, item.stock < 3 && cardStyles.lowStock]}>
        <h2>{item.id}</h2>
        <p>{item.stock} in stock</p>
      </article>
    );
  },
});
```

Two token families appear here. `tokens.sys.*` are the Material *system roles* every theme defines —
`surface`, `onSurface`, `outlineVariant`, `primary`, and so on — derived from the seed so a theme
change re-skins them everywhere. `tokens.customColor('warning')` reads one of the *named extra colors*
you declared under `defineTheme({ colors: { warning } })`; it returns a group (`.color`, `.onColor`,
`.colorContainer`, …) for palette entries that aren't part of the system role set. Reach for `sys.*` for
ordinary surfaces and text, and `customColor(name)` for app-specific accents like a low-stock warning.

Style objects can be selected with normal TypeScript conditionals. The compiler sees every referenced
object and compiler-known token, extracts the CSS at build time, and routes state/query-driven style
toggles through the same attribute update plan as other Kovo bindings. That means late mutation
fragments and deferred chunks can only reference classes already present in the app stylesheet.

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
declares its stylesheet on the route:

```tsx
import { route } from '@kovojs/server';

export const siteStylesheets = ['/assets/site.css'] as const;

export const cartPage = route('/cart', {
  meta: siteMeta,
  page: () => <CartPage />,
  stylesheets: siteStylesheets,
});
```

Each stylesheet entry can carry `preload` and `criticalCss`, and the app shell dedupes assets in page
order.

## Declare stylesheets for fragments and streams

A mutation fragment can patch into a long-lived document that predates the fragment's styles or, with
split CSS, into a page that never loaded them. Declare stylesheets on the route/component metadata
that owns the generated live target; ordinary enhanced success fragments carry those assets from the
generated renderer. Failure-only policies can provide `failureStylesheets` for submitted-form
rerenders:

```ts
export const cartPage = route('/cart', {
  stylesheets: siteStylesheets,
  page: () => <CartPage />,
});

export const addToCart = mutation('cart/add', {
  failureStylesheets: siteStylesheets,
  input: addToCartInput,
  handler(input, request) {
    return request.db.cart.add(input);
  },
});
```

Deferred chunks do the same through the component and route metadata that own the late-rendered
region:

```tsx
import { component } from '@kovojs/core';
import { route } from '@kovojs/server';

export const ProductGrid = component({
  queries: { productGrid },
  render: ({ productGrid }) => <section>{productGrid.items.map(renderProduct)}</section>,
});

export const cartPage = route('/cart', {
  page: () => <ProductGrid />,
  stylesheets: siteStylesheets,
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

- Component styling: typed `@kovojs/style` objects and theme tokens compiled to readable atomic CSS.
- Document styling: plain CSS for resets, fonts, page chrome, and generated CSS custom-property
  themes.
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
