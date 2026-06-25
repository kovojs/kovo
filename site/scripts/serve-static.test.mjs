import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createSiteStaticServeServer } from './serve-static.mjs';

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
