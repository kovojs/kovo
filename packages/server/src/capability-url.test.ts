import { describe, expect, it } from 'vitest';

import type { StorageCapability, StorageStreamResult } from '@kovojs/core';
import { publicAccess } from './access.js';
import { createApp, createRequestHandler } from './app.js';
import {
  signCapabilityUrl,
  type CapabilityUrlReplayResponse,
  verifyCapabilityUrl,
} from './capability-url.js';
import { renderedHtml } from './html.js';
import { createMemoryMutationReplayStore } from './replay.js';
import { route } from './route.js';

const secret = 'capability-url-test-secret';
const now = Date.UTC(2026, 5, 24, 12, 0, 0);

describe('capability URL primitive', () => {
  it('signs and verifies method, key, expiry, and default exact scope', () => {
    const url = signCapabilityUrl({
      baseUrl: 'https://cdn.example.test/_cap/download',
      key: '/invoices/2026/receipt.pdf',
      method: 'get',
      now,
      secret,
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get('kovo-cap-method')).toBe('GET');
    expect(parsed.searchParams.get('kovo-cap-key')).toBe('invoices/2026/receipt.pdf');
    expect(parsed.searchParams.get('kovo-cap-scope')).toBe('key:invoices/2026/receipt.pdf');

    expect(
      verifyCapabilityUrl(url, {
        key: 'invoices/2026/receipt.pdf',
        method: 'GET',
        now: now + 299_000,
        secret,
      }),
    ).toMatchObject({
      key: 'invoices/2026/receipt.pdf',
      method: 'GET',
      ok: true,
      scope: 'key:invoices/2026/receipt.pdf',
    });
  });

  it('rejects tampered method, key, scope, expiry, and signature bytes', () => {
    const url = signCapabilityUrl({
      baseUrl: 'https://cdn.example.test/_cap/download',
      expiresIn: 60,
      key: 'exports/report.csv',
      method: 'GET',
      now,
      secret,
    });

    expect(
      verifyCapabilityUrl(url, {
        key: 'exports/report.csv',
        method: 'POST',
        now,
        secret,
      }),
    ).toEqual({ ok: false, reason: 'method-mismatch' });

    expect(
      verifyCapabilityUrl(url, {
        key: 'exports/other.csv',
        method: 'GET',
        now,
        secret,
      }),
    ).toEqual({ ok: false, reason: 'key-mismatch' });

    const scoped = new URL(url);
    scoped.searchParams.set('kovo-cap-scope', 'prefix:exports');
    expect(
      verifyCapabilityUrl(scoped, {
        key: 'exports/report.csv',
        method: 'GET',
        now,
        secret,
      }),
    ).toEqual({ ok: false, reason: 'scope-mismatch' });

    const expiryTampered = new URL(url);
    expiryTampered.searchParams.set('kovo-cap-exp', String(Math.floor(now / 1000) + 600));
    expect(
      verifyCapabilityUrl(expiryTampered, {
        key: 'exports/report.csv',
        method: 'GET',
        now,
        secret,
      }),
    ).toEqual({ ok: false, reason: 'invalid' });

    const signatureTampered = new URL(url);
    signatureTampered.searchParams.set('kovo-cap-sig', 'not-the-signature');
    expect(
      verifyCapabilityUrl(signatureTampered, {
        key: 'exports/report.csv',
        method: 'GET',
        now,
        secret,
      }),
    ).toEqual({ ok: false, reason: 'invalid' });
  });

  it('enforces expiry before the sink reads the keyed object', () => {
    const url = signCapabilityUrl({
      baseUrl: 'https://cdn.example.test/_cap/download',
      expiresIn: 10,
      key: 'exports/report.csv',
      method: 'GET',
      now,
      secret,
    });

    expect(
      verifyCapabilityUrl(url, {
        key: 'exports/report.csv',
        method: 'GET',
        now: now + 10_000,
        secret,
      }),
    ).toMatchObject({ ok: true });
    expect(
      verifyCapabilityUrl(url, {
        key: 'exports/report.csv',
        method: 'GET',
        now: now + 11_000,
        secret,
      }),
    ).toEqual({ ok: false, reason: 'expired' });
  });

  it('supports explicit prefix scope only when it contains the signed key', () => {
    const url = signCapabilityUrl({
      baseUrl: 'https://cdn.example.test/_cap/download',
      key: 'exports/2026/report.csv',
      method: 'GET',
      now,
      scope: { kind: 'prefix', prefix: '/exports/2026' },
      secret,
    });

    expect(new URL(url).searchParams.get('kovo-cap-scope')).toBe('prefix:exports/2026');
    expect(
      verifyCapabilityUrl(url, {
        key: 'exports/2026/report.csv',
        method: 'GET',
        now,
        scope: { kind: 'prefix', prefix: 'exports/2026' },
        secret,
      }),
    ).toMatchObject({ ok: true, scope: 'prefix:exports/2026' });
    expect(() =>
      signCapabilityUrl({
        baseUrl: 'https://cdn.example.test/_cap/download',
        key: 'exports/2026/report.csv',
        method: 'GET',
        scope: { kind: 'prefix', prefix: 'private' },
        secret,
      }),
    ).toThrow(/prefix scope/iu);
  });

  it('rejects backslash, double-slash, and dot-segment key reopenings', () => {
    for (const key of ['exports\\report.csv', 'exports//report.csv', 'exports/./report.csv']) {
      expect(() =>
        signCapabilityUrl({
          baseUrl: 'https://cdn.example.test/_cap/download',
          key,
          method: 'GET',
          now,
          secret,
        }),
      ).toThrow(/Capability URL key/iu);
    }

    const url = signCapabilityUrl({
      baseUrl: 'https://cdn.example.test/_cap/download',
      key: 'exports/report.csv',
      method: 'GET',
      now,
      secret,
    });
    const reopened = new URL(url);
    reopened.searchParams.set('kovo-cap-key', 'exports//report.csv');

    expect(
      verifyCapabilityUrl(reopened, {
        key: 'exports/report.csv',
        method: 'GET',
        now,
        secret,
      }),
    ).toEqual({ ok: false, reason: 'malformed' });
  });

  it('consumes one-time capability URLs through the replay store', () => {
    const replayStore = createMemoryMutationReplayStore<CapabilityUrlReplayResponse>();
    const url = signCapabilityUrl({
      baseUrl: 'https://cdn.example.test/_cap/download',
      expiresIn: 60,
      key: 'exports/report.csv',
      method: 'GET',
      now,
      oneTime: true,
      oneTimeNonce: 'nonce-01',
      secret,
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get('kovo-cap-once')).toBe('nonce-01');

    expect(
      verifyCapabilityUrl(url, {
        key: 'exports/report.csv',
        method: 'GET',
        now,
        replayStore,
        secret,
      }),
    ).toMatchObject({ ok: true, oneTime: true, replayId: 'nonce-01' });

    expect(
      verifyCapabilityUrl(url, {
        key: 'exports/report.csv',
        method: 'GET',
        now,
        replayStore,
        secret,
      }),
    ).toEqual({ ok: false, reason: 'replayed' });

    expect(
      verifyCapabilityUrl(url, {
        key: 'exports/report.csv',
        method: 'GET',
        now,
        secret,
      }),
    ).toEqual({ ok: false, reason: 'replayed' });
  });
});

describe('capability URL app wiring', () => {
  it('installs request.signUrl with the framework-owned storage verification path', async () => {
    const storage = capabilityStorage({
      'exports/report.csv': storageObject('exports/report.csv', 'id,total\n1,42\n', 'text/csv'),
    });
    const app = createApp({
      capabilityUrls: { secret, storage },
      routes: [
        route('/exports', {
          access: publicAccess('test fixture'),
          guard: () => true,
          page(_context, request) {
            const href = request.signUrl?.({
              expiresIn: 60,
              key: 'exports/report.csv',
              reason: 'download link for verified export recipient',
              site: 'routes/exports.tsx:12',
            });
            return renderedHtml(String(href));
          },
        }),
      ],
    });
    const handler = createRequestHandler(app);

    const page = await handler(new Request('https://example.test/exports'));
    expect(page.headers.get('cache-control')).toBe('no-store');
    const href = (await page.text()).match(/https:\/\/example\.test\/_cap\/storage[^"<]*/u)?.[0];
    expect(href).toBeDefined();
    const signed = new URL(href);
    expect(signed.pathname).toBe('/_cap/storage');
    expect(signed.searchParams.get('kovo-cap-key')).toBe('exports/report.csv');

    const download = await handler(new Request(signed));
    expect(download.status).toBe(200);
    expect(download.headers.get('cache-control')).toBe('private, no-store');
    expect(download.headers.get('content-disposition')).toBe('attachment; filename="report.csv"');
    await expect(download.text()).resolves.toBe('id,total\n1,42\n');
    expect(storage.streamCalls).toEqual(['exports/report.csv']);
    expect(app.capabilities).toContainEqual({
      detail: 'scope=key:exports/report.csv,method=GET,oneTime=no',
      kind: 'capabilityUrl',
      reason: 'download link for verified export recipient',
      site: 'routes/exports.tsx:12',
      source: 'request.signUrl',
    });
  });

  it('does not install request.signUrl on cacheable public route documents', async () => {
    const app = createApp({
      capabilityUrls: { secret },
      routes: [
        route('/public-downloads', {
          access: publicAccess('test fixture'),
          page(_context, request: Request & { signUrl?: unknown }) {
            return renderedHtml(
              JSON.stringify({
                hasSignUrl: 'signUrl' in request,
                signUrlType: typeof request.signUrl,
              }),
            );
          },
        }),
      ],
    });
    const handler = createRequestHandler(app);

    const page = await handler(new Request('https://example.test/public-downloads'));

    expect(page.headers.get('cache-control')).toBeNull();
    const body = await page.text();
    expect(body).toContain('"hasSignUrl":false');
    expect(body).toContain('"signUrlType":"undefined"');
    expect(app.capabilities.some((fact) => fact.source === 'request.signUrl')).toBe(false);
  });

  it('fails closed without reading storage for missing, tampered, expired, or wrong-method caps', async () => {
    const storage = capabilityStorage({
      'exports/report.csv': storageObject('exports/report.csv', 'ok', 'text/csv'),
    });
    const handler = createRequestHandler(createApp({ capabilityUrls: { secret, storage } }));

    await expect(handler(new Request('https://example.test/_cap/storage'))).resolves.toMatchObject({
      status: 403,
    });

    const signed = signCapabilityUrl({
      baseUrl: 'https://example.test/_cap/storage',
      expiresIn: 60,
      key: 'exports/report.csv',
      method: 'GET',
      now,
      secret,
    });
    const tampered = new URL(signed);
    tampered.searchParams.set('kovo-cap-key', 'exports/other.csv');
    await expect(handler(new Request(tampered))).resolves.toMatchObject({ status: 403 });

    const expired = signCapabilityUrl({
      baseUrl: 'https://example.test/_cap/storage',
      expiresIn: 1,
      key: 'exports/report.csv',
      method: 'GET',
      now: 0,
      secret,
    });
    await expect(handler(new Request(expired))).resolves.toMatchObject({ status: 403 });

    await expect(handler(new Request(signed, { method: 'HEAD' }))).resolves.toMatchObject({
      status: 403,
    });
    expect(storage.streamCalls).toEqual([]);
  });

  it('consumes one-time storage capabilities before reading and rejects replay', async () => {
    const replayStore = createMemoryMutationReplayStore<CapabilityUrlReplayResponse>();
    const storage = capabilityStorage({
      'exports/report.csv': storageObject('exports/report.csv', 'ok', 'text/csv'),
    });
    const signed = signCapabilityUrl({
      baseUrl: 'https://example.test/_cap/storage',
      expiresIn: 60,
      key: 'exports/report.csv',
      method: 'GET',
      oneTime: true,
      oneTimeNonce: 'download-01',
      secret,
    });
    const handler = createRequestHandler(
      createApp({ capabilityUrls: { replayStore, secret, storage } }),
    );

    const first = await handler(new Request(signed));
    expect(first.status).toBe(200);
    await expect(first.text()).resolves.toBe('ok');

    const second = await handler(new Request(signed));
    expect(second.status).toBe(403);
    expect(storage.streamCalls).toEqual(['exports/report.csv']);
  });
});

function capabilityStorage(
  objects: Record<string, StorageStreamResult>,
): StorageCapability & { streamCalls: string[] } {
  const streamCalls: string[] = [];
  return {
    streamCalls,
    async get() {
      throw new Error('capability storage test does not use get()');
    },
    async put() {
      throw new Error('capability storage test does not use put()');
    },
    async stat() {
      throw new Error('capability storage test does not use stat()');
    },
    async stream(key) {
      streamCalls.push(key);
      return objects[key];
    },
  };
}

function storageObject(key: string, text: string, contentType: string): StorageStreamResult {
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
    contentType,
    key,
  };
}
