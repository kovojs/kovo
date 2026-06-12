export type { DiagnosticCode } from '@jiso/core';
import { reportRuntimeContextError } from './error-policy.js';
import type { QueryScriptLike, QueryStore } from './query-store.js';
import {
  abortIslandSignalScope,
  createIslandSignalScope,
  dispatchDelegatedEvent,
} from './handlers.js';
import type { ImportHandlerModule } from './handlers.js';
import { installMutationBroadcast } from './broadcast.js';
import type { BroadcastLike } from './broadcast.js';
import { installQueryVisibleReturnRefetch } from './query-refetch.js';
import type { QueryRefetchOptions } from './query-refetch.js';
import { installPagehideOptimismCleanup } from './optimism.js';
import type { RuntimeErrorContext } from './events.js';
import { addLoaderListener, installExecutionTriggers } from './loader-lifecycle.js';
import type {
  LoaderLifecycleTarget,
  LoaderRoot,
  VisibleObserverFactory,
} from './loader-lifecycle.js';
import { dispatchEnhancedFormSubmit, isEnhancedSubmitEvent } from './mutation-submit.js';
import type { EnhancedMutationLoaderOptions } from './mutation-submit.js';
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

type DefinedProps<Props extends object> = {
  [Key in keyof Props]?: Exclude<Props[Key], undefined>;
};

function definedProps<Props extends object>(props: Props): DefinedProps<Props> {
  return Object.fromEntries(
    Object.entries(props).filter((entry) => {
      const [, value] = entry;
      return value !== undefined;
    }),
  ) as DefinedProps<Props>;
}

export interface JisoLoaderOptions {
  discardPendingOptimism?: () => readonly string[] | void;
  enhancedMutations?: EnhancedMutationLoaderOptions;
  events?: readonly string[];
  focusTarget?: LoaderLifecycleTarget;
  importModule: ImportHandlerModule;
  onError?: (error: unknown, context: RuntimeErrorContext) => void;
  queryRefetch?: QueryRefetchOptions;
  requestIdle?: (callback: () => void) => void;
  visibleObserver?: VisibleObserverFactory;
  queryStore?: QueryStore;
  refetchOnFocus?: (queries: readonly string[]) => void | Promise<void>;
  refetchOnFocusOptOut?: readonly string[];
  root: LoaderRoot;
}

export interface JisoLoader {
  dispose(): void;
  events: readonly string[];
}

const defaultDelegatedEvents = ['click', 'submit', 'input', 'change'] as const;

export function installJisoLoader(options: JisoLoaderOptions): JisoLoader {
  const events = options.events ?? defaultDelegatedEvents;
  const islandSignalScope = createIslandSignalScope();
  const disposers: Array<() => void> = [];
  const enhancedMutationSetup = options.enhancedMutations
    ? withDefaultMutationBroadcast(options.enhancedMutations)
    : undefined;
  const enhancedMutations = enhancedMutationSetup?.options;
  const queryVisibleReturn = installQueryVisibleReturnRefetch({
    onError(error) {
      reportRuntimeContextError(options.onError, error, { phase: 'query-hydration' });
    },
    ...definedProps({
      queryRefetch: options.queryRefetch,
      queryScripts: options.root.querySelectorAll
        ? () => options.root.querySelectorAll?.('script[fw-query]') as Iterable<QueryScriptLike>
        : undefined,
      queryStore: options.queryStore,
      refetchOnFocus: options.refetchOnFocus,
      refetchOnFocusOptOut: options.refetchOnFocusOptOut,
    }),
    root: options.root,
  });

  for (const eventName of events) {
    addLoaderListener(
      options.root,
      eventName,
      async (event) => {
        const enhancedSubmit = isEnhancedSubmitEvent(event, enhancedMutations);
        try {
          if (
            await dispatchEnhancedFormSubmit(event, enhancedMutations, islandSignalScope, {
              onAppliedQueries: (queries) => {
                queryVisibleReturn.rememberAppliedQueries(queries);
              },
            })
          ) {
            return;
          }
          await dispatchDelegatedEvent(event, options.importModule, islandSignalScope);
        } catch (error) {
          reportRuntimeContextError(options.onError, error, {
            event,
            phase: enhancedSubmit ? 'enhanced-mutation' : 'delegated-event',
          });
        }
      },
      disposers,
      { capture: true },
    );
  }

  disposers.push(() => {
    queryVisibleReturn.dispose();
  });

  if (options.discardPendingOptimism) {
    disposers.push(
      installPagehideOptimismCleanup({
        discardPendingOptimism: options.discardPendingOptimism,
        root: options.root,
      }),
    );
  }

  disposers.push(installExecutionTriggers(options, islandSignalScope));
  if (enhancedMutationSetup?.dispose) {
    disposers.push(enhancedMutationSetup.dispose);
  }
  disposers.push(() => {
    abortIslandSignalScope(islandSignalScope);
  });

  return {
    dispose() {
      for (const dispose of disposers.splice(0).reverse()) dispose();
    },
    events,
  };
}

function withDefaultMutationBroadcast(options: EnhancedMutationLoaderOptions): {
  dispose?: () => void;
  options: EnhancedMutationLoaderOptions;
} {
  if (options.broadcast) return { options };
  if (typeof globalThis.BroadcastChannel !== 'function') return { options };

  try {
    const broadcast = installMutationBroadcast({
      channel: new globalThis.BroadcastChannel('jiso:mutation-response') as BroadcastLike,
      ...definedProps({ morph: options.morph, queryPlans: options.queryPlans }),
      root: options.root,
      store: options.store,
    });
    return {
      dispose: () => {
        broadcast.close();
      },
      options: {
        ...options,
        broadcast,
      },
    };
  } catch {
    return { options };
  }
}
