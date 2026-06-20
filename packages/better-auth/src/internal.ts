import { domain, endpoint, guards, mutation, s } from '@kovojs/server';
import type {
  AuthenticatedRequest,
  CookieOptions,
  CsrfValidationOptions,
  Domain,
  EndpointAuthDeclaration,
  EndpointDeclaration,
  EndpointMethod,
  Guard,
  GuardDenial,
  MutationDefinition,
  MutationFail,
  SessionProvider,
  SessionRequestLike,
} from '@kovojs/server';
import type { MutationRegistry } from '@kovojs/server/internal/execution';

/**
 * Options passed to a Better Auth `getSession` call. Carries the incoming request
 * `Headers` so Better Auth can read the session cookie. Part of the `BetterAuthApi`
 * contract the adapter consumes when building a Kovo session provider (SPEC.md §6.5).
 */
export interface BetterAuthGetSessionOptions {
  headers: Headers;
}

/**
 * The `{ session, user }` pair Better Auth returns for an authenticated request. The
 * adapter maps this into the app's own session value via a `BetterAuthSessionMapper`;
 * see SPEC.md §6.5 for how sessions flow into the request.
 */
export interface BetterAuthSessionPayload<Session, User> {
  session: Session;
  user: User;
}

/**
 * The subset of the Better Auth server `api` the session provider depends on: a
 * `getSession` method returning a `BetterAuthSessionPayload` (or null/undefined
 * when unauthenticated). Structurally satisfied by a real Better Auth instance.
 */
export interface BetterAuthApi<Session, User> {
  getSession(
    options: BetterAuthGetSessionOptions,
  ):
    | Promise<BetterAuthSessionPayload<Session, User> | null | undefined>
    | BetterAuthSessionPayload<Session, User>
    | null
    | undefined;
}

/**
 * Structural shape of a Better Auth instance accepted by `betterAuthSession`: it
 * just needs an `api` exposing `getSession`. Apps pass their real Better Auth object,
 * which satisfies this without an explicit cast (SPEC.md §6.5).
 */
export interface BetterAuthLike<Session, User> {
  api: BetterAuthApi<Session, User>;
}

/**
 * Minimal request shape the credential mutations and session provider read from: an
 * object carrying the incoming `Headers`. Apps extend this with their own session and
 * CSRF fields; it is the default `Request` type parameter across this adapter's helpers.
 */
export interface BetterAuthRequestLike {
  headers: Headers;
}

/**
 * Handler that turns a web `Request` into a `Response`. This is Better Auth's own
 * fetch-style handler, mounted at a prefix endpoint by `mount` to serve the
 * library's browser redirect protocol (OAuth/SAML/magic-link callbacks; SPEC.md §9.1).
 */
export type BetterAuthMountHandler = (request: Request) => Promise<Response> | Response;

/**
 * Structural shape of a Better Auth instance accepted by `mount`: it just needs a
 * `handler`. Apps pass their real Better Auth object directly.
 */
export interface BetterAuthMountLike {
  handler: BetterAuthMountHandler;
}

/**
 * Options for `mount`. `auth` overrides the default `custom` endpoint auth
 * declaration; `method` narrows the HTTP method; `csrfJustification` records why this
 * prefix endpoint is exempt from CSRF (the endpoint always runs with `csrf: false` — see
 * `mount` for the SPEC.md §6.6 rationale).
 */
export interface BetterAuthMountOptions<Method extends EndpointMethod = EndpointMethod> {
  auth?: EndpointAuthDeclaration;
  csrfJustification?: string;
  method?: Method;
}

/**
 * Function the app supplies to `betterAuthSession` to project Better Auth's
 * `{ session, user }` payload into the app's own session value. Called once per
 * authenticated request (SPEC.md §6.5).
 */
export type BetterAuthSessionMapper<AuthSession, AuthUser, SessionValue> = (
  value: BetterAuthSessionPayload<AuthSession, AuthUser>,
) => SessionValue;

/**
 * Builds a Kovo `SessionProvider` backed by Better Auth: it calls
 * `auth.api.getSession({ headers })` for each request and projects the result through
 * `map` into the app's session value, returning `null` when there is no session. Wire the
 * returned provider into `session(...)` so guards and pages see the authenticated user
 * (SPEC.md §6.5).
 */
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

/**
 * Mounts Better Auth's own request handler at a prefix endpoint so its browser redirect
 * protocol — OAuth/SAML/magic-link callbacks and similar provider round-trips — is served
 * under one declared path, while credential forms stay on typed mutations (SPEC.md §9.1).
 *
 * SECURITY — this endpoint is always declared with `csrf: false`. Per SPEC.md §6.6, CSRF
 * protection is default-ON for server-rendered, cookie-authenticated mutations, and
 * `csrf: false` is the framework's *sanctioned opt-out* reserved for endpoints that are
 * not browser-form-driven or are authenticated by some other means (e.g. non-browser /
 * externally-authenticated callers). Better Auth's redirect protocol handler is exactly
 * such an endpoint: the inbound requests are external-provider redirects and the
 * library-supplied OAuth `state` parameter (not a Kovo CSRF token) carries the
 * anti-forgery guarantee, so a Kovo CSRF token cannot be present or required here.
 * Disabling CSRF on this prefix does NOT relax protection on the app's own credential
 * mutations, which keep CSRF on. The reason is recorded on the endpoint via
 * `csrfJustification` (overridable through `BetterAuthMountOptions`).
 */
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

