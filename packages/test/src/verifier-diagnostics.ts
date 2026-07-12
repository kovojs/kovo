import type { DiagnosticCode, DiagnosticSeverity } from '@kovojs/core';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import type * as CoreGraph from '@kovojs/core/internal/graph';
import type { DbVerificationConfig, ObservedDbOperation } from './verifier-observation.js';
import {
  verifierArrayJoin,
  verifierArrayPush,
  verifierArraySort,
  verifierFreeze,
  verifierMap,
  verifierMapGet,
  verifierMapSet,
  verifierObjectKeys,
  verifierSet,
  verifierSetAdd,
  verifierSetHas,
  verifierSetValues,
  verifierStringEndsWith,
  verifierStringSlice,
  verifierStringSplit,
  verifierStringTrim,
} from './verifier-security-intrinsics.js';

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
  const observedWrites = verifierSet<string>();
  const observedBranches = verifierSet<string>();
  for (let index = 0; index < observed.length; index += 1) {
    const operation = observed[index];
    if (operation?.kind !== 'write') continue;
    if (operation.domain !== undefined) verifierSetAdd(observedWrites, operation.domain);
    if (operation.branch !== undefined) verifierSetAdd(observedBranches, operation.branch);
  }

  const declaredWrites = verifierSet<string>();
  const unobservedTouches: Array<CoreGraph.TouchSite & { branch: string }> = [];
  const entries = touchGraphEntries(touchGraph);
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const touches = entries[entryIndex]?.touches ?? [];
    for (let touchIndex = 0; touchIndex < touches.length; touchIndex += 1) {
      const touch = touches[touchIndex];
      if (touch === undefined) continue;
      verifierSetAdd(declaredWrites, touch.domain);
      if (hasUnobservedBranch(touch, observedBranches)) {
        verifierArrayPush(unobservedTouches, touch);
      }
    }
  }
  verifierArraySort(unobservedTouches, (left, right) => compareStrings(left.branch, right.branch));

  const diagnostics: DbVerificationDiagnostic[] = [];
  for (let index = 0; index < unobservedTouches.length; index += 1) {
    const touch = unobservedTouches[index];
    if (touch === undefined) continue;
    verifierArrayPush(
      diagnostics,
      verifierFreeze({
        branch: touch.branch,
        code: 'KV405' as const,
        domain: touch.domain,
        message: diagnosticDefinitions.KV405.message,
        severity: diagnosticDefinitions.KV405.severity,
        site: touch.site,
      }),
    );
  }
  const declaredDomains = verifierSetValues(declaredWrites);
  verifierArraySort(declaredDomains, compareStrings);
  for (let index = 0; index < declaredDomains.length; index += 1) {
    const domain = declaredDomains[index];
    if (domain === undefined || verifierSetHas(observedWrites, domain)) continue;
    verifierArrayPush(
      diagnostics,
      verifierFreeze({
        code: 'KV403' as const,
        domain,
        message: diagnosticDefinitions.KV403.message,
        severity: diagnosticDefinitions.KV403.severity,
      }),
    );
  }
  return diagnostics;
}

