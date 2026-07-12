import {
  witnessGetOwnPropertyDescriptor,
  witnessReflectApply,
} from './security-witness-intrinsics.js';

/** Package-private parser control for authenticated mutation target descriptors (SPEC §9.1). */
const NativeJSON = globalThis.JSON;
const nativeJsonParse = witnessGetOwnPropertyDescriptor(NativeJSON, 'parse')?.value;

if (typeof nativeJsonParse !== 'function') {
  throw new TypeError('Kovo mutation-wire JSON parser control is unavailable.');
}

let jsonControlSound = false;
try {
  const parsed = witnessReflectApply<Record<string, unknown>>(nativeJsonParse, NativeJSON, [
    '{"target":"safe","nested":{"count":2}}',
  ]);
  jsonControlSound =
    parsed.target === 'safe' &&
    typeof parsed.nested === 'object' &&
    parsed.nested !== null &&
    (parsed.nested as Record<string, unknown>).count === 2;
} catch {
  jsonControlSound = false;
}

export function mutationWireJsonParse(value: string): unknown {
  if (!jsonControlSound) {
    throw new TypeError(
      'Kovo mutation-wire JSON parser is unavailable because realm intrinsics were modified before framework initialization.',
    );
  }
  return witnessReflectApply(nativeJsonParse, NativeJSON, [value]);
}
