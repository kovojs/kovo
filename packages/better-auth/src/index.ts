export type { BetterAuthRoleRequest, BetterAuthRoleSession, BetterAuthRoleUser } from './guards.js';
export { authed, role } from './guards.js';
export type { BetterAuthCredentialMutationOptions } from './credential-options.js';
export type { BetterAuthMountOptions } from './mount.js';
export { mount } from './mount.js';
export type {
  BetterAuthApi,
  BetterAuthCredentialMutationValue,
  BetterAuthGetSessionOptions,
  BetterAuthGetSessionWithHeadersOptions,
  BetterAuthGetSessionWithHeadersResult,
  BetterAuthLike,
  BetterAuthMountHandler,
  BetterAuthMountLike,
  BetterAuthRequestLike,
  BetterAuthResponseLike,
  BetterAuthSignInEmailApi,
  BetterAuthSignInEmailBody,
  BetterAuthSignInEmailLike,
  BetterAuthSignOutApi,
  BetterAuthSignOutLike,
  BetterAuthSignUpEmailApi,
  BetterAuthSignUpEmailBody,
  BetterAuthSignUpEmailLike,
} from './internal.js';
export {
  betterAuthSignInEmailMutation,
  betterAuthSignOutMutation,
  betterAuthSignUpEmailMutation,
} from './mutations.js';
export type {
  BetterAuthSafeField,
  BetterAuthSanitizedRecord,
  BetterAuthSanitizedSessionPayload,
  BetterAuthSanitizedValue,
  BetterAuthSessionMapper,
  BetterAuthSessionPayload,
} from './session.js';
export { betterAuthSession } from './session.js';
