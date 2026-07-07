export type { Secret } from '@kovojs/core';
export { publicAccess, verifiedAccess } from '../access.js';
export type { AccessDecision, PublicAccess, VerifiedMachineAccess } from '../access.js';
export { csrfField, csrfToken, mintCsrfField, mintCsrfToken } from '../csrf.js';
export type {
  CsrfAnonymousCookieOptions,
  CsrfOptions,
  MintedCsrfField,
  MintedCsrfToken,
} from '../csrf.js';
export type { SigningSecret } from '../keyring.js';
export { domain } from '../domain.js';
export type { Domain } from '../domain.js';
export { errorBoundary, queue, stream } from '../mutation.js';
import { mutation as mutationImplementation } from '../mutation.js';
import { query as queryImplementation } from '../query.js';
import { task as taskImplementation } from '../task.js';
import type { MutationFactory } from '../mutation.js';
import type { QueryFactory } from '../query.js';
import type { TaskFactory } from '../task.js';

/**
 * Declare a typed write using source-derived registry identity (SPEC §4.1/§10.3).
 *
 * App-authored mutations use `mutation({ input, handler })`; the compiler derives the stable
 * `/_m/*` key from the exported binding plus module path and emits the generated metadata.
 */
export const mutation = mutationImplementation as unknown as MutationFactory;
// KV429 (SPEC §10.3/§11.1): mutation handler signals a stale-version conflict via
// StaleVersionError; the lifecycle converts it into a typed HTTP 409 (STALE_VERSION).
export { StaleVersionError } from '../mutation.js';
/** Build JSX-spread attributes for a SPEC §6.3 enhanced mutation form. */
export { mutationFormAttributes } from '../mutation.js';
export type {
  ChangeRecord,
  InvalidateOptions,
  MutationContext,
  MutationDefinition,
  MutationFail,
  MutationFormDefinition,
  MutationHandlerRequest,
  MutationQueue,
  MutationRequestDb,
  MutationResult,
  MutationStreamChunk,
  MutationStreamContext,
  MutationStreamDoneChunk,
  MutationStreamFragmentChunk,
  MutationStreamFragmentHtml,
  MutationStreamQueryChunk,
  MutationStreamSource,
  MutationStreamTextChunk,
  MutationTextCoalescingPolicy,
  MutationSuccess,
  // KV429 (SPEC §10.3/§11.1): typed 409 stale-version conflict outcome.
  StaleVersionConflict,
} from '../mutation.js';
/** Attribute object returned by `mutationFormAttributes(...)`. */
export type { MutationFormAttributes } from '../mutation.js';
export type {
  PreserveDefinitionInference,
  QueryDeclarationBoundaryShape,
  QueryDeclarationDefinition,
  QueryDefinitionBoundary,
  QueryDefinitionParameterBoundary,
  QueryDefinition,
  QueryInstanceKey,
  QueryJsonBoundaryErrorUseJsonbTypeOrSRecord,
  QueryLoadContext,
  QueryReadConfig,
  QueryResult,
  QueryUnknownDefinitionFieldError,
} from '../query.js';

/**
 * Declare a typed read using source-derived registry identity (SPEC §4.1/§10.2).
 *
 * App-authored queries use `query({ load, reads })`; the compiler derives the stable `/_q/*` key
 * from the exported binding plus module path and emits the generated metadata.
 */
export const query = queryImplementation as unknown as QueryFactory;
/**
 * Declare a durable background function whose serialized jobs are enqueued by
 * `request.schedule(...)` and drained by the node JobRunner (SPEC §9.6).
 */
export const task = taskImplementation as unknown as TaskFactory;
export type {
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
} from '../task.js';
// SPEC §6.6/§9.4/§10.3 (MARQUEE / KV433+KV422): public app code gets the branded `Reader<Db>` /
// `Writer<Db>` type mirrors, `readonlyDb(appDb)` for raw endpoint reads, and
// `declarePublicRead(...)` for audited public raw reads. Framework adapter hooks and audit drains
// stay on `@kovojs/server/internal/managed-db`.
export { declarePublicRead, KovoReadonlyHandleError, readonlyDb } from '../managed-db.js';
export {
  checkPostgresAppDbPosture,
  createPostgresAppRuntimeDb,
  declarePublicRelation,
  migratePostgresAppDb,
  planPostgresAppDbMigration,
  provisionPostgresAppDb,
} from '../postgres-runtime.js';
export type {
  CrossOwnerReadDeclaration,
  CrossOwnerReadPolicyOptions,
  DeclaredWriteSqliteAuthorizerConstants,
  DeclaredWriteSqliteAuthorizerDatabase,
  DeclaredWriteSqliteAuthorizerOptions,
  PublicReadDeclaration,
  PublicReadRowsScope,
  RawReadDeclaration,
  RawReadPolicyOptions,
  Reader,
  Writer,
} from '../managed-db.js';
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
} from '../postgres-runtime.js';
export { createSqliteAppRuntimeDb } from '../sqlite-runtime.js';
export type {
  KovoSqliteAppRuntimeDb,
  KovoSqliteAppRuntimeMetadata,
  KovoSqliteAppRuntimeOptions,
  KovoSqliteColumnOriginClient,
  KovoSqliteRuntimeColumnSource,
} from '../sqlite-runtime.js';
export { declareSecretReadCapability } from '../secret-read-boundary.js';
export type { DeclaredSecretReadCapability } from '../secret-read-boundary.js';
export { s, SchemaValidationError } from '../schema.js';
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
} from '../schema.js';
// KV428 (SPEC §6.6/§9.1): the upload inline-XSS gate. `accept`/`accept.unverified()` is the
// verified-MIME allowlist + audited client-MIME escape; `InlineUnverifiedUploadError` is the
// fail-closed inline-refusal. Audit drains stay on `@kovojs/server/internal/audit-facts`.
export { accept, InlineUnverifiedUploadError } from '../upload-sniff.js';
export type { UnverifiedAcceptance } from '../upload-sniff.js';
// KV434 (SPEC §6.6/§9.5): ReDoS-safe string validators. `unsafeRegex` is the audited escape for an
// unanalyzable pattern; `RedosPatternError` is the static-reject error.
export { RedosPatternError, unsafeRegex } from '../redos.js';
export type { BlessedFormatName, UnsafeRegexBrand } from '../redos.js';
// SPEC §9.1 idempotent replay store: apps provision and hold a store for webhook
// and mutation handlers (real consumer: conformance/webhook-spike). The default
// in-memory implementation and its contract types stay public at the root.
export { createMemoryMutationReplayStore } from '../replay.js';
export type { MutationReplayReservation, MutationReplayStore } from '../replay.js';
export { replayMutationWireBody } from '../response.js';
export type { FrameworkWireBody, ReplayMutationWireBodyOptions } from '../response.js';
