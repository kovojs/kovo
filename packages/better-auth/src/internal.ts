// The internal export is executable too; it must join the same package-entry ordering witness.
import './internal/runtime-lock.js';

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
  betterAuthArrayIsArray,
  betterAuthCharacterCodeAt,
  betterAuthCreateMap,
  betterAuthCreateNullRecord,
  betterAuthCreateSet,
  betterAuthDefineOwnData,
  betterAuthDeepFreeze,
  betterAuthEndsWith,
  betterAuthFreezeOwn,
  betterAuthIncludes,
  betterAuthIndexOf,
  betterAuthIsSafeInteger,
  betterAuthJsonParse,
  betterAuthMapGet,
  betterAuthMapEntries,
  betterAuthMapHas,
  betterAuthMapSet,
  betterAuthMapValues,
  betterAuthObjectKeys,
  betterAuthOwnDataOption,
  betterAuthOwnDataValue,
  betterAuthRegExpExec,
  betterAuthRegExpMatches,
  betterAuthReplaceAll,
  betterAuthSetAdd,
  betterAuthSetHas,
  betterAuthSetValues,
  betterAuthSlice,
  betterAuthSplit,
  betterAuthSnapshotDenseArray,
  betterAuthStartsWith,
  betterAuthToLowerCase,
  betterAuthToUpperCase,
  betterAuthTrim,
} from './internal/intrinsics.js';

// Public symbols are authored in honestly named source files (`session.ts`, `mount.ts`,
// `mutations.ts`, `guards.ts`, and `postgres.ts`) and explicitly curated by the package root.
// The legacy shared symbols below are also re-exported here so the `./internal` subpath — and
// colocated tests that import from it — keep resolving the same names; the `@internal` machinery
// below stays authored in this file.
export type * from './internal/contracts.js';
export { authed, role } from './guards.js';
export type { BetterAuthMountOptions } from './mount.js';
export { mount } from './mount.js';
export {
  betterAuthSignInEmailMutation,
  betterAuthSignOutMutation,
  betterAuthSignUpEmailMutation,
} from './mutations.js';
export type {
  BetterAuthSafeField,
  BetterAuthSanitizedRecord,
  BetterAuthSanitizedSessionPayload,
  BetterAuthSanitizedValue,
  BetterAuthSessionMapper,
  BetterAuthSessionPayload,
} from './session.js';
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
export const betterAuthCredentialOperationContracts = betterAuthDeepFreeze(
  {
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
  },
  'Better Auth credential operation contracts',
);

/** @internal Derived `{ domain, table }` touches per Better Auth credential API. */
export const betterAuthCredentialMutationDeclaredTableTouches = betterAuthDeepFreeze(
  deriveBetterAuthCredentialDeclaredTableTouches(),
  'Better Auth credential mutation declared table touches',
);

/** @internal Default Kovo domain touches per Better Auth credential API, derived from contracts. */
export const betterAuthCredentialMutationTouches = betterAuthDeepFreeze(
  deriveBetterAuthCredentialMutationTouches(),
  'Better Auth credential mutation touches',
);

/** @internal Default mutation keys per Better Auth credential API, derived from contracts. */
export const betterAuthCredentialMutationDefaultKeys = betterAuthDeepFreeze(
  deriveBetterAuthCredentialMutationDefaultKeys(),
  'Better Auth credential mutation default keys',
);

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
  const override =
    overrides === undefined
      ? undefined
      : betterAuthOwnDataOption<readonly BetterAuthOperationTableTouch[]>(
          overrides,
          api,
          `Better Auth ${api} declared table touch override`,
        );
  return override ?? betterAuthCredentialOperationContracts[api].tableTouches;
}

