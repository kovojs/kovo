export type { DiagnosticCode } from '@jiso/core';
export * from './events.js';
export {
  abortRemovedIslandSignals,
  dispatchDelegatedEvent,
  handler,
  parseHandlerReference,
  parseHandlerReferences,
  readElementParams,
  readElementState,
  writeElementState,
} from './handlers.js';
export type {
  ClientHandler,
  ElementParamValue,
  HandlerContext,
  ImportHandlerModule,
  IslandSignalScope,
} from './handlers.js';
export {
  applyDeferredChunk,
  applyDeferredChunkToDom,
  applyDeferredStreamResponseToDom,
  applyMutationResponse,
  applyMutationResponseToDom,
} from './apply-path.js';
export type {
  AppliedDeferredStreamResponse,
  AppliedMutationResponse,
  AppliedMutationResponseToDom,
  ApplyMutationResponseToDomOptions,
} from './apply-path.js';
export {
  applyFragments,
  DomMorphRoot,
  DomMorphTarget,
  keyedDomMorph,
  morphDomElement,
  morphStructuralTree,
} from './morph.js';
export type {
  MorphFragment,
  MorphRoot,
  MorphTarget,
  StructuralMorphBrowserState,
  StructuralMorphKey,
  StructuralMorphNode,
} from './morph.js';
export {
  applyCompiledQueryUpdatePlan,
  applyQueryBindings,
  supportsQueryBindings,
} from './query-bindings.js';
export type {
  AppliedCompiledQueryUpdatePlan,
  CompiledQueryDerive,
  CompiledQueryStamp,
  CompiledQueryTemplateStamp,
  CompiledQueryUpdatePlan,
  CompiledQueryUpdatePlans,
  QueryBindingElement,
  QueryBindingRoot,
  TemplateStampHost,
  TemplateStampItem,
} from './query-bindings.js';
export {
  createInlineJisoLoaderSource,
  installInlineJisoLoader,
  jisoLoaderSource,
} from './inline-loader.js';
export type { InlineImportHandlerModule } from './inline-loader.js';
export { createQueryStore, hydrateQueryScripts } from './query-store.js';
export type { QueryScriptLike, QuerySnapshot, QueryStore, QueryUpdatePlan } from './query-store.js';
export { refetchQueries } from './query-refetch.js';
export type {
  QueryRefetchFetch,
  QueryRefetchOptions,
  QueryRefetchResponse,
} from './query-refetch.js';
export type { FragmentChunk, QueryChunk } from './wire-parser.js';
export type { TargetCollectorRoot } from './mutation-targets.js';
export { MutationQueue } from './mutation-queue.js';
export type { MutationTask } from './mutation-queue.js';
export { installMutationBroadcast } from './broadcast.js';
export type {
  BroadcastLike,
  InstallMutationBroadcastOptions,
  MutationBroadcast,
} from './broadcast.js';
export {
  applyOptimisticTransforms,
  installPagehideOptimismCleanup,
  OptimisticRebaser,
} from './optimism.js';
export type {
  MutationChangeRecord,
  OptimisticChange,
  OptimisticEntry,
  OptimisticFor,
  OptimisticPlan,
  OptimisticQueryKey,
  OptimisticTransform,
  PagehideOptimismCleanupOptions,
  PendingOptimism,
  PendingTransform,
} from './optimism.js';
export { stampPendingQueries } from './pending.js';
export type { PendingElementLike, PendingRoot } from './pending.js';
export type {
  LoaderLifecycleTarget,
  LoaderRoot,
  VisibleObserver,
  VisibleObserverFactory,
  VisibleObserverEntry,
} from './loader-lifecycle.js';
export { installJisoLoader } from './loader.js';
export type { JisoLoader, JisoLoaderOptions } from './loader.js';
export {
  createSubmitContext,
  dispatchEnhancedFormSubmit,
  isEnhancedSubmitEvent,
  submitEnhancedMutation,
  submitOptimisticEnhancedMutation,
} from './mutation-submit.js';
export type {
  EnhancedFormElementLike,
  EnhancedFormLike,
  EnhancedMutationFetch,
  EnhancedMutationFetchOptions,
  EnhancedMutationLoaderOptions,
  EnhancedMutationResponseLike,
  EnhancedMutationSubmitOptions,
  OptimisticEnhancedMutationSubmitOptions,
  SubmitContext,
  SubmitContextOptions,
  SubmitFormDefinition,
  SubmitOptions,
  UploadProgress,
} from './mutation-submit.js';

export interface DeriveDefinition<Inputs extends readonly string[], Value> {
  inputs: Inputs;
  run(...values: unknown[]): Value;
}

export function derive<const Inputs extends readonly string[], Value>(
  inputs: Inputs,
  fn: (...values: unknown[]) => Value,
): DeriveDefinition<Inputs, Value> {
  return { inputs, run: fn };
}
