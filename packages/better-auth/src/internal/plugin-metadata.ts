/** @internal Candidate import paths probed for the OAuth-provider successor package metadata. */
export const betterAuthOAuthProviderSuccessorImportPaths = [
  '@better-auth/oauth-provider',
  'better-auth/oauth-provider',
  'better-auth/plugins/oauth-provider',
] as const;

/** @internal Candidate import paths probed for the Better Auth SSO plugin metadata. */
export const betterAuthSsoPluginMetadataImportPaths = [
  'better-auth/plugins/sso',
  'better-auth/sso',
  '@better-auth/sso',
] as const;

/** @internal Candidate import paths probed for the Better Auth passkey plugin metadata. */
export const betterAuthPasskeyPluginMetadataImportPaths = [
  'better-auth/plugins/passkey',
  'better-auth/passkey',
  '@better-auth/passkey',
] as const;
