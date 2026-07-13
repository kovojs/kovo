import { snapshotAuditJustification } from '../audit-justification.js';

/**
 * @internal Runtime half of the SPEC §6.6/§9.1 mutation CSRF discriminant.
 * Call only after the declaration has been copied to a framework-owned own-data
 * snapshot, so validation and later explain/dispatch consumers observe the same bytes.
 */
export function validateMutationCsrfPosture(source: {
  readonly csrf?: unknown;
  readonly csrfJustification?: unknown;
}): void {
  if (source.csrf === false) {
    snapshotAuditJustification(
      source.csrfJustification,
      'mutation() csrf:false csrfJustification',
    );
    return;
  }
  if (source.csrfJustification !== undefined) {
    throw new TypeError(
      'mutation() csrfJustification is only valid when csrf is exactly false.',
    );
  }
}
