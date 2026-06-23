// S1 (plans/bugs-and-testing.md): the production-only half of the architecture —
// `kovo build` → `dist/server/server.mjs` → versioned `/c/__v/` client modules →
// inline-loader delegation + `import()` in a real browser — driven end-to-end in
// Chromium. The CLI build tests fetch the prod server over HTTP but never drive it
// in a browser; this closes that gap with an interactive island.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { type Server } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { type Browser, chromium } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';

import { mainAsync } from './index.js';

const repoRoot = process.cwd();

function appSource(): string {
  return `
import { createApp, createMemoryVersionedClientModuleRegistry, route } from '@kovojs/server';

const trustedHtml = (value) => ({
  __kovoTrustedHtml: true,
  value,
  [Symbol.toPrimitive]: () => String(value),
  toString: () => String(value),
});

const clientModules = createMemoryVersionedClientModuleRegistry();
clientModules.put({
  path: '/c/counter.client.js',
  source: 'export function increment(event, ctx){ ctx.state.n = (ctx.state.n || 0) + 1; }',
  version: 'counter-v1',
});

const home = route('/', {
  page: () =>
    trustedHtml('<main><counter-island kovo-c="counter-island" kovo-state="{&quot;n&quot;:0}">' +
    '<button on:click="/c/__v/counter-v1/counter.client.js#increment">bump</button> ' +
    '<output data-bind="state.n">0</output>' +
    '</counter-island></main>'),
});

export default createApp({ clientModules, routes: [home] });
`;
}

function writeClientEntry(root: string): void {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><html><body><script type="module" src="/src/client.ts"></script></body></html>',
    'utf8',
  );
  writeFileSync(
    join(root, 'src/client.ts'),
    "import './style.css';\nexport const client = true;\n",
    'utf8',
  );
  writeFileSync(join(root, 'src/style.css'), 'main { color: rebeccapurple; }\n', 'utf8');
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no ephemeral port');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('kovo build — browser drive (S1)', () => {
  it('drives a prod-built interactive island in a real browser', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-browser-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let server: Server | undefined;
    let browser: Browser | undefined;

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      writeFileSync(appPath, appSource(), 'utf8');
      writeClientEntry(root);
      writeRetentionProofConfig(root);

      const exitCode = await withCwd(root, () =>
        mainAsync(['build', './app.mjs', '--out', './dist']),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);

      const serverModule = (await import(
        `${pathToFileURL(join(outDir, 'server/server.mjs')).href}?t=${Date.now()}`
      )) as { createKovoNodeServer(): Server };
      server = serverModule.createKovoNodeServer();
      const origin = await listen(server);

      browser = await chromium.launch();
      const page = await browser.newPage();

      // Capture the versioned /c/ client-module response the loader import()s, to assert
      // it is served with an immutable, long-lived cache posture (content-hashed URL).
      const clientModuleResponses: Array<{ url: string; cacheControl: string | undefined }> = [];
      page.on('response', (response) => {
        if (response.url().includes('/c/__v/')) {
          clientModuleResponses.push({
            url: response.url(),
            cacheControl: response.headers()['cache-control'],
          });
        }
      });

      await page.goto(`${origin}/`);

      const output = page.locator('output[data-bind="state.n"]');
      await output.waitFor();
      expect(await output.textContent()).toBe('0');

      // Click delegates through the inline loader → import() the versioned /c/ module →
      // the handler mutates island state → the data-bind updates. This is the full
      // prod-built resumability chain running in a real browser.
      await page.getByRole('button', { name: 'bump' }).click();
      await page.waitForFunction(
        () => document.querySelector('output[data-bind="state.n"]')?.textContent === '1',
        undefined,
        { timeout: 10_000 },
      );
      expect(await output.textContent()).toBe('1');

      // The /c/ module the browser actually loaded is a content-versioned URL served with
      // an immutable cache posture — safe to cache forever, never poisoning a redeploy.
      const counterModule = clientModuleResponses.find((entry) =>
        entry.url.includes('counter-v1/counter.client.js'),
      );
      expect(counterModule, 'loader import()ed the versioned /c/ module').toBeTruthy();
      expect(counterModule?.cacheControl).toContain('immutable');
    } finally {
      await browser?.close();
      if (server) await close(server);
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);
});

function writeRetentionProofConfig(root: string): void {
  writeFileSync(
    join(root, 'kovo.config.ts'),
    [
      "import { defineConfig, node } from '@kovojs/server/build';",
      'const base = node();',
      'export default defineConfig({',
      '  preset: {',
      "    name: 'node',",
      '    emit(build, context) {',
      '      return base.emit?.(build, context);',
      '    },',
      '    inspect() {',
      '      return [];',
      '    },',
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );
}

async function withCwd<T>(cwd: string, run: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await run();
  } finally {
    process.chdir(previous);
  }
}
