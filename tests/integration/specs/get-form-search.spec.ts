// SPEC §6.4 + §7: a GET form updates route search params via normal navigation.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'get-form-search' });

test('GET form writes route search params and re-renders coerced output', async ({ page }) => {
  await page.goto('/catalog?q=shoes&max=5');
  await expect(page.locator('[data-result]')).toHaveText('shoes:5');

  await page.getByLabel('Query').fill('trail boots');
  await page.getByLabel('Max').fill('12');
  await Promise.all([
    page.waitForURL('**/catalog?q=trail+boots&max=12'),
    page.getByRole('button', { name: 'Filter' }).click(),
  ]);

  await expect(page.locator('[data-result]')).toHaveText('trail boots:12');
  const url = new URL(page.url());
  expect(url.pathname).toBe('/catalog');
  expect(url.searchParams.get('q')).toBe('trail boots');
  expect(url.searchParams.get('max')).toBe('12');
});
