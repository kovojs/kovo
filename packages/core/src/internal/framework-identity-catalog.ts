/** @internal Canonical package identity used by compiler/static gates. */
export type FrameworkIdentityModule =
  | '@kovojs/browser'
  | '@kovojs/core'
  | '@kovojs/drizzle'
  | '@kovojs/server'
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
const SERVER_ROUTING_SPECIFIERS = ['@kovojs/server', '@kovojs/server/api/routing'] as const;
const SERVER_RENDERING_SPECIFIERS = ['@kovojs/server', '@kovojs/server/api/rendering'] as const;
const SERVER_WRITE_GOVERNANCE_SPECIFIERS = [
  '@kovojs/server',
  '@kovojs/server/write-governance',
] as const;

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

function coreAuthoring(exportName: string): FrameworkIdentityCatalogEntry {
  return {
    exportName,
    module: '@kovojs/core',
    packageSourceFiles: ['index', 'secret'],
    scopes: ['authoring'],
    specifiers: ['@kovojs/core'],
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

/** @internal Shared manifest-backed export catalog for TS and ts-morph identity adapters. */
export const frameworkIdentityCatalog = [
  ...['domain', 'mutation', 'query', 'Reader', 's', 'tag', 'task', 'write'].map(serverData),
  ...[
    'endpoint',
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
  ].map(serverRouting),
  serverRendering('safeRichHtml'),
  serverRendering('trustedHtml', '@kovojs/browser'),
  serverRendering('trustedUrl', '@kovojs/browser'),
  serverBrowserRenderingReExport('trustedHtml'),
  serverBrowserRenderingReExport('trustedUrl'),
  serverInternalRendering('renderedHtml'),
  ...['trustedAssign', 'encryptAtRest', 'hashPassword', 'serverValue', 'stream'].map((exportName) =>
    exportName === 'trustedAssign' || exportName === 'serverValue'
      ? serverWriteGovernance(exportName)
      : serverData(exportName),
  ),
  ...['component', 'declareOffWire', 'publishToClient', 'trustedReveal'].map(coreAuthoring),
  serverRendering('safeRichHtml', '@kovojs/browser'),
  ...['kovo', 'kovoAnalyzerSummary', 'sql', 'staticSql', 'trustedSql'].map(drizzleSql),
  ...[
    'avg',
    'avgDistinct',
    'count',
    'countDistinct',
    'max',
    'min',
    'sql',
    'sum',
    'sumDistinct',
  ].map(drizzleOrmSql),
] as const satisfies readonly FrameworkIdentityCatalogEntry[];

const moduleSpecifierIndex = new Map<string, Map<string, FrameworkExportIdentity>>();
const moduleExportIndex = new Map<FrameworkIdentityModule, Set<string>>();

for (const entry of frameworkIdentityCatalog) {
  let exports = moduleExportIndex.get(entry.module);
  if (!exports) {
    exports = new Set();
    moduleExportIndex.set(entry.module, exports);
  }
  exports.add(entry.exportName);

  for (const specifier of entry.specifiers) {
    let specifierExports = moduleSpecifierIndex.get(specifier);
    if (!specifierExports) {
      specifierExports = new Map();
      moduleSpecifierIndex.set(specifier, specifierExports);
    }
    specifierExports.set(entry.exportName, {
      exportName: entry.exportName,
      module: entry.module,
    });
  }
}

/** @internal */
export function frameworkCatalogExportForModuleSpecifier(
  specifier: string | undefined,
  exportName: string,
): FrameworkExportIdentity | undefined {
  if (!specifier) return undefined;
  return moduleSpecifierIndex.get(specifier)?.get(exportName);
}

/** @internal */
export function frameworkCatalogExportsForModule(
  module: FrameworkIdentityModule,
): ReadonlySet<string> {
  return moduleExportIndex.get(module) ?? new Set();
}

/** @internal */
export function frameworkCatalogExportForSourcePath(
  filePath: string,
  exportName: string,
): FrameworkExportIdentity | undefined {
  const normalized = filePath.replaceAll('\\', '/');
  for (const entry of frameworkIdentityCatalog) {
    if (entry.exportName !== exportName) continue;
    if (entry.module === 'drizzle-orm') {
      if (normalized.includes('drizzle-orm')) return catalogIdentity(entry);
      continue;
    }
    const packageName = entry.module.slice('@kovojs/'.length);
    if (normalized.includes(`/@kovojs/${packageName}/`)) return catalogIdentity(entry);
    if (!entry.packageSourceFiles?.length) continue;
    const relative = normalized.split(`/packages/${packageName}/src/`)[1];
    if (!relative) continue;
    const withoutExtension = relative.replace(/\.[cm]?[jt]sx?$/u, '');
    if (entry.packageSourceFiles.includes(withoutExtension)) return catalogIdentity(entry);
  }
  return undefined;
}

function catalogIdentity(entry: FrameworkExportIdentity): FrameworkExportIdentity {
  return { exportName: entry.exportName, module: entry.module };
}
