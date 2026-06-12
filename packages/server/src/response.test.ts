import { describe, expect, it } from 'vitest';

import {
  isHeaderSource,
  readHeader,
  routeResponseToDocumentResponse,
  routeResponseToWebResponse,
  serverResponseToWebResponse,
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

  it('preserves repeated server response headers when adapting to web Responses', async () => {
    const response = serverResponseToWebResponse(
      {
        body: 'created',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Set-Cookie': ['session=s1; Path=/', 'csrf=c1; Path=/'],
        },
        status: 200,
      },
      { method: 'GET' },
    );

    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect((response.headers as Headers & { getSetCookie(): string[] }).getSetCookie()).toEqual([
      'session=s1; Path=/',
      'csrf=c1; Path=/',
    ]);
    await expect(response.text()).resolves.toBe('created');
  });

  it('suppresses shared server response bodies for HEAD requests', async () => {
    const response = serverResponseToWebResponse(
      {
        body: 'created',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        status: 200,
      },
      { method: 'HEAD' },
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('');
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

  it('accepts concrete header sources without treating arbitrary objects as headers', () => {
    expect(isHeaderSource(new Headers({ 'Content-Type': 'text/html' }))).toBe(true);
    expect(isHeaderSource(new Map([['Content-Type', 'text/html']]))).toBe(true);
    expect(isHeaderSource({ 'Content-Type': 'text/html', Vary: ['Accept'] })).toBe(true);

    expect(isHeaderSource({ status: 200 })).toBe(false);
    expect(isHeaderSource(['Content-Type', 'text/html'])).toBe(false);

    const headers = { 'CONTENT-TYPE': 'text/html', Vary: ['Accept', 'Cookie'] };
    expect(isHeaderSource(headers)).toBe(true);
    expect(readHeader(headers, 'content-type')).toBe('text/html');
    expect(readHeader(headers, 'vary')).toBe('Accept, Cookie');
  });
});
