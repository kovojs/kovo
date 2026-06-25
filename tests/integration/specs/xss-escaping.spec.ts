import { expect, test } from '@kovojs/test/internal/integration';

// Output-safety conformance (SPEC §4.8/§5.2 #10 / KV236, §9.1 script-data encoding;
// plans/bugs-1.md F7/F8, plans/bugs-and-testing.md C1). Asserts user/model-controlled
// HTML metacharacters and a `javascript:` URL are neutralized across every render
// path — server text/attr render, the JSON island, the mutation wire payload, and
// the client update plan — with NO script execution. Locks in the behavior the
// integration suite never covered (testing-audit §4).
test.use({ kovoFixture: 'xss-escaping' });

test('neutralizes injected HTML/JS across server render, JSON island, wire, and client binding', async ({
  page,
  kovoApp,
}) => {
  // Any executed payload would surface as a dialog; there must be none, ever.
  let dialogFired = false;
  page.on('dialog', (dialog) => {
    dialogFired = true;
    void dialog.dismiss().catch(() => {});
  });

  // --- Initial load: raw served bytes ---
  const response = await page.goto('/');
  const homeHtml = (await response?.text()) ?? '';

  // F8: <script type="application/json"> JSON island is HTML script-data, so `<` is
  // escaped as the JSON unicode escape < (NOT &lt;, which would not decode here) —
  // the seeded </script><script> cannot end the script element early.
  expect(homeHtml).toContain('\\u003c/script>\\u003cscript>alert(2)\\u003c/script>');
  // The raw break-out sequence must NOT survive inside the island payload.
  expect(homeHtml).not.toContain('</script><script>alert(2)</script>');
  // Server text binding (escapeHtml) renders the payload as entities, not markup.
  expect(homeHtml).toContain('&lt;/script&gt;&lt;script&gt;alert(2)&lt;/script&gt;');

  // DOM: the bound text is literal text content, not parsed elements.
  const boundText = page.locator('xss-card output[data-bind="payload.text"]');
  await expect(boundText).toHaveText('</script><script>alert(2)</script>');
  const authoredTsxOutput = page.locator(
    '#tsx-authored-output-context tsx-xss-card output[data-bind="payload.text"]',
  );
  await expect(authoredTsxOutput).toHaveText('&lt;/script&gt;&lt;script&gt;alert(2)&lt;/script&gt;');
  await expect(page.locator('#tsx-authored-output-context script')).toHaveCount(0);
  expect(homeHtml).toContain('<tsx-xss-card');
  expect(homeHtml).toContain('&amp;lt;/script&amp;gt;&amp;lt;script&amp;gt;alert(2)');
  // Seeded href is the safe value as-is.
  await expect(page.locator('xss-card a[data-bind\\:href="payload.url"]')).toHaveAttribute(
    'href',
    'https://example.com',
  );

  // --- Mutation: drive XSS values through the wire + client update plan ---
  const mutationResponsePromise = page.waitForResponse(
    (r) => r.url().endsWith('/_m/xss/update') && r.status() === 200,
  );
  await page.getByRole('button', { name: 'Inject' }).click();
  const wire = await (await mutationResponsePromise).text();

  // Wire <kovo-query> JSON escapes `<`/`>` (renderQueryWireHtml → escapeHtml).
  expect(wire).toContain('<kovo-query name="payload">');
  expect(wire).toContain('&lt;img src=x onerror=');
  expect(wire).not.toContain('<img src=x onerror=');

  // Client text binding writes via textContent → the <img> is inert literal text.
  await expect(boundText).toHaveText('<img src=x onerror="alert(1)">');
  await expect(page.locator('xss-card output[data-bind="payload.text"] img')).toHaveCount(0);

  // F7 URL-scheme allowlist: client attribute binding routes href through
  // kovoSafeUrl, which rewrites the javascript: scheme to a safe `#`.
  await expect(page.locator('xss-card a[data-bind\\:href="payload.url"]')).toHaveAttribute(
    'href',
    '#',
  );

  // Server truth holds the RAW value (escaping is presentation-only, never mutates data).
  const rows = await kovoApp.db.query('select text, url from xss_payload where id = 1');
  expect(rows[0]).toEqual({ text: '<img src=x onerror="alert(1)">', url: 'javascript:alert(1)' });

  // No payload ever executed.
  expect(dialogFired).toBe(false);
});
