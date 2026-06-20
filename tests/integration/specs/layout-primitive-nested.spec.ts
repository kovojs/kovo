import { expect, test } from '@kovojs/test/internal/integration';

// SPEC §4.5 (plans/bugs-and-testing.md C8d; testing-audit §5.6): the first-class
// layout() primitive attached via route({ layout }), with a nested parent, must
// compose page chrome in order — shell wraps section wraps page.
test.use({ kovoFixture: 'layout-primitive-nested' });

test('route({ layout }) composes a nested parent layout around the page', async ({ page }) => {
  await page.goto('/');

  // All three segments present.
  await expect(page.locator('[data-layout="shell"]')).toHaveCount(1);
  await expect(page.locator('[data-layout="section"]')).toHaveCount(1);
  await expect(page.locator('[data-route="page"]')).toHaveText('Page body');

  // Nesting order: shell > section > page (parent wraps child wraps page).
  await expect(
    page.locator('[data-layout="shell"] > [data-layout="section"] > [data-route="page"]'),
  ).toHaveCount(1);
  // The shell's own chrome renders outside the section.
  await expect(page.locator('[data-layout="shell"] > header')).toHaveText('Shell chrome');
  await expect(page.locator('[data-layout="section"] > nav')).toHaveText('Section nav');
});
