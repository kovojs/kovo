// SPEC.md §9.1/§9.2: no-JS mutation requests share the handler but use PRG/full page errors.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'mutation-prg-no-js' });

test('raw no-JS POST redirects after commit', async ({ request, kovoApp }) => {
  const response = await request.post('/_m/newsletter/subscribe', {
    form: { email: 'ada@example.com', seats: '1' },
    maxRedirects: 0,
  });

  expect(response.status()).toBe(303);
  expect(response.headers()['location']).toBe('/thanks');
  expect(response.headers()['cache-control']).toBe('no-store');

  const rows = await kovoApp.db.query('select email, seats from subscribers');
  expect(rows).toEqual([{ email: 'ada@example.com', seats: 1 }]);
});

test('raw no-JS POST renders typed errors as a full page', async ({ request, kovoApp }) => {
  const response = await request.post('/_m/newsletter/subscribe', {
    form: { email: 'taken@example.com', seats: '1' },
    maxRedirects: 0,
  });

  expect(response.status()).toBe(422);
  expect(response.headers()['content-type']).toBe('text/html; charset=utf-8');
  const body = await response.text();
  expect(body).toContain('<!doctype html><html><body>');
  expect(body).toContain('data-error-code="ALREADY_SUBSCRIBED"');
  expect(body).toContain('Already subscribed');

  const rows = await kovoApp.db.query('select count(*)::int as count from subscribers');
  expect(rows[0]).toEqual({ count: 0 });
});
