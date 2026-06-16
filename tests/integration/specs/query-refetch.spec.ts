import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'query-refetch' });

test('typed read endpoint exposes latest server truth for visible-return refetch', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');
  await expect(page.locator('refetch-card [data-bind="refetch.message"]')).toHaveText(
    'Initial message',
  );

  await kovoApp.db.exec("update refetch_state set message = 'Externally changed' where id = 1");

  const response = await page.request.get('/_q/refetch', {
    headers: { Accept: 'text/html', 'Kovo-Fragment': 'true' },
  });
  expect(response.status()).toBe(200);
  await expect(response.text()).resolves.toBe(
    '<kovo-query name="refetch">{"message":"Externally changed"}</kovo-query>',
  );

  await expect(page.locator('refetch-card [data-bind="refetch.message"]')).toHaveText(
    'Initial message',
  );
  expect(await kovoApp.semantic('main')).toMatchSnapshot('query-refetch.semantic.txt');
});
