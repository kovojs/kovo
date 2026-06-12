import { domain, endpoint, guards, mutation, s } from '@jiso/server';
import type {
  AuthenticatedRequest,
  CsrfValidationOptions,
  Domain,
  EndpointAuthDeclaration,
  EndpointDeclaration,
  EndpointMethod,
  Guard,
  GuardFailure,
  MaybePromise,
  MutationDefinition,
  MutationFail,
  MutationRegistry,
  SessionProvider,
  SessionRequestLike,
} from '@jiso/server';

export interface BetterAuthGetSessionOptions {
  headers: Headers;
}

export interface BetterAuthSessionPayload<Session, User> {
  session: Session;
  user: User;
}

export interface BetterAuthApi<Session, User> {
  getSession(
    options: BetterAuthGetSessionOptions,
  ): MaybePromise<BetterAuthSessionPayload<Session, User> | null | undefined>;
}

export interface BetterAuthLike<Session, User> {
  api: BetterAuthApi<Session, User>;
}

export interface BetterAuthRequestLike {
  headers: Headers;
}

export type BetterAuthMountHandler = (request: Request) => MaybePromise<Response>;

export interface BetterAuthMountLike {
  handler: BetterAuthMountHandler;
}

export interface BetterAuthMountOptions<Method extends EndpointMethod = EndpointMethod> {
  auth?: EndpointAuthDeclaration;
  csrfJustification?: string;
  method?: Method;
}

export type BetterAuthSessionMapper<AuthSession, AuthUser, SessionValue> = (
  value: BetterAuthSessionPayload<AuthSession, AuthUser>,
) => SessionValue;

export function betterAuthSession<
  AuthSession,
  AuthUser,
  SessionValue,
  Request extends BetterAuthRequestLike = BetterAuthRequestLike,
>(
  auth: BetterAuthLike<AuthSession, AuthUser>,
  map: BetterAuthSessionMapper<AuthSession, AuthUser, SessionValue>,
): SessionProvider<Request, SessionValue> {
  return async (request) => {
    const value = await auth.api.getSession({ headers: request.headers });

    if (!value) return null;

    return map(value);
  };
}

// SPEC.md §9.1: adapter-owned OAuth/SAML/magic-link callbacks live behind declared
// prefix endpoints, while credential forms stay on typed mutations.
export function mount<
  const Path extends string,
  const Method extends EndpointMethod = EndpointMethod,
>(
  path: Path,
  auth: BetterAuthMountLike | BetterAuthMountHandler,
  options: BetterAuthMountOptions<Method> = {},
): EndpointDeclaration<Path, Method, 'prefix'> {
  const handler = typeof auth === 'function' ? auth : auth.handler;

  return endpoint(path, {
    auth: options.auth ?? { kind: 'custom', name: 'better-auth' },
    csrf: false,
    csrfJustification: options.csrfJustification ?? 'better-auth browser redirect protocol handler',
    handler(request) {
      return handler(request);
    },
    ...(options.method === undefined ? {} : { method: options.method }),
    mount: 'prefix',
  });
}

export interface BetterAuthResponseLike {
  headers: Headers;
  status: number;
}

export interface BetterAuthSignInEmailBody {
  email: string;
  password: string;
}

export interface BetterAuthSignUpEmailBody extends BetterAuthSignInEmailBody {
  name: string;
}

export interface BetterAuthSignInEmailApi {
  signInEmail(options: {
    asResponse: true;
    body: BetterAuthSignInEmailBody;
    headers: Headers;
  }): MaybePromise<BetterAuthResponseLike>;
}

export interface BetterAuthSignUpEmailApi {
  signUpEmail(options: {
    asResponse: true;
    body: BetterAuthSignUpEmailBody;
    headers: Headers;
  }): MaybePromise<BetterAuthResponseLike>;
}

export interface BetterAuthSignOutApi {
  signOut(options: { asResponse: true; headers: Headers }): MaybePromise<BetterAuthResponseLike>;
}

export interface BetterAuthSignInEmailLike {
  api: BetterAuthSignInEmailApi;
}

export interface BetterAuthSignUpEmailLike {
  api: BetterAuthSignUpEmailApi;
}

export interface BetterAuthSignOutLike {
  api: BetterAuthSignOutApi;
}

const optionalStringSchema = {
  parse(input: unknown): string | undefined {
    if (input === undefined || input === null || input === '') return undefined;
    if (typeof input !== 'string') throw new Error('Expected string');
    return input;
  },
};