/**
 * Minimal Better Auth response shape the credential mutations inspect: an object with
 * `status` and `headers`. Used to classify sign-in/sign-up success and to forward
 * `Set-Cookie` headers into the mutation response (SPEC.md §6.5).
 */
export interface BetterAuthResponseLike {
  headers: Headers;
  status: number;
}

/** Request body for a Better Auth email/password sign-in: `email` and `password`. */
export interface BetterAuthSignInEmailBody {
  email: string;
  password: string;
}

/** Request body for a Better Auth email/password sign-up: a sign-in body plus `name`. */
export interface BetterAuthSignUpEmailBody extends BetterAuthSignInEmailBody {
  name: string;
}

/**
 * The subset of the Better Auth server `api` consumed by `betterAuthSignInEmailMutation`:
 * a `signInEmail` method invoked with `asResponse: true` so the adapter can read the raw
 * response status and `Set-Cookie` headers (SPEC.md §6.5).
 */
export interface BetterAuthSignInEmailApi {
  signInEmail(options: {
    asResponse: true;
    body: BetterAuthSignInEmailBody;
    headers: Headers;
  }): Promise<BetterAuthResponseLike> | BetterAuthResponseLike;
}

/**
 * The subset of the Better Auth server `api` consumed by `betterAuthSignUpEmailMutation`:
 * a `signUpEmail` method invoked with `asResponse: true` (SPEC.md §6.5).
 */
export interface BetterAuthSignUpEmailApi {
  signUpEmail(options: {
    asResponse: true;
    body: BetterAuthSignUpEmailBody;
    headers: Headers;
  }): Promise<BetterAuthResponseLike> | BetterAuthResponseLike;
}

/**
 * The subset of the Better Auth server `api` consumed by `betterAuthSignOutMutation`:
 * a `signOut` method invoked with `asResponse: true` so the session-clearing `Set-Cookie`
 * headers can be forwarded (SPEC.md §6.5).
 */
export interface BetterAuthSignOutApi {
  signOut(options: {
    asResponse: true;
    headers: Headers;
  }): Promise<BetterAuthResponseLike> | BetterAuthResponseLike;
}

/**
 * Structural shape accepted by `betterAuthSignInEmailMutation`: a Better Auth
 * instance whose `api` exposes `signInEmail`. A real Better Auth object satisfies this.
 */
export interface BetterAuthSignInEmailLike {
  api: BetterAuthSignInEmailApi;
}

/**
 * Structural shape accepted by `betterAuthSignUpEmailMutation`: a Better Auth
 * instance whose `api` exposes `signUpEmail`.
 */
export interface BetterAuthSignUpEmailLike {
  api: BetterAuthSignUpEmailApi;
}

/**
 * Structural shape accepted by `betterAuthSignOutMutation`: a Better Auth instance
 * whose `api` exposes `signOut`.
 */
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

/**
 * Input schema for `betterAuthSignInEmailMutation` — `email`, `password`, and an
 * optional same-origin `next` redirect target. Exposed because it is the declared input
 * of the sign-in mutation; reuse it when building the matching login form (SPEC.md §6.5).
 */
export const betterAuthSignInEmailInput = s.object({
  email: s.string(),
  next: optionalStringSchema,
  password: s.string(),
});

/**
 * Input schema for `betterAuthSignUpEmailMutation` — `email`, `name`, `password`,
 * and an optional same-origin `next` redirect target (SPEC.md §6.5).
 */
export const betterAuthSignUpEmailInput = s.object({
  email: s.string(),
  name: s.string(),
  next: optionalStringSchema,
  password: s.string(),
});

/** Input schema for `betterAuthSignOutMutation`; sign-out takes no fields. */
export const betterAuthSignOutInput = s.object({});

/**
 * Declared error map for the credential mutations: a single `INVALID_CREDENTIALS` failure
 * (with an empty payload) the sign-in/sign-up mutations return when a session was not
 * positively established. Surfaced so apps can render the matching error UI (SPEC.md §6.5).
 */
export const betterAuthCredentialMutationErrors = {
  INVALID_CREDENTIALS: s.object({}),
};

/** @internal Better Auth credential API names keyed by the adapter's touch/registry plumbing. */
export type BetterAuthCredentialMutationApi = 'signInEmail' | 'signOut' | 'signUpEmail';

const betterAuthCredentialMutationApis = [
  'signInEmail',
  'signOut',
  'signUpEmail',
] as const satisfies readonly BetterAuthCredentialMutationApi[];

