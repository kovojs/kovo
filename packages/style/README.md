# @kovojs/style

Typed, StyleX-inspired styling for Kovo components: atomic style objects,
variant helpers, theme tokens, CSS variables, and class/prop merging.

```sh
pnpm add @kovojs/style
```

```ts
import * as style from '@kovojs/style';

export const styles = style.create({
  button: {
    display: 'inline-flex',
    gap: 8,
  },
});

const attrs = style.attrs(styles.button);
```

## Reference

- API: `/api/style/`
- Guide: `/guides/styling/`
