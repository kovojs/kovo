// SPEC §9.4 + §10.2: /_q reads coerce search args and emit canonical instance keys.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'query-args-search' });

test('typed read endpoint coerces query args from search params', async ({ request }) => {
  const response = await request.get('/_q/product?id=p1&max=7');
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe(
    '<kovo-query name="product:p1">{"id":"p1","max":7,"name":"Trail Boot"}</kovo-query>',
  );

  const defaulted = await request.get('/_q/product?id=p2');
  expect(defaulted.status()).toBe(200);
  expect(await defaulted.text()).toBe(
    '<kovo-query name="product:p2">{"id":"p2","max":10,"name":"Unknown"}</kovo-query>',
  );
});

test.skip('typed read endpoint rejects invalid query args without a server error', async ({
  request,
}) => {
  const invalid = await request.get('/_q/product?max=7');
  expect(invalid.status()).toBe(422);
  expect(await invalid.json()).toEqual({
    code: 'VALIDATION',
    payload: { issues: [{ message: 'Expected string', path: ['id'] }] },
  });
});