/** @internal Better Auth core table names recognized by the schema bridge. */
export type BetterAuthCoreTable = 'account' | 'session' | 'user' | 'verification';
/** @internal Better Auth device-authorization plugin table name. */
export type BetterAuthDeviceAuthorizationTable = 'deviceCode';
/** @internal Better Auth organization plugin table names. */
export type BetterAuthOrganizationTable =
  | 'invitation'
  | 'member'
  | 'organization'
  | 'organizationRole'
  | 'team'
  | 'teamMember';
/** @internal Better Auth OIDC-provider plugin table names. */
export type BetterAuthOidcProviderTable = 'oauthAccessToken' | 'oauthApplication' | 'oauthConsent';
/** @internal Better Auth JWT plugin table name. */
export type BetterAuthJwtTable = 'jwks';
/** @internal Better Auth rate-limit plugin table name. */
export type BetterAuthRateLimitTable = 'rateLimit';
/** @internal Better Auth SIWE plugin table name. */
export type BetterAuthSiweTable = 'walletAddress';
/** @internal Better Auth two-factor plugin table name. */
export type BetterAuthTwoFactorTable = 'twoFactor';
/** @internal Union of all Better Auth table names known to the schema bridge. */
export type BetterAuthTable =
  | BetterAuthCoreTable
  | BetterAuthDeviceAuthorizationTable
  | BetterAuthJwtTable
  | BetterAuthOidcProviderTable
  | BetterAuthOrganizationTable
  | BetterAuthRateLimitTable
  | BetterAuthSiweTable
  | BetterAuthTwoFactorTable;

/** @internal Kovo domain a Better Auth table is bridged into for touch-graph verification. */
export type BetterAuthTouchDomain = 'auth' | 'organization' | 'user';

/** @internal A declared `{ domain, table }` touch for a Better Auth credential write. */
export interface BetterAuthDeclaredTableTouch {
  domain: BetterAuthTouchDomain;
  table: string;
}

/** @internal Schema-bridge annotation mapping a Better Auth table to a Kovo domain/key. */
export interface BetterAuthSchemaBridgeDomainAnnotation {
  domain: BetterAuthTouchDomain;
  key?: string;
}

/** @internal Schema-bridge annotation: either a domain mapping or an exempt-with-rationale entry. */
export type BetterAuthSchemaBridgeAnnotation =
  | BetterAuthSchemaBridgeDomainAnnotation
  | {
      exempt: true;
      rationale: string;
    };

/** @internal Full Better Auth schema bridge: every known table mapped to an annotation. */
export type BetterAuthSchemaBridge = Record<BetterAuthTable, BetterAuthSchemaBridgeAnnotation>;
/** @internal Schema-bridge extensions for app/plugin tables outside the built-in bridge. */
export type BetterAuthSchemaBridgeExtensions = Record<string, BetterAuthSchemaBridgeAnnotation>;

/** @internal Result of validating an app schema against the Better Auth schema bridge. */
export interface BetterAuthSchemaBridgeValidation {
  declaredTouchMismatches: string[];
  keyFieldMismatches: string[];
  missingTables: BetterAuthCoreTable[];
  ok: boolean;
  pluginTableDegradations: BetterAuthPluginTableDegradation[];
  unbridgedTables: string[];
}

/** @internal Options for `validateBetterAuthSchemaBridge`: bridge extensions and declared touches. */
export interface BetterAuthSchemaBridgeValidationOptions {
  credentialMutationDeclaredTableTouches?: Partial<
    Record<BetterAuthCredentialMutationApi, readonly BetterAuthDeclaredTableTouch[]>
  >;
  credentialMutationTouches?: Partial<Record<BetterAuthCredentialMutationApi, readonly Domain[]>>;
  schemaBridge?: BetterAuthSchemaBridgeExtensions;
}

/** @internal KV406 degradation fact: a Better Auth table outside the blessed schema bridge. */
export interface BetterAuthPluginTableDegradation {
  diagnosticCode: 'KV406';
  fields: string[] | null;
  manualBridgeSteps: string[];
  message: string;
  physicalTable?: string;
  reason: 'unsupported-plugin-table';
  suggestedAnnotation: BetterAuthSchemaBridgeAnnotation | null;
  table: string;
}

/** @internal KV406 degradation fact: a schema.ts table declaration the adapter could not recognize. */
export interface BetterAuthSchemaSourceDeclarationDegradation {
  callee: string;
  diagnosticCode: 'KV406';
  manualBridgeSteps: string[];
  message: string;
  physicalTable?: string;
  reason: 'unrecognized-schema-table-declaration';
  table: string;
}

/** @internal KV406 degradation fact: a schema.ts plugin table the adapter did not auto-annotate. */
export interface BetterAuthSchemaSourcePluginTableDegradation {
  callee: string;
  diagnosticCode: 'KV406';
  fields: string[] | null;
  manualBridgeSteps: string[];
  message: string;
  physicalTable?: string;
  reason: 'unsupported-plugin-table-source';
  sourceFactory: 'recognized-drizzle-table' | 'unrecognized-table-factory';
  suggestedAnnotation: BetterAuthSchemaBridgeAnnotation | null;
  table: string;
}

