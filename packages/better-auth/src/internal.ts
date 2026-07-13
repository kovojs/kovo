import { publicAccess, type Domain } from '@kovojs/server';
import {
  betterAuthAuthDomain,
  betterAuthCredentialMutationErrors,
  betterAuthCredentialMutationApis,
  betterAuthMountOperationContract,
  betterAuthOrganizationDomain,
  betterAuthRequiredCoreTables,
  betterAuthSchemaBridge,
  betterAuthSignInEmailInput,
  betterAuthSignOutInput,
  betterAuthSignUpEmailInput,
  betterAuthUserDomain,
  type BetterAuthCoreTable,
  type BetterAuthCredentialMutationApi,
  type BetterAuthCredentialMutationTouchGraph,
  type BetterAuthCredentialMutationTouchGraphOptions,
  type BetterAuthDbVerificationConfig,
  type BetterAuthDeclaredTableTouch,
  type BetterAuthGeneratedSchemaTable,
  type BetterAuthGeneratedSchemaTableDegradation,
  type BetterAuthGeneratedSchemaTableDegradationReason,
  type BetterAuthOAuthProviderSuccessorMetadataDegradation,
  type BetterAuthOperationContract,
  type BetterAuthOperationTableTouch,
  type BetterAuthPluginTableDegradation,
  type BetterAuthRequestLike,
  type BetterAuthResponseLike,
  type BetterAuthSchemaBridge,
  type BetterAuthSchemaBridgeAnnotation,
  type BetterAuthSchemaBridgeDomainAnnotation,
  type BetterAuthSchemaBridgeExtensions,
  type BetterAuthSchemaBridgeValidation,
  type BetterAuthSchemaBridgeValidationOptions,
  type BetterAuthSchemaSourceAnnotationOptions,
  type BetterAuthSchemaSourceAnnotationResult,
  type BetterAuthSchemaSourceDeclarationDegradation,
  type BetterAuthSchemaSourceDialect,
  type BetterAuthSchemaSourceGenerationOptions,
  type BetterAuthSchemaSourceGenerationResult,
  type BetterAuthSchemaSourcePluginTableDegradation,
  type BetterAuthSignInEmailLike,
  type BetterAuthSignOutLike,
  type BetterAuthSignUpEmailLike,
  type BetterAuthTable,
  type BetterAuthTouchDomain,
  type BetterAuthTouchGraphEntry,
  type BetterAuthTouchGraphSite,
  type BetterAuthUnavailablePluginMetadataDegradation,
} from './internal/contracts.js';
import {
  activeOrganization,
  credentialMutationDefinitionOptions as credentialMutationDefinitionOptionsForContract,
  forwardBetterAuthSetCookie,
  getBetterAuthSetCookie,
  isBetterAuthCredentialFailureError,
  isBetterAuthCredentialFailureResponse,
  isBetterAuthCredentialMutationTouchGraphOptions,
  redirectPath,
  resolveBetterAuthCredentialSuccess,
  setSessionRevocationClearSiteData,
  unauthenticatedGuardFailure,
  unauthorizedGuardFailure,
  type ActiveOrganizationRequest,
  type BetterAuthCredentialFailure,
  type BetterAuthCredentialMutationValue,
  type BetterAuthOrganizationRequest,
  type BetterAuthOrganizationSession,
} from './internal/credential.js';
import type { BetterAuthCredentialMutationInternalOptions } from './credential-options.js';
import { betterAuthOAuthProviderSuccessorImportPaths } from './internal/plugin-metadata.js';
import {
  betterAuthArrayAppend,
  betterAuthDefineOwnData,
  betterAuthOwnDataOption,
  betterAuthSnapshotDenseArray,
  betterAuthToLowerCase,
} from './internal/intrinsics.js';

// The package's 13 public symbols are authored in the honestly-named source files
// (`session.ts`, `mount.ts`, `mutations.ts`, `guards.ts`) and re-exported from the
// package root by `index.ts` (api-devex-fixes #6). They are re-exported here so the
// `./internal` subpath — and the colocated tests that import from it — keep resolving
// the same names; the `@internal` machinery below stays authored in this file.
export type * from './internal/contracts.js';
export { authed, role } from './guards.js';
export type { BetterAuthMountOptions } from './mount.js';
export { mount } from './mount.js';
export {
  betterAuthSignInEmailMutation,
  betterAuthSignOutMutation,
  betterAuthSignUpEmailMutation,
} from './mutations.js';
export type { BetterAuthSessionMapper, BetterAuthSessionPayload } from './session.js';
export { betterAuthSession } from './session.js';
export {
  betterAuthAuthDomain,
  betterAuthCredentialMutationApis,
  betterAuthCredentialMutationErrors,
  betterAuthMountOperationContract,
  betterAuthOrganizationDomain,
  betterAuthRequiredCoreTables,
  betterAuthSchemaBridge,
  betterAuthSignInEmailInput,
  betterAuthSignOutInput,
  betterAuthSignUpEmailInput,
  betterAuthUserDomain,
} from './internal/contracts.js';
export {
  activeOrganization,
  forwardBetterAuthSetCookie,
  getBetterAuthSetCookie,
  isBetterAuthCredentialFailureError,
  isBetterAuthCredentialFailureResponse,
  redirectPath,
  resolveBetterAuthCredentialSuccess,
  setSessionRevocationClearSiteData,
  unauthenticatedGuardFailure,
  unauthorizedGuardFailure,
} from './internal/credential.js';
export type {
  ActiveOrganizationRequest,
  BetterAuthCredentialFailure,
  BetterAuthCredentialMutationValue,
  BetterAuthOrganizationRequest,
  BetterAuthOrganizationSession,
} from './internal/credential.js';
export {
  betterAuthOAuthProviderSuccessorImportPaths,
  betterAuthPasskeyPluginMetadataImportPaths,
  betterAuthSsoPluginMetadataImportPaths,
} from './internal/plugin-metadata.js';
export type {
  BetterAuthCredentialMutationInternalOptions,
  BetterAuthCredentialMutationOptions,
} from './credential-options.js';

/** @internal Resolve the Kovo domain a Better Auth table is bridged into, or null when unbridged/exempt. */
export function betterAuthTableDomain(
  table: string,
  schemaBridge: BetterAuthSchemaBridgeExtensions = {},
): BetterAuthTouchDomain | null {
  const bridge = betterAuthSchemaBridgeAnnotation(
    table,
    createBetterAuthSchemaBridge(schemaBridge),
  );

  if (bridge === undefined) return null;

  return 'domain' in bridge ? bridge.domain : null;
}

/**
 * @internal Single Better Auth operation contract per credential API.
 *
 * SPEC.md §6.6/§10.1/§10.2/§11.2: Better Auth owns the SQL, so the adapter names the
 * operation once here and derives registry domains, touch-graph rows, verifier table
 * coverage, and default access facts from the schema bridge.
 */
export const betterAuthCredentialOperationContracts = {
  signInEmail: {
    access: publicAccess('better-auth email sign-in credential form'),
    api: 'signInEmail',
    csrf: 'checked',
    defaultKey: 'auth/sign-in',
    tableTouches: [{ table: 'session' }],
  },
  signOut: {
    access: publicAccess('better-auth current-browser credential revocation form'),
    api: 'signOut',
    csrf: 'checked',
    defaultKey: 'auth/sign-out',
    tableTouches: [{ table: 'session' }],
  },
  signUpEmail: {
    access: publicAccess('better-auth email sign-up credential form'),
    api: 'signUpEmail',
    csrf: 'checked',
    defaultKey: 'auth/sign-up',
    tableTouches: [{ table: 'user' }, { table: 'account' }, { table: 'session' }],
  },
} as const satisfies {
  [Api in BetterAuthCredentialMutationApi]: BetterAuthOperationContract<Api>;
};

/** @internal Derived `{ domain, table }` touches per Better Auth credential API. */
export const betterAuthCredentialMutationDeclaredTableTouches =
  deriveBetterAuthCredentialDeclaredTableTouches();

/** @internal Default Kovo domain touches per Better Auth credential API, derived from contracts. */
export const betterAuthCredentialMutationTouches = deriveBetterAuthCredentialMutationTouches();

/** @internal Default mutation keys per Better Auth credential API, derived from contracts. */
export const betterAuthCredentialMutationDefaultKeys =
  deriveBetterAuthCredentialMutationDefaultKeys();

function deriveBetterAuthCredentialMutationDefaultKeys(): Record<
  BetterAuthCredentialMutationApi,
  string
> {
  const result = {} as Record<BetterAuthCredentialMutationApi, string>;
  const apis = betterAuthSnapshotDenseArray(
    betterAuthCredentialMutationApis,
    'Better Auth credential mutation APIs',
  );
  for (let index = 0; index < apis.length; index += 1) {
    const api = apis[index]!;
    betterAuthDefineOwnData(
      result,
      api,
      betterAuthCredentialOperationContracts[api].defaultKey,
      'Better Auth credential mutation default keys',
    );
  }
  return result;
}

function betterAuthDomainHandle(domain: BetterAuthTouchDomain): Domain {
  if (domain === 'auth') return betterAuthAuthDomain;
  if (domain === 'organization') return betterAuthOrganizationDomain;
  return betterAuthUserDomain;
}

function betterAuthOperationTableTouches(
  api: BetterAuthCredentialMutationApi,
  overrides?: Partial<
    Record<BetterAuthCredentialMutationApi, readonly BetterAuthOperationTableTouch[]>
  >,
): readonly BetterAuthOperationTableTouch[] {
  return overrides?.[api] ?? betterAuthCredentialOperationContracts[api].tableTouches;
}

function deriveBetterAuthDeclaredTableTouches(
  api: BetterAuthCredentialMutationApi,
  options: {
    credentialMutationTableTouches?: Partial<
      Record<BetterAuthCredentialMutationApi, readonly BetterAuthOperationTableTouch[]>
    >;
    schemaBridge?: BetterAuthSchemaBridgeExtensions;
  } = {},
): BetterAuthDeclaredTableTouch[] {
  const schemaBridge = createBetterAuthSchemaBridge(options.schemaBridge);
  const touches = betterAuthSnapshotDenseArray(
    betterAuthOperationTableTouches(api, options.credentialMutationTableTouches),
    `Better Auth ${api} declared table touches`,
  );
  const declared: BetterAuthDeclaredTableTouch[] = [];
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches[index]!;
    const bridge = betterAuthSchemaBridgeAnnotation(touch.table, schemaBridge);
    if (bridge === undefined || !('domain' in bridge)) continue;
    betterAuthArrayAppend(
      declared,
      { domain: bridge.domain, table: touch.table },
      `Better Auth ${api} declared table touches`,
    );
  }
  return declared;
}

function deriveBetterAuthCredentialDeclaredTableTouches(
  options: {
    credentialMutationTableTouches?: Partial<
      Record<BetterAuthCredentialMutationApi, readonly BetterAuthOperationTableTouch[]>
    >;
    schemaBridge?: BetterAuthSchemaBridgeExtensions;
  } = {},
): Record<BetterAuthCredentialMutationApi, readonly BetterAuthDeclaredTableTouch[]> {
  const result = {} as Record<
    BetterAuthCredentialMutationApi,
    readonly BetterAuthDeclaredTableTouch[]
  >;
  const apis = betterAuthSnapshotDenseArray(
    betterAuthCredentialMutationApis,
    'Better Auth credential mutation APIs',
  );
  for (let index = 0; index < apis.length; index += 1) {
    const api = apis[index]!;
    result[api] = deriveBetterAuthDeclaredTableTouches(api, options);
  }
  return result;
}

function deriveBetterAuthCredentialMutationTouches(
  options: {
    credentialMutationTableTouches?: Partial<
      Record<BetterAuthCredentialMutationApi, readonly BetterAuthOperationTableTouch[]>
    >;
    schemaBridge?: BetterAuthSchemaBridgeExtensions;
  } = {},
): Record<BetterAuthCredentialMutationApi, readonly Domain[]> {
  const result = {} as Record<BetterAuthCredentialMutationApi, readonly Domain[]>;
  const apis = betterAuthSnapshotDenseArray(
    betterAuthCredentialMutationApis,
    'Better Auth credential mutation APIs',
  );
  for (let index = 0; index < apis.length; index += 1) {
    const api = apis[index]!;
    const domains = new Map<BetterAuthTouchDomain, Domain>();
    for (const touch of deriveBetterAuthDeclaredTableTouches(api, options)) {
      if (!domains.has(touch.domain))
        domains.set(touch.domain, betterAuthDomainHandle(touch.domain));
    }
    result[api] = [...domains.values()];
  }
  return result;
}

