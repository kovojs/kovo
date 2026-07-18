import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveKovoBuildPreset } from '@kovojs/server/internal/build-preset';

import { createApp } from './app.js';
import { node as nodePreset } from './build.js';
import { renderedHtml } from './html.js';
import { writeKovoNeutralBuild } from './neutral-build.js';
import { toNodeHandler } from './node.js';
import { route } from './route.js';

// @kovo-security-property-oracle real-http-header-roundtrip
const HANDLER_SOURCE = `
export default async function handler(request) {
  const pathname = new URL(request.url).pathname;
  if (pathname === '/echo') {
    return new Response('echo', {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Handler-Ran': 'yes',
        'X-Observed-Cookie': request.headers.get('cookie') ?? 'missing',
        'X-Observed-Duplicate': request.headers.get('x-oracle-input') ?? 'missing',
      },
    });
  }
  if (pathname === '/cookies') {
    const headers = new Headers({
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'text/plain; charset=utf-8',
      Vary: 'Accept-Encoding',
    });
    headers.append('Set-Cookie', 'alpha=one; Path=/; HttpOnly');
    headers.append('Set-Cookie', 'beta=two; Path=/; SameSite=Strict');
    return new Response('cookies', { headers });
  }
  if (pathname === '/clear-site-data') {
    return new Response('cleared', {
      headers: {
        'Cache-Control': 'public, max-age=3600',
        'Clear-Site-Data': '"cookies", "storage"',
        Vary: 'Accept-Language',
      },
    });
  }
  if (pathname === '/transport-ambiguous') {
    return new Response('must not reach the wire', {
      headers: {
        Connection: 'X-Injected',
        'X-Injected': 'owned',
      },
    });
  }
  if (pathname === '/output-control') {
    try {
      return new Response('must not reach the wire', {
        headers: { 'X-Oracle': 'safe\\r\\nX-Injected: owned' },
      });
    } catch {
      return new Response('web header control rejected', {
        headers: { 'X-Oracle-Control': 'platform-rejected' },
        status: 418,
      });
    }
  }
  return new Response('not found', { status: 404 });
}
`;

interface HeaderObservation {
  readonly ambiguous: ParsedHttpResponse;
  readonly clearSiteData: ParsedHttpResponse;
  readonly controlInput: ParsedHttpResponse;
  readonly controlOutput: ParsedHttpResponse;
  readonly cookies: ParsedHttpResponse;
  readonly duplicateFraming: ParsedHttpResponse;
  readonly duplicateInput: ParsedHttpResponse;
}

interface ParsedHttpResponse {
  readonly headers: Readonly<Record<string, readonly string[]>>;
  readonly status: number;
}

describe('real HTTP header reconstruction property oracle (SPEC §9.1/§9.5; C9)', () => {
  it('keeps live and generated Node reconstruction identical for hostile header families', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-header-roundtrip-oracle-'));
    let live: RunningServer | undefined;
    let generated: RunningServer | undefined;
    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/dynamic', {
              guard: () => true,
              page: () => renderedHtml('<main>dynamic</main>'),
            }),
          ],
        }),
        outDir: join(root, 'neutral'),
        serverHandlerSource: HANDLER_SOURCE,
      });
      if (build.serverHandlerPath === undefined) throw new Error('expected neutral handler');
      const handler = (
        await import(`${pathToFileURL(build.serverHandlerPath).href}?oracle=${Date.now()}`)
      ).default as (request: Request) => Promise<Response>;

      live = await startLiveServer(handler);
      const preset = resolveKovoBuildPreset(nodePreset({ dockerfile: false }));
      if (preset === undefined) throw new Error('expected framework-owned Node preset');
      const output = join(root, 'node-output');
      await preset.emit(build, {
        declaredEnv: [],
        log() {},
        outDir: output,
        readNeutral: () => build,
      });
      generated = await startGeneratedServer(join(output, 'server.mjs'));

      const liveObservation = await observeHeaderRoundTrips(live.baseUrl);
      const generatedObservation = await observeHeaderRoundTrips(generated.baseUrl);
      expect(generatedObservation).toEqual(liveObservation);
      assertNormativeHeaderProperties(liveObservation);
    } finally {
      await generated?.close();
      await live?.close();
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);
});