/** @internal KV406 degradation fact: the OAuth-provider successor package metadata is unavailable. */
export interface BetterAuthOAuthProviderSuccessorMetadataDegradation {
  attemptedImports: readonly string[];
  diagnosticCode: 'KV406';
  legacyPlugin: 'oidcProvider';
  manualBridgeSteps: string[];
  message: string;
  packageName: '@better-auth/oauth-provider';
  reason: 'oauth-provider-successor-metadata-unavailable';
  schemaBridge: null;
  tableMetadata: null;
}

/** @internal KV406 degradation fact: a Better Auth plugin's real table metadata is unavailable. */
export interface BetterAuthUnavailablePluginMetadataDegradation {
  attemptedImports: readonly string[];
  diagnosticCode: 'KV406';
  manualBridgeSteps: string[];
  message: string;
  packageName: string;
  pluginName: string;
  reason: 'plugin-metadata-unavailable';
  schemaBridge: null;
  tableMetadata: null;
}

/** @internal A single touch-graph site emitted for a Better Auth credential write. */
export interface BetterAuthTouchGraphSite {
  branch?: string;
  domain: BetterAuthTouchDomain;
  keys: null | string;
  predicate?: 'eq' | 'non-eq';
  site: string;
  via: string;
}

/** @internal A touch-graph entry: the touches declared for one Better Auth credential write. */
export interface BetterAuthTouchGraphEntry {
  touches: readonly BetterAuthTouchGraphSite[];
  unresolved: readonly [];
}

/** @internal Map of credential-mutation keys to their declared touch-graph entries. */
export type BetterAuthCredentialMutationTouchGraph = Readonly<
  Record<string, BetterAuthTouchGraphEntry>
>;

/** @internal Db-verification config: per-physical-table domain/key/exempt data for the P9 bridge. */
export interface BetterAuthDbVerificationConfig {
  domainByTable: Record<string, BetterAuthTouchDomain>;
  exemptTables: readonly string[];
  keyByTable: Record<string, string>;
}

/** @internal Options for `createBetterAuthCredentialMutationTouchGraph`. */
export interface BetterAuthCredentialMutationTouchGraphOptions {
  apis?: readonly BetterAuthCredentialMutationApi[];
  credentialMutationDeclaredTableTouches?: Partial<
    Record<BetterAuthCredentialMutationApi, readonly BetterAuthDeclaredTableTouch[]>
  >;
  keys?: Partial<Record<BetterAuthCredentialMutationApi, string>>;
}

/** @internal Options for `annotateBetterAuthSchemaSource`. */
export interface BetterAuthSchemaSourceAnnotationOptions {
  annotationCallee?: string;
  schemaBridge?: BetterAuthSchemaBridgeExtensions;
  tableFactories?: readonly string[];
}

/** @internal Import-handling note returned by the schema-source annotator. */
export interface BetterAuthSchemaSourceImportNote {
  hasRequiredImport: boolean;
  insertedImport: boolean;
  localName: string;
  shouldAddRequiredImport: boolean;
  suggestedImport: string;
}

/** @internal Result of annotating an app schema.ts with Better Auth domain/exempt annotations. */
export interface BetterAuthSchemaSourceAnnotationResult {
  alreadyAnnotatedTables: string[];
  annotatedTables: string[];
  duplicateSourceTables: string[];
  existingExtraConfigTables: string[];
  importNote: BetterAuthSchemaSourceImportNote;
  missingSourceTables: string[];
  requiredImport: {
    module: '@kovojs/drizzle';
    name: 'kovo';
  };
  source: string;
  unsupportedSourceTables: BetterAuthSchemaSourcePluginTableDegradation[];
  unrecognizedSourceTables: BetterAuthSchemaSourceDeclarationDegradation[];
  validation: BetterAuthSchemaBridgeValidation;
}

/** @internal Reasons a generated schema.ts table is degraded to a KV406 fact. */
export type BetterAuthGeneratedSchemaTableDegradationReason =
  | 'ambiguous-physical-table'
  | 'schema-bridge-key-unavailable'
  | 'table-field-metadata-unavailable'
  | 'unsupported-field-type';

/** @internal KV406 degradation fact: a table that could not be generated into schema.ts. */
export interface BetterAuthGeneratedSchemaTableDegradation {
  diagnosticCode: 'KV406';
  field?: string;
  fields: string[] | null;
  manualBridgeSteps: string[];
  message: string;
  physicalTable?: string;
  reason: BetterAuthGeneratedSchemaTableDegradationReason;
  table: string;
}

/** @internal A successfully generated schema.ts table descriptor. */
export interface BetterAuthGeneratedSchemaTable {
  exportName: string;
  physicalTable: string;
  table: string;
}

