import type { AccessDecision } from '@kovojs/server';
import type { CsrfOptions } from '@kovojs/server/security';
import type { Session, User } from 'better-auth';

import type { BetterAuthAppBindingsOptions, BetterAuthAppRequest } from '../app-bindings.js';
import type { BetterAuthSessionMapper } from '../session.js';
import {
  betterAuthFreezeOwn,
  betterAuthObjectKeys,
  betterAuthOwnDataOption,
} from './intrinsics.js';

const NativeTypeError = globalThis.TypeError;

/** @internal Snapshot the exact authority-free human binding options without invoking accessors. */
export function snapshotBetterAuthAppBindingsOptions<
  SessionValue extends { id: string },
  Request extends BetterAuthAppRequest<SessionValue>,
>(
  source: BetterAuthAppBindingsOptions<SessionValue, Request>,
  backend: 'Postgres' | 'SQLite',
): Readonly<BetterAuthAppBindingsOptions<SessionValue, Request>> {
  if (typeof source !== 'object' || source === null) {
    throw new NativeTypeError(`Better Auth ${backend} app binding options must be an object.`);
  }
  const csrf = requiredOption<CsrfOptions<Request>>(source, 'csrf', backend);
  const mapSession = requiredOption<BetterAuthSessionMapper<Session, User, SessionValue>>(
    source,
    'mapSession',
    backend,
  );
  const schema = requiredOption<Record<string, unknown>>(source, 'schema', backend);
  const signInAccess = requiredOption<AccessDecision>(source, 'signInAccess', backend);
  const keys = betterAuthObjectKeys(source, `Better Auth ${backend} app binding option names`);
  let csrfCount = 0;
  let mapSessionCount = 0;
  let schemaCount = 0;
  let signInAccessCount = 0;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === 'csrf') csrfCount += 1;
    else if (key === 'mapSession') mapSessionCount += 1;
    else if (key === 'schema') schemaCount += 1;
    else if (key === 'signInAccess') signInAccessCount += 1;
  }
  if (
    keys.length !== 4 ||
    csrfCount !== 1 ||
    mapSessionCount !== 1 ||
    schemaCount !== 1 ||
    signInAccessCount !== 1
  ) {
    throw new NativeTypeError(
      `Better Auth ${backend} app binding options accept exactly csrf, mapSession, schema, and signInAccess.`,
    );
  }
  return betterAuthFreezeOwn(
    { csrf, mapSession, schema, signInAccess },
    `Better Auth ${backend} app binding options`,
  );
}

function requiredOption<Value>(
  source: object,
  property: 'csrf' | 'mapSession' | 'schema' | 'signInAccess',
  backend: 'Postgres' | 'SQLite',
): Value {
  const value = betterAuthOwnDataOption<Value>(
    source,
    property,
    `Better Auth ${backend} app binding option ${property}`,
  );
  if (value === undefined) {
    throw new NativeTypeError(`Better Auth ${backend} app binding option ${property} is required.`);
  }
  return value;
}
