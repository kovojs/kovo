// S1 (plans/bugs-and-testing.md): the production-only half of the architecture —
// `kovo build` → `dist/server/server.mjs` → versioned `/c/__v/` client modules →
// inline-loader delegation + `import()` in a real browser — driven end-to-end in
// Chromium. The CLI build tests fetch the prod server over HTTP but never drive it
// in a browser; this closes that gap with an interactive island.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Browser, chromium } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';

import { compileComponentModule } from '@kovojs/compiler';

import {
  builtServerProcess,
  closeBuiltServerProcess,
  listenBuiltServerProcess,
  type BuiltServerProcess,
} from '../test/built-server.js';
import { mainAsync } from './index.js';

const repoRoot = process.cwd();

// SPEC §4.4/§5.2.1: these low-level trusted-HTML fixtures must declare the exact client module
// URL that the compiler would mark beside each generated handler/derive reference.
function appSource(): string {
  return `
import { createApp, createMemoryVersionedClientModuleRegistry, publicAccess, route } from '@kovojs/server';
import { trustedHtml } from '@kovojs/browser';

const clientModules = createMemoryVersionedClientModuleRegistry();
clientModules.put({
  path: '/c/counter.client.js',
  source: 'export function increment(event, ctx){ ctx.state.n = (ctx.state.n || 0) + 1; }',
  version: 'counter-v1',
});

const home = route('/', {
  access: publicAccess('browser build fixture'),
  page: () =>
    trustedHtml('<main><counter-island kovo-c="counter-island" kovo-state="{&quot;n&quot;:0}">' +
    '<button on:click="/c/__v/counter-v1/counter.client.js#increment" data-kovo-module-allowlist="/c/__v/counter-v1/counter.client.js">bump</button> ' +
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

function authoredIslandSource(): string {
  return [
    '/** @jsxImportSource @kovojs/server */',
    "import { component } from '@kovojs/core';",
    '',
    'export const CounterIsland = component({',
    "  state: () => ({ count: 0, label: 'ready' }),",
    '  render: (_queries, state) => (',
    '    <section>',
    '      <button',
    '        data-testid="counter"',
    '        type="button"',
    '        onClick={() => {',
    '          state.count += 1;',
    '        }}',
    '      >',
    '        {state.count}',
    '      </button>',
    '      <input',
    '        aria-label="label"',
    '        value={state.label}',
    '        onInput={() => {',
    "          state.label += '!';",
    '        }}',
    '      />',
    '      <output data-testid="label">{state.label}</output>',
    '    </section>',
    '  ),',
    '});',
    '',
  ].join('\n');
}

function authoredIslandRefs(): { click: string; href: string; input: string } {
  const result = compileComponentModule({
    fileName: 'src/components/counter-island.tsx',
    source: authoredIslandSource(),
  });
  expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  const href = result.hmrImpact?.clientHref;
  if (!href) throw new Error('expected compiled client href for authored island fixture');
  const click = result.handlerExports.find((name) => name.endsWith('$button_click'));
  const input = result.handlerExports.find((name) => name.endsWith('$input_input'));
  if (!click || !input) throw new Error('expected click and input handlers for island fixture');

  return {
    click: `${href}#${click}`,
    href,
    input: `${href}#${input}`,
  };
}

function stateTextIslandSource(): string {
  return [
    '/** @jsxImportSource @kovojs/server */',
    "import { component } from '@kovojs/core';",
    '',
    'export const StateTextIsland = component({',
    '  state: () => ({ urgentOnly: false, clicks: 0 }),',
    '  render: (_queries, state) => (',
    '    <section>',
    '      <button',
    '        data-testid="priority"',
    '        type="button"',
    "        aria-pressed={state.urgentOnly ? 'true' : 'false'}",
    "        data-state={state.urgentOnly ? 'urgent' : 'all'}",
    '        onClick={() => {',
    '          state.urgentOnly = !state.urgentOnly;',
    '          state.clicks += 1;',
    '        }}',
    '      >',
    "        {state.urgentOnly ? 'all' : 'urgent'}",
    '      </button>',
    '      <output data-testid="clicks">{state.clicks}</output>',
    '    </section>',
    '  ),',
    '});',
    '',
  ].join('\n');
}

