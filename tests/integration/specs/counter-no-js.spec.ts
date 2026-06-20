import { expect, test } from '@kovojs/test/internal/integration';

// First BROWSER-level no-JS degradation test (testing-audit §5.3; plans/bugs-and-testing.md C8).
// With JavaScript disabled the inline loader never runs, so `enhance`/`data-mutation` are inert
// and the form falls back to a native full-page POST → 303 PRG → full re-render. The MPA spine
// "degrades to a website" (SPEC §8): the same endpoint, the same outcome, zero JS.
test.use({ kovoFixture: 'counter', javaScriptEnabled: false });

test('increments via native form POST + PRG with JavaScript disabled', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('count-badge output')).toHaveText('0');

  // A native submit causes a full navigation (POST /_m/counter/increment → 303 → GET /),
  // not an enhanced fetch — Playwright waits for the resulting document load.
  await page.getByRole('button', { name: 'Increment' }).click();
  await page.waitForLoadState('load');

  await expect(page.locator('count-badge output')).toHaveText('1');
  expect(new URL(page.url()).pathname).toBe('/');

  // A second submit accumulates server truth across full navigations.
  await page.getByRole('button', { name: 'Increment' }).click();
  await page.waitForLoadState('load');
  await expect(page.locator('count-badge output')).toHaveText('2');
});
