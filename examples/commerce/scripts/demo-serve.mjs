import { fileURLToPath } from 'node:url';

import { createDemoServeServer, runDemoServeCli } from '../../../scripts/demo-session/serve.mjs';

// SPEC.md §9.5: per-visitor multi-tenant serve for the commerce example. Each
// browser session drives its OWN seeded PGlite through the real commerce node
// handler (SSR routes, add-to-cart `/_m/*`, and the `/products?after=` "More"
// pagination). Run `pnpm run build:demo` first so built `/assets/*` stylesheets
// are present. This is the hosted demo path; production app serve uses
// `kovo build ./src/app.tsx` and `dist/server/server.mjs`.

const commerceRoot = fileURLToPath(new URL('../', import.meta.url));

export function createCommerceDemoServer(options = {}) {
  return createDemoServeServer({
    label: 'commerce-demo-serve',
    root: commerceRoot,
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    async loadInstanceFactory(vite) {
      const appShell = await vite.ssrLoadModule('/src/generated/app.kovo-route.tsx');
      const { createCommerceApp } = appShell;
      if (typeof createCommerceApp !== 'function') {
        throw new Error(
          'commerce /src/generated/app.kovo-route.tsx must export createCommerceApp.',
        );
      }
      // A reference instance only supplies the route table for the ownership
      // predicate; every visitor's requests run against their own fresh instance
      // (createCommerceApp() with no db mints a fresh seeded PGlite).
      const reference = createCommerceApp();
      return {
        referenceApp: reference.app,
        buildHandler: () => createCommerceApp().nodeHandler,
      };
    },
    ...options,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runDemoServeCli((options) =>
    createCommerceDemoServer(options).then((served) => ({
      ...served,
      label: 'commerce-demo-serve',
    })),
  );
}
