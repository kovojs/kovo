import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium, type Browser } from 'playwright';
import { describe, expect, it } from 'vitest';

import { writeKovoProject } from './index.js';
import { buildReusableProductionArtifact } from './index.build.test-support.js';
import { assertProdArtifactSinkCensus } from './index.build.prod-artifact.sink-census.js';
import {
  collectOutput,
  fetchTextWhenReady,
  linkStarterBuildDependencies,
  reservePort,
  stopProcess,
  withRepoBinOnPath,
} from './index.test-support.js';

describe('create-kovo starter (build integration: production island derives)', () => {
  // @kovo-security-certifies KV311 island-derive-prod-artifact
  it('hydrates destructured state aliases from the production artifact without stale or throwing derives', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-island-derive-'));
    const port = await reservePort();
    let browser: Browser | undefined;
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Prod Island Derive Proof' });
      linkStarterBuildDependencies(root);
      addIslandDeriveProof(root);
      configureNodeRetention(root);

      buildReusableProductionArtifact(root);
      const census = assertProdArtifactSinkCensus(root, [
        {
          proof: {
            evidence:
              'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts observes state-path derives in the production client artifact and hydrates them without ReferenceError/stale values',
            kind: 'proof',
          },
          sink: 'client-derive bodies',
          witnesses: [
            'IslandDeriveProof',
            'state.count',
            'state.items[0]',
            'state.nested.label',
            'state.groups[0][0]',
            'state.extra["computed-key"]',
            'state.cards[0].label',
          ],
        },
      ]);
      expect(census.entries).toHaveLength(1);
      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          NODE_ENV: 'production',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;
      const html = await fetchTextWhenReady(`${origin}/island-derive-proof`, output);
      expect(html).toContain('data-proof="island-derive"');
      expect(html).toContain('data-bind="/c/__v/');
      const clientSources = (await clientModuleSourcesFromHtml(origin, html)).join('\n');
      for (const path of [
        'state.count',
        'state.items[0]',
        'state.nested.label',
        'state.groups[0][0]',
        'state.extra["computed-key"]',
        '(state.cards[0]).label',
      ]) {
        expect(clientSources).toContain(path);
      }
      expect(clientSources).not.toMatch(
        /\b(?:chained|direct|firstItem|firstGroup|computedLabel|firstCard|cardLabel)\b/u,
      );

      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      const frameworkDataRequestsAfterInteraction: string[] = [];
      let interactionStarted = false;
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('request', (request) => {
        if (!interactionStarted) return;
        const url = new URL(request.url());
        if (url.pathname.startsWith('/_q') || url.pathname.startsWith('/_m')) {
          frameworkDataRequestsAfterInteraction.push(`${request.method()} ${url.pathname}`);
        }
      });
      await page.goto(`${origin}/island-derive-proof`, { waitUntil: 'networkidle' });

      await expectOutputText(page, 'count', '1');
      await expectOutputText(page, 'first', 'first');
      await expectOutputText(page, 'nested', 'alpha');
      await expectOutputText(page, 'group', 'inner');
      await expectOutputText(page, 'computed', 'delta');
      await expectOutputText(page, 'card', 'card-a');

      interactionStarted = true;
      await page.click('[data-proof="advance"]');
      try {
        await page.waitForFunction(
          () => {
            const text = (name: string): string | null =>
              document.querySelector(`[data-proof="${name}"]`)?.textContent;
            return (
              text('count') === '2' &&
              text('first') === 'second' &&
              text('nested') === 'beta' &&
              text('group') === 'updated' &&
              text('computed') === 'gamma' &&
              text('card') === 'card-b'
            );
          },
          undefined,
          { timeout: 10_000 },
        );
      } catch (error) {
        const state = await page.locator('[data-proof="island-derive"]').evaluate((node) => ({
          html: node.outerHTML,
          state: node.getAttribute('kovo-state'),
        }));
        throw new Error(
          [
            error instanceof Error ? error.message : String(error),
            `state=${state.state ?? ''}`,
            `html=${state.html}`,
            `pageErrors=${pageErrors.join(' | ')}`,
            `consoleErrors=${consoleErrors.join(' | ')}`,
          ].join('\n'),
        );
      }

      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
      expect(frameworkDataRequestsAfterInteraction).toEqual([]);
    } finally {
      await browser?.close();
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 180_000);

  // @kovo-security-certifies KV311 module-helper-derive-prod-artifact
  it('does not ship an unbound module-helper state derive in the production client artifact', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-helper-derive-'));

    try {
      writeKovoProject(root, { name: 'Prod Helper Derive Proof' });
      linkStarterBuildDependencies(root);
      addModuleHelperDeriveProof(root);

      buildReusableProductionArtifact(root);

      const clientSources = clientArtifactSources(root).join('\n');
      expect(clientSources).not.toContain('format(state.count)');
      expect(clientSources).not.toContain('format =');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);
});

async function expectOutputText(
  page: Awaited<ReturnType<Browser['newPage']>>,
  proof: string,
  text: string,
): Promise<void> {
  await page.waitForFunction(
    ([name, expected]) =>
      document.querySelector(`[data-proof="${name}"]`)?.textContent === expected,
    [proof, text],
  );
}

function clientArtifactSources(root: string): readonly string[] {
  const clientRoot = join(root, 'dist');
  if (!existsSync(clientRoot)) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        visit(path);
        continue;
      }
      if (entry.endsWith('.js')) files.push(readFileSync(path, 'utf8'));
    }
  };
  visit(clientRoot);
  return files;
}

