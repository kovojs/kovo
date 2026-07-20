import { canonicalJsonStringify } from '@kovojs/core/internal/json';

import type { PurposeCryptoHandle } from './crypto-authority.js';
import {
  createWitnessSet,
  witnessArrayAppend,
  witnessDefineProperty,
  witnessFreeze,
  witnessSetAdd,
  witnessSetHas,
} from './security-witness-intrinsics.js';

export const KOVO_SECURITY_EVENT_SCHEMA = 'kovo-security-event/v1' as const;

export type SecurityEventType =
  | 'budget-exhausted'
  | 'capability-closed'
  | 'closure-audit-refused'
  | 'csrf-rejected'
  | 'egress-denied';

export type SecurityEventReason =
  | 'build-capability-closure'
  | 'database-admission'
  | 'database-role-closure'
  | 'internal-network'
  | 'invalid-token'
  | 'malformed-destination'
  | 'policy'
  | 'request-body'
  | 'request-rate'
  | 'request-url'
  | 'runtime-registry'
  | 'static-analysis';

export interface SecurityEventInput {
  readonly reason: SecurityEventReason;
  readonly type: SecurityEventType;
}

export interface SecurityEventRecord extends SecurityEventInput {
  readonly keyId: string;
  readonly mac: string;
  readonly occurredAt: number;
  readonly previousMac: string | null;
  readonly schema: typeof KOVO_SECURITY_EVENT_SCHEMA;
  readonly sequence: number;
}

export interface SecurityEventChainHead {
  readonly dropped: number;
  readonly keyId: string | null;
  readonly mac: string | null;
  readonly sequence: number;
}

export interface SecurityEventJournal {
  readonly head: () => Readonly<SecurityEventChainHead>;
  readonly record: (input: SecurityEventInput) => Readonly<SecurityEventRecord>;
  readonly snapshot: () => readonly Readonly<SecurityEventRecord>[];
  readonly verify: (record: SecurityEventRecord) => boolean;
}

const EVENT_TYPES = createWitnessSet<SecurityEventType>();
for (const value of [
  'budget-exhausted',
  'capability-closed',
  'closure-audit-refused',
  'csrf-rejected',
  'egress-denied',
] as const) {
  witnessSetAdd(EVENT_TYPES, value);
}
const EVENT_REASONS = createWitnessSet<SecurityEventReason>();
for (const value of [
  'build-capability-closure',
  'database-admission',
  'database-role-closure',
  'internal-network',
  'invalid-token',
  'malformed-destination',
  'policy',
  'request-body',
  'request-rate',
  'request-url',
  'runtime-registry',
  'static-analysis',
] as const) {
  witnessSetAdd(EVENT_REASONS, value);
}

/** Create a bounded append-only view whose MAC chain protects exported/at-rest records only. */
export function createSecurityEventJournal(options: {
  readonly capacity?: number;
  readonly crypto: PurposeCryptoHandle;
  readonly now?: () => number;
}): SecurityEventJournal {
  const capacity = options.capacity ?? 1_024;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 4_096) {
    throw new TypeError('Security-event journal capacity must be an integer from 1..4096.');
  }
  const now = options.now ?? Date.now;
  const records: Array<Readonly<SecurityEventRecord> | undefined> = [];
  let cursor = 0;
  let count = 0;
  let dropped = 0;
  let sequence = 0;
  let previousMac: string | null = null;

  const journal: SecurityEventJournal = {
    head() {
      return witnessFreeze({
        dropped,
        keyId: sequence === 0 ? null : options.crypto.currentKeyId,
        mac: previousMac,
        sequence,
      });
    },
    record(input) {
      assertSecurityEventInput(input);
      const occurredAt = now();
      if (!Number.isSafeInteger(occurredAt) || occurredAt < 0) {
        throw new TypeError('Security-event clock must return a non-negative safe integer.');
      }
      sequence += 1;
      const unsigned = {
        keyId: options.crypto.currentKeyId,
        occurredAt,
        previousMac,
        reason: input.reason,
        schema: KOVO_SECURITY_EVENT_SCHEMA,
        sequence,
        type: input.type,
      } as const;
      const signed = options.crypto.sign(canonicalJsonStringify(unsigned));
      const record = witnessFreeze({ ...unsigned, keyId: signed.keyId, mac: signed.signature });
      previousMac = record.mac;
      if (count < capacity) {
        witnessDefineProperty(records, count, {
          configurable: true,
          enumerable: true,
          value: record,
          writable: true,
        });
        count += 1;
      } else {
        witnessDefineProperty(records, cursor, {
          configurable: true,
          enumerable: true,
          value: record,
          writable: true,
        });
        cursor = (cursor + 1) % capacity;
        dropped += 1;
      }
      return record;
    },
    snapshot() {
      const snapshot: Readonly<SecurityEventRecord>[] = [];
      for (let offset = 0; offset < count; offset += 1) {
        const index = count < capacity ? offset : (cursor + offset) % capacity;
        const record = records[index];
        if (record !== undefined) witnessArrayAppend(snapshot, record, 'security-event snapshot');
      }
      return witnessFreeze(snapshot);
    },
    verify(record) {
      if (!isSecurityEventRecord(record)) return false;
      const source = canonicalJsonStringify({
        keyId: record.keyId,
        occurredAt: record.occurredAt,
        previousMac: record.previousMac,
        reason: record.reason,
        schema: record.schema,
        sequence: record.sequence,
        type: record.type,
      });
      return options.crypto.verify(source, record.mac, record.keyId).ok;
    },
  };
  return witnessFreeze(journal);
}

function assertSecurityEventInput(input: SecurityEventInput): void {
  if (
    input === null ||
    typeof input !== 'object' ||
    !witnessSetHas(EVENT_TYPES, input.type) ||
    !witnessSetHas(EVENT_REASONS, input.reason)
  ) {
    throw new TypeError('Security events require a registered type and redacted reason.');
  }
}

function isSecurityEventRecord(record: SecurityEventRecord): boolean {
  try {
    assertSecurityEventInput(record);
    return (
      record.schema === KOVO_SECURITY_EVENT_SCHEMA &&
      Number.isSafeInteger(record.sequence) &&
      record.sequence > 0 &&
      Number.isSafeInteger(record.occurredAt) &&
      record.occurredAt >= 0 &&
      typeof record.keyId === 'string' &&
      typeof record.mac === 'string' &&
      (record.previousMac === null || typeof record.previousMac === 'string')
    );
  } catch {
    return false;
  }
}
