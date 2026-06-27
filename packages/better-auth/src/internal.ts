import type { AccessDecision, CsrfValidationOptions, Domain, Guard } from '@kovojs/server';
import type { MutationRegistry } from '@kovojs/server/internal/execution';
import {
  betterAuthAuthDomain,
  betterAuthCredentialMutationErrors,
  betterAuthCredentialMutationApis,
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
  credentialMutationDefinitionOptions,
  forwardBetterAuthSetCookie,
  getBetterAuthSetCookie,
  isBetterAuthCredentialFailureError,
  isBetterAuthCredentialFailureResponse,
  isBetterAuthSessionRevocationSetCookie,
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
import { betterAuthOAuthProviderSuccessorImportPaths } from './internal/plugin-metadata.js';

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
  credentialMutationDefinitionOptions,
  forwardBetterAuthSetCookie,
  getBetterAuthSetCookie,
  isBetterAuthCredentialFailureError,
  isBetterAuthCredentialFailureResponse,
  isBetterAuthSessionRevocationSetCookie,
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

/**
 * Options for the credential mutations (`betterAuthSignInEmailMutation`,
 * `betterAuthSignUpEmailMutation`, `betterAuthSignOutMutation`). `csrf` wires
 * in CSRF validation (default-on per SPEC.md §6.6), `guard` runs an authorization/rate-limit
 * guard, `access` declares the KV436 default-deny access decision (SPEC.md §10.2) for a
 * credential mutation that has no `guard` (sign-in/sign-up run before authentication),
 * `defaultRedirectTo` sets the post-mutation redirect target, `key` overrides the
 * mutation key, and `registry`/`transaction` integrate with the app's mutation registry and
 * transaction boundary.
 */
export interface BetterAuthCredentialMutationOptions<
  Key extends string,
  Request extends BetterAuthRequestLike,
  GuardedRequest extends Request,
> {
  access?: AccessDecision;
  csrf?: CsrfValidationOptions<Request> | false;
  defaultRedirectTo?: string;
  guard?: Guard<Request, GuardedRequest>;
  key?: Key;
  registry?: MutationRegistry;
  transaction?: <Result>(
    request: Request,
    run: (transactionRequest: GuardedRequest) => Promise<Result>,
  ) => Promise<Result>;
}

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

/** @internal Declared table touches per Better Auth credential API, used to build verifier facts. */
// Archived D5 auth plan B1/B6: better-auth writes are library-internal, so the blessed
// wrappers carry declared table/domain touches until the P9 observed-write
// harness can verify observed ⊆ declared at runtime.
export const betterAuthCredentialMutationDeclaredTableTouches = {
  signInEmail: [{ domain: 'auth', table: 'session' }],
  signOut: [{ domain: 'auth', table: 'session' }],
  signUpEmail: [
    { domain: 'user', table: 'user' },
    { domain: 'auth', table: 'account' },
    { domain: 'auth', table: 'session' },
  ],
} as const satisfies Record<
  BetterAuthCredentialMutationApi,
  readonly BetterAuthDeclaredTableTouch[]
>;

/** @internal Default Kovo domain touches per Better Auth credential API. */
export const betterAuthCredentialMutationTouches = {
  signInEmail: [betterAuthAuthDomain],
  signOut: [betterAuthAuthDomain],
  signUpEmail: [betterAuthUserDomain, betterAuthAuthDomain],
} as const satisfies Record<BetterAuthCredentialMutationApi, readonly Domain[]>;

/** @internal Default mutation keys per Better Auth credential API. */
export const betterAuthCredentialMutationDefaultKeys = {
  signInEmail: 'auth/sign-in',
  signOut: 'auth/sign-out',
  signUpEmail: 'auth/sign-up',
} as const satisfies Record<BetterAuthCredentialMutationApi, string>;

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
  const keyOverrides = isBetterAuthCredentialMutationTouchGraphOptions(options)
    ? (options.keys ?? {})
    : options;
  const declaredTableTouches = isBetterAuthCredentialMutationTouchGraphOptions(options)
    ? options.credentialMutationDeclaredTableTouches
    : undefined;
  const apis = isBetterAuthCredentialMutationTouchGraphOptions(options)
    ? (options.apis ?? betterAuthCredentialMutationApis)
    : betterAuthCredentialMutationApis;

  return Object.fromEntries(
    apis.map((api) => [
      keyOverrides[api] ?? betterAuthCredentialMutationDefaultKeys[api],
      {
        touches: (
          declaredTableTouches?.[api] ?? betterAuthCredentialMutationDeclaredTableTouches[api]
        ).map((touch) => ({
          domain: touch.domain,
          // Better Auth owns the SQL; the P9 bridge verifies domain/table coverage
          // without pretending row-key predicates are available at this boundary.
          keys: null,
          site: `@kovojs/better-auth:${api}`,
          via: touch.table,
        })),
        unresolved: [],
      },
    ]),
  );
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
    const physicalTables = betterAuthPhysicalTableNames(table, tables).filter(
      (physicalTable) => !collidingPhysicalTables.has(physicalTable),
    );

    if ('domain' in annotation) {
      for (const physicalTable of physicalTables) {
        domainByTable[physicalTable] = annotation.domain;
        if (annotation.key !== undefined) keyByTable[physicalTable] = annotation.key;
      }
    } else {
      exemptTables.push(...physicalTables);
    }
  }

  return {
    domainByTable,
    exemptTables: [...new Set(exemptTables)],
    keyByTable,
  };
}

