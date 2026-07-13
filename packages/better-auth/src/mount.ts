import { endpoint } from '@kovojs/server';
import type {
  AccessDecision,
  EndpointAuthDeclaration,
  EndpointDeclaration,
  EndpointMethod,
} from '@kovojs/server';

import { betterAuthMountOperationContract } from './internal/contracts.js';
import { betterAuthApply, betterAuthCaptureOwnMethod } from './internal/intrinsics.js';
import { assertBetterAuthRequestSecretPath } from './internal/non-egress-proof.js';
import type { BetterAuthMountHandler, BetterAuthMountLike } from './internal.js';

/**
 * Options for `mount`. `auth` overrides the default `custom` endpoint auth
 * declaration; `method` narrows the HTTP method; `csrfJustification` records why this
 * prefix endpoint is exempt from CSRF (the endpoint always runs with `csrf: false` — see
 * `mount` for the SPEC.md §6.6 rationale).
 */
export interface BetterAuthMountOptions<Method extends EndpointMethod = EndpointMethod> {
  access?: AccessDecision;
  auth?: EndpointAuthDeclaration;
  csrfJustification?: string;
  method: Method;
}

/**
 * Mounts Better Auth's own request handler at a prefix endpoint so its browser redirect
 * protocol — OAuth/SAML/magic-link callbacks and similar provider round-trips — is served
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
 * mutations, which keep CSRF on. The reason is recorded on the endpoint via
 * `csrfJustification` (overridable through `BetterAuthMountOptions`).
 */
export function mount<
  const Path extends string,
  const Method extends EndpointMethod = EndpointMethod,
>(
  path: Path,
  auth: BetterAuthMountLike | BetterAuthMountHandler,
  options: BetterAuthMountOptions<Method>,
): EndpointDeclaration<Path, Method, 'prefix'> {
  const { method: handler, receiver: handlerReceiver } =
    typeof auth === 'function'
      ? { method: auth, receiver: undefined }
      : betterAuthCaptureOwnMethod(auth, 'handler', 'Better Auth mount');
  const endpointAuth = options.auth ?? betterAuthMountOperationContract.auth;

  return endpoint(path, {
    ...(options.access === undefined && options.auth !== undefined
      ? {}
      : { access: options.access ?? betterAuthMountOperationContract.access }),
    auth: endpointAuth,
    csrf: false,
    csrfJustification:
      options.csrfJustification ?? betterAuthMountOperationContract.csrf.justification,
    handler(request) {
      assertBetterAuthRequestSecretPath('better-auth.mount.handler-delegation');
      return betterAuthApply(handler, handlerReceiver, [request]);
    },
    method: options.method,
    mount: 'prefix',
    mountJustification: betterAuthMountOperationContract.mountJustification,
    reason: betterAuthMountOperationContract.reason,
    response: betterAuthMountOperationContract.response,
  });
}
