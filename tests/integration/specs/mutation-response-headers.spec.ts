// SPEC.md §9.1: response headers merge without replacing mutation response vocabulary.
import { enhancedMutationHeaders, headerValues, setCookieValues } from '@kovojs/test/headers';
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'mutation-response-headers' });

test('merges handler transport headers on enhanced and no-JS mutation responses', async ({
  request,
  kovoApp,
}) => {
  const enhanced = await request.post('/_m/mutation-response-headers/touch', {
    form: {},
    headers: enhancedMutationHeaders({ targets: 'header-status' }),
  });
  expect(enhanced.status()).toBe(200);
  const enhancedHeaders = enhanced.headers();
  const enhancedCookie = setCookieValues(enhancedHeaders)[0] ?? '';
  expect(enhancedCookie).toContain('header_seen=yes');
  // SPEC §6.6/§9.1.1 cookie hardening (plans/bugs-and-testing.md C2; testing-audit §4):
  // the serialized Set-Cookie must carry the security flags the handler declared
  // (HttpOnly + SameSite=Strict + Secure), not merely name=value.
  expect(enhancedCookie).toMatch(/;\s*HttpOnly/i);
  expect(enhancedCookie).toMatch(/;\s*SameSite=Strict/i);
  expect(enhancedCookie).toMatch(/;\s*Secure/i);
  // Handler-owned Set-Cookie is additive: framework-owned wire headers still win their
  // channels and remain present on the enhanced response.
  expect(headerValues(enhancedHeaders, 'content-type')).toEqual([
    'text/vnd.kovo.fragment+html; charset=utf-8',
  ]);
  expect(headerValues(enhancedHeaders, 'kovo-build')).toHaveLength(1);
  expect(headerValues(enhancedHeaders, 'kovo-changes')).toEqual(['[]']);
  expect(await enhanced.text()).toContain('<kovo-fragment target="header-status">');

  const noJs = await request.post('/_m/mutation-response-headers/touch', {
    form: {},
    maxRedirects: 0,
  });
  expect(noJs.status()).toBe(303);
  const noJsHeaders = noJs.headers();
  const noJsCookie = setCookieValues(noJsHeaders)[0] ?? '';
  expect(noJsCookie).toContain('header_seen=yes');
  // The no-JS PRG path hardens the cookie identically to the enhanced path.
  expect(noJsCookie).toMatch(/;\s*HttpOnly/i);
  expect(noJsCookie).toMatch(/;\s*SameSite=Strict/i);
  expect(noJsCookie).toMatch(/;\s*Secure/i);
  // Handler-owned Set-Cookie is additive here too: the framework keeps PRG headers.
  expect(headerValues(noJsHeaders, 'cache-control')).toEqual(['no-store']);
  expect(headerValues(noJsHeaders, 'location')).toEqual(['/']);

  const rows = await kovoApp.db.query('select count(*)::int as count from header_events');
  expect(rows[0]).toEqual({ count: 2 });
});
