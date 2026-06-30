import { applyDeferredStreamResponseToRuntime as applyDeferredStreamResponseToRuntimeGenerated } from '@kovojs/browser/generated';

// @kovojs/test/internal/integration/fixture-browser-abi: browser-only white-box
// facade for framework-owned integration fixture client modules.

export { applyCompiledQueryUpdatePlan } from '@kovojs/browser/generated';
export {
  applyInlineQueryEventToRuntime,
  installInlineQueryEventHydration,
} from '@kovojs/browser/internal/inline-loader';
export { DomMorphRoot, keyedDomMorph } from '@kovojs/browser/internal/morph';
export {
  installMutationBroadcast,
  OptimisticRebaser,
  stampPendingQueries,
  submitEnhancedMutation,
  submitOptimisticEnhancedMutation,
} from '@kovojs/browser/internal/mutation';
export type {
  BroadcastLike,
  OptimisticEnhancedMutationSubmitOptions,
} from '@kovojs/browser/internal/mutation';

/** @internal Fixture-only wrapper around the compiler-generated deferred stream runtime ABI. */
export function applyDeferredStreamResponseToRuntime(options: object): unknown {
  return applyDeferredStreamResponseToRuntimeGenerated(options as never);
}
