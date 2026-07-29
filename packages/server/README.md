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

- API: `/api/server/` (root plus `build`, `runtime-bootstrap`, `sqlite`, `testing`, and `vite`)
- Guides: `/guides/request-shell/`, `/guides/deployment/`, `/guides/streaming/`
