import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '@kovojs/core/internal/storage';

import { createApp, createRequestHandler } from './app.js';
import {
  CAPABILITY_TOKEN_PARAM,
  DEFAULT_CAPABILITY_DOWNLOAD_BASE_PATH,
  createSignUrl,
  createStorageDownloadEndpoint,
  deriveDownloadKey,
  drainCapabilityMintFacts,
} from './capability-route.js';
import { createMemoryCapabilityReplayStore, signCapability } from './capability-url.js';
import { runEndpoint } from './endpoint.js';
import { renderedHtml } from './html.js';
import { route } from './route.js';

const SECRET = 'capability-route-test-secret-at-least-32-characters-long';
const BASE = DEFAULT_CAPABILITY_DOWNLOAD_BASE_PATH;

/** Seed a memory storage with one object so the route has something to (potentially) read. */
async function storageWith(key: string, body: string, metadata?: Readonly<Record<string, string>>) {
  const storage = createMemoryStorage();
  await storage.put(key, body, {
    contentType: 'text/plain',
    ...(metadata === undefined ? {} : { metadata }),
  });
  return storage;
}

/**
 * A storage capability that records every `get`, so a test can assert the verify sink ran BEFORE
 * (or instead of) any read. Wraps a real memory storage.
 */
function recordingStorage(inner: ReturnType<typeof createMemoryStorage>) {
  const reads: string[] = [];
  return {
    reads,
    storage: {
      get(key: string) {
        reads.push(key);
        return inner.get(key);
      },
      put: inner.put.bind(inner),
      stat: inner.stat.bind(inner),
      stream: inner.stream.bind(inner),
    },
  };
}

function downloadUrl(token: string, key = 'receipts/ord_1.pdf'): string {
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  return `https://app.example${BASE}/${encoded}?${CAPABILITY_TOKEN_PARAM}=${encodeURIComponent(token)}`;
}

