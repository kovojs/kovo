// SPEC §6.5 + §10.3: mutation guards fail before writes and use the enhanced
// typed-error fragment path instead of redirecting the fragment response.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'guarded-mutation' });

test('enhanced guarded mutation blocks anonymous writes and permits signed-in writes', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');
  await expect(page.locator('[data-count]')).toHaveText('0');

  const deniedResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/_m/guarded-mutation/increment') && response.status() === 422,
  );
  await page.getByRole('button', { name: 'Increment protected counter' }).click();
  const deniedResponse = await deniedResponsePromise;

  expect(await deniedResponse.text()).toContain('data-error-code="UNAUTHORIZED"');
  await expect(page.getByRole('alert')).toHaveAttribute('data-error-code', 'UNAUTHORIZED');
  await expect(page.locator('[data-count]')).toHaveText('0');
  await expect(kovoApp.db.query('select count from guarded_counter where id = 1')).resolves.toEqual(
    [{ count: 0 }],
  );

  await page.context().addCookies([
    {
      name: 'kovo_guarded_mutation_session',
      value: encodeURIComponent('ada@example.com'),
      domain: '127.0.0.1',
      path: '/',
    },
  ]);

  const allowedResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/_m/guarded-mutation/increment') && response.status() === 200,
  );
  await page.getByRole('button', { name: 'Increment protected counter' }).click();
  await allowedResponsePromise;

  await expect(page.locator('[data-count]')).toHaveText('1');
  await expect(kovoApp.db.query('select count from guarded_counter where id = 1')).resolves.toEqual(
    [{ count: 1 }],
  );
});
