// SPEC.md §9.1/§10.3: duplicate Kovo-Idem submissions replay without re-running writes.
import { enhancedMutationHeaders } from '@kovojs/test/headers';
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'idempotent-mutation' });

test('replays duplicate idempotency keys without executing the write twice', async ({
  page,
  request,
  kovoApp,
}) => {
  await page.goto('/');
  const origin = new URL(page.url()).origin;
  const token = await page.locator('input[name="kovo-csrf"]').inputValue();
  const idem = await page.locator('input[name="Kovo-Idem"]').inputValue();
  const build = (await page.locator('meta[name="kovo-build"]').getAttribute('content')) ?? '';
  const target = page.locator('[kovo-fragment-target="idem-status"]');
  const targetName = (await target.getAttribute('kovo-fragment-target')) ?? '';
  const component = (await target.getAttribute('kovo-live-component')) ?? '';
  const attestation = (await target.getAttribute('kovo-live-token')) ?? '';
  const props = JSON.parse((await target.getAttribute('kovo-props')) ?? '{}') as Record<
    string,
    unknown
  >;
  const mutationHeaders = enhancedMutationHeaders({
    liveTargets: [{ attestation, component, props, target: targetName }],
    targets: [{ queries: 'idem', target: targetName }],
  });

  const first = await request.post('/_m/idempotent-mutation/record', {
    form: { note: 'first', 'kovo-csrf': token },
    headers: {
      ...mutationHeaders,
      'Kovo-Build': build,
      'Kovo-Idem': idem,
      'Kovo-Current-Url': page.url(),
      origin,
    },
  });
  const firstBody = await first.text();
  expect(first.status()).toBe(200);
  expect(firstBody).toContain('<output data-bind="idem.count"');
  expect(firstBody).toContain('>1</output>');

  const duplicate = await request.post('/_m/idempotent-mutation/record', {
    form: { note: 'first', 'kovo-csrf': token },
    headers: {
      ...mutationHeaders,
      'Kovo-Build': build,
      'Kovo-Idem': idem,
      'Kovo-Current-Url': page.url(),
      origin,
    },
  });
  expect(duplicate.status()).toBe(200);
  expect(await duplicate.text()).toBe(firstBody);

  const rows = await kovoApp.db.query('select count(*)::int as count from ledger_entries');
  expect(rows[0]).toEqual({ count: 1 });
});
