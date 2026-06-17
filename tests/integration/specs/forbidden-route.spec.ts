// SPEC §6.5: an authenticated user without the required role receives a 403,
// while an authorized user reaches the guarded route.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'forbidden-route' });

test('role guard maps unauthorized sessions to a 403 response', async ({ page }) => {
  await page.context().addCookies([
    {
      name: 'kovo_forbidden_route_session',
      value: encodeURIComponent('ada@example.com|staff'),
      domain: '127.0.0.1',
      path: '/',
    },
  ]);

  const response = await page.goto('/admin');
  expect(response?.status()).toBe(403);
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
  await expect(page.locator('[data-forbidden-shell]')).toHaveText('Access deniedstatus:403');
  await expect(page.locator('[data-secret]')).toHaveCount(0);
});

test('role guard allows sessions carrying the required role', async ({ page }) => {
  await page.context().addCookies([
    {
      name: 'kovo_forbidden_route_session',
      value: encodeURIComponent('ada@example.com|admin,staff'),
      domain: '127.0.0.1',
      path: '/',
    },
  ]);

  const response = await page.goto('/admin');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
  await expect(page.locator('[data-secret]')).toHaveText('classified:ada@example.com');
});
