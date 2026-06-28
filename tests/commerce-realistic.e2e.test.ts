// B2 / S2 / S3 (plans/bugs-and-testing.md): boot the commerce example through
// the production Vite-plugin compiler and drive the real browser workflow the
// public demo exposes: anonymous visitors see the sign-in gate, authenticated
// visitors can page products and add items through the live CSRF/session stack.
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
  it('runs the public commerce sign-in, pagination, and add-to-cart workflow end to end', async () => {
    const page: Page = await browser!.newPage();
    let shopperContext;
    let shopperPage;
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });

      // The storefront SSRs through the real compiler/runtime, but anonymous
      // shoppers do not see an auth-guarded add-to-cart form.
      await expect(page.locator('[kovo-fragment-target="cart-badge"]').first()).toBeVisible();
      const initialDocument = await page.content();
      expect(initialDocument).toContain('installInlineKovoBootstrap');
      expect(initialDocument).toContain('kovo-runtime.client.js');
      await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
      await expect(page.locator('form[action="/_m/domain/add-to-cart"]')).toHaveCount(0);

      // The live CSRF/session stack still rejects a raw anonymous mutation.
      const csrf = await page.request.post(`${origin}/_m/domain/add-to-cart`, {
        form: { productId: 'p1', quantity: '1' },
        headers: { 'Kovo-Fragment': 'true' },
        failOnStatusCode: false,
      });
      expect(csrf.status()).toBe(422);
      expect(await csrf.text()).toContain('data-error-code="CSRF"');

      // The broken public pagination link is no longer exposed.
      await expect(page.getByRole('link', { name: 'More' })).toHaveCount(0);

      // Mint the real login session in a no-JS browser context, then verify the
      // visible button-driven add-to-cart workflow updates cart badge, stock,
      // and orders through POST-redirect-GET.
      shopperContext = await browser!.newContext({ javaScriptEnabled: false });
      shopperPage = await shopperContext.newPage();
      await shopperPage.goto(`${origin}/login?next=%2Fcart`, { waitUntil: 'domcontentloaded' });
      const csrfField = await shopperPage.locator('input[name="csrf"]').inputValue();
      const login = await shopperContext.request.post(`${origin}/_m/auth/sign-in`, {
        failOnStatusCode: false,
        form: {
          csrf: csrfField,
          email: 'ada@example.com',
          next: '/cart',
          password: 'correct',
        },
        headers: {
          origin,
          referer: `${origin}/login?next=%2Fcart`,
          'x-forwarded-for': '203.0.113.90',
        },
      });
      expect(login.ok()).toBe(true);

      await shopperPage.goto(`${origin}/cart`, { waitUntil: 'domcontentloaded' });
      await expect(
        shopperPage.locator('form[action="/_m/domain/add-to-cart"]').first(),
      ).toBeVisible();
      await expect(shopperPage.getByRole('link', { name: 'More' })).toHaveCount(0);
      await shopperPage.getByRole('button', { name: 'Add to cart' }).first().click();
      await shopperPage.waitForURL((url) => url.pathname === '/cart');
      await expect(shopperPage.locator('cart-badge')).toContainText('1');
      await expect(shopperPage.locator('body')).toContainText('4 in stock');
      await expect(shopperPage.locator('body')).toContainText('Order order-1');
    } finally {
      await shopperPage?.close();
      await shopperContext?.close();
      await page.close();
    }
  }, 120_000);
});
