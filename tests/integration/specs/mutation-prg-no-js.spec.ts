// SPEC.md §9.1/§9.2: no-JS mutation requests share the handler but use PRG/full page errors.
import { headerValues } from '@kovojs/test/headers';
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'mutation-prg-no-js' });

test('raw no-JS POST redirects after commit', async ({ request, kovoApp }) => {
  const response = await request.post('/_m/newsletter/subscribe', {
    form: { email: 'ada@example.com', seats: '1' },
    maxRedirects: 0,
  });

  expect(response.status()).toBe(303);
  expect(headerValues(response.headers(), 'location')).toEqual(['/thanks']);
  expect(headerValues(response.headers(), 'cache-control')).toEqual(['no-store']);

  const rows = await kovoApp.db.query('select email, seats from subscribers');
  expect(rows).toEqual([{ email: 'ada@example.com', seats: 1 }]);
});

test('raw no-JS POST renders typed errors as a full page', async ({ request, kovoApp }) => {
  const response = await request.post('/_m/newsletter/subscribe', {
    form: { email: 'taken@example.com', seats: '1' },
    maxRedirects: 0,
  });

  expect(response.status()).toBe(422);
  expect(headerValues(response.headers(), 'content-type')).toEqual(['text/html; charset=utf-8']);
  const body = await response.text();
  expect(body).toContain('<!doctype html><html><body>');
  expect(body).toContain('data-error-code="ALREADY_SUBSCRIBED"');
  expect(body).toContain('Already subscribed');

  const rows = await kovoApp.db.query('select count(*)::int as count from subscribers');
  expect(rows[0]).toEqual({ count: 0 });
});