export const betterAuthSignInEmailInput = s.object({
  email: s.string(),
  next: optionalStringSchema,
  password: s.string(),
});

export const betterAuthSignUpEmailInput = s.object({
  email: s.string(),
  name: s.string(),
  next: optionalStringSchema,
  password: s.string(),
});

export const betterAuthSignOutInput = s.object({});

export const betterAuthCredentialMutationErrors = {
  INVALID_CREDENTIALS: s.object({}),
};

export type BetterAuthCredentialMutationApi = 'signInEmail' | 'signOut' | 'signUpEmail';

const betterAuthCredentialMutationApis = [
  'signInEmail',
  'signOut',
  'signUpEmail',
] as const satisfies readonly BetterAuthCredentialMutationApi[];

export type BetterAuthCoreTable = 'account' | 'session' | 'user' | 'verification';
export type BetterAuthDeviceAuthorizationTable = 'deviceCode';
export type BetterAuthOrganizationTable =
  | 'invitation'
  | 'member'
  | 'organization'
  | 'organizationRole'
  | 'team'
  | 'teamMember';
export type BetterAuthOidcProviderTable = 'oauthAccessToken' | 'oauthApplication' | 'oauthConsent';
export type BetterAuthJwtTable = 'jwks';
export type BetterAuthRateLimitTable = 'rateLimit';
export type BetterAuthSiweTable = 'walletAddress';
export type BetterAuthTwoFactorTable = 'twoFactor';
export type BetterAuthTable =
  | BetterAuthCoreTable
  | BetterAuthDeviceAuthorizationTable
  | BetterAuthJwtTable
  | BetterAuthOidcProviderTable
  | BetterAuthOrganizationTable
  | BetterAuthRateLimitTable
  | BetterAuthSiweTable
  | BetterAuthTwoFactorTable;

export type BetterAuthTouchDomain = 'auth' | 'organization' | 'user';

export interface BetterAuthDeclaredTableTouch {
  domain: BetterAuthTouchDomain;
  table: string;
}

export interface BetterAuthSchemaBridgeDomainAnnotation {
  domain: BetterAuthTouchDomain;
  key?: string;
}

export type BetterAuthSchemaBridgeAnnotation =
  | BetterAuthSchemaBridgeDomainAnnotation
  | {
      exempt: true;
      rationale: string;
    };

export type BetterAuthSchemaBridge = Record<BetterAuthTable, BetterAuthSchemaBridgeAnnotation>;
export type BetterAuthSchemaBridgeExtensions = Record<string, BetterAuthSchemaBridgeAnnotation>;

export interface BetterAuthSchemaBridgeValidation {
  declaredTouchMismatches: string[];
  keyFieldMismatches: string[];
  missingTables: BetterAuthCoreTable[];
  ok: boolean;
  pluginTableDegradations: BetterAuthPluginTableDegradation[];
  unbridgedTables: string[];
}

export interface BetterAuthSchemaBridgeValidationOptions {
  credentialMutationDeclaredTableTouches?: Partial<
    Record<BetterAuthCredentialMutationApi, readonly BetterAuthDeclaredTableTouch[]>
  >;
  credentialMutationTouches?: Partial<Record<BetterAuthCredentialMutationApi, readonly Domain[]>>;
  schemaBridge?: BetterAuthSchemaBridgeExtensions;
}

export interface BetterAuthPluginTableDegradation {
  diagnosticCode: 'FW406';
  fields: string[] | null;
  manualBridgeSteps: string[];
  message: string;
  reason: 'unsupported-plugin-table';
  suggestedAnnotation: BetterAuthSchemaBridgeDomainAnnotation | null;
  table: string;
}

export interface BetterAuthOAuthProviderSuccessorMetadataDegradation {
  attemptedImports: readonly string[];
  diagnosticCode: 'FW406';
  legacyPlugin: 'oidcProvider';
  manualBridgeSteps: string[];
  message: string;
  packageName: '@better-auth/oauth-provider';
  reason: 'oauth-provider-successor-metadata-unavailable';
}

export interface BetterAuthTouchGraphSite {
  branch?: string;
  domain: BetterAuthTouchDomain;
  keys: null | string;
  predicate?: 'eq' | 'non-eq';
  site: string;
  via: string;
}

