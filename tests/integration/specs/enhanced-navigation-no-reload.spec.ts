// SPEC §8 (spec/07-navigation.md): "Enhanced navigation is a progressive enhancement... The loader
// may intercept only eligible same-origin, unmodified, GET anchor navigations. It fetches the
// canonical full HTML document ... and morphs only compatible changed segments."
//
// KNOWN-FAILING REGRESSION TEST — plans/good-perf.md O2 (decision D2).
//
// Kovo's enhanced navigation is currently dead in every build that carries the framework's default
// document CSP. The CSP sets `require-trusted-types-for 'script'; trusted-types kovo kovo-browser`,
// and the deferred client runtime then hands a raw string to `DOMParser.parseFromString`, which the
// policy rejects. The loader treats that as a parse failure and performs the normal full GET, so
// EVERY in-app navigation replaces the document. SPEC §8 permits that fallback, which is exactly why
// nothing caught this: the feature can be 100% unreachable while every existing spec stays green.
//
// The two tests below are deliberately split:
//
//   1. `enhanced navigation preconditions hold` MUST stay green. It pins the things that make the
//      regression test meaningful — the deferred runtime is served and installed, and the link under
//      test is an eligible same-origin unmodified GET anchor. Without it the `test.fail()` test below
//      could rot into passing-by-failing for an unrelated reason.
//   2. `an eligible in-app navigation does not replace the document` is marked `test.fail()`: it
//      reproduces the defect today, and Playwright turns the run RED the moment it starts passing.
//      Delete the `test.fail()` marker in the same change that lands the O2 document-part protocol.
import { expect, test, type Page } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'typed-link-navigation' });

const SENTINEL = 'kovo-enhanced-navigation-sentinel';

/**
 * Resolves once Kovo's deferred client runtime has replaced the tiny bootstrap's apply function,
 * i.e. the client half of enhanced navigation is actually installed in this document. Mirrors the
 * probe in `deferred-runtime-trusted-types.spec.ts`.
 */
async function waitForDeferredRuntime(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const apply = (globalThis as { __kovo_a?: (body: string) => void }).__kovo_a;
          return (
            typeof apply === 'function' &&
            !Function.prototype.toString.call(apply).includes('streamQueue')
          );
        }),
      { message: 'Kovo deferred client runtime never installed; enhanced navigation cannot run.' },
    )
    .toBe(true);
}

test('enhanced navigation preconditions hold', async ({ page }) => {
  const runtimeResponsePromise = page.waitForResponse((candidate) =>
    candidate.url().includes('/kovo-runtime.client.js'),
  );
  await page.goto('/');
  const runtimeResponse = await runtimeResponsePromise;
  expect(runtimeResponse.status()).toBe(200);
  await waitForDeferredRuntime(page);

  // SPEC §8 eligibility: same-origin, plain GET anchor, no target/download, no hash-only jump.
  const link = page.locator('#product-link');
  await expect(link).toHaveAttribute('href', '/products/sku-1?ref=home&sort=price+asc');
  expect(
    await link.evaluate((anchor: HTMLAnchorElement) => ({
      download: anchor.hasAttribute('download'),
      sameOrigin: new URL(anchor.href, location.href).origin === location.origin,
      target: anchor.getAttribute('target'),
    })),
  ).toEqual({ download: false, sameOrigin: true, target: null });
});

test('an eligible in-app navigation does not replace the document', async ({ page }) => {
  // Expected to FAIL until plans/good-perf.md O2 lands the structured document-part protocol (D2).
  // Playwright fails the run if this ever passes, so the fix cannot land without deleting the
  // marker — the defect cannot be fixed silently, and it cannot regress silently either.
  test.fail();

  await page.goto('/');
  await waitForDeferredRuntime(page);

  const homeDocumentUrl = page.url();
  await page.evaluate((sentinel) => {
    (globalThis as { __sentinel?: string }).__sentinel = sentinel;
  }, SENTINEL);

  await page.locator('#product-link').click();
  await expect(page.getByRole('heading', { name: 'Product sku-1' })).toBeVisible();

  const after = await page.evaluate(() => {
    const entry = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    return {
      navigationEntryName: entry?.name ?? null,
      navigationType: entry?.type ?? null,
      sentinel: (globalThis as { __sentinel?: string }).__sentinel ?? null,
    };
  });

  // The load-bearing assertion. A `location.assign` fallback destroys the JS realm, so a value set
  // before the click cannot survive it.
  expect(after.sentinel).toBe(SENTINEL);
  // Asserted because plans/good-perf.md O2 names it, but note it is NOT sufficient on its own: the
  // fallback path reports `navigate`, not `reload`, so this check passes even while the document is
  // being replaced.
  expect(after.navigationType).not.toBe('reload');
  // Direct proof that no new document was created: the navigation timing entry still describes the
  // document that was loaded for `/`, not the product URL.
  expect(after.navigationEntryName).toBe(homeDocumentUrl);
});
