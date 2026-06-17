---
title: Components & copy-in UI
description: Build behavior on the public @kovojs/headless-ui primitives, and start from the @kovojs/ui starter by copying its source into your app — you own the code.
order: 11
---

# Components & copy-in UI

Kovo gives you two layers for building UI, with behavior and styling kept deliberately separate.

- **`@kovojs/headless-ui`** is a public, versioned package. It ships the behavior: the accessible
  attribute builders (`selectTriggerAttributes`, `dialogContentAttributes`, …), URL helpers, and the
  headless types that describe a component's render inputs (`SelectItem`, `ComboboxItem`, …). You
  install it and import from it like any dependency.
- **`@kovojs/ui`** is the styled component starter. Its components are authored with
  `@kovojs/style` and expose typed `style` / `styles` override objects, but external apps do not
  install it as a versioned dependency. `kovo add` copies the StyleX-authored source into your app so
  you own it from then on.

This guide covers the copy-in flow, typed StyleX overrides, and the public packages copied
components build on.

## Copy-in components

Copy a component when the default styled source is close to what you need. Customize it with typed
StyleX objects instead of string class overrides:

```tsx
import * as style from '@kovojs/style';
import { Button } from './components/ui/button.js';

const toolbarStyles = style.create({
  saveButton: { minWidth: 112 },
});

export function Toolbar() {
  return <Button style={toolbarStyles.saveButton}>Save</Button>;
}
```

A copied component depends only on public, versioned packages:

- **`@kovojs/style`** — typed StyleX objects, property-level merge, tokens, themes, and readable atomic CSS.
- **`@kovojs/headless-ui`** — the `*Attributes` builders and headless render-input types.
- **`@kovojs/core`** — `component()`, the server component constructor.
- **`@kovojs/server`** — `escapeHtml` / `escapeAttribute`, used by components that interpolate text
  into markup.

### The flow

1. Install the public dependencies:

   ```sh
   npm install @kovojs/style @kovojs/headless-ui @kovojs/core @kovojs/server
   ```

2. Copy the component source:

   ```sh
   kovo add button
   ```

3. Import the copied component and pass typed style overrides when needed:

   ```tsx
   /** @jsxImportSource @kovojs/server */
   import * as style from '@kovojs/style';
   import { Button } from './components/ui/button.js';

   const styles = style.create({
     danger: { backgroundColor: 'var(--danger)', color: 'white' },
   });

   export function Toolbar() {
     return <Button variant="primary" style={styles.danger}>Delete</Button>;
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
    borderRadius: 6,
    display: 'inline-flex',
    fontSize: 14,
    justifyContent: 'center',
  },
  primary: { backgroundColor: 'var(--accent)', color: 'var(--on-accent)' },
  ghost: { backgroundColor: 'transparent', color: 'var(--text)' },
});

export interface ButtonProps {
  children?: string;
  style?: style.StyleInput;
  variant?: 'primary' | 'secondary' | 'ghost';
}

export const Button = component({
  render(props: ButtonProps) {
    return (
      <button {...style.attrs(buttonStyles.root, buttonStyles[props.variant ?? 'primary'], props.style)}>
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
import { selectTriggerAttributes } from '@kovojs/headless-ui';
import * as style from '@kovojs/style';
import { escapeHtml } from '@kovojs/server';
```

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

## In-repo apps

The examples and the docs site in this monorepo import `@kovojs/ui` directly via the workspace
(`@kovojs/ui/button`, etc.). That workspace import is a repo convenience; external apps use the
copied TSX source produced by `kovo add`.

## Next

- [Styling with StyleX](/guides/styling/) — typed component styles, plain document CSS, and the
  stylesheet contract.
- [Accessibility](/guides/accessibility/) — the behavior `@kovojs/headless-ui` bakes into every
  primitive.

<details>
<summary>Spec & diagnostics</summary>

Component model and `component()`: SPEC §5. The styled components are emitted as TSX/JSX source and
lowered by the compiler (SPEC §5.2); hand-authored lowered IR is KV235. The public/private package
boundary that makes `@kovojs/headless-ui` a dependency and `@kovojs/ui` a copy-in starter is recorded
in `plans/api-cleanup.md` Phase 7 and the repo `STABILITY.md`.

</details>
