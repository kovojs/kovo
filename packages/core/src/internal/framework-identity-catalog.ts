import {
  freezeSecurityValue,
  securityArrayAppend,
  securityMap,
  securityMapGet,
  securityMapSet,
  securityOwnArrayEntry,
  securitySet,
  securitySetAdd,
  securitySetForEach,
} from '#security-witness-intrinsics';

import { generatedHeadlessClientExecutableIdentities } from './generated-headless-client-executable-identities.js';

/** @internal Canonical package identity used by compiler/static gates. */
export type FrameworkIdentityModule =
  | '@kovojs/browser'
  | '@kovojs/core'
  | '@kovojs/drizzle'
  | '@kovojs/headless-ui'
  | '@kovojs/server'
  | '@kovojs/style'
  | 'drizzle-orm';

/** @internal Identity scopes make the shared catalog reviewable by analyzer surface. */
export type FrameworkIdentityScope =
  | 'authoring'
  | 'data-plane'
  | 'drizzle-sql'
  | 'rendering'
  | 'routing';

/** @internal Canonical framework export identity after import/subpath/re-export normalization. */
export interface FrameworkExportIdentity {
  readonly exportName: string;
  readonly module: FrameworkIdentityModule;
}

/** @internal Manifest row for one recognized framework export. */
export interface FrameworkIdentityCatalogEntry extends FrameworkExportIdentity {
  /** Review metadata only; app-supplied source paths never establish framework identity. */
  readonly packageSourceFiles?: readonly string[];
  readonly scopes: readonly FrameworkIdentityScope[];
  readonly specifiers: readonly string[];
}

const SERVER_DATA_SPECIFIERS = ['@kovojs/server'] as const;
const SERVER_APP_SPECIFIERS = ['@kovojs/server'] as const;
const SERVER_ROUTING_SPECIFIERS = ['@kovojs/server'] as const;
const SERVER_RENDERING_SPECIFIERS = ['@kovojs/server'] as const;
const SERVER_WRITE_GOVERNANCE_SPECIFIERS = ['@kovojs/server/write-safety'] as const;
const SERVER_COMMAND_SPECIFIERS = ['@kovojs/server/command'] as const;
const CORE_STORAGE_SPECIFIERS = ['@kovojs/core/storage'] as const;
const CORE_SCOPED_KEY_SPECIFIERS = ['@kovojs/core'] as const;
const CORE_SECURITY_SPECIFIERS = ['@kovojs/core/security'] as const;

const serverDataSourceFiles = ['domain', 'index', 'mutation', 'query', 'schema'] as const;
const serverAppSourceFiles = ['app-contract', 'index'] as const;
const serverRoutingSourceFiles = ['endpoint', 'guards', 'index', 'route'] as const;
const serverRenderingSourceFiles = ['index', 'rendering/html/safe-html'] as const;
const serverWriteGovernanceSourceFiles = ['public-write-safety', 'write-governance'] as const;

function serverData(exportName: string): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: '@kovojs/server',
    packageSourceFiles: serverDataSourceFiles,
    scopes: ['authoring', 'data-plane'],
    specifiers: SERVER_DATA_SPECIFIERS,
  };
}

function serverApp(exportName: string): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: '@kovojs/server',
    packageSourceFiles: serverAppSourceFiles,
    scopes: ['authoring', 'routing'],
    specifiers: SERVER_APP_SPECIFIERS,
  };
}

function serverRouting(exportName: string): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: '@kovojs/server',
    packageSourceFiles: serverRoutingSourceFiles,
    scopes: ['authoring', 'routing'],
    specifiers: SERVER_ROUTING_SPECIFIERS,
  };
}

function serverRendering(
  exportName: string,
  module: '@kovojs/browser' | '@kovojs/server' = '@kovojs/server',
): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module,
    packageSourceFiles:
      module === '@kovojs/browser' ? ['index', 'security-output'] : serverRenderingSourceFiles,
    scopes: ['authoring', 'rendering'],
    specifiers: module === '@kovojs/browser' ? ['@kovojs/browser'] : SERVER_RENDERING_SPECIFIERS,
  };
}

function serverCsrfAuthoring(exportName: string): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: '@kovojs/server',
    packageSourceFiles: ['csrf', 'public-security'],
    scopes: ['authoring', 'rendering', 'routing'],
    specifiers: ['@kovojs/server/security'],
  };
}

function serverInternalRendering(exportName: string): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: '@kovojs/server',
    packageSourceFiles: ['html', 'internal/html'],
    scopes: ['rendering'],
    specifiers: ['@kovojs/server/internal/html'],
  };
}