/** @internal Shared mutation definition facts for a Better Auth credential operation. */
export function credentialMutationDefinitionOptions<
  Key extends string,
  Request extends BetterAuthRequestLike,
  GuardedRequest extends Request,
>(
  api: BetterAuthCredentialMutationApi,
  options: BetterAuthCredentialMutationInternalOptions<Key, Request, GuardedRequest>,
) {
  return credentialMutationDefinitionOptionsForContract(options, {
    defaultAccess: betterAuthCredentialOperationContracts[api].access,
    touches: betterAuthCredentialMutationTouches[api],
  });
}

/** @internal Pre-built credential-mutation touch graph consumed by the P9 verifier. */
// Archived D5 auth plan B1 / SPEC.md §11.2: declared Better Auth table touches are
// materialized as verifier facts so library-internal writes can be checked by
// P9 observed-write instrumentation.
export const betterAuthCredentialMutationTouchGraph =
  createBetterAuthCredentialMutationTouchGraph();

/** @internal Pre-built db-verification config derived from the blessed schema bridge. */
export const betterAuthDbVerificationConfig = createBetterAuthDbVerificationConfig();

/** @internal Build a KV406 degradation fact for the unavailable OAuth-provider successor metadata. */
// Better Auth 1.6.17 deprecates `oidcProvider()` in favor of the successor
// package. SPEC.md §11.2 keeps successor-owned writes KV406 until its real
// table metadata and declared touches are pinned.
export function betterAuthOAuthProviderSuccessorMetadataDegradation(
  attemptedImports: readonly string[] = betterAuthOAuthProviderSuccessorImportPaths,
): BetterAuthOAuthProviderSuccessorMetadataDegradation {
  return {
    attemptedImports,
    diagnosticCode: 'KV406',
    legacyPlugin: 'oidcProvider',
    manualBridgeSteps: [
      'Install the Better Auth OAuth-provider successor package and inspect getAuthTables(auth.options) with that plugin enabled.',
      'If the successor reuses oauthApplication/oauthAccessToken/oauthConsent with userId ownership, keep the existing auth-domain bridge and pin the package metadata in conformance.',
      'If the successor adds or renames tables, add schema.ts kovo({ domain, key }) or kovo({ exempt: true }) annotations and declared Better Auth API touches before relying on runtime coverage.',
    ],
    message:
      '@better-auth/oauth-provider metadata is not available from the pinned Better Auth dependency set; successor OAuth-provider writes remain KV406 until a real metadata path is pinned.',
    packageName: '@better-auth/oauth-provider',
    reason: 'oauth-provider-successor-metadata-unavailable',
    schemaBridge: null,
    tableMetadata: null,
  };
}

/** @internal Build a KV406 degradation fact for a Better Auth plugin whose table metadata is unavailable. */
// SPEC.md §11.2: plugin writes whose real Better Auth metadata is unavailable
// cannot be represented by inferred table mappings. Keep them as KV406 facts
// until getAuthTables(auth.options) can be pinned for the installed package.
export function betterAuthUnavailablePluginMetadataDegradation(options: {
  attemptedImports: readonly string[];
  packageName: string;
  pluginName: string;
}): BetterAuthUnavailablePluginMetadataDegradation {
  return {
    attemptedImports: options.attemptedImports,
    diagnosticCode: 'KV406',
    manualBridgeSteps: [
      `Install a Better Auth ${options.pluginName} plugin package/export and inspect getAuthTables(auth.options) with that plugin enabled.`,
      'If the plugin exposes app-visible tables, add schema.ts kovo({ domain, key }) annotations and declared Better Auth API touches before relying on runtime coverage.',
      'If the plugin exposes only protocol/bookkeeping tables, add kovo({ exempt: true }) annotations with a SPEC.md §10.1 rationale and pin the metadata in conformance.',
    ],
    message: `${options.packageName} metadata is not available from the pinned Better Auth dependency set; ${options.pluginName} writes remain KV406 until real table metadata is pinned.`,
    packageName: options.packageName,
    pluginName: options.pluginName,
    reason: 'plugin-metadata-unavailable',
    schemaBridge: null,
    tableMetadata: null,
  };
}

/** @internal Build the credential-mutation touch graph (overload: key overrides per API). */
export function createBetterAuthCredentialMutationTouchGraph(
  keys?: Partial<Record<BetterAuthCredentialMutationApi, string>>,
): BetterAuthCredentialMutationTouchGraph;
export function createBetterAuthCredentialMutationTouchGraph(
  options?: BetterAuthCredentialMutationTouchGraphOptions,
): BetterAuthCredentialMutationTouchGraph;
export function createBetterAuthCredentialMutationTouchGraph(
  options:
    | BetterAuthCredentialMutationTouchGraphOptions
    | Partial<Record<BetterAuthCredentialMutationApi, string>> = {},
): BetterAuthCredentialMutationTouchGraph {
  const structuredOptions = isBetterAuthCredentialMutationTouchGraphOptions(options);
  const keyOverrides = structuredOptions
    ? (betterAuthOwnDataOption<Partial<Record<BetterAuthCredentialMutationApi, string>>>(
        options,
        'keys',
        'Better Auth credential touch-graph option keys',
      ) ?? {})
    : options;
  const tableTouches = structuredOptions
    ? betterAuthOwnDataOption<
        BetterAuthCredentialMutationTouchGraphOptions['credentialMutationTableTouches']
      >(
        options,
        'credentialMutationTableTouches',
        'Better Auth credential touch-graph option credentialMutationTableTouches',
      )
    : undefined;
  const schemaBridge = structuredOptions
    ? betterAuthOwnDataOption<BetterAuthSchemaBridgeExtensions>(
        options,
        'schemaBridge',
        'Better Auth credential touch-graph option schemaBridge',
      )
    : undefined;
  const apis = structuredOptions
    ? (betterAuthOwnDataOption<readonly BetterAuthCredentialMutationApi[]>(
        options,
        'apis',
        'Better Auth credential touch-graph option apis',
      ) ?? betterAuthCredentialMutationApis)
    : betterAuthCredentialMutationApis;
  const derivationOptions = {
    ...(tableTouches === undefined ? {} : { credentialMutationTableTouches: tableTouches }),
    ...(schemaBridge === undefined ? {} : { schemaBridge }),
  };
  const graph = {} as BetterAuthCredentialMutationTouchGraph;
  const selectedApis = betterAuthSnapshotDenseArray(
    apis,
    'Better Auth credential mutation touch-graph APIs',
  );
  for (let apiIndex = 0; apiIndex < selectedApis.length; apiIndex += 1) {
    const api = selectedApis[apiIndex]!;
    const declaredTouches = deriveBetterAuthDeclaredTableTouches(api, derivationOptions);
    const touches: BetterAuthTouchGraphSite[] = [];
    for (let touchIndex = 0; touchIndex < declaredTouches.length; touchIndex += 1) {
      const touch = declaredTouches[touchIndex]!;
      betterAuthArrayAppend(
        touches,
        {
          domain: touch.domain,
          // Better Auth owns the SQL; the P9 bridge verifies domain/table coverage
          // without pretending row-key predicates are available at this boundary.
          keys: null,
          site: `@kovojs/better-auth:${api}`,
          via: touch.table,
        },
        `Better Auth ${api} touch-graph sites`,
      );
    }
    const key =
      betterAuthOwnDataOption<string>(
        keyOverrides,
        api,
        `Better Auth credential touch-graph key ${api}`,
      ) ?? betterAuthCredentialMutationDefaultKeys[api];
    betterAuthDefineOwnData(
      graph,
      key,
      { touches, unresolved: [] },
      `Better Auth credential mutation touch graph ${key}`,
    );
  }
  return graph;
}

/** @internal Build the db-verification config (per-physical-table domain/key/exempt data). */
export function createBetterAuthDbVerificationConfig(
  schemaBridge: BetterAuthSchemaBridgeExtensions = {},
  tables: Record<string, unknown> = {},
): BetterAuthDbVerificationConfig {
  const bridge = createBetterAuthSchemaBridge(schemaBridge);
  const collidingPhysicalTables = betterAuthCollidingPhysicalTableNames(tables, bridge);
  const domainByTable: Record<string, BetterAuthTouchDomain> = {};
  const exemptTables: string[] = [];
  const keyByTable: Record<string, string> = {};

  for (const [table, annotation] of Object.entries(bridge)) {
    const candidates = betterAuthSnapshotDenseArray(
      betterAuthPhysicalTableNames(table, tables),
      `Better Auth ${table} physical table names`,
    );
    const physicalTables: string[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const physicalTable = candidates[index]!;
      if (!collidingPhysicalTables.has(physicalTable))
        betterAuthArrayAppend(
          physicalTables,
          physicalTable,
          `Better Auth ${table} physical table names`,
        );
    }

    if ('domain' in annotation) {
      for (const physicalTable of physicalTables) {
        betterAuthDefineOwnData(
          domainByTable,
          physicalTable,
          annotation.domain,
          'Better Auth verifier table domains',
        );
        if (annotation.key !== undefined)
          betterAuthDefineOwnData(
            keyByTable,
            physicalTable,
            annotation.key,
            'Better Auth verifier table keys',
          );
      }
    } else {
      for (let index = 0; index < physicalTables.length; index += 1) {
        betterAuthArrayAppend(
          exemptTables,
          physicalTables[index]!,
          'Better Auth verifier exempt tables',
        );
      }
    }
  }

  return {
    domainByTable,
    exemptTables: uniqueBetterAuthStrings(exemptTables, 'Better Auth verifier exempt tables'),
    keyByTable,
  };
}

function sortedBetterAuthStrings(values: readonly string[], label: string): string[] {
  const input = betterAuthSnapshotDenseArray(values, label);
  const sorted: string[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index]!;
    betterAuthArrayAppend(sorted, value, label);
    let insertion = sorted.length - 1;
    while (insertion > 0 && value < sorted[insertion - 1]!) {
      betterAuthDefineOwnData(sorted, insertion, sorted[insertion - 1]!, label);
      insertion -= 1;
    }
    betterAuthDefineOwnData(sorted, insertion, value, label);
  }
  return sorted;
}

function sortedUniqueBetterAuthStrings(values: readonly string[], label: string): string[] {
  const sorted = sortedBetterAuthStrings(values, label);
  const unique: string[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    if (index > 0 && sorted[index] === sorted[index - 1]) continue;
    betterAuthArrayAppend(unique, sorted[index]!, label);
  }
  return unique;
}

function uniqueBetterAuthStrings(values: readonly string[], label: string): string[] {
  const snapshot = betterAuthSnapshotDenseArray(values, label);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const value = snapshot[index]!;
    if (seen.has(value)) continue;
    seen.add(value);
    betterAuthArrayAppend(unique, value, label);
  }
  return unique;
}

function joinBetterAuthStrings(
  values: readonly string[],
  separator: string,
  label: string,
): string {
  const snapshot = betterAuthSnapshotDenseArray(values, label);
  let joined = '';
  for (let index = 0; index < snapshot.length; index += 1) {
    if (index > 0) joined += separator;
    joined += snapshot[index]!;
  }
  return joined;
}

function betterAuthSetStrings(values: ReadonlySet<string>, label: string): string[] {
  const snapshot: string[] = [];
  for (const value of values) betterAuthArrayAppend(snapshot, value, label);
  return snapshot;
}

function quoteBetterAuthStrings(values: readonly string[], label: string): string[] {
  const snapshot = betterAuthSnapshotDenseArray(values, label);
  const quoted: string[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    betterAuthArrayAppend(quoted, `'${snapshot[index]!}'`, label);
  }
  return quoted;
}

