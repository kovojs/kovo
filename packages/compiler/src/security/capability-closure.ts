import type * as CoreGraph from '@kovojs/core/internal/graph';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import type { CompilerDiagnostic } from '../diagnostics.js';
import { scanCapabilityClosureModules } from '../scan/capability-closure.js';
import type {
  CapabilityClosureSourceFile,
  CapabilityPackageRequest,
  CapabilityRootKind,
  PackageCapabilitySummary,
  PackageCapabilitySummaryExport,
  RawCapabilityKind,
  ResolvedCapabilityPackage,
  ScannedCapabilityModule,
  ScannedExportBindingFact,
  ScannedImportFact,
} from './capability-closure-model.js';
import { packageCapabilitySummarySchema } from './capability-closure-model.js';

export type {
  CapabilityClosureSourceFile,
  CapabilityPackageRequest,
  CapabilityRootKind,
  PackageCapabilitySummary,
  PackageCapabilitySummaryEntry,
  PackageCapabilitySummaryExport,
  RawCapabilityKind,
  ResolvedCapabilityPackage,
} from './capability-closure-model.js';
export { packageCapabilitySummarySchema } from './capability-closure-model.js';

/** @internal */
export interface AnalyzeCapabilityClosureOptions {
  readonly files: readonly CapabilityClosureSourceFile[];
  readonly packages?: readonly ResolvedCapabilityPackage[];
  readonly packageSummaries?: readonly PackageCapabilitySummary[];
}

/** @internal */
export interface AnalyzeCapabilityClosureResult {
  readonly diagnostics: readonly CompilerDiagnostic[];
  readonly facts: readonly CoreGraph.CapabilityClosureExplainFact[];
  readonly packageRequests: readonly CapabilityPackageRequest[];
}

interface CapabilityRoot {
  readonly kind: CapabilityRootKind;
  readonly module: string;
  readonly name: string;
  readonly site: string;
}

interface ModuleEdge {
  readonly from: string;
  readonly kind: ScannedImportFact['kind'] | 'callback-transfer';
  readonly site: string;
  readonly specifier: string;
  readonly to: string;
}

type BindingOrigin =
  | { readonly exportName: string; readonly kind: 'local'; readonly module: string }
  | { readonly exportName: string; readonly kind: 'package'; readonly specifier: string }
  | { readonly kind: 'unknown'; readonly reason: string };

interface ReachablePackageUse {
  readonly importedNames: readonly string[];
  readonly importFact: ScannedImportFact;
  readonly module: string;
}

interface TraversalNode {
  readonly module: string;
  readonly path: readonly string[];
}

interface PackageVerdict {
  readonly closed: readonly { capability?: RawCapabilityKind; reason: string }[];
  readonly doors: readonly { capability: RawCapabilityKind; reason: string }[];
  readonly summaryFact: CoreGraph.CapabilityClosureExplainFact;
}

const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const;

const frameworkPackageVersions = new Map<string, string>([
  ['@kovojs/better-auth', '0.2.0'],
  ['@kovojs/browser', '0.2.0'],
  ['@kovojs/core', '0.2.0'],
  ['@kovojs/drizzle', '0.2.0'],
  ['@kovojs/headless-ui', '0.2.0'],
  ['@kovojs/icons', '0.2.0'],
  ['@kovojs/server', '0.2.0'],
  ['@kovojs/style', '0.2.0'],
  ['@kovojs/ui', '0.2.0'],
]);

const frameworkSummaryVersion = 'kovo-framework-capabilities/2026-07-18.1';
const drizzleSummaryVersion = 'kovo-reviewed-drizzle/1.0.0-rc.4.1';

const rootFactories = new Map<string, CapabilityRootKind>([
  ['@kovojs/browser\0handler', 'serialized-browser-handler'],
  ['@kovojs/server\0agentTool', 'agent-tool-callback'],
  ['@kovojs/server\0endpoint', 'endpoint'],
  ['@kovojs/server\0layout', 'layout'],
  ['@kovojs/server\0mutation', 'mutation'],
  ['@kovojs/server\0query', 'query'],
  ['@kovojs/server\0route', 'route'],
  ['@kovojs/server\0task', 'durable-task'],
  ['@kovojs/server\0toolCallback', 'agent-tool-callback'],
  ['@kovojs/server\0webhook', 'webhook'],
]);

