import { fileURLToPath } from 'node:url';

import { createDemoServeServer, runDemoServeCli } from '../../../scripts/demo-session/serve.mjs';

// SPEC.md §9.5: per-visitor multi-tenant serve for the commerce example. Each
// browser session drives its OWN seeded PGlite through the real commerce node
// handler (SSR routes, add-to-cart `/_m/*`, and the `/products?after=` "More"
// pagination that the static export can't replay). See scripts/serve.mjs for the
// single-tenant variant. Run `vp build` first so built `/assets/*` stylesheets
// are present; this is the path the Cloud Run image runs.

const commerceRoot = fileURLToPath(new URL('../', import.meta.url));

export function createCommerceDemoServer(options = {}) {
  return createDemoServeServer({
    label: 'commerce-demo-serve',
    root: commerceRoot,
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    async loadInstanceFactory(vite) {
      const appShell = await vite.ssrLoadModule('/src/app-shell.tsx');
      const { createCommerceAppShell } = appShell;
      if (typeof createCommerceAppShell !== 'function') {
        throw new Error('commerce /src/app-shell.tsx must export createCommerceAppShell.');
      }
      // A reference instance only supplies the route table for the ownership
      // predicate; every visitor's requests run against their own fresh instance
      // (createCommerceAppShell() with no db mints a fresh seeded PGlite).
      const reference = createCommerceAppShell();
      return {
        referenceApp: reference.app,
        buildHandler: () => createCommerceAppShell().nodeHandler,
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
