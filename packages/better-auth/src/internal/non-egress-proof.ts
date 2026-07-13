export type BetterAuthRequestSecretCarrier =
  | 'adapter-system-db-secret-column'
  | 'request-cookie'
  | 'set-cookie'
  | 'submitted-password';

export type BetterAuthRequestSecretDisposition =
  | 'boxed'
  | 'confined-cookie-forwarding'
  | 'confined-third-party-adapter'
  | 'reconstructed-non-secret-projection'
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

const permittedCrossUserCredentialDispositions =
  betterAuthStringSet<BetterAuthRequestSecretDisposition>(
    ['boxed', 'vetted-compare-or-verify'],
    'Better Auth permitted cross-user credential dispositions',
  );

const permittedAdapterCredentialDispositions =
  betterAuthStringSet<BetterAuthRequestSecretDisposition>(
    ['boxed', 'reconstructed-non-secret-projection', 'vetted-compare-or-verify'],
    'Better Auth permitted adapter credential dispositions',
  );

export const betterAuthRequestSecretPaths = betterAuthDeepFreeze(
  [
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
      id: 'better-auth.get-session.response-secret-projection',
      entrypoint: 'session-provider',
      carrier: 'adapter-system-db-secret-column',
      source: 'packages/better-auth/src/session.ts',
      disposition: 'reconstructed-non-secret-projection',
      readsCrossUserCredential: false,
      reason:
        'Session and user rows are reconstructed without credential-shaped fields before app mapping.',
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
  ] as const satisfies readonly BetterAuthRequestSecretPath[],
  'Better Auth request secret path manifest',
);

export type BetterAuthRequestSecretPathId = (typeof betterAuthRequestSecretPaths)[number]['id'];

const pinnedBetterAuthRequestSecretPaths = snapshotBetterAuthRequestSecretPaths(
  betterAuthRequestSecretPaths,
  'Better Auth request secret path manifest',
);
const betterAuthRequestSecretPathIds = betterAuthCreateSet<string>();
for (let index = 0; index < pinnedBetterAuthRequestSecretPaths.length; index += 1) {
  betterAuthSetAdd(betterAuthRequestSecretPathIds, pinnedBetterAuthRequestSecretPaths[index]!.id);
}

