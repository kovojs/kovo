# @kovojs/icons

The [Lucide](https://lucide.dev) icon set as native Kovo SVG components — the
`lucide-react` equivalent for Kovo. One tree-shakeable component per icon, each
on its own import subpath.

```tsx
/** @jsxImportSource @kovojs/server */
import { ArrowRight } from '@kovojs/icons/arrow-right';
import { Search } from '@kovojs/icons/search';
import * as style from '@kovojs/style';

const styles = style.create({
  small: { width: 16, height: 16 },
  muted: { color: '#6b7280' },
});

// Decorative by default (aria-hidden):
<ArrowRight />

// Sized + tinted via the StyleX `style` channel (color flows through currentColor):
<Search style={[styles.small, styles.muted]} />

// Meaningful icon — `aria-label` promotes it to role="img":
<Search aria-label="Search" />
```

## API

Every icon accepts [`IconProps`](./src/icon-base.ts):

- `style?: style.StyleInput` — size (`width`/`height`) and color (`color`). There
  is **no `size` prop**; sizing goes through StyleX, consistent with `@kovojs/ui`.
- `class?: string` — concatenated after the StyleX class (SPEC.md §4.6).
- `aria-label` / `title` — promote a decorative icon to `role="img"`.
- `id`, `role`, and any `aria-*` / `data-*` — forwarded to the root `<svg>`
  (author-wins, SPEC.md §3). There is no React `ref` (SPEC.md §4.5); target via
  `id`/`class`/`data-*`.

Defaults match Lucide: `24×24`, `fill="none"`, `stroke="currentColor"`,
`stroke-width="2"`. Color inherits from the surrounding text color.

## Generated

Icon components are **generated**, not hand-authored. `scripts/build-icons.mjs`
reads the pinned `lucide-static` dependency and emits one `src/<name>.tsx` per
glyph, plus this package's `exports` map and its `public-packages.json` entry.
Regenerate with:

```sh
pnpm --filter @kovojs/icons run build:icons
```

The generated `src/*.tsx` files are committed source. The `icons.gen.test.ts`
determinism check fails if committed output drifts from a fresh generation.

Icons are derived from Lucide (ISC); see [NOTICE](./NOTICE).
