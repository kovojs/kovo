export { accessFactsFromApp } from '../access-graph.js';
export { endpointMatches, runEndpoint, type EndpointRequest } from '../endpoint.js';
export type { GuardFailureResponseOptions, RequestLifecycleOptions } from '../guards.js';
// part-3 I2: exposed on the internal execution subpath so adapters/tests can drive the
// session lifecycle (and its additive Set-Cookie sink) directly.
export { resolveLifecycleRequest } from '../guards.js';
export {
  runMutation,
  type MutationRegistry,
  type QueryRerun,
  type RunMutationOptions,
} from '../mutation.js';
export { invalidate, type MutationTouchSite } from '../change-record.js';
export {
  registerGeneratedMutationTouchRegistry,
  type GeneratedMutationTouchRegistry,
} from '../generated-mutation-registry.js';
export {
  registerGeneratedQueryReadRegistry,
  type GeneratedQueryReadRegistry,
} from '../generated-query-registry.js';
export {
  createMemoryMutationReplayStore,
  type MutationReplayReservation,
  type MutationReplayStore,
} from '../replay.js';
export { drainElevatedQueryFacts, runQuery, type ElevatedQueryFact } from '../query.js';
export { runRoutePage } from '../route.js';
// SPEC §6.6/§9.4/§10.3 (MARQUEE): the framework-owned managed DB handle composition primitives,
// exposed on the internal subpath so adapters/tests can resolve a read-only/read-write handle the
// same way the request shell does.
export {
  KovoReadonlyHandleError,
  managedDb,
  readonlyDb,
  type ManagedDbMode,
  type Reader,
} from '../managed-db.js';
