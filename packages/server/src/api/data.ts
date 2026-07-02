export type { Secret } from '@kovojs/core';
export { publicAccess, verifiedAccess } from '../access.js';
export type {
  AccessDecision,
  GuardAccessStep,
  GuardChainAccess,
  PublicAccess,
  VerifiedMachineAccess,
} from '../access.js';
export { csrfField, csrfToken, mintCsrfField, mintCsrfToken } from '../csrf.js';
export type {
  CsrfAnonymousCookieOptions,
  CsrfOptions,
  CsrfSecret,
  CsrfValidationOptions,
  MintedCsrfField,
  MintedCsrfToken,
} from '../csrf.js';
export { domain, tag } from '../domain.js';
export type { Domain, Tag } from '../domain.js';
export type { JsonSerializable } from '../json-boundary.js';
export { errorBoundary, queue, stream, write } from '../mutation.js';
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
  WriteDefinition,
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
  TaskRunnableMutation,
  TaskRunnableMutationInput,
  TaskRunnableQuery,
  TaskRunnableQueryInput,
  TaskRunContext,
  TaskScheduleOptions,
  TaskSchedulingRequest,
} from '../task.js';
// SPEC §6.6/§9.4/§10.3 (MARQUEE / KV433+KV422): the framework-owned managed DB handle. `Reader<Db>`
// is the branded read-only loader-handle type mirror; `readonlyDb(appDb)` is the blessed
// read-only endpoint helper; `kovoReadonlyDbHandle` lets framework-owned adapters vend that
// reader to query-loader `context.db`; `KovoReadonlyHandleError` is the fail-closed runtime throw
// a read-surface write verb raises.
export { KovoReadonlyHandleError, kovoReadonlyDbHandle, readonlyDb } from '../managed-db.js';
export type { Reader } from '../managed-db.js';
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
// fail-closed inline-refusal; `drainUnverifiedMimeFacts` feeds `kovo explain --capabilities`.
export { accept, InlineUnverifiedUploadError, drainUnverifiedMimeFacts } from '../upload-sniff.js';
export type { UnverifiedAcceptance, UnverifiedMimeFact } from '../upload-sniff.js';
// KV434 (SPEC §6.6/§9.5): ReDoS-safe string validators. `unsafeRegex` is the audited escape for an
// unanalyzable pattern; `RedosPatternError` is the static-reject error; `drainUnsafeRegexFacts`
// feeds `kovo explain --capabilities`.
export { RedosPatternError, drainUnsafeRegexFacts, unsafeRegex } from '../redos.js';
export type { BlessedFormatName, UnsafeRegexBrand, UnsafeRegexFact } from '../redos.js';
// SPEC §9.1 idempotent replay store: apps provision and hold a store for webhook
// and mutation handlers (real consumer: conformance/webhook-spike). The default
// in-memory implementation and its contract types stay public at the root.
export { createMemoryMutationReplayStore } from '../replay.js';
export type { MutationReplayReservation, MutationReplayStore } from '../replay.js';
