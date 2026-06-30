import { applyDeferredStreamResponseToRuntime as applyDeferredStreamResponseToRuntimeGenerated } from '@kovojs/browser/generated';

// @kovojs/test/internal/integration/fixture-abi — narrow white-box facade for
// framework-owned integration fixtures. Fixture app/client source imports this
// harness surface instead of importing Kovo package internals directly.

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
export { createMemoryStorage } from '@kovojs/core/internal/storage';
export type {
  WebhookReplayReservation,
  WebhookReplayStore,
  WebhookWireResponse,
} from '@kovojs/server/internal/wire';
export {
  escapeAttribute,
  escapeHtml,
  renderDeferredDocument,
  renderQueryScript,
} from '@kovojs/server/internal/html';
export { runQuery } from '@kovojs/server/internal/execution';

/** @internal Fixture-only wrapper around the compiler-generated deferred stream runtime ABI. */
export function applyDeferredStreamResponseToRuntime(options: object): unknown {
  return applyDeferredStreamResponseToRuntimeGenerated(options as never);
}
