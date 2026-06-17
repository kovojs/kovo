import { expect, test } from '@kovojs/test/internal/integration';

import { expectAxeClean } from './a11y-axe';

test.use({ kovoFixture: 'a11y-form-error-terminal' });

test('enhanced form error terminal state links invalid field to alert text', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');

  await page.getByRole('textbox', { name: 'Email' }).fill('invalid');
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/_m/a11y-form-error/subscribe') && response.status() === 422,
    ),
    page.getByRole('button', { name: 'Subscribe' }).click(),
  ]);

  const email = page.getByRole('textbox', { name: 'Email' });
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(email).toHaveAttribute('aria-describedby', 'email-error');
  await expect(page.getByRole('alert')).toHaveText('Enter a valid email address.');
  await expect(page.locator('[data-error-path="email"]')).toHaveCount(1);
  await expectAxeClean(page);

  expect(
    await kovoApp.semantic('[kovo-fragment-target="newsletter-form"]', {
      keepAttrs: ['aria-describedby', 'aria-invalid', 'data-error-code', 'data-error-path', 'id'],
    }),
  ).toMatchSnapshot('a11y-form-error-terminal.semantic.txt');
});
