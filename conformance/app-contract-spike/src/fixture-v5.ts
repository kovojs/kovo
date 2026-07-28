import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, realpath, rename, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import type { FreshArtifactSet } from './artifacts-v5.ts';

export const declarationFamilies = [
  'endpoint',
  'layout',
  'mutation',
  'query',
  'route',
  'task',
] as const;
export type DeclarationFamily = (typeof declarationFamilies)[number];
export type AppContractArm = 'arm-a' | 'arm-b';

export const matrixCaseNames = [
  'ordinary-local-import',
  'named-re-export',
  'star-re-export',
  'aliased-import',
  'destructured-factory',
  'wrapper-function',
  'dynamic-factory-selection',
  'object-derived-receiver',
  'array-derived-receiver',
  'wrapper-returned-receiver',
  'computed-factory-access',
  'monorepo-shared-app-package',
  'mutable-receiver',
  'reassigned-receiver',
  'joined-receiver',
  'duplicate-direct-copies',
  'duplicate-named-reexport-copies',
  'duplicate-star-reexport-copies',
  'duplicate-same-owner-key-copies',
] as const;
export type MatrixCaseName = (typeof matrixCaseNames)[number];

const appId = '00000000-0000-4000-8000-000000000001';
const providerKey = 'contacts-provider';
const ownerKey = `${appId}:${providerKey}`;

export interface PrototypeDiagnostic {
  readonly code: string;
  readonly fileName: string;
  readonly length: number;
  readonly message: string;
  readonly start: number;
}

export interface GeneratedContract {
  readonly configFile: string;
  readonly generatedFile: string;
  readonly manifestFile: string;
  readonly packageRoot: string;
  readonly providerFile: string;
  readonly serverPackageRoot: string;
}

export interface PrototypeFixture {
  readonly app: string;
  readonly configFile: string;
  readonly duplicate: string;
  readonly familyEntries: Readonly<
    Record<DeclarationFamily, Readonly<Record<AppContractArm | 'baseline', string>>>
  >;
  readonly generated: readonly GeneratedContract[];
  readonly generatedApp: GeneratedContract;
  readonly matrixEntries: Readonly<
    Record<MatrixCaseName, Readonly<Record<AppContractArm, string>>>
  >;
  readonly nestedFlowProbe: string;
  readonly ownerKey: string;
  readonly providerFile: string;
  readonly root: string;
  readonly runtimeEntries: Readonly<Record<AppContractArm, string>>;
  readonly secondaryProviderFile: string;
  readonly serverA: string;
  readonly serverB: string;
  readonly shared: string;
  readonly unrelatedMemberProbe: string;
}