/** @internal Validate Better Auth table metadata against the schema bridge; reports KV406 gaps. */
export function validateBetterAuthSchemaBridge(
  tables: Record<string, unknown>,
  options: BetterAuthSchemaBridgeValidationOptions = {},
): BetterAuthSchemaBridgeValidation {
  const schemaBridge = createBetterAuthSchemaBridge(options.schemaBridge);
  const bridgeTables = Object.keys(schemaBridge);
  const tableNames = new Set(Object.keys(tables));
  const bridgeTableNames = new Set<string>(bridgeTables);
  const missingTables = betterAuthRequiredCoreTables.filter((table) => !tableNames.has(table));
  const unbridgedTables = [...tableNames].filter((table) => !bridgeTableNames.has(table)).sort();
  const declaredTouchMismatches = declaredTableTouchMismatches(tableNames, {
    ...options,
    schemaBridge,
  });
  const keyFieldMismatches = [
    ...schemaBridgeKeyFieldMismatches(tables, schemaBridge),
    ...schemaBridgeExtensionCollisionMismatches(options.schemaBridge),
  ].sort();
  const pluginTableDegradations = unbridgedTables.map((table) =>
    unsupportedPluginTableDegradation(table, tables[table]),
  );

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
  const sourceTableCandidates = findSchemaTableCallCandidates(source);
  const sourceTables = findDrizzleTableCalls(source, options.tableFactories);
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
  const annotationCallee = options.annotationCallee ?? 'kovo';
  const hasRequiredImport = hasNamedImportLocal(source, '@kovojs/drizzle', annotationCallee);

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
        )
      ) {
        alreadyAnnotatedTables.push(call.tableName);
      } else {
        existingExtraConfigTables.push(call.tableName);
      }
      continue;
    }

    replacements.push({
      end: call.closeParen,
      start: call.closeParen,
      value: `, ${betterAuthSchemaAnnotationCall(table, annotationCallee, schemaBridge)}`,
    });
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
      [
        `export const ${exportName} = ${tableFactory}(${quoteTsString(physicalTable)}, {`,
        ...columns.lines.map((line) => `  ${line}`),
        `}, ${betterAuthSchemaAnnotationCall(table, annotationCallee, schemaBridge)});`,
      ].join('\n'),
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

  for (const api of betterAuthCredentialMutationApis) {
    const touches =
      options.credentialMutationDeclaredTableTouches?.[api] ??
      betterAuthCredentialMutationDeclaredTableTouches[api];
    const mutationTouchDomains = (
      options.credentialMutationTouches?.[api] ?? betterAuthCredentialMutationTouches[api]
    ).map((touch) => touch.key);
    const declaredTouchDomains = touches.map((touch) => touch.domain);

    for (const touch of touches) {
      if (!tableNames.has(touch.table)) {
        mismatches.push(
          `${api}.${touch.table} is declared touched but Better Auth table metadata is missing that table`,
        );
        continue;
      }

      const bridge = betterAuthSchemaBridgeAnnotation(touch.table, schemaBridge);

      if (bridge === undefined) {
        mismatches.push(
          `${api}.${touch.table} is declared touched but outside the Better Auth schema bridge`,
        );
        continue;
      }

      if (!('domain' in bridge)) {
        mismatches.push(`${api}.${touch.table} is declared touched but schema-bridge exempt`);
        continue;
      }

      if (bridge.domain !== touch.domain) {
        mismatches.push(
          `${api}.${touch.table} declares ${touch.domain} but schema bridge maps ${bridge.domain}`,
        );
      }
    }

    if (!sameSortedValues(declaredTouchDomains, mutationTouchDomains)) {
      mismatches.push(
        `${api} mutation registry domains ${formatDomainList(
          mutationTouchDomains,
        )} do not match declared table-touch domains ${formatDomainList(declaredTouchDomains)}`,
      );
    }
  }

  return mismatches.sort();
}

