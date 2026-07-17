import type { EndpointDeclaration } from '@kovojs/server';
import { createBetterAuthMountEndpoint } from '@kovojs/server/internal/better-auth';

import type { BetterAuthMountAdapter } from './mount-adapter.js';

/**
 * Mounts Better Auth's own request handler at a prefix endpoint so its browser redirect
 * protocol — OAuth/magic-link callbacks and similar safe-method provider round-trips — is served
 * under one declared path, while credential forms stay on typed mutations (SPEC.md §9.1).
 *
 * SECURITY — this endpoint is always declared with `csrf: false`. Per SPEC.md §6.6, CSRF
 * protection is default-ON for server-rendered, cookie-authenticated mutations, and
 * `csrf: false` is the framework's *sanctioned opt-out* reserved for endpoints that are
 * not browser-form-driven or are authenticated by some other means (e.g. non-browser /
 * externally-authenticated callers). Better Auth's redirect protocol handler is exactly
 * such an endpoint: the inbound requests are external-provider redirects and the
 * library-supplied OAuth `state` parameter (not a Kovo CSRF token) carries the
 * anti-forgery guarantee, so a Kovo CSRF token cannot be present or required here.
 * Disabling CSRF on this prefix does NOT relax protection on the app's own credential
 * mutations, which keep CSRF on. The framework hardcodes GET: an unsafe-method callback needs a
 * separate framework-owned, self-verifying adapter rather than widening this prefix authority.
 */
export function mount<const Path extends string>(
  path: Path,
  adapter: BetterAuthMountAdapter,
): EndpointDeclaration<Path, 'GET', 'prefix'> {
  return createBetterAuthMountEndpoint(path, adapter);
}
