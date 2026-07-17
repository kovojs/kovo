import type { MutationDefinition, MutationFormDefinition } from '@kovojs/server';
import { createBetterAuthCredentialMutation } from '@kovojs/server/internal/better-auth';

import {
  betterAuthCredentialMutationErrors,
  betterAuthSignInEmailInput,
  betterAuthSignOutInput,
  betterAuthSignUpEmailInput,
  credentialMutationDefinitionOptions,
  forwardBetterAuthSetCookie,
  isBetterAuthCredentialFailureError,
  redirectPath,
  resolveBetterAuthCredentialSuccess,
  setSessionRevocationClearSiteData,
} from './internal.js';
import type {
  BetterAuthCredentialMutationInternalOptions,
  BetterAuthCredentialMutationOptions,
} from './credential-options.js';
import type {
  BetterAuthCredentialMutationValue,
  BetterAuthRequestLike,
  BetterAuthResponseLike,
  BetterAuthSignInEmailLike,
  BetterAuthSignOutLike,
  BetterAuthSignUpEmailLike,
} from './internal.js';
import {
  callBetterAuthSignInEmail,
  callBetterAuthSignOut,
  callBetterAuthSignUpEmail,
  pinBetterAuthSignInEmail,
  pinBetterAuthSignOut,
  pinBetterAuthSignUpEmail,
} from './internal/trusted-plaintext.js';
import {
  betterAuthOwnDataOption,
  betterAuthResponseHeaders,
  betterAuthResponseStatus,
} from './internal/intrinsics.js';

const NativeError = Error;
const betterAuthCredentialBoundaryFailureMessage =
  'Better Auth credential provider failed inside the trusted plaintext boundary.';

function betterAuthCredentialBoundaryFailure(): Error {
  return new NativeError(betterAuthCredentialBoundaryFailureMessage);
}

/**
 * Builds a typed Kovo mutation that signs a user in via Better Auth email/password.
 * Calls `auth.api.signInEmail` with `asResponse: true`, treats the result as success only
 * on POSITIVE evidence of an established session (2xx, no two-factor-pending body, and a
 * session-establishing `Set-Cookie`), forwards the session cookie, and otherwise returns
 * the declared `INVALID_CREDENTIALS` failure. Defaults the mutation key to `auth/sign-in`.
 * Wire it into the app's mutation registry and pair it with a CSRF-protected login form
 * (SPEC.md §6.5; CSRF default-on per §6.6).
 */
export function betterAuthSignInEmailMutation<
  const Key extends string = 'auth/sign-in',
  Request extends BetterAuthRequestLike = BetterAuthRequestLike,
  GuardedRequest extends Request = Request,
>(
  auth: BetterAuthSignInEmailLike,
  options: BetterAuthCredentialMutationOptions<Key, Request, GuardedRequest> = {},
): MutationDefinition<
  Key,
  typeof betterAuthSignInEmailInput,
  typeof betterAuthCredentialMutationErrors,
  Request,
  BetterAuthCredentialMutationValue<'signed-in'>,
  GuardedRequest
> &
  MutationFormDefinition<Key, Request> {
  const pinnedAuth = pinBetterAuthSignInEmail(auth);
  const defaultRedirectTo = redirectPath(
    betterAuthOwnDataOption<string>(
      options,
      'defaultRedirectTo',
      'Better Auth credential option defaultRedirectTo',
    ),
    '/',
  );
  const key = betterAuthOwnDataOption<Key>(options, 'key', 'Better Auth credential option key');
  return createBetterAuthCredentialMutation(key ?? ('auth/sign-in' as Key), {
    ...credentialMutationDefinitionOptions(
      'signInEmail',
      options as BetterAuthCredentialMutationInternalOptions<Key, Request, GuardedRequest>,
    ),
    errors: betterAuthCredentialMutationErrors,
    input: betterAuthSignInEmailInput,
    redirectTo: (result: { value: BetterAuthCredentialMutationValue<'signed-in'> }) =>
      result.value.redirectTo,
    async handler(input, request, context) {
      try {
        const response = await callBetterAuthSignInEmail(
          pinnedAuth,
          {
            email: input.email,
            password: input.password,
          },
          request.headers,
        );

        const success = await resolveBetterAuthCredentialSuccess(response, context, {
          redirectTo: redirectPath(input.next, defaultRedirectTo),
          status: 'signed-in',
        });

        if (success === null) {
          return context.fail('INVALID_CREDENTIALS', {});
        }

        return success;
      } catch (error) {
        if (isBetterAuthCredentialFailureError(error)) {
          return context.fail('INVALID_CREDENTIALS', {});
        }

        throw betterAuthCredentialBoundaryFailure();
      }
    },
  });
}

/**
 * Builds a typed Kovo mutation that registers a user via Better Auth email/password.
 * Calls `auth.api.signUpEmail` with `asResponse: true`, applies the same
 * positive-session-evidence success check as sign-in, forwards the session cookie, and
 * returns the declared `INVALID_CREDENTIALS` failure otherwise. Defaults the mutation key
 * to `auth/sign-up` (SPEC.md §6.5; CSRF default-on per §6.6).
 */
