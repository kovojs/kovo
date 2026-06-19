import type { DiagnosticCode, DiagnosticSeverity } from '@kovojs/core';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import type * as CoreGraph from '@kovojs/core/internal/graph';
import type { DbVerificationConfig, ObservedDbOperation } from './verifier-observation.js';

export type { DiagnosticCode } from '@kovojs/core';

/**
 * A database-verification diagnostic emitted by the harness verification API
 * (`KovoTestContext.verificationDiagnostics`): an uncovered/declared-but-unobserved
 * write or branch, with its domain, message, and severity (SPEC.md §11).
 */
export interface DbVerificationDiagnostic {
  branch?: string;
  code: DiagnosticCode;
  domain: string;
  message: string;
  severity: DiagnosticSeverity;
  site?: string;
}

/** @internal Compute verification diagnostics for observed operations vs the touch graph. */
export function diagnosticsForObservations(
  observed: readonly ObservedDbOperation[],
  touchGraph: CoreGraph.TouchGraph,
): DbVerificationDiagnostic[] {
  const observedWrites = new Set(
    observed
      .filter(
        (operation): operation is ObservedDbOperation & { domain: string } =>
          operation.kind === 'write' && operation.domain !== undefined,
      )
      .map((operation) => operation.domain),
  );
  const observedBranches = new Set(
    observed
      .filter(
        (operation): operation is ObservedDbOperation & { branch: string } =>
          operation.kind === 'write' && operation.branch !== undefined,
      )
      .map((operation) => operation.branch),
  );
  const declaredWrites = new Set(
    Object.values(touchGraph).flatMap((entry) => entry.touches.map((touch) => touch.domain)),
  );
  const unobservedBranches: DbVerificationDiagnostic[] = Object.values(touchGraph)
    .flatMap((entry) => entry.touches)
    .filter((touch) => hasUnobservedBranch(touch, observedBranches))
    .sort((left, right) => left.branch.localeCompare(right.branch))
    .map((touch) => ({
      branch: touch.branch,
      code: 'KV405' as const,
      domain: touch.domain,
      message: diagnosticDefinitions.KV405.message,
      severity: diagnosticDefinitions.KV405.severity,
      site: touch.site,
    }));

  const unobservedDomains: DbVerificationDiagnostic[] = [...declaredWrites]
    .filter((domain) => !observedWrites.has(domain))
    .sort()
    .map((domain) => ({
      code: 'KV403' as const,
      domain,
      message: diagnosticDefinitions.KV403.message,
      severity: diagnosticDefinitions.KV403.severity,
    }));

  return [...unobservedBranches, ...unobservedDomains];
}

/** @internal Throw if any observed write is not covered by the touch graph (SPEC.md §11). */
export function assertObservedWritesCovered(
  observed: readonly ObservedDbOperation[],
  touchGraph: CoreGraph.TouchGraph,
  config: DbVerificationConfig,
  touchGraphKey?: string,
): void {
  const scopedTouchGraph = selectTouchGraph(touchGraph, touchGraphKey);

  assertRowKeys(observed, config);
  assertKeyedWritesObserved(observed, scopedTouchGraph, config);
  assertMutationReadsCovered(observed, scopedTouchGraph, config);

  const exemptTables = new Set(config.exemptTables ?? []);
  const unmappedWrites = observed.filter(
    (operation) =>
      operation.kind === 'write' &&
      operation.domain === undefined &&
      !exemptTables.has(operation.table),
  );

  if (unmappedWrites.length > 0) {
    const tables = unmappedWrites.map((operation) => operation.table).join(', ');
    throw new Error(diagnosticMessage('KV404', tables));
  }

  const entries = Object.values(scopedTouchGraph).filter((entry) => entry !== undefined);
  const allowedWrites = new Set(
    entries.flatMap((entry) => entry.touches.map((touch) => touch.domain)),
  );
  const unresolvedWrites = entries.flatMap((entry) => entry.unresolved);
  const unresolvedDomains = new Set(
    unresolvedWrites.flatMap((site) => (site.domain ? [site.domain] : [])),
  );
  const uncovered = observed.filter(
    (operation) =>
      operation.kind === 'write' &&
      operation.domain !== undefined &&
      !allowedWrites.has(operation.domain) &&
      !unresolvedDomains.has(operation.domain),
  );

  if (uncovered.length > 0) {
    const domains = uncovered.map((operation) => operation.domain).join(', ');
    throw new Error(diagnosticMessage('KV402', domains));
  }
}

/** @internal Throw if any observed read is not covered by the declared read set (SPEC.md §11). */
export function assertObservedReadsCovered(
  observed: readonly ObservedDbOperation[],
  domains: readonly string[],
  config: DbVerificationConfig,
): void {
  assertRowKeys(observed, config);
  assertNoExemptReads(observed, config);

  const unmappedReads = observed.filter(
    (operation) => operation.kind === 'read' && operation.domain === undefined,
  );

  if (unmappedReads.length > 0) {
    const tables = unmappedReads.map((operation) => operation.table).join(', ');
    throw new Error(diagnosticMessage('KV407', tables));
  }

  const allowedReads = new Set(domains);
  const uncovered = observed.filter(
    (operation) =>
      operation.kind === 'read' &&
      operation.domain !== undefined &&
      !allowedReads.has(operation.domain),
  );

  if (uncovered.length > 0) {
    const readDomains = uncovered.map((operation) => operation.domain).join(', ');
    throw new Error(diagnosticMessage('KV407', readDomains));
  }
}

