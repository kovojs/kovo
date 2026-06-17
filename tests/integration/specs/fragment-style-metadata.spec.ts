import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'fragment-style-metadata' });

test('late mutation fragments request compiler-metadata styles without duplicate links', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');
  await expect(page.locator('link[rel="stylesheet"][href="/assets/late-card.css"]')).toHaveCount(0);

  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith('/_m/fragment-style-metadata/reveal') &&
        candidate.status() === 200,
    ),
    page.getByRole('button', { name: 'Reveal card' }).click(),
  ]);
  expect((await response.text()).match(/href="\/assets\/late-card\.css"/g)).toHaveLength(1);

  const card = page.locator('[data-late-card]');
  await expect(card).toHaveText('Late styled card');
  await expect(card).toHaveCSS('background-color', 'rgb(12, 84, 96)');
  await expect(page.locator('link[rel="stylesheet"][href="/assets/late-card.css"]')).toHaveCount(1);

  expect(await kovoApp.semantic('[kovo-fragment-target="late-card"]')).toMatchSnapshot(
    'fragment-style-metadata.semantic.txt',
  );
});
