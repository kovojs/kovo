import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const homeRoute = route('/', {
  page: () => `<main>
    <h1>Event chain</h1>
    <button type="button" on:click="/client.ts#author /client.ts#primitive">Run chain</button>
    <output data-order>idle</output>
  </main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
