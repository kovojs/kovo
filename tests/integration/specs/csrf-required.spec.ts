// SPEC.md §6.6/§9.1: CSRF is stamped into forms and checked before parsing/guards.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'csrf-required' });

test('requires CSRF for enhanced mutation POSTs', async ({ page, request, kovoApp }) => {
  await page.goto('/');

  const token = await page.locator('input[name="kovo-csrf"]').inputValue();
  expect(token).not.toBe('');
  expect(await kovoApp.semantic('form')).not.toContain('kovo-csrf');

  const missing = await request.post('/_m/csrf-required/deposit', {
    form: { amount: 'not-a-number' },
    headers: { 'Kovo-Fragment': 'true', 'Kovo-Targets': 'csrf-total' },
  });
  expect(missing.status()).toBe(422);
  expect(await missing.text()).toContain('data-error-code="CSRF"');

  const invalid = await request.post('/_m/csrf-required/deposit', {
    form: { amount: '1', 'kovo-csrf': 'invalid-token' },
    headers: { 'Kovo-Fragment': 'true', 'Kovo-Targets': 'csrf-total' },
  });
  expect(invalid.status()).toBe(422);
  expect(await invalid.text()).toContain('data-error-code="CSRF"');

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/_m/csrf-required/deposit') && response.status() === 200,
    ),
    page.getByRole('button', { name: 'Deposit with csrf' }).click(),
  ]);
  await expect(page.locator('[data-bind="csrf.total"]')).toHaveText('1');

  const rows = await kovoApp.db.query('select amount from payments');
  expect(rows).toEqual([{ amount: 1 }]);
});
