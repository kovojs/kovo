// I2: the login() helper establishes an authenticated session through the rendered
// sign-in form, so a guards.authed() route renders the signed-in user.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'auth' });

test('login() reaches a guarded route as the signed-in user', async ({ page, kovoApp }) => {
  await kovoApp.login({
    fields: { email: 'ada@example.com', password: 'correct' },
    submit: 'Sign in',
  });

  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
  await expect(page.getByText('Signed in as ada@example.com')).toBeVisible();
});

test('the guarded route does not leak account content when signed out', async ({ page }) => {
  await page.goto('/account');
  // guards.authed() denies the unauthenticated request, so the signed-in user is
  // never rendered (the security property; the exact denied-response shape is the
  // framework's to decide).
  await expect(page.getByText('ada@example.com')).toHaveCount(0);
});

test('login → authed request → logout round-trip clears the session (testing-audit §4)', async ({
  page,
  kovoApp,
}) => {
  await kovoApp.login({
    fields: { email: 'ada@example.com', password: 'correct' },
    submit: 'Sign in',
  });

  // Authed request renders the account.
  await page.goto('/account');
  await expect(page.getByText('Signed in as ada@example.com')).toBeVisible();

  // Logout clears the session cookie via the enhanced mutation.
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/_m/auth/sign-out') && r.status() < 400),
    page.getByRole('button', { name: 'Sign out' }).click(),
  ]);

  // The next request to the guarded route no longer renders the account.
  await page.goto('/account');
  await expect(page.getByText('ada@example.com')).toHaveCount(0);
});

test('session-dependent route documents are no-store, guarded or not (bugs-1 F34; bugz-3 L2)', async ({
  page,
  kovoApp,
}) => {
  await kovoApp.login({
    fields: { email: 'ada@example.com', password: 'correct' },
    submit: 'Sign in',
  });

  // The guarded /account document renders session-dependent content, so it must be
  // no-store — the browser's bfcache cannot restore it after logout without the guard.
  const guarded = await page.request.get('/account');
  expect(guarded.status()).toBe(200);
  expect(guarded.headers()['cache-control']).toBe('no-store');

  // bugz-3 L2: the unguarded /login document still resolves the signed-in session and stamps a
  // kovo-session fingerprint, so it is session-dependent even without a route guard.
  const unguarded = await page.request.get('/login');
  expect(unguarded.status()).toBe(200);
  expect(unguarded.headers()['cache-control']).toBe('no-store');
  expect(unguarded.headers().vary).toBe('Cookie');
});

test('documents stamp an opaque per-session fingerprint for broadcast scoping (bugs-1 F13)', async ({
  page,
  kovoApp,
}) => {
  await kovoApp.login({
    fields: { email: 'ada@example.com', password: 'correct' },
    submit: 'Sign in',
  });

  const html = await (await page.request.get('/account')).text();
  const match = html.match(/<meta name="kovo-session" content="([^"]+)">/);
  expect(match, 'document carries a kovo-session fingerprint meta').not.toBeNull();
  expect((match?.[1] ?? '').length).toBeGreaterThan(0);

  // The fingerprint is stable for the same session (so same-user tabs still sync).
  const again = await (await page.request.get('/account')).text();
  expect(again).toContain(`<meta name="kovo-session" content="${match?.[1]}">`);
});
