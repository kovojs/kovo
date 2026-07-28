import { resolve as builtinResolve } from 'node:path';

import { canonicalJsonStringify } from '@kovojs/core/internal/json';
import {
  createSecurityEventRecordVerifier,
  type SecurityEventRecordVerifier,
} from '@kovojs/server/internal/execution';

import { parseKovoCommandInvocation } from '../commands-manifest.js';
import { requireKovoCommandResultProtocol } from '../command-schema.js';
import { kovoInvocationEnvironmentValue } from '../invocation-environment.js';
import type { CliCommandResult } from '../shared.js';
import { readBoundedRegularFile } from './bounded-regular-file.js';

const resolve = builtinResolve;
const MAX_INCIDENT_INPUT_BYTES = 32 * 1024 * 1024;
const INCIDENT_PRINCIPAL_IDENTITY_MAX_LENGTH = 1_024;

const INCIDENT_DOORS = [
  'auth',
  'authorization',
  'declassification',
  'egress',
  'storage',
  'task',
  'replay',
] as const;
const INCIDENT_PRINCIPAL_KINDS = ['anonymous', 'principal', 'system', 'unresolved'] as const;
const INCIDENT_UNRESOLVED_REASONS = [
  'epoch-unavailable',
  'outside-request-context',
  'principal-unrecordable',
  'principal-not-proven',
  'tenant-unavailable',
] as const;

type IncidentDoor = (typeof INCIDENT_DOORS)[number];
type IncidentOutcome = 'allow' | 'deny';
type IncidentResourceKind =
  | 'credential'
  | 'destination'
  | 'object'
  | 'reservation'
  | 'resource'
  | 'secret'
  | 'task';

interface IncidentOptions {
  advisoryPath: string;
  eventsPath: string;
}

interface IncidentPredicate {
  coverage: 'covered' | 'outside-covered-doors';
  decisionSites: readonly string[];
  doors: readonly IncidentDoor[];
  outcomes: readonly IncidentOutcome[];
  resourceKinds: readonly IncidentResourceKind[];
}

interface IncidentAdvisory {
  id: string;
  predicate: IncidentPredicate;
}

interface IncidentPrincipal {
  epoch: number | null;
  id: string | null;
  kind: (typeof INCIDENT_PRINCIPAL_KINDS)[number];
  reason?: (typeof INCIDENT_UNRESOLVED_REASONS)[number];
  tenant: string | null;
}

interface IncidentDecisionRecord {
  decisionSite: string;
  door: IncidentDoor;
  keyId: string;
  mac: string;
  occurredAt: number;
  outcome: IncidentOutcome;
  previousMac: string | null;
  principal: IncidentPrincipal;
  resourceScope: { identity: string; kind: IncidentResourceKind };
  schema: 'kovo-security-event/v1';
  sequence: number;
  type: 'security-decision';
}

interface IncidentDenialRecord {
  keyId: string;
  mac: string;
  occurredAt: number;
  previousMac: string | null;
  reason: string;
  schema: 'kovo-security-event/v1';
  sequence: number;
  type:
    | 'budget-exhausted'
    | 'capability-closed'
    | 'closure-audit-refused'
    | 'csrf-rejected'
    | 'egress-denied';
}

type IncidentChainRecord = IncidentDecisionRecord | IncidentDenialRecord;

interface IncidentEventExport {
  dropped: number;
  events: readonly IncidentDecisionRecord[];
}

/** Parse `kovo incident scope <advisory> --events <export>`. @internal */
export function parseIncidentArgs(
  args: readonly string[],
): { ok: true; options: IncidentOptions } | { message: string; ok: false } {
  const parsed = parseKovoCommandInvocation('incident', args);
  if (!parsed.ok) return { message: parsed.message, ok: false };
  return {
    ok: true,
    options: {
      advisoryPath: parsed.value.arguments.advisory,
      eventsPath: parsed.value.options.events,
    },
  };
}

/**
 * Replay one finite advisory predicate against a structurally validated, deployment-authenticated
 * event export. Output is canonical JSON so automation receives the same bytes regardless of input
 * event order. The invocation environment must carry the same deployment id and root secret used
 * by the runtime's purpose-separated security-event chain.
 *
 * @internal
 */
