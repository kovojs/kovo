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
