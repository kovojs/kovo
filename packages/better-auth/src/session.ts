import type { SessionProvider, SessionProviderResult } from '@kovojs/server';

import {
  getBetterAuthSetCookie,
  isBetterAuthCredentialShapedColumn,
  type BetterAuthGetSessionWithHeadersResult,
  type BetterAuthLike,
  type BetterAuthBindingRequest,
} from './internal.js';
import { callBetterAuthGetSession, pinBetterAuthGetSession } from './internal/trusted-plaintext.js';
import {
  betterAuthArrayAppend,
  betterAuthArrayIsArray,
  betterAuthCloneDate,
  betterAuthCreateMap,
  betterAuthCreateNullRecord,
  betterAuthDefineOwnData,
  betterAuthGetOwnPropertyDescriptor,
  betterAuthMapGet,
  betterAuthMapHas,
  betterAuthMapSet,
  betterAuthObjectKeys,
  betterAuthOwnDataValue,
  betterAuthSnapshotDenseArray,
} from './internal/intrinsics.js';
import { assertBetterAuthRequestSecretPath } from './internal/non-egress-proof.js';

const NativeError = Error;
const betterAuthSessionBoundaryFailureMessage =
  'Better Auth session provider failed inside the trusted plaintext boundary.';
const betterAuthSanitizationInProgress = {};
const betterAuthMaximumSanitizedDepth = 128;

/**
 * The `{ session, user }` pair Better Auth returns for an authenticated request. The
 * adapter maps this into the app's own session value via a `BetterAuthSessionMapper`;
 * see SPEC.md §6.5 for how sessions flow into the request.
 */
export interface BetterAuthSessionPayload<Session, User> {
  session: Session;
  user: User;
}

/**
 * Author-time field-key filter used by Better Auth's sanitized session projection. Credential
 * nouns are omitted when they are the whole key, a snake/kebab suffix, or a camel-case suffix.
 * Runtime recursive reconstruction remains the confidentiality proof (SPEC §10.3 C9-C10).
 */
export type BetterAuthSafeField<Key> = Key extends string
  ? Lowercase<Key> extends
      | 'apikey'
      | 'apisecret'
      | 'backupcode'
      | 'backupcodes'
      | 'certificate'
      | 'code'
      | 'codes'
      | 'credential'
      | 'credentials'
      | 'hash'
      | 'key'
      | 'keys'
      | 'otp'
      | 'passcode'
      | 'passphrase'
      | 'password'
      | 'pin'
      | 'privatekey'
      | 'salt'
      | 'secret'
      | 'secrets'
      | 'seed'
      | 'signature'
      | 'token'
      | 'tokens'
    ? never
    : Key extends
          | `${string}${
              | 'ApiKey'
              | 'ApiSecret'
              | 'BackupCode'
              | 'BackupCodes'
              | 'Certificate'
              | 'Code'
              | 'Codes'
              | 'Credential'
              | 'Credentials'
              | 'Hash'
              | 'Key'
              | 'Keys'
              | 'Otp'
              | 'Passcode'
              | 'Passphrase'
              | 'Password'
              | 'Pin'
              | 'PrivateKey'
              | 'Salt'
              | 'Secret'
              | 'Secrets'
              | 'Seed'
              | 'Signature'
              | 'Token'
              | 'Tokens'}`
          | `${string}${'_' | '-'}${
              | 'apikey'
              | 'apisecret'
              | 'backupcode'
              | 'backupcodes'
              | 'certificate'
              | 'code'
              | 'codes'
              | 'credential'
              | 'credentials'
              | 'hash'
              | 'key'
              | 'keys'
              | 'otp'
              | 'passcode'
              | 'passphrase'
              | 'password'
              | 'pin'
              | 'privatekey'
              | 'salt'
              | 'secret'
              | 'secrets'
              | 'seed'
              | 'signature'
              | 'token'
              | 'tokens'}`
      ? never
      : Key
  : Key;

/**
 * A recursively reconstructed Better Auth value. JSON objects lose credential-shaped fields,
 * arrays and dates are copied, and scalar values are preserved.
 */
export type BetterAuthSanitizedValue<Value> = Value extends Date
  ? Date
  : Value extends readonly unknown[]
    ? { [Index in keyof Value]: BetterAuthSanitizedValue<Value[Index]> }
    : Value extends object
      ? BetterAuthSanitizedRecord<Value>
      : Value;

/**
 * A Better Auth row after Kovo removes credential-shaped fields before app code sees it. The
 * mapped type is author-time defense-in-depth; recursive runtime reconstruction owns enforcement
 * (SPEC §10.3 C9 and AGENTS.md's type-level security ergonomics rule).
 */