export function runIncidentScopeCommand(
  options: IncidentOptions,
  invocationCwd: string,
  invocationEnv: NodeJS.ProcessEnv,
): CliCommandResult {
  try {
    const verifier = incidentEventVerifier(invocationEnv);
    const advisory = readAdvisory(resolve(invocationCwd, options.advisoryPath));
    const eventExport = readEventExport(resolve(invocationCwd, options.eventsPath), verifier);
    const matched = eventExport.events.filter((record) => matches(advisory.predicate, record));
    const affectedPrincipals = sortedUnique(
      matched.flatMap((record) =>
        record.principal.kind === 'principal' ||
        record.principal.kind === 'system' ||
        (record.principal.kind === 'unresolved' && record.principal.id !== null)
          ? [record.principal.id!]
          : [],
      ),
    );
    const affectedTenants = sortedUnique(
      matched.flatMap((record) =>
        record.principal.tenant === null ? [] : [record.principal.tenant],
      ),
    );

    let status: 'affected' | 'not-observed' | 'unanswerable';
    let complete: boolean;
    let reason: string | null;
    if (advisory.predicate.coverage === 'outside-covered-doors') {
      status = 'unanswerable';
      complete = false;
      reason =
        'unanswerable within the covered doors: advisory exploit path does not cross a Kovo decision door';
    } else if (eventExport.dropped > 0) {
      status = 'unanswerable';
      complete = false;
      reason = `unanswerable within the covered doors: journal dropped ${eventExport.dropped} record${eventExport.dropped === 1 ? '' : 's'}`;
    } else if (matched.some((record) => record.principal.kind === 'unresolved')) {
      status = 'unanswerable';
      complete = false;
      reason =
        'unanswerable within the covered doors: a matching decision has unresolved principal scope';
    } else if (matched.length === 0) {
      status = 'not-observed';
      complete = true;
      reason = 'no matching event was observed; this is not a no-impact claim';
    } else {
      status = 'affected';
      complete = true;
      reason = null;
    }

    const output = canonicalJsonStringify({
      advisoryId: advisory.id,
      affectedPrincipals,
      affectedTenants,
      answerability: { complete, reason },
      coveredDoors: [...advisory.predicate.doors].sort(compareStrings),
      decisionSites: [...advisory.predicate.decisionSites].sort(compareStrings),
      matchedEvents: matched.length,
      schema: 'kovo.security.incident-scope/v1',
      status,
    });
    return { exitCode: status === 'unanswerable' ? 1 : 0, output: `${output}\n` };
  } catch (error) {
    return {
      error: `${requireKovoCommandResultProtocol('incident')}\nERROR ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
    };
  }
}

function readAdvisory(path: string): IncidentAdvisory {
  const value = readBoundedJson(path, 'advisory');
  const advisory = requireRecord(value, 'advisory');
  if (advisory.schema !== 'kovo.security.advisory/v1') {
    throw new Error('advisory has an unsupported schema');
  }
  const id = boundedText(advisory.id, 'advisory id');
  const rawPredicate = requireRecord(advisory.incidentScope, 'advisory incidentScope');
  requireExactKeys(
    rawPredicate,
    ['coverage', 'decisionSites', 'doors', 'outcomes', 'resourceKinds', 'schema'],
    'advisory incidentScope',
  );
  if (rawPredicate.schema !== 'kovo.security.incident-scope-predicate/v1') {
    throw new Error('advisory incidentScope has an unsupported schema');
  }
  if (rawPredicate.coverage !== 'covered' && rawPredicate.coverage !== 'outside-covered-doors') {
    throw new Error('advisory incidentScope coverage must be closed and explicit');
  }
  const doors = closedStringArray(rawPredicate.doors, INCIDENT_DOORS, 'incident doors');
  const decisionSites = stringArray(rawPredicate.decisionSites, 'decision sites').map((site) => {
    assertDecisionSite(site);
    return site;
  });
  const outcomes = closedStringArray(
    rawPredicate.outcomes,
    ['allow', 'deny'] as const,
    'incident outcomes',
  );
  const resourceKinds = closedStringArray(
    rawPredicate.resourceKinds,
    ['credential', 'destination', 'object', 'reservation', 'resource', 'secret', 'task'] as const,
    'incident resource kinds',
  );
  return {
    id,
    predicate: {
      coverage: rawPredicate.coverage,
      decisionSites,
      doors,
      outcomes,
      resourceKinds,
    },
  };
}

function readEventExport(path: string, verifier: SecurityEventRecordVerifier): IncidentEventExport {
  const value = requireRecord(
    readBoundedJson(path, 'security-event export'),
    'security-event export',
  );
  requireExactKeys(value, ['coverage', 'events', 'head', 'schema'], 'security-event export');
  if (value.schema !== 'kovo-security-event-export/v2') {
    throw new Error('security-event export has an unsupported schema');
  }
  const coverage = requireRecord(value.coverage, 'security-event coverage');
  requireExactKeys(coverage, ['doors', 'schema'], 'security-event coverage');
  if (coverage.schema !== 'kovo-security-event-coverage/v1') {
    throw new Error('security-event coverage has an unsupported schema');
  }
  const coveredDoors = closedStringArray(coverage.doors, INCIDENT_DOORS, 'covered doors');
  if (
    coveredDoors.length !== INCIDENT_DOORS.length ||
    INCIDENT_DOORS.some((door) => !coveredDoors.includes(door))
  ) {
    throw new Error('security-event export does not cover the complete incident-door denominator');
  }
  if (!Array.isArray(value.events) || value.events.length > 4_096) {
    throw new Error('security-event export events must be an array of at most 4096 records');
  }
  const chain = value.events.map((record, index) => readChainRecord(record, index));
  for (let index = 0; index < chain.length; index += 1) {
    if (!verifier.verify(chain[index])) {
      throw new Error(`security-event record[${index}] MAC verification failed`);
    }
  }
  const head = requireRecord(value.head, 'security-event chain head');
  requireExactKeys(
    head,
    ['dropped', 'keyId', 'mac', 'schema', 'sequence', 'tailKeyId', 'tailMac'],
    'security-event chain head',
  );
  if (!verifier.verifyExportHead(head)) {
    throw new Error('security-event export head MAC verification failed');
  }
  boundedToken(head.keyId);
  boundedToken(head.mac);
  const tailKeyId = head.tailKeyId === null ? null : boundedToken(head.tailKeyId);
  const tailMac = head.tailMac === null ? null : boundedToken(head.tailMac);
  const dropped = nonNegativeSafeInteger(head.dropped, 'security-event dropped count');
  const sequence = nonNegativeSafeInteger(head.sequence, 'security-event head sequence');
  if (sequence !== dropped + chain.length) {
    throw new Error('security-event chain head does not equal retained plus dropped records');
  }
  if (chain.length === 0) {
    if (tailKeyId !== null || tailMac !== null || sequence !== 0 || dropped !== 0) {
      throw new Error('empty security-event chain head is inconsistent');
    }
    return { dropped, events: [] };
  }
  const firstExpected = dropped + 1;
  for (let index = 0; index < chain.length; index += 1) {
    const record = chain[index]!;
    if (record.sequence !== firstExpected + index) {
      throw new Error('security-event chain sequence is not contiguous');
    }
    if (index > 0 && record.previousMac !== chain[index - 1]!.mac) {
      throw new Error('security-event chain is not contiguous');
    }
  }
  const last = chain[chain.length - 1]!;
  if (tailMac !== last.mac || tailKeyId !== last.keyId || sequence !== last.sequence) {
    throw new Error('security-event chain head does not match the retained tail');
  }
  return {
    dropped,
    events: chain.filter(
      (record): record is IncidentDecisionRecord => record.type === 'security-decision',
    ),
  };
}

function incidentEventVerifier(invocationEnv: NodeJS.ProcessEnv): SecurityEventRecordVerifier {
  const deploymentId = kovoInvocationEnvironmentValue(
    invocationEnv,
    'KOVO_ATTESTATION_DEPLOYMENT_ID',
  );
  const secret = kovoInvocationEnvironmentValue(invocationEnv, 'KOVO_ATTESTATION_SECRET');
  if (deploymentId === undefined || secret === undefined) {
    throw new Error(
      'security-event verification requires KOVO_ATTESTATION_DEPLOYMENT_ID and KOVO_ATTESTATION_SECRET',
    );
  }
  return createSecurityEventRecordVerifier({ deploymentId, secret });
}

function readChainRecord(value: unknown, index: number): IncidentChainRecord {
  const record = requireRecord(value, `security-event record[${index}]`);
  return record.type === 'security-decision'
    ? readDecisionRecord(record, index)
    : readDenialRecord(record, index);
}

function readDecisionRecord(value: unknown, index: number): IncidentDecisionRecord {
  const record = requireRecord(value, `security-event record[${index}]`);
  if (record.type !== 'security-decision') {
    throw new Error(
      `security-event record[${index}] is not answerability-bearing security-decision data`,
    );
  }
  requireExactKeys(
    record,
    [
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
    ],
    `security-event record[${index}]`,
  );
  if (record.schema !== 'kovo-security-event/v1') {
    throw new Error(`security-event record[${index}] has an unsupported schema`);
  }
  assertDecisionSite(record.decisionSite);
  const door = closedString(record.door, INCIDENT_DOORS, `security-event record[${index}] door`);
  const outcome = closedString(
    record.outcome,
    ['allow', 'deny'] as const,
    `security-event record[${index}] outcome`,
  );
  const principal = readPrincipal(record.principal, index);
  const resourceScope = readResourceScope(record.resourceScope, door, index);
  const previousMac = record.previousMac === null ? null : boundedToken(record.previousMac);
  return {
    decisionSite: record.decisionSite as string,
    door,
    keyId: boundedToken(record.keyId),
    mac: boundedToken(record.mac),
    occurredAt: nonNegativeSafeInteger(
      record.occurredAt,
      `security-event record[${index}] occurredAt`,
    ),
    outcome,
    previousMac,
    principal,
    resourceScope,
    schema: 'kovo-security-event/v1',
    sequence: positiveSafeInteger(record.sequence, `security-event record[${index}] sequence`),
    type: 'security-decision',
  };
}

function readDenialRecord(value: unknown, index: number): IncidentDenialRecord {
  const record = requireRecord(value, `security-event record[${index}]`);
  requireExactKeys(
    record,
    ['keyId', 'mac', 'occurredAt', 'previousMac', 'reason', 'schema', 'sequence', 'type'],
    `security-event record[${index}]`,
  );
  if (record.schema !== 'kovo-security-event/v1') {
    throw new Error(`security-event record[${index}] has an unsupported schema`);
  }
  const type = closedString(
    record.type,
    [
      'budget-exhausted',
      'capability-closed',
      'closure-audit-refused',
      'csrf-rejected',
      'egress-denied',
    ] as const,
    `security-event record[${index}] denial type`,
  );
  const reason = closedString(
    record.reason,
    [
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
    ] as const,
    `security-event record[${index}] denial reason`,
  );
  const previousMac = record.previousMac === null ? null : boundedToken(record.previousMac);
  return {
    keyId: boundedToken(record.keyId),
    mac: boundedToken(record.mac),
    occurredAt: nonNegativeSafeInteger(
      record.occurredAt,
      `security-event record[${index}] occurredAt`,
    ),
    previousMac,
    reason,
    schema: 'kovo-security-event/v1',
    sequence: positiveSafeInteger(record.sequence, `security-event record[${index}] sequence`),
    type,
  };
}

function readPrincipal(value: unknown, index: number): IncidentPrincipal {
  const principal = requireRecord(value, `security-event record[${index}] principal`);
  const kind = closedString(
    principal.kind,
    INCIDENT_PRINCIPAL_KINDS,
    `security-event record[${index}] principal kind`,
  );
  requireExactKeys(
    principal,
    kind === 'unresolved'
      ? ['epoch', 'id', 'kind', 'reason', 'tenant']
      : ['epoch', 'id', 'kind', 'tenant'],
    `security-event record[${index}] principal`,
  );
  if (kind === 'principal') {
    return {
      epoch: positiveSafeInteger(principal.epoch, `security-event record[${index}] epoch`),
      id: boundedPrincipalIdentity(principal.id, `security-event record[${index}] principal id`),
      kind,
      tenant:
        principal.tenant === null
          ? null
          : boundedPrincipalIdentity(principal.tenant, `security-event record[${index}] tenant`),
    };
  }
  if (kind === 'system') {
    if (principal.epoch !== null) {
      throw new Error(`security-event record[${index}] system epoch must be null`);
    }
    return {
      epoch: null,
      id: boundedPrincipalIdentity(principal.id, `security-event record[${index}] system id`),
      kind,
      tenant:
        principal.tenant === null
          ? null
          : boundedPrincipalIdentity(principal.tenant, `security-event record[${index}] tenant`),
    };
  }
  if (kind === 'unresolved') {
    const reason = closedString(
      principal.reason,
      INCIDENT_UNRESOLVED_REASONS,
      `security-event record[${index}] unresolved reason`,
    );
    if (principal.epoch !== null) {
      throw new Error(`security-event record[${index}] unresolved epoch must be null`);
    }
    if (reason === 'epoch-unavailable' || reason === 'tenant-unavailable') {
      return {
        epoch: null,
        id: boundedPrincipalIdentity(
          principal.id,
          `security-event record[${index}] unresolved principal id`,
        ),
        kind,
        reason,
        tenant:
          principal.tenant === null
            ? null
            : boundedPrincipalIdentity(
                principal.tenant,
                `security-event record[${index}] unresolved tenant`,
              ),
      };
    }
    if (principal.id !== null || principal.tenant !== null) {
      throw new Error(
        `security-event record[${index}] unknown unresolved principal facts must be null`,
      );
    }
    return { epoch: null, id: null, kind, reason, tenant: null };
  }
  if (principal.epoch !== null || principal.id !== null || principal.tenant !== null) {
    throw new Error(`security-event record[${index}] anonymous principal facts must be null`);
  }
  return { epoch: null, id: null, kind, tenant: null };
}

function readResourceScope(
  value: unknown,
  door: IncidentDoor,
  index: number,
): { identity: string; kind: IncidentResourceKind } {
  const scope = requireRecord(value, `security-event record[${index}] resourceScope`);
  requireExactKeys(scope, ['identity', 'kind'], `security-event record[${index}] resourceScope`);
  const kind = closedString(
    scope.kind,
    ['credential', 'destination', 'object', 'reservation', 'resource', 'secret', 'task'] as const,
    `security-event record[${index}] resource kind`,
  );
  const expected = {
    auth: 'credential',
    authorization: 'resource',
    declassification: 'secret',
    egress: 'destination',
    replay: 'reservation',
    storage: 'object',
    task: 'task',
  } as const;
  if (kind !== expected[door]) {
    throw new Error(`security-event record[${index}] resource kind does not match its door`);
  }
  if (
    scope.identity !== 'global' &&
    (typeof scope.identity !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(scope.identity))
  ) {
    throw new Error(`security-event record[${index}] resource identity is not opaque`);
  }
  return { identity: scope.identity as string, kind };
}

function matches(predicate: IncidentPredicate, record: IncidentDecisionRecord): boolean {
  return (
    predicate.doors.includes(record.door) &&
    predicate.decisionSites.includes(record.decisionSite) &&
    predicate.outcomes.includes(record.outcome) &&
    predicate.resourceKinds.includes(record.resourceScope.kind)
  );
}

function readBoundedJson(path: string, label: string): unknown {
  const source = readBoundedRegularFile(path, {
    label,
    limitMessage: `${label} exceeds the ${MAX_INCIDENT_INPUT_BYTES}-byte size limit`,
    maxBytes: MAX_INCIDENT_INPUT_BYTES,
  }).toString('utf8');
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value).sort(compareStrings);
  const wanted = [...expected].sort(compareStrings);
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} contains a missing or unexpected field`);
  }
}

