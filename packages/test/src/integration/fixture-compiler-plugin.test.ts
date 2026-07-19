import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';
import type { CompileResult } from '@kovojs/compiler/internal';
import { createServer as createViteServer } from 'vite';

import { kovoFixtureCompilerPlugin } from './fixture-compiler-plugin.js';

function compileResult(source: string): CompileResult {
  return {
    componentGraphFacts: [],
    clientExports: [],
    cssAssets: [],
    dependencyFootprint: {},
    diagnostics: [],
    files: [],
    handlerExports: [],
    hmrImpact: null,
    loweredSource: source,
    outputContextFacts: [],
    platformSubstitutions: [],
    publishToClientFacts: [],
    queryUpdatePlans: [],
    renderEquivalenceChecks: [],
    updateCoverage: [],
    viewTransitions: [],
  };
}

describe('kovoFixtureCompilerPlugin', () => {
  it('serves only compiler-owned client identities and aggregates their query plans', async () => {
    const compile = vi.fn((options: { fileName: string }) => {
      const componentName = options.fileName.includes('alpha') ? 'AlphaCard' : 'BetaCard';
      const marker = componentName === 'AlphaCard' ? 'alpha' : 'beta';
      return {
        ...compileResult(`export const ${componentName} = true;`),
        files: [
          {
            fileName: options.fileName.replace(/\.tsx$/u, '.client.js'),
            kind: 'client' as const,
            source: `export const ${componentName}$queryUpdatePlans = { card(_root, value) { value.push('${marker}'); }, undeclared() { throw new Error('undeclared plan ran'); } };`,
          },
        ],
        queryUpdatePlans: [{ componentName, paths: [], query: 'card' }],
      };
    });
    const plugin = kovoFixtureCompilerPlugin(compile as never);
    const fixtureDir = fileURLToPath(
      new URL('../../../../tests/integration/fixtures/binding-text-attr/', import.meta.url),
    );
    const alphaFile = fileURLToPath(
      new URL('../../../../tests/integration/fixtures/binding-text-attr/alpha.tsx', import.meta.url),
    );
    const betaFile = fileURLToPath(
      new URL('../../../../tests/integration/fixtures/binding-text-attr/beta.tsx', import.meta.url),
    );
    const vite = await createViteServer({
      appType: 'custom',
      configFile: false,
      logLevel: 'silent',
      plugins: [plugin],
      root: fixtureDir,
      server: { hmr: false, middlewareMode: true, watch: null, ws: false },
    });

    try {
      const transform = plugin.transform as (
        source: string,
        id: string,
      ) => Promise<{ code: string }>;
      await transform('component({})', alphaFile);
      await transform('component({})', betaFile);

      const generatedAlphaId = alphaFile.replace(/\.tsx$/u, '.client.js');
      expect((plugin.resolveId as (id: string) => string | null)(generatedAlphaId)).toBe(
        generatedAlphaId,
      );
      expect((plugin.load as (id: string) => string | null)(generatedAlphaId)).toContain(
        'AlphaCard$queryUpdatePlans',
      );
      expect(
        (plugin.resolveId as (id: string) => string | null)(
          fileURLToPath(
            new URL(
              '../../../../tests/integration/fixtures/binding-text-attr/unregistered.client.js',
              import.meta.url,
            ),
          ),
        ),
      ).toBeNull();

      const aggregate = (await vite.ssrLoadModule(
        'virtual:kovo-fixture-generated-query-plans',
      )) as {
        kovoFixtureQueryPlans: { card(root: unknown, value: string[]): void };
      };
      const applied: string[] = [];
      aggregate.kovoFixtureQueryPlans.card(null, applied);
      expect(applied).toEqual(['alpha', 'beta']);
      expect(Object.hasOwn(aggregate.kovoFixtureQueryPlans, 'undeclared')).toBe(false);
      expect(Object.isFrozen(aggregate.kovoFixtureQueryPlans)).toBe(true);
      expect(Object.getPrototypeOf(aggregate.kovoFixtureQueryPlans)).toBeNull();
    } finally {
      await vite.close();
    }
  });

  it('rejects generated client and query-plan identity mismatches', async () => {
    const wrongFilePlugin = kovoFixtureCompilerPlugin(() => ({
      ...compileResult('export const safe = true;'),
      files: [
        {
          fileName: '../outside.client.js',
          kind: 'client' as const,
          source: 'export const Card$queryUpdatePlans = {};',
        },
      ],
      queryUpdatePlans: [{ componentName: 'Card', paths: [], query: 'card' }],
    }));
    (wrongFilePlugin.configResolved as (config: unknown) => void)({ root: '/workspace/app' });
    await expect(
      (wrongFilePlugin.transform as (source: string, id: string) => Promise<unknown>)(
        'component({})',
        '/workspace/app/card.tsx',
      ),
    ).rejects.toThrow(/client module identity mismatch/u);

    const mixedIdentityPlugin = kovoFixtureCompilerPlugin(() => ({
      ...compileResult('export const safe = true;'),
      files: [
        {
          fileName: 'card.client.js',
          kind: 'client' as const,
          source: 'export const Card$queryUpdatePlans = {};',
        },
      ],
      queryUpdatePlans: [
        { componentName: 'Card', paths: [], query: 'card' },
        { componentName: 'OtherCard', paths: [], query: 'other' },
      ],
    }));
    (mixedIdentityPlugin.configResolved as (config: unknown) => void)({ root: '/workspace/app' });
    await expect(
      (mixedIdentityPlugin.transform as (source: string, id: string) => Promise<unknown>)(
        'component({})',
        '/workspace/app/card.tsx',
      ),
    ).rejects.toThrow(/multiple query-plan component identities/u);

    const duplicateQueryPlugin = kovoFixtureCompilerPlugin(() => ({
      ...compileResult('export const safe = true;'),
      files: [
        {
          fileName: 'card.client.js',
          kind: 'client' as const,
          source: 'export const Card$queryUpdatePlans = { card() {} };',
        },
      ],
      queryUpdatePlans: [
        { componentName: 'Card', paths: [], query: 'card' },
        { componentName: 'Card', paths: [], query: 'card' },
      ],
    }));
    (duplicateQueryPlugin.configResolved as (config: unknown) => void)({ root: '/workspace/app' });
    await expect(
      (duplicateQueryPlugin.transform as (source: string, id: string) => Promise<unknown>)(
        'component({})',
        '/workspace/app/card.tsx',
      ),
    ).rejects.toThrow(/duplicate query-plan identity card/u);
  });

  it('keeps generated-query-plan aggregate identities private to one plugin instance', async () => {
    const first = kovoFixtureCompilerPlugin(() => ({
      ...compileResult('export const safe = true;'),
      files: [
        {
          fileName: 'card.client.js',
          kind: 'client' as const,
          source: 'export const Card$queryUpdatePlans = { card() {} };',
        },
      ],
      queryUpdatePlans: [{ componentName: 'Card', paths: [], query: 'card' }],
    }));
    const second = kovoFixtureCompilerPlugin();
    (first.configResolved as (config: unknown) => void)({ root: '/workspace/app' });
    (second.configResolved as (config: unknown) => void)({ root: '/workspace/app' });
    await (first.transform as (source: string, id: string) => Promise<unknown>)(
      'component({})',
      '/workspace/app/card.tsx',
    );

    const firstResolved = (first.resolveId as (id: string) => string | null)(
      'virtual:kovo-fixture-generated-query-plans',
    );
    const secondResolved = (second.resolveId as (id: string) => string | null)(
      'virtual:kovo-fixture-generated-query-plans',
    );
    expect(firstResolved).not.toBe(secondResolved);
    expect((second.load as (id: string) => string | null)(firstResolved!)).toBeNull();
  });

  it('pins classifier/cache intrinsics after authored replacement', async () => {
    const compile = vi.fn(() => compileResult('export const safe = true;'));
    const plugin = kovoFixtureCompilerPlugin(compile);
    const configResolved = plugin.configResolved as (config: unknown) => void;
    const transform = plugin.transform as (source: string, id: string) => unknown;
    configResolved({ root: '/workspace/app' });
    const nativeMapGet = Map.prototype.get;
    const nativeMapSet = Map.prototype.set;
    const nativeRegExpExec = RegExp.prototype.exec;
    const nativeIncludes = String.prototype.includes;
    let transformed: unknown;
    try {
      Map.prototype.get = () => undefined;
      Map.prototype.set = function poisonedSet() {
        return this;
      };
      RegExp.prototype.exec = () => null;
      String.prototype.includes = () => false;
      transformed = await transform(
        'component({ render: () => null })',
        '/workspace/app/src/demo.tsx',
      );
    } finally {
      Map.prototype.get = nativeMapGet;
      Map.prototype.set = nativeMapSet;
      RegExp.prototype.exec = nativeRegExpExec;
      String.prototype.includes = nativeIncludes;
    }
    expect(transformed).toEqual({ code: 'export const safe = true;\n', map: null });
    expect(compile).toHaveBeenCalledOnce();
  });

  it('rejects config/result accessors without invoking them', async () => {
    let configInvoked = false;
    const plugin = kovoFixtureCompilerPlugin(() => compileResult('safe'));
    const configResolved = plugin.configResolved as (config: unknown) => void;
    expect(() =>
      configResolved({
        get root() {
          configInvoked = true;
          return '/workspace/app';
        },
      }),
    ).toThrow(/stable own data property/u);
    expect(configInvoked).toBe(false);

    let resultInvoked = false;
    const resultPlugin = kovoFixtureCompilerPlugin(() => ({
      ...compileResult('safe'),
      get diagnostics() {
        resultInvoked = true;
        return [];
      },
    }));
    (resultPlugin.configResolved as (config: unknown) => void)({ root: '/workspace/app' });
    await expect(
      (resultPlugin.transform as (source: string, id: string) => unknown)(
        'component({ render: () => null })',
        '/workspace/app/src/demo.tsx',
      ),
    ).rejects.toThrow(/stable own data property/u);
    expect(resultInvoked).toBe(false);
  });

  it('registers private snapshotted CSS metadata and returns defensive manifest copies', async () => {
    const asset = {
      componentName: 'card',
      criticalCss: '.card{color:red}',
      fragmentTargets: ['card'],
      href: '/assets/card.css',
      sourceFileName: 'card.css',
    };
    const result: CompileResult = {
      ...compileResult('export const card = true;'),
      cssAssets: [asset],
      files: [{ fileName: 'card.css', kind: 'css', source: '.card{color:green}' }],
    };
    const plugin = kovoFixtureCompilerPlugin(() => result);
    (plugin.configResolved as (config: unknown) => void)({ root: '/workspace/app' });
    const transformed = await (
      plugin.transform as (source: string, id: string) => Promise<{ code: string }>
    )('component({ render: () => null })', '/workspace/app/src/card.tsx');
    const privateId = /from\s+"([^"]+:register:[^"]+)"/u.exec(transformed.code)?.[1];
    expect(privateId).toBeTruthy();
    const resolved = (plugin.resolveId as (id: string) => string | null)(privateId!);
    const registrySource = (plugin.load as (id: string) => string | null)(resolved!);
    const registry = (await import(
      `data:text/javascript;base64,${Buffer.from(registrySource!).toString('base64')}`
    )) as {
      kovoFixtureRegisterStylesheets(values: unknown[]): void;
      kovoFixtureStylesheetManifest(): Array<{ href: string }>;
      kovoFixtureStylesheetsForTargets(targets: string[]): Array<{ href: string }>;
    };
    registry.kovoFixtureRegisterStylesheets([asset]);
    const first = registry.kovoFixtureStylesheetManifest();
    first[0]!.href = 'https://attacker.test/evil.css';
    expect(registry.kovoFixtureStylesheetManifest()[0]?.href).toBe('/assets/card.css');
    expect(registry.kovoFixtureStylesheetsForTargets(['card'])[0]?.href).toBe('/assets/card.css');
  });

  it('keeps preloaded stylesheet registration authoritative after an earlier poison dependency', async () => {
    const cssAsset = {
      componentName: 'poisoned-style',
      criticalCss: '.poisoned{color:rebeccapurple}',
      fragmentTargets: ['poisoned-style'],
      href: '/assets/poisoned-style.css',
      sourceFileName: 'poisoned-style.css',
    };
    const compile = vi.fn(() => ({
      ...compileResult('export const styledModuleEvaluated = true;'),
      cssAssets: [cssAsset],
      files: [
        {
          fileName: 'poisoned-style.css',
          kind: 'css' as const,
          source: cssAsset.criticalCss,
        },
      ],
    }));
    const plugin = kovoFixtureCompilerPlugin(compile);
    const fixtureDir = fileURLToPath(
      new URL('../../../../tests/integration/fixtures/css-registry-poison/', import.meta.url),
    );
    const vite = await createViteServer({
      appType: 'custom',
      configFile: false,
      logLevel: 'silent',
      plugins: [plugin],
      root: fixtureDir,
      server: { hmr: false, middlewareMode: true, watch: null, ws: false },
    });

    try {
      // Mirrors bootFixture: capture registry controls before the app evaluates poison.ts and then
      // the transformed styled component's appended registration import.
      await vite.ssrLoadModule(plugin.fixtureCssRuntimeId);
      const app = (await vite.ssrLoadModule('/app.ts')) as { stylesheetHrefs?: unknown };
      expect(app.stylesheetHrefs).toEqual(['/assets/poisoned-style.css']);
      expect(compile).toHaveBeenCalledOnce();
    } finally {
      try {
        const poison = (await vite.ssrLoadModule('/poison.ts')) as {
          restoreCssRegistryPoison?: () => void;
        };
        poison.restoreCssRegistryPoison?.();
      } finally {
        await vite.close();
      }
    }
  });

  it('compiles repeated fixture transforms fresh', async () => {
    let count = 0;
    const compile = vi.fn(() => compileResult(`export const marker = ${++count};`));
    const plugin = kovoFixtureCompilerPlugin(compile);
    const configResolved = plugin.configResolved as (config: unknown) => void;
    const transform = plugin.transform as (source: string, id: string) => unknown;

    configResolved({ root: '/workspace/app' });

    await expect(
      Promise.resolve(transform('component(', '/workspace/app/src/demo.tsx')),
    ).resolves.toEqual({
      code: 'export const marker = 1;\n',
      map: null,
    });
    await expect(
      Promise.resolve(transform('component(', '/workspace/app/src/demo.tsx')),
    ).resolves.toEqual({
      code: 'export const marker = 2;\n',
      map: null,
    });
    await expect(
      Promise.resolve(
        transform('component({ render: () => null })', '/workspace/app/src/demo.tsx'),
      ),
    ).resolves.toEqual({
      code: 'export const marker = 3;\n',
      map: null,
    });

    expect(compile).toHaveBeenCalledTimes(3);
  });

  it('forwards precomputed project mutation provenance to fixture component lowering', async () => {
    const compile = vi.fn(() => compileResult('export const safe = true;'));
    const projectMutationFacts = {
      mutationBindings: [
        {
          fileName: 'forms.tsx',
          key: 'cart/add',
          localName: 'addToCart',
          source: { exportName: 'addToCart', fileName: 'app.ts', kind: 'kovo-mutation' as const },
        },
      ],
      mutationInputs: { 'cart/add': [] },
    };
    const plugin = kovoFixtureCompilerPlugin(compile, projectMutationFacts);
    (plugin.configResolved as (config: unknown) => void)({ root: '/workspace/app' });

    await (plugin.transform as (source: string, id: string) => Promise<unknown>)(
      'component({ render: () => null })',
      '/workspace/app/forms.tsx',
    );

    expect(compile).toHaveBeenCalledWith(
      expect.objectContaining({ registryFacts: projectMutationFacts }),
    );
  });

  it('does not classify noExternal framework modules as fixture-authored source', async () => {
    const compile = vi.fn(() => compileResult('never'));
    const plugin = kovoFixtureCompilerPlugin(compile);
    const configResolved = plugin.configResolved as (config: unknown) => void;
    const transform = plugin.transform as (source: string, id: string) => unknown;
    configResolved({ root: '/workspace/app' });

    await expect(
      Promise.resolve(
        transform(
          'export function internal() { return "component("; }',
          '/workspace/packages/compiler/src/internal.ts',
        ),
      ),
    ).resolves.toBeNull();
    expect(compile).not.toHaveBeenCalled();
  });

  it('does not classify a lexical parent traversal as fixture-authored source', async () => {
    const compile = vi.fn(() => compileResult('never'));
    const plugin = kovoFixtureCompilerPlugin(compile);
    const configResolved = plugin.configResolved as (config: unknown) => void;
    const transform = plugin.transform as (source: string, id: string) => unknown;
    configResolved({ root: '/workspace/app' });

    await expect(
      Promise.resolve(
        transform('component({ render: () => null })', '/workspace/app/../outside.tsx'),
      ),
    ).resolves.toBeNull();
    expect(compile).not.toHaveBeenCalled();
  });
});
