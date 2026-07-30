/** @jsxImportSource @kovojs/server */
import { createApp } from '@kovojs/test/internal/integration/fixture-abi';
import { route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const home = route('/', {
  page: () => (
    <main>
      <h1>Isolated browser posture</h1>
    </main>
  ),
});

export default defineFixture({
  app: createApp({
    document: { csp: { crossOriginIsolation: true, reporting: false } },
    routes: [home],
  }),
});
