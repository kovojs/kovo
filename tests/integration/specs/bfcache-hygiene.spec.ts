// SPEC.md §8/§9.3: bfcache-safe navigation uses pagehide/pageshow lifecycle
// hooks, keepalive enhanced mutations, and visible-return typed-read recovery.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'bfcache-hygiene' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const fetchLog: Array<{ keepalive: unknown; url: string }> = [];
    const pageShowLog: boolean[] = [];
    const errorLog: string[] = [];
    const originalAddEventListener = window.addEventListener.bind(window);
    const originalFetch = window.fetch.bind(window);

    Object.defineProperty(window, '__kovoNavLifecycle', {
      configurable: true,
      value: { errorLog, fetchLog, pageShowLog },
    });

    originalAddEventListener('pageshow', (event) => {
      pageShowLog.push(event.persisted);
    });
    originalAddEventListener('error', (event) => {
      errorLog.push(String(event.error?.message ?? event.message));
    });
    originalAddEventListener('unhandledrejection', (event) => {
      errorLog.push(String(event.reason?.message ?? event.reason));
    });

    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      fetchLog.push({ keepalive: init?.keepalive, url });
      return originalFetch(input, init);
    }) as typeof window.fetch;
  });
});

test('recovers server truth after bfcache restore without unload handlers', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');
  await page.waitForFunction(
    () =>
      (window as typeof window & { __bfcacheLifecycleReady?: boolean }).__bfcacheLifecycleReady ===
      true,
  );

  const panel = page.locator('#counter-panel');
  const count = page.locator('#counter-value');
  await expect(count).toHaveText('1');

  await page.getByRole('link', { name: 'Leave page' }).click();
  await expect(page.getByRole('heading', { name: 'Away' })).toBeVisible();
  await kovoApp.db.exec('update nav_lifecycle_counter set value = 5 where id = 1');

  const cleanRefetchResponse = page.waitForResponse(
    (response) => response.url().endsWith('/_q/navCounter') && response.status() === 200,
  );
  await page.goBack();
  const cleanResponse = await cleanRefetchResponse;
  await expect(cleanResponse.text()).resolves.toBe(
    '<kovo-query name="navCounter">{"value":5}</kovo-query>',
  );
  await expect(page.getByRole('heading', { name: 'Navigation lifecycle' })).toBeVisible();
  await expect(count).toHaveText('5');

  const cleanLifecycle = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __kovoNavLifecycle: { pageShowLog: boolean[] };
        }
      ).__kovoNavLifecycle,
  );
  // Chromium's Playwright/Vite fixture path can report persisted=false, but the
  // public browser path must still recover through the pageshow typed-read pass.
  expect(cleanLifecycle.pageShowLog.length).toBeGreaterThan(0);

  const mutationRequest = page.waitForRequest((request) =>
    request.url().endsWith('/_m/nav-lifecycle/increment'),
  );
  await page.getByRole('button', { name: 'Increment optimistically' }).click();
  await mutationRequest;

  await expect(count).toHaveText('7');
  await expect(panel).toHaveAttribute('kovo-pending', '');
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & { __bfcachePendingCount?: () => number }
        ).__bfcachePendingCount?.() ?? -1,
    ),
  ).toBe(1);
  const mutationFetchBeforeNavigation = await page.evaluate(() =>
    (
      window as typeof window & {
        __kovoNavLifecycle: { fetchLog: Array<{ keepalive: unknown; url: string }> };
      }
    ).__kovoNavLifecycle.fetchLog.find((entry) =>
      entry.url.includes('/_m/nav-lifecycle/increment'),
    ),
  );
  expect(mutationFetchBeforeNavigation?.keepalive).toBe(true);

  await page.getByRole('link', { name: 'Leave page' }).click();
  await expect(page.getByRole('heading', { name: 'Away' })).toBeVisible();

  await expect
    .poll(async () => {
      const rows = await kovoApp.db.query<{ value: number }>(
        'select value from nav_lifecycle_counter where id = 1',
      );
      return Number(rows[0]?.value);
    })
    .toBe(8);

  const refetchResponse = page.waitForResponse(
    (response) => response.url().endsWith('/_q/navCounter') && response.status() === 200,
  );
  await page.goBack();
  const response = await refetchResponse;
  await expect(response.text()).resolves.toBe(
    '<kovo-query name="navCounter">{"value":8}</kovo-query>',
  );

  await expect(page.getByRole('heading', { name: 'Navigation lifecycle' })).toBeVisible();
  await expect(count).toHaveText('8');
  await expect(panel).not.toHaveAttribute('kovo-pending', '');
  await expect(panel).not.toHaveAttribute('aria-busy', 'true');
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & { __bfcachePendingCount?: () => number }
        ).__bfcachePendingCount?.() ?? -1,
    ),
  ).toBe(0);

  const lifecycle = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __kovoNavLifecycle: {
            errorLog: string[];
            fetchLog: Array<{ keepalive: unknown; url: string }>;
            pageShowLog: boolean[];
          };
        }
      ).__kovoNavLifecycle,
  );
  const refetchFetch = lifecycle.fetchLog.find((entry) => entry.url.includes('/_q/navCounter'));
  expect(refetchFetch).toBeTruthy();
  expect(lifecycle.errorLog.filter((message) => !message.includes('WebSocket closed'))).toEqual([]);
});
