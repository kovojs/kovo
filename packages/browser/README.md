# @kovojs/browser

Browser-side helpers used by Kovo's emitted client modules and advanced
authoring surfaces, including derives, handlers, trusted HTML, and optimism.

```sh
pnpm add @kovojs/browser
```

```ts
import { derive } from '@kovojs/browser';

export const cartLabel = derive(['cart'], (cart: { count: number }) =>
  cart.count === 1 ? '1 item' : `${cart.count} items`,
);
```

Most apps do not import this package directly. The compiler emits the browser
runtime imports it needs.

Custom shells have one experimental bootstrap:

```ts
import { installKovoClient } from '@kovojs/browser/client';

const client = installKovoClient({
  root: document,
  importModule: (url) => import(url),
  onError(error, context) {
    console.error(`Kovo ${context.phase}`, error);
  },
});

await client.ready;
// On shell teardown: await client.dispose(); (or dispose('abort')).
```

Kovo owns the query store, morph root, request initialization, and module
allowlist. A custom `fetch(request, next)` hook may observe the exact request,
but it must call `next()` once and return that exact response.

## Reference

- API: `/api/browser/`
- Guides: `/guides/islands/`, `/guides/optimistic/`
