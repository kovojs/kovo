// SPEC.md §9.5: the default request shell assembles a complete document, and
// SPEC.md §4.2: initial query JSON is present before its consumers.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'document-shell' });

test('assembles the default document shell around route content', async ({
  kovoApp,
  page,
  request,
}) => {
  const raw = await request.get('/');
  expect(raw.status()).toBe(200);
  expect(raw.headers()['content-type']).toBe('text/html; charset=utf-8');

  const html = await raw.text();
  expect(html.startsWith('<!doctype html><html lang="en-US">')).toBeTruthy();
  expect(html).toContain('<title>Document Shell</title>');
  expect(html).toContain('<script>');
  expect(html).toContain('kovo-query="shell"');

  const queryIndex = html.indexOf('kovo-query="shell"');
  const consumerIndex = html.indexOf('kovo-deps="shell"');
  expect(queryIndex).toBeGreaterThan(-1);
  expect(consumerIndex).toBeGreaterThan(queryIndex);

  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle('Document Shell');
  await expect(page.getByRole('heading', { name: 'Document Shell' })).toBeVisible();
  await expect(page.locator('[data-bind="shell.message"]')).toHaveText('Shell ready');

  expect(await kovoApp.semantic('html')).toMatchSnapshot('document-shell.semantic.txt');
});
