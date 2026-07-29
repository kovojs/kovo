import { snapshotSqliteSchemaRecord } from '@kovojs/server/internal/sqlite';
import {
  useSqliteSystemDb,
  type KovoSqliteSystemDb,
} from '@kovojs/server/internal/sqlite-capability';
import { type AccessDecision, type SessionProvider } from '@kovojs/server';
import {
  initializePrincipalEpoch,
  type PrincipalEpochStore,
} from '@kovojs/server/principal-epochs';
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
import { registerFixedBetterAuthCanonicalOrigin } from './internal/request-origin.js';
import { assertBetterAuthRuntimeRealmLocked } from './internal/runtime-lock.js';
import { createBetterAuthSqliteRateLimitStorage } from './internal/sqlite-rate-limit-storage.js';
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
const betterAuthSqliteSecretMinimumLength = 32;

declare const betterAuthSqliteSecretBrand: unique symbol;

/**
 * Better Auth signing material that cleared Kovo's 32-character SQLite binding floor.
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not name it.
 */
export type BetterAuthSqliteSecret = string & {
  readonly [betterAuthSqliteSecretBrand]: 'better-auth-sqlite-secret';
};

/**
 * Validate signing material before it can reach the Better Auth SQLite constructor.
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not call it.
 */
export function betterAuthSqliteSecret(value: string): BetterAuthSqliteSecret {
  if (typeof value !== 'string' || value.length < betterAuthSqliteSecretMinimumLength) {
    throw new NativeTypeError(
      `Better Auth SQLite secret must be a string of at least ${betterAuthSqliteSecretMinimumLength} characters (SPEC §6.6).`,
    );
  }
  return value as BetterAuthSqliteSecret;
}

/**
 * SQLite spelling of the backend-neutral generated development seed.
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not name it.
 */
export type BetterAuthSqliteDevelopmentSeed = BetterAuthDevelopmentSeed;

/**
 * Options for the framework-owned Better Auth/SQLite construction boundary.
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not name it.
 */
export type BetterAuthSqliteBindingsOptions<
  Request extends BetterAuthGeneratedRequest,
  SessionValue,
> = BetterAuthBindingsOptions<Request, SessionValue, BetterAuthSqliteSecret>;

/**
 * Generated-app binding options whose secrets/URL/demo seed come from boot-pinned operator env.
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not name it.
 */
export type BetterAuthSqliteEnvironmentBindingsOptions<
  Request extends BetterAuthGeneratedRequest,
  SessionValue,
> = BetterAuthEnvironmentBindingsOptions<Request, SessionValue, BetterAuthSqliteSecret>;

/**
 * Sanitized bindings produced by `createBetterAuthSqliteBindings`.
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not name it.
 */
export type BetterAuthSqliteBindings<
  Request extends BetterAuthGeneratedRequest,
  SessionValue,
  AuthenticatedRequest extends Request = Request,
> = BetterAuthBindings<Request, SessionValue, AuthenticatedRequest>;

/**
 * Construct SQLite bindings without exposing raw operator environment values to generated code.
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not call it.
 */
export function createBetterAuthSqliteBindingsFromEnvironment<
  Request extends BetterAuthGeneratedRequest,
  SessionValue,
  AuthenticatedRequest extends Request = Request,
>(
  options: BetterAuthSqliteEnvironmentBindingsOptions<Request, SessionValue>,
): Readonly<BetterAuthSqliteBindings<Request, SessionValue, AuthenticatedRequest>> {
  assertBetterAuthRuntimeRealmLocked();
  if (typeof options !== 'object' || options === null) {
    throw new NativeTypeError('Better Auth SQLite environment binding options must be an object.');
  }
  const environment = resolveBetterAuthEnvironment();
  const principalEpochStore = betterAuthOwnDataOption<PrincipalEpochStore>(
    options,
    'principalEpochStore',
    'Better Auth SQLite binding option principalEpochStore',
  );
  const passwordReset = betterAuthOwnDataOption<BetterAuthPasswordResetOptions>(
    options,
    'passwordReset',
    'Better Auth SQLite environment binding option passwordReset',
  );
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
    ...(principalEpochStore === undefined ? {} : { principalEpochStore }),
    ...(passwordReset === undefined ? {} : { passwordReset }),
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
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not call it.
 */
export function createBetterAuthSqliteBindings<
  Request extends BetterAuthGeneratedRequest,
  SessionValue,
  AuthenticatedRequest extends Request = Request,
>(
  options: BetterAuthSqliteBindingsOptions<Request, SessionValue>,
): Readonly<BetterAuthSqliteBindings<Request, SessionValue, AuthenticatedRequest>> {
  assertBetterAuthRuntimeRealmLocked();
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
  const principalEpochStore = betterAuthOwnDataOption<PrincipalEpochStore>(
    options,
    'principalEpochStore',
    'Better Auth SQLite binding option principalEpochStore',
  );
  if (
    principalEpochStore !== undefined &&
    (typeof principalEpochStore !== 'object' || principalEpochStore === null)
  ) {
    throw new NativeTypeError(
      'Better Auth SQLite binding principalEpochStore must be a stable object.',
    );
  }
  const schema = requiredOption<Record<string, unknown>>(options, 'schema');
  if (typeof schema !== 'object' || schema === null) {
    throw new NativeTypeError('Better Auth SQLite binding schema must be an object.');
  }
  const pinnedSchema = snapshotSqliteSchemaRecord(schema);
  const rateLimitTable = requireBetterAuthRateLimitSchema(pinnedSchema);
  const secret = betterAuthSqliteSecret(requiredTextOption(options, 'secret'));
  const passwordReset = optionalBetterAuthPasswordResetFeature(
    betterAuthOwnDataOption<BetterAuthPasswordResetOptions>(
      options,
      'passwordReset',
      'Better Auth SQLite binding option passwordReset',
    ),
    baseURL,
  );
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
  const rateLimitConsumer = betterAuthCredentialConsumers.sqliteRateLimit;
  const sealedRateLimit = runBetterAuthCredentialSourceCallable<
    ReturnType<typeof createBetterAuthSqliteRateLimitStorage>
  >(
    rateLimitConsumer,
    'rate-limit.constructor',
    createBetterAuthSqliteRateLimitStorage,
    undefined,
    [secret, systemDb, rateLimitTable],
  );
  const rateLimit = consumeBetterAuthCredentialResult(rateLimitConsumer, sealedRateLimit);
  const adapterConsumer = betterAuthCredentialConsumers.sqliteAdapter;
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
  registerFixedBetterAuthCanonicalOrigin(auth, baseURL, 'Better Auth SQLite binding');
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
      // The configured fixed local account already exists or is not seedable.
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
    'Better Auth SQLite bindings',
  );
}

function requireBetterAuthRateLimitSchema(schema: object): unknown {
  const table = betterAuthOwnDataOption<unknown>(
    schema,
    'rateLimit',
    'Better Auth SQLite binding schema.rateLimit',
  );
  if ((typeof table !== 'object' && typeof table !== 'function') || table === null) {
    throw new NativeTypeError(
      'Better Auth SQLite bindings require schema.rateLimit for durable credential throttling.',
    );
  }
  return table;
}

function requiredOption<Value>(
  options: object,
  property: keyof BetterAuthSqliteBindingsOptions<BetterAuthGeneratedRequest, unknown>,
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
