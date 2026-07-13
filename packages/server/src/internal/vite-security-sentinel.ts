/** @internal Module-private posture token for the supported bootstrap-first Vite runner. */
export const trustedViteSecurityProfileSentinel: unique symbol = Symbol(
  'Kovo trusted Vite security profile',
);

/** @internal Module-private slot carrying the pre-authored trusted dev integration constructor. */
export const trustedViteSecurityProfileIntegrationSentinel: unique symbol = Symbol(
  'Kovo trusted Vite security profile integration',
);
