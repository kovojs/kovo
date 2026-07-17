// SPEC.md §6.4: respond.file() keeps route guards, attachment headers, and
// If-None-Match handling while bypassing HTML rendering.
import { headerValues } from '@kovojs/test/headers';
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'respond-file' });

test('guarded file response returns attachment headers and supports ETag 304', async ({
  request,
}) => {
  const anonymous = await request.get('/downloads/orders.pdf', { maxRedirects: 0 });
  expect(anonymous.status()).toBe(303);

  const authorized = await request.get('/downloads/orders.pdf', {
    headers: { cookie: 'respond_file_session=1' },
  });
  expect(authorized.status()).toBe(200);
  const authorizedHeaders = authorized.headers();
  expect(headerValues(authorizedHeaders, 'content-type')).toEqual(['application/pdf']);
  expect(headerValues(authorizedHeaders, 'content-disposition')).toEqual([
    'attachment; filename="orders.pdf"',
  ]);
  expect(headerValues(authorizedHeaders, 'etag')).toEqual(['"orders-pdf-v1"']);
  expect(headerValues(authorizedHeaders, 'x-content-type-options')).toEqual(['nosniff']);
  expect(await authorized.text()).toBe('%PDF-1.7\n');

  const notModified = await request.get('/downloads/orders.pdf', {
    headers: {
      cookie: 'respond_file_session=1',
      'if-none-match': '"orders-pdf-v1"',
    },
  });
  expect(notModified.status()).toBe(304);
  expect(await notModified.text()).toBe('');
});

test('download filenames neutralize bidi overrides in browser download UX', async ({
  kovoApp,
  page,
}) => {
  await page
    .context()
    .addCookies([{ name: 'respond_file_session', url: kovoApp.origin, value: '1' }]);
  await page.setContent(
    `<a id="bidi-download" href="${kovoApp.origin}/downloads/bidi-file">download</a>`,
  );

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#bidi-download').click(),
  ]);
  expect(download.suggestedFilename()).toBe('invoice_fdp.exe');
});
