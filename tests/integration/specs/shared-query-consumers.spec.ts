import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'shared-query-consumers' });

test('ships one query value and updates multiple dependent islands together', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');

  await expect(page.locator('script[kovo-query="profile"]')).toHaveCount(1);
  await expect(page.locator('profile-summary [data-bind="profile.name"]')).toHaveText(
    'Ada Lovelace',
  );
  await expect(page.locator('profile-status [data-bind="profile.status"]')).toHaveText('draft');

  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith('/_m/shared-query-consumers/publish') &&
        candidate.status() === 200,
    ),
    page.getByRole('button', { name: 'Publish profile' }).click(),
  ]);
  const body = await response.text();
  expect(body.match(/<kovo-fragment\b/g)?.length).toBe(2);
  expect(body).toContain('<kovo-fragment target="profile-summary">');
  expect(body).toContain('<kovo-fragment target="profile-status">');

  await expect(page.locator('profile-summary [data-bind="profile.name"]')).toHaveText(
    'Grace Hopper',
  );
  await expect(page.locator('profile-status [data-bind="profile.status"]')).toHaveText('published');
  expect(new URL(page.url()).pathname).toBe('/');

  const rows = await kovoApp.db.query('select name, status from profile where id = 1');
  expect(rows[0]).toEqual({ name: 'Grace Hopper', status: 'published' });

  expect(await kovoApp.semantic('main')).toMatchSnapshot('shared-consumers.semantic.txt');
});
