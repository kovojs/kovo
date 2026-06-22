// SPEC.md §10.1/§10.3: request-time owner scoping prevents an owner-scoped
// query path from serving rows outside the resolved session.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'unscoped-owner-fixture' });

test('owner-scoped route and typed read only expose rows for the session owner', async ({
  page,
  request,
}) => {
  const anonymous = await request.get('/invoice?id=inv-u1', { maxRedirects: 0 });
  expect(anonymous.status()).toBe(303);

  await page
    .context()
    .addCookies([{ domain: '127.0.0.1', name: 'owner_user', path: '/', value: 'u1' }]);

  await page.goto('/invoice?id=inv-u1');
  await expect(page.locator('[data-invoice]')).toHaveText('u1:inv-u1:$31');

  await page.goto('/invoice?id=inv-u2');
  await expect(page.locator('[data-denied]')).toHaveText('not-found');
  await expect(page.locator('main')).not.toContainText('u2:inv-u2');

  const ownQuery = await page.request.get('/_q/owner-invoice?id=inv-u1');
  expect(ownQuery.status()).toBe(200);
  await expect(ownQuery.text()).resolves.toContain(
    '<kovo-query name="owner-invoice" key="owner-invoice:inv-u1">{"invoice":{"id":"inv-u1","owner_id":"u1","total":31}}</kovo-query>',
  );

  const crossOwnerQuery = await page.request.get('/_q/owner-invoice?id=inv-u2');
  expect(crossOwnerQuery.status()).toBe(200);
  await expect(crossOwnerQuery.text()).resolves.toBe(
    '<kovo-query name="owner-invoice" key="owner-invoice:inv-u2">{"invoice":null}</kovo-query>',
  );
});