async function clientModuleSourcesFromHtml(
  origin: string,
  html: string,
): Promise<readonly string[]> {
  const hrefs = [
    ...new Set([...html.matchAll(/\/c\/__v\/[^"'\s#]+\.client\.js/g)].map(([href]) => href)),
  ];
  expect(hrefs.length).toBeGreaterThan(0);
  return Promise.all(
    hrefs.map(async (href) => {
      const response = await fetch(`${origin}${href}`);
      expect(response.status).toBe(200);
      return response.text();
    }),
  );
}

function addIslandDeriveProof(root: string): void {
  writeFileSync(
    join(root, 'src/island-derive-proof.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { component } from '@kovojs/core';",
      '',
      'export const IslandDeriveProof = component({',
      "  state: () => ({ cards: [{ label: 'card-a' }], count: 1, extra: { 'computed-key': 'delta' }, groups: [[{ label: 'inner' }]], items: ['first'], nested: { label: 'alpha' } }),",
      '  render: (_queries, state) => (',
      '      <island-derive-proof data-proof="island-derive">',
      '        {(() => {',
      '          const { count } = state;',
      '          const direct = count;',
      '          const chained = direct;',
      '          return <output data-proof="count">{chained}</output>;',
      '        })()}',
      '        {(() => {',
      '          const [firstItem] = state.items;',
      '          return <output data-proof="first">{firstItem}</output>;',
      '        })()}',
      '        {(() => {',
      '          const { nested: { label } } = state;',
      '          return <output data-proof="nested">{label}</output>;',
      '        })()}',
      '        {(() => {',
      '          const { groups: [[firstGroup]] } = state;',
      '          return <output data-proof="group">{firstGroup.label}</output>;',
      '        })()}',
      '        {(() => {',
      '          const { extra: { ["computed-key"]: computedLabel } } = state;',
      '          return <output data-proof="computed">{computedLabel}</output>;',
      '        })()}',
      '        {(() => {',
      '          const firstCard = state.cards[0];',
      '          const cardLabel = firstCard.label;',
      '          return <output data-proof="card">{cardLabel}</output>;',
      '        })()}',
      '        <button',
      '          data-proof="advance"',
      '          type="button"',
      '          onClick={() => {',
      '            state.count = state.count + 1;',
      "            state.items = ['second'];",
      "            state.nested = { label: 'beta' };",
      "            state.groups = [[{ label: 'updated' }]];",
      "            state.extra = { 'computed-key': 'gamma' };",
      "            state.cards = [{ label: 'card-b' }];",
      '          }}',
      '        >',
      '          Advance',
      '        </button>',
      '      </island-derive-proof>',
      '  ),',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );
  patchAppRoute(root, {
    importLine: "import { IslandDeriveProof } from './island-derive-proof.js';",
    routeLines: [
      "    route('/island-derive-proof', {",
      "      access: publicAccess('public island derive production proof'),",
      "      meta: { description: 'Island derive production proof.', title: 'Island derive proof' },",
      '      layout: AppLayout,',
      '      stylesheets,',
      '      page() {',
      '        return <main><IslandDeriveProof /></main>;',
      '      },',
      '    }),',
    ],
  });
}

function addModuleHelperDeriveProof(root: string): void {
  writeFileSync(
    join(root, 'src/helper-derive-proof.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { component } from '@kovojs/core';",
      '',
      'const format = (value: number): string => `count:${value}`;',
      '',
      'export const HelperDeriveProof = component({',
      '  state: () => ({ count: 1 }),',
      '  render: (_queries, state) => {',
      '    const label = format(state.count);',
      '    return <helper-derive-proof><p>{label}</p></helper-derive-proof>;',
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );
  patchAppRoute(root, {
    importLine: "import { HelperDeriveProof } from './helper-derive-proof.js';",
    routeLines: [
      "    route('/helper-derive-proof', {",
      "      access: publicAccess('public helper derive production proof'),",
      "      meta: { description: 'Helper derive production proof.', title: 'Helper derive proof' },",
      '      layout: AppLayout,',
      '      stylesheets,',
      '      page() {',
      '        return <HelperDeriveProof />;',
      '      },',
      '    }),',
    ],
  });
}

function patchAppRoute(
  root: string,
  patch: { importLine: string; routeLines: readonly string[] },
): void {
  const appPath = join(root, 'src/app.tsx');
  const source = readFileSync(appPath, 'utf8');
  const withImport = replaceRequired(
    source,
    "import { ContactsRegion } from './components/contacts.js';",
    ["import { ContactsRegion } from './components/contacts.js';", patch.importLine].join('\n'),
    'island derive route import',
  );
  const withRoute = replaceRequired(
    withImport,
    '  routes: [\n    route(',
    ['  routes: [', ...patch.routeLines, '    route('].join('\n'),
    'island derive route insertion',
  );
  writeFileSync(appPath, withRoute, 'utf8');
}

function configureNodeRetention(root: string): void {
  const configPath = join(root, 'kovo.config.ts');
  const source = readFileSync(configPath, 'utf8');
  writeFileSync(
    configPath,
    replaceRequired(
      source,
      'preset: node(),',
      [
        'preset: node({',
        '  retention: {',
        '    hours: 24,',
        "    immutableClientModules: 'retained',",
        "    priorTokenQueryReads: 'retained',",
        '  },',
        '}),',
      ].join('\n'),
      'node retention proof config',
    ),
    'utf8',
  );
}

function replaceRequired(
  source: string,
  search: string,
  replacement: string,
  label: string,
): string {
  if (!source.includes(search)) throw new Error(`Expected scaffold anchor for ${label}.`);
  return source.replace(search, replacement);
}
