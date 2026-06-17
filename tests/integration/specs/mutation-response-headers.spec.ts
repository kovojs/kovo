// SPEC.md §9.1: response headers merge without replacing mutation response vocabulary.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'mutation-response-headers' });

test('merges handler transport headers on enhanced and no-JS mutation responses', async ({
  request,
  kovoApp,
}) => {
  const enhanced = await request.post('/_m/mutation-response-headers/touch', {
    form: {},
    headers: { 'Kovo-Fragment': 'true', 'Kovo-Targets': 'header-status' },
  });
  expect(enhanced.status()).toBe(200);
  expect(enhanced.headers()['set-cookie']).toContain('header_seen=yes');
  expect(enhanced.headers()['content-type']).toBe('text/vnd.kovo.fragment+html; charset=utf-8');
  expect(await enhanced.text()).toContain('<kovo-fragment target="header-status">');

  const noJs = await request.post('/_m/mutation-response-headers/touch', {
    form: {},
    maxRedirects: 0,
  });
  expect(noJs.status()).toBe(303);
  expect(noJs.headers()['set-cookie']).toContain('header_seen=yes');
  expect(noJs.headers()['location']).toBe('/');

  const rows = await kovoApp.db.query('select count(*)::int as count from header_events');
  expect(rows[0]).toEqual({ count: 2 });
});