/** @internal Options for `generateBetterAuthSchemaSource`. */
export interface BetterAuthSchemaSourceGenerationOptions {
  annotationCallee?: string;
  schemaBridge?: BetterAuthSchemaBridgeExtensions;
}

/** @internal Result of generating an app schema.ts from Better Auth table metadata. */
export interface BetterAuthSchemaSourceGenerationResult {
  generatedTables: BetterAuthGeneratedSchemaTable[];
  requiredImports: string[];
  skippedTables: BetterAuthGeneratedSchemaTableDegradation[];
  source: string;
  unsupportedPluginTables: BetterAuthPluginTableDegradation[];
  validation: BetterAuthSchemaBridgeValidation;
}

/** @internal Kovo `auth` domain handle used by the credential-mutation touch declarations. */
export const betterAuthAuthDomain = domain('auth');
/** @internal Kovo `organization` domain handle for organization-plugin touch declarations. */
export const betterAuthOrganizationDomain = domain('organization');
/** @internal Kovo `user` domain handle used by the credential-mutation touch declarations. */
export const betterAuthUserDomain = domain('user');

/**
 * @internal Blessed Better Auth schema bridge: maps each known table to a Kovo
 * domain/key or an exempt-with-rationale annotation.
 */
// Archived D5 auth plan B1: app-owned schema.ts tables stay visible to the touch graph.
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

/** @internal Candidate import paths probed for the OAuth-provider successor package metadata. */
export const betterAuthOAuthProviderSuccessorImportPaths = [
  '@better-auth/oauth-provider',
  'better-auth/oauth-provider',
  'better-auth/plugins/oauth-provider',
] as const;

/** @internal Candidate import paths probed for the Better Auth SSO plugin metadata. */
export const betterAuthSsoPluginMetadataImportPaths = [
  'better-auth/plugins/sso',
  'better-auth/sso',
  '@better-auth/sso',
] as const;

/** @internal Candidate import paths probed for the Better Auth passkey plugin metadata. */
export const betterAuthPasskeyPluginMetadataImportPaths = [
  'better-auth/plugins/passkey',
  'better-auth/passkey',
  '@better-auth/passkey',
] as const;

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
  const collidingPhysicalTables = betterAuthCollidingPhysicalTableNames(tables, schemaBridge);
  const generatedTables: BetterAuthGeneratedSchemaTable[] = [];
  const skippedTables: BetterAuthGeneratedSchemaTableDegradation[] = [];
  const declarations: string[] = [];
  const requiredBuilders = new Set<string>(['pgTable']);
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

    const columns = betterAuthGeneratedSchemaColumns(table, metadata);
    if ('degradation' in columns) {
      skippedTables.push(columns.degradation);
      continue;
    }

    for (const builder of columns.builders) requiredBuilders.add(builder);

    const exportName = uniqueBetterAuthSchemaExportName(table, exportNames);
    generatedTables.push({ exportName, physicalTable, table });
    declarations.push(
      [
        `export const ${exportName} = pgTable(${quoteTsString(physicalTable)}, {`,
        ...columns.lines.map((line) => `  ${line}`),
        `}, ${betterAuthSchemaAnnotationCall(table, annotationCallee, schemaBridge)});`,
      ].join('\n'),
    );
  }

  const drizzleImport = `import { ${[...requiredBuilders]
    .sort()
    .join(', ')} } from 'drizzle-orm/pg-core';`;
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
export interface BetterAuthCredentialMutationValue<Status extends string> {
  redirectTo: string;
  status: Status;
}

/** @internal Typed shape of the `INVALID_CREDENTIALS` failure the credential mutations can return. */
export type BetterAuthCredentialFailure = MutationFail<
  'INVALID_CREDENTIALS',
  Record<string, never>
>;

/**
 * Options for the credential mutations (`betterAuthSignInEmailMutation`,
 * `betterAuthSignUpEmailMutation`, `betterAuthSignOutMutation`). `csrf` wires
 * in CSRF validation (default-on per SPEC.md §6.6), `guard` runs an authorization/rate-limit
 * guard, `defaultRedirectTo` sets the post-mutation redirect target, `key` overrides the
 * mutation key, and `registry`/`transaction` integrate with the app's mutation registry and
 * transaction boundary.
 */
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

/**
 * Builds a typed Kovo mutation that signs a user in via Better Auth email/password.
 * Calls `auth.api.signInEmail` with `asResponse: true`, treats the result as success only
 * on POSITIVE evidence of an established session (2xx, no two-factor-pending body, and a
 * session-establishing `Set-Cookie`), forwards the session cookie, and otherwise returns
 * the declared `INVALID_CREDENTIALS` failure. Defaults the mutation key to `auth/sign-in`.
 * Wire it into the app's mutation registry and pair it with a CSRF-protected login form
 * (SPEC.md §6.5; CSRF default-on per §6.6).
 */
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
    redirectTo: (result) => result.value.redirectTo,
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

        const success = await resolveBetterAuthCredentialSuccess(response, context, {
          redirectTo: redirectPath(input.next, options.defaultRedirectTo ?? '/'),
          status: 'signed-in',
        });

        if (success === null) {
          return context.fail('INVALID_CREDENTIALS', {});
        }

        return success;
      } catch (error) {
        if (isBetterAuthCredentialFailureError(error)) {
          return context.fail('INVALID_CREDENTIALS', {});
        }

        throw error;
      }
    },
  });
}

