# @kovojs/server

Kovo's server runtime: app creation, schemas, guards, sessions, routes,
streaming, documents, static export, and the Vite plugin entry.

```sh
pnpm add @kovojs/server
```

```tsx
/** @jsxImportSource @kovojs/server */
import { createApp, publicAccess, route } from '@kovojs/server';

const home = route('/', {
  access: publicAccess('public homepage'),
  page: () => <main>Hello from Kovo</main>,
});

export default createApp({
  routes: [home],
});
```

## Reference

- API: `/api/server/`, `/api/server-build/`, `/api/server-vite/`
- Guides: `/guides/request-shell/`, `/guides/deployment/`, `/guides/streaming/`
