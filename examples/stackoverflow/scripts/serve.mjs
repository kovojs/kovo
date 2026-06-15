import { createServer as createNodeServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { createServer as createViteServer } from 'vite';

const soRoot = fileURLToPath(new URL('../', import.meta.url));

export async function createSoServeServer({
  host = '127.0.0.1',
  port = Number(process.env.PORT ?? 5176),
  strictPort = false,
} = {}) {
  const vite = await createViteServer({
    appType: 'custom',
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    logLevel: 'info',
    root: soRoot,
    server: { middlewareMode: true },
  });
  const server = createNodeServer(vite.middlewares);

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