const frameworkDoorExports = new Map<string, readonly RawCapabilityKind[]>([
  ['@kovojs/better-auth\0*\0createBetterAuthPostgresBindings', ['database-driver']],
  ['@kovojs/better-auth\0*\0createBetterAuthPostgresBindingsFromEnvironment', ['database-driver']],
  ['@kovojs/better-auth\0*\0createBetterAuthSqliteBindings', ['database-driver']],
  ['@kovojs/better-auth\0*\0createBetterAuthSqliteBindingsFromEnvironment', ['database-driver']],
  ['@kovojs/core\0*\0createFileSystemStorage', ['filesystem']],
  ['@kovojs/core\0*\0createS3CompatibleStorage', ['network']],
  ['@kovojs/server\0*\0checkPostgresAppDbPosture', ['database-driver']],
  ['@kovojs/server\0*\0createFileSystemStorage', ['filesystem']],
  ['@kovojs/server\0*\0createPostgresAppRuntimeDb', ['database-driver']],
  ['@kovojs/server\0*\0createS3CompatibleStorage', ['network']],
  ['@kovojs/server\0*\0exportStaticApp', ['filesystem']],
  ['@kovojs/server\0*\0migratePostgresAppDb', ['database-driver']],
  ['@kovojs/server\0*\0planPostgresAppDbMigration', ['database-driver']],
  ['@kovojs/server\0*\0provisionPostgresAppDb', ['database-driver']],
  ['@kovojs/server\0*\0rootedFiles', ['filesystem']],
  ['@kovojs/server\0*\0runCommand', ['process']],
  ['@kovojs/server\0./build\0*', ['filesystem', 'process', 'worker']],
  ['@kovojs/server\0./sqlite\0*', ['database-driver']],
  ['@kovojs/server\0./testing\0*', ['database-driver', 'filesystem']],
  ['@kovojs/server\0./vite\0*', ['dynamic-loader', 'filesystem']],
]);

/**
 * Derive the complete capability closure for all declared untrusted-data roots.
 *
 * The pass is deliberately module-granular: once a root reaches a module, eager imports, re-exports,
 * local wrapper dependencies, literal dynamic loading, globals, and callbacks supplied through a
 * wrapper/container all participate. Unsupported resolution and package facts become KV448 rather
 * than an allow-by-omission verdict (SPEC §6.6; C13).
 */
export function analyzeCapabilityClosure(
  options: AnalyzeCapabilityClosureOptions,
): AnalyzeCapabilityClosureResult {
  const modules = scanCapabilityClosureModules(options.files);
  const modulesByName = new Map(
    modules.map((module) => [normalizeModuleName(module.fileName), module]),
  );
  const normalizedModules = modules.map((module) => ({
    ...module,
    fileName: normalizeModuleName(module.fileName),
  }));
  modulesByName.clear();
  for (const module of normalizedModules) modulesByName.set(module.fileName, module);

  const resolver = new BindingResolver(modulesByName);
  const roots = discoverRoots(normalizedModules, resolver);
  const edges = deriveModuleEdges(normalizedModules, modulesByName, resolver);
  const edgesByModule = groupEdges(edges);
  const packageUsesByModule = packageUses(normalizedModules);
  const packageRequests = collectCapabilityPackageRequestsFromModules(normalizedModules);
  const packageMetadata = indexPackageMetadata(options.packages ?? []);
  const packageSummaries = indexPackageSummaries(options.packageSummaries ?? []);
  const facts: CoreGraph.CapabilityClosureExplainFact[] = roots.map(rootFact);
  const diagnostics: CompilerDiagnostic[] = [];
  const factKeys = new Set(facts.map(capabilityFactKey));

  for (const root of roots) {
    const rootPath = [`root:${root.kind}:${root.name}@${root.module}`];
    const queue: TraversalNode[] = [{ module: root.module, path: rootPath }];
    const visited = new Set<string>();
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]!;
      if (visited.has(current.module)) continue;
      visited.add(current.module);
      const module = modulesByName.get(current.module);
      if (module === undefined) continue;

      for (const global of module.globals) {
        const terminal = `${global.evidence}@${module.fileName}`;
        appendClosed(
          root,
          global.site,
          global.capability,
          `raw ${global.capability} authority (${global.evidence}) is unavailable from untrusted-data-reachable code`,
          [...current.path, terminal],
          facts,
          factKeys,
          diagnostics,
        );
      }

      for (const use of packageUsesByModule.get(current.module) ?? []) {
        const verdict = packageVerdict(use, packageMetadata, packageSummaries);
        appendFact(facts, factKeys, verdict.summaryFact);
        const packagePath = [
          ...current.path,
          `${use.importFact.kind}:${use.importFact.specifier ?? '<dynamic>'}@${current.module}`,
        ];
        for (const closed of verdict.closed) {
          appendClosed(
            root,
            use.importFact.site,
            closed.capability,
            closed.reason,
            packagePath,
            facts,
            factKeys,
            diagnostics,
          );
        }
        for (const door of verdict.doors) {
          appendFact(facts, factKeys, {
            capability: door.capability,
            kind: 'door',
            module: current.module,
            name: root.name,
            path: packagePath,
            reason: door.reason,
            rootKind: root.kind,
            site: use.importFact.site,
          });
        }
      }

      for (const imported of module.imports) {
        if (
          imported.specifier !== undefined ||
          imported.kind === 'import' ||
          imported.kind === 're-export'
        ) {
          continue;
        }
        appendClosed(
          root,
          imported.site,
          'dynamic-loader',
          `${imported.kind} target is not a compile-visible string literal`,
          [...current.path, `${imported.kind}:<unresolved>@${current.module}`],
          facts,
          factKeys,
          diagnostics,
        );
      }

      for (const edge of edgesByModule.get(current.module) ?? []) {
        queue.push({
          module: edge.to,
          path: [...current.path, `${edge.kind}:${edge.specifier}@${edge.from}`, edge.to],
        });
      }

      for (const imported of module.imports) {
        const specifier = imported.specifier;
        if (specifier === undefined || !isRelativeSpecifier(specifier)) continue;
        if (resolveRelativeModule(module.fileName, specifier, modulesByName) !== undefined)
          continue;
        appendClosed(
          root,
          imported.site,
          'dynamic-loader',
          `relative ${imported.kind} ${specifier} did not resolve inside the immutable app source snapshot`,
          [...current.path, `${imported.kind}:${specifier}@${current.module}`, '<unresolved>'],
          facts,
          factKeys,
          diagnostics,
        );
      }
    }
  }

  return {
    diagnostics: stableDiagnostics(diagnostics),
    facts: stableFacts(facts),
    packageRequests,
  };
}