/** @internal Validate Better Auth table metadata against the schema bridge; reports KV406 gaps. */
export function validateBetterAuthSchemaBridge(
  tables: Record<string, unknown>,
  options: BetterAuthSchemaBridgeValidationOptions = {},
): BetterAuthSchemaBridgeValidation {
  const schemaBridge = createBetterAuthSchemaBridge(options.schemaBridge);
  const bridgeTables = betterAuthSnapshotDenseArray(
    Object.keys(schemaBridge),
    'Better Auth schema-bridge table names',
  );
  const tableKeys = betterAuthSnapshotDenseArray(
    Object.keys(tables),
    'Better Auth metadata table names',
  );
  const tableNames = new Set<string>();
  for (let index = 0; index < tableKeys.length; index += 1) tableNames.add(tableKeys[index]!);
  const bridgeTableNames = new Set<string>();
  for (let index = 0; index < bridgeTables.length; index += 1)
    bridgeTableNames.add(bridgeTables[index]!);
  const missingTables: BetterAuthCoreTable[] = [];
  const requiredTables = betterAuthSnapshotDenseArray(
    betterAuthRequiredCoreTables,
    'Better Auth required core tables',
  );
  for (let index = 0; index < requiredTables.length; index += 1) {
    const table = requiredTables[index]!;
    if (!tableNames.has(table))
      betterAuthArrayAppend(missingTables, table, 'Better Auth missing required tables');
  }
  const unsortedUnbridgedTables: string[] = [];
  for (let index = 0; index < tableKeys.length; index += 1) {
    const table = tableKeys[index]!;
    if (!bridgeTableNames.has(table))
      betterAuthArrayAppend(unsortedUnbridgedTables, table, 'Better Auth unbridged table names');
  }
  const unbridgedTables = sortedBetterAuthStrings(
    unsortedUnbridgedTables,
    'Better Auth unbridged table names',
  );
  const declaredTouchMismatches = declaredTableTouchMismatches(tableNames, {
    ...options,
    schemaBridge,
  });
  const unsortedKeyFieldMismatches: string[] = [];
  const keyMismatchGroups = [
    schemaBridgeKeyFieldMismatches(tables, schemaBridge),
    schemaBridgeExtensionCollisionMismatches(options.schemaBridge),
  ];
  for (let groupIndex = 0; groupIndex < keyMismatchGroups.length; groupIndex += 1) {
    const group = betterAuthSnapshotDenseArray(
      keyMismatchGroups[groupIndex]!,
      'Better Auth schema-bridge key mismatches',
    );
    for (let mismatchIndex = 0; mismatchIndex < group.length; mismatchIndex += 1) {
      betterAuthArrayAppend(
        unsortedKeyFieldMismatches,
        group[mismatchIndex]!,
        'Better Auth schema-bridge key mismatches',
      );
    }
  }
  const keyFieldMismatches = sortedBetterAuthStrings(
    unsortedKeyFieldMismatches,
    'Better Auth schema-bridge key mismatches',
  );
  const pluginTableDegradations: BetterAuthPluginTableDegradation[] = [];
  for (let index = 0; index < unbridgedTables.length; index += 1) {
    const table = unbridgedTables[index]!;
    betterAuthArrayAppend(
      pluginTableDegradations,
      unsupportedPluginTableDegradation(table, tables[table]),
      'Better Auth plugin table degradations',
    );
  }

  return {
    declaredTouchMismatches,
    keyFieldMismatches,
    missingTables,
    ok:
      missingTables.length === 0 &&
      unbridgedTables.length === 0 &&
      keyFieldMismatches.length === 0 &&
      declaredTouchMismatches.length === 0,
    pluginTableDegradations,
    unbridgedTables,
  };
}

/** @internal Annotate an app schema.ts source string with Better Auth Kovo domain/exempt annotations. */
// Archived D5 auth plan B1 / SPEC.md §14: Better Auth owns the SQL/table metadata, while
// the app-authored schema.ts must carry explicit Kovo domain/exempt annotations.
export function annotateBetterAuthSchemaSource(
  source: string,
  tables: Record<string, unknown>,
  options: BetterAuthSchemaSourceAnnotationOptions = {},
): BetterAuthSchemaSourceAnnotationResult {
  const schemaBridge = createBetterAuthSchemaBridge(options.schemaBridge);
  const validation = validateBetterAuthSchemaBridge(
    tables,
    options.schemaBridge === undefined ? {} : { schemaBridge: options.schemaBridge },
  );
  const metadataTables = new Set(
    Object.keys(tables).filter((table) => isBetterAuthSchemaTable(table, schemaBridge)),
  );
  const metadataTableByPhysicalName = betterAuthMetadataTableByPhysicalName(tables, schemaBridge);
  const sourceIr = parseBetterAuthSchemaSourceIr(source, options.tableFactories);
  const sourceTableCandidates = sourceIr.tableCallCandidates;
  const sourceTables = sourceIr.drizzleTableCalls;
  const unrecognizedSourceTables = unrecognizedBetterAuthSourceTableDeclarations(
    sourceTableCandidates,
    sourceTables,
    metadataTables,
    metadataTableByPhysicalName,
  );
  const unsupportedSourceTables = unsupportedBetterAuthSourceTableDeclarations(
    sourceTableCandidates,
    sourceTables,
    validation.pluginTableDegradations,
    tables,
  );
  const duplicateSourceTables = duplicateBetterAuthSourceTableNames(
    duplicateDrizzleTableNames(sourceTables),
    metadataTables,
    metadataTableByPhysicalName,
  );
  const replacements: { end: number; start: number; value: string }[] = [];
  const annotatedTables: string[] = [];
  const alreadyAnnotatedTables: string[] = [];
  const existingExtraConfigTables: string[] = [];
  const annotationImport = resolveBetterAuthSchemaAnnotationImport(
    source,
    sourceIr,
    options.annotationCallee,
  );
  const annotationCallee = annotationImport.localName;
  const hasRequiredImport = annotationImport.hasRequiredImport;

  for (const call of sourceTables) {
    const table = metadataTableByPhysicalName.get(call.tableName);
    if (table === undefined || !metadataTables.has(table)) continue;
    if (duplicateSourceTables.has(call.tableName)) continue;

    if (call.extraConfigText !== null) {
      if (
        isBetterAuthSchemaAnnotationText(
          call.extraConfigText,
          table,
          annotationCallee,
          schemaBridge,
          betterAuthTableFieldNames(tables[table]),
        )
      ) {
        alreadyAnnotatedTables.push(call.tableName);
      } else {
        existingExtraConfigTables.push(call.tableName);
      }
      continue;
    }

    replacements.push(
      betterAuthSchemaTableAnnotationReplacement(
        call,
        table,
        annotationCallee,
        schemaBridge,
        betterAuthTableFieldNames(tables[table]),
      ),
    );
    annotatedTables.push(call.tableName);
  }

  const sourceTableNames = new Set(sourceTables.map((call) => call.tableName));
  const missingSourceTables = [...metadataTables]
    .map((table) => betterAuthPhysicalTableName(table, tables[table]))
    .filter((table) => !sourceTableNames.has(table))
    .sort();
  const insertedImport = annotatedTables.length > 0 && !hasRequiredImport;
  const sourceReplacements = insertedImport
    ? [...replacements, betterAuthSchemaImportReplacement(source, annotationCallee)]
    : replacements;

  return {
    alreadyAnnotatedTables: sortedBetterAuthTables(alreadyAnnotatedTables),
    annotatedTables: sortedBetterAuthTables(annotatedTables),
    duplicateSourceTables: sortedBetterAuthTables([...duplicateSourceTables]),
    existingExtraConfigTables: [...new Set(existingExtraConfigTables)].sort(),
    importNote: {
      hasRequiredImport,
      insertedImport,
      localName: annotationCallee,
      shouldAddRequiredImport: false,
      suggestedImport: betterAuthSchemaImportStatement(annotationCallee),
    },
    missingSourceTables,
    requiredImport: {
      module: '@kovojs/drizzle',
      name: 'kovo',
    },
    source: applyBetterAuthSchemaSourceReplacements(source, sourceReplacements),
    unsupportedSourceTables,
    unrecognizedSourceTables,
    validation,
  };
}

/** @internal Generate an app schema.ts source string from Better Auth table metadata. */
// Archived D5 auth plan B1 / SPEC.md §10.1 and §11.2: generated app schema.ts is a
// convenience over real Better Auth metadata, not an inferred plugin mapper.
export function generateBetterAuthSchemaSource(
  tables: Record<string, unknown>,
  options: BetterAuthSchemaSourceGenerationOptions = {},
): BetterAuthSchemaSourceGenerationResult {
  const schemaBridge = createBetterAuthSchemaBridge(options.schemaBridge);
  const validation = validateBetterAuthSchemaBridge(
    tables,
    options.schemaBridge === undefined ? {} : { schemaBridge: options.schemaBridge },
  );
  const annotationCallee = options.annotationCallee ?? 'kovo';
  const dialect = options.dialect ?? 'postgres';
  const tableFactory = dialect === 'sqlite' ? 'sqliteTable' : 'pgTable';
  const drizzleCoreModule =
    dialect === 'sqlite' ? 'drizzle-orm/sqlite-core' : 'drizzle-orm/pg-core';
  const collidingPhysicalTables = betterAuthCollidingPhysicalTableNames(tables, schemaBridge);
  const generatedTables: BetterAuthGeneratedSchemaTable[] = [];
  const skippedTables: BetterAuthGeneratedSchemaTableDegradation[] = [];
  const declarations: string[] = [];
  const requiredBuilders = new Set<string>([tableFactory]);
  const exportNames = new Set<string>();

  for (const table of orderedBetterAuthMetadataTables(tables, schemaBridge)) {
    const annotation = betterAuthSchemaBridgeAnnotation(table, schemaBridge);
    if (annotation === undefined) continue;

    const metadata = tables[table];
    const physicalTable = betterAuthPhysicalTableName(table, metadata);
    const fieldNames = betterAuthTableFieldNames(metadata);

    if (collidingPhysicalTables.has(physicalTable)) {
      skippedTables.push(
        generatedSchemaTableDegradation({
          fields: fieldNames,
          message: `${betterAuthTableLabel(
            table,
            physicalTable,
          )} shares a physical table name with another Better Auth table; generate schema.ts manually after resolving the alias collision.`,
          physicalTable,
          reason: 'ambiguous-physical-table',
          table,
        }),
      );
      continue;
    }

    if (fieldNames === null) {
      skippedTables.push(
        generatedSchemaTableDegradation({
          fields: null,
          message: `${betterAuthTableLabel(
            table,
            physicalTable,
          )} cannot be generated because Better Auth table field metadata is unavailable.`,
          physicalTable,
          reason: 'table-field-metadata-unavailable',
          table,
        }),
      );
      continue;
    }

    if ('domain' in annotation && annotation.key !== undefined && !fieldNames.has(annotation.key)) {
      skippedTables.push(
        generatedSchemaTableDegradation({
          fields: fieldNames,
          field: annotation.key,
          message: `${betterAuthTableLabel(
            table,
            physicalTable,
          )} cannot be generated because schema-bridge key ${annotation.key} is absent from Better Auth field metadata.`,
          physicalTable,
          reason: 'schema-bridge-key-unavailable',
          table,
        }),
      );
      continue;
    }

    const columns = betterAuthGeneratedSchemaColumns(table, metadata, dialect);
    if ('degradation' in columns) {
      skippedTables.push(columns.degradation);
      continue;
    }

    for (const builder of columns.builders) requiredBuilders.add(builder);

    const exportName = uniqueBetterAuthSchemaExportName(table, exportNames);
    generatedTables.push({ exportName, physicalTable, table });
    declarations.push(
      renderBetterAuthGeneratedSchemaDeclaration({
        annotationCall: betterAuthSchemaAnnotationCall(
          table,
          annotationCallee,
          schemaBridge,
          fieldNames,
        ),
        columns: columns.columns,
        dialect,
        exportName,
        physicalTable,
        tableFactory,
      }),
    );
  }

  const drizzleImport = `import { ${[...requiredBuilders]
    .sort()
    .join(', ')} } from '${drizzleCoreModule}';`;
  const requiredImports = [betterAuthSchemaImportStatement(annotationCallee), drizzleImport];
  const source =
    declarations.length === 0
      ? ''
      : [...requiredImports, '', declarations.join('\n\n'), ''].join('\n');

  return {
    generatedTables,
    requiredImports,
    skippedTables: skippedTables.sort((left, right) => left.table.localeCompare(right.table)),
    source,
    unsupportedPluginTables: validation.pluginTableDegradations,
    validation,
  };
}

