export type { Secret } from '@kovojs/core';
export { publicAccess, verifiedAccess } from '../access.js';
export type {
  AccessDecision,
  GuardAccessStep,
  GuardChainAccess,
  PublicAccess,
  VerifiedMachineAccess,
} from '../access.js';
export { csrfField, csrfToken } from '../csrf.js';
export type {
  CsrfAnonymousCookieOptions,
  CsrfOptions,
  CsrfSecret,
  CsrfValidationOptions,
} from '../csrf.js';
export { domain, tag } from '../domain.js';
export type { Domain, Tag } from '../domain.js';
export type { JsonSerializable } from '../json-boundary.js';
export { errorBoundary, mutation, stream, write } from '../mutation.js';
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
  ElevatedQueryFact,
  QueryDeclarationDefinition,
  QueryDefinitionBoundary,
  QueryDefinition,
  QueryLoadContext,
  QueryReadConfig,
  QueryResult,
} from '../query.js';
export { drainElevatedQueryFacts, query } from '../query.js';
// SPEC §6.6/§9.4/§10.3 (MARQUEE / KV433+KV422): the framework-owned managed DB handle. `Reader<Db>`
// is the read-only loader-handle type mirror; `KovoReadonlyHandleError` is the fail-closed runtime
// throw a `query()` loader's write verb raises.
export { KovoReadonlyHandleError } from '../managed-db.js';
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
