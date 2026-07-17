// SPEC §5.2 rule 11: pair-dependent HTML sinks follow browser-effective first-attribute
// semantics after ASCII case folding, including attributes reconstructed from dynamic TSX spreads.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'meta-refresh-sink' });

const attackerUrl = 'https://attacker.example/phish';

function probeUrl(origin: string, order: string, target: string): string {
  const url = new URL('/meta-refresh', origin);
  url.searchParams.set('order', order);
  url.searchParams.set('target', target);
  return url.href;
}

test('removes external refresh content for the browser-effective attacker-first duplicate', async ({
  kovoApp,
  page,
  request,
}) => {
  let attackerRequests = 0;
  await page.route('https://attacker.example/**', async (route) => {
    attackerRequests += 1;
    await route.fulfill({ body: '<title>ATTACKER LANDED</title>', contentType: 'text/html' });
  });

  const attackFirstUrl = probeUrl(kovoApp.origin, 'attack-first', attackerUrl);
  const attackResponse = await request.get(attackFirstUrl);
  const attackHtml = await attackResponse.text();
  expect(attackHtml).toContain('HTTP-EQUIV="refresh" http-equiv="not-refresh"');
  expect(attackHtml).not.toContain(`content="0; url=${attackerUrl}"`);

  await page.goto(attackFirstUrl);
  await page.waitForTimeout(350);
  expect(page.url()).toBe(attackFirstUrl);
  await expect(page.getByRole('heading', { name: 'Meta refresh sink app' })).toBeVisible();
  expect(attackerRequests).toBe(0);

  const safeFirstUrl = probeUrl(kovoApp.origin, 'safe-first', attackerUrl);
  const safeResponse = await request.get(safeFirstUrl);
  const safeHtml = await safeResponse.text();
  expect(safeHtml).toContain(
    `http-equiv="not-refresh" HTTP-EQUIV="refresh" content="0; url=${attackerUrl}"`,
  );

  await page.goto(safeFirstUrl);
  await page.waitForTimeout(350);
  expect(page.url()).toBe(safeFirstUrl);
  await expect(page.getByRole('heading', { name: 'Meta refresh sink app' })).toBeVisible();
  expect(attackerRequests).toBe(0);

  const canonicalUrl = probeUrl(kovoApp.origin, 'canonical', attackerUrl);
  const canonicalHtml = await (await request.get(canonicalUrl)).text();
  expect(canonicalHtml).toContain('http-equiv="refresh"');
  expect(canonicalHtml).not.toContain(`content="0; url=${attackerUrl}"`);
});

test('keeps javascript and data refresh controls inert', async ({ kovoApp, page, request }) => {
  for (const [name, target] of [
    ['javascript', "javascript:document.title='JAVASCRIPT_PWNED';void(0)"],
    ['data', 'data:text/html,<title>DATA_PWNED</title>'],
  ] as const) {
    const url = probeUrl(kovoApp.origin, 'attack-first', target);
    const html = await (await request.get(url)).text();
    expect(html).toContain('HTTP-EQUIV="refresh" http-equiv="not-refresh"');
    expect(html).not.toContain('JAVASCRIPT_PWNED');
    expect(html).not.toContain('DATA_PWNED');

    await page.goto(url);
    await page.waitForTimeout(350);
    expect(page.url(), name).toBe(url);
    expect(await page.title(), name).not.toBe('JAVASCRIPT_PWNED');
    expect(await page.title(), name).not.toBe('DATA_PWNED');
    await expect(page.getByRole('heading', { name: 'Meta refresh sink app' })).toBeVisible();
  }
});
