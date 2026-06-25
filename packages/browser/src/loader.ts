import type { BrowserKovoRoot } from './browser-root.js';
import { withDefaultMutationBroadcast } from './broadcast.js';
import type { ClockUpdatePlan } from './clock-tick-bus.js';
import { definedProps } from './defined-props.js';
import { guardKovoDynamicImportModule } from './dynamic-import-url.js';
import { reportRuntimeContextError } from './error-policy.js';
import type { RuntimeErrorContext } from './events.js';
import { abortIslandSignalScope, createIslandSignalScope } from './handler-context.js';
import type { IslandSignalScope } from './handler-context.js';
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

/**
 * Enhanced-mutation wiring for `installKovoLoader`: the same options as
 * {@link EnhancedMutationLoaderOptions}, but with the `root` typed as the opaque
 * {@link BrowserKovoRoot} from `createBrowserKovoRoot` so an app entry does not
 * hand-build the low-level morph/target objects (SPEC §9.1).
 */
export type BrowserEnhancedMutationOptions = Omit<EnhancedMutationLoaderOptions, 'root'> & {
  root: BrowserKovoRoot;
};

/**
 * Options for `installKovoLoader`: the root, module importer, query store/plans, and lifecycle hooks.
 */
export interface KovoLoaderOptions {
  allowedClientModuleUrls?: readonly string[];
  discardPendingOptimism?: () => readonly string[] | void;
  enhancedMutations?: BrowserEnhancedMutationOptions;
  events?: readonly string[];
  focusTarget?: LoaderLifecycleTarget;
  importModule: ImportHandlerModule;
  onError?: (error: unknown, context: RuntimeErrorContext) => void;
  applyQuery?: QueryApplyInterposition;
  clockUpdatePlans?: readonly ClockUpdatePlan[];
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

/**
 * A running loader instance: the delegated `events` it listens for, a `dispose` to tear it down,
 * and the `islandSignalScope` for threading into deferred-stream applies (K4 / SPEC §4.7).
 */
export interface KovoLoader {
  dispose(): void;
  events: readonly string[];
  /** K4 / SPEC §4.7: the loader's island signal scope for passing to applyDeferredStreamResponseToRuntime. */
  islandSignalScope: IslandSignalScope;
}

// SPEC.md §4.4: delegate (capture phase) every on:* event the app may use. focus/blur
// have no bubble phase but run a capture phase at ancestors, so capture delegation reaches
// them; pointerenter/pointerleave are synthesized from pointerover/out in the lifecycle.
export const defaultDelegatedEvents = [
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
 * Install the Kovo client loader on a root element: wire delegated events,
 * hydrate the query store from inline scripts, lazy-load island handlers on
 * first interaction, and apply mutation fragment patches and optimistic updates.
 * This is the manual/programmatic loader entry for app entries and starters that
 * wire the loader by hand; it is NOT what the compiler inlines. The shipped
 * production bootstrap is the `@internal installInlineKovoLoader` in
 * `./inline-loader.js` (SPEC §8). Returns a handle whose `dispose` removes all listeners.
 *
 * @experimental
 * @param options - The `root`, an `importModule` to load handler bundles, and optional query/lifecycle hooks.
 * @returns A `KovoLoader` handle.
 */
export function installKovoLoader(options: KovoLoaderOptions): KovoLoader {
  const events = options.events ?? defaultDelegatedEvents;
  const islandSignalScope = createIslandSignalScope();
  const importModule =
    options.allowedClientModuleUrls === undefined
      ? options.importModule
      : guardKovoDynamicImportModule(options.importModule, {
          allowedModuleUrls: options.allowedClientModuleUrls,
        });
  const disposers: Array<() => void> = [];
  let queryRuntime: InstalledLoaderQueryRuntime | undefined;
  const rememberAppliedQueries = (queries: readonly string[]): void => {
    queryRuntime?.rememberAppliedQueries(queries);
  };
  // bugs-1 F13 / SPEC §9.3: the server stamps an opaque per-session fingerprint as
  // <meta name="kovo-session">; the broadcast uses it to discard cross-principal
  // rebroadcasts so shared-device tabs never apply another session's private data.
  const sessionFingerprint =
    typeof document === 'undefined'
      ? undefined
      : (document.querySelector('meta[name="kovo-session"]')?.getAttribute('content') ?? undefined);
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
          importModule:
            options.enhancedMutations.importModule && options.allowedClientModuleUrls !== undefined
              ? guardKovoDynamicImportModule(options.enhancedMutations.importModule, {
                  allowedModuleUrls: options.allowedClientModuleUrls,
                })
              : (options.enhancedMutations.importModule ?? importModule),
          // K4 / SPEC §4.7: thread the loader's islandSignalScope into the broadcast
          // so a broadcast morph that removes an island correctly aborts its ctx.signal.
          islandSignalScope,
          principal: sessionFingerprint,
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
      importModule,
      islandSignalScope,
      onAppliedQueries: rememberAppliedQueries,
      root: options.root,
    }),
  );

  queryRuntime = installLoaderQueryRuntime({
    root: options.root,
    ...definedProps({
      applyQuery: options.applyQuery,
      clockUpdatePlans: options.clockUpdatePlans,
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
    // K4 / SPEC §4.7: expose so deferred-stream apply calls can pass the scope
    // and abort island signals when a morph removes an island's fragment target.
    islandSignalScope,
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