export interface BetterAuthTouchGraphEntry {
  touches: readonly BetterAuthTouchGraphSite[];
  unresolved: readonly [];
}

export type BetterAuthCredentialMutationTouchGraph = Readonly<
  Record<string, BetterAuthTouchGraphEntry>
>;

export interface BetterAuthDbVerificationConfig {
  domainByTable: Record<string, BetterAuthTouchDomain>;
  exemptTables: readonly string[];
  keyByTable: Record<string, string>;
}

export interface BetterAuthCredentialMutationTouchGraphOptions {
  apis?: readonly BetterAuthCredentialMutationApi[];
  credentialMutationDeclaredTableTouches?: Partial<
    Record<BetterAuthCredentialMutationApi, readonly BetterAuthDeclaredTableTouch[]>
  >;
  keys?: Partial<Record<BetterAuthCredentialMutationApi, string>>;
}

export interface BetterAuthSchemaSourceAnnotationOptions {
  annotationCallee?: string;
  schemaBridge?: BetterAuthSchemaBridgeExtensions;
  tableFactories?: readonly string[];
}

export interface BetterAuthSchemaSourceImportNote {
  hasRequiredImport: boolean;
  insertedImport: boolean;
  localName: string;
  shouldAddRequiredImport: boolean;
  suggestedImport: string;
}

export interface BetterAuthSchemaSourceAnnotationResult {
  alreadyAnnotatedTables: string[];
  annotatedTables: string[];
  existingExtraConfigTables: string[];
  importNote: BetterAuthSchemaSourceImportNote;
  missingSourceTables: string[];
  requiredImport: {
    module: '@jiso/drizzle';
    name: 'jiso';
  };
  source: string;
  validation: BetterAuthSchemaBridgeValidation;
}

export const betterAuthAuthDomain = domain('auth');
export const betterAuthOrganizationDomain = domain('organization');
export const betterAuthUserDomain = domain('user');

// plans/auth.md B1: app-owned schema.ts tables stay visible to the touch graph.
// User rows are intentionally not exempt; app queries commonly render names/avatars.
export const betterAuthSchemaBridge = {
  account: { domain: 'auth', key: 'userId' },
  deviceCode: {
    exempt: true,
    rationale:
      'Better Auth device-authorization codes are redirect/device-flow protocol state, not an app read surface under SPEC.md §10.1.',
  },
  invitation: { domain: 'organization', key: 'organizationId' },
  jwks: {
    exempt: true,
    rationale:
      'Better Auth JWT signing-key material is adapter bookkeeping; SPEC.md §10.1 forbids app queries from reading exempt tables.',
  },
  member: { domain: 'organization', key: 'organizationId' },
  oauthAccessToken: { domain: 'auth', key: 'userId' },
  oauthApplication: { domain: 'auth', key: 'userId' },
  oauthConsent: { domain: 'auth', key: 'userId' },
  organization: { domain: 'organization', key: 'id' },
  organizationRole: { domain: 'organization', key: 'organizationId' },
  rateLimit: {
    exempt: true,
    rationale:
      'Better Auth database-backed rate-limit counters are adapter enforcement state; SPEC.md §10.1 forbids app queries from reading exempt tables.',
  },
  session: { domain: 'auth', key: 'userId' },
  team: { domain: 'organization', key: 'organizationId' },
  teamMember: { domain: 'organization', key: 'teamId' },
  twoFactor: { domain: 'auth', key: 'userId' },
  user: { domain: 'user', key: 'id' },
  verification: {
    exempt: true,
    rationale: 'Better Auth email/token verification bookkeeping is not an app read surface.',
  },
  walletAddress: { domain: 'auth', key: 'userId' },
} as const satisfies BetterAuthSchemaBridge;

const betterAuthRequiredCoreTables = [
  'account',
  'session',
  'user',
  'verification',
] as const satisfies readonly BetterAuthCoreTable[];

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

// plans/auth.md B1/B6: better-auth writes are library-internal, so the blessed
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

export const betterAuthCredentialMutationTouches = {
  signInEmail: [betterAuthAuthDomain],
  signOut: [betterAuthAuthDomain],
  signUpEmail: [betterAuthUserDomain, betterAuthAuthDomain],
} as const satisfies Record<BetterAuthCredentialMutationApi, readonly Domain[]>;

export const betterAuthCredentialMutationDefaultKeys = {
  signInEmail: 'auth/sign-in',
  signOut: 'auth/sign-out',
  signUpEmail: 'auth/sign-up',
} as const satisfies Record<BetterAuthCredentialMutationApi, string>;

