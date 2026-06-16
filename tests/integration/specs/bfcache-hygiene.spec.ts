// SPEC.md §8: the public browser path must avoid unload and keep enhanced mutations
// navigation-safe. Full pagehide/refetch coverage stays open until the inline loader
// emits those lifecycle hooks.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'bfcache-hygiene' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const listenerLog: string[] = [];
    const fetchLog: Array<{ keepalive: unknown; url: string }> = [];
    const originalAddEventListener = window.addEventListener.bind(window);
    const originalFetch = window.fetch.bind(window);

    Object.defineProperty(window, '__kovoNavLifecycle', {
      configurable: true,
      value: { fetchLog, listenerLog },
    });

    window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      listenerLog.push(type);
      return originalAddEventListener(type, listener, options);
    }) as typeof window.addEventListener;

    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      fetchLog.push({ keepalive: init?.keepalive, url });
      return originalFetch(input, init);
    }) as typeof window.fetch;
  });
});

test('avoids unload listeners and uses keepalive for enhanced mutations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Navigation lifecycle' })).toBeVisible();

  const listeners = await page.evaluate(() => (window as typeof window & { __kovoNavLifecycle: { listenerLog: string[] } }).__kovoNavLifecycle.listenerLog);
  expect(listeners).not.toContain('unload');
  expect(listeners).not.toContain('beforeunload');

  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith('/_m/nav-lifecycle/increment') && response.status() === 200,
    ),
    page.getByRole('button', { name: 'Increment' }).click(),
  ]);
  await expect(page.locator('#counter-value')).toHaveText('1');

  const fetchLog = await page.evaluate(
    () =>
      (window as typeof window & {
        __kovoNavLifecycle: { fetchLog: Array<{ keepalive: unknown; url: string }> };
      }).__kovoNavLifecycle.fetchLog,
  );
  const mutationFetch = fetchLog.find((entry) => entry.url.includes('/_m/nav-lifecycle/increment'));
  expect(mutationFetch?.keepalive).toBe(true);
});
