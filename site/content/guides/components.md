---
title: Components & copy-in UI
description: Use public styled components from @kovojs/ui subpaths, or copy their source into your app when you want to own the styling.
order: 11
---

# Components & copy-in UI

Kovo gives you two supported ways to use styled components, with behavior and styling kept
deliberately separate.

- **`@kovojs/headless-ui`** is a public, versioned package. It ships the behavior: the accessible
  attribute builders (`selectTriggerAttributes`, `dialogContentAttributes`, …), URL helpers, and the
  headless types that describe a component's render inputs (`SelectItem`, `ComboboxItem`, …). You
  install it and import from it like any dependency.
- **`@kovojs/ui`** is the public styled component package. Import direct component subpaths such as
  `@kovojs/ui/button` when you want versioned components. The same source can also be copied into
  your app with `kovo add` when you want to own the component implementation.

This guide covers direct imports, the copy-in flow, typed StyleX overrides, and the public packages
styled components build on.

## Direct component imports

Install the public packages and import each component from its component subpath:

```sh
npm install @kovojs/ui @kovojs/style @kovojs/headless-ui @kovojs/core @kovojs/server
```

```tsx
import { Button } from '@kovojs/ui/button';

export function Toolbar() {
  return <Button variant="primary">Save</Button>;
}
```

