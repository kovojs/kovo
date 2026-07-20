import { canonicalJsonStringify } from '@kovojs/core/internal/json';

import type { PurposeCryptoHandle } from './crypto-authority.js';
import {
  createWitnessSet,
  witnessArrayAppend,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessOwnKeys,
  witnessRegExpTest,
  witnessSetAdd,
  witnessSetHas,
  witnessStringStartsWith,
} from './security-witness-intrinsics.js';
import { securitySha256Hex } from './response-security-intrinsics.js';

export const KOVO_SECURITY_EVENT_SCHEMA = 'kovo-security-event/v1' as const;

/** Gate-checked projection of the reviewed runtime denial-site census. */
export const SECURITY_EVENT_TYPES = witnessFreeze([
  'budget-exhausted',
  'capability-closed',
  'closure-audit-refused',
  'csrf-rejected',
  'egress-denied',
] as const);

export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

/**
 * Closed denominator for security decisions that can answer a later principal/tenant incident
 * question. Adding a decision door is incomplete until its resource kind and event emission are
 * added here together (plans/10x-better-security-3.md §5.1).
 */
export const SECURITY_EVENT_INCIDENT_DOORS = witnessFreeze([
  'auth',
  'authorization',
  'declassification',
  'egress',
  'storage',
  'task',
  'replay',
] as const);

export type SecurityEventIncidentDoor = (typeof SECURITY_EVENT_INCIDENT_DOORS)[number];

/** No-payload resource identity vocabulary paired one-to-one with the incident door denominator. */
export const SECURITY_EVENT_RESOURCE_KIND_BY_DOOR = witnessFreeze({
  auth: 'credential',
  authorization: 'resource',
  declassification: 'secret',
  egress: 'destination',
  replay: 'reservation',
  storage: 'object',
  task: 'task',
} as const satisfies Record<SecurityEventIncidentDoor, string>);

export type SecurityEventResourceKind =
  (typeof SECURITY_EVENT_RESOURCE_KIND_BY_DOOR)[SecurityEventIncidentDoor];

export type SecurityDecisionOutcome = 'allow' | 'deny';

const SECURITY_EVENT_PRINCIPAL_KINDS = witnessFreeze([
  'anonymous',
  'principal',
  'system',
  'unresolved',
] as const);
const SECURITY_EVENT_UNRESOLVED_REASONS = witnessFreeze([
  'epoch-unavailable',
  'outside-request-context',
  'principal-unrecordable',
  'principal-not-proven',
  'tenant-unavailable',
] as const);
const SECURITY_EVENT_PRINCIPAL_IDENTITY_MAX_LENGTH = 1_024;

export type SecurityEventPrincipalScope =
  | {
      readonly epoch: null;
      readonly id: null;
      readonly kind: 'anonymous';
      readonly tenant: null;
    }
  | {
      readonly epoch: number;
      readonly id: string;
      readonly kind: 'principal';
      readonly tenant: string | null;
    }
  | {
      readonly epoch: null;
      readonly id: string;
      readonly kind: 'system';
      readonly tenant: string | null;
    }
  | {
      readonly epoch: null;
      readonly id: string | null;
      readonly kind: 'unresolved';
      readonly reason: (typeof SECURITY_EVENT_UNRESOLVED_REASONS)[number];
      readonly tenant: string | null;
    };

export interface SecurityEventResourceScope {
  /** `global`, or a framework-produced digest. Raw URLs, keys, rows, and payloads are forbidden. */
  readonly identity: 'global' | `sha256:${string}`;
  readonly kind: SecurityEventResourceKind;
}

/**
 * Complete input for one answerability-bearing security decision. Unlike denial telemetry, this
 * shape cannot omit principal epoch or resource scope: JavaScript callers fail at the event door
 * and TypeScript callers get the same requirement at author time.
 */
export interface SecurityDecisionEventInput {
  readonly decisionSite: string;
  readonly door: SecurityEventIncidentDoor;
  readonly outcome: SecurityDecisionOutcome;
  readonly principal: SecurityEventPrincipalScope;
  readonly resourceScope: SecurityEventResourceScope;
  readonly type: 'security-decision';
}

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

export interface SecurityDenialEventInput {
  readonly reason: SecurityEventReason;
  readonly type: SecurityEventType;
}

export type SecurityEventInput = SecurityDenialEventInput | SecurityDecisionEventInput;

interface SecurityEventRecordBase {
  readonly keyId: string;
  readonly mac: string;
  readonly occurredAt: number;
  readonly previousMac: string | null;
  readonly schema: typeof KOVO_SECURITY_EVENT_SCHEMA;
  readonly sequence: number;
}

