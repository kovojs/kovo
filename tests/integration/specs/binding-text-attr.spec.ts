import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'binding-text-attr' });

test('updates text and attribute bindings from current server and state surfaces', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');

  const queryOutput = page.locator('binding-card [data-bind="card.text"]');
  const queryButton = page.locator('binding-card [data-bind\\:aria-label="card.label"]');
  await expect(queryOutput).toHaveText('Initial text');
  await expect(queryButton).toHaveAttribute('aria-label', 'Initial card');
  await expect(queryButton).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('script[kovo-query="card"]')).toHaveCount(1);

  await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith('/_m/binding-text-attr/update') && response.status() === 200,
    ),
    page.getByRole('button', { name: 'Update server card' }).click(),
  ]);

  await expect(queryOutput).toHaveText('Updated text');
  await expect(queryButton).toHaveAttribute('aria-label', 'Updated card');
  await expect(queryButton).toHaveAttribute('data-state', 'ready');
  expect(new URL(page.url()).pathname).toBe('/');

  const stateOutput = page.locator('state-binding-panel [data-bind="state.text"]');
  const stateButton = page.locator('state-binding-panel [data-bind\\:aria-label="state.label"]');
  await expect(stateOutput).toHaveText('Client initial');
  await expect(stateButton).toHaveAttribute('aria-label', 'Client initial card');

  await stateButton.click();
  await expect(stateOutput).toHaveText('Client text');
  await expect(stateButton).toHaveAttribute('aria-label', 'Client card');
  await expect(stateButton).toHaveAttribute('data-state', 'ready');

  const rows = await kovoApp.db.query('select text, label, status from card_state where id = 1');
  expect(rows[0]).toEqual({ label: 'Updated card', status: 'ready', text: 'Updated text' });

  expect(
    await kovoApp.semantic('binding-card', {
      keepAttrs: ['data-bind:aria-label', 'data-bind:data-state'],
    }),
  ).toMatchSnapshot('binding-card.semantic.txt');
  expect(
    await kovoApp.semantic('state-binding-panel', {
      keepAttrs: ['data-bind:aria-label', 'data-bind:data-state'],
    }),
  ).toMatchSnapshot('state-binding-panel.semantic.txt');
});
