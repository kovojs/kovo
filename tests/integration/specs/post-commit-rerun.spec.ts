// SPEC.md §10.3: mutation response query/fragments are rendered after commit.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'post-commit-rerun' });

test('enhanced response includes committed query truth and matching fragment', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');
  await expect(page.locator('[data-bind="balance.balance"]')).toHaveText('10');

  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/_m/account/deposit') && response.status() === 200,
  );
  await page.getByRole('button', { name: 'Deposit' }).click();
  const response = await responsePromise;
  const body = await response.text();

  expect(body).toContain('<kovo-fragment target="balance-badge">');
  expect(body).toContain('<output data-bind="balance.balance">15</output>');
  await expect(page.locator('[data-bind="balance.balance"]')).toHaveText('15');

  const rows = await kovoApp.db.query('select balance from account where id = 1');
  expect(rows[0]).toEqual({ balance: 15 });

  expect(await kovoApp.semantic('[kovo-fragment-target="balance-badge"]')).toMatchSnapshot(
    'balance-badge.semantic.txt',
  );
});