Every styled component takes a typed `style` (or `styles`) override prop; the mechanics live in
[Styling → Overrides](/guides/styling/#overrides).

Use this mode when the versioned package behavior and styling are close to what your app needs. The
root `@kovojs/ui` entry is reserved for package-wide helpers; component symbols live on component
subpaths so each symbol has one public home. Styled components use the `@kovojs/style` system token
contract by default, so changing the app theme seed changes their surface, foreground, border, and
state colors without editing each component.

Headless behavior follows the same subpath rule. `@kovojs/headless-ui` has no public root import;
import each primitive's attribute builders from its primitive subpath:

```ts
import { dialogContentAttributes } from '@kovojs/headless-ui/dialog';
import { selectTriggerAttributes } from '@kovojs/headless-ui/select';
```

Icons are also one glyph per subpath, with shared props at the root:

```tsx
import type { IconProps } from '@kovojs/icons';
import { Search } from '@kovojs/icons/search';
```

## Copy-in components

Copy a component when you want to own the component source. The only thing that changes from the
direct-import case is where you import the component from — `./components/ui/button.js` instead of
`@kovojs/ui/button`. It still takes the same typed StyleX override prop (see
[Styling → Overrides](/guides/styling/#overrides)).

A copied component depends only on public, versioned packages:

- **`@kovojs/style`** — typed StyleX objects, property-level merge, tokens, themes, and readable atomic CSS.
- **`@kovojs/headless-ui`** — the `*Attributes` builders and headless render-input types.
- **`@kovojs/core`** — `component()`, the server component constructor.
- **`@kovojs/server/internal/html`** — `escapeHtml` / `escapeAttribute`, used by generated or in-repo components that interpolate text
  into markup.

### The flow

1. Install the public dependencies:

   ```sh
   npm install @kovojs/style @kovojs/headless-ui @kovojs/core @kovojs/server
   ```

2. Copy the component source and any sibling files listed by the registry, such as the shared
   `theme.ts` token adapter used by styled components:

   ```sh
   kovo add button
   ```

3. Import the copied component and pass typed style overrides when needed:

   ```tsx
   /** @jsxImportSource @kovojs/server */
   import * as style from '@kovojs/style';
   import { Button } from './components/ui/button.js';

   const styles = style.create({
     danger: {
       backgroundColor: style.tokens.sys.color.errorContainer,
       color: style.tokens.sys.color.onErrorContainer,
     },
   });

   export function Toolbar() {
     return (
       <Button variant="primary" style={styles.danger}>
         Delete
       </Button>
     );
   }
   ```

The copied source is plain TSX. It uses the `@kovojs/server` JSX runtime
(`/** @jsxImportSource @kovojs/server */` at the top of each file) and renders to attributes the
headless layer defines, so it works in SSR pages, mutation fragments, and deferred streams the same
way your own components do.

### What a styled component looks like

A static component imports `@kovojs/style` and `component()`:

```tsx
/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

export const buttonStyles = style.create({
  root: {
    alignItems: 'center',
    borderRadius: style.tokens.sys.shape.cornerMedium,
    display: 'inline-flex',
    fontSize: 14,
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: style.tokens.sys.color.primary,
    color: style.tokens.sys.color.onPrimary,
  },
  ghost: {
    backgroundColor: 'transparent',
    color: style.tokens.sys.color.onSurface,
  },
});

export interface ButtonProps {
  children?: string;
  style?: style.StyleInput;
  variant?: 'primary' | 'secondary' | 'ghost';
}

export const Button = component({
  render(props: ButtonProps) {
    return (
      <button style={[buttonStyles.root, buttonStyles[props.variant ?? 'primary'], props.style]}>
        {props.children}
      </button>
    );
  },
});
```

A component with real interaction behavior adds the headless attribute builders and (when it
interpolates text) `escapeHtml`. The select trigger, for instance, pulls its ARIA and `data-*`
attributes from `selectTriggerAttributes` in `@kovojs/headless-ui` rather than spelling out the
state machine by hand:

```tsx
/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  selectTriggerAttributes,
  type SelectTriggerAttributeOptions,
} from '@kovojs/headless-ui/select';
import * as style from '@kovojs/style';

const selectStyles = style.create({
  trigger: { alignItems: 'center', display: 'inline-flex', gap: 8 },
});

export interface SelectTriggerProps extends SelectTriggerAttributeOptions {
  label: string;
  styles?: { trigger?: style.StyleInput };
}

export const SelectTrigger = component({
  render(props: SelectTriggerProps) {
    // The builder returns the ARIA + data-* attributes for the trigger's current state.
    const attrs = selectTriggerAttributes({
      id: props.id,
      labelledBy: props.labelledBy,
      listboxId: props.listboxId,
      open: props.open,
      value: props.value,
      items: props.items,
    });

    return (
      <button
        style={[selectStyles.trigger, props.styles?.trigger]}
        id={attrs.id}
        aria-controls={attrs['aria-controls']}
        aria-expanded={attrs['aria-expanded']}
        aria-haspopup={attrs['aria-haspopup']}
        aria-labelledby={attrs['aria-labelledby']}
        data-state={attrs['data-state']}
        data-placeholder={attrs['data-placeholder']}
      >
        {props.label}
      </button>
    );
  },
});
```

You spread the builder's output onto the host element rather than hand-writing the ARIA contract;
the compiler wires the interactive `on:*` handlers and `data-bind` updates onto the same element when
the component is enhanced. (Components that interpolate untrusted text into markup also import
`escapeHtml` from `@kovojs/server/internal/html`.)

Because the behavior lives in `@kovojs/headless-ui`, your copy stays small: it owns markup and
StyleX objects, the public package owns correctness.

> **Server render inputs, not client state.** Kovo's styled components are server components: they
> render once on the server and emit attributes. The `*StateProps` interfaces you'll see on
> interactive components (e.g. `SelectStateProps` with `items`, `listboxId`, `highlightedValue`) are
> the **render inputs** the server needs to emit the right headless attributes — not a client-side
> state machine leaking out. Leave them as-is unless you're changing what the component renders.

### The registry

The package ships a machine-readable manifest, `packages/ui/registry.json`, listing every component:
its source file(s), the symbols it exports, and the exact `@kovojs/style` /
`@kovojs/headless-ui` / `@kovojs/core` / `@kovojs/server` symbols it imports (plus any sibling
components to copy alongside it). This is the data `kovo add <component>` consumes to copy a
component and its dependencies into your app. It is also enforced: a copy-in smoke test typechecks a
representative component against the public packages alone, so a component can never start depending
on a non-public symbol without the build catching it.

## Choosing a mode

Use `@kovojs/ui/<component>` imports when you want package-managed updates. Use `kovo add` when the
component is a starting point and future changes should live in your app.

## Next

- [Styling with StyleX](/guides/styling/) — typed component styles, plain document CSS, and the
  stylesheet contract.
- [Accessibility](/guides/accessibility/) — the behavior `@kovojs/headless-ui` bakes into every
  primitive.
- [Stability & Versioning](/getting-started/stability/) — public package boundaries and import stability.

<details>
<summary>Spec & diagnostics</summary>

Component model and `component()`: SPEC §5. The styled components are emitted as TSX/JSX source and
lowered by the compiler (SPEC §5.2); hand-authored lowered IR is KV235. The public package boundary
for `@kovojs/ui`, `@kovojs/headless-ui`, and `@kovojs/style` is recorded in
`plans/api-export-cleanup.md` and the repo `STABILITY.md`.

</details>