/** @internal Format a `KVxxx` diagnostic code and detail into a verification error message. */
export function diagnosticMessage(code: DiagnosticCode, detail: string): string {
  return `${code} ${trimDiagnosticSentence(diagnosticDefinitions[code].message)}: ${detail}`;
}

function assertKeyedWritesObserved(
  observed: readonly ObservedDbOperation[],
  touchGraph: CoreGraph.TouchGraph,
  config: DbVerificationConfig,
): void {
  const entries = Object.values(touchGraph).filter((entry) => entry !== undefined);
  const unresolvedWrites = entries.flatMap((entry) => entry.unresolved);
  const unresolvedDomains = new Set(
    unresolvedWrites.flatMap((site) => (site.domain ? [site.domain] : [])),
  );

  const keyedTouchByTable = new Map(
    entries
      .flatMap((entry) => entry.touches)
      .filter((touch) => touch.keys !== null)
      .map((touch) => [touch.via, touch] as const),
  );
  const missing = observed.filter((operation) => {
    if (operation.kind !== 'write' || operation.rowKey !== undefined) return false;

    const touch = keyedTouchByTable.get(operation.table);
    if (!touch || unresolvedDomains.has(touch.domain)) return false;

    return config.keyByTable?.[operation.table] !== undefined;
  });

  if (missing.length === 0) return;

  const details = missing
    .map(
      (operation) =>
        `${operation.table} expected ${config.keyByTable?.[operation.table]} observed <missing>`,
    )
    .join(', ');
  throw new Error(diagnosticMessage('KV408', details));
}

function selectTouchGraph(
  touchGraph: CoreGraph.TouchGraph,
  touchGraphKey: string | undefined,
): CoreGraph.TouchGraph {
  if (touchGraphKey === undefined) return touchGraph;

  const entry = touchGraph[touchGraphKey];
  return entry === undefined ? {} : { [touchGraphKey]: entry };
}

function assertRowKeys(
  observed: readonly ObservedDbOperation[],
  config: DbVerificationConfig,
): void {
  const mismatches = observed.filter((operation) => {
    const expected = config.keyByTable?.[operation.table];
    return (
      expected !== undefined &&
      operation.rowKey !== undefined &&
      !observedRowKeys(operation).has(expected)
    );
  });

  if (mismatches.length === 0) return;

  const details = mismatches
    .map(
      (operation) =>
        `${operation.table} expected ${config.keyByTable?.[operation.table]} observed ${operation.rowKey}`,
    )
    .join(', ');
  throw new Error(diagnosticMessage('KV408', details));
}

function observedRowKeys(operation: ObservedDbOperation): ReadonlySet<string> {
  return new Set(operation.rowKey?.split(',').map((key) => key.trim()) ?? []);
}

function assertMutationReadsCovered(
  observed: readonly ObservedDbOperation[],
  touchGraph: CoreGraph.TouchGraph,
  config: DbVerificationConfig,
): void {
  assertNoExemptReads(observed, config);

  const unmappedReads = observed.filter(
    (operation) =>
      operation.kind === 'read' &&
      operation.mutationRead === true &&
      operation.domain === undefined,
  );

  if (unmappedReads.length > 0) {
    const tables = unmappedReads.map((operation) => operation.table).join(', ');
    throw new Error(diagnosticMessage('KV407', tables));
  }

  const allowedReads = new Set(
    Object.values(touchGraph).flatMap((entry) => (entry.reads ?? []).map((read) => read.domain)),
  );
  const unresolvedWrites = Object.values(touchGraph).flatMap((entry) => entry.unresolved);
  const unresolvedDomains = new Set(
    unresolvedWrites.flatMap((site) => (site.domain ? [site.domain] : [])),
  );
  const uncovered = observed.filter(
    (operation) =>
      operation.kind === 'read' &&
      operation.mutationRead === true &&
      operation.domain !== undefined &&
      !allowedReads.has(operation.domain) &&
      !unresolvedDomains.has(operation.domain),
  );

  if (uncovered.length > 0) {
    const readDomains = uncovered.map((operation) => operation.domain).join(', ');
    throw new Error(diagnosticMessage('KV407', readDomains));
  }
}

function assertNoExemptReads(
  observed: readonly ObservedDbOperation[],
  config: DbVerificationConfig,
): void {
  const exemptTables = new Set(config.exemptTables ?? []);
  if (exemptTables.size === 0) return;

  const exemptReads = observed.filter(
    (operation) => operation.kind === 'read' && exemptTables.has(operation.table),
  );
  if (exemptReads.length === 0) return;

  const tables = [...new Set(exemptReads.map((operation) => operation.table))].sort().join(', ');
  throw new Error(diagnosticMessage('KV411', tables));
}

function trimDiagnosticSentence(message: string): string {
  return message.endsWith('.') ? message.slice(0, -1) : message;
}

function hasUnobservedBranch(
  touch: CoreGraph.TouchSite,
  observedBranches: ReadonlySet<string>,
): touch is CoreGraph.TouchSite & { branch: string } {
  return touch.branch !== undefined && !observedBranches.has(touch.branch);
}
