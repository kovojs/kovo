import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'binding-text-attr' });

test('updates text and attribute bindings from current server and state surfaces', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');

  const queryOutput = page.locator('binding-card > output');
  const queryButton = page.locator('binding-card > button[type="button"]');
  await expect(queryOutput).toHaveText('Initial text');
  await expect(queryButton).toHaveAttribute('aria-label', 'Initial card');
  await expect(queryButton).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('script[kovo-query="card"]')).toHaveCount(1);

  const mutationResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/_m/binding-text-attr/update') && response.status() === 200,
  );
  await page.getByRole('button', { name: 'Update server card' }).click();
  const mutationResponse = await mutationResponsePromise;
  const mutationBody = await mutationResponse.text();
  expect(mutationBody).toMatch(/<kovo-query name="card"[^>]*>/u);
  expect(mutationBody).toContain('<kovo-fragment target="binding-card">');

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

  const bindingCardSemantic = await kovoApp.semantic('binding-card', {
    keepAttrs: ['data-bind:aria-label', 'data-bind:data-state'],
  });
  expect(bindingCardSemantic).toContain('aria-label="Updated card"');
  expect(bindingCardSemantic).toContain('data-state="ready"');
  expect(bindingCardSemantic).toMatch(/data-bind:aria-label="card\.BindingCard\$/u);
  expect(bindingCardSemantic).toMatch(/data-bind:data-state="card\.BindingCard\$/u);
  expect(
    await kovoApp.semantic('state-binding-panel', {
      keepAttrs: ['data-bind:aria-label', 'data-bind:data-state'],
    }),
  ).toMatchSnapshot('state-binding-panel.semantic.txt');
});