// plans/auth.md B1 / SPEC.md §11.2: declared Better Auth table touches are
// materialized as verifier facts so library-internal writes can be checked by
// P9 observed-write instrumentation.
export const betterAuthCredentialMutationTouchGraph =
  createBetterAuthCredentialMutationTouchGraph();

export const betterAuthDbVerificationConfig = createBetterAuthDbVerificationConfig();

export const betterAuthOAuthProviderSuccessorImportPaths = [
  '@better-auth/oauth-provider',
  'better-auth/oauth-provider',
  'better-auth/plugins/oauth-provider',
] as const;

// Better Auth 1.6.17 deprecates `oidcProvider()` in favor of the successor
// package. SPEC.md §11.2 keeps successor-owned writes FW406 until its real
// table metadata and declared touches are pinned.
export function betterAuthOAuthProviderSuccessorMetadataDegradation(
  attemptedImports: readonly string[] = betterAuthOAuthProviderSuccessorImportPaths,
): BetterAuthOAuthProviderSuccessorMetadataDegradation {
  return {
    attemptedImports,
    diagnosticCode: 'FW406',
    legacyPlugin: 'oidcProvider',
    manualBridgeSteps: [
      'Install the Better Auth OAuth-provider successor package and inspect getAuthTables(auth.options) with that plugin enabled.',
      'If the successor reuses oauthApplication/oauthAccessToken/oauthConsent with userId ownership, keep the existing auth-domain bridge and pin the package metadata in conformance.',
      'If the successor adds or renames tables, add schema.ts jiso({ domain, key }) or jiso({ exempt: true }) annotations and declared Better Auth API touches before relying on runtime coverage.',
    ],
    message:
      '@better-auth/oauth-provider metadata is not available from the pinned Better Auth dependency set; successor OAuth-provider writes remain FW406 until a real metadata path is pinned.',
    packageName: '@better-auth/oauth-provider',
    reason: 'oauth-provider-successor-metadata-unavailable',
  };
}

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
          site: `@jiso/better-auth:${api}`,
          via: touch.table,
        })),
        unresolved: [],
      },
    ]),
  );
}

export function createBetterAuthDbVerificationConfig(
  schemaBridge: BetterAuthSchemaBridgeExtensions = {},
): BetterAuthDbVerificationConfig {
  const domainByTable: Record<string, BetterAuthTouchDomain> = {};
  const exemptTables: string[] = [];
  const keyByTable: Record<string, string> = {};

  for (const [table, annotation] of Object.entries(createBetterAuthSchemaBridge(schemaBridge))) {
    if ('domain' in annotation) {
      domainByTable[table] = annotation.domain;
      if (annotation.key !== undefined) keyByTable[table] = annotation.key;
    } else {
      exemptTables.push(table);
    }
  }

  return {
    domainByTable,
    exemptTables,
    keyByTable,
  };
}

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
  const keyFieldMismatches = schemaBridgeKeyFieldMismatches(tables, schemaBridge);
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

