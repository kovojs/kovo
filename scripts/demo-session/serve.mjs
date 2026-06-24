import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer as createNodeServer } from 'node:http';
import path from 'node:path';
import { createBrotliCompress, createGzip } from 'node:zlib';

import { createServer as createViteServer } from 'vite-plus';

import { createPerSessionDispatcher } from './dispatcher.mjs';

// SPEC.md §9.5: a multi-tenant ("demo") serve path for the example app shells.
// The regular scripts/serve.mjs wires ONE process-wide app-shell node handler via
// the example's Vite dev plugin (nodeHandlerExportName) — every visitor shares one
// seeded PGlite. This path instead gives every visitor a fresh, isolated instance
// over the SAME real server paths (SSR routes, `/_m/*` mutations, `/products?after=`
// pagination), so a hosted demo behaves per-user without falling back to the
// client-side static replay.
//
// It reuses the framework's own request-ownership predicate
// (shouldHandleKovoAppShellViteRequest) to send only app-owned requests to the
// per-session handler; everything else (Vite internals, HMR, /src) falls through
// to Vite, and built `/assets/*` are served from dist — mirroring scripts/serve.mjs.
//
// The example opts its Vite config out of the singleton dev plugin when
// KOVO_DEMO_MULTITENANT is set (so it doesn't also claim app requests); this
// helper sets that env var before the config loads.

const STATIC_MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const DEMO_FAVICON_ICO = Buffer.from([
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x20, 0x00, 0x30, 0x00,
  0x00, 0x00, 0x16, 0x00, 0x00, 0x00, 0x28, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00,
  0x00, 0x00, 0x01, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x24, 0x80, 0xf4, 0xff, 0x00, 0x00,
  0x00, 0x00,
]);

/**
 * @param {{
 *   label: string,
 *   root: string,
 *   configFile: string,
 *   loadInstanceFactory: (vite: import('vite-plus').ViteDevServer) =>
 *     Promise<{ referenceApp: unknown, buildHandler: () => unknown }>,
 *   host?: string,
 *   port?: number,
 *   strictPort?: boolean,
 * }} options
 */
export async function createDemoServeServer({
  label,
  root,
  configFile,
  loadInstanceFactory,
  host = process.env.HOST ?? '127.0.0.1',
  port = Number(process.env.PORT ?? 5174),
  strictPort = false,
}) {
  // Must be set before the example's vite.config.ts loads so it drops the
  // singleton app-shell dev plugin (which would otherwise also claim app routes).
  process.env.KOVO_DEMO_MULTITENANT = '1';

  const distDir = path.join(root, 'dist');
  const vite = await createViteServer({
    appType: 'custom',
    configFile,
    logLevel: 'info',
    root,
    server: { middlewareMode: true },
  });

  try {
    const serverModule = await vite.ssrLoadModule('@kovojs/server/internal/app-shell-vite');
    const shouldHandle = serverModule.shouldHandleKovoAppShellViteRequest;
    if (typeof shouldHandle !== 'function') {
      throw new Error(
        '@kovojs/server/internal/app-shell-vite must export shouldHandleKovoAppShellViteRequest.',
      );
    }

    const { referenceApp, buildHandler } = await loadInstanceFactory(vite);
    const dispatcher = createPerSessionDispatcher({
      buildHandler,
      idleMs: positiveEnvInt('KOVO_DEMO_IDLE_MS', 20 * 60_000),
      maxSessions: positiveEnvInt('KOVO_DEMO_MAX_SESSIONS', 40),
      warmSessions: nonNegativeEnvInt('KOVO_DEMO_WARM_SESSIONS', 0),
    });

    const server = createNodeServer((req, res) => {
      void tryServeBuiltAsset(req, res, distDir).then((served) => {
        if (served) return;
        if (shouldHandle(req, referenceApp)) {
          dispatcher.dispatch(req, res).catch((error) => failRequest(res, error, label));
          return;
        }
        vite.middlewares(req, res);
      });
    });

    await listen(server, { host, port, strictPort });
    void dispatcher.ready().catch((error) => {
      process.stderr.write(`[${label}] demo warmup failed: ${error?.stack ?? error}\n`);
    });

    return {
      close: () => closeServer(server, vite),
      dispatcher,
      host,
      port: actualPort(server, label),
      server,
      vite,
    };
  } catch (error) {
    await vite.close();
    throw error;
  }
}

/**
 * Run a demo serve server as a CLI (PORT/HOST from env or --host/--port), print a
 * `<label>/v1 <origin>` banner, and wire graceful shutdown.
 */
export async function runDemoServeCli(makeServer) {
  const options = parseCliOptions(process.argv.slice(2));
  const served = await makeServer(options);
  const origin = `http://${served.host}:${served.port}`;
  process.stdout.write([`${served.label ?? 'demo-serve'}/v1`, origin, ''].join('\n'));

  const shutdown = async () => {
    await served.close();
  };
  process.once('SIGINT', () => void shutdown().then(() => process.exit(0)));
  process.once('SIGTERM', () => void shutdown().then(() => process.exit(0)));
  return served;
}