function stateTextIslandRefs(): {
  ariaPressed: string;
  click: string;
  dataState: string;
  href: string;
  text: string;
} {
  const result = compileComponentModule({
    fileName: 'src/components/state-text-island.tsx',
    source: stateTextIslandSource(),
  });
  expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  const href = result.hmrImpact?.clientHref;
  if (!href) throw new Error('expected compiled client href for state text island fixture');
  const click = result.handlerExports.find((name) => name.endsWith('$button_click'));
  if (!click) throw new Error('expected click handler for state text island fixture');

  return {
    ariaPressed: `${href}#StateTextIsland$button_aria_pressed_derive`,
    click: `${href}#${click}`,
    dataState: `${href}#StateTextIsland$button_data_state_derive`,
    href,
    text: `${href}#StateTextIsland$button_text_derive`,
  };
}

describe('kovo build — browser drive (S1)', () => {
  it('drives a prod-built interactive island in a real browser', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-browser-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let server: BuiltServerProcess | undefined;
    let browser: Browser | undefined;

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeFileSync(appPath, appSource(), 'utf8');
      writeClientEntry(root);
      writeRetentionProofConfig(root);

      const exitCode = await withCwd(root, () =>
        mainAsync(['build', './app.mjs', '--out', './dist']),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);

      server = builtServerProcess(join(outDir, 'server/server.mjs'));
      const origin = await listenBuiltServerProcess(server);

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
      if (server) await closeBuiltServerProcess(server);
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('updates same-element state-derived text and attributes in a prod-built island', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-browser-state-text-'));
    const appPath = join(root, 'src/app.tsx');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let server: BuiltServerProcess | undefined;
    let browser: Browser | undefined;

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/core'), join(root, 'node_modules/@kovojs/core'));
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeClientEntry(root);
      writeRetentionProofConfig(root);
      mkdirSync(join(root, 'src/components'), { recursive: true });
      const refs = stateTextIslandRefs();
      writeFileSync(
        appPath,
        [
          '/** @jsxImportSource @kovojs/server */',
          "import { createApp, publicAccess, route } from '@kovojs/server';",
          "import { trustedHtml } from '@kovojs/browser';",
          "import { StateTextIsland } from './components/state-text-island.tsx';",
          '',
          'void StateTextIsland;',
          '',
          'export default createApp({',
          '  routes: [',
          "    route('/', {",
          "      access: publicAccess('browser state text fixture'),",
          '      page: () =>',
          '        trustedHtml(',
          '          ' +
            JSON.stringify(
              `<main><section kovo-c="state-text-island" kovo-state="{&quot;urgentOnly&quot;:false,&quot;clicks&quot;:0}">` +
                `<button data-testid="priority" type="button" aria-pressed="false" data-state="all" on:click="${refs.click}" data-kovo-module-allowlist="${refs.href}" data-bind="${refs.text}" data-bind:aria-pressed="${refs.ariaPressed}" data-bind:data-state="${refs.dataState}">urgent</button>` +
                `<output data-testid="clicks" data-bind="state.clicks">0</output>` +
                `</section></main>`,
            ) +
            ',',
          '        ),',
          '    }),',
          '  ],',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );
      writeFileSync(
        join(root, 'src/components/state-text-island.tsx'),
        stateTextIslandSource(),
        'utf8',
      );

      const exitCode = await withCwd(root, () =>
        mainAsync(['build', './src/app.tsx', '--out', './dist']),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);

      server = builtServerProcess(join(outDir, 'server/server.mjs'));
      const origin = await listenBuiltServerProcess(server);

      browser = await chromium.launch();
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });

      await page.goto(`${origin}/`);
      const button = page.getByTestId('priority');
      expect((await button.textContent())?.trim()).toBe('urgent');
      expect(await button.getAttribute('aria-pressed')).toBe('false');
      expect(await button.getAttribute('data-state')).toBe('all');
      expect((await page.getByTestId('clicks').textContent())?.trim()).toBe('0');

      await button.click();
      await expect
        .poll(
          async () =>
            JSON.stringify({
              ariaPressed: await button.getAttribute('aria-pressed'),
              consoleErrors,
              dataState: await button.getAttribute('data-state'),
              pageErrors,
              state: await page.locator('section').getAttribute('kovo-state'),
              text: (await button.textContent())?.trim(),
              clicks: (await page.getByTestId('clicks').textContent())?.trim(),
            }),
          { timeout: 10_000 },
        )
        .toContain(
          JSON.stringify({
            ariaPressed: 'true',
            consoleErrors: [],
            dataState: 'urgent',
            pageErrors: [],
            state: '{"urgentOnly":true,"clicks":1}',
            text: 'all',
            clicks: '1',
          }).slice(1, -1),
        );
      expect((await button.textContent())?.trim()).toBe('all');
      expect(await button.getAttribute('aria-pressed')).toBe('true');
      expect(await button.getAttribute('data-state')).toBe('urgent');
      expect((await page.getByTestId('clicks').textContent())?.trim()).toBe('1');
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    } finally {
      await browser?.close();
      if (server) await closeBuiltServerProcess(server);
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('hydrates compiler-emitted client islands without bare generated ABI imports', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-browser-authored-island-'));
    const appPath = join(root, 'src/app.tsx');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let server: BuiltServerProcess | undefined;
    let browser: Browser | undefined;

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/core'), join(root, 'node_modules/@kovojs/core'));
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeClientEntry(root);
      writeRetentionProofConfig(root);
      mkdirSync(join(root, 'src/components'), { recursive: true });
      const refs = authoredIslandRefs();
      writeFileSync(
        appPath,
        [
          '/** @jsxImportSource @kovojs/server */',
          "import { createApp, publicAccess, route } from '@kovojs/server';",
          "import { trustedHtml } from '@kovojs/browser';",
          "import { CounterIsland } from './components/counter-island.tsx';",
          '',
          'void CounterIsland;',
          '',
          'export default createApp({',
          '  routes: [',
          "    route('/', {",
          "      access: publicAccess('browser authored island fixture'),",
          '      page: () =>',
          '        trustedHtml(',
          '          ' +
            JSON.stringify(
              `<main><section kovo-c="counter-island" kovo-state="{&quot;count&quot;:0,&quot;label&quot;:&quot;ready&quot;}">` +
                `<button data-testid="counter" type="button" on:click="${refs.click}" data-kovo-module-allowlist="${refs.href}">bump</button>` +
                `<output data-testid="count" data-bind="state.count">0</output>` +
                `<input aria-label="label" value="ready" on:input="${refs.input}" data-kovo-module-allowlist="${refs.href}" data-bind:value="state.label">` +
                `<output data-testid="label" data-bind="state.label">ready</output>` +
                `</section></main>`,
            ) +
            ',',
          '        ),',
          '    }),',
          '  ],',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );
      writeFileSync(
        join(root, 'src/components/counter-island.tsx'),
        authoredIslandSource(),
        'utf8',
      );

      const exitCode = await withCwd(root, () =>
        mainAsync(['build', './src/app.tsx', '--out', './dist']),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);

      server = builtServerProcess(join(outDir, 'server/server.mjs'));
      const origin = await listenBuiltServerProcess(server);

      browser = await chromium.launch();
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      const reservedRequests: string[] = [];
      const clientModules: Array<{ source: string; url: string }> = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/_m') || url.pathname.startsWith('/_q')) {
          reservedRequests.push(`${request.method()} ${url.pathname}`);
        }
      });
      page.on('response', async (response) => {
        if (!response.url().includes('/c/__v/') || !response.url().endsWith('.client.js')) return;
        clientModules.push({ source: await response.text(), url: response.url() });
      });

      await page.goto(`${origin}/`);
      await page.getByTestId('counter').click();
      await expect
        .poll(
          async () =>
            JSON.stringify({
              clientModuleUrls: clientModules.map((module) => module.url),
              consoleErrors,
              moduleSource: clientModules
                .find((module) => module.url.includes('counter-island.client.js'))
                ?.source.slice(0, 1000),
              pageErrors,
              state: await page.locator('section').getAttribute('kovo-state'),
              text: (await page.getByTestId('count').textContent())?.trim(),
            }),
          { timeout: 10_000 },
        )
        .toContain('"text":"1"');
      await page.getByLabel('label').fill('changed');
      await page.waitForFunction(
        () => document.querySelector('[data-testid="label"]')?.textContent?.trim() === 'ready!',
        undefined,
        { timeout: 10_000 },
      );

      const islandModule = clientModules.find((module) =>
        module.url.includes('counter-island.client.js'),
      );
      expect(islandModule?.source).toContain('const securityHandler = (operations, fn) => {');
      expect(islandModule?.source).not.toContain('@kovojs/browser/generated');
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
      expect(reservedRequests).toEqual([]);
    } finally {
      await browser?.close();
      if (server) await closeBuiltServerProcess(server);
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
      'export default defineConfig({',
      '  preset: node({',
      '    retention: {',
      '      hours: 24,',
      "      immutableClientModules: 'retained',",
      "      priorTokenQueryReads: 'retained',",
      '    },',
      '  }),',
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
