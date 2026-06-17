// SPEC.md §6.4: respond.stream() sends declared stream headers and still runs
// route guards before the body is served.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'respond-stream' });

test('guarded stream response arrives with declared inline disposition', async ({ request }) => {
  const anonymous = await request.get('/reports/live.txt', { maxRedirects: 0 });
  expect(anonymous.status()).toBe(303);

  const authorized = await request.get('/reports/live.txt', {
    headers: { cookie: 'respond_stream_session=1' },
  });
  expect(authorized.status()).toBe(200);
  expect(authorized.headers()['content-type']).toBe('text/plain; charset=utf-8');
  expect(authorized.headers()['content-disposition']).toBe('inline; filename="live.txt"');
  expect(authorized.headers()['x-content-type-options']).toBe('nosniff');
  expect(await authorized.text()).toBe('alpha\nbeta\n');
});