export function assertBetterAuthRequestSecretPath(id: BetterAuthRequestSecretPathId): void {
  if (!betterAuthSetHas(betterAuthRequestSecretPathIds, id)) {
    throw new NativeError(`KV439: unenumerated Better Auth request secret path ${id}`);
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
export const betterAuthPlaintextReadingApiMethods: readonly string[] = betterAuthDeepFreeze(
  [
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
  ],
  'Better Auth plaintext-reading API methods',
);

/**
 * `auth.api.*` methods Kovo calls that provably do NOT read cross-user submitted-plaintext or
 * request-cookie material and therefore need not live in the trusted module. This is an explicit
 * allowlist (currently empty): a new non-plaintext usage must be justified and classified here
 * rather than silently escaping the confinement proof. SPEC §10.1 C10.
 */
export const betterAuthNonPlaintextApiMethods: readonly string[] = betterAuthDeepFreeze(
  [],
  'Better Auth non-plaintext API methods',
);

/** A single `auth.api.<method>(` call site discovered by the confinement scan. */
export interface BetterAuthApiUsage {
  /** The invoked `auth.api.<method>` name. */
  method: string;
  /** Source file, relative to `packages/better-auth/src/`, POSIX-separated. */
  file: string;
}

export type BetterAuthRequestExportCapability =
  | 'app-owned-declaration'
  | 'credential-mutation'
  | 'fixed-seed-operation'
  | 'privileged-adapter'
  | 'raw-auth-instance'
  | 'sanitized-session-provider'
  | 'unclassified';

/** One actual runtime export from generated app-authored `src/auth.ts`. */
export interface BetterAuthRequestReachableExport {
  capability: BetterAuthRequestExportCapability;
  name: string;
}

const permittedBetterAuthRequestExportCapabilities =
  betterAuthStringSet<BetterAuthRequestExportCapability>(
    [
      'app-owned-declaration',
      'credential-mutation',
      'fixed-seed-operation',
      'sanitized-session-provider',
    ],
    'Better Auth permitted request export capabilities',
  );

/**
 * SPEC §6.6/§10.3: prove confinement over the complete request-reachable export set, not a proxy
 * file name. The caller supplies every real runtime export discovered from generated `auth.ts`;
 * any unclassified export, raw Better Auth instance, or privileged adapter capability fails red.
 */
export function proveBetterAuthRequestExportConfinement(
  exports: readonly BetterAuthRequestReachableExport[],
): string[] {
  const issues: string[] = [];
  const names = betterAuthCreateSet<string>();
  const exportFacts = betterAuthSnapshotDenseArray(
    exports,
    'Better Auth request-reachable exports',
  );

  for (let index = 0; index < exportFacts.length; index += 1) {
    const exported = exportFacts[index]!;
    const name = betterAuthStringField(
      exported,
      'name',
      `Better Auth request-reachable export ${index}`,
    );
    const capability = betterAuthStringField(
      exported,
      'capability',
      `Better Auth request-reachable export ${index}`,
    ) as BetterAuthRequestExportCapability;
    if (betterAuthSetHas(names, name)) {
      betterAuthArrayAppend(
        issues,
        `KV439: duplicate request-reachable Better Auth export ${name}`,
        'Better Auth request export confinement issues',
      );
    }
    betterAuthSetAdd(names, name);
    if (!betterAuthSetHas(permittedBetterAuthRequestExportCapabilities, capability)) {
      betterAuthArrayAppend(
        issues,
        `KV439: request-reachable Better Auth export ${name} exposes ${capability}`,
        'Better Auth request export confinement issues',
      );
    }
  }

  return issues;
}

const betterAuthPlaintextReadingApiMethodSet = betterAuthStringSet(
  betterAuthPlaintextReadingApiMethods,
  'Better Auth plaintext-reading API methods',
);
const betterAuthNonPlaintextApiMethodSet = betterAuthStringSet(
  betterAuthNonPlaintextApiMethods,
  'Better Auth non-plaintext API methods',
);

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
  const usageFacts = betterAuthSnapshotDenseArray(usages, 'Better Auth plaintext API usages');

  for (let index = 0; index < usageFacts.length; index += 1) {
    const usage = usageFacts[index]!;
    const method = betterAuthStringField(
      usage,
      'method',
      `Better Auth plaintext API usage ${index}`,
    );
    const file = betterAuthStringField(usage, 'file', `Better Auth plaintext API usage ${index}`);
    const isPlaintext = betterAuthSetHas(betterAuthPlaintextReadingApiMethodSet, method);
    const isNonPlaintext = betterAuthSetHas(betterAuthNonPlaintextApiMethodSet, method);

    if (isPlaintext && isNonPlaintext) {
      betterAuthArrayAppend(
        issues,
        `KV439: auth.api.${method} is classified both plaintext-reading and non-plaintext`,
        'Better Auth plaintext API confinement issues',
      );
    }

    if (!isPlaintext && !isNonPlaintext) {
      betterAuthArrayAppend(
        issues,
        `KV439: unclassified Better Auth plaintext API auth.api.${method} in ${file}; ` +
          `classify it as plaintext-reading (confined to ${betterAuthTrustedPlaintextModule}) or ` +
          `allowlist it as non-plaintext with justification`,
        'Better Auth plaintext API confinement issues',
      );
      continue;
    }

    if (isPlaintext && file !== betterAuthTrustedPlaintextModule) {
      betterAuthArrayAppend(
        issues,
        `KV439: plaintext-reading Better Auth API auth.api.${method} used outside ` +
          `${betterAuthTrustedPlaintextModule} in ${file}`,
        'Better Auth plaintext API confinement issues',
      );
    }
  }

  return issues;
}

export function proveBetterAuthRequestSecretNonEgress(
  paths: readonly BetterAuthRequestSecretPath[] = pinnedBetterAuthRequestSecretPaths,
): string[] {
  const issues: string[] = [];
  const seen = betterAuthCreateSet<string>();
  const pathFacts = snapshotBetterAuthRequestSecretPaths(paths, 'Better Auth request secret paths');

  for (let index = 0; index < pathFacts.length; index += 1) {
    const path = pathFacts[index]!;
    if (betterAuthSetHas(seen, path.id)) {
      appendBetterAuthNonEgressIssue(
        issues,
        `KV439: duplicate Better Auth request secret path ${path.id}`,
      );
    }
    betterAuthSetAdd(seen, path.id);
    appendBetterAuthSecretPathIssues(issues, path);
  }

  return issues;
}

function appendBetterAuthSecretPathIssues(
  issues: string[],
  path: BetterAuthRequestSecretPath,
): void {
  if (
    path.readsCrossUserCredential &&
    !betterAuthSetHas(permittedCrossUserCredentialDispositions, path.disposition)
  ) {
    appendBetterAuthNonEgressIssue(
      issues,
      `KV439: ${path.id} reads a cross-user auth credential with unboxed disposition ${path.disposition}`,
    );
  }
  if (
    path.readsCrossUserCredential &&
    path.disposition === 'vetted-compare-or-verify' &&
    betterAuthTrim(path.reason).length === 0
  ) {
    appendBetterAuthNonEgressIssue(
      issues,
      `KV439: ${path.id} requires a compare/verify justification`,
    );
  }

  if (
    path.carrier === 'adapter-system-db-secret-column' &&
    !path.readsCrossUserCredential &&
    !betterAuthSetHas(permittedAdapterCredentialDispositions, path.disposition)
  ) {
    appendBetterAuthNonEgressIssue(
      issues,
      `KV439: ${path.id} handles an adapter auth credential with unconfined disposition ${path.disposition}`,
    );
  }

  if (path.disposition === 'boxed' && path.carrier !== 'adapter-system-db-secret-column') {
    appendBetterAuthNonEgressIssue(
      issues,
      `KV439: ${path.id} claims boxing for non-database auth secret carrier`,
    );
  }
  if (
    path.disposition === 'reconstructed-non-secret-projection' &&
    path.carrier !== 'adapter-system-db-secret-column'
  ) {
    appendBetterAuthNonEgressIssue(
      issues,
      `KV439: ${path.id} claims credential projection for non-database auth secret carrier`,
    );
  }
}

function appendBetterAuthNonEgressIssue(issues: string[], issue: string): void {
  betterAuthArrayAppend(issues, issue, 'Better Auth request secret non-egress issues');
}

function betterAuthStringSet<Value extends string>(
  values: readonly Value[],
  label: string,
): Set<Value> {
  const snapshot = betterAuthSnapshotDenseArray(values, label);
  const set = betterAuthCreateSet<Value>();
  for (let index = 0; index < snapshot.length; index += 1) {
    betterAuthSetAdd(set, snapshot[index]!);
  }
  return set;
}

function betterAuthObjectFact(value: unknown, label: string): object {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    throw new NativeTypeError(`${label} must be an object with own-data facts.`);
  }
  return value;
}

