import { fileURLToPath } from 'node:url';

import { createDemoServeServer, runDemoServeCli } from '../../../scripts/demo-session/serve.mjs';

// SPEC.md §9.5: per-visitor multi-tenant serve for the CRM example. Each browser
// session drives its OWN seeded PGlite through the real CRM node handler (pipeline
// dashboard, new-deal/add-contact forms, move-stage/close-won actions). See
// scripts/serve.mjs for the single-tenant variant; run `vp build` first so built
// `/assets/*` (Tailwind) are present.

const crmRoot = fileURLToPath(new URL('../', import.meta.url));

export function createCrmDemoServer(options = {}) {
  return createDemoServeServer({
    label: 'crm-demo-serve',
    root: crmRoot,
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    async loadInstanceFactory(vite) {
      const { buildCrmInteractiveApp } = await vite.ssrLoadModule('/src/interactive-app.ts');
      const { toNodeHandler } = await vite.ssrLoadModule('@kovojs/server/app-shell/node');
      if (typeof buildCrmInteractiveApp !== 'function') {
        throw new Error('crm /src/interactive-app.ts must export buildCrmInteractiveApp.');
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
