import { types as nodeUtilTypes } from 'node:util';

import {
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessObjectIs,
  witnessOwnKeys,
} from './security-witness-intrinsics.js';

const sqliteSchemaIsProxy = nodeUtilTypes.isProxy;

/**
 * Snapshot a Better Auth SQLite schema record without retaining accessors, proxies, or mutable
 * caller-owned containers.
 *
 * @internal
 */
export function snapshotSqliteSchemaRecord(
  schema: Record<string, unknown>,
): Readonly<Record<string, unknown>> {
  if (sqliteSchemaIsProxy(schema)) {
    throw new TypeError('SQLite adapter schema must not be a Proxy.');
  }
  const snapshot = witnessCreateNullRecord<unknown>();
  const keys = witnessOwnKeys(schema);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (typeof key !== 'string') {
      throw new TypeError('SQLite adapter schema must not contain symbol keys.');
    }
    const before = witnessGetOwnPropertyDescriptor(schema, key);
    const after = witnessGetOwnPropertyDescriptor(schema, key);
    if (
      before === undefined ||
      after === undefined ||
      !('value' in before) ||
      !('value' in after) ||
      !witnessObjectIs(before.value, after.value)
    ) {
      throw new TypeError(`SQLite adapter schema.${key} must be a stable own-data property.`);
    }
    witnessDefineProperty(snapshot, key, {
      configurable: true,
      enumerable: before.enumerable === true,
      value: before.value,
      writable: true,
    });
  }
  return witnessFreeze(snapshot);
}