function serverJsxRuntime(exportName: string): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: '@kovojs/server',
    packageSourceFiles: ['jsx-runtime'],
    scopes: ['authoring', 'rendering'],
    specifiers: ['@kovojs/server/jsx-runtime', '@kovojs/server/jsx-dev-runtime'],
  };
}

function serverWriteGovernance(exportName: string): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: '@kovojs/server',
    packageSourceFiles: serverWriteGovernanceSourceFiles,
    scopes: ['data-plane'],
    specifiers: SERVER_WRITE_GOVERNANCE_SPECIFIERS,
  };
}

function serverCommand(exportName: string): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: '@kovojs/server',
    packageSourceFiles: ['command', 'public-command'],
    scopes: ['authoring', 'data-plane'],
    specifiers: SERVER_COMMAND_SPECIFIERS,
  };
}

function serverTaskSurface(
  exportName: string,
  specifier: string,
  packageSourceFiles: readonly string[],
  scopes: readonly FrameworkIdentityScope[] = ['authoring', 'data-plane'],
): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: '@kovojs/server',
    packageSourceFiles,
    scopes,
    specifiers: [specifier],
  };
}

function coreStorage(exportName: string): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: '@kovojs/core',
    packageSourceFiles: ['index', 'scoped-key', 'storage', 'storage-public'],
    scopes: ['authoring', 'data-plane'],
    specifiers: CORE_STORAGE_SPECIFIERS,
  };
}

function coreScopedKey(exportName: string): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: '@kovojs/core',
    packageSourceFiles: ['index', 'scoped-key'],
    scopes: ['authoring', 'data-plane'],
    specifiers: CORE_SCOPED_KEY_SPECIFIERS,
  };
}

function coreAuthoring(exportName: string): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: '@kovojs/core',
    packageSourceFiles: ['index'],
    scopes: ['authoring'],
    specifiers: ['@kovojs/core'],
  };
}

function coreSecurity(exportName: string): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: '@kovojs/core',
    packageSourceFiles: ['secret', 'security'],
    scopes: ['authoring'],
    specifiers: CORE_SECURITY_SPECIFIERS,
  };
}

function headlessHandler(exportName: string, specifier: string): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: '@kovojs/headless-ui',
    scopes: ['authoring'],
    specifiers: [specifier],
  };
}

// SPEC §13.1 / §6.6: recognize the exact public TSX style calls the compiler reviews. Do not
// promote the rest of the package (or its internal extraction ABI) into classifier authority.
function styleAuthoring(exportName: string): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: '@kovojs/style',
    packageSourceFiles: ['engine', 'index'],
    scopes: ['authoring', 'rendering'],
    specifiers: ['@kovojs/style'],
  };
}

function drizzleSql(exportName: string): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: '@kovojs/drizzle',
    packageSourceFiles: ['drizzle-surface', 'runtime'],
    scopes: ['data-plane', 'drizzle-sql'],
    specifiers: ['@kovojs/drizzle'],
  };
}

function drizzleOrmSql(exportName: string): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: 'drizzle-orm',
    scopes: ['data-plane', 'drizzle-sql'],
    specifiers: ['drizzle-orm'],
  };
}

function drizzleOrmSchema(
  exportName: string,
  specifier: 'drizzle-orm/pg-core' | 'drizzle-orm/sqlite-core',
): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: 'drizzle-orm',
    scopes: ['data-plane'],
    specifiers: [specifier],
  };
}

const catalogEntries: FrameworkIdentityCatalogEntry[] = [];

appendCatalogEntry(catalogEntries, serverApp('defineKovo'));