/**
 * Success value returned by the credential mutations: a `status` literal
 * (`'signed-in'` / `'signed-up'` / `'signed-out'`) and the same-origin `redirectTo`
 * target the framework redirects to after the mutation (SPEC.md §6.5).
 */
function declaredTableTouchMismatches(
  tableNames: ReadonlySet<string>,
  options: BetterAuthSchemaBridgeValidationOptions = {},
): string[] {
  const schemaBridge = createBetterAuthSchemaBridge(options.schemaBridge);
  const mismatches: string[] = [];

  const apis = betterAuthSnapshotDenseArray(
    betterAuthCredentialMutationApis,
    'Better Auth declared-touch validation APIs',
  );
  for (let apiIndex = 0; apiIndex < apis.length; apiIndex += 1) {
    const api = apis[apiIndex]!;
    const touches = betterAuthSnapshotDenseArray(
      options.credentialMutationTableTouches?.[api] ??
        betterAuthCredentialOperationContracts[api].tableTouches,
      `Better Auth ${api} declared-touch validation`,
    );
    const declaredTouchDomains: BetterAuthTouchDomain[] = [];

    for (let touchIndex = 0; touchIndex < touches.length; touchIndex += 1) {
      const touch = touches[touchIndex]!;
      if (!tableNames.has(touch.table)) {
        betterAuthArrayAppend(
          mismatches,
          `${api}.${touch.table} is declared touched but Better Auth table metadata is missing that table`,
          'Better Auth declared-touch mismatches',
        );
        continue;
      }

      const bridge = betterAuthSchemaBridgeAnnotation(touch.table, schemaBridge);

      if (bridge === undefined) {
        betterAuthArrayAppend(
          mismatches,
          `${api}.${touch.table} is declared touched but outside the Better Auth schema bridge`,
          'Better Auth declared-touch mismatches',
        );
        continue;
      }

      if (!('domain' in bridge)) {
        betterAuthArrayAppend(
          mismatches,
          `${api}.${touch.table} is declared touched but schema-bridge exempt`,
          'Better Auth declared-touch mismatches',
        );
        continue;
      }

      betterAuthArrayAppend(
        declaredTouchDomains,
        bridge.domain,
        `Better Auth ${api} declared-touch domains`,
      );
      const legacyDomain = (touch as Partial<BetterAuthDeclaredTableTouch>).domain;
      if (legacyDomain !== undefined && bridge.domain !== legacyDomain) {
        betterAuthArrayAppend(
          mismatches,
          `${api}.${touch.table} declares ${legacyDomain} but schema bridge maps ${bridge.domain}`,
          'Better Auth declared-touch mismatches',
        );
      }
    }

    const mutationTouches = deriveBetterAuthCredentialMutationTouches({
      ...(options.credentialMutationTableTouches === undefined
        ? {}
        : { credentialMutationTableTouches: options.credentialMutationTableTouches }),
      ...(options.schemaBridge === undefined ? {} : { schemaBridge: options.schemaBridge }),
    })[api];
    const mutationTouchDomains: string[] = [];
    for (let touchIndex = 0; touchIndex < mutationTouches.length; touchIndex += 1) {
      betterAuthArrayAppend(
        mutationTouchDomains,
        mutationTouches[touchIndex]!.key,
        `Better Auth ${api} mutation registry domains`,
      );
    }

    if (!sameSortedValues(declaredTouchDomains, mutationTouchDomains)) {
      betterAuthArrayAppend(
        mismatches,
        `${api} mutation registry domains ${formatDomainList(
          mutationTouchDomains,
        )} do not match declared table-touch domains ${formatDomainList(declaredTouchDomains)}`,
        'Better Auth declared-touch mismatches',
      );
    }
  }

  return sortedBetterAuthStrings(mismatches, 'Better Auth declared-touch mismatches');
}

function sameSortedValues(left: readonly string[], right: readonly string[]): boolean {
  const leftValues = sortedUniqueBetterAuthStrings(left, 'Better Auth declared-touch domains');
  const rightValues = sortedUniqueBetterAuthStrings(right, 'Better Auth mutation-touch domains');

  if (leftValues.length !== rightValues.length) return false;

  for (let index = 0; index < leftValues.length; index += 1) {
    if (leftValues[index] !== rightValues[index]) return false;
  }
  return true;
}

function formatDomainList(values: readonly string[]): string {
  const uniqueValues = sortedUniqueBetterAuthStrings(values, 'Better Auth domain list');

  return uniqueValues.length === 0
    ? '[]'
    : `[${joinBetterAuthStrings(uniqueValues, ', ', 'Better Auth domain list')}]`;
}

function schemaBridgeKeyFieldMismatches(
  tables: Record<string, unknown>,
  schemaBridge: BetterAuthSchemaBridgeExtensions = betterAuthSchemaBridge,
): string[] {
  const mismatches = betterAuthPhysicalTableNameCollisionMismatches(tables, schemaBridge);

  for (const [table, annotation] of Object.entries(schemaBridge)) {
    if (!('domain' in annotation) || annotation.key === undefined) continue;

    const fieldNames = betterAuthTableFieldNames(tables[table]);

    if (fieldNames === null) continue;
    if (fieldNames.has(annotation.key)) continue;

    betterAuthArrayAppend(
      mismatches,
      schemaBridgeKeyFieldMismatch(table, annotation.key, tables[table]),
      'Better Auth schema-bridge key mismatches',
    );
  }

  return sortedBetterAuthStrings(mismatches, 'Better Auth schema-bridge key mismatches');
}

function schemaBridgeKeyFieldMismatch(table: string, key: string, metadata: unknown): string {
  const physicalTable = betterAuthPhysicalTableName(table, metadata);
  const tableField =
    physicalTable === table
      ? `${table}.${key}`
      : `${table}.${key} (physical ${physicalTable}.${key})`;

  return `${tableField} is a schema-bridge key but Better Auth table metadata does not expose that field`;
}

function betterAuthPhysicalTableNameCollisionMismatches(
  tables: Record<string, unknown>,
  schemaBridge: BetterAuthSchemaBridgeExtensions = betterAuthSchemaBridge,
): string[] {
  const physicalTables = betterAuthPhysicalTableNameGroups(tables, schemaBridge);
  const mismatches: string[] = [];

  for (const [physicalTable, logicalTables] of physicalTables) {
    if (logicalTables.length < 2) continue;

    betterAuthArrayAppend(
      mismatches,
      `Better Auth tables ${joinBetterAuthStrings(
        logicalTables,
        ', ',
        'Better Auth colliding logical table names',
      )} resolve to the same physical table ${physicalTable}; modelName aliases must be unique for schema.ts annotations and P9 verification`,
      'Better Auth physical-table collision mismatches',
    );
  }

  return mismatches;
}

function betterAuthCollidingPhysicalTableNames(
  tables: Record<string, unknown>,
  schemaBridge: BetterAuthSchemaBridgeExtensions = betterAuthSchemaBridge,
): Set<string> {
  const collisions = new Set<string>();
  for (const [physicalTable, logicalTables] of betterAuthPhysicalTableNameGroups(
    tables,
    schemaBridge,
  )) {
    if (logicalTables.length > 1) collisions.add(physicalTable);
  }
  return collisions;
}

function betterAuthTableFieldNames(table: unknown): Set<string> | null {
  if (!table || typeof table !== 'object') return null;

  const fields = (table as { fields?: unknown }).fields;

  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;

  return new Set(['id', ...Object.keys(fields)]);
}

function unsupportedPluginTableDegradation(
  table: string,
  metadata: unknown,
): BetterAuthPluginTableDegradation {
  const fieldNames = betterAuthTableFieldNames(metadata);
  const physicalTable = betterAuthPhysicalTableName(table, metadata);
  const suggestedAnnotation = suggestedUnsupportedPluginTableAnnotation(fieldNames);

  return {
    diagnosticCode: 'KV406',
    fields:
      fieldNames === null
        ? null
        : sortedBetterAuthStrings(
            betterAuthSetStrings(fieldNames, 'Better Auth plugin table fields'),
            'Better Auth plugin table fields',
          ),
    manualBridgeSteps: unsupportedPluginTableManualBridgeSteps(
      table,
      physicalTable,
      fieldNames,
      suggestedAnnotation,
    ),
    message: `${betterAuthTableLabel(
      table,
      physicalTable,
    )} is outside the blessed Better Auth schema bridge; add a schema.ts domain/exempt annotation and declared touches before relying on runtime coverage.`,
    ...(physicalTable === table ? {} : { physicalTable }),
    reason: 'unsupported-plugin-table',
    suggestedAnnotation,
    table,
  };
}

function unsupportedPluginTableManualBridgeSteps(
  table: string,
  physicalTable: string,
  fields: Set<string> | null,
  suggestedAnnotation: BetterAuthSchemaBridgeAnnotation | null,
): string[] {
  const fieldList =
    fields === null
      ? 'unavailable from Better Auth metadata'
      : joinBetterAuthStrings(
          sortedBetterAuthStrings(
            betterAuthSetStrings(fields, 'Better Auth plugin table fields'),
            'Better Auth plugin table fields',
          ),
          ', ',
          'Better Auth plugin table fields',
        );
  const annotationStep =
    suggestedAnnotation === null
      ? 'If it is app-visible, add a schema.ts kovo({ domain, key }) annotation; otherwise add kovo({ exempt: true }) with a rationale.'
      : 'domain' in suggestedAnnotation
        ? `Likely app-visible ownership is kovo(${formatBetterAuthSchemaDomainAnnotation(
            suggestedAnnotation,
          )}); confirm before adding the bridge, otherwise use kovo({ exempt: true }) with a rationale.`
        : 'Likely Better Auth protocol/bookkeeping state is kovo({ exempt: true }); confirm the app never queries it before adding the bridge.';

  return [
    `Inspect ${betterAuthTableLabel(
      table,
      physicalTable,
    )} fields (${fieldList}) and decide whether the app reads this table.`,
    annotationStep,
    `Add declared Better Auth API touches for writes that can mutate ${table}; SPEC.md §11.2 keeps observed writes KV406 until declared coverage exists.`,
  ];
}

function betterAuthTableLabel(table: string, physicalTable: string): string {
  return physicalTable === table ? table : `${table} (physical ${physicalTable})`;
}

function suggestedUnsupportedPluginTableAnnotation(
  fields: Set<string> | null,
): BetterAuthSchemaBridgeAnnotation | null {
  if (fields === null) return null;
  if (isLikelyBetterAuthProtocolTable(fields)) {
    return {
      exempt: true,
      rationale:
        'Better Auth plugin protocol/bookkeeping state is not an app read surface under SPEC.md §10.1.',
    };
  }
  if (fields.has('organizationId')) return { domain: 'organization', key: 'organizationId' };
  if (fields.has('teamId')) return { domain: 'organization', key: 'teamId' };
  if (fields.has('userId'))
    return withBetterAuthSecretFields(fields, {
      domain: 'auth',
      key: 'userId',
    });

  return null;
}

function isLikelyBetterAuthProtocolTable(fields: ReadonlySet<string>): boolean {
  const nonIdFields: string[] = [];
  for (const field of fields) {
    if (field !== 'id')
      betterAuthArrayAppend(nonIdFields, field, 'Better Auth plugin protocol fields');
  }

  if (nonIdFields.length === 0) return false;
  let hasAnchor = false;
  for (let index = 0; index < nonIdFields.length; index += 1) {
    const field = nonIdFields[index]!;
    if (protocolStateAnchorFields.has(field)) hasAnchor = true;
    if (!protocolStateFields.has(field)) return false;
  }
  return hasAnchor;
}

const protocolStateAnchorFields = new Set(['challenge', 'code', 'deviceCode', 'token', 'value']);

const protocolStateFields = new Set([
  'challenge',
  'clientId',
  'code',
  'createdAt',
  'deviceCode',
  'expiresAt',
  'identifier',
  'lastPolledAt',
  'pollingInterval',
  'scope',
  'status',
  'token',
  'updatedAt',
  'userCode',
  'userId',
  'value',
]);

