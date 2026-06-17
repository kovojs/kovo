// SPEC.md §6.4: respond.file() keeps route guards, attachment headers, and
// If-None-Match handling while bypassing HTML rendering.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'respond-file' });

test('guarded file response returns attachment headers and supports ETag 304', async ({
  request,
}) => {
  const anonymous = await request.get('/exports/orders.csv', { maxRedirects: 0 });
  expect(anonymous.status()).toBe(303);

  const authorized = await request.get('/exports/orders.csv', {
    headers: { cookie: 'respond_file_session=1' },
  });
  expect(authorized.status()).toBe(200);
  expect(authorized.headers()['content-type']).toBe('text/csv; charset=utf-8');
  expect(authorized.headers()['content-disposition']).toBe('attachment; filename="orders.csv"');
  expect(authorized.headers().etag).toBe('"orders-v1"');
  expect(authorized.headers()['x-content-type-options']).toBe('nosniff');
  expect(await authorized.text()).toBe('id,total\nord_1,42\n');

  const notModified = await request.get('/exports/orders.csv', {
    headers: {
      cookie: 'respond_file_session=1',
      'if-none-match': '"orders-v1"',
    },
  });
  expect(notModified.status()).toBe(304);
  expect(await notModified.text()).toBe('');
});
