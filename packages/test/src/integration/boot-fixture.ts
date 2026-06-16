// Generic "boot a single-file Kovo fixture and serve it" — the reusable
// generalization of examples/commerce/scripts/serve.mjs.
//
// The serve model mirrors the framework's own production-serve path (SPEC §9.5):
// the app shell is SSR-loaded through a Vite middleware server (so the Kovo
// compiler plugin compiles `component()` TSX on demand), built `dist/assets/*`
// are served from disk when present, and app-matched requests are dispatched to
// the fixture handler with a per-request `db`. Everything else (client modules,
// Vite internals) falls through to Vite.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import path from 'node:path';

import { kovoVitePlugin } from '@kovojs/compiler';
import { toNodeHandler } from '@kovojs/server/app-shell/node';
import { shouldHandleKovoAppShellViteRequest } from '@kovojs/server/app-shell/vite';
import { createServer as createViteServer, type ViteDevServer } from 'vite';

import { isFixtureDescriptor } from './define-fixture.js';
import { createFixtureInstance, type FixtureInstance } from './fixture-instance.js';

/** A booted fixture server: its `origin`, the live `db`, a per-test `reset`, and `close`. */
export interface BootedFixture {
  /** The current per-test database (recreated by `reset`). */
  readonly db: FixtureInstance['db'];
  /** `http://host:port` the fixture is served at. */
  readonly origin: string;
  /** Stop the HTTP server, Vite, and the database. */
  close(): Promise<void>;
  /** Reset the database to a fresh schema + seed for the next test. */
  reset(): Promise<void>;
}

/** Options for `bootFixture`. */
export interface BootFixtureOptions {
  /** Fixture entry module id relative to the fixture dir. Default `/app.tsx`. */
  entry?: string;
  /** Bind host. Default `127.0.0.1`. */
  host?: string;
}

const STATIC_MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/**
 * Boot a single-file fixture app and serve it on an ephemeral port.
 *
 * @param fixtureDir - Absolute path to the fixture directory (containing `app.tsx`).
 * @param options - Entry module id and bind host overrides.
 */
export async function bootFixture(
  fixtureDir: string,
  options: BootFixtureOptions = {},
): Promise<BootedFixture> {
  const entry = options.entry ?? '/app.tsx';
  const host = options.host ?? '127.0.0.1';
  const distAssetsDir = path.join(fixtureDir, 'dist');

  const vite = await createViteServer({
    appType: 'custom',
    configFile: false,
    logLevel: 'warn',
    plugins: [Object.assign(kovoVitePlugin(), { enforce: 'pre' as const })],
    root: fixtureDir,
    server: { hmr: false, middlewareMode: true },
    // Kovo workspace packages ship TS source from their dev `exports`, so Vite must
    // compile them rather than externalize to Node (which can't import `.ts`). This
    // mirrors what vite-plus configures for the example app-shells.
    ssr: { noExternal: [/^@kovojs\//] },
  });

  let instance: FixtureInstance;
  try {
    const module = await vite.ssrLoadModule(entry);
    const descriptor = (module as { default?: unknown }).default;
    if (!isFixtureDescriptor(descriptor)) {
      throw new Error(`Fixture entry ${entry} must \`export default defineFixture(...)\`.`);
    }
    instance = await createFixtureInstance(descriptor);
  } catch (error) {
    await vite.close();
    throw error;
  }

  const nodeHandler = toNodeHandler((request) => instance.handle(request));
  const server = createHttpServer((req, res) => {
    void (async () => {
      if (await tryServeBuiltAsset(req.url ?? '/', distAssetsDir, res)) return;
      if (shouldHandleKovoAppShellViteRequest(req, instance.app)) {
        await nodeHandler(req, res);
        return;
      }
      vite.middlewares(req, res);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
    });
  });

  const port = await listen(server, host);

  return {
    get db() {
      return instance.db;
    },
    origin: `http://${host}:${port}`,
    async close() {
      await closeHttpServer(server);
      await vite.close();
      await instance.close();
    },
    reset: () => instance.reset(),
  };
}

async function tryServeBuiltAsset(
  rawUrl: string,
  distDir: string,
  res: import('node:http').ServerResponse,
): Promise<boolean> {
  const pathname = decodeURIComponent(new URL(rawUrl, 'http://x').pathname);
  if (!pathname.startsWith('/assets/')) return false;
  const filePath = path.join(distDir, pathname);
  if (!filePath.startsWith(distDir)) return false;

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    res.writeHead(200, {
      'cache-control': 'public, max-age=31536000, immutable',
      'content-type': STATIC_MIME[path.extname(filePath)] ?? 'application/octet-stream',
    });
    createReadStream(filePath).pipe(res);
    return true;
  } catch {
    return false;
  }
}

function listen(server: Server, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.off('error', reject);
      const address = server.address();
      if (typeof address === 'object' && address !== null) {
        resolve(address.port);
        return;
      }
      reject(new Error('Fixture server did not expose a TCP port.'));
    });
  });
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
