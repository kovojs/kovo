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
  securityStringCharCodeAt,
  securityStringSlice,
} from '#security-witness-intrinsics';

/** @internal Canonical package identity used by compiler/static gates. */
export type FrameworkIdentityModule =
  | '@kovojs/browser'
  | '@kovojs/core'
  | '@kovojs/drizzle'
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
  readonly packageSourceFiles?: readonly string[];
  readonly scopes: readonly FrameworkIdentityScope[];
  readonly specifiers: readonly string[];
}

const SERVER_DATA_SPECIFIERS = ['@kovojs/server', '@kovojs/server/api/data'] as const;
const SERVER_APP_SPECIFIERS = ['@kovojs/server'] as const;
const SERVER_ROUTING_SPECIFIERS = ['@kovojs/server', '@kovojs/server/api/routing'] as const;
const SERVER_RENDERING_SPECIFIERS = ['@kovojs/server', '@kovojs/server/api/rendering'] as const;
const SERVER_WRITE_GOVERNANCE_SPECIFIERS = [
  '@kovojs/server',
  '@kovojs/server/write-governance',
] as const;
const SERVER_COMMAND_SPECIFIERS = ['@kovojs/server'] as const;
const CORE_STORAGE_SPECIFIERS = ['@kovojs/core', '@kovojs/server'] as const;

const serverDataSourceFiles = [
  'api/data',
  'domain',
  'index',
  'managed-db',
  'mutation',
  'query',
  'schema',
  'task',
] as const;
const serverAppSourceFiles = ['app', 'index'] as const;
const serverRoutingSourceFiles = ['api/routing', 'endpoint', 'index', 'route', 'webhook'] as const;
const serverRenderingSourceFiles = ['api/rendering', 'index', 'rendering/html/safe-html'] as const;
const serverWriteGovernanceSourceFiles = ['index', 'write-governance'] as const;

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

function serverBrowserRenderingReExport(exportName: string): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: '@kovojs/browser',
    scopes: ['authoring', 'rendering'],
    specifiers: SERVER_RENDERING_SPECIFIERS,
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
    packageSourceFiles: ['command', 'index'],
    scopes: ['authoring', 'data-plane'],
    specifiers: SERVER_COMMAND_SPECIFIERS,
  };
}

function coreStorage(exportName: string): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: '@kovojs/core',
    packageSourceFiles: ['index', 'storage'],
    scopes: ['authoring', 'data-plane'],
    specifiers: CORE_STORAGE_SPECIFIERS,
  };
}

function coreAuthoring(exportName: string): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: '@kovojs/core',
    packageSourceFiles: ['index', 'secret'],
    scopes: ['authoring'],
    specifiers: ['@kovojs/core'],
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

const catalogEntries: FrameworkIdentityCatalogEntry[] = [];

appendCatalogEntry(catalogEntries, serverApp('createApp'));

appendCatalogFactories(
  catalogEntries,
  ['domain', 'mutation', 'query', 'Reader', 's', 'tag', 'task', 'write'],
  serverData,
);
appendCatalogFactories(
  catalogEntries,
  [
    'endpoint',
    'guard',
    'href',
    'layout',
    'Link',
    'notFound',
    'publicAccess',
    'redirect',
    'respond',
    'rootedFiles',
    'route',
    'verifiedAccess',
    'webhook',
  ],
  serverRouting,
);
appendCatalogEntry(catalogEntries, serverRendering('safeRichHtml'));
appendCatalogEntry(catalogEntries, serverRendering('trustedHtml', '@kovojs/browser'));
appendCatalogEntry(catalogEntries, serverRendering('trustedUrl', '@kovojs/browser'));
appendCatalogEntry(catalogEntries, serverBrowserRenderingReExport('trustedHtml'));
appendCatalogEntry(catalogEntries, serverBrowserRenderingReExport('trustedUrl'));
appendCatalogEntry(catalogEntries, serverInternalRendering('renderedHtml'));
appendCatalogEntry(catalogEntries, serverWriteGovernance('trustedAssign'));
appendCatalogEntry(catalogEntries, serverData('encryptAtRest'));
appendCatalogEntry(catalogEntries, serverData('hashPassword'));
appendCatalogEntry(catalogEntries, serverWriteGovernance('serverValue'));
appendCatalogEntry(catalogEntries, serverData('stream'));
appendCatalogFactories(catalogEntries, ['cmd', 'commandAllowlist', 'runCommand'], serverCommand);
appendCatalogFactories(
  catalogEntries,
  ['createFileSystemStorage', 'createS3CompatibleStorage'],
  coreStorage,
);
appendCatalogFactories(
  catalogEntries,
  ['component', 'declareOffWire', 'publishToClient', 'trustedReveal'],
  coreAuthoring,
);
appendCatalogFactories(catalogEntries, ['attrs', 'create'], styleAuthoring);
appendCatalogEntry(catalogEntries, serverRendering('safeRichHtml', '@kovojs/browser'));
appendCatalogFactories(
  catalogEntries,
  ['kovo', 'kovoAnalyzerSummary', 'sql', 'staticSql', 'trustedSql'],
  drizzleSql,
);
appendCatalogFactories(
  catalogEntries,
  ['avg', 'avgDistinct', 'count', 'countDistinct', 'max', 'min', 'sql', 'sum', 'sumDistinct'],
  drizzleOrmSql,
);

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

