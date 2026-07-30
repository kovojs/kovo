import { build as esbuild } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { kovoVitePlugin } from '@kovojs/compiler';
import { compilerOwnedViteClientModuleRole } from '@kovojs/compiler/internal';
import { computeRenderPlanFingerprint } from '@kovojs/core/internal/render-plan-token';
import { describe, expect, it } from 'vitest';

import { kovoServerHandlerEntrySource } from './build-export.js';

async function compilerModules(queryName = 'deals') {
  const plugin = kovoVitePlugin();
  await plugin.transform?.(
    `
import { component } from '@kovojs/core';
export const Card = component({
  queries: { ${queryName}: {} },
  state: () => ({ count: 0 }),
  render: ({ ${queryName} }) => (
    <button onClick={() => { state.count += 1; }}>{${queryName}.length}</button>
  ),
});
`,
    `src/${queryName}.tsx`,
  );
  const modules = plugin.getClientModules?.() ?? [];
  if (modules.length === 0) throw new Error('Expected compiler modules.');
  return modules;
}

const emptyStyles = { app: [], fragments: {}, routes: {} } as const;
const generatedHandlerClientModulesPath = fileURLToPath(
  new URL('../../../server/src/client-modules.ts', import.meta.url),
);
const generatedHandlerCreateAppPath = fileURLToPath(
  new URL('../../../server/src/app.ts', import.meta.url),
);
const generatedHandlerAppTokenPath = fileURLToPath(
  new URL('../../../server/src/app-token.ts', import.meta.url),
);

async function executeGeneratedHandlerBundle(
  root: string,
  name: string,
  modules: Awaited<ReturnType<typeof compilerModules>>,
) {
  const appPath = join(root, `${name}-app.mjs`);
  const entryPath = join(root, `${name}-handler.mjs`);
  const outputPath = join(root, `${name}-bundle.mjs`);
  const resultKey = `__kovo_generated_handler_${name}`;
  writeFileSync(join(root, 'runtime-registry.mjs'), '', 'utf8');
  writeFileSync(
    appPath,
    [
      `import { createApp } from ${JSON.stringify(generatedHandlerCreateAppPath)};`,
      `import { createKovoAppToken } from ${JSON.stringify(generatedHandlerAppTokenPath)};`,
      `import { createMemoryVersionedClientModuleStore, snapshotVersionedClientModuleRegistry } from ${JSON.stringify(generatedHandlerClientModulesPath)};`,
      "const stale = [{ path: '/c/stale.client.js', source: 'export const stale = true;' }];",
      'const store = createMemoryVersionedClientModuleStore();',
      `store.replaceActiveSnapshot({ modules: stale, renderPlanFingerprint: ${JSON.stringify(
        modules[0]?.renderPlanFingerprint ?? computeRenderPlanFingerprint({}),
      )} });`,
      'const app = createApp({ clientModules: snapshotVersionedClientModuleRegistry(store), routes: [] });',
      `globalThis[${JSON.stringify(resultKey)}] = app;`,
      'export default createKovoAppToken(app);',
      '',
    ].join('\n'),
    'utf8',
  );
  const emitted = kovoServerHandlerEntrySource(appPath, emptyStyles, 'cloudflare', modules, []);
  const rewritten = emitted.replace(
    JSON.stringify(pathToFileURL(appPath).href),
    JSON.stringify(`./${name}-app.mjs`),
  );
  if (rewritten === emitted) throw new Error('Expected emitted app import to be rewritten.');
  writeFileSync(entryPath, rewritten, 'utf8');

  const built = await esbuild({
    absWorkingDir: process.cwd(),
    bundle: true,
    entryPoints: [entryPath],
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'generated-handler-file-url',
        setup(build) {
          build.onResolve({ filter: /^file:\/\// }, (args) => ({
            path: fileURLToPath(args.path),
          }));
        },
      },
    ],
    target: 'node22',
    write: false,
  });
  const output = built.outputFiles[0]?.text;
  if (!output) throw new Error('Expected generated handler bundle output.');
  writeFileSync(outputPath, output, 'utf8');
  const exports = (await import(pathToFileURL(outputPath).href)) as Record<string, unknown>;
  const app = (globalThis as Record<string, unknown>)[resultKey] as
    | {
        clientModules: {
          entries(): readonly { path: string; source: string }[];
        };
      }
    | undefined;
  delete (globalThis as Record<string, unknown>)[resultKey];
  if (!app) throw new Error('Generated handler app did not execute.');
  return { app, exports };
}

