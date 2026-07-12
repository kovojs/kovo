import type * as CoreGraph from '@kovojs/core/internal/graph';
import {
  frameworkTrustedSqlCarrier,
  isManagedSqlStatement,
  snapshotManagedSqlStatement,
} from '@kovojs/core/internal/sql-safety';

import type { DbVerificationConfig, ObservedDbOperation } from './verifier-observation.js';
import {
  verifierApply,
  verifierArrayPush,
  verifierDefineProperty,
  verifierDenseArraySnapshot,
  verifierFreeze,
  verifierGetOwnPropertyDescriptor,
  verifierIsArray,
  verifierNullRecord,
  verifierOwnKeys,
  verifierSet,
  verifierSetAdd,
  verifierSetDelete,
  verifierSetForEach,
} from './verifier-security-intrinsics.js';

const frameworkSqlSnapshotters = verifierSet<Function>();

/** @internal Register a pre-app framework-copy SQL snapshot control for fixture SSR bridging. */
export function registerFrameworkSqlSnapshotter(snapshotter: Function): () => void {
  const registered = (statement: unknown): unknown =>
    verifierApply(snapshotter, undefined, [statement]);
  verifierSetAdd(frameworkSqlSnapshotters, registered);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    verifierSetDelete(frameworkSqlSnapshotters, registered);
  };
}

interface OwnDataEntry {
  key: string;
  value: unknown;
}

