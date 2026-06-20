import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'streaming-chat' });

test('streams chat text through Kovo chunks and reconciles with server truth', async ({
  kovoApp,
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('[kovo-fragment-target="messages"] article')).toHaveCount(0);

  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/_m/chat/send') && response.status() === 200,
  );
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.locator('body')).toHaveAttribute(
    'data-rendered-markdown',
    /table.*code.*image/,
  );
  const response = await responsePromise;
  const wire = await response.text();

  expect(response.headers()['content-type']).toBe('text/vnd.kovo.fragment+html; charset=utf-8');
  expect(response.headers()['kovo-changes']).toBe('[{"domain":"chat"}]');
  expect(wire).toContain('<kovo-fragment target="messages" mode="append">');
  expect(wire).toContain('<kovo-text target="assistant:2">');
  expect(wire).toContain('<kovo-text target="assistant:2" mode="checkpoint">');
  expect((wire.match(/<kovo-text\b/g) ?? []).length).toBeLessThan(5);
  expect(wire).toContain('<kovo-done></kovo-done>');

  await expect(page.locator('[kovo-fragment-target="messages"] article')).toHaveCount(2);
  await expect(page.locator('[data-role="user"]')).toHaveText('show table');
  await expect(page.locator('[data-role="assistant"]')).toContainText(
    'Final answer for show table: table code image',
  );
  await expect(page.locator('[data-role="assistant"]')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('[data-role="assistant"]')).toHaveAttribute('aria-atomic', 'true');

  const rows = await kovoApp.db.query('select id, role, body from messages order by id');
  expect(rows).toEqual([
    { body: 'show table', id: 1, role: 'user' },
    { body: 'Final answer for show table: table code image', id: 2, role: 'assistant' },
  ]);
});

test('keeps no-JS and typed failure paths on the ordinary mutation vocabulary', async ({
  kovoApp,
  page,
  request,
}) => {
  const noJs = await request.post('/_m/chat/send', {
    form: { body: 'no js', turns: '1' },
    maxRedirects: 0,
  });
  expect(noJs.status()).toBe(303);
  expect(noJs.headers()['location']).toBe('/');

  await page.goto('/');
  await page.getByRole('textbox', { name: 'Message' }).fill('fail');
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith('/_m/chat/send') && response.status() === 422,
    ),
    page.getByRole('button', { name: 'Send' }).click(),
  ]);
  await expect(page.locator('[kovo-fragment-target="composer"] [role="alert"]')).toHaveAttribute(
    'data-error-code',
    'MODEL_UNAVAILABLE',
  );

  const rows = await kovoApp.db.query('select id, role, body from messages order by id');
  expect(rows).toEqual([
    { body: 'no js', id: 1, role: 'user' },
    { body: 'Final answer for no js: table code image', id: 2, role: 'assistant' },
  ]);
});

test('escapes model-streamed HTML/JS in the <kovo-text> wire (no LLM-output XSS)', async ({
  page,
}) => {
  // The LLM-output path is the highest-risk modern injection vector and had no
  // escaping assertion (testing-audit §4; plans/bugs-1.md F8/F10). Kovo owns the
  // escaped source buffer (SPEC §9.1) and never inserts model output as raw HTML.
  let dialogFired = false;
  page.on('dialog', (dialog) => {
    dialogFired = true;
    void dialog.dismiss().catch(() => {});
  });

  await page.goto('/');
  await page.getByRole('textbox', { name: 'Message' }).fill('xss-probe');
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/_m/chat/send') && response.status() === 200,
  );
  await page.getByRole('button', { name: 'Send' }).click();
  const wire = await (await responsePromise).text();

  // The model payload is HTML-escaped in the <kovo-text> chunk, so </kovo-text>
  // cannot break out and <img>/<script> cannot inject.
  expect(wire).toContain(
    '&lt;img src=x onerror=alert(1)&gt;&lt;/kovo-text&gt;&lt;script&gt;alert(2)&lt;/script&gt;',
  );
  expect(wire).not.toContain('<img src=x onerror=alert(1)>');
  expect(wire).not.toContain('</kovo-text><script>alert(2)');

  // Reconcile to server truth: nothing executed, no element injected.
  await expect(page.locator('[data-role="assistant"]')).toContainText('Final answer for xss-probe');
  await expect(page.locator('[kovo-fragment-target="messages"] img')).toHaveCount(0);
  await expect(page.locator('[kovo-fragment-target="messages"] script')).toHaveCount(0);
  expect(dialogFired).toBe(false);
});

test('marks a streamed assistant source failed when the response aborts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Message' }).fill('abort');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.locator('[data-stream-text="assistant:2"]')).toHaveAttribute(
    'data-stream-state',
    'error',
  );
});
