import { fileURLToPath } from 'node:url';

import { createDemoServeServer, runDemoServeCli } from '../../../scripts/demo-session/serve.mjs';

// Per-visitor demo server: each browser session gets its own seeded CRM database.

const crmRoot = fileURLToPath(new URL('../', import.meta.url));

export function createCrmDemoServer(options = {}) {
  return createDemoServeServer({
    label: 'crm-demo-serve',
    root: crmRoot,
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    async loadInstanceFactory(vite, { createRequestHandler }) {
      const { buildCrmInteractiveApp } = await vite.ssrLoadModule('/src/interactive-app.tsx');
      const { releaseCrmDatabase } = await vite.ssrLoadModule('/src/kovo.ts');
      const { toNodeHandler } = await vite.ssrLoadModule('@kovojs/server');
      if (typeof buildCrmInteractiveApp !== 'function') {
        throw new Error('crm /src/interactive-app.tsx must export buildCrmInteractiveApp.');
      }
      if (typeof releaseCrmDatabase !== 'function') {
        throw new Error('crm /src/kovo.ts must export releaseCrmDatabase.');
      }
      // The closed app graph is shared; the dispatcher-owned header selects a bounded,
      // lazily seeded database per visitor. Eviction releases that session's database.
      const reference = await buildCrmInteractiveApp();
      const handler = toNodeHandler(createRequestHandler(reference.app));
      return {
        referenceApp: reference.app,
        buildHandler: () => handler,
        onEvict: releaseCrmDatabase,
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
