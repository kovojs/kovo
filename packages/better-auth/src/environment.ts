import { runtimeEnvironmentValue } from '@kovojs/server/internal/runtime-environment';
import { createSigningKeyRing, type CsrfOptions } from '@kovojs/server';
import { createFrameworkCsrfSigningSecret } from '@kovojs/server/internal/keyring';

import {
  betterAuthFreezeOwn,
  betterAuthObjectKeys,
  betterAuthOwnDataOption,
  betterAuthOwnDataValue,
  betterAuthUrlSnapshot,
} from './internal/intrinsics.js';

const NativeTypeError = globalThis.TypeError;
const BETTER_AUTH_SECRET_MINIMUM_LENGTH = 32;
const DEFAULT_BETTER_AUTH_URL = 'http://localhost:5173';
const REPLACEMENT_SECRET = 'replace-with-a-deployed-secret';
const REPLACEMENT_DEMO_PASSWORD = 'replace-with-a-local-demo-password';
const BETTER_AUTH_CSRF_BINDING_MAXIMUM_LENGTH = 1_024;

/** Request fields the framework-owned Better Auth CSRF binding is permitted to inspect. */
export interface BetterAuthCsrfRequestLike {
  /** Anonymous pre-auth identity, when the request lifecycle has already resolved one. */
  authCsrfId?: string | null;
  /** Sanitized Better Auth session identity resolved by the framework session provider. */
  session?: { id: string } | null;
}

/** Options used to build a CSRF config from boot-pinned signing material. */
export interface BetterAuthEnvironmentCsrfOptions {
  /** Form field name used by generated credential mutations. */
  field: string;
}

/**
 * Create a frozen CSRF config from bootstrap-pinned operator signing material.
 *
 * The raw environment string is consumed inside this first-party package and converted to an
 * opaque signing-key ring before the result crosses into generated source (SPEC §6.6 C9).
 */
export function betterAuthCsrfFromEnvironment<
  Request extends BetterAuthCsrfRequestLike = BetterAuthCsrfRequestLike,
>(options: BetterAuthEnvironmentCsrfOptions): Readonly<CsrfOptions<Request>> {
  if (typeof options !== 'object' || options === null) {
    throw new NativeTypeError('Better Auth environment CSRF options must be an object.');
  }
  const field = betterAuthOwnDataOption<string>(
    options,
    'field',
    'Better Auth environment CSRF option field',
  );
  const optionKeys = betterAuthObjectKeys(options, 'Better Auth environment CSRF options');
  if (optionKeys.length !== 1 || optionKeys[0] !== 'field') {
    throw new NativeTypeError(
      'Better Auth environment CSRF options accept only { field }; session binding is framework-owned (SPEC §6.6 C9).',
    );
  }
  if (typeof field !== 'string' || field.length === 0 || field.length > 256) {
    throw new NativeTypeError(
      'Better Auth environment CSRF field must be a non-empty string of at most 256 characters.',
    );
  }
  const secret = requiredBetterAuthEnvironmentSecret();
  const secretRing = createSigningKeyRing({
    keys: [{ id: 'better-auth-current', secret, state: 'active' }],
  });
  return betterAuthFreezeOwn(
    {
      field,
      secret: createFrameworkCsrfSigningSecret(secretRing),
      sessionId: betterAuthEnvironmentCsrfSessionId,
    },
    'Better Auth environment CSRF config',
  ) as Readonly<CsrfOptions<Request>>;
}

function betterAuthEnvironmentCsrfSessionId(
  request: BetterAuthCsrfRequestLike,
): string | undefined {
  if (typeof request !== 'object' || request === null) {
    throw new NativeTypeError('Better Auth CSRF request must be an object.');
  }
  const session = betterAuthOwnDataValue(request, 'session', 'Better Auth CSRF request');
  if (session !== undefined && session !== null) {
    if (typeof session !== 'object') {
      throw new NativeTypeError('Better Auth CSRF request.session must be an object or null.');
    }
    const sessionId = betterAuthOwnDataValue(session, 'id', 'Better Auth CSRF request.session');
    return validatedBetterAuthCsrfBinding(sessionId, 'Better Auth CSRF request.session.id', false);
  }
  const authCsrfId = betterAuthOwnDataValue(request, 'authCsrfId', 'Better Auth CSRF request');
  return validatedBetterAuthCsrfBinding(authCsrfId, 'Better Auth CSRF request.authCsrfId', true);
}

