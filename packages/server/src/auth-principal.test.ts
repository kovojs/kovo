import { describe, expect, it } from 'vitest';

import {
  actAsNonRequestPrincipal,
  assertNonRequestPrincipalPosture,
  declareSystemPrincipal,
  nonRequestPrincipalPostureDiagnostic,
} from './auth-principal.js';

describe('non-request principal posture (SPEC §10.3 DEC-G)', () => {
  const audit = {
    ingress: 'task' as const,
    operation: 'read' as const,
    surface: 'nightly:test_job',
  };

  it('mints branded actAs and system postures for framework-owned task/webhook seams', () => {
    const actAs = actAsNonRequestPrincipal('user_1', audit);
    const system = declareSystemPrincipal('nightly analytics sweep', audit);

    expect(() => assertNonRequestPrincipalPosture(actAs)).not.toThrow();
    expect(() => assertNonRequestPrincipalPosture(system)).not.toThrow();
    expect(nonRequestPrincipalPostureDiagnostic(actAs)).toBe(
      'task:nightly:test_job:read:actAs(user_1)',
    );
    expect(nonRequestPrincipalPostureDiagnostic(system)).toBe(
      'task:nightly:test_job:read:system(nightly analytics sweep)',
    );
  });

  it('rejects structural brand shortcuts and unresolved actAs ids', () => {
    expect(() =>
      assertNonRequestPrincipalPosture({
        audit,
        kind: 'act-as',
        principal: 'user_1',
      }),
    ).toThrow(/framework-minted actAs/);
    expect(() => actAsNonRequestPrincipal(' anonymous ', audit)).toThrow(/proven/);
    expect(() => declareSystemPrincipal('', audit)).toThrow(/non-empty audited reason/);
  });
});
