import { describe, expect, it } from 'vitest';

import * as runtime from './index.js';
import { applyDeferredStreamResponseToRuntime } from './apply-deferred-stream.js';
import { createEventBus } from './events.js';
import {
  abortRemovedIslandSignals,
  readElementParams,
  readElementState,
  writeElementState,
} from './handler-context.js';
import { dispatchDelegatedEvent, handler } from './handlers.js';
import {
  createInlineJisoLoaderSource,
  installInlineJisoLoader,
  jisoLoaderSource,
} from './inline-loader.js';
import { installJisoLoader } from './loader.js';
import {
  applyFragments,
  DomMorphRoot,
  DomMorphTarget,
  keyedDomMorph,
  morphDomElement,
  morphStructuralTree,
} from './morph.js';
import { installMutationBroadcast } from './broadcast.js';
import { applyFetchedEnhancedMutationResponseToDom } from './mutation-apply.js';
import { MutationQueue } from './mutation-queue.js';
import {
  createMutationIdem,
  isMutationBroadcastMessage,
  readMutationChangeHeader,
  sanitizeMutationChangeRecord,
} from './mutation-response.js';
import {
  dispatchEnhancedFormSubmit,
  isEnhancedSubmitEvent,
  submitEnhancedMutation,
} from './mutation-submit.js';
import { submitOptimisticEnhancedMutation } from './mutation-optimistic.js';
import {
  applyOptimisticTransforms,
  installPagehideOptimismCleanup,
  OptimisticRebaser,
} from './optimism.js';
import { stampPendingQueries } from './pending.js';
import { createSubmitContext } from './submit-context.js';
import {
  applyCompiledQueryUpdatePlan,
  applyQueryBindings,
  supportsQueryBindings,
} from './query-bindings.js';
import {
  applyInlineQueryEventToRuntime,
  installInlineQueryEventHydration,
} from './query-events.js';
import { refetchQueries } from './query-refetch.js';
import { createQueryStore } from './query-store.js';
import { derive } from './derive.js';

// @ts-expect-error SPEC.md §9.4: decoded query apply options belong to the query-apply module,
// not the root runtime barrel.
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
import type { ApplyQueryChunksToRuntimeOptions as RemovedRootApplyQueryChunksToRuntimeOptions } from './index.js';

// @ts-expect-error SPEC.md §9.1: rooted decoded apply results use the root-aware runtime name.
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedMutationDomResult = import('./index.js').AppliedMutationResponseToDom;

// @ts-expect-error SPEC.md §9.1: DOM body parsing is an internal module seam,
// not a root runtime compatibility export.
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedMutationResponseToDom = typeof import('./index.js').applyMutationResponseToDom;

// @ts-expect-error SPEC.md §4.4: inline loader imports use the canonical handler module type,
// not a root runtime compatibility alias.
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedInlineImportHandlerModule = import('./index.js').InlineImportHandlerModule;

// @ts-expect-error SPEC.md §4.4/§9.1: wire chunk shapes belong to their parser/scanner modules,
// not the root runtime barrel.
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootFragmentChunk = import('./index.js').FragmentChunk;

// @ts-expect-error SPEC.md §4.4/§9.1: decoded query wire chunks are parser-owned,
// not a duplicated root runtime compatibility type.
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootQueryChunk = import('./index.js').QueryChunk;

// @ts-expect-error SPEC.md §9.4: decoded query chunk apply is an internal runtime primitive,
// not a root runtime compatibility export.
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootApplyQueryChunksToRuntime = typeof import('./index.js').applyQueryChunksToRuntime;

