import { isSecret } from '@kovojs/core';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import {
  createWitnessWeakSet,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

export class SecretEgressError extends Error {
  readonly code = 'KV435' as const;

  constructor(channel: string) {
    super(
      `KV435 ${diagnosticDefinitions.KV435.message} Secret provenance box blocked runtime egress: Secret runtime value cannot cross ${channel}; reveal or redact it explicitly before egress.`,
    );
    this.name = 'SecretEgressError';
  }
}

export function assertNoSecretEgressValue(value: unknown, channel: string): void {
  assertNoSecretEgressValueInner(value, channel, createWitnessWeakSet<object>(), 0);
}

function assertNoSecretEgressValueInner(
  value: unknown,
  channel: string,
  seen: WeakSet<object>,
  depth: number,
): void {
  if (isSecret(value)) throw new SecretEgressError(channel);
  if (!witnessIsArray(value)) return;
  if (depth >= 64 || witnessWeakSetHas(seen, value)) {
    throw new TypeError(
      `Secret egress inspection for ${channel} requires an acyclic bounded array.`,
    );
  }
  witnessWeakSetAdd(seen, value);
  const length = witnessGetOwnPropertyDescriptor(value, 'length');
  if (
    length === undefined ||
    !('value' in length) ||
    typeof length.value !== 'number' ||
    length.value < 0 ||
    length.value > 100_000 ||
    length.value % 1 !== 0
  ) {
    throw new TypeError(`Secret egress inspection for ${channel} requires a bounded dense array.`);
  }
  for (let index = 0; index < length.value; index += 1) {
    const entry = witnessGetOwnPropertyDescriptor(value, index);
    if (entry === undefined || !('value' in entry)) {
      throw new TypeError(
        `Secret egress inspection for ${channel} requires dense own data entries.`,
      );
    }
    assertNoSecretEgressValueInner(entry.value, channel, seen, depth + 1);
  }
}
