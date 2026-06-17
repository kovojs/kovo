// SPEC.md §4.5 requires fragment-target children to re-render from hoisted component refs.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'fragment-slot-hoist' });

test('rerenders hoisted fragment-target children after mutation', async ({ page, kovoApp }) => {
  await page.goto('/');
  await expect(page.locator('[data-hoisted-slot="balance"]')).toHaveText(
    'Hoisted slot for acct-1: 10',
  );

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/_m/fragment-slot-hoist/deposit') && response.status() === 200,
  );
  await page.getByRole('button', { name: 'Deposit' }).click();
  const response = await responsePromise;
  const body = await response.text();

  expect(body).toContain(
    '<kovo-query name="slotBalance">{"accountId":"acct-1","balance":17}</kovo-query>',
  );
  expect(body).toContain('Hoisted slot for acct-1: <output>17</output>');
  await expect(page.locator('[data-hoisted-slot="balance"]')).toHaveText(
    'Hoisted slot for acct-1: 17',
  );

  const rows = await kovoApp.db.query('select balance from slot_account where id = 1');
  expect(rows[0]).toEqual({ balance: 17 });

  expect(await kovoApp.semantic('[kovo-fragment-target="balance-shell"]')).toMatchSnapshot(
    'fragment-slot-hoist-semantic.txt',
  );
});
