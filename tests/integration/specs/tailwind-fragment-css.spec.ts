import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'tailwind-fragment-css' });

test('enhanced mutation fragments deliver and apply late stylesheet links once', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');
  await expect(page.locator('link[href="/assets/fragment.css"]')).toHaveCount(0);

  const [response] = await Promise.all([
    page.waitForResponse((candidate) =>
      candidate.url().endsWith('/_m/tailwind-fragment-css/reveal') && candidate.status() === 200,
    ),
    page.getByRole('button', { name: 'Show recommendation' }).click(),
  ]);
  const body = await response.text();
  expect(body.match(/href="\/assets\/fragment\.css"/g)).toHaveLength(1);

  const recommendation = page.locator('[data-recommendation]');
  await expect(recommendation).toHaveText('Styled recommendation');
  await expect(recommendation).toHaveCSS('background-color', 'rgb(12, 84, 96)');
  await expect(page.locator('link[href="/assets/fragment.css"]')).toHaveCount(1);

  expect(await kovoApp.semantic('[kovo-fragment-target="recommendations"]')).toMatchSnapshot(
    'tailwind-fragment-css.semantic.txt',
  );
});
