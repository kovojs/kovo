import {
  reportServerError,
  type ServerErrorDiagnosticInputContext,
  type ServerErrorHandler,
} from '../diagnostics.js';

import type { MutationLifecycleReplayReservation } from './replay-policy.js';

/**
 * Release replay truth for a failure whose application transaction did not commit.
 *
 * A custom store's abort hook is app-controlled and may throw or reject. That secondary failure
 * is diagnostic-only: it cannot replace the framework's stable 500 response or become an
 * unhandled rejection (SPEC §9.1/§10.3).
 *
 * @internal
 */
export async function abortFailedMutationReplay(
  reservation: MutationLifecycleReplayReservation<unknown> | undefined,
  onError: ServerErrorHandler | undefined,
  context: ServerErrorDiagnosticInputContext,
): Promise<void> {
  try {
    await reservation?.abort?.();
  } catch (error) {
    reportServerError(onError, error, context);
  }
}
