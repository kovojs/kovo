import type {
  ListenerTargetLike,
  OptionalQuerySelectorAllRootLike,
  VisibilityStateLike,
} from './dom-like.js';
import { reportRuntimeContextError } from './error-policy.js';
import type {
  DelegatedEvent,
  EventElementLike,
  EventTargetLike,
  RuntimeErrorContext,
} from './events.js';
import { dispatchDelegatedEvent } from './handlers.js';
import type { IslandSignalScope } from './handler-context.js';
import type { ImportHandlerModule } from './handlers.js';
import {
  dispatchEnhancedFormSubmit,
  isEnhancedSubmitEvent,
  type EnhancedMutationLoaderOptions,
} from './mutation-submit.js';
import type { QueryScriptLike } from './query-script-hydration.js';

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface LoaderLifecycleTarget extends ListenerTargetLike<DelegatedEvent> {}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface LoaderRoot
  extends
    LoaderLifecycleTarget,
    OptionalQuerySelectorAllRootLike<EventElementLike | QueryScriptLike>,
    VisibilityStateLike {}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface VisibleObserver {
  observe(element: EventElementLike): void;
  unobserve(element: EventElementLike): void;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export type VisibleObserverFactory = (
  callback: (entries: readonly VisibleObserverEntry[]) => void,
) => VisibleObserver;

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface VisibleObserverEntry {
  isIntersecting: boolean;
  target: EventElementLike;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface ExecutionTriggerOptions {
  importModule: ImportHandlerModule;
  onError?: (error: unknown, context: RuntimeErrorContext) => void;
  requestIdle?: (callback: () => void) => void;
  root: LoaderRoot;
  visibleObserver?: VisibleObserverFactory;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface DelegatedEventLifecycleOptions {
  enhancedMutations?: EnhancedMutationLoaderOptions;
  events: readonly string[];
  importModule: ImportHandlerModule;
  islandSignalScope: IslandSignalScope;
  onAppliedQueries?: (queries: readonly string[]) => void;
  onError?: (error: unknown, context: RuntimeErrorContext) => void;
  root: LoaderRoot;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export function addLoaderListener(
  target: LoaderLifecycleTarget,
  type: string,
  listener: (event: DelegatedEvent) => void | Promise<void>,
  disposers: Array<() => void>,
  options?: { capture?: boolean },
): void {
  target.addEventListener(type, listener, options);
  disposers.push(() => {
    target.removeEventListener?.(type, listener, options);
  });
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export function installDelegatedEventLifecycle(
  options: DelegatedEventLifecycleOptions,
): () => void {
  const disposers: Array<() => void> = [];

  for (const eventName of options.events) {
    addLoaderListener(
      options.root,
      eventName,
      async (event) => {
        const enhancedSubmit = isEnhancedSubmitEvent(event, options.enhancedMutations);
        try {
          if (
            await dispatchEnhancedFormSubmit(
              event,
              options.enhancedMutations,
              options.islandSignalScope,
              options.onAppliedQueries
                ? {
                    onAppliedQueries: options.onAppliedQueries,
                  }
                : {},
            )
          ) {
            return;
          }
          await dispatchDelegatedEvent(event, options.importModule, options.islandSignalScope);
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

  // SPEC.md §4.4: pointerenter/pointerleave have no capture phase at ancestors, so
  // delegation synthesizes them from the bubbling pointerover/pointerout pair, firing
  // only when the pointer crosses the on:* element's boundary (relatedTarget outside it).
  for (const [overType, enterType] of [
    ['pointerover', 'pointerenter'],
    ['pointerout', 'pointerleave'],
  ] as const) {
    addLoaderListener(
      options.root,
      overType,
      (event) => {
        const crossing = event as DelegatedEvent & { relatedTarget?: PointerCrossingNode | null };
        const element = crossing.target?.closest?.(`[on\\:${enterType}]`) as
          | PointerCrossingNode
          | null
          | undefined;
        if (!element || element.contains?.(crossing.relatedTarget ?? null) === true) return;
        void dispatchDelegatedEvent(
          { target: element, type: enterType },
          options.importModule,
          options.islandSignalScope,
        ).catch((error) => {
          reportRuntimeContextError(options.onError, error, { event, phase: 'delegated-event' });
        });
      },
      disposers,
      { capture: true },
    );
  }

  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}

interface PointerCrossingNode extends EventTargetLike {
  contains?: (node: PointerCrossingNode | null) => boolean;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export function installExecutionTriggers(
  options: ExecutionTriggerOptions,
  islandSignalScope: IslandSignalScope,
): () => void {
  if (!options.root.querySelectorAll) return () => undefined;

  // K5: track disposed state so a queued idle callback that fires after dispose()
  // cannot run the handler against a torn-down loader.
  let disposed = false;

  for (const element of options.root.querySelectorAll(
    '[on\\:load]',
  ) as Iterable<EventElementLike>) {
    dispatchExecutionTrigger({ target: element, type: 'load' }, options, islandSignalScope);
  }

  const requestIdle =
    options.requestIdle ??
    (typeof globalThis.requestIdleCallback === 'function'
      ? (callback: () => void) => {
          globalThis.requestIdleCallback(callback);
        }
      : (callback: () => void) => {
          setTimeout(callback, 0);
        });

  for (const element of options.root.querySelectorAll(
    '[on\\:idle]',
  ) as Iterable<EventElementLike>) {
    requestIdle(() => {
      // K5: guard against post-dispose idle callbacks.
      if (disposed) return;
      dispatchExecutionTrigger({ target: element, type: 'idle' }, options, islandSignalScope);
    });
  }

  const visibleElements = [
    ...(options.root.querySelectorAll('[on\\:visible]') as Iterable<EventElementLike>),
  ];

  // K5: always return a real disposer that flips the disposed flag so pending idle
  // callbacks are suppressed even when there are no visible elements.
  if (visibleElements.length === 0) {
    return () => {
      disposed = true;
    };
  }

  const createObserver =
    options.visibleObserver ??
    (typeof globalThis.IntersectionObserver === 'function'
      ? (callback: (entries: readonly VisibleObserverEntry[]) => void) =>
          new globalThis.IntersectionObserver((entries) => {
            callback(
              entries.map((entry) => ({
                isIntersecting: entry.isIntersecting,
                target: entry.target as unknown as EventElementLike,
              })),
            );
          }) as unknown as VisibleObserver
      : undefined);
  if (!createObserver) return () => undefined;

  const seen = new Set<EventElementLike>();
  const observer = createObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || seen.has(entry.target)) continue;

      seen.add(entry.target);
      observer.unobserve(entry.target);
      dispatchExecutionTrigger(
        { target: entry.target, type: 'visible' },
        options,
        islandSignalScope,
      );
    }
  });

  for (const element of visibleElements) {
    observer.observe(element);
  }

  return () => {
    disposed = true;
    for (const element of new Set([...seen, ...visibleElements])) {
      observer.unobserve(element);
    }
  };
}

function dispatchExecutionTrigger(
  event: DelegatedEvent,
  options: ExecutionTriggerOptions,
  islandSignalScope: IslandSignalScope,
): void {
  void dispatchDelegatedEvent(event, options.importModule, islandSignalScope).catch((error) => {
    reportRuntimeContextError(options.onError, error, { event, phase: 'execution-trigger' });
  });
}
