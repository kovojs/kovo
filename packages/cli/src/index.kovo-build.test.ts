import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { mainAsync } from './index.js';

describe('kovo build', () => {
  it('bundles an app module and emits node preset output without Vite at request time', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-build-cli-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(process.cwd(), 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      writeFileSync(appPath, appModuleSource(), 'utf8');

      const exitCode = await mainAsync(['build', appPath, '--out', outDir]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('kovo-build/v1\nAPP module=');
      expect(output).toContain(`SUMMARY preset=node outDir=${JSON.stringify(outDir)}`);
      expect(readFileSync(join(outDir, '.kovo/server/handler.mjs'), 'utf8')).not.toContain(
        'vite',
      );

      const serverModule = (await import(
        `${pathToFileURL(join(outDir, 'server/server.mjs')).href}?t=${Date.now()}`
      )) as {
        createKovoNodeServer(): Server;
      };
      const server = serverModule.createKovoNodeServer();
      const origin = await listen(server);

      try {
        const document = await fetch(`${origin}/cart`);
        await expect(document.text()).resolves.toContain('<main>Cart 0</main>');
        expect(document.status).toBe(200);

        const mutationResponse = await fetch(`${origin}/_m/cart/add`, {
          body: new URLSearchParams({ quantity: '2' }),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          method: 'POST',
          redirect: 'manual',
        });
        expect(mutationResponse.status).toBe(303);

        const queryResponse = await fetch(`${origin}/_q/cart`);
        await expect(queryResponse.text()).resolves.toBe(
          '<kovo-query name="cart">{"count":2}</kovo-query>',
        );
      } finally {
        await close(server);
      }
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });
});

function appModuleSource(): string {
  return `
import {
  createApp,
  domain,
  mutation,
  query,
  route,
  s,
} from '@kovojs/server';

const cart = domain('cart');
const db = { count: 0 };
const cartQuery = query('cart', {
  load: () => ({ count: db.count }),
  reads: [cart],
});
const addToCart = mutation('cart/add', {
  csrf: false,
  input: s.object({ quantity: s.number().int().min(1).default(1) }),
  registry: {
    queries: [cartQuery],
    touches: [cart],
  },
  handler(input) {
    db.count += input.quantity;
    return { count: db.count };
  },
});

export default createApp({
  mutations: [addToCart],
  queries: [cartQuery],
  routes: [
    route('/cart', {
      page: () => '<main>Cart ' + db.count + '</main>',
    }),
  ],
});
`;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected kovo build test server to listen on an ephemeral port.');
  }

  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
