import { snapshotAuditJustification } from '../audit-justification.js';
import { witnessGetOwnPropertyDescriptor } from '../security-witness-intrinsics.js';

/**
 * @internal Runtime half of the SPEC §6.6/§9.1 mutation CSRF discriminant.
 * Call only after the declaration has been copied to a framework-owned own-data
 * snapshot, so validation and later explain/dispatch consumers observe the same bytes.
 */
export function validateMutationCsrfPosture(source: {
  readonly csrf?: unknown;
  readonly csrfJustification?: unknown;
  readonly machineReplayPrincipal?: unknown;
}): void {
  const machineReplayPrincipal = witnessGetOwnPropertyDescriptor(source, 'machineReplayPrincipal');
  if (source.csrf === false) {
    snapshotAuditJustification(source.csrfJustification, 'mutation() csrf:false csrfJustification');
    if (
      machineReplayPrincipal !== undefined &&
      (!('value' in machineReplayPrincipal) || typeof machineReplayPrincipal.value !== 'function')
    ) {
      throw new TypeError(
        'mutation() csrf:false machineReplayPrincipal must be a stable selector function when declared.',
      );
    }
    return;
  }
  if (source.csrfJustification !== undefined) {
    throw new TypeError('mutation() csrfJustification is only valid when csrf is exactly false.');
  }
  if (machineReplayPrincipal !== undefined) {
    throw new TypeError(
      'mutation() machineReplayPrincipal is only valid when csrf is exactly false.',
    );
  }
}
