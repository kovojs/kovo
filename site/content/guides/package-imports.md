---
title: Package import surfaces
description: Public import boundaries for headless primitives, styled UI, icons, browser client helpers, and generated runtime modules.
order: 6.85
---

# Package import surfaces

Kovo keeps author-facing package imports narrow. Public package roots and subpaths are recorded in
`public-packages.json`; generated API pages use the same manifest as the import-boundary gate, so the
docs and enforcement stay aligned.

## Browser client boundary

Use `@kovojs/browser` for author-authored browser helpers such as `handler`, `derive`, `tempId`,
`trustedHtml`, and `trustedUrl`.

Use `@kovojs/browser/client` only from an app-owned browser entry file that manually installs the
runtime loader:

```ts
import {
  createBrowserKovoRoot,
  createQueryStore,
  defaultEnhancedFetch,
  installKovoLoader,
} from '@kovojs/browser/client';

const store = createQueryStore();
const root = createBrowserKovoRoot();

installKovoLoader({
  importModule: (specifier) => import(specifier),
  root: document,
  queryStore: store,
  enhancedMutations: { fetch: defaultEnhancedFetch, queryPlans: {}, root, store },
});
```

Do not author imports from `@kovojs/browser/generated`; that subpath is the compiler-emitted runtime
ABI. Do not import `@kovojs/browser/internal/*`; those modules are loader implementation details.

## Headless primitives

`@kovojs/headless-ui` has no public root import. Import primitive behavior from the primitive subpath:

```ts
import { selectTriggerAttributes } from '@kovojs/headless-ui/select';
import { dialogContentAttributes } from '@kovojs/headless-ui/dialog';
```

The package owns ARIA/data attribute builders, render-input types, and primitive event helpers.
Styled components and copied components use these helpers so accessibility behavior is centralized.
See the generated [headless UI API](/api/headless-ui/) for the full subpath list.

## Styled UI components

`@kovojs/ui` keeps component symbols on direct component subpaths:

```tsx
import { Button } from '@kovojs/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@kovojs/ui/dialog';
```

The root `@kovojs/ui` entry intentionally exports no components. Use component subpaths for
versioned package components, or `kovo add <component>` when you want copied source that your app
owns. See [Components & copy-in UI](/guides/components/) and the generated [UI API](/api/ui/).

## Icons

`@kovojs/icons` exposes the shared `IconProps` type at the root and every glyph as its own subpath:

```tsx
import type { IconProps } from '@kovojs/icons';
import { ArrowRight } from '@kovojs/icons/arrow-right';
import { Search } from '@kovojs/icons/search';
```

Per-icon subpaths keep icon imports tree-shakeable and make each glyph's source easy to inspect. The
generated [icons API](/api/icons/) documents the shared props; use the package export list or editor
autocomplete for the glyph catalog.

## create-kovo

`create-kovo` is a public CLI package, not an app import surface:

```sh
create-kovo my-app --dialect sqlite
```

The command refuses to write into non-empty targets, writes a per-project random CSRF secret to the
gitignored `.env`, and generates the selected Postgres or SQLite starter. See the generated
[create-kovo command reference](/api/create-kovo/).

## Next

- [The kovo & vp CLIs](/guides/cli/) - project commands after scaffolding.
- [Streaming](/guides/streaming/) - a browser/client entry that installs the loader.
- [API reference](/api/core/) - generated package reference from public source.
