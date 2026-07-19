import { describe, expect, it } from 'vitest';

import {
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
});
