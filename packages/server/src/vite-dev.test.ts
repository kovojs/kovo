import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { route } from './route.js';
import {
  createJisoAppShellDevDiagnosticLedger,
  renderJisoAppShellViteDevDiagnosticResponse,
  shouldHandleJisoAppShellViteRequest,
} from './vite-dev.js';

describe('server app shell Vite dev seam', () => {
  it('derives request ownership from the app-shell dispatch table', () => {
    const app = createApp({
      mutations: [{ key: 'cart/add' }],
      routes: [route('/products/:id', {})],
    });

    expect(
      shouldHandleJisoAppShellViteRequest(request('/products/p1', { method: 'GET' }), app),
    ).toBe(true);
    expect(
      shouldHandleJisoAppShellViteRequest(request('/products/p1', { method: 'HEAD' }), app),
    ).toBe(true);
    expect(
      shouldHandleJisoAppShellViteRequest(request('/products/p1', { method: 'POST' }), app),
    ).toBe(false);
    expect(
      shouldHandleJisoAppShellViteRequest(request('/_m/cart/add', { method: 'POST' }), app),
    ).toBe(true);
    expect(shouldHandleJisoAppShellViteRequest(request('/src/styles.css'), app)).toBe(false);
  });

  it('renders route diagnostics directly from the dev ledger', () => {
    const diagnostics = createJisoAppShellDevDiagnosticLedger();
    diagnostics.recordModuleDiagnostics({
      diagnostics: [
        {
          code: 'FW225',
          fileName: 'src/components/cart.tsx',
          message: 'JSX nesting violates the HTML content model.',
        },
      ],
      fileName: 'src/components/cart.tsx',
    });

    const response = renderJisoAppShellViteDevDiagnosticResponse(
      createApp({
        routes: [
          route('/cart', {
            modulepreloads: ['/c/src/components/cart.client.js?v=failed'],
          }),
        ],
      }),
      request('/cart'),
      diagnostics,
    );

    expect(response).toMatchObject({
      body: expect.stringContaining('<p class="jiso-diagnostic-code">FW225</p>'),
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
      status: 500,
    });
  });

  it('renders mutation diagnostics as fragment wire responses when requested', () => {
    const diagnostics = createJisoAppShellDevDiagnosticLedger();
    diagnostics.recordModuleDiagnostics({
      diagnostics: [
        {
          code: 'FW225',
          fileName: 'src/mutations/cart.ts',
          message: 'JSX nesting violates the HTML content model.',
        },
      ],
      fileName: 'src/mutations/cart.ts',
      moduleHrefs: ['/_m/cart/add'],
    });

    const response = renderJisoAppShellViteDevDiagnosticResponse(
      createApp({
        mutations: [{ key: 'cart/add' }],
      }),
      request('/_m/cart/add', {
        headers: {
          'FW-Fragment': 'true',
          'FW-Targets': 'cart-errors;cart-summary',
        },
        method: 'POST',
      }),
      diagnostics,
    );

    expect(response).toMatchObject({
      body: expect.stringContaining('<fw-fragment target="cart-errors">'),
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
      },
      status: 500,
    });
  });
});

function request(
  url: string,
  options: {
    headers?: IncomingMessage['headers'];
    method?: string;
  } = {},
): IncomingMessage {
  return {
    headers: options.headers ?? {},
    method: options.method ?? 'GET',
    url,
  } as IncomingMessage;
}