// plans/auth.md B1 / SPEC.md §14: Better Auth owns the SQL/table metadata, while
// the app-authored schema.ts must carry explicit Jiso domain/exempt annotations.
export function annotateBetterAuthSchemaSource(
  source: string,
  tables: Record<string, unknown>,
  options: BetterAuthSchemaSourceAnnotationOptions = {},
): BetterAuthSchemaSourceAnnotationResult {
  const schemaBridge = createBetterAuthSchemaBridge(options.schemaBridge);
  const validation = validateBetterAuthSchemaBridge(tables, { schemaBridge });
  const metadataTables = new Set(Object.keys(tables));
  const sourceTables = findDrizzleTableCalls(source, options.tableFactories);
  const replacements: { end: number; start: number; value: string }[] = [];
  const annotatedTables: string[] = [];
  const alreadyAnnotatedTables: string[] = [];
  const existingExtraConfigTables: string[] = [];
  const annotationCallee = options.annotationCallee ?? 'jiso';
  const hasRequiredImport = hasNamedImportLocal(source, '@jiso/drizzle', annotationCallee);

  for (const call of sourceTables) {
    const table = call.tableName;
    if (!isBetterAuthSchemaTable(table, schemaBridge) || !metadataTables.has(table)) continue;

    if (call.extraConfigText !== null) {
      if (
        isBetterAuthSchemaAnnotationText(
          call.extraConfigText,
          table,
          annotationCallee,
          schemaBridge,
        )
      ) {
        alreadyAnnotatedTables.push(table);
      } else {
        existingExtraConfigTables.push(table);
      }
      continue;
    }

    replacements.push({
      end: call.closeParen,
      start: call.closeParen,
      value: `, ${betterAuthSchemaAnnotationCall(table, annotationCallee, schemaBridge)}`,
    });
    annotatedTables.push(table);
  }

  const sourceTableNames = new Set(sourceTables.map((call) => call.tableName));
  const missingSourceTables = [...metadataTables]
    .filter((table) => isBetterAuthSchemaTable(table, schemaBridge))
    .filter((table) => !sourceTableNames.has(table))
    .sort();
  const insertedImport = annotatedTables.length > 0 && !hasRequiredImport;
  const sourceReplacements = insertedImport
    ? [...replacements, betterAuthSchemaImportReplacement(source, annotationCallee)]
    : replacements;

  return {
    alreadyAnnotatedTables: sortedBetterAuthTables(alreadyAnnotatedTables),
    annotatedTables: sortedBetterAuthTables(annotatedTables),
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
      module: '@jiso/drizzle',
      name: 'jiso',
    },
    source: applyBetterAuthSchemaSourceReplacements(source, sourceReplacements),
    validation,
  };
}

export interface BetterAuthCredentialMutationValue<Status extends string> {
  redirectTo: string;
  status: Status;
}

export type BetterAuthCredentialFailure = MutationFail<
  'INVALID_CREDENTIALS',
  Record<string, never>
>;

export interface BetterAuthCredentialMutationOptions<
  Key extends string,
  Request extends BetterAuthRequestLike,
  GuardedRequest extends Request,
