import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import {
  publicScopedKey,
  type ScopedKey,
  type StorageBody,
  type StorageCapability,
  type StoragePutOptions,
  type StorageReadCapability,
} from '@kovojs/core';
import {
  createFileSystemStorage as createFileSystemStorageCapability,
  createMemoryStorage as createMemoryStorageCapability,
  scopedKeyFactsFor,
} from '@kovojs/core/internal/storage';

import { createApp, createRequestHandler } from './app.js';
import {
  CAPABILITY_TOKEN_PARAM,
  DEFAULT_CAPABILITY_DOWNLOAD_BASE_PATH,
  createSignUrl as createSignUrlCapability,
  createStorageDownloadEndpoint,
  deriveDownloadKey,
  drainCapabilityMintFacts,
  type StorageDownloadEndpointOptions,
} from './capability-route.js';
import {
  createMemoryCapabilityReplayStore,
  MAX_CAPABILITY_AUDIENCE_LENGTH,
  MAX_CAPABILITY_SCOPE_LENGTH,
  signCapability as signCapabilityPrimitive,
  verifyCapability,
} from './capability-url.js';
import { runEndpoint } from './endpoint.js';
import { renderedHtml } from './html.js';
import { route } from './route.js';

const SECRET = 'capability-route-test-secret-at-least-32-characters-long';
const BASE = DEFAULT_CAPABILITY_DOWNLOAD_BASE_PATH;

type TestStorageCapability = Omit<
  StorageCapability,
  'delete' | 'get' | 'put' | 'stat' | 'stream'
> & {
  delete(key: ScopedKey | string): Promise<void>;
  get(key: ScopedKey | string): ReturnType<StorageCapability['get']>;
  put(
    key: ScopedKey | string,
    body: StorageBody,
    options?: StoragePutOptions,
  ): ReturnType<StorageCapability['put']>;
  stat(key: ScopedKey | string): ReturnType<StorageCapability['stat']>;
  stream(key: ScopedKey | string): ReturnType<StorageCapability['stream']>;
};

function testScopedKey(key: ScopedKey | string): ScopedKey {
  return typeof key === 'string' ? publicScopedKey(key) : key;
}

function testKeyFrame(key: string): string {
  return scopedKeyFactsFor(publicScopedKey(key)).frame;
}

function encodedTestKeyFrame(key: string): string {
  return testKeyFrame(key).split('/').map(encodeURIComponent).join('/');
}

function testStorage(storage: StorageCapability): TestStorageCapability {
  return {
    delete: (key) => storage.delete(testScopedKey(key)),
    get: (key) => storage.get(testScopedKey(key)),
    put: (key, body, options) => storage.put(testScopedKey(key), body, options),
    stat: (key) => storage.stat(testScopedKey(key)),
    stream: (key) => storage.stream(testScopedKey(key)),
  };
}

function createMemoryStorage(
  ...args: Parameters<typeof createMemoryStorageCapability>
): TestStorageCapability {
  return testStorage(createMemoryStorageCapability(...args));
}

function createFileSystemStorage(
  ...args: Parameters<typeof createFileSystemStorageCapability>
): TestStorageCapability {
  return testStorage(createFileSystemStorageCapability(...args));
}

function createSignUrl(...args: Parameters<typeof createSignUrlCapability>) {
  const signer = createSignUrlCapability(...args);
  return {
    signUrl(
      options: Omit<Parameters<typeof signer.signUrl>[0], 'key'> & { key: ScopedKey | string },
    ) {
      return signer.signUrl({ ...options, key: testScopedKey(options.key) });
    },
  };
}

