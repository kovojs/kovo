# @kovojs/core

Core authoring primitives shared by Kovo packages: components, routes, queries,
forms, diagnostics, storage helpers, and verifier utilities.

```sh
pnpm add @kovojs/core
```

```ts
import { component, query, route, s } from '@kovojs/core';

export const contactRoute = route('/contacts/:id', {
  params: s.object({ id: s.string() }),
});

export const contactQuery = query({
  name: 'contact',
  args: s.object({ id: s.string() }),
  loader: async ({ args }) => ({ id: args.id, name: 'Ada' }),
});

export const ContactName = component(({ contact }: { contact: { name: string } }) => (
  <strong>{contact.name}</strong>
));
```

## Reference

- API: `/api/core/`
- Guides: `/getting-started/mental-model/`, `/guides/routing/`, `/guides/queries/`
