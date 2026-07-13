/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked through pinned Reflect.apply. */

import { constants as fsConstants, existsSync, realpathSync, statSync } from 'node:fs';
import { createServer as createNodeServer } from 'node:http';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readConfinedFilePath } from '../../scripts/lib/confined-static-file.mjs';

const NativeString = globalThis.String;
const NativeURL = globalThis.URL;
const nativeFunctionBind = globalThis.Function.prototype.bind;
const nativeReflectApply = globalThis.Reflect.apply;
const fileUrlToPath = bindControl(fileURLToPath);
const fsExistsSync = bindControl(existsSync);
const fsRealpathSync = bindControl(realpathSync);
const fsStatSync = bindControl(statSync);
const fsFileTypeMask = fsConstants.S_IFMT;
const fsRegularFileType = fsConstants.S_IFREG;
const nativeDecodeURIComponent = globalThis.decodeURIComponent;
const nativeStringEndsWith = NativeString.prototype.endsWith;
const nativeStringReplace = NativeString.prototype.replace;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
const pathExtname = bindControl(extname);
const pathIsAbsolute = bindControl(isAbsolute);
const pathJoin = bindControl(join);
const pathRelative = bindControl(relative);
const pathResolve = bindControl(resolve);

const siteRoot = fileUrlToPath(new NativeURL('../', import.meta.url));
const defaultStaticRoot = pathResolve(siteRoot, 'dist');

export async function createSiteStaticServeServer({
  host = process.env.HOST ?? '127.0.0.1',
  onRequest,
  port = Number(process.env.PORT ?? 4173),
  staticRoot = defaultStaticRoot,
  strictPort = false,
} = {}) {
  const server = createNodeServer(async (request, response) => {
    const intercepted = await onRequest?.({
      method: request.method ?? 'GET',
      rawUrl: request.url ?? '/',
      request,
      response,
      staticRoot,
    });
    if (intercepted === true) return;

    await serveSiteStaticFile({
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

export function resolveSiteStaticRequest({ rawUrl, method, staticRoot = defaultStaticRoot }) {
  if (!fsExistsSync(staticRoot)) {
    return textResponseResult(
      404,
      'Static export directory not found. Run pnpm --filter @kovojs/site run build first.\n',
    );
  }

  const canonicalStaticRoot = fsRealpathSync(staticRoot);

  if (method !== 'GET' && method !== 'HEAD') {
    return textResponseResult(405, 'Method not allowed for static docs.\n', {
      allow: 'GET, HEAD',
    });
  }

  let url;
  try {
    url = new NativeURL(rawUrl, 'http://kovo-site.local');
  } catch {
    return textResponseResult(400, 'Invalid request URL.\n');
  }

  let decodedPath;
  try {
    decodedPath = nativeDecodeURIComponent(url.pathname);
  } catch {
    return textResponseResult(400, 'Invalid request path.\n');
  }

  const primaryPath = resolveFilePath(staticRoot, decodedPath);
  if (!insideRoot(staticRoot, primaryPath)) {
    return textResponseResult(403, 'Refusing to serve outside the static export directory.\n');
  }

  if (fsExistsSync(primaryPath) && regularFileStat(fsStatSync(primaryPath))) {
    const canonicalPrimaryPath = fsRealpathSync(primaryPath);
    if (!insideRoot(canonicalStaticRoot, canonicalPrimaryPath)) {
      return textResponseResult(403, 'Refusing to serve outside the static export directory.\n');
    }
    return fileResponseResult({
      filePath: canonicalPrimaryPath,
      requestPath: decodedPath,
      responsePath: decodedPath,
      status: 200,
    });
  }

  const notFoundPath = pathResolve(staticRoot, '404.html');
  if (fsExistsSync(notFoundPath) && regularFileStat(fsStatSync(notFoundPath))) {
    const canonicalNotFoundPath = fsRealpathSync(notFoundPath);
    if (!insideRoot(canonicalStaticRoot, canonicalNotFoundPath)) {
      return textResponseResult(403, 'Refusing to serve outside the static export directory.\n');
    }
    return fileResponseResult({
      filePath: canonicalNotFoundPath,
      requestPath: decodedPath,
      responsePath: '/404.html',
      status: 404,
    });
  }

  return textResponseResult(404, 'Not found.\n');
}

export async function serveSiteStaticFile({
  rawUrl,
  method,
  response,
  staticRoot = defaultStaticRoot,
}) {
  const resolved = resolveSiteStaticRequest({ method, rawUrl, staticRoot });
  if (resolved.kind === 'file') {
    const loaded = await readConfinedFilePath(staticRoot, resolved.filePath, method !== 'HEAD');
    if (loaded === undefined) {
      sendText(response, 404, 'Not found.\n', { 'cache-control': 'no-store' });
      return textResponseResult(404, 'Not found.\n', { 'cache-control': 'no-store' });
    }
    sendFile(response, method, loaded, resolved.responsePath, resolved.status);
    return resolved;
  }

  sendText(response, resolved.status, resolved.body, resolved.headers);
  return resolved;
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
    decodedPath === '/' || stringEndsWith(decodedPath, '/') || !pathExtname(decodedPath)
      ? pathJoin(decodedPath, 'index.html')
      : decodedPath;
  return pathResolve(
    staticRoot,
    nativeReflectApply(nativeStringReplace, relativePath, [/^\/+/, '']),
  );
}

function sendFile(response, method, loaded, decodedPath, status = 200) {
  response.writeHead(status, responseHeaders(loaded.filePath, decodedPath, loaded.size));
  if (method === 'HEAD') {
    response.end();
    return;
  }
  response.end(loaded.body);
}

function sendText(response, status, body, headers = {}) {
  response.writeHead(status, { ...headers, 'content-type': 'text/plain; charset=utf-8' });
  response.end(body);
}

function textResponseResult(status, body, headers = {}) {
  return {
    body,
    headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' },
    kind: 'text',
    status,
  };
}

function fileResponseResult({ filePath, requestPath, responsePath, status }) {
  return {
    filePath,
    headers: responseHeaders(filePath, responsePath),
    kind: 'file',
    requestPath,
    responsePath,
    status,
  };
}

function responseHeaders(filePath, decodedPath, size = fsStatSync(filePath).size) {
  const headers = {
    'content-length': size,
    'content-type': contentType(filePath),
  };

  // SPEC.md section 6.6 and section 9.5: exported /c/ modules are immutable
  // app-shell artifacts, and old versions must keep resolving across deploys.
  if (stringStartsWith(decodedPath, '/c/')) {
    headers['cache-control'] = 'public, max-age=31536000, immutable';
  }

  return headers;
}

function contentType(filePath) {
  switch (nativeReflectApply(nativeStringToLowerCase, pathExtname(filePath), [])) {
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
  const relativeFilePath = pathRelative(staticRoot, filePath);
  return (
    relativeFilePath !== '' &&
    !stringStartsWith(relativeFilePath, '..') &&
    !pathIsAbsolute(relativeFilePath)
  );
}

function regularFileStat(fileStat) {
  return (fileStat.mode & fsFileTypeMask) === fsRegularFileType;
}

function stringEndsWith(value, suffix) {
  return nativeReflectApply(nativeStringEndsWith, value, [suffix]);
}

function stringStartsWith(value, prefix) {
  return nativeReflectApply(nativeStringStartsWith, value, [prefix]);
}

function bindControl(control) {
  return nativeReflectApply(nativeFunctionBind, control, [undefined]);
}

function isMainModule() {
  return process.argv[1] === fileUrlToPath(import.meta.url);
}
