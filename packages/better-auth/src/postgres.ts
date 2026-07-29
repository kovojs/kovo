import { type AccessDecision, type SessionProvider } from '@kovojs/server';
import {
  usePostgresSystemDb,
  type KovoPostgresSystemDb,
} from '@kovojs/server/internal/postgres-capability';
import {
  initializePrincipalEpoch,
  type PrincipalEpochStore,
} from '@kovojs/server/principal-epochs';
import { postgresSchemaModule } from '@kovojs/server/postgres';
import type { CsrfOptions } from '@kovojs/server/security';
import { betterAuth, type Session, type User } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import type {
  BetterAuthBindings,
  BetterAuthBindingsOptions,
  BetterAuthDevelopmentSeed,
  BetterAuthEnvironmentBindingsOptions,
  BetterAuthGeneratedRequest,
} from './bindings-contract.js';
import {
  betterAuthEnvironmentIsProduction,
  resolveBetterAuthEnvironment,
  validateBetterAuthBaseUrl,
} from './environment.js';
import { betterAuthFixedCookieSecurity } from './internal/cookie-security.js';
import {
  betterAuthCredentialConsumers,
  consumeBetterAuthCredentialResult,
  runBetterAuthCredentialSourceCallable,
} from './internal/credential-runtime-gate.js';
import { betterAuthFreezeOwn, betterAuthOwnDataOption } from './internal/intrinsics.js';
import { betterAuthHashPassword, betterAuthVerifyPassword } from './internal/password.js';
import { createBetterAuthPostgresRateLimitStorage } from './internal/postgres-rate-limit-storage.js';
import { registerFixedBetterAuthCanonicalOrigin } from './internal/request-origin.js';
import { assertBetterAuthRuntimeRealmLocked } from './internal/runtime-lock.js';
import {
  callBetterAuthSignUpEmail,
  pinBetterAuthSignUpEmail,
} from './internal/trusted-plaintext.js';
import {
  betterAuthRequestPasswordResetMutation,
  betterAuthSignInEmailMutation,
  betterAuthSignOutMutation,
} from './mutations.js';
import { createBetterAuthMountAdapter } from './mount-adapter.js';
import {
  optionalBetterAuthPasswordResetFeature,
  type BetterAuthPasswordResetOptions,
} from './password-reset-mail.js';
import { betterAuthSession, type BetterAuthSessionMapper } from './session.js';

const NativeHeaders = globalThis.Headers;
const NativeTypeError = globalThis.TypeError;
const betterAuthPostgresSecretMinimumLength = 32;

declare const betterAuthPostgresSecretBrand: unique symbol;

/**
 * Better Auth signing material that cleared Kovo's non-empty 32-character security floor.
 *
 * The brand is an author-time guardrail. `createBetterAuthPostgresBindings` repeats the runtime
 * validation, so a cast or value crossing an untyped boundary cannot bypass the sink (SPEC §6.6).
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not name it.
 */
export type BetterAuthPostgresSecret = string & {
  readonly [betterAuthPostgresSecretBrand]: 'better-auth-postgres-secret';
};

/**
 * Validate signing material before it can reach Better Auth's Postgres constructor.
 *
 * Generate a high-entropy value with `crypto.randomBytes(32).toString('base64url')`; this
 * constructor enforces the same 32-character absolute floor as Kovo's app signing-secret gate.
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not call it.
 */
export function betterAuthPostgresSecret(value: string): BetterAuthPostgresSecret {
  if (typeof value !== 'string' || value.length < betterAuthPostgresSecretMinimumLength) {
    throw new NativeTypeError(
      `Better Auth Postgres secret must be a string of at least ${betterAuthPostgresSecretMinimumLength} characters (SPEC §6.6).`,
    );
  }
  return value as BetterAuthPostgresSecret;
}

/**
 * Options for the framework-owned Better Auth/Postgres construction boundary.
 *
 * The database input is an opaque system capability rather than a Drizzle handle. The constructor
 * consumes it internally, snapshots the schema/options it retains, and returns only sanitized Kovo
 * session and credential-mutation bindings (SPEC §6.6 and §10.3 capability ownership/C9).
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not name it.
 */
export type BetterAuthPostgresBindingsOptions<
  Request extends BetterAuthGeneratedRequest,
  SessionValue,
> = BetterAuthBindingsOptions<Request, SessionValue, BetterAuthPostgresSecret>;

/**
 * Generated-app binding options whose secrets/URL/demo seed come from boot-pinned operator env.
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not name it.
 */
export type BetterAuthPostgresEnvironmentBindingsOptions<
  Request extends BetterAuthGeneratedRequest,
  SessionValue,
