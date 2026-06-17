// SPEC.md §9.1 and §9.5: endpoint() is raw Request -> Response machine ingress
// and dispatches before the route table without ambient session.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'endpoint-raw-request' });

test('declared raw endpoints receive raw bodies without ambient session', async ({ request }) => {
  const rawBody = '{ "sku": "p1", "quantity": 2 }';
  const response = await request.post('/machine/exact', {
    data: rawBody,
    headers: {
      cookie: 'endpoint_raw_session=1',
      'content-type': 'application/json',
      'x-signature': 'sig_123',
    },
  });

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    body: rawBody,
    sessionAmbient: false,
    signature: 'sig_123',
  });
});

test('exact and prefix endpoint mounts dispatch apart from page routes', async ({
  page,
  request,
}) => {
  const routeResponse = await page.goto('/machine/exact');
  expect(routeResponse?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Route Fallback' })).toBeVisible();

  const exactPost = await request.post('/machine/exact', {
    data: 'posted-to-endpoint',
    headers: { 'x-signature': 'sig_456' },
  });
  expect(exactPost.status()).toBe(200);
  expect(await exactPost.json()).toMatchObject({ body: 'posted-to-endpoint' });

  const prefixPost = await request.post('/machine/prefix/sub/path', {
    data: 'prefixed',
  });
  expect(prefixPost.status()).toBe(200);
  expect(await prefixPost.text()).toBe('prefix:/machine/prefix/sub/path:prefixed');
});
