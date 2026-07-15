import { kovo } from '@kovojs/server/vite';
import { defineConfig } from 'vite-plus';

const port = Number.parseInt(process.env.PORT ?? '5173', 10);

// `kovo({ app })` is the Kovo dev/SSR plugin: it loads the app shell, serves route
// documents and `/c/` handler modules, and applies the Kovo compiler. `kovo dev`
// bootstraps it before authored config/plugins; `vp check` and `vp test` retain the
// config integration. `kovo build ./src/app.tsx` (see
// package.json) produces the deployable server.
export default defineConfig({
  plugins: [kovo({ app: '/src/app.tsx' })],
  server: {
    host: process.env.HOST ?? '127.0.0.1',
    port: Number.isFinite(port) ? port : 5173,
    strictPort: true,
  },
  build: {
    manifest: true,
    rollupOptions: {
      input: { styles: 'src/styles.css' },
      output: { assetFileNames: 'assets/[name][extname]' },
    },
  },
  test: {
    // Generated unit tests import the eager app aggregate. Install the test-only verdict shim in a
    // global setup module so every test observes it before app/auth modules evaluate; production
    // builds and servers never load this file.
    setupFiles: ['./src/test-setup.ts'],
    server: {
      deps: {
        external: ['undici'],
      },
    },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    semi: true,
    singleQuote: true,
    sortPackageJson: true,
  },
});
