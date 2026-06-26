# @kovojs/compiler

Kovo's build-time compiler. It lowers authored TSX/JSX app components into
server modules, client modules, graphs, diagnostics, and Vite integration
artifacts. App authors usually reach it through `vp`, `kovo`, or the Vite plugin.

```sh
pnpm add -D @kovojs/compiler
```

```ts
import { defineConfig } from 'vite';
import { kovoVitePlugin } from '@kovojs/compiler';

export default defineConfig({
  plugins: [kovoVitePlugin()],
});
```

## Reference

- Guides: `/guides/compiler-internals/`, `/guides/cli/`
- Public surface: see `public-packages.json` for the app-facing and generated subpaths.
