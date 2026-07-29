# @kovojs/style

Typed, StyleX-inspired styling for Kovo components: atomic style objects,
variant helpers, theme tokens, CSS variables, and class/prop merging.

```sh
pnpm add @kovojs/style
```

```tsx
import * as style from '@kovojs/style';

export const styles = style.create({
  button: {
    display: 'inline-flex',
    gap: 8,
  },
  disabled: {
    opacity: 0.5,
  },
});

const attrs = style.attrs(styles.button);

export function SaveButton({ disabled }: { disabled: boolean }) {
  return <button style={[styles.button, disabled && styles.disabled]}>Save</button>;
}
```

`styles.button` is an opaque `StyleHandle`. It has no public rule or provenance fields and cannot be
reconstructed with an object literal or cast; pass it directly to a component `style` prop or to
`style.attrs`. Nested arrays and falsy conditions are supported:

Use `defineTheme({ seed })` for app themes. `DefineThemeOptions`, `KovoTheme`, and `ThemeTokens` are
the aggregate public theme types; compiler extraction metadata stays behind the internal build
boundary.

## Reference

- API: `/api/style/`
- Guide: `/guides/styling/`
- Migration: `docs/releases/style-api-v1.md`
