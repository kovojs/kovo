import { isSecret } from '@kovojs/core';
import { isScopedKey } from '@kovojs/core/internal/storage';

import {
  guardArgsFileReceiptForSource,
  isGuardArgsFileReceipt,
} from './guard-args-file-receipt.js';
import { snapshotPinnedDataTreeValue } from './request-carrier.js';
import {
  securityCreateDate,
  securityDateGetTime,
  securityIsDate,
  securityNumberIsNaN,
} from './response-security-intrinsics.js';
import {
  createWitnessWeakSet,
  witnessDefineProperty,
  witnessFreeze,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

const GuardArgsTypeError = TypeError;
const guardArgsReceipts = createWitnessWeakSet<object>();
const dateMutationRefusal = witnessFreeze((): never => {
  throw new GuardArgsTypeError('Validated guard args Date receipts are immutable.');
});
const dateMutators = witnessFreeze([
  'setDate',
  'setFullYear',
  'setHours',
  'setMilliseconds',
  'setMinutes',
  'setMonth',
  'setSeconds',
  'setTime',
  'setUTCDate',
  'setUTCFullYear',
  'setUTCHours',
  'setUTCMilliseconds',
  'setUTCMinutes',
  'setUTCMonth',
  'setUTCSeconds',
  'setYear',
] as const);

/**
 * @internal Commit parsed query/mutation args to the exact bounded value observed by both the
 * guard chain and the loader/handler (SPEC §6.6 / §10.3 C15).
 */
export function snapshotGuardArgsReceipt<Value>(value: Value): Value {
  if (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    witnessWeakSetHas(guardArgsReceipts, value)
  ) {
    return value;
  }

  const receipt = snapshotPinnedDataTreeValue(value, {
    label: 'Validated guard args',
    snapshotLeaf: snapshotGuardArgsLeaf,
  });
  if ((typeof receipt === 'object' || typeof receipt === 'function') && receipt !== null) {
    witnessWeakSetAdd(guardArgsReceipts, receipt);
  }
  return receipt;
}

function snapshotGuardArgsLeaf(
  value: object,
): { readonly handled: true; readonly value: object } | undefined {
  // These values carry module-private receipts and are already immutable at their authority
  // boundary. Reconstructing them structurally would destroy their witness and silently revoke
  // the very value the schema validated.
  if (isScopedKey(value) || isSecret(value) || isGuardArgsFileReceipt(value)) {
    return { handled: true, value };
  }
  const fileReceipt = guardArgsFileReceiptForSource(value);
  if (fileReceipt !== undefined) return { handled: true, value: fileReceipt };

  if (!securityIsDate(value)) return undefined;
  const timestamp = securityDateGetTime(value);
  if (securityNumberIsNaN(timestamp)) {
    throw new GuardArgsTypeError('Validated guard args cannot contain an invalid Date.');
  }
  const receipt = securityCreateDate(timestamp);
  for (let index = 0; index < dateMutators.length; index += 1) {
    witnessDefineProperty(receipt, dateMutators[index]!, {
      configurable: false,
      enumerable: false,
      value: dateMutationRefusal,
      writable: false,
    });
  }
  const pinned = witnessFreeze(receipt);
  witnessWeakSetAdd(guardArgsReceipts, pinned);
  return { handled: true, value: pinned };
}