/** Parse once to tell the pre-evaluation resolver exactly which installed package facts are needed. */
export function collectCapabilityPackageRequests(
  files: readonly CapabilityClosureSourceFile[],
): CapabilityPackageRequest[] {
  return collectCapabilityPackageRequestsFromModules(scanCapabilityClosureModules(files));
}

function collectCapabilityPackageRequestsFromModules(
  modules: readonly ScannedCapabilityModule[],
): CapabilityPackageRequest[] {
  const names = new Map<string, Set<string>>();
  for (const module of modules) {
    for (const imported of module.imports) {
      const specifier = imported.specifier;
      if (
        specifier === undefined ||
        isRelativeSpecifier(specifier) ||
        rawCapabilityForModuleSpecifier(specifier) !== undefined
      ) {
        continue;
      }
      const importedNames = names.get(specifier) ?? new Set<string>();
      for (const name of imported.importedNames) importedNames.add(name);
      names.set(specifier, importedNames);
    }
  }
  return [...names.entries()]
    .map(([specifier, importedNames]) => ({
      importedNames: [...importedNames].sort(),
      specifier,
    }))
    .sort((left, right) => left.specifier.localeCompare(right.specifier));
}

function discoverRoots(
  modules: readonly ScannedCapabilityModule[],
  resolver: BindingResolver,
): CapabilityRoot[] {
  const roots: CapabilityRoot[] = [];
  const keys = new Set<string>();
  for (const module of modules) {
    for (const handler of module.browserHandlers) {
      appendRoot(roots, keys, {
        kind: 'serialized-browser-handler',
        module: module.fileName,
        name: handler.name,
        site: handler.site,
      });
    }
    for (const call of module.calls) {
      const origin = resolver.resolveBinding(module.fileName, call.callee);
      if (origin.kind !== 'package') continue;
      const packageName = packageNameForSpecifier(origin.specifier);
      let kind = rootFactories.get(`${packageName}\0${origin.exportName}`);
      if (kind === undefined) continue;
      if (kind === 'durable-task' && call.hasCron) kind = 'scheduled-task';
      appendRoot(roots, keys, {
        kind,
        module: module.fileName,
        name: call.firstLiteral ?? call.assignedName ?? origin.exportName,
        site: call.site,
      });
    }
  }
  return roots.sort(compareRoots);
}

function appendRoot(roots: CapabilityRoot[], keys: Set<string>, root: CapabilityRoot): void {
  const key = `${root.kind}\0${root.module}\0${root.site}\0${root.name}`;
  if (keys.has(key)) return;
  keys.add(key);
  roots.push(root);
}

function deriveModuleEdges(
  modules: readonly ScannedCapabilityModule[],
  modulesByName: ReadonlyMap<string, ScannedCapabilityModule>,
  resolver: BindingResolver,
): ModuleEdge[] {
  const edges: ModuleEdge[] = [];
  const keys = new Set<string>();
  for (const module of modules) {
    for (const imported of module.imports) {
      if (imported.specifier === undefined || !isRelativeSpecifier(imported.specifier)) continue;
      const target = resolveRelativeModule(module.fileName, imported.specifier, modulesByName);
      if (target === undefined) continue;
      appendEdge(edges, keys, {
        from: module.fileName,
        kind: imported.kind,
        site: imported.site,
        specifier: imported.specifier,
        to: target,
      });
    }
    for (const call of module.calls) {
      if (!call.carriesCallback) continue;
      const origin = resolver.resolveBinding(module.fileName, call.callee);
      if (origin.kind !== 'local' || origin.module === module.fileName) continue;
      appendEdge(edges, keys, {
        from: origin.module,
        kind: 'callback-transfer',
        site: call.site,
        specifier: `${origin.exportName}(${module.fileName} callback/container)`,
        to: module.fileName,
      });
    }
  }
  return edges;
}

function appendEdge(edges: ModuleEdge[], keys: Set<string>, edge: ModuleEdge): void {
  const key = `${edge.from}\0${edge.to}\0${edge.kind}\0${edge.specifier}`;
  if (keys.has(key)) return;
  keys.add(key);
  edges.push(edge);
}

