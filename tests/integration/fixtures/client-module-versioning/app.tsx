import { createApp, createMemoryVersionedClientModuleRegistry, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const clientModules = createMemoryVersionedClientModuleRegistry();
const moduleHref = clientModules.put({
  path: '/c/versioned.client.js',
  source: `
    export function mark() {
      const output = document.querySelector('[data-client-version]');
      if (output) output.textContent = 'loaded:a1b2c3d4';
    }
  `,
  version: 'a1b2c3d4',
});

const homeRoute = route('/', {
  meta: { title: 'Client Module Versioning' },
  page: () => `<main>
    <h1>Client Module Versioning</h1>
    <button type="button" on:click="${moduleHref}#mark">Load versioned module</button>
    <output data-client-version>idle</output>
  </main>`,
});

export default defineFixture({
  app: createApp({
    clientModules,
    routes: [homeRoute],
  }),
});