export type SecurityDenialEventRecord = SecurityEventRecordBase & SecurityDenialEventInput;
export type SecurityDecisionEventRecord = SecurityEventRecordBase & SecurityDecisionEventInput;
export type SecurityEventRecord = SecurityDenialEventRecord | SecurityDecisionEventRecord;

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
for (const value of SECURITY_EVENT_TYPES) {
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

let installedJournal: SecurityEventJournal | undefined;
let decisionRecorderArmed = false;
let unsealedEventCount = 0;

/**
 * Single framework security-event door. Decision calls made before generated runtime registration
 * are low-level/library calls outside the production completeness claim. Generated production
 * registration arms this door; from that point onward a missing journal is fatal.
 */
export function securityEvent(
  input: SecurityEventInput,
): Readonly<SecurityEventRecord> | undefined {
  const normalized = normalizedSecurityEventInput(input);
  if (installedJournal === undefined) {
    if (normalized.type === 'security-decision') {
      if (!decisionRecorderArmed) return undefined;
      throw new TypeError(
        'Answerability-bearing security decisions require the journal before the decision can proceed.',
      );
    }
    unsealedEventCount += 1;
    return undefined;
  }
  return installedJournal.record(normalized);
}

/** @internal Arm answerability only after the generated production registry is evaluated. */
export function armSecurityDecisionEventRecorder(): void {
  decisionRecorderArmed = true;
}

/** @internal Test/boot witness for the generated-registry ordering contract. */
export function securityDecisionEventRecorderArmed(): boolean {
  return decisionRecorderArmed;
}

/** Hash a bounded decision input into the only accepted no-payload identity shape. @internal */
export function securityEventResourceIdentity(value: string): `sha256:${string}` {
  return `sha256:${securitySha256Hex(value)}`;
}

/** @internal Install the deployment-keyed collector before authored app evaluation. */
export function installSecurityEventJournal(journal: SecurityEventJournal): void {
  if (installedJournal !== undefined && installedJournal !== journal) {
    throw new TypeError('Security-event journal is already installed for this boot.');
  }
  installedJournal = journal;
}

/** @internal Current chain head for signed posture responses. */
export function securityEventChainHead(): Readonly<SecurityEventChainHead> {
  if (installedJournal !== undefined) return installedJournal.head();
  return witnessFreeze({ dropped: unsealedEventCount, keyId: null, mac: null, sequence: 0 });
}

/** @internal Bounded records for reviewed declared-egress export. */
export function securityEventSnapshot(): readonly Readonly<SecurityEventRecord>[] {
  return installedJournal?.snapshot() ?? witnessFreeze([]);
}

/** Create a bounded append-only view whose MAC chain protects exported/at-rest records only. */
export function createSecurityEventJournal(options: {
  readonly capacity?: number;
  readonly authority: PurposeCryptoHandle;
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
        keyId: sequence === 0 ? null : options.authority.currentKeyId,
        mac: previousMac,
        sequence,
      });
    },
    record(input) {
      const normalized = normalizedSecurityEventInput(input);
      const occurredAt = now();
      if (!Number.isSafeInteger(occurredAt) || occurredAt < 0) {
        throw new TypeError('Security-event clock must return a non-negative safe integer.');
      }
      sequence += 1;
      const unsigned = {
        keyId: options.authority.currentKeyId,
        occurredAt,
        previousMac,
        schema: KOVO_SECURITY_EVENT_SCHEMA,
        sequence,
        ...normalized,
      } as const;
      const signed = options.authority.sign(canonicalJsonStringify(unsigned));
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
      const keyId = ownDataValue(record, 'keyId', 'Security event record key id') as string;
      const mac = ownDataValue(record, 'mac', 'Security event record MAC') as string;
      const source = canonicalJsonStringify({
        keyId,
        occurredAt: ownDataValue(record, 'occurredAt', 'Security event record occurrence time'),
        previousMac: ownDataValue(record, 'previousMac', 'Security event record previous MAC'),
        schema: ownDataValue(record, 'schema', 'Security event record schema'),
        sequence: ownDataValue(record, 'sequence', 'Security event record sequence'),
        ...securityEventInputFromRecord(record),
      });
      return options.authority.verify(source, mac, keyId).ok;
    },
  };
  return witnessFreeze(journal);
}

