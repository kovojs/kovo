import { createHash } from 'node:crypto';

import { scopedKeyFactsFor } from '@kovojs/core/internal/storage';

import {
  createWitnessWeakMap,
  witnessArrayAppend,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessNumberIsSafeInteger,
  witnessObjectKeys,
  witnessReflectApply,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';
import { scopedKey } from './state-key.js';

const derivedVectorDatasetBrand: unique symbol = Symbol('kovo.derived-vector-dataset');

const DERIVED_VECTOR_NAMESPACE_VERSION = 'kovo-derived-vector-v1';
const MAX_DERIVED_ARTIFACT_KEY_LENGTH = 960;
const MAX_DERIVED_VECTOR_BATCH_SIZE = 10_000;

/** Input reconstructed by Kovo for one principal-scoped vector query. */
export interface DerivedVectorQueryInput<Query> {
  /** Opaque physical namespace derived from the complete inherited `ScopedKey` frame. */
  readonly namespace: string;
  /** Adapter-specific vector query. It cannot select or replace the namespace. */
  readonly query: Query;
}

/** Input reconstructed by Kovo for one principal-scoped vector write. */
export interface DerivedVectorUpsertInput<Record> {
  /** Opaque physical namespace derived from the complete inherited `ScopedKey` frame. */
  readonly namespace: string;
  /** Dense, bounded, immutable record-list snapshot. */
  readonly records: readonly Record[];
}

/**
 * Deployment adapter consumed only by {@link derived}.
 *
 * The adapter is trusted to implement its namespace argument faithfully. Kovo reconstructs that
 * argument and never exposes a caller-selected namespace through the public dataset handle.
 */
export interface DerivedVectorStoreAdapter<Record, Query, Match> {
  /** Search only the exact namespace supplied by Kovo. */
  readonly query: (
    input: DerivedVectorQueryInput<Query>,
  ) => Promise<readonly Match[]> | readonly Match[];
  /** Insert or replace records only in the exact namespace supplied by Kovo. */
  readonly upsert: (input: DerivedVectorUpsertInput<Record>) => Promise<void> | void;
}

/** Static construction options for a principal-scoped derived dataset. */
export interface DerivedVectorDatasetOptions {
  /** Stable logical artifact key; Kovo combines it with the request principal's `ScopedKey`. */
  readonly key: string;
  /** The first shipped derived-data family is deliberately the finite vector/RAG case. */
  readonly kind: 'vector';
}

/**
 * Framework-owned, principal-scoped vector/RAG dataset.
 *
 * Every read and write requires the exact framework request carrier. The handle derives a fresh
 * `ScopedKey` at each operation, so an artifact written for principal A cannot be queried by
 * principal B even when both use the same logical key. The private brand is type-level ergonomics;
 * the closure-owned adapter methods and runtime `ScopedKey` witness enforce the boundary.
 */
export interface DerivedVectorDataset<Record, Query, Match> {
  readonly [derivedVectorDatasetBrand]: 'kovo-derived-vector-dataset';
  /** Query the vector namespace re-derived from this exact request principal. */
  query(request: unknown, query: Query): Promise<readonly Match[]>;
  /** Persist records under the vector namespace re-derived from this exact request principal. */
  upsert(request: unknown, records: readonly Record[]): Promise<void>;
}

interface DerivedVectorDatasetFacts<Record, Query, Match> {
  readonly adapter: DerivedVectorStoreAdapter<Record, Query, Match>;
  readonly key: string;
  readonly query: DerivedVectorStoreAdapter<Record, Query, Match>['query'];
  readonly upsert: DerivedVectorStoreAdapter<Record, Query, Match>['upsert'];
}

const derivedVectorDatasetWitnesses = createWitnessWeakMap<
  object,
  Readonly<{ readonly kind: 'vector' }>
>();

/**
 * Construct the only supported door from owner-scoped database data to a vector/RAG store.
 *
 * SPEC §6.6 and §10.3 C9: the physical artifact identity is reconstructed from the complete
 * request-derived `ScopedKey`; an app cannot supply a namespace, principal id, or structural brand.
 */
export function derived<Record, Query, Match>(
  adapter: DerivedVectorStoreAdapter<Record, Query, Match>,
  options: DerivedVectorDatasetOptions,
): DerivedVectorDataset<Record, Query, Match> {
  const facts = snapshotDerivedVectorDatasetFacts(adapter, options);
  const value: DerivedVectorDataset<Record, Query, Match> = {
    [derivedVectorDatasetBrand]: 'kovo-derived-vector-dataset',
    query: async (request: unknown, query: Query): Promise<readonly Match[]> => {
      const namespace = namespaceForRequest(request, facts.key);
      const input = witnessFreeze({ namespace, query });
      const result = await witnessReflectApply<Promise<readonly Match[]> | readonly Match[]>(
        facts.query,
        facts.adapter,
        [input],
      );
      return snapshotDenseArray(result, 'derived vector query result');
    },
    upsert: async (request: unknown, records: readonly Record[]): Promise<void> => {
      const namespace = namespaceForRequest(request, facts.key);
      const recordSnapshot = snapshotDenseArray(records, 'derived vector upsert records');
      const input = witnessFreeze({ namespace, records: recordSnapshot });
      await witnessReflectApply<Promise<void> | void>(facts.upsert, facts.adapter, [input]);
    },
  };

  const closed = witnessFreeze(value);
  witnessWeakMapSet(derivedVectorDatasetWitnesses, closed, witnessFreeze({ kind: 'vector' }));
  return closed;
}

function snapshotDerivedVectorDatasetFacts<Record, Query, Match>(
  adapter: DerivedVectorStoreAdapter<Record, Query, Match>,
  options: DerivedVectorDatasetOptions,
): DerivedVectorDatasetFacts<Record, Query, Match> {
  if ((typeof adapter !== 'object' && typeof adapter !== 'function') || adapter === null) {
    throw new TypeError('KV452: derived() requires a vector-store adapter object.');
  }
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('KV452: derived() requires exact vector dataset options.');
  }
  const optionKeys = witnessObjectKeys(options);
  const firstOptionKey =
    optionKeys.length > 0 ? ownDataValue(optionKeys, '0', 'derived() option keys') : undefined;
  const secondOptionKey =
    optionKeys.length > 1 ? ownDataValue(optionKeys, '1', 'derived() option keys') : undefined;
  if (
    optionKeys.length !== 2 ||
    !(
      (firstOptionKey === 'key' && secondOptionKey === 'kind') ||
      (firstOptionKey === 'kind' && secondOptionKey === 'key')
    )
  ) {
    throw new TypeError('KV452: derived() options must contain exactly key and kind.');
  }
  const key = ownDataValue(options, 'key', 'derived() options');
  const kind = ownDataValue(options, 'kind', 'derived() options');
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_DERIVED_ARTIFACT_KEY_LENGTH) {
    throw new TypeError(
      `KV452: derived() key must be a 1..${MAX_DERIVED_ARTIFACT_KEY_LENGTH} code-unit string.`,
    );
  }
  if (kind !== 'vector') {
    throw new TypeError('KV452: derived() currently supports only kind: vector.');
  }
  const query = ownCallable<
    [DerivedVectorQueryInput<Query>],
    Promise<readonly Match[]> | readonly Match[]
  >(adapter, 'query', 'derived() vector adapter');
  const upsert = ownCallable<[DerivedVectorUpsertInput<Record>], Promise<void> | void>(
    adapter,
    'upsert',
    'derived() vector adapter',
  );
  return witnessFreeze({ adapter, key, query, upsert });
}

