import { createServer } from 'node:http';
import { request as nodeHttpRequest, type IncomingHttpHeaders } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import type { CacheInfluenceManifest } from '@kovojs/core/internal/cache-influence';

import { afterEach, describe, expect, it } from 'vitest';

import { publicAccess } from './access.js';
import { createApp, createRequestHandler } from './app.js';
import { node as nodePresetToken, vercel as vercelPresetToken } from './build.js';
import { resolveKovoBuildPreset, type KovoBuildPreset } from '@kovojs/server/internal/build-preset';
import { renderedHtml } from './html.js';
import { installGeneratedCacheInfluenceManifestForCommand } from './generated-cache-influence-registry.js';
import { writeKovoNeutralBuild } from './neutral-build.js';
import { route } from './route.js';

const roots: string[] = [];
let releaseManifest: (() => void) | undefined;

afterEach(async () => {
  releaseManifest?.();
  releaseManifest = undefined;
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function closedDocumentEntry(root: string): CacheInfluenceManifest['entries'][number] {
  return {
    authored: { posture: 'public' },
    axes: [
      { kind: 'url-path', role: 'cache-key' },
      { kind: 'url-search', role: 'cache-key' },
      { kind: 'cookie', role: 'shared-cache-closed' },
    ],
    closedReasons: ['cookie-influence'],
    root,
    surface: 'document',
    vary: [],
    verdict: 'shared-cache-closed',
  };
}

interface EmittedCompressionAdapter {
  clearProvedDocumentCompressionCacheForTest(): void;
  disableProvedDocumentCompressionCacheForBenchmark(): void;
  nodeRequestToWebRequest(request: import('node:http').IncomingMessage): Request;
  prepareVercelRequestIngress(request: import('node:http').IncomingMessage): object;
  preparedNodeRequestToWebRequest(
    prepared: object,
    response: import('node:http').ServerResponse,
  ): Request;
  preparedNodeRequestTransportMetadata(prepared: object): {
    readonly acceptEncoding?: string;
    readonly httpVersion: string;
    readonly method: string;
  };
  provedDocumentCompressionCacheStatsForTest(): {
    readonly bytes: number;
    readonly cancellations: number;
    readonly compressions: number;
    readonly entries: number;
    readonly hits: number;
    readonly misses: number;
  };
  provedDocumentCompressionWitnessForTest(response: Response): unknown;
  rejectPreparedNodeRequestIngress(
    prepared: object,
    response: import('node:http').ServerResponse,
  ): boolean;
  writeWebResponseToNode(
    response: Response,
    nodeResponse: import('node:http').ServerResponse,
    method?: string,
    options?: Record<string, unknown>,
  ): Promise<void>;
}

interface EmittedCompressionServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

interface RawResponse {
  readonly body: Buffer;
  readonly headers: IncomingHttpHeaders;
  readonly status: number;
}

function presetEngine(token: object): KovoBuildPreset {
  const preset = resolveKovoBuildPreset(token);
  if (preset === undefined) throw new TypeError('Expected a framework-owned preset token.');
  return preset;
}

function compressionHandlerSource(): string {
  return `import { createHash } from 'node:crypto';

const witnesses = new WeakMap();
const canonicalCacheControl = 'public, max-age=0, must-revalidate';

function digest(body) {
  return createHash('sha256').update(body).digest('base64url');
}

function proved(body, buildToken = 'build-a', init = {}) {
  const response = new Response(body, {
    ...init,
    headers: {
      'Cache-Control': canonicalCacheControl,
      'Content-Type': 'text/html; charset=utf-8',
      ...(init.headers ?? {}),
    },
  });
  witnesses.set(response, Object.freeze({ bodyDigest: digest(body ?? ''), buildToken }));
  return response;
}

// Exact generated-entry spelling. The adapter reads this function from this handler module only;
// values with the same shape in headers, transport options, or other exports are ignored.
export function __kovoReadProvedDocumentCompressionWitness(response) {
  return witnesses.get(response);
}

// Adversarial lookalike export: this must never be consulted by the emitted adapter.
export function frameworkProvedDocumentCompressionWitness() {
  return Object.freeze({ bodyDigest: 'forged-digest', buildToken: 'forged-build' });
}

export default async function handler(request) {
  const url = new URL(request.url);
  const credentialed = request.headers.has('cookie') || request.headers.has('authorization');
  if (url.pathname === '/forged') {
    return new Response('forged-validator'.repeat(128), {
      headers: {
        'Cache-Control': canonicalCacheControl,
        'Content-Type': 'text/html; charset=utf-8',
        ETag: '"public-but-unproved"',
        'Kovo-Build': 'forged-build',
      },
    });
  }
  if (url.pathname === '/clone') {
    return proved('structural-clone'.repeat(128)).clone();
  }
  if (url.pathname === '/status-304') {
    return proved(null, 'build-a', { status: 304 });
  }

  let body = 'base-body'.repeat(512);
  let buildToken = 'build-a';
  if (url.pathname === '/body-change') body = 'changed-body'.repeat(512);
  if (url.pathname === '/build-change') buildToken = 'build-b';
  if (url.pathname.startsWith('/entry-')) body = ('bounded-' + url.pathname).repeat(64);

  if (credentialed) {
    return new Response(body, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/html; charset=utf-8',
        Vary: 'Cookie',
      },
    });
  }

  const headers = {};
  if (url.pathname === '/clear-site-data') headers['Clear-Site-Data'] = '"cookies"';
  if (url.pathname === '/set-cookie') headers['Set-Cookie'] = 'sid=secret; Path=/; HttpOnly';
  if (url.pathname === '/private') headers['Cache-Control'] = 'private, no-store';
  if (url.pathname === '/no-store') headers['Cache-Control'] = 'no-store';
  if (url.pathname === '/no-transform') headers['Cache-Control'] = 'public, no-transform';
  return proved(body, buildToken, { headers });
}

globalThis[Symbol.for('kovo.test.emitted-compression-handler')] = Object.freeze({
  handler,
  reader: __kovoReadProvedDocumentCompressionWitness,
});
`;
}

async function emittedAdapters(root: string): Promise<
  readonly {
    readonly adapter: EmittedCompressionAdapter;
    readonly handler: (request: Request) => Promise<Response>;
    readonly handlerReader: (response: Response) => unknown;
    readonly kind: 'node' | 'vercel';
    readonly source: string;
  }[]
> {
  const neutral = await writeKovoNeutralBuild({
    app: createApp({
      routes: [
        route('/runtime', {
          guard: () => true,
          page: () => renderedHtml('<main>runtime</main>'),
        }),
      ],
    }),
    outDir: join(root, 'neutral'),
    serverHandlerSource: compressionHandlerSource(),
  });
  const nodeOut = join(root, 'node');
  const vercelOut = join(root, 'vercel');
  await Promise.all([
    presetEngine(nodePresetToken({ dockerfile: false })).emit(neutral, {
      declaredEnv: [],
      log() {},
      outDir: nodeOut,
      readNeutral: () => neutral,
    }),
    presetEngine(vercelPresetToken()).emit(neutral, {
      declaredEnv: [],
      log() {},
      outDir: vercelOut,
      readNeutral: () => neutral,
    }),
  ]);

  const entries = [
    {
      adapterPath: join(nodeOut, 'node-adapter.mjs'),
      handlerPath: join(nodeOut, 'server/handler.mjs'),
      importPath: './server/handler.mjs',
      kind: 'node' as const,
    },
    {
      adapterPath: join(vercelOut, 'functions/kovo.func/node-adapter.mjs'),
      handlerPath: join(vercelOut, 'functions/kovo.func/handler.mjs'),
      importPath: './handler.mjs',
      kind: 'vercel' as const,
    },
  ];
  const emitted: {
    adapter: EmittedCompressionAdapter;
    handler: (request: Request) => Promise<Response>;
    handlerReader: (response: Response) => unknown;
    kind: 'node' | 'vercel';
    source: string;
  }[] = [];
  const registrationKey = Symbol.for('kovo.test.emitted-compression-handler');
  for (const entry of entries) {
    delete (globalThis as Record<symbol, unknown>)[registrationKey];
    const source = await readFile(entry.adapterPath, 'utf8');
    expect(source).toContain(
      `const generatedHandlerModule = await import(${JSON.stringify(entry.importPath)});`,
    );
    expect(source).toContain('provedDocumentCompressionCacheMaxEntries = 128');
    expect(source).toContain('provedDocumentCompressionCacheMaxBytes = 32 * 1024 * 1024');
    const adapter = (await import(
      pathToFileURL(entry.adapterPath).href
    )) as EmittedCompressionAdapter;
    const registration = (globalThis as Record<symbol, unknown>)[registrationKey] as
      | {
          handler(request: Request): Promise<Response>;
          reader(response: Response): unknown;
        }
      | undefined;
    delete (globalThis as Record<symbol, unknown>)[registrationKey];
    if (registration === undefined) {
      throw new Error(`Expected ${entry.kind} handler to register from the adapter module graph.`);
    }
    emitted.push({
      adapter,
      handler: registration.handler,
      handlerReader: registration.reader,
      kind: entry.kind,
      source,
    });
  }
  return emitted;
}

async function serveAdapter(
  adapter: EmittedCompressionAdapter,
  handler: (request: Request) => Promise<Response>,
  kind: 'node' | 'vercel',
): Promise<EmittedCompressionServer> {
  const server = createServer(async (nodeRequest, nodeResponse) => {
    try {
      if (kind === 'vercel') {
        nodeRequest.headers['x-forwarded-proto'] = 'https';
        nodeRequest.headers['x-vercel-forwarded-for'] = nodeRequest.socket.remoteAddress;
        const prepared = adapter.prepareVercelRequestIngress(nodeRequest);
        if (adapter.rejectPreparedNodeRequestIngress(prepared, nodeResponse)) return;
        const transport = adapter.preparedNodeRequestTransportMetadata(prepared);
        const request = adapter.preparedNodeRequestToWebRequest(prepared, nodeResponse);
        const response = await handler(request);
        await adapter.writeWebResponseToNode(response, nodeResponse, transport.method, {
          acceptEncoding: transport.acceptEncoding,
          // Structural proof lookalikes are intentionally ignored. Only the statically imported
          // generated handler reader can return authority for the exact Response object.
          provedDocumentCompressionWitness: {
            bodyDigest: 'forged-option-digest',
            buildToken: 'forged-option-build',
          },
        });
        return;
      }
      const request = adapter.nodeRequestToWebRequest(nodeRequest);
      const response = await handler(request);
      await adapter.writeWebResponseToNode(response, nodeResponse, request.method, {
        acceptEncoding: nodeRequest.headers['accept-encoding'],
        provedDocumentCompressionWitness: {
          bodyDigest: 'forged-option-digest',
          buildToken: 'forged-option-build',
        },
      });
    } catch {
      if (!nodeResponse.headersSent) nodeResponse.writeHead(500);
      nodeResponse.end('Internal Server Error');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new TypeError('Expected TCP address.');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    },
  };
}

async function rawGet(
  baseUrl: string,
  pathname: string,
  options: {
    readonly headers?: Readonly<Record<string, string>>;
    readonly method?: string;
  } = {},
): Promise<RawResponse> {
  const url = new URL(pathname, baseUrl);
  return await new Promise((resolve, reject) => {
    const request = nodeHttpRequest(
      {
        agent: false,
        headers: options.headers,
        hostname: url.hostname,
        method: options.method ?? 'GET',
        path: `${url.pathname}${url.search}`,
        port: url.port,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            body: Buffer.concat(chunks),
            headers: response.headers,
            status: response.statusCode ?? 0,
          }),
        );
      },
    );
    request.once('error', reject);
    request.end();
  });
}

