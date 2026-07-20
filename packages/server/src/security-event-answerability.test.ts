import { describe, expect, it } from 'vitest';

import { createSecurityEventCryptoHandle } from './crypto-authority.js';
import {
  SECURITY_EVENT_INCIDENT_DOORS,
  SECURITY_EVENT_RESOURCE_KIND_BY_DOOR,
  createSecurityEventJournal,
  type SecurityDecisionEventInput,
} from './security-event.js';

const authority = createSecurityEventCryptoHandle(
  'security-event-answerability-test-secret-0123456789abcdef0123456789abcdef',
  'deployment:answerability-test',
);

function decision(
  door: (typeof SECURITY_EVENT_INCIDENT_DOORS)[number],
): SecurityDecisionEventInput {
  return {
    decisionSite: `framework:${door}:answerability-test`,
    door,
    outcome: 'allow',
    principal: {
      epoch: 7,
      id: `principal-${door}`,
      kind: 'principal',
      tenant: 'tenant-a',
    },
    resourceScope: {
      identity: 'global',
      kind: SECURITY_EVENT_RESOURCE_KIND_BY_DOOR[door],
    },
    type: 'security-decision',
  };
}

describe('security-event retrospective answerability (SPEC §§6.6, 11.2)', () => {
  it('freezes the complete principal-scope door denominator and records every required fact', () => {
    expect(SECURITY_EVENT_INCIDENT_DOORS).toEqual([
      'auth',
      'authorization',
      'declassification',
      'egress',
      'storage',
      'task',
      'replay',
    ]);

    let now = 1_720_000_000_000;
    const journal = createSecurityEventJournal({ authority, now: () => now++ });
    for (const door of SECURITY_EVENT_INCIDENT_DOORS) journal.record(decision(door));

    const records = journal.snapshot();
    expect(records).toHaveLength(7);
    expect(records.map((record) => record.type)).toEqual(
      Array.from({ length: 7 }, () => 'security-decision'),
    );
    expect(records.map((record) => (record.type === 'security-decision' ? record.door : null))).toEqual(
      SECURITY_EVENT_INCIDENT_DOORS,
    );
    expect(Object.keys(records[0]!).sort()).toEqual([
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
    ]);
    expect(records.every((record) => journal.verify(record))).toBe(true);
  });

  it('fails closed on missing, accessor-backed, mismatched, or payload-shaped decision facts', () => {
    const journal = createSecurityEventJournal({ authority, now: () => 1_720_000_000_000 });
    const valid = decision('authorization');

    expect(() =>
      journal.record({ ...valid, principal: undefined } as unknown as SecurityDecisionEventInput),
    ).toThrow(/principal scope/u);
    expect(() =>
      journal.record({
        ...valid,
        resourceScope: { identity: 'global', kind: 'destination' },
      } as SecurityDecisionEventInput),
    ).toThrow(/resource kind/u);
    expect(() =>
      journal.record({
        ...valid,
        principal: { epoch: null, id: 'principal-a', kind: 'principal', tenant: null },
      } as unknown as SecurityDecisionEventInput),
    ).toThrow(/epoch/u);
    expect(() =>
      journal.record({
        ...valid,
        resourceScope: {
          identity: 'https://api.example.test/private/customer/17',
          kind: 'resource',
        },
      } as unknown as SecurityDecisionEventInput),
    ).toThrow(/opaque resource scope/u);
    expect(() =>
      journal.record({ ...valid, payload: { secret: 'must-not-enter-record' } } as unknown as SecurityDecisionEventInput),
    ).toThrow(/unexpected field/u);

    const accessor = { ...valid } as Record<string, unknown>;
    Object.defineProperty(accessor, 'decisionSite', {
      enumerable: true,
      get() {
        return 'framework:authorization:answerability-test';
      },
    });
    expect(() => journal.record(accessor as unknown as SecurityDecisionEventInput)).toThrow(
      /own data/u,
    );
    expect(journal.snapshot()).toEqual([]);
  });
});