function ownDataEntries(value: unknown, label: string): readonly OwnDataEntry[] {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`${label} must be a plain own-data object.`);
  }

  const entries: OwnDataEntry[] = [];
  const keys = verifierOwnKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== 'string') {
      throw new TypeError(`${label} must not contain symbol properties.`);
    }
    const descriptor = verifierGetOwnPropertyDescriptor(value, key);
    // One descriptor read per Proxy key prevents a later time-varying carrier from being consulted
    // again after the policy/statement snapshot is committed.
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label}.${key} must be an enumerable own data property.`);
    }
    verifierArrayPush(entries, verifierFreeze({ key, value: descriptor.value }));
  }
  return verifierFreeze(entries);
}

function entryValue(
  entries: readonly OwnDataEntry[],
  key: string,
): { found: true; value: unknown } | { found: false } {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry?.key === key) return { found: true, value: entry.value };
  }
  return { found: false };
}

function requiredString(entries: readonly OwnDataEntry[], key: string, label: string): string {
  const entry = entryValue(entries, key);
  if (!entry.found || typeof entry.value !== 'string') {
    throw new TypeError(`${label}.${key} must be a string own data property.`);
  }
  return entry.value;
}

function optionalString(
  entries: readonly OwnDataEntry[],
  key: string,
  label: string,
): string | undefined {
  const entry = entryValue(entries, key);
  if (!entry.found || entry.value === undefined) return undefined;
  if (typeof entry.value !== 'string') {
    throw new TypeError(`${label}.${key} must be a string own data property when present.`);
  }
  return entry.value;
}

function stringRecord(value: unknown, label: string): Readonly<Record<string, string>> {
  const entries = ownDataEntries(value, label);
  const snapshot = verifierNullRecord<string>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined || typeof entry.value !== 'string') {
      throw new TypeError(`${label} values must be strings.`);
    }
    verifierDefineProperty(snapshot, entry.key, {
      configurable: false,
      enumerable: true,
      value: entry.value,
      writable: false,
    });
  }
  return verifierFreeze(snapshot);
}

function stringArray(value: unknown, label: string): readonly string[] {
  return verifierDenseArraySnapshot(value, label, (entry) => {
    if (typeof entry !== 'string') throw new TypeError(`${label} entries must be strings.`);
    return entry;
  });
}

/** Snapshot caller-owned verifier policy once (SPEC §11.2 observed ⊆ static). */
export function snapshotDbVerificationConfig(config: DbVerificationConfig): DbVerificationConfig {
  const entries = ownDataEntries(config, 'verification config');
  const domainEntry = entryValue(entries, 'domainByTable');
  if (!domainEntry.found) {
    throw new TypeError('verification config.domainByTable must be an own data property.');
  }
  const domainByTable = stringRecord(domainEntry.value, 'verification config.domainByTable');

  const exemptEntry = entryValue(entries, 'exemptTables');
  const keyEntry = entryValue(entries, 'keyByTable');
  const dialectEntry = entryValue(entries, 'sqlDialect');
  const sqlDialect = dialectEntry.found ? dialectEntry.value : undefined;
  if (sqlDialect !== undefined && sqlDialect !== 'postgres' && sqlDialect !== 'sqlite') {
    throw new TypeError('verification config.sqlDialect must be postgres or sqlite.');
  }

  return verifierFreeze({
    domainByTable,
    ...(exemptEntry.found && exemptEntry.value !== undefined
      ? { exemptTables: stringArray(exemptEntry.value, 'verification config.exemptTables') }
      : {}),
    ...(keyEntry.found && keyEntry.value !== undefined
      ? { keyByTable: stringRecord(keyEntry.value, 'verification config.keyByTable') }
      : {}),
    ...(sqlDialect === undefined ? {} : { sqlDialect }),
  });
}

function snapshotTouchSite(value: unknown, label: string): CoreGraph.TouchSite {
  const entries = ownDataEntries(value, label);
  const keysEntry = entryValue(entries, 'keys');
  if (!keysEntry.found || (keysEntry.value !== null && typeof keysEntry.value !== 'string')) {
    throw new TypeError(`${label}.keys must be null or a string own data property.`);
  }
  const predicate = optionalString(entries, 'predicate', label);
  if (predicate !== undefined && predicate !== 'eq' && predicate !== 'non-eq') {
    throw new TypeError(`${label}.predicate must be eq or non-eq.`);
  }
  const branch = optionalString(entries, 'branch', label);
  return verifierFreeze({
    ...(branch === undefined ? {} : { branch }),
    domain: requiredString(entries, 'domain', label),
    keys: keysEntry.value,
    ...(predicate === undefined ? {} : { predicate }),
    site: requiredString(entries, 'site', label),
    via: requiredString(entries, 'via', label),
  });
}

function snapshotReadSite(value: unknown, label: string): CoreGraph.ReadSite {
  const entries = ownDataEntries(value, label);
  const keysEntry = entryValue(entries, 'keys');
  if (!keysEntry.found || (keysEntry.value !== null && typeof keysEntry.value !== 'string')) {
    throw new TypeError(`${label}.keys must be null or a string own data property.`);
  }
  const predicate = optionalString(entries, 'predicate', label);
  if (predicate !== undefined && predicate !== 'eq' && predicate !== 'non-eq') {
    throw new TypeError(`${label}.predicate must be eq or non-eq.`);
  }
  const branch = optionalString(entries, 'branch', label);
  return verifierFreeze({
    ...(branch === undefined ? {} : { branch }),
    domain: requiredString(entries, 'domain', label),
    keys: keysEntry.value,
    ...(predicate === undefined ? {} : { predicate }),
    site: requiredString(entries, 'site', label),
    source: requiredString(entries, 'source', label),
    via: requiredString(entries, 'via', label),
  });
}

function snapshotUnresolved(value: unknown, label: string): CoreGraph.UnresolvedWriteSite {
  const entries = ownDataEntries(value, label);
  const code = requiredString(entries, 'code', label);
  if (code !== 'KV404' && code !== 'KV406' && code !== 'KV413') {
    throw new TypeError(`${label}.code is not a verifier unresolved-write diagnostic.`);
  }
  const domain = optionalString(entries, 'domain', label);
  return verifierFreeze({
    code,
    ...(domain === undefined ? {} : { domain }),
    message: requiredString(entries, 'message', label),
    site: requiredString(entries, 'site', label),
  });
}

function snapshotTouchGraphEntry(value: unknown, label: string): CoreGraph.TouchGraphEntry {
  const entries = ownDataEntries(value, label);
  const touches = entryValue(entries, 'touches');
  const unresolved = entryValue(entries, 'unresolved');
  if (!touches.found || !unresolved.found) {
    throw new TypeError(`${label} requires own touches and unresolved arrays.`);
  }
  const reads = entryValue(entries, 'reads');
  const tables = entryValue(entries, 'tables');
  return verifierFreeze({
    ...(reads.found && reads.value !== undefined
      ? {
          reads: verifierDenseArraySnapshot(reads.value, `${label}.reads`, (entry, index) =>
            snapshotReadSite(entry, `${label}.reads[${index}]`),
          ),
        }
      : {}),
    ...(tables.found && tables.value !== undefined
      ? { tables: stringArray(tables.value, `${label}.tables`) }
      : {}),
    touches: verifierDenseArraySnapshot(touches.value, `${label}.touches`, (entry, index) =>
      snapshotTouchSite(entry, `${label}.touches[${index}]`),
    ),
    unresolved: verifierDenseArraySnapshot(
      unresolved.value,
      `${label}.unresolved`,
      (entry, index) => snapshotUnresolved(entry, `${label}.unresolved[${index}]`),
    ),
  });
}

export function snapshotTouchGraph(touchGraph: CoreGraph.TouchGraph): CoreGraph.TouchGraph {
  const entries = ownDataEntries(touchGraph, 'touch graph');
  const snapshot = verifierNullRecord<CoreGraph.TouchGraphEntry>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    verifierDefineProperty(snapshot, entry.key, {
      configurable: false,
      enumerable: true,
      value: snapshotTouchGraphEntry(entry.value, `touch graph.${entry.key}`),
      writable: false,
    });
  }
  return verifierFreeze(snapshot);
}

export function snapshotObservedOperation(
  value: unknown,
  label = 'observed DB operation',
): ObservedDbOperation {
  const entries = ownDataEntries(value, label);
  const kind = requiredString(entries, 'kind', label);
  if (kind !== 'read' && kind !== 'write') throw new TypeError(`${label}.kind is invalid.`);
  const mutationReadEntry = entryValue(entries, 'mutationRead');
  const mutationRead = mutationReadEntry.found ? mutationReadEntry.value : undefined;
  if (mutationRead !== undefined && typeof mutationRead !== 'boolean') {
    throw new TypeError(`${label}.mutationRead must be boolean or undefined.`);
  }
  return verifierFreeze({
    branch: optionalString(entries, 'branch', label),
    domain: optionalString(entries, 'domain', label),
    kind,
    mutationRead,
    rowKey: optionalString(entries, 'rowKey', label),
    sql: optionalString(entries, 'sql', label),
    table: requiredString(entries, 'table', label),
  });
}

export function snapshotObservedOperations(
  observed: readonly ObservedDbOperation[],
  label = 'observed DB operations',
): readonly ObservedDbOperation[] {
  return verifierDenseArraySnapshot(observed, label, (entry, index) =>
    snapshotObservedOperation(entry, `${label}[${index}]`),
  );
}

export function snapshotDomains(domains: readonly string[]): readonly string[] {
  return stringArray(domains, 'declared read domains');
}

/** Snapshot a query definition's declared domains through own-data descriptors (SPEC §11.2). */
export function snapshotQueryReadDomains(
  query: object,
  label = 'query fixture',
): readonly string[] {
  const readsDescriptor = verifierGetOwnPropertyDescriptor(query, 'reads');
  if (readsDescriptor === undefined) return snapshotDomains([]);
  if (!('value' in readsDescriptor)) {
    throw new TypeError(`${label}.reads must be a stable own data property.`);
  }
  if (readsDescriptor.value === undefined) return snapshotDomains([]);
  return verifierDenseArraySnapshot(readsDescriptor.value, `${label}.reads`, (domain, index) => {
    if (typeof domain !== 'object' || domain === null) {
      throw new TypeError(`${label}.reads[${index}] must be a domain object.`);
    }
    const keyDescriptor = verifierGetOwnPropertyDescriptor(domain, 'key');
    if (
      keyDescriptor === undefined ||
      !('value' in keyDescriptor) ||
      typeof keyDescriptor.value !== 'string'
    ) {
      throw new TypeError(`${label}.reads[${index}].key must be a string own data property.`);
    }
    return keyDescriptor.value;
  });
}

/**
 * Snapshot an externally supplied SQL carrier once and pass that same immutable value to both the
 * parser and adapter.  Framework-minted statements reuse the core-managed snapshot; generic test
 * adapters receive a frozen own-data reconstruction preserving text/sql and parameter key names.
 */
export function snapshotVerifierSqlStatement(statement: unknown): unknown {
  if (typeof statement === 'string') return statement;
  if (typeof statement !== 'object' || statement === null) {
    throw new TypeError('Kovo DB verifier SQL statements must be strings or own-data carriers.');
  }
  if (isManagedSqlStatement(statement)) return statement;

  const managed = snapshotManagedSqlStatement(statement);
  if (managed.ok && managed.statement.provenance !== 'plain-separated-carrier') {
    return managed.statement;
  }

  const bridged = snapshotFrameworkCopySqlStatement(statement);
  if (bridged !== undefined) return bridged;

  const entries = ownDataEntries(statement, 'SQL statement carrier');
  const textEntry = entryValue(entries, 'text');
  const sqlEntry = entryValue(entries, 'sql');
  const text = textEntry.found ? textEntry.value : undefined;
  const sql = sqlEntry.found ? sqlEntry.value : undefined;
  if (typeof text !== 'string' && typeof sql !== 'string') {
    throw new TypeError('Kovo DB verifier SQL statement carriers require own string text or sql.');
  }

  const snapshot = verifierNullRecord<unknown>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    const value = verifierIsArray(entry.value)
      ? verifierDenseArraySnapshot(
          entry.value,
          `SQL statement carrier.${entry.key}`,
          (item) => item,
        )
      : entry.value;
    verifierDefineProperty(snapshot, entry.key, {
      configurable: false,
      enumerable: true,
      value,
      writable: false,
    });
  }
  return verifierFreeze(snapshot);
}

function snapshotFrameworkCopySqlStatement(statement: object): unknown | undefined {
  let reconstructed: unknown;
  verifierSetForEach(frameworkSqlSnapshotters, (snapshotter) => {
    if (reconstructed !== undefined) return;
    const result = verifierApply<unknown>(snapshotter, undefined, [statement]);
    if (typeof result !== 'object' || result === null) return;
    const okDescriptor = verifierGetOwnPropertyDescriptor(result, 'ok');
    if (okDescriptor === undefined || !('value' in okDescriptor)) {
      throw new TypeError('Framework SQL snapshot control returned an unstable result.');
    }
    if (okDescriptor.value !== true) return;
    const statementDescriptor = verifierGetOwnPropertyDescriptor(result, 'statement');
    if (
      statementDescriptor === undefined ||
      !('value' in statementDescriptor) ||
      typeof statementDescriptor.value !== 'object' ||
      statementDescriptor.value === null
    ) {
      throw new TypeError('Framework SQL snapshot control omitted its statement artifact.');
    }
    const foreignStatement = statementDescriptor.value;
    const textDescriptor = verifierGetOwnPropertyDescriptor(foreignStatement, 'text');
    const sqlDescriptor = verifierGetOwnPropertyDescriptor(foreignStatement, 'sql');
    const valuesDescriptor = verifierGetOwnPropertyDescriptor(foreignStatement, 'values');
    if (
      textDescriptor === undefined ||
      !('value' in textDescriptor) ||
      typeof textDescriptor.value !== 'string' ||
      sqlDescriptor === undefined ||
      !('value' in sqlDescriptor) ||
      sqlDescriptor.value !== textDescriptor.value ||
      valuesDescriptor === undefined ||
      !('value' in valuesDescriptor)
    ) {
      throw new TypeError('Framework SQL snapshot control returned an invalid statement artifact.');
    }
    const values = verifierDenseArraySnapshot(
      valuesDescriptor.value,
      'framework-copy SQL parameters',
      (value) => value,
    );
    reconstructed = frameworkTrustedSqlCarrier(
      { text: textDescriptor.value, values },
      'framework-owned integration fixture SQL bridge',
    );
  });
  return reconstructed;
}
