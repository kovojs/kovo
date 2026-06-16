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

/** @internal */
export type ImportHandlerModule = (url: string) => Promise<Record<string, unknown>>;

export type { ElementParamValue, HandlerContext, IslandSignalScope } from './handler-context.js';

/**
 * A client event handler: receives the DOM `event` and a typed island `HandlerContext`.
 * @internal
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
 * import { handler } from '@kovojs/runtime';
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

const delegatedStateQueues = new WeakMap<EventElementLike, Promise<void>>();

/** @internal */
export async function dispatchDelegatedEvent(
  event: DelegatedEvent,
  importModule: ImportHandlerModule,
  islandSignalScope: IslandSignalScope = defaultIslandSignalScope,
): Promise<void> {
  const element = event.target?.closest?.(`[on\\:${event.type}]`);
  if (!element) return;

  const stateHost = readElementStateHost(element) ?? element;
  const previous = delegatedStateQueues.get(stateHost) ?? Promise.resolve();
  const dispatch = previous
    .catch(() => undefined)
    .then(() =>
      dispatchDelegatedEventForElement(event, importModule, element, stateHost, islandSignalScope),
    );
  const queued = dispatch
    .catch(() => undefined)
    .finally(() => {
      if (delegatedStateQueues.get(stateHost) === queued) {
        delegatedStateQueues.delete(stateHost);
      }
    });
  delegatedStateQueues.set(stateHost, queued);

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

  try {
    for (const ref of parseHandlerReferences(element.getAttribute(`on:${event.type}`))) {
      const { exportName, url } = parseHandlerReference(ref);
      const mod = await importModule(url);
      const fn = mod[exportName];

      if (typeof fn !== 'function') {
        throw new Error(`Handler export not found: ${ref}`);
      }

      await (fn as ClientHandler)(event as Event, handlerContext.context);
    }
  } finally {
    handlerContext.commit();
    if (supportsQueryBindings(stateHost)) {
      await applyStateBindings(stateHost, handlerContext.context.state, { importModule });
    }
  }
}

function parseHandlerReferences(refs: string | null): string[] {
  return refs?.split(/\s+/).filter(Boolean) ?? [];
}

function parseHandlerReference(ref: string): { exportName: string; url: string } {
  const hashIndex = ref.lastIndexOf('#');
  if (hashIndex <= 0 || hashIndex === ref.length - 1) {
    throw new Error(`Invalid handler reference: ${ref}`);
  }

  return {
    exportName: ref.slice(hashIndex + 1),
    url: ref.slice(0, hashIndex),
  };
}