function assertSecurityEventInput(input: SecurityEventInput): void {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('Security events require a registered type and redacted reason.');
  }
  const type = ownDataValue(input, 'type', 'Security event type');
  if (type === 'security-decision') {
    assertSecurityDecisionEventInput(input as SecurityDecisionEventInput);
    return;
  }
  assertExactOwnDataFields(input, ['reason', 'type'], 'Security denial event');
  const reason = ownDataValue(input, 'reason', 'Security denial event reason');
  if (
    !witnessSetHas(EVENT_TYPES, type as SecurityEventType) ||
    !witnessSetHas(EVENT_REASONS, reason as SecurityEventReason)
  ) {
    throw new TypeError('Security events require a registered type and redacted reason.');
  }
}

function assertSecurityDecisionEventInput(input: SecurityDecisionEventInput): void {
  assertExactOwnDataFields(
    input,
    ['decisionSite', 'door', 'outcome', 'principal', 'resourceScope', 'type'],
    'Security decision event',
  );
  const door = ownDataValue(input, 'door', 'Security decision door');
  if (!isIncidentDoor(door)) {
    throw new TypeError('Security decision event requires a registered incident door.');
  }
  const outcome = ownDataValue(input, 'outcome', 'Security decision outcome');
  if (outcome !== 'allow' && outcome !== 'deny') {
    throw new TypeError('Security decision event outcome must be allow or deny.');
  }
  const decisionSite = ownDataValue(input, 'decisionSite', 'Security decision site');
  if (
    typeof decisionSite !== 'string' ||
    (!witnessRegExpTest(/^sha256:[a-f0-9]{64}$/u, decisionSite) &&
      !witnessRegExpTest(
        /^framework:(auth|authorization|declassification|egress|storage|task|replay):[a-z0-9][a-z0-9.-]{0,127}$/u,
        decisionSite,
      ))
  ) {
    throw new TypeError(
      'Security decision site must be a build-stable sha256 or framework door identity.',
    );
  }
  if (
    witnessRegExpTest(/^framework:/u, decisionSite) &&
    !witnessStringStartsWith(decisionSite, `framework:${door}:`)
  ) {
    throw new TypeError('Security decision site door does not match the event door.');
  }

  const principal = ownDataValue(input, 'principal', 'Security decision principal scope');
  assertPrincipalScope(principal);
  const resourceScope = ownDataValue(input, 'resourceScope', 'Security decision resource scope');
  assertResourceScope(resourceScope, door);
}

function assertPrincipalScope(value: unknown): asserts value is SecurityEventPrincipalScope {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('Security decision principal scope is required.');
  }
  const kind = ownDataValue(value, 'kind', 'Security decision principal scope kind');
  if (!isSecurityEventPrincipalKind(kind)) {
    throw new TypeError('Security decision principal scope kind is not registered.');
  }
  const expectedFields =
    kind === 'unresolved'
      ? ['epoch', 'id', 'kind', 'reason', 'tenant']
      : ['epoch', 'id', 'kind', 'tenant'];
  assertExactOwnDataFields(value, expectedFields, 'Security decision principal scope');
  const epoch = ownDataValue(value, 'epoch', 'Security decision principal epoch');
  const id = ownDataValue(value, 'id', 'Security decision principal id');
  const tenant = ownDataValue(value, 'tenant', 'Security decision tenant id');
  if (kind === 'principal') {
    if (!boundedIdentity(id) || !Number.isSafeInteger(epoch) || (epoch as number) < 1) {
      throw new TypeError('Principal security events require a non-empty id and positive epoch.');
    }
    if (tenant !== null && !boundedIdentity(tenant)) {
      throw new TypeError('Principal security event tenant must be null or a bounded identity.');
    }
    return;
  }
  if (kind === 'system') {
    if (!boundedIdentity(id) || epoch !== null) {
      throw new TypeError('System security events require a non-empty id and null epoch.');
    }
    if (tenant !== null && !boundedIdentity(tenant)) {
      throw new TypeError('System security event tenant must be null or a bounded identity.');
    }
    return;
  }
  if (kind === 'anonymous') {
    if (id !== null || epoch !== null || tenant !== null) {
      throw new TypeError('Anonymous security events require null id, epoch, and tenant.');
    }
    return;
  }
  if (kind === 'unresolved') {
    const reason = ownDataValue(value, 'reason', 'Unresolved security principal reason');
    if (!isSecurityEventUnresolvedReason(reason)) {
      throw new TypeError('Unresolved security principal reason is not registered.');
    }
    const knownPrincipalReason = reason === 'epoch-unavailable' || reason === 'tenant-unavailable';
    const validKnownPrincipal =
      knownPrincipalReason && boundedIdentity(id) && (tenant === null || boundedIdentity(tenant));
    const validUnknownPrincipal =
      (reason === 'outside-request-context' ||
        reason === 'principal-unrecordable' ||
        reason === 'principal-not-proven') &&
      id === null &&
      tenant === null;
    if (epoch !== null || (!validKnownPrincipal && !validUnknownPrincipal)) {
      throw new TypeError(
        'Unresolved security events require an honest known-or-unknown principal scope and registered reason.',
      );
    }
    return;
  }
  throw new TypeError('Security decision principal scope kind is not registered.');
}