> {
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

export function betterAuthSignInEmailMutation<
  const Key extends string = 'auth/sign-in',
  Request extends BetterAuthRequestLike = BetterAuthRequestLike,
  GuardedRequest extends Request = Request,
>(
  auth: BetterAuthSignInEmailLike,
  options: BetterAuthCredentialMutationOptions<Key, Request, GuardedRequest> = {},
): MutationDefinition<
  Key,
  typeof betterAuthSignInEmailInput,
  typeof betterAuthCredentialMutationErrors,
  Request,
  BetterAuthCredentialMutationValue<'signed-in'>,
  GuardedRequest
> & { key: Key } {
  return mutation(options.key ?? ('auth/sign-in' as Key), {
    ...credentialMutationDefinitionOptions(
      options,
      betterAuthCredentialMutationTouches.signInEmail,
    ),
    errors: betterAuthCredentialMutationErrors,
    input: betterAuthSignInEmailInput,
    async handler(input, request, context) {
      try {
        const response = await auth.api.signInEmail({
          asResponse: true,
          body: {
            email: input.email,
            password: input.password,
          },
          headers: request.headers,
        });

        if (isBetterAuthCredentialFailureResponse(response)) {
          return context.fail('INVALID_CREDENTIALS', {});
        }

        forwardBetterAuthSetCookie(response.headers, context);

        return {
          redirectTo: redirectPath(input.next, options.defaultRedirectTo ?? '/'),
          status: 'signed-in',
        };
      } catch (error) {
        if (isBetterAuthCredentialFailureError(error)) {
          return context.fail('INVALID_CREDENTIALS', {});
        }

        throw error;
      }
    },
  });
}

export function betterAuthSignUpEmailMutation<
  const Key extends string = 'auth/sign-up',
  Request extends BetterAuthRequestLike = BetterAuthRequestLike,
  GuardedRequest extends Request = Request,
>(
  auth: BetterAuthSignUpEmailLike,
  options: BetterAuthCredentialMutationOptions<Key, Request, GuardedRequest> = {},
): MutationDefinition<
  Key,
  typeof betterAuthSignUpEmailInput,
  typeof betterAuthCredentialMutationErrors,
  Request,
  BetterAuthCredentialMutationValue<'signed-up'>,
  GuardedRequest
> & { key: Key } {
  return mutation(options.key ?? ('auth/sign-up' as Key), {
    ...credentialMutationDefinitionOptions(
      options,
      betterAuthCredentialMutationTouches.signUpEmail,
    ),
    errors: betterAuthCredentialMutationErrors,
    input: betterAuthSignUpEmailInput,
    async handler(input, request, context) {
      try {
        const response = await auth.api.signUpEmail({
          asResponse: true,
          body: {
            email: input.email,
            name: input.name,
            password: input.password,
          },
          headers: request.headers,
        });

        if (isBetterAuthCredentialFailureResponse(response)) {
          return context.fail('INVALID_CREDENTIALS', {});
        }

        forwardBetterAuthSetCookie(response.headers, context);

        return {
          redirectTo: redirectPath(input.next, options.defaultRedirectTo ?? '/'),
          status: 'signed-up',
        };
      } catch (error) {
        if (isBetterAuthCredentialFailureError(error)) {
          return context.fail('INVALID_CREDENTIALS', {});
        }

        throw error;
      }
    },
  });
}

export function betterAuthSignOutMutation<
  const Key extends string = 'auth/sign-out',
  Request extends BetterAuthRequestLike = BetterAuthRequestLike,
  GuardedRequest extends Request = Request,
>(
  auth: BetterAuthSignOutLike,
  options: BetterAuthCredentialMutationOptions<Key, Request, GuardedRequest> = {},
): MutationDefinition<
  Key,
  typeof betterAuthSignOutInput,
  Record<string, never>,
  Request,
  BetterAuthCredentialMutationValue<'signed-out'>,
  GuardedRequest
> & { key: Key } {
  return mutation(options.key ?? ('auth/sign-out' as Key), {
    ...credentialMutationDefinitionOptions(options, betterAuthCredentialMutationTouches.signOut),
    input: betterAuthSignOutInput,
    async handler(_input, request, context) {
      const response = await auth.api.signOut({
        asResponse: true,
        headers: request.headers,
      });

      forwardBetterAuthSetCookie(response.headers, context);

      return {
        redirectTo: options.defaultRedirectTo ?? '/login',
        status: 'signed-out',
      };
    },
  });
}

// SPEC.md §9.1 and plans/auth.md B4: credential mutations can only forward auth cookies
// through the current mutation response-header channel.
export function forwardBetterAuthSetCookie(
  headers: Headers,
  context: { setCookie?: (rawSetCookie: string) => void },
): void {
  for (const cookie of getBetterAuthSetCookie(headers)) {
    context.setCookie?.(cookie);
  }
}

export function getBetterAuthSetCookie(headers: Headers): string[] {
  const platformHeaders = headers as Headers & {
    getSetCookie?: () => string[];
  };
  const cookies = platformHeaders.getSetCookie?.();

  if (cookies && cookies.length > 0) return cookies;

  const cookie = headers.get('set-cookie');

  return cookie ? [cookie] : [];
}

export function isBetterAuthCredentialFailureResponse(response: BetterAuthResponseLike): boolean {
  return isCredentialFailureStatus(response.status);
}

export function isBetterAuthCredentialFailureError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const status =
    readNumericProperty(error, 'status') ??
    readNumericProperty(error, 'statusCode') ??
    readNumericProperty(error, 'code');

  return status === undefined ? false : isCredentialFailureStatus(status);
}

export function authed<Request extends SessionRequestLike>(): Guard<
  Request,
  AuthenticatedRequest<Request>
> {
  return guards.authed<Request>();
}

export interface BetterAuthRoleUser {
  id?: string;
  roles?: readonly string[] | null;
}

export interface BetterAuthRoleSession {
  user?: BetterAuthRoleUser | null;
}

export interface BetterAuthRoleRequest {
  session?: BetterAuthRoleSession | null;
}

type SessionFor<Request extends BetterAuthRoleRequest> = NonNullable<Request['session']>;
type UserFor<Request extends BetterAuthRoleRequest> = NonNullable<SessionFor<Request>['user']>;
type RoleNameFor<Request extends BetterAuthRoleRequest> =
  UserFor<Request> extends {
    roles?: readonly (infer Role)[] | null;
  }
    ? Extract<Role, string>
    : string;

export function role<Request extends BetterAuthRoleRequest>(
  requiredRole: RoleNameFor<Request>,
): Guard<Request>;
export function role(requiredRole: string): Guard<BetterAuthRoleRequest>;
export function role(requiredRole: string): Guard<BetterAuthRoleRequest> {
  return (request) => {
    if (!request.session?.user) return unauthenticatedGuardFailure();

    return request.session.user.roles?.includes(requiredRole) === true
      ? true
      : unauthorizedGuardFailure();
  };
}

