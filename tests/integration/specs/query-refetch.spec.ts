import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'query-refetch' });

test('visible-return refetch updates bound query consumers from typed-read truth', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');
  await page.waitForFunction(
    () =>
      (window as typeof window & { __queryRefetchReady?: boolean }).__queryRefetchReady === true,
  );
  await expect(page.locator('refetch-card [data-bind="refetch.message"]')).toHaveText(
    'Initial message',
  );

  await kovoApp.db.exec("update refetch_state set message = 'Externally changed' where id = 1");

  const refetchResponse = page.waitForResponse(
    (response) => response.url().endsWith('/_q/refetch') && response.status() === 200,
  );
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await refetchResponse;

  await expect(page.locator('refetch-card [data-bind="refetch.message"]')).toHaveText(
    'Externally changed',
  );
  expect(new URL(page.url()).pathname).toBe('/');

  const response = await page.request.get('/_q/refetch', {
    headers: { Accept: 'text/html', 'Kovo-Fragment': 'true' },
  });
  expect(response.status()).toBe(200);
  await expect(response.text()).resolves.toBe(
    '<kovo-query name="refetch">{"message":"Externally changed"}</kovo-query>',
  );

  expect(await kovoApp.semantic('main')).toMatchSnapshot('query-refetch.semantic.txt');
});