function formatBetterAuthSchemaDomainAnnotation(
  annotation: BetterAuthSchemaBridgeDomainAnnotation,
): string {
  const key = annotation.key === undefined ? '' : `, key: '${annotation.key}'`;
  const secret =
    annotation.secret === undefined || annotation.secret.length === 0
      ? ''
      : `, secret: [${joinBetterAuthStrings(
          quoteBetterAuthStrings(annotation.secret, 'Better Auth schema secret fields'),
          ', ',
          'Better Auth schema secret fields',
        )}]`;

  return `{ domain: '${annotation.domain}'${key}${secret} }`;
}

function betterAuthObservedSchemaAnnotation(
  annotation: BetterAuthSchemaBridgeDomainAnnotation,
  fields: ReadonlySet<string> | null,
): BetterAuthSchemaBridgeDomainAnnotation {
  if (fields === null) return annotation;

  const staticSecret = betterAuthSnapshotDenseArray(
    annotation.secret ?? [],
    'Better Auth static schema secret fields',
  );
  const classifiedSecret = betterAuthCredentialSecretFields(fields);
  const secret: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < staticSecret.length; index += 1) {
    const column = staticSecret[index]!;
    betterAuthArrayAppend(secret, column, 'Better Auth schema secret fields');
    seen.add(column);
  }

  for (const column of classifiedSecret) {
    if (seen.has(column)) continue;
    betterAuthArrayAppend(secret, column, 'Better Auth schema secret fields');
    seen.add(column);
  }

  return secret.length === 0 ? annotation : { ...annotation, secret };
}

function withBetterAuthSecretFields(
  fields: ReadonlySet<string>,
  annotation: BetterAuthSchemaBridgeDomainAnnotation,
): BetterAuthSchemaBridgeDomainAnnotation {
  return betterAuthObservedSchemaAnnotation(annotation, fields);
}

// SPEC.md §10.1 C10: security sets are allowlists with fail-closed defaults, never a hand-picked
// denylist of names. papercuts-36 P2: the old `betterAuthCredentialSecretFields` was a fixed
// 8-name denylist, so a plugin credential column outside those names — canonically the official
// apiKey plugin's `key` column, or a custom credential `additionalField` — escaped `secret:`
// classification and the KV406 bridge suggestion emitted it as an ordinary readable column.
//
// The rule is now POSITIVE and fail-closed: a plugin column whose final name segment is a
// credential noun defaults to `secret:` unless the author explicitly annotates it non-secret. New
// credential-shaped columns are classified secret by default rather than requiring a name edit.
const betterAuthCredentialColumnNouns = new Set<string>([
  'apikey',
  'apisecret',
  'backupcode',
  'backupcodes',
  'certificate',
  'code',
  'codes',
  'credential',
  'credentials',
  'hash',
  'key',
  'keys',
  'otp',
  'passcode',
  'passphrase',
  'password',
  'pin',
  'privatekey',
  'salt',
  'secret',
  'secrets',
  'seed',
  'signature',
  'token',
  'tokens',
]);

/**
 * @internal Split a Better Auth column name into lowercased word segments across camelCase and
 * non-alphanumeric boundaries. `refreshTokenExpiresAt` → `[refresh, token, expires, at]`.
 */
function betterAuthColumnSegments(column: string): string[] {
  const split = column
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/);
  const snapshot = betterAuthSnapshotDenseArray(split, 'Better Auth credential column segments');
  const segments: string[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const segment = snapshot[index]!;
    if (segment.length === 0) continue;
    betterAuthArrayAppend(
      segments,
      betterAuthToLowerCase(segment),
      'Better Auth credential column segments',
    );
  }
  return segments;
}

/**
 * @internal SPEC.md §10.1 C10: a column is credential-shaped when its final name segment is a
 * credential noun (the column *is* the secret). This is deliberately positive rather than a fixed
 * denylist: `key`, `apiKey`, `clientSecret`, `passwordHash`, `backupCodes` classify secret, while
 * metadata columns whose secret noun is a qualifier — `refreshTokenExpiresAt`, `keyId`,
 * `accessTokenCreatedAt` — end in a temporal/identifier segment and stay readable. Non-credential
 * columns (`name`, `createdAt`, `userId`, `provider`, `scope`, `prefix`) never match.
 */
export function isBetterAuthCredentialShapedColumn(column: string): boolean {
  const segments = betterAuthColumnSegments(column);
  if (segments.length === 0) return false;
  const last = segments[segments.length - 1];
  return last !== undefined && betterAuthCredentialColumnNouns.has(last);
}

/**
 * @internal Positive, fail-closed secret classifier for Better Auth plugin credential columns.
 * SPEC.md §10.1 C10 / papercuts-36 P2. Returns the sorted subset of `fields` that default to
 * `secret:` because they are credential-shaped, so the KV406 bridge suggestion never omits a
 * plausible credential column (e.g. apiKey `key`) without an explicit author override.
 */
export function betterAuthCredentialSecretFields(fields: ReadonlySet<string>): readonly string[] {
  const secretFields: string[] = [];
  for (const field of fields) {
    if (isBetterAuthCredentialShapedColumn(field))
      betterAuthArrayAppend(secretFields, field, 'Better Auth credential-shaped secret fields');
  }
  return sortedBetterAuthStrings(secretFields, 'Better Auth credential-shaped secret fields');
}

/**
 * @internal Known Better Auth plugin credential columns the positive classifier MUST cover.
 * SPEC.md §10.1 C10: the completeness test in `index.schema-bridge.test.ts` binds the classifier to
 * this set so a regression that stops classifying a real credential column fails closed (RED).
 */
export const betterAuthKnownPluginCredentialColumns = [
  'accessToken', // account / oauthAccessToken OAuth bearer credential
  'backupCodes', // twoFactor recovery codes
  'clientSecret', // oauthApplication registered client secret
  'idToken', // account OIDC id token
  'key', // apiKey plugin stored API-key credential
  'password', // account password hash
  'privateKey', // jwks signing-key material
  'refreshToken', // account / oauthAccessToken OAuth refresh credential
  'secret', // twoFactor TOTP shared secret
  'token', // session bearer credential
] as const;

/**
 * @internal Better Auth columns that MUST stay readable (never classified secret) — used by the
 * completeness test to prove the positive rule does not over-block ordinary owner-scoped columns.
 */
export const betterAuthKnownReadablePluginColumns = [
  'accessTokenExpiresAt',
  'createdAt',
  'expiresAt',
  'id',
  'ipAddress',
  'name',
  'prefix',
  'provider',
  'refreshTokenExpiresAt',
  'scope',
  'start',
  'updatedAt',
  'userId',
] as const;

const betterAuthSchemaTableNames = new Set<string>(Object.keys(betterAuthSchemaBridge));

function betterAuthSchemaBridgeAnnotation(
  table: string,
  schemaBridge: BetterAuthSchemaBridgeExtensions = betterAuthSchemaBridge,
): BetterAuthSchemaBridgeAnnotation | undefined {
  return schemaBridge[table];
}

function createBetterAuthSchemaBridge(
  extensions: BetterAuthSchemaBridgeExtensions = {},
): BetterAuthSchemaBridgeExtensions {
  return {
    ...extensions,
    ...betterAuthSchemaBridge,
  };
}

function schemaBridgeExtensionCollisionMismatches(
  extensions: BetterAuthSchemaBridgeExtensions = {},
): string[] {
  const builtInTables = new Set(Object.keys(betterAuthSchemaBridge));
  const collisions: string[] = [];
  const extensionTables = betterAuthSnapshotDenseArray(
    Object.keys(extensions),
    'Better Auth schema-bridge extension table names',
  );
  for (let index = 0; index < extensionTables.length; index += 1) {
    const table = extensionTables[index]!;
    if (!builtInTables.has(table)) continue;
    betterAuthArrayAppend(
      collisions,
      `${table} is a blessed Better Auth schema-bridge table; extension entries may only add plugin tables outside the built-in bridge`,
      'Better Auth schema-bridge extension collisions',
    );
  }
  return sortedBetterAuthStrings(collisions, 'Better Auth schema-bridge extension collisions');
}

function betterAuthPhysicalTableNames(table: string, tables: Record<string, unknown>): string[] {
  const physicalName = betterAuthPhysicalTableName(table, tables[table]);

  return physicalName === table ? [table] : [table, physicalName];
}

function betterAuthPhysicalTableName(table: string, metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') return table;

  const modelName = (metadata as { modelName?: unknown }).modelName;

  return typeof modelName === 'string' && modelName.length > 0 ? modelName : table;
}

function betterAuthMetadataTableByPhysicalName(
  tables: Record<string, unknown>,
  schemaBridge: BetterAuthSchemaBridgeExtensions = betterAuthSchemaBridge,
): Map<string, string> {
  const tableByPhysicalName = new Map<string, string>();
  const physicalTableGroups = betterAuthPhysicalTableNameGroups(tables, schemaBridge);

  for (const [physicalTable, logicalTables] of physicalTableGroups) {
    if (logicalTables.length !== 1) continue;

    tableByPhysicalName.set(physicalTable, logicalTables[0] ?? physicalTable);
  }

  return tableByPhysicalName;
}

function betterAuthPhysicalTableNameGroups(
  tables: Record<string, unknown>,
  schemaBridge: BetterAuthSchemaBridgeExtensions = betterAuthSchemaBridge,
): Map<string, string[]> {
  const physicalTables = new Map<string, string[]>();

  for (const table of Object.keys(tables)) {
    if (!isBetterAuthSchemaTable(table, schemaBridge)) continue;

    const physicalTable = betterAuthPhysicalTableName(table, tables[table]);
    const logicalTables = physicalTables.get(physicalTable) ?? [];
    betterAuthArrayAppend(logicalTables, table, `Better Auth ${physicalTable} logical table names`);
    physicalTables.set(
      physicalTable,
      sortedBetterAuthStrings(logicalTables, `Better Auth ${physicalTable} logical table names`),
    );
  }

  return physicalTables;
}

function orderedBetterAuthMetadataTables(
  tables: Record<string, unknown>,
  schemaBridge: BetterAuthSchemaBridgeExtensions = betterAuthSchemaBridge,
): string[] {
  return Object.keys(tables)
    .filter((table) => isBetterAuthSchemaTable(table, schemaBridge))
    .sort((left, right) => {
      const leftOrder = betterAuthTableOrder(tables[left]);
      const rightOrder = betterAuthTableOrder(tables[right]);

      return leftOrder === rightOrder
        ? betterAuthPhysicalTableName(left, tables[left]).localeCompare(
            betterAuthPhysicalTableName(right, tables[right]),
          )
        : leftOrder - rightOrder;
    });
}

function betterAuthTableOrder(metadata: unknown): number {
  if (!metadata || typeof metadata !== 'object') return Number.POSITIVE_INFINITY;

  const order = (metadata as { order?: unknown }).order;

  return typeof order === 'number' ? order : Number.POSITIVE_INFINITY;
}

interface BetterAuthSchemaSourceArgument {
  end: number;
  start: number;
  text: string;
}

interface DrizzleTableCall {
  arguments: BetterAuthSchemaSourceArgument[];
  callEnd: number;
  callStart: number;
  callee: string;
  closeParen: number;
  extraConfigText: null | string;
  tableName: string;
}

interface BetterAuthSchemaSourceIr {
  drizzleTableCalls: DrizzleTableCall[];
  localBindings: Set<string>;
  tableCallCandidates: DrizzleTableCall[];
}

type BetterAuthGeneratedSchemaFieldBuilder = 'boolean' | 'integer' | 'text' | 'timestamp';
type BetterAuthGeneratedSchemaFieldType = 'boolean' | 'date' | 'number' | 'string';

interface BetterAuthGeneratedSchemaColumnIr {
  builder: BetterAuthGeneratedSchemaFieldBuilder;
  columnName: string;
  field: string;
  fieldType: BetterAuthGeneratedSchemaFieldType;
  primaryKey: boolean;
  propertyName: string;
  required: boolean;
}

interface BetterAuthGeneratedSchemaColumnsIr {
  builders: Set<BetterAuthGeneratedSchemaFieldBuilder>;
  columns: BetterAuthGeneratedSchemaColumnIr[];
}

interface BetterAuthGeneratedSchemaDeclarationIr {
  annotationCall: string;
  columns: BetterAuthGeneratedSchemaColumnIr[];
  dialect: BetterAuthSchemaSourceDialect;
  exportName: string;
  physicalTable: string;
  tableFactory: string;
}