function assertDecisionSite(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    (!/^sha256:[a-f0-9]{64}$/u.test(value) &&
      !/^framework:(auth|authorization|declassification|egress|storage|task|replay):[a-z0-9][a-z0-9.-]{0,127}$/u.test(
        value,
      ))
  ) {
    throw new Error('decision site must be a build-stable sha256 or framework identity');
  }
}

function boundedText(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 512 ||
    /^[\s]|[\s]$/u.test(value) ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${label} must be bounded printable text`);
  }
  return value;
}

function boundedPrincipalIdentity(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > INCIDENT_PRINCIPAL_IDENTITY_MAX_LENGTH ||
    /^[\s]|[\s]$/u.test(value) ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${label} must be a bounded printable principal identity`);
  }
  return value;
}

function boundedToken(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) {
    throw new Error('security-event chain token is invalid');
  }
  return value;
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function positiveSafeInteger(value: unknown, label: string): number {
  const number = nonNegativeSafeInteger(value, label);
  if (number < 1) throw new Error(`${label} must be positive`);
  return number;
}

function closedString<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new Error(`${label} is outside the closed vocabulary`);
  }
  return value as Values[number];
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4_096) {
    throw new Error(`${label} must be a non-empty bounded array`);
  }
  const result = value.map((entry, index) => boundedText(entry, `${label}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates`);
  return result;
}

function closedStringArray<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number][] {
  return stringArray(value, label).map((entry) => closedString(entry, values, label));
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
