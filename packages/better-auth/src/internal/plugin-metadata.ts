import { betterAuthDeepFreeze } from './intrinsics.js';

/** @internal Candidate import paths probed for the OAuth-provider successor package metadata. */
export const betterAuthOAuthProviderSuccessorImportPaths = betterAuthDeepFreeze(
  [
    '@better-auth/oauth-provider',
    'better-auth/oauth-provider',
    'better-auth/plugins/oauth-provider',
  ] as const,
  'Better Auth OAuth-provider successor import paths',
);

/** @internal Candidate import paths probed for the Better Auth SSO plugin metadata. */
export const betterAuthSsoPluginMetadataImportPaths = betterAuthDeepFreeze(
  ['better-auth/plugins/sso', 'better-auth/sso', '@better-auth/sso'] as const,
  'Better Auth SSO plugin metadata import paths',
);

/** @internal Candidate import paths probed for the Better Auth passkey plugin metadata. */
export const betterAuthPasskeyPluginMetadataImportPaths = betterAuthDeepFreeze(
  ['better-auth/plugins/passkey', 'better-auth/passkey', '@better-auth/passkey'] as const,
  'Better Auth passkey plugin metadata import paths',
);
