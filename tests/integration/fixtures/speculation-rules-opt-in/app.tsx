import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';

const defaultRoute = route('/', {
  page: () => `<main>
    <h1>Default navigation</h1>
    <a href="/prerendered">Open prerendered route</a>
  </main>`,
});

const prerenderedRoute = route('/prerendered', {
  prefetch: 'conservative',
  prerenderUrls: ['/products/sku-1', '/search?q=trail+pack'],
  page: () => `<main>
    <h1>Prerendered route</h1>
    <p>Speculation rules are opt-in.</p>
  </main>`,
});

export default defineFixture({
  app: createApp({ routes: [defaultRoute, prerenderedRoute] }),
});
