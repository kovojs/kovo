import { describe, expect, it } from 'vitest';

import * as runtime from './index.js';
import { createEventBus } from './events.js';
import {
  abortRemovedIslandSignals,
  readElementParams,
  readElementState,
  writeElementState,
} from './handler-context.js';
import {
  dispatchDelegatedEvent,
  handler,
  parseHandlerReference,
  parseHandlerReferences,
} from './handlers.js';
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
import {
  applyEnhancedMutationResponseBodyToDom,
  applyFetchedEnhancedMutationResponseToDom,
} from './mutation-apply.js';
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
  applyQueryChunksToRuntime,
  createQueryScriptHydrationLedger,
  hydrateQueryScripts,
  queryScriptsFromRoot,
} from './query-apply.js';
import {
  applyInlineQueryEventToRuntime,
  installInlineQueryEventHydration,
} from './query-events.js';
import { refetchQueries } from './query-refetch.js';
import { createQueryStore } from './query-store.js';
import { derive } from './derive.js';

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
    expect(runtime.parseHandlerReference).toBe(parseHandlerReference);
    expect(runtime.parseHandlerReferences).toBe(parseHandlerReferences);
    expect(runtime.installJisoLoader).toBe(installJisoLoader);
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
    expect(runtime.installMutationBroadcast).toBe(installMutationBroadcast);
    expect(runtime.applyEnhancedMutationResponseBodyToDom).toBe(
      applyEnhancedMutationResponseBodyToDom,
    );
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
    expect(Object.hasOwn(runtime, 'applyMutationResponseToStore')).toBe(false);
  });

  it('exports query modules directly from their split implementations', () => {
    // SPEC.md §4.8/§9.4: the public query data plane is the same split store,
    // apply, binding, refetch, event, and derive implementation used at runtime.
    expect(runtime.applyCompiledQueryUpdatePlan).toBe(applyCompiledQueryUpdatePlan);
    expect(runtime.applyQueryBindings).toBe(applyQueryBindings);
    expect(runtime.supportsQueryBindings).toBe(supportsQueryBindings);
    expect(runtime.applyQueryChunksToRuntime).toBe(applyQueryChunksToRuntime);
    expect(runtime.createQueryScriptHydrationLedger).toBe(createQueryScriptHydrationLedger);
    expect(runtime.hydrateQueryScripts).toBe(hydrateQueryScripts);
    expect(runtime.queryScriptsFromRoot).toBe(queryScriptsFromRoot);
    expect(runtime.applyInlineQueryEventToRuntime).toBe(applyInlineQueryEventToRuntime);
    expect(runtime.installInlineQueryEventHydration).toBe(installInlineQueryEventHydration);
    expect(runtime.refetchQueries).toBe(refetchQueries);
    expect(runtime.createQueryStore).toBe(createQueryStore);
    expect(runtime.derive).toBe(derive);
  });
});
