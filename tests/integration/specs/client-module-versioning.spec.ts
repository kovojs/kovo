// SPEC.md §4.3/§6.6: handler refs use readable versioned module URLs, and old
// documents can import those immutable /c/ modules on first interaction.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'client-module-versioning' });

test('serves readable versioned client modules used by on:* refs', async ({
  kovoApp,
  page,
  request,
}) => {
  const moduleResponse = await request.get('/c/versioned.client.js?v=a1b2c3d4');
  expect(moduleResponse.status()).toBe(200);
  expect(moduleResponse.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(moduleResponse.headers()['content-type']).toBe('text/javascript; charset=utf-8');
  expect(await moduleResponse.text()).toContain('export function mark');

  await page.goto('/');
  const button = page.getByRole('button', { name: 'Load versioned module' });
  await expect(button).toHaveAttribute(
    'on:click',
    '/c/versioned.client.js?v=a1b2c3d4#mark',
  );

  await button.click();
  await expect(page.locator('[data-client-version]')).toHaveText('loaded:a1b2c3d4');

  expect(await kovoApp.semantic('main', { keepAttrs: ['on:click'] })).toMatchSnapshot(
    'client-module-versioning.semantic.txt',
  );
});