/** @internal Throw if any observed write is not covered by the touch graph (SPEC.md §11). */
export function assertObservedWritesCovered(
  observed: readonly ObservedDbOperation[],
  touchGraph: CoreGraph.TouchGraph,
  config: DbVerificationConfig,
  touchGraphKey?: string,
  allReadsInScope = false,
): void {
  const scopedTouchGraph = selectTouchGraph(touchGraph, touchGraphKey);

  assertRowKeys(observed, config);
  assertRawWriteTablesAllowed(observed, scopedTouchGraph);
  assertKeyedWritesObserved(observed, scopedTouchGraph, config);
  assertMutationReadsCovered(observed, scopedTouchGraph, config, allReadsInScope);

  const exemptTables = stringSet(config.exemptTables ?? []);
  const unmappedTables: string[] = [];
  for (let index = 0; index < observed.length; index += 1) {
    const operation = observed[index];
    if (
      operation?.kind === 'write' &&
      operation.domain === undefined &&
      !verifierSetHas(exemptTables, operation.table)
    ) {
      verifierArrayPush(unmappedTables, operation.table);
    }
  }
  if (unmappedTables.length > 0) {
    throw new Error(diagnosticMessage('KV404', verifierArrayJoin(unmappedTables, ', ')));
  }

  const allowedWrites = verifierSet<string>();
  const unresolvedDomains = verifierSet<string>();
  const entries = touchGraphEntries(scopedTouchGraph);
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex];
    if (entry === undefined) continue;
    addTouchDomains(allowedWrites, entry.touches);
    addUnresolvedDomains(unresolvedDomains, entry.unresolved);
  }
  const uncoveredDomains: string[] = [];
  for (let index = 0; index < observed.length; index += 1) {
    const operation = observed[index];
    if (
      operation?.kind === 'write' &&
      operation.domain !== undefined &&
      !verifierSetHas(allowedWrites, operation.domain) &&
      !verifierSetHas(unresolvedDomains, operation.domain)
    ) {
      verifierArrayPush(uncoveredDomains, operation.domain);
    }
  }
  if (uncoveredDomains.length > 0) {
    throw new Error(diagnosticMessage('KV402', verifierArrayJoin(uncoveredDomains, ', ')));
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

  const unmappedTables: string[] = [];
  const allowedReads = stringSet(domains);
  const uncoveredDomains: string[] = [];
  for (let index = 0; index < observed.length; index += 1) {
    const operation = observed[index];
    if (operation?.kind !== 'read') continue;
    if (operation.domain === undefined) verifierArrayPush(unmappedTables, operation.table);
    else if (!verifierSetHas(allowedReads, operation.domain)) {
      verifierArrayPush(uncoveredDomains, operation.domain);
    }
  }
  if (unmappedTables.length > 0) {
    throw new Error(diagnosticMessage('KV407', verifierArrayJoin(unmappedTables, ', ')));
  }
  if (uncoveredDomains.length > 0) {
    throw new Error(diagnosticMessage('KV407', verifierArrayJoin(uncoveredDomains, ', ')));
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
  const entries = touchGraphEntries(touchGraph);
  const unresolvedDomains = verifierSet<string>();
  const keyedTouchByTable = verifierMap<string, CoreGraph.TouchSite>();
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex];
    if (entry === undefined) continue;
    addUnresolvedDomains(unresolvedDomains, entry.unresolved);
    for (let touchIndex = 0; touchIndex < entry.touches.length; touchIndex += 1) {
      const touch = entry.touches[touchIndex];
      if (touch !== undefined && touch.keys !== null) {
        verifierMapSet(keyedTouchByTable, touch.via, touch);
      }
    }
  }
  const details: string[] = [];
  for (let index = 0; index < observed.length; index += 1) {
    const operation = observed[index];
    if (operation?.kind !== 'write' || operation.rowKey !== undefined) continue;
    const touch = verifierMapGet(keyedTouchByTable, operation.table);
    if (
      touch !== undefined &&
      !verifierSetHas(unresolvedDomains, touch.domain) &&
      config.keyByTable?.[operation.table] !== undefined
    ) {
      verifierArrayPush(
        details,
        `${operation.table} expected ${config.keyByTable[operation.table]} observed <missing>`,
      );
    }
  }
  if (details.length > 0) {
    throw new Error(diagnosticMessage('KV408', verifierArrayJoin(details, ', ')));
  }
}

function assertRawWriteTablesAllowed(
  observed: readonly ObservedDbOperation[],
  touchGraph: CoreGraph.TouchGraph,
): void {
  const allowedTables = verifierSet<string>();
  const entries = touchGraphEntries(touchGraph);
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const tables = entries[entryIndex]?.tables ?? [];
    for (let tableIndex = 0; tableIndex < tables.length; tableIndex += 1) {
      const table = tables[tableIndex];
      if (table !== undefined) verifierSetAdd(allowedTables, table);
    }
  }
  const allowedValues = verifierSetValues(allowedTables);
  if (allowedValues.length === 0) return;
  const unexpected = verifierSet<string>();
  for (let index = 0; index < observed.length; index += 1) {
    const operation = observed[index];
    if (
      operation?.kind === 'write' &&
      operation.sql !== undefined &&
      !verifierSetHas(allowedTables, operation.table)
    ) {
      verifierSetAdd(unexpected, operation.table);
    }
  }
  const tables = verifierSetValues(unexpected);
  if (tables.length === 0) return;
  verifierArraySort(tables, compareStrings);
  throw new Error(diagnosticMessage('KV406', verifierArrayJoin(tables, ', ')));
}

function selectTouchGraph(
  touchGraph: CoreGraph.TouchGraph,
  touchGraphKey: string | undefined,
): CoreGraph.TouchGraph {
  if (touchGraphKey === undefined) return touchGraph;

  const entry = touchGraph[touchGraphKey];
  return entry === undefined ? {} : verifierFreeze({ [touchGraphKey]: entry });
}

function assertRowKeys(
  observed: readonly ObservedDbOperation[],
  config: DbVerificationConfig,
): void {
  const details: string[] = [];
  for (let index = 0; index < observed.length; index += 1) {
    const operation = observed[index];
    if (operation === undefined) continue;
    const expected = config.keyByTable?.[operation.table];
    if (
      expected !== undefined &&
      operation.rowKey !== undefined &&
      !verifierSetHas(observedRowKeys(operation), expected)
    ) {
      verifierArrayPush(
        details,
        `${operation.table} expected ${expected} observed ${operation.rowKey}`,
      );
    }
  }
  if (details.length > 0) {
    throw new Error(diagnosticMessage('KV408', verifierArrayJoin(details, ', ')));
  }
}

