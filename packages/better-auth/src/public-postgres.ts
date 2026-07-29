// Keep the shared bootstrap-order witness as this exported entry's first executable dependency.
import './internal/runtime-lock.js';

import { postgresSystemDbForGeneratedIntegration } from '@kovojs/server/generated/db-capabilities';
import type { KovoPostgresAppRuntimeDb } from '@kovojs/server/postgres';

import type {
  BetterAuthAppBindings,
  BetterAuthAppBindingsOptions,
  BetterAuthAppRequest,
} from './app-bindings.js';
import { authed } from './guards.js';
import { snapshotBetterAuthAppBindingsOptions } from './internal/app-bindings-options.js';
import { createBetterAuthPostgresBindingsFromEnvironment } from './postgres.js';

/**
 * Bind Better Auth to an exact framework-owned Postgres app runtime.
 *
 * Kovo mints the purpose-closed system database capability internally, fixes persistent principal
 * revocation and authenticated sign-out posture, consumes deployment secrets/base URL from the
 * boot-pinned environment, and returns only sanitized app bindings (SPEC §6.6/§10.3 C9).
 */
export function createBetterAuthPostgresAppBindings<
  SessionValue extends { id: string },
  Request extends BetterAuthAppRequest<SessionValue> = BetterAuthAppRequest<SessionValue>,
>(
  runtime: KovoPostgresAppRuntimeDb,
  options: BetterAuthAppBindingsOptions<SessionValue, Request>,
): Readonly<BetterAuthAppBindings<SessionValue, Request>> {
  const systemDb = postgresSystemDbForGeneratedIntegration(runtime, {
    operation: 'write',
    reason: 'Better Auth manages Postgres session tables before an app session exists',
    surface: '@kovojs/better-auth/postgres#createBetterAuthPostgresAppBindings',
  });
  const snapshot = snapshotBetterAuthAppBindingsOptions(options, 'Postgres');
  return createBetterAuthPostgresBindingsFromEnvironment<
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