function betterAuthStringField(value: unknown, field: PropertyKey, label: string): string {
  const fact = betterAuthOwnDataValue(betterAuthObjectFact(value, label), field, label);
  if (typeof fact !== 'string') {
    throw new NativeTypeError(`${label}.${String(field)} must be text.`);
  }
  return fact;
}

function betterAuthBooleanField(value: unknown, field: PropertyKey, label: string): boolean {
  const fact = betterAuthOwnDataValue(betterAuthObjectFact(value, label), field, label);
  if (typeof fact !== 'boolean') {
    throw new NativeTypeError(`${label}.${String(field)} must be boolean.`);
  }
  return fact;
}

function snapshotBetterAuthRequestSecretPaths(
  paths: readonly BetterAuthRequestSecretPath[],
  label: string,
): BetterAuthRequestSecretPath[] {
  const input = betterAuthSnapshotDenseArray(paths, label);
  const snapshot: BetterAuthRequestSecretPath[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const path = input[index]!;
    const itemLabel = `${label}[${index}]`;
    betterAuthArrayAppend(
      snapshot,
      {
        carrier: betterAuthStringField(
          path,
          'carrier',
          itemLabel,
        ) as BetterAuthRequestSecretCarrier,
        disposition: betterAuthStringField(
          path,
          'disposition',
          itemLabel,
        ) as BetterAuthRequestSecretDisposition,
        entrypoint: betterAuthStringField(
          path,
          'entrypoint',
          itemLabel,
        ) as BetterAuthRequestSecretPath['entrypoint'],
        id: betterAuthStringField(path, 'id', itemLabel),
        readsCrossUserCredential: betterAuthBooleanField(
          path,
          'readsCrossUserCredential',
          itemLabel,
        ),
        reason: betterAuthStringField(path, 'reason', itemLabel),
        source: betterAuthStringField(path, 'source', itemLabel),
      },
      label,
    );
  }
  return snapshot;
}
import {
  betterAuthArrayAppend,
  betterAuthCreateSet,
  betterAuthDeepFreeze,
  betterAuthOwnDataValue,
  betterAuthSetAdd,
  betterAuthSetHas,
  betterAuthSnapshotDenseArray,
  betterAuthTrim,
} from './intrinsics.js';

const NativeError = Error;
const NativeTypeError = TypeError;
