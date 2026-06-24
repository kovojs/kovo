export { createApp, createRequestHandler } from './app.js';
// SPEC §6.6 / §9.5 (plans/secure-framework.md Tier 1): refuse-to-boot env/secret
// validation at the createApp chokepoint. `CreateAppBootError` is the typed boot
// refusal a deploy/test catches; `committedSecretWaiver` is the audited escape for
// the committed-secret heuristic.
export { committedSecretWaiver, CreateAppBootError, isCreateAppBootError } from './env.js';
export type { EnvValidationIssue } from './env.js';
export { isKovoApp } from './app-guards.js';
export { publicAccess, verifiedAccess } from './access.js';
export { adminAssign, drainAdminAssignFacts, serverValue } from './write-governance.js';
export type { AdminAssignFact } from './write-governance.js';
// SPEC §6.6 / plans/secure-framework.md Phase 5: outbound-egress private-network deny floor
// (runtime defense-in-depth, NOT a by-construction proof). `EgressBlockedError` is the typed
// 502-class error a blocked outbound connection throws; `installEgressFloor`/`selfProbe` let a
// worker/child bootstrap re-install + verify the floor (it does not cross worker boundaries).
// The flat `awsCredential`/`gcpCredential`/`azureCredential` factories below are the ONLY entry
// points to the metadata-allowed frame.
export { EgressBlockedError, EgressConfigError } from './egress.js';
export type { EgressOptions, PrivateAddressClass } from './egress.js';
export { installEgressFloor, selfProbe } from './egress-bootstrap.js';
export type { EgressFloorInstall } from './egress-bootstrap.js';
export { awsCredential, azureCredential, gcpCredential } from './egress-credentials.js';
export type { CredentialProvider } from './egress-credentials.js';
// SPEC §6.6 / §9.1 / plans/secure-framework.md Phase 5: capability-URL primitive — sign a
// short-lived, scope-bound token over a storage object; constant-time verify BEFORE any storage
// read (by-construction at the verify sink). The framework download *route* that hosts the sink
// remains open work; these are the signing/verify/one-time-replay core a route mounts.
export {
  DEFAULT_CAPABILITY_TTL_MS,
  createMemoryCapabilityReplayStore,
  signCapability,
  verifyCapability,
} from './capability-url.js';
export type {
  CapabilityClaims,
  CapabilityMethod,
  CapabilityRejectReason,
  CapabilityReplayStore,
  CapabilityVerifyResult,
  SignCapabilityOptions,
  SignedCapability,
} from './capability-url.js';
export type {
  AccessDecision,
  GuardAccessStep,
  GuardChainAccess,
  PublicAccess,
  VerifiedMachineAccess,
} from './access.js';
// SPEC.md §9.5: apps inject a custom versioned client-module registry through
// `createApp({ clientModules })`. Real example/site consumers (examples/gallery,
// crm, stackoverflow, reference; site/src/client/modules.ts) construct one with
// `createMemoryVersionedClientModuleRegistry`, so the constructor and its option
// surface stay public at the root barrel (also available on the internal subpath).
export { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
export { toNodeHandler } from './node.js';
export { exportStaticApp } from './static-export.js';
export { StaticExportError } from './static-export-diagnostics.js';
// SPEC.md §9.5: app authors wire the app shell into their Vite dev server from
// vite.config.ts (the create-kovo starter template does exactly this). These stay
// public at the root barrel and also remain on `@kovojs/server/internal/app-shell-vite`.
/**
 * @experimental
 */
export { createKovoAppShellViteDevIntegration, kovoAppShellViteDevPlugin } from './vite-dev.js';
export type {
  AppDiagnostic,
  AppDocumentOptions,
  AppErrorShellOptions,
  AppMutationResponseContext,
  AppMutationResponseOptions,
  AppMutationResponseResolver,
  AppRateLimitOptions,
  AppRequestLimitOptions,
  AppRequestRateLimitOptions,
  AppRouteRenderContext,
  CreateAppOptions,
  ErrorShellRenderer,
  KovoApp,
  RequestHandler,
  ResolvedAppRateLimitOptions,
  ResolvedAppRequestLimitOptions,
  ResolvedAppRequestRateLimitOptions,
} from './app-types.js';
// Option/registry types named by `createApp({ clientModules })` and by app
// consumers that hold a registry reference (recursive publicness,
// rules/api-surface.md). They also remain on `@kovojs/server/internal/client-modules`.
export type {
  MemoryVersionedClientModuleRegistryOptions,
  VersionedClientModuleInput,
  VersionedClientModuleRegistry,
} from './client-modules.js';
export type { NodeHandlerOptions, NodeRequestHandler } from './node.js';
export type {
  StaticExportCompileDiagnostic,
  StaticExportDiagnostic,
  StaticExportDiagnosticSeverity,
} from './static-export-diagnostics.js';
export type {
  StaticExportNonExportablePolicy,
  StaticExportOptions,
  StaticExportResult,
} from './static-export-types.js';
// SPEC.md §9.5 / rules/api-surface.md: the dev integration/plugin companion types
// (KovoAppShellViteCompilerModuleDiagnosticReport, KovoAppShellViteDevIntegration,
// KovoAppShellViteDevPlugin, KovoAppShellViteDevPluginOptions) are not re-exported
// from the root barrel; they remain available on
// `@kovojs/server/internal/app-shell-vite`.
// rules/api-surface.md "No `export *` on a public barrel": public package barrels
// must use explicit named re-exports so the surface is reviewed on change. These
// blocks enumerate exactly the names re-exported by ./api/data.js,
// ./api/rendering.js, and ./api/routing.js.
export {
  createMemoryMutationReplayStore,
  csrfField,
  csrfToken,
  domain,
  errorBoundary,
  mutation,
  mutationFormAttributes,
  query,
  s,
  SchemaValidationError,
  stream,
  tag,
  write,
} from './api/data.js';
export type {
  ChangeRecord,
  CsrfAnonymousCookieOptions,
  CsrfOptions,
  CsrfValidationOptions,
  Domain,
  FileLike,
  FileSchema,
  FileSchemaOptions,
  InferSchema,
  InvalidateOptions,
  MutationContext,
  MutationDefinition,
  MutationFail,
  MutationFormAttributes,
  MutationFormDefinition,
  MutationReplayReservation,
  MutationReplayStore,
  MutationResult,
  MutationStreamChunk,
  MutationStreamContext,
  MutationStreamDoneChunk,
  MutationStreamFragmentChunk,
  MutationStreamFragmentHtml,
  MutationStreamQueryChunk,
  MutationStreamSource,
  MutationStreamTextChunk,
  MutationSuccess,
  MutationTextCoalescingPolicy,
  NumberSchema,
  QueryDeclarationDefinition,
  QueryDefinition,
  JsonSerializable,
  QueryLoadContext,
  QueryResult,
  Schema,
  Secret,
  StoredFileSchema,
  StoredFileSchemaOptions,
  StoredFileUpload,
  Tag,
  ValidationFailurePayload,
  ValidationIssue,
  WriteDefinition,
} from './api/data.js';
export {
  cspSha256,
  Defer,
  i18n,
  meta,
  metaFromQuery,
  renderContentSecurityPolicy,
  stylesheet,
  t,
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
  Stylesheet,
} from './api/rendering.js';
export type {
  ContentSecurityPolicyOptions,
  CspInlineMetadata,
  DeferProps,
  DocumentAuthoringContext,
  DocumentConfig,
  DocumentDeclaration,
  DocumentShellAttributes,
  DocumentShellAttributeValue,
  I18nCatalog,
  PageHintOptions,
  RouteMeta,
  RouteMetaFactory,
  RouteMetaSource,
  RoutePrefetch,
  RegionPriority,
  ServerRenderable,
  StylesheetAsset,
  StylesheetDeclarationOptions,
  StylesheetTheme,
} from './api/rendering.js';
export {
  endpoint,
  guards,
  href,
  layout,
  Link,
  notFound,
  redirect,
  respond,
  route,
  session,
  webhook,
} from './api/routing.js';
export type {
  AuthenticatedRequest,
  CookieClass,
  CookieOptions,
  DeferredFragmentChunk,
  DeferredPriority,
  DeferredQueryChunk,
  DeferredStreamChunk,
  DiagnosticCode,
  Endpoint,
  EndpointAuthDeclaration,
  EndpointCsrfExemption,
  EndpointDeclaration,
  EndpointDefinition,
  EndpointHandler,
  EndpointMountDefinition,
  EndpointMethod,
  EndpointMount,
  EndpointReason,
  EndpointRequest,
  EndpointCachePosture,
  EndpointResponseBody,
  EndpointResponsePosture,
  ForbiddenContext,
  ForbiddenDenial,
  ForbiddenRenderer,
  Guard,
  GuardDenial,
  GuardFailure,
  GuardResult,
  JsonValue,
  LayoutDeclaration,
  LayoutDefinition,
  LayoutFactory,
  LayoutQueryResults,
  LayoutRenderResult,
  LayoutRenderSlots,
  LinkDescriptor,
  MutationResponseHeaders,
  MutationResponseHeaderValue,
  NotFound,
  RateLimitedDenial,
  RateLimitOptions,
  Redirect,
  ResponseHeaders,
  ResponseHeaderValue,
  Route,
  RouteBoundaries,
  RouteBoundaryContext,
  RouteBoundaryRenderer,
  RouteDeclaration,
  RouteDefinition,
  RouteFileOptions,
  RoutePageResponse,
  RoutePageResult,
  RouteRegionDefinitions,
  RouteRequest,
  RouteRequestInput,
  RouteResponseBody,
  RouteResponseOutcome,
  RouteStreamOptions,
  ServerErrorDiagnosticContext,
  ServerErrorHandler,
  ServerResponseBase,
  SessionDefinition,
  SessionProvider,
  SessionProviderResult,
  SessionRequestLike,
  SessionUserLike,
  UnauthenticatedContext,
  UnauthenticatedDenial,
  UnauthenticatedHandler,
  UnsafeCookieDowngrade,
  WebhookChangeOptions,
  WebhookDeclaration,
  WebhookDefinition,
  WebhookFail,
  WebhookHandlerContext,
  WebhookTransactionContext,
} from './api/routing.js';