export function betterAuthSignUpEmailMutation<
  const Key extends string = 'auth/sign-up',
  Request extends BetterAuthRequestLike = BetterAuthRequestLike,
  GuardedRequest extends Request = Request,
>(
  auth: BetterAuthSignUpEmailLike,
  options: BetterAuthCredentialMutationOptions<Key, Request, GuardedRequest> = {},
): MutationDefinition<
  Key,
  typeof betterAuthSignUpEmailInput,
  typeof betterAuthCredentialMutationErrors,
  Request,
  BetterAuthCredentialMutationValue<'signed-up'>,
  GuardedRequest
> &
  MutationFormDefinition<Key, Request> {
  const pinnedAuth = pinBetterAuthSignUpEmail(auth);
  const defaultRedirectTo = redirectPath(
    betterAuthOwnDataOption<string>(
      options,
      'defaultRedirectTo',
      'Better Auth credential option defaultRedirectTo',
    ),
    '/',
  );
  const key = betterAuthOwnDataOption<Key>(options, 'key', 'Better Auth credential option key');
  return createBetterAuthCredentialMutation(key ?? ('auth/sign-up' as Key), {
    ...credentialMutationDefinitionOptions(
      'signUpEmail',
      options as BetterAuthCredentialMutationInternalOptions<Key, Request, GuardedRequest>,
    ),
    errors: betterAuthCredentialMutationErrors,
    input: betterAuthSignUpEmailInput,
    redirectTo: (result: { value: BetterAuthCredentialMutationValue<'signed-up'> }) =>
      result.value.redirectTo,
    async handler(input, request, context) {
      try {
        const response = await callBetterAuthSignUpEmail(
          pinnedAuth,
          {
            email: input.email,
            name: input.name,
            password: input.password,
          },
          request.headers,
        );

        const success = await resolveBetterAuthCredentialSuccess(response, context, {
          redirectTo: redirectPath(input.next, defaultRedirectTo),
          status: 'signed-up',
        });

        if (success === null) {
          return context.fail('INVALID_CREDENTIALS', {});
        }

        return success;
      } catch (error) {
        if (isBetterAuthCredentialFailureError(error)) {
          return context.fail('INVALID_CREDENTIALS', {});
        }

        throw betterAuthCredentialBoundaryFailure();
      }
    },
  });
}

/**
 * Builds a typed Kovo mutation that signs a user out via Better Auth. Calls
 * `auth.api.signOut` with `asResponse: true`, forwards the session-clearing `Set-Cookie`
 * headers into the mutation response, and redirects to `defaultRedirectTo` (default
 * `/login`). Defaults the mutation key to `auth/sign-out`. Typically guarded so only an
 * authenticated request can sign out (SPEC.md §6.5; CSRF default-on per §6.6).
 */
export function betterAuthSignOutMutation<
  const Key extends string = 'auth/sign-out',
  Request extends BetterAuthRequestLike = BetterAuthRequestLike,
  GuardedRequest extends Request = Request,
>(
  auth: BetterAuthSignOutLike,
  options: BetterAuthCredentialMutationOptions<Key, Request, GuardedRequest> = {},
): MutationDefinition<
  Key,
  typeof betterAuthSignOutInput,
  Record<string, never>,
  Request,
  BetterAuthCredentialMutationValue<'signed-out'>,
  GuardedRequest
> &
  MutationFormDefinition<Key, Request> {
  const pinnedAuth = pinBetterAuthSignOut(auth);
  const defaultRedirectTo = redirectPath(
    betterAuthOwnDataOption<string>(
      options,
      'defaultRedirectTo',
      'Better Auth credential option defaultRedirectTo',
    ),
    '/login',
  );
  const key = betterAuthOwnDataOption<Key>(options, 'key', 'Better Auth credential option key');
  return createBetterAuthCredentialMutation(key ?? ('auth/sign-out' as Key), {
    ...credentialMutationDefinitionOptions(
      'signOut',
      options as BetterAuthCredentialMutationInternalOptions<Key, Request, GuardedRequest>,
    ),
    errors: {},
    input: betterAuthSignOutInput,
    redirectTo: (result: { value: BetterAuthCredentialMutationValue<'signed-out'> }) =>
      result.value.redirectTo,
    async handler(_input, request, context) {
      try {
        const response: BetterAuthResponseLike = await callBetterAuthSignOut(
          pinnedAuth,
          request.headers,
        );

        // SPEC §6.5/§9.1: a resolved provider promise is not revocation evidence. Bind the
        // exact boot-pinned Response facts and require a successful status before clearing any
        // browser state or publishing the framework-owned signed-out outcome. Deferred response
        // inspection and cookie forwarding remain inside the opaque plaintext boundary too.
        const status = betterAuthResponseStatus(response);
        const responseHeaders = betterAuthResponseHeaders(response);
        if (
          status === undefined ||
          status < 200 ||
          status >= 300 ||
          responseHeaders === undefined
        ) {
          throw betterAuthCredentialBoundaryFailure();
        }

        forwardBetterAuthSetCookie(responseHeaders, context);
        setSessionRevocationClearSiteData(context);

        return {
          redirectTo: defaultRedirectTo,
          status: 'signed-out' as const,
        };
      } catch {
        throw betterAuthCredentialBoundaryFailure();
      }
    },
  });
}
