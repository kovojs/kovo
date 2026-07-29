import { isSecret } from '@kovojs/core/security';
import { isScopedKey } from '@kovojs/core/internal/storage';

import {
  guardArgsFileReceiptForSource,
  isGuardArgsFileReceipt,
} from './guard-args-file-receipt.js';
import { snapshotPinnedDataTreeValue } from './request-carrier.js';
import { securityIsDate } from './response-security-intrinsics.js';
import {
  createWitnessWeakSet,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

const GuardArgsTypeError = TypeError;
const guardArgsReceipts = createWitnessWeakSet<object>();
const rejectedDateMessage =
  'Validated guard args cannot contain Date values because JavaScript Date internal slots are mutable through borrowed native mutators; use an ISO timestamp string or epoch number instead.';

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

  if (securityIsDate(value)) {
    // SPEC §6.6 / §10.3 C15: Object.freeze() and own throwing methods cannot freeze Date's
    // [[DateValue]] internal slot. Date.prototype.setTime.call(receipt, value) bypasses both and
    // can change an accepted ownership key before the final read/write consumer. A Proxy membrane
    // would lose native Date brand/borrowed-read/structured-clone semantics and would make the
    // proxy, rather than a reconstruct/box/own door, the security mechanism. Reject the value and
    // require an actually immutable timestamp representation.
    throw new GuardArgsTypeError(rejectedDateMessage);
  }
  return undefined;
}
