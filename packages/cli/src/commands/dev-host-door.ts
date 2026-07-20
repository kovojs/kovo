import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

import { secret, type SecretValue } from '@kovojs/core';
import type { InlineConfig, ViteDevServer } from 'vite-plus';

const DEV_AUTH_COOKIE = 'Kovo-Dev-Auth';
const DEFAULT_DEV_HOST = '127.0.0.1';
const SOURCE_PATH_PREFIXES = Object.freeze([
  '/@fs/',
  '/@id/',
  '/@kovo/',
  '/@react-refresh',
  '/@vite/',
  '/node_modules/',
  '/src/',
]);
const SOURCE_FILE_SUFFIXES = Object.freeze([
  '.astro',
  '.cjs',
  '.css',
  '.cts',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.less',
  '.mjs',
  '.mts',
  '.sass',
  '.scss',
  '.styl',
  '.svelte',
  '.ts',
  '.tsx',
  '.vue',
  '.wasm',
]);
const SOURCE_FETCH_DESTINATIONS = Object.freeze([
  'audioworklet',
  'paintworklet',
  'script',
  'sharedworker',
  'style',
  'worker',
]);

type DevServerOptions = NonNullable<InlineConfig['server']>;

interface DevRequestAuthority {
  expectedOrigin: string;
  ok: true;
}

interface DevRequestRejection {
  message: string;
  ok: false;
  status: 400 | 401 | 403 | 413 | 414 | 503;
}

/** Bootstrap-captured direct-Node ingress controls for the supported dev host door. */
export interface KovoDevNodeIngressProfile {
  nodeRequestPreloadIngressRejection(
    request: IncomingMessage,
  ): { readonly message: string; readonly status: 400 | 413 | 414 } | undefined;
  rejectNodeRequestPreloadIngress(request: IncomingMessage, response: ServerResponse): boolean;
}

/**
 * Collapse every supported `kovo dev` listen path into the one loopback-only host door.
 *
 * The technical-preview runner deliberately has no LAN compatibility posture. A future remote-dev
 * mode needs a separately authenticated operator entry rather than widening this local source door.
 */
export function configureKovoDevHostDoor(server: DevServerOptions): void {
  const host = exactLoopbackHost(server.host);
  server.host = host;
  // Vite adds its own resolved listener names while constructing the server. The Kovo door below
  // remains the exact enforcing boundary; this compatibility carrier must stay mutable until Vite
  // finishes resolution rather than failing boot inside Vite's own normalization.
  server.allowedHosts = [host === '::1' ? '[::1]' : host];
  server.cors = false;
}

/**
 * Install the supported runner's sole HTTP/HMR authority door (SPEC §§6.6 and 9.5.1).
 *
 * Vite's boot-random websocket token becomes an HttpOnly, SameSite=Strict browser session. The
 * same token therefore authenticates source/env/module HTTP reads and wraps Vite's real websocket
 * upgrade listener, while exact Host/Origin checks close DNS rebinding before either transport.
 */
export function installKovoDevHostDoor(
  server: ViteDevServer,
  nodeIngress: KovoDevNodeIngressProfile,
): void {
  const configuredHost = exactLoopbackHost(server.config.server.host);
  const token = server.config.webSocketToken;
  if (!isBase64UrlToken(token)) {
    throw new TypeError('Kovo dev requires Vite to provide one non-empty boot websocket token.');
  }
  const tokenWitness = secret(token);
  const httpServer = server.httpServer;
  if (httpServer === null) {
    throw new TypeError('Kovo dev requires one owned HTTP server for its HTTP/HMR host door.');
  }

  server.middlewares.use((request, response, next) => {
    // SPEC §9.5: close the complete finite Node verdict before this outer door parses a URL,
    // delegates to Vite, or reaches any authored/plugin callback.
    if (nodeIngress.rejectNodeRequestPreloadIngress(request, response)) return;
    const authority = devRequestAuthority(request, httpServer, configuredHost, false);
    if (!authority.ok) {
      rejectHttpDevRequest(response, authority);
      return;
    }
    if (devRequestReadsSourceOrEnvironment(request, authority.expectedOrigin)) {
      if (!requestHasDevAuth(request, tokenWitness)) {
        rejectHttpDevRequest(response, {
          message: 'Kovo dev source endpoints require the boot-authenticated browser session.',
          ok: false,
          status: 401,
        });
        return;
      }
    } else if (request.method === 'GET' || request.method === 'HEAD') {
      issueDevAuthCookie(response, token);
    }
    next();
  });

  const upgradeListeners = httpServer.rawListeners('upgrade');
  if (upgradeListeners.length === 0) {
    throw new TypeError('Kovo dev requires Vite to register one HMR websocket upgrade listener.');
  }
  for (let index = 0; index < upgradeListeners.length; index += 1) {
    httpServer.removeListener('upgrade', upgradeListeners[index]!);
  }
  httpServer.on('upgrade', (request, socket, head) => {
    const ingressRejection = nodeIngress.nodeRequestPreloadIngressRejection(request);
    if (ingressRejection !== undefined) {
      rejectWebSocketDevRequest(socket, {
        message: ingressRejection.message,
        ok: false,
        status: ingressRejection.status,
      });
      return;
    }
    const authority = devRequestAuthority(request, httpServer, configuredHost, true);
    if (!authority.ok) {
      rejectWebSocketDevRequest(socket, authority);
      return;
    }
    if (!requestHasDevAuth(request, tokenWitness)) {
      rejectWebSocketDevRequest(socket, {
        message: 'Kovo dev HMR requires the boot-authenticated browser session.',
        ok: false,
        status: 403,
      });
      return;
    }
    for (let index = 0; index < upgradeListeners.length; index += 1) {
      Reflect.apply(upgradeListeners[index]!, httpServer, [request, socket, head]);
    }
  });
}

