// SPEC §6.4 and §9.5: route-returned notFound() and unexpected page failures
// render the configured app error shells with stable statuses.
import { createApp, notFound, publicAccess, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: () => '<main><h1>Error Shell Home</h1></main>',
});

const missingProductRoute = route('/products/:id', {
  access: publicAccess('integration fixture route /products/:id has no runtime guard'),
  page: () => notFound(),
});

const brokenRoute = route('/broken', {
  access: publicAccess('integration fixture route /broken has no runtime guard'),
  page() {
    throw new Error('private integration route detail');
  },
});

export default defineFixture({
  app: createApp({
    errorShells: {
      notFound: ({ request, status }) => {
        const url = new URL(request.url);
        return {
          body: `<main data-error-shell="404"><h1>Custom missing</h1><p>${status}:${url.pathname}</p></main>`,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          status,
        };
      },
      serverError: ({ status }) => ({
        body: `<main data-error-shell="500"><h1>Custom failure</h1><p>${status}:safe</p></main>`,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status,
      }),
    },
    routes: [homeRoute, missingProductRoute, brokenRoute],
  }),
});