function ownCallable<Arguments extends unknown[], Result>(
  value: object,
  key: string,
  label: string,
): (...args: Arguments) => Result {
  const callable = ownDataValue(value, key, label);
  if (typeof callable !== 'function') {
    throw new TypeError(`${label}.${key} must be an own callable data property.`);
  }
  return callable as (...args: Arguments) => Result;
}

function ownDataValue(value: object, key: string, label: string): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`${label}.${key} must be an own data property.`);
  }
  return descriptor.value;
}

function namespaceForRequest(request: unknown, artifactKey: string): string {
  const inherited = scopedKey(request, `derived/vector/${artifactKey}`);
  const frame = scopedKeyFactsFor(inherited).frame;
  const digest = createHash('sha256').update(frame, 'utf8').digest('hex');
  return `${DERIVED_VECTOR_NAMESPACE_VERSION}/${digest}`;
}

function snapshotDenseArray<Value>(value: readonly Value[], label: string): readonly Value[] {
  if (!witnessIsArray(value)) throw new TypeError(`KV452: ${label} must be an array.`);
  const lengthDescriptor = witnessGetOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number' ||
    !witnessNumberIsSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > MAX_DERIVED_VECTOR_BATCH_SIZE
  ) {
    throw new TypeError(
      `KV452: ${label} must contain at most ${MAX_DERIVED_VECTOR_BATCH_SIZE} entries.`,
    );
  }
  const result: Value[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(value, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`KV452: ${label} must be dense own data.`);
    }
    witnessArrayAppend(result, descriptor.value as Value, label);
  }
  return witnessFreeze(result);
}