function validatedBetterAuthCsrfBinding(
  value: unknown,
  label: string,
  optional: boolean,
): string | undefined {
  if (value === undefined || value === null) {
    if (optional) return undefined;
    throw new NativeTypeError(`${label} must be a non-empty string when session is present.`);
  }
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > BETTER_AUTH_CSRF_BINDING_MAXIMUM_LENGTH
  ) {
    throw new NativeTypeError(
      `${label} must be a non-empty string of at most ${BETTER_AUTH_CSRF_BINDING_MAXIMUM_LENGTH} characters.`,
    );
  }
  return value;
}

/** Resolved raw values stay private to the two reviewed binding constructors. @internal */
export interface BetterAuthResolvedEnvironment {
  readonly baseURL: string;
  readonly developmentSeed?: Readonly<{ email: string; name: string; password: string }>;
  readonly production: boolean;
  readonly secret: string;
}

/** Resolve auth values at constructor call time, after server bootstrap loaded and pinned `.env`. */
export function resolveBetterAuthEnvironment(): BetterAuthResolvedEnvironment {
  const production = runtimeEnvironmentValue('NODE_ENV') === 'production';
  assertNoUpstreamBetterAuthEnvironmentOverrides();
  const configuredBaseURL = runtimeEnvironmentValue('BETTER_AUTH_URL');
  if (production && configuredBaseURL === undefined) {
    throw new NativeTypeError(
      'BETTER_AUTH_URL is required in production and must be a canonical HTTPS origin (for example, https://app.example.com).',
    );
  }
  const baseURL = validateBetterAuthBaseUrl(
    configuredBaseURL ?? DEFAULT_BETTER_AUTH_URL,
    production,
  );
  const secret = requiredBetterAuthEnvironmentSecret();
  const password = runtimeEnvironmentValue('KOVO_DEMO_PASSWORD');
  const developmentSeed =
    production ||
    password === undefined ||
    password.length === 0 ||
    password === REPLACEMENT_DEMO_PASSWORD
      ? undefined
      : betterAuthFreezeOwn(
          { email: 'demo@example.com', name: 'Demo User', password },
          'Better Auth environment development seed',
        );
  return betterAuthFreezeOwn(
    {
      baseURL,
      ...(developmentSeed === undefined ? {} : { developmentSeed }),
      production,
      secret,
    },
    'Better Auth resolved environment',
  );
}

/** Whether fixed development principals are forbidden by the boot-pinned production posture. */
export function betterAuthEnvironmentIsProduction(): boolean {
  return runtimeEnvironmentValue('NODE_ENV') === 'production';
}

function requiredBetterAuthEnvironmentSecret(): string {
  const secret =
    runtimeEnvironmentValue('BETTER_AUTH_SECRET') ?? runtimeEnvironmentValue('KOVO_CSRF_SECRET');
  if (
    secret === undefined ||
    secret === REPLACEMENT_SECRET ||
    secret.length < BETTER_AUTH_SECRET_MINIMUM_LENGTH
  ) {
    throw new NativeTypeError(
      'Set BETTER_AUTH_SECRET (or KOVO_CSRF_SECRET) to a strong random value of at least 32 characters (SPEC §6.6).',
    );
  }
  return secret;
}

function assertNoUpstreamBetterAuthEnvironmentOverrides(): void {
  for (const name of ['BETTER_AUTH_SECRETS', 'BETTER_AUTH_TRUSTED_ORIGINS'] as const) {
    if (runtimeEnvironmentValue(name) !== undefined) {
      throw new NativeTypeError(
        `${name} is not accepted by Kovo's generated Better Auth boundary; configure the reviewed Kovo constructor instead (SPEC §6.6 C9).`,
      );
    }
  }
}

/** Validate the canonical origin shared by generated and direct binding constructors. @internal */
export function validateBetterAuthBaseUrl(value: string, production: boolean): string {
  let snapshot: ReturnType<typeof betterAuthUrlSnapshot>;
  try {
    snapshot = betterAuthUrlSnapshot(value);
  } catch {
    throw new NativeTypeError('BETTER_AUTH_URL must be a canonical absolute HTTP(S) origin.');
  }
  if (
    (snapshot.protocol !== 'http:' && snapshot.protocol !== 'https:') ||
    snapshot.origin === 'null' ||
    snapshot.username !== '' ||
    snapshot.password !== '' ||
    snapshot.pathname !== '/' ||
    snapshot.search !== '' ||
    snapshot.hash !== '' ||
    value !== snapshot.origin
  ) {
    throw new NativeTypeError('BETTER_AUTH_URL must be a canonical absolute HTTP(S) origin.');
  }
  if (production && snapshot.protocol !== 'https:') {
    throw new NativeTypeError('BETTER_AUTH_URL must use HTTPS in production.');
  }
  return snapshot.origin;
}