/**
 * Builds a typed Kovo mutation that registers a user via Better Auth email/password.
 * Calls `auth.api.signUpEmail` with `asResponse: true`, applies the same
 * positive-session-evidence success check as sign-in, forwards the session cookie, and
 * returns the declared `INVALID_CREDENTIALS` failure otherwise. Defaults the mutation key
 * to `auth/sign-up` (SPEC.md §6.5; CSRF default-on per §6.6).
 */
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
    redirectTo: (result) => result.value.redirectTo,
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

        const success = await resolveBetterAuthCredentialSuccess(response, context, {
          redirectTo: redirectPath(input.next, options.defaultRedirectTo ?? '/'),
          status: 'signed-up',
        });

        if (success === null) {
          return context.fail('INVALID_CREDENTIALS', {});
        }

        return success;
      } catch (error) {
        if (isBetterAuthCredentialFailureError(error)) {
          return context.fail('INVALID_CREDENTIALS', {});
        }

        throw error;
      }
    },
  });
}

/**
 * Builds a typed Kovo mutation that signs a user out via Better Auth. Calls
 * `auth.api.signOut` with `asResponse: true`, forwards the session-clearing `Set-Cookie`
 * headers into the mutation response, and redirects to `defaultRedirectTo` (default
 * `/login`). Defaults the mutation key to `auth/sign-out`. Typically guarded so only an
 * authenticated request can sign out (SPEC.md §6.5; CSRF default-on per §6.6).
 */
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
    redirectTo: (result) => result.value.redirectTo,
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

/** @internal Forward Better Auth `Set-Cookie` headers into the mutation response channel. */
// SPEC.md §9.1 and archived D5 auth plan B4: credential mutations can only forward auth cookies
// through the current mutation response-header channel.
export function forwardBetterAuthSetCookie(
  headers: Headers,
  context: { setCookie?: (name: string, value: string, options?: CookieOptions) => void },
): void {
  // bug-and-testing-part2 B3: the public Set-Cookie channel is the typed builder only (no raw
  // free-string overload). Better Auth emits standard URL-encoded Set-Cookie strings, so parse each
  // into (name, value, attributes) and re-emit through the typed builder. The value is decoded once
  // (Better Auth URL-encodes it) so the typed builder re-encodes it to the identical wire bytes.
  const setCookie = context.setCookie;
  if (!setCookie) return;
  for (const cookie of getBetterAuthSetCookie(headers)) {
    const parsed = parseSetCookieHeader(cookie);
    if (parsed) setCookie(parsed.name, parsed.value, parsed.options);
  }
}

/** @internal Parse a standard `Set-Cookie` header string into a typed cookie-builder call. */
function parseSetCookieHeader(
  raw: string,
): { name: string; options: CookieOptions; value: string } | undefined {
  const segments = raw.split(';');
  const first = segments[0] ?? '';
  const separator = first.indexOf('=');
  if (separator <= 0) return undefined;
  const name = first.slice(0, separator).trim();
  if (!name) return undefined;
  const value = decodeCookieOctet(first.slice(separator + 1).trim());

  const options: CookieOptions = {};
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index]?.trim();
    if (!segment) continue;
    const attrSeparator = segment.indexOf('=');
    const attr = (attrSeparator === -1 ? segment : segment.slice(0, attrSeparator)).trim().toLowerCase();
    const attrValue = attrSeparator === -1 ? '' : segment.slice(attrSeparator + 1).trim();
    switch (attr) {
      case 'httponly':
        options.httpOnly = true;
        break;
      case 'secure':
        options.secure = true;
        break;
      case 'path':
        options.path = attrValue;
        break;
      case 'domain':
        options.domain = attrValue;
        break;
      case 'max-age': {
        const maxAge = Number(attrValue);
        if (!Number.isNaN(maxAge)) options.maxAge = maxAge;
        break;
      }
      case 'expires':
        options.expires = attrValue;
        break;
      case 'samesite': {
        const sameSite = attrValue.toLowerCase();
        if (sameSite === 'lax' || sameSite === 'none' || sameSite === 'strict') {
          options.sameSite = sameSite;
        }
        break;
      }
      default:
        break; // ignore attributes the typed builder does not model (Priority, Partitioned, …)
    }
  }
  return { name, options, value };
}

