// I0 smoke spec: the static-home fixture boots, serves, and renders. Establishes
// the whole pipeline — per-worker boot, baseURL wiring, web-first assertions, and a
// semantic-structure snapshot.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'static-home' });

test('serves the static route end to end', async ({ page, kovoApp }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBeTruthy();

  await expect(page).toHaveTitle(/Static Home/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hello Kovo');
  await expect(page.locator('[data-bind="greeting"]')).toHaveText('Welcome');

  // Non-brittle: assert on the semantic structure, not raw markup.
  expect(await kovoApp.semantic('main')).toMatchSnapshot('home.semantic.txt');
});
