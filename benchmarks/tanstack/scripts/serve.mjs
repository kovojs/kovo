import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import serverEntry from '../dist/server/assets/server.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const clientDir = path.join(root, 'dist/client');
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 4312);

const mime = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
};

const server = createServer(async (nodeRequest, nodeResponse) => {
  try {
    if (await tryStatic(nodeRequest.url ?? '/', nodeResponse)) return;
    const request = await toWebRequest(nodeRequest);
    const response = await serverEntry.fetch(request);
    await writeResponse(nodeResponse, response);
  } catch (error) {
    nodeResponse.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    nodeResponse.end(error instanceof Error ? error.stack : String(error));
  }
});

server.listen(port, host, () => {
  process.stdout.write(`TanStack benchmark server listening on http://${host}:${port}\n`);
});

async function tryStatic(rawUrl, response) {
  const pathname = decodeURIComponent(new URL(rawUrl, 'http://x').pathname);
  const filePath = path.join(clientDir, pathname);
  if (!filePath.startsWith(clientDir)) return false;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    response.writeHead(200, {
      'cache-control': 'public, max-age=31536000, immutable',
      'content-length': info.size,
      'content-type': mime[path.extname(filePath)] ?? 'application/octet-stream',
    });
    createReadStream(filePath).pipe(response);
    return true;
  } catch {
    return false;
  }
}

async function toWebRequest(nodeRequest) {
  const url = `http://${nodeRequest.headers.host ?? `${host}:${port}`}${nodeRequest.url ?? '/'}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(nodeRequest.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  const method = nodeRequest.method ?? 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : Readable.toWeb(nodeRequest);
  return new Request(url, { body, duplex: body ? 'half' : undefined, headers, method });
}

async function writeResponse(nodeResponse, response) {
  const headers = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  nodeResponse.writeHead(response.status, headers);
  if (response.body) Readable.fromWeb(response.body).pipe(nodeResponse);
  else nodeResponse.end();
}
