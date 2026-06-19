// @internal package-private enhanced-mutation engine (SPEC §9.1). Raw submit,
// optimistic rebase/submit, pending-query stamping, cross-tab broadcast, and the
// compiled query-update-plan applier are framework white-box surface — NOT part
// of the public `./client` bootstrap surface. App entries install these through
// `installKovoLoader`; these raw symbols exist here only for framework-owned
// tests and emit tooling.
export { submitEnhancedMutation } from '../mutation-submit.js';
export type {
  EnhancedMutationSubmitOptions,
  EnhancedMutationFetch,
  EnhancedMutationFetchOptions,
  EnhancedMutationResponseLike,
} from '../mutation-submit.js';
export { submitOptimisticEnhancedMutation } from '../mutation-optimistic.js';
export type { OptimisticEnhancedMutationSubmitOptions } from '../mutation-optimistic.js';
export { OptimisticRebaser } from '../optimism.js';
export type { MutationChangeRecord } from '../optimism.js';
/** @internal bfcache-safe pagehide optimism cleanup (SPEC §10.4) — framework white-box, not public `./client`. */
export { installPagehideOptimismCleanup } from '../optimism.js';
export { stampPendingQueries } from '../pending.js';
export type { PendingElementLike, PendingRoot } from '../pending.js';
export { installMutationBroadcast } from '../broadcast.js';
export type { BroadcastLike, MutationBroadcast } from '../broadcast.js';
export { applyCompiledQueryUpdatePlan } from '../query-bindings.js';
export type { CompiledQueryUpdatePlans } from '../query-bindings.js';
