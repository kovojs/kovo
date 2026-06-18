import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { chromium, type Browser } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';
import axe from 'axe-core';

import { createCommerceApp } from './app.js';

let browser: Browser | undefined;
let server: Server | undefined;

afterEach(async () => {
  await browser?.close();
  browser = undefined;
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
});

describe('commerce enhanced navigation', () => {
  it('preserves the shared layout and matches the full target document', async () => {
    const shell = createCommerceApp();
    server = createServer(shell.nodeHandler);
    await listen(server);
    const origin = serverOrigin(server);
    const targetHtml = await fetch(`${origin}/cart`).then((response) => response.text());

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`${origin}/`, { waitUntil: 'networkidle' });

    await page.evaluate(() => {
      const layout = document.querySelector('main') as HTMLElement & { __kovoTestPersist?: true };
      layout.__kovoTestPersist = true;
      const link = document.createElement('a');
      link.href = '/cart';
      link.id = 'test-cart-link';
      link.textContent = 'Cart';
      document.body.append(link);
    });

    await page.click('#test-cart-link');
    await page.waitForFunction(() => location.pathname === '/cart');

    const layoutPersisted = await page.evaluate(
      () =>
        (document.querySelector('main') as (HTMLElement & { __kovoTestPersist?: true }) | null)
          ?.__kovoTestPersist === true,
    );
    await page.evaluate(() => {
      document.querySelector('#test-cart-link')?.remove();
    });
    const enhancedBody = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[tabindex="-1"]').forEach((element) => {
        element.removeAttribute('tabindex');
      });
      return clone.innerHTML;
    });
    const fullBody = await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const clone = doc.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[tabindex="-1"]').forEach((element) => {
        element.removeAttribute('tabindex');
      });
      return clone.innerHTML;
    }, targetHtml);
    await page.addScriptTag({ content: axe.source });
    const axeViolations = await page.evaluate(async () => {
      const results = await (
        window as typeof window & {
          axe: { run(root: Element): Promise<{ violations: Array<{ id: string }> }> };
        }
      ).axe.run(document.body);
      return results.violations.map((violation) => violation.id);
    });

    expect(layoutPersisted).toBe(true);
    expect(enhancedBody).toBe(fullBody);
    expect(axeViolations).toEqual([]);
  });
});

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function serverOrigin(server: Server): string {
  const address = server.address() as AddressInfo | null;
  if (!address) throw new Error('server is not listening');
  return `http://127.0.0.1:${address.port}`;
}
