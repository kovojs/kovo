/**
 * Typed scanner facts for the SPEC §6.6 capability-closed module graph.
 *
 * Source text is consumed only by `scan/capability-closure.ts`.  The graph pass receives these
 * finite facts so post-parse security decisions never fall back to snippets or regular expressions
 * (SPEC §5.2 rule 10).
 */

/** @internal */
export const packageCapabilitySummarySchema = 'kovo-package-capabilities/v1' as const;

/** @internal */
export type RawCapabilityKind =
  | 'database-driver'
  | 'dynamic-loader'
  | 'filesystem'
  | 'network'
  | 'process'
  | 'vm'
  | 'worker';

const rawModuleCapabilities = new Map<string, RawCapabilityKind>([
  ['child_process', 'process'],
  ['cloudflare:sockets', 'network'],
  ['cluster', 'process'],
  ['dgram', 'network'],
  ['dns', 'network'],
  ['fs', 'filesystem'],
  ['http', 'network'],
  ['http2', 'network'],
  ['https', 'network'],
  ['inspector', 'process'],
  ['module', 'dynamic-loader'],
  ['net', 'network'],
  ['os', 'process'],
  ['process', 'process'],
  ['readline', 'process'],
  ['repl', 'process'],
  ['sea', 'process'],
  ['tls', 'network'],
  ['trace_events', 'process'],
  ['tty', 'process'],
  ['v8', 'vm'],
  ['vm', 'vm'],
  ['wasi', 'vm'],
  ['worker_threads', 'worker'],
]);

const rawDatabasePackages = new Set([
  '@electric-sql/pglite',
  'better-sqlite3',
  'bun:sqlite',
  'mysql',
  'mysql2',
  'node:sqlite',
  'pg',
  'postgres',
  'sqlite3',
]);

/** @internal One C13-enrolled raw-module classifier shared by scanner and graph analysis. */
export function classifyRawCapabilityModuleSpecifier(
  specifier: string,
): RawCapabilityKind | undefined {
  const withoutNode = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
  const builtin = rawModuleCapabilities.get(withoutNode.split('/')[0]!);
  if (builtin !== undefined) return builtin;
  const packageName = capabilityPackageNameForSpecifier(specifier);
  if (rawDatabasePackages.has(packageName)) return 'database-driver';
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

function capabilityPackageNameForSpecifier(specifier: string): string {
  if (!specifier.startsWith('@')) return specifier.split('/')[0] ?? specifier;
  const parts = specifier.split('/');
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
}

/** @internal */
export type CapabilityRootKind =
  | 'agent-tool-callback'
  | 'application'
  | 'durable-task'
  | 'endpoint'
  | 'layout'
  | 'mutation'
  | 'query'
  | 'route'
  | 'scheduled-task'
  | 'serialized-browser-handler'
  | 'webhook';

/** @internal */
export interface CapabilityClosureSourceFile {
  readonly fileName: string;
  readonly source: string;
}

/** @internal */
export interface ScannedImportFact {
  readonly firstImport?: boolean;
  readonly importedNames: readonly string[];
  readonly kind: 'dynamic-import' | 'import' | 'require' | 're-export';
  readonly site: string;
  readonly specifier?: string;
}

/** @internal */
export interface ScannedImportBindingFact {
  readonly imported: string;
  readonly local: string;
  readonly namespace?: boolean;
  readonly specifier: string;
}

/** @internal */
export interface ScannedBindingAliasFact {
  readonly local: string;
  readonly site: string;
  readonly source: string;
  readonly sourceStartsAtUnshadowedGlobalNamespace?: boolean;
}

/** @internal */
export interface ScannedExportBindingFact {
  readonly exported?: string;
  readonly imported?: string;
  readonly local?: string;
  readonly specifier?: string;
  readonly wildcard?: boolean;
}

/** @internal */
export interface ScannedCallFact {
  readonly assignedName?: string;
  readonly callee: string;
  readonly carriesCallback: boolean;
  readonly firstArgumentBinding?: string;
  readonly firstLiteral?: string;
  readonly hasCron: boolean;
  readonly site: string;
}

/** @internal */
export interface ScannedGlobalCapabilityFact {
  readonly capability: RawCapabilityKind;
  readonly evidence: string;
  readonly site: string;
}

/** @internal */
export interface ScannedBrowserHandlerFact {
  readonly name: string;
  readonly site: string;
}

/** @internal */
export interface ScannedCapabilityModule {
  readonly aliases: readonly ScannedBindingAliasFact[];
  readonly browserHandlers: readonly ScannedBrowserHandlerFact[];
  readonly calls: readonly ScannedCallFact[];
  readonly exports: readonly ScannedExportBindingFact[];
  readonly fileName: string;
  readonly globals: readonly ScannedGlobalCapabilityFact[];
  readonly importBindings: readonly ScannedImportBindingFact[];
  readonly imports: readonly ScannedImportFact[];
}

/**
 * Exact installed-package facts derived before authored module evaluation.
 * @internal
 */
export interface ResolvedCapabilityPackage {
  readonly conditions: readonly string[];
  readonly exportStatus: 'resolved' | 'unresolved';
  /** Exact compiler-derived source or packed implementation identity; never package metadata. */
  readonly implementationDigest?: string;
  readonly manifestFingerprint: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly specifier: string;
}

/** @internal */
export interface PackageCapabilitySummaryExport {
  readonly capabilities: readonly RawCapabilityKind[];
  readonly disposition: 'framework-door' | 'pure' | 'raw';
  readonly name: string;
}

/** @internal */
export interface PackageCapabilitySummaryEntry {
  readonly conditions: readonly string[];
  readonly exports: readonly PackageCapabilitySummaryExport[];
  readonly subpath: string;
}

/**
 * Versioned least-authority summary. Project summaries may describe `pure` or `raw` exports;
 * `framework-door` is accepted only from the compiler-owned framework registry.
 * @internal
 */
export interface PackageCapabilitySummary {
  readonly entries: readonly PackageCapabilitySummaryEntry[];
  readonly manifestFingerprint: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly schema: typeof packageCapabilitySummarySchema;
  readonly source: string;
  readonly summaryVersion: string;
}

/** @internal */
export interface CapabilityPackageRequest {
  readonly importedNames: readonly string[];
  readonly specifier: string;
}
