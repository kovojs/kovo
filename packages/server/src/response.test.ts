import { describe, expect, it } from 'vitest';

import {
  routeResponseToDocumentResponse,
  routeResponseToWebResponse,
  type RoutePageResponse,
} from './response.js';

describe('server response adapters', () => {
  it('suppresses route response bodies for HEAD requests', async () => {
    const response = routeResponseToWebResponse(
      {
        body: '<main>ok</main>',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 200,
      },
      { method: 'HEAD' },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    await expect(response.text()).resolves.toBe('');
  });

  it('adapts typed-array route bodies without leaking unused buffer bytes', async () => {
    const bytes = new TextEncoder().encode('xxpayloadyy');
    const body = bytes.subarray(2, 9);

    const response = routeResponseToWebResponse(
      {
        body,
        headers: { 'Content-Type': 'application/octet-stream' },
        status: 200,
      },
      { method: 'GET' },
    );

    await expect(response.text()).resolves.toBe('payload');
  });

  it('normalizes ArrayBuffer bodies before document wrapping', () => {
    const source = new TextEncoder().encode('page').buffer;
    const response: RoutePageResponse = {
      body: source,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    };

    const documentResponse = routeResponseToDocumentResponse(response);

    expect(documentResponse.body).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(documentResponse.body as Uint8Array)).toBe('page');
  });
});
