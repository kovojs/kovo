import { fileURLToPath } from 'node:url';

import { createDemoServeServer, runDemoServeCli } from '../../../scripts/demo-session/serve.mjs';

// Per-visitor demo server: each browser session gets its own seeded CRM database.

const crmRoot = fileURLToPath(new URL('../', import.meta.url));

export function createCrmDemoServer(options = {}) {
  return createDemoServeServer({
    label: 'crm-demo-serve',
    root: crmRoot,
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    async loadInstanceFactory(vite) {
      const { buildCrmInteractiveApp } = await vite.ssrLoadModule(
        '/src/generated/interactive-app.kovo-route.tsx',
      );
      const { toNodeHandler } = await vite.ssrLoadModule('@kovojs/server/app-shell/node');
      if (typeof buildCrmInteractiveApp !== 'function') {
        throw new Error(
          'crm /src/generated/interactive-app.kovo-route.tsx must export buildCrmInteractiveApp.',
        );
      }
      // buildCrmInteractiveApp() with no db mints a fresh seeded PGlite; the
      // reference instance only supplies the route table for the ownership
      // predicate, every visitor gets their own.
      const reference = await buildCrmInteractiveApp();
      return {
        referenceApp: reference.app,
        buildHandler: async () => toNodeHandler((await buildCrmInteractiveApp()).handler),
      };
    },
    ...options,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runDemoServeCli((options) =>
    createCrmDemoServer(options).then((served) => ({ ...served, label: 'crm-demo-serve' })),
  );
}
