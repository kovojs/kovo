export type AdversarialResidualProofId =
  | 'adversarial-diagnostic-assertion'
  | 'adversarial-bugz25-postgres'
  | 'adversarial-bugz31-ordinary-carriers'
  | 'adversarial-bugz31-projection-carriers'
  | 'adversarial-bugz31-array-result-carriers'
  | 'adversarial-bugz31-iterable-binding-carriers'
  | 'adversarial-bugz31-assignment-targets'
  | 'adversarial-bugz31-loop-and-exhaustion-targets'
  | 'adversarial-bugz31-assimilation'
  | 'adversarial-bugz31-root-provenance'
  | 'adversarial-bugz31-namespace-members-postgres';

export const ADVERSARIAL_RESIDUAL_TEST_TIMEOUT_MS: Readonly<
  Record<AdversarialResidualProofId, number>
>;

export function adversarialResidualTestTimeoutMs(id: string): number;
