import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { createDemoServeServer, runDemoServeCli } from '../../../scripts/demo-session/serve.mjs';

// Per-visitor demo server for the Stack Overflow example. Each browser session
// gets its own seeded PGlite instance.

const soRoot = fileURLToPath(new URL('../', import.meta.url));

export function createSoDemoServer(options = {}) {
  return createDemoServeServer({
    label: 'stackoverflow-demo-serve',
    root: soRoot,
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    async loadInstanceFactory(vite) {
      emitGeneratedGraph();
      await vite.ssrLoadModule('/src/generated/touch-graph.ts');
      const { buildSoInteractiveApp } = await vite.ssrLoadModule('/src/interactive-app.tsx');
      const { toNodeHandler } = await vite.ssrLoadModule('@kovojs/server');
      if (typeof buildSoInteractiveApp !== 'function') {
        throw new Error(
          'stackoverflow /src/interactive-app.tsx must export buildSoInteractiveApp.',
        );
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

function emitGeneratedGraph() {
  execFileSync(process.execPath, [fileURLToPath(new URL('./emit-graph.mjs', import.meta.url))], {
    cwd: soRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
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
