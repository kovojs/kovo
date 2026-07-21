// @kovo-security-classifier-corpus dependency-capability-loader
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';
import { build as viteBuild, createServer as createViteServer } from 'vite-plus';

import {
  assertDependencyCapabilityImport,
  dependencyCapabilityLoaderVitePlugin,
  type AppDependencyCapabilityManifest,
} from './dependency-capability-loader.js';
import { resolveCapabilityPackageImport } from './capability-closure-packages.js';

const manifest: AppDependencyCapabilityManifest = {
  dependencies: [
    {
      entries: [
        {
          conditions: ['default', 'import'],
          importers: ['app.mjs'],
          imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
          rootKinds: ['route'],
          sites: ['app.mjs:1:1'],
          specifier: 'safe-parser',
        },
      ],
      manifestFingerprint: 'sha256:safe-parser-v1',
      packageName: 'safe-parser',
      packageVersion: '1.2.3',
      summaryVersion: 'safe-parser-review/1',
      verdict: 'open',
    },
  ],
  schema: 'kovo-app-dependency-capabilities/v1',
};

function depthBudgetCarrierExpression(assetPath: string): string {
  const depth = 56;
  const nested = Array.from({ length: depth }).reduce<string>(
    (value) => `{ next: ${value} }`,
    'box',
  );
  return `(() => { function install(box) { const root = ${nested}; root${'.next'.repeat(depth)}.platform = globalThis; } const box = {}; install(box); return new box.platform.Worker('${assetPath}'); })()`;
}

function recursiveBudgetCarrierExpression(assetPath: string): string {
  return `(() => { function install(box) { var cycle = cycle; console.log(cycle); const holder = { get target() { return box; } }; holder.target.platform = globalThis; } const box = {}; install(box); return new box.platform.Worker('${assetPath}'); })()`;
}

// @kovo-security-certifies C13 dependency-browser-carrier-recursion-budget
function recursiveCallableCarrierExpression(assetPath: string): string {
  return `(() => { function select() { return flag ? select() : select(); } return new (select().Worker)('${assetPath}'); })()`;
}

function finiteBrowserBudgetExhaustionExpression(): string {
  const declarations = ['function branch0(value) { return value; }'];
  for (let depth = 1; depth <= 14; depth += 1) {
    declarations.push(
      `function branch${depth}(value) { return flag ? branch${depth - 1}(value + 1) : branch${depth - 1}(value + 2); }`,
    );
  }
  return `(() => { ${declarations.join(' ')} return branch14(0); })()`;
}

// @kovo-security-certifies C13 dependency-closed-constructor-chain
function closedBrowserValueDynamicWorkerExpression(assetPath: string): string {
  return `globalThis.location.constructor.constructor(${JSON.stringify(
    `return new Worker(${JSON.stringify(assetPath)})`,
  )})()`;
}

// @kovo-security-certifies C13 dependency-invocation-adapter-closure
function dynamicCodeAdapterCarrierExpressions(
  assetPath: string,
): readonly (readonly [label: string, expression: string])[] {
  const workerCode = `new Worker(${JSON.stringify(assetPath)})`;
  const script = JSON.stringify(workerCode);
  const functionBody = JSON.stringify(`return ${workerCode}`);
  return [
    ['eval.call dynamic Worker', `globalThis.eval.call(null, ${script})`],
    ['eval.apply dynamic Worker', `globalThis.eval.apply(null, [${script}])`],
    ['eval.bind dynamic Worker', `globalThis.eval.bind(null)(${script})`],
    ['Reflect.apply eval dynamic Worker', `Reflect.apply(globalThis.eval, null, [${script}])`],
    [
      'Reflect.construct Function dynamic Worker',
      `Reflect.construct(Function, [${functionBody}])()`,
    ],
    ['Function tagged-template dynamic Worker', `Function\`${`return ${workerCode}`}\`() `],
    [
      'borrowed apply.call eval dynamic Worker',
      `(() => {}).apply.call(globalThis.eval, null, [${script}])`,
    ],
    ['local-function constructor dynamic Worker', `(() => {}).constructor(${functionBody})()`],
    ['array-method constructor dynamic Worker', `[].filter.constructor(${functionBody})()`],
    ['Object constructor dynamic Worker', `Object.constructor(${functionBody})()`],
    ['Proxy constructor dynamic Worker', `Proxy.constructor(${functionBody})()`],
    ['setTimeout constructor dynamic Worker', `setTimeout.constructor(${functionBody})()`],
    ['Object.freeze constructor dynamic Worker', `Object.freeze.constructor(${functionBody})()`],
    ['Reflect.get constructor dynamic Worker', `Reflect.get.constructor(${functionBody})()`],
    [
      'Reflect.construct constructor dynamic Worker',
      `Reflect.construct.constructor(${functionBody})()`,
    ],
    [
      'constructor-chain call dynamic Worker',
      `globalThis.location.constructor.constructor.call(null, ${functionBody})()`,
    ],
    [
      'constructor-chain Reflect.apply dynamic Worker',
      `Reflect.apply(globalThis.location.constructor.constructor, null, [${functionBody}])()`,
    ],
    [
      'descriptor Reflect.construct Worker',
      `Reflect.construct(Object.getOwnPropertyDescriptor(globalThis, 'Worker').value, [${JSON.stringify(assetPath)}])`,
    ],
  ];
}

function timerAdapterCarrierExpressions(
  assetPath: string,
): readonly (readonly [label: string, expression: string])[] {
  const script = JSON.stringify(`new Worker(${JSON.stringify(assetPath)})`);
  return [
    [
      'setTimeout tagged-template callback',
      `setTimeout\`${`new Worker(${JSON.stringify(assetPath)})`}\``,
    ],
    ['setTimeout array callback', `setTimeout([${script}], 0)`],
    ['setTimeout coercing-object callback', `setTimeout({ toString() { return ${script}; } }, 0)`],
    [
      'setTimeout aliased-array callback',
      `(() => { const callback = [${script}]; return setTimeout(callback, 0); })()`,
    ],
    [
      'setTimeout extra timer-authority callback argument',
      `setTimeout(timer => timer(${script}, 0), 0, setTimeout)`,
    ],
    ['setTimeout.call string callback', `setTimeout.call(null, ${script}, 0)`],
    ['setTimeout.apply string callback', `setTimeout.apply(null, [${script}, 0])`],
    ['setTimeout.bind string callback', `setTimeout.bind(null)(${script}, 0)`],
    ['Reflect.apply setTimeout string callback', `Reflect.apply(setTimeout, null, [${script}, 0])`],
    [
      'borrowed call.call setTimeout string callback',
      `(() => {}).call.call(setTimeout, null, ${script}, 0)`,
    ],
  ];
}

function deepStructuredArgumentCarrierExpression(assetPath: string): string {
  const depth = 56;
  const nested = Array.from({ length: depth }).reduce<string>(
    (value) => `{ next: ${value} }`,
    '{ box }',
  );
  return `(() => { const box = {}; const root = ${nested}; function install(value) { value${'.next'.repeat(depth)}.box.platform = globalThis; } install(root); return new box.platform.Worker('${assetPath}'); })()`;
}

async function buildReviewedBrowserPackageArtifact(dependencySource: string): Promise<string> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-browser-authority-escape-')));
  const appModulePath = join(root, 'client.mjs');
  const packageRoot = join(root, 'node_modules', 'safe-parser');
  const outDir = join(root, 'dist');
  const appSource = "import { inspect } from 'safe-parser'; export const value = inspect();\n";
  try {
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({
        exports: { '.': './index.mjs' },
        name: 'safe-parser',
        type: 'module',
        version: '1.2.3',
      }),
    );
    writeFileSync(join(packageRoot, 'index.mjs'), `${dependencySource}\n`);
    writeFileSync(appModulePath, appSource);
    const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
    const exactManifest: AppDependencyCapabilityManifest = {
      dependencies: [
        {
          entries: [
            {
              conditions: installed.conditions,
              importers: ['client.mjs'],
              imports: [{ capabilities: [], disposition: 'pure', name: 'inspect' }],
              rootKinds: ['route'],
              sites: ['client.mjs:1:1'],
              specifier: 'safe-parser',
            },
          ],
          manifestFingerprint: installed.manifestFingerprint,
          packageName: installed.packageName,
          packageVersion: installed.packageVersion,
          summaryVersion: 'safe-parser-review/1',
          verdict: 'open',
        },
      ],
      schema: 'kovo-app-dependency-capabilities/v1',
    };
    await viteBuild({
      build: {
        emptyOutDir: true,
        minify: true,
        outDir,
        rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.js' } },
      },
      configFile: false,
      logLevel: 'silent',
      plugins: [
        dependencyCapabilityLoaderVitePlugin(
          appModulePath,
          [{ fileName: 'client.mjs', source: appSource }],
          exactManifest,
          'build-client',
        ),
      ],
      root,
    });
    return readFileSync(join(outDir, 'entry.js'), 'utf8');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

