import { kovo } from '@kovojs/server/vite';
import { defineConfig } from 'vite-plus';

const port = Number.parseInt(process.env.PORT ?? '5173', 10);

// `kovo({ app })` is the Kovo dev/SSR plugin: it loads the app shell, serves route
// documents and `/c/` handler modules, and applies the Kovo compiler. `kovo dev`
// bootstraps it before authored config/plugins. `kovo check`, `kovo test`, and
// `kovo build` retain the config integration while keeping the implementation
// toolchain behind Kovo's versioned commands.
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
    // SPEC §6.6/§12: app.test.ts keeps Vitest's mutable timer realm separate and launches the app
    // through Kovo's bootstrap-first dev runner. The authored app graph is evaluated only in that
    // child runtime, then tested over its public HTTP boundary.
    server: {
      deps: {
        external: ['undici'],
      },
    },
  },
  lint: {
    options: {
      typeAware: true,
      // `kovo check` owns the authoritative incremental TypeScript preflight.
      typeCheck: false,
    },
  },
  fmt: {
    semi: true,
    singleQuote: true,
    sortPackageJson: true,
  },
});
