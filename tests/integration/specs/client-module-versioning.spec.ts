// SPEC.md §4.3/§6.6: handler refs use readable versioned module URLs, and old
// documents can import those immutable /c/ modules on first interaction.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'client-module-versioning' });

test('serves readable versioned client modules used by on:* refs', async ({
  kovoApp,
  page,
  request,
}) => {
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Load versioned module' });
  const handlerRef = await button.getAttribute('on:click');
  const moduleHref = handlerRef?.split('#')[0] ?? '';
  expect(moduleHref).toMatch(/^\/c\/__v\/[a-f0-9]+\/versioned\.client\.js$/u);

  const moduleResponse = await request.get(moduleHref);
  expect(moduleResponse.status()).toBe(200);
  expect(moduleResponse.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(moduleResponse.headers()['content-type']).toBe('text/javascript; charset=utf-8');
  expect(await moduleResponse.text()).toContain('export function mark');

  await expect(button).toHaveAttribute('on:click', `${moduleHref}#mark`);
  await expect(button).toHaveAttribute('data-kovo-module-allowlist', moduleHref);

  await button.click();
  await expect(page.locator('[data-client-version]')).toHaveText('loaded:a1b2c3d4');

  expect(await kovoApp.semantic('main', { keepAttrs: ['on:click'] })).toMatchSnapshot(
    'client-module-versioning.semantic.txt',
  );
});
