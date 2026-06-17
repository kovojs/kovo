import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const homeRoute = route('/', {
  page: () => `<main>
    <h1>Idle trigger</h1>
    <output on:idle="/client.ts#markIdle" data-status>waiting</output>
  </main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
