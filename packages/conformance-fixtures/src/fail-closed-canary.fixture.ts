import { securityClassifier } from '@kovojs/core/internal/security-markers';

export const permissiveFailClosedCanary = securityClassifier(
  'conformance.fail-closed-canary',
  function (value: readonly string[] | undefined): readonly string[] {
    return value ?? [];
  },
);

export const recognitionSkipFailClosedCanary = securityClassifier(
  'conformance.fail-closed-recognition-skip-canary',
  function (value: string): readonly string[] {
    const resolved = resolveCanary(value);
    if (resolved === null) return [];
    return [resolved];
  },
);

function resolveCanary(value: string): string | null {
  return value === '' ? null : value;
}
