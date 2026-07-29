# @kovojs/core

Core authoring primitives shared by Kovo packages: components, routes, queries,
forms, diagnostics, storage helpers, and verifier utilities.

```sh
pnpm add @kovojs/core
```

```ts
import { component, queryRef, routeRef } from '@kovojs/core';

export const contactRoute = routeRef('/contacts/:id', {
  params: { id: '' },
});

export const contactQuery = queryRef('contact');

export const ContactName = component({
  render({ contact }: { contact: { name: string } }) {
    return <strong>{contact.name}</strong>;
  },
});
```

## Reference

- API: `/api/core/`
- Guides: `/getting-started/mental-model/`, `/guides/routing/`, `/guides/queries/`
