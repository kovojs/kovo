import type { MutationBroadcast } from './broadcast.js';
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';

const bootSessionTransitionSecurity = createBrowserNavigationSecurityControls();
const bootSessionTransitionReloadPinned = bootSessionTransitionSecurity.hasReloadControl();
let fallbackSessionTransitionLocation: unknown;
let fallbackSessionTransitionSecurity:
  | ReturnType<typeof createBrowserNavigationSecurityControls>
  | undefined;

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

function sessionTransitionSecurity(): ReturnType<typeof createBrowserNavigationSecurityControls> {
  if (bootSessionTransitionReloadPinned) return bootSessionTransitionSecurity;

  // Node/SSR imports have no Location at module initialization. Admit a late browser/test realm
  // only when the whole Location object appears or changes, then pin that receiver and exact
  // method. A later write to `.reload` on the same object cannot replace the selected sink.
  const location = (globalThis as { location?: unknown }).location;
  if (
    fallbackSessionTransitionSecurity === undefined ||
    fallbackSessionTransitionLocation !== location
  ) {
    fallbackSessionTransitionLocation = location;
    fallbackSessionTransitionSecurity = createBrowserNavigationSecurityControls();
  }
  return fallbackSessionTransitionSecurity;
}

/** @internal Start the full-render half of a session transition after principal retirement. */
export function reloadSessionTransitionDocument(): unknown {
  return sessionTransitionSecurity().reload();
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
