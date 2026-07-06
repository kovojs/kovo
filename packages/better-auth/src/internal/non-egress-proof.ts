export type BetterAuthRequestSecretCarrier =
  | 'adapter-system-db-secret-column'
  | 'request-cookie'
  | 'set-cookie'
  | 'submitted-password';

export type BetterAuthRequestSecretDisposition =
  | 'boxed'
  | 'confined-cookie-forwarding'
  | 'confined-third-party-adapter'
  | 'vetted-compare-or-verify';

export interface BetterAuthRequestSecretPath {
  /** Stable proof id for the request-reachable auth secret read path. */
  id: string;
  /** Request entrypoint that makes this path reachable. */
  entrypoint:
    | 'credential-mutation:sign-in-email'
    | 'credential-mutation:sign-out'
    | 'credential-mutation:sign-up-email'
    | 'mounted-better-auth-handler'
    | 'session-provider';
  /** Secret carrier consumed by this path. */
  carrier: BetterAuthRequestSecretCarrier;
  /** File that owns the Kovo-side adapter path or declared third-party boundary. */
  source: string;
  /** How the path is prevented from becoming plaintext egress. */
  disposition: BetterAuthRequestSecretDisposition;
  /** Whether the path can read another user's stored credential through the adapter DB handle. */
  readsCrossUserCredential: boolean;
  /** Short review note for the TCB inventory and tests. */
  reason: string;
}

const permittedCrossUserCredentialDispositions = new Set<BetterAuthRequestSecretDisposition>([
  'boxed',
  'vetted-compare-or-verify',
]);

export const betterAuthRequestSecretPaths = [
  {
    id: 'better-auth.sign-in.submitted-password',
    entrypoint: 'credential-mutation:sign-in-email',
    carrier: 'submitted-password',
    source: 'packages/better-auth/src/internal/trusted-plaintext.ts',
    disposition: 'vetted-compare-or-verify',
    readsCrossUserCredential: false,
    reason: 'Submitted password is passed only to Better Auth signInEmail comparison.',
  },
  {
    id: 'better-auth.sign-up.submitted-password',
    entrypoint: 'credential-mutation:sign-up-email',
    carrier: 'submitted-password',
    source: 'packages/better-auth/src/internal/trusted-plaintext.ts',
    disposition: 'vetted-compare-or-verify',
    readsCrossUserCredential: false,
    reason: 'Submitted password is passed only to Better Auth signUpEmail hash/write path.',
  },
  {
    id: 'better-auth.sign-out.request-cookie',
    entrypoint: 'credential-mutation:sign-out',
    carrier: 'request-cookie',
    source: 'packages/better-auth/src/internal/trusted-plaintext.ts',
    disposition: 'confined-third-party-adapter',
    readsCrossUserCredential: false,
    reason: 'Request cookie is passed only to Better Auth signOut revocation.',
  },
  {
    id: 'better-auth.get-session.request-cookie',
    entrypoint: 'session-provider',
    carrier: 'request-cookie',
    source: 'packages/better-auth/src/internal/trusted-plaintext.ts',
    disposition: 'confined-third-party-adapter',
    readsCrossUserCredential: false,
    reason: 'Request cookie is passed only to Better Auth getSession lookup.',
  },
  {
    id: 'better-auth.set-cookie.forwarding',
    entrypoint: 'credential-mutation:sign-in-email',
    carrier: 'set-cookie',
    source: 'packages/better-auth/src/internal/credential.ts',
    disposition: 'confined-cookie-forwarding',
    readsCrossUserCredential: false,
    reason: 'Better Auth Set-Cookie values are forwarded only to Kovo session-cookie sinks.',
  },
  {
    id: 'better-auth.session-refresh.set-cookie',
    entrypoint: 'session-provider',
    carrier: 'set-cookie',
    source: 'packages/better-auth/src/session.ts',
    disposition: 'confined-cookie-forwarding',
    readsCrossUserCredential: false,
    reason:
      'Session-refresh Set-Cookie values are returned through SessionProviderResult.setCookies.',
  },
  {
    id: 'better-auth.adapter.sign-in.account-password',
    entrypoint: 'credential-mutation:sign-in-email',
    carrier: 'adapter-system-db-secret-column',
    source: 'better-auth Drizzle adapter systemDb handle',
    disposition: 'vetted-compare-or-verify',
    readsCrossUserCredential: true,
    reason:
      'Better Auth may read account.password through its adapter only to verify the submitted password.',
  },
  {
    id: 'better-auth.adapter.session-token-lookup',
    entrypoint: 'session-provider',
    carrier: 'adapter-system-db-secret-column',
    source: 'better-auth Drizzle adapter systemDb handle',
    disposition: 'vetted-compare-or-verify',
    readsCrossUserCredential: true,
    reason:
      'Better Auth may read session bearer credentials only to verify the current request cookie.',
  },
  {
    id: 'better-auth.mount.handler-delegation',
    entrypoint: 'mounted-better-auth-handler',
    carrier: 'request-cookie',
    source: 'packages/better-auth/src/mount.ts',
    disposition: 'confined-third-party-adapter',
    readsCrossUserCredential: false,
    reason:
      'Mounted provider callbacks delegate the whole request to Better Auth and return its Response.',
  },
] as const satisfies readonly BetterAuthRequestSecretPath[];

export type BetterAuthRequestSecretPathId = (typeof betterAuthRequestSecretPaths)[number]['id'];

const betterAuthRequestSecretPathIds = new Set<string>(
  betterAuthRequestSecretPaths.map((path) => path.id),
);

