import { snapshotSqliteSchemaRecord } from '@kovojs/server/internal/sqlite';
import { useSqliteSystemDb } from '@kovojs/server/internal/sqlite-capability';
import type { AccessDecision, CsrfOptions, SessionProvider } from '@kovojs/server';
import type { KovoSqliteSystemDb } from '@kovojs/server/sqlite';
import { betterAuth, type Session, type User } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import type { BetterAuthRequestLike } from './internal.js';
import {
  betterAuthEnvironmentIsProduction,
  resolveBetterAuthEnvironment,
  validateBetterAuthBaseUrl,
} from './environment.js';
import {
  betterAuthFreezeOwn,
  betterAuthOwnDataOption,
  betterAuthUrlProtocol,
} from './internal/intrinsics.js';
import {
  callBetterAuthSignUpEmail,
  pinBetterAuthSignUpEmail,
} from './internal/trusted-plaintext.js';
import { betterAuthSignInEmailMutation, betterAuthSignOutMutation } from './mutations.js';
import { betterAuthSession, type BetterAuthSessionMapper } from './session.js';

const NativeHeaders = globalThis.Headers;
const NativeTypeError = globalThis.TypeError;
const betterAuthSqliteSecretMinimumLength = 32;

declare const betterAuthSqliteSecretBrand: unique symbol;

/** Better Auth signing material that cleared Kovo's 32-character SQLite binding floor. */
export type BetterAuthSqliteSecret = string & {
  readonly [betterAuthSqliteSecretBrand]: 'better-auth-sqlite-secret';
};

/** Validate signing material before it can reach the Better Auth SQLite constructor. */
export function betterAuthSqliteSecret(value: string): BetterAuthSqliteSecret {
  if (typeof value !== 'string' || value.length < betterAuthSqliteSecretMinimumLength) {
    throw new NativeTypeError(
      `Better Auth SQLite secret must be a string of at least ${betterAuthSqliteSecretMinimumLength} characters (SPEC §6.6).`,
    );
  }
  return value as BetterAuthSqliteSecret;
}

/** A fixed development-only account that the SQLite binding may create. */
export interface BetterAuthSqliteDevelopmentSeed {
  /** Email address for the local development account. */
  email: string;
  /** Display name for the local development account. */
  name: string;
  /** Password for the local account; absent/null disables seeding. */
  password?: string | null;
}

/** Options for the framework-owned Better Auth/SQLite construction boundary. */
export interface BetterAuthSqliteBindingsOptions<
  Request extends BetterAuthRequestLike,
  SessionValue,
> {
  /** Absolute Better Auth base URL for this local app. */
  baseURL: string;
  /** Kovo CSRF configuration shared by generated credential mutations. */
  csrf: CsrfOptions<Request>;
  /** Optional fixed local account; ignored when `NODE_ENV=production`. */
  developmentSeed?: BetterAuthSqliteDevelopmentSeed;
  /** Sanitized projection from Better Auth's credential-free session/user records. */
  mapSession: BetterAuthSessionMapper<Session, User, SessionValue>;
  /** Exact Better Auth Drizzle table record from the app's SQLite schema. */
  schema: Record<string, unknown>;
  /** Better Auth signing secret. */
  secret: BetterAuthSqliteSecret;
  /** Explicit pre-auth access decision for sign-in. */
  signInAccess: AccessDecision;
  /** Explicit authenticated access decision for sign-out. */
  signOutAccess: AccessDecision;
  /** Opaque framework-minted capability; no raw client is structurally reachable from it. */
  systemDb: KovoSqliteSystemDb;
}

/** Generated-app binding options whose secrets/URL/demo seed come from boot-pinned operator env. */
export type BetterAuthSqliteEnvironmentBindingsOptions<
  Request extends BetterAuthRequestLike,
  SessionValue,
> = Omit<
  BetterAuthSqliteBindingsOptions<Request, SessionValue>,
  'baseURL' | 'developmentSeed' | 'secret'
>;

/** Sanitized bindings produced by `createBetterAuthSqliteBindings`. */
export interface BetterAuthSqliteBindings<
  Request extends BetterAuthRequestLike,
  SessionValue,
  AuthenticatedRequest extends Request = Request,
