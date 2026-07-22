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
  | 'crypto-acquisition'
  | 'database-driver'
  | 'declassification'
  | 'digest'
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

const exactDigestOnlyCryptoExports = new Set(['createHash', 'hash']);

/**
 * Binding-sensitive raw import classifier (SPEC §6.6).
 *
 * A crypto namespace is itself high authority. Only an exact non-empty set of named, non-keyed
 * digest exports receives the lower `digest` classification; a mixed import canonicalizes to the
 * stronger verdict.
 * @internal
 */
export function classifyRawCapabilityImport(
  specifier: string,
  importedNames: readonly string[],
): RawCapabilityKind | undefined {
  const withoutNode = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
  if (withoutNode === 'crypto') {
    return importedNames.length > 0 &&
      importedNames.every((name) => exactDigestOnlyCryptoExports.has(name))
      ? 'digest'
      : 'crypto-acquisition';
  }
  if (capabilityPackageNameForSpecifier(specifier) === '@node-rs/argon2') {
    return 'crypto-acquisition';
  }
  return classifyRawCapabilityModuleSpecifier(specifier);
}

/** @internal One C13-enrolled raw-module classifier shared by scanner and graph analysis. */
export function classifyRawCapabilityModuleSpecifier(
  specifier: string,
): RawCapabilityKind | undefined {
  const withoutNode = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
  if (withoutNode === 'crypto') return 'crypto-acquisition';
  const builtin = rawModuleCapabilities.get(withoutNode.split('/')[0]!);
  if (builtin !== undefined) return builtin;
  const packageName = capabilityPackageNameForSpecifier(specifier);
  if (packageName === '@node-rs/argon2') return 'crypto-acquisition';
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
  import('@kovojs/core/internal/security-operation-ir').SecurityRootKind;

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

/** @internal Per-use syntax-provenance alternative emitted before graph resolution. */
export type ScannedBindingCandidate =
  | { readonly exportName: string; readonly kind: 'local'; readonly members?: readonly string[] }
  | {
      readonly exportName: string;
      readonly kind: 'import';
      readonly members?: readonly string[];
      readonly namespace?: boolean;
      readonly specifier: string;
    }
  | { readonly kind: 'unknown'; readonly reason: string };

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
  readonly calleeCandidates?: readonly ScannedBindingCandidate[];
  readonly calleeUncertain?: boolean;
  readonly carriesCallback: boolean;
  readonly firstArgumentBinding?: string;
  readonly firstArgumentCandidates?: readonly ScannedBindingCandidate[];
  readonly firstArgumentUncertain?: boolean;
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
  readonly compilerDependencies: readonly ScannedCompilerDependencyFact[];
  readonly exports: readonly ScannedExportBindingFact[];
  readonly fileName: string;
  readonly globals: readonly ScannedGlobalCapabilityFact[];
  readonly importBindings: readonly ScannedImportBindingFact[];
  readonly imports: readonly ScannedImportFact[];
  readonly lexicalProvenanceBudgetExhausted?: boolean;
}

/** @internal Exact package edges inserted only by the reviewed compiler transform. */
export interface ScannedCompilerDependencyFact {
  readonly importedNames: readonly string[];
  readonly kind: 'generated-internal-abi' | 'jsx-runtime';
  readonly site: string;
  readonly specifier:
    | '@kovojs/browser/internal/output'
    | '@kovojs/server/internal/csrf'
    | '@kovojs/server/internal/escape'
    | '@kovojs/server/internal/route'
    | '@kovojs/server/internal/wire'
    | '@kovojs/server/jsx-dev-runtime'
    | '@kovojs/server/jsx-runtime';
}

/** @internal Exact compiler dependency fact bound to the authored module that was lowered. */
export interface CompilerGeneratedCapabilityDependency extends ScannedCompilerDependencyFact {
  readonly importer: string;
}

/**
 * Exact installed-package facts derived before authored module evaluation.
 * @internal
 */
export interface ResolvedCapabilityPackage {
  readonly conditions: readonly string[];
  readonly exportStatus: 'resolved' | 'unresolved';
  /** Normalized authored module that owns this exact resolution fact. */
  readonly importer?: string;
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
  /** Normalized authored module that contains this package edge. */
  readonly importer?: string;
  readonly importedNames: readonly string[];
  readonly specifier: string;
}

/** @internal Version token for the compiler-derived app dependency loader manifest. */
export const appDependencyCapabilityManifestSchema = 'kovo-app-dependency-capabilities/v1' as const;

/** @internal One exact export permission retained from the L1 package verdict. */
export type AppDependencyCapabilityImport =
  import('@kovojs/core/internal/graph').AppDependencyCapabilityImport;

/** @internal One exact package subpath used by an untrusted-data-reachable app root. */
export type AppDependencyCapabilityEntry =
  import('@kovojs/core/internal/graph').AppDependencyCapabilityEntry;

/** @internal Exact installed identity plus the least-authority verdict used by the loader floor. */
export type AppDependencyCapability = import('@kovojs/core/internal/graph').AppDependencyCapability;

/**
 * Compiler-derived dependency import bound consumed by supported build/dev loader paths.
 *
 * This is a fail-closed runtime/build-loader floor, not a same-realm sandbox proof (SPEC §6.6).
 * @internal
 */
export type AppDependencyCapabilityManifest =
  import('@kovojs/core/internal/graph').AppDependencyCapabilityManifest;
