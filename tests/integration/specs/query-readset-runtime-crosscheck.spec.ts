import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'query-readset-runtime-crosscheck' });

test('verifies query endpoint reads against declared read domains', async ({
  request,
  kovoApp,
}) => {
  const response = await request.get('/_q/readset-good');

  expect(response.status()).toBe(200);
  await expect(response.text()).resolves.toBe(
    '<kovo-query name="readset-good">{"name":"Keyboard"}</kovo-query>',
  );
  expect(kovoApp.verificationDiagnostics()).toEqual([]);
});

test('fails loudly when a query reads outside its declared readset', async ({ request }) => {
  const response = await request.get('/_q/readset-bad');

  expect(response.status()).toBe(500);
  const body = await response.text();
  expect(body).toContain('KV407');
  expect(body).toContain('audit');
});
