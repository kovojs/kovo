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
export { mount } from './mount.js';
export type { BetterAuthMountAdapter } from './mount-adapter.js';
export type { BetterAuthBindingRequest, BetterAuthCredentialMutationValue } from './internal.js';
export type {
  BetterAuthSafeField,
  BetterAuthSanitizedRecord,
  BetterAuthSanitizedSessionPayload,
  BetterAuthSanitizedValue,
  BetterAuthSessionMapper,
} from './session.js';