export async function createPrototypeFixture(
  root: string,
  artifacts: FreshArtifactSet,
): Promise<PrototypeFixture> {
  const store = join(root, 'store');
  const serverA = join(store, 'server-a');
  const serverB = join(store, 'server-b');
  const core = join(store, 'core');
  const browser = join(store, 'browser');
  await cp(artifacts.packages.server.extractedPackageRoot, serverA, { recursive: true });
  await cp(artifacts.packages.server.extractedPackageRoot, serverB, { recursive: true });
  await cp(artifacts.packages.core.extractedPackageRoot, core, { recursive: true });
  await cp(artifacts.packages.browser.extractedPackageRoot, browser, { recursive: true });
  await installSyntheticRuntimeOverlay(serverA, 'server-copy-a');
  await installSyntheticRuntimeOverlay(serverB, 'server-copy-b');
  await linkKovoDependency(serverA, 'core', core);
  await linkKovoDependency(serverA, 'browser', browser);
  await linkKovoDependency(serverB, 'core', core);
  await linkKovoDependency(serverB, 'browser', browser);

  const app = join(root, 'app');
  const shared = join(root, 'packages/shared');
  const duplicate = join(root, 'packages/secondary');
  const consumer = join(root, 'packages/duplicate-consumer');
  await writePackageManifest(app, '@fixture/app', {
    exports: {
      './named': './src/named.ts',
      './provider': './src/kovo.ts',
      './star': './src/star.ts',
    },
    imports: { '#kovo': './.kovo/app.ts' },
  });
  await writePackageManifest(shared, '@fixture/shared', {
    imports: { '#kovo': './.kovo/app.ts' },
  });
  await writePackageManifest(duplicate, '@fixture/secondary', {
    exports: {
      './named': './src/named.ts',
      './provider': './src/kovo.ts',
      './star': './src/star.ts',
    },
    imports: { '#kovo': './.kovo/app.ts' },
  });
  await writePackageManifest(consumer, '@fixture/duplicate-consumer', {});
  await linkFixtureDependencies(app, serverA);
  await linkFixtureDependencies(shared, serverA, app);
  await linkFixtureDependencies(duplicate, serverB);
  await linkPackage(consumer, '@fixture/app', app);
  await linkPackage(consumer, '@fixture/secondary', duplicate);

  const configFile = join(app, 'kovo.config.json');
  await writeJson(configFile, {
    appId,
    providerKey,
    providers: ['db', 'env'],
  });
  const providerFile = join(app, 'src/kovo.ts');
  await writeSource(providerFile, primaryProviderSource());
  await writeSource(join(app, 'src/named.ts'), "export { app } from './kovo.js';\n");
  await writeSource(join(app, 'src/star.ts'), "export * from './kovo.js';\n");
  const secondaryProviderFile = join(duplicate, 'src/kovo.ts');
  await writeSource(secondaryProviderFile, secondaryProviderSource());
  await writeSource(
    join(duplicate, 'src/named.ts'),
    "export { app, sameOwnerApp } from './kovo.js';\n",
  );
  await writeSource(join(duplicate, 'src/star.ts'), "export * from './kovo.js';\n");

  const generatedApp = await generateBoundContract({
    artifacts,
    configFile,
    packageRoot: app,
    providerFile,
    serverPackageRoot: serverA,
  });
  const generatedShared = await generateBoundContract({
    artifacts,
    configFile,
    packageRoot: shared,
    providerFile,
    serverPackageRoot: serverA,
  });
  const generatedDuplicate = await generateBoundContract({
    artifacts,
    configFile,
    packageRoot: duplicate,
    providerFile: secondaryProviderFile,
    serverPackageRoot: serverB,
  });

  const matrixEntries = await writeMatrixFixtures({ app, consumer, shared });
  const familyEntries = await writeFamilyFixtures(app);
  const runtimeEntries = await writeRuntimeFixtures(app);
  const nestedFlowProbe = join(app, 'src/probes/nested-derived.ts');
  await writeSource(
    nestedFlowProbe,
    [
      "import { app } from '../kovo.js';",
      'const levelOne = { levelTwo: [{ current: app }] };',
      'const active = levelOne.levelTwo[0]!.current;',
      'export const item = active.query({ load() { return 1; } });',
      '',
    ].join('\n'),
  );
  const unrelatedMemberProbe = join(app, 'src/probes/unrelated-member.ts');
  await writeSource(
    unrelatedMemberProbe,
    [
      'const service = { query(definition: unknown) { return definition; } };',
      'export const item = service.query({ load() { return 1; } });',
      '',
    ].join('\n'),
  );

  return {
    app,
    configFile,
    duplicate,
    familyEntries,
    generated: [generatedApp, generatedShared, generatedDuplicate],
    generatedApp,
    matrixEntries,
    nestedFlowProbe,
    ownerKey,
    providerFile,
    root,
    runtimeEntries,
    secondaryProviderFile,
    serverA: await realpath(serverA),
    serverB: await realpath(serverB),
    shared,
    unrelatedMemberProbe,
  };
}