appendCatalogFactories(catalogEntries, ['domain', 'mutation', 'query', 's', 'tag'], serverData);
appendCatalogEntry(
  catalogEntries,
  serverTaskSurface('agent', '@kovojs/server/agent', ['agent', 'public-agent']),
);
appendCatalogEntry(
  catalogEntries,
  serverTaskSurface('tool', '@kovojs/server/agent', ['agent', 'public-agent']),
);
appendCatalogEntry(
  catalogEntries,
  serverTaskSurface('declareSecretReadCapability', '@kovojs/server/secret-reading', [
    'public-secret-reading',
    'secret-read-boundary',
  ]),
);
appendCatalogEntry(
  catalogEntries,
  serverTaskSurface('scopedKey', '@kovojs/server/storage-keys', [
    'public-storage-keys',
    'state-key',
  ]),
);
appendCatalogEntry(
  catalogEntries,
  serverTaskSurface('task', '@kovojs/server/tasks', ['public-tasks', 'task']),
);
appendCatalogEntry(
  catalogEntries,
  serverTaskSurface(
    'webhook',
    '@kovojs/server/webhooks',
    ['public-webhooks', 'webhook'],
    ['authoring', 'routing'],
  ),
);
appendCatalogEntry(
  catalogEntries,
  serverTaskSurface(
    'rootedFiles',
    '@kovojs/server/files',
    ['file', 'public-files'],
    ['authoring', 'routing'],
  ),
);
appendCatalogFactories(
  catalogEntries,
  [
    'endpoint',
    'guard',
    'guards',
    'layout',
    'notFound',
    'publicAccess',
    'respond',
    'route',
    'verifiedAccess',
  ],
  serverRouting,
);
appendCatalogEntry(catalogEntries, serverRendering('safeRichHtml'));
appendCatalogEntry(catalogEntries, serverRendering('trustedHtml', '@kovojs/browser'));
appendCatalogEntry(catalogEntries, serverRendering('trustedUrl', '@kovojs/browser'));
appendCatalogFactories(catalogEntries, ['mintCsrfField', 'mintCsrfToken'], serverCsrfAuthoring);
appendCatalogEntry(catalogEntries, serverInternalRendering('renderedHtml'));
appendCatalogFactories(
  catalogEntries,
  ['createElement', 'jsx', 'jsxDEV', 'jsxs'],
  serverJsxRuntime,
);
appendCatalogEntry(catalogEntries, serverWriteGovernance('trustedAssign'));
appendCatalogEntry(
  catalogEntries,
  serverTaskSurface('encryptAtRest', '@kovojs/server/confidential', [
    'confidential-at-rest',
    'public-confidential',
  ]),
);
appendCatalogEntry(
  catalogEntries,
  serverTaskSurface('derived', '@kovojs/server/derived-data', [
    'derived-dataset',
    'public-derived-data',
  ]),
);
appendCatalogEntry(
  catalogEntries,
  serverTaskSurface('hashPassword', '@kovojs/server/password', ['password', 'public-password']),
);
appendCatalogEntry(catalogEntries, serverWriteGovernance('serverValue'));
appendCatalogEntry(catalogEntries, serverData('stream'));
appendCatalogFactories(catalogEntries, ['cmd', 'commandAllowlist', 'runCommand'], serverCommand);
appendCatalogFactories(
  catalogEntries,
  ['createFileSystemStorage', 'createS3CompatibleStorage'],
  coreStorage,
);
appendCatalogEntry(catalogEntries, coreScopedKey('publicScopedKey'));
appendCatalogFactories(catalogEntries, ['component', 'redirect'], coreAuthoring);
appendCatalogFactories(
  catalogEntries,
  [
    'DeclassifyPolicy',
    'declareOffWire',
    'publishToClient',
    'revealSecret',
    'revealUntrusted',
    'secret',
    'trustedReveal',
  ],
  coreSecurity,
);
for (let index = 0; index < generatedHeadlessClientExecutableIdentities.length; index += 1) {
  const entry = securityOwnArrayEntry(generatedHeadlessClientExecutableIdentities, index);
  if (!entry.ok) {
    throw new TypeError(
      `Generated Headless UI client executable identities[${index}] must be dense.`,
    );
  }
  appendCatalogEntry(
    catalogEntries,
    headlessHandler(entry.value.exportName, entry.value.specifier),
  );
}
appendCatalogEntry(catalogEntries, styleAuthoring('create'));
appendCatalogEntry(catalogEntries, serverRendering('safeRichHtml', '@kovojs/browser'));
appendCatalogFactories(
  catalogEntries,
  ['kovo', 'kovoAnalyzerSummary', 'sql', 'staticSql', 'trustedSql'],
  drizzleSql,
);
appendCatalogFactories(
  catalogEntries,
  [
    'and',
    'arrayContained',
    'arrayContains',
    'arrayOverlaps',
    'asc',
    'avg',
    'avgDistinct',
    'between',
    'count',
    'countDistinct',
    'desc',
    'eq',
    'exists',
    'gt',
    'gte',
    'ilike',
    'inArray',
    'isNotNull',
    'isNull',
    'like',
    'lt',
    'lte',
    'max',
    'min',
    'ne',
    'not',
    'notBetween',
    'notExists',
    'notIlike',
    'notInArray',
    'or',
    'sql',
    'sum',
    'sumDistinct',
  ],
  drizzleOrmSql,
);
appendCatalogEntry(catalogEntries, drizzleOrmSchema('pgTable', 'drizzle-orm/pg-core'));
appendCatalogEntry(catalogEntries, drizzleOrmSchema('sqliteTable', 'drizzle-orm/sqlite-core'));
appendCatalogEntry(catalogEntries, drizzleOrmSchema('alias', 'drizzle-orm/pg-core'));
appendCatalogEntry(catalogEntries, drizzleOrmSchema('alias', 'drizzle-orm/sqlite-core'));

