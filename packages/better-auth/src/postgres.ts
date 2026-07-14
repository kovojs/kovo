import {
  postgresSchemaModule,
  usePostgresSystemDb,
  type AccessDecision,
  type CsrfOptions,
  type KovoPostgresSystemDb,
  type SessionProvider,
} from '@kovojs/server';
import { betterAuth, type Session, type User } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import type { BetterAuthRequestLike } from './internal.js';
import { betterAuthFreezeOwn, betterAuthOwnDataOption } from './internal/intrinsics.js';
import {
  callBetterAuthSignUpEmail,
  pinBetterAuthSignUpEmail,
} from './internal/trusted-plaintext.js';
import { betterAuthSignInEmailMutation, betterAuthSignOutMutation } from './mutations.js';
import { betterAuthSession, type BetterAuthSessionMapper } from './session.js';

const NativeHeaders = globalThis.Headers;
const NativeTypeError = globalThis.TypeError;
// SPEC §2/§6.6: production posture is a boot fact. App-authored modules must not be able to
// rewrite process.env after framework initialization and re-enable a fixed development principal.
const betterAuthPostgresProduction = process.env.NODE_ENV === 'production';
const betterAuthPostgresSecretMinimumLength = 32;

declare const betterAuthPostgresSecretBrand: unique symbol;

/**
 * Better Auth signing material that cleared Kovo's non-empty 32-character security floor.
 *
 * The brand is an author-time guardrail. `createBetterAuthPostgresBindings` repeats the runtime
 * validation, so a cast or value crossing an untyped boundary cannot bypass the sink (SPEC §6.6).
 */
export type BetterAuthPostgresSecret = string & {
  readonly [betterAuthPostgresSecretBrand]: 'better-auth-postgres-secret';
};

/**
 * Validate signing material before it can reach Better Auth's Postgres constructor.
 *
 * Generate a high-entropy value with `crypto.randomBytes(32).toString('base64url')`; this
 * constructor enforces the same 32-character absolute floor as Kovo's app signing-secret gate.
 */
export function betterAuthPostgresSecret(value: string): BetterAuthPostgresSecret {
  if (typeof value !== 'string' || value.length < betterAuthPostgresSecretMinimumLength) {
    throw new NativeTypeError(
      `Better Auth Postgres secret must be a string of at least ${betterAuthPostgresSecretMinimumLength} characters (SPEC §6.6).`,
    );
  }
  return value as BetterAuthPostgresSecret;
}

/** A fixed development-only account that the Postgres binding may create after database boot. */
export interface BetterAuthDevelopmentSeed {
  /** Email address for the local development account. */
  email: string;
  /** Display name for the local development account. */
  name: string;
  /** Password for the local development account. An absent value disables seeding. */
  password?: string | null;
}

/**
 * Options for the framework-owned Better Auth/Postgres construction boundary.
 *
 * The database input is an opaque system capability rather than a Drizzle handle. The constructor
 * consumes it internally, snapshots the schema/options it retains, and returns only sanitized Kovo
 * session and credential-mutation bindings (SPEC §6.6 and §10.3 capability ownership/C9).
 */
export interface BetterAuthPostgresBindingsOptions<
  Request extends BetterAuthRequestLike,
  SessionValue,
> {
  /** Absolute Better Auth base URL for this deployment. */
  baseURL: string;
  /** Kovo CSRF configuration shared by the generated credential mutations. */
  csrf: CsrfOptions<Request>;
  /** Optional fixed local account; ignored when `NODE_ENV=production`. */
  developmentSeed?: BetterAuthDevelopmentSeed;
  /** Sanitized projection from Better Auth's credential-free session/user records. */
  mapSession: BetterAuthSessionMapper<Session, User, SessionValue>;
  /** Exact Better Auth Drizzle table record from the app's pinned Postgres schema. */
  schema: Record<string, unknown>;
  /** Better Auth signing secret. */
  secret: BetterAuthPostgresSecret;
  /** Explicit pre-auth access decision for the sign-in mutation. */
  signInAccess: AccessDecision;
  /** Explicit authenticated access decision for the sign-out mutation. */
  signOutAccess: AccessDecision;
  /** Opaque framework-minted database capability consumed only by this constructor. */
  systemDb: KovoPostgresSystemDb;
}

/**
 * Sanitized bindings produced by `createBetterAuthPostgresBindings`.
 *
 * The raw Better Auth instance, Drizzle adapter, and system database never appear on this object.
 */
export interface BetterAuthPostgresBindings<
  Request extends BetterAuthRequestLike,
  SessionValue,
  AuthenticatedRequest extends Request = Request,
> {
  /** Create the configured fixed development account, or do nothing when disabled/production. */
  seedDemoUser(): Promise<void>;
  /** Runtime-sanitized Better Auth session provider for `session(schema).provider(...)`. */
  sessionProvider: SessionProvider<BetterAuthRequestLike, SessionValue>;
  /** CSRF-protected Better Auth email/password sign-in mutation. */
  signIn: ReturnType<typeof betterAuthSignInEmailMutation<'auth/sign-in', Request, Request>>;
  /** CSRF-protected Better Auth sign-out mutation. */
  signOut: ReturnType<
    typeof betterAuthSignOutMutation<'auth/sign-out', Request, AuthenticatedRequest>
  >;
}

