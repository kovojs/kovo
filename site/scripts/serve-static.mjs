import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer as createNodeServer } from 'node:http';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultStaticRoot = resolve(siteRoot, 'dist');

export async function createSiteStaticServeServer({
  host = process.env.HOST ?? '127.0.0.1',
  port = Number(process.env.PORT ?? 4173),
  staticRoot = defaultStaticRoot,
  strictPort = false,
} = {}) {
  const server = createNodeServer((request, response) => {
    serveSiteStaticFile({
      method: request.method ?? 'GET',
      rawUrl: request.url ?? '/',
      response,
      staticRoot,
    });
  });

  await listen(server, { host, port, strictPort });

  return {
    close: () => closeServer(server),
    host,
    port: actualPort(server),
    server,
    staticRoot,
  };
}

export function serveSiteStaticFile({ rawUrl, method, response, staticRoot = defaultStaticRoot }) {
  if (!existsSync(staticRoot)) {
    sendText(
      response,
      404,
      'Static export directory not found. Run pnpm --filter @kovojs/site run build first.\n',
    );
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    response.writeHead(405, {
      allow: 'GET, HEAD',
      'content-type': 'text/plain; charset=utf-8',
    });
    response.end('Method not allowed for static docs.\n');
    return;
  }

  let url;
  try {
    url = new URL(rawUrl, 'http://kovo-site.local');
  } catch {
    sendText(response, 400, 'Invalid request URL.\n');
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    sendText(response, 400, 'Invalid request path.\n');
    return;
  }

  const primaryPath = resolveFilePath(staticRoot, decodedPath);
  if (!insideRoot(staticRoot, primaryPath)) {
    sendText(response, 403, 'Refusing to serve outside the static export directory.\n');
    return;
  }

  if (existsSync(primaryPath) && statSync(primaryPath).isFile()) {
    sendFile(response, method, primaryPath, decodedPath);
    return;
  }

  const notFoundPath = resolve(staticRoot, '404.html');
  if (existsSync(notFoundPath) && statSync(notFoundPath).isFile()) {
    sendFile(response, method, notFoundPath, '/404.html', 404);
    return;
  }

  sendText(response, 404, 'Not found.\n');
}

if (isMainModule()) {
  const served = await createSiteStaticServeServer(parseCliOptions(process.argv.slice(2)));
  const origin = `http://${served.host}:${served.port}`;

  process.stdout.write(['site-static-serve/v1', origin, ''].join('\n'));

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
      if (!host) throw new Error('Missing value for site static serve option --host.');
      options.host = host;
      index += 1;
      continue;
    }

    if (arg === '--port') {
      const rawPort = args[index + 1];
      if (!rawPort) throw new Error('Missing value for site static serve option --port.');
      const port = Number(rawPort);
      if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new Error(`Invalid site static serve port '${rawPort}'.`);
      }
      options.port = port;
      index += 1;
      continue;
    }

    if (arg === '--strictPort') {
      options.strictPort = true;
      continue;
    }

    throw new Error(`Unknown site static serve option '${arg}'.`);
  }

  return options;
}

function resolveFilePath(staticRoot, decodedPath) {
  const relativePath =
    decodedPath === '/' || decodedPath.endsWith('/') || !extname(decodedPath)
      ? join(decodedPath, 'index.html')
      : decodedPath;
  return resolve(staticRoot, relativePath.replace(/^\/+/, ''));
}

function sendFile(response, method, filePath, decodedPath, status = 200) {
  response.writeHead(status, responseHeaders(filePath, decodedPath));
  if (method === 'HEAD') {
    response.end();
    return;
  }
  response.end(readFileSync(filePath));
}

function sendText(response, status, body) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(body);
}

function responseHeaders(filePath, decodedPath) {
  const headers = {
    'content-length': statSync(filePath).size,
    'content-type': contentType(filePath),
  };

  // SPEC.md section 6.6 and section 9.5: exported /c/ modules are immutable
  // app-shell artifacts, and old versions must keep resolving across deploys.
  if (decodedPath.startsWith('/c/')) {
    headers['cache-control'] = 'public, max-age=31536000, immutable';
  }

  return headers;
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
    case '.md':
      return 'text/markdown; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
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
  throw new Error('Site static serve server did not expose a TCP port.');
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

function insideRoot(staticRoot, filePath) {
  const relativeFilePath = relative(staticRoot, filePath);
  return relativeFilePath !== '' && !relativeFilePath.startsWith('..');
}

function isMainModule() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}
