import './security-bootstrap.js';

export { createApp, createRequestHandler } from './app.js';
// SPEC §6.6 / §9.5 (plans/secure-framework.md Tier 1): refuse-to-boot env/secret
// validation at the createApp chokepoint. `CreateAppBootError` is the typed boot
// refusal a deploy/test catches; `committedSecretWaiver` is the audited escape for
// the committed-secret heuristic.
export { committedSecretWaiver, CreateAppBootError, isCreateAppBootError } from './env.js';
export type { EnvValidationIssue } from './env.js';
// SPEC §10.3: generated Postgres apps import this runtime to derive schema DDL/RLS/grants from
// app-authored Drizzle schema exports while keeping privileged provisioning out of normal boot.
export {
  checkPostgresAppDbPosture,
  createPostgresAppRuntimeDb,
  declarePublicRelation,
  migratePostgresAppDb,
  planPostgresAppDbMigration,
  postgresSchemaModule,
  provisionPostgresAppDb,
  usePostgresSystemDb,
} from './postgres-runtime.js';
export type {
  KovoPostgresAppRuntimeDb,
  KovoPostgresAppRuntimeOptions,
  KovoPostgresMigrateOptions,
  KovoPostgresMigration,
  KovoPostgresMigrationPlan,
  KovoPostgresMigrationPlanOptions,
  KovoPostgresMigrationRunReport,
  KovoPostgresPostureIssue,
  KovoPostgresPostureReport,
  KovoPostgresProvisionOptions,
  KovoPostgresPublicRelationDeclaration,
  KovoPostgresPublicRelationDeclarationOptions,
  KovoPostgresResolvedRuntimeDriver,
  KovoPostgresRuntimeDb,
  KovoPostgresRuntimeDriver,
  KovoPostgresSystemDb,
} from './postgres-runtime.js';
// SPEC §5.2/§10.3/§11.2: generated SQLite starter source must use public Kovo entrypoints, while
// the adapter hooks and low-level secret/read/write wrappers remain internal.
export { createSqliteAppRuntimeDb } from './sqlite-runtime.js';
export type {
  KovoSqliteAppRuntimeDb,
  KovoSqliteAppRuntimeMetadata,
  KovoSqliteAppRuntimeOptions,
  KovoSqliteColumnOriginClient,
  KovoSqliteRuntimeColumnSource,
} from './sqlite-runtime.js';
export { declareSecretReadCapability } from './secret-read-boundary.js';
export type { DeclaredSecretReadCapability } from './secret-read-boundary.js';
export { isKovoApp } from './app-guards.js';
export { publicAccess, verifiedAccess } from './access.js';
export { trustedAssign, serverValue } from './write-governance.js';
export type { TrustedAssignOptions } from './write-governance.js';
export { encryptAtRest } from './confidential-at-rest.js';
export type { EncryptedAtRest, EncryptAtRestOptions } from './confidential-at-rest.js';
// SPEC §6.6 / KV424 and plans/most-secure-web-framework.md SINK-02: shell command
// execution is exposed as a framework-owned `execFile` primitive. This is a
// runtime-DiD floor plus a type-only Command surface; raw `child_process` remains
// an app-authored dangerous sink.
export { cmd, commandAllowlist, runCommand } from './command.js';
export type {
  Command,
  CommandAllowlist,
  CommandOptions,
  CommandResult,
  CommandRunOptions,
} from './command.js';
// SPEC §6.6 / plans/secure-framework.md Phase 5: outbound-egress private-network deny floor
// (runtime defense-in-depth, NOT a by-construction proof). `EgressBlockedError` is the typed
// 502-class error a blocked outbound connection throws. The worker/bootstrap installers and
// cloud-credential metadata frames are framework plumbing exposed on
// `@kovojs/server/internal/egress`, not app-authored root API.
export { EgressBlockedError, EgressConfigError } from './egress.js';
export type { EgressOptions, PrivateAddressClass } from './egress.js';
export { createSigningKeyRing } from './keyring.js';
export type {
  SigningInput,
  SigningKey,
  SigningKeyRing,
  SigningKeyRingOptions,
  SigningKeyState,
  SigningRejectReason,
  SigningResult,
  SigningSecret,
  SigningVerifyInput,
  SigningVerifyResult,
} from './keyring.js';
// SPEC §6.6 / §9.1 / plans/secure-framework.md Phase 5 follow-up: the framework-owned storage
// download ROUTE that hosts the capability verify sink. `createStorageDownloadEndpoint` builds a
// prefix-mounted GET/HEAD endpoint whose handler verifies a per-object token BEFORE any storage
// read. Raw sign/verify/mint plumbing lives on `@kovojs/server/internal/capabilities`.
export {
  DEFAULT_CAPABILITY_DOWNLOAD_BASE_PATH,
  createStorageDownloadEndpoint,
} from './capability-route.js';
export type { CapabilityMethod, CapabilityReplayStore } from './capability-url.js';
export type {
  SignUrlContext,
  SignUrlOptions,
  SignedUrl,
  StorageDownloadEndpointOptions,
} from './capability-route.js';
// SPEC §6.6 / §9.1: rooted filesystem serving is the framework-owned file/path sink for
// route-served local bytes. App code passes request-derived relative paths to this capability,
// never a pre-resolved raw fs path.
export { rootedFiles } from './file.js';
export type { RootedFiles, RootedFileServeOptions } from './file.js';
// SPEC §6.6 / plans/most-secure-web-framework.md OPP-10: first-party password primitive.
// This is intentionally narrow: a public argon2id-only hash/verify sink with explicit parameter
// defaults/floors. It does not expose raw bcrypt/scrypt/SHA/Argon2 algorithm knobs and is labeled
// runtime-DiD at the sink, not a proof of all authentication strength.
export {
  PASSWORD_ARGON2ID_DEFAULTS,
  hashPassword,
  isArgon2idPasswordDigest,
  verifyCredential,
  verifyPassword,
} from './password.js';
export type {
  CredentialVerifyResult,
  PasswordDigest,
  PasswordHashOptions,
  PasswordVerifyResult,
} from './password.js';
export type { AccessDecision, PublicAccess, VerifiedMachineAccess } from './access.js';
// SPEC §6.6 / §9.1: storage capability constructors are public app wiring surfaces for
// upload/file schemas and the framework-owned capability download endpoint.
export {
  createFileSystemStorage,
  createMemoryStorage,
  createS3CompatibleStorage,
} from '@kovojs/core';
export type {
  FileSystemStorageOptions,
  MemoryStorageOptions,
  S3CompatibleGetObjectInput,
  S3CompatibleGetObjectOutput,
  S3CompatibleHeadObjectInput,
  S3CompatibleObjectClient,
  S3CompatibleObjectMetadata,
  S3CompatiblePutObjectInput,
  S3CompatiblePutObjectOutput,
  S3CompatibleStorageOptions,
  StorageBody,
  StorageCapability,
  StorageDeleteCapability,
  StorageGetResult,
  StorageObjectInfo,
  StoragePutCapability,
  StoragePutOptions,
  StoragePutResult,
  StorageReadCapability,
  StorageStreamResult,
} from '@kovojs/core';
// SPEC §9.1: verifier builders are part of the webhook authoring surface, so server
// re-exports them next to `webhook()`.
export { customVerifier, hmacSignature, standardWebhooks } from '@kovojs/core';
export type { WebhookVerifier } from '@kovojs/core';
// SPEC.md §9.5: apps inject a custom versioned client-module registry through
// `createApp({ clientModules })`. Real example/site consumers (examples/gallery,
// crm, stackoverflow, reference; site/src/client/modules.ts) construct one with
// `createMemoryVersionedClientModuleRegistry`, so the constructor and its option
// surface stay public at the root barrel (also available on the internal subpath).
export { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
export { toNodeHandler } from './node.js';
export { exportStaticApp } from './static-export.js';
export { StaticExportError } from './static-export-diagnostics.js';
export { createDurableTaskStatus } from './task-observability.js';
export { createDurableTaskSqlExecutor } from './task-queue.js';
export type {
  DurableTaskObservedStatus,
  DurableTaskStatusFilters,
  DurableTaskStatusJob,
  DurableTaskStatusSnapshotSource,
  DurableTaskStatusRecord,
  DurableTaskStatusSqlExecutor,
  DurableTaskStatusSqlResult,
  DurableTaskStatusSqlStatement,
  DurableTaskStatusSurface,
} from './task-observability.js';
export type {
  AppEgressOptions,
  AppEgressOptOut,
  AppDiagnostic,
  AppDocumentOptions,
  AppErrorShellOptions,
  AppMutationResponseContext,
  AppMutationResponseOptions,
  AppMutationResponseResolver,
  AppReadRequest,
  AppRateLimitOptions,
  AppRequestLimitOptions,
  AppRequestRateLimitOptions,
  AppRouteRenderContext,
  AppTaskDeclaration,
  CreateAppOptions,
  ErrorShellRenderer,
  KovoApp,
  RequestHandler,
  ResolvedAppRateLimitOptions,
  ResolvedAppRequestLimitOptions,
  ResolvedAppRequestRateLimitOptions,
} from './app-types.js';
// CSP allowlist config named by `createApp({ document: { csp } })` (recursive publicness,
// rules/api-surface.md): an app declares third-party analytics/Stripe origins through these.
// SPEC §6.6: a cross-browser runtime DiD floor, not a by-construction proof.
export type {
  CspAllowlist,
  CspInlineMetadata,
  CspReportingConfig,
  DocumentCspConfig,
} from './csp.js';
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
  accept,
  createMemoryMutationReplayStore,
  csrfField,
  csrfToken,
  declarePublicRead,
  domain,
  errorBoundary,
  InlineUnverifiedUploadError,
  KovoReadonlyHandleError,
  mutation,
  mintCsrfField,
  mintCsrfToken,
  mutationFormAttributes,
  queue,
  query,
  RedosPatternError,
  readonlyDb,
  replayMutationWireBody,
  s,
  SchemaValidationError,
  // KV429 (SPEC §10.3/§11.1): thrown by a mutation handler when a CAS predicate matches
  // 0 rows; the lifecycle converts this into a typed HTTP 409 (STALE_VERSION) response
  // distinct from the IDEMPOTENCY_CONFLICT 409 produced by the replay path.
  StaleVersionError,
  stream,
  task,
  unsafeRegex,
} from './api/data.js';
export type {
  BlessedFormatName,
  ChangeRecord,
  CsrfAnonymousCookieOptions,
  CsrfOptions,
  Domain,
  FileLike,
  FileSchema,
  FileSchemaOptions,
  FrameworkWireBody,
  InferSchema,
  InvalidateOptions,
  MutationContext,
  MutationDefinition,
  MutationFail,
  MutationFormAttributes,
  MutationFormDefinition,
  MutationHandlerRequest,
  MintedCsrfField,
  MintedCsrfToken,
  MutationQueue,
  MutationRequestDb,
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
  CrossOwnerReadDeclaration,
  CrossOwnerReadPolicyOptions,
  DeclaredWriteSqliteAuthorizerConstants,
  DeclaredWriteSqliteAuthorizerDatabase,
  DeclaredWriteSqliteAuthorizerOptions,
  PreserveDefinitionInference,
  PublicReadDeclaration,
  PublicReadRowsScope,
  QueryDeclarationBoundaryShape,
  QueryDeclarationDefinition,
  QueryDefinition,
  QueryDefinitionBoundary,
  QueryDefinitionParameterBoundary,
  QueryInstanceKey,
  QueryJsonBoundaryErrorUseJsonbTypeOrSRecord,
  QueryLoadContext,
  QueryReadConfig,
  QueryResult,
  QueryUnknownDefinitionFieldError,
  RawReadDeclaration,
  RawReadPolicyOptions,
  Reader,
  ReplayMutationWireBodyOptions,
  Schema,
  Secret,
  // KV429 (SPEC §10.3/§11.1): the typed 409 stale-version conflict outcome.
  StaleVersionConflict,
  StoredFileSchema,
  StoredFileSchemaOptions,
  StoredFileUpload,
  StringSchema,
  Writer,
  TaskCronCatchUp,
  TaskDefinition,
  TaskFactory,
  TaskHandle,
  TaskInput,
  TaskPrincipalReadScope,
  TaskPrincipalScope,
  TaskPrincipalWriteScope,
  TaskRunnableMutation,
  TaskRunnableMutationInput,
  TaskRunnableQuery,
  TaskRunnableQueryInput,
  TaskRunContext,
  TaskScheduleOptions,
  TaskSchedulingRequest,
  UnsafeRegexBrand,
  UnverifiedAcceptance,
  ValidationFailurePayload,
  ValidationIssue,
} from './api/data.js';
export {
  Defer,
  i18n,
  metaFromQuery,
  ComponentXmlError,
  parseComponentXml,
  renderRegistry,
  renderRouteHtml,
  renderTree,
  safeRichHtml,
  stylesheet,
  t,
  trustedHtml,
  trustedUrl,
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
} from './api/rendering.js';
export type {
  ComponentElementNode,
  ComponentNode,
  ComponentRegistry,
  ComponentRegistryEntry,
  ComponentRegistryInput,
  ComponentTextNode,
  DeferProps,
  DocumentAuthoringContext,
  DocumentConfig,
  DocumentDeclaration,
  DocumentShellAttributes,
  DocumentShellAttributeValue,
  I18nCatalog,
  PageHintOptions,
  RouteMeta,
  RouteMetaCallback,
  RouteMetaFactory,
  RouteMetaSource,
  RoutePrefetch,
  RegionPriority,
  RenderTreeOptions,
  SafeRichHtmlOptions,
  AwaitableGeneratedFragmentRenderable,
  GeneratedFragmentRenderable,
  ServerFragmentRenderable,
  ServerRenderable,
  ServerRenderedHtml,
  StylesheetAsset,
  StylesheetDeclarationOptions,
  StylesheetTheme,
} from './api/rendering.js';
export {
  endpoint,
  guard,
  guards,
  href,
  layout,
  Link,
  notFound,
  redirect,
  respond,
  route,
  session,
  createMemoryWebhookReplayStore,
  webhook,
} from './api/routing.js';
export type {
  AuthenticatedRequest,
  ClientIpRequestLike,
  CookieClass,
  CookieOptions,
  DiagnosticCode,
  Endpoint,
  EndpointAuthDeclaration,
  EndpointCsrfExemption,
  EndpointDbContext,
  EndpointDbDefinitionBase,
  EndpointDbHandler,
  EndpointDbScope,
  EndpointDeclaration,
  EndpointDefinition,
  EndpointHandler,
  EndpointMountDefinition,
  EndpointMethod,
  EndpointMount,
  EndpointRequest,
  EndpointCachePosture,
  EndpointResponseBody,
  EndpointResponseBodyPosture,
  EndpointResponsePosture,
  ForbiddenContext,
  ForbiddenDenial,
  ForbiddenRenderer,
  Guard,
  GuardArgsRequest,
  GuardDenial,
  GuardParamsRequest,
  GuardResult,
  JsonValue,
  LayoutDeclaration,
  LayoutDefinition,
  LayoutFactory,
  LayoutQueryResults,
  LayoutRegionResults,
  LayoutRenderResult,
  LayoutRenderSlots,
  LinkDescriptor,
  NotFound,
  RateLimitedDenial,
  RateLimitOptions,
  RedirectLocationAllowlistEntry,
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
  RouteRegionResults,
  RouteRequest,
  RouteRequestInput,
  RouteResponseBody,
  RouteResponseOutcome,
  RouteResponseStatus,
  RouteStoredFileOptions,
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
  WebhookDeclaredWriteDomain,
  WebhookDeclaredWriteKey,
  WebhookDeclaredWrites,
  WebhookDefinition,
  WebhookFail,
  WebhookFailureStatus,
  WebhookHandlerContext,
  WebhookPrincipalWriteScope,
  WebhookRunnableMutation,
  WebhookRunnableMutationInput,
  WebhookReplayReservation,
  WebhookReplayStore,
  WebhookResponseStatus,
  WebhookSuccessStatus,
  WebhookTransactionContext,
  WebhookTxDb,
  WebhookWireResponse,
} from './api/routing.js';