function observedRowKeys(operation: ObservedDbOperation): ReadonlySet<string> {
  const keys = verifierSet<string>();
  if (operation.rowKey === undefined) return keys;
  const parts = verifierStringSplit(operation.rowKey, ',');
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part !== undefined) verifierSetAdd(keys, verifierStringTrim(part));
  }
  return keys;
}

function assertMutationReadsCovered(
  observed: readonly ObservedDbOperation[],
  touchGraph: CoreGraph.TouchGraph,
  config: DbVerificationConfig,
  allReadsInScope: boolean,
): void {
  assertNoExemptReads(observed, config);

  const unmappedTables: string[] = [];
  const allowedReads = verifierSet<string>();
  const unresolvedDomains = verifierSet<string>();
  const entries = touchGraphEntries(touchGraph);
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex];
    if (entry === undefined) continue;
    const reads = entry.reads ?? [];
    for (let readIndex = 0; readIndex < reads.length; readIndex += 1) {
      const read = reads[readIndex];
      if (read !== undefined) verifierSetAdd(allowedReads, read.domain);
    }
    addUnresolvedDomains(unresolvedDomains, entry.unresolved);
  }
  const uncoveredDomains: string[] = [];
  for (let index = 0; index < observed.length; index += 1) {
    const operation = observed[index];
    if (operation?.kind !== 'read' || (!allReadsInScope && operation.mutationRead !== true)) {
      continue;
    }
    if (operation.domain === undefined) verifierArrayPush(unmappedTables, operation.table);
    else if (
      !verifierSetHas(allowedReads, operation.domain) &&
      !verifierSetHas(unresolvedDomains, operation.domain)
    ) {
      verifierArrayPush(uncoveredDomains, operation.domain);
    }
  }
  if (unmappedTables.length > 0) {
    throw new Error(diagnosticMessage('KV407', verifierArrayJoin(unmappedTables, ', ')));
  }
  if (uncoveredDomains.length > 0) {
    throw new Error(diagnosticMessage('KV407', verifierArrayJoin(uncoveredDomains, ', ')));
  }
}

function assertNoExemptReads(
  observed: readonly ObservedDbOperation[],
  config: DbVerificationConfig,
): void {
  const exemptTables = stringSet(config.exemptTables ?? []);
  if (verifierSetValues(exemptTables).length === 0) return;
  const tables = verifierSet<string>();
  for (let index = 0; index < observed.length; index += 1) {
    const operation = observed[index];
    if (operation?.kind === 'read' && verifierSetHas(exemptTables, operation.table)) {
      verifierSetAdd(tables, operation.table);
    }
  }
  const values = verifierSetValues(tables);
  if (values.length === 0) return;
  verifierArraySort(values, compareStrings);
  throw new Error(diagnosticMessage('KV411', verifierArrayJoin(values, ', ')));
}

function trimDiagnosticSentence(message: string): string {
  return verifierStringEndsWith(message, '.') ? verifierStringSlice(message, 0, -1) : message;
}

function hasUnobservedBranch(
  touch: CoreGraph.TouchSite,
  observedBranches: ReadonlySet<string>,
): touch is CoreGraph.TouchSite & { branch: string } {
  return touch.branch !== undefined && !verifierSetHas(observedBranches, touch.branch);
}

function touchGraphEntries(touchGraph: CoreGraph.TouchGraph): CoreGraph.TouchGraphEntry[] {
  const entries: CoreGraph.TouchGraphEntry[] = [];
  const keys = verifierObjectKeys(touchGraph);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) continue;
    const entry = touchGraph[key];
    if (entry !== undefined) verifierArrayPush(entries, entry);
  }
  return entries;
}

function stringSet(values: readonly string[]): Set<string> {
  const set = verifierSet<string>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value !== undefined) verifierSetAdd(set, value);
  }
  return set;
}

function addTouchDomains(set: Set<string>, touches: readonly CoreGraph.TouchSite[]): void {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches[index];
    if (touch !== undefined) verifierSetAdd(set, touch.domain);
  }
}

function addUnresolvedDomains(
  set: Set<string>,
  unresolved: readonly CoreGraph.UnresolvedWriteSite[],
): void {
  for (let index = 0; index < unresolved.length; index += 1) {
    const domain = unresolved[index]?.domain;
    if (domain !== undefined) verifierSetAdd(set, domain);
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
