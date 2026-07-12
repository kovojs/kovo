import { assertKovoModuleRef, type KovoModuleRef } from '@kovojs/core/internal/module-ref';

import type { DelegatedEvent, EventElementLike } from './events.js';
import {
  createDelegatedHandlerContext,
  defaultIslandSignalScope,
  readElementStateHost,
  type ElementParamValue,
  type HandlerContext,
  type IslandSignalScope,
} from './handler-context.js';
import { applyStateBindings, supportsQueryBindings } from './query-bindings.js';
import { assertAllowedKovoDynamicImportRefForModule } from './dynamic-import-url.js';
import {
  securityArrayAppend,
  securityRegExpTest,
  securityStringSlice,
  securityWeakMap,
  securityWeakMapDelete,
  securityWeakMapGet,
  securityWeakMapSet,
} from './security-witness-intrinsics.js';

/** Runtime API used by Kovo applications and generated runtime integration. */
export type ImportHandlerModule = (url: string) => Promise<Record<string, unknown>>;

export type { ElementParamValue, HandlerContext, IslandSignalScope } from './handler-context.js';

/**
 * A client event handler: receives the DOM `event` and a typed island `HandlerContext`.
 */
export type ClientHandler<State = unknown, Params = Record<string, ElementParamValue>> = (
  event: Event,
  ctx: HandlerContext<State, Params>,
) => void | Promise<void>;

/**
 * Type a client event handler for an island. The handler receives the DOM event
 * and a `HandlerContext` exposing the island's typed `state` and element params.
 * The compiler links it to an `on:event` binding and loads its module on first
 * interaction (SPEC §4.3). Identity function at runtime; it exists for typing.
 *
 * @param fn - The handler implementation.
 * @returns The same handler, typed.
 * @example
 * import { handler } from '@kovojs/browser';
 *
 * type CounterState = { count: number };
 *
 * export const increment = handler<CounterState>((_event, ctx) => {
 *   ctx.state.count += 1;
 * });
 */
export function handler<State = unknown, Params = Record<string, ElementParamValue>>(
  fn: ClientHandler<State, Params>,
): ClientHandler<State, Params> {
  return fn;
}

const delegatedStateQueues = securityWeakMap<EventElementLike, Promise<void>>();

/**
 * Well-known global key (shared with `@kovojs/headless-ui`'s `scheduleDeferred`)
 * carrying the post-commit scheduler that is active for the duration of a
 * synchronous handler invocation.
 */
const POST_COMMIT_GLOBAL_KEY = '__kovo_postCommitSchedule';

type PostCommitScheduler = (callback: () => void) => void;

interface PostCommitGlobal {
  [POST_COMMIT_GLOBAL_KEY]?: PostCommitScheduler;
}

/**
 * Runs `run` with a post-commit scheduler published on the global so primitives
 * (e.g. menu focus via `scheduleDeferred`) enqueue deferred callbacks instead of
 * scheduling a bare `setTimeout(0)`. Callbacks are collected into `queue` and the
 * previous global hook is restored afterwards so nested/concurrent dispatches do
 * not leak into each other. See SPEC §4.3/§4.8 and the focus-race fix.
 */
function withPostCommitQueue<T>(queue: Array<() => void>, run: () => T): T {
  const globalRecord = globalThis as PostCommitGlobal;
  const previous = globalRecord[POST_COMMIT_GLOBAL_KEY];
  globalRecord[POST_COMMIT_GLOBAL_KEY] = (callback) => {
    securityArrayAppend(queue, callback, 'Browser packages/browser/src/handlers.ts collection');
  };
  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete globalRecord[POST_COMMIT_GLOBAL_KEY];
    } else {
      globalRecord[POST_COMMIT_GLOBAL_KEY] = previous;
    }
  }
}

/**
 * Drains post-commit callbacks after state is committed and bindings are
 * flushed. A callback that throws must not prevent the rest from running.
 */
