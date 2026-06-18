import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer as createNodeServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer as createViteServer } from 'vite';

const commerceRoot = fileURLToPath(new URL('../', import.meta.url));
const distDir = path.join(commerceRoot, 'dist');

const STATIC_MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

// SPEC.md §9.5: dev/demo source serve for the commerce example. Production uses
// `kovo build ./src/app-shell.tsx` and the generated `dist/server/server.mjs`.
// This helper keeps the Vite middleware path available for local source-serving
// checks, serving built `/assets/*` from `dist/` when `vp build` has populated it.
async function tryServeBuiltAsset(req, res) {
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

export async function createCommerceServeServer({
  host = '127.0.0.1',
  port = Number(process.env.PORT ?? 5174),
  strictPort = false,
} = {}) {
  const vite = await createViteServer({
    appType: 'custom',
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    logLevel: 'info',
    root: commerceRoot,
    server: { middlewareMode: true },
  });
  // The shared app-shell dev plugin wires the interactive `commerceNodeHandler`
  // (createCommerceAppShell) into the Vite middleware — see vite.config.ts
  // `nodeHandlerExportName: 'commerceNodeHandler'`. So mutations (`/_m/*`) round-
  // trip against the real PGlite-backed app here; this serve path only adds the
  // built-asset shortcut so the app is styled in production serve.
  const server = createNodeServer((req, res) => {
    void tryServeBuiltAsset(req, res).then((served) => {
      if (!served) vite.middlewares(req, res);
    });
  });

  try {
    await listen(server, { host, port, strictPort });
  } catch (error) {
    await vite.close();
    throw error;
  }

  return {
    close: () => closeServer(server, vite),
    host,
    port: actualPort(server),
    server,
    vite,
  };
}

if (isMainModule()) {
  const options = parseCliOptions(process.argv.slice(2));
  const served = await createCommerceServeServer(options);
  const origin = `http://${served.host}:${served.port}`;

  process.stdout.write(['commerce-serve/v1', origin, ''].join('\n'));

  const shutdown = async () => {
    await served.close();
  };

  process.once('SIGINT', () => {
    void shutdown().then(() => {
      process.exit(0);
    });
  });
  process.once('SIGTERM', () => {
    void shutdown().then(() => {
      process.exit(0);
    });
  });
}

function parseCliOptions(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--host') {
      const host = args[index + 1];
      if (!host) throw new Error('Missing value for commerce serve option --host.');
      options.host = host;
      index += 1;
      continue;
    }

    if (arg === '--port') {
      const rawPort = args[index + 1];
      if (!rawPort) throw new Error('Missing value for commerce serve option --port.');
      const port = Number(rawPort);
      if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new Error(`Invalid commerce serve port '${rawPort}'.`);
      }
      options.port = port;
      index += 1;
      continue;
    }

    if (arg === '--strictPort') {
      options.strictPort = true;
      continue;
    }

    throw new Error(`Unknown commerce serve option '${arg}'.`);
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

function actualPort(server) {
  const address = server.address();
  if (typeof address === 'object' && address !== null) return address.port;
  throw new Error('Commerce serve server did not expose a TCP port.');
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

function isMainModule() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}
