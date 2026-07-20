import { DeclassifyPolicy } from '@kovojs/core';

export const testSecretRevealPolicy = DeclassifyPolicy.create({
  door: 'secret.reveal',
  ownerScope: 'application',
  purpose: 'server-computation',
});

export const testRevealSecretPolicy = DeclassifyPolicy.create({
  door: 'revealSecret',
  ownerScope: 'application',
  purpose: 'server-computation',
});

export const testTrustedRevealPolicy = DeclassifyPolicy.create({
  door: 'trustedReveal',
  ownerScope: 'application',
  purpose: 'public-projection',
});

export const testRevealUntrustedPolicy = DeclassifyPolicy.create({
  door: 'revealUntrusted',
  ownerScope: 'application',
  purpose: 'request-validation',
});
