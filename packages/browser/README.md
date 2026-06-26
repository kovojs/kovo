# @kovojs/browser

Browser-side helpers used by Kovo's emitted client modules and advanced
authoring surfaces, including derives, handlers, trusted HTML, and optimism.

```sh
pnpm add @kovojs/browser
```

```ts
import { derive } from '@kovojs/browser';

export const cartLabel = derive((cart: { count: number }) =>
  cart.count === 1 ? '1 item' : `${cart.count} items`,
);
```

Most apps do not import this package directly. The compiler emits the browser
runtime imports it needs.

## Reference

- API: `/api/browser/`
- Guides: `/guides/islands/`, `/guides/optimistic/`