function betterAuthOperationTouchTable(
  touch: BetterAuthOperationTableTouch,
  label: string,
): string {
  if (touch === null || typeof touch !== 'object' || betterAuthArrayIsArray(touch)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const table = betterAuthOwnDataOption<string>(touch, 'table', `${label}.table`);
  if (typeof table !== 'string' || table === '') {
    throw new TypeError(`${label}.table must be non-empty text.`);
  }
  return table;
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
    const table = betterAuthOperationTouchTable(
      touch,
      `Better Auth ${api} declared table touch ${index}`,
    );
    const bridge = betterAuthSchemaBridgeAnnotation(table, schemaBridge);
    if (bridge === undefined || !('domain' in bridge)) continue;
    betterAuthArrayAppend(
      declared,
      { domain: bridge.domain, table },
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
    const domains = betterAuthCreateMap<BetterAuthTouchDomain, Domain>();
    const touches = betterAuthSnapshotDenseArray(
      deriveBetterAuthDeclaredTableTouches(api, options),
      `Better Auth ${api} declared table touches`,
    );
    for (let touchIndex = 0; touchIndex < touches.length; touchIndex += 1) {
      const touch = touches[touchIndex]!;
      if (!betterAuthMapHas(domains, touch.domain)) {
        betterAuthMapSet(domains, touch.domain, betterAuthDomainHandle(touch.domain));
      }
    }
    result[api] = betterAuthMapValues(domains, `Better Auth ${api} mutation domains`);
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
export const betterAuthCredentialMutationTouchGraph = betterAuthDeepFreeze(
  createBetterAuthCredentialMutationTouchGraph(),
  'Better Auth credential mutation touch graph',
);

/** @internal Pre-built db-verification config derived from the blessed schema bridge. */
export const betterAuthDbVerificationConfig = betterAuthDeepFreeze(
  createBetterAuthDbVerificationConfig(),
  'Better Auth db verification config',
);

/** @internal Build a KV406 degradation fact for the unavailable OAuth-provider successor metadata. */
// Better Auth 1.6.17 deprecates `oidcProvider()` in favor of the successor
// package. SPEC.md §11.2 keeps successor-owned writes KV406 until its real
// table metadata and declared touches are pinned.
export function betterAuthOAuthProviderSuccessorMetadataDegradation(
  attemptedImports: readonly string[] = betterAuthOAuthProviderSuccessorImportPaths,
): BetterAuthOAuthProviderSuccessorMetadataDegradation {
  return betterAuthDeepFreeze(
    {
      attemptedImports: snapshotBetterAuthTextArray(
        attemptedImports,
        'Better Auth OAuth successor attempted imports',
      ),
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
    },
    'Better Auth OAuth successor metadata degradation',
  );
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
  assertBetterAuthOptionsObject(options, 'Better Auth unavailable plugin metadata options');
  const attemptedImports = betterAuthOwnDataOption<readonly string[]>(
    options,
    'attemptedImports',
    'Better Auth unavailable plugin metadata option attemptedImports',
  );
  const packageName = betterAuthOwnDataOption<string>(
    options,
    'packageName',
    'Better Auth unavailable plugin metadata option packageName',
  );
  const pluginName = betterAuthOwnDataOption<string>(
    options,
    'pluginName',
    'Better Auth unavailable plugin metadata option pluginName',
  );
  if (attemptedImports === undefined) {
    throw new TypeError('Better Auth unavailable plugin attemptedImports are required.');
  }
  if (typeof packageName !== 'string' || packageName.length === 0) {
    throw new TypeError('Better Auth unavailable plugin packageName must be non-empty text.');
  }
  if (typeof pluginName !== 'string' || pluginName.length === 0) {
    throw new TypeError('Better Auth unavailable plugin pluginName must be non-empty text.');
  }

  return betterAuthDeepFreeze(
    {
      attemptedImports: snapshotBetterAuthTextArray(
        attemptedImports,
        'Better Auth unavailable plugin attempted imports',
      ),
      diagnosticCode: 'KV406',
      manualBridgeSteps: [
        `Install a Better Auth ${pluginName} plugin package/export and inspect getAuthTables(auth.options) with that plugin enabled.`,
        'If the plugin exposes app-visible tables, add schema.ts kovo({ domain, key }) annotations and declared Better Auth API touches before relying on runtime coverage.',
        'If the plugin exposes only protocol/bookkeeping tables, add kovo({ exempt: true }) annotations with a SPEC.md §10.1 rationale and pin the metadata in conformance.',
      ],
      message: `${packageName} metadata is not available from the pinned Better Auth dependency set; ${pluginName} writes remain KV406 until real table metadata is pinned.`,
      packageName,
      pluginName,
      reason: 'plugin-metadata-unavailable',
      schemaBridge: null,
      tableMetadata: null,
    },
    `Better Auth ${pluginName} unavailable metadata degradation`,
  );
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
  const metadata = snapshotBetterAuthMetadataTables(tables, 'Better Auth verifier metadata tables');
  const collidingPhysicalTables = betterAuthCollidingVerifierTableNames(metadata, bridge);
  const domainByTable: Record<string, BetterAuthTouchDomain> = {};
  const exemptTables: string[] = [];
  const keyByTable: Record<string, string> = {};

  const bridgeTables = betterAuthObjectKeys(bridge, 'Better Auth verifier schema bridge');
  for (let tableIndex = 0; tableIndex < bridgeTables.length; tableIndex += 1) {
    const table = bridgeTables[tableIndex]!;
    const annotation = betterAuthOwnDataValue(
      bridge,
      table,
      'Better Auth verifier schema bridge',
    ) as BetterAuthSchemaBridgeAnnotation;
    const candidates = betterAuthSnapshotDenseArray(
      betterAuthPhysicalTableNames(table, metadata),
      `Better Auth ${table} physical table names`,
    );
    const physicalTables: string[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const physicalTable = candidates[index]!;
      if (!betterAuthSetHas(collidingPhysicalTables, physicalTable))
        betterAuthArrayAppend(
          physicalTables,
          physicalTable,
          `Better Auth ${table} physical table names`,
        );
    }

    if ('domain' in annotation) {
      for (let index = 0; index < physicalTables.length; index += 1) {
        const physicalTable = physicalTables[index]!;
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
  const seen = betterAuthCreateSet<string>();
  const unique: string[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const value = snapshot[index]!;
    if (betterAuthSetHas(seen, value)) continue;
    betterAuthSetAdd(seen, value);
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
  return betterAuthSetValues(values, label);
}

function snapshotBetterAuthTextArray(values: readonly string[], label: string): string[] {
  const snapshot = betterAuthSnapshotDenseArray<unknown>(values, label);
  const strings: string[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const value = snapshot[index];
    if (typeof value !== 'string') throw new TypeError(`${label} must contain only text.`);
    betterAuthArrayAppend(strings, value, label);
  }
  return strings;
}

function quoteBetterAuthStrings(values: readonly string[], label: string): string[] {
  const snapshot = betterAuthSnapshotDenseArray(values, label);
  const quoted: string[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    betterAuthArrayAppend(quoted, `'${snapshot[index]!}'`, label);
  }
  return quoted;
}

function quoteTsStrings(values: readonly string[]): string[] {
  const snapshot = betterAuthSnapshotDenseArray(
    values,
    'Better Auth schema annotation secret fields',
  );
  const quoted: string[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    betterAuthArrayAppend(
      quoted,
      quoteTsString(snapshot[index]!),
      'Better Auth schema annotation secret fields',
    );
  }
  return quoted;
}

function betterAuthSetFromStrings(values: readonly string[], label: string): Set<string> {
  const snapshot = betterAuthSnapshotDenseArray(values, label);
  const set = betterAuthCreateSet<string>();
  for (let index = 0; index < snapshot.length; index += 1) {
    betterAuthSetAdd(set, snapshot[index]!);
  }
  return set;
}

function betterAuthTableMetadata(tables: Record<string, unknown>, table: string): unknown {
  return betterAuthOwnDataValue(tables, table, 'Better Auth metadata tables');
}

function snapshotBetterAuthMetadataTables(
  tables: Record<string, unknown>,
  label: string,
): Record<string, unknown> {
  if (tables === null || typeof tables !== 'object' || betterAuthArrayIsArray(tables)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const snapshot = betterAuthCreateNullRecord<unknown>();
  const tableNames = betterAuthObjectKeys(tables, `${label} names`);
  for (let index = 0; index < tableNames.length; index += 1) {
    const table = tableNames[index]!;
    betterAuthDefineOwnData(
      snapshot,
      table,
      snapshotBetterAuthTableMetadata(
        betterAuthOwnDataValue(tables, table, label),
        `${label}.${table}`,
      ),
      label,
    );
  }
  return snapshot;
}

function snapshotBetterAuthTableMetadata(metadata: unknown, label: string): unknown {
  if (metadata === null || typeof metadata !== 'object' || betterAuthArrayIsArray(metadata)) {
    return metadata;
  }

  const snapshot = betterAuthCreateNullRecord<unknown>();
  betterAuthDefineOwnData(
    snapshot,
    'modelName',
    betterAuthOwnDataValue(metadata, 'modelName', label),
    label,
  );
  betterAuthDefineOwnData(
    snapshot,
    'order',
    betterAuthOwnDataValue(metadata, 'order', label),
    label,
  );
  const fields = betterAuthOwnDataValue(metadata, 'fields', label);
  betterAuthDefineOwnData(
    snapshot,
    'fields',
    snapshotBetterAuthFieldMetadataMap(fields, `${label}.fields`),
    label,
  );
  return snapshot;
}

function snapshotBetterAuthFieldMetadataMap(fields: unknown, label: string): unknown {
  if (fields === null || typeof fields !== 'object' || betterAuthArrayIsArray(fields)) {
    return fields;
  }

  const snapshot = betterAuthCreateNullRecord<unknown>();
  const fieldNames = betterAuthObjectKeys(fields, `${label} names`);
  for (let index = 0; index < fieldNames.length; index += 1) {
    const field = fieldNames[index]!;
    betterAuthDefineOwnData(
      snapshot,
      field,
      snapshotBetterAuthFieldMetadata(
        betterAuthOwnDataValue(fields, field, label),
        `${label}.${field}`,
      ),
      label,
    );
  }
  return snapshot;
}

function snapshotBetterAuthFieldMetadata(metadata: unknown, label: string): unknown {
  if (metadata === null || typeof metadata !== 'object' || betterAuthArrayIsArray(metadata)) {
    return metadata;
  }

  const snapshot = betterAuthCreateNullRecord<unknown>();
  betterAuthDefineOwnData(snapshot, 'type', betterAuthOwnDataValue(metadata, 'type', label), label);
  betterAuthDefineOwnData(
    snapshot,
    'required',
    betterAuthOwnDataValue(metadata, 'required', label),
    label,
  );
  const fieldName = betterAuthOwnDataValue(metadata, 'fieldName', label);
  betterAuthDefineOwnData(
    snapshot,
    'fieldName',
    snapshotBetterAuthNestedFieldName(fieldName, `${label}.fieldName`),
    label,
  );
  return snapshot;
}

function snapshotBetterAuthNestedFieldName(fieldName: unknown, label: string): unknown {
  if (fieldName === null || typeof fieldName !== 'object' || betterAuthArrayIsArray(fieldName)) {
    return fieldName;
  }

  const snapshot = betterAuthCreateNullRecord<unknown>();
  betterAuthDefineOwnData(
    snapshot,
    'fieldName',
    betterAuthOwnDataValue(fieldName, 'fieldName', label),
    label,
  );
  return snapshot;
}

function assertBetterAuthOptionsObject(options: object, label: string): void {
  if (options === null || typeof options !== 'object' || betterAuthArrayIsArray(options)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function compareBetterAuthStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareBetterAuthMetadataTables(
  left: string,
  right: string,
  tables: Record<string, unknown>,
): number {
  const leftMetadata = betterAuthTableMetadata(tables, left);
  const rightMetadata = betterAuthTableMetadata(tables, right);
  const leftOrder = betterAuthTableOrder(leftMetadata);
  const rightOrder = betterAuthTableOrder(rightMetadata);
  return leftOrder === rightOrder
    ? compareBetterAuthStrings(
        betterAuthPhysicalTableName(left, leftMetadata),
        betterAuthPhysicalTableName(right, rightMetadata),
      )
    : leftOrder - rightOrder;
}

function sortedBetterAuthGeneratedSchemaDegradations(
  values: readonly BetterAuthGeneratedSchemaTableDegradation[],
): BetterAuthGeneratedSchemaTableDegradation[] {
  const input = betterAuthSnapshotDenseArray(values, 'Better Auth skipped generated schema tables');
  const sorted: BetterAuthGeneratedSchemaTableDegradation[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index]!;
    betterAuthArrayAppend(sorted, value, 'Better Auth skipped generated schema tables');
    let insertion = sorted.length - 1;
    while (
      insertion > 0 &&
      compareBetterAuthStrings(value.table, sorted[insertion - 1]!.table) < 0
    ) {
      betterAuthDefineOwnData(
        sorted,
        insertion,
        sorted[insertion - 1]!,
        'Better Auth skipped generated schema tables',
      );
      insertion -= 1;
    }
    betterAuthDefineOwnData(
      sorted,
      insertion,
      value,
      'Better Auth skipped generated schema tables',
    );
  }
  return sorted;
}

function sortedBetterAuthSourceDeclarationDegradations(
  values: readonly BetterAuthSchemaSourceDeclarationDegradation[],
): BetterAuthSchemaSourceDeclarationDegradation[] {
  const input = betterAuthSnapshotDenseArray(
    values,
    'Better Auth schema source declaration degradations',
  );
  const sorted: BetterAuthSchemaSourceDeclarationDegradation[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index]!;
    betterAuthArrayAppend(sorted, value, 'Better Auth schema source declaration degradations');
    let insertion = sorted.length - 1;
    while (insertion > 0 && compareBetterAuthSourceDegradation(value, sorted[insertion - 1]!) < 0) {
      betterAuthDefineOwnData(
        sorted,
        insertion,
        sorted[insertion - 1]!,
        'Better Auth schema source declaration degradations',
      );
      insertion -= 1;
    }
    betterAuthDefineOwnData(
      sorted,
      insertion,
      value,
      'Better Auth schema source declaration degradations',
    );
  }
  return sorted;
}

function sortedBetterAuthSourcePluginDegradations(
  values: readonly BetterAuthSchemaSourcePluginTableDegradation[],
): BetterAuthSchemaSourcePluginTableDegradation[] {
  const input = betterAuthSnapshotDenseArray(
    values,
    'Better Auth schema source plugin degradations',
  );
  const sorted: BetterAuthSchemaSourcePluginTableDegradation[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index]!;
    betterAuthArrayAppend(sorted, value, 'Better Auth schema source plugin degradations');
    let insertion = sorted.length - 1;
    while (insertion > 0 && compareBetterAuthSourceDegradation(value, sorted[insertion - 1]!) < 0) {
      betterAuthDefineOwnData(
        sorted,
        insertion,
        sorted[insertion - 1]!,
        'Better Auth schema source plugin degradations',
      );
      insertion -= 1;
    }
    betterAuthDefineOwnData(
      sorted,
      insertion,
      value,
      'Better Auth schema source plugin degradations',
    );
  }
  return sorted;
}

function compareBetterAuthSourceDegradation(
  left: { callee: string; table: string },
  right: { callee: string; table: string },
): number {
  return left.table === right.table
    ? compareBetterAuthStrings(left.callee, right.callee)
    : compareBetterAuthStrings(left.table, right.table);
}

/** @internal Validate Better Auth table metadata against the schema bridge; reports KV406 gaps. */
export function validateBetterAuthSchemaBridge(
  tables: Record<string, unknown>,
  options: BetterAuthSchemaBridgeValidationOptions = {},
): BetterAuthSchemaBridgeValidation {
  assertBetterAuthOptionsObject(options, 'Better Auth schema-bridge validation options');
  const schemaBridgeExtensions = betterAuthOwnDataOption<BetterAuthSchemaBridgeExtensions>(
    options,
    'schemaBridge',
    'Better Auth schema-bridge validation option schemaBridge',
  );
  const credentialMutationTableTouches = betterAuthOwnDataOption<
    BetterAuthSchemaBridgeValidationOptions['credentialMutationTableTouches']
  >(
    options,
    'credentialMutationTableTouches',
    'Better Auth schema-bridge validation option credentialMutationTableTouches',
  );
  const metadataTables = snapshotBetterAuthMetadataTables(
    tables,
    'Better Auth schema-bridge metadata tables',
  );
  const schemaBridge = createBetterAuthSchemaBridge(schemaBridgeExtensions);
  const bridgeTables = betterAuthObjectKeys(schemaBridge, 'Better Auth schema-bridge table names');
  const tableKeys = betterAuthObjectKeys(metadataTables, 'Better Auth metadata table names');
  const tableNames = betterAuthCreateSet<string>();
  for (let index = 0; index < tableKeys.length; index += 1) {
    betterAuthSetAdd(tableNames, tableKeys[index]!);
  }
  const bridgeTableNames = betterAuthCreateSet<string>();
  for (let index = 0; index < bridgeTables.length; index += 1)
    betterAuthSetAdd(bridgeTableNames, bridgeTables[index]!);
  const missingTables: BetterAuthCoreTable[] = [];
  const requiredTables = betterAuthSnapshotDenseArray(
    betterAuthRequiredCoreTables,
    'Better Auth required core tables',
  );
  for (let index = 0; index < requiredTables.length; index += 1) {
    const table = requiredTables[index]!;
    if (!betterAuthSetHas(tableNames, table))
      betterAuthArrayAppend(missingTables, table, 'Better Auth missing required tables');
  }
  const unsortedUnbridgedTables: string[] = [];
  for (let index = 0; index < tableKeys.length; index += 1) {
    const table = tableKeys[index]!;
    if (!betterAuthSetHas(bridgeTableNames, table))
      betterAuthArrayAppend(unsortedUnbridgedTables, table, 'Better Auth unbridged table names');
  }
  const unbridgedTables = sortedBetterAuthStrings(
    unsortedUnbridgedTables,
    'Better Auth unbridged table names',
  );
  const declaredTouchMismatches = declaredTableTouchMismatches(tableNames, {
    ...(credentialMutationTableTouches === undefined ? {} : { credentialMutationTableTouches }),
    schemaBridge,
  });
  const unsortedKeyFieldMismatches: string[] = [];
  const keyMismatchGroups = [
    schemaBridgeKeyFieldMismatches(metadataTables, schemaBridge),
    schemaBridgeExtensionCollisionMismatches(schemaBridgeExtensions),
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
      unsupportedPluginTableDegradation(table, betterAuthTableMetadata(metadataTables, table)),
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
  if (typeof source !== 'string') throw new TypeError('Better Auth schema source must be text.');
  assertBetterAuthOptionsObject(options, 'Better Auth schema source annotation options');
  const schemaBridgeExtensions = betterAuthOwnDataOption<BetterAuthSchemaBridgeExtensions>(
    options,
    'schemaBridge',
    'Better Auth schema source option schemaBridge',
  );
  const requestedAnnotationCallee = betterAuthOwnDataOption<string>(
    options,
    'annotationCallee',
    'Better Auth schema source option annotationCallee',
  );
  const configuredTableFactories = betterAuthOwnDataOption<readonly string[]>(
    options,
    'tableFactories',
    'Better Auth schema source option tableFactories',
  );
  if (
    requestedAnnotationCallee !== undefined &&
    !isValidTypeScriptIdentifier(requestedAnnotationCallee)
  ) {
    throw new TypeError('Better Auth annotationCallee must be a TypeScript identifier.');
  }
  const tableFactories = betterAuthSnapshotDenseArray(
    configuredTableFactories ?? [],
    'Better Auth schema source table factories',
  );
  const metadata = snapshotBetterAuthMetadataTables(
    tables,
    'Better Auth schema source metadata tables',
  );
  const schemaBridge = createBetterAuthSchemaBridge(schemaBridgeExtensions);
  const validation = validateBetterAuthSchemaBridge(
    metadata,
    schemaBridgeExtensions === undefined ? {} : { schemaBridge: schemaBridgeExtensions },
  );
  const metadataTables = betterAuthCreateSet<string>();
  const metadataTableNames = betterAuthObjectKeys(metadata, 'Better Auth metadata table names');
  for (let index = 0; index < metadataTableNames.length; index += 1) {
    const table = metadataTableNames[index]!;
    if (isBetterAuthSchemaTable(table, schemaBridge)) betterAuthSetAdd(metadataTables, table);
  }
  const metadataTableByPhysicalName = betterAuthMetadataTableByPhysicalName(metadata, schemaBridge);
  const sourceIr = parseBetterAuthSchemaSourceIr(source, tableFactories);
  const sourceTableCandidates = sourceIr.tableCallCandidates;
  const sourceTables = betterAuthSnapshotDenseArray(
    sourceIr.drizzleTableCalls,
    'Better Auth schema source table calls',
  );
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
    metadata,
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
    requestedAnnotationCallee,
  );
  const annotationCallee = annotationImport.localName;
  const hasRequiredImport = annotationImport.hasRequiredImport;

  for (let callIndex = 0; callIndex < sourceTables.length; callIndex += 1) {
    const call = sourceTables[callIndex]!;
    const table = betterAuthMapGet(metadataTableByPhysicalName, call.tableName);
    if (table === undefined || !betterAuthSetHas(metadataTables, table)) continue;
    if (betterAuthSetHas(duplicateSourceTables, call.tableName)) continue;

    if (call.extraConfigText !== null) {
      if (
        isBetterAuthSchemaAnnotationText(
          call.extraConfigText,
          table,
          annotationCallee,
          schemaBridge,
          betterAuthTableFieldNames(betterAuthTableMetadata(metadata, table)),
        )
      ) {
        betterAuthArrayAppend(
          alreadyAnnotatedTables,
          call.tableName,
          'Better Auth already annotated source tables',
        );
      } else {
        betterAuthArrayAppend(
          existingExtraConfigTables,
          call.tableName,
          'Better Auth source tables with extra config',
        );
      }
      continue;
    }

    betterAuthArrayAppend(
      replacements,
      betterAuthSchemaTableAnnotationReplacement(
        call,
        table,
        annotationCallee,
        schemaBridge,
        betterAuthTableFieldNames(betterAuthTableMetadata(metadata, table)),
      ),
      'Better Auth schema source replacements',
    );
    betterAuthArrayAppend(annotatedTables, call.tableName, 'Better Auth annotated source tables');
  }

  const sourceTableNames = betterAuthCreateSet<string>();
  for (let index = 0; index < sourceTables.length; index += 1) {
    betterAuthSetAdd(sourceTableNames, sourceTables[index]!.tableName);
  }
  const unsortedMissingSourceTables: string[] = [];
  const metadataTablesSnapshot = betterAuthSetValues(
    metadataTables,
    'Better Auth bridged metadata tables',
  );
  for (let index = 0; index < metadataTablesSnapshot.length; index += 1) {
    const table = metadataTablesSnapshot[index]!;
    const physicalTable = betterAuthPhysicalTableName(
      table,
      betterAuthTableMetadata(metadata, table),
    );
    if (!betterAuthSetHas(sourceTableNames, physicalTable)) {
      betterAuthArrayAppend(
        unsortedMissingSourceTables,
        physicalTable,
        'Better Auth missing schema source tables',
      );
    }
  }
  const missingSourceTables = sortedBetterAuthStrings(
    unsortedMissingSourceTables,
    'Better Auth missing schema source tables',
  );
  const insertedImport = annotatedTables.length > 0 && !hasRequiredImport;
  const sourceReplacements = betterAuthSnapshotDenseArray(
    replacements,
    'Better Auth schema source replacements',
  );
  if (insertedImport) {
    betterAuthArrayAppend(
      sourceReplacements,
      betterAuthSchemaImportReplacement(source, annotationCallee),
      'Better Auth schema source replacements',
    );
  }

  return {
    alreadyAnnotatedTables: sortedBetterAuthTables(alreadyAnnotatedTables),
    annotatedTables: sortedBetterAuthTables(annotatedTables),
    duplicateSourceTables: sortedBetterAuthTables(
      betterAuthSetValues(duplicateSourceTables, 'Better Auth duplicate schema source tables'),
    ),
    existingExtraConfigTables: sortedUniqueBetterAuthStrings(
      existingExtraConfigTables,
      'Better Auth source tables with extra config',
    ),
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
  assertBetterAuthOptionsObject(options, 'Better Auth schema source generation options');
  const schemaBridgeExtensions = betterAuthOwnDataOption<BetterAuthSchemaBridgeExtensions>(
    options,
    'schemaBridge',
    'Better Auth schema generation option schemaBridge',
  );
  const configuredAnnotationCallee = betterAuthOwnDataOption<string>(
    options,
    'annotationCallee',
    'Better Auth schema generation option annotationCallee',
  );
  const configuredDialect = betterAuthOwnDataOption<BetterAuthSchemaSourceDialect>(
    options,
    'dialect',
    'Better Auth schema generation option dialect',
  );
  const annotationCallee = configuredAnnotationCallee ?? 'kovo';
  if (!isValidTypeScriptIdentifier(annotationCallee)) {
    throw new TypeError('Better Auth annotationCallee must be a TypeScript identifier.');
  }
  const dialect = configuredDialect ?? 'postgres';
  if (dialect !== 'postgres' && dialect !== 'sqlite') {
    throw new TypeError('Better Auth schema dialect must be postgres or sqlite.');
  }
  const metadata = snapshotBetterAuthMetadataTables(
    tables,
    'Better Auth schema generation metadata tables',
  );
  const schemaBridge = createBetterAuthSchemaBridge(schemaBridgeExtensions);
  const validation = validateBetterAuthSchemaBridge(
    metadata,
    schemaBridgeExtensions === undefined ? {} : { schemaBridge: schemaBridgeExtensions },
  );
  const tableFactory = dialect === 'sqlite' ? 'sqliteTable' : 'pgTable';
  const drizzleCoreModule =
    dialect === 'sqlite' ? 'drizzle-orm/sqlite-core' : 'drizzle-orm/pg-core';
  const collidingPhysicalTables = betterAuthCollidingPhysicalTableNames(metadata, schemaBridge);
  const generatedTables: BetterAuthGeneratedSchemaTable[] = [];
  const skippedTables: BetterAuthGeneratedSchemaTableDegradation[] = [];
  const declarations: string[] = [];
  const requiredBuilders = betterAuthCreateSet<string>();
  betterAuthSetAdd(requiredBuilders, tableFactory);
  const exportNames = betterAuthCreateSet<string>();

  const orderedTables = orderedBetterAuthMetadataTables(metadata, schemaBridge);
  for (let tableIndex = 0; tableIndex < orderedTables.length; tableIndex += 1) {
    const table = orderedTables[tableIndex]!;
    const annotation = betterAuthSchemaBridgeAnnotation(table, schemaBridge);
    if (annotation === undefined) continue;

    const tableMetadata = betterAuthTableMetadata(metadata, table);
    const physicalTable = betterAuthPhysicalTableName(table, tableMetadata);
    const fieldNames = betterAuthTableFieldNames(tableMetadata);

    if (betterAuthSetHas(collidingPhysicalTables, physicalTable)) {
      betterAuthArrayAppend(
        skippedTables,
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
        'Better Auth skipped generated schema tables',
      );
      continue;
    }

    if (fieldNames === null) {
      betterAuthArrayAppend(
        skippedTables,
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
        'Better Auth skipped generated schema tables',
      );
      continue;
    }

    if (
      'domain' in annotation &&
      annotation.key !== undefined &&
      !betterAuthSetHas(fieldNames, annotation.key)
    ) {
      betterAuthArrayAppend(
        skippedTables,
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
        'Better Auth skipped generated schema tables',
      );
      continue;
    }

    const columns = betterAuthGeneratedSchemaColumns(table, tableMetadata, dialect);
    if ('degradation' in columns) {
      betterAuthArrayAppend(
        skippedTables,
        columns.degradation,
        'Better Auth skipped generated schema tables',
      );
      continue;
    }

    const columnBuilders = betterAuthSetValues(
      columns.builders,
      'Better Auth generated schema column builders',
    );
    for (let builderIndex = 0; builderIndex < columnBuilders.length; builderIndex += 1) {
      betterAuthSetAdd(requiredBuilders, columnBuilders[builderIndex]!);
    }

    const exportName = uniqueBetterAuthSchemaExportName(table, exportNames);
    betterAuthArrayAppend(
      generatedTables,
      { exportName, physicalTable, table },
      'Better Auth generated schema tables',
    );
    betterAuthArrayAppend(
      declarations,
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
      'Better Auth generated schema declarations',
    );
  }

  const sortedBuilders = sortedBetterAuthStrings(
    betterAuthSetValues(requiredBuilders, 'Better Auth generated schema builders'),
    'Better Auth generated schema builders',
  );
  const drizzleImport = `import { ${joinBetterAuthStrings(
    sortedBuilders,
    ', ',
    'Better Auth generated schema builders',
  )} } from '${drizzleCoreModule}';`;
  const requiredImports = [betterAuthSchemaImportStatement(annotationCallee), drizzleImport];
  const source =
    declarations.length === 0
      ? ''
      : `${joinBetterAuthStrings(
          requiredImports,
          '\n',
          'Better Auth generated schema imports',
        )}\n\n${joinBetterAuthStrings(
          declarations,
          '\n\n',
          'Better Auth generated schema declarations',
        )}\n`;

  return {
    generatedTables,
    requiredImports,
    skippedTables: sortedBetterAuthGeneratedSchemaDegradations(skippedTables),
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
      betterAuthOperationTableTouches(api, options.credentialMutationTableTouches),
      `Better Auth ${api} declared-touch validation`,
    );
    const declaredTouchDomains: BetterAuthTouchDomain[] = [];

    for (let touchIndex = 0; touchIndex < touches.length; touchIndex += 1) {
      const touch = touches[touchIndex]!;
      const table = betterAuthOperationTouchTable(
        touch,
        `Better Auth ${api} declared table touch ${touchIndex}`,
      );
      if (!betterAuthSetHas(tableNames, table)) {
        betterAuthArrayAppend(
          mismatches,
          `${api}.${table} is declared touched but Better Auth table metadata is missing that table`,
          'Better Auth declared-touch mismatches',
        );
        continue;
      }

      const bridge = betterAuthSchemaBridgeAnnotation(table, schemaBridge);

      if (bridge === undefined) {
        betterAuthArrayAppend(
          mismatches,
          `${api}.${table} is declared touched but outside the Better Auth schema bridge`,
          'Better Auth declared-touch mismatches',
        );
        continue;
      }

      if (!('domain' in bridge)) {
        betterAuthArrayAppend(
          mismatches,
          `${api}.${table} is declared touched but schema-bridge exempt`,
          'Better Auth declared-touch mismatches',
        );
        continue;
      }

      betterAuthArrayAppend(
        declaredTouchDomains,
        bridge.domain,
        `Better Auth ${api} declared-touch domains`,
      );
      const legacyDomain = betterAuthOwnDataOption<BetterAuthTouchDomain>(
        touch,
        'domain',
        `Better Auth ${api} declared table touch ${touchIndex}.domain`,
      );
      if (legacyDomain !== undefined && bridge.domain !== legacyDomain) {
        betterAuthArrayAppend(
          mismatches,
          `${api}.${table} declares ${legacyDomain} but schema bridge maps ${bridge.domain}`,
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

  const bridgeTables = betterAuthObjectKeys(
    schemaBridge,
    'Better Auth schema-bridge key validation tables',
  );
  for (let tableIndex = 0; tableIndex < bridgeTables.length; tableIndex += 1) {
    const table = bridgeTables[tableIndex]!;
    const annotation = betterAuthOwnDataValue(
      schemaBridge,
      table,
      'Better Auth schema-bridge key validation',
    ) as BetterAuthSchemaBridgeAnnotation;
    if (!('domain' in annotation) || annotation.key === undefined) continue;

    const metadata = betterAuthTableMetadata(tables, table);
    const fieldNames = betterAuthTableFieldNames(metadata);

    if (fieldNames === null) continue;
    if (betterAuthSetHas(fieldNames, annotation.key)) continue;

    betterAuthArrayAppend(
      mismatches,
      schemaBridgeKeyFieldMismatch(table, annotation.key, metadata),
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

  const groups = betterAuthMapEntries(
    physicalTables,
    'Better Auth physical-table collision groups',
  );
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const [physicalTable, logicalTables] = groups[groupIndex]!;
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
  const collisions = betterAuthCreateSet<string>();
  const groups = betterAuthMapEntries(
    betterAuthPhysicalTableNameGroups(tables, schemaBridge),
    'Better Auth physical-table collision groups',
  );
  for (let index = 0; index < groups.length; index += 1) {
    const [physicalTable, logicalTables] = groups[index]!;
    if (logicalTables.length > 1) betterAuthSetAdd(collisions, physicalTable);
  }
  return collisions;
}

function betterAuthCollidingVerifierTableNames(
  tables: Record<string, unknown>,
  schemaBridge: BetterAuthSchemaBridgeExtensions,
): Set<string> {
  const ownersByTable = betterAuthCreateMap<string, Set<string>>();
  const addOwner = (physicalTable: string, logicalTable: string): void => {
    const owners = betterAuthMapGet(ownersByTable, physicalTable) ?? betterAuthCreateSet<string>();
    betterAuthSetAdd(owners, logicalTable);
    betterAuthMapSet(ownersByTable, physicalTable, owners);
  };

  // Verifier config deliberately accepts both the logical fallback and Better Auth's modelName
  // alias. Detect collisions over that complete emitted key set, not only metadata-present tables.
  const bridgeTables = betterAuthObjectKeys(schemaBridge, 'Better Auth verifier bridge tables');
  for (let index = 0; index < bridgeTables.length; index += 1) {
    const table = bridgeTables[index]!;
    const candidates = betterAuthPhysicalTableNames(table, tables);
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      addOwner(candidates[candidateIndex]!, table);
    }
  }

  // Unbridged plugin tables remain KV406. Their actual physical names reserve verifier keys so a
  // blessed table alias cannot silently classify the plugin's observed writes.
  const metadataTables = betterAuthObjectKeys(tables, 'Better Auth verifier metadata tables');
  for (let index = 0; index < metadataTables.length; index += 1) {
    const table = metadataTables[index]!;
    addOwner(betterAuthPhysicalTableName(table, betterAuthTableMetadata(tables, table)), table);
  }

  const collisions = betterAuthCreateSet<string>();
  const groups = betterAuthMapEntries(ownersByTable, 'Better Auth verifier table-name owners');
  for (let index = 0; index < groups.length; index += 1) {
    const [physicalTable, owners] = groups[index]!;
    if (betterAuthSetValues(owners, 'Better Auth verifier table-name owners').length > 1) {
      betterAuthSetAdd(collisions, physicalTable);
    }
  }
  return collisions;
}

function betterAuthTableFieldNames(table: unknown): Set<string> | null {
  if (!table || typeof table !== 'object') return null;

  const fields = betterAuthOwnDataValue(table, 'fields', 'Better Auth table metadata');

  if (!fields || typeof fields !== 'object' || betterAuthArrayIsArray(fields)) return null;

  const fieldNames = betterAuthCreateSet<string>();
  betterAuthSetAdd(fieldNames, 'id');
  const keys = betterAuthObjectKeys(fields, 'Better Auth table field metadata');
  for (let index = 0; index < keys.length; index += 1) {
    betterAuthSetAdd(fieldNames, keys[index]!);
  }
  return fieldNames;
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
  if (betterAuthSetHas(fields, 'organizationId')) {
    return { domain: 'organization', key: 'organizationId' };
  }
  if (betterAuthSetHas(fields, 'teamId')) return { domain: 'organization', key: 'teamId' };
  if (betterAuthSetHas(fields, 'userId'))
    return withBetterAuthSecretFields(fields, {
      domain: 'auth',
      key: 'userId',
    });

  return null;
}

function isLikelyBetterAuthProtocolTable(fields: ReadonlySet<string>): boolean {
  const nonIdFields: string[] = [];
  const fieldValues = betterAuthSetValues(fields, 'Better Auth plugin protocol fields');
  for (let index = 0; index < fieldValues.length; index += 1) {
    const field = fieldValues[index]!;
    if (field !== 'id')
      betterAuthArrayAppend(nonIdFields, field, 'Better Auth plugin protocol fields');
  }

  if (nonIdFields.length === 0) return false;
  let hasAnchor = false;
  for (let index = 0; index < nonIdFields.length; index += 1) {
    const field = nonIdFields[index]!;
    if (betterAuthSetHas(protocolStateAnchorFields, field)) hasAnchor = true;
    if (!betterAuthSetHas(protocolStateFields, field)) return false;
  }
  return hasAnchor;
}

const protocolStateAnchorFields = betterAuthSetFromStrings(
  ['challenge', 'code', 'deviceCode', 'token', 'value'],
  'Better Auth protocol-state anchor fields',
);

const protocolStateFields = betterAuthSetFromStrings(
  [
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
  ],
  'Better Auth protocol-state fields',
);

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
  const seen = betterAuthCreateSet<string>();
  for (let index = 0; index < staticSecret.length; index += 1) {
    const column = staticSecret[index]!;
    betterAuthArrayAppend(secret, column, 'Better Auth schema secret fields');
    betterAuthSetAdd(seen, column);
  }

  const classified = betterAuthSnapshotDenseArray(
    classifiedSecret,
    'Better Auth classified schema secret fields',
  );
  for (let index = 0; index < classified.length; index += 1) {
    const column = classified[index]!;
    if (betterAuthSetHas(seen, column)) continue;
    betterAuthArrayAppend(secret, column, 'Better Auth schema secret fields');
    betterAuthSetAdd(seen, column);
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
const betterAuthCredentialColumnNouns = betterAuthSetFromStrings(
  [
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
  ],
  'Better Auth credential column nouns',
);

/**
 * @internal Split a Better Auth column name into lowercased word segments across camelCase and
 * non-alphanumeric boundaries. `refreshTokenExpiresAt` → `[refresh, token, expires, at]`.
 */
function betterAuthColumnSegments(column: string): string[] {
  const segments: string[] = [];
  let segmentStart = -1;
  for (let index = 0; index < column.length; index += 1) {
    const code = betterAuthCharacterCodeAt(column, index);
    const alphanumeric = isAsciiAlphaNumericCode(code);
    if (!alphanumeric) {
      if (segmentStart >= 0) {
        appendBetterAuthColumnSegment(segments, column, segmentStart, index);
        segmentStart = -1;
      }
      continue;
    }

    if (segmentStart < 0) {
      segmentStart = index;
      continue;
    }

    const previousCode = betterAuthCharacterCodeAt(column, index - 1);
    const nextCode = index + 1 < column.length ? betterAuthCharacterCodeAt(column, index + 1) : -1;
    const camelBoundary =
      isAsciiUpperCode(code) &&
      (isAsciiLowerCode(previousCode) ||
        isAsciiDigitCode(previousCode) ||
        (isAsciiUpperCode(previousCode) && isAsciiLowerCode(nextCode)));
    if (camelBoundary) {
      appendBetterAuthColumnSegment(segments, column, segmentStart, index);
      segmentStart = index;
    }
  }
  if (segmentStart >= 0)
    appendBetterAuthColumnSegment(segments, column, segmentStart, column.length);
  return segments;
}

function appendBetterAuthColumnSegment(
  segments: string[],
  column: string,
  start: number,
  end: number,
): void {
  if (end <= start) return;
  betterAuthArrayAppend(
    segments,
    betterAuthToLowerCase(betterAuthSlice(column, start, end)),
    'Better Auth credential column segments',
  );
}

function isAsciiUpperCode(code: number): boolean {
  return code >= 0x41 && code <= 0x5a;
}

function isAsciiLowerCode(code: number): boolean {
  return code >= 0x61 && code <= 0x7a;
}

function isAsciiDigitCode(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isAsciiAlphaNumericCode(code: number): boolean {
  return isAsciiUpperCode(code) || isAsciiLowerCode(code) || isAsciiDigitCode(code);
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
  return last !== undefined && betterAuthSetHas(betterAuthCredentialColumnNouns, last);
}

/**
 * @internal Positive, fail-closed secret classifier for Better Auth plugin credential columns.
 * SPEC.md §10.1 C10 / papercuts-36 P2. Returns the sorted subset of `fields` that default to
 * `secret:` because they are credential-shaped, so the KV406 bridge suggestion never omits a
 * plausible credential column (e.g. apiKey `key`) without an explicit author override.
 */
export function betterAuthCredentialSecretFields(fields: ReadonlySet<string>): readonly string[] {
  const secretFields: string[] = [];
  const fieldValues = betterAuthSetValues(fields, 'Better Auth credential candidate fields');
  for (let index = 0; index < fieldValues.length; index += 1) {
    const field = fieldValues[index]!;
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
export const betterAuthKnownPluginCredentialColumns = betterAuthDeepFreeze(
  [
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
  ] as const,
  'Better Auth known plugin credential columns',
);

/**
 * @internal Better Auth columns that MUST stay readable (never classified secret) — used by the
 * completeness test to prove the positive rule does not over-block ordinary owner-scoped columns.
 */
export const betterAuthKnownReadablePluginColumns = betterAuthDeepFreeze(
  [
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
  ] as const,
  'Better Auth known readable plugin columns',
);

const betterAuthSchemaTableNames = betterAuthSetFromStrings(
  betterAuthObjectKeys(betterAuthSchemaBridge, 'Better Auth built-in schema table names'),
  'Better Auth built-in schema table names',
);

function betterAuthSchemaBridgeAnnotation(
  table: string,
  schemaBridge: BetterAuthSchemaBridgeExtensions = betterAuthSchemaBridge,
): BetterAuthSchemaBridgeAnnotation | undefined {
  return betterAuthOwnDataValue(schemaBridge, table, 'Better Auth schema bridge') as
    | BetterAuthSchemaBridgeAnnotation
    | undefined;
}

function createBetterAuthSchemaBridge(
  extensions: BetterAuthSchemaBridgeExtensions = {},
): BetterAuthSchemaBridgeExtensions {
  assertBetterAuthOptionsObject(extensions, 'Better Auth schema bridge extensions');
  const bridge: BetterAuthSchemaBridgeExtensions = {};
  const extensionTables = betterAuthObjectKeys(extensions, 'Better Auth schema bridge extensions');
  for (let index = 0; index < extensionTables.length; index += 1) {
    const table = extensionTables[index]!;
    const annotation = snapshotBetterAuthSchemaBridgeAnnotation(
      betterAuthOwnDataValue(extensions, table, 'Better Auth schema bridge extensions'),
      `Better Auth schema bridge extension ${table}`,
    );
    betterAuthDefineOwnData(bridge, table, annotation, 'Better Auth schema bridge extensions');
  }
  const builtInTables = betterAuthObjectKeys(
    betterAuthSchemaBridge,
    'Better Auth built-in schema bridge',
  );
  for (let index = 0; index < builtInTables.length; index += 1) {
    const table = builtInTables[index]!;
    const annotation = snapshotBetterAuthSchemaBridgeAnnotation(
      betterAuthOwnDataValue(betterAuthSchemaBridge, table, 'Better Auth built-in schema bridge'),
      `Better Auth built-in schema bridge ${table}`,
    );
    betterAuthDefineOwnData(bridge, table, annotation, 'Better Auth built-in schema bridge');
  }
  return bridge;
}

function snapshotBetterAuthSchemaBridgeAnnotation(
  value: unknown,
  label: string,
): BetterAuthSchemaBridgeAnnotation {
  if (value === null || typeof value !== 'object' || betterAuthArrayIsArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  const domain = betterAuthOwnDataOption<BetterAuthTouchDomain>(value, 'domain', `${label}.domain`);
  const exempt = betterAuthOwnDataOption<boolean>(value, 'exempt', `${label}.exempt`);
  const key = betterAuthOwnDataOption<string>(value, 'key', `${label}.key`);
  const rationale = betterAuthOwnDataOption<string>(value, 'rationale', `${label}.rationale`);
  const secret = betterAuthOwnDataOption<readonly string[]>(value, 'secret', `${label}.secret`);

  if (domain !== undefined) {
    if (domain !== 'auth' && domain !== 'organization' && domain !== 'user') {
      throw new TypeError(`${label}.domain must be auth, organization, or user.`);
    }
    if (exempt !== undefined || rationale !== undefined) {
      throw new TypeError(`${label} cannot declare both domain and exempt posture.`);
    }
    if (key !== undefined && (typeof key !== 'string' || key === '')) {
      throw new TypeError(`${label}.key must be non-empty text when provided.`);
    }
    let secretSnapshot: readonly string[] | undefined;
    if (secret !== undefined) {
      const fields = betterAuthSnapshotDenseArray(secret, `${label}.secret`);
      for (let index = 0; index < fields.length; index += 1) {
        if (typeof fields[index] !== 'string' || fields[index] === '') {
          throw new TypeError(`${label}.secret must contain non-empty field names.`);
        }
      }
      secretSnapshot = betterAuthFreezeOwn(fields, `${label}.secret`);
    }
    return betterAuthDeepFreeze(
      {
        domain,
        ...(key === undefined ? {} : { key }),
        ...(secretSnapshot === undefined ? {} : { secret: secretSnapshot }),
      },
      label,
    );
  }

  if (exempt !== true) {
    throw new TypeError(`${label} must declare an own-data domain or exempt:true posture.`);
  }
  if (key !== undefined || secret !== undefined) {
    throw new TypeError(`${label} cannot attach domain fields to exempt posture.`);
  }
  if (typeof rationale !== 'string' || rationale === '') {
    throw new TypeError(`${label}.rationale must be non-empty text.`);
  }
  return betterAuthDeepFreeze({ exempt: true, rationale }, label);
}

function schemaBridgeExtensionCollisionMismatches(
  extensions: BetterAuthSchemaBridgeExtensions = {},
): string[] {
  const builtInTables = betterAuthSetFromStrings(
    betterAuthObjectKeys(betterAuthSchemaBridge, 'Better Auth built-in schema table names'),
    'Better Auth built-in schema table names',
  );
  const collisions: string[] = [];
  const extensionTables = betterAuthSnapshotDenseArray(
    betterAuthObjectKeys(extensions, 'Better Auth schema-bridge extension table names'),
    'Better Auth schema-bridge extension table names',
  );
  for (let index = 0; index < extensionTables.length; index += 1) {
    const table = extensionTables[index]!;
    if (!betterAuthSetHas(builtInTables, table)) continue;
    betterAuthArrayAppend(
      collisions,
      `${table} is a blessed Better Auth schema-bridge table; extension entries may only add plugin tables outside the built-in bridge`,
      'Better Auth schema-bridge extension collisions',
    );
  }
  return sortedBetterAuthStrings(collisions, 'Better Auth schema-bridge extension collisions');
}

function betterAuthPhysicalTableNames(table: string, tables: Record<string, unknown>): string[] {
  const physicalName = betterAuthPhysicalTableName(table, betterAuthTableMetadata(tables, table));

  return physicalName === table ? [table] : [table, physicalName];
}

function betterAuthPhysicalTableName(table: string, metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') return table;

  const modelName = betterAuthOwnDataValue(metadata, 'modelName', 'Better Auth table metadata');

  return typeof modelName === 'string' && modelName.length > 0 ? modelName : table;
}

function betterAuthMetadataTableByPhysicalName(
  tables: Record<string, unknown>,
  schemaBridge: BetterAuthSchemaBridgeExtensions = betterAuthSchemaBridge,
): Map<string, string> {
  const tableByPhysicalName = betterAuthCreateMap<string, string>();
  const physicalTableGroups = betterAuthPhysicalTableNameGroups(tables, schemaBridge);

  const groups = betterAuthMapEntries(
    physicalTableGroups,
    'Better Auth physical-to-logical table groups',
  );
  for (let index = 0; index < groups.length; index += 1) {
    const [physicalTable, logicalTables] = groups[index]!;
    if (logicalTables.length !== 1) continue;

    betterAuthMapSet(tableByPhysicalName, physicalTable, logicalTables[0] ?? physicalTable);
  }

  return tableByPhysicalName;
}

function betterAuthPhysicalTableNameGroups(
  tables: Record<string, unknown>,
  schemaBridge: BetterAuthSchemaBridgeExtensions = betterAuthSchemaBridge,
): Map<string, string[]> {
  const physicalTables = betterAuthCreateMap<string, string[]>();

  const tableNames = betterAuthObjectKeys(tables, 'Better Auth metadata table names');
  for (let index = 0; index < tableNames.length; index += 1) {
    const table = tableNames[index]!;
    if (!isBetterAuthSchemaTable(table, schemaBridge)) continue;

    const physicalTable = betterAuthPhysicalTableName(
      table,
      betterAuthTableMetadata(tables, table),
    );
    const logicalTables = betterAuthMapGet(physicalTables, physicalTable) ?? [];
    betterAuthArrayAppend(logicalTables, table, `Better Auth ${physicalTable} logical table names`);
    betterAuthMapSet(
      physicalTables,
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
  const tableNames = betterAuthObjectKeys(tables, 'Better Auth metadata table names');
  const ordered: string[] = [];
  for (let index = 0; index < tableNames.length; index += 1) {
    const table = tableNames[index]!;
    if (!isBetterAuthSchemaTable(table, schemaBridge)) continue;
    betterAuthArrayAppend(ordered, table, 'Better Auth ordered metadata tables');
    let insertion = ordered.length - 1;
    while (
      insertion > 0 &&
      compareBetterAuthMetadataTables(ordered[insertion - 1]!, table, tables) > 0
    ) {
      betterAuthDefineOwnData(
        ordered,
        insertion,
        ordered[insertion - 1]!,
        'Better Auth ordered metadata tables',
      );
      insertion -= 1;
    }
    betterAuthDefineOwnData(ordered, insertion, table, 'Better Auth ordered metadata tables');
  }
  return ordered;
}

function betterAuthTableOrder(metadata: unknown): number {
  if (!metadata || typeof metadata !== 'object') return Infinity;

  const order = betterAuthOwnDataValue(metadata, 'order', 'Better Auth table metadata');

  return typeof order === 'number' ? order : Infinity;
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

  const idColumn = betterAuthGeneratedSchemaIdColumn(
    table,
    physicalTable,
    betterAuthOwnDataValue(fields, 'id', 'Better Auth generated schema fields'),
    dialect,
  );

  if ('degradation' in idColumn) return idColumn;

  const columns = [idColumn.column];
  const builders = betterAuthCreateSet<BetterAuthGeneratedSchemaFieldBuilder>();
  betterAuthSetAdd(builders, idColumn.builder);

  const fieldNames = betterAuthObjectKeys(fields, 'Better Auth generated schema fields');
  for (let fieldIndex = 0; fieldIndex < fieldNames.length; fieldIndex += 1) {
    const field = fieldNames[fieldIndex]!;
    if (field === 'id') continue;
    const fieldMetadata = betterAuthOwnDataValue(
      fields,
      field,
      'Better Auth generated schema fields',
    );

    const column = betterAuthGeneratedSchemaColumn(
      table,
      physicalTable,
      field,
      fieldMetadata,
      dialect,
    );

    if ('degradation' in column) return column;

    betterAuthSetAdd(builders, column.builder);
    betterAuthArrayAppend(columns, column.column, 'Better Auth generated schema columns');
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
        )} cannot be generated because field id has unsupported Better Auth type ${
          type ?? 'unavailable'
        }.`,
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
        )} cannot be generated because field ${field} has unsupported Better Auth type ${
          type ?? 'unavailable'
        }.`,
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

  const fields = betterAuthOwnDataValue(metadata, 'fields', 'Better Auth table metadata');

  if (!fields || typeof fields !== 'object' || betterAuthArrayIsArray(fields)) return null;

  return fields as Record<string, unknown>;
}

function betterAuthFieldType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;

  const type = betterAuthOwnDataValue(metadata, 'type', 'Better Auth field metadata');

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
  const lines = [
    `export const ${declaration.exportName} = ${declaration.tableFactory}(${quoteTsString(
      declaration.physicalTable,
    )}, {`,
  ];
  const columns = betterAuthSnapshotDenseArray(
    declaration.columns,
    'Better Auth generated schema declaration columns',
  );
  for (let index = 0; index < columns.length; index += 1) {
    betterAuthArrayAppend(
      lines,
      `  ${renderBetterAuthGeneratedSchemaColumn(columns[index]!, declaration.dialect)}`,
      'Better Auth generated schema declaration lines',
    );
  }
  betterAuthArrayAppend(
    lines,
    `}, ${declaration.annotationCall});`,
    'Better Auth generated schema declaration lines',
  );
  return joinBetterAuthStrings(lines, '\n', 'Better Auth generated schema declaration lines');
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

  const fieldName = betterAuthOwnDataValue(metadata, 'fieldName', 'Better Auth field metadata');

  if (typeof fieldName === 'string' && fieldName.length > 0) return fieldName;

  if (fieldName && typeof fieldName === 'object') {
    const nestedFieldName = betterAuthOwnDataValue(
      fieldName,
      'fieldName',
      'Better Auth nested field metadata',
    );

    if (typeof nestedFieldName === 'string' && nestedFieldName.length > 0) {
      return nestedFieldName;
    }
  }

  return field;
}

function betterAuthFieldRequired(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;

  return betterAuthOwnDataValue(metadata, 'required', 'Better Auth field metadata') === true;
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
    fields:
      options.fields === null
        ? null
        : sortedBetterAuthStrings(
            betterAuthSetValues(options.fields, 'Better Auth generated schema degradation fields'),
            'Better Auth generated schema degradation fields',
          ),
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

  while (betterAuthSetHas(usedNames, name)) {
    name = `${baseName}${index}`;
    index += 1;
  }

  betterAuthSetAdd(usedNames, name);

  return name;
}

function betterAuthSchemaExportIdentifier(table: string): string {
  if (isValidTypeScriptIdentifier(table) && !isReservedTypeScriptIdentifier(table)) return table;

  const words = splitBetterAuthIdentifierWords(table);
  let suffix = '';
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    suffix += `${betterAuthToUpperCase(betterAuthSlice(word, 0, 1))}${betterAuthSlice(word, 1)}`;
  }

  return suffix.length === 0 ? 'betterAuthTable' : `betterAuth${suffix}`;
}

function splitBetterAuthIdentifierWords(value: string): string[] {
  const words: string[] = [];
  let start = -1;
  for (let index = 0; index < value.length; index += 1) {
    if (isIdentifierCharacter(value[index])) {
      if (start < 0) start = index;
      continue;
    }
    if (start >= 0) {
      betterAuthArrayAppend(
        words,
        betterAuthSlice(value, start, index),
        'Better Auth schema export identifier words',
      );
      start = -1;
    }
  }
  if (start >= 0) {
    betterAuthArrayAppend(
      words,
      betterAuthSlice(value, start),
      'Better Auth schema export identifier words',
    );
  }
  return words;
}

function betterAuthSchemaObjectPropertyName(value: string): string {
  return isValidTypeScriptIdentifier(value) && !isReservedTypeScriptIdentifier(value)
    ? value
    : quoteTsString(value);
}

function isValidTypeScriptIdentifier(value: string): boolean {
  if (value.length === 0 || !isIdentifierStart(value[0])) return false;
  for (let index = 1; index < value.length; index += 1) {
    if (!isIdentifierCharacter(value[index])) return false;
  }
  return true;
}

const reservedTypeScriptIdentifiers = betterAuthSetFromStrings(
  [
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
  ],
  'Better Auth reserved TypeScript identifiers',
);

function isReservedTypeScriptIdentifier(value: string): boolean {
  return betterAuthSetHas(reservedTypeScriptIdentifiers, value);
}

function isBetterAuthSchemaTable(
  table: string,
  schemaBridge: BetterAuthSchemaBridgeExtensions = betterAuthSchemaBridge,
): boolean {
  return (
    betterAuthSetHas(betterAuthSchemaTableNames, table) ||
    betterAuthOwnDataValue(schemaBridge, table, 'Better Auth schema bridge') !== undefined
  );
}

function sortedBetterAuthTables(tables: readonly string[]): string[] {
  return sortedUniqueBetterAuthStrings(tables, 'Better Auth table names');
}

function duplicateDrizzleTableNames(calls: readonly DrizzleTableCall[]): Set<string> {
  const counts = betterAuthCreateMap<string, number>();
  const callSnapshot = betterAuthSnapshotDenseArray(calls, 'Better Auth schema table calls');
  for (let index = 0; index < callSnapshot.length; index += 1) {
    const call = callSnapshot[index]!;
    betterAuthMapSet(counts, call.tableName, (betterAuthMapGet(counts, call.tableName) ?? 0) + 1);
  }

  const duplicates = betterAuthCreateSet<string>();
  const entries = betterAuthMapEntries(counts, 'Better Auth schema table counts');
  for (let index = 0; index < entries.length; index += 1) {
    const [tableName, count] = entries[index]!;
    if (count > 1) betterAuthSetAdd(duplicates, tableName);
  }
  return duplicates;
}

function duplicateBetterAuthSourceTableNames(
  duplicateTableNames: ReadonlySet<string>,
  metadataTables: ReadonlySet<string>,
  metadataTableByPhysicalName: ReadonlyMap<string, string>,
): Set<string> {
  const duplicates = betterAuthCreateSet<string>();
  const tableNames = betterAuthSetValues(
    duplicateTableNames,
    'Better Auth duplicate schema source tables',
  );
  for (let index = 0; index < tableNames.length; index += 1) {
    const tableName = tableNames[index]!;
    const metadataTable = betterAuthMapGet(metadataTableByPhysicalName, tableName);
    if (metadataTable !== undefined && betterAuthSetHas(metadataTables, metadataTable)) {
      betterAuthSetAdd(duplicates, tableName);
    }
  }
  return duplicates;
}

function unrecognizedBetterAuthSourceTableDeclarations(
  candidates: readonly DrizzleTableCall[],
  recognizedCalls: readonly DrizzleTableCall[],
  metadataTables: ReadonlySet<string>,
  metadataTableByPhysicalName: ReadonlyMap<string, string>,
): BetterAuthSchemaSourceDeclarationDegradation[] {
  const recognizedPhysicalTables = betterAuthCreateSet<string>();
  const recognizedSnapshot = betterAuthSnapshotDenseArray(
    recognizedCalls,
    'Better Auth recognized schema source calls',
  );
  for (let index = 0; index < recognizedSnapshot.length; index += 1) {
    betterAuthSetAdd(recognizedPhysicalTables, recognizedSnapshot[index]!.tableName);
  }
  const seen = betterAuthCreateSet<string>();
  const degradations: BetterAuthSchemaSourceDeclarationDegradation[] = [];

  const candidateSnapshot = betterAuthSnapshotDenseArray(
    candidates,
    'Better Auth schema source table candidates',
  );
  for (let index = 0; index < candidateSnapshot.length; index += 1) {
    const candidate = candidateSnapshot[index]!;
    if (betterAuthSetHas(recognizedPhysicalTables, candidate.tableName)) continue;

    const table = betterAuthMapGet(metadataTableByPhysicalName, candidate.tableName);
    if (table === undefined || !betterAuthSetHas(metadataTables, table)) continue;

    const key = `${candidate.tableName}\0${candidate.callee}`;
    if (betterAuthSetHas(seen, key)) continue;
    betterAuthSetAdd(seen, key);

    betterAuthArrayAppend(
      degradations,
      unrecognizedSchemaTableDeclarationDegradation(table, candidate),
      'Better Auth unrecognized schema source tables',
    );
  }

  return sortedBetterAuthSourceDeclarationDegradations(degradations);
}

function unsupportedBetterAuthSourceTableDeclarations(
  candidates: readonly DrizzleTableCall[],
  recognizedCalls: readonly DrizzleTableCall[],
  pluginTableDegradations: readonly BetterAuthPluginTableDegradation[],
  tables: Record<string, unknown>,
): BetterAuthSchemaSourcePluginTableDegradation[] {
  const recognizedSourceCalls = betterAuthCreateSet<string>();
  const recognizedSnapshot = betterAuthSnapshotDenseArray(
    recognizedCalls,
    'Better Auth recognized schema source calls',
  );
  for (let index = 0; index < recognizedSnapshot.length; index += 1) {
    const call = recognizedSnapshot[index]!;
    betterAuthSetAdd(recognizedSourceCalls, sourceTableDeclarationKey(call.tableName, call.callee));
  }
  const degradationsByPhysicalName = betterAuthCreateMap<
    string,
    BetterAuthPluginTableDegradation[]
  >();
  const seen = betterAuthCreateSet<string>();
  const degradations: BetterAuthSchemaSourcePluginTableDegradation[] = [];

  const pluginDegradations = betterAuthSnapshotDenseArray(
    pluginTableDegradations,
    'Better Auth plugin table degradations',
  );
  for (let index = 0; index < pluginDegradations.length; index += 1) {
    const degradation = pluginDegradations[index]!;
    const physicalTable = betterAuthPhysicalTableName(
      degradation.table,
      betterAuthTableMetadata(tables, degradation.table),
    );
    const tableDegradations = betterAuthMapGet(degradationsByPhysicalName, physicalTable) ?? [];
    betterAuthArrayAppend(
      tableDegradations,
      degradation,
      'Better Auth physical plugin table degradations',
    );
    betterAuthMapSet(degradationsByPhysicalName, physicalTable, tableDegradations);
  }

  const candidateSnapshot = betterAuthSnapshotDenseArray(
    candidates,
    'Better Auth schema source table candidates',
  );
  for (let candidateIndex = 0; candidateIndex < candidateSnapshot.length; candidateIndex += 1) {
    const candidate = candidateSnapshot[candidateIndex]!;
    const tableDegradations = betterAuthMapGet(degradationsByPhysicalName, candidate.tableName);
    if (tableDegradations === undefined) continue;

    const sourceFactory = betterAuthSetHas(
      recognizedSourceCalls,
      sourceTableDeclarationKey(candidate.tableName, candidate.callee),
    )
      ? 'recognized-drizzle-table'
      : 'unrecognized-table-factory';

    const tableDegradationSnapshot = betterAuthSnapshotDenseArray(
      tableDegradations,
      'Better Auth physical plugin table degradations',
    );
    for (let index = 0; index < tableDegradationSnapshot.length; index += 1) {
      const degradation = tableDegradationSnapshot[index]!;
      const key = `${candidate.tableName}\0${candidate.callee}\0${degradation.table}`;
      if (betterAuthSetHas(seen, key)) continue;
      betterAuthSetAdd(seen, key);

      betterAuthArrayAppend(
        degradations,
        unsupportedSchemaSourcePluginTableDegradation(degradation, candidate, sourceFactory),
        'Better Auth unsupported schema source plugin tables',
      );
    }
  }

  return sortedBetterAuthSourcePluginDegradations(degradations);
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
  const manualBridgeSteps = [
    `${betterAuthTableLabel(
      degradation.table,
      physicalTable,
    )} appears in schema.ts through ${factoryLabel}; the Better Auth adapter left it unannotated because it is outside the blessed schema bridge.`,
  ];
  const inheritedSteps = betterAuthSnapshotDenseArray(
    degradation.manualBridgeSteps,
    'Better Auth plugin schema-source manual bridge steps',
  );
  for (let index = 0; index < inheritedSteps.length; index += 1) {
    betterAuthArrayAppend(
      manualBridgeSteps,
      inheritedSteps[index]!,
      'Better Auth plugin schema-source manual bridge steps',
    );
  }

  return {
    callee: call.callee,
    diagnosticCode: 'KV406',
    fields: degradation.fields,
    manualBridgeSteps,
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
        : `, secret: [${joinBetterAuthStrings(
            quoteTsStrings(annotation.secret),
            ', ',
            'Better Auth schema annotation secret fields',
          )}]`;

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
  const args: string[] = [];
  const callArguments = betterAuthSnapshotDenseArray(
    call.arguments,
    'Better Auth schema source table-call arguments',
  );
  for (let index = 0; index < callArguments.length; index += 1) {
    betterAuthArrayAppend(
      args,
      betterAuthTrim(callArguments[index]!.text),
      'Better Auth schema source table-call arguments',
    );
  }
  betterAuthArrayAppend(
    args,
    betterAuthSchemaAnnotationCall(table, annotationCallee, schemaBridge, fields),
    'Better Auth schema source table-call arguments',
  );
  return {
    end: call.callEnd,
    start: call.callStart,
    value: renderBetterAuthSchemaSourceTableCall(call, args),
  };
}

function renderBetterAuthSchemaSourceTableCall(
  call: DrizzleTableCall,
  args: readonly string[],
): string {
  return `${call.callee}(${joinBetterAuthStrings(
    args,
    ', ',
    'Better Auth schema source table-call arguments',
  )})`;
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
  if (!betterAuthSetHas(localBindings, 'kovo')) return 'kovo';

  const baseName = 'kovoSchema';
  let localName = baseName;
  let index = 2;

  while (betterAuthSetHas(localBindings, localName)) {
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
    const existingSpecifiers = betterAuthTrim(kovoDrizzleImport.specifiersText);
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
  const namedImports = findNamedImports(source);
  for (let importIndex = 0; importIndex < namedImports.length; importIndex += 1) {
    const namedImport = namedImports[importIndex]!;
    if (stringLiteralValue(namedImport.moduleText) !== moduleName) continue;

    const specifiers = betterAuthSplit(namedImport.specifiersText, ',');
    for (let specifierIndex = 0; specifierIndex < specifiers.length; specifierIndex += 1) {
      const parsed = namedImportSpecifier(betterAuthTrim(specifiers[specifierIndex]!));
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

function betterAuthMatchText(match: RegExpExecArray, index: number, label: string): string {
  const value = betterAuthOwnDataValue(match, index, label);
  if (typeof value !== 'string') throw new TypeError(`${label}[${index}] must be text.`);
  return value;
}

function betterAuthMatchIndex(match: RegExpExecArray, label: string): number {
  const value = betterAuthOwnDataValue(match, 'index', label);
  if (typeof value !== 'number' || value < 0 || !betterAuthIsSafeInteger(value)) {
    throw new TypeError(`${label}.index must be a non-negative safe integer.`);
  }
  return value;
}

function betterAuthMatchGroup(match: RegExpExecArray, name: string, label: string): string {
  const groups = betterAuthOwnDataValue(match, 'groups', label);
  if (groups === undefined) return '';
  if (groups === null || typeof groups !== 'object') {
    throw new TypeError(`${label}.groups must be an object.`);
  }
  const value = betterAuthOwnDataValue(groups, name, `${label}.groups`);
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new TypeError(`${label}.groups.${name} must be text.`);
  return value;
}

function findNamedImportFromModule(source: string, moduleName: string): NamedImportMatch | null {
  const namedImports = findNamedImports(source);
  for (let index = 0; index < namedImports.length; index += 1) {
    const namedImport = namedImports[index]!;
    if (stringLiteralValue(namedImport.moduleText) === moduleName) return namedImport;
  }

  return null;
}

function findNamedImports(source: string): NamedImportMatch[] {
  const imports: NamedImportMatch[] = [];
  const importPattern = /import\s*\{(?<specifiers>[^}]*)\}\s*from\s*(?<module>['"][^'"]+['"])/g;

  const matches = betterAuthRegExpMatches(
    importPattern,
    source,
    'Better Auth named import matches',
  );
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const fullMatch = betterAuthMatchText(match, 0, 'Better Auth named import match');
    const matchIndex = betterAuthMatchIndex(match, 'Better Auth named import match');
    const openBrace = betterAuthIndexOf(fullMatch, '{');
    const closeBrace = betterAuthIndexOf(fullMatch, '}');
    betterAuthArrayAppend(
      imports,
      {
        moduleText: betterAuthMatchGroup(match, 'module', 'Better Auth named import match'),
        specifiersEnd: matchIndex + closeBrace,
        specifiersStart: matchIndex + openBrace + 1,
        specifiersText: betterAuthMatchGroup(match, 'specifiers', 'Better Auth named import match'),
      },
      'Better Auth named imports',
    );
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

  const matches = betterAuthRegExpMatches(
    importPattern,
    source,
    'Better Auth namespace import matches',
  );
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    betterAuthArrayAppend(
      imports,
      {
        localName: betterAuthMatchGroup(match, 'local', 'Better Auth namespace import match'),
        moduleText: betterAuthMatchGroup(match, 'module', 'Better Auth namespace import match'),
      },
      'Better Auth namespace imports',
    );
  }

  return imports;
}

function findFirstImport(source: string): number {
  const match = betterAuthRegExpExec(/^[ \t]*import\s/m, source);

  return match === null ? 0 : betterAuthMatchIndex(match, 'Better Auth first import match');
}

interface NamedImportSpecifier {
  imported: string;
  local: string;
}

function namedImportSpecifier(specifier: string): NamedImportSpecifier | null {
  const match = betterAuthRegExpExec(
    /^(?<imported>[A-Za-z_$][0-9A-Za-z_$]*)(?:\s+as\s+(?<local>[A-Za-z_$][0-9A-Za-z_$]*))?$/,
    specifier,
  );

  const imported =
    match === null ? '' : betterAuthMatchGroup(match, 'imported', 'Better Auth import specifier');
  if (!imported) return null;

  return {
    imported,
    local:
      match === null
        ? imported
        : betterAuthMatchGroup(match, 'local', 'Better Auth import specifier') || imported,
  };
}

function parseBetterAuthSchemaSourceIr(
  source: string,
  factories: readonly string[] = [],
): BetterAuthSchemaSourceIr {
  const tableCallCandidates = findSchemaTableCallCandidates(source);
  const factoryCallees = drizzleTableFactoryCallees(source, factories);
  const candidates = betterAuthSnapshotDenseArray(
    tableCallCandidates,
    'Better Auth schema table-call candidates',
  );
  const drizzleTableCalls: DrizzleTableCall[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const call = candidates[index]!;
    const recognized = betterAuthIncludes(call.callee, '.')
      ? betterAuthSetHas(factoryCallees.members, call.callee)
      : betterAuthSetHas(factoryCallees.identifiers, call.callee);
    if (recognized) {
      betterAuthArrayAppend(drizzleTableCalls, call, 'Better Auth recognized schema table calls');
    }
  }

  return {
    drizzleTableCalls,
    localBindings: sourceLocalBindingNames(source),
    tableCallCandidates,
  };
}

function sourceLocalBindingNames(source: string): Set<string> {
  const names = betterAuthCreateSet<string>();

  const namedImports = findNamedImports(source);
  for (let importIndex = 0; importIndex < namedImports.length; importIndex += 1) {
    const specifierTexts = betterAuthSplit(namedImports[importIndex]!.specifiersText, ',');
    for (let index = 0; index < specifierTexts.length; index += 1) {
      const specifier = namedImportSpecifier(betterAuthTrim(specifierTexts[index]!));
      if (specifier !== null) betterAuthSetAdd(names, specifier.local);
    }
  }

  const namespaceImports = findNamespaceImports(source);
  for (let index = 0; index < namespaceImports.length; index += 1) {
    betterAuthSetAdd(names, namespaceImports[index]!.localName);
  }

  const defaultImports = findDefaultImportLocalNames(source);
  for (let index = 0; index < defaultImports.length; index += 1) {
    betterAuthSetAdd(names, defaultImports[index]!);
  }

  const declarations = findTopLevelDeclarationLocalNames(source);
  for (let index = 0; index < declarations.length; index += 1) {
    betterAuthSetAdd(names, declarations[index]!);
  }

  return names;
}

function findDefaultImportLocalNames(source: string): string[] {
  const names: string[] = [];
  const importPattern =
    /import\s+(?!type\b)(?<local>[A-Za-z_$][0-9A-Za-z_$]*)\s*(?:,|\s+from\s*['"][^'"]+['"])/g;

  const matches = betterAuthRegExpMatches(
    importPattern,
    source,
    'Better Auth default import matches',
  );
  for (let index = 0; index < matches.length; index += 1) {
    const localName = betterAuthMatchGroup(
      matches[index]!,
      'local',
      'Better Auth default import match',
    );
    if (localName !== '') {
      betterAuthArrayAppend(names, localName, 'Better Auth default import local names');
    }
  }

  return names;
}

function findTopLevelDeclarationLocalNames(source: string): string[] {
  const names: string[] = [];
  const declarationPattern =
    /(?:^|[\n;])\s*(?:export\s+)?(?:const|let|var|function|class|enum|type|interface)\s+(?<local>[A-Za-z_$][0-9A-Za-z_$]*)/g;

  const matches = betterAuthRegExpMatches(
    declarationPattern,
    source,
    'Better Auth top-level declaration matches',
  );
  for (let index = 0; index < matches.length; index += 1) {
    const localName = betterAuthMatchGroup(
      matches[index]!,
      'local',
      'Better Auth top-level declaration match',
    );
    if (localName !== '') {
      betterAuthArrayAppend(names, localName, 'Better Auth top-level declaration names');
    }
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
    const tableName = stringLiteralValue(args[0] === undefined ? '' : betterAuthTrim(args[0].text));

    if (tableName !== null) {
      betterAuthArrayAppend(
        calls,
        {
          arguments: args,
          callEnd: closeParen + 1,
          callStart: calleeStart,
          callee: memberCallee?.value ?? identifier.value,
          closeParen,
          extraConfigText: args[2] === undefined ? null : betterAuthTrim(args[2].text),
          tableName,
        },
        'Better Auth schema source table calls',
      );
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
  const identifiers = betterAuthCreateSet<string>();
  const members = betterAuthCreateSet<string>();
  const factorySnapshot = betterAuthSnapshotDenseArray(
    factories,
    'Better Auth schema table factories',
  );
  for (let index = 0; index < factorySnapshot.length; index += 1) {
    const factory = factorySnapshot[index]!;
    if (betterAuthIncludes(factory, '.')) betterAuthSetAdd(members, factory);
    else betterAuthSetAdd(identifiers, factory);
  }

  const namedImports = findNamedImports(source);
  for (let importIndex = 0; importIndex < namedImports.length; importIndex += 1) {
    const namedImport = namedImports[importIndex]!;
    const moduleName = stringLiteralValue(namedImport.moduleText);
    if (!isDrizzleCoreModule(moduleName)) continue;

    const moduleFactory = drizzleTableFactoryByModule[moduleName];
    const specifierTexts = betterAuthSplit(namedImport.specifiersText, ',');
    for (let index = 0; index < specifierTexts.length; index += 1) {
      const specifier = namedImportSpecifier(betterAuthTrim(specifierTexts[index]!));
      if (specifier?.imported === moduleFactory) betterAuthSetAdd(identifiers, specifier.local);
    }
  }

  const namespaceImports = findNamespaceImports(source);
  for (let index = 0; index < namespaceImports.length; index += 1) {
    const namespaceImport = namespaceImports[index]!;
    const moduleName = stringLiteralValue(namespaceImport.moduleText);
    if (!isDrizzleCoreModule(moduleName)) continue;

    betterAuthSetAdd(
      members,
      `${namespaceImport.localName}.${drizzleTableFactoryByModule[moduleName]}`,
    );
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
    value: betterAuthSlice(source, index, end),
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
    value: `${betterAuthSlice(source, objectStart, objectEnd)}.${property.value}`,
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
  if (char === undefined || char.length === 0) return false;
  const code = betterAuthCharacterCodeAt(char, 0);
  return isAsciiUpperCode(code) || isAsciiLowerCode(code) || code === 0x5f || code === 0x24;
}

function isIdentifierCharacter(char: string | undefined): boolean {
  if (char === undefined || char.length === 0) return false;
  const code = betterAuthCharacterCodeAt(char, 0);
  return isAsciiAlphaNumericCode(code) || code === 0x5f || code === 0x24;
}

function skipWhitespace(source: string, index: number): number {
  let next = index;

  while (next < source.length && isSourceWhitespace(source, next)) next += 1;

  return next;
}

function skipWhitespaceBackward(source: string, index: number): number {
  let next = index;

  while (next >= 0 && isSourceWhitespace(source, next)) next -= 1;

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
      betterAuthArrayAppend(
        args,
        { end: index, start: argStart, text: betterAuthSlice(source, argStart, index) },
        'Better Auth schema source call arguments',
      );
      argStart = index + 1;
    }

    index = skipSourceToken(source, index);
  }

  betterAuthArrayAppend(
    args,
    { end, start: argStart, text: betterAuthSlice(source, argStart, end) },
    'Better Auth schema source call arguments',
  );

  return args;
}

function isTopLevelSeparator(source: string, start: number, index: number): boolean {
  const stack: string[] = [];
  let stackDepth = 0;
  let cursor = start;

  while (cursor < index) {
    const char = source[cursor] ?? '';
    const matchingClose = closingDelimiterFor(char);

    if (matchingClose) {
      betterAuthDefineOwnData(
        stack,
        stackDepth,
        matchingClose,
        'Better Auth schema delimiter stack',
      );
      stackDepth += 1;
      cursor += 1;
      continue;
    }

    if (stackDepth > 0 && char === stack[stackDepth - 1]) {
      stackDepth -= 1;
      cursor += 1;
      continue;
    }

    cursor = skipSourceToken(source, cursor);
  }

  return stackDepth === 0;
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
  const newline = betterAuthIndexOf(source, '\n', index + 2);

  return newline === -1 ? source.length : newline + 1;
}

function skipBlockComment(source: string, index: number): number {
  const close = betterAuthIndexOf(source, '*/', index + 2);

  return close === -1 ? source.length : close + 2;
}

function closingDelimiterFor(char: string): string | null {
  if (char === '(') return ')';
  if (char === '[') return ']';
  if (char === '{') return '}';

  return null;
}

function stringLiteralValue(text: string): string | null {
  if (betterAuthStartsWith(text, "'") || betterAuthStartsWith(text, '"')) {
    try {
      const jsonText = betterAuthStartsWith(text, "'") ? `"${betterAuthSlice(text, 1, -1)}"` : text;
      const parsed = betterAuthJsonParse(jsonText);
      return typeof parsed === 'string' ? parsed : null;
    } catch {
      return betterAuthSlice(text, 1, -1);
    }
  }

  if (
    betterAuthStartsWith(text, '`') &&
    betterAuthEndsWith(text, '`') &&
    !betterAuthIncludes(text, '${')
  ) {
    return betterAuthSlice(text, 1, -1);
  }

  return null;
}

function quoteTsString(value: string): string {
  return `'${betterAuthReplaceAll(betterAuthReplaceAll(value, '\\', '\\\\'), "'", "\\'")}'`;
}

function compactSourceText(source: string): string {
  let compact = '';
  for (let index = 0; index < source.length; index += 1) {
    if (!isSourceWhitespace(source, index)) compact += source[index]!;
  }
  return compact;
}

function applyBetterAuthSchemaSourceReplacements(
  source: string,
  replacements: readonly { end: number; start: number; value: string }[],
): string {
  const input = betterAuthSnapshotDenseArray(
    replacements,
    'Better Auth schema source replacements',
  );
  const sorted: { end: number; start: number; value: string }[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index]!;
    betterAuthArrayAppend(sorted, value, 'Better Auth schema source replacements');
    let insertion = sorted.length - 1;
    while (insertion > 0 && value.start > sorted[insertion - 1]!.start) {
      betterAuthDefineOwnData(
        sorted,
        insertion,
        sorted[insertion - 1]!,
        'Better Auth schema source replacements',
      );
      insertion -= 1;
    }
    betterAuthDefineOwnData(sorted, insertion, value, 'Better Auth schema source replacements');
  }
  let next = source;
  for (let index = 0; index < sorted.length; index += 1) {
    const range = sorted[index]!;
    next = `${betterAuthSlice(next, 0, range.start)}${range.value}${betterAuthSlice(
      next,
      range.end,
    )}`;
  }
  return next;
}

function isSourceWhitespace(source: string, index: number): boolean {
  const code = betterAuthCharacterCodeAt(source, index);
  return (
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0b ||
    code === 0x0c ||
    code === 0x0d ||
    code === 0x20 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}
