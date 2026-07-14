import type { BrowserKovoRoot } from './browser-root.js';
import { withDefaultMutationBroadcast } from './broadcast.js';
import type { ClockUpdatePlan } from './clock-tick-bus.js';
import { definedProps } from './defined-props.js';
import { appendDisposer, drainDisposers } from './dispose-stack.js';
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
import type { EnhancedMutationFetch, UploadProgress } from './mutation-fetch.js';
import type { EnhancedMutationLoaderOptions } from './mutation-submit.js';
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';
import { installPagehideOptimismCleanup } from './optimism.js';
import type { QueryEventHydrationTarget } from './query-events.js';
import type { QueryApplyInterposition } from './query-apply.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { QueryRefetchOptions } from './query-refetch.js';
import type { QueryStore } from './query-store.js';
import { securityGetOwnPropertyDescriptor } from './security-witness-intrinsics.js';
import { readPageBuildToken } from './build-token.js';

const loaderBrowserSecurity =
  typeof document === 'undefined' ? undefined : createBrowserNavigationSecurityControls();

/**
 * App-facing enhanced-mutation wiring for `installKovoLoader`.
 *
 * The compiler-owned query plans and other mutation DI seams live on
 * {@link KovoGeneratedEnhancedMutationOptions}, exported from
 * `@kovojs/browser/generated` per SPEC §5.2 and §9.1.
 */
export interface BrowserEnhancedMutationOptions {
  fetch: EnhancedMutationFetch;
  onError?: (error: unknown, form: unknown) => void;
  onUploadProgress?: (progress: UploadProgress, form: unknown) => void;
  root: BrowserKovoRoot;
  store: QueryStore;
}

/**
 * @generated Compiler/runtime enhanced-mutation ABI for generated bootstraps
 * (SPEC §5.2, §9.1). App entries should use {@link BrowserEnhancedMutationOptions}.
 */
export type KovoGeneratedEnhancedMutationOptions = Omit<EnhancedMutationLoaderOptions, 'root'> & {
  root: BrowserKovoRoot & EnhancedMutationLoaderOptions['root'];
};

/**
 * Options for `installKovoLoader`: the app-facing root, module importer, query
 * store, and enhanced-mutation essentials.
 */
export interface KovoLoaderOptions {
  allowedClientModuleUrls?: readonly string[];
  enhancedMutations?: BrowserEnhancedMutationOptions;
  events?: readonly string[];
  importModule: (url: string) => Promise<Record<string, unknown>>;
  onError?: (error: unknown, context: unknown) => void;
  queryStore?: QueryStore;
  root: EventTarget & ParentNode;
}

/**
 * @generated Full generated/runtime loader ABI. Compiler-emitted bootstraps may
 * pass update plans, query-apply interpositions, lifecycle observers, and typed
 * read refetch hooks through `@kovojs/browser/generated`; those DI seams are not
 * part of the app-authored `@kovojs/browser/client` option surface.
 */
export interface KovoGeneratedLoaderOptions {
  allowedClientModuleUrls?: readonly string[];
  discardPendingOptimism?: () => readonly string[] | void;
  enhancedMutations?: KovoGeneratedEnhancedMutationOptions;
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
}

/**
 * @generated Running loader handle with generated/runtime integration hooks.
 */
export interface KovoGeneratedLoader extends KovoLoader {
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
  return installGeneratedKovoLoader(toGeneratedLoaderOptions(options));
}

/**
 * @generated Install the Kovo loader with compiler/runtime ABI options. Exported
 * from `@kovojs/browser/generated` as `installKovoLoader` for emitted bootstraps
 * (SPEC §5.2, §9.1).
 */
