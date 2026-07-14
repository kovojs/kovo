/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked through pinned Reflect.apply. */

import { createServer as createNodeServer } from 'node:http';
import {
  basename as importedPathBasename,
  extname as importedPathExtname,
  join as importedPathJoin,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import { readConfinedStaticFile } from '../../../scripts/lib/confined-static-file.mjs';
import { createSecurityLockedViteServer } from '../../../scripts/lib/secure-vite-runtime.mjs';

const NativeURL = globalThis.URL;
const nativeFunctionBind = globalThis.Function.prototype.bind;
const nativeReflectApply = globalThis.Reflect.apply;
const pathBasename = bindControl(importedPathBasename);
const pathExtname = bindControl(importedPathExtname);
const pathJoin = bindControl(importedPathJoin);

const soRoot = fileURLToPath(new NativeURL('../', import.meta.url));
const distDir = pathJoin(soRoot, 'dist');

const STATIC_MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

// The app references built client assets at `/assets/*`. Serve them from
// `dist/` when present, then fall through to Vite middleware for app routes.
async function tryServeBuiltAsset(req, res) {
  const pathname = new NativeURL(req.url, 'http://x').pathname;
  const loaded = await readConfinedStaticFile(distDir, pathname, '/assets/', req.method !== 'HEAD');
  if (loaded === undefined) return false;
  try {
    res.writeHead(200, {
      'content-type': STATIC_MIME[pathExtname(loaded.filePath)] ?? 'application/octet-stream',
      'cache-control': cacheControlForAsset(pathname),
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    res.end(loaded.body);
    return true;
  } catch {
    return false;
  }
}

function cacheControlForAsset(pathname) {
  const fileName = pathBasename(pathname);
  return hasContentHash(fileName)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=0, must-revalidate';
}

function hasContentHash(fileName) {
  return /(?:[.-])[a-f0-9]{8,}(?=\.)/i.test(fileName);
}

export async function createSoServeServer({
  host = '127.0.0.1',
  port = Number(process.env.PORT ?? 5176),
  strictPort = false,
} = {}) {
  const vite = await createSecurityLockedViteServer({
    appType: 'custom',
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    logLevel: 'info',
    root: soRoot,
    server: { middlewareMode: true },
  });
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
  const served = await createSoServeServer(options);
  const origin = `http://${served.host}:${served.port}`;

  process.stdout.write(['so-serve/v1', origin, ''].join('\n'));

  const shutdown = async () => {
    await served.close();
  };

  process.once('SIGINT', () => {
    void shutdown().then(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void shutdown().then(() => process.exit(0));
  });
}

function parseCliOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--host') {
      const host = args[index + 1];
      if (!host) throw new Error('Missing value for so serve option --host.');
      options.host = host;
      index += 1;
      continue;
    }
    if (arg === '--port') {
      const rawPort = args[index + 1];
      if (!rawPort) throw new Error('Missing value for so serve option --port.');
      const port = Number(rawPort);
      if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new Error(`Invalid crm serve port '${rawPort}'.`);
      }
      options.port = port;
      index += 1;
      continue;
    }
    if (arg === '--strictPort') {
      options.strictPort = true;
      continue;
    }
    throw new Error(`Unknown so serve option '${arg}'.`);
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
  throw new Error('SO serve server did not expose a TCP port.');
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

function bindControl(control) {
  return nativeReflectApply(nativeFunctionBind, control, [undefined]);
}
