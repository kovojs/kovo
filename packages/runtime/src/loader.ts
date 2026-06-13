import { withDefaultMutationBroadcast } from './broadcast.js';
import { definedProps } from './defined-props.js';
import { reportRuntimeContextError } from './error-policy.js';
import type { RuntimeErrorContext } from './events.js';
import { abortIslandSignalScope, createIslandSignalScope } from './handler-context.js';
import type { ImportHandlerModule } from './handlers.js';
import { installDelegatedEventLifecycle, installExecutionTriggers } from './loader-lifecycle.js';
import type {
  LoaderLifecycleTarget,
  LoaderRoot,
  VisibleObserverFactory,
} from './loader-lifecycle.js';
import { installLoaderQueryRuntime } from './loader-query.js';
import type { InstalledLoaderQueryRuntime } from './loader-query.js';
import type { EnhancedMutationLoaderOptions } from './mutation-submit.js';
import { installPagehideOptimismCleanup } from './optimism.js';
import type { QueryEventHydrationTarget } from './query-events.js';
import type { QueryApplyInterposition } from './query-apply.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { QueryRefetchOptions } from './query-refetch.js';
import type { QueryStore } from './query-store.js';

export interface JisoLoaderOptions {
  discardPendingOptimism?: () => readonly string[] | void;
  enhancedMutations?: EnhancedMutationLoaderOptions;
  events?: readonly string[];
  focusTarget?: LoaderLifecycleTarget;
  importModule: ImportHandlerModule;
  onError?: (error: unknown, context: RuntimeErrorContext) => void;
  applyQuery?: QueryApplyInterposition;
  queryEventTarget?: QueryEventHydrationTarget;
  queryPlans?: CompiledQueryUpdatePlans;
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
  let queryRuntime: InstalledLoaderQueryRuntime | undefined;
  const rememberAppliedQueries = (queries: readonly string[]): void => {
    queryRuntime?.rememberAppliedQueries(queries);
  };
  const enhancedMutationSetup = options.enhancedMutations
    ? withDefaultMutationBroadcast({
        ...options.enhancedMutations,
        ...definedProps({
          applyQuery: options.enhancedMutations.applyQuery ?? options.applyQuery,
          broadcastOnError: options.onError
            ? (error: unknown) => {
                reportRuntimeContextError(options.onError, error, { phase: 'mutation-broadcast' });
              }
            : undefined,
        }),
        onAppliedQueries: rememberAppliedQueries,
      })
    : undefined;
  const enhancedMutations = enhancedMutationSetup?.options;

  disposers.push(
    installDelegatedEventLifecycle({
      ...definedProps({
        enhancedMutations,
        onError: options.onError,
      }),
      events,
      importModule: options.importModule,
      islandSignalScope,
      onAppliedQueries: rememberAppliedQueries,
      root: options.root,
    }),
  );

  queryRuntime = installLoaderQueryRuntime({
    root: options.root,
    ...definedProps({
      applyQuery: options.applyQuery,
      onError: options.onError,
      queryEventTarget: options.queryEventTarget,
      queryPlans: options.queryPlans ?? options.enhancedMutations?.queryPlans,
      queryRefetch: options.queryRefetch,
      queryStore: options.queryStore,
      refetchOnFocus: options.refetchOnFocus,
      refetchOnFocusOptOut: options.refetchOnFocusOptOut,
    }),
  });

  disposers.push(() => {
    queryRuntime?.dispose();
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
