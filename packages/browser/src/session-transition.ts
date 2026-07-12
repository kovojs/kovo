import type { MutationBroadcast } from './broadcast.js';

export interface SessionTransitionRuntime {
  broadcast?: MutationBroadcast;
}

/**
 * SPEC §9.3: synchronously cut the page-load principal's origin-wide mutation authority before
 * any reload or sanitized hard-navigation sink is consulted. Navigation can be delayed, rejected,
 * or cancelled by the user agent; none of those outcomes may keep the old channel live.
 *
 * @internal
 */
export function retireSessionTransitionPrincipal(runtime: SessionTransitionRuntime): void {
  runtime.broadcast?.close();
}

/** @internal Start the full-render half of a session transition after principal retirement. */
export function reloadSessionTransitionDocument(): void {
  const location = (globalThis as { location?: { reload?: () => void } }).location;
  location?.reload?.();
}

/**
 * SPEC §9.3: once a mutation response announces a session transition, the page-load principal is
 * stale. Retire its origin-wide channel immediately, before reading or applying response bytes,
 * then force a full render that installs the current principal fingerprint.
 *
 * @internal
 */
export function retireSessionTransitionRuntime(runtime: SessionTransitionRuntime): void {
  retireSessionTransitionPrincipal(runtime);
  reloadSessionTransitionDocument();
}
