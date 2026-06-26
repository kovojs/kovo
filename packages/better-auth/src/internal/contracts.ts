import { domain, s } from '@kovojs/server';
import type { Domain } from '@kovojs/server';

import type { BetterAuthSessionPayload } from '../session.js';

/**
 * Options passed to a Better Auth `getSession` call. Carries the incoming request
 * `Headers` so Better Auth can read the session cookie. Part of the `BetterAuthApi`
 * contract the adapter consumes when building a Kovo session provider (SPEC.md §6.5).
 */
export interface BetterAuthGetSessionOptions {
  headers: Headers;
}

/**
 * part-3 I2: options for a `getSession` call that also returns the response `Headers`.
 * Better Auth writes fresh session-refresh / cookie-cache `Set-Cookie` headers there
 * (on `updateAge`/`cookieCache`); the adapter forwards them so rolling sessions extend
 * (SPEC.md §6.5, §9.1.1:854).
 */
export interface BetterAuthGetSessionWithHeadersOptions extends BetterAuthGetSessionOptions {
  returnHeaders: true;
}

/**
 * The `{ response, headers }` pair Better Auth returns from `getSession` when called with
 * `returnHeaders: true`: `response` is the session payload (or null/undefined) and `headers`
 * carries any refresh `Set-Cookie` the call wrote (part-3 I2).
 */
export interface BetterAuthGetSessionWithHeadersResult<Session, User> {
  headers: Headers;
  response: BetterAuthSessionPayload<Session, User> | null | undefined;
}

/**
 * The subset of the Better Auth server `api` the session provider depends on: a
 * `getSession` method. part-3 I2: the adapter calls it with `returnHeaders: true` so it
 * CAN forward session-refresh `Set-Cookie` headers when the instance honors that option
 * and returns the `{ response, headers }` envelope. The consumed signature stays
 * BACKWARD-COMPATIBLE — it also admits an instance whose `getSession` ignores
 * `returnHeaders` and returns the bare session payload (as the example apps and a
 * non-overloaded instance do). The provider detects the shape at runtime
 * ({@link betterAuthSession}); a real overloaded Better Auth instance satisfies it too.
 */
export interface BetterAuthApi<Session, User> {
  getSession(
    options: BetterAuthGetSessionWithHeadersOptions,
  ):
    | Promise<
        | BetterAuthGetSessionWithHeadersResult<Session, User>
        | BetterAuthSessionPayload<Session, User>
        | null
        | undefined
      >
    | BetterAuthGetSessionWithHeadersResult<Session, User>
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

/** @internal Better Auth credential API names keyed by the adapter's touch/registry plumbing. */
export const betterAuthCredentialMutationApis = [
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
  // bugz-3 M6 (SPEC.md §10.1): credential/token/bearer columns that must never reach the
  // client wire. Emitted into the schema.ts `kovo({ ..., secret: [...] })` annotation so the
  // Drizzle confidentiality gate (KV435) brands any projection that reads them `kind:'secret'`,
  // while legitimate owner-scoped non-secret reads of the same table stay green.
  secret?: readonly string[];
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
  dialect?: BetterAuthSchemaSourceDialect;
  schemaBridge?: BetterAuthSchemaBridgeExtensions;
}

/** @internal Drizzle dialects supported by generated Better Auth schema.ts output. */
export type BetterAuthSchemaSourceDialect = 'postgres' | 'sqlite';

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
  // bugz-3 M6 (SPEC.md §10.1): `account` stores the password hash and OAuth access/refresh/id
  // tokens. They stay owner-scoped (`auth`/`userId`) so apps can still render non-secret
  // columns (provider, scope), but the credential columns are classified `secret:` so a
  // projection that reaches them fires KV435 instead of serializing a long-lived credential.
  account: {
    domain: 'auth',
    key: 'userId',
    secret: ['password', 'accessToken', 'refreshToken', 'idToken'],
  },
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
  // bugz-3 M6 (SPEC.md §10.1): `session.token` is the raw bearer credential. Owner-scoped
  // reads of non-secret session columns (expiry, ip, userAgent) stay green; the token column
  // is `secret:` so it can never be projected onto the client wire.
  session: { domain: 'auth', key: 'userId', secret: ['token'] },
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

/** @internal Better Auth core tables that must be present in the app schema bridge. */
export const betterAuthRequiredCoreTables = [
  'account',
  'session',
  'user',
  'verification',
] as const satisfies readonly BetterAuthCoreTable[];

/** @internal Resolve the Kovo domain a Better Auth table is bridged into, or null when unbridged/exempt. */
