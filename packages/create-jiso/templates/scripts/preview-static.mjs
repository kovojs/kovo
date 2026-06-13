import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer as createNodeServer } from 'node:http';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const starterRoot = fileURLToPath(new URL('../', import.meta.url));
const staticRoot = resolve(starterRoot, 'dist');

export async function createStarterStaticPreviewServer({
  host = '127.0.0.1',
  port = Number(process.env.PORT ?? 4173),
  strictPort = false,
} = {}) {
  const server = createNodeServer((request, response) => {
    serveStaticExportFile(request.url ?? '/', response);
  });

  await listen(server, { host, port, strictPort });

  return {
    close: () => closeServer(server),
    host,
    port: actualPort(server),
    server,
  };
}

if (isMainModule()) {
  const served = await createStarterStaticPreviewServer(parseCliOptions(process.argv.slice(2)));
  const origin = `http://${served.host}:${served.port}`;

  process.stdout.write(['starter-static-preview/v1', origin, ''].join('\n'));

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

function serveStaticExportFile(rawUrl, response) {
  if (!existsSync(staticRoot)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Static export directory not found. Run npm run static first.\n');
    return;
  }

  let url;
  try {
    url = new URL(rawUrl, 'http://starter-static.local');
  } catch {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Invalid request URL.\n');
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Invalid request path.\n');
    return;
  }

  const relativePath =
    decodedPath === '/' || decodedPath.endsWith('/')
      ? join(decodedPath, 'index.html')
      : decodedPath;
  const filePath = resolve(staticRoot, relativePath.replace(/^\/+/, ''));
  const relativeFilePath = relative(staticRoot, filePath);

  if (relativeFilePath === '' || relativeFilePath.startsWith('..')) {
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Refusing to serve outside the static export directory.\n');
    return;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found.\n');
    return;
  }

  response.writeHead(200, { 'content-type': contentType(filePath) });
  response.end(readFileSync(filePath));
}

function parseCliOptions(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--host') {
      const host = args[index + 1];
      if (!host) throw new Error('Missing value for starter static preview option --host.');
      options.host = host;
      index += 1;
      continue;
    }

    if (arg === '--port') {
      const rawPort = args[index + 1];
      if (!rawPort) throw new Error('Missing value for starter static preview option --port.');
      const port = Number(rawPort);
      if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new Error(`Invalid starter static preview port '${rawPort}'.`);
      }
      options.port = port;
      index += 1;
      continue;
    }

    if (arg === '--strictPort') {
      options.strictPort = true;
      continue;
    }

    throw new Error(`Unknown starter static preview option '${arg}'.`);
  }

  return options;
}

function listen(server, { host, port, strictPort }) {
  return new Promise((resolvePromise, reject) => {
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
      resolvePromise();
    });
  });
}

function actualPort(server) {
  const address = server.address();
  if (typeof address === 'object' && address !== null) return address.port;
  throw new Error('Starter static preview server did not expose a TCP port.');
}

function closeServer(server) {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolvePromise();
    });
  });
}

function contentType(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

function isMainModule() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}