function betterAuthGeneratedSchemaColumns(
  table: string,
  metadata: unknown,
  dialect: BetterAuthSchemaSourceDialect,
): BetterAuthGeneratedSchemaColumnsIr | { degradation: BetterAuthGeneratedSchemaTableDegradation } {
  const fields = betterAuthTableFields(metadata);
  const physicalTable = betterAuthPhysicalTableName(table, metadata);

  if (fields === null) {
    return {
      degradation: generatedSchemaTableDegradation({
        fields: null,
        message: `${betterAuthTableLabel(
          table,
          physicalTable,
        )} cannot be generated because Better Auth table field metadata is unavailable.`,
        physicalTable,
        reason: 'table-field-metadata-unavailable',
        table,
      }),
    };
  }

  const idColumn = betterAuthGeneratedSchemaIdColumn(table, physicalTable, fields.id, dialect);

  if ('degradation' in idColumn) return idColumn;

  const columns = [idColumn.column];
  const builders = new Set<BetterAuthGeneratedSchemaFieldBuilder>([idColumn.builder]);

  for (const [field, fieldMetadata] of Object.entries(fields)) {
    if (field === 'id') continue;

    const column = betterAuthGeneratedSchemaColumn(
      table,
      physicalTable,
      field,
      fieldMetadata,
      dialect,
    );

    if ('degradation' in column) return column;

    builders.add(column.builder);
    columns.push(column.column);
  }

  return { builders, columns };
}

function betterAuthGeneratedSchemaIdColumn(
  table: string,
  physicalTable: string,
  metadata: unknown,
  dialect: BetterAuthSchemaSourceDialect,
):
  | {
      builder: BetterAuthGeneratedSchemaFieldBuilder;
      column: BetterAuthGeneratedSchemaColumnIr;
    }
  | { degradation: BetterAuthGeneratedSchemaTableDegradation } {
  if (metadata === undefined) {
    return {
      builder: 'text',
      column: {
        builder: 'text',
        columnName: 'id',
        field: 'id',
        fieldType: 'string',
        primaryKey: true,
        propertyName: 'id',
        required: true,
      },
    };
  }

  const type = betterAuthFieldType(metadata);
  const mapping = betterAuthGeneratedSchemaFieldMapping(type, dialect);
  const fieldNames = betterAuthTableFieldNames({ fields: { id: metadata } });

  if (mapping === null) {
    return {
      degradation: generatedSchemaTableDegradation({
        field: 'id',
        fields: fieldNames,
        message: `${betterAuthTableLabel(
          table,
          physicalTable,
        )} cannot be generated because field id has unsupported Better Auth type ${String(
          type ?? 'unavailable',
        )}.`,
        physicalTable,
        reason: 'unsupported-field-type',
        table,
      }),
    };
  }

  const columnName = betterAuthFieldName('id', metadata);

  return {
    builder: mapping.builder,
    column: {
      builder: mapping.builder,
      columnName,
      field: 'id',
      fieldType: mapping.fieldType,
      primaryKey: true,
      propertyName: 'id',
      required: true,
    },
  };
}

function betterAuthGeneratedSchemaColumn(
  table: string,
  physicalTable: string,
  field: string,
  metadata: unknown,
  dialect: BetterAuthSchemaSourceDialect,
):
  | {
      builder: BetterAuthGeneratedSchemaFieldBuilder;
      column: BetterAuthGeneratedSchemaColumnIr;
    }
  | { degradation: BetterAuthGeneratedSchemaTableDegradation } {
  const type = betterAuthFieldType(metadata);
  const mapping = betterAuthGeneratedSchemaFieldMapping(type, dialect);
  const fieldNames = betterAuthTableFieldNames({ fields: { [field]: metadata } });

  if (mapping === null) {
    return {
      degradation: generatedSchemaTableDegradation({
        field,
        fields: fieldNames,
        message: `${betterAuthTableLabel(
          table,
          physicalTable,
        )} cannot be generated because field ${field} has unsupported Better Auth type ${String(
          type ?? 'unavailable',
        )}.`,
        physicalTable,
        reason: 'unsupported-field-type',
        table,
      }),
    };
  }

  const columnName = betterAuthFieldName(field, metadata);
  const required = betterAuthFieldRequired(metadata);

  return {
    builder: mapping.builder,
    column: {
      builder: mapping.builder,
      columnName,
      field,
      fieldType: mapping.fieldType,
      primaryKey: false,
      propertyName: betterAuthSchemaObjectPropertyName(field),
      required,
    },
  };
}

function betterAuthTableFields(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') return null;

  const fields = (metadata as { fields?: unknown }).fields;

  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;

  return fields as Record<string, unknown>;
}

function betterAuthFieldType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;

  const type = (metadata as { type?: unknown }).type;

  return typeof type === 'string' ? type : null;
}

const betterAuthGeneratedSchemaFieldMappings = {
  boolean: {
    postgres: { builder: 'boolean' },
    sqlite: { builder: 'integer' },
  },
  date: {
    postgres: { builder: 'timestamp' },
    sqlite: { builder: 'text' },
  },
  number: {
    postgres: { builder: 'integer' },
    sqlite: { builder: 'integer' },
  },
  string: {
    postgres: { builder: 'text' },
    sqlite: { builder: 'text' },
  },
} as const satisfies Record<
  BetterAuthGeneratedSchemaFieldType,
  Record<BetterAuthSchemaSourceDialect, { builder: BetterAuthGeneratedSchemaFieldBuilder }>
>;

function betterAuthGeneratedSchemaFieldMapping(
  type: string | null,
  dialect: BetterAuthSchemaSourceDialect,
): {
  builder: BetterAuthGeneratedSchemaFieldBuilder;
  fieldType: BetterAuthGeneratedSchemaFieldType;
} | null {
  if (!isBetterAuthGeneratedSchemaFieldType(type)) return null;

  return {
    builder: betterAuthGeneratedSchemaFieldMappings[type][dialect].builder,
    fieldType: type,
  };
}

function isBetterAuthGeneratedSchemaFieldType(
  type: string | null,
): type is BetterAuthGeneratedSchemaFieldType {
  return type === 'boolean' || type === 'date' || type === 'number' || type === 'string';
}

function renderBetterAuthGeneratedSchemaDeclaration(
  declaration: BetterAuthGeneratedSchemaDeclarationIr,
): string {
  return [
    `export const ${declaration.exportName} = ${declaration.tableFactory}(${quoteTsString(
      declaration.physicalTable,
    )}, {`,
    ...declaration.columns.map(
      (column) => `  ${renderBetterAuthGeneratedSchemaColumn(column, declaration.dialect)}`,
    ),
    `}, ${declaration.annotationCall});`,
  ].join('\n');
}

function renderBetterAuthGeneratedSchemaColumn(
  column: BetterAuthGeneratedSchemaColumnIr,
  dialect: BetterAuthSchemaSourceDialect,
): string {
  const suffix = column.primaryKey ? '.primaryKey()' : column.required ? '.notNull()' : '';

  return `${column.propertyName}: ${betterAuthGeneratedSchemaColumnExpression(
    column.builder,
    column.columnName,
    column.fieldType,
    dialect,
  )}${suffix},`;
}

function betterAuthGeneratedSchemaColumnExpression(
  builder: BetterAuthGeneratedSchemaFieldBuilder,
  columnName: string,
  fieldType: BetterAuthGeneratedSchemaFieldType,
  dialect: BetterAuthSchemaSourceDialect,
): string {
  if (dialect === 'sqlite' && fieldType === 'boolean') {
    return `integer(${quoteTsString(columnName)}, { mode: 'boolean' })`;
  }

  return `${builder}(${quoteTsString(columnName)})`;
}

function betterAuthFieldName(field: string, metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') return field;

  const fieldName = (metadata as { fieldName?: unknown }).fieldName;

  if (typeof fieldName === 'string' && fieldName.length > 0) return fieldName;

  if (fieldName && typeof fieldName === 'object') {
    const nestedFieldName = (fieldName as { fieldName?: unknown }).fieldName;

    if (typeof nestedFieldName === 'string' && nestedFieldName.length > 0) {
      return nestedFieldName;
    }
  }

  return field;
}

function betterAuthFieldRequired(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;

  return (metadata as { required?: unknown }).required === true;
}

function generatedSchemaTableDegradation(options: {
  field?: string;
  fields: Set<string> | null;
  message: string;
  physicalTable: string;
  reason: BetterAuthGeneratedSchemaTableDegradationReason;
  table: string;
}): BetterAuthGeneratedSchemaTableDegradation {
  return {
    diagnosticCode: 'KV406',
    ...(options.field === undefined ? {} : { field: options.field }),
    fields: options.fields === null ? null : [...options.fields].sort(),
    manualBridgeSteps: generatedSchemaTableManualBridgeSteps(
      options.table,
      options.physicalTable,
      options.reason,
      options.field,
    ),
    message: options.message,
    ...(options.physicalTable === options.table ? {} : { physicalTable: options.physicalTable }),
    reason: options.reason,
    table: options.table,
  };
}

function generatedSchemaTableManualBridgeSteps(
  table: string,
  physicalTable: string,
  reason: BetterAuthGeneratedSchemaTableDegradationReason,
  field: string | undefined,
): string[] {
  const label = betterAuthTableLabel(table, physicalTable);
  const firstStep =
    reason === 'ambiguous-physical-table'
      ? `Resolve the Better Auth modelName collision for ${label} before generating schema.ts.`
      : `Inspect Better Auth metadata for ${label} and write the Drizzle declaration manually.`;
  const fieldStep =
    field === undefined
      ? 'Add the matching kovo({ domain, key }) or kovo({ exempt: true }) annotation once the table declaration is explicit.'
      : `Verify field ${field} in Better Auth metadata before adding the matching Kovo annotation.`;

  return [
    firstStep,
    fieldStep,
    'Keep observed writes KV406 until schema.ts and declared Better Auth API touches both cover the table under SPEC.md §11.2.',
  ];
}

function uniqueBetterAuthSchemaExportName(table: string, usedNames: Set<string>): string {
  const baseName = betterAuthSchemaExportIdentifier(table);
  let name = baseName;
  let index = 2;

  while (usedNames.has(name)) {
    name = `${baseName}${index}`;
    index += 1;
  }

  usedNames.add(name);

  return name;
}

