# @kovojs/compiler

Kovo's compiler is installed as build-time infrastructure. It lowers authored
TSX/JSX app components into server modules, client modules, graphs, and
diagnostics. App code does not import this package directly.

```sh
pnpm dlx create-kovo my-app
```

Configure an app through the public server-owned Vite entry:

```ts
import { kovo } from '@kovojs/server/vite';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  plugins: [kovo({ app: '/src/app.tsx' })],
});
```

## Reference

- Configure and build an app: `/api/server/` (`@kovojs/server/vite`)
- Inspect compiler facts: `/guides/cli/`
- Understand emitted source: `/guides/compiler-internals/`