function decodeCookieOctet(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** @internal Read all `Set-Cookie` values from a Headers object across platform variants. */
export function getBetterAuthSetCookie(headers: Headers): string[] {
  const platformHeaders = headers as Headers & {
    getSetCookie?: () => string[];
  };
  const cookies = platformHeaders.getSetCookie?.();

  if (cookies && cookies.length > 0) return cookies;

  const cookie = headers.get('set-cookie');

  return cookie ? [cookie] : [];
}

/** @internal True when a Better Auth response status (400/401/403) signals a credential failure. */
export function isBetterAuthCredentialFailureResponse(response: BetterAuthResponseLike): boolean {
  return isCredentialFailureStatus(response.status);
}

// SECURITY (SECURITY_FINDINGS.md M2): a credential sign-in/sign-up must be classified
// by POSITIVE evidence of an established session, never by the mere absence of a
// 400/401/403. Better Auth returns Response objects for 2FA-pending (`200` with a
// `twoFactorRedirect` body and no session cookie), rate-limit (`429`), and transient
// 5xx; none of those establish a session and must be treated as failures.
function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

// A Set-Cookie that establishes a session sets a non-empty value and is not a
// deletion (`Max-Age=0` / `Expires` in the past / empty value). Sign-out clears
// cookies this way, so the same predicate cleanly distinguishes establish vs. clear.
function isSessionEstablishingSetCookie(rawSetCookie: string): boolean {
  const firstPair = rawSetCookie.split(';', 1)[0] ?? '';
  const separatorIndex = firstPair.indexOf('=');
  if (separatorIndex < 0) return false;

  const value = firstPair.slice(separatorIndex + 1).trim();
  if (value === '') return false;

  const attributes = rawSetCookie.slice(firstPair.length).toLowerCase();
  if (/(?:^|;)\s*max-age\s*=\s*0(?:\s*;|\s*$)/.test(attributes)) return false;
  if (/(?:^|;)\s*max-age\s*=\s*-/.test(attributes)) return false;

  return true;
}

function hasSessionEstablishingSetCookie(headers: Headers): boolean {
  return getBetterAuthSetCookie(headers).some(isSessionEstablishingSetCookie);
}

interface BetterAuthCredentialResponseWithBody extends BetterAuthResponseLike {
  clone?: () => { json?: () => Promise<unknown> };
  json?: () => Promise<unknown>;
}

// Better Auth returns `200 { twoFactorRedirect: true, ... }` (no session cookie) when
// a second factor is required. The framework has no 2FA UI, so this is treated as a
// failure rather than redirecting into the protected area. The body is read from a
// clone so the original Response stays consumable for cookie forwarding; non-Response
// fakes (plain `{ headers, status }`) simply report "no two-factor body".
async function isBetterAuthTwoFactorPendingResponse(
  response: BetterAuthResponseLike,
): Promise<boolean> {
  const withBody = response as BetterAuthCredentialResponseWithBody;
  const readJson = (() => {
    if (typeof withBody.clone === 'function') {
      const cloned = withBody.clone();
      if (cloned && typeof cloned.json === 'function') return cloned.json.bind(cloned);
    }
    if (typeof withBody.json === 'function') return withBody.json.bind(withBody);
    return undefined;
  })();

  if (!readJson) return false;

  try {
    const body = await readJson();
    return (
      typeof body === 'object' &&
      body !== null &&
      (body as Record<string, unknown>).twoFactorRedirect === true
    );
  } catch {
    // A non-JSON or unreadable body cannot be a two-factor-pending payload.
    return false;
  }
}

// Resolve a credential response to a success value only when the session was
// positively established; otherwise return null so the caller emits the declared
// failure. See SECURITY_FINDINGS.md M2.
async function resolveBetterAuthCredentialSuccess<Status extends string>(
  response: BetterAuthResponseLike,
  context: { setCookie?: (name: string, value: string, options?: CookieOptions) => void },
  success: BetterAuthCredentialMutationValue<Status>,
): Promise<BetterAuthCredentialMutationValue<Status> | null> {
  if (!isSuccessStatus(response.status)) return null;
  if (await isBetterAuthTwoFactorPendingResponse(response)) return null;
  if (!hasSessionEstablishingSetCookie(response.headers)) return null;

  forwardBetterAuthSetCookie(response.headers, context);

  return success;
}

/** @internal True when a thrown Better Auth error carries a 400/401/403 credential-failure status. */
export function isBetterAuthCredentialFailureError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const status =
    readNumericProperty(error, 'status') ??
    readNumericProperty(error, 'statusCode') ??
    readNumericProperty(error, 'code');

  return status === undefined ? false : isCredentialFailureStatus(status);
}

/**
 * Guard that requires an authenticated session, narrowing the request to an
 * `AuthenticatedRequest`. A thin re-export of the framework's `guards.authed` for use on
 * auth-protected mutations and routes; an unauthenticated request denies with a
 * login-redirect intent (SPEC.md §6.5).
 */
export function authed<Request extends SessionRequestLike>(): Guard<
  Request,
  AuthenticatedRequest<Request>
> {
  return guards.authed<Request>();
}