/**
 * Construct the Better Auth/Postgres adapter behind one framework-owned capability door.
 *
 * Only the opaque `KovoPostgresSystemDb` capability crosses generated app source. The raw Drizzle
 * database is revealed inside this package just long enough to construct Better Auth's adapter;
 * the returned frozen record contains only a sanitized session provider, Kovo credential
 * mutations, and a fixed development seed operation (SPEC §6.6 and §10.3 C9).
 */
export function createBetterAuthPostgresBindings<
  Request extends BetterAuthRequestLike,
  SessionValue,
  AuthenticatedRequest extends Request = Request,
>(
  options: BetterAuthPostgresBindingsOptions<Request, SessionValue>,
): Readonly<BetterAuthPostgresBindings<Request, SessionValue, AuthenticatedRequest>> {
  if (typeof options !== 'object' || options === null) {
    throw new NativeTypeError('Better Auth Postgres binding options must be an object.');
  }

  const baseURL = requiredTextOption(options, 'baseURL');
  const csrf = requiredOption<CsrfOptions<Request>>(options, 'csrf');
  const mapSession = requiredOption<BetterAuthSessionMapper<Session, User, SessionValue>>(
    options,
    'mapSession',
  );
  if (typeof mapSession !== 'function') {
    throw new NativeTypeError('Better Auth Postgres binding mapSession must be a function.');
  }
  const schema = requiredOption<Record<string, unknown>>(options, 'schema');
  if (typeof schema !== 'object' || schema === null) {
    throw new NativeTypeError('Better Auth Postgres binding schema must be an object.');
  }
  const pinnedSchema = postgresSchemaModule(schema);
  const secret = betterAuthPostgresSecret(requiredTextOption(options, 'secret'));
  const signInAccess = requiredOption<AccessDecision>(options, 'signInAccess');
  const signOutAccess = requiredOption<AccessDecision>(options, 'signOutAccess');
  const systemDb = requiredOption<KovoPostgresSystemDb>(options, 'systemDb');
  const developmentSeed = snapshotDevelopmentSeed(
    betterAuthOwnDataOption<BetterAuthDevelopmentSeed>(
      options,
      'developmentSeed',
      'Better Auth Postgres binding option developmentSeed',
    ),
  );

  const database = usePostgresSystemDb(systemDb, (db) =>
    drizzleAdapter(db, { provider: 'pg', schema: pinnedSchema }),
  );
  const auth = betterAuth({
    advanced: { disableCSRFCheck: true },
    baseURL,
    database,
    emailAndPassword: { enabled: true },
    secret,
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
    if (betterAuthPostgresProduction || developmentSeed === undefined || seedAuth === undefined) {
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
      // The configured fixed account already exists or the local database is not seedable.
    }
  }

  return betterAuthFreezeOwn(
    { seedDemoUser, sessionProvider, signIn, signOut },
    'Better Auth Postgres bindings',
  );
}

function requiredOption<Value>(
  options: object,
  property: keyof BetterAuthPostgresBindingsOptions<BetterAuthRequestLike, unknown>,
): Value {
  const value = betterAuthOwnDataOption<Value>(
    options,
    property,
    `Better Auth Postgres binding option ${property}`,
  );
  if (value === undefined) {
    throw new NativeTypeError(`Better Auth Postgres binding option ${property} is required.`);
  }
  return value;
}

function requiredTextOption(options: object, property: 'baseURL' | 'secret'): string {
  const value = requiredOption<string>(options, property);
  if (typeof value !== 'string' || value.length === 0) {
    throw new NativeTypeError(`Better Auth Postgres binding option ${property} must not be empty.`);
  }
  return value;
}

function snapshotDevelopmentSeed(
  value: BetterAuthDevelopmentSeed | undefined,
): Readonly<{ email: string; name: string; password: string }> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) {
    throw new NativeTypeError('Better Auth Postgres binding developmentSeed must be an object.');
  }
  const email = requiredSeedText(value, 'email');
  const name = requiredSeedText(value, 'name');
  const password = betterAuthOwnDataOption<string | null>(
    value,
    'password',
    'Better Auth Postgres binding developmentSeed.password',
  );
  if (password === undefined || password === null) return undefined;
  if (typeof password !== 'string') {
    throw new NativeTypeError(
      'Better Auth Postgres binding developmentSeed.password must be a string when present.',
    );
  }
  if (password.length === 0) return undefined;
  return betterAuthFreezeOwn(
    { email, name, password },
    'Better Auth Postgres binding development seed',
  );
}

function requiredSeedText(value: object, property: 'email' | 'name'): string {
  const field = betterAuthOwnDataOption<string>(
    value,
    property,
    `Better Auth Postgres binding developmentSeed.${property}`,
  );
  if (typeof field !== 'string' || field.length === 0) {
    throw new NativeTypeError(
      `Better Auth Postgres binding developmentSeed.${property} must be a non-empty string.`,
    );
  }
  return field;
}
