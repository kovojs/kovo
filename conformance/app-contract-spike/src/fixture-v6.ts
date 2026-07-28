import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, realpath, rename, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import ts from 'typescript';

import {
  directorySubject,
  fileSubject,
  packSealedOverlay,
  type ContentSubject,
  type FileSubject,
  type FreshArtifactSet,
} from './artifacts-v6.ts';

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

const appId = '00000000-0000-4000-8000-000000000006';
const providerKey = 'contacts-provider-v6';
const providerExportBinding = 'contactsProvider';
const providerImportSpecifier = './provider.js';
const ownerKey = ownerKeyFor(appId, providerKey);

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
  readonly providerDefinitionFile: string;
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
  readonly serverCopyContents: readonly [ContentSubject, ContentSubject];
  readonly serverOverlayFiles: readonly FileSubject[];
  readonly serverOverlayTarball: string;
  readonly serverOverlayTarballSha256: string;
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
  await installSyntheticRuntimeOverlay(serverA);
  await installSyntheticRuntimeOverlay(serverB);
  await linkKovoDependency(serverA, 'core', core);
  await linkKovoDependency(serverA, 'browser', browser);
  await linkKovoDependency(serverB, 'core', core);
  await linkKovoDependency(serverB, 'browser', browser);
  const serverCopyContents = [
    await directorySubject(serverA),
    await directorySubject(serverB),
  ] as const;
  if (serverCopyContents[0].digest !== serverCopyContents[1].digest) {
    throw new Error('D1 v6 duplicate server copies differ after overlay writes.');
  }
  const serverOverlayFiles = await Promise.all(
    ['package.json', 'd1/index.d.mts', 'd1/index.mjs'].map((fileName) =>
      fileSubject(serverA, fileName),
    ),
  );
  const serverOverlay = await packSealedOverlay(
    serverA,
    join(root, 'sealed-packs/server-overlay'),
  );

  const app = join(root, 'app');
  const shared = join(root, 'packages/shared');
  const duplicate = join(root, 'packages/secondary');
  const consumer = join(root, 'packages/duplicate-consumer');
  await writePackageManifest(app, '@fixture/app', {
    exports: {
      './named': './src/named.ts',
      './provider': './src/kovo.ts',
      './generated': './src/generated.ts',
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
      './generated': './src/generated.ts',
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

  const configFile = join(app, 'src/kovo.config.ts');
  await writeSource(configFile, configSource());
  await writeSource(
    join(app, 'src/provider.ts'),
    `export const ${providerExportBinding} = { key: '${providerKey}' } as const;\n`,
  );
  const providerDefinitionFile = join(app, 'src/provider.ts');
  const providerFile = join(app, 'src/kovo.ts');
  await writeSource(providerFile, primaryProviderSource());
  await writeSource(join(app, 'src/named.ts'), "export { app } from './kovo.js';\n");
  await writeSource(join(app, 'src/star.ts'), "export * from './kovo.js';\n");
  await writeSource(join(app, 'src/generated.ts'), "export * from '#kovo';\n");
  await writeSource(join(app, 'src/generated-named.ts'), "export { query } from '#kovo';\n");
  await writeSource(join(app, 'src/generated-star.ts'), "export * from '#kovo';\n");
  const secondaryProviderFile = join(duplicate, 'src/kovo.ts');
  const duplicateConfigFile = join(duplicate, 'src/kovo.config.ts');
  await writeSource(duplicateConfigFile, configSource());
  await writeSource(
    join(duplicate, 'src/provider.ts'),
    [
      "export const billingProvider = { key: 'billing-provider-v6' } as const;",
      `export const ${providerExportBinding} = { key: '${providerKey}' } as const;`,
      '',
    ].join('\n'),
  );
  await writeSource(secondaryProviderFile, secondaryProviderSource());
  await writeSource(
    join(duplicate, 'src/named.ts'),
    "export { app, sameOwnerApp } from './kovo.js';\n",
  );
  await writeSource(join(duplicate, 'src/star.ts'), "export * from './kovo.js';\n");
  await writeSource(join(duplicate, 'src/generated.ts'), "export * from '#kovo';\n");

  const generatedApp = await generateBoundContract({
    artifacts,
    configFile,
    packageRoot: app,
    providerDefinitionFile,
    providerFile,
    serverPackageRoot: serverA,
  });
  const generatedShared = await generateBoundContract({
    artifacts,
    configFile,
    packageRoot: shared,
    providerDefinitionFile,
    providerFile,
    serverPackageRoot: serverA,
  });
  const generatedDuplicate = await generateBoundContract({
    appExportName: 'sameOwnerApp',
    artifacts,
    configFile: duplicateConfigFile,
    packageRoot: duplicate,
    providerDefinitionFile: join(duplicate, 'src/provider.ts'),
    providerFile,
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
    serverCopyContents,
    serverOverlayFiles,
    serverOverlayTarball: serverOverlay.tarball,
    serverOverlayTarballSha256: serverOverlay.sha256,
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
  const providerSource = await readFile(contract.providerDefinitionFile, 'utf8');
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
): Promise<void> {
  const manifestFile = join(packageRoot, 'package.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as {
    exports?: Record<string, unknown>;
    files?: string[];
  };
  manifest.exports = {
    ...(manifest.exports ?? {}),
    '.': {
      types: './d1/index.d.mts',
      default: './d1/index.mjs',
    },
  };
  manifest.files = [...new Set([...(manifest.files ?? []), 'd1'])].sort();
  await writeJson(manifestFile, manifest);
  await writeSource(join(packageRoot, 'd1/index.mjs'), syntheticRuntimeSource());
  await writeSource(join(packageRoot, 'd1/index.d.mts'), syntheticDeclarationSource());
}

function syntheticRuntimeSource(): string {
  return [
    "import { createHash } from 'node:crypto';",
    'export const d1PackageInstance = "d1-v6-authenticated-overlay";',
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
    'const ownerKeyFor = (metadata) => `d1v6:${createHash("sha256").update(JSON.stringify({',
    '  appId: metadata.appId,',
    '  providerExportBinding: metadata.providerExportBinding,',
    '  providerImportSpecifier: metadata.providerImportSpecifier,',
    '  providerKey: metadata.providerKey,',
    '})).digest("hex")}`;',
    'export function createD1BoundFactories(metadata) {',
    '  const owner = Object.freeze({',
    '    appId: metadata.appId,',
    '    ownerKey: ownerKeyFor(metadata),',
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
    '        if (!observed || observed.ownerKey !== ownerKeyFor(options)) {',
    '          throw new TypeError("D1OWN001 mixed app or Kovo package handle refused before assembly.");',
    '        }',
    '      }',
    '      return Object.freeze({ handleCount: handles.length, ownerKey: ownerKeyFor(options) });',
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
    '  metadata: { readonly appId: AppId; readonly providerExportBinding: string; readonly providerImportSpecifier: string; readonly providerKey: string },',
    '): D1BoundFactories<AppId>;',
    'export declare function defineKovo<const AppId extends string>(',
    '  options: { readonly appId: AppId; readonly db?: () => unknown; readonly env?: () => unknown; readonly provider: unknown; readonly providerExportBinding: string; readonly providerImportSpecifier: string; readonly providerKey: string },',
    '): D1App<AppId>;',
    'export declare function inspectD1Ownership(value: unknown):',
    '  | { readonly appId: string; readonly kind: string; readonly ownerKey: string; readonly packageInstance: string; readonly providerKey: string }',
    '  | null;',
    '',
  ].join('\n');
}

async function generateBoundContract(options: {
  readonly appExportName?: 'app' | 'sameOwnerApp';
  readonly artifacts: FreshArtifactSet;
  readonly configFile: string;
  readonly packageRoot: string;
  readonly providerDefinitionFile: string;
  readonly providerFile: string;
  readonly serverPackageRoot: string;
}): Promise<GeneratedContract> {
  const providerSource = await readFile(options.providerFile, 'utf8');
  const providerDefinitionSource = await readFile(options.providerDefinitionFile, 'utf8');
  const configSource = await readFile(options.configFile, 'utf8');
  const context = providerContext({
    appExportName: options.appExportName ?? 'app',
    configFile: options.configFile,
    configSource,
    providerDefinitionFile: options.providerDefinitionFile,
    providerDefinitionSource,
    providerFile: options.providerFile,
    providerSource,
  });
  const generatedFile = join(options.packageRoot, '.kovo/app.ts');
  const manifestFile = join(options.packageRoot, '.kovo/app.manifest.json');
  const providerImport = relative(dirname(generatedFile), options.providerFile)
    .replaceAll('\\', '/')
    .replace(/\.ts$/u, '.js');
  const normalizedProviderImport = providerImport.startsWith('.')
    ? providerImport
    : `./${providerImport}`;
  const importedApp = options.appExportName ?? 'app';
  const moduleSource = [
    '/* kovo-app-contract-prototype/v6: compiler generated; do not edit */',
    `import { ${importedApp} as app } from ${JSON.stringify(normalizedProviderImport)};`,
    "export { publicAccess } from '@kovojs/server';",
    'export const __kovoGeneratedContract = Object.freeze({',
    `  appId: ${JSON.stringify(context.appId)},`,
    `  compilerSourceSha256: ${JSON.stringify(options.artifacts.packages.compiler.sourceSha256)},`,
    `  ownerKey: ${JSON.stringify(
      ownerKeyFor(
        context.appId,
        context.providerKey,
        context.providerExportBinding,
        context.providerImportSpecifier,
      ),
    )},`,
    `  providerExportBinding: ${JSON.stringify(context.providerExportBinding)},`,
    `  providerImportSpecifier: ${JSON.stringify(context.providerImportSpecifier)},`,
    `  providerKey: ${JSON.stringify(context.providerKey)},`,
    `  serverPackedContentsSha256: ${JSON.stringify(
      options.artifacts.packages.server.packedContents.digest,
    )},`,
    '});',
    'export const endpoint: typeof app.endpoint = app.endpoint;',
    'export const layout: typeof app.layout = app.layout;',
    'export const mutation: typeof app.mutation = app.mutation;',
    'export const query: typeof app.query = app.query;',
    'export const route: typeof app.route = app.route;',
    'export const task: typeof app.task = app.task;',
    '',
  ].join('\n');
  const manifest = {
    appId: context.appId,
    compilerSourceSha256: options.artifacts.packages.compiler.sourceSha256,
    completed: 'complete',
    configSha256: sha256(configSource),
    generatedModuleSha256: sha256(moduleSource),
    ownerKey: ownerKeyFor(
      context.appId,
      context.providerKey,
      context.providerExportBinding,
      context.providerImportSpecifier,
    ),
    providerExportBinding: context.providerExportBinding,
    providerImportSpecifier: context.providerImportSpecifier,
    providerKey: context.providerKey,
    providerSourceSha256: sha256(providerDefinitionSource),
    schema: 'kovo.generated-app-contract/v6',
    serverPackedContentsSha256: options.artifacts.packages.server.packedContents.digest,
  };
  await atomicWrite(generatedFile, moduleSource);
  await atomicWrite(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    configFile: options.configFile,
    generatedFile,
    manifestFile,
    packageRoot: options.packageRoot,
    providerDefinitionFile: options.providerDefinitionFile,
    providerFile: options.providerFile,
    serverPackageRoot: options.serverPackageRoot,
  };
}

function providerContext(options: {
  readonly appExportName: string;
  readonly configFile: string;
  readonly configSource: string;
  readonly providerDefinitionFile: string;
  readonly providerDefinitionSource: string;
  readonly providerFile: string;
  readonly providerSource: string;
}): {
  readonly appId: string;
  readonly providerExportBinding: string;
  readonly providerImportSpecifier: string;
  readonly providerKey: string;
} {
  const configAst = ts.createSourceFile(
    options.configFile,
    options.configSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const configExport = configAst.statements.find(ts.isExportAssignment);
  const configObject = configExport
    ? objectLiteralFromExpression(configExport.expression)
    : undefined;
  if (!configObject) {
    throw new Error(`D1 config AST is not a frozen object: ${options.configFile}.`);
  }
  const config = {
    appId: stringLiteralProperty(configObject, 'appId'),
    providerExportBinding: stringLiteralProperty(configObject, 'providerExportBinding'),
    providerImportSpecifier: stringLiteralProperty(configObject, 'providerImportSpecifier'),
    providerKey: stringLiteralProperty(configObject, 'providerKey'),
    providerReference: identifierProperty(configObject, 'provider'),
  };
  if (
    !config.appId ||
    !config.providerExportBinding ||
    !config.providerImportSpecifier ||
    !config.providerKey ||
    config.providerReference !== config.providerExportBinding
  ) {
    throw new Error(`D1 config identity is not statically authenticated: ${options.configFile}.`);
  }

  const providerAst = ts.createSourceFile(
    options.providerFile,
    options.providerSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const appDeclaration = providerAst.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find(
      (declaration) =>
        ts.isIdentifier(declaration.name) && declaration.name.text === options.appExportName,
    );
  const appObject = appDeclaration?.initializer
    ? objectLiteralFromExpression(appDeclaration.initializer)
    : undefined;
  const providerImport = providerAst.statements
    .filter(ts.isImportDeclaration)
    .find(
      (statement) =>
        ts.isStringLiteralLike(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === config.providerImportSpecifier &&
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.elements.some(
          (specifier) => specifier.name.text === config.providerExportBinding,
        ),
    );
  if (
    !appObject ||
    !providerImport ||
    stringLiteralProperty(appObject, 'appId') !== config.appId ||
    stringLiteralProperty(appObject, 'providerKey') !== config.providerKey ||
    stringLiteralProperty(appObject, 'providerExportBinding') !== config.providerExportBinding ||
    stringLiteralProperty(appObject, 'providerImportSpecifier') !==
      config.providerImportSpecifier ||
    identifierProperty(appObject, 'provider') !== config.providerExportBinding
  ) {
    throw new Error(
      `D1 provider app AST disagrees with config: ${options.providerFile}: ${JSON.stringify({
        appId: appObject && stringLiteralProperty(appObject, 'appId'),
        foundApp: Boolean(appObject),
        foundImport: Boolean(providerImport),
        provider: appObject && identifierProperty(appObject, 'provider'),
        providerExportBinding:
          appObject && stringLiteralProperty(appObject, 'providerExportBinding'),
        providerImportSpecifier:
          appObject && stringLiteralProperty(appObject, 'providerImportSpecifier'),
        providerKey: appObject && stringLiteralProperty(appObject, 'providerKey'),
      })}.`,
    );
  }

  const definitionAst = ts.createSourceFile(
    options.providerDefinitionFile,
    options.providerDefinitionSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const providerDeclaration = definitionAst.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find(
      (declaration) =>
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === config.providerExportBinding,
    );
  const providerObject = providerDeclaration?.initializer
    ? objectLiteralFromExpression(providerDeclaration.initializer)
    : undefined;
  if (!providerObject || stringLiteralProperty(providerObject, 'key') !== config.providerKey) {
    throw new Error(
      `D1 provider definition AST disagrees with config: ${options.providerDefinitionFile}.`,
    );
  }
  return {
    appId: config.appId,
    providerExportBinding: config.providerExportBinding,
    providerImportSpecifier: config.providerImportSpecifier,
    providerKey: config.providerKey,
  };
}

function objectLiteralFromExpression(expression: ts.Expression): ts.ObjectLiteralExpression | undefined {
  const unwrapped = unwrapTsExpression(expression);
  if (ts.isObjectLiteralExpression(unwrapped)) return unwrapped;
  if (
    ts.isCallExpression(unwrapped) &&
    unwrapped.arguments.length === 1 &&
    ((ts.isPropertyAccessExpression(unwrapped.expression) &&
      ts.isIdentifier(unwrapped.expression.expression) &&
      unwrapped.expression.expression.text === 'Object' &&
      unwrapped.expression.name.text === 'freeze') ||
      (ts.isIdentifier(unwrapped.expression) && unwrapped.expression.text === 'defineKovo'))
  ) {
    const argument = unwrapTsExpression(unwrapped.arguments[0]!);
    return ts.isObjectLiteralExpression(argument) ? argument : undefined;
  }
  return undefined;
}

function stringLiteralProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): string | undefined {
  const property = object.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) &&
      ((ts.isIdentifier(candidate.name) && candidate.name.text === name) ||
        (ts.isStringLiteralLike(candidate.name) && candidate.name.text === name)),
  );
  const value = property ? unwrapTsExpression(property.initializer) : undefined;
  return value && ts.isStringLiteralLike(value) ? value.text : undefined;
}

function identifierProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): string | undefined {
  const property = object.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) &&
      ((ts.isIdentifier(candidate.name) && candidate.name.text === name) ||
        (ts.isStringLiteralLike(candidate.name) && candidate.name.text === name)),
  );
  const value = property ? unwrapTsExpression(property.initializer) : undefined;
  return value && ts.isIdentifier(value) ? value.text : undefined;
}

function unwrapTsExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
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
  const providerImport = "import { app } from '../kovo.js';";

  await write(
    'ordinary-local-import',
    'arm-a',
    options.app,
    `${providerImport}\nexport const item = app.query(${definition});\n`,
  );
  await write(
    'ordinary-local-import',
    'arm-b',
    options.app,
    `import { query } from '#kovo';\nexport const item = query(${definition});\n`,
  );
  await write(
    'named-re-export',
    'arm-a',
    options.app,
    `import { app } from '../named.js';\nexport const item = app.query(${definition});\n`,
  );
  await write(
    'named-re-export',
    'arm-b',
    options.app,
    `import { query } from '../generated-named.js';\nexport const item = query(${definition});\n`,
  );
  await write(
    'star-re-export',
    'arm-a',
    options.app,
    `import { app } from '../star.js';\nexport const item = app.query(${definition});\n`,
  );
  await write(
    'star-re-export',
    'arm-b',
    options.app,
    `import { query } from '../generated-star.js';\nexport const item = query(${definition});\n`,
  );
  await write(
    'aliased-import',
    'arm-a',
    options.app,
    `import { app as contacts } from '../kovo.js';\nexport const item = contacts.query(${definition});\n`,
  );
  await write(
    'aliased-import',
    'arm-b',
    options.app,
    `import { query as contactsQuery } from '#kovo';\nexport const item = contactsQuery(${definition});\n`,
  );

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
  }
  const generatedImport = "import { query } from '#kovo';";
  const generatedNamespaceImport = "import * as generated from '#kovo';";
  const rejectedArmB: Readonly<Record<(typeof matrixCaseNames)[number], string>> = {
    'aliased-import': '',
    'array-derived-receiver': `${generatedImport}\nconst active = [query][0]!;\nexport const item = active(${definition});\n`,
    'computed-factory-access': `${generatedNamespaceImport}\nexport const item = generated['query'](${definition});\n`,
    'destructured-factory': `${generatedNamespaceImport}\nconst { query } = generated;\nexport const item = query(${definition});\n`,
    'duplicate-direct-copies': '',
    'duplicate-named-reexport-copies': '',
    'duplicate-same-owner-key-copies': '',
    'duplicate-star-reexport-copies': '',
    'dynamic-factory-selection': `${generatedImport}\ndeclare const choose: boolean;\nconst factory = ({ left: query, right: query })[choose ? 'left' : 'right'];\nexport const item = factory(${definition});\n`,
    'joined-receiver': `${generatedImport}\ndeclare const choose: boolean;\nconst active = choose ? query : query;\nexport const item = active(${definition});\n`,
    'monorepo-shared-app-package': '',
    'mutable-receiver': `${generatedImport}\nlet active = query;\nexport const item = active(${definition});\n`,
    'named-re-export': '',
    'object-derived-receiver': `${generatedImport}\nconst active = ({ value: query }).value;\nexport const item = active(${definition});\n`,
    'ordinary-local-import': '',
    'reassigned-receiver': `${generatedImport}\nconst active = query;\n// @ts-expect-error D1 probe\nactive = query;\nexport const item = active(${definition});\n`,
    'star-re-export': '',
    'wrapper-function': `${generatedImport}\nconst wrapped = (value: Parameters<typeof query>[0]) => query(value);\nexport const item = wrapped(${definition});\n`,
    'wrapper-returned-receiver': `${generatedImport}\nconst select = () => query;\nexport const item = select()(${definition});\n`,
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
    await write(name, 'arm-b', options.app, rejectedArmB[name]);
  }
  await write(
    'monorepo-shared-app-package',
    'arm-a',
    options.shared,
    `import { app } from '@fixture/app/provider';\nexport const item = app.query(${definition});\n`,
  );
  await write(
    'monorepo-shared-app-package',
    'arm-b',
    options.shared,
    `import { query } from '#kovo';\nexport const item = query(${definition});\n`,
  );

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
    await write(name, 'arm-a', options.consumer, duplicateSource(left, right, sameOwner));
    const generatedSource = [
      "import { query as primaryQuery } from '@fixture/app/generated';",
      "import { query as secondaryQuery } from '@fixture/secondary/generated';",
      `export const first = primaryQuery(${definition});`,
      `export const second = secondaryQuery(${definition});`,
      `export const duplicatePath = ${JSON.stringify(`${left}:${right}:${String(sameOwner)}`)};`,
      '',
    ].join('\n');
    await write(name, 'arm-b', options.consumer, generatedSource);
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
  const directFactory = `direct${family[0]!.toUpperCase()}${family.slice(1)}`;
  const generatedFactory = `generated${family[0]!.toUpperCase()}${family.slice(1)}`;
  const factory =
    variant === 'arm-a'
      ? `app.${family}`
      : variant === 'arm-b'
        ? generatedFactory
        : directFactory;
  const imports = [
    `import { ${family} as ${directFactory}, publicAccess${
      family === 'layout' ? ', route as directRoute' : ''
    } } from '@kovojs/server';`,
    `import { ${family} as ${generatedFactory}${
      family === 'layout' ? ', route as generatedRoute' : ''
    } } from '#kovo';`,
    "import { app } from '../../../src/kovo.js';",
  ].join('\n');
  if (family === 'layout') {
    const routeFactory =
      variant === 'arm-a'
        ? 'app.route'
        : variant === 'arm-b'
          ? 'generatedRoute'
          : 'directRoute';
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
      ? `'/probe', { access: publicAccess('D1 v6'), handler() { return new Response('ok'); } }`
      : family === 'mutation'
        ? `{ access: publicAccess('D1 v6'), handler() { return { ok: true } as const; } }`
        : family === 'task'
          ? `{ run() { return { ok: true } as const; } }`
          : `{ access: publicAccess('D1 v6'), load() { return { status: 'ok' } as const; } }`;
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
    `import { ${providerExportBinding} } from '${providerImportSpecifier}';`,
    'const probe = globalThis as typeof globalThis & { __d1ProviderEvaluations?: number };',
    'const lazyDb = () => { probe.__d1ProviderEvaluations = (probe.__d1ProviderEvaluations ?? 0) + 1; return { source: "db" } as const; };',
    'const lazyEnv = () => { probe.__d1ProviderEvaluations = (probe.__d1ProviderEvaluations ?? 0) + 1; return { stage: "test" } as const; };',
    'export const app = defineKovo({',
    `  appId: '${appId}',`,
    '  db: lazyDb,',
    '  env: lazyEnv,',
    `  provider: ${providerExportBinding},`,
    `  providerExportBinding: '${providerExportBinding}',`,
    `  providerImportSpecifier: '${providerImportSpecifier}',`,
    `  providerKey: '${providerKey}',`,
    '});',
    '',
  ].join('\n');
}

