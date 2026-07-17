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
import {
  mutation,
  type MutationCsrfDeclaration,
  type MutationDefinition,
  type MutationFormDefinition,
} from '../mutation/definition.js';
import type { Schema } from '../schema.js';

/**
 * Declare a framework-owned Better Auth mutation with an exact reviewed wire key. App-authored
 * declarations stay on the public source-derived `mutation({ ... })` API; this adapter-only entry
 * keeps the branded mutation mint in the same packed server chunk that later consumes it
 * (SPEC §4.1/§6.5).
 *
 * @internal
 */
export function createBetterAuthCredentialMutation<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>> = Record<string, Schema<unknown>>,
  Request = unknown,
  Value = unknown,
  GuardedRequest extends Request = Request,
>(
  key: Key,
  definition: Omit<
    MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
    'csrf' | 'csrfJustification' | 'key'
  > &
    MutationCsrfDeclaration<Request>,
): MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest> &
  MutationFormDefinition<Key, Request> {
  return mutation(key, definition);
}

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
