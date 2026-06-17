// SPEC.md §6.3/§9.2: validation failures are typed wire errors with field paths.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'validation-field-errors' });

test('schema validation failures morph field-scoped 422 errors and skip the write', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');

  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/_m/validation/reserve') && response.status() === 422,
  );
  await page.getByRole('button', { name: 'Reserve' }).click();
  const response = await responsePromise;

  await expect(page.locator('[data-error-path="quantity"]')).toHaveText('Expected number >= 1');
  expect(response.headers()['content-type']).toBe('text/vnd.kovo.fragment+html; charset=utf-8');
  expect(new URL(page.url()).pathname).toBe('/');

  const rows = await kovoApp.db.query('select count(*)::int as count from reservations');
  expect(rows[0]).toEqual({ count: 0 });

  expect(await kovoApp.semantic('[kovo-fragment-target="reservation-form"]')).toMatchSnapshot(
    'reservation-form-error.semantic.txt',
  );
});