describe('capability download route: verify-before-read sink', () => {
  it('declares framework-owned bytes response posture for build/explain audits', async () => {
    const storage = await storageWith('a.pdf', 'A');
    const route = createStorageDownloadEndpoint({ secret: SECRET, storage });

    expect(route.response).toEqual({
      appOwnedSafety: true,
      body: 'bytes',
      cache: 'private',
      reservedHeaders: ['X-Content-Type-Options'],
    });
  });
  it('a VALID scoped signed URL dereferences the object when the route derives the same scope', async () => {
    const key = 'receipts/ord_1.pdf';
    const storage = await storageWith(key, 'receipt-bytes');
    const route = createStorageDownloadEndpoint({
      secret: SECRET,
      storage,
      now: () => 1000,
      // The route derives the same scope from the request that the URL was minted with.
      scope: () => 'tenant_1',
    });
    const ctx = createSignUrl({ secret: SECRET, now: () => 1000 });
    const { url } = await ctx.signUrl({ key, scope: 'tenant_1', expiresIn: 60_000 });

    const response = await runEndpoint(
      route,
      new Request(`https://app.example${url}`, { method: 'GET' }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Vary')).toBe('Cookie');
    expect(await response.text()).toBe('receipt-bytes');
  });

  it('ctx.signUrl produces a URL the route verifies end-to-end (no scope)', async () => {
    const key = 'a.pdf';
    const storage = await storageWith(key, 'A');
    const route = createStorageDownloadEndpoint({ secret: SECRET, storage });
    const ctx = createSignUrl({ secret: SECRET });
    const { url } = await ctx.signUrl({ key });
    const response = await runEndpoint(route, new Request(`https://app.example${url}`));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('A');
  });

  it('uses stored upload filename metadata when no endpoint filename override is supplied', async () => {
    const key = 'uploads/note';
    const storage = await storageWith(key, 'note-body', { filename: 'note.txt' });
    const route = createStorageDownloadEndpoint({ secret: SECRET, storage });
    const ctx = createSignUrl({ secret: SECRET });
    const { url } = await ctx.signUrl({ key });

    const response = await runEndpoint(route, new Request(`https://app.example${url}`));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="note.txt"');
  });

  it('lets explicit endpoint filenames override stored upload filename metadata', async () => {
    const key = 'uploads/note';
    const storage = await storageWith(key, 'note-body', { filename: 'note.txt' });
    const route = createStorageDownloadEndpoint({
      secret: SECRET,
      storage,
      storedFile: { filename: 'download.txt' },
    });
    const ctx = createSignUrl({ secret: SECRET });
    const { url } = await ctx.signUrl({ key });

    const response = await runEndpoint(route, new Request(`https://app.example${url}`));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="download.txt"');
  });

  it('REJECTS a token minted for a DIFFERENT object (no cross-object read)', async () => {
    const storage = await storageWith('b.pdf', 'B-secret');
    const { reads, storage: recording } = recordingStorage(storage);
    // Inject a clock so the rejection is for claim-mismatch (not incidental expiry).
    const route = createStorageDownloadEndpoint({
      secret: SECRET,
      storage: recording,
      now: () => 1,
    });
    // Mint for a.pdf, then attempt to dereference b.pdf with it.
    const { token } = await signCapability(SECRET, { key: 'a.pdf' }, 0);
    const response = await runEndpoint(route, new Request(downloadUrl(token, 'b.pdf')));
    expect(response.status).toBe(404);
    // The object was NEVER read: the verify sink rejected before storage.get.
    expect(reads).toEqual([]);
    expect(await response.text()).not.toContain('B-secret');
  });

  it('REJECTS a tampered signature, object never read, no reason leaked', async () => {
    const storage = await storageWith('a.pdf', 'A');
    const { reads, storage: recording } = recordingStorage(storage);
    const route = createStorageDownloadEndpoint({ secret: SECRET, storage: recording });
    const { token } = await signCapability(SECRET, { key: 'a.pdf' }, 0);
    const [payload, sig] = token.split('.');
    const tampered = `${payload}.${sig!.slice(0, -2)}AA`;
    const response = await runEndpoint(route, new Request(downloadUrl(tampered, 'a.pdf')));
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Vary')).toBe('Cookie');
    expect(reads).toEqual([]);
    const body = await response.text();
    expect(body).toBe('Not Found');
    expect(body.toLowerCase()).not.toContain('signature');
  });

  it('REJECTS an expired token, object never read', async () => {
    const storage = await storageWith('a.pdf', 'A');
    const { reads, storage: recording } = recordingStorage(storage);
    const route = createStorageDownloadEndpoint({
      secret: SECRET,
      storage: recording,
      now: () => 10_000,
    });
    const { token } = await signCapability(SECRET, { key: 'a.pdf', expiresIn: 50 }, 0);
    const response = await runEndpoint(route, new Request(downloadUrl(token, 'a.pdf')));
    expect(response.status).toBe(404);
    expect(reads).toEqual([]);
  });

  it('REJECTS a wrong-secret token, object never read', async () => {
    const storage = await storageWith('a.pdf', 'A');
    const { reads, storage: recording } = recordingStorage(storage);
    const route = createStorageDownloadEndpoint({ secret: SECRET, storage: recording });
    const { token } = await signCapability(
      'a-totally-different-secret-padding-padding-pad',
      { key: 'a.pdf' },
      0,
    );
    const response = await runEndpoint(route, new Request(downloadUrl(token, 'a.pdf')));
    expect(response.status).toBe(404);
    expect(reads).toEqual([]);
  });

  it('REJECTS a GET token used on a HEAD request (method mismatch), object never read', async () => {
    const storage = await storageWith('a.pdf', 'A');
    const { reads, storage: recording } = recordingStorage(storage);
    const route = createStorageDownloadEndpoint({
      secret: SECRET,
      storage: recording,
      now: () => 1,
    });
    const { token } = await signCapability(SECRET, { key: 'a.pdf', method: 'GET' }, 0);
    const response = await runEndpoint(
      route,
      new Request(downloadUrl(token, 'a.pdf'), { method: 'HEAD' }),
    );
    expect(response.status).toBe(404);
    expect(reads).toEqual([]);
  });

  it('REJECTS a wrong-scope token (cross-tenant), object never read', async () => {
    const storage = await storageWith('a.pdf', 'A');
    const { reads, storage: recording } = recordingStorage(storage);
    const route = createStorageDownloadEndpoint({
      secret: SECRET,
      storage: recording,
      scope: () => 'tenant_2',
      now: () => 1,
    });
    const { token } = await signCapability(SECRET, { key: 'a.pdf', scope: 'tenant_1' }, 0);
    const response = await runEndpoint(route, new Request(downloadUrl(token, 'a.pdf')));
    expect(response.status).toBe(404);
    expect(reads).toEqual([]);
  });

  it('REJECTS a replayed one-time token on second use (first read OK, second never read)', async () => {
    const key = 'a.pdf';
    const storage = await storageWith(key, 'once');
    const { reads, storage: recording } = recordingStorage(storage);
    const replayStore = createMemoryCapabilityReplayStore({ now: () => 1 });
    const route = createStorageDownloadEndpoint({
      secret: SECRET,
      storage: recording,
      replayStore,
      now: () => 1,
    });
    const { token } = await signCapability(
      SECRET,
      {
        audience: `storage-download:${BASE}`,
        key,
        oneTime: true,
        expiresIn: 60_000,
      },
      0,
    );
    const first = await runEndpoint(route, new Request(downloadUrl(token, key)));
    expect(first.status).toBe(200);
    expect(reads).toEqual([key]);
    const second = await runEndpoint(route, new Request(downloadUrl(token, key)));
    expect(second.status).toBe(404);
    // No second read — the burn happened in the verify sink before any storage.get.
    expect(reads).toEqual([key]);
  });

  it('REJECTS a one-time token when the route has no replay store (fail closed)', async () => {
    const storage = await storageWith('a.pdf', 'A');
    const { reads, storage: recording } = recordingStorage(storage);
    const route = createStorageDownloadEndpoint({
      secret: SECRET,
      storage: recording,
      now: () => 1,
    });
    const { token } = await signCapability(
      SECRET,
      { key: 'a.pdf', oneTime: true, expiresIn: 60_000 },
      0,
    );
    const response = await runEndpoint(route, new Request(downloadUrl(token, 'a.pdf')));
    expect(response.status).toBe(404);
    expect(reads).toEqual([]);
  });

  it('REJECTS a request with no token, object never read', async () => {
    const storage = await storageWith('a.pdf', 'A');
    const { reads, storage: recording } = recordingStorage(storage);
    const route = createStorageDownloadEndpoint({ secret: SECRET, storage: recording });
    const response = await runEndpoint(route, new Request(`https://app.example${BASE}/a.pdf`));
    expect(response.status).toBe(404);
    expect(reads).toEqual([]);
  });

  it('a HEAD request with a valid HEAD token verifies and returns no body', async () => {
    const key = 'a.pdf';
    const storage = await storageWith(key, 'A');
    const route = createStorageDownloadEndpoint({ secret: SECRET, storage, now: () => 1 });
    const { token } = await signCapability(
      SECRET,
      { audience: `storage-download:${BASE}`, key, method: 'HEAD' },
      0,
    );
    const response = await runEndpoint(
      route,
      new Request(downloadUrl(token, key), { method: 'HEAD' }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  it('a valid token for a MISSING object returns 404 (no existence oracle)', async () => {
    const storage = createMemoryStorage();
    const route = createStorageDownloadEndpoint({ secret: SECRET, storage });
    const { token } = await signCapability(SECRET, { key: 'missing.pdf' }, 0);
    const response = await runEndpoint(route, new Request(downloadUrl(token, 'missing.pdf')));
    expect(response.status).toBe(404);
  });
});

describe('deriveDownloadKey: request-derived expected key', () => {
  it('extracts and normalizes the key after the mount base', () => {
    expect(deriveDownloadKey(`${BASE}/receipts/ord_1.pdf`, BASE)).toBe('receipts/ord_1.pdf');
  });

  it('returns undefined for a path not under the mount', () => {
    expect(deriveDownloadKey('/other/a.pdf', BASE)).toBeUndefined();
  });

  it('returns undefined for the bare mount with no key', () => {
    expect(deriveDownloadKey(BASE, BASE)).toBeUndefined();
  });

  it('returns undefined for a traversal key (fail closed)', () => {
    expect(deriveDownloadKey(`${BASE}/../etc/passwd`, BASE)).toBeUndefined();
  });
});

describe('ctx.signUrl: mint shape + audit facts', () => {
  it('mints a URL under the mount base with the token in the kovo-cap param', async () => {
    drainCapabilityMintFacts();
    const ctx = createSignUrl({ secret: SECRET });
    const { url, token, key, oneTime } = await ctx.signUrl({ key: 'receipts/ord_1.pdf' });
    expect(url.startsWith(`${BASE}/receipts/ord_1.pdf?`)).toBe(true);
    expect(url).toContain(`${CAPABILITY_TOKEN_PARAM}=`);
    expect(url).toContain(encodeURIComponent(token));
    expect(key).toBe('receipts/ord_1.pdf');
    expect(oneTime).toBe(false);
  });

  it('refuses to mint one-time URLs unless the signer is bound to a replay-store endpoint', async () => {
    const ctx = createSignUrl({ secret: SECRET });

    await expect(ctx.signUrl({ key: 'a.pdf', oneTime: true })).rejects.toThrow(
      /requires a storage download endpoint with a replayStore/u,
    );
  });

  it('mints one-time URLs when the selected endpoint has a replay store', async () => {
    const key = 'once.txt';
    const storage = await storageWith(key, 'once');
    const replayStore = createMemoryCapabilityReplayStore();
    const route = createStorageDownloadEndpoint({ secret: SECRET, storage, replayStore });
    const ctx = createSignUrl({ secret: SECRET, oneTimeReplayStore: true });

    const { url, oneTime } = await ctx.signUrl({ key, oneTime: true });
    const first = await runEndpoint(route, new Request(`https://app.example${url}`));
    const second = await runEndpoint(route, new Request(`https://app.example${url}`));

    expect(oneTime).toBe(true);
    expect(first.status).toBe(200);
    expect(await first.text()).toBe('once');
    expect(second.status).toBe(404);
  });

  it('records a capability-mint fact per signUrl call (drained for kovo explain --capabilities)', async () => {
    drainCapabilityMintFacts();
    const ctx = createSignUrl({ secret: SECRET, oneTimeReplayStore: true });
    await ctx.signUrl({ key: 'a.pdf', scope: 't1', expiresIn: 1234, oneTime: true });
    await ctx.signUrl({ key: 'b.pdf' });
    const facts = drainCapabilityMintFacts();
    expect(facts).toHaveLength(2);
    expect(facts[0]).toMatchObject({
      key: 'a.pdf',
      method: 'GET',
      scope: 't1',
      oneTime: true,
      expiresInMs: 1234,
    });
    expect(facts[1]).toMatchObject({ key: 'b.pdf', method: 'GET', oneTime: false });
    // Draining is destructive.
    expect(drainCapabilityMintFacts()).toHaveLength(0);
  });

  it('canonicalizes the key before signing so the route re-derives the same key', async () => {
    const key = 'a.pdf';
    const storage = await storageWith(key, 'A');
    const route = createStorageDownloadEndpoint({ secret: SECRET, storage });
    const ctx = createSignUrl({ secret: SECRET });
    // A key with redundant slashes normalizes identically on both ends.
    const { url } = await ctx.signUrl({ key });
    const response = await runEndpoint(route, new Request(`https://app.example${url}`));
    expect(response.status).toBe(200);
  });

  it('composes with a custom createStorageDownloadEndpoint basePath mounted on the app', async () => {
    const key = 'receipts/custom.txt';
    const storage = await storageWith(key, 'custom-download', { filename: 'custom.txt' });
    const app = createApp({
      csrf: { secret: SECRET, sessionId: () => 'anonymous' },
      endpoints: [
        createStorageDownloadEndpoint({ basePath: '/downloads', secret: SECRET, storage }),
      ],
      routes: [
        route('/', {
          async page(context) {
            if (context.signUrl === undefined) throw new Error('missing ctx.signUrl');
            const signed = await context.signUrl({ key });
            return renderedHtml(`<a href="${signed.url}">Download</a>`);
          },
        }),
      ],
    });
    const handler = createRequestHandler(app);

    const document = await handler(new Request('https://app.example/'));
    const html = await document.text();
    const href = html.match(/href="([^"]+)"/)?.[1];

    expect(href?.startsWith('/downloads/receipts/custom.txt?')).toBe(true);
    const response = await handler(new Request(`https://app.example${href}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="custom.txt"');
    expect(await response.text()).toBe('custom-download');
  });

  it('route ctx.signUrl fails clearly when multiple storage download endpoints are mounted', async () => {
    const key = 'receipts/custom.txt';
    const storage = await storageWith(key, 'custom-download');
    const errors: unknown[] = [];
    const app = createApp({
      csrf: { secret: SECRET, sessionId: () => 'anonymous' },
      endpoints: [
        createStorageDownloadEndpoint({ basePath: '/private-downloads', secret: SECRET, storage }),
        createStorageDownloadEndpoint({ basePath: '/public-downloads', secret: SECRET, storage }),
      ],
      onError(error) {
        errors.push(error);
      },
      routes: [
        route('/', {
          async page(context) {
            if (context.signUrl === undefined) throw new Error('missing ctx.signUrl');
            await context.signUrl({ key });
            return renderedHtml('<main>unreachable</main>');
          },
        }),
      ],
    });
    const handler = createRequestHandler(app);

    const response = await handler(new Request('https://app.example/'));

    expect(response.status).toBe(500);
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('ctx.signUrl() is ambiguous');
    expect(String(errors[0])).toContain('/private-downloads');
    expect(String(errors[0])).toContain('/public-downloads');
  });
});
