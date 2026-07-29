import {
  authed,
  type BetterAuthBindingRequest as GeneratedRequest,
  type BetterAuthDevelopmentSeed,
  createBetterAuthPostgresBindingsFromEnvironment,
  createBetterAuthSqliteBindingsFromEnvironment as createSqlite,
} from '@kovojs/better-auth';

export {
  type BetterAuthPostgresBindings,
  type BetterAuthSqliteBindings,
} from '@kovojs/better-auth';

export { authed, createBetterAuthPostgresBindingsFromEnvironment, createSqlite };
export type { BetterAuthDevelopmentSeed, GeneratedRequest };
