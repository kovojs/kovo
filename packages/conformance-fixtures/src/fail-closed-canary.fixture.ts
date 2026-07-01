import { securityClassifier } from '@kovojs/core/internal/security-markers';

export const permissiveFailClosedCanary = securityClassifier(
  'conformance.fail-closed-canary',
  function (value: readonly string[] | undefined): readonly string[] {
    return value ?? [];
  },
);
