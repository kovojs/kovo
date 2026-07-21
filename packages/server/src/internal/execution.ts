export { accessDecisionFor } from '../access.js';
export { appEgressPosture } from '../app.js';
export { createRuntimeAttestationVerificationHandle } from '../crypto-authority.js';
export { accessFactsFromApp } from '../access-graph.js';
export { endpointMatches, runEndpoint, type EndpointRequest } from '../endpoint.js';
export type { GuardFailureResponseOptions, RequestLifecycleOptions } from '../guards.js';
// part-3 I2: exposed on the internal execution subpath so adapters/tests can drive the
// session lifecycle (and its additive Set-Cookie sink) directly.
export { explainGuard, guardAuditName, resolveLifecycleRequest } from '../guards.js';
export { authorizationCorrespondenceFactsFromApp } from '../postgres-authorization-explain.js';
export {
  runMutation,
  type MutationRegistry,
  type QueryRerun,
  type RunMutationOptions,
} from '../mutation.js';
export { invalidate, type MutationTouchSite } from '../change-record.js';
export { registerGeneratedCacheInfluenceManifest } from '../generated-cache-influence-registry.js';
export { registerGeneratedBrowserPostureManifest } from '../generated-browser-posture-registry.js';
export {
  registerGeneratedMutationTouchRegistry,
  type GeneratedMutationTouchRegistry,
} from '../generated-mutation-registry.js';
export {
  registerGeneratedQueryReadRegistry,
  type GeneratedQueryReadRegistry,
} from '../generated-query-registry.js';
export {
  registerGeneratedRuntimePostureManifest,
  registeredRuntimePostureManifest,
} from '../generated-runtime-posture-registry.js';
export { runtimeAttestationPayloadSource } from '../runtime-attestation.js';
export {
  escapeObligationReviewPayload,
  verifyEscapeObligationReviewEnvelope,
  type EscapeObligationReviewEnvelope,
  type EscapeObligationReviewSubject,
} from '../escape-obligation-review.js';
export {
  escapeCensusReviewPayload,
  snapshotEscapeCensusReviewSubject,
  verifyEscapeCensusReviewEnvelope,
  verifyEscapeCensusReviewSet,
  type EscapeCensusReviewEnvelope,
  type EscapeCensusReviewSite,
  type EscapeCensusReviewSubject,
  type EscapeCensusReviewVerification,
} from '../escape-census-review.js';
export { exportSecurityEvents } from '../security-event-export.js';
export {
  createSecurityEventRecordVerifier,
  type SecurityEventRecordVerifier,
} from '../security-event.js';
export {
  extractCompilerBoundKovoRuntimeDbMetadata,
  installGeneratedTableSecurityManifestForCommand,
  registeredGeneratedTableSecurityManifest,
  registerGeneratedTableSecurityManifest,
} from '../generated-table-security-registry.js';
export {
  createMemoryMutationReplayStore,
  type MutationReplayReservation,
  type MutationReplayStore,
} from '../replay.js';
export { runQuery } from '../query.js';
export { runRoutePage } from '../route.js';
// Managed DB composition lives on `@kovojs/server/internal/managed-db`, whose Node bootstrap owns
// the private SQL-parser authority. Keep this mixed build/runtime entry platform-neutral: generated
// registry modules import the append helper below even in route-only Cloudflare bundles.
export { witnessArrayAppend as appendFrameworkRuntimeArrayValue } from '../security-witness-intrinsics.js';
