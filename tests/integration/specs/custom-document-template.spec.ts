// SPEC.md §9.5: app document templates receive assembled shell parts, so custom
// chrome can wrap the document while preserving the loader and body content.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'custom-document-template' });

test('wraps assembled document parts and keeps client interaction working', async ({
  kovoApp,
  page,
  request,
}) => {
  const raw = await request.get('/');
  expect(raw.status()).toBe(200);
  const html = await raw.text();
  expect(html.startsWith('<!doctype html><html lang="en-GB" data-template="custom">')).toBeTruthy();
  expect(html).toContain('<header role="banner">Custom Chrome</header>');
  expect(html).toContain('installInlineKovoLoader');
  expect(html).toContain('data-kovo-csp-hash=');
  expect(html).toContain('on:click="/client.ts#mark"');

  await page.goto('/');
  await expect(page.getByRole('banner')).toHaveText('Custom Chrome');
  await page.getByRole('button', { name: 'Run client handler' }).click();
  await expect(page.locator('[data-template-result]')).toHaveText('handler ran');

  expect(
    await kovoApp.semantic('html', { keepAttrs: ['data-template', 'on:click'] }),
  ).toMatchSnapshot('custom-document-template.semantic.txt');
});