function assertResourceScope(
  value: unknown,
  door: SecurityEventIncidentDoor,
): asserts value is SecurityEventResourceScope {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('Security decision resource scope is required.');
  }
  assertExactOwnDataFields(value, ['identity', 'kind'], 'Security decision resource scope');
  const identity = ownDataValue(value, 'identity', 'Security decision resource scope identity');
  const kind = ownDataValue(value, 'kind', 'Security decision resource scope kind');
  if (kind !== SECURITY_EVENT_RESOURCE_KIND_BY_DOOR[door]) {
    throw new TypeError('Security decision resource kind does not match its incident door.');
  }
  if (
    identity !== 'global' &&
    (typeof identity !== 'string' || !witnessRegExpTest(/^sha256:[a-f0-9]{64}$/u, identity))
  ) {
    throw new TypeError(
      'Security decision requires an opaque resource scope (global or sha256 digest).',
    );
  }
}

function normalizedSecurityEventInput(input: SecurityEventInput): SecurityEventInput {
  assertSecurityEventInput(input);
  const type = ownDataValue(input, 'type', 'Security event type');
  if (type !== 'security-decision') {
    return witnessFreeze({
      reason: ownDataValue(input, 'reason', 'Security denial event reason') as SecurityEventReason,
      type: type as SecurityEventType,
    });
  }
  const principalInput = ownDataValue(
    input,
    'principal',
    'Security decision principal scope',
  ) as SecurityEventPrincipalScope;
  const principalKind = ownDataValue(
    principalInput,
    'kind',
    'Security decision principal scope kind',
  );
  const principal =
    principalKind === 'unresolved'
      ? witnessFreeze({
          epoch: ownDataValue(principalInput, 'epoch', 'Security decision principal epoch') as null,
          id: ownDataValue(principalInput, 'id', 'Security decision principal id') as string | null,
          kind: 'unresolved' as const,
          reason: ownDataValue(
            principalInput,
            'reason',
            'Unresolved security principal reason',
          ) as Extract<SecurityEventPrincipalScope, { kind: 'unresolved' }>['reason'],
          tenant: ownDataValue(principalInput, 'tenant', 'Security decision tenant id') as
            | string
            | null,
        })
      : witnessFreeze({
          epoch: ownDataValue(principalInput, 'epoch', 'Security decision principal epoch') as
            | number
            | null,
          id: ownDataValue(principalInput, 'id', 'Security decision principal id') as string | null,
          kind: principalKind as 'anonymous' | 'principal' | 'system',
          tenant: ownDataValue(principalInput, 'tenant', 'Security decision tenant id') as
            | string
            | null,
        });
  const resourceInput = ownDataValue(
    input,
    'resourceScope',
    'Security decision resource scope',
  ) as SecurityEventResourceScope;
  return witnessFreeze({
    decisionSite: ownDataValue(input, 'decisionSite', 'Security decision site') as string,
    door: ownDataValue(input, 'door', 'Security decision door') as SecurityEventIncidentDoor,
    outcome: ownDataValue(input, 'outcome', 'Security decision outcome') as SecurityDecisionOutcome,
    principal: principal as SecurityEventPrincipalScope,
    resourceScope: witnessFreeze({
      identity: ownDataValue(
        resourceInput,
        'identity',
        'Security decision resource scope identity',
      ) as SecurityEventResourceScope['identity'],
      kind: ownDataValue(
        resourceInput,
        'kind',
        'Security decision resource scope kind',
      ) as SecurityEventResourceKind,
    }),
    type: 'security-decision' as const,
  });
}

