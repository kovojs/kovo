import { createServer as createNodeServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { createSecurityLockedViteServer } from '../../../scripts/lib/secure-vite-runtime.mjs';

const referenceRoot = fileURLToPath(new URL('../', import.meta.url));

export async function createReferenceServeServer({
  host = '127.0.0.1',
  port = Number(process.env.PORT ?? 5177),
} = {}) {
  const vite = await createSecurityLockedViteServer({
    appType: 'custom',
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    logLevel: 'error',
    root: referenceRoot,
    server: { middlewareMode: true },
  });
  const server = createNodeServer((request, response) => vite.middlewares(request, response));

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
  } catch (error) {
    await vite.close();
    throw error;
  }

  return {
    close: () => closeServer(server, vite),
    host,
    port: actualPort(server),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const served = await createReferenceServeServer(parseCliOptions(process.argv.slice(2)));
  process.stdout.write(`reference-serve/v1\nhttp://${served.host}:${served.port}\n`);
  const shutdown = () => void served.close().then(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function parseCliOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--port') {
      const rawPort = args[index + 1];
      const port = Number(rawPort);
      if (!rawPort || !Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new Error(`Invalid reference serve port '${rawPort ?? ''}'.`);
      }
      options.port = port;
      index += 1;
      continue;
    }
    throw new Error(`Unknown reference serve option '${arg}'.`);
  }
  return options;
}

function actualPort(server) {
  const address = server.address();
  if (typeof address === 'object' && address !== null) return address.port;
  throw new Error('Reference serve server did not expose a TCP port.');
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
