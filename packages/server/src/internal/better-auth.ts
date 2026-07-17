import {
  assertBetterAuthMountAdapter,
  invokeBetterAuthMountAdapter,
  type BetterAuthMountAdapter,
} from '@kovojs/better-auth/internal/server-mount-adapter';

import { publicAccess } from '../access.js';
import {
  frameworkEndpoint,
  pinEndpointBrowserCredentialDelegation,
  type EndpointDeclaration,
} from '../endpoint.js';

/**
 * Build the fixed endpoint for an exact opaque Better Auth adapter token. This entry accepts no
 * handler, auth declaration, CSRF exemption, access decision, or response posture from its caller;
 * a forged or structural token fails before private browser authority is minted (SPEC §6.6/§9.1).
 *
 * @internal
 */
export function createBetterAuthMountEndpoint<const Path extends string>(
  path: Path,
  adapter: BetterAuthMountAdapter,
): EndpointDeclaration<Path, 'GET', 'prefix'> {
  assertBetterAuthMountAdapter(adapter);
  return frameworkEndpoint(
    path,
    {
      access: publicAccess('better-auth provider redirect protocol handled by Better Auth state'),
      auth: { kind: 'custom', name: 'better-auth' },
      csrf: false,
      csrfJustification: 'better-auth browser redirect protocol handler',
      async handler(request) {
        return await invokeBetterAuthMountAdapter(adapter, request);
      },
      method: 'GET',
      mount: 'prefix',
      mountJustification: 'better-auth owns provider callback subpaths under this mount',
      reason: 'better-auth provider redirect and callback mount',
      response: {
        appOwnedSafety: true,
        body: 'redirect',
        cache: 'no-store',
        reservedHeaders: ['Location', 'Set-Cookie'],
      },
    },
    (declaration) => {
      pinEndpointBrowserCredentialDelegation(declaration);
    },
  );
}