/**
 * Mount the second half of the same door after Kovo's app shell and before Vite internals.
 * Anything that falls through the closed app route table is a Vite-readable surface regardless of
 * filename or extension, so this complete fallback—not the suffix classifier—is the source/env
 * authentication boundary.
 */
export function installKovoDevSourceFallbackDoor(
  server: ViteDevServer,
  nodeIngress: KovoDevNodeIngressProfile,
): void {
  const configuredHost = exactLoopbackHost(server.config.server.host);
  const token = server.config.webSocketToken;
  if (!isBase64UrlToken(token)) {
    throw new TypeError('Kovo dev requires Vite to provide one non-empty boot websocket token.');
  }
  const tokenWitness = secret(token);
  const httpServer = server.httpServer;
  if (httpServer === null) {
    throw new TypeError('Kovo dev requires one owned HTTP server for its source fallback door.');
  }
  server.middlewares.use((request, response, next) => {
    // SPEC §9.5: keep the post-app Vite fallback independently closed before URL parsing.
    if (nodeIngress.rejectNodeRequestPreloadIngress(request, response)) return;
    const authority = devRequestAuthority(request, httpServer, configuredHost, false);
    if (!authority.ok) {
      rejectHttpDevRequest(response, authority);
      return;
    }
    if (!requestHasDevAuth(request, tokenWitness)) {
      response.removeHeader('Set-Cookie');
      rejectHttpDevRequest(response, {
        message: 'Kovo dev Vite endpoints require the boot-authenticated browser session.',
        ok: false,
        status: 401,
      });
      return;
    }
    next();
  });
}

function exactLoopbackHost(value: boolean | string | undefined): string {
  if (value === undefined || value === false) return DEFAULT_DEV_HOST;
  if (value === true || typeof value !== 'string') {
    throw new TypeError('Kovo dev host must be an exact loopback host.');
  }
  const host = value.toLowerCase();
  if (host === 'localhost') return host;
  if (host === '::1' || host === '[::1]') return '::1';
  if (/^127\.(?:0|[1-9]\d{0,2})\.(?:0|[1-9]\d{0,2})\.(?:0|[1-9]\d{0,2})$/u.test(host)) {
    const octets = host.split('.');
    if (octets.every((octet) => Number(octet) <= 255)) return host;
  }
  throw new TypeError(
    'Kovo dev host must be an exact loopback host (localhost, 127/8, or ::1); remote dev exposure is unsupported.',
  );
}

function devRequestAuthority(
  request: IncomingMessage,
  server: NonNullable<ViteDevServer['httpServer']>,
  configuredHost: string,
  requireOrigin: boolean,
): DevRequestAuthority | DevRequestRejection {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    return {
      message: 'Kovo dev host authority is unavailable before the server is listening.',
      ok: false,
      status: 503,
    };
  }
  const expectedOrigin = new URL(
    `http://${configuredHost === '::1' ? '[::1]' : configuredHost}:${address.port}`,
  ).origin;
  const host = singletonRawHeader(request, 'host');
  if (host === null || host === undefined || canonicalHttpAuthority(host) !== expectedOrigin) {
    return {
      message: 'Kovo dev rejected a request whose Host did not match the loopback listener.',
      ok: false,
      status: 403,
    };
  }

  const origin = singletonRawHeader(request, 'origin');
  if (
    origin === null ||
    (origin === undefined ? requireOrigin : canonicalHttpOrigin(origin) !== expectedOrigin)
  ) {
    return {
      message: 'Kovo dev rejected a request whose Origin did not match the loopback listener.',
      ok: false,
      status: 403,
    };
  }

  const target = request.url;
  if (typeof target !== 'string') {
    return { message: 'Kovo dev requires one HTTP request target.', ok: false, status: 400 };
  }
  try {
    if (new URL(target, expectedOrigin).origin !== expectedOrigin) {
      return {
        message: 'Kovo dev rejected an absolute request target outside its listener origin.',
        ok: false,
        status: 403,
      };
    }
  } catch {
    return {
      message: 'Kovo dev rejected a malformed HTTP request target.',
      ok: false,
      status: 400,
    };
  }
  return { expectedOrigin, ok: true };
}

