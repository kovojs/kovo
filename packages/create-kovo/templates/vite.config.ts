import { kovo } from '@kovojs/server/vite';
import { defineConfig } from 'vite-plus';

// `kovo({ app })` is the Kovo dev/SSR plugin: it loads the app shell, serves route
// documents and `/c/` handler modules, and applies the Kovo compiler. `vp dev`,
// `vp check`, and `vp test` all run through it; `kovo build ./src/app.tsx` (see
// package.json) produces the deployable server.
export default defineConfig({
  plugins: [kovo({ app: '/src/app.tsx' })],
  build: {
    manifest: true,
    rollupOptions: {
      input: { styles: 'src/styles.css' },
      output: { assetFileNames: 'assets/[name][extname]' },
    },
  },
  test: {
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
