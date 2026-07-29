# @kovojs/browser

Browser-side helpers used by Kovo's emitted client modules and advanced
authoring surfaces, including derives, handlers, trusted HTML, and optimism.

```sh
pnpm add @kovojs/browser
```

```ts
import { derive } from '@kovojs/browser';
import { cart } from './cart.server.js';

export const cartLabel = derive([derive.query(cart)], (value) =>
  value.count === 1 ? '1 item' : `${value.count} items`,
);
```

Most apps do not import this package directly. The compiler emits the browser
runtime imports it needs. Manual derives use opaque query, state, or clock input
handles; raw string inputs belong only to compiler-emitted modules.

Reviewed HTML and URL escape hatches require structured audit metadata:

```ts
import { trustedHtml, trustedUrl } from '@kovojs/browser';

const article = trustedHtml(reviewedMarkup, {
  reason: 'rendered by the audited Markdown pipeline',
  source: 'content/markdown.ts',
});
const payment = trustedUrl(paymentUrl, {
  reason: 'allowlisted payment-provider redirect',
});
```

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
