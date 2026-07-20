import { runUniformWork } from '@kovojs/server/internal/better-auth';

import type { BetterAuthCredentialMutationValue } from './internal/credential.js';
import type { BetterAuthResponseLike } from './internal/contracts.js';
import { betterAuthDrainResponseBody, betterAuthResponseStatus } from './internal/intrinsics.js';

/**
 * Normalize a captured Better Auth account operation at Kovo's HTTP-handler door (SPEC §9.2).
 * Accepted and rejected upstream responses are fully consumed through the same work shape, then
 * replaced by the typed generic-accepted Kovo result. Upstream status/body/cookies never cross.
 *
 * @kovo-response-observation-candidate better-auth.sign-up-email
 */
export async function normalizeBetterAuthAccountOperation<Status extends string>(
  response: BetterAuthResponseLike,
  accepted: BetterAuthCredentialMutationValue<Status>,
): Promise<BetterAuthCredentialMutationValue<Status>> {
  const status = betterAuthResponseStatus(response);
  const acceptedProviderResponse =
    status !== undefined && status >= 200 && status < 300 ? response : undefined;
  return await runUniformWork({
    candidate: acceptedProviderResponse,
    decoy() {
      return response;
    },
    async work(selected) {
      const body = betterAuthDrainResponseBody(selected);
      if (body !== undefined) {
        try {
          await body;
        } catch {
          // The normalized Kovo result owns the body vocabulary; unreadable provider bytes are
          // discarded in both worlds and cannot become an account-existence oracle.
        }
      }
      return accepted;
    },
    normalize(result) {
      return result;
    },
  });
}

/**
 * Password-reset specialization used at the same captured handler door. External mail delivery is
 * deliberately outside Kovo's HTTP-equivalence claim and must be measured by the deployer.
 *
 * @kovo-response-observation-candidate better-auth.request-password-reset
 */
export async function normalizeBetterAuthPasswordResetResponse(
  response: BetterAuthResponseLike,
): Promise<BetterAuthCredentialMutationValue<'recovery-accepted'>> {
  return await normalizeBetterAuthAccountOperation(response, {
    redirectTo: '/',
    status: 'recovery-accepted',
  });
}
