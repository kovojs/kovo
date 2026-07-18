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

/** @internal */
export type CapabilityRootKind =
  | 'agent-tool-callback'
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