function securityEventInputFromRecord(record: SecurityEventRecord): SecurityEventInput {
  const type = ownDataValue(record, 'type', 'Security event record type');
  const input =
    type === 'security-decision'
      ? {
          decisionSite: ownDataValue(record, 'decisionSite', 'Security decision site') as string,
          door: ownDataValue(record, 'door', 'Security decision door') as SecurityEventIncidentDoor,
          outcome: ownDataValue(
            record,
            'outcome',
            'Security decision outcome',
          ) as SecurityDecisionOutcome,
          principal: ownDataValue(
            record,
            'principal',
            'Security decision principal scope',
          ) as SecurityEventPrincipalScope,
          resourceScope: ownDataValue(
            record,
            'resourceScope',
            'Security decision resource scope',
          ) as SecurityEventResourceScope,
          type: 'security-decision' as const,
        }
      : {
          reason: ownDataValue(
            record,
            'reason',
            'Security denial event reason',
          ) as SecurityEventReason,
          type: type as SecurityEventType,
        };
  return normalizedSecurityEventInput(input);
}

function isIncidentDoor(value: unknown): value is SecurityEventIncidentDoor {
  for (const door of SECURITY_EVENT_INCIDENT_DOORS) {
    if (value === door) return true;
  }
  return false;
}

function isSecurityEventPrincipalKind(
  value: unknown,
): value is (typeof SECURITY_EVENT_PRINCIPAL_KINDS)[number] {
  for (const kind of SECURITY_EVENT_PRINCIPAL_KINDS) {
    if (value === kind) return true;
  }
  return false;
}

function isSecurityEventUnresolvedReason(
  value: unknown,
): value is (typeof SECURITY_EVENT_UNRESOLVED_REASONS)[number] {
  for (const reason of SECURITY_EVENT_UNRESOLVED_REASONS) {
    if (value === reason) return true;
  }
  return false;
}

/** @internal Whether a principal identity can enter the bounded no-control event schema. */
export function securityEventPrincipalIdentityIsRecordable(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    // SPEC §9.4: framework principals are valid through 1,024 code units. The answerability
    // record must accept every principal the authorization/replay boundary can prove.
    value.length <= SECURITY_EVENT_PRINCIPAL_IDENTITY_MAX_LENGTH &&
    witnessRegExpTest(/^[^\u0000-\u001f\u007f]+$/u, value) &&
    !witnessRegExpTest(/^\s|\s$/u, value)
  );
}

const boundedIdentity = securityEventPrincipalIdentityIsRecordable;

function ownDataValue(value: object, property: PropertyKey, label: string): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`${label} must be an own data property.`);
  }
  return descriptor.value;
}

function assertExactOwnDataFields(value: object, expected: readonly string[], label: string): void {
  const keys = witnessOwnKeys(value);
  if (keys.length !== expected.length) {
    throw new TypeError(`${label} contains a missing or unexpected field.`);
  }
  for (const property of expected) {
    ownDataValue(value, property, `${label}.${property}`);
  }
  for (const property of keys) {
    if (typeof property !== 'string' || !expected.includes(property)) {
      throw new TypeError(`${label} contains an unexpected field.`);
    }
  }
}

function isSecurityEventRecord(record: SecurityEventRecord): boolean {
  try {
    const type = ownDataValue(record, 'type', 'Security event record type');
    const expectedFields =
      type === 'security-decision'
        ? [
            'decisionSite',
            'door',
            'keyId',
            'mac',
            'occurredAt',
            'outcome',
            'previousMac',
            'principal',
            'resourceScope',
            'schema',
            'sequence',
            'type',
          ]
        : ['keyId', 'mac', 'occurredAt', 'previousMac', 'reason', 'schema', 'sequence', 'type'];
    assertExactOwnDataFields(record, expectedFields, 'Security event record');
    assertSecurityEventInput(securityEventInputFromRecord(record));
    const schema = ownDataValue(record, 'schema', 'Security event record schema');
    const sequence = ownDataValue(record, 'sequence', 'Security event record sequence');
    const occurredAt = ownDataValue(record, 'occurredAt', 'Security event record occurrence time');
    const keyId = ownDataValue(record, 'keyId', 'Security event record key id');
    const mac = ownDataValue(record, 'mac', 'Security event record MAC');
    const previousMac = ownDataValue(record, 'previousMac', 'Security event record previous MAC');
    return (
      schema === KOVO_SECURITY_EVENT_SCHEMA &&
      Number.isSafeInteger(sequence) &&
      (sequence as number) > 0 &&
      Number.isSafeInteger(occurredAt) &&
      (occurredAt as number) >= 0 &&
      typeof keyId === 'string' &&
      typeof mac === 'string' &&
      (previousMac === null || typeof previousMac === 'string')
    );
  } catch {
    return false;
  }
}
