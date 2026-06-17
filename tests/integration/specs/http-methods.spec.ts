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

test('page-path POST returns the app-shell 405 response', async ({ request }) => {
  const response = await request.post('/');
  expect(response.status()).toBe(405);
  expect(response.headers().allow).toBe('GET, HEAD');
  expect(await response.text()).toBe('Method Not Allowed');
});
