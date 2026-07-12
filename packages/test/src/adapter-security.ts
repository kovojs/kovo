import { createFrameworkManagedSqlDispatchProxy } from '@kovojs/server/internal/execution';
import {
  verifierArrayJoin,
  verifierArrayPush,
  verifierArraySort,
  verifierDenseArraySnapshot,
  verifierFreeze,
  verifierGetOwnPropertyDescriptor,
  verifierNullRecord,
  verifierObjectKeys,
  verifierReflectGet,
  verifierDefineProperty,
  verifierSet,
  verifierSetAdd,
  verifierSetValues,
} from './verifier-security-intrinsics.js';

/**
 * Mark a repo-owned adapter object as safe for its captured table-helper dispatch to cross the
 * server's managed SQL membrane. The server still classifies every direct SQL method itself;
 * only the adapter's `read`/`write` helpers retain this witnessed dispatch (SPEC §11.2).
 */
export function createManagedAdapterDispatchProxy<Target extends object>(target: Target): Target {
  return createFrameworkManagedSqlDispatchProxy(target, {
    get(value, property, receiver) {
      return verifierReflectGet(value, property, receiver);
    },
  });
}

/** @internal Mark a generic harness fixture while retaining server guards for known SQL sinks. */
export function createManagedTestFixtureDispatchProxy<Target extends object>(
  target: Target,
): Target {
  return createFrameworkManagedSqlDispatchProxy(
    target,
    {
      get(value, property, receiver) {
        return verifierReflectGet(value, property, receiver);
      },
    },
    'test-fixture',
  );
}

/** @internal Test-fixture proxy whose private capability shell delegates ordinary DB access. */
export function createManagedTestFixtureDelegatingProxy<Target extends object>(
  target: Target,
  delegate: object,
): Target {
  return createFrameworkManagedSqlDispatchProxy(
    target,
    {
      get(value, property, receiver) {
        return verifierGetOwnPropertyDescriptor(value, property) === undefined
          ? verifierReflectGet(delegate, property, delegate)
          : verifierReflectGet(value, property, receiver);
      },
    },
    'test-fixture',
  );
}

export interface AdapterDeclaredWritePolicy {
  readonly dialect?: 'postgres' | 'sqlite';
  readonly tables: readonly string[];
  readonly touches: readonly string[];
}

function ownData(value: object, property: PropertyKey, label: string): unknown {
  const descriptor = verifierGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError(`${label}.${String(property)} must be a stable own data property.`);
  }
  return descriptor.value;
}

export function snapshotAdapterPolicy(
  policy: object,
  dialect: 'postgres' | 'sqlite',
): AdapterDeclaredWritePolicy {
  const suppliedDialect = ownData(policy, 'dialect', 'declared-write policy');
  if (suppliedDialect !== undefined && suppliedDialect !== dialect) {
    throw new TypeError(`declared-write policy dialect must be ${dialect}.`);
  }
  return verifierFreeze({
    dialect,
    tables: snapshotStringArray(
      ownData(policy, 'tables', 'declared-write policy') ?? [],
      'declared-write policy.tables',
    ),
    touches: snapshotStringArray(
      ownData(policy, 'touches', 'declared-write policy') ?? [],
      'declared-write policy.touches',
    ),
  });
}

export function snapshotAdapterValues(
  values: readonly unknown[],
  label = 'SQL parameters',
): readonly unknown[] {
  return verifierDenseArraySnapshot(values, label, (value) => value);
}

export function snapshotAdapterStatementCarrier(
  statement: object,
  params: readonly unknown[],
  label: string,
): Readonly<{ text: string; values: readonly unknown[] }> {
  const textDescriptor = verifierGetOwnPropertyDescriptor(statement, 'text');
  const sqlDescriptor = verifierGetOwnPropertyDescriptor(statement, 'sql');
  if (
    (textDescriptor !== undefined && !('value' in textDescriptor)) ||
    (sqlDescriptor !== undefined && !('value' in sqlDescriptor))
  ) {
    throw new TypeError(`${label} sql/text must be stable own data properties.`);
  }
  const text =
    textDescriptor !== undefined &&
    'value' in textDescriptor &&
    typeof textDescriptor.value === 'string'
      ? textDescriptor.value
      : sqlDescriptor !== undefined &&
          'value' in sqlDescriptor &&
          typeof sqlDescriptor.value === 'string'
        ? sqlDescriptor.value
        : undefined;
  if (text === undefined) throw new TypeError(`${label} must include own string sql/text.`);

  const valuesDescriptor = verifierGetOwnPropertyDescriptor(statement, 'values');
  if (valuesDescriptor !== undefined && !('value' in valuesDescriptor)) {
    throw new TypeError(`${label}.values must be a stable own data property.`);
  }
  const values =
    valuesDescriptor !== undefined && 'value' in valuesDescriptor ? valuesDescriptor.value : params;
  return verifierFreeze({ text, values: snapshotAdapterValues(values as readonly unknown[]) });
}

export function snapshotRowEntries(
  value: Record<string, unknown>,
): readonly (readonly [string, unknown])[] {
  const keys = verifierObjectKeys(value);
  const entries: (readonly [string, unknown])[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) continue;
    const descriptor = verifierGetOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`database row ${key} must be an enumerable own data property.`);
    }
    verifierArrayPush(entries, verifierFreeze([key, descriptor.value] as const));
  }
  return verifierFreeze(entries);
}

export function snapshotOwnDataRecord(
  value: object,
  label: string,
): Readonly<Record<string, unknown>> {
  const snapshot = verifierNullRecord<unknown>();
  const keys = verifierObjectKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) continue;
    const descriptor = verifierGetOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label}.${key} must be an enumerable own data property.`);
    }
    verifierDefineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: descriptor.value,
      writable: false,
    });
  }
  return verifierFreeze(snapshot);
}

export function formatPolicyValues(values: readonly string[]): string {
  const unique = verifierSet<string>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value !== undefined) verifierSetAdd(unique, value);
  }
  const sorted = verifierSetValues(unique);
  verifierArraySort(sorted, compareStrings);
  return verifierArrayJoin(sorted, ', ');
}

export function snapshotStringArray(value: unknown, label: string): readonly string[] {
  return verifierDenseArraySnapshot(value, label, (entry) => {
    if (typeof entry !== 'string') throw new TypeError(`${label} entries must be strings.`);
    return entry;
  });
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
