import type { StorageCapability } from '@kovojs/core';
import {
  countPrincipalStorageObjects,
  erasePrincipalStorageObjects,
} from '@kovojs/core/internal/storage';
import { canonicalJsonStringify } from '@kovojs/core/internal/json';

import { isProvenPrincipal, declareSystemPrincipal } from './auth-principal.js';
import { createPrincipalErasureCryptoHandle } from './crypto-authority.js';
import { usePostgresAppRuntimeDb } from './internal/postgres-capability.js';
import type { SigningKeyRing } from './keyring.js';
import {
  countPostgresMutationReplayPrincipalRows,
  erasePostgresMutationReplayPrincipalRows,
  persistedReplayPrincipal,
} from './postgres-replay.js';
import type { KovoPostgresAppRuntimeDb } from './postgres-runtime.js';
import { tombstonePrincipalEpoch } from './principal-epoch.js';
import {
  countDurableTaskPrincipalRows,
  createDurableTaskSqlExecutor,
  eraseDurableTaskPrincipalRows,
} from './task-queue.js';
import { requestStateNow } from './request-state-intrinsics.js';
import {
  createWitnessWeakSet,
  witnessArrayAppend,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessObjectIs,
  witnessRegExpTest,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

/** Exact receipt vocabulary for a point-in-time principal-erasure absence proof. */
export interface PrincipalErasureReceipt {
  readonly absenceProbed: true;
  readonly blobObjectsDeleted: number;
  readonly completedAtMs: number;
  readonly durableTaskRowsDeleted: number;
  readonly keyId: string;
  readonly mutationReplayRowsDeleted: number;
  /** One-way principal commitment; the raw principal is never copied into the receipt. */
  readonly principalCommitment: `sha256:${string}`;
  readonly signature: string;
  readonly storageAdaptersProbed: number;
  readonly tombstoneEpoch: number;
  readonly version: 'kovo-principal-erasure-receipt/v1';
}

/** Complete, non-empty sink set required by {@link erasePrincipal}. */
export type PrincipalErasureStorageSet = readonly [StorageCapability, ...StorageCapability[]];

/** Runtime and signing authority required to erase one principal from Kovo-owned sinks. */
export interface ErasePrincipalOptions {
  /** Exact app runtime whose framework-system task/replay ledgers are covered. */
  readonly runtime: KovoPostgresAppRuntimeDb;
  /** Exact framework key ring used only by the fixed receipt-signing purpose. */
  readonly signingKeyRing: SigningKeyRing;
  /** Every storage adapter wired by this app; omission is outside the receipt's claim. */
  readonly storage: PrincipalErasureStorageSet;
}

/** Fail-closed error raised when any mandatory post-delete absence probe finds residue. */
export class PrincipalErasureIncompleteError extends Error {
  readonly sink: 'blobs' | 'durable-tasks' | 'mutation-replay';

  constructor(sink: PrincipalErasureIncompleteError['sink']) {
    super(`Principal erasure absence probe found residue in ${sink}.`);
    this.name = 'PrincipalErasureIncompleteError';
    this.sink = sink;
  }
}

interface PrincipalErasureSignedPayload {
  readonly absenceProbed: true;
  readonly blobObjectsDeleted: number;
  readonly completedAtMs: number;
  readonly durableTaskRowsDeleted: number;
  readonly mutationReplayRowsDeleted: number;
  readonly principalCommitment: `sha256:${string}`;
  readonly storageAdaptersProbed: number;
  readonly tombstoneEpoch: number;
  readonly version: PrincipalErasureReceipt['version'];
}

/**
 * Tombstone one identity, erase all currently enumerable Kovo-owned residue, independently probe
 * every supplied sink, and only then mint a signed point-in-time receipt (SPEC §10.3).
 */
export async function erasePrincipal(
  principal: string,
  options: ErasePrincipalOptions,
): Promise<PrincipalErasureReceipt> {
  if (!isProvenPrincipal(principal) || principal.length > 1_024) {
    throw new TypeError('erasePrincipal() requires a bounded proven principal id.');
  }
  const runtime = stableErasureOption<KovoPostgresAppRuntimeDb>(options, 'runtime');
  const signingKeyRing = stableErasureOption<SigningKeyRing>(options, 'signingKeyRing');
  const storage = snapshotErasureStorageSet(
    stableErasureOption<PrincipalErasureStorageSet>(options, 'storage'),
  );

  // Resolve through the module-private runtime registry before reading public-looking properties;
  // a structural cast cannot smuggle arbitrary SQL or epoch stores into this sink.
  const db = usePostgresAppRuntimeDb(runtime, {
    principalPosture: declareSystemPrincipal('erase one tombstoned principal from Kovo sinks', {
      ingress: 'endpoint',
      operation: 'write',
      surface: 'erasePrincipal',
    }),
  });
  await runtime.ready;
  const executor = createDurableTaskSqlExecutor(db);

  // Validate every supplied adapter's exact, internally registered enumeration authority before
  // making the irreversible tombstone transition. This preflight reads only; it cannot mint an
  // erasure receipt and its count is deliberately not reused as the final absence proof.
  for (let index = 0; index < storage.length; index += 1) {
    await countPrincipalStorageObjects(storage[index]!, principal);
  }
  const tombstone = await tombstonePrincipalEpoch(
    runtime.principalEpochStore,
    principal,
    'principal-deletion',
  );

  let blobObjectsDeleted = 0;
  for (let index = 0; index < storage.length; index += 1) {
    const result = await erasePrincipalStorageObjects(storage[index]!, principal);
    blobObjectsDeleted += result.deleted;
    if (result.remaining !== 0) throw new PrincipalErasureIncompleteError('blobs');
  }
  const durableTaskRowsDeleted = await eraseDurableTaskPrincipalRows(executor, principal);
  const mutationReplayRowsDeleted = await erasePostgresMutationReplayPrincipalRows(
    executor,
    principal,
  );

  // Mandatory second pass after every deletion phase. A receipt never reports best effort.
  for (let index = 0; index < storage.length; index += 1) {
    if ((await countPrincipalStorageObjects(storage[index]!, principal)) !== 0) {
      throw new PrincipalErasureIncompleteError('blobs');
    }
  }
  if ((await countDurableTaskPrincipalRows(executor, principal)) !== 0) {
    throw new PrincipalErasureIncompleteError('durable-tasks');
  }
  if ((await countPostgresMutationReplayPrincipalRows(executor, principal)) !== 0) {
    throw new PrincipalErasureIncompleteError('mutation-replay');
  }

  const payload = witnessFreeze<PrincipalErasureSignedPayload>({
    absenceProbed: true,
    blobObjectsDeleted,
    completedAtMs: requestStateNow(),
    durableTaskRowsDeleted,
    mutationReplayRowsDeleted,
    principalCommitment: persistedReplayPrincipal(principal) as `sha256:${string}`,
    storageAdaptersProbed: storage.length,
    tombstoneEpoch: tombstone.epoch,
    version: 'kovo-principal-erasure-receipt/v1',
  });
  const signer = createPrincipalErasureCryptoHandle(signingKeyRing);
  const signed = signer.sign(principalErasurePayloadText(payload));
  return witnessFreeze({ ...payload, keyId: signed.keyId, signature: signed.signature });
}

/** Verify a receipt against the same fixed-purpose key ring without granting generic signing. */
export function verifyPrincipalErasureReceipt(
  receipt: PrincipalErasureReceipt,
  signingKeyRing: SigningKeyRing,
): boolean {
  try {
    const snapshot = snapshotPrincipalErasureReceipt(receipt);
    const signer = createPrincipalErasureCryptoHandle(signingKeyRing);
    return signer.verify(principalErasurePayloadText(snapshot), snapshot.signature, snapshot.keyId)
      .ok;
  } catch {
    return false;
  }
}

function principalErasurePayloadText(payload: PrincipalErasureSignedPayload): string {
  return canonicalJsonStringify({
    absenceProbed: payload.absenceProbed,
    blobObjectsDeleted: payload.blobObjectsDeleted,
    completedAtMs: payload.completedAtMs,
    durableTaskRowsDeleted: payload.durableTaskRowsDeleted,
    mutationReplayRowsDeleted: payload.mutationReplayRowsDeleted,
    principalCommitment: payload.principalCommitment,
    storageAdaptersProbed: payload.storageAdaptersProbed,
    tombstoneEpoch: payload.tombstoneEpoch,
    version: payload.version,
  });
}

function snapshotPrincipalErasureReceipt(source: PrincipalErasureReceipt): PrincipalErasureReceipt {
  const absenceProbed = stableErasureOption<unknown>(source, 'absenceProbed');
  const blobObjectsDeleted = erasureCount(source, 'blobObjectsDeleted');
  const completedAtMs = erasureCount(source, 'completedAtMs');
  const durableTaskRowsDeleted = erasureCount(source, 'durableTaskRowsDeleted');
  const keyId = stableErasureOption<unknown>(source, 'keyId');
  const mutationReplayRowsDeleted = erasureCount(source, 'mutationReplayRowsDeleted');
  const principalCommitment = stableErasureOption<unknown>(source, 'principalCommitment');
  const signature = stableErasureOption<unknown>(source, 'signature');
  const storageAdaptersProbed = erasureCount(source, 'storageAdaptersProbed');
  const tombstoneEpoch = erasureCount(source, 'tombstoneEpoch');
  const version = stableErasureOption<unknown>(source, 'version');
  if (
    absenceProbed !== true ||
    version !== 'kovo-principal-erasure-receipt/v1' ||
    typeof keyId !== 'string' ||
    !witnessRegExpTest(/^[A-Za-z0-9_-]+$/u, keyId) ||
    typeof signature !== 'string' ||
    !witnessRegExpTest(/^[A-Za-z0-9_-]{43}$/u, signature) ||
    typeof principalCommitment !== 'string' ||
    !witnessRegExpTest(/^sha256:[A-Za-z0-9+/]{43}=$/u, principalCommitment) ||
    storageAdaptersProbed < 1 ||
    tombstoneEpoch < 1
  ) {
    throw new TypeError('Principal erasure receipt is invalid.');
  }
  return witnessFreeze({
    absenceProbed: true,
    blobObjectsDeleted,
    completedAtMs,
    durableTaskRowsDeleted,
    keyId,
    mutationReplayRowsDeleted,
    principalCommitment: principalCommitment as `sha256:${string}`,
    signature,
    storageAdaptersProbed,
    tombstoneEpoch,
    version,
  });
}

function snapshotErasureStorageSet(source: unknown): PrincipalErasureStorageSet {
  if (!witnessIsArray(source) || source.length < 1 || source.length > 1_024) {
    throw new TypeError('erasePrincipal() storage must be a non-empty bounded dense array.');
  }
  const snapshot: StorageCapability[] = [];
  const seen = createWitnessWeakSet<object>();
  for (let index = 0; index < source.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(source, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      (typeof descriptor.value !== 'object' && typeof descriptor.value !== 'function') ||
      descriptor.value === null
    ) {
      throw new TypeError('erasePrincipal() storage must be a dense own-data array.');
    }
    if (witnessWeakSetHas(seen, descriptor.value)) {
      throw new TypeError('erasePrincipal() storage entries must be unique exact capabilities.');
    }
    witnessWeakSetAdd(seen, descriptor.value);
    witnessArrayAppend(snapshot, descriptor.value as StorageCapability, 'principal erasure stores');
  }
  return witnessFreeze(snapshot) as unknown as PrincipalErasureStorageSet;
}

function stableErasureOption<Value>(source: object, property: PropertyKey): Value {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    throw new TypeError('Principal erasure carrier must be a stable own-data record.');
  }
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value)
  ) {
    throw new TypeError(`Principal erasure ${String(property)} must be stable own data.`);
  }
  return before.value as Value;
}

function erasureCount(source: object, property: keyof PrincipalErasureReceipt): number {
  const value = stableErasureOption<unknown>(source, property);
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`Principal erasure receipt ${property} must be a non-negative integer.`);
  }
  return value as number;
}
