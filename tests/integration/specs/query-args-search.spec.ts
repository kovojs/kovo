// SPEC §9.4 + §10.2: /_q reads coerce search args and emit canonical instance keys.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'query-args-search' });

test('typed read endpoint coerces search args and returns the canonical instance key', async ({
  page,
}) => {
  await page.goto('/?id=p1&max=200');
  await expect(page.locator('script[kovo-query="product"][key="product:p1"]')).toHaveCount(1);
  await expect(page.locator('[data-product]')).toHaveText('p1:Pen:true');

  const response = await page.request.get('/_q/product?id=p2&max=800');
  expect(response.status()).toBe(200);
  await expect(response.text()).resolves.toBe(
    '<kovo-query name="product:p2">{"id":"p2","name":"Notebook","price":799,"withinBudget":true}</kovo-query>',
  );

  const coercedDefault = await page.request.get('/_q/product?id=p1');
  expect(coercedDefault.status()).toBe(200);
  await expect(coercedDefault.text()).resolves.toContain(
    '<kovo-query name="product:p1">{"id":"p1","name":"Pen","price":199,"withinBudget":true}</kovo-query>',
  );
});

test('typed read endpoint rejects invalid query args without a server error', async ({
  request,
}) => {
  const invalid = await request.get('/_q/product?max=7');
  expect(invalid.status()).toBe(422);
  expect(await invalid.json()).toEqual({
    code: 'VALIDATION',
    payload: { issues: [{ message: 'Expected string', path: ['id'] }] },
  });
});
