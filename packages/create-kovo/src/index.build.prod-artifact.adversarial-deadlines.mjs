export const ADVERSARIAL_RESIDUAL_TEST_TIMEOUT_MS = Object.freeze({
  'adversarial-diagnostic-assertion': 480_000,
  'adversarial-bugz25-postgres': 300_000,
  'adversarial-bugz31-ordinary-carriers': 300_000,
  'adversarial-bugz31-projection-carriers': 300_000,
  'adversarial-bugz31-array-result-carriers': 300_000,
  'adversarial-bugz31-iterable-binding-carriers': 300_000,
  'adversarial-bugz31-assignment-targets': 300_000,
  'adversarial-bugz31-loop-and-exhaustion-targets': 300_000,
  'adversarial-bugz31-assimilation': 300_000,
  'adversarial-bugz31-root-provenance': 300_000,
  'adversarial-bugz31-namespace-members-postgres': 300_000,
});

export function adversarialResidualTestTimeoutMs(id) {
  const timeoutMs = ADVERSARIAL_RESIDUAL_TEST_TIMEOUT_MS[id];
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Unknown adversarial residual proof deadline: ${String(id)}`);
  }
  return timeoutMs;
}
