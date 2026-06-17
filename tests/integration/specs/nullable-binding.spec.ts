import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'nullable-binding' });

async function submit(page: import('@kovojs/test/internal/integration').Page, name: string): Promise<void> {
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/_m/nullable-binding/')),
    page.getByRole('button', { name }).click(),
  ]);
}

test('keeps optional text and attribute bindings empty or removed across SSR and updates', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');

  const serverText = page.locator('deal-card [data-bind="deal.contact?.name"]');
  const serverLink = page.locator('deal-card [data-bind\\:href="deal.contact?.name"]');
  await expect(serverText).toHaveText('');
  await expect(serverLink).not.toHaveAttribute('href');
  await expect(serverLink).not.toHaveAttribute('aria-label');

  await submit(page, 'Fill server contact');
  await expect(serverText).toHaveText('Server Contact');
  await expect(serverLink).toHaveAttribute('href', 'Server Contact');
  await expect(serverLink).toHaveAttribute('aria-label', 'Server Contact');

  await submit(page, 'Clear server contact');
  await expect(serverText).toHaveText('');
  await expect(serverLink).not.toHaveAttribute('href');
  await expect(serverLink).not.toHaveAttribute('aria-label');

  const stateText = page.locator('nullable-state [data-bind="state.contact?.name"]');
  const stateLink = page.locator('nullable-state [data-bind\\:href="state.contact?.name"]');
  await expect(stateText).toHaveText('');
  await expect(stateLink).not.toHaveAttribute('href');

  await page.getByRole('button', { name: 'Fill state contact' }).click();
  await expect(stateText).toHaveText('Client Contact');
  await expect(stateLink).toHaveAttribute('href', 'Client Contact');
  await expect(stateLink).toHaveAttribute('aria-label', 'Client Contact');

  await page.getByRole('button', { name: 'Clear state contact' }).click();
  await expect(stateText).toHaveText('');
  await expect(stateLink).not.toHaveAttribute('href');
  await expect(stateLink).not.toHaveAttribute('aria-label');

  const rows = await kovoApp.db.query('select contact_name from deal where id = 1');
  expect(rows[0]).toEqual({ contact_name: null });

  expect(
    await kovoApp.semantic('deal-card', {
      keepAttrs: ['data-bind:aria-label', 'data-bind:href'],
    }),
  ).toMatchSnapshot('deal-card.semantic.txt');
  expect(
    await kovoApp.semantic('nullable-state', {
      keepAttrs: ['data-bind:aria-label', 'data-bind:href'],
    }),
  ).toMatchSnapshot('nullable-state.semantic.txt');
});