function canonicalHttpAuthority(value: string): string | undefined {
  if (value.trim() !== value || value === '') return undefined;
  try {
    const parsed = new URL(`http://${value}`);
    if (
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function canonicalHttpOrigin(value: string): string | undefined {
  if (value.trim() !== value || value === '') return undefined;
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function singletonRawHeader(request: IncomingMessage, name: string): string | null | undefined {
  const rawHeaders = request.rawHeaders;
  let value: string | undefined;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const rawName = rawHeaders[index];
    if (typeof rawName !== 'string' || rawName.toLowerCase() !== name) continue;
    const rawValue = rawHeaders[index + 1];
    if (typeof rawValue !== 'string' || value !== undefined) return null;
    value = rawValue;
  }
  return value;
}

function requestHasDevAuth(request: IncomingMessage, token: SecretValue<string>): boolean {
  const cookieHeader = request.headers.cookie;
  if (typeof cookieHeader !== 'string') return false;
  const cookies = cookieHeader.split(';');
  let candidate: string | undefined;
  for (let index = 0; index < cookies.length; index += 1) {
    const cookie = cookies[index]!.trim();
    const separator = cookie.indexOf('=');
    if (separator < 0 || cookie.slice(0, separator) !== DEV_AUTH_COOKIE) continue;
    if (candidate !== undefined) return false;
    candidate = cookie.slice(separator + 1);
  }
  if (candidate === undefined) return false;
  return token.equals(candidate);
}

function issueDevAuthCookie(response: ServerResponse, token: string): void {
  const cookie = `${DEV_AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`;
  const existing = response.getHeader('Set-Cookie');
  if (existing === undefined) {
    response.setHeader('Set-Cookie', cookie);
    return;
  }
  if (Array.isArray(existing)) {
    response.setHeader('Set-Cookie', [...existing, cookie]);
    return;
  }
  response.setHeader('Set-Cookie', [String(existing), cookie]);
}

function devRequestReadsSourceOrEnvironment(
  request: IncomingMessage,
  expectedOrigin: string,
): boolean {
  const fetchDestination = request.headers['sec-fetch-dest'];
  if (
    typeof fetchDestination === 'string' &&
    SOURCE_FETCH_DESTINATIONS.includes(fetchDestination.toLowerCase())
  ) {
    return true;
  }
  const target = request.url;
  if (typeof target !== 'string') return true;
  let parsed: URL;
  try {
    parsed = new URL(target, expectedOrigin);
  } catch {
    return true;
  }
  const pathname = repeatedlyDecodePathname(parsed.pathname);
  if (pathname === undefined) return true;
  const lowerPath = pathname.toLowerCase().replaceAll('\\', '/');
  for (let index = 0; index < SOURCE_PATH_PREFIXES.length; index += 1) {
    if (lowerPath.startsWith(SOURCE_PATH_PREFIXES[index]!)) return true;
  }
  const basename = lowerPath.slice(lowerPath.lastIndexOf('/') + 1);
  if (
    basename === '.env' ||
    basename.startsWith('.env.') ||
    basename === 'package.json' ||
    basename === 'pnpm-lock.yaml' ||
    basename === 'yarn.lock' ||
    basename.startsWith('tsconfig') ||
    basename.startsWith('vite.config.')
  ) {
    return true;
  }
  for (let index = 0; index < SOURCE_FILE_SUFFIXES.length; index += 1) {
    if (lowerPath.endsWith(SOURCE_FILE_SUFFIXES[index]!)) return true;
  }
  for (const key of parsed.searchParams.keys()) {
    if (
      key === 'direct' ||
      key === 'import' ||
      key === 'inline' ||
      key === 'raw' ||
      key === 'url' ||
      key === 'worker'
    ) {
      return true;
    }
  }
  return false;
}

function repeatedlyDecodePathname(value: string): string | undefined {
  let decoded = value;
  try {
    for (let pass = 0; pass < 4; pass += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return decoded;
      decoded = next;
    }
  } catch {
    return undefined;
  }
  return decoded.includes('%') ? undefined : decoded;
}

function rejectHttpDevRequest(response: ServerResponse, rejection: DevRequestRejection): void {
  response.writeHead(rejection.status, {
    'Cache-Control': 'private, no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...(rejection.status === 401 ? { 'WWW-Authenticate': 'Kovo-Dev' } : {}),
  });
  response.end(rejection.message);
}

function rejectWebSocketDevRequest(socket: Duplex, rejection: DevRequestRejection): void {
  const body = rejection.message;
  socket.end(
    `HTTP/1.1 ${rejection.status} ${devWebSocketStatusText(rejection.status)}\r\n` +
      'Cache-Control: private, no-store\r\n' +
      'Connection: close\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      'Cross-Origin-Resource-Policy: same-origin\r\n' +
      '\r\n' +
      body,
  );
}

function devWebSocketStatusText(status: DevRequestRejection['status']): string {
  if (status === 400) return 'Bad Request';
  if (status === 401) return 'Unauthorized';
  if (status === 413) return 'Payload Too Large';
  if (status === 414) return 'URI Too Long';
  if (status === 503) return 'Service Unavailable';
  return 'Forbidden';
}

function isBase64UrlToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{12,}$/u.test(value);
}
