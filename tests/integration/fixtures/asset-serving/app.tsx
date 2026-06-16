import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';

const homeRoute = route('/', {
  meta: { title: 'Asset Serving' },
  page: () => `<main>
    <h1>Asset Serving</h1>
    <link rel="stylesheet" href="/assets/shell.css">
    <p class="asset-serving">Route still dispatched</p>
  </main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