> = BetterAuthEnvironmentBindingsOptions<Request, SessionValue, BetterAuthPostgresSecret>;

/**
 * Sanitized bindings produced by `createBetterAuthPostgresBindings`.
 *
 * The raw Better Auth instance, Drizzle adapter, and system database never appear on this object.
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not name it.
 */
export type BetterAuthPostgresBindings<
  Request extends BetterAuthGeneratedRequest,
  SessionValue,
  AuthenticatedRequest extends Request = Request,
> = BetterAuthBindings<Request, SessionValue, AuthenticatedRequest>;

/**
 * Construct Postgres bindings without exposing raw operator environment values to generated code.
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not call it.
 */
export function createBetterAuthPostgresBindingsFromEnvironment<
  Request extends BetterAuthGeneratedRequest,
  SessionValue,
  AuthenticatedRequest extends Request = Request,
>(
  options: BetterAuthPostgresEnvironmentBindingsOptions<Request, SessionValue>,
): Readonly<BetterAuthPostgresBindings<Request, SessionValue, AuthenticatedRequest>> {
  assertBetterAuthRuntimeRealmLocked();
  if (typeof options !== 'object' || options === null) {
    throw new NativeTypeError(
      'Better Auth Postgres environment binding options must be an object.',
    );
  }
  const environment = resolveBetterAuthEnvironment();
  const principalEpochStore = betterAuthOwnDataOption<PrincipalEpochStore>(
    options,
    'principalEpochStore',
    'Better Auth Postgres binding option principalEpochStore',
  );
  const passwordReset = betterAuthOwnDataOption<BetterAuthPasswordResetOptions>(
    options,
    'passwordReset',
    'Better Auth Postgres environment binding option passwordReset',
  );
  return createBetterAuthPostgresBindings<Request, SessionValue, AuthenticatedRequest>({
    baseURL: environment.baseURL,
    csrf: requiredOption<CsrfOptions<Request>>(options, 'csrf'),
    ...(environment.developmentSeed === undefined
      ? {}
      : { developmentSeed: environment.developmentSeed }),
    mapSession: requiredOption<BetterAuthSessionMapper<Session, User, SessionValue>>(
      options,
      'mapSession',
    ),
    ...(principalEpochStore === undefined ? {} : { principalEpochStore }),
    ...(passwordReset === undefined ? {} : { passwordReset }),
    schema: requiredOption<Record<string, unknown>>(options, 'schema'),
    secret: betterAuthPostgresSecret(environment.secret),
    signInAccess: requiredOption<AccessDecision>(options, 'signInAccess'),
    signOutAccess: requiredOption<AccessDecision>(options, 'signOutAccess'),
    systemDb: requiredOption<KovoPostgresSystemDb>(options, 'systemDb'),
  });
}

/**
 * Construct the Better Auth/Postgres adapter behind one framework-owned capability door.
 *
 * Only the inferred framework-minted database authority crosses generated app source; its
 * implementation-only nominal carrier is absent from this generated signature. The raw Drizzle
 * database is revealed inside this package just long enough to construct Better Auth's adapter,
 * and the runtime WeakMap lookup rejects every unminted value (SPEC §6.6/§10.3 C9).
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not call it.
 */
export function createBetterAuthPostgresBindings<
  Request extends BetterAuthGeneratedRequest,
  SessionValue,
  AuthenticatedRequest extends Request = Request,
