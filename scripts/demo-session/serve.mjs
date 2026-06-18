import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer as createNodeServer } from 'node:http';
import path from 'node:path';

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

async function tryServeBuiltAsset(req, res, distDir) {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!pathname.startsWith('/assets/')) return false;
  const filePath = path.join(distDir, pathname);
  if (!filePath.startsWith(distDir)) return false;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    res.writeHead(200, {
      'content-type': STATIC_MIME[path.extname(filePath)] ?? 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
    });
    createReadStream(filePath).pipe(res);
    return true;
  } catch {
    return false;
  }
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
