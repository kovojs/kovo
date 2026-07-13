import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { kovoVitePlugin } from '@kovojs/compiler';
import { afterEach, expect, it } from 'vitest';
import { createServer as createViteServer, type ViteDevServer } from 'vite';

const roots: string[] = [];
const servers: ViteDevServer[] = [];

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
  while (roots.length > 0) rmSync(roots.pop()!, { force: true, recursive: true });
});

it('does not load generated client modules from outside the configured Vite root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kovo-vite-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'kovo-vite-outside-'));
  roots.push(root, outside);
  mkdirSync(join(root, 'src'), { recursive: true });
  symlinkSync(
    join(process.cwd(), 'packages/test/node_modules'),
    join(outside, 'node_modules'),
    'dir',
  );
  writeFileSync(
    join(outside, 'probe.tsx'),
    `
      import { component, publishToClient } from '@kovojs/core';
      const marker = 'KOVO_OUTSIDE_ROOT_MARKER';
      export const Probe = component({
        render: () => <button onClick={() => publishToClient(marker, { reason: 'public repro marker' })}>probe</button>,
      });
    `,
  );

  const vite = await createViteServer({
    appType: 'custom',
    configFile: false,
    logLevel: 'silent',
    plugins: [kovoVitePlugin()],
    root,
    server: { hmr: false, host: '127.0.0.1', port: 0, watch: null, ws: false },
  });
  servers.push(vite);
  await vite.listen();

  const maliciousId = join(outside, 'probe.client.js');
  const port = (vite.httpServer?.address() as AddressInfo).port;
  const response = await fetch(`http://127.0.0.1:${port}${maliciousId}`);
  expect(await response.text()).not.toContain('KOVO_OUTSIDE_ROOT_MARKER');
});
