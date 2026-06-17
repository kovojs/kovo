// SPEC.md §6.5/§9.1: spoofed Kovo-Targets cannot force unauthorized fragment
// refreshes or leak protected fragment data.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'mutation-targets-malicious' });

test('ignores malformed, duplicate, unknown, and unauthorized mutation targets safely', async ({
  request,
}) => {
  const anonymous = await request.post('/_m/targets/refresh', {
    form: { value: 'anonymous' },
    headers: {
      'Kovo-Fragment': 'true',
      'Kovo-Targets':
        'public-status; public-status=public; unknown-target; private-panel=private; bad-target"]',
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

  const authed = await request.post('/_m/targets/refresh', {
    form: { value: 'authed' },
    headers: {
      Cookie: 'kovo_target_session=ada',
      'Kovo-Fragment': 'true',
      'Kovo-Targets': 'private-panel=private',
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