export function installGeneratedKovoLoader(
  options: KovoGeneratedLoaderOptions,
): KovoGeneratedLoader {
  const events = options.events ?? defaultDelegatedEvents;
  const allowedClientModuleUrls = ownAllowedClientModuleUrls(options);
  const islandSignalScope = createIslandSignalScope();
  // Every production import crosses one guarded boundary. An explicit compiler registry is used
  // by generated/programmatic loaders; otherwise the guard consumes the marked document manifest.
  const importModule = guardKovoDynamicImportModule(
    options.importModule,
    definedProps({ allowedModuleUrls: allowedClientModuleUrls }),
  );
  const disposers: Array<() => void> = [];
  let queryRuntime: InstalledLoaderQueryRuntime | undefined;
  const rememberAppliedQueries = (queries: readonly string[]): void => {
    queryRuntime?.rememberAppliedQueries(queries);
  };
  // bugs-1 F13 / SPEC §9.3: the server stamps an opaque per-session fingerprint as
  // <meta name="kovo-session">; the broadcast uses it to discard cross-principal
  // rebroadcasts so shared-device tabs never apply another session's private data.
  const sessionMeta =
    typeof document === 'undefined' || loaderBrowserSecurity === undefined
      ? null
      : loaderBrowserSecurity.queryOne(document, 'meta[name="kovo-session"]');
  const sessionFingerprint =
    sessionMeta === null || loaderBrowserSecurity === undefined
      ? undefined
      : (loaderBrowserSecurity.readAttribute(sessionMeta, 'content') ?? undefined);
  // SPEC §6.6/§9.1.1: generated loader authority uses one construction-time page build proof for
  // direct mutation apply and BroadcastChannel publish/receive.
  const pageBuildToken = readPageBuildToken();
  const enhancedMutationSetup = options.enhancedMutations
    ? withDefaultMutationBroadcast({
        ...options.enhancedMutations,
        ...definedProps({
          applyQuery: options.enhancedMutations.applyQuery ?? options.applyQuery,
          buildToken: pageBuildToken,
          broadcastOnError: options.onError
            ? (error: unknown) => {
                reportRuntimeContextError(options.onError, error, { phase: 'mutation-broadcast' });
              }
            : undefined,
          importModule: options.enhancedMutations.importModule
            ? guardKovoDynamicImportModule(
                options.enhancedMutations.importModule,
                definedProps({ allowedModuleUrls: allowedClientModuleUrls }),
              )
            : importModule,
          // K4 / SPEC §4.7: thread the loader's islandSignalScope into the broadcast
          // so a broadcast morph that removes an island correctly aborts its ctx.signal.
          islandSignalScope,
          expectedBuildToken: pageBuildToken,
          principal: sessionFingerprint,
        }),
        onAppliedQueries: rememberAppliedQueries,
      })
    : undefined;
  const enhancedMutations = enhancedMutationSetup?.options;

  initializeNativeIndeterminateCheckboxes(options.root);

  appendDisposer(
    disposers,
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

  appendDisposer(disposers, () => {
    queryRuntime?.dispose();
  });

  if (options.discardPendingOptimism) {
    appendDisposer(
      disposers,
      installPagehideOptimismCleanup({
        discardPendingOptimism: options.discardPendingOptimism,
        root: options.root,
      }),
    );
  }

  // SPEC §4.7/§4.8: startup triggers cross the same exact compiler-manifest gate as
  // delegated handlers. Passing the original importer here would make the trigger-level fallback
  // perform a second empty-manifest check and reject legitimate generated on:load/idle/visible refs.
  appendDisposer(
    disposers,
    installExecutionTriggers({ ...options, importModule }, islandSignalScope),
  );
  if (enhancedMutationSetup?.dispose) {
    appendDisposer(disposers, enhancedMutationSetup.dispose);
  }
  appendDisposer(disposers, () => {
    abortIslandSignalScope(islandSignalScope);
  });

  return {
    dispose() {
      drainDisposers(disposers);
    },
    events,
    // K4 / SPEC §4.7: expose so deferred-stream apply calls can pass the scope
    // and abort island signals when a morph removes an island's fragment target.
    islandSignalScope,
  };
}

function toGeneratedLoaderOptions(options: KovoLoaderOptions): KovoGeneratedLoaderOptions {
  const enhancedMutations =
    options.enhancedMutations === undefined
      ? undefined
      : {
          ...options.enhancedMutations,
          root: options.enhancedMutations.root as KovoGeneratedEnhancedMutationOptions['root'],
        };

  return {
    importModule: options.importModule as ImportHandlerModule,
    root: options.root as LoaderRoot,
    ...definedProps({
      allowedClientModuleUrls: ownAllowedClientModuleUrls(options),
      enhancedMutations,
      events: options.events,
      onError: options.onError as KovoGeneratedLoaderOptions['onError'],
      queryStore: options.queryStore,
    }),
  };
}

function ownAllowedClientModuleUrls(
  options: KovoLoaderOptions | KovoGeneratedLoaderOptions,
): readonly string[] | undefined {
  const descriptor = securityGetOwnPropertyDescriptor(options, 'allowedClientModuleUrls');
  if (descriptor === undefined || ('value' in descriptor && descriptor.value === undefined)) {
    return undefined;
  }
  if (!('value' in descriptor)) {
    throw new TypeError('Kovo loader allowedClientModuleUrls must be an own-data property.');
  }
  return descriptor.value as readonly string[];
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