export async function validateGeneratedContract(
  contract: GeneratedContract,
  artifacts: FreshArtifactSet,
): Promise<PrototypeDiagnostic[]> {
  const manifest = JSON.parse(await readFile(contract.manifestFile, 'utf8')) as Record<
    string,
    unknown
  >;
  const generatedSource = await readFile(contract.generatedFile, 'utf8');
  const providerSource = await readFile(contract.providerFile, 'utf8');
  const configSource = await readFile(contract.configFile, 'utf8');
  const expected: Readonly<Record<string, string>> = {
    compilerSourceSha256: artifacts.packages.compiler.sourceSha256,
    configSha256: sha256(configSource),
    generatedModuleSha256: sha256(generatedSource),
    providerSourceSha256: sha256(providerSource),
    serverPackedContentsSha256: artifacts.packages.server.packedContents.digest,
  };
  const diagnostics: PrototypeDiagnostic[] = [];
  if (manifest.completed !== 'complete') {
    diagnostics.push(
      generatedDiagnostic(
        contract.manifestFile,
        'D1B106',
        'Generated app contract is not marked as one completed atomic generation.',
      ),
    );
  }
  for (const [field, value] of Object.entries(expected)) {
    if (manifest[field] !== value) {
      diagnostics.push(
        generatedDiagnostic(
          contract.manifestFile,
          generatedDigestDiagnosticCode(field),
          `Generated app contract ${field} does not match its authenticated input.`,
        ),
      );
    }
  }
  return diagnostics;
}

export async function generatedContractMutationDiagnostics(
  contract: GeneratedContract,
  artifacts: FreshArtifactSet,
): Promise<Readonly<Record<string, readonly PrototypeDiagnostic[]>>> {
  const originalManifest = await readFile(contract.manifestFile, 'utf8');
  const manifest = JSON.parse(originalManifest) as Record<string, unknown>;
  const mutations: Readonly<Record<string, readonly [string, unknown]>> = {
    'compiler-source-digest': ['compilerSourceSha256', '0'.repeat(64)],
    'completion-token': ['completed', 'partial'],
    'config-source-digest': ['configSha256', '0'.repeat(64)],
    'generated-module-digest': ['generatedModuleSha256', '0'.repeat(64)],
    'provider-source-digest': ['providerSourceSha256', '0'.repeat(64)],
    'server-packed-contents-digest': ['serverPackedContentsSha256', '0'.repeat(64)],
  };
  const result: Record<string, readonly PrototypeDiagnostic[]> = {};
  for (const [name, [field, value]] of Object.entries(mutations)) {
    await writeJson(contract.manifestFile, { ...manifest, [field]: value });
    result[name] = await validateGeneratedContract(contract, artifacts);
  }
  await writeSource(contract.manifestFile, originalManifest);
  return result;
}

export function stableFixturePath(fixture: PrototypeFixture, fileName: string): string {
  return `<fixture>/${relative(fixture.root, fileName).replaceAll('\\', '/')}`;
}

async function installSyntheticRuntimeOverlay(
  packageRoot: string,
  instanceId: string,
): Promise<void> {
  const manifestFile = join(packageRoot, 'package.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as {
    exports?: Record<string, unknown>;
  };
  manifest.exports = {
    ...(manifest.exports ?? {}),
    '.': {
      types: './d1/index.d.mts',
      default: './d1/index.mjs',
    },
  };
  await writeJson(manifestFile, manifest);
  await writeSource(join(packageRoot, 'd1/index.mjs'), syntheticRuntimeSource(instanceId));
  await writeSource(join(packageRoot, 'd1/index.d.mts'), syntheticDeclarationSource());
}

