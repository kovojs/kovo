import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';

const FALLBACK_REAUTH_LOCATION = '/';
const reauthSecurity = createBrowserNavigationSecurityControls();

/**
 * SPEC §6.5: a `Kovo-Reauth` browser navigation target must remain a
 * same-origin, single-leading-slash path. Treat the response header as an
 * untrusted sink even though framework servers already sanitize it.
 *
 * @internal
 */
export function sanitizeReauthDirective(value: string): string {
  return reauthSecurity.safeSameOriginPath(value) ?? FALLBACK_REAUTH_LOCATION;
}

/** @internal Shared root-relative redirect validator for auth-success and 401 paths. */
export function sanitizeAuthNavigationTarget(value: unknown): string | undefined {
  return reauthSecurity.safeSameOriginPath(value);
}
