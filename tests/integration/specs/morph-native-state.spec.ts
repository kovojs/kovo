import { expect, test } from '@kovojs/test/internal/integration';

// SPEC §9.1 morph survival (plans/bugs-and-testing.md C8; testing-audit §5.3): a
// fragment morph claims to preserve user-agent/DOM-resident state — my F39 SPEC edit
// explicitly lists "<details>/media element UA state". A user opens a <details>, then
// an unrelated morph (incremented counter) re-renders the enclosing fragment.
test.use({ kovoFixture: 'morph-native-state' });

// KNOWN GAP: the idiomorph-class morph replaces the <details> element, so the user's
// open state is lost — contradicting the SPEC §9.1 survival claim. Encoded as an
// expected failure so it stays visible and ALERTS (expected-to-fail-but-passed) when
// the morph is fixed to preserve native element state. See also testing-audit §5.3
// (native-element-state-survival), which lists <details>/checkbox/media.
test('a fragment morph preserves a user-opened <details> (native UA state)', async ({ page }) => {
  test.fail();
  await page.goto('/');
  const details = page.locator('[data-testid="panel-details"]');
  await expect(page.getByTestId('count')).toHaveText('0');

  // User opens the disclosure.
  await page.locator('[data-testid="panel-details"] > summary').click();
  await expect(details).toHaveJSProperty('open', true);

  // An unrelated change morphs the enclosing fragment.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith('/_m/morph-native-state/bump') && r.status() === 200,
    ),
    page.getByRole('button', { name: 'Bump' }).click(),
  ]);
  await expect(page.getByTestId('count')).toHaveText('1');

  // The user's open state must survive the morph of an unrelated sibling.
  // (Currently fails — the morph drops it; short timeout keeps the expected failure fast.)
  await expect(details).toHaveJSProperty('open', true, { timeout: 2000 });
});
