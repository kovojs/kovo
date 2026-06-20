// B2 / S2 / S3 (plans/bugs-and-testing.md): the realistic-app keystone. Boots the
// commerce example — the REAL package stack (drizzle extracted graph + better-auth
// session + seeded PGlite + @kovojs/ui/@kovojs/style components) through the production
// Vite-plugin compiler (`vite.ssrLoadModule`, NOT hand-written lowered IR) — and drives
// it in a real browser. This is the production-stack half the fixtures never exercise
// (testing-audit S2/S3): real TSX → production compiler → real-component SSR → inline
// loader, with the real CSRF/session security stack active (the fixtures use csrf:false).
//
// Findings recorded in the B2 ledger (both consistent with bugs-1):
//  - The multi-tenant demo-serve renders add-to-cart forms WITHOUT a CSRF synchronizer
//    token for an anonymous visitor (the token binds to session.id, unminted for the
//    anonymous demo session), so the CSRF-protected `/_m/cart/add` returns 422
//    `data-error-code="CSRF"` until a session is established — cf. bugs-1 F3 (anon CSRF).
//  - The "More" link target `/products?after=` is not a standalone route in the
//    demo-serve (404); pagination there is a fragment path, not a full nav.
// We therefore assert the parts the realistic stack robustly proves in a browser:
// real-component SSR, the live CSRF security posture, and a second real route render.
import { type Browser, type Page, chromium, expect } from '@playwright/test';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { createCommerceDemoServer } from '../examples/commerce/scripts/demo-serve.mjs';

interface DemoServer {
  close(): Promise<void>;
  host: string;
  port: number;
}

let served: DemoServer | undefined;
let browser: Browser | undefined;
let origin = '';

beforeAll(async () => {
  served = (await createCommerceDemoServer({ port: 0 })) as DemoServer;
  origin = `http://${served.host}:${served.port}`;
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await served?.close();
});

describe('realistic-app: commerce real stack driven in a browser (B2/S2/S3)', () => {
  it('renders real-component SSR with the real CSRF/session stack active across routes', async () => {
    const page: Page = await browser!.newPage();
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });

      // (1) Real-component server render through the PRODUCTION compiler. The minimal
      // CLI build (no vite plugin) renders an empty body; the full pipeline renders the
      // storefront — @kovojs/ui buttons, @kovojs/style classes, drizzle-backed products.
      await expect(page.getByRole('button', { name: 'Add to cart' }).first()).toBeVisible();
      expect(await page.locator('form[action="/_m/cart/add"]').count()).toBeGreaterThan(0);
      // Live fragment target + resumability bootstrap are stamped into the document.
      await expect(page.locator('[kovo-fragment-target="cart-badge"]').first()).toBeVisible();
      expect(await page.content()).toContain('installInlineKovoLoader');

      // (2) The real CSRF security stack is ACTIVE (unlike the csrf:false fixtures): an
      // anonymous enhanced add-to-cart is rejected with a typed CSRF error, not silently
      // accepted — the production security posture, wired end-to-end through the app.
      const csrf = await page.request.post(`${origin}/_m/cart/add`, {
        form: { productId: 'p1', quantity: '1' },
        headers: { 'Kovo-Fragment': 'true' },
        failOnStatusCode: false,
      });
      expect(csrf.status()).toBe(422);
      expect(await csrf.text()).toContain('data-error-code="CSRF"');

      // (3) A second real route renders through the stack: /cart runs its own typed
      // query against seeded PGlite and renders the cart shell.
      await page.goto(`${origin}/cart`, { waitUntil: 'domcontentloaded' });
      expect(page.url()).toContain('/cart');
      await expect(page.locator('[kovo-fragment-target="cart-badge"]').first()).toBeVisible();
      await expect(page.locator('body')).toContainText(/cart/i);
    } finally {
      await page.close();
    }
  }, 120_000);
});
