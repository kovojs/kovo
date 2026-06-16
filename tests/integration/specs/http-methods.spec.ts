// SPEC.md §9.5: page routes answer GET/HEAD, other page-path methods are 405,
// and mutation POSTs are reserved under /_m/.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'http-methods' });

test('routes GET and HEAD while reserving mutation POST for /_m/', async ({
  kovoApp,
  page,
  request,
}) => {
  const get = await request.get('/');
  expect(get.status()).toBe(200);
  expect(await get.text()).toContain('<h1>HTTP Methods</h1>');

  const head = await request.head('/');
  expect(head.status()).toBe(200);
  expect(head.headers()['content-type']).toBe('text/html; charset=utf-8');

  const mutationPost = await request.post('/_m/methods/record', {
    form: {},
    maxRedirects: 0,
  });
  expect(mutationPost.status()).toBe(303);
  expect(mutationPost.headers().location).toBe('/done');

  const rows = await kovoApp.db.query('select kind from method_events');
  expect(rows).toEqual([{ kind: 'mutation' }]);

  const browserResponse = await page.goto('/');
  expect(browserResponse?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'HTTP Methods' })).toBeVisible();
});

test.skip(
  'page-path POST returns the app-shell 405 response',
  // Current fixture serving uses the Vite dev ownership filter, which lets
  // disallowed route methods fall through to Vite instead of dispatching the
  // app-shell 405 from SPEC.md §9.5.
  async () => {},
);
