import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest, createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import { tryServeBuiltAsset } from './serve.mjs';

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('demo-session built asset serving', () => {
  it('serves text assets with Brotli by default when accepted', async () => {
    const distDir = tempDist({
      'assets/app.css': 'body{color:teal;}'.repeat(128),
    });
    const server = await serveAssets(distDir);

    try {
      const response = await requestAsset(server.origin, '/assets/app.css', {
        'Accept-Encoding': 'br,gzip',
      });

      expect(response.status).toBe(200);
      expect(response.headers).toMatchObject({
        'cache-control': 'public, max-age=0, must-revalidate',
        'content-encoding': 'br',
        'content-type': 'text/css; charset=utf-8',
        vary: 'Accept-Encoding',
      });
      expect(brotliDecompressSync(response.body).toString('utf8')).toBe(
        'body{color:teal;}'.repeat(128),
      );
    } finally {
      await server.close();
    }
  });

  it('honors gzip preference and does not compress binary assets', async () => {
    const distDir = tempDist({
      'assets/app.css': 'body{color:teal;}'.repeat(128),
      'assets/logo.png': Buffer.from([1, 2, 3]),
    });
    const server = await serveAssets(distDir);

    try {
      const css = await requestAsset(server.origin, '/assets/app.css', {
        'Accept-Encoding': 'br;q=0, gzip;q=1',
      });
      expect(css.headers['content-encoding']).toBe('gzip');
      expect(gunzipSync(css.body).toString('utf8')).toBe('body{color:teal;}'.repeat(128));

      const png = await requestAsset(server.origin, '/assets/logo.png', {
        'Accept-Encoding': 'br,gzip',
      });
      expect(png.headers['content-encoding']).toBeUndefined();
      expect(png.headers.vary).toBeUndefined();
      expect(png.body).toEqual(Buffer.from([1, 2, 3]));
    } finally {
      await server.close();
    }
  });

  it('answers HEAD for compressible assets with headers and no body', async () => {
    const distDir = tempDist({
      'assets/app.css': 'body{color:teal;}',
    });
    const server = await serveAssets(distDir);

    try {
      const response = await requestAsset(
        server.origin,
        '/assets/app.css',
        { 'Accept-Encoding': 'br,gzip' },
        'HEAD',
      );

      expect(response.status).toBe(200);
      expect(response.headers['content-encoding']).toBe('br');
      expect(response.body).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
});

function tempDist(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'kovo-demo-assets-'));
  tempDirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, body);
  }
  return dir;
}

function serveAssets(distDir) {
  const server = createServer((request, response) => {
    void tryServeBuiltAsset(request, response, distDir).then((served) => {
      if (served) return;
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('missing');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        close: () =>
          new Promise((closeResolve, reject) =>
            server.close((error) => (error ? reject(error) : closeResolve())),
          ),
        origin: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function requestAsset(origin, pathname, headers, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${origin}${pathname}`, { headers, method }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () =>
        resolve({
          body: Buffer.concat(chunks),
          headers: response.headers,
          status: response.statusCode ?? 0,
        }),
      );
    });
    request.on('error', reject);
    request.end();
  });
}
