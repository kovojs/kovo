import { withDefaultMutationBroadcast } from './broadcast.js';
import { reportRuntimeContextError } from './error-policy.js';
import type { RuntimeErrorContext } from './events.js';
import {
  abortIslandSignalScope,
  createIslandSignalScope,
  dispatchDelegatedEvent,
} from './handlers.js';
import type { ImportHandlerModule } from './handlers.js';
import { addLoaderListener, installExecutionTriggers } from './loader-lifecycle.js';
import type {
  LoaderLifecycleTarget,
  LoaderRoot,
  VisibleObserverFactory,
} from './loader-lifecycle.js';
import { dispatchEnhancedFormSubmit, isEnhancedSubmitEvent } from './mutation-submit.js';
import type { EnhancedMutationLoaderOptions } from './mutation-submit.js';
import { installPagehideOptimismCleanup } from './optimism.js';
import { installQueryVisibleReturnRefetch } from './query-refetch.js';
import type { QueryRefetchOptions } from './query-refetch.js';
import type { QueryScriptLike, QueryStore } from './query-store.js';

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
