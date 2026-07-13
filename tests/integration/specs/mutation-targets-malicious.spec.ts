// SPEC.md §6.5/§9.1: spoofed Kovo-Targets cannot force unauthorized fragment
// refreshes or leak protected fragment data.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'mutation-targets-malicious' });

test('ignores malformed, duplicate, unknown, and unauthorized mutation targets safely', async ({
  request,
}) => {
  const anonymousPage = await request.get('/');
  const anonymousHtml = await anonymousPage.text();
  const anonymousCsrf = /name="kovo-csrf" value="([^"]+)"/.exec(anonymousHtml)?.[1] ?? '';
  const origin = new URL(anonymousPage.url()).origin;
  expect(anonymousCsrf).toBeTruthy();

  const anonymous = await request.post('/_m/targets/refresh', {
    form: { 'kovo-csrf': anonymousCsrf, value: 'anonymous' },
    headers: {
      'Kovo-Fragment': 'true',
      'Kovo-Targets':
        'public-status; public-status=public; unknown-target; private-panel=private; bad-target"]',
      origin,
    },
  });
  expect(anonymous.status()).toBe(200);
  const anonymousBody = await anonymous.text();
  expect(anonymousBody).toContain('<kovo-fragment target="public-status">');
  expect(anonymousBody).toContain('data-public-status');
  expect(anonymousBody).not.toContain('private-panel');
  expect(anonymousBody).not.toContain('secret');
  expect(anonymousBody).not.toContain('unknown-target');
  expect(anonymousBody).not.toContain('bad-target');

  const authedPage = await request.get('/', {
    headers: { Cookie: 'kovo_target_session=ada' },
  });
  const authedHtml = await authedPage.text();
  const authedCsrf = /name="kovo-csrf" value="([^"]+)"/.exec(authedHtml)?.[1] ?? '';
  expect(authedCsrf).toBeTruthy();

  const authed = await request.post('/_m/targets/refresh', {
    form: { 'kovo-csrf': authedCsrf, value: 'authed' },
    headers: {
      Cookie: 'kovo_target_session=ada',
      'Kovo-Fragment': 'true',
      'Kovo-Targets': 'private-panel=private',
      origin,
    },
  });
  expect(authed.status()).toBe(200);
  const authedBody = await authed.text();
  expect(authedBody).toContain(
    '<kovo-fragment target="private-panel"><output data-private-panel>private:ada:secret</output></kovo-fragment>',
  );
  expect(authedBody).not.toContain('unknown-target');
  expect(authedBody).not.toContain('bad-target');
});
