import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const host = process.env.HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '4173', 10);

const types = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function resolveRequest(requestUrl) {
  const url = new URL(requestUrl ?? '/', `http://${host}:${port}`);
  const decoded = decodeURIComponent(url.pathname);
  const clean = decoded.replace(/^\/+/, '');
  const requested = path.resolve(distDir, clean);

  if (requested !== distDir && !requested.startsWith(`${distDir}${path.sep}`)) {
    return null;
  }

  if (decoded.endsWith('/')) return path.join(requested, 'index.html');
  if (path.extname(requested)) return requested;
  return path.join(requested, 'index.html');
}

async function sendFile(response, filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');

    response.writeHead(200, {
      'content-length': info.size,
      'content-type': types.get(path.extname(filePath)) ?? 'application/octet-stream',
    });
    createReadStream(filePath).pipe(response);
  } catch {
    const fallback = path.join(distDir, '404.html');
    if (existsSync(fallback)) {
      response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      createReadStream(fallback).pipe(response);
      return;
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found\n');
  }
}

if (!existsSync(distDir)) {
  throw new Error('serve: site/dist is missing; run `pnpm --filter @kovojs/site run build` first');
}

const server = createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' });
    response.end();
    return;
  }

  const filePath = resolveRequest(request.url);
  if (!filePath) {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Bad request\n');
    return;
  }

  void sendFile(response, filePath);
});

server.listen(port, host, () => {
  console.log(`Kovo docs served from site/dist at http://${host}:${port}/`);
});
