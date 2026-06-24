import { fileURLToPath } from 'node:url';

import { createDemoServeServer, runDemoServeCli } from '../../../scripts/demo-session/serve.mjs';

// Hosted demo server for the Stack Overflow example. Browser sessions share one
// app/PGlite instance; rows are scoped by the dispatcher session id.

const soRoot = fileURLToPath(new URL('../', import.meta.url));

export function createSoDemoServer(options = {}) {
  return createDemoServeServer({
    label: 'stackoverflow-demo-serve',
    root: soRoot,
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    async loadInstanceFactory(vite) {
      const { buildSoInteractiveApp } = await vite.ssrLoadModule('/src/interactive-app.tsx');
      const { toNodeHandler } = await vite.ssrLoadModule('@kovojs/server');
      if (typeof buildSoInteractiveApp !== 'function') {
        throw new Error(
          'stackoverflow /src/interactive-app.tsx must export buildSoInteractiveApp.',
        );
      }
      // The app's db provider seeds each browser session on demand, so the
      // dispatcher can reuse this handler instead of rebuilding Kovo + PGlite
      // for every cookieless visitor.
      const reference = await buildSoInteractiveApp();
      const sharedHandler = toNodeHandler(reference.handler);
      return {
        referenceApp: reference.app,
        buildHandler: () => sharedHandler,
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