export type BetterAuthSanitizedRecord<Value> = Value extends object
  ? {
      [Key in keyof Value as BetterAuthSafeField<Key>]: BetterAuthSanitizedValue<Value[Key]>;
    }
  : Value;

/**
 * The reconstructed `{ session, user }` projection delivered to an app-authored session mapper.
 * Better Auth bearer tokens, password hashes, API keys, and similarly credential-shaped fields
 * are absent at runtime and omitted from the common TypeScript field vocabulary.
 */
export interface BetterAuthSanitizedSessionPayload<Session, User> {
  session: BetterAuthSanitizedRecord<Session>;
  user: BetterAuthSanitizedRecord<User>;
}

/**
 * Function the app supplies to a fixed SQLite/Postgres binding constructor to project Better
 * Auth's `{ session, user }` payload into the app's own session value. Called once per authenticated
 * request (SPEC §6.5/§6.6).
 */
export type BetterAuthSessionMapper<AuthSession, AuthUser, SessionValue> = (
  value: BetterAuthSanitizedSessionPayload<AuthSession, AuthUser>,
) => SessionValue;

/**
 * @internal Build the fixed binding's Kovo `SessionProvider`. This function is deliberately absent
 * from package exports; the exact `auth` object must already be privately registered by the
 * SQLite/Postgres constructor (SPEC §6.6).
 *
 * It calls
 * `auth.api.getSession({ headers, returnHeaders: true })` for each request and projects the
 * result through `map` into the app's session value, returning `null` when there is no
 * session. Wire the returned provider into `session(...)` so guards and pages see the
 * authenticated user (SPEC.md §6.5).
 *
 * part-3 I2 (SPEC.md §6.5, §9.1.1:854): Better Auth writes fresh session-refresh /
 * cookie-cache `Set-Cookie` headers on every authenticated request once rolling sessions
 * (`updateAge`) or `cookieCache` are enabled (the default for the former). Reading only the
 * payload — as the prior implementation did — silently dropped those headers, so a
 * continuously-active user was hard-logged-out at the original session boundary and the
 * cookie cache never populated. The provider now requests the response headers
 * (`returnHeaders: true`) and forwards every refresh `Set-Cookie` through the additive
 * `SessionProviderResult.setCookies` channel so the framework re-emits them on the GET
 * response. The provider still resolves to a plain mapped value when there are no refresh
 * cookies.
 */
export function betterAuthSession<
  AuthSession,
  AuthUser,
  SessionValue,
  Request extends BetterAuthBindingRequest = BetterAuthBindingRequest,
>(
  auth: BetterAuthLike<AuthSession, AuthUser>,
  map: BetterAuthSessionMapper<AuthSession, AuthUser, SessionValue>,
): SessionProvider<Request, SessionValue> {
  const pinnedAuth = pinBetterAuthGetSession(auth);
  return async (request): Promise<SessionProviderResult<SessionValue> | SessionValue | null> => {
    let result:
      | BetterAuthGetSessionWithHeadersResult<AuthSession, AuthUser>
      | BetterAuthSessionPayload<AuthSession, AuthUser>
      | null
      | undefined;
    try {
      result = await callBetterAuthGetSession(pinnedAuth, request);
    } catch {
      throw new NativeError(betterAuthSessionBoundaryFailureMessage);
    }

    try {
      // BACKWARD-COMPAT shape detection: an instance that honors `returnHeaders` returns the
      // `{ response, headers }` envelope; one that ignores it returns the bare session payload.
      // Bind every deferred descriptor/header operation inside the same opaque-error boundary as
      // the provider call: structural shims can otherwise throw cookie-bearing errors later.
      const responseDescriptor =
        result !== null && typeof result === 'object'
          ? betterAuthGetOwnPropertyDescriptor(result, 'response')
          : undefined;
      const headersDescriptor =
        result !== null && typeof result === 'object'
          ? betterAuthGetOwnPropertyDescriptor(result, 'headers')
          : undefined;
      const isEnvelope =
        responseDescriptor !== undefined &&
        'value' in responseDescriptor &&
        headersDescriptor !== undefined &&
        'value' in headersDescriptor;
      const payload = isEnvelope
        ? (responseDescriptor.value as
            | BetterAuthSessionPayload<AuthSession, AuthUser>
            | null
            | undefined)
        : (result as BetterAuthSessionPayload<AuthSession, AuthUser> | null | undefined);
      const value = payload ? map(sanitizeBetterAuthSessionPayload(payload)) : null;
      const headers = isEnvelope ? (headersDescriptor.value as Headers) : undefined;
      const setCookies = getBetterAuthSetCookie(headers);

      // Forward refresh/cookie-cache Set-Cookie headers only when the instance actually
      // produced them; otherwise resolve to the plain mapped value so the contract is fully
      // backward compatible (no envelope unless there is something to forward).
      return setCookies.length > 0 ? { setCookies, value } : value;
    } catch {
      throw new NativeError(betterAuthSessionBoundaryFailureMessage);
    }
  };
}

