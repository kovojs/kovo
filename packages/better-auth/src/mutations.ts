import { mutation } from '@kovojs/server';
import { assignDerivedMutationKey } from '@kovojs/server/internal/wire';
import type { MutationDefinition } from '@kovojs/server';

import {
  betterAuthCredentialMutationErrors,
  betterAuthCredentialMutationTouches,
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
  BetterAuthCredentialMutationOptions,
  BetterAuthCredentialMutationValue,
  BetterAuthRequestLike,
  BetterAuthSignInEmailLike,
  BetterAuthSignOutLike,
  BetterAuthSignUpEmailLike,
} from './internal.js';

type MutationWithAssignedKey<Definition, Key extends string> =
  Definition extends MutationDefinition<
    string,
    infer InputSchema,
    infer Errors,
    infer Request,
    infer Value,
    infer GuardedRequest
  >
    ? MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest> & { key: Key }
    : Definition & { key: Key };

function assignBetterAuthMutationKey<Key extends string, Definition extends { key: string }>(
  definition: Definition,
  key: Key,
): MutationWithAssignedKey<Definition, Key> {
  assignDerivedMutationKey(definition as unknown as MutationDefinition<string>, key);
  return definition as unknown as MutationWithAssignedKey<Definition, Key>;
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
> & { key: Key } {
  return assignBetterAuthMutationKey(
    mutation({
      ...credentialMutationDefinitionOptions(
        options,
        betterAuthCredentialMutationTouches.signInEmail,
      ),
      errors: betterAuthCredentialMutationErrors,
      input: betterAuthSignInEmailInput,
      redirectTo: (result: { value: BetterAuthCredentialMutationValue<'signed-in'> }) =>
        result.value.redirectTo,
      async handler(input, request, context) {
        try {
          const response = await auth.api.signInEmail({
            asResponse: true,
            body: {
              email: input.email,
              password: input.password,
            },
            headers: request.headers,
          });

          const success = await resolveBetterAuthCredentialSuccess(response, context, {
            redirectTo: redirectPath(input.next, options.defaultRedirectTo ?? '/'),
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

          throw error;
        }
      },
    }),
    options.key ?? ('auth/sign-in' as Key),
  );
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
> & { key: Key } {
  return assignBetterAuthMutationKey(
    mutation({
      ...credentialMutationDefinitionOptions(
        options,
        betterAuthCredentialMutationTouches.signUpEmail,
      ),
      errors: betterAuthCredentialMutationErrors,
      input: betterAuthSignUpEmailInput,
      redirectTo: (result: { value: BetterAuthCredentialMutationValue<'signed-up'> }) =>
        result.value.redirectTo,
      async handler(input, request, context) {
        try {
          const response = await auth.api.signUpEmail({
            asResponse: true,
            body: {
              email: input.email,
              name: input.name,
              password: input.password,
            },
            headers: request.headers,
          });

          const success = await resolveBetterAuthCredentialSuccess(response, context, {
            redirectTo: redirectPath(input.next, options.defaultRedirectTo ?? '/'),
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

          throw error;
        }
      },
    }),
    options.key ?? ('auth/sign-up' as Key),
  );
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
> & { key: Key } {
  return assignBetterAuthMutationKey(
    mutation({
      ...credentialMutationDefinitionOptions(options, betterAuthCredentialMutationTouches.signOut),
      errors: {},
      input: betterAuthSignOutInput,
      redirectTo: (result: { value: BetterAuthCredentialMutationValue<'signed-out'> }) =>
        result.value.redirectTo,
      async handler(_input, request, context) {
        const response = await auth.api.signOut({
          asResponse: true,
          headers: request.headers,
        });

        forwardBetterAuthSetCookie(response.headers, context);
        setSessionRevocationClearSiteData(context);

        return {
          redirectTo: options.defaultRedirectTo ?? '/login',
          status: 'signed-out' as const,
        };
      },
    }),
    options.key ?? ('auth/sign-out' as Key),
  );
}
