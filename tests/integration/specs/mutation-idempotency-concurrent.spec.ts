// SPEC.md §9.1/§10.3: simultaneous enhanced submissions with one Kovo-Idem
// execute once and replay the reserved response to the duplicate.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'mutation-idempotency-concurrent' });

test('coalesces concurrent duplicate enhanced mutation submissions', async ({
  page,
  request,
  kovoApp,
}) => {
  await page.goto('/');
  const origin = new URL(page.url()).origin;
  const token = await page.locator('input[name="kovo-csrf"]').inputValue();
  // SPEC.md §10.3: replay authority is a canonical server-stamped token. Preserve
  // the form's issued-at component while exercising two requests with the same token.
  const idem = await page.locator('input[name="Kovo-Idem"]').inputValue();
  const target = page.locator('[kovo-fragment-target="idem-concurrent-status"]');
  const liveTarget = [
    await target.getAttribute('kovo-fragment-target'),
    '#',
    await target.getAttribute('kovo-live-component'),
    '@',
    await target.getAttribute('kovo-live-token'),
    ':',
    (await target.getAttribute('kovo-props')) ?? '{}',
  ].join('');
  const post = () =>
    request.post('/_m/mutation-idempotency-concurrent/record', {
      form: { note: 'race', 'kovo-csrf': token },
      headers: {
        'Kovo-Fragment': 'true',
        'Kovo-Idem': idem,
        'Kovo-Current-Url': page.url(),
        'Kovo-Live-Targets': liveTarget,
        'Kovo-Targets': 'idem-concurrent-status=idem',
        origin,
      },
    });

  const [first, duplicate] = await Promise.all([post(), post()]);
  expect(first.status()).toBe(200);
  expect(duplicate.status()).toBe(200);
  expect(first.headers()['kovo-idem']).toBe(idem);
  expect(duplicate.headers()['kovo-idem']).toBe(idem);

  const [firstBody, duplicateBody] = await Promise.all([first.text(), duplicate.text()]);
  expect(firstBody).toBe(duplicateBody);
  expect(firstBody).toContain('<output data-bind="idem.count"');
  expect(firstBody).toContain('>1</output>');

  const rows = await kovoApp.db.query(
    'select count(*)::int as count, array_agg(note order by note) as notes from concurrent_entries',
  );
  expect(rows[0]).toEqual({ count: 1, notes: ['race'] });
});