function groupEdges(edges: readonly ModuleEdge[]): Map<string, ModuleEdge[]> {
  const grouped = new Map<string, ModuleEdge[]>();
  for (const edge of edges) {
    const values = grouped.get(edge.from) ?? [];
    values.push(edge);
    grouped.set(edge.from, values);
  }
  for (const values of grouped.values()) {
    values.sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.specifier.localeCompare(right.specifier) ||
        left.to.localeCompare(right.to),
    );
  }
  return grouped;
}

function packageUses(
  modules: readonly ScannedCapabilityModule[],
): Map<string, ReachablePackageUse[]> {
  const uses = new Map<string, ReachablePackageUse[]>();
  for (const module of modules) {
    for (const imported of module.imports) {
      const specifier = imported.specifier;
      if (
        specifier === undefined ||
        isRelativeSpecifier(specifier) ||
        rawCapabilityForModuleSpecifier(specifier) !== undefined
      ) {
        continue;
      }
      const moduleUses = uses.get(module.fileName) ?? [];
      moduleUses.push({
        importedNames: imported.importedNames,
        importFact: imported,
        module: module.fileName,
      });
      uses.set(module.fileName, moduleUses);
    }
  }
  return uses;
}

function packageVerdict(
  use: ReachablePackageUse,
  metadataBySpecifier: ReadonlyMap<string, readonly ResolvedCapabilityPackage[]>,
  summariesByPackage: ReadonlyMap<string, readonly PackageCapabilitySummary[]>,
): PackageVerdict {
  const specifier = use.importFact.specifier!;
  const metadataCandidates = metadataBySpecifier.get(specifier) ?? [];
  if (metadataCandidates.length !== 1) {
    const status = metadataCandidates.length === 0 ? 'unresolved' : 'contradictory';
    return closedPackageVerdict(
      use,
      status,
      metadataCandidates.length === 0
        ? `package ${specifier} could not be resolved to one exact installed manifest before app evaluation`
        : `package ${specifier} resolved to contradictory installed-manifest facts`,
    );
  }
  const metadata = metadataCandidates[0]!;
  const packageName = packageNameForSpecifier(specifier);
  if (metadata.packageName !== packageName || metadata.specifier !== specifier) {
    return closedPackageVerdict(
      use,
      'contradictory',
      `package resolution for ${specifier} reports ${metadata.packageName}/${metadata.specifier}`,
      metadata,
    );
  }
  if (metadata.exportStatus !== 'resolved') {
    return closedPackageVerdict(
      use,
      'unresolved',
      `package ${specifier} has no unambiguous conditional export target in the installed manifest`,
      metadata,
    );
  }

  const frameworkVersion = frameworkPackageVersions.get(packageName);
  if (frameworkVersion !== undefined) {
    if (metadata.packageVersion !== frameworkVersion) {
      return closedPackageVerdict(
        use,
        'stale',
        `compiler-owned ${packageName} summary covers ${frameworkVersion}, installed ${metadata.packageVersion}; review the upgraded package before retaining authority`,
        metadata,
      );
    }
    return frameworkPackageVerdict(use, metadata);
  }

  if (packageName === 'drizzle-orm') {
    return drizzlePackageVerdict(use, metadata);
  }

  const summaries = summariesByPackage.get(packageName) ?? [];
  if (summaries.length !== 1) {
    return closedPackageVerdict(
      use,
      summaries.length === 0 ? 'absent' : 'contradictory',
      summaries.length === 0
        ? `reachable third-party package ${packageName} has no reviewed exact-version capability summary`
        : `reachable package ${packageName} has ${summaries.length} contradictory summaries`,
      metadata,
    );
  }
  return reviewedPackageVerdict(use, metadata, summaries[0]!);
}

function frameworkPackageVerdict(
  use: ReachablePackageUse,
  metadata: ResolvedCapabilityPackage,
): PackageVerdict {
  const packageName = metadata.packageName;
  const subpath = packageSubpath(use.importFact.specifier!);
  const doors = new Map<RawCapabilityKind, string>();
  for (const importedName of use.importedNames) {
    const exact = [
      ...(frameworkDoorExports.get(`${packageName}\0${subpath}\0${importedName}`) ?? []),
      ...(frameworkDoorExports.get(`${packageName}\0*\0${importedName}`) ?? []),
    ];
    const wildcard = [
      ...(frameworkDoorExports.get(`${packageName}\0${subpath}\0*`) ?? []),
      ...(frameworkDoorExports.get(`${packageName}\0*\0*`) ?? []),
    ];
    const namespace = importedName === '*';
    const packageWide = namespace
      ? [...frameworkDoorExports.entries()]
          .filter(
            ([key]) =>
              key.startsWith(`${packageName}\0${subpath}\0`) ||
              key.startsWith(`${packageName}\0*\0`),
          )
          .flatMap(([, values]) => values)
      : [];
    for (const capability of [...exact, ...wildcard, ...packageWide]) {
      doors.set(
        capability,
        `${packageName}${subpath === '.' ? '' : subpath.slice(1)} supplies reviewed ${capability} operations through ${importedName}`,
      );
    }
  }
  return {
    closed: [],
    doors: [...doors.entries()].map(([capability, reason]) => ({ capability, reason })),
    summaryFact: summaryFact(metadata, frameworkSummaryVersion, 'valid', use.importFact.site),
  };
}