> {
  /** Create the configured fixed development account, or do nothing when disabled/production. */
  seedDemoUser(): Promise<void>;
  /** Runtime-sanitized Better Auth session provider. */
  sessionProvider: SessionProvider<BetterAuthRequestLike, SessionValue>;
  /** CSRF-protected email/password sign-in mutation. */
  signIn: ReturnType<typeof betterAuthSignInEmailMutation<'auth/sign-in', Request, Request>>;
  /** CSRF-protected sign-out mutation. */
  signOut: ReturnType<
    typeof betterAuthSignOutMutation<'auth/sign-out', Request, AuthenticatedRequest>
  >;
}

/** Construct SQLite bindings without exposing raw operator environment values to generated code. */
export function createBetterAuthSqliteBindingsFromEnvironment<
  Request extends BetterAuthRequestLike,
  SessionValue,
  AuthenticatedRequest extends Request = Request,
>(
  options: BetterAuthSqliteEnvironmentBindingsOptions<Request, SessionValue>,
): Readonly<BetterAuthSqliteBindings<Request, SessionValue, AuthenticatedRequest>> {
  if (typeof options !== 'object' || options === null) {
    throw new NativeTypeError('Better Auth SQLite environment binding options must be an object.');
  }
  const environment = resolveBetterAuthEnvironment();
  return createBetterAuthSqliteBindings<Request, SessionValue, AuthenticatedRequest>({
    baseURL: environment.baseURL,
    csrf: requiredOption<CsrfOptions<Request>>(options, 'csrf'),
    ...(environment.developmentSeed === undefined
      ? {}
      : { developmentSeed: environment.developmentSeed }),
    mapSession: requiredOption<BetterAuthSessionMapper<Session, User, SessionValue>>(
      options,
      'mapSession',
    ),
    schema: requiredOption<Record<string, unknown>>(options, 'schema'),
    secret: betterAuthSqliteSecret(environment.secret),
    signInAccess: requiredOption<AccessDecision>(options, 'signInAccess'),
    signOutAccess: requiredOption<AccessDecision>(options, 'signOutAccess'),
    systemDb: requiredOption<KovoSqliteSystemDb>(options, 'systemDb'),
  });
}

/**
 * Construct Better Auth's SQLite adapter behind the package-internal raw-capability consumer.
 *
 * The public result is a frozen record of sanitized Kovo bindings. The raw Drizzle/native client,
 * Better Auth instance, and capability consumer never cross this function's boundary (SPEC
 * §6.6/§10.3 C9).
 */
export function createBetterAuthSqliteBindings<
  Request extends BetterAuthRequestLike,
  SessionValue,
  AuthenticatedRequest extends Request = Request,
