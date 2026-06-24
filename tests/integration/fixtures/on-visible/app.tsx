import { createApp, publicAccess, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: () => `<main>
    <h1>Visible trigger</h1>
    <div style="height: 160vh">spacer</div>
    <output on:visible="/client.ts#markVisible" data-status>waiting</output>
  </main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
