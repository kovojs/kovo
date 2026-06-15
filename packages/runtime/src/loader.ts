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

/** Options for `installJisoLoader`: the root, module importer, query store/plans, and lifecycle hooks. */
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

/** A running loader instance: the delegated `events` it listens for and a `dispose` to tear it down. */
export interface JisoLoader {
  dispose(): void;
  events: readonly string[];
}

// SPEC.md §4.4: delegate (capture phase) every on:* event the app may use. focus/blur
// have no bubble phase but run a capture phase at ancestors, so capture delegation reaches
// them; pointerenter/pointerleave are synthesized from pointerover/out in the lifecycle.
const defaultDelegatedEvents = [
  'click',
  'submit',
  'input',
  'change',
  'keydown',
  'keyup',
  'contextmenu',
  'paste',
  'cancel',
  'beforetoggle',
  'animationend',
  'scroll',
  'focus',
  'blur',
  'pointerdown',
  'pointermove',
  'pointerup',
] as const;

/**
 * Install the Jiso client loader on a root element: wire delegated events,
 * hydrate the query store from inline scripts, lazy-load island handlers on
 * first interaction, and apply mutation fragment patches and optimistic updates.
 * This is the single client entry point; the compiler emits the inline bootstrap
 * that calls it (SPEC §8). Returns a handle whose `dispose` removes all listeners.
 *
 * @param options - The `root`, an `importModule` to load handler bundles, and optional query/lifecycle hooks.
 * @returns A `JisoLoader` handle.
 */
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

  initializeNativeIndeterminateCheckboxes(options.root);

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

function initializeNativeIndeterminateCheckboxes(root: LoaderRoot): void {
  if (!root.querySelectorAll) return;

  for (const element of root.querySelectorAll(
    'input[type="checkbox"][aria-checked="mixed"],input[type="checkbox"][data-state="indeterminate"]',
  ) as Iterable<{ indeterminate?: boolean }>) {
    if (element.indeterminate !== undefined) {
      element.indeterminate = true;
    }
  }
}