function drizzlePackageVerdict(
  use: ReachablePackageUse,
  metadata: ResolvedCapabilityPackage,
): PackageVerdict {
  if (metadata.packageVersion !== '1.0.0-rc.4') {
    return closedPackageVerdict(
      use,
      'stale',
      `reviewed drizzle-orm summary covers 1.0.0-rc.4, installed ${metadata.packageVersion}`,
      metadata,
    );
  }
  const subpath = packageSubpath(use.importFact.specifier!);
  const pureSubpaths = new Set(['.', './pg-core', './relations', './sqlite-core']);
  if (!pureSubpaths.has(subpath)) {
    return closedPackageVerdict(
      use,
      'absent',
      `drizzle-orm subpath ${subpath} is not in the reviewed schema/query-construction summary; driver subpaths require the Kovo database door`,
      metadata,
    );
  }
  return {
    closed: [],
    doors: [],
    summaryFact: summaryFact(metadata, drizzleSummaryVersion, 'valid', use.importFact.site),
  };
}

function reviewedPackageVerdict(
  use: ReachablePackageUse,
  metadata: ResolvedCapabilityPackage,
  summary: PackageCapabilitySummary,
): PackageVerdict {
  const staleReason = packageSummaryStaleReason(metadata, summary);
  if (staleReason !== undefined) {
    return closedPackageVerdict(use, 'stale', staleReason, metadata, summary.summaryVersion);
  }
  const subpath = packageSubpath(use.importFact.specifier!);
  const entries = summary.entries.filter((entry) => entry.subpath === subpath);
  if (entries.length !== 1) {
    return closedPackageVerdict(
      use,
      entries.length === 0 ? 'absent' : 'contradictory',
      entries.length === 0
        ? `summary ${summary.summaryVersion} has no entry for ${use.importFact.specifier}`
        : `summary ${summary.summaryVersion} has duplicate ${subpath} entries`,
      metadata,
      summary.summaryVersion,
    );
  }
  const entry = entries[0]!;
  if (!sameStrings(entry.conditions, metadata.conditions)) {
    return closedPackageVerdict(
      use,
      'stale',
      `summary conditions ${formatList(entry.conditions)} do not cover installed conditional exports ${formatList(metadata.conditions)}`,
      metadata,
      summary.summaryVersion,
    );
  }

  const permissions: PackageCapabilitySummaryExport[] = [];
  for (const importedName of use.importedNames) {
    const matches = entry.exports.filter(
      (candidate) => candidate.name === importedName || candidate.name === '*',
    );
    if (matches.length !== 1) {
      return closedPackageVerdict(
        use,
        matches.length === 0 ? 'absent' : 'contradictory',
        matches.length === 0
          ? `summary ${summary.summaryVersion} does not classify export ${importedName}`
          : `summary ${summary.summaryVersion} gives export ${importedName} contradictory permissions`,
        metadata,
        summary.summaryVersion,
      );
    }
    permissions.push(matches[0]!);
  }

  const closed: { capability?: RawCapabilityKind; reason: string }[] = [];
  for (const permission of permissions) {
    if (permission.disposition === 'framework-door') {
      closed.push({
        reason: `project/package summary ${summary.summaryVersion} attempts to mint framework-door authority; only the compiler-owned Kovo registry may do so`,
      });
      continue;
    }
    if (permission.disposition === 'raw' || permission.capabilities.length > 0) {
      const capabilities =
        permission.capabilities.length > 0 ? permission.capabilities : [undefined];
      for (const capability of capabilities) {
        closed.push({
          ...(capability === undefined ? {} : { capability }),
          reason: `package ${metadata.packageName} export ${permission.name} exposes raw ${capability ?? 'unclassified'} authority`,
        });
      }
    }
  }
  return {
    closed,
    doors: [],
    summaryFact: summaryFact(
      metadata,
      summary.summaryVersion,
      closed.length === 0 ? 'valid' : 'contradictory',
      use.importFact.site,
    ),
  };
}

function packageSummaryStaleReason(
  metadata: ResolvedCapabilityPackage,
  summary: PackageCapabilitySummary,
): string | undefined {
  if (summary.schema !== packageCapabilitySummarySchema) {
    return `summary ${summary.summaryVersion} uses unsupported schema ${String(summary.schema)}`;
  }
  if (summary.packageName !== metadata.packageName) {
    return `summary names ${summary.packageName}, installed package is ${metadata.packageName}`;
  }
  if (summary.packageVersion !== metadata.packageVersion) {
    return `summary covers ${summary.packageVersion}, installed package is ${metadata.packageVersion}`;
  }
  if (summary.manifestFingerprint !== metadata.manifestFingerprint) {
    return `summary manifest fingerprint ${summary.manifestFingerprint} is stale for installed ${metadata.manifestFingerprint}`;
  }
  if (summary.summaryVersion.trim() === '')
    return 'package capability summary has no version token';
  return undefined;
}