function drainPostCommitQueue(queue: ReadonlyArray<() => void>): void {
  for (let index = 0; index < queue.length; index += 1) {
    const callback = queue[index];
    if (callback === undefined) continue;
    try {
      callback();
    } catch {
      // Post-commit side effects (e.g. focus) are best-effort; do not let one
      // failure abort the dispatch or the remaining callbacks.
    }
  }
}

/** @internal Resolve and run the island handler bound to a delegated event (SPEC §4.4). */
export async function dispatchDelegatedEvent(
  event: DelegatedEvent,
  importModule: ImportHandlerModule,
  islandSignalScope: IslandSignalScope = defaultIslandSignalScope,
): Promise<void> {
  const element = event.target?.closest?.(`[on\\:${event.type}]`);
  if (!element) return;

  const stateHost = readElementStateHost(element) ?? element;
  const previous = securityWeakMapGet(delegatedStateQueues, stateHost) ?? Promise.resolve();
  const dispatch = previous
    .catch(() => undefined)
    .then(() =>
      dispatchDelegatedEventForElement(event, importModule, element, stateHost, islandSignalScope),
    );
  const queued = dispatch
    .catch(() => undefined)
    .finally(() => {
      if (securityWeakMapGet(delegatedStateQueues, stateHost) === queued) {
        securityWeakMapDelete(delegatedStateQueues, stateHost);
      }
    });
  securityWeakMapSet(delegatedStateQueues, stateHost, queued);

  await dispatch;
}

async function dispatchDelegatedEventForElement(
  event: DelegatedEvent,
  importModule: ImportHandlerModule,
  element: EventElementLike,
  stateHost: EventElementLike,
  islandSignalScope: IslandSignalScope,
): Promise<void> {
  const handlerContext = createDelegatedHandlerContext(element, stateHost, islandSignalScope);

  // Post-commit callbacks (e.g. deferred menu focus) registered by primitives
  // during handler execution. Drained AFTER state is committed and the update
  // plan is flushed so focus targets are revealed first; SPEC §4.3/§4.8.
  const postCommitQueue: Array<() => void> = [];

  try {
    const references = parseHandlerReferences(element.getAttribute(`on:${event.type}`));
    for (let index = 0; index < references.length; index += 1) {
      const reference = references[index];
      if (reference === undefined) continue;
      const { ref, source } = reference;
      assertAllowedKovoDynamicImportRefForModule(ref, importModule);
      const mod = await importModule(ref.url);
      const fn = mod[ref.exportName];

      if (typeof fn !== 'function') {
        throw new Error(`Handler export not found: ${source}`);
      }

      // Install the post-commit scheduler only around the handler's synchronous
      // call frame: primitives register deferred work synchronously, and a
      // synchronous-scoped hook avoids leaking into concurrent dispatches.
      const result = withPostCommitQueue(postCommitQueue, () =>
        (fn as ClientHandler)(event as Event, handlerContext.context),
      );
      await result;
    }
  } finally {
    handlerContext.commit();
    if (supportsQueryBindings(stateHost)) {
      await applyStateBindings(stateHost, handlerContext.context.state, { importModule });
    }
    drainPostCommitQueue(postCommitQueue);
  }
}

function parseHandlerReferences(
  refs: string | null,
): { ref: KovoModuleRef<'handler'>; source: string }[] {
  if (refs === null) return [];
  const parsed: { ref: KovoModuleRef<'handler'>; source: string }[] = [];
  let start = 0;
  for (let index = 0; index <= refs.length; index += 1) {
    if (index < refs.length && !securityRegExpTest(/\s/u, refs[index] ?? '')) continue;
    if (index > start) {
      const source = securityStringSlice(refs, start, index);
      securityArrayAppend(
        parsed,
        { ref: assertKovoModuleRef(source, 'handler'), source },
        'Browser packages/browser/src/handlers.ts collection',
      );
    }
    start = index + 1;
  }
  return parsed;
}
