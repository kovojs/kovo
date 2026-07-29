import '../../../tests/example-generated-graphs.setup.js';

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { chromium, type Browser } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';
import axe from 'axe-core';
import { setCookieValues } from '@kovojs/test/headers';
import { htmlFormFields } from '@kovojs/test/html-fragment';

import { createCommerceTestApp } from './app-test-helpers.js';

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
  it('applies enhanced navigation and matches the full target document', async () => {
    const shell = createCommerceTestApp();
    server = createServer(shell.nodeHandler);
    await listen(server);
    const origin = serverOrigin(server);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ bypassCSP: true });
    await addAuthenticatedCommerceCookie(page.context(), origin);
    await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
    const targetHtml = await page.evaluate(async () => {
      const response = await fetch('/cart', { headers: { Accept: 'text/html' } });
      return response.text();
    });

    await page.evaluate(() => {
      (window as typeof window & { __kovoEnhancedNavigated?: boolean }).__kovoEnhancedNavigated =
        false;
      addEventListener('kovo:navigate', () => {
        (window as typeof window & { __kovoEnhancedNavigated?: boolean }).__kovoEnhancedNavigated =
          true;
      });
      const layout = document.querySelector('[data-commerce-shell]') as HTMLElement;
      const link = document.createElement('a');
      link.href = '/cart';
      link.id = 'test-cart-link';
      link.textContent = 'Cart';
      layout.append(link);
    });

    await page.click('#test-cart-link');
    await page.waitForFunction(() => location.pathname === '/cart');

    const enhancedNavigated = await page.evaluate(
      () =>
        (window as typeof window & { __kovoEnhancedNavigated?: boolean })
          .__kovoEnhancedNavigated === true,
    );
    await page.evaluate(() => {
      document.querySelector('#test-cart-link')?.remove();
    });
    const enhancedBody = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[tabindex="-1"]').forEach((element) => {
        element.removeAttribute('tabindex');
      });
      clone.querySelectorAll<HTMLInputElement>('input[name="Kovo-Idem"]').forEach((input) => {
        input.value = '<idem>';
      });
      clone.querySelectorAll<HTMLInputElement>('input[name="csrf"]').forEach((input) => {
        input.value = '<csrf>';
      });
      return clone.innerHTML;
    });
    const fullBody = await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const clone = doc.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[tabindex="-1"]').forEach((element) => {
        element.removeAttribute('tabindex');
      });
      clone.querySelectorAll<HTMLInputElement>('input[name="Kovo-Idem"]').forEach((input) => {
        input.value = '<idem>';
      });
      clone.querySelectorAll<HTMLInputElement>('input[name="csrf"]').forEach((input) => {
        input.value = '<csrf>';
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

    expect(enhancedNavigated).toBe(true);
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

async function addAuthenticatedCommerceCookie(
  context: import('playwright').BrowserContext,
  origin: string,
): Promise<void> {
  const loginPage = await fetch(`${origin}/login?next=/`);
  const loginHtml = await loginPage.text();
  const csrf = htmlFormFields(loginHtml, 'csrf')[0]?.value;
  const csrfCookie = setCookieValues(loginPage.headers)
    .map((value) => value.split(';', 1)[0] ?? '')
    .filter(Boolean)
    .join('; ');
  if (!csrf || !csrfCookie) throw new Error('Commerce login page did not mint CSRF state.');

  const response = await fetch(`${origin}/_m/auth/sign-in`, {
    body: new URLSearchParams({
      csrf,
      email: 'ada@example.com',
      next: '/',
      password: 'correct',
    }),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: csrfCookie,
      Origin: origin,
      Referer: `${origin}/login?next=/`,
    },
    method: 'POST',
    redirect: 'manual',
  });
  const sessionPair = setCookieValues(response.headers)
    .map((value) => value.split(';', 1)[0] ?? '')
    .find((value) => value.startsWith('kovo_commerce_session='));
  if (response.status !== 303 || !sessionPair) {
    throw new Error(`Commerce sign-in failed with status ${response.status}.`);
  }
  const separator = sessionPair.indexOf('=');
  await context.addCookies([
    {
      name: sessionPair.slice(0, separator),
      url: origin,
      value: sessionPair.slice(separator + 1),
    },
  ]);
}
