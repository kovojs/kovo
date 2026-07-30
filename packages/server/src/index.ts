import './security-bootstrap.js';

import { sealManagedSqlParserAuthorityRegistry } from './sql-write-allowlist.js';

/**
 * The ordinary Kovo server authoring surface.
 *
 * Operational capabilities live on named task subpaths so importing the root communicates
 * "declare an app", not "acquire every server authority" (SPEC §3.2/§6.2.1/§9.5).
 */
export { defineKovo } from './app-contract.js';
export type {
  AppAssemblyOptions,
  AppEndpointFactory,
  AppLayoutFactory,
  AppMutationFactory,
  AppQueryFactory,
  AppRequestForAccess,
  AppRouteFactory,
  AppTaskFactory,
  AuthenticatedAppRequest,
  DefineKovoInput,
  DefineKovoOptions,
  DefinedKovoContract,
  EndpointHandle,
  InferKovoEnv,
  InferKovoSession,
  KovoContract,
  LayoutHandle,
  MutationHandle,
  QueryHandle,
  RouteHandle,
  TaskHandle as AppTaskHandle,
} from './app-contract.js';

export { publicAccess, verifiedAccess } from './access.js';
export type { AccessDecision, PublicAccess, VerifiedMachineAccess } from './access.js';

export { domain, tag } from './domain.js';
export type { Domain } from './domain.js';

export { s, SchemaValidationError } from './schema.js';
export type {
  FileLike,
  FileSchema,
  FileSchemaOptions,
  InferSchema,
  NumberSchema,
  Schema,
  StoredFileSchema,
  StoredFileSchemaOptions,
  StoredFileUpload,
  StringSchema,
  ValidationFailurePayload,
  ValidationIssue,
} from './schema.js';

export { errorBoundary, mutation, mutationFormAttributes, queue } from './mutation.js';
export type {
  MutationDefinition,
  MutationFail,
  MutationFormAttributes,
  MutationFormDefinition,
  MutationHandlerRequest,
  MutationResult,
  MutationSuccess,
} from './mutation.js';
export { query } from './query.js';
export type { QueryDefinition, QueryInstanceKey, QueryResult } from './query.js';
export { StaleVersionError } from './mutation/stale-version.js';
export type { StaleVersionConflict } from './mutation/stale-version.js';

export { endpoint } from './endpoint.js';
export type {
  EndpointDefinition,
  EndpointMethod,
  EndpointRequest,
  EndpointResponsePosture,
} from './endpoint.js';
export { guard, guards, session } from './guards.js';
export type { Guard, SessionProvider } from './guards.js';
export { layout, notFound, route } from './route.js';
export type { LayoutDefinition, RouteDefinition, RoutePageResult, RouteRequest } from './route.js';
export { respond, unsafeInline } from './response.js';
export type {
  ResponseHeaders,
  ResponseHeaderValue,
  AppResponseHeaders,
  RouteResponseBody,
  RouteResponseOutcome,
  UnsafeInlineAcceptance,
} from './response.js';

export {
  BodyAttrs,
  BodyEnd,
  BodyStart,
  Document,
  FontPreload,
  Head,
  HtmlAttrs,
  InlineScript,
  InlineStyle,
  Meta,
  ModulePreload,
  StylesheetLink,
} from './document-structured.js';
export type { DocumentConfig, DocumentDeclaration } from './document-structured.js';
export { Defer } from './deferred-region.js';
export type { DeferProps, ServerRenderable } from './deferred-region.js';
export { i18n, metaFromQuery, t } from './meta.js';
export { safeRichHtml } from './rendering/html/safe-html.js';
export { stylesheet } from './hints.js';
export type {
  RouteMeta,
  StylesheetAsset,
  StylesheetDeclarationOptions,
  StylesheetTheme,
} from './hints.js';
export { stream } from './mutation/streaming.js';

export { CreateAppBootError, isCreateAppBootError } from './env.js';
export type { AppResponseHeaderName } from './response-app-headers.js';

// SPEC §6.6 rule 6: native root dependencies evaluate before this body. Close the
// platform-neutral parser registry before authored app code runs.
sealManagedSqlParserAuthorityRegistry();
