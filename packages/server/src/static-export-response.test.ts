import { describe, expect, it } from 'vitest';

import {
  readStaticExportClientModuleResponse,
  readStaticExportReplayedResponse,
  readStaticExportRouteDocumentResponse,
} from './static-export-response.js';

describe('server static export response boundary', () => {
  it('uses one replay response reader for route documents and client modules', async () => {
    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response: new Response('<main>Home</main>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          status: 200,
        }),
        routePath: '/',
      }),
    ).resolves.toEqual({
      body: '<main>Home</main>',
      headers: { 'content-type': 'text/html; charset=utf-8' },
      status: 200,
    });

    await expect(
      readStaticExportReplayedResponse({
        href: '/c/cart.client.js?v=cart-1',
        kind: 'client-module',
        path: '/c/cart.client.js',
        response: new Response('export const cart = true;', {
          headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
          status: 200,
        }),
      }),
    ).resolves.toEqual({
      body: 'export const cart = true;',
      headers: { 'content-type': 'text/javascript; charset=utf-8' },
      status: 200,
    });
  });

  it('accepts successful HTML route document responses with sorted headers', async () => {
    await expect(
      readStaticExportRouteDocumentResponse({
        response: new Response('<main>Home</main>', {
          headers: {
            'X-Route': '/',
            'Content-Type': 'Text/HTML; charset=utf-8',
          },
          status: 200,
        }),
        routePath: '/',
      }),
    ).resolves.toEqual({
      body: '<main>Home</main>',
      headers: {
        'content-type': 'Text/HTML; charset=utf-8',
        'x-route': '/',
      },
      status: 200,
    });
  });

  it('raises FW229 for non-document route replay responses', async () => {
    await expect(
      readStaticExportRouteDocumentResponse({
        response: new Response('name,total\norder,12\n', {
          headers: { 'Content-Type': 'text/csv; charset=utf-8' },
          status: 200,
        }),
        routePath: '/exports/orders.csv',
      }),
    ).rejects.toMatchObject({
      code: 'FW229',
      diagnostics: [
        {
          code: 'FW229',
          message: expect.stringContaining(
            "can only write successful HTML route documents; '/exports/orders.csv' returned status 200 with Content-Type 'text/csv; charset=utf-8'",
          ),
          routePath: '/exports/orders.csv',
        },
      ],
    });
  });

  it('accepts JavaScript client module replay responses', async () => {
    await expect(
      readStaticExportClientModuleResponse({
        href: '/c/cart.client.js?v=cart-1#Cart$add',
        path: '/c/cart.client.js',
        response: new Response('export const cart = true;', {
          headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
          status: 200,
        }),
      }),
    ).resolves.toEqual({
      body: 'export const cart = true;',
      headers: { 'content-type': 'application/javascript; charset=utf-8' },
      status: 200,
    });
  });

  it('raises FW229 for non-JavaScript client module replay responses', async () => {
    await expect(
      readStaticExportClientModuleResponse({
        href: '/c/cart.client.js?v=cart-1',
        path: '/c/cart.client.js',
        response: new Response('<!doctype html><h1>Missing</h1>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          status: 404,
        }),
      }),
    ).rejects.toMatchObject({
      code: 'FW229',
      diagnostics: [
        {
          code: 'FW229',
          message: expect.stringContaining(
            "client module '/c/cart.client.js?v=cart-1' because the app handler returned status 404 with Content-Type 'text/html; charset=utf-8'",
          ),
          routePath: '/c/cart.client.js',
        },
      ],
    });
  });
});