function syntheticRuntimeSource(instanceId: string): string {
  return [
    `export const d1PackageInstance = ${JSON.stringify(instanceId)};`,
    'const ownership = new WeakMap();',
    'const makeFactory = (kind, owner) => (...args) => {',
    '  const handle = Object.freeze({ args, kind });',
    '  ownership.set(handle, Object.freeze({ ...owner, kind, packageInstance: d1PackageInstance }));',
    '  return handle;',
    '};',
    'export const publicAccess = (reason) => Object.freeze({ kind: "public", reason });',
    'const unbound = Object.freeze({ appId: "<unbound>", ownerKey: "<unbound>", providerKey: "<unbound>" });',
    'export const endpoint = makeFactory("endpoint", unbound);',
    'export const layout = makeFactory("layout", unbound);',
    'export const mutation = makeFactory("mutation", unbound);',
    'export const query = makeFactory("query", unbound);',
    'export const route = makeFactory("route", unbound);',
    'export const task = makeFactory("task", unbound);',
    'export function createD1BoundFactories(metadata) {',
    '  const owner = Object.freeze({',
    '    appId: metadata.appId,',
    '    ownerKey: `${metadata.appId}:${metadata.providerKey}`,',
    '    providerKey: metadata.providerKey,',
    '  });',
    '  return Object.freeze({',
    '    endpoint: makeFactory("endpoint", owner),',
    '    layout: makeFactory("layout", owner),',
    '    mutation: makeFactory("mutation", owner),',
    '    publicAccess,',
    '    query: makeFactory("query", owner),',
    '    route: makeFactory("route", owner),',
    '    task: makeFactory("task", owner),',
    '  });',
    '}',
    'export function inspectD1Ownership(value) {',
    '  return value && typeof value === "object" ? ownership.get(value) ?? null : null;',
    '}',
    'export function defineKovo(options) {',
    '  const factories = createD1BoundFactories(options);',
    '  return Object.freeze({',
    '    ...factories,',
    '    appId: options.appId,',
    '    assemble(registries) {',
    '      const handles = Object.values(registries).flat();',
    '      for (const handle of handles) {',
    '        const observed = inspectD1Ownership(handle);',
    '        if (!observed || observed.ownerKey !== `${options.appId}:${options.providerKey}`) {',
    '          throw new TypeError("D1OWN001 mixed app or Kovo package handle refused before assembly.");',
    '        }',
    '      }',
    '      return Object.freeze({ handleCount: handles.length, ownerKey: `${options.appId}:${options.providerKey}` });',
    '    },',
    '  });',
    '}',
    '',
  ].join('\n');
}

function syntheticDeclarationSource(): string {
  return [
    "export * from '../dist/index.mjs';",
    "type Server = typeof import('../dist/index.mjs');",
    'declare const d1Owner: unique symbol;',
    'export interface D1BoundFactories<AppId extends string> {',
    '  readonly [d1Owner]: AppId;',
    "  readonly endpoint: Server['endpoint'];",
    "  readonly layout: Server['layout'];",
    "  readonly mutation: Server['mutation'];",
    "  readonly publicAccess: Server['publicAccess'];",
    "  readonly query: Server['query'];",
    "  readonly route: Server['route'];",
    "  readonly task: Server['task'];",
    '}',
    'export interface D1App<AppId extends string> extends D1BoundFactories<AppId> {',
    '  readonly appId: AppId;',
    '  assemble(input: Readonly<Record<string, readonly unknown[]>>): { readonly handleCount: number; readonly ownerKey: string };',
    '}',
    'export declare const d1PackageInstance: string;',
    'export declare function createD1BoundFactories<const AppId extends string>(',
    '  metadata: { readonly appId: AppId; readonly providerKey: string },',
    '): D1BoundFactories<AppId>;',
    'export declare function defineKovo<const AppId extends string>(',
    '  options: { readonly appId: AppId; readonly db?: () => unknown; readonly env?: () => unknown; readonly providerKey: string },',
    '): D1App<AppId>;',
    'export declare function inspectD1Ownership(value: unknown):',
    '  | { readonly appId: string; readonly kind: string; readonly ownerKey: string; readonly packageInstance: string; readonly providerKey: string }',
    '  | null;',
    '',
  ].join('\n');
}