function closedPackageVerdict(
  use: ReachablePackageUse,
  status: 'absent' | 'contradictory' | 'stale' | 'unresolved',
  reason: string,
  metadata?: ResolvedCapabilityPackage,
  summaryVersion?: string,
): PackageVerdict {
  const specifier = use.importFact.specifier!;
  return {
    closed: [{ reason }],
    doors: [],
    summaryFact: {
      conditions: metadata?.conditions ?? [],
      kind: 'summary',
      ...(metadata === undefined ? {} : { manifestFingerprint: metadata.manifestFingerprint }),
      packageName: metadata?.packageName ?? packageNameForSpecifier(specifier),
      packageVersion: metadata?.packageVersion ?? '<unresolved>',
      reason,
      site: use.importFact.site,
      status,
      ...(summaryVersion === undefined ? {} : { summaryVersion }),
    },
  };
}

function summaryFact(
  metadata: ResolvedCapabilityPackage,
  summaryVersion: string,
  status: NonNullable<CoreGraph.CapabilityClosureExplainFact['status']>,
  site: string,
): CoreGraph.CapabilityClosureExplainFact {
  return {
    conditions: metadata.conditions,
    kind: 'summary',
    manifestFingerprint: metadata.manifestFingerprint,
    packageName: metadata.packageName,
    packageVersion: metadata.packageVersion,
    site,
    status,
    summaryVersion,
  };
}

function appendClosed(
  root: CapabilityRoot,
  site: string,
  capability: RawCapabilityKind | undefined,
  reason: string,
  path: readonly string[],
  facts: CoreGraph.CapabilityClosureExplainFact[],
  factKeys: Set<string>,
  diagnostics: CompilerDiagnostic[],
): void {
  const fact: CoreGraph.CapabilityClosureExplainFact = {
    ...(capability === undefined ? {} : { capability }),
    kind: 'closed',
    module: root.module,
    name: root.name,
    path,
    reason,
    rootKind: root.kind,
    site,
    status: 'unresolved',
  };
  const key = capabilityFactKey(fact);
  if (factKeys.has(key)) return;
  appendFact(facts, factKeys, fact);
  diagnostics.push(capabilityDiagnostic(root, site, reason, path));
}

function appendFact(
  facts: CoreGraph.CapabilityClosureExplainFact[],
  keys: Set<string>,
  fact: CoreGraph.CapabilityClosureExplainFact,
): void {
  const key = capabilityFactKey(fact);
  if (keys.has(key)) return;
  keys.add(key);
  facts.push(fact);
}

function capabilityDiagnostic(
  root: CapabilityRoot,
  site: string,
  reason: string,
  path: readonly string[],
): CompilerDiagnostic {
  const parsedSite = parseSite(site);
  const definition = diagnosticDefinitions.KV448;
  return {
    code: 'KV448',
    fileName: parsedSite.fileName,
    help: definition.help,
    message: `${definition.message} root=${root.kind}:${root.name}; reason=${reason}; provenance=${path.join(' -> ')}`,
    severity: 'error',
    start: { column: parsedSite.column, line: parsedSite.line },
  };
}

function rootFact(root: CapabilityRoot): CoreGraph.CapabilityClosureExplainFact {
  return {
    kind: 'root',
    module: root.module,
    name: root.name,
    rootKind: root.kind,
    site: root.site,
  };
}

function indexPackageMetadata(
  packages: readonly ResolvedCapabilityPackage[],
): Map<string, readonly ResolvedCapabilityPackage[]> {
  const indexed = new Map<string, ResolvedCapabilityPackage[]>();
  for (const packageFact of packages) {
    const values = indexed.get(packageFact.specifier) ?? [];
    values.push(packageFact);
    indexed.set(packageFact.specifier, values);
  }
  return indexed;
}

function indexPackageSummaries(
  summaries: readonly PackageCapabilitySummary[],
): Map<string, readonly PackageCapabilitySummary[]> {
  const indexed = new Map<string, PackageCapabilitySummary[]>();
  for (const summary of summaries) {
    const values = indexed.get(summary.packageName) ?? [];
    values.push(summary);
    indexed.set(summary.packageName, values);
  }
  return indexed;
}

function rawCapabilityForModuleSpecifier(specifier: string): RawCapabilityKind | undefined {
  const normalized = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
  if (normalized === 'fs' || normalized.startsWith('fs/')) return 'filesystem';
  if (
    normalized === 'http' ||
    normalized === 'https' ||
    normalized === 'http2' ||
    normalized === 'net' ||
    normalized === 'tls' ||
    normalized === 'dgram' ||
    normalized === 'dns' ||
    normalized.startsWith('dns/')
  ) {
    return 'network';
  }
  if (
    normalized === 'process' ||
    normalized === 'child_process' ||
    normalized === 'cluster' ||
    normalized === 'inspector' ||
    normalized === 'os' ||
    normalized === 'repl'
  ) {
    return 'process';
  }
  if (normalized === 'vm' || normalized === 'v8') return 'vm';
  if (normalized === 'worker_threads') return 'worker';
  if (normalized === 'module') return 'dynamic-loader';
  const packageName = packageNameForSpecifier(specifier);
  if (
    packageName === '@electric-sql/pglite' ||
    packageName === 'better-sqlite3' ||
    packageName === 'mysql' ||
    packageName === 'mysql2' ||
    packageName === 'pg' ||
    packageName === 'postgres' ||
    packageName === 'sqlite3' ||
    specifier === 'node:sqlite' ||
    specifier === 'bun:sqlite'
  ) {
    return 'database-driver';
  }
  if (
    packageName === 'drizzle-orm' &&
    /\/(?:better-sqlite3|bun-sqlite|d1|durable-sqlite|expo-sqlite|libsql|mysql2|neon|node-postgres|op-sqlite|pglite|postgres-js|sql-js|sqlite-proxy|tidb-serverless|vercel-postgres)(?:\/|$)/u.test(
      specifier,
    )
  ) {
    return 'database-driver';
  }
  return undefined;
}

