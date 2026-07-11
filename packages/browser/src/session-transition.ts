import type { MutationBroadcast } from './broadcast.js';

export interface SessionTransitionRuntime {
  broadcast?: MutationBroadcast;
}

/**
 * SPEC §9.3: once a mutation response announces a session transition, the page-load principal is
 * stale. Retire its origin-wide channel immediately, before reading or applying response bytes,
 * then force a full render that installs the current principal fingerprint.
 *
 * @internal
 */
export function retireSessionTransitionRuntime(runtime: SessionTransitionRuntime): void {
  runtime.broadcast?.close();
  const location = (globalThis as { location?: { reload?: () => void } }).location;
  location?.reload?.();
}
