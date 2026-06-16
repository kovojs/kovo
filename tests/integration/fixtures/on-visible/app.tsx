import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';

const homeRoute = route('/', {
  page: () => `<main>
    <h1>Visible trigger</h1>
    <div style="height: 160vh">spacer</div>
    <output on:visible="/client.ts#markVisible" data-status>waiting</output>
  </main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