async function generateBoundContract(options: {
  readonly artifacts: FreshArtifactSet;
  readonly configFile: string;
  readonly packageRoot: string;
  readonly providerFile: string;
  readonly serverPackageRoot: string;
}): Promise<GeneratedContract> {
  const providerSource = await readFile(options.providerFile, 'utf8');
  const configSource = await readFile(options.configFile, 'utf8');
  const context = providerContext(providerSource, options.providerFile);
  const generatedFile = join(options.packageRoot, '.kovo/app.ts');
  const manifestFile = join(options.packageRoot, '.kovo/app.manifest.json');
  const moduleSource = [
    '/* kovo-app-contract-prototype/v5: compiler generated; do not edit */',
    "import { createD1BoundFactories } from '@kovojs/server';",
    "import type { D1BoundFactories } from '@kovojs/server';",
    'export const __kovoGeneratedContract = Object.freeze({',
    `  appId: ${JSON.stringify(context.appId)},`,
    `  compilerSourceSha256: ${JSON.stringify(options.artifacts.packages.compiler.sourceSha256)},`,
    `  providerKey: ${JSON.stringify(context.providerKey)},`,
    `  serverPackedContentsSha256: ${JSON.stringify(
      options.artifacts.packages.server.packedContents.digest,
    )},`,
    '});',
    'const bound = createD1BoundFactories(__kovoGeneratedContract);',
    'type Bound = D1BoundFactories<typeof __kovoGeneratedContract.appId>;',
    "export const endpoint: Bound['endpoint'] = bound.endpoint;",
    "export const layout: Bound['layout'] = bound.layout;",
    "export const mutation: Bound['mutation'] = bound.mutation;",
    "export const publicAccess: Bound['publicAccess'] = bound.publicAccess;",
    "export const query: Bound['query'] = bound.query;",
    "export const route: Bound['route'] = bound.route;",
    "export const task: Bound['task'] = bound.task;",
    '',
  ].join('\n');
  const manifest = {
    appId: context.appId,
    compilerSourceSha256: options.artifacts.packages.compiler.sourceSha256,
    completed: 'complete',
    configSha256: sha256(configSource),
    generatedModuleSha256: sha256(moduleSource),
    ownerKey: `${context.appId}:${context.providerKey}`,
    providerKey: context.providerKey,
    providerSourceSha256: sha256(providerSource),
    schema: 'kovo.generated-app-contract/v5',
    serverPackedContentsSha256: options.artifacts.packages.server.packedContents.digest,
  };
  await atomicWrite(generatedFile, moduleSource);
  await atomicWrite(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    configFile: options.configFile,
    generatedFile,
    manifestFile,
    packageRoot: options.packageRoot,
    providerFile: options.providerFile,
    serverPackageRoot: options.serverPackageRoot,
  };
}

function providerContext(
  source: string,
  fileName: string,
): { readonly appId: string; readonly providerKey: string } {
  const observedAppId = source.match(/appId:\s*['"]([^'"]+)['"]/u)?.[1];
  const observedProviderKey = source.match(/providerKey:\s*['"]([^'"]+)['"]/u)?.[1];
  if (!observedAppId || !observedProviderKey) {
    throw new Error(`D1 provider context is not statically extractable from ${fileName}.`);
  }
  return { appId: observedAppId, providerKey: observedProviderKey };
}

