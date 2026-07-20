import { DeclassifyPolicy } from '@kovojs/core';

/**
 * Framework-owned request-validation release used only after a server boundary has independently
 * validated the input shape. This policy is runtime capability data, not static proof (SPEC §6.6).
 * @internal
 */
export const frameworkRevealUntrustedPolicy = DeclassifyPolicy.create({
  door: 'revealUntrusted',
  ownerScope: 'framework',
  purpose: 'request-validation',
});
