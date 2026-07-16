import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'fragment-style-metadata' });

test('late mutation fragments request compiler-metadata styles without duplicate links', async ({
  page,
  kovoApp,
  request,
}) => {
  // Read the wire through Playwright's API client rather than Chromium's CDP response cache. A
  // loaded browser shard may discard an enhanced-navigation body before `Response.text()` can
  // retrieve it even when the read starts from `waitForResponse`.
  const wireResponse = await request.post('/_m/fragment-style-metadata/reveal', {
    form: {},
    headers: {
      Accept: 'text/vnd.kovo.fragment+html; stream=1',
      'Kovo-Fragment': 'true',
      'Kovo-Stream': 'true',
    },
  });
  expect(wireResponse.status()).toBe(200);
  const wire = await wireResponse.text();
  expect(wire.match(/href="\/assets\/late-card\.css"/g)).toHaveLength(1);

  await page.goto('/');
  await expect(page.locator('link[rel="stylesheet"][href="/assets/late-card.css"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Reveal card' }).click();

  const card = page.locator('[data-late-card]');
  await expect(card).toHaveText('Late styled card');
  await expect(card).toHaveCSS('background-color', 'rgb(12, 84, 96)');
  await expect(page.locator('link[rel="stylesheet"][href="/assets/late-card.css"]')).toHaveCount(1);

  expect(await kovoApp.semantic('[kovo-fragment-target="late-card"]')).toMatchSnapshot(
    'fragment-style-metadata.semantic.txt',
  );
});