>(
  options: BetterAuthPostgresBindingsOptions<Request, SessionValue>,
): Readonly<BetterAuthPostgresBindings<Request, SessionValue, AuthenticatedRequest>> {
  assertBetterAuthRuntimeRealmLocked();
  if (typeof options !== 'object' || options === null) {
    throw new NativeTypeError('Better Auth Postgres binding options must be an object.');
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
    throw new NativeTypeError('Better Auth Postgres binding mapSession must be a function.');
  }
  const principalEpochStore = betterAuthOwnDataOption<PrincipalEpochStore>(
    options,
    'principalEpochStore',
    'Better Auth Postgres binding option principalEpochStore',
  );
  if (
    principalEpochStore !== undefined &&
    (typeof principalEpochStore !== 'object' || principalEpochStore === null)
  ) {
    throw new NativeTypeError(
      'Better Auth Postgres binding principalEpochStore must be a stable object.',
    );
  }
  const schema = requiredOption<Record<string, unknown>>(options, 'schema');
  if (typeof schema !== 'object' || schema === null) {
    throw new NativeTypeError('Better Auth Postgres binding schema must be an object.');
  }
  const pinnedSchema = postgresSchemaModule(schema);
  const rateLimitTable = requireBetterAuthRateLimitSchema(pinnedSchema);
  const secret = betterAuthPostgresSecret(requiredTextOption(options, 'secret'));
  const passwordReset = optionalBetterAuthPasswordResetFeature(
    betterAuthOwnDataOption<BetterAuthPasswordResetOptions>(
      options,
      'passwordReset',
      'Better Auth Postgres binding option passwordReset',
    ),
    baseURL,
  );
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
  const rateLimitConsumer = betterAuthCredentialConsumers.postgresRateLimit;
  const sealedRateLimit = runBetterAuthCredentialSourceCallable<
    ReturnType<typeof createBetterAuthPostgresRateLimitStorage>
  >(
    rateLimitConsumer,
    'rate-limit.constructor',
    createBetterAuthPostgresRateLimitStorage,
    undefined,
    [secret, systemDb, rateLimitTable],
  );
  const rateLimit = consumeBetterAuthCredentialResult(rateLimitConsumer, sealedRateLimit);
  const adapterConsumer = betterAuthCredentialConsumers.postgresAdapter;
  const sealedAuth = runBetterAuthCredentialSourceCallable<ReturnType<typeof betterAuth>>(
    adapterConsumer,
    'better-auth.constructor',
    betterAuth,
    undefined,
    [
      {
        // The raw Better Auth router is structurally unreachable. Kovo exposes only an opaque,
        // GET-only callback adapter; fixed credential wrappers own unsafe-method ingress (SPEC
        // §6.6/§10.3 C9), so ambient trusted-origin configuration cannot become widenable authority.
        advanced: {
          ...betterAuthFixedCookieSecurity(baseURL),
          disableCSRFCheck: true,
          disableOriginCheck: true,
          ipAddress: { ipAddressHeaders: ['x-kovo-client-ip'] },
        },
        baseURL,
        database,
        // Seeding provisions a credential only. A session must require the explicit, CSRF-protected
        // sign-in mutation rather than being created as a side effect of server boot (SPEC §6.6).
        emailAndPassword: {
          autoSignIn: false,
          enabled: true,
          password: { hash: betterAuthHashPassword, verify: betterAuthVerifyPassword },
          ...(passwordReset === undefined ? {} : { sendResetPassword: passwordReset.mail.capture }),
        },
        rateLimit,
        secret,
        secrets: [{ version: 0, value: secret }],
        telemetry: { enabled: false },
        trustedOrigins: [],
      },
    ],
  );
  const auth = consumeBetterAuthCredentialResult(adapterConsumer, sealedAuth);
  registerFixedBetterAuthCanonicalOrigin(auth, baseURL, 'Better Auth Postgres binding');
  const mountAdapter = createBetterAuthMountAdapter(auth, baseURL);
  const sessionProvider = betterAuthSession<Session, User, SessionValue>(
    auth,
    mapSession,
    principalEpochStore === undefined
      ? undefined
      : async (payload) => {
          const principal = betterAuthOwnDataOption<unknown>(
            payload.user,
            'id',
            'Better Auth sanitized user.id',
          );
          if (typeof principal !== 'string') {
            throw new NativeTypeError('Better Auth sanitized user.id must be a principal string.');
          }
          await initializePrincipalEpoch(principalEpochStore, principal);
        },
  );
  const requestPasswordReset =
    passwordReset === undefined
      ? undefined
      : betterAuthRequestPasswordResetMutation<'auth/request-password-reset', Request>(auth, {
          access: passwordReset.access,
          csrf,
          mail: passwordReset.mail,
        });
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
      // The configured fixed account already exists or the local database is not seedable.
    }
  }

  return betterAuthFreezeOwn(
    {
      mountAdapter,
      ...(requestPasswordReset === undefined ? {} : { requestPasswordReset }),
      seedDemoUser,
      sessionProvider,
      signIn,
      signOut,
    },
    'Better Auth Postgres bindings',
  );
}

function requireBetterAuthRateLimitSchema(schema: object): unknown {
  const table = betterAuthOwnDataOption<unknown>(
    schema,
    'rateLimit',
    'Better Auth Postgres binding schema.rateLimit',
  );
  if ((typeof table !== 'object' && typeof table !== 'function') || table === null) {
    throw new NativeTypeError(
      'Better Auth Postgres bindings require schema.rateLimit for durable credential throttling.',
    );
  }
  return table;
}

function requiredOption<Value>(
  options: object,
  property: keyof BetterAuthPostgresBindingsOptions<BetterAuthGeneratedRequest, unknown>,
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
