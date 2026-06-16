---
title: Components & copy-in UI
description: Build behavior on the public @kovojs/headless-ui primitives, and start from the @kovojs/ui starter by copying its source into your app — you own the code.
order: 11
---

# Components & copy-in UI

Kovo gives you two layers for building UI, and they sit on opposite sides of the public API line.

- **`@kovojs/headless-ui`** is a public, versioned package. It ships the behavior: the accessible
  attribute builders (`selectTriggerAttributes`, `dialogContentAttributes`, …), the small styling
  helpers (`cn`, `defineVariants`, `safeUrl`, the `ClassValue` type), and the headless types that
  describe a component's render inputs (`SelectItem`, `ComboboxItem`, …). You install it and import
  from it like any dependency.
- **`@kovojs/ui`** is a styled starter — a set of Tailwind-styled server components built on top of
  `@kovojs/headless-ui`. It is **private**: you do not install it. Instead you copy the component
  source you want into your own app and own it from then on (shadcn-style).

This guide covers the copy-in flow and how a copied component stays self-contained.

## Copy-in components (`@kovojs/ui`)

`@kovojs/ui` is a starter, not a dependency. The package is `private: true` and is never published,
so there is nothing to `npm install`. To use a styled component, you copy its `.tsx` source into
your app — conventionally under `src/components/ui/` — and edit it freely. This is the same model as
shadcn/ui: **you own the code.** When you need the button to look different, you change your copy;
there is no upstream version to fight.

A copied component depends only on the **public, versioned** packages it imports:

- **`@kovojs/headless-ui`** — the behavior and styling helpers (`cn`, `defineVariants`, the
  `*Attributes` builders, headless render-input types). This is the real dependency the copied code
  pulls in.
- **`@kovojs/core`** — `component()`, the server component constructor.
- **`@kovojs/server`** — `escapeHtml` / `escapeAttribute`, used by components that interpolate text
  into markup.

A copied component never imports `@kovojs/ui` itself. That is the whole point: once the source is in
your repo, it stands on the public packages alone.

### The flow

1. Install the public dependencies your copied components will import:

   ```sh
   npm install @kovojs/headless-ui @kovojs/core @kovojs/server
   ```

2. Copy the component source into your app. For example, the button:

   ```sh
   mkdir -p src/components/ui
   cp node_modules/.../button.tsx src/components/ui/button.tsx
   # or paste the source from the Gallery / repository
   ```

3. Import it from your own tree and use it like any server component:

   ```tsx
   /** @jsxImportSource @kovojs/server */
   import { Button } from '@/components/ui/button';

   export function Toolbar() {
     return <Button variant="primary">Save</Button>;
   }
   ```

The copied source is plain TSX. It uses the `@kovojs/server` JSX runtime
(`/** @jsxImportSource @kovojs/server */` at the top of each file) and renders to attributes the
headless layer defines, so it works in SSR pages, mutation fragments, and deferred streams the same
way your own components do.

### What a copied component looks like

A static component imports only the styling helpers and `component()`:

```tsx
/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { cn, defineVariants, type ClassValue } from '@kovojs/headless-ui';

export interface ButtonProps {
  children?: string;
  class?: ClassValue;
  variant?: 'primary' | 'secondary' | 'ghost';
}

export const Button = component({
  render(props: ButtonProps) {
    return (
      <button class={cn(buttonClassNames({ variant: props.variant }), props.class)}>
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
import { cn, selectTriggerAttributes, type ClassValue } from '@kovojs/headless-ui';
import { escapeHtml } from '@kovojs/server';
```

Because the behavior lives in `@kovojs/headless-ui`, your copy stays small: it owns markup and
classes, the public package owns correctness.

> **Server render inputs, not client state.** Kovo's styled components are server components: they
> render once on the server and emit attributes. The `*StateProps` interfaces you'll see on
> interactive components (e.g. `SelectStateProps` with `items`, `listboxId`, `highlightedValue`) are
> the **render inputs** the server needs to emit the right headless attributes — not a client-side
> state machine leaking out. Leave them as-is unless you're changing what the component renders.

### The registry

The starter ships a machine-readable manifest, `packages/ui/registry.json`, listing every component:
its source file(s), the symbols it exports, and the exact `@kovojs/headless-ui` / `@kovojs/core` /
`@kovojs/server` symbols it imports (plus any sibling components to copy alongside it). This is the
data a future `kovo add <component>` would consume to copy a component and its dependencies into your
app. It is also enforced: a copy-in smoke test typechecks a representative component against the
public packages alone, so a component can never start depending on a non-public symbol without the
build catching it.

## In-repo apps

The examples and the docs site in this monorepo don't copy components — they import `@kovojs/ui`
directly via the workspace (`@kovojs/ui/button`, etc.) as a convenience, the same way they import any
workspace package. That path exists only inside the repo. External apps always use the copy-in flow
above; `@kovojs/ui` is never a versioned dependency you install.

## Next

- [Styling with Tailwind](/guides/styling/) — keep the classes your copied components emit
  statically discoverable.
- [Accessibility](/guides/accessibility/) — the behavior `@kovojs/headless-ui` bakes into every
  primitive.

<details>
<summary>Spec & diagnostics</summary>

Component model and `component()`: SPEC §5. The styled components are emitted as TSX/JSX source and
lowered by the compiler (SPEC §5.2); hand-authored lowered IR is KV235. The public/private package
boundary that makes `@kovojs/headless-ui` a dependency and `@kovojs/ui` a copy-in starter is recorded
in `plans/api-cleanup.md` Phase 7 and the repo `STABILITY.md`.

</details>