class BindingResolver {
  readonly #modules: ReadonlyMap<string, ScannedCapabilityModule>;

  constructor(modules: ReadonlyMap<string, ScannedCapabilityModule>) {
    this.#modules = modules;
  }

  resolveBinding(moduleName: string, binding: string): BindingOrigin {
    return this.#resolveBinding(moduleName, binding, new Set());
  }

  #resolveBinding(moduleName: string, binding: string, seen: Set<string>): BindingOrigin {
    const visitKey = `binding\0${moduleName}\0${binding}`;
    if (seen.has(visitKey)) return { kind: 'unknown', reason: 'binding cycle' };
    seen.add(visitKey);
    const module = this.#modules.get(moduleName);
    if (module === undefined) return { kind: 'unknown', reason: `missing module ${moduleName}` };

    const aliases = module.aliases.filter(
      (alias) => alias.local === binding || binding.startsWith(`${alias.local}.`),
    );
    const rewrittenAliases = aliases.map((alias) =>
      alias.local === binding
        ? alias.source
        : `${alias.source}${binding.slice(alias.local.length)}`,
    );
    if (rewrittenAliases.length === 1) {
      return this.#resolveBinding(moduleName, rewrittenAliases[0]!, seen);
    }
    if (aliases.length > 1) {
      const origins = rewrittenAliases.map((alias) =>
        this.#resolveBinding(moduleName, alias, new Set(seen)),
      );
      return sameOrigin(origins) ?? { kind: 'unknown', reason: `contradictory alias ${binding}` };
    }

    for (const imported of module.importBindings) {
      if (binding === imported.local) {
        if (imported.namespace) {
          return { kind: 'local', module: moduleName, exportName: binding };
        }
        return this.#resolveImport(moduleName, imported.specifier, imported.imported, seen);
      }
      if (imported.namespace && binding.startsWith(`${imported.local}.`)) {
        const exportName = binding.slice(imported.local.length + 1);
        return this.#resolveImport(moduleName, imported.specifier, exportName, seen);
      }
    }
    return { exportName: binding, kind: 'local', module: moduleName };
  }

  #resolveImport(
    importer: string,
    specifier: string,
    imported: string,
    seen: Set<string>,
  ): BindingOrigin {
    if (!isRelativeSpecifier(specifier)) {
      return { exportName: imported, kind: 'package', specifier };
    }
    const target = resolveRelativeModule(importer, specifier, this.#modules);
    if (target === undefined) return { kind: 'unknown', reason: `unresolved ${specifier}` };
    return this.#resolveExport(target, imported, seen);
  }

  #resolveExport(moduleName: string, exportName: string, seen: Set<string>): BindingOrigin {
    const visitKey = `export\0${moduleName}\0${exportName}`;
    if (seen.has(visitKey)) return { kind: 'unknown', reason: 're-export cycle' };
    seen.add(visitKey);
    const module = this.#modules.get(moduleName);
    if (module === undefined) return { kind: 'unknown', reason: `missing module ${moduleName}` };
    const explicit = module.exports.filter((entry) => entry.exported === exportName);
    if (explicit.length > 0) {
      const origins = explicit.map((entry) => this.#resolveExportEntry(moduleName, entry, seen));
      return (
        sameOrigin(origins) ?? { kind: 'unknown', reason: `contradictory export ${exportName}` }
      );
    }
    const wildcard = module.exports.filter(
      (entry) => entry.wildcard && entry.specifier !== undefined,
    );
    if (wildcard.length > 0) {
      const origins = wildcard.map((entry) =>
        this.#resolveImport(moduleName, entry.specifier!, exportName, new Set(seen)),
      );
      return sameOrigin(origins) ?? { kind: 'unknown', reason: `ambiguous wildcard ${exportName}` };
    }
    return { exportName, kind: 'local', module: moduleName };
  }

  #resolveExportEntry(
    moduleName: string,
    entry: ScannedExportBindingFact,
    seen: Set<string>,
  ): BindingOrigin {
    if (entry.specifier !== undefined) {
      return this.#resolveImport(
        moduleName,
        entry.specifier,
        entry.imported ?? entry.exported ?? '*',
        seen,
      );
    }
    if (entry.local !== undefined) return this.#resolveBinding(moduleName, entry.local, seen);
    return { kind: 'unknown', reason: 'malformed export' };
  }
}

