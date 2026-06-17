// SPEC §6.5 + §9.4: guarded typed reads run the same auth guard on route render
// and on the /_q endpoint.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'guarded-query-read' });

test('query guard protects initial page render and typed-read endpoint', async ({
  page,
  request,
}) => {
  const anonymousPage = await page.goto('/?view=summary');
  expect(anonymousPage?.status()).toBe(200);
  await expect(page.locator('[data-denied]')).toHaveText('UNAUTHORIZED');
  await expect(page.locator('[data-account]')).toHaveCount(0);

  const anonymousQuery = await request.get('/_q/account?view=summary', { maxRedirects: 0 });
  expect(anonymousQuery.status()).toBe(303);
  expect(anonymousQuery.headers().location).toBe('/login?next=%2F_q%2Faccount%3Fview%3Dsummary');
  expect(await anonymousQuery.text()).not.toContain('ada@example.com');

  await page.context().addCookies([
    {
      name: 'kovo_guarded_query_session',
      value: encodeURIComponent('ada@example.com'),
      domain: '127.0.0.1',
      path: '/',
    },
  ]);

  await page.goto('/?view=summary');
  await expect(page.locator('[data-account]')).toHaveText('ada@example.com:summary');

  const authedQuery = await page.request.get('/_q/account?view=summary');
  expect(authedQuery.status()).toBe(200);
  await expect(authedQuery.text()).resolves.toContain(
    '<kovo-query name="account:summary">{"id":"ada@example.com","view":"summary"}</kovo-query>',
  );
});
