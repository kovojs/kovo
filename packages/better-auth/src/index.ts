// Keep the shared bootstrap-order witness as this exported entry's first executable dependency.
import './internal/runtime-lock.js';

export type { BetterAuthRoleRequest, BetterAuthRoleSession, BetterAuthRoleUser } from './guards.js';
export { authed, role } from './guards.js';
export type { BetterAuthCsrfRequestLike, BetterAuthEnvironmentCsrfOptions } from './environment.js';
export { betterAuthCsrfFromEnvironment } from './environment.js';
export type {
  BetterAuthDevelopmentSeed,
  BetterAuthPostgresBindings,
  BetterAuthPostgresBindingsOptions,
  BetterAuthPostgresEnvironmentBindingsOptions,
  BetterAuthPostgresSecret,
} from './postgres.js';
export {
  betterAuthPostgresSecret,
  createBetterAuthPostgresBindings,
  createBetterAuthPostgresBindingsFromEnvironment,
} from './postgres.js';
export type {
  BetterAuthSqliteBindings,
  BetterAuthSqliteBindingsOptions,
  BetterAuthSqliteEnvironmentBindingsOptions,
  BetterAuthSqliteDevelopmentSeed,
  BetterAuthSqliteSecret,
} from './sqlite.js';
export {
  betterAuthSqliteSecret,
  createBetterAuthSqliteBindings,
  createBetterAuthSqliteBindingsFromEnvironment,
} from './sqlite.js';
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