function decoded(response: RawResponse): string {
  if (response.headers['content-encoding'] === 'br') {
    return brotliDecompressSync(response.body).toString('utf8');
  }
  if (response.headers['content-encoding'] === 'gzip') {
    return gunzipSync(response.body).toString('utf8');
  }
  return response.body.toString('utf8');
}

describe('emitted proved-document compressed representation cache', () => {
  it('keeps Node and Vercel cache authority, identity, floors, LRU, and disable-only parity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-emitted-compression-cache-'));
    roots.push(root);
    const adapters = await emittedAdapters(root);
    releaseManifest = installGeneratedCacheInfluenceManifestForCommand({
      entries: [closedDocumentEntry('document:/')],
      schema: 'kovo-cache-influence/v1',
    });
    const closedHandler = createRequestHandler(
      createApp({
        routes: [
          route('/', {
            access: publicAccess('emitted closed-manifest cache-floor fixture'),
            page: () => renderedHtml('<main>closed document</main>'),
          }),
        ],
      }),
    );
    const liveClosed = await closedHandler(new Request('https://closed.example.test/'));
    expect(liveClosed.headers.get('cache-control')).toBe('private, no-store');
    expect(liveClosed.headers.get('vary')).toContain('Cookie');

    for (const emitted of adapters) {
      emitted.adapter.clearProvedDocumentCompressionCacheForTest();
      const graphProbe = await emitted.handler(new Request('https://probe.example/base'));
      expect(emitted.handlerReader(graphProbe)).toEqual({
        bodyDigest: expect.any(String),
        buildToken: 'build-a',
      });
      expect(emitted.adapter.provedDocumentCompressionWitnessForTest(graphProbe)).toEqual({
        bodyDigest: expect.any(String),
        buildToken: 'build-a',
      });
      await graphProbe.body?.cancel();
      const closedServer = await serveAdapter(emitted.adapter, closedHandler, emitted.kind);
      try {
        const closed = await rawGet(closedServer.baseUrl, '/', {
          headers: { 'accept-encoding': 'br' },
        });
        expect(closed.headers['cache-control'], emitted.kind).toBe('private, no-store');
        expect(closed.headers.vary, emitted.kind).toContain('Cookie');
        expect(decoded(closed), emitted.kind).toContain('closed document');
        expect(emitted.adapter.provedDocumentCompressionCacheStatsForTest()).toMatchObject({
          compressions: 0,
          entries: 0,
          hits: 0,
          misses: 0,
        });
      } finally {
        await closedServer.close();
      }
      const server = await serveAdapter(emitted.adapter, emitted.handler, emitted.kind);
      try {
        const burst = await Promise.all(
          Array.from({ length: 8 }, () =>
            rawGet(server.baseUrl, '/base', { headers: { 'accept-encoding': 'br' } }),
          ),
        );
        for (const response of burst) {
          expect(response.status, emitted.kind).toBe(200);
          expect(response.headers['content-encoding'], emitted.kind).toBe('br');
          expect(decoded(response), emitted.kind).toBe('base-body'.repeat(512));
        }
        expect(new Set(burst.map((response) => response.headers['kovo-pad'])).size).toBeGreaterThan(
          1,
        );
        expect(emitted.adapter.provedDocumentCompressionCacheStatsForTest()).toMatchObject({
          compressions: 1,
          entries: 1,
          hits: 7,
          misses: 1,
        });

        const gzip = await rawGet(server.baseUrl, '/base', {
          headers: { 'accept-encoding': 'gzip;q=1, br;q=0' },
        });
        expect(decoded(gzip), emitted.kind).toBe('base-body'.repeat(512));
        expect(emitted.adapter.provedDocumentCompressionCacheStatsForTest()).toMatchObject({
          compressions: 2,
          entries: 2,
          misses: 2,
        });

        const changedBody = await rawGet(server.baseUrl, '/body-change', {
          headers: { 'accept-encoding': 'br' },
        });
        const changedBuild = await rawGet(server.baseUrl, '/build-change', {
          headers: { 'accept-encoding': 'br' },
        });
        expect(decoded(changedBody), emitted.kind).toBe('changed-body'.repeat(512));
        expect(decoded(changedBuild), emitted.kind).toBe('base-body'.repeat(512));
        expect(emitted.adapter.provedDocumentCompressionCacheStatsForTest()).toMatchObject({
          compressions: 4,
          entries: 4,
          misses: 4,
        });

        const beforeBypasses = emitted.adapter.provedDocumentCompressionCacheStatsForTest();
        for (const headers of [{ cookie: 'sid=secret' }, { authorization: 'Bearer secret' }]) {
          const response = await rawGet(server.baseUrl, '/base', {
            headers: { 'accept-encoding': 'br', ...headers },
          });
          expect(response.headers['content-encoding'], emitted.kind).toBe('br');
          expect(response.headers['cache-control'], emitted.kind).toBe('private, no-store');
        }
        for (const pathname of [
          '/clear-site-data',
          '/set-cookie',
          '/private',
          '/no-store',
          '/no-transform',
          '/clone',
          '/forged',
          '/status-304',
        ]) {
          const response = await rawGet(server.baseUrl, pathname, {
            headers: { 'accept-encoding': 'br' },
          });
          if (pathname === '/no-transform' || pathname === '/status-304') {
            expect(
              response.headers['content-encoding'],
              `${emitted.kind}:${pathname}`,
            ).toBeUndefined();
          } else {
            expect(response.headers['content-encoding'], `${emitted.kind}:${pathname}`).toBe('br');
          }
        }
        const head = await rawGet(server.baseUrl, '/base', {
          headers: { 'accept-encoding': 'br' },
          method: 'HEAD',
        });
        expect(head.headers['content-encoding'], emitted.kind).toBeUndefined();
        expect(emitted.adapter.provedDocumentCompressionCacheStatsForTest()).toEqual(
          beforeBypasses,
        );

        emitted.adapter.clearProvedDocumentCompressionCacheForTest();
        for (let index = 0; index < 130; index += 1) {
          const response = await rawGet(server.baseUrl, `/entry-${index}`, {
            headers: { 'accept-encoding': 'br' },
          });
          expect(decoded(response), `${emitted.kind}:entry-${index}`).toBe(
            `bounded-/entry-${index}`.repeat(64),
          );
        }
        expect(emitted.adapter.provedDocumentCompressionCacheStatsForTest()).toMatchObject({
          compressions: 130,
          entries: 128,
          misses: 130,
        });
        const evicted = await rawGet(server.baseUrl, '/entry-0', {
          headers: { 'accept-encoding': 'br' },
        });
        expect(decoded(evicted), emitted.kind).toBe('bounded-/entry-0'.repeat(64));
        expect(emitted.adapter.provedDocumentCompressionCacheStatsForTest()).toMatchObject({
          compressions: 131,
          entries: 128,
          misses: 131,
        });

        emitted.adapter.disableProvedDocumentCompressionCacheForBenchmark();
        const uncachedFirst = await rawGet(server.baseUrl, '/base', {
          headers: { 'accept-encoding': 'br' },
        });
        const uncachedSecond = await rawGet(server.baseUrl, '/base', {
          headers: { 'accept-encoding': 'br' },
        });
        expect(decoded(uncachedFirst), emitted.kind).toBe('base-body'.repeat(512));
        expect(decoded(uncachedSecond), emitted.kind).toBe('base-body'.repeat(512));
        expect(emitted.adapter.provedDocumentCompressionCacheStatsForTest()).toEqual({
          bytes: 0,
          cancellations: 0,
          compressions: 0,
          entries: 0,
          hits: 0,
          misses: 0,
        });
      } finally {
        await server.close();
      }
    }
  }, 60_000);
});