function signCapability(
  secret: Parameters<typeof signCapabilityPrimitive>[0],
  options: Parameters<typeof signCapabilityPrimitive>[1],
  now?: Parameters<typeof signCapabilityPrimitive>[2],
) {
  const framedOptions = { ...options, key: testKeyFrame(options.key) };
  return now === undefined
    ? signCapabilityPrimitive(secret, framedOptions)
    : signCapabilityPrimitive(secret, framedOptions, now);
}

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
      get(key: ScopedKey) {
        reads.push(scopedKeyFactsFor(key).key);
        return inner.get(key);
      },
      put: inner.put.bind(inner),
      stat: inner.stat.bind(inner),
      stream: inner.stream.bind(inner),
    },
  };
}

function downloadUrl(token: string, key = 'receipts/ord_1.pdf'): string {
  const encoded = encodedTestKeyFrame(key);
  return `https://app.example${BASE}/${encoded}?${CAPABILITY_TOKEN_PARAM}=${encodeURIComponent(token)}`;
}

function invokeDownloadHandler(
  route: ReturnType<typeof createStorageDownloadEndpoint>,
  request: Request,
): Promise<Response> {
  return (route.handler as (request: Request) => Promise<Response>)(request);
}

describe('capability download route: verify-before-read sink', () => {
  it('declares framework-owned bytes response posture for build/explain audits', async () => {
    const storage = await storageWith('a.pdf', 'A');
    const route = createStorageDownloadEndpoint({ secret: SECRET, storage });

    expect(route.response).toEqual({
      appOwnedSafety: true,
      body: ['bytes', 'text'],
      cache: 'private',
      reservedHeaders: ['X-Content-Type-Options'],
    });
  });

  it('accepts read-only storage authority for the verified download sink', async () => {
    const key = 'receipts/read-only.txt';
    const storage = await storageWith(key, 'read-only-download');
    const readOnly: StorageReadCapability = {
      get: storage.get.bind(storage),
      stat: storage.stat.bind(storage),
      stream: storage.stream.bind(storage),
    };
    const route = createStorageDownloadEndpoint({ secret: SECRET, storage: readOnly });
    const ctx = createSignUrl({ secret: SECRET });
    const { url } = await ctx.signUrl({ key });

    const response = await runEndpoint(route, new Request(`https://app.example${url}`));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('read-only-download');
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

  it('pins the route secret and scope instead of retaining the caller options object', async () => {
    const storage = await storageWith('private.pdf', 'PRIVATE');
    const { reads, storage: recording } = recordingStorage(storage);
    const options: StorageDownloadEndpointOptions = {
      now: () => 1,
      scope: () => 'tenant_original',
      secret: SECRET,
      storage: recording,
    };
    const route = createStorageDownloadEndpoint(options);
    options.secret = 'attacker-capability-secret-at-least-32-bytes';
    options.scope = () => 'tenant_attacker';

    const { token } = await signCapability(
      options.secret,
      {
        audience: `storage-download:${BASE}`,
        key: 'private.pdf',
        scope: 'tenant_attacker',
      },
      0,
    );
    const response = await runEndpoint(route, new Request(downloadUrl(token, 'private.pdf')));

    expect(response.status).toBe(404);
    expect(reads).toEqual([]);
  });

  it('pins the verification clock so retained config mutation cannot revive an expired token', async () => {
    const storage = await storageWith('expired.pdf', 'PRIVATE');
    const { reads, storage: recording } = recordingStorage(storage);
    const options: StorageDownloadEndpointOptions = {
      now: () => 100,
      secret: SECRET,
      storage: recording,
    };
    const route = createStorageDownloadEndpoint(options);
    options.now = () => 0;
    const { token } = await signCapability(SECRET, { expiresIn: 5, key: 'expired.pdf' }, 0);

    const response = await runEndpoint(route, new Request(downloadUrl(token, 'expired.pdf')));
    expect(response.status).toBe(404);
    expect(reads).toEqual([]);
  });

  it('pins the replay store so swapping retained config cannot replay a one-time token', async () => {
    const storage = await storageWith('once.pdf', 'PRIVATE');
    const options: StorageDownloadEndpointOptions = {
      now: () => 1,
      replayStore: createMemoryCapabilityReplayStore({ now: () => 1 }),
      secret: SECRET,
      storage,
    };
    const route = createStorageDownloadEndpoint(options);
    const { token } = await signCapability(
      SECRET,
      {
        audience: `storage-download:${BASE}`,
        expiresIn: 60_000,
        key: 'once.pdf',
        oneTime: true,
      },
      0,
    );
    const first = await runEndpoint(route, new Request(downloadUrl(token, 'once.pdf')));
    options.replayStore = createMemoryCapabilityReplayStore({ now: () => 1 });
    const second = await runEndpoint(route, new Request(downloadUrl(token, 'once.pdf')));

    expect(first.status).toBe(200);
    expect(second.status).toBe(404);
  });

  it('pins stored-file response posture instead of reading a mutated nested options object', async () => {
    const storage = await storageWith('download.txt', 'download');
    const storedFile = { disposition: 'attachment' as const, filename: 'original.txt' };
    const route = createStorageDownloadEndpoint({ secret: SECRET, storage, storedFile });
    storedFile.filename = 'mutated.txt';
    const { url } = await createSignUrl({ secret: SECRET }).signUrl({ key: 'download.txt' });

    const response = await runEndpoint(route, new Request(`https://app.example${url}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="original.txt"');
  });

  it('uses pinned request method controls when a late string override tries to turn POST into GET', async () => {
    const storage = await storageWith('a.pdf', 'PRIVATE');
    const { reads, storage: recording } = recordingStorage(storage);
    const route = createStorageDownloadEndpoint({
      now: () => 1,
      secret: SECRET,
      storage: recording,
    });
    const { token } = await signCapability(SECRET, { key: 'a.pdf' }, 0);
    const originalToUpperCase = String.prototype.toUpperCase;
    try {
      String.prototype.toUpperCase = () => 'GET';
      const response = await invokeDownloadHandler(
        route,
        new Request(downloadUrl(token, 'a.pdf'), { method: 'POST' }),
      );
      expect(response.status).toBe(404);
      expect(reads).toEqual([]);
    } finally {
      String.prototype.toUpperCase = originalToUpperCase;
    }
  });

  it('uses the pinned URL pathname getter when late poisoning tries to substitute an object path', async () => {
    const storage = await storageWith('private.pdf', 'PRIVATE');
    const { reads, storage: recording } = recordingStorage(storage);
    const route = createStorageDownloadEndpoint({
      now: () => 1,
      secret: SECRET,
      storage: recording,
    });
    const { token } = await signCapability(SECRET, { key: 'private.pdf' }, 0);
    const pathname = Object.getOwnPropertyDescriptor(URL.prototype, 'pathname');
    if (pathname === undefined) throw new Error('missing URL pathname descriptor');
    try {
      Object.defineProperty(URL.prototype, 'pathname', {
        ...pathname,
        get: () => `${BASE}/private.pdf`,
      });
      const response = await invokeDownloadHandler(
        route,
        new Request(downloadUrl(token, 'public.pdf')),
      );
      expect(response.status).toBe(404);
      expect(reads).toEqual([]);
    } finally {
      Object.defineProperty(URL.prototype, 'pathname', pathname);
    }
  });

  it('does not let a case-aliased filesystem key turn an exact capability into another object', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-capability-storage-exact-key-'));
    try {
      const storedKey = 'Tenant/Victim.txt';
      const aliasedKey = 'tenant/victim.txt';
      const storage = createFileSystemStorage({ root });
      await storage.put(storedKey, 'VICTIM SECRET');
      const route = createStorageDownloadEndpoint({ secret: SECRET, storage });
      const ctx = createSignUrl({ secret: SECRET });

      const aliasCapability = await ctx.signUrl({ key: aliasedKey });
      const aliasResponse = await runEndpoint(
        route,
        new Request(`https://app.example${aliasCapability.url}`),
      );
      expect(aliasResponse.status).toBe(404);
      expect(await aliasResponse.text()).not.toContain('VICTIM SECRET');

      const exactCapability = await ctx.signUrl({ key: storedKey });
      const exactResponse = await runEndpoint(
        route,
        new Request(`https://app.example${exactCapability.url}`),
      );
      expect(exactResponse.status).toBe(200);
      expect(await exactResponse.text()).toBe('VICTIM SECRET');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
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

  it('dispatches a mounted signed HEAD request through the app shell', async () => {
    const key = 'a.pdf';
    const storage = await storageWith(key, 'A');
    const app = createApp({
      endpoints: [createStorageDownloadEndpoint({ secret: SECRET, storage, now: () => 1 })],
    });
    const handler = createRequestHandler(app);
    const { token } = await signCapability(
      SECRET,
      { audience: `storage-download:${BASE}`, key, method: 'HEAD' },
      0,
    );

    const response = await handler(
      new Request(downloadUrl(token, key), {
        method: 'HEAD',
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/plain');
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
    const key = deriveDownloadKey(`${BASE}/${encodedTestKeyFrame('receipts/ord_1.pdf')}`, BASE);
    expect(scopedKeyFactsFor(key).key).toBe('receipts/ord_1.pdf');
  });

  it('normalizes a trailing slash on the mount base before deriving the key', () => {
    const key = deriveDownloadKey(
      `${BASE}/${encodedTestKeyFrame('receipts/ord_1.pdf')}`,
      `${BASE}/`,
    );
    expect(scopedKeyFactsFor(key).key).toBe('receipts/ord_1.pdf');
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

  it('returns undefined for an unsafe capability base path', () => {
    expect(deriveDownloadKey(`${BASE}/a.pdf`, 'https://evil.example/downloads')).toBeUndefined();
    expect(deriveDownloadKey(`${BASE}/a.pdf`, '//evil.example/downloads')).toBeUndefined();
    expect(
      deriveDownloadKey(`${BASE}/a.pdf`, '/downloads\r\nSet-Cookie: c2=owned'),
    ).toBeUndefined();
  });
});

describe('ctx.signUrl: mint shape + audit facts', () => {
  it('mints a URL under the mount base with the token in the kovo-cap param', async () => {
    drainCapabilityMintFacts();
    const ctx = createSignUrl({ secret: SECRET });
    const { url, token, key, oneTime } = await ctx.signUrl({ key: 'receipts/ord_1.pdf' });
    expect(url.startsWith(`${BASE}/${encodedTestKeyFrame('receipts/ord_1.pdf')}?`)).toBe(true);
    expect(url).toContain(`${CAPABILITY_TOKEN_PARAM}=`);
    expect(url).toContain(encodeURIComponent(token));
    expect(scopedKeyFactsFor(key).key).toBe('receipts/ord_1.pdf');
    expect(oneTime).toBe(false);
  });

  it('pins signer secret, scope, base path, replay posture, and clock at construction', async () => {
    const configuration = {
      basePath: '/downloads',
      defaultScope: 'tenant_original',
      now: () => 10,
      oneTimeReplayStore: true,
      secret: SECRET,
    };
    const signer = createSignUrl(configuration);
    configuration.basePath = '/attacker';
    configuration.defaultScope = 'tenant_attacker';
    configuration.now = () => 20;
    configuration.oneTimeReplayStore = false;
    configuration.secret = 'attacker-capability-secret-at-least-32-bytes';

    const signed = await signer.signUrl({ expiresIn: 5, key: 'a.pdf', oneTime: true });
    expect(signed.url.startsWith(`/downloads/${encodedTestKeyFrame('a.pdf')}?`)).toBe(true);
    await expect(
      verifyCapability(
        SECRET,
        signed.token,
        { key: testKeyFrame('a.pdf'), method: 'GET', scope: 'tenant_original' },
        { audience: 'storage-download:/downloads', now: 16 },
      ),
    ).resolves.toMatchObject({ ok: false, reason: 'expired' });
    const replayStore = createMemoryCapabilityReplayStore({ now: () => 11 });
    await expect(
      verifyCapability(
        SECRET,
        signed.token,
        { key: testKeyFrame('a.pdf'), method: 'GET', scope: 'tenant_original' },
        { audience: 'storage-download:/downloads', now: 11, replayStore },
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  it('rejects unsafe capability URL base paths before minting bearer URLs', () => {
    for (const basePath of [
      '/',
      'https://evil.example/downloads',
      '//evil.example/downloads',
      '/\\evil.example/downloads',
      '/downloads\\evil',
      '/downloads?next=/other',
      '/downloads#fragment',
      '/downloads\r\nSet-Cookie: c2=owned',
    ]) {
      expect(() => createSignUrl({ basePath, secret: SECRET }), basePath).toThrow(
        /Capability URL basePath/u,
      );
    }
  });

  it('rejects unsafe storage download endpoint mount paths at the verify sink', async () => {
    const storage = await storageWith('a.pdf', 'A');

    expect(() =>
      createStorageDownloadEndpoint({
        basePath: 'https://evil.example/downloads',
        secret: SECRET,
        storage,
      }),
    ).toThrow(/Capability URL basePath/u);
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

  it('bounds signer configuration and retained capability-mint claim text', async () => {
    drainCapabilityMintFacts();
    const key = 'k'.repeat(1024);
    const scope = 's'.repeat(MAX_CAPABILITY_SCOPE_LENGTH);
    const ctx = createSignUrl({ secret: SECRET });

    await ctx.signUrl({ key, scope });
    expect(drainCapabilityMintFacts()).toEqual([expect.objectContaining({ key, scope })]);
    expect(() => ctx.signUrl({ key: 'k'.repeat(1025) })).toThrow(/1\.\.1024/);
    expect(() =>
      createSignUrl({
        defaultScope: 's'.repeat(MAX_CAPABILITY_SCOPE_LENGTH + 1),
        secret: SECRET,
      }),
    ).toThrow(/stable values/);
    expect(() =>
      createSignUrl({
        basePath: `/${'a'.repeat(MAX_CAPABILITY_AUDIENCE_LENGTH)}`,
        secret: SECRET,
      }),
    ).toThrow(/stable values|bounded capability audience/);
  });

  it('bounds normal signUrl observations to the newest 256 facts', async () => {
    drainCapabilityMintFacts();
    const ctx = createSignUrl({ secret: SECRET, now: () => 1_000 });
    for (let index = 0; index < 10_000; index += 1) {
      await ctx.signUrl({ key: `bounded/${index}.txt` });
    }

    const facts = drainCapabilityMintFacts();
    expect(facts).toHaveLength(256);
    expect(facts[0]).toMatchObject({ key: 'bounded/9744.txt' });
    expect(facts.at(-1)).toMatchObject({ key: 'bounded/9999.txt' });
    expect(drainCapabilityMintFacts()).toEqual([]);
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
      csrf: {
        secret: 'different-app-csrf-secret-at-least-32-characters',
        sessionId: () => 'anonymous',
      },
      endpoints: [
        createStorageDownloadEndpoint({ basePath: '/downloads', secret: SECRET, storage }),
      ],
      routes: [
        route('/', {
          async page(context) {
            if (context.signUrl === undefined) throw new Error('missing ctx.signUrl');
            const signed = await context.signUrl({ key: publicScopedKey(key) });
            return renderedHtml(`<a href="${signed.url}">Download</a>`);
          },
        }),
      ],
    });
    const handler = createRequestHandler(app);

    const document = await handler(new Request('https://app.example/'));
    const html = await document.text();
    const href = html.match(/href="([^"]+)"/)?.[1];

    expect(href?.startsWith(`/downloads/${encodedTestKeyFrame(key)}?`)).toBe(true);
    const response = await handler(new Request(`https://app.example${href}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="custom.txt"');
    expect(await response.text()).toBe('custom-download');
  });

  it('never exposes a verified bearer to onError when the post-verification storage read fails', async () => {
    const key = 'receipts/failing.txt';
    const storage: StorageReadCapability = {
      async get() {
        throw new Error('verified storage backend failed');
      },
      async stat() {
        return undefined;
      },
      async stream() {
        return undefined;
      },
    };
    const onError = vi.fn();
    const app = createApp({
      endpoints: [
        createStorageDownloadEndpoint({ basePath: '/downloads', secret: SECRET, storage }),
      ],
      onError,
    });
    const { url, token } = await createSignUrl({ basePath: '/downloads', secret: SECRET }).signUrl({
      key,
    });

    const response = await createRequestHandler(app)(new Request(`https://app.example${url}`));

    expect(response.status).toBe(500);
    expect(onError).toHaveBeenCalledTimes(1);
    const [, context] = onError.mock.calls[0]!;
    const redactedPath = `/downloads/${encodedTestKeyFrame(key)}?kovo-cap`;
    expect(context.url).toBe(redactedPath);
    expect(context.request.url).toBe(`https://app.example${redactedPath}`);
    expect(JSON.stringify(onError.mock.calls)).not.toContain(token);
  });

  it('mounts ctx.signUrl from the storage endpoint secret even when app CSRF is not configured', async () => {
    const key = 'receipts/no-csrf.txt';
    const storage = await storageWith(key, 'download-without-csrf');
    const app = createApp({
      endpoints: [
        createStorageDownloadEndpoint({ basePath: '/downloads', secret: SECRET, storage }),
      ],
      routes: [
        route('/', {
          async page(context) {
            if (context.signUrl === undefined) throw new Error('missing ctx.signUrl');
            const signed = await context.signUrl({ key: publicScopedKey(key) });
            return renderedHtml(`<a href="${signed.url}">Download</a>`);
          },
        }),
      ],
    });
    const handler = createRequestHandler(app);

    const document = await handler(new Request('https://app.example/'));
    const href = (await document.text()).match(/href="([^"]+)"/)?.[1];

    expect(href?.startsWith(`/downloads/${encodedTestKeyFrame(key)}?`)).toBe(true);
    const response = await handler(new Request(`https://app.example${href}`));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('download-without-csrf');
  });

  it('threads createStorageDownloadEndpoint scope into route ctx.signUrl defaultScope', async () => {
    const key = 'receipts/scoped.txt';
    const storage = await storageWith(key, 'tenant-download');
    const app = createApp({
      endpoints: [
        createStorageDownloadEndpoint({
          basePath: '/downloads',
          scope: (request) => request.headers.get('x-machine-tenant') ?? undefined,
          secret: SECRET,
          storage,
        }),
      ],
      routes: [
        route('/', {
          async page(context) {
            if (context.signUrl === undefined) throw new Error('missing ctx.signUrl');
            const signed = await context.signUrl({ key: publicScopedKey(key) });
            return renderedHtml(`<a href="${signed.url}">Download</a>`);
          },
        }),
      ],
    });
    const handler = createRequestHandler(app);

    const document = await handler(
      new Request('https://app.example/', { headers: { 'x-machine-tenant': 'tenant_1' } }),
    );
    const href = (await document.text()).match(/href="([^"]+)"/)?.[1];

    expect(href?.startsWith(`/downloads/${encodedTestKeyFrame(key)}?`)).toBe(true);
    const response = await handler(
      new Request(`https://app.example${href}`, {
        headers: { 'x-machine-tenant': 'tenant_1' },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('tenant-download');
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
            await context.signUrl({ key: publicScopedKey(key) });
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

  it('keeps multiple storage signers ambiguous after app code mutates array mapping', async () => {
    const key = 'receipts/authority.txt';
    const privateStorage = await storageWith(key, 'private-download');
    const publicStorage = await storageWith(key, 'public-download');
    const privateSecret = 'private-capability-secret-at-least-32-characters';
    const publicSecret = 'public-capability-secret-at-least-32-characters';
    const errors: unknown[] = [];
    const app = createApp({
      endpoints: [
        createStorageDownloadEndpoint({
          basePath: '/private-downloads',
          secret: privateSecret,
          storage: privateStorage,
        }),
        createStorageDownloadEndpoint({
          basePath: '/public-downloads',
          secret: publicSecret,
          storage: publicStorage,
        }),
      ],
      onError(error) {
        errors.push(error);
      },
      routes: [
        route('/', {
          async page(context) {
            if (context.signUrl === undefined) throw new Error('missing ctx.signUrl');
            const signed = await context.signUrl({ key: publicScopedKey(key) });
            return renderedHtml(`<a href="${signed.url}">Download</a>`);
          },
        }),
      ],
    });
    const handler = createRequestHandler(app);
    const originalMap = Array.prototype.map;
    let response: Response;

    try {
      Array.prototype.map = function substituteStorageSigner(callback, thisArg) {
        const mapped = Reflect.apply(originalMap, this, [callback, thisArg]) as unknown[];
        if (
          mapped.length === 2 &&
          (mapped[0] as { basePath?: unknown } | undefined)?.basePath === '/private-downloads' &&
          (mapped[1] as { basePath?: unknown } | undefined)?.basePath === '/public-downloads'
        ) {
          return [mapped[0]];
        }
        return mapped;
      } as typeof Array.prototype.map;
      response = await handler(new Request('https://app.example/'));
    } finally {
      Array.prototype.map = originalMap;
    }

    expect(response!.status).toBe(500);
    expect(await response!.text()).not.toContain('kovo-cap=');
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('ctx.signUrl() is ambiguous');
  });

  it('binds route ctx.signUrl without mutable Function.prototype authority', async () => {
    const storage = createMemoryStorage();
    await storage.put('receipts/public.txt', 'public-download', { contentType: 'text/plain' });
    await storage.put('receipts/secret.txt', 'secret-download', { contentType: 'text/plain' });
    const app = createApp({
      endpoints: [
        createStorageDownloadEndpoint({
          basePath: '/downloads',
          secret: SECRET,
          storage,
        }),
      ],
      routes: [
        route('/', {
          async page(context) {
            if (context.signUrl === undefined) throw new Error('missing ctx.signUrl');
            const signed = await context.signUrl({ key: publicScopedKey('receipts/public.txt') });
            return renderedHtml(`<a href="${signed.url}">Download</a>`);
          },
        }),
      ],
    });
    const handler = createRequestHandler(app);
    const nativeBind = Function.prototype.bind;
    let bindHits = 0;
    let documentResponse: Response;

    try {
      Function.prototype.bind = function substituteCapabilityKey(thisArg, ...args) {
        const bound = Reflect.apply(nativeBind, this, [thisArg, ...args]) as (
          options: Record<string, unknown>,
        ) => Promise<unknown>;
        if (this.name !== 'signUrl') return bound;
        bindHits += 1;
        return async (options: Record<string, unknown>) =>
          bound({ ...options, key: 'receipts/secret.txt' });
      };
      documentResponse = await handler(new Request('https://app.example/'));
    } finally {
      Function.prototype.bind = nativeBind;
    }

    const document = await documentResponse!.text();
    const href = document.match(/href="([^"]+)"/)?.[1];
    expect(documentResponse!.status).toBe(200);
    expect(href).toContain(`/downloads/${encodedTestKeyFrame('receipts/public.txt')}?`);
    expect(bindHits).toBe(0);
    const download = await handler(new Request(`https://app.example${href}`));
    expect(await download.text()).toBe('public-download');
  });
});
