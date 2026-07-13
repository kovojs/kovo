import { renameSync, symlinkSync } from 'node:fs';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createSiteStaticServeServer,
  resolveSiteStaticRequest,
  serveSiteStaticFile,
} from './serve-static.mjs';

const roots = [];
const servers = [];

describe('site static Cloud Run server', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  it('uses HOST and PORT environment defaults for Cloud Run', async () => {
    const root = await createStaticRoot();
    const previousHost = process.env.HOST;
    const previousPort = process.env.PORT;
    process.env.HOST = '127.0.0.1';
    process.env.PORT = '0';

    try {
      const served = await createSiteStaticServeServer({ staticRoot: root });
      servers.push(served);
      expect(served.host).toBe('127.0.0.1');
      expect(served.port).toBeGreaterThan(0);
    } finally {
      restoreEnv('HOST', previousHost);
      restoreEnv('PORT', previousPort);
    }
  });

  it('serves exported documents and immutable client modules', async () => {
    const root = await createStaticRoot();
    const served = await createSiteStaticServeServer({
      host: '127.0.0.1',
      port: 0,
      staticRoot: root,
      strictPort: true,
    });
    servers.push(served);

    const origin = `http://127.0.0.1:${served.port}`;
    const page = await fetch(`${origin}/getting-started`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toBe('<h1>Docs</h1>');

    const module = await fetch(`${origin}/c/search.js?v=abc`);
    expect(module.status).toBe(200);
    expect(module.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await module.text()).toBe('export {};');
  });

  it('resolves export paths through the shared request resolver', async () => {
    const root = await createStaticRoot();

    expect(
      resolveSiteStaticRequest({ method: 'GET', rawUrl: '/getting-started', staticRoot: root }),
    ).toMatchObject({
      filePath: await realpath(path.join(root, 'getting-started', 'index.html')),
      kind: 'file',
      requestPath: '/getting-started',
      responsePath: '/getting-started',
      status: 200,
    });
    expect(
      resolveSiteStaticRequest({ method: 'GET', rawUrl: '/missing', staticRoot: root }),
    ).toMatchObject({
      filePath: await realpath(path.join(root, '404.html')),
      kind: 'file',
      requestPath: '/missing',
      responsePath: '/404.html',
      status: 404,
    });
    expect(
      resolveSiteStaticRequest({ method: 'POST', rawUrl: '/', staticRoot: root }),
    ).toMatchObject({
      body: 'Method not allowed for static docs.\n',
      kind: 'text',
      status: 405,
    });
  });

  it('lets smoke fixtures intercept requests before the shared static server', async () => {
    const root = await createStaticRoot();
    const served = await createSiteStaticServeServer({
      host: '127.0.0.1',
      onRequest: async ({ rawUrl, response }) => {
        if (rawUrl !== '/fixture') return false;
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('fixture');
        return true;
      },
      port: 0,
      staticRoot: root,
      strictPort: true,
    });
    servers.push(served);

    const origin = `http://127.0.0.1:${served.port}`;
    expect(await fetch(`${origin}/fixture`).then((result) => result.text())).toBe('fixture');
    expect((await fetch(`${origin}/getting-started`)).status).toBe(200);
  });

  it('refuses to follow exported-file symlinks outside the static root', async () => {
    const root = await createStaticRoot();
    const outside = await mkdtemp(path.join(tmpdir(), 'kovo-site-static-outside-'));
    roots.push(outside);
    const secretPath = path.join(outside, 'deployment-secret.txt');
    await writeFile(secretPath, 'OUTSIDE_DEPLOYMENT_SECRET');
    await symlink(secretPath, path.join(root, 'leak.txt'));

    const served = await createSiteStaticServeServer({
      host: '127.0.0.1',
      port: 0,
      staticRoot: root,
      strictPort: true,
    });
    servers.push(served);

    const response = await fetch(`http://127.0.0.1:${served.port}/leak.txt`);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('OUTSIDE_DEPLOYMENT_SECRET');

    await rm(path.join(root, '404.html'));
    await symlink(secretPath, path.join(root, '404.html'));
    const fallback = await fetch(`http://127.0.0.1:${served.port}/missing`);
    expect(fallback.status).toBe(403);
    expect(await fallback.text()).not.toContain('OUTSIDE_DEPLOYMENT_SECRET');
  });

  it.skipIf(process.platform === 'win32')(
    'streams the checked descriptor when the exported pathname is swapped after headers',
    async () => {
      const root = await createStaticRoot();
      const outside = await mkdtemp(path.join(tmpdir(), 'kovo-site-static-outside-'));
      roots.push(outside);
      const pagePath = path.join(root, 'getting-started', 'index.html');
      const checkedPath = path.join(root, 'getting-started', 'index.checked.html');
      const secretPath = path.join(outside, 'deployment-secret.txt');
      await writeFile(secretPath, 'OUTSIDE_DEPLOYMENT_SECRET');

      const chunks = [];
      const response = new PassThrough();
      response.on('data', (chunk) => chunks.push(chunk));
      response.writeHead = () => {
        renameSync(pagePath, checkedPath);
        symlinkSync(secretPath, pagePath);
        return response;
      };
      const finished = once(response, 'finish');

      await expect(
        serveSiteStaticFile({
          method: 'GET',
          rawUrl: '/getting-started',
          response,
          staticRoot: root,
        }),
      ).resolves.toMatchObject({ kind: 'file', status: 200 });
      await finished;

      expect(Buffer.concat(chunks).toString('utf8')).toBe('<h1>Docs</h1>');
    },
  );
});

async function createStaticRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'kovo-site-static-'));
  roots.push(root);
  await mkdir(path.join(root, 'getting-started'), { recursive: true });
  await mkdir(path.join(root, 'c'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), '<h1>Home</h1>');
  await writeFile(path.join(root, '404.html'), '<h1>Not found</h1>');
  await writeFile(path.join(root, 'getting-started', 'index.html'), '<h1>Docs</h1>');
  await writeFile(path.join(root, 'c', 'search.js'), 'export {};');
  return root;
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