export async function tryServeBuiltAsset(req, res, distDir) {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (pathname === '/favicon.ico') {
    res.writeHead(200, {
      'cache-control': 'public, max-age=86400',
      'content-length': String(DEMO_FAVICON_ICO.byteLength),
      'content-type': STATIC_MIME['.ico'],
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    res.end(DEMO_FAVICON_ICO);
    return true;
  }
  if (!pathname.startsWith('/assets/')) return false;
  const filePath = path.resolve(distDir, pathname.replace(/^\/+/, ''));
  if (!insideDirectory(distDir, filePath)) {
    sendTextAssetResponse(req, res, 403, 'Refusing to serve outside the demo dist directory.\n');
    return true;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      sendMissingBuiltAsset(req, res, pathname);
      return true;
    }
    const contentType = STATIC_MIME[path.extname(filePath)] ?? 'application/octet-stream';
    const compression = isCompressibleContentType(contentType)
      ? preferredCompression(String(req.headers['accept-encoding'] ?? ''))
      : undefined;
    const headers = {
      'content-type': contentType,
      'cache-control': cacheControlForAsset(pathname),
      ...(isCompressibleContentType(contentType) ? { vary: 'Accept-Encoding' } : {}),
      ...(compression ? { 'content-encoding': compression } : {}),
    };
    res.writeHead(200, {
      ...headers,
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    const source = createReadStream(filePath);
    const body =
      compression === 'br'
        ? source.pipe(createBrotliCompress())
        : compression === 'gzip'
          ? source.pipe(createGzip())
          : source;
    body.once('error', (error) => {
      res.destroy(error instanceof Error ? error : undefined);
    });
    body.pipe(res);
    return true;
  } catch {
    sendMissingBuiltAsset(req, res, pathname);
    return true;
  }
}

function insideDirectory(root, filePath) {
  const relativePath = path.relative(root, filePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function sendMissingBuiltAsset(req, res, pathname) {
  sendTextAssetResponse(
    req,
    res,
    404,
    `Built demo asset not found: ${pathname}. Run the example build before serving.\n`,
  );
}

function sendTextAssetResponse(req, res, status, body) {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    'content-type': 'text/plain; charset=utf-8',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
}

function preferredCompression(acceptEncoding) {
  const encodings = parseAcceptEncoding(acceptEncoding);
  const wildcard = encodings.get('*') ?? 0;
  const br = encodings.get('br') ?? wildcard;
  const gzip = encodings.get('gzip') ?? wildcard;
  if (br <= 0 && gzip <= 0) return undefined;
  return br >= gzip && br > 0 ? 'br' : 'gzip';
}

function parseAcceptEncoding(value) {
  const encodings = new Map();
  for (const rawEntry of value.split(',')) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const [rawName, ...params] = entry.split(';');
    const name = rawName?.trim().toLowerCase();
    if (!name) continue;
    let q = 1;
    for (const param of params) {
      const [rawKey, rawValue] = param.trim().split('=');
      if (rawKey?.toLowerCase() !== 'q') continue;
      const parsed = Number(rawValue);
      q = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
    }
    encodings.set(name, q);
  }
  return encodings;
}

function isCompressibleContentType(contentType) {
  const type = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return (
    type.startsWith('text/') ||
    type === 'application/javascript' ||
    type === 'application/json' ||
    type === 'application/ld+json' ||
    type === 'application/manifest+json' ||
    type === 'application/x-javascript' ||
    type === 'application/xhtml+xml' ||
    type === 'application/xml' ||
    type === 'image/svg+xml' ||
    type.endsWith('+json') ||
    type.endsWith('+xml')
  );
}

function cacheControlForAsset(pathname) {
  const fileName = path.basename(pathname);
  return hasContentHash(fileName)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=0, must-revalidate';
}

function hasContentHash(fileName) {
  return /(?:[.-])[a-f0-9]{8,}(?=\.)/i.test(fileName);
}

function failRequest(res, error, label) {
  process.stderr.write(`[${label}] request failed: ${error?.stack ?? error}\n`);
  if (res.headersSent) {
    res.destroy(error instanceof Error ? error : new Error(String(error)));
    return;
  }
  res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Internal Server Error');
}

function positiveEnvInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeEnvInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function parseCliOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--host') {
      const host = args[index + 1];
      if (!host) throw new Error('Missing value for demo serve option --host.');
      options.host = host;
      index += 1;
      continue;
    }
    if (arg === '--port') {
      const rawPort = args[index + 1];
      const port = Number(rawPort);
      if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new Error(`Invalid demo serve port '${rawPort}'.`);
      }
      options.port = port;
      index += 1;
      continue;
    }
    if (arg === '--strictPort') {
      options.strictPort = true;
      continue;
    }
    throw new Error(`Unknown demo serve option '${arg}'.`);
  }
  return options;
}

function listen(server, { host, port, strictPort }) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      if (strictPort || error.code !== 'EADDRINUSE') {
        reject(error);
        return;
      }
      server.listen(0, host);
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function actualPort(server, label) {
  const address = server.address();
  if (typeof address === 'object' && address !== null) return address.port;
  throw new Error(`${label} demo serve server did not expose a TCP port.`);
}

function closeServer(server, vite) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        void vite.close().finally(() => reject(error));
        return;
      }
      void vite.close().then(resolve, reject);
    });
  });
}
