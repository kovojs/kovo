// SPEC §6.5: a null or undefined provider result is anonymous and takes the
// normal unauthenticated path without a server error.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'session-null-anonymous' });

test('null and undefined provider results behave as anonymous sessions', async ({ request }) => {
  for (const mode of ['null', 'undefined']) {
    const publicResponse = await request.get(`/public?mode=${mode}`);
    expect(publicResponse.status()).toBe(200);
    await expect(publicResponse.text()).resolves.toContain('<p data-session>anonymous</p>');

    const guardedResponse = await request.get(`/account?mode=${mode}`, { maxRedirects: 0 });
    expect(guardedResponse.status()).toBe(303);
    expect(guardedResponse.headers().location).toBe(`/login?next=%2Faccount%3Fmode%3D${mode}`);
    await expect(guardedResponse.text()).resolves.not.toContain('Internal Server Error');
  }

  const authedResponse = await request.get('/account?mode=user');
  expect(authedResponse.status()).toBe(200);
  await expect(authedResponse.text()).resolves.toContain('ada@example.com');
});