function sameSortedValues(left: readonly string[], right: readonly string[]): boolean {
  const leftValues = [...new Set(left)].sort();
  const rightValues = [...new Set(right)].sort();

  if (leftValues.length !== rightValues.length) return false;

  return leftValues.every((value, index) => value === rightValues[index]);
}

function formatDomainList(values: readonly string[]): string {
  const uniqueValues = [...new Set(values)].sort();

  return uniqueValues.length === 0 ? '[]' : `[${uniqueValues.join(', ')}]`;
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

    mismatches.push(schemaBridgeKeyFieldMismatch(table, annotation.key, tables[table]));
  }

  return mismatches.sort();
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

    mismatches.push(
      `Better Auth tables ${logicalTables.join(
        ', ',
      )} resolve to the same physical table ${physicalTable}; modelName aliases must be unique for schema.ts annotations and P9 verification`,
    );
  }

  return mismatches;
}

function betterAuthCollidingPhysicalTableNames(
  tables: Record<string, unknown>,
  schemaBridge: BetterAuthSchemaBridgeExtensions = betterAuthSchemaBridge,
): Set<string> {
  return new Set(
    [...betterAuthPhysicalTableNameGroups(tables, schemaBridge)]
      .filter(([, logicalTables]) => logicalTables.length > 1)
      .map(([physicalTable]) => physicalTable),
  );
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
    fields: fieldNames === null ? null : [...fieldNames].sort(),
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
    fields === null ? 'unavailable from Better Auth metadata' : [...fields].sort().join(', ');
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
  if (fields.has('userId')) return { domain: 'auth', key: 'userId' };

  return null;
}

function isLikelyBetterAuthProtocolTable(fields: ReadonlySet<string>): boolean {
  const nonIdFields = [...fields].filter((field) => field !== 'id');

  if (nonIdFields.length === 0) return false;
  if (!nonIdFields.some((field) => protocolStateAnchorFields.has(field))) return false;

  return nonIdFields.every((field) => protocolStateFields.has(field));
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

  return `{ domain: '${annotation.domain}'${key} }`;
}

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

  return Object.keys(extensions)
    .filter((table) => builtInTables.has(table))
    .sort()
    .map(
      (table) =>
        `${table} is a blessed Better Auth schema-bridge table; extension entries may only add plugin tables outside the built-in bridge`,
    );
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
    logicalTables.push(table);
    physicalTables.set(physicalTable, logicalTables.sort());
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

interface DrizzleTableCall {
  callee: string;
  closeParen: number;
  extraConfigText: null | string;
  tableName: string;
}

type BetterAuthGeneratedSchemaFieldBuilder = 'boolean' | 'integer' | 'text' | 'timestamp';

interface BetterAuthGeneratedSchemaColumns {
  builders: Set<BetterAuthGeneratedSchemaFieldBuilder>;
  lines: string[];
}

function betterAuthGeneratedSchemaColumns(
  table: string,
  metadata: unknown,
  dialect: BetterAuthSchemaSourceDialect,
): BetterAuthGeneratedSchemaColumns | { degradation: BetterAuthGeneratedSchemaTableDegradation } {
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

  const lines = [`id: ${idColumn.expression},`];
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
    lines.push(`${betterAuthSchemaObjectPropertyName(field)}: ${column.expression},`);
  }

  return { builders, lines };
}