describe('runtime root exports', () => {
  it('exports loader and handler modules directly from their canonical implementations', () => {
    // SPEC.md §4.4/§4.7: the public runtime loader surface composes the same
    // loader, event, and handler modules that execute delegated browser work.
    expect(runtime.createEventBus).toBe(createEventBus);
    expect(runtime.abortRemovedIslandSignals).toBe(abortRemovedIslandSignals);
    expect(runtime.readElementParams).toBe(readElementParams);
    expect(runtime.readElementState).toBe(readElementState);
    expect(runtime.writeElementState).toBe(writeElementState);
    expect(runtime.dispatchDelegatedEvent).toBe(dispatchDelegatedEvent);
    expect(runtime.handler).toBe(handler);
    expect(runtime.installJisoLoader).toBe(installJisoLoader);
    expect(Object.hasOwn(runtime, 'parseHandlerReference')).toBe(false);
    expect(Object.hasOwn(runtime, 'parseHandlerReferences')).toBe(false);
  });

  it('exports inline loader and morph modules without private compatibility barrels', () => {
    // SPEC.md §4.4/§9.1: inline bootstrap and morph exports must remain the
    // canonical modules after deleting private runtime re-export facades.
    expect(runtime.createInlineJisoLoaderSource).toBe(createInlineJisoLoaderSource);
    expect(runtime.installInlineJisoLoader).toBe(installInlineJisoLoader);
    expect(runtime.jisoLoaderSource).toBe(jisoLoaderSource);
    expect(runtime.applyFragments).toBe(applyFragments);
    expect(runtime.DomMorphRoot).toBe(DomMorphRoot);
    expect(runtime.DomMorphTarget).toBe(DomMorphTarget);
    expect(runtime.keyedDomMorph).toBe(keyedDomMorph);
    expect(runtime.morphDomElement).toBe(morphDomElement);
    expect(runtime.morphStructuralTree).toBe(morphStructuralTree);
  });

  it('exports mutation modules directly from their split implementations', () => {
    // SPEC.md §9.1/§9.2/§10.4: mutation submit, response apply, broadcast,
    // pending, and optimism stay split while the root package remains stable.
    expect(runtime.applyDeferredStreamResponseToRuntime).toBe(applyDeferredStreamResponseToRuntime);
    expect(runtime.installMutationBroadcast).toBe(installMutationBroadcast);
    expect(runtime.applyFetchedEnhancedMutationResponseToDom).toBe(
      applyFetchedEnhancedMutationResponseToDom,
    );
    expect(runtime.MutationQueue).toBe(MutationQueue);
    expect(runtime.createMutationIdem).toBe(createMutationIdem);
    expect(runtime.isMutationBroadcastMessage).toBe(isMutationBroadcastMessage);
    expect(runtime.readMutationChangeHeader).toBe(readMutationChangeHeader);
    expect(runtime.sanitizeMutationChangeRecord).toBe(sanitizeMutationChangeRecord);
    expect(runtime.dispatchEnhancedFormSubmit).toBe(dispatchEnhancedFormSubmit);
    expect(runtime.isEnhancedSubmitEvent).toBe(isEnhancedSubmitEvent);
    expect(runtime.submitEnhancedMutation).toBe(submitEnhancedMutation);
    expect(runtime.submitOptimisticEnhancedMutation).toBe(submitOptimisticEnhancedMutation);
    expect(runtime.applyOptimisticTransforms).toBe(applyOptimisticTransforms);
    expect(runtime.installPagehideOptimismCleanup).toBe(installPagehideOptimismCleanup);
    expect(runtime.OptimisticRebaser).toBe(OptimisticRebaser);
    expect(runtime.stampPendingQueries).toBe(stampPendingQueries);
    expect(runtime.createSubmitContext).toBe(createSubmitContext);
    expect(Object.hasOwn(runtime, 'applyDeferredStreamResponseToDom')).toBe(false);
    expect(Object.hasOwn(runtime, 'applyEnhancedMutationResponseBodyToDom')).toBe(false);
    expect(Object.hasOwn(runtime, 'applyFragmentQueryBody')).toBe(false);
    expect(Object.hasOwn(runtime, 'applyMutationResponse')).toBe(false);
    expect(Object.hasOwn(runtime, 'applyMutationResponseBodyToRuntime')).toBe(false);
    expect(Object.hasOwn(runtime, 'applyMutationResponseChunksToRuntime')).toBe(false);
    expect(Object.hasOwn(runtime, 'applyMutationResponseToDom')).toBe(false);
    expect(Object.hasOwn(runtime, 'applyMutationResponseToStore')).toBe(false);
    expect(Object.hasOwn(runtime, 'applyMutationResponseToRuntime')).toBe(false);
    expect(Object.hasOwn(runtime, 'AppliedMutationResponseToDom')).toBe(false);
  });

  it('exports query modules directly from their split implementations', () => {
    // SPEC.md §4.8/§9.4: the public query data plane is the same split store,
    // apply, binding, refetch, event, and derive implementation used at runtime.
    expect(runtime.applyCompiledQueryUpdatePlan).toBe(applyCompiledQueryUpdatePlan);
    expect(runtime.applyQueryBindings).toBe(applyQueryBindings);
    expect(runtime.supportsQueryBindings).toBe(supportsQueryBindings);
    expect(runtime.applyInlineQueryEventToRuntime).toBe(applyInlineQueryEventToRuntime);
    expect(runtime.installInlineQueryEventHydration).toBe(installInlineQueryEventHydration);
    expect(runtime.refetchQueries).toBe(refetchQueries);
    expect(runtime.createQueryStore).toBe(createQueryStore);
    expect(runtime.derive).toBe(derive);
    expect(Object.hasOwn(runtime, 'applyQueryChunksToRuntime')).toBe(false);
    expect(Object.hasOwn(runtime, 'applyQueryChunkToStore')).toBe(false);
    expect(Object.hasOwn(runtime, 'applyQueryChunksToStore')).toBe(false);
    expect(Object.hasOwn(runtime, 'createQueryScriptHydrationLedger')).toBe(false);
    expect(Object.hasOwn(runtime, 'hydrateQueryScripts')).toBe(false);
    expect(Object.hasOwn(runtime, 'queryScriptsFromRoot')).toBe(false);
  });
});