async function writeMatrixFixtures(options: {
  readonly app: string;
  readonly consumer: string;
  readonly shared: string;
}): Promise<Record<MatrixCaseName, Record<AppContractArm, string>>> {
  const entries = {} as Record<MatrixCaseName, Record<AppContractArm, string>>;
  const write = async (
    name: MatrixCaseName,
    arm: AppContractArm,
    root: string,
    source: string,
  ): Promise<void> => {
    entries[name] ??= {} as Record<AppContractArm, string>;
    const fileName = join(root, `src/matrix/${name}-${arm}.ts`);
    await writeSource(fileName, source);
    entries[name][arm] = fileName;
  };
  const definition = '{ load() { return { status: "ok" } as const; } }';
  const providerImport = "import { app } from '../../kovo.js';";
  const armB = `import { query } from '#kovo';\nexport const item = query(${definition});\n`;

  await write(
    'ordinary-local-import',
    'arm-a',
    options.app,
    `${providerImport}\nexport const item = app.query(${definition});\n`,
  );
  await write('ordinary-local-import', 'arm-b', options.app, armB);
  await write(
    'named-re-export',
    'arm-a',
    options.app,
    `import { app } from '../../named.js';\nexport const item = app.query(${definition});\n`,
  );
  await write('named-re-export', 'arm-b', options.app, armB);
  await write(
    'star-re-export',
    'arm-a',
    options.app,
    `import { app } from '../../star.js';\nexport const item = app.query(${definition});\n`,
  );
  await write('star-re-export', 'arm-b', options.app, armB);
  await write(
    'aliased-import',
    'arm-a',
    options.app,
    `import { app as contacts } from '../../kovo.js';\nexport const item = contacts.query(${definition});\n`,
  );
  await write('aliased-import', 'arm-b', options.app, armB);

  const rejected: Readonly<
    Record<Exclude<MatrixCaseName, string & `duplicate-${string}`>, string>
  > = {
    'aliased-import': '',
    'array-derived-receiver': `${providerImport}\nconst active = [app][0]!;\nexport const item = active.query(${definition});\n`,
    'computed-factory-access': `${providerImport}\nexport const item = app['query'](${definition});\n`,
    'destructured-factory': `${providerImport}\nconst { query } = app;\nexport const item = query(${definition});\n`,
    'dynamic-factory-selection': `${providerImport}\ndeclare const choose: boolean;\nconst factory = choose ? app.query : app.query;\nexport const item = factory(${definition});\n`,
    'joined-receiver': `${providerImport}\ndeclare const choose: boolean;\nconst active = choose ? app : app;\nexport const item = active.query(${definition});\n`,
    'monorepo-shared-app-package': '',
    'mutable-receiver': `${providerImport}\nlet active = app;\nexport const item = active.query(${definition});\n`,
    'named-re-export': '',
    'object-derived-receiver': `${providerImport}\nconst active = ({ value: app }).value;\nexport const item = active.query(${definition});\n`,
    'ordinary-local-import': '',
    'reassigned-receiver': `${providerImport}\nconst active = app;\n// @ts-expect-error D1 probe\nactive = app;\nexport const item = active.query(${definition});\n`,
    'star-re-export': '',
    'wrapper-function': `${providerImport}\nconst wrapped = (value: Parameters<typeof app.query>[0]) => app.query(value);\nexport const item = wrapped(${definition});\n`,
    'wrapper-returned-receiver': `${providerImport}\nconst select = () => app;\nexport const item = select().query(${definition});\n`,
  };
  for (const name of [
    'destructured-factory',
    'wrapper-function',
    'dynamic-factory-selection',
    'object-derived-receiver',
    'array-derived-receiver',
    'wrapper-returned-receiver',
    'computed-factory-access',
    'mutable-receiver',
    'reassigned-receiver',
    'joined-receiver',
  ] as const) {
    await write(name, 'arm-a', options.app, rejected[name]);
    await write(name, 'arm-b', options.app, armB);
  }
  await write(
    'monorepo-shared-app-package',
    'arm-a',
    options.shared,
    `import { app } from '@fixture/app/provider';\nexport const item = app.query(${definition});\n`,
  );
  await write('monorepo-shared-app-package', 'arm-b', options.shared, armB);

  const duplicateSource = (
    left: '/named' | '/provider' | '/star',
    right: '/named' | '/provider' | '/star',
    sameOwner: boolean,
  ): string =>
    [
      `import { app as primary } from '@fixture/app${left}';`,
      `import { ${sameOwner ? 'sameOwnerApp' : 'app'} as secondary } from '@fixture/secondary${right}';`,
      `export const first = primary.query(${definition});`,
      `export const second = secondary.query(${definition});`,
      '',
    ].join('\n');
  const duplicateCases = [
    ['duplicate-direct-copies', '/provider', '/provider', false],
    ['duplicate-named-reexport-copies', '/named', '/named', false],
    ['duplicate-star-reexport-copies', '/star', '/star', false],
    ['duplicate-same-owner-key-copies', '/provider', '/provider', true],
  ] as const;
  for (const [name, left, right, sameOwner] of duplicateCases) {
    const source = duplicateSource(left, right, sameOwner);
    await write(name, 'arm-a', options.consumer, source);
    await write(name, 'arm-b', options.consumer, source);
  }
  return entries;
}