/**
 * Minimal user shape the `role` guard reads: an optional `id` and an optional `roles`
 * list. Apps' own session-user types structurally satisfy this (SPEC.md §6.5).
 */
export interface BetterAuthRoleUser {
  id?: string;
  roles?: readonly string[] | null;
}

/** Minimal session shape the `role` guard reads: an optional `user`. */
export interface BetterAuthRoleSession {
  user?: BetterAuthRoleUser | null;
}

/** Minimal request shape the `role` guard reads: an optional `session`. */
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

/**
 * Guard that requires the session user to hold a given role. Denies with an
 * unauthenticated (→ login redirect) intent when there is no session user, and with a
 * forbidden (→ 403) intent when the user lacks the role. The role name is type-checked
 * against the request's own `roles` element type when known (SPEC.md §6.5).
 */
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

/** @internal Session shape with an optional active organization id, read by `activeOrganization`. */
export interface BetterAuthOrganizationSession extends BetterAuthRoleSession {
  activeOrganizationId?: string | null;
}

/** @internal Request shape carrying an organization session for the `activeOrganization` guard. */
export interface BetterAuthOrganizationRequest {
  session?: BetterAuthOrganizationSession | null;
}

/** @internal Request narrowed by `activeOrganization` to guarantee a non-null active organization. */
export type ActiveOrganizationRequest<Request extends BetterAuthOrganizationRequest> = Request & {
  session: NonNullable<Request['session']> & {
    activeOrganizationId: string;
    user: NonNullable<NonNullable<Request['session']>['user']>;
  };
};

/** @internal Guard that requires an active organization on the session; narrows the request accordingly. */
export function activeOrganization<Request extends BetterAuthOrganizationRequest>(): Guard<
  Request,
  ActiveOrganizationRequest<Request>
> {
  return (request) => {
    if (!request.session?.user) return unauthenticatedGuardFailure();

    return request.session.activeOrganizationId ? true : unauthorizedGuardFailure();
  };
}

// SPEC.md §6.5 and §10.3: adapter guards preserve the unauthenticated (→ login
// redirect) vs forbidden (→ 403 shell) intent the framework maps to HTTP.
function unauthenticatedGuardFailure(): GuardDenial {
  return {
    kind: 'unauthenticated',
    payload: {},
  };
}

function unauthorizedGuardFailure(): GuardDenial {
  return {
    kind: 'forbidden',
    payload: {},
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

// SECURITY (SECURITY_FINDINGS.md H4): the same-origin redirect guard must reject
// authority-forming targets after backslash-normalization (browsers collapse `\`
// to `/` when resolving http(s) URLs, so `/\evil.com` resolves cross-origin) and
// reject ASCII control characters that can smuggle a CRLF / header-splitting
// payload into the emitted `Location` response header.
// eslint-disable-next-line no-control-regex -- intentional ASCII control-char class (U+0000 to U+001F, U+007F).
const redirectControlCharPattern = /[\u0000-\u001f\u007f]/;

function redirectPath(value: string | undefined, fallback: string): string {
  if (typeof value !== 'string' || value === '') return fallback;
  if (redirectControlCharPattern.test(value)) return fallback;

  // Browsers treat backslashes as path separators when resolving http(s) URLs, so
  // collapse them before checking for a protocol-relative (`//`) authority.
  const collapsed = value.replace(/\\/g, '/');
  if (!collapsed.startsWith('/') || collapsed.startsWith('//')) return fallback;

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

  const idColumn = betterAuthGeneratedSchemaIdColumn(table, physicalTable, fields.id);

  if ('degradation' in idColumn) return idColumn;

  const lines = [`id: ${idColumn.expression},`];
  const builders = new Set<BetterAuthGeneratedSchemaFieldBuilder>([idColumn.builder]);

  for (const [field, fieldMetadata] of Object.entries(fields)) {
    if (field === 'id') continue;

    const column = betterAuthGeneratedSchemaColumn(table, physicalTable, field, fieldMetadata);

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
  const builder = betterAuthGeneratedSchemaFieldBuilder(type);
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
    expression: `${builder}(${quoteTsString(columnName)}).primaryKey()`,
  };
}

function betterAuthGeneratedSchemaColumn(
  table: string,
  physicalTable: string,
  field: string,
  metadata: unknown,
):
  | {
      builder: BetterAuthGeneratedSchemaFieldBuilder;
      expression: string;
    }
  | { degradation: BetterAuthGeneratedSchemaTableDegradation } {
  const type = betterAuthFieldType(metadata);
  const builder = betterAuthGeneratedSchemaFieldBuilder(type);
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
    expression: `${builder}(${quoteTsString(columnName)})${notNull}`,
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
): BetterAuthGeneratedSchemaFieldBuilder | null {
  if (type === 'boolean') return 'boolean';
  if (type === 'date') return 'timestamp';
  if (type === 'number') return 'integer';
  if (type === 'string') return 'text';

  return null;
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