/** @internal */
export function frameworkCatalogExportForSourcePath(
  filePath: string,
  exportName: string,
): FrameworkExportIdentity | undefined {
  const normalized = normalizeCatalogPath(filePath);
  for (let index = 0; index < frameworkIdentityCatalog.length; index += 1) {
    const catalogEntry = securityOwnArrayEntry(frameworkIdentityCatalog, index);
    if (!catalogEntry.ok) {
      throw new TypeError(`Framework identity catalog[${index}] must be dense.`);
    }
    const entry = catalogEntry.value;
    if (entry.exportName !== exportName) continue;
    if (entry.module === 'drizzle-orm') {
      if (catalogStringIncludes(normalized, 'drizzle-orm')) return catalogIdentity(entry);
      continue;
    }
    const packageName = securityStringSlice(entry.module, '@kovojs/'.length);
    if (catalogStringIncludes(normalized, `/@kovojs/${packageName}/`)) {
      return catalogIdentity(entry);
    }
    if (!entry.packageSourceFiles?.length) continue;
    const sourceMarker = `/packages/${packageName}/src/`;
    const markerIndex = catalogStringIndexOf(normalized, sourceMarker);
    const relative =
      markerIndex < 0
        ? undefined
        : securityStringSlice(normalized, markerIndex + sourceMarker.length);
    if (!relative) continue;
    const withoutExtension = catalogSourcePathWithoutExtension(relative);
    if (catalogArrayIncludes(entry.packageSourceFiles, withoutExtension)) {
      return catalogIdentity(entry);
    }
  }
  return undefined;
}

function normalizeCatalogPath(value: string): string {
  let normalized = '';
  for (let index = 0; index < value.length; index += 1) {
    normalized +=
      securityStringCharCodeAt(value, index) === 0x5c
        ? '/'
        : securityStringSlice(value, index, index + 1);
  }
  return normalized;
}

function catalogStringIncludes(value: string, search: string): boolean {
  return catalogStringIndexOf(value, search) >= 0;
}

function catalogStringIndexOf(value: string, search: string): number {
  if (search.length === 0) return 0;
  for (let index = 0; index + search.length <= value.length; index += 1) {
    if (securityStringSlice(value, index, index + search.length) === search) return index;
  }
  return -1;
}

function catalogSourcePathWithoutExtension(value: string): string {
  const extensions = ['.tsx', '.jsx', '.mts', '.cts', '.mjs', '.cjs', '.ts', '.js'];
  for (let index = 0; index < extensions.length; index += 1) {
    const entry = securityOwnArrayEntry(extensions, index);
    if (!entry.ok) throw new TypeError(`Framework source extensions[${index}] must be dense.`);
    if (securityStringSlice(value, -entry.value.length) === entry.value) {
      return securityStringSlice(value, 0, value.length - entry.value.length);
    }
  }
  return value;
}

function catalogArrayIncludes(values: readonly string[], expected: string): boolean {
  for (let index = 0; index < values.length; index += 1) {
    const entry = securityOwnArrayEntry(values, index);
    if (!entry.ok) throw new TypeError(`Framework source files[${index}] must be dense.`);
    if (entry.value === expected) return true;
  }
  return false;
}

function catalogIdentity(entry: FrameworkExportIdentity): FrameworkExportIdentity {
  return freezeSecurityValue({ exportName: entry.exportName, module: entry.module });
}