function assertNormativeHeaderProperties(observed: HeaderObservation): void {
  expect(observed.duplicateInput.status).toBe(200);
  expect(observed.duplicateInput.headers['x-observed-duplicate']).toEqual(['one, two']);
  expect(observed.duplicateInput.headers['x-observed-cookie']).toEqual(['a=1; b=2']);

  expect(observed.cookies.status).toBe(200);
  expect(observed.cookies.headers['set-cookie']).toEqual([
    'alpha=one; Path=/; HttpOnly',
    'beta=two; Path=/; SameSite=Strict',
  ]);
  expect(observed.cookies.headers['cache-control']).toEqual(['private, no-store']);
  expect(observed.cookies.headers.vary).toEqual(['Accept-Encoding, Cookie']);

  expect(observed.clearSiteData.status).toBe(200);
  expect(observed.clearSiteData.headers['clear-site-data']).toEqual(['"cookies", "storage"']);
  expect(observed.clearSiteData.headers['cache-control']).toEqual(['private, no-store']);
  expect(observed.clearSiteData.headers.vary).toEqual(['Accept-Language, Cookie']);

  expect(observed.ambiguous.status).toBe(500);
  expect(observed.ambiguous.headers.connection).toEqual(['close']);
  expect(observed.ambiguous.headers['x-injected']).toBeUndefined();

  // Web Headers owns raw control rejection before Kovo receives a Response; this is an explicit
  // platform-only property. The Kovo-owned transport ambiguity above independently fails KV415.
  expect(observed.controlOutput.status).toBe(418);
  expect(observed.controlOutput.headers['x-oracle-control']).toEqual(['platform-rejected']);

  // llhttp owns malformed request syntax before either adapter constructs a Web Request.
  expect(observed.controlInput.status).toBe(400);
  expect(observed.controlInput.headers['x-handler-ran']).toBeUndefined();
  expect(observed.duplicateFraming.status).toBe(400);
  expect(observed.duplicateFraming.headers['x-handler-ran']).toBeUndefined();
}

async function observeHeaderRoundTrips(baseUrl: string): Promise<HeaderObservation> {
  const host = new URL(baseUrl).host;
  const exchange = async (target: string, fields: readonly string[] = []) =>
    parseHttpResponse(
      await rawHttpExchange(
        baseUrl,
        [`GET ${target} HTTP/1.1`, `Host: ${host}`, ...fields, 'Connection: close', '', ''].join(
          '\r\n',
        ),
      ),
    );

  return {
    ambiguous: await exchange('/transport-ambiguous'),
    clearSiteData: await exchange('/clear-site-data'),
    controlInput: await exchange('/echo', ['X-Oracle-Input: safe\x00owned']),
    controlOutput: await exchange('/output-control'),
    cookies: await exchange('/cookies'),
    duplicateFraming: await exchange('/echo', ['Content-Length: 0', 'Content-Length: 1']),
    duplicateInput: await exchange('/echo', [
      'X-Oracle-Input: one',
      'X-Oracle-Input: two',
      'Cookie: a=1',
      'Cookie: b=2',
    ]),
  };
}

function parseHttpResponse(wire: string): ParsedHttpResponse {
  const head = wire.split('\r\n\r\n', 1)[0] ?? '';
  const lines = head.split('\r\n');
  const status = Number(/^HTTP\/\d\.\d\s+(\d{3})/u.exec(lines[0] ?? '')?.[1] ?? 0);
  const headers: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const name = line.slice(0, colon).toLowerCase();
    (headers[name] ??= []).push(line.slice(colon + 1).trim());
  }
  return { headers, status };
}

interface RunningServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

async function startLiveServer(
  handler: (request: Request) => Promise<Response>,
): Promise<RunningServer> {
  const server = createServer(toNodeHandler(handler));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    },
  };
}

async function startGeneratedServer(serverPath: string): Promise<RunningServer> {
  const source = `
const imported = await import(${JSON.stringify(pathToFileURL(serverPath).href)});
const server = imported.createKovoNodeServer();
server.listen(0, '127.0.0.1', () => {
  console.log('KOVO_HEADER_ORACLE_SERVER:' + server.address().port);
});
`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', source], {
    env: { ...process.env, HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => stdout.push(chunk));
  child.stderr.on('data', (chunk: string) => stderr.push(chunk));

  const deadline = Date.now() + 10_000;
  let port: number | undefined;
  while (Date.now() < deadline) {
    const value = /KOVO_HEADER_ORACLE_SERVER:(\d+)/u.exec(stdout.join(''))?.[1];
    if (value !== undefined) {
      port = Number(value);
      break;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`generated Node server exited before ready: ${stderr.join('')}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (port === undefined) {
    child.kill('SIGKILL');
    throw new Error(`generated Node server did not become ready: ${stderr.join('')}`);
  }

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGTERM');
      await exited;
    },
  };
}

async function rawHttpExchange(baseUrl: string, request: string): Promise<string> {
  const url = new URL(baseUrl);
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = connect({ host: url.hostname, port: Number(url.port) });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('timed out waiting for HTTP header oracle response'));
    }, 5_000);
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.once('connect', () => socket.write(request));
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.once('close', () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}