describe('SPEC §6.6 app dependency loader attenuation', () => {
  // @kovo-security-certifies C13 dependency-complete-ssr-wiring
  it('forces complete dependency traversal in both supported SSR app-evaluation lanes', () => {
    const source = readFileSync(new URL('./commands/build-export.ts', import.meta.url), 'utf8');
    for (const functionName of ['loadBuildAppModule', 'loadExportAppModule']) {
      const start = source.indexOf(`async function ${functionName}(`);
      const end = source.indexOf('\nasync function ', start + 1);
      expect(start, `${functionName} must remain present`).toBeGreaterThanOrEqual(0);
      expect(source.slice(start, end === -1 ? undefined : end)).toContain(
        'ssr: dependencyCapabilityCompleteSsrOptions()',
      );
    }
  });

  it('keeps the native SQLite wrapper external while traversing every app dependency', () => {
    const source = readFileSync(new URL('./commands/build-export.ts', import.meta.url), 'utf8');
    const start = source.indexOf('function dependencyCapabilityCompleteSsrOptions()');
    const end = source.indexOf('\nfunction ', start + 1);
    const options = source.slice(start, end === -1 ? undefined : end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(options).toContain("'better-sqlite3'");
    expect(options).toContain('noExternal: true');
  });

  it('uses the discarded component-scan lane only for the temporary SSR compiler census', () => {
    const source = readFileSync(new URL('./commands/build-export.ts', import.meta.url), 'utf8');
    const start = source.indexOf('async function buildKovoComponentClientModules(');
    const end = source.indexOf('\nfunction ', start + 1);
    const componentScan = source.slice(start, end === -1 ? undefined : end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(componentScan).toContain("'component-scan'");
    expect(componentScan).toContain('rmSync(tempDir, { force: true, recursive: true })');
    expect(source.slice(0, start)).not.toContain("'component-scan'");
    expect(source.slice(end)).not.toContain("'component-scan'");
  });

  // @kovo-security-certifies C13 dependency-capability-loader-identity
  it('admits only the exact censused dependency import and installed identity', () => {
    expect(
      assertDependencyCapabilityImport(manifest, 'safe-parser', {
        conditions: ['default', 'import'],
        exportStatus: 'resolved',
        manifestFingerprint: 'sha256:safe-parser-v1',
        packageName: 'safe-parser',
        packageVersion: '1.2.3',
        specifier: 'safe-parser',
      }),
    ).toMatchObject({ packageName: 'safe-parser', summaryVersion: 'safe-parser-review/1' });

    for (const source of ['safe-parser/hidden', 'surprise-loader']) {
      expect(() =>
        assertDependencyCapabilityImport(manifest, source, {
          conditions: ['default', 'import'],
          exportStatus: 'resolved',
          manifestFingerprint: 'sha256:safe-parser-v1',
          packageName: 'safe-parser',
          packageVersion: '1.2.3',
          specifier: source,
        }),
      ).toThrow(/KV448.*absent from the compiler-derived dependency manifest/u);
    }

    for (const installed of [
      { packageVersion: '1.2.4' },
      { manifestFingerprint: 'sha256:substituted' },
      { conditions: ['default', 'require'] },
    ]) {
      expect(() =>
        assertDependencyCapabilityImport(manifest, 'safe-parser', {
          conditions: ['default', 'import'],
          exportStatus: 'resolved',
          manifestFingerprint: 'sha256:safe-parser-v1',
          packageName: 'safe-parser',
          packageVersion: '1.2.3',
          specifier: 'safe-parser',
          ...installed,
        }),
      ).toThrow(/KV448.*identity drifted after capability census/u);
    }

    expect(() => assertDependencyCapabilityImport(manifest, 'safe-parser', undefined)).toThrow(
      /KV448.*identity drifted after capability census/u,
    );

    for (const missing of ['rootKinds', 'sites'] as const) {
      const malformed = JSON.parse(JSON.stringify(manifest)) as AppDependencyCapabilityManifest;
      delete (malformed.dependencies[0]!.entries[0]! as unknown as Record<string, unknown>)[
        missing
      ];
      expect(() =>
        dependencyCapabilityLoaderVitePlugin(
          '/app.mjs',
          [{ fileName: 'app.mjs', source: "import 'safe-parser';" }],
          malformed,
        ),
      ).toThrow(/KV448.*manifest dependency\[0\] entry\[0\] is malformed/u);
    }
  });

  // @kovo-security-certifies C13 dependency-capability-loader-closed-verdict
  it('never turns a raw or closed manifest row into loader authority', () => {
    for (const disposition of ['raw', 'framework-door'] as const) {
      const closed: AppDependencyCapabilityManifest = {
        ...manifest,
        dependencies: [
          {
            ...manifest.dependencies[0]!,
            entries: [
              {
                ...manifest.dependencies[0]!.entries[0]!,
                imports: [{ capabilities: ['network'], disposition, name: 'parse' }],
              },
            ],
            verdict: 'closed',
          },
        ],
      };
      expect(() =>
        assertDependencyCapabilityImport(closed, 'safe-parser', {
          conditions: ['default', 'import'],
          exportStatus: 'resolved',
          manifestFingerprint: 'sha256:safe-parser-v1',
          packageName: 'safe-parser',
          packageVersion: '1.2.3',
          specifier: 'safe-parser',
        }),
      ).toThrow(/KV448.*does not carry an open least-authority verdict/u);
    }

    for (const disposition of ['raw', 'request-closed'] as const) {
      const retainedUnsafeImport: AppDependencyCapabilityManifest = {
        ...manifest,
        dependencies: [
          {
            ...manifest.dependencies[0]!,
            entries: [
              {
                ...manifest.dependencies[0]!.entries[0]!,
                imports: [{ capabilities: ['network'], disposition, name: 'parse' }],
              },
            ],
            verdict: 'open',
          },
        ],
      };
      expect(() =>
        assertDependencyCapabilityImport(retainedUnsafeImport, 'safe-parser', {
          conditions: ['default', 'import'],
          exportStatus: 'resolved',
          manifestFingerprint: 'sha256:safe-parser-v1',
          packageName: 'safe-parser',
          packageVersion: '1.2.3',
          specifier: 'safe-parser',
        }),
      ).toThrow(/KV448.*does not carry an open least-authority verdict/u);
    }
  });

  // @kovo-security-certifies C13 dependency-configured-alias-identity-join
  it('enforces the manifest in a real Vite import path before admitting app dependencies', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-dependency-loader-'));
    const appModulePath = join(root, 'app.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    const outDir = join(root, 'dist');
    const source = "import { parse } from 'safe-parser';\nexport const value = parse('ok');\n";
    try {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          exports: {
            '.': { default: './index.js', import: './index.js' },
            './hidden': './hidden.js',
          },
          name: 'safe-parser',
          type: 'module',
          version: '1.2.3',
        }),
        'utf8',
      );
      writeFileSync(
        join(packageRoot, 'index.js'),
        'export const parse = value => value;\n',
        'utf8',
      );
      writeFileSync(join(packageRoot, 'hidden.js'), 'export const hidden = true;\n', 'utf8');
      writeFileSync(appModulePath, source, 'utf8');
      const installed = resolveCapabilityPackageImport('safe-parser', appModulePath);
      expect(installed).toBeDefined();
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed!.conditions,
                importers: ['app.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                rootKinds: ['route'],
                sites: ['app.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: installed!.manifestFingerprint,
            packageName: installed!.packageName,
            packageVersion: installed!.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };
      const build = (approvedSource: string, candidateManifest = exactManifest) =>
        viteBuild({
          build: { emptyOutDir: true, outDir, rollupOptions: { input: appModulePath } },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: basename(appModulePath), source: approvedSource }],
              candidateManifest,
            ),
          ],
          root,
        });

      await expect(build(source)).resolves.toBeDefined();

      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir, rollupOptions: { input: appModulePath } },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: basename(appModulePath), source }],
              exactManifest,
            ),
          ],
          resolve: { alias: { 'safe-parser': join(packageRoot, 'index.js') } },
          root,
        }),
      ).resolves.toBeDefined();

      const aliasTarget = join(packageRoot, 'index.js');
      const aliasBorrowingSource =
        `import { parse as reviewed } from 'safe-parser';\n` +
        `import { parse as borrowed } from ${JSON.stringify(aliasTarget)};\n` +
        `export const value = [reviewed('ok'), borrowed('borrowed')];\n`;
      writeFileSync(appModulePath, aliasBorrowingSource, 'utf8');
      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir, rollupOptions: { input: appModulePath } },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: basename(appModulePath), source: aliasBorrowingSource }],
              exactManifest,
            ),
          ],
          resolve: { alias: { 'safe-parser': aliasTarget } },
          root,
        }),
      ).rejects.toThrow(/KV448.*authored an unadmitted edge.*package-alias target/u);

      const aliasBorrowingBareSource =
        `import { parse as reviewed } from 'safe-parser';\n` +
        `import { parse as borrowed } from 'borrowed-parser';\n` +
        `export const value = [reviewed('ok'), borrowed('borrowed')];\n`;
      writeFileSync(appModulePath, aliasBorrowingBareSource, 'utf8');
      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir, rollupOptions: { input: appModulePath } },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: basename(appModulePath), source: aliasBorrowingBareSource }],
              exactManifest,
            ),
          ],
          resolve: {
            alias: {
              'borrowed-parser': aliasTarget,
              'safe-parser': aliasTarget,
            },
          },
          root,
        }),
      ).rejects.toThrow(/KV448.*authored an unadmitted edge.*package-alias target/u);

      writeFileSync(appModulePath, source, 'utf8');

      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir, rollupOptions: { input: appModulePath } },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: basename(appModulePath), source }],
              exactManifest,
            ),
          ],
          resolve: { alias: { 'safe-parser': join(packageRoot, 'hidden.js') } },
          root,
        }),
      ).rejects.toThrow(/KV448.*alias resolves outside its exact package export target/u);

      const widenedSource =
        "import { hidden } from 'safe-parser/hidden';\nexport const value = hidden;\n";
      writeFileSync(appModulePath, widenedSource, 'utf8');
      await expect(build(widenedSource)).rejects.toThrow(
        /KV448.*safe-parser\/hidden.*absent from the compiler-derived dependency manifest/u,
      );

      writeFileSync(appModulePath, source, 'utf8');
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          exports: {
            '.': { default: './index.js', import: './index.js' },
            './hidden': './hidden.js',
          },
          name: 'safe-parser',
          type: 'module',
          version: '1.2.4',
        }),
        'utf8',
      );
      await expect(build(source)).rejects.toThrow(
        /KV448.*identity drifted after capability census/u,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-browser-carrier-client-lane
  it('limits browser carrier evaluation to client artifacts', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-browser-lane-')));
    const appModulePath = join(root, 'app.mjs');
    const source = `${recursiveCallableCarrierExpression('/payload.mjs')};\n`;
    try {
      writeFileSync(appModulePath, source);
      const build = (lane: 'build-client' | 'build-server') =>
        viteBuild({
          build: {
            emptyOutDir: true,
            outDir: join(root, `dist-${lane}`),
            rollupOptions: { input: appModulePath },
            ...(lane === 'build-server' ? { ssr: true } : {}),
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'app.mjs', source }],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              lane,
            ),
          ],
          root,
          ssr: { noExternal: true },
        });

      await expect(build('build-server')).resolves.toBeDefined();
      await expect(build('build-client')).rejects.toThrow(
        /KV448.*supported build-client artifact.*retains a Worker constructor/u,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-browser-carrier-finite-budget
  it('fails closed when finite browser carrier evaluation exhausts its shared step budget', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-browser-budget-')));
    const appModulePath = join(root, 'app.mjs');
    const source = `${finiteBrowserBudgetExhaustionExpression()};\n`;
    try {
      writeFileSync(appModulePath, source);
      await expect(
        viteBuild({
          build: {
            emptyOutDir: true,
            outDir: join(root, 'dist'),
            rollupOptions: { input: appModulePath },
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'app.mjs', source }],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              'build-client',
            ),
          ],
          root,
        }),
      ).rejects.toThrow(/KV448.*opaque browser executable carrier/u);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-real-drizzle-noncarrier
  it('admits the retained real Drizzle eq graph as a proved browser non-carrier in both build lanes', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-real-drizzle-')));
    const appModulePath = join(root, 'app.mjs');
    const source = "import { eq } from 'drizzle-orm'; export const retainedEq = eq;\n";
    try {
      mkdirSync(join(root, 'node_modules'), { recursive: true });
      symlinkSync(
        join(import.meta.dirname, '../../drizzle/node_modules/drizzle-orm'),
        join(root, 'node_modules', 'drizzle-orm'),
        'dir',
      );
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('drizzle-orm', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['app.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'eq' }],
                rootKinds: ['route'],
                sites: ['app.mjs:1:1'],
                specifier: 'drizzle-orm',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'drizzle-eq-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };
      const build = (lane: 'build-client' | 'build-server') =>
        viteBuild({
          build: {
            emptyOutDir: true,
            minify: false,
            outDir: join(root, `dist-${lane}`),
            rollupOptions: { input: appModulePath },
            ...(lane === 'build-server' ? { ssr: true } : {}),
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'app.mjs', source }],
              exactManifest,
              lane,
            ),
          ],
          root,
          ssr: { noExternal: true },
        });

      await expect(build('build-client')).resolves.toBeDefined();
      await expect(build('build-server')).resolves.toBeDefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('admits direct timers with proved callbacks and local carrier-shaped properties', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-safe-builtins-')));
    const appModulePath = join(root, 'app.mjs');
    const source = [
      'const local = {',
      '  eval: value => value,',
      '  Function: value => () => value,',
      '  setTimeout: callback => callback(),',
      '};',
      'setTimeout(() => {}, 1);',
      "globalThis.__kovoSafeCarrierNames = [local.eval('safe'), local.Function('safe')(), local.setTimeout(() => 'safe'), globalThis.location.constructor];",
    ].join('\n');
    try {
      writeFileSync(appModulePath, `${source}\n`);
      await expect(
        viteBuild({
          build: {
            emptyOutDir: true,
            outDir: join(root, 'dist'),
            rollupOptions: { input: appModulePath },
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'app.mjs', source: `${source}\n` }],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              'build-client',
            ),
          ],
          root,
        }),
      ).resolves.toBeDefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('forces ESM and literal CommonJS dependencies into production SSR artifacts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-dependency-ssr-loader-'));
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    try {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          exports: { '.': './index.js' },
          name: 'safe-parser',
          type: 'module',
          version: '1.2.3',
        }),
      );
      writeFileSync(join(packageRoot, 'index.js'), 'export const parse = value => value;\n');

      for (const fixture of [
        {
          fileName: 'app.mjs',
          source: "import { parse } from 'safe-parser'; export const value = parse('esm');\n",
        },
        {
          fileName: 'app.cjs',
          source: "const { parse } = require('safe-parser'); exports.value = parse('cjs');\n",
        },
      ]) {
        const appModulePath = join(root, fixture.fileName);
        const outDir = join(root, `dist-${fixture.fileName}`);
        writeFileSync(appModulePath, fixture.source);
        const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
        const exactManifest: AppDependencyCapabilityManifest = {
          dependencies: [
            {
              entries: [
                {
                  conditions: installed.conditions,
                  importers: [fixture.fileName],
                  imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                  rootKinds: ['route'],
                  sites: [`${fixture.fileName}:1:1`],
                  specifier: 'safe-parser',
                },
              ],
              manifestFingerprint: installed.manifestFingerprint,
              packageName: installed.packageName,
              packageVersion: installed.packageVersion,
              summaryVersion: 'safe-parser-review/1',
              verdict: 'open',
            },
          ],
          schema: 'kovo-app-dependency-capabilities/v1',
        };
        const plugin = () =>
          dependencyCapabilityLoaderVitePlugin(
            appModulePath,
            [{ fileName: fixture.fileName, source: fixture.source }],
            exactManifest,
            'build-server',
            { allowNodeBuiltins: true },
          );
        const config = {
          build: {
            emptyOutDir: true,
            outDir,
            rollupOptions: {
              input: appModulePath,
              output: { entryFileNames: 'entry.mjs' },
            },
            ssr: true,
          },
          configFile: false as const,
          logLevel: 'silent' as const,
          plugins: [plugin()],
          root,
          ssr: { noExternal: ['safe-parser'] },
        };
        await expect(viteBuild(config)).resolves.toBeDefined();
        const emitted = readFileSync(join(outDir, 'entry.mjs'), 'utf8');
        expect(emitted).not.toMatch(/(?:from|require|__require)\s*\(?['"]safe-parser['"]/u);

        await expect(
          viteBuild({ ...config, plugins: [plugin()], ssr: { external: ['safe-parser'] } }),
        ).rejects.toThrow(
          /KV448.*safe-parser.*(?:overlaps a trusted SSR external|resolved outside its exact package export target|escaped the supported build-server)/u,
        );
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-bundle-owned-chunk-identity
  it('admits bundle-owned sibling chunks without treating their filenames as package externals', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-owned-chunk-')));
    const appModulePath = join(root, 'app.mjs');
    const handlerPath = join(root, 'handler.mjs');
    const outDir = join(root, 'dist');
    const appSource =
      "export async function run() { return (await import('./handler.mjs')).handler(); }\n";
    const handlerSource = "export const handler = () => 'owned';\n";
    try {
      writeFileSync(appModulePath, appSource);
      writeFileSync(handlerPath, handlerSource);
      await expect(
        viteBuild({
          build: {
            emptyOutDir: true,
            outDir,
            rollupOptions: {
              input: appModulePath,
              output: { chunkFileNames: '[name].mjs', entryFileNames: '[name].mjs' },
            },
            ssr: true,
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [
                { fileName: 'app.mjs', source: appSource },
                { fileName: 'handler.mjs', source: handlerSource },
              ],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              'build-server',
            ),
          ],
          root,
          ssr: { noExternal: true },
        }),
      ).resolves.toBeDefined();
      expect(readFileSync(join(outDir, 'app.mjs'), 'utf8')).toMatch(
        /import\(["']\.\/handler\.mjs["']\)/u,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-bundle-owned-output-kind
  it('rejects a retained module import that collides with a bundle-owned asset name', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-asset-collision-')));
    const appModulePath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const appSource = [
      'export async function run() {',
      "  return import(/* @vite-ignore */ './payload.mjs');",
      '}',
      '',
    ].join('\n');
    try {
      writeFileSync(appModulePath, appSource);
      await expect(
        viteBuild({
          build: {
            emptyOutDir: true,
            outDir,
            rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.mjs' } },
            ssr: true,
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            {
              buildStart() {
                this.emitFile({
                  fileName: 'payload.mjs',
                  source: "globalThis.__KOVO_ASSET_MODULE_COLLISION__ = 'EXECUTED';\n",
                  type: 'asset',
                });
              },
              name: 'emit-module-looking-asset',
            },
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'app.mjs', source: appSource }],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              'build-server',
              { allowNodeBuiltins: true },
            ),
          ],
          root,
          ssr: { noExternal: true },
        }),
      ).rejects.toThrow(/KV448.*module import.*bundle-owned non-chunk asset/u);
      expect(() => readFileSync(join(outDir, 'entry.mjs'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-bare-bundle-key-artifact-closure
  it('rejects a retained bare package specifier that collides with a bundle file name', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-bare-bundle-key-')));
    const appModulePath = join(root, 'app.mjs');
    const packageRoot = join(root, 'node_modules', 'entry.mjs');
    const outDir = join(root, 'dist');
    const source =
      "export async function run() { return import(/* @vite-ignore */ 'entry.mjs'); }\n";
    try {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          exports: { '.': './index.mjs' },
          name: 'entry.mjs',
          type: 'module',
          version: '1.0.0',
        }),
      );
      writeFileSync(
        join(packageRoot, 'index.mjs'),
        "globalThis.__KOVO_BARE_BUNDLE_KEY__ = 'EXECUTED'; export const value = 'raw';\n",
      );
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('entry.mjs', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['app.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: '*' }],
                rootKinds: ['route'],
                sites: ['app.mjs:1:38'],
                specifier: 'entry.mjs',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'entry-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };

      await expect(
        viteBuild({
          build: {
            emptyOutDir: true,
            outDir,
            rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.mjs' } },
            ssr: true,
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'app.mjs', source }],
              exactManifest,
              'build-server',
              { allowNodeBuiltins: true },
            ),
          ],
          root,
          ssr: { noExternal: true },
        }),
      ).rejects.toThrow(/KV448.*entry\.mjs.*escaped the supported build-server artifact/u);
      expect(() => readFileSync(join(outDir, 'entry.mjs'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-transitive-bundle-closure
  it('rejects uncensused transitive packages even when a supported SSR artifact bundles them', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-dependency-transitive-loader-'));
    const appModulePath = join(root, 'app.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    const helperRoot = join(root, 'node_modules', 'helper-parser');
    const outDir = join(root, 'dist');
    const source = "import { parse } from 'safe-parser'; export const value = parse('safe');\n";
    try {
      for (const [directory, packageName] of [
        [packageRoot, 'safe-parser'],
        [helperRoot, 'helper-parser'],
      ] as const) {
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          join(directory, 'package.json'),
          JSON.stringify({
            ...(packageName === 'safe-parser'
              ? { dependencies: { 'helper-parser': '1.0.0' } }
              : {}),
            exports: { '.': './index.js' },
            name: packageName,
            type: 'module',
            version: packageName === 'safe-parser' ? '1.2.3' : '1.0.0',
          }),
        );
      }
      writeFileSync(
        join(packageRoot, 'index.js'),
        "import { helper } from 'helper-parser'; export const parse = value => helper(value);\n",
      );
      writeFileSync(join(helperRoot, 'index.js'), 'export const helper = value => value;\n');
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['app.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                rootKinds: ['route'],
                sites: ['app.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };
      const plugin = () =>
        dependencyCapabilityLoaderVitePlugin(
          appModulePath,
          [{ fileName: 'app.mjs', source }],
          exactManifest,
          'build-server',
        );
      const build = (noExternal: true | readonly string[]) =>
        viteBuild({
          build: {
            emptyOutDir: true,
            outDir,
            rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.mjs' } },
            ssr: true,
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [plugin()],
          root,
          ssr: { noExternal },
        });

      for (const noExternal of [['safe-parser'] as const, true] as const) {
        await expect(build(noExternal)).rejects.toThrow(
          /KV448.*uncensused transitive dependency helper-parser imported by reviewed package safe-parser/u,
        );
      }
      expect(() => readFileSync(join(outDir, 'entry.mjs'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-direct-export-package-boundary
  it.each(['intervening manifest', 'symlinked nested node_modules'] as const)(
    'rejects a direct reviewed export crossing a %s package boundary',
    async (kind) => {
      const root = realpathSync(
        mkdtempSync(join(tmpdir(), 'kovo-dependency-direct-nested-export-')),
      );
      const appModulePath = join(root, 'app.mjs');
      const packageRoot = join(root, 'node_modules', 'safe-parser');
      const nestedRoot =
        kind === 'intervening manifest'
          ? join(packageRoot, 'nested')
          : join(packageRoot, 'node_modules', 'helper-parser');
      const exportTarget = kind === 'intervening manifest' ? './nested/index.mjs' : './link.mjs';
      const outDir = join(root, 'dist');
      const source = "import { parse } from 'safe-parser'; export const value = parse('safe');\n";
      try {
        mkdirSync(nestedRoot, { recursive: true });
        writeFileSync(
          join(packageRoot, 'package.json'),
          JSON.stringify({
            exports: { '.': exportTarget },
            name: 'safe-parser',
            type: 'module',
            version: '1.2.3',
          }),
        );
        if (kind === 'intervening manifest') {
          writeFileSync(
            join(nestedRoot, 'package.json'),
            JSON.stringify({ name: 'helper-parser', type: 'module', version: '9.9.9' }),
          );
        }
        const nestedEntry = join(nestedRoot, 'index.mjs');
        writeFileSync(
          nestedEntry,
          "globalThis.__KOVO_DIRECT_NESTED_EXPORT__ = 'EXECUTED'; export const parse = value => value;\n",
        );
        if (kind === 'symlinked nested node_modules') {
          symlinkSync(nestedEntry, join(packageRoot, 'link.mjs'), 'file');
        }
        writeFileSync(appModulePath, source);
        const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
        const exactManifest: AppDependencyCapabilityManifest = {
          dependencies: [
            {
              entries: [
                {
                  conditions: installed.conditions,
                  importers: ['app.mjs'],
                  imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                  rootKinds: ['route'],
                  sites: ['app.mjs:1:1'],
                  specifier: 'safe-parser',
                },
              ],
              manifestFingerprint: installed.manifestFingerprint,
              packageName: installed.packageName,
              packageVersion: installed.packageVersion,
              summaryVersion: 'safe-parser-review/1',
              verdict: 'open',
            },
          ],
          schema: 'kovo-app-dependency-capabilities/v1',
        };

        await expect(
          viteBuild({
            build: {
              emptyOutDir: true,
              outDir,
              rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.mjs' } },
              ssr: true,
            },
            configFile: false,
            logLevel: 'silent',
            plugins: [
              dependencyCapabilityLoaderVitePlugin(
                appModulePath,
                [{ fileName: 'app.mjs', source }],
                exactManifest,
                'build-server',
                { allowNodeBuiltins: true },
              ),
            ],
            root,
            ssr: { noExternal: true },
          }),
        ).rejects.toThrow(/KV448.*safe-parser resolved outside its exact package export target/u);
        expect(() => readFileSync(join(outDir, 'entry.mjs'), 'utf8')).toThrow();
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
  );

  // @kovo-security-certifies C13 dependency-transitive-ssr-pre-evaluation
  it('rejects an uncensused transitive before supported SSR app evaluation', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-transitive-ssr-')));
    const appModulePath = join(root, 'app.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    const helperRoot = join(root, 'node_modules', 'helper-parser');
    const executedPath = join(root, 'helper-executed');
    const source = "import { parse } from 'safe-parser'; export const value = parse('safe');\n";
    let server: Awaited<ReturnType<typeof createViteServer>> | undefined;
    try {
      for (const [directory, packageName] of [
        [packageRoot, 'safe-parser'],
        [helperRoot, 'helper-parser'],
      ] as const) {
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          join(directory, 'package.json'),
          JSON.stringify({
            ...(packageName === 'safe-parser'
              ? { dependencies: { 'helper-parser': '1.0.0' } }
              : {}),
            exports: { '.': './index.js' },
            name: packageName,
            type: 'module',
            version: packageName === 'safe-parser' ? '1.2.3' : '1.0.0',
          }),
        );
      }
      writeFileSync(
        join(packageRoot, 'index.js'),
        "import { helper } from 'helper-parser'; export const parse = value => helper(value);\n",
      );
      writeFileSync(
        join(helperRoot, 'index.js'),
        `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(
          executedPath,
        )}, 'executed'); export const helper = value => value;\n`,
      );
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['app.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                rootKinds: ['route'],
                sites: ['app.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };
      server = await createViteServer({
        appType: 'custom',
        configFile: false,
        logLevel: 'silent',
        plugins: [
          dependencyCapabilityLoaderVitePlugin(
            appModulePath,
            [{ fileName: 'app.mjs', source }],
            exactManifest,
            'build-app',
          ),
        ],
        root,
        server: { hmr: false },
        ssr: { noExternal: true },
      });

      await expect(server.ssrLoadModule('/app.mjs')).rejects.toThrow(
        /KV448.*uncensused transitive dependency helper-parser imported by reviewed package safe-parser/u,
      );
      expect(() => readFileSync(executedPath, 'utf8')).toThrow();
    } finally {
      await server?.close();
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-exact-reviewed-subgraph
  it('does not confuse a framework-owned package export with the app-admitted package subgraph', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-shared-root-')));
    const appModulePath = join(root, 'app.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    const helperRoot = join(root, 'node_modules', 'framework-driver');
    const driverPath = join(packageRoot, 'framework-driver.js');
    const source = "import { parse } from 'safe-parser'; export const value = parse('safe');\n";
    let server: Awaited<ReturnType<typeof createViteServer>> | undefined;
    try {
      mkdirSync(packageRoot, { recursive: true });
      mkdirSync(helperRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          dependencies: { 'framework-driver': '1.0.0' },
          exports: { '.': './index.js', './framework-driver': './framework-driver.js' },
          name: 'safe-parser',
          type: 'module',
          version: '1.2.3',
        }),
      );
      writeFileSync(join(packageRoot, 'index.js'), 'export const parse = value => value;\n');
      writeFileSync(
        driverPath,
        "import { drive } from 'framework-driver'; export const driven = drive('framework');\n",
      );
      writeFileSync(
        join(helperRoot, 'package.json'),
        JSON.stringify({
          exports: { '.': './index.js' },
          name: 'framework-driver',
          type: 'module',
          version: '1.0.0',
        }),
      );
      writeFileSync(join(helperRoot, 'index.js'), 'export const drive = value => value;\n');
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['app.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                rootKinds: ['route'],
                sites: ['app.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };
      server = await createViteServer({
        appType: 'custom',
        configFile: false,
        logLevel: 'silent',
        plugins: [
          dependencyCapabilityLoaderVitePlugin(
            appModulePath,
            [{ fileName: 'app.mjs', source }],
            exactManifest,
            'build-app',
          ),
        ],
        root,
        server: { hmr: false },
        ssr: { external: ['framework-driver'], noExternal: true },
      });

      await expect(server.ssrLoadModule('/app.mjs')).resolves.toMatchObject({ value: 'safe' });
      await expect(server.ssrLoadModule(`/@fs${driverPath}`)).resolves.toMatchObject({
        driven: 'framework',
      });
    } finally {
      await server?.close();
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-cjs-loader-alias-pre-evaluation
  it('rejects a reviewed CJS loader alias whose resolved child would evade Vite resolution', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-cjs-alias-')));
    const appModulePath = join(root, 'app.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    const helperRoot = join(root, 'node_modules', 'helper-parser');
    const outDir = join(root, 'dist');
    const source = "import { parse } from 'safe-parser'; export const value = parse('safe');\n";
    try {
      for (const [directory, packageName] of [
        [packageRoot, 'safe-parser'],
        [helperRoot, 'helper-parser'],
      ] as const) {
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          join(directory, 'package.json'),
          JSON.stringify({
            ...(packageName === 'safe-parser'
              ? { dependencies: { 'helper-parser': '1.0.0' } }
              : {}),
            exports: { '.': './index.cjs' },
            name: packageName,
            type: 'commonjs',
            version: packageName === 'safe-parser' ? '1.2.3' : '1.0.0',
          }),
        );
      }
      writeFileSync(
        join(packageRoot, 'index.cjs'),
        [
          'const load = require;',
          "const helperPath = load.resolve('helper-parser');",
          'load(helperPath);',
          'exports.parse = value => value;',
          '',
        ].join('\n'),
      );
      writeFileSync(
        join(helperRoot, 'index.cjs'),
        "globalThis.__KOVO_UNCENSUSED_REQUIRE_ALIAS__ = 'EXECUTED';\n",
      );
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['app.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                rootKinds: ['route'],
                sites: ['app.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };

      await expect(
        viteBuild({
          build: {
            emptyOutDir: true,
            outDir,
            rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.mjs' } },
            ssr: true,
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'app.mjs', source }],
              exactManifest,
              'build-server',
              { allowNodeBuiltins: true },
            ),
          ],
          root,
          ssr: { noExternal: true },
        }),
      ).rejects.toThrow(/KV448.*reviewed package safe-parser aliases CommonJS loader authority/u);
      expect(() => readFileSync(join(outDir, 'entry.mjs'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-relative-alias-retarget-closure
  it('rejects a Vite alias that retargets a reviewed package child edge', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-relative-alias-')));
    const appModulePath = join(root, 'app.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    const outDir = join(root, 'dist');
    const source = "import { parse } from 'safe-parser'; export const value = parse('safe');\n";
    try {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          exports: { '.': './index.mjs' },
          name: 'safe-parser',
          type: 'module',
          version: '1.2.3',
        }),
      );
      writeFileSync(
        join(packageRoot, 'index.mjs'),
        "import { helper } from './safe-helper.js'; export const parse = helper;\n",
      );
      writeFileSync(join(packageRoot, 'safe-helper.js'), 'export const helper = value => value;\n');
      writeFileSync(
        join(packageRoot, 'raw-helper.js'),
        "globalThis.__KOVO_RELATIVE_ALIAS_RETARGET__ = 'EXECUTED'; export const helper = value => value;\n",
      );
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['app.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                rootKinds: ['route'],
                sites: ['app.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };

      await expect(
        viteBuild({
          build: {
            emptyOutDir: true,
            outDir,
            rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.mjs' } },
            ssr: true,
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'app.mjs', source }],
              exactManifest,
              'build-server',
              { allowNodeBuiltins: true },
            ),
          ],
          resolve: {
            alias: {
              './safe-helper.js': join(packageRoot, 'raw-helper.js'),
            },
          },
          root,
          ssr: { noExternal: true },
        }),
      ).rejects.toThrow(/KV448.*Vite alias.*reviewed package safe-parser child edge/u);
      expect(() => readFileSync(join(outDir, 'entry.mjs'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-relative-extension-retarget-closure
  it('rejects custom resolve extensions that retarget a reviewed package child edge', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-extension-retarget-')));
    const appModulePath = join(root, 'app.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    const outDir = join(root, 'dist');
    const source = "import { parse } from 'safe-parser'; export const value = parse('safe');\n";
    try {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          exports: { '.': './index.mjs' },
          name: 'safe-parser',
          type: 'module',
          version: '1.2.3',
        }),
      );
      writeFileSync(
        join(packageRoot, 'index.mjs'),
        "import { helper } from './helper'; export const parse = helper;\n",
      );
      writeFileSync(join(packageRoot, 'helper.js'), 'export const helper = value => value;\n');
      writeFileSync(
        join(packageRoot, 'helper.raw.js'),
        "globalThis.__KOVO_EXTENSION_RETARGET__ = 'EXECUTED'; export const helper = value => value;\n",
      );
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['app.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                rootKinds: ['route'],
                sites: ['app.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };

      await expect(
        viteBuild({
          build: {
            emptyOutDir: true,
            outDir,
            rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.mjs' } },
            ssr: true,
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'app.mjs', source }],
              exactManifest,
              'build-server',
              { allowNodeBuiltins: true },
            ),
          ],
          resolve: {
            extensions: ['.raw.js', '.js', '.mjs', '.mts', '.ts', '.jsx', '.tsx', '.json'],
          },
          root,
          ssr: { noExternal: true },
        }),
      ).rejects.toThrow(/KV448.*resolve extensions.*reviewed package child identity/u);
      expect(() => readFileSync(join(outDir, 'entry.mjs'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-reviewed-module-suffix-closure
  it.each([
    [
      'SVG script document',
      'payload.svg',
      "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>parent.postMessage('KOVO_STATIC_SVG_EXECUTED','*')</script></svg>\n",
      "import payloadUrl from './payload.svg'; export function start(){ const frame=document.createElement('iframe'); frame.src=payloadUrl; document.body.append(frame); }\n",
    ],
    [
      'CSS request polyglot',
      'style.css',
      "a\n{background:url('/__KOVO_CSS_POLYGLOT_EXECUTED__')}\n",
      "import './style.css'; export function start(){ document.querySelector('a').style.display='block'; }\n",
    ],
  ] as const)(
    'rejects a reviewed package %s before Vite assigns non-module semantics',
    async (_label, resourceName, resourceSource, packageSource) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-resource-child-')));
      const appModulePath = join(root, 'client.mjs');
      const packageRoot = join(root, 'node_modules', 'safe-parser');
      const outDir = join(root, 'dist');
      const source = "import { start } from 'safe-parser'; start();\n";
      try {
        mkdirSync(packageRoot, { recursive: true });
        writeFileSync(
          join(packageRoot, 'package.json'),
          JSON.stringify({
            exports: { '.': './index.mjs' },
            name: 'safe-parser',
            type: 'module',
            version: '1.2.3',
          }),
        );
        writeFileSync(join(packageRoot, 'index.mjs'), packageSource);
        writeFileSync(join(packageRoot, resourceName), resourceSource);
        writeFileSync(appModulePath, source);
        const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
        const exactManifest: AppDependencyCapabilityManifest = {
          dependencies: [
            {
              entries: [
                {
                  conditions: installed.conditions,
                  importers: ['client.mjs'],
                  imports: [{ capabilities: [], disposition: 'pure', name: 'start' }],
                  rootKinds: ['route'],
                  sites: ['client.mjs:1:1'],
                  specifier: 'safe-parser',
                },
              ],
              manifestFingerprint: installed.manifestFingerprint,
              packageName: installed.packageName,
              packageVersion: installed.packageVersion,
              summaryVersion: 'safe-parser-review/1',
              verdict: 'open',
            },
          ],
          schema: 'kovo-app-dependency-capabilities/v1',
        };

        await expect(
          viteBuild({
            build: {
              assetsInlineLimit: 0,
              emptyOutDir: true,
              outDir,
              rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.js' } },
            },
            configFile: false,
            logLevel: 'silent',
            plugins: [
              dependencyCapabilityLoaderVitePlugin(
                appModulePath,
                [{ fileName: 'client.mjs', source }],
                exactManifest,
                'build-client',
              ),
            ],
            root,
          }),
        ).rejects.toThrow(
          new RegExp(
            `KV448.*reviewed package safe-parser.*${resourceName}.*closed module suffix`,
            'u',
          ),
        );
        expect(() => readFileSync(join(outDir, 'entry.js'), 'utf8')).toThrow();
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
  );

  // @kovo-security-certifies C13 dependency-reviewed-module-suffix-symlink-closure
  it('rejects a preserve-symlinks resource alias before Vite assigns its lexical suffix semantics', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-resource-symlink-')));
    const appModulePath = join(root, 'client.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    const outDir = join(root, 'dist');
    const source = "import { start } from 'safe-parser'; start();\n";
    try {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          exports: { '.': './index.mjs' },
          name: 'safe-parser',
          type: 'module',
          version: '1.2.3',
        }),
      );
      writeFileSync(
        join(packageRoot, 'index.mjs'),
        "import payloadUrl from './payload.svg'; export function start(){ const frame=document.createElement('iframe'); frame.src=payloadUrl; document.body.append(frame); }\n",
      );
      writeFileSync(
        join(packageRoot, 'payload.js'),
        "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>parent.postMessage('SYMLINK_SUFFIX','*')</script></svg>\n",
      );
      symlinkSync('payload.js', join(packageRoot, 'payload.svg'));
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['client.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'start' }],
                rootKinds: ['route'],
                sites: ['client.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };

      await expect(
        viteBuild({
          build: {
            assetsInlineLimit: 0,
            emptyOutDir: true,
            outDir,
            rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.js' } },
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'client.mjs', source }],
              exactManifest,
              'build-client',
            ),
          ],
          resolve: { preserveSymlinks: true },
          root,
        }),
      ).rejects.toThrow(
        /KV448.*reviewed package safe-parser.*lexical module path.*payload\.svg.*closed module suffix/u,
      );
      expect(() => readFileSync(join(outDir, 'entry.js'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-direct-export-module-suffix
  it('rejects a direct reviewed export whose target has non-module browser semantics', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-resource-export-')));
    const appModulePath = join(root, 'client.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    const outDir = join(root, 'dist');
    const source =
      "import payloadUrl from 'safe-parser'; globalThis.__KOVO_PAYLOAD__ = payloadUrl;\n";
    try {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          exports: { '.': './payload.svg' },
          name: 'safe-parser',
          type: 'module',
          version: '1.2.3',
        }),
      );
      writeFileSync(
        join(packageRoot, 'payload.svg'),
        "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>parent.postMessage('EXECUTED','*')</script></svg>\n",
      );
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['client.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'default' }],
                rootKinds: ['route'],
                sites: ['client.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };

      await expect(
        viteBuild({
          build: {
            assetsInlineLimit: 0,
            emptyOutDir: true,
            outDir,
            rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.js' } },
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'client.mjs', source }],
              exactManifest,
              'build-client',
            ),
          ],
          root,
        }),
      ).rejects.toThrow(/KV448.*safe-parser.*direct export.*payload\.svg.*closed module suffix/u);
      expect(() => readFileSync(join(outDir, 'entry.js'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-reviewed-special-query-closure
  it.each(['direct', 'import.meta.glob injected'] as const)(
    'rejects a reviewed package %s worker query before Vite creates an unreviewed subgraph',
    async (kind) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-worker-query-')));
      const appModulePath = join(root, 'client.mjs');
      const packageRoot = join(root, 'node_modules', 'safe-parser');
      const helperRoot = join(root, 'node_modules', 'helper-parser');
      const outDir = join(root, 'dist');
      const source = "import { start } from 'safe-parser'; start();\n";
      try {
        for (const [directory, packageName] of [
          [packageRoot, 'safe-parser'],
          [helperRoot, 'helper-parser'],
        ] as const) {
          mkdirSync(directory, { recursive: true });
          writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({
              exports: { '.': './index.mjs' },
              name: packageName,
              type: 'module',
              version: packageName === 'safe-parser' ? '1.2.3' : '1.0.0',
            }),
          );
        }
        writeFileSync(
          join(packageRoot, 'index.mjs'),
          kind === 'direct'
            ? "import WorkerEntry from './worker.mjs?worker'; export const start = () => new WorkerEntry();\n"
            : "const workers = import.meta.glob('./worker.mjs', { eager: true, import: 'default', query: '?worker&url' }); export const start = () => workers['./worker.mjs'];\n",
        );
        writeFileSync(
          join(packageRoot, 'worker.mjs'),
          "import 'helper-parser'; globalThis.__KOVO_WORKER_QUERY__ = 'EXECUTED';\n",
        );
        writeFileSync(
          join(helperRoot, 'index.mjs'),
          "globalThis.__KOVO_WORKER_QUERY_HELPER__ = 'EXECUTED';\n",
        );
        writeFileSync(appModulePath, source);
        const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
        const exactManifest: AppDependencyCapabilityManifest = {
          dependencies: [
            {
              entries: [
                {
                  conditions: installed.conditions,
                  importers: ['client.mjs'],
                  imports: [{ capabilities: [], disposition: 'pure', name: 'start' }],
                  rootKinds: ['route'],
                  sites: ['client.mjs:1:1'],
                  specifier: 'safe-parser',
                },
              ],
              manifestFingerprint: installed.manifestFingerprint,
              packageName: installed.packageName,
              packageVersion: installed.packageVersion,
              summaryVersion: 'safe-parser-review/1',
              verdict: 'open',
            },
          ],
          schema: 'kovo-app-dependency-capabilities/v1',
        };

        await expect(
          viteBuild({
            build: {
              emptyOutDir: true,
              outDir,
              rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.js' } },
            },
            configFile: false,
            logLevel: 'silent',
            plugins: [
              dependencyCapabilityLoaderVitePlugin(
                appModulePath,
                [{ fileName: 'client.mjs', source }],
                exactManifest,
                'build-client',
              ),
            ],
            root,
          }),
        ).rejects.toThrow(/KV448.*reviewed package safe-parser child edge.*query or fragment/u);
        expect(() => readFileSync(join(outDir, 'entry.js'), 'utf8')).toThrow();
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
  );

  // @kovo-security-certifies C13 dependency-reviewed-worker-constructor-closure
  it.each([
    ['Worker', 'Worker', '', "new URL('./worker.mjs', import.meta.url)"],
    ['SharedWorker', 'SharedWorker', '', "new URL('./worker.mjs', import.meta.url)"],
    ['Worker URL string', 'Worker', '', "'/worker.mjs'"],
    ['Worker alias', 'W', 'const W = Worker; ', "new URL('./worker.mjs', import.meta.url)"],
    ['Worker alias URL string', 'W', 'const W = Worker; ', "'/worker.mjs'"],
    ['global Worker member', 'globalThis.Worker', '', "new URL('./worker.mjs', import.meta.url)"],
    ['computed global Worker member', "globalThis['Worker']", '', "'/worker.mjs'"],
    ['computed global Worker alias', 'W', "const W = globalThis['Wor' + 'ker']; ", "'/worker.mjs'"],
    [
      'destructured global Worker alias',
      'W',
      'const { Worker: W } = globalThis; ',
      "'/worker.mjs'",
    ],
    [
      'SharedWorker alias',
      'W',
      'const W = SharedWorker; ',
      "new URL('./worker.mjs', import.meta.url)",
    ],
  ] as const)(
    'rejects a reviewed package %s constructor before Vite creates an unreviewed subgraph',
    async (label, constructorExpression, prefix, argumentExpression) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-worker-constructor-')));
      const appModulePath = join(root, 'client.mjs');
      const packageRoot = join(root, 'node_modules', 'safe-parser');
      const helperRoot = join(root, 'node_modules', 'helper-parser');
      const outDir = join(root, 'dist');
      const source = "import { start } from 'safe-parser'; start();\n";
      try {
        for (const [directory, packageName] of [
          [packageRoot, 'safe-parser'],
          [helperRoot, 'helper-parser'],
        ] as const) {
          mkdirSync(directory, { recursive: true });
          writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({
              exports: { '.': './index.mjs' },
              name: packageName,
              type: 'module',
              version: packageName === 'safe-parser' ? '1.2.3' : '1.0.0',
            }),
          );
        }
        writeFileSync(
          join(packageRoot, 'index.mjs'),
          `${prefix}export const start = () => new ${constructorExpression}(${argumentExpression}, { type: 'module' });\n`,
        );
        writeFileSync(
          join(packageRoot, 'worker.mjs'),
          "import 'helper-parser'; globalThis.__KOVO_WORKER_CONSTRUCTOR__ = 'EXECUTED';\n",
        );
        writeFileSync(
          join(helperRoot, 'index.mjs'),
          "globalThis.__KOVO_WORKER_CONSTRUCTOR_HELPER__ = 'EXECUTED';\n",
        );
        writeFileSync(appModulePath, source);
        const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
        const exactManifest: AppDependencyCapabilityManifest = {
          dependencies: [
            {
              entries: [
                {
                  conditions: installed.conditions,
                  importers: ['client.mjs'],
                  imports: [{ capabilities: [], disposition: 'pure', name: 'start' }],
                  rootKinds: ['route'],
                  sites: ['client.mjs:1:1'],
                  specifier: 'safe-parser',
                },
              ],
              manifestFingerprint: installed.manifestFingerprint,
              packageName: installed.packageName,
              packageVersion: installed.packageVersion,
              summaryVersion: 'safe-parser-review/1',
              verdict: 'open',
            },
          ],
          schema: 'kovo-app-dependency-capabilities/v1',
        };

        await expect(
          viteBuild({
            build: {
              emptyOutDir: true,
              outDir,
              rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.js' } },
            },
            configFile: false,
            logLevel: 'silent',
            plugins: [
              dependencyCapabilityLoaderVitePlugin(
                appModulePath,
                [{ fileName: 'client.mjs', source }],
                exactManifest,
                'build-client',
              ),
            ],
            root,
          }),
        ).rejects.toThrow(
          new RegExp(
            `KV448.*supported build-client artifact.*retains a ${label.includes('Shared') ? 'SharedWorker' : 'Worker'} constructor`,
            'u',
          ),
        );
        expect(() => readFileSync(join(outDir, 'entry.js'), 'utf8')).toThrow();
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
  );

  // @kovo-security-certifies C13 dependency-reviewed-public-worker-closure
  it.each([
    ['computed Worker', "new globalThis['Worker']('/worker.mjs', { type: 'module' })", 'Worker'],
    [
      'nested-global Worker',
      "new globalThis.window.Worker('/worker.mjs', { type: 'module' })",
      'Worker',
    ],
    [
      'default-view SharedWorker',
      "new document.defaultView.SharedWorker('/worker.mjs', { type: 'module' })",
      'SharedWorker',
    ],
    [
      'reflected Worker',
      "new (Reflect.get(globalThis, 'Worker'))('/worker.mjs', { type: 'module' })",
      'Worker',
    ],
    [
      'finite-template Worker',
      "new globalThis[`Wor${'ker'}`]('/worker.mjs', { type: 'module' })",
      'Worker',
    ],
    [
      'function-returned global Worker',
      "new ((() => globalThis)().Worker)('/worker.mjs', { type: 'module' })",
      'Worker',
    ],
    [
      'opaque identity-callback Worker',
      "(() => { const id = value => value; return new (id(globalThis).Worker)('/worker.mjs', { type: 'module' }); })()",
      'Worker',
    ],
    [
      'opaque named-helper Worker',
      "(() => { const get = () => globalThis; return new (get().Worker)('/worker.mjs', { type: 'module' }); })()",
      'Worker',
    ],
    [
      'array-aliased global Worker',
      "new ([globalThis][0].Worker)('/worker.mjs', { type: 'module' })",
      'Worker',
    ],
    [
      'descriptor Worker',
      "new (Object.getOwnPropertyDescriptor(globalThis, 'Worker').value)('/worker.mjs')",
      'opaque',
    ],
    [
      'reflected descriptor Worker',
      "new (Reflect.getOwnPropertyDescriptor(globalThis, 'Worker').value)('/worker.mjs')",
      'opaque',
    ],
    [
      'Reflect.apply-transferred Worker',
      "new (Reflect.apply(Reflect.get, Reflect, [globalThis, 'Worker']))('/worker.mjs')",
      'opaque',
    ],
    [
      'intermediate identity Worker',
      "(() => { const id = x => x; const W = id(globalThis).Worker; return new W('/worker.mjs'); })()",
      'Worker',
    ],
    ['Function dynamic Worker', "Function('return Worker')()", 'opaque'],
    [
      'constructor-chain dynamic Worker',
      "globalThis.constructor.constructor('return Worker')()",
      'opaque',
    ],
    [
      'closed-browser-value constructor-chain dynamic Worker',
      closedBrowserValueDynamicWorkerExpression('/worker.mjs'),
      'opaque',
    ],
    ...dynamicCodeAdapterCarrierExpressions('/worker.mjs').map(
      ([label, expression]) => [label, expression, 'opaque'] as const,
    ),
    ...timerAdapterCarrierExpressions('/worker.mjs').map(
      ([label, expression]) => [label, expression, 'opaque'] as const,
    ),
    ['indirect eval Worker', "(0, eval)('Worker')", 'opaque'],
    [
      'callback-parameter Worker',
      "((g) => { const W = g.Worker; return new W('/worker.mjs'); })(globalThis)",
      'Worker',
    ],
    ['child-frame Worker', "new frames[0].Worker('/worker.mjs')", 'Worker'],
    ['proxied-global Worker', "new (new Proxy(globalThis, {}).Worker)('/worker.mjs')", 'Worker'],
    [
      'member-written Worker',
      "(() => { const box = {}; box.global = globalThis; const W = box.global.Worker; return new W('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'helper-written Worker',
      "(() => { function install(box, platform) { box.platform = platform; } const box = {}; install(box, globalThis); const W = box.platform.Worker; return new W('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'nested-helper-written Worker',
      "(() => { function write(box, platform) { box.platform = platform; } function install(box, platform) { write(box, platform); } const box = {}; install(box, globalThis); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'closure-helper-written Worker',
      "(() => { function install(box, platform) { function write() { box.platform = platform; } write(); } const box = {}; install(box, globalThis); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'Object.assign helper-written Worker',
      "(() => { function install(box, platform) { Object.assign(box, { platform }); } const box = {}; install(box, globalThis); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'Reflect.set helper-written Worker',
      "(() => { function install(box, platform) { Reflect.set(box, 'platform', platform); } const box = {}; install(box, globalThis); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'defineProperty helper-written Worker',
      "(() => { function install(box, platform) { Object.defineProperty(box, 'platform', { value: platform }); } const box = {}; install(box, globalThis); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'accessor-triggered Worker',
      "(() => { const box = { get trigger() { this.platform = globalThis; return 1; } }; function inspect(value) { Reflect.get(value, 'trigger'); } inspect(box); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'curried-helper-written Worker',
      "(() => { function prepare(box) { return platform => { box.platform = platform; }; } const box = {}; const install = prepare(box); install(globalThis); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'nested-returned-helper-written Worker',
      "(() => { function prepare(box) { return () => platform => { box.platform = platform; }; } const box = {}; prepare(box)()(globalThis); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'projected-capture-helper-written Worker',
      "(() => { function prepare(box) { const state = { target: box }; const write = platform => { state.target.platform = platform; }; const api = { write }; return api.write; } const box = {}; prepare(box)(globalThis); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'returned-class-method-written Worker',
      "(() => { function prepare(box) { return class Installer { install(platform) { box.platform = platform; } }; } const box = {}; const Installer = prepare(box); new Installer().install(globalThis); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'constructor-written Worker',
      "(() => { function Installer(box) { box.platform = globalThis; } const box = {}; new Installer(box); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'setter-argument-written Worker',
      "(() => { const box = {}; const holder = { set target(value) { value.platform = globalThis; } }; holder.target = box; return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'setter-captured-target-written Worker',
      "(() => { const box = {}; const holder = { set platform(value) { box.platform = value; } }; holder.platform = globalThis; return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'class-constructor-written Worker',
      "(() => { class Installer { constructor(box) { box.platform = globalThis; } } const box = {}; new Installer(box); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'projected-constructor-written Worker',
      "(() => { function Installer(box) { box.platform = globalThis; } const registry = { Installer }; const C = registry.Installer; const box = {}; new C(box); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'constructor-returned-setter-written Worker',
      "(() => { function Holder() { return { set target(value) { value.platform = globalThis; } }; } const box = {}; const holder = new Holder(); holder.target = box; return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'dynamic-constructor-written Worker',
      "(() => { const Installer = getInstaller(); const box = {}; new Installer(box); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'Reflect.construct-written Worker',
      "(() => { function Installer(box) { box.platform = globalThis; } const box = {}; Reflect.construct(Installer, [box]); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'projected-computed-setter-written Worker',
      "(() => { const box = {}; const registry = { holder: { set target(value) { value.platform = globalThis; } } }; const holder = registry.holder; holder['tar' + 'get'] = box; return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'class-instance-setter-written Worker',
      "(() => { class Holder { set target(value) { value.platform = globalThis; } } const box = {}; const projected = { holder: new Holder() }.holder; projected.target = box; return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'static-class-setter-written Worker',
      "(() => { class Holder { static set target(value) { value.platform = globalThis; } } const box = {}; Holder.target = box; return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'prototype-setter-written Worker',
      "(() => { function Holder() {} Holder.prototype = { set target(value) { value.platform = globalThis; } }; const box = {}; const holder = new Holder(); holder.target = box; return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'defineProperty-setter-written Worker',
      "(() => { const holder = {}; Object.defineProperty(holder, 'target', { set(value) { value.platform = globalThis; } }); const box = {}; holder.target = box; return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'defineProperty-prototype-setter-written Worker',
      "(() => { function Holder() {} Object.defineProperty(Holder.prototype, 'target', { set(value) { value.platform = globalThis; } }); const box = {}; const holder = new Holder(); holder.target = box; return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'Reflect.set-setter-written Worker',
      "(() => { const holder = { set target(value) { value.platform = globalThis; } }; const box = {}; Reflect.set(holder, 'target', box); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'Object.assign-setter-written Worker',
      "(() => { const holder = { set target(value) { value.platform = globalThis; } }; const box = {}; Object.assign(holder, { target: box }); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'dynamic-key-setter-written Worker',
      "(() => { const holder = { set target(value) { value.platform = globalThis; } }; const box = {}; holder[getSetterKey()] = box; return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-Proxy-set-trap-written Worker',
      "(() => { const box = {}; const holder = new Proxy({}, { set(_target, _key, value) { value.platform = globalThis; return true; } }); holder.target = box; return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-Proxy-get-trap-returned Worker',
      "(() => { const holder = new Proxy({}, { get(_target, key) { return key === 'platform' ? globalThis : undefined; } }); return new holder.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-legacy-defineSetter-written Worker',
      "(() => { const holder = {}; holder.__defineSetter__('target', value => { value.platform = globalThis; }); const box = {}; holder.target = box; return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-legacy-defineGetter-returned Worker',
      "(() => { const holder = {}; holder.__defineGetter__('platform', () => globalThis); return new holder.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-method-this-written Worker',
      "(() => { const holder = { install() { this.platform = globalThis; } }; holder.install(); return new holder.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-call-invoked-helper-written Worker',
      "(() => { function install(box) { box.platform = globalThis; } const box = {}; install.call(null, box); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-apply-invoked-helper-written Worker',
      "(() => { function install(box) { box.platform = globalThis; } const box = {}; install.apply(null, [box]); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-bind-invoked-helper-written Worker',
      "(() => { function install(box) { box.platform = globalThis; } const box = {}; install.bind(null, box)(); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-object-destructuring-target-written Worker',
      "(() => { const box = {}; ({ value: box.platform } = { value: globalThis }); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-array-destructuring-target-written Worker',
      "(() => { const box = {}; [box.platform] = [globalThis]; return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-destructuring-setter-written Worker',
      "(() => { const holder = { set target(value) { value.platform = globalThis; } }; const box = {}; ({ value: holder.target } = { value: box }); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-constructor-arguments-written Worker',
      "(() => { function Installer() { arguments[0].platform = globalThis; } const box = {}; new Installer(box); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-setter-arguments-written Worker',
      "(() => { const holder = { set target(_value) { arguments[0].platform = globalThis; } }; const box = {}; holder.target = box; return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-static-setter-this-written Worker',
      "(() => { class Holder { static set target(value) { this.platform = value; } } Holder.target = globalThis; return new Holder.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-deep-structured-argument-written Worker',
      deepStructuredArgumentCarrierExpression('/worker.mjs'),
      'Worker',
    ],
    [
      'audit-object-rest-target-written Worker',
      "(() => { const box = {}; const source = { platform: globalThis }; ({ ...box.value } = source); return new box.value.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-array-rest-target-written Worker',
      "(() => { const box = {}; const source = [globalThis]; [...box.value] = source; return new box.value[0].Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-arrow-captured-arguments-written Worker',
      "(() => { function prepare() { return () => { arguments[0].platform = globalThis; }; } const box = {}; prepare(box)(); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-for-of-member-target-written Worker',
      "(() => { const box = {}; for (box.platform of [globalThis]) { break; } return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-for-of-nested-target-written Worker',
      "(() => { const box = {}; for ({ value: box.platform } of [{ value: globalThis }]) { break; } return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-for-of-identifier-written Worker',
      "(() => { let platform = {}; for (platform of [globalThis]) { break; } return new platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-for-of-nested-identifier-written Worker',
      "(() => { let platform = {}; for ({ value: platform } of [{ value: globalThis }]) { break; } return new platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-for-await-member-target-written Worker',
      "(async () => { const box = {}; for await (box.platform of [globalThis]) { break; } return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-for-await-identifier-written Worker',
      "(async () => { let platform = {}; for await (platform of [globalThis]) { break; } return new platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-defineProperties-prototype-setter-written Worker',
      "(() => { function Holder() {} const prototype = Holder.prototype; Object.defineProperties(prototype, { target: { set(value) { value.platform = globalThis; } } }); const holder = new Holder(); const box = {}; holder.target = box; return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-Reflect-defineProperty-prototype-setter-written Worker',
      "(() => { function Holder() {} const holder = new Holder(); Reflect.defineProperty(holder, 'target', { set(value) { value.platform = globalThis; } }); const box = {}; holder.target = box; return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-setPrototypeOf-prototype-setter-written Worker',
      "(() => { function Holder() {} const prototype = Holder.prototype; Object.setPrototypeOf(prototype, { set target(value) { value.platform = globalThis; } }); const holder = new Holder(); const box = {}; holder.target = box; return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-static-getter-this-written Worker',
      "(() => { class Holder { static get trigger() { this.platform = globalThis; return 1; } } Holder.trigger; return new Holder.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-static-block-this-written Worker',
      "(() => { class Holder { static { this.platform = globalThis; } } return new Holder.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-constructor-receiver-written Worker',
      "(() => { function Holder() { this.platform = globalThis; } const holder = new Holder(); return new holder.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-Object-freeze-Proxy-trap-written Worker',
      "(() => { const box = {}; const proxy = new Proxy(box, { preventExtensions(target) { target.platform = globalThis; Reflect.preventExtensions(target); return true; } }); Object.freeze(proxy); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-default-parameter-written Worker',
      "(() => { function install(box, _unused = (box.platform = globalThis)) { return box; } const box = {}; const installed = install(box); return new installed.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-array-join-coercion-written Worker',
      "(() => { const box = { toString() { this.platform = globalThis; return ''; } }; [box].join(':'); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-array-callback-written Worker',
      "(() => { const box = {}; [box].forEach(value => { value.platform = globalThis; }); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-timer-extra-argument-written Worker',
      "(() => { function install(box) { box.platform = globalThis; } const box = {}; setTimeout(install, 0, box); return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'audit-tagged-template-argument-written Worker',
      "(() => { function install(_strings, box) { box.platform = globalThis; } const box = {}; install`${box}`; return new box.platform.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    ['depth-budget-helper-written Worker', depthBudgetCarrierExpression('/worker.mjs'), 'Worker'],
    [
      'recursive-budget-helper-written Worker',
      recursiveBudgetCarrierExpression('/worker.mjs'),
      'Worker',
    ],
    [
      'recursive-callable-budget Worker',
      recursiveCallableCarrierExpression('/worker.mjs'),
      'Worker',
    ],
    [
      'array-written Worker',
      "(() => { const box = []; box[0] = globalThis; const W = box[0].Worker; return new W('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'prototype-inherited Worker',
      "(() => { const holder = { __proto__: globalThis }; return new holder.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'descriptor-mutated Worker',
      "(() => { const holder = {}; Object.defineProperty(holder, 'Worker', Object.getOwnPropertyDescriptor(globalThis, 'Worker')); return new holder.Worker('/worker.mjs'); })()",
      'opaque',
    ],
    [
      'static-field Worker',
      "(() => { class Box { static G = globalThis } return new Box.G.Worker('/worker.mjs'); })()",
      'Worker',
    ],
    [
      'Worker subclass',
      "(() => { class ReviewedWorker extends Worker {} return new ReviewedWorker('/worker.mjs'); })()",
      'Worker',
    ],
  ] as const)(
    'rejects a reviewed package %s before a supported artifact can ship an unapproved public module',
    async (_label, expression, expectedConstructor) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-public-worker-')));
      const appModulePath = join(root, 'client.mjs');
      const packageRoot = join(root, 'node_modules', 'safe-parser');
      const publicRoot = join(root, 'public');
      const outDir = join(root, 'dist');
      const source = "import { start } from 'safe-parser'; start();\n";
      try {
        mkdirSync(packageRoot, { recursive: true });
        mkdirSync(publicRoot, { recursive: true });
        writeFileSync(
          join(packageRoot, 'package.json'),
          JSON.stringify({
            exports: { '.': './index.mjs' },
            name: 'safe-parser',
            type: 'module',
            version: '1.2.3',
          }),
        );
        writeFileSync(
          join(packageRoot, 'index.mjs'),
          `export const start = () => ${expression};\n`,
        );
        writeFileSync(
          join(publicRoot, 'worker.mjs'),
          "import 'data:text/javascript,globalThis.__KOVO_PUBLIC_WORKER__%3D%27EXECUTED%27';\n",
        );
        writeFileSync(appModulePath, source);
        const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
        const exactManifest: AppDependencyCapabilityManifest = {
          dependencies: [
            {
              entries: [
                {
                  conditions: installed.conditions,
                  importers: ['client.mjs'],
                  imports: [{ capabilities: [], disposition: 'pure', name: 'start' }],
                  rootKinds: ['route'],
                  sites: ['client.mjs:1:1'],
                  specifier: 'safe-parser',
                },
              ],
              manifestFingerprint: installed.manifestFingerprint,
              packageName: installed.packageName,
              packageVersion: installed.packageVersion,
              summaryVersion: 'safe-parser-review/1',
              verdict: 'open',
            },
          ],
          schema: 'kovo-app-dependency-capabilities/v1',
        };

        await expect(
          viteBuild({
            build: {
              emptyOutDir: true,
              outDir,
              rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.js' } },
            },
            configFile: false,
            logLevel: 'silent',
            plugins: [
              dependencyCapabilityLoaderVitePlugin(
                appModulePath,
                [{ fileName: 'client.mjs', source }],
                exactManifest,
                'build-client',
              ),
            ],
            root,
          }),
        ).rejects.toThrow(
          expectedConstructor === 'opaque'
            ? /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u
            : new RegExp(
                `KV448.*supported build-client artifact.*retains a ${expectedConstructor} constructor`,
                'u',
              ),
        );
        // Vite copies publicDir before generateBundle; the build still fails before an artifact can
        // be published, and this staged file proves the retained-artifact backstop saw a real graph.
        expect(readFileSync(join(outDir, 'worker.mjs'), 'utf8')).toContain(
          '__KOVO_PUBLIC_WORKER__',
        );
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
  );

  // @kovo-security-certifies C13 dependency-reviewed-executable-asset-closure
  it.each([
    ['service worker', 'navigator.serviceWorker'],
    [
      'service worker',
      "navigator.serviceWorker.register(new URL('./payload.mjs', import.meta.url), { type: 'module' })",
    ],
    ['paint worklet', "CSS.paintWorklet.addModule(new URL('./payload.mjs', import.meta.url))"],
    ['audio worklet', "context.audioWorklet.addModule(new URL('./payload.mjs', import.meta.url))"],
    [
      'service worker',
      "navigator['service' + 'Worker']['register']('/payload.mjs', { type: 'module' })",
    ],
    ['paint worklet', "CSS['paint' + 'Worklet']['addModule']('/payload.mjs')"],
    ['audio worklet', "context['audio' + 'Worklet']['addModule']('/payload.mjs')"],
    [
      'service worker',
      "(() => { const { serviceWorker: worker } = navigator; return worker.register('/payload.mjs', { type: 'module' }); })()",
    ],
    [
      'paint worklet',
      "(() => { const { paintWorklet: worklet } = CSS; return worklet.addModule('/payload.mjs'); })()",
    ],
    [
      'audio worklet',
      "(() => { const { audioWorklet: worklet } = context; return worklet.addModule('/payload.mjs'); })()",
    ],
    [
      'service worker',
      "Reflect.get(navigator, 'serviceWorker').register('/payload.mjs', { type: 'module' })",
    ],
    ['paint worklet', "Reflect.get(CSS, 'paintWorklet').addModule('/payload.mjs')"],
    ['audio worklet', "Reflect.get(context, 'audioWorklet').addModule('/payload.mjs')"],
    [
      'service worker',
      "(() => { const key = 'serviceWorker'; return navigator[key].register('/payload.mjs', { type: 'module' }); })()",
    ],
    [
      'opaque browser executable carrier',
      "(() => { const key = globalThis.__KOVO_BROWSER_KEY__; return globalThis[key]('/payload.mjs'); })()",
    ],
    [
      'opaque browser executable carrier',
      "(() => { const key = globalThis.__KOVO_BROWSER_KEY__; const { [key]: Carrier } = globalThis; return new Carrier('/payload.mjs'); })()",
    ],
    [
      'opaque browser executable carrier',
      "Reflect.apply(Reflect.get, Reflect, [navigator, 'serviceWorker']).register('/payload.mjs')",
    ],
    [
      'service worker',
      "(() => { const read = (object, key) => object[key]; const worker = read(navigator, 'serviceWorker'); return worker?.register('/payload.mjs'); })()",
    ],
    [
      'opaque browser executable carrier',
      "(() => { const worklet = Reflect.apply(Reflect.get, Reflect, [CSS, 'paintWorklet']); return worklet.addModule('/payload.mjs'); })()",
    ],
    [
      'opaque browser executable carrier',
      "(() => { const worklet = Reflect.apply(Reflect.get, Reflect, [context, 'audioWorklet']); return worklet.addModule('/payload.mjs'); })()",
    ],
    ['opaque browser executable carrier', 'setTimeout("new Worker(\'/payload.mjs\')", 0)'],
    [
      'opaque new-URL',
      "(() => { const U = URL; globalThis.__KOVO_URL_CONSTRUCTOR__ = U; return (globalThis.__KOVO_URL_ASSET__ = new U('./payload.mjs', import.meta.url)); })()",
    ],
    [
      'opaque new-URL',
      "(() => { class ReviewedURL extends URL {} return new ReviewedURL('./payload.mjs', import.meta.url); })()",
    ],
    [
      'opaque new-URL',
      "(() => { const BaseURL = URL; class ReviewedURL extends BaseURL {} const args = ['./payload.mjs', import.meta.url]; return new ReviewedURL(...args); })()",
    ],
    [
      'opaque new-URL',
      "(() => { class ReviewedURL extends URL { constructor() { super('./payload.mjs', import.meta.url); } } return new ReviewedURL(); })()",
    ],
    [
      'opaque new-URL',
      "(() => { class ReviewedURL extends URL {} return new ReviewedURL('./payload.mjs', `${import.meta.url}`); })()",
    ],
    [
      'opaque browser executable carrier',
      "(() => { class ReviewedURL extends URL {} return Reflect.apply(Reflect.construct, Reflect, [ReviewedURL, ['./payload.mjs', import.meta.url]]); })()",
    ],
    [
      'opaque browser executable carrier',
      "(() => { class ReviewedURL extends URL {} return Reflect.construct.call(Reflect, ReviewedURL, ['./payload.mjs', import.meta.url]); })()",
    ],
    [
      'opaque new-URL',
      '(() => { class ReviewedURL extends URL {} return new ReviewedURL(import.meta.url); })()',
    ],
    [
      'opaque new-URL',
      "(() => { class ReviewedURL extends URL { constructor() { super('./payload.mjs', arguments[0]); } } return new ReviewedURL(import.meta.url); })()",
    ],
    [
      'opaque new-URL',
      "(() => { globalThis.__KovoURL = URL; return new __KovoURL('./payload.mjs', import.meta.url); })()",
    ],
    [
      'opaque new-URL',
      "(() => { Object.defineProperty(globalThis, '__KovoURL', { value: URL }); return new __KovoURL('./payload.mjs', import.meta.url); })()",
    ],
    [
      'opaque new-URL',
      "(() => { class ReviewedURL extends URL {} return new ReviewedURL('./payload.mjs', [import.meta.url]); })()",
    ],
  ] as const)('rejects a reviewed package %s executable asset', async (carrier, expression) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-executable-asset-')));
    const appModulePath = join(root, 'client.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    const outDir = join(root, 'dist');
    const source = "import { start } from 'safe-parser'; start({});\n";
    try {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          exports: { '.': './index.mjs' },
          name: 'safe-parser',
          type: 'module',
          version: '1.2.3',
        }),
      );
      writeFileSync(
        join(packageRoot, 'index.mjs'),
        `export const start = context => ${expression};\n`,
      );
      writeFileSync(
        join(packageRoot, 'payload.mjs'),
        "import 'data:text/javascript,globalThis.__KOVO_EXECUTABLE_ASSET_IMPORT__%3D%27EXECUTED%27'; globalThis.__KOVO_EXECUTABLE_ASSET__ = 'EXECUTED';\n",
      );
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['client.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'start' }],
                rootKinds: ['route'],
                sites: ['client.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };

      await expect(
        viteBuild({
          build: {
            emptyOutDir: true,
            outDir,
            rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.js' } },
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'client.mjs', source }],
              exactManifest,
              'build-client',
            ),
          ],
          root,
        }),
      ).rejects.toThrow(
        new RegExp(
          `KV448.*supported build-client artifact.*retains an? ${carrier} executable asset`,
          'u',
        ),
      );
      expect(() => readFileSync(join(outDir, 'entry.js'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-reviewed-local-carrier-name-precision
  it('allows locally bound carrier-shaped names, helper-local writes, and proven plain-object properties', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-local-carriers-')));
    const appModulePath = join(root, 'client.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    const outDir = join(root, 'dist');
    const source = "import { inspect } from 'safe-parser'; export const value = inspect();\n";
    try {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          exports: { '.': './index.mjs' },
          name: 'safe-parser',
          type: 'module',
          version: '1.2.3',
        }),
      );
      writeFileSync(
        join(packageRoot, 'index.mjs'),
        [
          "class Worker { constructor() { this.kind = 'local'; } }",
          "const settings = { serviceWorker: { state: 'off' }, paintWorklet: { addModule: () => 'local' } };",
          'const { serviceWorker, paintWorklet } = settings;',
          "class Namespace {} Namespace.Worker = class LocalWorker { constructor() { this.kind = 'namespace'; } };",
          "function FunctionNamespace() {} FunctionNamespace.Worker = class LocalWorker { constructor() { this.kind = 'function-namespace'; } };",
          "const frozen = globalThis.Object.freeze({ Worker: class LocalWorker { constructor() { this.kind = 'frozen'; } }, serviceWorker: { register: () => 'local-register' }, paintWorklet: { addModule: () => 'local-module' } });",
          "const localClassRegister = (() => { class serviceWorker { static register() { return 'class-register'; } } return serviceWorker.register(); })();",
          "const localBox = {}; localBox.Worker = class LocalWorker { constructor() { this.kind = 'member'; } };",
          "const localArray = []; localArray[0] = class LocalWorker { constructor() { this.kind = 'array'; } };",
          "const ignoredUnknownResult = inspectSomething({ value: 'off-slice' });",
          "const readLocalWorker = box => { const local = {}; local.seen = true; return box.worker; }; const forwardLocalWorker = box => readLocalWorker(box); const LocalViaHelper = forwardLocalWorker({ worker: class LocalWorker { constructor() { this.kind = 'helper-read'; } } }); const helperRead = new LocalViaHelper().kind;",
          "const nonCapturingBox = { Worker: class LocalWorker { constructor() { this.kind = 'non-capturing'; } } }; function makeLocalWriter(unused) { const local = {}; return () => platform => { local.platform = platform; return local.platform; }; } const localWrite = makeLocalWriter(nonCapturingBox)()('local-only'); const nonCapturingWorker = new nonCapturingBox.Worker().kind;",
          "const safeConstructorBox = { Worker: class LocalWorker { constructor() { this.kind = 'safe-constructor'; } } }; function SafeInstaller(unused) { const local = {}; local.platform = 'local-only'; } class SafeClassInstaller { constructor(unused) { const local = {}; local.platform = 'local-only'; } } new SafeInstaller(safeConstructorBox); new SafeClassInstaller(safeConstructorBox); const safeConstructorWorker = new safeConstructorBox.Worker().kind;",
          "const safeSetterBox = { Worker: class LocalWorker { constructor() { this.kind = 'safe-setter'; } } }; const safeHolder = { set target(unused) { const local = {}; local.platform = 'local-only'; } }; const safeHolderAlias = { holder: safeHolder }.holder; safeHolderAlias['tar' + 'get'] = safeSetterBox; class SafeClassHolder { set target(unused) { const local = {}; local.platform = 'local-only'; } } const safeClassHolder = new SafeClassHolder(); safeClassHolder.target = safeSetterBox; function SafePrototypeHolder() {} Object.defineProperty(SafePrototypeHolder.prototype, 'safe', { value: 'local-only' }); const safePrototypeHolder = new SafePrototypeHolder(); safePrototypeHolder.other = safeSetterBox; const safeSetterWorker = new safeSetterBox.Worker().kind;",
          "const describedLocal = (() => { const Object = { getOwnPropertyDescriptor: () => ({ value: class LocalWorker { constructor() { this.kind = 'local-object'; } } }) }; const Local = Object.getOwnPropertyDescriptor({}, 'Worker').value; return new Local().kind; })();",
          "const reflectedLocal = (() => { const Reflect = { get: (object, key) => object[key] }; const Local = Reflect.get({ Worker: class LocalWorker { constructor() { this.kind = 'local-reflect'; } } }, 'Worker'); return new Local().kind; })();",
          "class LocalAssetReference { constructor(_path, _base) { this.kind = 'local-asset'; } }",
          "const localAssetReference = new LocalAssetReference('./payload.mjs', import.meta.url).kind;",
          "const reflectedLocalAssetReference = Reflect.construct(LocalAssetReference, ['./payload.mjs', import.meta.url]).kind;",
          "class LocalBase { constructor() { this.kind = 'local-base'; } } class LocalSubclass extends LocalBase {}",
          'const localSubclass = new LocalSubclass().kind;',
          'const SafeURLAlias = URL;',
          "const safeURLAlias = new SafeURLAlias('/local', 'https://example.test').pathname;",
          "const spreadSafeURLAlias = new SafeURLAlias(...['/local', 'https://example.test']).pathname;",
          'class SafeURLSubclass extends URL {}',
          "const safeURLSubclass = new SafeURLSubclass('/local', 'https://example.test').pathname;",
          "class SafeConstructingURL extends URL { constructor() { super('/local', 'https://example.test'); } }",
          'const safeConstructingURL = new SafeConstructingURL().pathname;',
          "export const inspect = () => [new Worker().kind, new Namespace.Worker().kind, new FunctionNamespace.Worker().kind, new frozen.Worker().kind, frozen.serviceWorker.register(), frozen.paintWorklet.addModule(), localClassRegister, new localBox.Worker().kind, new localArray[0]().kind, helperRead, localWrite, nonCapturingWorker, safeConstructorWorker, safeSetterWorker, reflectedLocal, describedLocal, localAssetReference, reflectedLocalAssetReference, localSubclass, safeURLAlias, spreadSafeURLAlias, safeURLSubclass, safeConstructingURL, settings.serviceWorker.state, serviceWorker.state, paintWorklet.addModule(), new Map().size, new URL('/local', 'https://example.test').pathname, new Error('local').message, typeof ignoredUnknownResult].join(':');",
          '',
        ].join('\n'),
      );
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['client.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'inspect' }],
                rootKinds: ['route'],
                sites: ['client.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };

      await expect(
        viteBuild({
          build: {
            emptyOutDir: true,
            outDir,
            rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.js' } },
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'client.mjs', source }],
              exactManifest,
              'build-client',
            ),
          ],
          root,
        }),
      ).resolves.toBeDefined();
      expect(readFileSync(join(outDir, 'entry.js'), 'utf8')).toContain('local');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-browser-authority-escape-closure
  it.each([
    [
      'object storage',
      "const holder = { run: Reflect.construct, U: URL, args: ['./payload.mjs', import.meta.url] }; export const inspect = () => holder.run(holder.U, holder.args);",
    ],
    [
      'structured helper return',
      "function box(run, U) { return { run, U }; } const holder = box(Reflect.construct, URL); export const inspect = () => holder.run(holder.U, ['./payload.mjs', import.meta.url]);",
    ],
    [
      'structured closure return',
      "function box(run, U, args) { return { invoke() { return run(U, args); } }; } const holder = box(Reflect.construct, URL, ['./payload.mjs', import.meta.url]); export const inspect = () => holder.invoke();",
    ],
    [
      'class field and getter',
      "class Holder { static run = Reflect.construct; static U = URL; static args = ['./payload.mjs', import.meta.url]; static get value() { return this.run(this.U, this.args); } } export const inspect = () => Holder.value;",
    ],
    [
      'Proxy trap receiver',
      "const target = {}; const proxy = new Proxy(target, { ownKeys(value) { value.run(value.U, value.args); return []; } }); target.run = Reflect.construct; target.U = URL; target.args = ['./payload.mjs', import.meta.url]; export const inspect = () => ({ ...proxy });",
    ],
    [
      'iterator receiver',
      "const iterable = { *[Symbol.iterator]() { this.run(this.U, this.args); yield 1; } }; iterable.run = Reflect.construct; iterable.U = URL; iterable.args = ['./payload.mjs', import.meta.url]; export const inspect = () => Array.from(iterable);",
    ],
    [
      'tag substitution',
      "function tag(_strings, run, U, args) { run(U, args); return 1; } export const inspect = () => tag`${Reflect.construct}${URL}${['./payload.mjs', import.meta.url]}`;",
    ],
    [
      'getter-fabricated pair',
      "const holder = { get run() { return Reflect.construct; }, get U() { return URL; } }; export const inspect = () => holder.run(holder.U, ['./payload.mjs', import.meta.url]);",
    ],
    [
      'imperative event registration',
      "addEventListener('message', () => {}); export const inspect = () => 1;",
    ],
    [
      'timer destructuring default',
      'const { timer = setTimeout } = {}; export const inspect = () => timer(\'import("/payload.mjs")\', 0);',
    ],
    [
      'timer generator yield',
      'function* timers() { yield setTimeout; } const timer = timers().next().value; export const inspect = () => timer(\'import("/payload.mjs")\', 0);',
    ],
    [
      'Proxy-returned timer',
      'const proxy = new Proxy({}, { get() { return setTimeout; } }); export const inspect = () => proxy.timer(\'import("/payload.mjs")\', 0);',
    ],
    [
      'Proxy-set timer',
      'const target = {}; const proxy = new Proxy(target, { set(object, key, value) { object[key] = value; return true; } }); proxy.timer = setTimeout; export const inspect = () => target.timer(\'import("/payload.mjs")\', 0);',
    ],
  ] as const)('rejects retained invocation authority through %s', async (_kind, source) => {
    await expect(buildReviewedBrowserPackageArtifact(source)).rejects.toThrow(
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    );
  });

  // @kovo-security-certifies C13 dependency-browser-authority-escape-precision
  it('keeps lexical URL aliases and authority-free helper results inside the finite language', async () => {
    const artifact = await buildReviewedBrowserPackageArtifact(
      [
        'const Alias = URL;',
        "const direct = new Alias('/local', 'https://example.test').pathname;",
        "function ignore(_authority, value) { return value; } const ignored = ignore(Reflect, 'safe');",
        "function box(_authority, value) { return { value }; } const structured = box(Reflect, 'local').value;",
        'class SafeURL extends URL {}',
        "const subclass = new SafeURL('/local', 'https://example.test').pathname;",
        "const addEventListener = callback => callback(); const localListener = addEventListener(() => 'safe');",
        "const timeout = setTimeout(() => 'safe', 0);",
        "export const inspect = () => [direct, ignored, structured, subclass, localListener, typeof timeout].join(':');",
      ].join('\n'),
    );

    expect(artifact).toContain('safe');
  });

  // @kovo-security-certifies C13 dependency-approved-worker-subgraph-closure
  it.each(['query import', 'constructor', 'computed constructor', 'service worker'] as const)(
    'rejects an approved app %s worker subgraph that omits dependency closure',
    async (kind) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-app-worker-')));
      const appModulePath = join(root, 'app.mjs');
      const workerPath = join(root, 'worker.mjs');
      const packageRoot = join(root, 'node_modules', 'safe-parser');
      const helperRoot = join(root, 'node_modules', 'helper-parser');
      const outDir = join(root, 'dist');
      const appSource =
        kind === 'query import'
          ? "import WorkerEntry from './worker.mjs?worker'; new WorkerEntry();\n"
          : kind === 'constructor'
            ? "new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });\n"
            : kind === 'computed constructor'
              ? "new globalThis['Worker']('/worker.mjs', { type: 'module' });\n"
              : "navigator['service' + 'Worker']['register']('/worker.mjs', { type: 'module' });\n";
      const workerSource = "import { parse } from 'safe-parser'; parse('worker');\n";
      try {
        for (const [directory, packageName] of [
          [packageRoot, 'safe-parser'],
          [helperRoot, 'helper-parser'],
        ] as const) {
          mkdirSync(directory, { recursive: true });
          writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({
              exports: { '.': './index.mjs' },
              name: packageName,
              type: 'module',
              version: packageName === 'safe-parser' ? '1.2.3' : '1.0.0',
            }),
          );
        }
        writeFileSync(
          join(packageRoot, 'index.mjs'),
          "import { helper } from 'helper-parser'; export const parse = value => helper(value);\n",
        );
        writeFileSync(
          join(helperRoot, 'index.mjs'),
          "globalThis.__KOVO_APP_WORKER_HELPER__ = 'EXECUTED'; export const helper = value => value;\n",
        );
        writeFileSync(appModulePath, appSource);
        writeFileSync(workerPath, workerSource);
        const installed = resolveCapabilityPackageImport('safe-parser', workerPath)!;
        const exactManifest: AppDependencyCapabilityManifest = {
          dependencies: [
            {
              entries: [
                {
                  conditions: installed.conditions,
                  importers: ['worker.mjs'],
                  imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                  rootKinds: ['route'],
                  sites: ['worker.mjs:1:1'],
                  specifier: 'safe-parser',
                },
              ],
              manifestFingerprint: installed.manifestFingerprint,
              packageName: installed.packageName,
              packageVersion: installed.packageVersion,
              summaryVersion: 'safe-parser-review/1',
              verdict: 'open',
            },
          ],
          schema: 'kovo-app-dependency-capabilities/v1',
        };

        await expect(
          viteBuild({
            build: {
              emptyOutDir: true,
              outDir,
              rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.js' } },
            },
            configFile: false,
            logLevel: 'silent',
            plugins: [
              dependencyCapabilityLoaderVitePlugin(
                appModulePath,
                [
                  { fileName: 'app.mjs', source: appSource },
                  { fileName: 'worker.mjs', source: workerSource },
                ],
                exactManifest,
                'build-client',
              ),
            ],
            root,
          }),
        ).rejects.toThrow(
          kind === 'query import'
            ? /KV448.*approved app source app\.mjs edge.*query or fragment/u
            : kind === 'service worker'
              ? /KV448.*supported build-client artifact.*retains a service worker executable asset/u
              : /KV448.*supported build-client artifact.*retains a Worker constructor/u,
        );
        expect(() => readFileSync(join(outDir, 'entry.js'), 'utf8')).toThrow();
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
  );

  // @kovo-security-certifies C13 dependency-retained-browser-carrier-closure
  it.each([
    [
      'nested-global Worker',
      "new globalThis.window.Worker('/payload.mjs', { type: 'module' })",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'reflected SharedWorker',
      "new (Reflect.get(globalThis, 'SharedWorker'))('/payload.mjs', { type: 'module' })",
      /KV448.*supported build-client artifact.*retains a SharedWorker constructor/u,
    ],
    [
      'reflected service worker',
      "Reflect.get(navigator, 'serviceWorker').register('/payload.mjs', { type: 'module' })",
      /KV448.*supported build-client artifact.*retains a service worker executable asset/u,
    ],
    [
      'reflected paint worklet',
      "Reflect.get(CSS, 'paintWorklet').addModule('/payload.mjs')",
      /KV448.*supported build-client artifact.*retains a paint worklet executable asset/u,
    ],
    [
      'reflected audio worklet',
      "Reflect.get(globalThis.__KOVO_AUDIO_CONTEXT__, 'audioWorklet').addModule('/payload.mjs')",
      /KV448.*supported build-client artifact.*retains an? audio worklet executable asset/u,
    ],
    [
      'descriptor Worker',
      "new (Object.getOwnPropertyDescriptor(globalThis, 'Worker').value)('/payload.mjs')",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'opaque accessor service worker',
      "(() => { const read = (object, key) => object[key]; const worker = read(navigator, 'serviceWorker'); return worker?.register('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a service worker executable asset/u,
    ],
    [
      'member-written Worker',
      "(() => { const box = {}; box.global = globalThis; const W = box.global.Worker; return new W('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'helper-written Worker',
      "(() => { function install(box, platform) { box.platform = platform; } const box = {}; install(box, globalThis); const W = box.platform.Worker; return new W('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'closure-helper-written Worker',
      "(() => { function install(box, platform) { function write() { box.platform = platform; } write(); } const box = {}; install(box, globalThis); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'curried-helper-written Worker',
      "(() => { function prepare(box) { return platform => { box.platform = platform; }; } const box = {}; const install = prepare(box); install(globalThis); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'nested-returned-helper-written Worker',
      "(() => { function prepare(box) { return () => platform => { box.platform = platform; }; } const box = {}; prepare(box)()(globalThis); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'projected-capture-helper-written Worker',
      "(() => { function prepare(box) { const state = { target: box }; const write = platform => { state.target.platform = platform; }; const api = { write }; return api.write; } const box = {}; prepare(box)(globalThis); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'returned-class-method-written Worker',
      "(() => { function prepare(box) { return class Installer { install(platform) { box.platform = platform; } }; } const box = {}; const Installer = prepare(box); new Installer().install(globalThis); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'constructor-written Worker',
      "(() => { function Installer(box) { box.platform = globalThis; } const box = {}; new Installer(box); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'setter-argument-written Worker',
      "(() => { const box = {}; const holder = { set target(value) { value.platform = globalThis; } }; holder.target = box; return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'setter-captured-target-written Worker',
      "(() => { const box = {}; const holder = { set platform(value) { box.platform = value; } }; holder.platform = globalThis; return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'class-constructor-written Worker',
      "(() => { class Installer { constructor(box) { box.platform = globalThis; } } const box = {}; new Installer(box); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'projected-constructor-written Worker',
      "(() => { function Installer(box) { box.platform = globalThis; } const registry = { Installer }; const C = registry.Installer; const box = {}; new C(box); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'constructor-returned-setter-written Worker',
      "(() => { function Holder() { return { set target(value) { value.platform = globalThis; } }; } const box = {}; const holder = new Holder(); holder.target = box; return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'dynamic-constructor-written Worker',
      "(() => { const Installer = getInstaller(); const box = {}; new Installer(box); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'Reflect.construct-written Worker',
      "(() => { function Installer(box) { box.platform = globalThis; } const box = {}; Reflect.construct(Installer, [box]); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'projected-computed-setter-written Worker',
      "(() => { const box = {}; const registry = { holder: { set target(value) { value.platform = globalThis; } } }; const holder = registry.holder; holder['tar' + 'get'] = box; return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'class-instance-setter-written Worker',
      "(() => { class Holder { set target(value) { value.platform = globalThis; } } const box = {}; const projected = { holder: new Holder() }.holder; projected.target = box; return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'static-class-setter-written Worker',
      "(() => { class Holder { static set target(value) { value.platform = globalThis; } } const box = {}; Holder.target = box; return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'prototype-setter-written Worker',
      "(() => { function Holder() {} Holder.prototype = { set target(value) { value.platform = globalThis; } }; const box = {}; const holder = new Holder(); holder.target = box; return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'defineProperty-setter-written Worker',
      "(() => { const holder = {}; Object.defineProperty(holder, 'target', { set(value) { value.platform = globalThis; } }); const box = {}; holder.target = box; return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'defineProperty-prototype-setter-written Worker',
      "(() => { function Holder() {} Object.defineProperty(Holder.prototype, 'target', { set(value) { value.platform = globalThis; } }); const box = {}; const holder = new Holder(); holder.target = box; return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'Reflect.set-setter-written Worker',
      "(() => { const holder = { set target(value) { value.platform = globalThis; } }; const box = {}; Reflect.set(holder, 'target', box); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'Object.assign-setter-written Worker',
      "(() => { const holder = { set target(value) { value.platform = globalThis; } }; const box = {}; Object.assign(holder, { target: box }); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'dynamic-key-setter-written Worker',
      "(() => { const holder = { set target(value) { value.platform = globalThis; } }; const box = {}; holder[getSetterKey()] = box; return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-Proxy-set-trap-written Worker',
      "(() => { const box = {}; const holder = new Proxy({}, { set(_target, _key, value) { value.platform = globalThis; return true; } }); holder.target = box; return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-Proxy-get-trap-returned Worker',
      "(() => { const holder = new Proxy({}, { get(_target, key) { return key === 'platform' ? globalThis : undefined; } }); return new holder.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-legacy-defineSetter-written Worker',
      "(() => { const holder = {}; holder.__defineSetter__('target', value => { value.platform = globalThis; }); const box = {}; holder.target = box; return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-legacy-defineGetter-returned Worker',
      "(() => { const holder = {}; holder.__defineGetter__('platform', () => globalThis); return new holder.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-method-this-written Worker',
      "(() => { const holder = { install() { this.platform = globalThis; } }; holder.install(); return new holder.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-call-invoked-helper-written Worker',
      "(() => { function install(box) { box.platform = globalThis; } const box = {}; install.call(null, box); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-apply-invoked-helper-written Worker',
      "(() => { function install(box) { box.platform = globalThis; } const box = {}; install.apply(null, [box]); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-bind-invoked-helper-written Worker',
      "(() => { function install(box) { box.platform = globalThis; } const box = {}; install.bind(null, box)(); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-object-destructuring-target-written Worker',
      "(() => { const box = {}; ({ value: box.platform } = { value: globalThis }); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-array-destructuring-target-written Worker',
      "(() => { const box = {}; [box.platform] = [globalThis]; return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-destructuring-setter-written Worker',
      "(() => { const holder = { set target(value) { value.platform = globalThis; } }; const box = {}; ({ value: holder.target } = { value: box }); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-constructor-arguments-written Worker',
      "(() => { function Installer() { arguments[0].platform = globalThis; } const box = {}; new Installer(box); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-setter-arguments-written Worker',
      "(() => { const holder = { set target(_value) { arguments[0].platform = globalThis; } }; const box = {}; holder.target = box; return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-static-setter-this-written Worker',
      "(() => { class Holder { static set target(value) { this.platform = value; } } Holder.target = globalThis; return new Holder.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-deep-structured-argument-written Worker',
      deepStructuredArgumentCarrierExpression('/payload.mjs'),
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-object-rest-target-written Worker',
      "(() => { const box = {}; const source = { platform: globalThis }; ({ ...box.value } = source); return new box.value.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-array-rest-target-written Worker',
      "(() => { const box = {}; const source = [globalThis]; [...box.value] = source; return new box.value[0].Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-arrow-captured-arguments-written Worker',
      "(() => { function prepare() { return () => { arguments[0].platform = globalThis; }; } const box = {}; prepare(box)(); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-for-of-member-target-written Worker',
      "(() => { const box = {}; for (box.platform of [globalThis]) { break; } return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-for-of-nested-target-written Worker',
      "(() => { const box = {}; for ({ value: box.platform } of [{ value: globalThis }]) { break; } return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-for-of-identifier-written Worker',
      "(() => { let platform = {}; for (platform of [globalThis]) { break; } return new platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-for-of-nested-identifier-written Worker',
      "(() => { let platform = {}; for ({ value: platform } of [{ value: globalThis }]) { break; } return new platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-for-await-member-target-written Worker',
      "(async () => { const box = {}; for await (box.platform of [globalThis]) { break; } return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-for-await-identifier-written Worker',
      "(async () => { let platform = {}; for await (platform of [globalThis]) { break; } return new platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-defineProperties-prototype-setter-written Worker',
      "(() => { function Holder() {} const prototype = Holder.prototype; Object.defineProperties(prototype, { target: { set(value) { value.platform = globalThis; } } }); const holder = new Holder(); const box = {}; holder.target = box; return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-Reflect-defineProperty-prototype-setter-written Worker',
      "(() => { function Holder() {} const holder = new Holder(); Reflect.defineProperty(holder, 'target', { set(value) { value.platform = globalThis; } }); const box = {}; holder.target = box; return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-setPrototypeOf-prototype-setter-written Worker',
      "(() => { function Holder() {} const prototype = Holder.prototype; Object.setPrototypeOf(prototype, { set target(value) { value.platform = globalThis; } }); const holder = new Holder(); const box = {}; holder.target = box; return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-static-getter-this-written Worker',
      "(() => { class Holder { static get trigger() { this.platform = globalThis; return 1; } } Holder.trigger; return new Holder.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-static-block-this-written Worker',
      "(() => { class Holder { static { this.platform = globalThis; } } return new Holder.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-constructor-receiver-written Worker',
      "(() => { function Holder() { this.platform = globalThis; } const holder = new Holder(); return new holder.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-Object-freeze-Proxy-trap-written Worker',
      "(() => { const box = {}; const proxy = new Proxy(box, { preventExtensions(target) { target.platform = globalThis; Reflect.preventExtensions(target); return true; } }); Object.freeze(proxy); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-default-parameter-written Worker',
      "(() => { function install(box, _unused = (box.platform = globalThis)) { return box; } const box = {}; const installed = install(box); return new installed.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-array-join-coercion-written Worker',
      "(() => { const box = { toString() { this.platform = globalThis; return ''; } }; [box].join(':'); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-array-callback-written Worker',
      "(() => { const box = {}; [box].forEach(value => { value.platform = globalThis; }); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-timer-extra-argument-written Worker',
      "(() => { function install(box) { box.platform = globalThis; } const box = {}; setTimeout(install, 0, box); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'audit-tagged-template-argument-written Worker',
      "(() => { function install(_strings, box) { box.platform = globalThis; } const box = {}; install`${box}`; return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'depth-budget-helper-written Worker',
      depthBudgetCarrierExpression('/payload.mjs'),
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'recursive-budget-helper-written Worker',
      recursiveBudgetCarrierExpression('/payload.mjs'),
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'recursive-callable-budget Worker',
      recursiveCallableCarrierExpression('/payload.mjs'),
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'accessor-triggered Worker',
      "(() => { const box = { get trigger() { this.platform = globalThis; return 1; } }; function inspect(value) { Reflect.get(value, 'trigger'); } inspect(box); return new box.platform.Worker('/payload.mjs'); })()",
      /KV448.*supported build-client artifact.*retains a Worker constructor/u,
    ],
    [
      'Reflect.apply-transferred Worker',
      "new (Reflect.apply(Reflect.get, Reflect, [globalThis, 'Worker']))('/payload.mjs')",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'dynamic Function Worker',
      'Function("return new Worker(\'/payload.mjs\')")()',
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'closed-browser-value constructor-chain dynamic Worker',
      closedBrowserValueDynamicWorkerExpression('/payload.mjs'),
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified URL-constructor alias',
      "(() => { const U = URL; globalThis.__KOVO_URL_CONSTRUCTOR__ = U; return (globalThis.__KOVO_URL_ASSET__ = new U('./payload.mjs', import.meta.url)); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified import.meta.url base alias',
      "(() => { const getURL = () => URL; const meta = import.meta; const base = meta.url; const U = getURL(); globalThis.__KOVO_URL_CONSTRUCTOR__ = U; return (globalThis.__KOVO_URL_ASSET__ = new U('./payload.mjs', base)); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified destructured import.meta.url base alias',
      "(() => { const { url: base } = import.meta; const U = (0, URL); globalThis.__KOVO_URL_CONSTRUCTOR__ = U; return (globalThis.__KOVO_URL_ASSET__ = new U('./payload.mjs', base)); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified mutable conditional URL aliases',
      "(() => { let U = class Local {}; U = globalThis.__KOVO_URL_CHOICE__ ? class Local {} : (0, URL); let base = 'https://example.test'; base = import.meta.url; globalThis.__KOVO_URL_CONSTRUCTOR__ = U; return (globalThis.__KOVO_URL_ASSET__ = new U('./payload.mjs', base)); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified URL spread argument alias',
      "(() => { const U = URL; const args = ['./payload.mjs', import.meta.url]; globalThis.__KOVO_URL_CONSTRUCTOR__ = U; globalThis.__KOVO_URL_ARGUMENTS__ = args; return (globalThis.__KOVO_URL_ASSET__ = new U(...args)); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified URL subclass',
      "(() => { class U extends URL {} globalThis.__KOVO_URL_CONSTRUCTOR__ = U; return (globalThis.__KOVO_URL_ASSET__ = new U('./payload.mjs', import.meta.url)); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified URL subclass spread argument alias',
      "(() => { const B = URL; class U extends B {} const args = ['./payload.mjs', import.meta.url]; globalThis.__KOVO_URL_CONSTRUCTOR__ = U; globalThis.__KOVO_URL_ARGUMENTS__ = args; return (globalThis.__KOVO_URL_ASSET__ = new U(...args)); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified URL subclass super call',
      "(() => { class U extends URL { constructor() { super('./payload.mjs', import.meta.url); } } globalThis.__KOVO_URL_CONSTRUCTOR__ = U; return (globalThis.__KOVO_URL_ASSET__ = new U()); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified URL subclass shifted super base',
      "(() => { class U extends URL { constructor(base) { super('./payload.mjs', base); } } globalThis.__KOVO_URL_CONSTRUCTOR__ = U; return (globalThis.__KOVO_URL_ASSET__ = new U(import.meta.url)); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified URL subclass lexical super spread',
      "(() => { const args = ['./payload.mjs', import.meta.url]; class U extends URL { constructor() { super(...args); } } globalThis.__KOVO_URL_CONSTRUCTOR__ = U; globalThis.__KOVO_URL_ARGUMENTS__ = args; return (globalThis.__KOVO_URL_ASSET__ = new U()); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified URL subclass chained super call',
      "(() => { class U extends URL { constructor() { super('./payload.mjs', import.meta.url); } } class V extends U {} globalThis.__KOVO_URL_CONSTRUCTOR__ = V; return (globalThis.__KOVO_URL_ASSET__ = new V()); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified URL subclass template-literal base',
      "(() => { class U extends URL {} globalThis.__KOVO_URL_CONSTRUCTOR__ = U; return (globalThis.__KOVO_URL_ASSET__ = new U('./payload.mjs', `${import.meta.url}`)); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified URL subclass spread template-literal base',
      "(() => { class U extends URL {} const args = ['./payload.mjs', `${import.meta.url}`]; globalThis.__KOVO_URL_CONSTRUCTOR__ = U; globalThis.__KOVO_URL_ARGUMENTS__ = args; return (globalThis.__KOVO_URL_ASSET__ = new U(...args)); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified Reflect.apply Reflect.construct URL subclass',
      "(() => { class U extends URL {} const args = ['./payload.mjs', import.meta.url]; return (globalThis.__KOVO_URL_ASSET__ = Reflect.apply(Reflect.construct, Reflect, [U, args])); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified Reflect.construct.call URL subclass',
      "(() => { class U extends URL {} const args = ['./payload.mjs', import.meta.url]; return (globalThis.__KOVO_URL_ASSET__ = Reflect.construct.call(Reflect, U, args)); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified Reflect.construct.bind URL subclass',
      "(() => { class U extends URL {} const args = ['./payload.mjs', import.meta.url]; const construct = Reflect.construct.bind(Reflect, U, args); return (globalThis.__KOVO_URL_ASSET__ = construct()); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified Reflect.construct.apply URL subclass',
      "(() => { class U extends URL {} const args = ['./payload.mjs', import.meta.url]; return (globalThis.__KOVO_URL_ASSET__ = Reflect.construct.apply(Reflect, [U, args])); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified destructured Reflect.apply URL subclass',
      "(() => { const { apply } = Reflect; class U extends URL {} const args = ['./payload.mjs', import.meta.url]; return (globalThis.__KOVO_URL_ASSET__ = apply(Reflect.construct, Reflect, [U, args])); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified borrowed call Reflect.construct URL subclass',
      "(() => { class U extends URL {} const args = ['./payload.mjs', import.meta.url]; return (globalThis.__KOVO_URL_ASSET__ = (() => {}).call.call(Reflect.construct, Reflect, U, args)); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified forwarded Reflect.construct URL subclass',
      "(() => { const invoke = (fn, receiver, args) => Reflect.apply(fn, receiver, args); class U extends URL {} const args = ['./payload.mjs', import.meta.url]; return (globalThis.__KOVO_URL_ASSET__ = invoke(Reflect.construct, Reflect, [U, args])); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified URL subclass one-argument module URL',
      '(() => { class U extends URL {} globalThis.__KOVO_URL_CONSTRUCTOR__ = U; return (globalThis.__KOVO_URL_ASSET__ = new U(import.meta.url)); })()',
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified URL subclass implicit arguments base',
      "(() => { class U extends URL { constructor() { super('./payload.mjs', arguments[0]); } } return (globalThis.__KOVO_URL_ASSET__ = new U(import.meta.url)); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified URL subclass implicit arguments spread',
      "(() => { class U extends URL { constructor() { super(...arguments); } } return (globalThis.__KOVO_URL_ASSET__ = new U('./payload.mjs', import.meta.url)); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified URL helper implicit arguments base',
      "(() => { function first() { return arguments[0]; } class U extends URL { constructor() { super('./payload.mjs', first(import.meta.url)); } } return (globalThis.__KOVO_URL_ASSET__ = new U()); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified global URL constructor alias',
      "(() => { globalThis.__KovoURL = URL; return (globalThis.__KOVO_URL_ASSET__ = new __KovoURL('./payload.mjs', import.meta.url)); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified global module URL base alias',
      "(() => { globalThis.__kovoBase = import.meta.url; return (globalThis.__KOVO_URL_ASSET__ = new URL('./payload.mjs', __kovoBase)); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified nested global URL constructor alias',
      "(() => { globalThis.__kovoConstructors = { URL }; const { URL: U } = __kovoConstructors; return (globalThis.__KOVO_URL_ASSET__ = new U('./payload.mjs', import.meta.url)); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified Object.defineProperty global URL alias',
      "(() => { Object.defineProperty(globalThis, '__KovoURL', { value: URL }); return (globalThis.__KOVO_URL_ASSET__ = new __KovoURL('./payload.mjs', import.meta.url)); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified Reflect.defineProperty global module URL base',
      "(() => { Reflect.defineProperty(window, '__kovoBase', { value: import.meta.url }); return (globalThis.__KOVO_URL_ASSET__ = new URL('./payload.mjs', __kovoBase)); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified escaped global unknown constructor',
      "(() => { inspectGlobal(globalThis); return (globalThis.__KOVO_URL_ASSET__ = new __KovoUnknown('./payload.mjs', import.meta.url)); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified timer before ambient overwrite',
      '(() => { setTimeout(\'import("/payload.mjs")\', 0); globalThis.setTimeout = () => {}; })()',
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified captured timer before ambient overwrite',
      '(() => { const timer = setTimeout; globalThis.setTimeout = () => {}; timer(\'import("/payload.mjs")\', 0); })()',
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified captured URL before ambient overwrite',
      "(() => { const U = URL; globalThis.URL = class LocalURL {}; return (globalThis.__KOVO_URL_ASSET__ = new U('./payload.mjs', import.meta.url)); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified captured Reflect.construct before ambient overwrite',
      "(() => { const construct = Reflect.construct; globalThis.Reflect = {}; return (globalThis.__KOVO_URL_ASSET__ = construct(URL, ['./payload.mjs', import.meta.url])); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified descriptor-acquired timer',
      "Object.getOwnPropertyDescriptor(globalThis, 'setTimeout').value('import(\"/payload.mjs\")', 0)",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified descriptor-acquired Function',
      "Object.getOwnPropertyDescriptor(globalThis, 'Function').value('return import(\"/payload.mjs\")')()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified descriptor-acquired Reflect.construct',
      "Object.getOwnPropertyDescriptor(Reflect, 'construct').value(URL, ['./payload.mjs', import.meta.url])",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified mutated URL superclass',
      "(() => { class LocalBase {} class U extends LocalBase {} Object.setPrototypeOf(U, URL); return (globalThis.__KOVO_URL_ASSET__ = new U('./payload.mjs', import.meta.url)); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified dunder-mutated URL superclass',
      "(() => { class LocalBase {} class U extends LocalBase {} U.__proto__ = URL; return (globalThis.__KOVO_URL_ASSET__ = new U('./payload.mjs', import.meta.url)); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified helper dunder-mutated URL superclass',
      "(() => { function install(Constructor, Base) { Constructor.__proto__ = Base; } class LocalBase {} class U extends LocalBase {} install(U, URL); return (globalThis.__KOVO_URL_ASSET__ = new U('./payload.mjs', import.meta.url)); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified helper setPrototypeOf-mutated URL superclass',
      "(() => { function install(Constructor, Base) { Object.setPrototypeOf(Constructor, Base); } class LocalBase {} class U extends LocalBase {} install(U, URL); return (globalThis.__KOVO_URL_ASSET__ = new U('./payload.mjs', import.meta.url)); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified new-target-mutated URL superclass',
      "(() => { class Base { constructor() { Object.setPrototypeOf(new.target, URL); } } class U extends Base {} new U(); return (globalThis.__KOVO_URL_ASSET__ = new U('./payload.mjs', import.meta.url)); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified helper new-target-mutated URL superclass',
      "(() => { function install(Constructor, Base) { Object.setPrototypeOf(Constructor, Base); } class LocalBase { constructor() { install(new.target, URL); } } class U extends LocalBase {} new U(); return (globalThis.__KOVO_URL_ASSET__ = new U('./payload.mjs', import.meta.url)); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified instance-constructor-mutated URL superclass',
      "(() => { class Base { constructor() { this.constructor.__proto__ = URL; } } class U extends Base {} new U(); return (globalThis.__KOVO_URL_ASSET__ = new U('./payload.mjs', import.meta.url)); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified URL subclass array-coercible base',
      "(() => { class U extends URL {} return (globalThis.__KOVO_URL_ASSET__ = new U('./payload.mjs', [import.meta.url])); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified URL subclass object-coercible base',
      "(() => { class U extends URL {} const base = { toString() { return import.meta.url; } }; return (globalThis.__KOVO_URL_ASSET__ = new U('./payload.mjs', base)); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified URL super array-coercible base',
      "(() => { class U extends URL { constructor() { super('./payload.mjs', [import.meta.url]); } } return (globalThis.__KOVO_URL_ASSET__ = new U()); })()",
      /KV448.*supported build-client artifact.*retains an opaque new-URL executable asset/u,
    ],
    [
      'minified descriptor-helper Reflect.construct authority laundering',
      "(() => { function get(object, key) { return Object.getOwnPropertyDescriptor(object, key).value; } const R = get(globalThis, 'Reflect'); const U = get(globalThis, 'URL'); return (globalThis.__KOVO_URL_ASSET__ = R.construct(U, ['./payload.mjs', import.meta.url])); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified Object.create-helper Reflect.construct authority laundering',
      "(() => { function inherit(object) { return Object.create(object); } const R = inherit(Reflect); const U = inherit(URL); return (globalThis.__KOVO_URL_ASSET__ = R.construct(U, ['./payload.mjs', import.meta.url])); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified local-helper Reflect.construct invocation',
      "(() => { function invoke(R, U, args) { return R.construct(U, args); } return (globalThis.__KOVO_URL_ASSET__ = invoke(Reflect, URL, ['./payload.mjs', import.meta.url])); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified local-helper aliased Reflect.construct invocation',
      "(() => { function invoke(construct, U, args) { return construct(U, args); } return (globalThis.__KOVO_URL_ASSET__ = invoke(Reflect.construct, URL, ['./payload.mjs', import.meta.url])); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified descriptor-helper eval authority laundering',
      "(() => { function get(object, key) { return Object.getOwnPropertyDescriptor(object, key).value; } return get(globalThis, 'eval')('import(\"/payload.mjs\")'); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified descriptor-helper Function authority laundering',
      "(() => { function get(object, key) { return Object.getOwnPropertyDescriptor(object, key).value; } return get(globalThis, 'Function')('return import(\"/payload.mjs\")')(); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified descriptor-helper timer authority laundering',
      "(() => { function get(object, key) { return Object.getOwnPropertyDescriptor(object, key).value; } return get(globalThis, 'setTimeout')('import(\"/payload.mjs\")', 0); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified local-helper timer invocation',
      '(() => { function invoke(timer, source, delay) { return timer(source, delay); } return invoke(setTimeout, \'import("/payload.mjs")\', 0); })()',
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    [
      'minified discarded local-helper timer invocation',
      "(() => { function invoke(timer, source) { timer(source, 0); return 'plain'; } return invoke(setTimeout, 'import(\"/payload.mjs\")'); })()",
      /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
    ],
    ...dynamicCodeAdapterCarrierExpressions('/payload.mjs').map(
      ([label, expression]) =>
        [
          label,
          expression,
          /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
        ] as const,
    ),
    ...timerAdapterCarrierExpressions('/payload.mjs').map(
      ([label, expression]) =>
        [
          label,
          expression,
          /KV448.*supported build-client artifact.*retains an? opaque browser executable carrier executable asset/u,
        ] as const,
    ),
  ] as const)(
    'rejects a retained approved-app %s before a public executable module can ship',
    async (_label, expression, expectedError) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-retained-carrier-')));
      const appModulePath = join(root, 'app.mjs');
      const publicRoot = join(root, 'public');
      const outDir = join(root, 'dist');
      const appSource = `${expression};\n`;
      try {
        mkdirSync(publicRoot, { recursive: true });
        writeFileSync(appModulePath, appSource);
        writeFileSync(
          join(publicRoot, 'payload.mjs'),
          "import 'data:text/javascript,globalThis.__KOVO_RETAINED_CARRIER__%3D%27EXECUTED%27';\n",
        );

        await expect(
          viteBuild({
            build: {
              emptyOutDir: true,
              minify: true,
              outDir,
              rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.js' } },
            },
            configFile: false,
            logLevel: 'silent',
            plugins: [
              dependencyCapabilityLoaderVitePlugin(
                appModulePath,
                [{ fileName: 'app.mjs', source: appSource }],
                { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
                'build-client',
              ),
            ],
            root,
          }),
        ).rejects.toThrow(expectedError);
        // Vite copies publicDir before generateBundle. The copied executable is the concrete
        // secondary graph this retained-artifact backstop prevents from becoming a successful build.
        expect(readFileSync(join(outDir, 'payload.mjs'), 'utf8')).toContain(
          '__KOVO_RETAINED_CARRIER__',
        );
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
  );

  // @kovo-security-certifies C13 dependency-relative-nested-package-boundary
  it.each([
    ['manifest-owned', true, 'node_modules', false, false],
    ['legacy node_modules', false, 'node_modules', false, false],
    ['case-folded node_modules', false, 'NODE_MODULES', false, false],
    ['symlinked node_modules', false, 'node_modules', true, false],
    ['package-main redirect', true, 'internal', false, true],
  ] as const)(
    'rejects a relative edge from a reviewed package into a %s nested package boundary',
    async (
      _label,
      helperHasManifest,
      boundaryDirectory,
      helperUsesSymlink,
      helperUsesMainRedirect,
    ) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-relative-nested-')));
      const appModulePath = join(root, 'app.mjs');
      const packageRoot = join(root, 'node_modules', 'safe-parser');
      const helperSpecifierRoot = join(packageRoot, boundaryDirectory, 'helper-parser');
      const helperRoot =
        helperUsesSymlink || helperUsesMainRedirect
          ? join(packageRoot, 'vendor', 'helper-parser')
          : helperSpecifierRoot;
      const outDir = join(root, 'dist');
      const source = "import { parse } from 'safe-parser'; export const value = parse('safe');\n";
      try {
        mkdirSync(packageRoot, { recursive: true });
        mkdirSync(helperRoot, { recursive: true });
        writeFileSync(
          join(packageRoot, 'package.json'),
          JSON.stringify({
            exports: { '.': './index.cjs' },
            name: 'safe-parser',
            type: 'commonjs',
            version: '1.2.3',
          }),
        );
        if (helperHasManifest) {
          const manifestRoot = helperUsesMainRedirect ? helperSpecifierRoot : helperRoot;
          mkdirSync(manifestRoot, { recursive: true });
          writeFileSync(
            join(manifestRoot, 'package.json'),
            JSON.stringify({
              ...(helperUsesMainRedirect
                ? { main: '../../vendor/helper-parser/index.cjs' }
                : { exports: { '.': './index.cjs' } }),
              name: 'helper-parser',
              type: 'commonjs',
              version: '1.0.0',
            }),
          );
        }
        if (helperUsesSymlink) {
          mkdirSync(dirname(helperSpecifierRoot), { recursive: true });
          symlinkSync(helperRoot, helperSpecifierRoot, 'dir');
        }
        writeFileSync(
          join(packageRoot, 'index.cjs'),
          [
            helperUsesMainRedirect
              ? `require('./${boundaryDirectory}/helper-parser');`
              : `require('./${boundaryDirectory}/helper-parser/index.cjs');`,
            'exports.parse = value => value;',
            '',
          ].join('\n'),
        );
        writeFileSync(
          join(helperRoot, 'index.cjs'),
          "globalThis.__KOVO_RELATIVE_NESTED_PACKAGE__ = 'EXECUTED';\n",
        );
        writeFileSync(appModulePath, source);
        const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
        const exactManifest: AppDependencyCapabilityManifest = {
          dependencies: [
            {
              entries: [
                {
                  conditions: installed.conditions,
                  importers: ['app.mjs'],
                  imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                  rootKinds: ['route'],
                  sites: ['app.mjs:1:1'],
                  specifier: 'safe-parser',
                },
              ],
              manifestFingerprint: installed.manifestFingerprint,
              packageName: installed.packageName,
              packageVersion: installed.packageVersion,
              summaryVersion: 'safe-parser-review/1',
              verdict: 'open',
            },
          ],
          schema: 'kovo-app-dependency-capabilities/v1',
        };

        await expect(
          viteBuild({
            build: {
              emptyOutDir: true,
              outDir,
              rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.mjs' } },
              ssr: true,
            },
            configFile: false,
            logLevel: 'silent',
            plugins: [
              dependencyCapabilityLoaderVitePlugin(
                appModulePath,
                [{ fileName: 'app.mjs', source }],
                exactManifest,
                'build-server',
                { allowNodeBuiltins: true },
              ),
            ],
            root,
            ssr: { noExternal: true },
          }),
        ).rejects.toThrow(/KV448.*nested package boundary.*safe-parser/u);
        expect(() => readFileSync(join(outDir, 'entry.mjs'), 'utf8')).toThrow();
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
  );

  // @kovo-security-certifies C13 dependency-vite-ignore-artifact-closure
  it.each(['relative', 'file URL'] as const)(
    'rejects a Vite-ignored %s import that remains outside the bundle-owned artifact',
    async (kind) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-vite-ignore-')));
      const appModulePath = join(root, 'app.mjs');
      const packageRoot = join(root, 'node_modules', 'safe-parser');
      const helperPath = join(root, kind === 'relative' ? 'helper.mjs' : 'helper-file.mjs');
      const outDir = join(root, 'dist');
      const source = "import { parse } from 'safe-parser'; export const value = parse('safe');\n";
      try {
        mkdirSync(packageRoot, { recursive: true });
        writeFileSync(
          join(packageRoot, 'package.json'),
          JSON.stringify({
            exports: { '.': './index.mjs' },
            name: 'safe-parser',
            type: 'module',
            version: '1.2.3',
          }),
        );
        const specifier = kind === 'relative' ? '../helper.mjs' : pathToFileURL(helperPath).href;
        writeFileSync(
          join(packageRoot, 'index.mjs'),
          [
            `await import(/* @vite-ignore */ ${JSON.stringify(specifier)});`,
            'export const parse = value => value;',
            '',
          ].join('\n'),
        );
        writeFileSync(
          helperPath,
          `globalThis.__KOVO_VITE_IGNORE_${kind === 'relative' ? 'RELATIVE' : 'FILE'}__ = 'EXECUTED';\n`,
        );
        writeFileSync(appModulePath, source);
        const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
        const exactManifest: AppDependencyCapabilityManifest = {
          dependencies: [
            {
              entries: [
                {
                  conditions: installed.conditions,
                  importers: ['app.mjs'],
                  imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                  rootKinds: ['route'],
                  sites: ['app.mjs:1:1'],
                  specifier: 'safe-parser',
                },
              ],
              manifestFingerprint: installed.manifestFingerprint,
              packageName: installed.packageName,
              packageVersion: installed.packageVersion,
              summaryVersion: 'safe-parser-review/1',
              verdict: 'open',
            },
          ],
          schema: 'kovo-app-dependency-capabilities/v1',
        };

        await expect(
          viteBuild({
            build: {
              emptyOutDir: true,
              outDir,
              rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.mjs' } },
              ssr: true,
            },
            configFile: false,
            logLevel: 'silent',
            plugins: [
              dependencyCapabilityLoaderVitePlugin(
                appModulePath,
                [{ fileName: 'app.mjs', source }],
                exactManifest,
                'build-server',
                { allowNodeBuiltins: true },
              ),
            ],
            root,
            ssr: { noExternal: true },
          }),
        ).rejects.toThrow(/KV448.*unresolved module target.*bundle-owned artifact/u);
        expect(() => readFileSync(join(outDir, 'entry.mjs'), 'utf8')).toThrow();
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
  );

  it('literalizes an exact same-block const module target in the emitted server artifact', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-finite-import-')));
    const appModulePath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const appSource = [
      'export async function loadBuiltin() {',
      "  const target = 'node:fs';",
      '  return import(/* @vite-ignore */ target);',
      '}',
      '',
    ].join('\n');
    try {
      writeFileSync(appModulePath, appSource);
      await viteBuild({
        build: {
          emptyOutDir: true,
          outDir,
          rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.mjs' } },
          ssr: true,
        },
        configFile: false,
        logLevel: 'silent',
        plugins: [
          dependencyCapabilityLoaderVitePlugin(
            appModulePath,
            [{ fileName: 'app.mjs', source: appSource }],
            { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
            'build-server',
            { allowNodeBuiltins: true },
          ),
        ],
        root,
        ssr: { noExternal: true },
      });

      const artifact = readFileSync(join(outDir, 'entry.mjs'), 'utf8');
      expect(artifact).toMatch(/import\([\s\S]{0,100}["']node:fs["']/u);
      expect(artifact).not.toMatch(/import\(\s*target\s*\)/u);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not resolve a captured or shadowed dynamic module target as a finite artifact edge', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-shadowed-import-')));
    const appModulePath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const appSource = [
      "const target = 'node:fs';",
      'export async function loadSelected(target) {',
      '  return import(/* @vite-ignore */ target);',
      '}',
      '',
    ].join('\n');
    try {
      writeFileSync(appModulePath, appSource);
      await expect(
        viteBuild({
          build: {
            emptyOutDir: true,
            outDir,
            rollupOptions: { input: appModulePath, output: { entryFileNames: 'entry.mjs' } },
            ssr: true,
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'app.mjs', source: appSource }],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              'build-server',
              { allowNodeBuiltins: true },
            ),
          ],
          root,
          ssr: { noExternal: true },
        }),
      ).rejects.toThrow(/KV448.*supported build-server artifact.*non-literal module edge/u);
      expect(() => readFileSync(join(outDir, 'entry.mjs'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-nonliteral-artifact-module-closure
  it('rejects a retained non-literal HTML-client import before a public module can execute', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-nonliteral-client-')));
    const appModulePath = join(root, 'src', 'client.ts');
    const outDir = join(root, 'dist');
    const appSource = [
      "const target = '/payload.mjs';",
      'export const load = () => import(/* @vite-ignore */ target);',
      'void load();',
      '',
    ].join('\n');
    try {
      mkdirSync(join(root, 'public'), { recursive: true });
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(appModulePath, appSource);
      writeFileSync(
        join(root, 'public', 'payload.mjs'),
        "globalThis.__KOVO_NONLITERAL_CLIENT_IMPORT__ = 'EXECUTED';\n",
      );
      writeFileSync(
        join(root, 'index.html'),
        '<!doctype html><script type="module" src="/src/client.ts"></script>',
      );

      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'client.ts', source: appSource }],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              'build-client',
            ),
          ],
          root,
        }),
      ).rejects.toThrow(/KV448.*supported build-client artifact.*non-literal module edge/u);
      expect(() => readFileSync(join(outDir, 'index.html'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-artifact-runtime-url-identity
  it('rejects percent-encoded dot segments before they can confuse chunk ownership', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-encoded-dot-')));
    const appModulePath = join(root, 'app.mjs');
    const decoyModulePath = join(root, 'decoy.mjs');
    const outDir = join(root, 'dist');
    const appSource = "void import(/* @vite-ignore */ './%2e%2e/payload.js');\n";
    const decoySource = "export const decoy = 'reviewed chunk';\n";
    try {
      mkdirSync(join(root, 'public'), { recursive: true });
      writeFileSync(appModulePath, appSource);
      writeFileSync(decoyModulePath, decoySource);
      writeFileSync(
        join(root, 'public', 'payload.js'),
        "globalThis.__KOVO_ENCODED_DOT_PUBLIC__ = 'EXECUTED';\n",
      );
      await expect(
        viteBuild({
          build: {
            emptyOutDir: true,
            outDir,
            rollupOptions: {
              input: appModulePath,
              output: { entryFileNames: 'assets/entry.mjs' },
            },
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            {
              buildStart() {
                this.emitFile({
                  fileName: 'assets/%2e%2e/payload.js',
                  id: decoyModulePath,
                  type: 'chunk',
                });
              },
              name: 'emit-encoded-dot-decoy-chunk',
            },
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [
                { fileName: 'app.mjs', source: appSource },
                { fileName: 'decoy.mjs', source: decoySource },
              ],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              'build-client',
            ),
          ],
          root,
        }),
      ).rejects.toThrow(/KV448.*ambiguous runtime URL module target.*%2e%2e/u);
      expect(() => readFileSync(join(outDir, 'assets', 'entry.mjs'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-artifact-empty-path-segment-identity
  it('rejects repeated URL slashes before they can confuse chunk ownership', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-empty-segment-')));
    const appModulePath = join(root, 'app.mjs');
    const decoyModulePath = join(root, 'decoy.mjs');
    const outDir = join(root, 'dist');
    const appSource = "void import(/* @vite-ignore */ './/../target.mjs');\n";
    const decoySource = "export const decoy = 'reviewed chunk';\n";
    try {
      mkdirSync(join(root, 'public', 'assets'), { recursive: true });
      writeFileSync(appModulePath, appSource);
      writeFileSync(decoyModulePath, decoySource);
      writeFileSync(
        join(root, 'public', 'assets', 'target.mjs'),
        "globalThis.__KOVO_EMPTY_SEGMENT_PUBLIC__ = 'EXECUTED';\n",
      );
      await expect(
        viteBuild({
          build: {
            emptyOutDir: true,
            outDir,
            rollupOptions: {
              input: appModulePath,
              output: { entryFileNames: 'assets/entry.mjs' },
            },
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            {
              buildStart() {
                this.emitFile({
                  fileName: 'target.mjs',
                  id: decoyModulePath,
                  type: 'chunk',
                });
              },
              name: 'emit-empty-segment-decoy-chunk',
            },
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [
                { fileName: 'app.mjs', source: appSource },
                { fileName: 'decoy.mjs', source: decoySource },
              ],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              'build-client',
            ),
          ],
          root,
        }),
      ).rejects.toThrow(/KV448.*ambiguous runtime URL module target.*\.\/\/\.\.\/target/u);
      expect(() => readFileSync(join(outDir, 'assets', 'entry.mjs'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-builtin-ssr-pre-evaluation
  it('rejects a reviewed package builtin import before supported SSR app evaluation', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-builtin-ssr-')));
    const appModulePath = join(root, 'app.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    const source = "import { parse } from 'safe-parser'; export const value = parse('safe');\n";
    let server: Awaited<ReturnType<typeof createViteServer>> | undefined;
    try {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          exports: { '.': './index.js' },
          name: 'safe-parser',
          type: 'module',
          version: '1.2.3',
        }),
      );
      writeFileSync(
        join(packageRoot, 'index.js'),
        "import { readFileSync } from 'node:fs'; export const parse = () => readFileSync;\n",
      );
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['app.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                rootKinds: ['route'],
                sites: ['app.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };
      server = await createViteServer({
        appType: 'custom',
        configFile: false,
        logLevel: 'silent',
        plugins: [
          dependencyCapabilityLoaderVitePlugin(
            appModulePath,
            [{ fileName: 'app.mjs', source }],
            exactManifest,
            'export',
          ),
        ],
        root,
        server: { hmr: false },
        ssr: { noExternal: true },
      });

      await expect(server.ssrLoadModule('/app.mjs')).rejects.toThrow(
        /KV448.*uncensused transitive dependency node:fs imported by reviewed package safe-parser/u,
      );
    } finally {
      await server?.close();
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-direct-ssr-external-pre-evaluation
  it('rejects a direct app dependency that overlaps a trusted SSR host external', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-direct-external-ssr-')));
    const appModulePath = join(root, 'app.mjs');
    const packageRoot = join(root, 'node_modules', 'typescript');
    const executedPath = join(root, 'external-executed');
    const source = "import { value } from 'typescript'; export { value };\n";
    try {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          exports: { '.': './index.js' },
          name: 'typescript',
          type: 'module',
          version: '6.0.3',
        }),
      );
      writeFileSync(
        join(packageRoot, 'index.js'),
        `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(
          executedPath,
        )}, 'executed'); export const value = 'forged';\n`,
      );
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('typescript', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['app.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'value' }],
                rootKinds: ['route'],
                sites: ['app.mjs:1:1'],
                specifier: 'typescript',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'typescript-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };
      await expect(
        createViteServer({
          appType: 'custom',
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'app.mjs', source }],
              exactManifest,
              'build-app',
            ),
          ],
          root,
          server: { hmr: false },
          ssr: { external: ['typescript'], noExternal: true },
        }),
      ).rejects.toThrow(/KV448.*typescript.*overlaps a trusted SSR external/u);
      expect(() => readFileSync(executedPath, 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-transitive-reviewed-external
  it('rejects a reviewed package reaching a raw runtime external that skipped resolveId', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-external-loader-')));
    const appModulePath = join(root, 'app.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    const source = "import { parse } from 'safe-parser'; export const value = parse('safe');\n";
    try {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          dependencies: { pg: '8.16.3' },
          exports: { '.': './index.js' },
          name: 'safe-parser',
          type: 'module',
          version: '1.2.3',
        }),
      );
      writeFileSync(
        join(packageRoot, 'index.js'),
        "import { Client } from 'pg'; export const parse = value => [value, Client];\n",
      );
      writeFileSync(appModulePath, source);
      const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
      const exactManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: installed.conditions,
                importers: ['app.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                rootKinds: ['route'],
                sites: ['app.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: installed.manifestFingerprint,
            packageName: installed.packageName,
            packageVersion: installed.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };

      await expect(
        viteBuild({
          build: {
            outDir: join(root, 'dist'),
            rollupOptions: { external: (id) => id === 'pg', input: appModulePath },
            ssr: true,
          },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'app.mjs', source }],
              exactManifest,
              'build-server',
              { allowRuntimeExternal: (id) => id === 'pg' },
            ),
          ],
          root,
          ssr: { noExternal: ['safe-parser'] },
        }),
      ).rejects.toThrow(
        /KV448.*uncensused transitive dependency pg imported by reviewed package safe-parser/u,
      );
      expect(() => readFileSync(join(root, 'dist', 'app.mjs'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-package-root-containment
  it('rejects relative and symlink escapes from an admitted third-party package root', async () => {
    for (const escapeKind of ['relative', 'symlink'] as const) {
      const root = realpathSync(
        mkdtempSync(join(tmpdir(), `kovo-dependency-${escapeKind}-escape-`)),
      );
      const appModulePath = join(root, 'app.mjs');
      const packageRoot = join(root, 'node_modules', 'safe-parser');
      const escapePath = join(root, 'escape.mjs');
      const source = "import { parse } from 'safe-parser'; export const value = parse('safe');\n";
      try {
        mkdirSync(packageRoot, { recursive: true });
        writeFileSync(
          join(packageRoot, 'package.json'),
          JSON.stringify({
            exports: { '.': './index.js' },
            name: 'safe-parser',
            type: 'module',
            version: '1.2.3',
          }),
        );
        writeFileSync(
          join(packageRoot, 'index.js'),
          `export { parse } from ${JSON.stringify(escapeKind === 'relative' ? '../../escape.mjs' : './linked.mjs')};\n`,
        );
        writeFileSync(
          escapePath,
          "import { readFileSync } from 'node:fs'; export const parse = value => [value, readFileSync];\n",
        );
        if (escapeKind === 'symlink') symlinkSync(escapePath, join(packageRoot, 'linked.mjs'));
        writeFileSync(appModulePath, source);
        const installed = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
        const exactManifest: AppDependencyCapabilityManifest = {
          dependencies: [
            {
              entries: [
                {
                  conditions: installed.conditions,
                  importers: ['app.mjs'],
                  imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                  rootKinds: ['route'],
                  sites: ['app.mjs:1:1'],
                  specifier: 'safe-parser',
                },
              ],
              manifestFingerprint: installed.manifestFingerprint,
              packageName: installed.packageName,
              packageVersion: installed.packageVersion,
              summaryVersion: 'safe-parser-review/1',
              verdict: 'open',
            },
          ],
          schema: 'kovo-app-dependency-capabilities/v1',
        };

        await expect(
          viteBuild({
            build: {
              outDir: join(root, 'dist'),
              rollupOptions: { input: appModulePath },
              ssr: true,
            },
            configFile: false,
            logLevel: 'silent',
            plugins: [
              dependencyCapabilityLoaderVitePlugin(
                appModulePath,
                [{ fileName: 'app.mjs', source }],
                exactManifest,
                'build-server',
                { allowNodeBuiltins: true },
              ),
            ],
            root,
            ssr: { noExternal: true },
          }),
        ).rejects.toThrow(
          new RegExp(
            `KV448.*reviewed package safe-parser ${escapeKind} import escapes its exact package root`,
            'u',
          ),
        );
        expect(() => readFileSync(join(root, 'dist', 'app.mjs'), 'utf8')).toThrow();
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    }
  });

  // @kovo-security-certifies C13 dependency-inline-html-module-closure
  it('rejects inline HTML module proxies outside the immutable approved-source snapshot', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-inline-html-')));
    const appModulePath = join(root, 'src', 'app.ts');
    const packageRoot = join(root, 'node_modules', 'safe-parser');
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(appModulePath, 'export const app = true;\n');
      writeFileSync(
        join(root, 'index.html'),
        [
          '<!doctype html>',
          '<script type="module">',
          "import { parse } from 'safe-parser';",
          "document.body.textContent = parse('uncensused');",
          '</script>',
        ].join('\n'),
      );
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          exports: { '.': './index.js' },
          name: 'safe-parser',
          type: 'module',
          version: '1.2.3',
        }),
      );
      writeFileSync(join(packageRoot, 'index.js'), 'export const parse = value => value;\n');

      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir: join(root, 'dist') },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'app.ts', source: 'export const app = true;\n' }],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              'build-client',
            ),
          ],
          root,
        }),
      ).rejects.toThrow(
        /KV448.*inline HTML module is outside the immutable approved-source snapshot/u,
      );
      expect(() => readFileSync(join(root, 'dist', 'index.html'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-external-html-module-snapshot
  it('rejects an external HTML module script outside the immutable approved-source snapshot', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-html-module-')));
    const appModulePath = join(root, 'app.mjs');
    const packageRoot = join(root, 'node_modules', 'safe-client');
    const outDir = join(root, 'dist');
    const appSource = "export const app = 'approved';\n";
    try {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(appModulePath, appSource);
      writeFileSync(
        join(root, 'index.html'),
        '<!doctype html><script type="module" src="/node_modules/safe-client/index.js"></script>',
      );
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({ name: 'safe-client', type: 'module', version: '1.0.0' }),
      );
      writeFileSync(
        join(packageRoot, 'index.js'),
        "globalThis.__UNCENSUSED_CLIENT_PACKAGE__ = 'executed';\n",
      );

      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'app.mjs', source: appSource }],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              'build-client',
            ),
          ],
          root,
        }),
      ).rejects.toThrow(/KV448.*HTML module.*immutable approved-source snapshot/u);
      expect(() => readFileSync(join(outDir, 'index.html'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-transitive-app-source-snapshot
  it('rejects an approved browser module that reaches outside the snapshot through /@fs', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-approved-fs-edge-')));
    const outsidePath = join(tmpdir(), `kovo-outside-browser-authority-${process.pid}.mjs`);
    const appModulePath = join(root, 'app.mjs');
    const clientPath = join(root, 'src', 'client.mjs');
    const outDir = join(root, 'dist');
    const appSource = 'export default {};\n';
    const clientSource = [
      `import ${JSON.stringify(`/@fs${outsidePath}`)};`,
      'globalThis.__KOVO_APPROVED_CLIENT__ = true;',
      '',
    ].join('\n');
    try {
      mkdirSync(dirname(clientPath), { recursive: true });
      writeFileSync(appModulePath, appSource);
      writeFileSync(clientPath, clientSource);
      writeFileSync(outsidePath, 'globalThis.__OUTSIDE_SNAPSHOT_EXECUTED__ = true;\n');
      writeFileSync(
        join(root, 'index.html'),
        '<!doctype html><script type="module" src="/src/client.mjs"></script>\n',
      );

      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [
                { fileName: 'app.mjs', source: appSource },
                { fileName: 'src/client.mjs', source: clientSource },
              ],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              'build-client',
            ),
          ],
          root,
        }),
      ).rejects.toThrow(
        /KV448.*approved app source src\/client\.mjs edge \/@fs.*outside the immutable approved-source snapshot/u,
      );
      expect(() => readFileSync(join(outDir, 'index.html'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(outsidePath, { force: true });
    }
  });

  // @kovo-security-certifies C13 dependency-html-resolved-module-snapshot
  it('rejects an approved HTML module URL when Vite aliases it outside the snapshot', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-html-alias-')));
    const appModulePath = join(root, 'src', 'client.ts');
    const packageRoot = join(root, 'node_modules', 'safe-client');
    const outDir = join(root, 'dist');
    const appSource = "globalThis.__KOVO_APPROVED_CLIENT__ = 'loaded';\n";
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(appModulePath, appSource);
      writeFileSync(
        join(root, 'index.html'),
        '<!doctype html><script type="module" src="/src/client.ts"></script>',
      );
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({ name: 'safe-client', type: 'module', version: '1.0.0' }),
      );
      writeFileSync(
        join(packageRoot, 'index.js'),
        "globalThis.__UNCENSUSED_CLIENT_PACKAGE__ = 'executed';\n",
      );

      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'client.ts', source: appSource }],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              'build-client',
            ),
          ],
          resolve: {
            alias: [{ find: '/src/client.ts', replacement: join(packageRoot, 'index.js') }],
          },
          root,
        }),
      ).rejects.toThrow(/KV448.*HTML module.*immutable approved-source snapshot/u);
      expect(() => readFileSync(join(outDir, 'index.html'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-html-public-shadow-snapshot
  it.each([
    ['ordinary module', 'module', ''],
    ['Vite-ignored module', 'module', ' vite-ignore'],
    ['browser-case-insensitive module', 'MODULE', ''],
  ])('rejects an approved-looking %s shadowed by a public asset', async (_label, type, ignore) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-html-public-shadow-')));
    const appModulePath = join(root, 'src', 'client.ts');
    const publicModulePath = join(root, 'public', 'src', 'client.ts');
    const outDir = join(root, 'dist');
    const appSource = "globalThis.__KOVO_APPROVED_CLIENT__ = 'loaded';\n";
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(dirname(publicModulePath), { recursive: true });
      writeFileSync(appModulePath, appSource);
      writeFileSync(publicModulePath, "globalThis.__KOVO_PUBLIC_SHADOW_PACKAGE__ = 'EXECUTED';\n");
      writeFileSync(
        join(root, 'index.html'),
        `<!doctype html><script type="${type}"${ignore} src="/src/client.ts"></script>`,
      );

      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'client.ts', source: appSource }],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              'build-client',
            ),
          ],
          root,
        }),
      ).rejects.toThrow(/KV448.*public asset shadows approved HTML module/u);
      expect(() => readFileSync(join(outDir, 'index.html'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-html-authored-execution-closure
  it.each([
    [
      'event handler',
      '<body onload="globalThis.__KOVO_HTML_HANDLER_PWNED__=\'EXECUTED\'">',
      /KV448.*raw HTML event handler.*compiler-owned JSX lowering/u,
    ],
    [
      'nested srcdoc document',
      "<iframe srcdoc=\"&lt;script type='module' src='data:text/javascript,parent.__KOVO_SRCDOC_PWNED__%3D%27EXECUTED%27'&gt;&lt;/script&gt;\"></iframe>",
      /KV448.*nested HTML document.*immutable approved-source snapshot/u,
    ],
    [
      'empty named browsing-context element',
      '<iframe name="victim-frame"></iframe>',
      /KV448.*nested HTML document.*immutable approved-source snapshot/u,
    ],
    [
      'base URL retarget',
      '<base href="https://attacker.invalid/">',
      /KV448.*raw HTML base URL.*immutable approved-source snapshot/u,
    ],
    [
      'base browsing-context target',
      '<base target="attacker-window">',
      /KV448.*raw HTML base target.*immutable approved-source snapshot/u,
    ],
    [
      'named opener target',
      '<a target="attacker-window" href="https://attacker.invalid/child">run</a>',
      /KV448.*raw HTML element control a\[target\].*opener-bearing named browsing context/u,
    ],
    [
      'explicit opener relationship',
      '<a target="_blank" rel="opener" href="https://attacker.invalid/child">run</a>',
      /KV448.*raw HTML element control a\[rel\].*window\.opener authority/u,
    ],
    [
      'meta refresh navigation',
      '<meta http-equiv="refresh" content="0;url=https://attacker.invalid/phish">',
      /KV448.*raw HTML element control meta\[http-equiv\].*automatic navigation/u,
    ],
    [
      'javascript URL handler',
      '<a href="javascript:void(globalThis.__KOVO_JS_URL_PWNED__=\'EXECUTED\')">run</a>',
      /KV448.*raw HTML javascript URL.*compiler-owned JSX lowering/u,
    ],
    [
      'SVG SMIL set transfer',
      '<svg><a><set attributeName="href" to="javascript:void(globalThis.__KOVO_SMIL_SET_PWNED__=\'EXECUTED\')"></set><text>run</text></a></svg>',
      /KV448.*raw SVG SMIL execution transfer.*compiler-owned JSX lowering/u,
    ],
    [
      'SVG SMIL animate transfer',
      '<svg><a><animate attributeName="href" values="javascript:void(globalThis.__KOVO_SMIL_ANIMATE_PWNED__=\'EXECUTED\')"></animate><text>run</text></a></svg>',
      /KV448.*raw SVG SMIL execution transfer.*compiler-owned JSX lowering/u,
    ],
  ])('rejects raw HTML %s outside compiler-owned closure', async (_label, fragment, error) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-html-execution-')));
    const appModulePath = join(root, 'src', 'client.ts');
    const outDir = join(root, 'dist');
    const appSource = "globalThis.__KOVO_APPROVED_CLIENT__ = 'loaded';\n";
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(appModulePath, appSource);
      writeFileSync(
        join(root, 'index.html'),
        ['<!doctype html>', '<script type="module" src="/src/client.ts"></script>', fragment].join(
          '\n',
        ),
      );

      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [{ fileName: 'client.ts', source: appSource }],
              { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
              'build-client',
            ),
          ],
          root,
        }),
      ).rejects.toThrow(error);
      expect(() => readFileSync(join(outDir, 'index.html'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies C13 dependency-html-url-module-snapshot
  it.each([
    [
      'data URL',
      'module',
      "data:text/javascript,globalThis.__KOVO_DATA_SCRIPT_PWNED__%3D'EXECUTED'",
      '',
    ],
    [
      'character-reference encoded data URL',
      'module',
      "&#x64;ata:text/javascript,globalThis.__KOVO_DATA_SCRIPT_PWNED__%3D'EXECUTED'",
      '',
    ],
    ['absolute HTTPS URL', 'module', 'https://attacker.invalid/remote-pwn.js', ''],
    [
      'legacy JavaScript MIME URL',
      'text/javascript1.5',
      "data:text/javascript,globalThis.__KOVO_LEGACY_TYPE_PWNED__%3D'EXECUTED'",
      '',
    ],
    [
      'module after a browser-valid bogus comment close',
      'module',
      "data:text/javascript,globalThis.__KOVO_COMMENT_CLOSE_PWNED__%3D'EXECUTED'",
      '<!-- harmless --!>',
    ],
    [
      'module after an abrupt empty-comment close',
      'module',
      "data:text/javascript,globalThis.__KOVO_ABRUPT_COMMENT_PWNED__%3D'EXECUTED'",
      '<!-->',
    ],
    [
      'module after an abrupt dash-comment close',
      'module',
      "data:text/javascript,globalThis.__KOVO_DASH_COMMENT_PWNED__%3D'EXECUTED'",
      '<!--->',
    ],
    [
      'module after a script-looking quoted attribute value',
      'module',
      "data:text/javascript,globalThis.__KOVO_ATTRIBUTE_DECOY_PWNED__%3D'EXECUTED'",
      '<div data-decoy="<script type=application/json>"></div>',
    ],
    [
      'module after a script-looking RCDATA value',
      'module',
      "data:text/javascript,globalThis.__KOVO_RCDATA_DECOY_PWNED__%3D'EXECUTED'",
      '<textarea><script type=application/json></textarea>',
    ],
  ])(
    'rejects an executable HTML %s outside the approved snapshot',
    async (_label, type, src, prefix) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-dependency-html-url-')));
      const appModulePath = join(root, 'src', 'client.ts');
      const outDir = join(root, 'dist');
      const appSource = "globalThis.__KOVO_APPROVED_CLIENT__ = 'loaded';\n";
      try {
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(appModulePath, appSource);
        writeFileSync(
          join(root, 'index.html'),
          [
            '<!doctype html>',
            '<script type="module" src="/src/client.ts"></script>',
            prefix,
            `<script type="${type}" src="${src}"></script>`,
          ].join('\n'),
        );

        await expect(
          viteBuild({
            build: { emptyOutDir: true, outDir },
            configFile: false,
            logLevel: 'silent',
            plugins: [
              dependencyCapabilityLoaderVitePlugin(
                appModulePath,
                [{ fileName: 'client.ts', source: appSource }],
                { dependencies: [], schema: 'kovo-app-dependency-capabilities/v1' },
                'build-client',
              ),
            ],
            root,
          }),
        ).rejects.toThrow(/KV448.*immutable approved-source snapshot/u);
        expect(() => readFileSync(join(outDir, 'index.html'), 'utf8')).toThrow();
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
  );

  it('binds a nested package edge to the helper that actually resolves it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-dependency-nested-loader-'));
    const appModulePath = join(root, 'app.mjs');
    const helperPath = join(root, 'features', 'helper.mjs');
    const topPackageRoot = join(root, 'node_modules', 'safe-parser');
    const nestedPackageRoot = join(root, 'features', 'node_modules', 'safe-parser');
    try {
      for (const [packageRoot, version] of [
        [topPackageRoot, '1.2.3'],
        [nestedPackageRoot, '2.0.0'],
      ] as const) {
        mkdirSync(packageRoot, { recursive: true });
        writeFileSync(
          join(packageRoot, 'package.json'),
          JSON.stringify({
            exports: { '.': './index.js' },
            name: 'safe-parser',
            type: 'module',
            version,
          }),
        );
        writeFileSync(join(packageRoot, 'index.js'), 'export const parse = value => value;\n');
      }
      mkdirSync(join(root, 'features'), { recursive: true });
      const appSource = "import { value } from './features/helper.mjs'; export { value };\n";
      const helperSource =
        "import { parse } from 'safe-parser'; export const value = parse('nested');\n";
      writeFileSync(appModulePath, appSource);
      writeFileSync(helperPath, helperSource);
      const reviewedTop = resolveCapabilityPackageImport('safe-parser', appModulePath)!;
      const wrongImporterManifest: AppDependencyCapabilityManifest = {
        dependencies: [
          {
            entries: [
              {
                conditions: reviewedTop.conditions,
                importers: ['features/helper.mjs'],
                imports: [{ capabilities: [], disposition: 'pure', name: 'parse' }],
                rootKinds: ['route'],
                sites: ['features/helper.mjs:1:1'],
                specifier: 'safe-parser',
              },
            ],
            manifestFingerprint: reviewedTop.manifestFingerprint,
            packageName: reviewedTop.packageName,
            packageVersion: reviewedTop.packageVersion,
            summaryVersion: 'safe-parser-review/1',
            verdict: 'open',
          },
        ],
        schema: 'kovo-app-dependency-capabilities/v1',
      };
      await expect(
        viteBuild({
          build: { outDir: join(root, 'dist'), rollupOptions: { input: appModulePath }, ssr: true },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            dependencyCapabilityLoaderVitePlugin(
              appModulePath,
              [
                { fileName: 'app.mjs', source: appSource },
                { fileName: 'features/helper.mjs', source: helperSource },
              ],
              wrongImporterManifest,
              'build-server',
            ),
          ],
          root,
          ssr: { noExternal: ['safe-parser'] },
        }),
      ).rejects.toThrow(/KV448.*safe-parser identity drifted after capability census/u);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