export interface BetterAuthOrganizationSession extends BetterAuthRoleSession {
  activeOrganizationId?: string | null;
}

export interface BetterAuthOrganizationRequest {
  session?: BetterAuthOrganizationSession | null;
}

export type ActiveOrganizationRequest<Request extends BetterAuthOrganizationRequest> = Request & {
  session: NonNullable<Request['session']> & {
    activeOrganizationId: string;
    user: NonNullable<NonNullable<Request['session']>['user']>;
  };
};

export function activeOrganization<Request extends BetterAuthOrganizationRequest>(): Guard<
  Request,
  ActiveOrganizationRequest<Request>
> {
  return (request) => {
    if (!request.session?.user) return unauthenticatedGuardFailure();

    return request.session.activeOrganizationId ? true : unauthorizedGuardFailure();
  };
}

// SPEC.md §6.5 and §10.3: adapter guards preserve anonymous vs unauthorized failures.
function unauthenticatedGuardFailure(): GuardFailure {
  return {
    auth: 'unauthenticated',
    code: 'UNAUTHORIZED',
    payload: {},
    status: 422,
  };
}

function unauthorizedGuardFailure(): GuardFailure {
  return {
    auth: 'unauthorized',
    code: 'UNAUTHORIZED',
    payload: {},
    status: 422,
  };
}

function isCredentialFailureStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403;
}

function readNumericProperty(value: object, key: string): number | undefined {
  if (!Object.hasOwn(value, key)) return undefined;

  const property = (value as Record<string, unknown>)[key];

  return typeof property === 'number' ? property : undefined;
}

function redirectPath(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;

  return value;
}

function credentialMutationDefinitionOptions<
  Key extends string,
  Request extends BetterAuthRequestLike,
  GuardedRequest extends Request,
>(
  options: BetterAuthCredentialMutationOptions<Key, Request, GuardedRequest>,
  touches: readonly Domain[],
): Pick<
  MutationDefinition<Key, never, never, Request, never, GuardedRequest>,
  'csrf' | 'guard' | 'registry' | 'transaction'
> {
  return {
    ...(options.csrf === undefined ? {} : { csrf: options.csrf }),
    ...(options.guard === undefined ? {} : { guard: options.guard }),
    registry: {
      ...options.registry,
      touches: mergeDomainTouches(touches, options.registry?.touches),
    },
    ...(options.transaction === undefined ? {} : { transaction: options.transaction }),
  };
}

function mergeDomainTouches(
  defaults: readonly Domain[],
  overrides: readonly Domain[] | undefined,
): Domain[] {
  const merged = new Map(defaults.map((item) => [item.key, item]));

  for (const item of overrides ?? []) {
    merged.set(item.key, item);
  }

  return [...merged.values()];
}

function isBetterAuthCredentialMutationTouchGraphOptions(
  value:
    | BetterAuthCredentialMutationTouchGraphOptions
    | Partial<Record<BetterAuthCredentialMutationApi, string>>,
): value is BetterAuthCredentialMutationTouchGraphOptions {
  return 'apis' in value || 'credentialMutationDeclaredTableTouches' in value || 'keys' in value;
}

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
  const mismatches: string[] = [];

  for (const [table, annotation] of Object.entries(schemaBridge)) {
    if (!('domain' in annotation) || annotation.key === undefined) continue;

    const fieldNames = betterAuthTableFieldNames(tables[table]);

    if (fieldNames === null) continue;
    if (fieldNames.has(annotation.key)) continue;

    mismatches.push(
      `${table}.${annotation.key} is a schema-bridge key but Better Auth table metadata does not expose that field`,
    );
  }

  return mismatches.sort();
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
  const suggestedAnnotation = suggestedUnsupportedPluginTableAnnotation(fieldNames);

  return {
    diagnosticCode: 'FW406',
    fields: fieldNames === null ? null : [...fieldNames].sort(),
    manualBridgeSteps: unsupportedPluginTableManualBridgeSteps(
      table,
      fieldNames,
      suggestedAnnotation,
    ),
    message: `${table} is outside the blessed Better Auth schema bridge; add a schema.ts domain/exempt annotation and declared touches before relying on runtime coverage.`,
    reason: 'unsupported-plugin-table',
    suggestedAnnotation,
    table,
  };
}