async function writeFamilyFixtures(
  app: string,
): Promise<Record<DeclarationFamily, Record<AppContractArm | 'baseline', string>>> {
  const entries = {} as Record<DeclarationFamily, Record<AppContractArm | 'baseline', string>>;
  for (const family of declarationFamilies) {
    entries[family] = {} as Record<AppContractArm | 'baseline', string>;
    for (const variant of ['baseline', 'arm-a', 'arm-b'] as const) {
      const extension = family === 'layout' || family === 'route' ? 'tsx' : 'ts';
      const fileName = join(app, `src/families/${variant}/${family}.${extension}`);
      await writeSource(fileName, familySource(family, variant));
      entries[family][variant] = fileName;
    }
  }
  return entries;
}

function familySource(family: DeclarationFamily, variant: AppContractArm | 'baseline'): string {
  const factory = variant === 'arm-a' ? `app.${family}` : family;
  const imports =
    variant === 'arm-b'
      ? `import { ${family}, publicAccess${family === 'layout' ? ', route' : ''} } from '#kovo';`
      : [
          `import { ${family}, publicAccess${family === 'layout' ? ', route' : ''} } from '@kovojs/server';`,
          "import { app } from '../../../src/kovo.js';",
        ].join('\n');
  if (family === 'layout') {
    const routeFactory = variant === 'arm-a' ? 'app.route' : 'route';
    return [
      '/** @jsxImportSource @kovojs/server */',
      imports,
      `const Shell = ${factory}({`,
      '  render: (_queries, _state, { children }) => <main>{children}</main>,',
      '});',
      `export const declaration = ${routeFactory}('/layout-probe', {`,
      '  layout: Shell,',
      '  page: () => <p>probe</p>,',
      '});',
      '',
    ].join('\n');
  }
  if (family === 'route') {
    return [
      '/** @jsxImportSource @kovojs/server */',
      imports,
      `export const declaration = ${factory}('/probe', { page: () => <p>probe</p> });`,
      '',
    ].join('\n');
  }
  const definition =
    family === 'endpoint'
      ? `'/probe', { access: publicAccess('D1 v5'), handler() { return new Response('ok'); } }`
      : family === 'mutation'
        ? `{ access: publicAccess('D1 v5'), handler() { return { ok: true } as const; } }`
        : family === 'task'
          ? `{ run() { return { ok: true } as const; } }`
          : `{ access: publicAccess('D1 v5'), load() { return { status: 'ok' } as const; } }`;
  return `${imports}\nexport const declaration = ${factory}(${definition});\n`;
}

