// Keep the shared bootstrap-order witness as this exported entry's first executable dependency.
import './internal/runtime-lock.js';

import { sqliteSystemDbForGeneratedIntegration } from '@kovojs/server/generated/db-capabilities';
import type { KovoSqliteAppRuntime } from '@kovojs/server/sqlite';

import type {
  BetterAuthAppBindings,
  BetterAuthAppBindingsOptions,
  BetterAuthAppRequest,
} from './app-bindings.js';
import { authed } from './guards.js';
import { snapshotBetterAuthAppBindingsOptions } from './internal/app-bindings-options.js';
import { createBetterAuthSqliteBindingsFromEnvironment } from './sqlite.js';

/**
 * Bind Better Auth to an exact framework-owned SQLite app runtime.
 *
 * Kovo recovers the purpose-closed system database capability internally, fixes principal
 * revocation and authenticated sign-out posture, consumes deployment secrets/base URL from the
 * boot-pinned environment, and returns only sanitized app bindings (SPEC §6.6/§10.3 C9).
 */
export function createBetterAuthSqliteAppBindings<
  SessionValue extends { id: string },
  Request extends BetterAuthAppRequest<SessionValue> = BetterAuthAppRequest<SessionValue>,
>(
  runtime: KovoSqliteAppRuntime,
  options: BetterAuthAppBindingsOptions<SessionValue, Request>,
): Readonly<BetterAuthAppBindings<SessionValue, Request>> {
  const systemDb = sqliteSystemDbForGeneratedIntegration(runtime, {
    operation: 'write',
    reason: 'Better Auth manages SQLite session tables before an app session exists',
    surface: '@kovojs/better-auth/sqlite#createBetterAuthSqliteAppBindings',
  });
  const snapshot = snapshotBetterAuthAppBindingsOptions(options, 'SQLite');
  return createBetterAuthSqliteBindingsFromEnvironment<
    Request,
    SessionValue,
    Request & { session: SessionValue }
  >({
    csrf: snapshot.csrf,
    mapSession: snapshot.mapSession,
    principalEpochStore: runtime.principalEpochStore,
    schema: snapshot.schema,
    signInAccess: snapshot.signInAccess,
    signOutAccess: [authed<Request>()],
    systemDb,
  });
}