function betterAuthSchemaExportIdentifier(table: string): string {
  if (isValidTypeScriptIdentifier(table) && !isReservedTypeScriptIdentifier(table)) return table;

  const words = table.split(/[^0-9A-Za-z_$]+/).filter((word) => word.length > 0);
  const suffix = words.map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`).join('');

  return suffix.length === 0 ? 'betterAuthTable' : `betterAuth${suffix}`;
}

function betterAuthSchemaObjectPropertyName(value: string): string {
  return isValidTypeScriptIdentifier(value) && !isReservedTypeScriptIdentifier(value)
    ? value
    : quoteTsString(value);
}

function isValidTypeScriptIdentifier(value: string): boolean {
  return /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(value);
}

const reservedTypeScriptIdentifiers = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
]);

function isReservedTypeScriptIdentifier(value: string): boolean {
  return reservedTypeScriptIdentifiers.has(value);
}

function isBetterAuthSchemaTable(
  table: string,
  schemaBridge: BetterAuthSchemaBridgeExtensions = betterAuthSchemaBridge,
): boolean {
  return betterAuthSchemaTableNames.has(table) || schemaBridge[table] !== undefined;
}

function sortedBetterAuthTables(tables: readonly string[]): string[] {
  return [...new Set(tables)].sort();
}

function duplicateDrizzleTableNames(calls: readonly DrizzleTableCall[]): Set<string> {
  const counts = new Map<string, number>();

  for (const call of calls) {
    counts.set(call.tableName, (counts.get(call.tableName) ?? 0) + 1);
  }

  return new Set([...counts].filter(([, count]) => count > 1).map(([tableName]) => tableName));
}

function duplicateBetterAuthSourceTableNames(
  duplicateTableNames: ReadonlySet<string>,
  metadataTables: ReadonlySet<string>,
  metadataTableByPhysicalName: ReadonlyMap<string, string>,
): Set<string> {
  return new Set(
    [...duplicateTableNames].filter((tableName) => {
      const metadataTable = metadataTableByPhysicalName.get(tableName);

      return metadataTable === undefined ? false : metadataTables.has(metadataTable);
    }),
  );
}

function unrecognizedBetterAuthSourceTableDeclarations(
  candidates: readonly DrizzleTableCall[],
  recognizedCalls: readonly DrizzleTableCall[],
  metadataTables: ReadonlySet<string>,
  metadataTableByPhysicalName: ReadonlyMap<string, string>,
): BetterAuthSchemaSourceDeclarationDegradation[] {
  const recognizedPhysicalTables = new Set(recognizedCalls.map((call) => call.tableName));
  const seen = new Set<string>();
  const degradations: BetterAuthSchemaSourceDeclarationDegradation[] = [];

  for (const candidate of candidates) {
    if (recognizedPhysicalTables.has(candidate.tableName)) continue;

    const table = metadataTableByPhysicalName.get(candidate.tableName);
    if (table === undefined || !metadataTables.has(table)) continue;

    const key = `${candidate.tableName}\0${candidate.callee}`;
    if (seen.has(key)) continue;
    seen.add(key);

    degradations.push(unrecognizedSchemaTableDeclarationDegradation(table, candidate));
  }

  return degradations.sort((left, right) =>
    left.table === right.table
      ? left.callee.localeCompare(right.callee)
      : left.table.localeCompare(right.table),
  );
}

function unsupportedBetterAuthSourceTableDeclarations(
  candidates: readonly DrizzleTableCall[],
  recognizedCalls: readonly DrizzleTableCall[],
  pluginTableDegradations: readonly BetterAuthPluginTableDegradation[],
  tables: Record<string, unknown>,
): BetterAuthSchemaSourcePluginTableDegradation[] {
  const recognizedSourceCalls = new Set(
    recognizedCalls.map((call) => sourceTableDeclarationKey(call.tableName, call.callee)),
  );
  const degradationsByPhysicalName = new Map<string, BetterAuthPluginTableDegradation[]>();
  const seen = new Set<string>();
  const degradations: BetterAuthSchemaSourcePluginTableDegradation[] = [];

  for (const degradation of pluginTableDegradations) {
    const physicalTable = betterAuthPhysicalTableName(degradation.table, tables[degradation.table]);
    const tableDegradations = degradationsByPhysicalName.get(physicalTable) ?? [];
    tableDegradations.push(degradation);
    degradationsByPhysicalName.set(physicalTable, tableDegradations);
  }

  for (const candidate of candidates) {
    const tableDegradations = degradationsByPhysicalName.get(candidate.tableName);
    if (tableDegradations === undefined) continue;

    const sourceFactory = recognizedSourceCalls.has(
      sourceTableDeclarationKey(candidate.tableName, candidate.callee),
    )
      ? 'recognized-drizzle-table'
      : 'unrecognized-table-factory';

    for (const degradation of tableDegradations) {
      const key = `${candidate.tableName}\0${candidate.callee}\0${degradation.table}`;
      if (seen.has(key)) continue;
      seen.add(key);

      degradations.push(
        unsupportedSchemaSourcePluginTableDegradation(degradation, candidate, sourceFactory),
      );
    }
  }

  return degradations.sort((left, right) =>
    left.table === right.table
      ? left.callee.localeCompare(right.callee)
      : left.table.localeCompare(right.table),
  );
}

function sourceTableDeclarationKey(tableName: string, callee: string): string {
  return `${tableName}\0${callee}`;
}

function unsupportedSchemaSourcePluginTableDegradation(
  degradation: BetterAuthPluginTableDegradation,
  call: DrizzleTableCall,
  sourceFactory: BetterAuthSchemaSourcePluginTableDegradation['sourceFactory'],
): BetterAuthSchemaSourcePluginTableDegradation {
  const physicalTable = call.tableName;
  const factoryLabel =
    sourceFactory === 'recognized-drizzle-table'
      ? `recognized Drizzle table factory ${call.callee}`
      : `unrecognized table factory ${call.callee}`;

  return {
    callee: call.callee,
    diagnosticCode: 'KV406',
    fields: degradation.fields,
    manualBridgeSteps: [
      `${betterAuthTableLabel(
        degradation.table,
        physicalTable,
      )} appears in schema.ts through ${factoryLabel}; the Better Auth adapter left it unannotated because it is outside the blessed schema bridge.`,
      ...degradation.manualBridgeSteps,
    ],
    message: `${betterAuthTableLabel(
      degradation.table,
      physicalTable,
    )} appears in schema.ts but is outside the blessed Better Auth schema bridge; the adapter did not synthesize a fabricated mapping.`,
    ...(physicalTable === degradation.table ? {} : { physicalTable }),
    reason: 'unsupported-plugin-table-source',
    sourceFactory,
    suggestedAnnotation: degradation.suggestedAnnotation,
    table: degradation.table,
  };
}

function unrecognizedSchemaTableDeclarationDegradation(
  table: string,
  call: DrizzleTableCall,
): BetterAuthSchemaSourceDeclarationDegradation {
  const physicalTable = call.tableName;

  return {
    callee: call.callee,
    diagnosticCode: 'KV406',
    manualBridgeSteps: [
      `Import the Drizzle table factory that declares ${physicalTable}, or pass it through tableFactories when the factory is intentionally wrapped.`,
      `Add the Better Auth kovo(...) annotation manually if ${call.callee} is not a Drizzle table factory.`,
      'Keep observed writes KV406 until schema.ts and declared Better Auth API touches both cover the table under SPEC.md §11.2.',
    ],
    message: `${betterAuthTableLabel(
      table,
      physicalTable,
    )} appears in schema.ts through unrecognized table factory ${call.callee}; the Better Auth adapter did not synthesize a schema annotation.`,
    ...(physicalTable === table ? {} : { physicalTable }),
    reason: 'unrecognized-schema-table-declaration',
    table,
  };
}

function betterAuthSchemaAnnotationCall(
  table: string,
  annotationCallee: string,
  schemaBridge: BetterAuthSchemaBridgeExtensions = betterAuthSchemaBridge,
  fields: ReadonlySet<string> | null = null,
): string {
  let annotation = betterAuthSchemaBridgeAnnotation(table, schemaBridge);

  if (annotation === undefined) {
    throw new Error(`${table} is outside the Better Auth schema bridge`);
  }

  if ('domain' in annotation) {
    annotation = betterAuthObservedSchemaAnnotation(annotation, fields);
    const key = annotation.key === undefined ? '' : `, key: ${quoteTsString(annotation.key)}`;
    // bugz-3 M6 / DEC-B (SPEC.md §10.1): emit static bridge secrets unioned with the positive
    // credential classifier over observed Better Auth fields, so KV435 covers plugin-added
    // credentials on already-bridged tables as well as unknown-plugin suggestions.
    const secret =
      annotation.secret === undefined || annotation.secret.length === 0
        ? ''
        : `, secret: [${annotation.secret.map((column) => quoteTsString(column)).join(', ')}]`;

    return `${annotationCallee}({ domain: ${quoteTsString(annotation.domain)}${key}${secret} })`;
  }

  return `${annotationCallee}({ exempt: true })`;
}

function isBetterAuthSchemaAnnotationText(
  text: string,
  table: string,
  annotationCallee: string,
  schemaBridge: BetterAuthSchemaBridgeExtensions = betterAuthSchemaBridge,
  fields: ReadonlySet<string> | null = null,
): boolean {
  return (
    compactSourceText(text) ===
    compactSourceText(betterAuthSchemaAnnotationCall(table, annotationCallee, schemaBridge, fields))
  );
}

function betterAuthSchemaTableAnnotationReplacement(
  call: DrizzleTableCall,
  table: string,
  annotationCallee: string,
  schemaBridge: BetterAuthSchemaBridgeExtensions = betterAuthSchemaBridge,
  fields: ReadonlySet<string> | null = null,
): { end: number; start: number; value: string } {
  return {
    end: call.callEnd,
    start: call.callStart,
    value: renderBetterAuthSchemaSourceTableCall(call, [
      ...call.arguments.map((argument) => argument.text.trim()),
      betterAuthSchemaAnnotationCall(table, annotationCallee, schemaBridge, fields),
    ]),
  };
}

function renderBetterAuthSchemaSourceTableCall(
  call: DrizzleTableCall,
  args: readonly string[],
): string {
  return `${call.callee}(${args.join(', ')})`;
}

function resolveBetterAuthSchemaAnnotationImport(
  source: string,
  sourceIr: BetterAuthSchemaSourceIr,
  requestedLocalName: string | undefined,
): { hasRequiredImport: boolean; localName: string } {
  if (requestedLocalName !== undefined) {
    return {
      hasRequiredImport: hasNamedImportLocal(source, '@kovojs/drizzle', 'kovo', requestedLocalName),
      localName: requestedLocalName,
    };
  }

  const existingLocalName = findNamedImportLocal(source, '@kovojs/drizzle', 'kovo');

  if (existingLocalName !== null) {
    return { hasRequiredImport: true, localName: existingLocalName };
  }

  return {
    hasRequiredImport: false,
    localName: uniqueBetterAuthSchemaAnnotationLocalName(sourceIr.localBindings),
  };
}

function uniqueBetterAuthSchemaAnnotationLocalName(localBindings: ReadonlySet<string>): string {
  if (!localBindings.has('kovo')) return 'kovo';

  const baseName = 'kovoSchema';
  let localName = baseName;
  let index = 2;

  while (localBindings.has(localName)) {
    localName = `${baseName}${index}`;
    index += 1;
  }

  return localName;
}

function betterAuthSchemaImportStatement(localName: string): string {
  const specifier = localName === 'kovo' ? 'kovo' : `kovo as ${localName}`;

  return `import { ${specifier} } from '@kovojs/drizzle';`;
}

function betterAuthSchemaImportReplacement(
  source: string,
  localName: string,
): { end: number; start: number; value: string } {
  const kovoDrizzleImport = findNamedImportFromModule(source, '@kovojs/drizzle');
  const specifier = localName === 'kovo' ? 'kovo' : `kovo as ${localName}`;

  if (kovoDrizzleImport !== null) {
    const existingSpecifiers = kovoDrizzleImport.specifiersText.trim();
    const specifiers =
      existingSpecifiers.length === 0 ? specifier : `${existingSpecifiers}, ${specifier}`;

    return {
      end: kovoDrizzleImport.specifiersEnd,
      start: kovoDrizzleImport.specifiersStart,
      value: ` ${specifiers} `,
    };
  }

  const firstImport = findFirstImport(source);
  const statement = `${betterAuthSchemaImportStatement(localName)}\n`;

  return {
    end: firstImport,
    start: firstImport,
    value: statement,
  };
}

function hasNamedImportLocal(
  source: string,
  moduleName: string,
  importedName: string,
  localName: string,
): boolean {
  return findNamedImportLocal(source, moduleName, importedName, localName) !== null;
}

function findNamedImportLocal(
  source: string,
  moduleName: string,
  importedName: string,
  preferredLocalName?: string,
): string | null {
  for (const namedImport of findNamedImports(source)) {
    if (stringLiteralValue(namedImport.moduleText) !== moduleName) continue;

    for (const specifier of namedImport.specifiersText.split(',')) {
      const parsed = namedImportSpecifier(specifier.trim());
      if (parsed?.imported !== importedName) continue;
      if (preferredLocalName !== undefined && parsed.local !== preferredLocalName) continue;

      return parsed.local;
    }
  }

  return null;
}

interface NamedImportMatch {
  moduleText: string;
  specifiersEnd: number;
  specifiersStart: number;
  specifiersText: string;
}

function findNamedImportFromModule(source: string, moduleName: string): NamedImportMatch | null {
  for (const namedImport of findNamedImports(source)) {
    if (stringLiteralValue(namedImport.moduleText) === moduleName) return namedImport;
  }

  return null;
}

function findNamedImports(source: string): NamedImportMatch[] {
  const imports: NamedImportMatch[] = [];
  const importPattern = /import\s*\{(?<specifiers>[^}]*)\}\s*from\s*(?<module>['"][^'"]+['"])/g;

  for (const match of source.matchAll(importPattern)) {
    const openBrace = match[0].indexOf('{');
    imports.push({
      moduleText: match.groups?.module ?? '',
      specifiersEnd: match.index + match[0].indexOf('}'),
      specifiersStart: match.index + openBrace + 1,
      specifiersText: match.groups?.specifiers ?? '',
    });
  }

  return imports;
}

interface NamespaceImportMatch {
  localName: string;
  moduleText: string;
}

function findNamespaceImports(source: string): NamespaceImportMatch[] {
  const imports: NamespaceImportMatch[] = [];
  const importPattern =
    /import\s+\*\s+as\s+(?<local>[A-Za-z_$][0-9A-Za-z_$]*)\s+from\s*(?<module>['"][^'"]+['"])/g;

  for (const match of source.matchAll(importPattern)) {
    imports.push({
      localName: match.groups?.local ?? '',
      moduleText: match.groups?.module ?? '',
    });
  }

  return imports;
}

function findFirstImport(source: string): number {
  const match = /^[ \t]*import\s/m.exec(source);

  return match?.index ?? 0;
}

interface NamedImportSpecifier {
  imported: string;
  local: string;
}

function namedImportSpecifier(specifier: string): NamedImportSpecifier | null {
  const match =
    /^(?<imported>[A-Za-z_$][0-9A-Za-z_$]*)(?:\s+as\s+(?<local>[A-Za-z_$][0-9A-Za-z_$]*))?$/.exec(
      specifier,
    );

  const imported = match?.groups?.imported;
  if (!imported) return null;

  return {
    imported,
    local: match.groups?.local ?? imported,
  };
}

function parseBetterAuthSchemaSourceIr(
  source: string,
  factories: readonly string[] = [],
): BetterAuthSchemaSourceIr {
  const tableCallCandidates = findSchemaTableCallCandidates(source);
  const factoryCallees = drizzleTableFactoryCallees(source, factories);
  const drizzleTableCalls = tableCallCandidates.filter((call) =>
    call.callee.includes('.')
      ? factoryCallees.members.has(call.callee)
      : factoryCallees.identifiers.has(call.callee),
  );

  return {
    drizzleTableCalls,
    localBindings: sourceLocalBindingNames(source),
    tableCallCandidates,
  };
}

function sourceLocalBindingNames(source: string): Set<string> {
  const names = new Set<string>();

  for (const namedImport of findNamedImports(source)) {
    for (const specifierText of namedImport.specifiersText.split(',')) {
      const specifier = namedImportSpecifier(specifierText.trim());
      if (specifier !== null) names.add(specifier.local);
    }
  }

  for (const namespaceImport of findNamespaceImports(source)) {
    names.add(namespaceImport.localName);
  }

  for (const defaultImport of findDefaultImportLocalNames(source)) {
    names.add(defaultImport);
  }

  for (const declaration of findTopLevelDeclarationLocalNames(source)) {
    names.add(declaration);
  }

  return names;
}

function findDefaultImportLocalNames(source: string): string[] {
  const names: string[] = [];
  const importPattern =
    /import\s+(?!type\b)(?<local>[A-Za-z_$][0-9A-Za-z_$]*)\s*(?:,|\s+from\s*['"][^'"]+['"])/g;

  for (const match of source.matchAll(importPattern)) {
    const localName = match.groups?.local;
    if (localName !== undefined) names.push(localName);
  }

  return names;
}

function findTopLevelDeclarationLocalNames(source: string): string[] {
  const names: string[] = [];
  const declarationPattern =
    /(?:^|[\n;])\s*(?:export\s+)?(?:const|let|var|function|class|enum|type|interface)\s+(?<local>[A-Za-z_$][0-9A-Za-z_$]*)/g;

  for (const match of source.matchAll(declarationPattern)) {
    const localName = match.groups?.local;
    if (localName !== undefined) names.push(localName);
  }

  return names;
}

function findSchemaTableCallCandidates(source: string): DrizzleTableCall[] {
  const calls: DrizzleTableCall[] = [];

  for (let index = 0; index < source.length; index += 1) {
    if (
      source[index] === '"' ||
      source[index] === "'" ||
      source[index] === '`' ||
      (source[index] === '/' && (source[index + 1] === '/' || source[index + 1] === '*'))
    ) {
      index = skipSourceToken(source, index) - 1;
      continue;
    }

    const identifier = readIdentifierAt(source, index);

    if (identifier === null) continue;

    const memberCallee = readMemberCalleeBefore(source, identifier);
    const calleeStart = memberCallee?.start ?? identifier.start;
    if (memberCallee === null && isIdentifierCharacter(source[identifier.start - 1] ?? '')) {
      continue;
    }
    if (!isLikelySchemaTableDeclaration(source, calleeStart)) continue;

    const openParen = skipWhitespace(source, identifier.end);
    if (source[openParen] !== '(') continue;

    const closeParen = findMatchingDelimiter(source, openParen, '(', ')');
    if (closeParen === -1) continue;

    const args = splitTopLevelArguments(source, openParen + 1, closeParen);
    const tableName = stringLiteralValue(args[0]?.text.trim() ?? '');

    if (tableName !== null) {
      calls.push({
        arguments: args,
        callEnd: closeParen + 1,
        callStart: calleeStart,
        callee: memberCallee?.value ?? identifier.value,
        closeParen,
        extraConfigText: args[2]?.text.trim() ?? null,
        tableName,
      });
    }

    index = closeParen;
  }

  return calls;
}

