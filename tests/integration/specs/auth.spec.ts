// I2: the login() helper establishes an authenticated session through the rendered
// sign-in form, so a guards.authed() route renders the signed-in user.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'auth' });

test('login() reaches a guarded route as the signed-in user', async ({ page, kovoApp }) => {
  await kovoApp.login({
    fields: { email: 'ada@example.com', password: 'correct' },
    submit: 'Sign in',
  });

  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
  await expect(page.getByText('Signed in as ada@example.com')).toBeVisible();
});

test('the guarded route does not leak account content when signed out', async ({ page }) => {
  await page.goto('/account');
  // guards.authed() denies the unauthenticated request, so the signed-in user is
  // never rendered (the security property; the exact denied-response shape is the
  // framework's to decide).
  await expect(page.getByText('ada@example.com')).toHaveCount(0);
});
