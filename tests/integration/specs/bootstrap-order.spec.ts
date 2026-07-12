// SPEC §6.6 rule 6: the supported fixture runner initializes its exact Vite SSR graph before
// evaluating the fixture's poison-first dependency.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'bootstrap-order' });

test('boots compiler and server controls before authored fixture dependencies', async ({
  page,
}) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Bootstrap first' })).toBeVisible();
});