describe('generated production handler client-module bootstrap', () => {
  it('registers the exact compiler and manual set before importing the app', async () => {
    const modules = await compilerModules();
    const manual = {
      path: '/c/manual.client.js',
      source: 'export const manual = true;',
    };
    const source = kovoServerHandlerEntrySource('/tmp/kovo/app.mjs', emptyStyles, 'node', modules, [
      manual,
    ]);
    const claim = source.indexOf(
      'const generatedClientModuleInstaller = claimGeneratedBuildClientModuleInstaller();',
    );
    const manualRegistration = source.indexOf(
      'generatedClientModuleInstaller.manual(Object.freeze(',
    );
    const appImport = source.indexOf('generatedClientModuleInstaller.load(');

    expect(claim).toBeGreaterThan(0);
    expect(manualRegistration).toBeGreaterThan(claim);
    expect(appImport).toBeGreaterThan(manualRegistration);
    expect(source).toContain('generatedClientModuleInstaller.appBootstrap(Object.freeze(');
    expect(source).toContain('generatedClientModuleInstaller.deferredAppRuntime(Object.freeze(');
    expect(source).toContain('generatedClientModuleInstaller.componentClient(Object.freeze(');
    expect(source).not.toContain('export { claimGeneratedBuildClientModuleInstaller');
    expect(source.split('\n').filter((line) => line.startsWith('export '))).toEqual([
      'export default createRequestHandler(appWithBuildStylesheetAssets(app, stylesheetAssets));',
    ]);
  });

  it('claims and seals an empty generated snapshot before app import', () => {
    const source = kovoServerHandlerEntrySource('/tmp/kovo/app.mjs', emptyStyles, 'node', [], []);
    const claim = source.indexOf(
      'const generatedClientModuleInstaller = claimGeneratedBuildClientModuleInstaller();',
    );
    const load = source.indexOf(
      `generatedClientModuleInstaller.load("${computeRenderPlanFingerprint({})}"`,
    );
    const lifecycle = source.indexOf(
      'runWithGeneratedLiveTargetRegistry(() => generatedClientModuleInstaller.load(',
    );
    const appImport = source.indexOf('() => import(', load);

    expect(claim).toBeGreaterThan(0);
    expect(lifecycle).toBeGreaterThan(claim);
    expect(load).toBeGreaterThan(lifecycle);
    expect(appImport).toBeGreaterThan(load);
    expect(source).not.toContain('generatedClientModuleInstaller.appBootstrap(');
    expect(source).not.toContain('generatedClientModuleInstaller.manual(');
  });

  it('executes emitted nonempty and empty handlers in one process with exact replacement', async () => {
    const root = mkdtempSync(join(process.cwd(), 'packages/cli/.tmp-generated-handler-'));
    try {
      const modules = await compilerModules();
      const nonempty = await executeGeneratedHandlerBundle(root, 'nonempty', modules);
      const empty = await executeGeneratedHandlerBundle(root, 'empty', []);

      expect(Object.keys(nonempty.exports)).toEqual(['default']);
      expect(Object.keys(empty.exports)).toEqual(['default']);
      expect(new Set(nonempty.app.clientModules.entries().map((module) => module.path))).toEqual(
        new Set(modules.map((module) => module.path)),
      );
      expect(empty.app.clientModules.entries().map((module) => module.path)).toEqual([
        '/c/kovo-runtime.client.js',
      ]);
      expect(nonempty.app.clientModules.entries()).not.toContainEqual(
        expect.objectContaining({ path: '/c/stale.client.js' }),
      );
      expect(empty.app.clientModules.entries()).not.toContainEqual(
        expect.objectContaining({ path: '/c/stale.client.js' }),
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects copied, duplicate, mixed-fingerprint, incomplete-pair, and reserved-manual input', async () => {
    const modules = await compilerModules();
    const copied = modules.map((module) => ({ ...module }));
    expect(() =>
      kovoServerHandlerEntrySource('/tmp/kovo/app.mjs', emptyStyles, 'node', copied),
    ).toThrow(/unproven compiler client module/u);
    expect(() =>
      kovoServerHandlerEntrySource('/tmp/kovo/app.mjs', emptyStyles, 'node', [
        modules[0]!,
        modules[0]!,
      ]),
    ).toThrow(/registered twice/u);
    const appBootstrap = modules.find(
      (module) => compilerOwnedViteClientModuleRole(module) === 'app-bootstrap',
    )!;
    expect(() =>
      kovoServerHandlerEntrySource('/tmp/kovo/app.mjs', emptyStyles, 'node', [appBootstrap]),
    ).toThrow(/exactly one coherent app-bootstrap\/deferred-runtime pair/u);
    const other = await compilerModules('pipeline');
    expect(() =>
      kovoServerHandlerEntrySource('/tmp/kovo/app.mjs', emptyStyles, 'node', [
        ...modules,
        ...other,
      ]),
    ).toThrow(/incoherent fingerprints|registered twice/u);
    expect(() =>
      kovoServerHandlerEntrySource('/tmp/kovo/app.mjs', emptyStyles, 'node', modules, [
        { path: '/c/generated/app.client.js', source: 'export const forged = true;' },
      ]),
    ).toThrow(/path is reserved/u);
  });

  it('keeps installer claims independent across two emitted bundles in one process', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-generated-installer-bundles-'));
    const entry = fileURLToPath(
      new URL('../../../server/src/internal/generated-build-client-modules.ts', import.meta.url),
    );
    try {
      const built = await esbuild({
        bundle: true,
        entryPoints: [entry],
        format: 'esm',
        platform: 'node',
        write: false,
      });
      const source = built.outputFiles[0]?.text;
      if (!source) throw new Error('Expected generated installer bundle output.');
      const firstPath = join(root, 'first.mjs');
      const secondPath = join(root, 'second.mjs');
      writeFileSync(firstPath, `${source}\n//# sourceURL=kovo-first-installer\n`, 'utf8');
      writeFileSync(secondPath, `${source}\n//# sourceURL=kovo-second-installer\n`, 'utf8');

      const first = (await import(pathToFileURL(firstPath).href)) as {
        claimGeneratedBuildClientModuleInstaller(): object;
      };
      const second = (await import(pathToFileURL(secondPath).href)) as {
        claimGeneratedBuildClientModuleInstaller(): object;
      };
      expect(first.claimGeneratedBuildClientModuleInstaller()).toBeTypeOf('object');
      expect(second.claimGeneratedBuildClientModuleInstaller()).toBeTypeOf('object');
      expect(() => first.claimGeneratedBuildClientModuleInstaller()).toThrow(/already claimed/u);
      expect(() => second.claimGeneratedBuildClientModuleInstaller()).toThrow(/already claimed/u);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not expose the generated installer through the server package surface', () => {
    const packageJsonPath = fileURLToPath(new URL('../../../server/package.json', import.meta.url));
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      exports?: Record<string, unknown>;
      publishConfig?: { exports?: Record<string, unknown> };
    };
    expect(packageJson.exports).not.toHaveProperty('./internal/generated-build-client-modules');
    expect(packageJson.publishConfig?.exports).not.toHaveProperty(
      './internal/generated-build-client-modules',
    );
    expect(() =>
      import.meta.resolve('@kovojs/server/internal/generated-build-client-modules'),
    ).toThrow(/not defined by "exports"|Package subpath/u);
  });
});