function sanitizeBetterAuthSessionPayload<AuthSession, AuthUser>(
  payload: BetterAuthSessionPayload<AuthSession, AuthUser>,
): BetterAuthSanitizedSessionPayload<AuthSession, AuthUser> {
  // Better Auth's core session row includes the live bearer `token`. The app mapper is not one
  // of the trusted plaintext sinks: reconstruct both rows and omit every credential-shaped field
  // through the same positive classifier used by schema confidentiality (SPEC §10.1/§10.3 C9-C10).
  assertBetterAuthRequestSecretPath('better-auth.get-session.response-secret-projection');
  if (typeof payload !== 'object' || payload === null || betterAuthArrayIsArray(payload)) {
    throw new TypeError('Better Auth session payload must be an object.');
  }
  const session = betterAuthOwnDataValue(payload, 'session', 'Better Auth session payload');
  const user = betterAuthOwnDataValue(payload, 'user', 'Better Auth session payload');
  const copies = betterAuthCreateMap<object, unknown>();
  return {
    session: sanitizeBetterAuthRow<AuthSession>(session, 'Better Auth session row', copies),
    user: sanitizeBetterAuthRow<AuthUser>(user, 'Better Auth user row', copies),
  };
}

function sanitizeBetterAuthRow<Value>(
  source: unknown,
  label: string,
  copies: Map<object, unknown>,
): BetterAuthSanitizedRecord<Value> {
  if (typeof source !== 'object' || source === null || betterAuthArrayIsArray(source)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return sanitizeBetterAuthValue(source, label, copies) as BetterAuthSanitizedRecord<Value>;
}

function sanitizeBetterAuthValue<Value>(
  source: Value,
  label: string,
  copies: Map<object, unknown>,
  depth = 0,
): BetterAuthSanitizedValue<Value> {
  if (depth > betterAuthMaximumSanitizedDepth) {
    throw new TypeError(`${label} exceeds the Better Auth session value depth limit.`);
  }
  if (source === null) return source as BetterAuthSanitizedValue<Value>;
  const sourceType = typeof source;
  if (
    sourceType === 'string' ||
    sourceType === 'number' ||
    sourceType === 'boolean' ||
    sourceType === 'bigint' ||
    sourceType === 'undefined'
  ) {
    return source as BetterAuthSanitizedValue<Value>;
  }
  if (sourceType !== 'object') {
    throw new TypeError(`${label} contains an unsupported value.`);
  }

  const objectSource = source as object;
  if (betterAuthMapHas(copies, objectSource)) {
    const existing = betterAuthMapGet(copies, objectSource);
    if (existing === betterAuthSanitizationInProgress) {
      throw new TypeError(`${label} contains a cyclic value.`);
    }
    return existing as BetterAuthSanitizedValue<Value>;
  }
  const date = betterAuthCloneDate(objectSource);
  if (date !== undefined) {
    betterAuthMapSet(copies, objectSource, date);
    return date as BetterAuthSanitizedValue<Value>;
  }
  if (betterAuthArrayIsArray(objectSource)) {
    const values = betterAuthSnapshotDenseArray(objectSource, label);
    const snapshot: unknown[] = [];
    betterAuthMapSet(copies, objectSource, betterAuthSanitizationInProgress);
    for (let index = 0; index < values.length; index += 1) {
      betterAuthArrayAppend(
        snapshot,
        sanitizeBetterAuthValue(values[index], `${label}[${index}]`, copies, depth + 1),
        label,
      );
    }
    betterAuthMapSet(copies, objectSource, snapshot);
    return snapshot as BetterAuthSanitizedValue<Value>;
  }

  const snapshot = betterAuthCreateNullRecord<unknown>();
  betterAuthMapSet(copies, objectSource, betterAuthSanitizationInProgress);
  const fields = betterAuthObjectKeys(objectSource, `${label} fields`);
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    if (isBetterAuthCredentialShapedColumn(field)) continue;
    betterAuthDefineOwnData(
      snapshot,
      field,
      sanitizeBetterAuthValue(
        betterAuthOwnDataValue(objectSource, field, label),
        `${label}.${field}`,
        copies,
        depth + 1,
      ),
      label,
    );
  }
  betterAuthMapSet(copies, objectSource, snapshot);
  return snapshot as BetterAuthSanitizedValue<Value>;
}