interface DrizzleTableFactoryCallees {
  identifiers: Set<string>;
  members: Set<string>;
}

const drizzleTableFactoryByModule = {
  'drizzle-orm/mysql-core': 'mysqlTable',
  'drizzle-orm/pg-core': 'pgTable',
  'drizzle-orm/sqlite-core': 'sqliteTable',
} as const;

function drizzleTableFactoryCallees(
  source: string,
  factories: readonly string[],
): DrizzleTableFactoryCallees {
  const identifiers = new Set(factories.filter((factory) => !factory.includes('.')));
  const members = new Set(factories.filter((factory) => factory.includes('.')));

  for (const namedImport of findNamedImports(source)) {
    const moduleName = stringLiteralValue(namedImport.moduleText);
    if (!isDrizzleCoreModule(moduleName)) continue;

    const moduleFactory = drizzleTableFactoryByModule[moduleName];
    for (const specifierText of namedImport.specifiersText.split(',')) {
      const specifier = namedImportSpecifier(specifierText.trim());
      if (specifier?.imported === moduleFactory) identifiers.add(specifier.local);
    }
  }

  for (const namespaceImport of findNamespaceImports(source)) {
    const moduleName = stringLiteralValue(namespaceImport.moduleText);
    if (!isDrizzleCoreModule(moduleName)) continue;

    members.add(`${namespaceImport.localName}.${drizzleTableFactoryByModule[moduleName]}`);
  }

  return { identifiers, members };
}

function isDrizzleCoreModule(
  moduleName: string | null,
): moduleName is keyof typeof drizzleTableFactoryByModule {
  return moduleName !== null && moduleName in drizzleTableFactoryByModule;
}

function readIdentifierAt(
  source: string,
  index: number,
): { end: number; start: number; value: string } | null {
  const first = source[index];
  if (!isIdentifierStart(first)) return null;

  let end = index + 1;
  while (end < source.length && isIdentifierCharacter(source[end])) end += 1;

  return {
    end,
    start: index,
    value: source.slice(index, end),
  };
}

function readMemberCalleeBefore(
  source: string,
  property: { start: number; value: string },
): { start: number; value: string } | null {
  const dot = skipWhitespaceBackward(source, property.start - 1);

  if (source[dot] !== '.') return null;

  const objectEnd = skipWhitespaceBackward(source, dot - 1) + 1;
  const objectStart = readIdentifierStartBefore(source, objectEnd);

  if (objectStart === null) return null;

  return {
    start: objectStart,
    value: `${source.slice(objectStart, objectEnd)}.${property.value}`,
  };
}

function readIdentifierStartBefore(source: string, end: number): number | null {
  if (!isIdentifierCharacter(source[end - 1] ?? '')) return null;

  let start = end - 1;
  while (start > 0 && isIdentifierCharacter(source[start - 1])) start -= 1;

  return isIdentifierStart(source[start]) ? start : null;
}

function isLikelySchemaTableDeclaration(source: string, calleeStart: number): boolean {
  const before = skipWhitespaceBackward(source, calleeStart - 1);

  return source[before] === '=';
}

function isIdentifierStart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z_$]/.test(char);
}

function isIdentifierCharacter(char: string | undefined): boolean {
  return char !== undefined && /[0-9A-Za-z_$]/.test(char);
}

function skipWhitespace(source: string, index: number): number {
  let next = index;

  while (/\s/.test(source[next] ?? '')) next += 1;

  return next;
}

function skipWhitespaceBackward(source: string, index: number): number {
  let next = index;

  while (next >= 0 && /\s/.test(source[next] ?? '')) next -= 1;

  return next;
}

function splitTopLevelArguments(
  source: string,
  start: number,
  end: number,
): { end: number; start: number; text: string }[] {
  const args: { end: number; start: number; text: string }[] = [];
  let argStart = start;
  let index = start;

  while (index < end) {
    const char = source[index];

    if (char === ',' && isTopLevelSeparator(source, start, index)) {
      args.push({ end: index, start: argStart, text: source.slice(argStart, index) });
      argStart = index + 1;
    }

    index = skipSourceToken(source, index);
  }

  args.push({ end, start: argStart, text: source.slice(argStart, end) });

  return args;
}

function isTopLevelSeparator(source: string, start: number, index: number): boolean {
  const stack: string[] = [];
  let cursor = start;

  while (cursor < index) {
    const char = source[cursor] ?? '';
    const matchingClose = closingDelimiterFor(char);

    if (matchingClose) {
      stack.push(matchingClose);
      cursor += 1;
      continue;
    }

    if (stack.length > 0 && char === stack[stack.length - 1]) {
      stack.pop();
      cursor += 1;
      continue;
    }

    cursor = skipSourceToken(source, cursor);
  }

  return stack.length === 0;
}

function findMatchingDelimiter(
  source: string,
  openIndex: number,
  open: string,
  close: string,
): number {
  let depth = 1;
  let index = openIndex + 1;

  while (index < source.length) {
    const char = source[index];

    if (char === open) {
      depth += 1;
      index += 1;
      continue;
    }

    if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
      index += 1;
      continue;
    }

    index = skipSourceToken(source, index);
  }

  return -1;
}

function skipSourceToken(source: string, index: number): number {
  const char = source[index];
  const next = source[index + 1];

  if (char === '"' || char === "'" || char === '`') return skipQuotedString(source, index, char);
  if (char === '/' && next === '/') return skipLineComment(source, index);
  if (char === '/' && next === '*') return skipBlockComment(source, index);

  return index + 1;
}

function skipQuotedString(source: string, index: number, quote: string): number {
  let next = index + 1;

  while (next < source.length) {
    if (source[next] === '\\') {
      next += 2;
      continue;
    }

    if (source[next] === quote) return next + 1;

    next += 1;
  }

  return source.length;
}

function skipLineComment(source: string, index: number): number {
  const newline = source.indexOf('\n', index + 2);

  return newline === -1 ? source.length : newline + 1;
}

function skipBlockComment(source: string, index: number): number {
  const close = source.indexOf('*/', index + 2);

  return close === -1 ? source.length : close + 2;
}

function closingDelimiterFor(char: string): string | null {
  if (char === '(') return ')';
  if (char === '[') return ']';
  if (char === '{') return '}';

  return null;
}

function stringLiteralValue(text: string): string | null {
  if (text.startsWith("'") || text.startsWith('"')) {
    try {
      return JSON.parse(text.replace(/^'/, '"').replace(/'$/, '"')) as string;
    } catch {
      return text.slice(1, -1);
    }
  }

  if (text.startsWith('`') && text.endsWith('`') && !text.includes('${')) {
    return text.slice(1, -1);
  }

  return null;
}

function quoteTsString(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function compactSourceText(source: string): string {
  return source.replace(/\s+/g, '');
}

function applyBetterAuthSchemaSourceReplacements(
  source: string,
  replacements: readonly { end: number; start: number; value: string }[],
): string {
  return [...replacements]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (next, range) => `${next.slice(0, range.start)}${range.value}${next.slice(range.end)}`,
      source,
    );
}
