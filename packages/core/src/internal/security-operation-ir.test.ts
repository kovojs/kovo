import { describe, expect, it } from 'vitest';

import {
  agentIntegrityAllows,
  agentIntegrityLevels,
  agentMinimumIntegrityForOperations,
  attenuateAgentIntegrity,
  browserSecurityOperationKinds,
  securityOperationDoorForKind,
  securityOperationKinds,
  securityRootKinds,
  securitySemanticClosedReasons,
  serverSecurityOperationKinds,
} from './security-operation-ir.js';

describe('finite security decision vocabulary (SPEC §2 and §6.6)', () => {
  it('exports exact frozen operation, root, and closed-verdict inventories', () => {
    expect(browserSecurityOperationKinds).toHaveLength(12);
    expect(serverSecurityOperationKinds).toHaveLength(16);
    expect(securityOperationKinds).toHaveLength(28);
    expect(securityRootKinds).toHaveLength(11);
    expect(securitySemanticClosedReasons).toHaveLength(8);

    for (const values of [
      browserSecurityOperationKinds,
      serverSecurityOperationKinds,
      securityOperationKinds,
      securityRootKinds,
      securitySemanticClosedReasons,
    ]) {
      expect(Object.isFrozen(values)).toBe(true);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it('keeps every finite operation attached to one reviewed C9 door', () => {
    expect(securityOperationKinds.map((kind) => securityOperationDoorForKind(kind))).toHaveLength(
      securityOperationKinds.length,
    );
  });

  it('keeps none out of the generated root denominator', () => {
    expect(securityRootKinds).not.toContain('none');
    expect(securityRootKinds).toContain('scheduled-task');
  });

  it('exhausts the four-level agent meet and finite operation requirements', () => {
    expect(agentIntegrityLevels).toEqual(['untrusted', 'retrieved', 'validated', 'principal']);
    expect(Object.isFrozen(agentIntegrityLevels)).toBe(true);
    for (let actual = 0; actual < agentIntegrityLevels.length; actual += 1) {
      for (let minimum = 0; minimum < agentIntegrityLevels.length; minimum += 1) {
        expect(
          agentIntegrityAllows(agentIntegrityLevels[actual]!, agentIntegrityLevels[minimum]!),
        ).toBe(actual >= minimum);
        expect(
          attenuateAgentIntegrity(agentIntegrityLevels[actual]!, agentIntegrityLevels[minimum]!),
        ).toBe(agentIntegrityLevels[Math.min(actual, minimum)]);
      }
    }

    const retrieved = new Set(['server.database.read', 'server.storage.read']);
    const untrusted = new Set(['server.handler.root', 'server.helper.call']);
    for (const kind of serverSecurityOperationKinds) {
      expect(
        agentMinimumIntegrityForOperations([{ door: securityOperationDoorForKind(kind), kind }]),
      ).toBe(untrusted.has(kind) ? 'untrusted' : retrieved.has(kind) ? 'retrieved' : 'principal');
    }
    expect(
      agentMinimumIntegrityForOperations([
        { door: 'handler-root', kind: 'server.future-effect' } as never,
      ]),
    ).toBe('principal');
  });
});
