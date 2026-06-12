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

export type BetterAuthCoreTable = 'account' | 'session' | 'user' | 'verification';
export type BetterAuthOrganizationTable =
  | 'invitation'
  | 'member'
  | 'organization'
  | 'organizationRole'
  | 'team'
  | 'teamMember';
export type BetterAuthOidcProviderTable = 'oauthAccessToken' | 'oauthApplication' | 'oauthConsent';
export type BetterAuthJwtTable = 'jwks';
export type BetterAuthSiweTable = 'walletAddress';
export type BetterAuthTwoFactorTable = 'twoFactor';
export type BetterAuthTable =
  | BetterAuthCoreTable
  | BetterAuthJwtTable
  | BetterAuthOidcProviderTable
  | BetterAuthOrganizationTable
  | BetterAuthSiweTable
  | BetterAuthTwoFactorTable;

export type BetterAuthTouchDomain = 'auth' | 'organization' | 'user';

export interface BetterAuthDeclaredTableTouch {
  domain: BetterAuthTouchDomain;
  table: BetterAuthTable;
}

export type BetterAuthSchemaBridgeAnnotation =
  | {
      domain: BetterAuthTouchDomain;
      key?: string;
    }
  | {
      exempt: true;
      rationale: string;
    };

export type BetterAuthSchemaBridge = Record<BetterAuthTable, BetterAuthSchemaBridgeAnnotation>;

export interface BetterAuthSchemaBridgeValidation {
  declaredTouchMismatches: string[];
  keyFieldMismatches: string[];
  missingTables: BetterAuthCoreTable[];
  ok: boolean;
  pluginTableDegradations: BetterAuthPluginTableDegradation[];
  unbridgedTables: string[];
}

export interface BetterAuthPluginTableDegradation {
  diagnosticCode: 'FW406';
  fields: string[] | null;
  manualBridgeSteps: string[];
  message: string;
  reason: 'unsupported-plugin-table';
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
  via: BetterAuthTable;
}

export interface BetterAuthTouchGraphEntry {
  touches: readonly BetterAuthTouchGraphSite[];
  unresolved: readonly [];
}

export type BetterAuthCredentialMutationTouchGraph = Readonly<
  Record<string, BetterAuthTouchGraphEntry>
>;

export interface BetterAuthDbVerificationConfig {
  domainByTable: Partial<Record<BetterAuthTable, BetterAuthTouchDomain>>;
  exemptTables: readonly BetterAuthTable[];
  keyByTable: Partial<Record<BetterAuthTable, string>>;
}

