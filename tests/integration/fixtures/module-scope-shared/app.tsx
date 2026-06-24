import { createApp, publicAccess, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: () => `<main>
    <h1>Module scope shared</h1>
    <button type="button" on:click="/client.ts#record" data-p-item-id="alpha">Record alpha</button>
    <button type="button" on:click="/client.ts#record" data-p-item-id="beta">Record beta</button>
    <output data-log>idle</output>
  </main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
