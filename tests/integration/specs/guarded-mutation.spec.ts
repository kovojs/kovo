// SPEC §6.5 + §10.3: unauthenticated mutation guard failures use the auth
// redirect vocabulary, while signed-in writes still run through server truth.
import { csrfToken } from '@kovojs/server';
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'guarded-mutation' });

const csrf = {
  secret: 'guarded-mutation-csrf-secret-key-0123456789',
  sessionId: () => 'guarded-mutation-fixture-session',
};

test('guarded mutation reauths anonymous submits and permits signed-in writes', async ({
  request,
  page,
  kovoApp,
}) => {
  const token = csrfToken({} as Request, csrf, { audience: 'guarded-mutation/increment' });

  await page.goto('/');
  const origin = new URL(page.url()).origin;
  await expect(page.locator('[data-count]')).toHaveText('0');

  const enhancedDenied = await request.post('/_m/guarded-mutation/increment', {
    form: { 'kovo-csrf': token },
    headers: {
      'Kovo-Fragment': 'true',
      'Kovo-Targets': 'guarded-count',
      origin,
    },
  });

  expect(enhancedDenied.status()).toBe(401);
  expect(enhancedDenied.headers()['kovo-reauth']).toBe('/login?next=%2F');
  expect(await enhancedDenied.text()).toBe('');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('[data-count]')).toHaveText('0');
  await expect(kovoApp.db.query('select count from guarded_counter where id = 1')).resolves.toEqual(
    [{ count: 0 }],
  );

  const noJsDenied = await request.post('/_m/guarded-mutation/increment', {
    form: { 'kovo-csrf': token },
    headers: { origin, Referer: '/' },
    maxRedirects: 0,
  });
  expect(noJsDenied.status()).toBe(303);
  expect(noJsDenied.headers().location).toBe('/login?next=%2F');

  await page.context().addCookies([
    {
      name: 'kovo_guarded_mutation_session',
      value: encodeURIComponent('ada@example.com'),
      domain: '127.0.0.1',
      path: '/',
    },
  ]);

  const allowedResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/_m/guarded-mutation/increment') && response.status() === 200,
  );
  await page.getByRole('button', { name: 'Increment protected counter' }).click();
  await allowedResponsePromise;

  await expect(page.locator('[data-count]')).toHaveText('1');
  await expect(kovoApp.db.query('select count from guarded_counter where id = 1')).resolves.toEqual(
    [{ count: 1 }],
  );
});