function secondaryProviderSource(): string {
  return [
    "import { defineKovo } from '@kovojs/server';",
    "import { billingProvider, contactsProvider } from './provider.js';",
    'export const app = defineKovo({',
    `  appId: '${appId}',`,
    '  provider: billingProvider,',
    "  providerExportBinding: 'billingProvider',",
    `  providerImportSpecifier: '${providerImportSpecifier}',`,
    "  providerKey: 'billing-provider-v6',",
    '});',
    'export const sameOwnerApp = defineKovo({',
    `  appId: '${appId}',`,
    `  provider: ${providerExportBinding},`,
    `  providerExportBinding: '${providerExportBinding}',`,
    `  providerImportSpecifier: '${providerImportSpecifier}',`,
    `  providerKey: '${providerKey}',`,
    '});',
    '',
  ].join('\n');
}

function configSource(): string {
  return [
    `import { ${providerExportBinding} } from '${providerImportSpecifier}';`,
    'export default Object.freeze({',
    `  appId: '${appId}',`,
    `  provider: ${providerExportBinding},`,
    `  providerExportBinding: '${providerExportBinding}',`,
    `  providerImportSpecifier: '${providerImportSpecifier}',`,
    `  providerKey: '${providerKey}',`,
    '});',
    '',
  ].join('\n');
}

function ownerKeyFor(
  observedAppId: string,
  observedProviderKey: string,
  observedProviderExportBinding = providerExportBinding,
  observedProviderImportSpecifier = providerImportSpecifier,
): string {
  return `d1v6:${sha256(
    JSON.stringify({
      appId: observedAppId,
        providerExportBinding: observedProviderExportBinding,
        providerImportSpecifier: observedProviderImportSpecifier,
      providerKey: observedProviderKey,
    }),
  )}`;
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
