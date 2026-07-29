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

export function IconExamples() {
  return (
    <div>
      {/* Decorative by default (aria-hidden). */}
      <ArrowRight />

      {/* Size and tint through StyleX; color flows through currentColor. */}
      <Search style={[styles.small, styles.muted]} />

      {/* aria-label promotes a meaningful icon to role="img". */}
      <Search aria-label="Search" />
    </div>
  );
}
```

## Use an icon

Every glyph uses the shared `IconProps` contract:

- `style?: style.StyleInput` — size (`width`/`height`) and color (`color`). There
  is **no `size` prop**; sizing goes through StyleX, consistent with `@kovojs/ui`.
- `class?: string` — concatenated after the StyleX class (SPEC.md §4.6).
- `aria-label` / `title` — promote a decorative icon to `role="img"`.
- `id`, `role`, and any `aria-*` / `data-*` — forwarded to the root `<svg>`
  (author-wins, SPEC.md §3). There is no React `ref` (SPEC.md §4.5); target via
  `id`/`class`/`data-*`.

Defaults match Lucide: `24×24`, `fill="none"`, `stroke="currentColor"`,
`stroke-width="2"`. Color inherits from the surrounding text color.

## Reference

- Shared props: `/api/icons/`
- Search all glyphs: `/guides/components/#icons`
- License: [Lucide ISC notice](./NOTICE)
