import { withDefaultMutationBroadcast } from './broadcast.js';
import { definedProps } from './defined-props.js';
import { reportRuntimeContextError } from './error-policy.js';
import type { RuntimeErrorContext } from './events.js';
import { abortIslandSignalScope, createIslandSignalScope } from './handlers.js';
import type { ImportHandlerModule } from './handlers.js';
import { installDelegatedEventLifecycle, installExecutionTriggers } from './loader-lifecycle.js';
import type {
  LoaderLifecycleTarget,
  LoaderRoot,
  VisibleObserverFactory,
} from './loader-lifecycle.js';
import type { EnhancedMutationLoaderOptions } from './mutation-submit.js';
import { installPagehideOptimismCleanup } from './optimism.js';
import { installInlineQueryEventHydration } from './query-events.js';
import type { QueryEventHydrationTarget } from './query-events.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import { installQueryVisibleReturnRefetch } from './query-visible-return.js';
import type { QueryRefetchOptions } from './query-refetch.js';
import type { QueryStore } from './query-store.js';

export interface JisoLoaderOptions {
  discardPendingOptimism?: () => readonly string[] | void;
  enhancedMutations?: EnhancedMutationLoaderOptions;
  events?: readonly string[];
  focusTarget?: LoaderLifecycleTarget;
  importModule: ImportHandlerModule;
  onError?: (error: unknown, context: RuntimeErrorContext) => void;
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
  const queryVisibleReturn = installQueryVisibleReturnRefetch({
    onError(error) {
      reportRuntimeContextError(options.onError, error, { phase: 'query-hydration' });
    },
    ...definedProps({
      queryRefetch: options.queryRefetch,
      queryStore: options.queryStore,
      refetchOnFocus: options.refetchOnFocus,
      refetchOnFocusOptOut: options.refetchOnFocusOptOut,
    }),
    root: options.root,
  });
  const enhancedMutationSetup = options.enhancedMutations
    ? withDefaultMutationBroadcast({
        ...options.enhancedMutations,
        onAppliedQueries(queries) {
          queryVisibleReturn.rememberAppliedQueries(queries);
        },
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
      onAppliedQueries(queries) {
        queryVisibleReturn.rememberAppliedQueries(queries);
      },
      root: options.root,
    }),
  );

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

  if (options.queryStore) {
    disposers.push(
      installInlineQueryEventHydration({
        onError(error) {
          reportRuntimeContextError(options.onError, error, { phase: 'query-hydration' });
        },
        onAppliedQueries(queries) {
          queryVisibleReturn.rememberAppliedQueries(queries);
        },
        root: options.root,
        store: options.queryStore,
        target:
          options.queryEventTarget ??
          globalQueryEventTarget() ??
          (options.root as unknown as QueryEventHydrationTarget),
        ...definedProps({
          queryPlans: options.queryPlans ?? options.enhancedMutations?.queryPlans,
        }),
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

function globalQueryEventTarget(): QueryEventHydrationTarget | undefined {
  return typeof globalThis.addEventListener === 'function' ? globalThis : undefined;
}