export function assertBetterAuthRequestSecretPath(id: BetterAuthRequestSecretPathId): void {
  if (!betterAuthRequestSecretPathIds.has(id)) {
    throw new Error(`KV439: unenumerated Better Auth request secret path ${id}`);
  }
}

/**
 * Relative module (from `packages/better-auth/src/`) that owns every Better Auth plaintext-reading
 * API call. SPEC §6.6/§10.3: Better Auth's server API consumes password/cookie material as ordinary
 * strings, so Kovo confines those contact points to a single trusted module.
 */
export const betterAuthTrustedPlaintextModule = 'internal/trusted-plaintext.ts';

/**
 * SPEC §10.1 C10 (papercuts-36 P1): the plaintext-API confinement is a FAIL-CLOSED enumeration, not
 * a hardcoded 4-name regex. `auth.api.*` methods that read submitted password or request-cookie
 * plaintext are enumerated here; every such method Kovo calls MUST live in the trusted module. The
 * list intentionally covers more Better Auth plaintext endpoints than Kovo currently calls, so that
 * introducing a call to any of them outside the trusted module fails closed. Extend this list — with
 * the new call confined to the trusted module — when adopting another plaintext-reading endpoint.
 */
export const betterAuthPlaintextReadingApiMethods: readonly string[] = [
  'changeEmail',
  'changePassword',
  'forgetPassword',
  'getSession',
  'listSessions',
  'resetPassword',
  'revokeSession',
  'revokeSessions',
  'signInEmail',
  'signInUsername',
  'signOut',
  'signUpEmail',
  'updateUser',
  'verifyEmail',
];

/**
 * `auth.api.*` methods Kovo calls that provably do NOT read cross-user submitted-plaintext or
 * request-cookie material and therefore need not live in the trusted module. This is an explicit
 * allowlist (currently empty): a new non-plaintext usage must be justified and classified here
 * rather than silently escaping the confinement proof. SPEC §10.1 C10.
 */
export const betterAuthNonPlaintextApiMethods: readonly string[] = [];

/** A single `auth.api.<method>(` call site discovered by the confinement scan. */
export interface BetterAuthApiUsage {
  /** The invoked `auth.api.<method>` name. */
  method: string;
  /** Source file, relative to `packages/better-auth/src/`, POSIX-separated. */
  file: string;
}

const betterAuthPlaintextReadingApiMethodSet = new Set(betterAuthPlaintextReadingApiMethods);
const betterAuthNonPlaintextApiMethodSet = new Set(betterAuthNonPlaintextApiMethods);

/**
 * SPEC §10.1 C10 / §6.6 (papercuts-36 P1): prove the Better Auth plaintext-API surface is confined
 * to the trusted module by an enumeration whose completeness is checked, not by a subset regex.
 *
 * Fail-closed properties, given every `auth.api.<method>(` call site in framework source:
 *  1. An `auth.api.*` method that is neither classified plaintext-reading nor allowlisted
 *     non-plaintext is UNCLASSIFIED → RED (a new endpoint cannot slip through unclassified).
 *  2. A plaintext-reading method called outside the trusted module is MISPLACED → RED.
 *  3. A method classified as both plaintext and non-plaintext is contradictory → RED.
 */
export function proveBetterAuthPlaintextApiConfinement(
  usages: readonly BetterAuthApiUsage[],
): string[] {
  const issues: string[] = [];

  for (const usage of usages) {
    const isPlaintext = betterAuthPlaintextReadingApiMethodSet.has(usage.method);
    const isNonPlaintext = betterAuthNonPlaintextApiMethodSet.has(usage.method);

    if (isPlaintext && isNonPlaintext) {
      issues.push(
        `KV439: auth.api.${usage.method} is classified both plaintext-reading and non-plaintext`,
      );
    }

    if (!isPlaintext && !isNonPlaintext) {
      issues.push(
        `KV439: unclassified Better Auth plaintext API auth.api.${usage.method} in ${usage.file}; ` +
          `classify it as plaintext-reading (confined to ${betterAuthTrustedPlaintextModule}) or ` +
          `allowlist it as non-plaintext with justification`,
      );
      continue;
    }

    if (isPlaintext && usage.file !== betterAuthTrustedPlaintextModule) {
      issues.push(
        `KV439: plaintext-reading Better Auth API auth.api.${usage.method} used outside ` +
          `${betterAuthTrustedPlaintextModule} in ${usage.file}`,
      );
    }
  }

  return issues;
}

export function proveBetterAuthRequestSecretNonEgress(
  paths: readonly BetterAuthRequestSecretPath[] = betterAuthRequestSecretPaths,
): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    if (seen.has(path.id)) {
      issues.push(`KV439: duplicate Better Auth request secret path ${path.id}`);
    }
    seen.add(path.id);

    if (path.readsCrossUserCredential) {
      if (!permittedCrossUserCredentialDispositions.has(path.disposition)) {
        issues.push(
          `KV439: ${path.id} reads a cross-user auth credential with unboxed disposition ${path.disposition}`,
        );
      }
      if (path.disposition === 'vetted-compare-or-verify' && path.reason.trim().length === 0) {
        issues.push(`KV439: ${path.id} requires a compare/verify justification`);
      }
    }

    if (path.disposition === 'boxed' && path.carrier !== 'adapter-system-db-secret-column') {
      issues.push(`KV439: ${path.id} claims boxing for non-database auth secret carrier`);
    }
  }

  return issues;
}
