// SPEC.md §9.2/§10.3: unexpected handler failures roll back transactional
// writes and return stable no-internals error responses.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'mutation-handler-failure-rollback' });

test('rolls back writes and sanitizes enhanced and no-js mutation failures', async ({
  kovoApp,
  request,
}) => {
  const enhanced = await request.post('/_m/rollback/fail-after-write', {
    form: { note: 'enhanced' },
    headers: {
      'Kovo-Fragment': 'true',
      'Kovo-Targets': 'rollback-status',
    },
  });
  expect(enhanced.status()).toBe(500);
  await expect(enhanced.text()).resolves.toBe(
    '<kovo-fragment target="rollback-status"><output role="alert" data-error-code="SERVER_ERROR">Internal Server Error</output></kovo-fragment>',
  );

  let rows = await kovoApp.db.query('select note from rollback_events order by id');
  expect(rows).toEqual([]);

  const noJs = await request.post('/_m/rollback/fail-after-write', {
    form: { note: 'no-js' },
  });
  expect(noJs.status()).toBe(500);
  const noJsBody = await noJs.text();
  expect(noJsBody).toBe('Internal Server Error');
  expect(noJsBody).not.toContain('internal stack detail');

  rows = await kovoApp.db.query('select note from rollback_events order by id');
  expect(rows).toEqual([]);
});