async function writeRuntimeFixtures(app: string): Promise<Record<AppContractArm, string>> {
  const entries = {} as Record<AppContractArm, string>;
  for (const arm of ['arm-a', 'arm-b'] as const) {
    const fileName = join(app, `src/runtime/${arm}.ts`);
    const imports =
      arm === 'arm-a'
        ? "import { app } from '../kovo.ts';"
        : "import { endpoint, layout, mutation, query, route, task } from '#kovo';";
    const factory = (family: DeclarationFamily): string =>
      arm === 'arm-a' ? `app.${family}` : family;
    await writeSource(
      fileName,
      [
        imports,
        `export const queryHandle = ${factory('query')}({ load() { return { ok: true }; } });`,
        `export const mutationHandle = ${factory('mutation')}({ handler() { return { ok: true }; } });`,
        `export const endpointHandle = ${factory('endpoint')}('/runtime', { handler() { return new Response('ok'); } });`,
        `export const taskHandle = ${factory('task')}({ run() { return { ok: true }; } });`,
        `export const layoutHandle = ${factory('layout')}({});`,
        `export const routeHandle = ${factory('route')}('/runtime', { page() { return 'ok'; } });`,
        '',
      ].join('\n'),
    );
    entries[arm] = fileName;
  }
  return entries;
}

function primaryProviderSource(): string {
  return [
    "import { defineKovo } from '@kovojs/server';",
    'const probe = globalThis as typeof globalThis & { __d1ProviderEvaluations?: number };',
    'const lazyDb = () => { probe.__d1ProviderEvaluations = (probe.__d1ProviderEvaluations ?? 0) + 1; return { source: "db" } as const; };',
    'const lazyEnv = () => { probe.__d1ProviderEvaluations = (probe.__d1ProviderEvaluations ?? 0) + 1; return { stage: "test" } as const; };',
    'export const app = defineKovo({',
    `  appId: '${appId}',`,
    '  db: lazyDb,',
    '  env: lazyEnv,',
    `  providerKey: '${providerKey}',`,
    '});',
    '',
  ].join('\n');
}

function secondaryProviderSource(): string {
  return [
    "import { defineKovo } from '@kovojs/server';",
    'export const app = defineKovo({',
    `  appId: '${appId}',`,
    "  providerKey: 'billing-provider',",
    '});',
    'export const sameOwnerApp = defineKovo({',
    `  appId: '${appId}',`,
    `  providerKey: '${providerKey}',`,
    '});',
    '',
  ].join('\n');
}

async function linkFixtureDependencies(
  packageRoot: string,
  serverRoot: string,
  appRoot?: string,
): Promise<void> {
  await linkPackage(packageRoot, '@kovojs/server', serverRoot);
  if (appRoot) await linkPackage(packageRoot, '@fixture/app', appRoot);
}

async function linkKovoDependency(
  packageRoot: string,
  packageName: string,
  target: string,
): Promise<void> {
  await linkPackage(packageRoot, `@kovojs/${packageName}`, target);
}

async function linkPackage(packageRoot: string, name: string, target: string): Promise<void> {
  const link = join(packageRoot, 'node_modules', ...name.split('/'));
  await mkdir(dirname(link), { recursive: true });
  await symlink(target, link, 'dir');
}

async function writePackageManifest(
  packageRoot: string,
  name: string,
  additions: Readonly<Record<string, unknown>>,
): Promise<void> {
  await writeJson(join(packageRoot, 'package.json'), {
    ...additions,
    name,
    private: true,
    type: 'module',
  });
}

function generatedDiagnostic(fileName: string, code: string, message: string): PrototypeDiagnostic {
  return { code, fileName, length: 1, message, start: 0 };
}

function generatedDigestDiagnosticCode(field: string): string {
  switch (field) {
    case 'providerSourceSha256':
      return 'D1B101';
    case 'configSha256':
      return 'D1B102';
    case 'compilerSourceSha256':
      return 'D1B103';
    case 'serverPackedContentsSha256':
      return 'D1B104';
    case 'generatedModuleSha256':
      return 'D1B105';
    default:
      return 'D1B109';
  }
}

async function atomicWrite(fileName: string, source: string): Promise<void> {
  const temporary = `${fileName}.tmp`;
  await writeSource(temporary, source);
  await rename(temporary, fileName);
}

async function writeJson(fileName: string, value: unknown): Promise<void> {
  await writeSource(fileName, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeSource(fileName: string, source: string): Promise<void> {
  await mkdir(dirname(fileName), { recursive: true });
  await writeFile(fileName, source);
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
