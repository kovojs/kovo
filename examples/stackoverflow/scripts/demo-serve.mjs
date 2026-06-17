import { fileURLToPath } from 'node:url';

import { createDemoServeServer, runDemoServeCli } from '../../../scripts/demo-session/serve.mjs';

// SPEC.md §9.5: per-visitor multi-tenant serve for the Stack Overflow example.
// Each browser session drives its OWN seeded PGlite through the real node handler
// (ranked question list with upvote + ask forms, per-question detail with upvote +
// answer forms). See scripts/serve.mjs for the single-tenant variant; run
// `vp build` first so built `/assets/*` stylesheets are present.

const soRoot = fileURLToPath(new URL('../', import.meta.url));

export function createSoDemoServer(options = {}) {
  return createDemoServeServer({
    label: 'stackoverflow-demo-serve',
    root: soRoot,
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    async loadInstanceFactory(vite) {
      const { buildSoInteractiveApp } = await vite.ssrLoadModule('/src/interactive-app.tsx');
      const { toNodeHandler } = await vite.ssrLoadModule('@kovojs/server/app-shell/node');
      if (typeof buildSoInteractiveApp !== 'function') {
        throw new Error('stackoverflow /src/interactive-app.tsx must export buildSoInteractiveApp.');
      }
      // buildSoInteractiveApp() with no db mints a fresh seeded PGlite; the
      // reference instance only supplies the route table for the ownership
      // predicate, every visitor gets their own.
      const reference = await buildSoInteractiveApp();
      return {
        referenceApp: reference.app,
        buildHandler: async () => toNodeHandler((await buildSoInteractiveApp()).handler),
      };
    },
    ...options,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runDemoServeCli((options) =>
    createSoDemoServer(options).then((served) => ({
      ...served,
      label: 'stackoverflow-demo-serve',
    })),
  );
}
