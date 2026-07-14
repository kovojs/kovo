import { runtimeEnvironmentValue } from '@kovojs/server/internal/runtime-environment';
import { createSigningKeyRing, type CsrfOptions } from '@kovojs/server';

import {
  betterAuthFreezeOwn,
  betterAuthOwnDataOption,
  betterAuthUrlProtocol,
} from './internal/intrinsics.js';

const NativeTypeError = globalThis.TypeError;
const BETTER_AUTH_SECRET_MINIMUM_LENGTH = 32;
const DEFAULT_BETTER_AUTH_URL = 'http://localhost:5173';
const REPLACEMENT_SECRET = 'replace-with-a-deployed-secret';
const REPLACEMENT_DEMO_PASSWORD = 'replace-with-a-local-demo-password';

/** App callback/options used to build a CSRF config from boot-pinned signing material. */
export interface BetterAuthEnvironmentCsrfOptions<Request> {
  /** Form field name used by generated credential mutations. */
  field: string;
  /** Session/anonymous binding extractor retained by the frozen CSRF config. */
  sessionId(request: Request): string | undefined;
}

/**
 * Create a frozen CSRF config from bootstrap-pinned operator signing material.
 *
 * The raw environment string is consumed inside this first-party package and converted to an
 * opaque signing-key ring before the result crosses into generated source (SPEC §6.6 C9).
 */
export function betterAuthCsrfFromEnvironment<Request>(
  options: BetterAuthEnvironmentCsrfOptions<Request>,
): Readonly<CsrfOptions<Request>> {
  if (typeof options !== 'object' || options === null) {
    throw new NativeTypeError('Better Auth environment CSRF options must be an object.');
  }
  const field = betterAuthOwnDataOption<string>(
    options,
    'field',
    'Better Auth environment CSRF option field',
  );
  const sessionId = betterAuthOwnDataOption<(request: Request) => string | undefined>(
    options,
    'sessionId',
    'Better Auth environment CSRF option sessionId',
  );
  if (typeof field !== 'string' || field.length === 0 || field.length > 256) {
    throw new NativeTypeError(
      'Better Auth environment CSRF field must be a non-empty string of at most 256 characters.',
    );
  }
  if (typeof sessionId !== 'function') {
    throw new NativeTypeError('Better Auth environment CSRF sessionId must be a function.');
  }
  const secret = requiredBetterAuthEnvironmentSecret();
  const secretRing = createSigningKeyRing({
    keys: [{ id: 'better-auth-current', secret, state: 'active' }],
  });
  return betterAuthFreezeOwn(
    { field, secret: secretRing, sessionId },
    'Better Auth environment CSRF config',
  );
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
  const baseURL = validateBetterAuthBaseUrl(
    runtimeEnvironmentValue('BETTER_AUTH_URL') ?? DEFAULT_BETTER_AUTH_URL,
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

function validateBetterAuthBaseUrl(value: string): string {
  let protocol: string;
  try {
    protocol = betterAuthUrlProtocol(value);
  } catch {
    throw new NativeTypeError('BETTER_AUTH_URL must be an absolute HTTP(S) URL.');
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new NativeTypeError('BETTER_AUTH_URL must be an absolute HTTP(S) URL.');
  }
  return value;
}