function unsupportedPluginTableManualBridgeSteps(
  table: string,
  fields: Set<string> | null,
  suggestedAnnotation: BetterAuthSchemaBridgeDomainAnnotation | null,
): string[] {
  const fieldList =
    fields === null ? 'unavailable from Better Auth metadata' : [...fields].sort().join(', ');
  const annotationStep =
    suggestedAnnotation === null
      ? 'If it is app-visible, add a schema.ts jiso({ domain, key }) annotation; otherwise add jiso({ exempt: true }) with a rationale.'
      : `Likely app-visible ownership is jiso(${formatBetterAuthSchemaDomainAnnotation(
          suggestedAnnotation,
        )}); confirm before adding the bridge, otherwise use jiso({ exempt: true }) with a rationale.`;

  return [
    `Inspect ${table} fields (${fieldList}) and decide whether the app reads this table.`,
    annotationStep,
    `Add declared Better Auth API touches for writes that can mutate ${table}; SPEC.md §11.2 keeps observed writes FW406 until declared coverage exists.`,
  ];
}

function suggestedUnsupportedPluginTableAnnotation(
  fields: Set<string> | null,
): BetterAuthSchemaBridgeDomainAnnotation | null {
  if (fields === null) return null;
  if (fields.has('organizationId')) return { domain: 'organization', key: 'organizationId' };
  if (fields.has('teamId')) return { domain: 'organization', key: 'teamId' };
  if (fields.has('userId')) return { domain: 'auth', key: 'userId' };

  return null;
}

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
    ...betterAuthSchemaBridge,
    ...extensions,
  };
}

interface DrizzleTableCall {
  closeParen: number;
  extraConfigText: null | string;
  tableName: string;
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
  const specifier = localName === 'jiso' ? 'jiso' : `jiso as ${localName}`;

  return `import { ${specifier} } from '@jiso/drizzle';`;
}

function betterAuthSchemaImportReplacement(
  source: string,
  localName: string,
): { end: number; start: number; value: string } {
  const jisoDrizzleImport = findNamedImportFromModule(source, '@jiso/drizzle');
  const specifier = localName === 'jiso' ? 'jiso' : `jiso as ${localName}`;

  if (jisoDrizzleImport !== null) {
    const existingSpecifiers = jisoDrizzleImport.specifiersText.trim();
    const specifiers =
      existingSpecifiers.length === 0 ? specifier : `${existingSpecifiers}, ${specifier}`;

    return {
      end: jisoDrizzleImport.specifiersEnd,
      start: jisoDrizzleImport.specifiersStart,
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
  factories: readonly string[] = ['mysqlTable', 'pgTable', 'sqliteTable'],
): DrizzleTableCall[] {
  const calls: DrizzleTableCall[] = [];
  const factoryCallees = drizzleTableFactoryCallees(source, factories);

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
    const isFactoryCallee =
      memberCallee === null
        ? factoryCallees.identifiers.has(identifier.value)
        : factoryCallees.members.has(memberCallee);

    if (!isFactoryCallee) continue;
    if (memberCallee === null && isIdentifierCharacter(source[identifier.start - 1] ?? '')) {
      continue;
    }

    const openParen = skipWhitespace(source, identifier.end);
    if (source[openParen] !== '(') continue;

    const closeParen = findMatchingDelimiter(source, openParen, '(', ')');
    if (closeParen === -1) continue;

    const args = splitTopLevelArguments(source, openParen + 1, closeParen);
    const tableName = stringLiteralValue(args[0]?.text.trim() ?? '');

    if (tableName !== null) {
      calls.push({
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

const defaultDrizzleTableFactories = new Set<string>(Object.values(drizzleTableFactoryByModule));

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

  for (const factory of defaultDrizzleTableFactories) {
    identifiers.add(factory);
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
): string | null {
  const dot = skipWhitespaceBackward(source, property.start - 1);

  if (source[dot] !== '.') return null;

  const objectEnd = skipWhitespaceBackward(source, dot - 1) + 1;
  const objectStart = readIdentifierStartBefore(source, objectEnd);

  if (objectStart === null) return null;

  return `${source.slice(objectStart, objectEnd)}.${property.value}`;
}

function readIdentifierStartBefore(source: string, end: number): number | null {
  if (!isIdentifierCharacter(source[end - 1] ?? '')) return null;

  let start = end - 1;
  while (start > 0 && isIdentifierCharacter(source[start - 1])) start -= 1;

  return isIdentifierStart(source[start]) ? start : null;
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