function sameOrigin(origins: readonly BindingOrigin[]): BindingOrigin | undefined {
  const known = origins.filter((origin) => origin.kind !== 'unknown');
  if (known.length === 0) return origins[0];
  const first = known[0]!;
  const key = bindingOriginKey(first);
  return known.every((origin) => bindingOriginKey(origin) === key) ? first : undefined;
}

function bindingOriginKey(origin: BindingOrigin): string {
  if (origin.kind === 'unknown') return `unknown:${origin.reason}`;
  return origin.kind === 'local'
    ? `local:${origin.module}:${origin.exportName}`
    : `package:${origin.specifier}:${origin.exportName}`;
}

function resolveRelativeModule(
  importer: string,
  specifier: string,
  modules: ReadonlyMap<string, unknown>,
): string | undefined {
  const cleanSpecifier = stripModuleSuffix(specifier);
  const base = normalizeModuleName(`${moduleDirname(importer)}/${cleanSpecifier}`);
  const candidates: string[] = [];
  if (sourceExtensions.some((extension) => base.endsWith(extension))) {
    if (base.endsWith('.js')) {
      candidates.push(`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`);
    } else if (base.endsWith('.mjs')) {
      candidates.push(`${base.slice(0, -4)}.mts`);
    } else if (base.endsWith('.cjs')) {
      candidates.push(`${base.slice(0, -4)}.cts`);
    } else if (base.endsWith('.jsx')) {
      candidates.push(`${base.slice(0, -4)}.tsx`);
    }
    candidates.push(base);
  } else {
    candidates.push(base);
    for (const extension of sourceExtensions) candidates.push(`${base}${extension}`);
    for (const extension of sourceExtensions) candidates.push(`${base}/index${extension}`);
  }
  return candidates.find((candidate) => modules.has(candidate));
}

function normalizeModuleName(value: string): string {
  const parts = value.replaceAll('\\', '/').split('/');
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..' && normalized.length > 0 && normalized[normalized.length - 1] !== '..') {
      normalized.pop();
    } else {
      normalized.push(part);
    }
  }
  return normalized.join('/') || '.';
}

function moduleDirname(value: string): string {
  const index = value.lastIndexOf('/');
  return index < 0 ? '.' : value.slice(0, index);
}

function stripModuleSuffix(value: string): string {
  const query = value.indexOf('?');
  const fragment = value.indexOf('#');
  const end = query < 0 ? fragment : fragment < 0 ? query : Math.min(query, fragment);
  return end < 0 ? value : value.slice(0, end);
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function packageNameForSpecifier(specifier: string): string {
  if (!specifier.startsWith('@')) return specifier.split('/')[0] ?? specifier;
  const parts = specifier.split('/');
  return parts.length > 1 ? `${parts[0]}/${parts[1]}` : specifier;
}

function packageSubpath(specifier: string): string {
  const packageName = packageNameForSpecifier(specifier);
  return specifier === packageName ? '.' : `.${specifier.slice(packageName.length)}`;
}

function parseSite(site: string): { column: number; fileName: string; line: number } {
  const match = /^(.*):(\d+):(\d+)$/u.exec(site);
  return match
    ? { column: Number(match[3]), fileName: match[1]!, line: Number(match[2]) }
    : { column: 1, fileName: site, line: 1 };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return (
    leftSorted.length === rightSorted.length &&
    leftSorted.every((value, index) => value === rightSorted[index])
  );
}

function formatList(values: readonly string[]): string {
  return values.length === 0 ? '<none>' : [...values].sort().join(',');
}

function compareRoots(left: CapabilityRoot, right: CapabilityRoot): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.name.localeCompare(right.name) ||
    left.module.localeCompare(right.module) ||
    left.site.localeCompare(right.site)
  );
}

function capabilityFactKey(fact: CoreGraph.CapabilityClosureExplainFact): string {
  return [
    fact.kind,
    fact.rootKind ?? '',
    fact.name ?? '',
    fact.module ?? '',
    fact.manifestFingerprint ?? '',
    fact.capability ?? '',
    fact.packageName ?? '',
    fact.packageVersion ?? '',
    fact.summaryVersion ?? '',
    fact.status ?? '',
    fact.site,
    fact.reason ?? '',
    fact.path?.join('\0') ?? '',
  ].join('\u0001');
}

function stableFacts(
  facts: readonly CoreGraph.CapabilityClosureExplainFact[],
): CoreGraph.CapabilityClosureExplainFact[] {
  return [...facts].sort((left, right) =>
    capabilityFactKey(left).localeCompare(capabilityFactKey(right)),
  );
}

function stableDiagnostics(diagnostics: readonly CompilerDiagnostic[]): CompilerDiagnostic[] {
  return [...diagnostics].sort(
    (left, right) =>
      left.fileName.localeCompare(right.fileName) ||
      (left.start?.line ?? 0) - (right.start?.line ?? 0) ||
      (left.start?.column ?? 0) - (right.start?.column ?? 0) ||
      left.message.localeCompare(right.message),
  );
}
