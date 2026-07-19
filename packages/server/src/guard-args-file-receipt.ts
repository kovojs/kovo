import {
  securityArrayBufferByteLength,
  securityArrayBufferSlice,
} from './response-security-intrinsics.js';
import {
  createWitnessWeakSet,
  createWitnessWeakMap,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessWeakSetAdd,
  witnessWeakSetHas,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

interface GuardArgsFileReceipt {
  arrayBuffer(): Promise<ArrayBuffer>;
  readonly name: string;
  readonly size: number;
  readonly type: string;
}

const guardArgsFileReceipts = createWitnessWeakSet<object>();
const guardArgsFileReceiptsByNativeSource = createWitnessWeakMap<object, GuardArgsFileReceipt>();

/** @internal Commit verified upload bytes and metadata to a framework-owned immutable receipt. */
export function createGuardArgsFileReceipt(
  bytes: ArrayBuffer,
  name: string,
  type: string,
): GuardArgsFileReceipt {
  const committedBytes = securityArrayBufferSlice(bytes);
  const readBytes = witnessFreeze(
    async (): Promise<ArrayBuffer> => securityArrayBufferSlice(committedBytes),
  );
  const receipt = witnessCreateNullRecord<unknown>();
  witnessDefineProperty(receipt, 'arrayBuffer', {
    configurable: false,
    enumerable: true,
    value: readBytes,
    writable: false,
  });
  witnessDefineProperty(receipt, 'name', {
    configurable: false,
    enumerable: true,
    value: name,
    writable: false,
  });
  witnessDefineProperty(receipt, 'size', {
    configurable: false,
    enumerable: true,
    value: securityArrayBufferByteLength(committedBytes),
    writable: false,
  });
  witnessDefineProperty(receipt, 'type', {
    configurable: false,
    enumerable: true,
    value: type,
    writable: false,
  });
  witnessWeakSetAdd(guardArgsFileReceipts, receipt);
  return witnessFreeze(receipt) as unknown as GuardArgsFileReceipt;
}

/** @internal Recognize only a file receipt minted by this framework module. */
export function isGuardArgsFileReceipt(value: unknown): value is GuardArgsFileReceipt {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    witnessWeakSetHas(guardArgsFileReceipts, value)
  );
}

/** @internal Associate an immutable native File with the byte receipt committed by its schema. */
export function registerGuardArgsNativeFileReceipt(
  source: object,
  receipt: GuardArgsFileReceipt,
): void {
  if (!isGuardArgsFileReceipt(receipt)) {
    throw new TypeError('Validated file receipt must be framework-minted.');
  }
  witnessWeakMapSet(guardArgsFileReceiptsByNativeSource, source, receipt);
}

/** @internal Recover the committed receipt for an exact native File parsed by `s.file()`. */
export function guardArgsFileReceiptForSource(source: object): GuardArgsFileReceipt | undefined {
  return witnessWeakMapGet(guardArgsFileReceiptsByNativeSource, source);
}
