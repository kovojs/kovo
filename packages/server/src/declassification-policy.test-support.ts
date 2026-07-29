import { DeclassifyPolicy } from '@kovojs/core/security';

export const testSecretRevealPolicy = DeclassifyPolicy.forSecretValue({
  ownerScope: 'application',
  purpose: 'server-computation',
});

export const testRevealSecretPolicy = DeclassifyPolicy.forRevealSecret({
  ownerScope: 'application',
  purpose: 'server-computation',
});

export const testTrustedRevealPolicy = DeclassifyPolicy.forTrustedReveal({
  ownerScope: 'application',
});

export const testRevealUntrustedPolicy = DeclassifyPolicy.forRevealUntrusted({
  ownerScope: 'application',
});
