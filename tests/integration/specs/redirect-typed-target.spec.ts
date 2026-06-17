// SPEC §6.4 + §9.1: no-JS mutation PRG follows the typed redirect target,
// including path params and search params.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'redirect-typed-target' });

test('mutation redirects to typed route target with params and search', async ({
  page,
  request,
}) => {
  const response = await request.post('/_m/redirect-typed-target/place-order', {
    form: { id: 'ord-42' },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toBe('/orders/ord-42?source=mutation&tab=receipt');

  await page.goto(response.headers().location);
  await expect(page.getByRole('heading', { name: 'Order ord-42' })).toBeVisible();
  await expect(page.locator('[data-route]')).toHaveText('mutation:receipt');
});