>(
  options: BetterAuthSqliteBindingsOptions<Request, SessionValue>,
): Readonly<BetterAuthSqliteBindings<Request, SessionValue, AuthenticatedRequest>> {
  if (typeof options !== 'object' || options === null) {
    throw new NativeTypeError('Better Auth SQLite binding options must be an object.');
  }

  const baseURL = validateBetterAuthBaseUrl(
    requiredTextOption(options, 'baseURL'),
    betterAuthEnvironmentIsProduction(),
  );
  const csrf = requiredOption<CsrfOptions<Request>>(options, 'csrf');
  const mapSession = requiredOption<BetterAuthSessionMapper<Session, User, SessionValue>>(
    options,
    'mapSession',
  );
  if (typeof mapSession !== 'function') {
    throw new NativeTypeError('Better Auth SQLite binding mapSession must be a function.');
  }
  const schema = requiredOption<Record<string, unknown>>(options, 'schema');
  if (typeof schema !== 'object' || schema === null) {
    throw new NativeTypeError('Better Auth SQLite binding schema must be an object.');
  }
  const pinnedSchema = snapshotSqliteSchemaRecord(schema);
  const secret = betterAuthSqliteSecret(requiredTextOption(options, 'secret'));
  const signInAccess = requiredOption<AccessDecision>(options, 'signInAccess');
  const signOutAccess = requiredOption<AccessDecision>(options, 'signOutAccess');
  const systemDb = requiredOption<KovoSqliteSystemDb>(options, 'systemDb');
  const developmentSeed = snapshotDevelopmentSeed(
    betterAuthOwnDataOption<BetterAuthSqliteDevelopmentSeed>(
      options,
      'developmentSeed',
      'Better Auth SQLite binding option developmentSeed',
    ),
  );

  const database = useSqliteSystemDb(systemDb, (db) =>
    drizzleAdapter(db, { provider: 'sqlite', schema: pinnedSchema }),
  );
  const auth = betterAuth({
    // The raw Better Auth router is unreachable. Kovo's fixed credential wrappers own the
    // request-origin floor and never forward callback URLs (SPEC §6.6/§10.3 C9), so ambient
    // Better Auth trusted-origin configuration must not become a second, widenable authority.
    advanced: {
      disableCSRFCheck: true,
      disableOriginCheck: true,
      useSecureCookies: betterAuthUrlProtocol(baseURL) === 'https:',
    },
    baseURL,
    database,
    // Seeding provisions a credential only. A session must require the explicit, CSRF-protected
    // sign-in mutation rather than being created as a side effect of server boot (SPEC §6.6).
    emailAndPassword: { autoSignIn: false, enabled: true },
    secret,
    secrets: [{ version: 0, value: secret }],
    trustedOrigins: [],
  });
  const sessionProvider = betterAuthSession<Session, User, SessionValue>(auth, mapSession);
  const signIn = betterAuthSignInEmailMutation<'auth/sign-in', Request>(auth, {
    access: signInAccess,
    csrf,
    defaultRedirectTo: '/',
  });
  const signOut = betterAuthSignOutMutation<'auth/sign-out', Request, AuthenticatedRequest>(auth, {
    access: signOutAccess,
    csrf,
    defaultRedirectTo: '/login',
  });
  const seedAuth = developmentSeed === undefined ? undefined : pinBetterAuthSignUpEmail(auth);

  async function seedDemoUser(): Promise<void> {
    if (
      betterAuthEnvironmentIsProduction() ||
      developmentSeed === undefined ||
      seedAuth === undefined
    ) {
      return;
    }
    try {
      await callBetterAuthSignUpEmail(
        seedAuth,
        {
          email: developmentSeed.email,
          name: developmentSeed.name,
          password: developmentSeed.password,
        },
        new NativeHeaders(),
      );
    } catch {
      // The configured fixed local account already exists or is not seedable.
    }
  }

  return betterAuthFreezeOwn(
    { seedDemoUser, sessionProvider, signIn, signOut },
    'Better Auth SQLite bindings',
  );
}

function requiredOption<Value>(
  options: object,
  property: keyof BetterAuthSqliteBindingsOptions<BetterAuthRequestLike, unknown>,
): Value {
  const value = betterAuthOwnDataOption<Value>(
    options,
    property,
    `Better Auth SQLite binding option ${property}`,
  );
  if (value === undefined) {
    throw new NativeTypeError(`Better Auth SQLite binding option ${property} is required.`);
  }
  return value;
}

function requiredTextOption(options: object, property: 'baseURL' | 'secret'): string {
  const value = requiredOption<string>(options, property);
  if (typeof value !== 'string' || value.length === 0) {
    throw new NativeTypeError(`Better Auth SQLite binding option ${property} must not be empty.`);
  }
  return value;
}

function snapshotDevelopmentSeed(
  value: BetterAuthSqliteDevelopmentSeed | undefined,
): Readonly<{ email: string; name: string; password: string }> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) {
    throw new NativeTypeError('Better Auth SQLite binding developmentSeed must be an object.');
  }
  const email = requiredSeedText(value, 'email');
  const name = requiredSeedText(value, 'name');
  const password = betterAuthOwnDataOption<string | null>(
    value,
    'password',
    'Better Auth SQLite binding developmentSeed.password',
  );
  if (password === undefined || password === null) return undefined;
  if (typeof password !== 'string') {
    throw new NativeTypeError(
      'Better Auth SQLite binding developmentSeed.password must be a string when present.',
    );
  }
  if (password.length === 0) return undefined;
  return betterAuthFreezeOwn(
    { email, name, password },
    'Better Auth SQLite binding development seed',
  );
}

function requiredSeedText(value: object, property: 'email' | 'name'): string {
  const field = betterAuthOwnDataOption<string>(
    value,
    property,
    `Better Auth SQLite binding developmentSeed.${property}`,
  );
  if (typeof field !== 'string' || field.length === 0) {
    throw new NativeTypeError(
      `Better Auth SQLite binding developmentSeed.${property} must be a non-empty string.`,
    );
  }
  return field;
}