/** @internal Shared manifest-backed export catalog for TS and ts-morph identity adapters. */
export const frameworkIdentityCatalog: readonly FrameworkIdentityCatalogEntry[] =
  freezeSecurityValue(catalogEntries);

function appendCatalogFactories(
  target: FrameworkIdentityCatalogEntry[],
  exportNames: readonly string[],
  factory: (exportName: string) => FrameworkIdentityCatalogEntry,
): void {
  for (let index = 0; index < exportNames.length; index += 1) {
    const entry = securityOwnArrayEntry(exportNames, index);
    if (!entry.ok) throw new TypeError(`Framework identity export names[${index}] must be dense.`);
    appendCatalogEntry(target, factory(entry.value));
  }
}

function appendCatalogEntry(
  target: FrameworkIdentityCatalogEntry[],
  entry: FrameworkIdentityCatalogEntry,
): void {
  securityArrayAppend(
    target,
    freezeSecurityValue({
      exportName: entry.exportName,
      module: entry.module,
      ...(entry.packageSourceFiles === undefined
        ? {}
        : {
            packageSourceFiles: freezeStringArray(entry.packageSourceFiles, 'package source files'),
          }),
      scopes: freezeStringArray(entry.scopes, 'scopes') as readonly FrameworkIdentityScope[],
      specifiers: freezeStringArray(entry.specifiers, 'specifiers'),
    }),
  );
}

function freezeStringArray(values: readonly string[], label: string): readonly string[] {
  const snapshot: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const entry = securityOwnArrayEntry(values, index);
    if (!entry.ok) throw new TypeError(`Framework identity ${label}[${index}] must be dense.`);
    securityArrayAppend(snapshot, entry.value);
  }
  return freezeSecurityValue(snapshot);
}

const moduleSpecifierIndex = securityMap<string, Map<string, FrameworkExportIdentity>>();
const moduleExportIndex = securityMap<FrameworkIdentityModule, Set<string>>();

for (let index = 0; index < frameworkIdentityCatalog.length; index += 1) {
  const catalogEntry = securityOwnArrayEntry(frameworkIdentityCatalog, index);
  if (!catalogEntry.ok) {
    throw new TypeError(`Framework identity catalog[${index}] must be dense.`);
  }
  const entry = catalogEntry.value;
  let exports = securityMapGet(moduleExportIndex, entry.module);
  if (!exports) {
    exports = securitySet();
    securityMapSet(moduleExportIndex, entry.module, exports);
  }
  securitySetAdd(exports, entry.exportName);

  for (let offset = 0; offset < entry.specifiers.length; offset += 1) {
    const specifierEntry = securityOwnArrayEntry(entry.specifiers, offset);
    if (!specifierEntry.ok) {
      throw new TypeError(`Framework identity specifiers[${offset}] must be dense.`);
    }
    const specifier = specifierEntry.value;
    let specifierExports = securityMapGet(moduleSpecifierIndex, specifier);
    if (!specifierExports) {
      specifierExports = securityMap();
      securityMapSet(moduleSpecifierIndex, specifier, specifierExports);
    }
    securityMapSet(
      specifierExports,
      entry.exportName,
      freezeSecurityValue({
        exportName: entry.exportName,
        module: entry.module,
      }),
    );
  }
}

/** @internal */
export function frameworkCatalogExportForModuleSpecifier(
  specifier: string | undefined,
  exportName: string,
): FrameworkExportIdentity | undefined {
  if (!specifier) return undefined;
  const exports = securityMapGet(moduleSpecifierIndex, specifier);
  return exports && securityMapGet(exports, exportName);
}

// SPEC §6.6 keeps classifier identity provenance-bound. Callers intentionally get no source-path
// lookup: in-memory app projects control their file names and can spell nested paths that resemble
// `packages/*/src` or `node_modules`, so only exact reviewed module specifiers establish authority.

/** @internal */
export function frameworkCatalogExportsForModule(
  module: FrameworkIdentityModule,
): ReadonlySet<string> {
  const snapshot = securitySet<string>();
  const exports = securityMapGet(moduleExportIndex, module);
  if (exports) {
    securitySetForEach(exports, (exportName) => {
      securitySetAdd(snapshot, exportName);
    });
  }
  return snapshot;
}
