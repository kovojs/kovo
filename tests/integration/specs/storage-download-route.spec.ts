// SPEC.md §13.5: guarded download routes authorize app-owned rows while storage
// capabilities reject keys that would escape their configured namespace.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'storage-download-route' });

test('storage download route authorizes rows before serving object bytes', async ({ request }) => {
  const anonymous = await request.get('/files/download?key=receipts%2Fu1%2Forder-1.txt', {
    maxRedirects: 0,
  });
  expect(anonymous.status()).toBe(303);

  const authorized = await request.get('/files/download?key=receipts%2Fu1%2Forder-1.txt', {
    headers: { cookie: 'storage_user=u1' },
  });
  expect(authorized.status()).toBe(200);
  expect(authorized.headers()['content-type']).toBe('text/plain; charset=utf-8');
  expect(authorized.headers()['content-disposition']).toBe('attachment; filename="order-1.txt"');
  expect(authorized.headers().etag).toBe('"receipt-u1-v1"');
  expect(await authorized.text()).toBe('paid by u1\n');

  const crossOwner = await request.get('/files/download?key=receipts%2Fu2%2Forder-2.txt', {
    headers: { cookie: 'storage_user=u1' },
  });
  expect(crossOwner.status()).toBe(404);
  expect(await crossOwner.text()).not.toContain('paid by u2');
});

test('storage download route fails safely for escaped stored keys', async ({ request }) => {
  const escaped = await request.get('/files/download?key=..%2Fescape.txt', {
    headers: { cookie: 'storage_user=u1' },
  });

  expect(escaped.status()).toBe(404);
  expect(await escaped.text()).not.toContain('escape');
});
