// SPEC.md §6.5/§9.1: spoofed Kovo-Targets cannot force unauthorized fragment
// refreshes or leak protected fragment data.
import { enhancedMutationHeaders } from '@kovojs/test/headers';
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'mutation-targets-malicious' });

function liveTarget(html: string, marker: string) {
  const opening = new RegExp(`<[^>]*${marker}[^>]*>`).exec(html)?.[0] ?? '';
  const attribute = (name: string) => new RegExp(`${name}="([^"]+)"`).exec(opening)?.[1] ?? '';
  return {
    component: attribute('kovo-live-component'),
    target: attribute('kovo-fragment-target'),
    token: attribute('kovo-live-token'),
  };
}

test('ignores malformed, duplicate, unknown, and unauthorized mutation targets safely', async ({
  request,
}) => {
  const anonymousPage = await request.get('/');
  const anonymousHtml = await anonymousPage.text();
  const anonymousCsrf = /name="kovo-csrf" value="([^"]+)"/.exec(anonymousHtml)?.[1] ?? '';
  const anonymousBuild = /<meta name="kovo-build" content="([^"]+)"/.exec(anonymousHtml)?.[1] ?? '';
  const publicTarget = liveTarget(anonymousHtml, 'data-public-status');
  const origin = new URL(anonymousPage.url()).origin;
  expect(anonymousCsrf).toBeTruthy();
  expect(publicTarget.target).toBe('public-status');
  expect(publicTarget.component).toBeTruthy();
  expect(publicTarget.token).toBeTruthy();

  const anonymous = await request.post('/_m/targets/refresh', {
    form: { 'kovo-csrf': anonymousCsrf, value: 'anonymous' },
    headers: {
      ...enhancedMutationHeaders({
        liveTargets: [
          {
            attestation: publicTarget.token,
            component: publicTarget.component,
            target: publicTarget.target,
          },
          {
            attestation: 'forged',
            component: publicTarget.component,
            target: publicTarget.target,
          },
          {
            attestation: 'forged',
            component: 'private-panel',
            target: 'private-panel',
          },
          'bad-target"]',
        ],
        targets: [
          { queries: 'publicTarget', target: publicTarget.target },
          { target: publicTarget.target },
          { target: 'unknown-target' },
          { queries: 'privateTarget', target: 'private-panel' },
          'bad-target"]',
        ],
      }),
      'Kovo-Build': anonymousBuild,
      'Kovo-Current-Url': anonymousPage.url(),
      origin,
    },
  });
  expect(anonymous.status()).toBe(200);
  const anonymousBody = await anonymous.text();
  // Ambiguous duplicate descriptors fail closed as a set. The valid-looking
  // entry does not rescue a header that also claims the same target with a
  // forged token.
  expect(anonymousBody).toBe('');
  expect(anonymousBody).not.toContain('private-panel');
  expect(anonymousBody).not.toContain('secret');
  expect(anonymousBody).not.toContain('unknown-target');
  expect(anonymousBody).not.toContain('bad-target');

  const validAnonymous = await request.post('/_m/targets/refresh', {
    form: { 'kovo-csrf': anonymousCsrf, value: 'anonymous-valid' },
    headers: {
      ...enhancedMutationHeaders({
        liveTargets: [
          {
            attestation: publicTarget.token,
            component: publicTarget.component,
            target: publicTarget.target,
          },
        ],
        targets: [{ queries: 'publicTarget', target: publicTarget.target }],
      }),
      'Kovo-Build': anonymousBuild,
      'Kovo-Current-Url': anonymousPage.url(),
      origin,
    },
  });
  expect(validAnonymous.status()).toBe(200);
  const validAnonymousBody = await validAnonymous.text();
  expect(validAnonymousBody).toContain('<kovo-fragment target="public-status">');
  expect(validAnonymousBody).toContain('data-public-status');
  expect(validAnonymousBody).not.toContain('private-panel');
  expect(validAnonymousBody).not.toContain('secret');

  const authedPage = await request.get('/', {
    headers: { Cookie: 'kovo_target_session=ada' },
  });
  const authedHtml = await authedPage.text();
  const authedCsrf = /name="kovo-csrf" value="([^"]+)"/.exec(authedHtml)?.[1] ?? '';
  const authedBuild = /<meta name="kovo-build" content="([^"]+)"/.exec(authedHtml)?.[1] ?? '';
  const privateTarget = liveTarget(authedHtml, 'data-private-panel');
  expect(authedCsrf).toBeTruthy();
  expect(privateTarget.target).toBe('private-panel');
  expect(privateTarget.component).toBeTruthy();
  expect(privateTarget.token).toBeTruthy();

  const authed = await request.post('/_m/targets/refresh', {
    form: { 'kovo-csrf': authedCsrf, value: 'authed' },
    headers: {
      ...enhancedMutationHeaders({
        liveTargets: [
          {
            attestation: privateTarget.token,
            component: privateTarget.component,
            target: privateTarget.target,
          },
        ],
        targets: [{ queries: 'privateTarget', target: privateTarget.target }],
      }),
      Cookie: 'kovo_target_session=ada',
      'Kovo-Build': authedBuild,
      'Kovo-Current-Url': authedPage.url(),
      origin,
    },
  });
  expect(authed.status()).toBe(200);
  const authedBody = await authed.text();
  expect(authedBody).toContain('<kovo-query name="privateTarget">{"id":"ada"}</kovo-query>');
  expect(authedBody).toContain('<kovo-fragment target="private-panel">');
  expect(authedBody).toContain('data-private-panel');
  expect(authedBody).toContain('private:<span data-bind="privateTarget.id">ada</span>:secret');
  expect(authedBody).not.toContain('unknown-target');
  expect(authedBody).not.toContain('bad-target');
});
