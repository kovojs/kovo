// Drive the REAL served commerce Node app in Chromium and prove add-to-cart
// round-trips through the live `addToCart` mutation (no mocks): the cart badge
// count increments and the product grid re-renders via the inline-loader fragment
// morph, with no console errors.
//
// This exercises Phase R2 of plans/examples-interactivity.md end to end:
//   - scripts/serve.mjs serves the interactive `createCommerceAppShell` handler
//     (vite.config.ts `nodeHandlerExportName: 'commerceNodeHandler'`) over PGlite,
//     and serves built `dist/assets/*` so the page is styled.
//   - The `addToCart` mutation is guarded by betterAuth, so we first log in through
//     the real `/login` form (carries the server-rendered auth CSRF token), which
//     establishes the session cookie. The authenticated cart page then renders the
//     add-to-cart forms WITH the per-session CSRF field, so the mutation is accepted.
//   - The fragment morph re-renders cart-badge / product-grid / order-history from
//     server truth. We removed per-fragment `stylesheets` (Phase R1 learning) so a
//     leading <link> can't become the morph root and wipe the region.
//
// Run after `vp build` (the styled production-serve path):
//   cd examples/commerce && vp build && node scratch/commerce-serve-drive.mjs
//
// Prod serve note: in-memory PGlite resets per server start; this demo seeds its
// catalog on boot, so a fresh run starts from a 0 cart.

import { chromium } from 'playwright';

import { createCommerceServeServer } from '../scripts/serve.mjs';

const DEMO_EMAIL = 'ada@example.com';
const DEMO_PASSWORD = 'correct';

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

async function readCartBadgeCount(page) {
  return page.evaluate(() => {
    const node = document.querySelector('[data-bind="cart.count"]');
    return node ? Number(node.textContent?.trim()) : Number.NaN;
  });
}

async function main() {
  const served = await createCommerceServeServer({ host: '127.0.0.1', port: 0 });
  const origin = `http://${served.host}:${served.port}`;
  process.stdout.write(`commerce-serve-drive: serving ${origin}\n`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  try {
    // 1. Log in through the real /login form (server-rendered auth CSRF token).
    //    The enhance loader posts the sign-in mutation; the server sets the
    //    session cookie (`set-cookie: kovo_commerce_session=...`). The enhanced
    //    sign-in response is a 200 with no client-followable redirect (framework
    //    friction noted in the handoff), so once the cookie is set we navigate to
    //    /cart ourselves rather than waiting on an auto-redirect.
    await page.goto(`${origin}/login`, { waitUntil: 'networkidle' });
    await page.fill('input[name="email"]', DEMO_EMAIL);
    await page.fill('input[name="password"]', DEMO_PASSWORD);
    await Promise.all([
      page.waitForResponse(
        (response) => response.url().endsWith('/_m/auth/sign-in') && response.status() < 400,
        { timeout: 15_000 },
      ),
      page.click('button[type="submit"]'),
    ]);

    // 2. The authenticated cart page renders add-to-cart forms (with CSRF).
    await page.goto(`${origin}/cart`, { waitUntil: 'networkidle' });
    await page.waitForSelector('form[action="/_m/cart/add"] input[name="csrf"]', {
      state: 'attached',
      timeout: 15_000,
    });
    const before = await readCartBadgeCount(page);
    if (!Number.isFinite(before)) {
      fail('cart badge count not found on the authenticated cart page');
      return;
    }
    process.stdout.write(`commerce-serve-drive: cart badge before add-to-cart = ${before}\n`);

    const csrfField = await page.$('form[action="/_m/cart/add"] input[name="csrf"]');
    if (!csrfField) {
      fail('add-to-cart form is missing its per-session CSRF field (auth not applied?)');
      return;
    }

    // 3. Submit the first add-to-cart form; the enhance loader morphs the fragment
    //    wire (cart-badge / product-grid / order-history) from server truth.
    await page.click('form[action="/_m/cart/add"] button[type="submit"]');
    await page.waitForFunction(
      (prev) => {
        const node = document.querySelector('[data-bind="cart.count"]');
        return node ? Number(node.textContent?.trim()) > prev : false;
      },
      before,
      { timeout: 15_000 },
    );

    const after = await readCartBadgeCount(page);
    process.stdout.write(`commerce-serve-drive: cart badge after add-to-cart  = ${after}\n`);

    if (!(after > before)) {
      fail(`cart badge did not increment (before=${before}, after=${after})`);
      return;
    }

    // 4. Prove the product-grid fragment actually morphed (still present + live).
    //    The product-grid host resolves via its compiler-derived `kovo-c`
    //    identity stamp; its per-product add-to-cart forms must survive the morph.
    const gridForms = await page.$$('[kovo-c="product-grid"] form[action="/_m/cart/add"]');
    if (gridForms.length === 0) {
      fail('product-grid region lost its add-to-cart forms after the morph');
      return;
    }

    if (consoleErrors.length > 0) {
      fail(`console errors during the run:\n  ${consoleErrors.join('\n  ')}`);
      return;
    }

    process.stdout.write(
      `PASS: add-to-cart round-tripped via the real Node server — cart badge ${before} -> ${after}, ` +
        `product grid re-rendered (${gridForms.length} forms), no console errors.\n`,
    );
  } finally {
    await browser.close();
    await served.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
