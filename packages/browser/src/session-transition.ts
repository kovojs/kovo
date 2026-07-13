import type { MutationBroadcast } from './broadcast.js';
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';
import {
  applySecurityIntrinsic,
  securityGetOwnPropertyDescriptor,
  securityGetPrototypeOf,
} from './security-witness-intrinsics.js';

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
 * Snapshot the exact old-principal retirement capability before an async mutation starts.
 *
 * SPEC §6.6/§9.3: a submit options object and its broadcast method remain reachable by authored
 * code while the request is in flight. Header-time retirement must close the channel selected at
 * submission, even if either property is later replaced.
 *
 * @internal
 */
export function captureSessionTransitionPrincipalRetirement(
  runtime: SessionTransitionRuntime,
): () => void {
  const broadcastDescriptor = securityGetOwnPropertyDescriptor(runtime, 'broadcast');
  if (
    !broadcastDescriptor ||
    ('value' in broadcastDescriptor && broadcastDescriptor.value === undefined)
  ) {
    return () => undefined;
  }
  if (!('value' in broadcastDescriptor)) {
    throw new TypeError('Kovo session-transition broadcast must be own data.');
  }
  const broadcast = broadcastDescriptor.value;
  if (broadcast === null || typeof broadcast !== 'object') {
    throw new TypeError('Kovo session-transition broadcast is invalid.');
  }
  const close = capturedBroadcastMethod(broadcast, 'close');
  if (!close) throw new TypeError('Kovo session-transition broadcast close is unavailable.');
  let retired = false;
  return () => {
    if (retired) return;
    retired = true;
    applySecurityIntrinsic(close, broadcast, []);
  };
}

/**
 * SPEC §9.3: synchronously cut the page-load principal's origin-wide mutation authority before
 * any reload or sanitized hard-navigation sink is consulted. Navigation can be delayed, rejected,
 * or cancelled by the user agent; none of those outcomes may keep the old channel live.
 *
 * @internal
 */
export function retireSessionTransitionPrincipal(runtime: SessionTransitionRuntime): void {
  captureSessionTransitionPrincipalRetirement(runtime)();
}

function capturedBroadcastMethod(
  value: object,
  property: 'close',
): ((...args: any[]) => unknown) | undefined {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = securityGetOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      return 'value' in descriptor && typeof descriptor.value === 'function'
        ? descriptor.value
        : undefined;
    }
    owner = securityGetPrototypeOf(owner);
  }
  return undefined;
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
