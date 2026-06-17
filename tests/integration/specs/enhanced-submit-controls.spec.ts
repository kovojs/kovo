// SPEC.md §6.3/§9.1: enhanced forms stay real POST forms, and supported input
// coercions survive enhancement without silently including disabled controls.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'enhanced-submit-controls' });

test('keeps real post markup and submits supported coerced values', async ({ page, kovoApp }) => {
  await page.goto('/');

  const form = page.locator('form[data-mutation="enhanced-submit-controls/submit"]');
  await expect(form).toHaveAttribute('method', 'post');
  await expect(form).toHaveAttribute('action', '/_m/enhanced-submit-controls/submit');

  await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith('/_m/enhanced-submit-controls/submit'),
    ),
    page.getByRole('button', { name: 'Submit order' }).click(),
  ]);

  await expect(page.locator('[data-submit-report]')).toContainText(
    'intent=confirm; quantity=2; includeGift=true; adminNote=missing',
  );
  await expect(
    kovoApp.db.query(
      'select quantity, include_gift from enhanced_submit_log order by id',
    ),
  ).resolves.toEqual([
    { include_gift: 1, quantity: 2 },
  ]);
});

test('preserves clicked submitter button values for enhanced requests', async ({ page, kovoApp }) => {
  await page.goto('/');

  await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith('/_m/enhanced-submit-controls/submit'),
    ),
    page.getByRole('button', { name: 'Preview order' }).click(),
  ]);

  await expect(page.locator('[data-submit-report]')).toContainText(
    'intent=preview; quantity=2; includeGift=true; adminNote=missing',
  );
  await expect(
    kovoApp.db.query(
      'select quantity, include_gift from enhanced_submit_log order by id desc limit 1',
    ),
  ).resolves.toEqual([{ include_gift: 1, quantity: 2 }]);
});
