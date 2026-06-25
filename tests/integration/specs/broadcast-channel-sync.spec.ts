import type { Page } from '@playwright/test';
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'broadcast-channel-sync' });

test('mutation query chunks rebroadcast to another same-user tab @race-prone', async ({
  context,
  page,
}) => {
  const other = await context.newPage();
  const otherMutationRequests: string[] = [];
  other.on('request', (request) => {
    if (request.url().includes('/_m/broadcast-channel-sync/publish')) {
      otherMutationRequests.push(request.url());
    }
  });

  await page.goto('/');
  await other.goto('/');
  await Promise.all([waitReady(page), waitReady(other)]);

  const pageStatus = page.locator('[data-bind="presence.status"]');
  const otherStatus = other.locator('[data-bind="presence.status"]');
  await expect(pageStatus).toHaveText('offline');
  await expect(otherStatus).toHaveText('offline');

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/_m/broadcast-channel-sync/publish') && response.status() === 200,
    ),
    page.getByRole('button', { name: 'Publish presence' }).click(),
  ]);

  await expect(pageStatus).toHaveText('online');
  await expect(otherStatus).toHaveText('online');
  expect(new URL(other.url()).pathname).toBe('/');
  expect(otherMutationRequests).toEqual([]);

  await other.close();
});

function waitReady(page: Page): Promise<unknown> {
  return page.waitForFunction(
    () =>
      (window as typeof window & { __broadcastSyncReady?: boolean }).__broadcastSyncReady === true,
  );
}
