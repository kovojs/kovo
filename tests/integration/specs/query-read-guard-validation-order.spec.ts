// SPEC.md §6.5/§9.4: query arg validation runs before typed-read guards, but
// valid anonymous reads still take the guard failure path.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'query-read-guard-validation-order' });

test('validates typed-read search args before applying query guards', async ({ page, request }) => {
  const malformedAnonymous = await request.get('/_q/secret');
  expect(malformedAnonymous.status()).toBe(422);
  expect(await malformedAnonymous.json()).toEqual({
    code: 'VALIDATION',
    payload: { issues: [{ message: 'Expected string', path: ['id'] }] },
  });

  const validAnonymous = await request.get('/_q/secret?id=s1', { maxRedirects: 0 });
  expect(validAnonymous.status()).toBe(303);
  expect(validAnonymous.headers().location).toBe('/login?next=%2F_q%2Fsecret%3Fid%3Ds1');
  expect(await validAnonymous.text()).not.toContain('protected');

  await page.context().addCookies([
    {
      domain: '127.0.0.1',
      name: 'kovo_query_order_session',
      path: '/',
      value: 'ada',
    },
  ]);

  const malformedAuthed = await page.request.get('/_q/secret');
  expect(malformedAuthed.status()).toBe(422);
  expect(await malformedAuthed.json()).toEqual({
    code: 'VALIDATION',
    payload: { issues: [{ message: 'Expected string', path: ['id'] }] },
  });

  const validAuthed = await page.request.get('/_q/secret?id=s1');
  expect(validAuthed.status()).toBe(200);
  await expect(validAuthed.text()).resolves.toBe(
    '<kovo-query name="secret" key="secret:s1">{"id":"s1","owner":"ada","value":"protected"}</kovo-query>',
  );
});