export interface BetterAuthSchemaSourceAnnotationOptions {
  annotationCallee?: string;
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
  alreadyAnnotatedTables: BetterAuthTable[];
  annotatedTables: BetterAuthTable[];
  existingExtraConfigTables: string[];
  importNote: BetterAuthSchemaSourceImportNote;
  missingSourceTables: BetterAuthTable[];
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

export function betterAuthTableDomain(table: BetterAuthTable): BetterAuthTouchDomain | null {
  const bridge = betterAuthSchemaBridge[table];

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
  keys: Partial<Record<BetterAuthCredentialMutationApi, string>> = {},
): BetterAuthCredentialMutationTouchGraph {
  return Object.fromEntries(
    (
      Object.entries(betterAuthCredentialMutationDeclaredTableTouches) as [
        BetterAuthCredentialMutationApi,
        readonly BetterAuthDeclaredTableTouch[],
      ][]
    ).map(([api, touches]) => [
      keys[api] ?? betterAuthCredentialMutationDefaultKeys[api],
      {
        touches: touches.map((touch) => ({
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

export function createBetterAuthDbVerificationConfig(): BetterAuthDbVerificationConfig {
  const domainByTable: Partial<Record<BetterAuthTable, BetterAuthTouchDomain>> = {};
  const exemptTables: BetterAuthTable[] = [];
  const keyByTable: Partial<Record<BetterAuthTable, string>> = {};

  for (const [table, annotation] of Object.entries(betterAuthSchemaBridge) as [
    BetterAuthTable,
    BetterAuthSchemaBridgeAnnotation,
  ][]) {
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
): BetterAuthSchemaBridgeValidation {
  const bridgeTables = Object.keys(betterAuthSchemaBridge) as BetterAuthTable[];
  const tableNames = new Set(Object.keys(tables));
  const bridgeTableNames = new Set<string>(bridgeTables);
  const missingTables = betterAuthRequiredCoreTables.filter((table) => !tableNames.has(table));
  const unbridgedTables = [...tableNames].filter((table) => !bridgeTableNames.has(table)).sort();
  const declaredTouchMismatches = declaredTableTouchMismatches();
  const keyFieldMismatches = schemaBridgeKeyFieldMismatches(tables);
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
  const validation = validateBetterAuthSchemaBridge(tables);
  const metadataTables = new Set(Object.keys(tables));
  const sourceTables = findDrizzleTableCalls(source, options.tableFactories);
  const replacements: { end: number; start: number; value: string }[] = [];
  const annotatedTables: BetterAuthTable[] = [];
  const alreadyAnnotatedTables: BetterAuthTable[] = [];
  const existingExtraConfigTables: string[] = [];
  const annotationCallee = options.annotationCallee ?? 'jiso';
  const hasRequiredImport = hasNamedImportLocal(source, '@jiso/drizzle', annotationCallee);

  for (const call of sourceTables) {
    const table = call.tableName;
    if (!isBetterAuthTable(table) || !metadataTables.has(table)) continue;

    if (call.extraConfigText !== null) {
      if (isBetterAuthSchemaAnnotationText(call.extraConfigText, table, annotationCallee)) {
        alreadyAnnotatedTables.push(table);
      } else {
        existingExtraConfigTables.push(table);
      }
      continue;
    }

    replacements.push({
      end: call.closeParen,
      start: call.closeParen,
      value: `, ${betterAuthSchemaAnnotationCall(table, annotationCallee)}`,
    });
    annotatedTables.push(table);
  }

  const sourceTableNames = new Set(sourceTables.map((call) => call.tableName));
  const missingSourceTables = [...metadataTables]
    .filter((table): table is BetterAuthTable => isBetterAuthTable(table))
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

function declaredTableTouchMismatches(): string[] {
  const mismatches: string[] = [];

  for (const [api, touches] of Object.entries(betterAuthCredentialMutationDeclaredTableTouches)) {
    for (const touch of touches) {
      const domainForTable = betterAuthTableDomain(touch.table);

      if (domainForTable === null) {
        mismatches.push(`${api}.${touch.table} is declared touched but schema-bridge exempt`);
        continue;
      }

      if (domainForTable !== touch.domain) {
        mismatches.push(
          `${api}.${touch.table} declares ${touch.domain} but schema bridge maps ${domainForTable}`,
        );
      }
    }
  }

  return mismatches;
}

function schemaBridgeKeyFieldMismatches(tables: Record<string, unknown>): string[] {
  const mismatches: string[] = [];

  for (const [table, annotation] of Object.entries(betterAuthSchemaBridge) as [
    BetterAuthTable,
    BetterAuthSchemaBridgeAnnotation,
  ][]) {
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

  return {
    diagnosticCode: 'FW406',
    fields: fieldNames === null ? null : [...fieldNames].sort(),
    manualBridgeSteps: unsupportedPluginTableManualBridgeSteps(table, fieldNames),
    message: `${table} is outside the blessed Better Auth schema bridge; add a schema.ts domain/exempt annotation and declared touches before relying on runtime coverage.`,
    reason: 'unsupported-plugin-table',
    table,
  };
}

function unsupportedPluginTableManualBridgeSteps(
  table: string,
  fields: Set<string> | null,
): string[] {
  const fieldList =
    fields === null ? 'unavailable from Better Auth metadata' : [...fields].sort().join(', ');

  return [
    `Inspect ${table} fields (${fieldList}) and decide whether the app reads this table.`,
    'If it is app-visible, add a schema.ts jiso({ domain, key }) annotation; otherwise add jiso({ exempt: true }) with a rationale.',
    `Add declared Better Auth API touches for writes that can mutate ${table}; SPEC.md §11.2 keeps observed writes FW406 until declared coverage exists.`,
  ];
}

const betterAuthSchemaTableNames = new Set<string>(
  Object.keys(betterAuthSchemaBridge) as BetterAuthTable[],
);

interface DrizzleTableCall {
  closeParen: number;
  extraConfigText: null | string;
  tableName: string;
}

function isBetterAuthTable(table: string): table is BetterAuthTable {
  return betterAuthSchemaTableNames.has(table);
}

function sortedBetterAuthTables(tables: readonly BetterAuthTable[]): BetterAuthTable[] {
  return [...new Set(tables)].sort();
}

function betterAuthSchemaAnnotationCall(table: BetterAuthTable, annotationCallee: string): string {
  const annotation = betterAuthSchemaBridge[table];

  if ('domain' in annotation) {
    const key = annotation.key === undefined ? '' : `, key: ${quoteTsString(annotation.key)}`;

    return `${annotationCallee}({ domain: ${quoteTsString(annotation.domain)}${key} })`;
  }

  return `${annotationCallee}({ exempt: true })`;
}

function isBetterAuthSchemaAnnotationText(
  text: string,
  table: BetterAuthTable,
  annotationCallee: string,
): boolean {
  return (
    compactSourceText(text) ===
    compactSourceText(betterAuthSchemaAnnotationCall(table, annotationCallee))
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
      if (namedImportLocalName(specifier.trim()) === localName) return true;
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

function findFirstImport(source: string): number {
  const match = /^[ \t]*import\s/m.exec(source);

  return match?.index ?? 0;
}

function namedImportLocalName(specifier: string): string | null {
  const match =
    /^(?<imported>[A-Za-z_$][0-9A-Za-z_$]*)(?:\s+as\s+(?<local>[A-Za-z_$][0-9A-Za-z_$]*))?$/.exec(
      specifier,
    );

  return match?.groups?.local ?? match?.groups?.imported ?? null;
}

function findDrizzleTableCalls(
  source: string,
  factories: readonly string[] = ['mysqlTable', 'pgTable', 'sqliteTable'],
): DrizzleTableCall[] {
  const calls: DrizzleTableCall[] = [];
  const factoryNames = new Set(factories);

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

    if (identifier === null || !factoryNames.has(identifier.value)) continue;
    if (isIdentifierCharacter(source[identifier.start - 1] ?? '')) continue;
    if (source[identifier.start - 1] === '.') continue;

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
