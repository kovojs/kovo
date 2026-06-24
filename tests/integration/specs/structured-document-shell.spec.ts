// SPEC.md §9.5: structured document primitives add app chrome while Kovo owns
// the required document shell, loader, query scripts, and body content.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'structured-document-shell' });

test('wraps assembled document parts and keeps client interaction working', async ({
  kovoApp,
  page,
  request,
}) => {
  const raw = await request.get('/');
  expect(raw.status()).toBe(200);
  const html = await raw.text();
  expect(html.startsWith('<!doctype html><html lang="en-GB" data-document="structured">')).toBe(
    true,
  );
  expect(html).toContain('<meta content="structured" name="kovo-document">');
  expect(html).toContain('<header role="banner">Custom Chrome</header>');
  expect(html).toContain('installInlineKovoBootstrap');
  expect(html).toContain('data-kovo-csp-hash=');
  expect(html).toContain('on:click="/client.ts#mark"');

  await page.goto('/');
  await expect(page.getByRole('banner')).toHaveText('Custom Chrome');
  await page.getByRole('button', { name: 'Run client handler' }).click();
  await expect(page.locator('[data-document-result]')).toHaveText('handler ran');

  expect(
    await kovoApp.semantic('html', { keepAttrs: ['data-document', 'on:click'] }),
  ).toMatchSnapshot('structured-document-shell.semantic.txt');
});