function betterAuthGeneratedSchemaIdColumn(
  table: string,
  physicalTable: string,
  metadata: unknown,
  dialect: BetterAuthSchemaSourceDialect,
):
  | {
      builder: BetterAuthGeneratedSchemaFieldBuilder;
      expression: string;
    }
  | { degradation: BetterAuthGeneratedSchemaTableDegradation } {
  if (metadata === undefined) {
    return {
      builder: 'text',
      expression: "text('id').primaryKey()",
    };
  }

  const type = betterAuthFieldType(metadata);
  const builder = betterAuthGeneratedSchemaFieldBuilder(type, dialect);
  const fieldNames = betterAuthTableFieldNames({ fields: { id: metadata } });

  if (builder === null) {
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
    builder,
    expression: `${betterAuthGeneratedSchemaColumnExpression(
      builder,
      columnName,
      type,
      dialect,
    )}.primaryKey()`,
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
      expression: string;
    }
  | { degradation: BetterAuthGeneratedSchemaTableDegradation } {
  const type = betterAuthFieldType(metadata);
  const builder = betterAuthGeneratedSchemaFieldBuilder(type, dialect);
  const fieldNames = betterAuthTableFieldNames({ fields: { [field]: metadata } });

  if (builder === null) {
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
  const notNull = required ? '.notNull()' : '';

  return {
    builder,
    expression: `${betterAuthGeneratedSchemaColumnExpression(
      builder,
      columnName,
      type,
      dialect,
    )}${notNull}`,
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

function betterAuthGeneratedSchemaFieldBuilder(
  type: string | null,
  dialect: BetterAuthSchemaSourceDialect,
): BetterAuthGeneratedSchemaFieldBuilder | null {
  if (type === 'boolean') return dialect === 'sqlite' ? 'integer' : 'boolean';
  if (type === 'date') return dialect === 'sqlite' ? 'text' : 'timestamp';
  if (type === 'number') return 'integer';
  if (type === 'string') return 'text';

  return null;
}

function betterAuthGeneratedSchemaColumnExpression(
  builder: BetterAuthGeneratedSchemaFieldBuilder,
  columnName: string,
  fieldType: string | null,
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
): string {
  const annotation = betterAuthSchemaBridgeAnnotation(table, schemaBridge);

  if (annotation === undefined) {
    throw new Error(`${table} is outside the Better Auth schema bridge`);
  }

  if ('domain' in annotation) {
    const key = annotation.key === undefined ? '' : `, key: ${quoteTsString(annotation.key)}`;

    return `${annotationCallee}({ domain: ${quoteTsString(annotation.domain)}${key} })`;
  }

  return `${annotationCallee}({ exempt: true })`;
}

function isBetterAuthSchemaAnnotationText(
  text: string,
  table: string,
  annotationCallee: string,
  schemaBridge: BetterAuthSchemaBridgeExtensions = betterAuthSchemaBridge,
): boolean {
  return (
    compactSourceText(text) ===
    compactSourceText(betterAuthSchemaAnnotationCall(table, annotationCallee, schemaBridge))
  );
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

function hasNamedImportLocal(source: string, moduleName: string, localName: string): boolean {
  for (const namedImport of findNamedImports(source)) {
    if (stringLiteralValue(namedImport.moduleText) !== moduleName) continue;

    for (const specifier of namedImport.specifiersText.split(',')) {
      if (namedImportSpecifier(specifier.trim())?.local === localName) return true;
    }
  }

  return false;
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
  const importPattern = /import\s*\{(?<specifiers>[^}]+)\}\s*from\s*(?<module>['"][^'"]+['"])/g;

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

function findDrizzleTableCalls(
  source: string,
  factories: readonly string[] = [],
): DrizzleTableCall[] {
  const factoryCallees = drizzleTableFactoryCallees(source, factories);

  return findSchemaTableCallCandidates(source).filter((call) =>
    call.callee.includes('.')
      ? factoryCallees.members.has(call.callee)
      : factoryCallees.identifiers.has(call.callee),
  );
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
