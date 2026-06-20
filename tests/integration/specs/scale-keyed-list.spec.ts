import { expect, test } from '@kovojs/test/internal/integration';

// SPEC §4.8 keyed stamps at volume (plans/bugs-and-testing.md P3 scale; testing-audit §5.6).
// A 300-row keyed list reconciled through a fragment patch must keep identity correct at
// scale: the middle row removed, the first row updated, order preserved, keys unique.
test.use({ kovoFixture: 'scale-keyed-list' });

test('keyed-morph preserves identity across a 300-row list patch', async ({ page, kovoApp }) => {
  await page.goto('/');

  const rows = page.locator('[data-bind-list="cart.items"] > li[kovo-key]');
  await expect(rows).toHaveCount(300);
  await expect(page.locator('li[kovo-key="r0"] [data-bind=".qty"]')).toHaveText('0');
  await expect(page.locator('li[kovo-key="r150"]')).toHaveCount(1);

  await Promise.all([
    page
      .waitForResponse((r) => r.url().endsWith('/_m/scale-keyed-list/change') && r.status() === 200)
      .then((r) => r.text())
      .then((body) => expect(body).toContain('<kovo-fragment target="cart-list">')),
    page.getByRole('button', { name: 'Change' }).click(),
  ]);

  // The middle row is gone, the count drops by exactly one, the first row updated in place.
  await expect(rows).toHaveCount(299);
  await expect(page.locator('li[kovo-key="r150"]')).toHaveCount(0);
  await expect(page.locator('li[kovo-key="r0"] [data-bind=".qty"]')).toHaveText('999');

  // No mis-keying or duplicate keys at volume: keys are unique and order is preserved.
  const keys = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('kovo-key')));
  expect(new Set(keys).size).toBe(keys.length);
  expect(keys[0]).toBe('r0');
  expect(keys[1]).toBe('r1');
  expect(keys.at(-1)).toBe('r299');
  expect(keys).not.toContain('r150');

  const dbCount = await kovoApp.db.query('select count(*)::int as count from cart_item');
  expect(dbCount[0]).toEqual({ count: 299 });
});
