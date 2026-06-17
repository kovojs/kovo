import { diagnosticDefinitions } from '@kovojs/core';
import type { EventDefinition, JsonValue } from '@kovojs/core';
import type {
  AttributeElementLike,
  AttributeWriterLike,
  ClosestElementLike,
  OptionalQuerySelectorAllRootLike,
} from './dom-like.js';
import { reportRuntimeContextError } from './error-policy.js';

/** @internal */
export interface DelegatedEvent {
  preventDefault?: () => void;
  submitter?: unknown;
  type: string;
  target: EventTargetLike | null;
}

/** @internal */
export interface EventTargetLike extends ClosestElementLike<EventElementLike> {}

/** @internal */
export interface EventElementLike
  extends
    AttributeElementLike,
    ClosestElementLike<EventElementLike>,
    OptionalQuerySelectorAllRootLike<UploadProgressElementLike> {}

/** @internal */
export interface UploadProgressElementLike extends AttributeWriterLike {
  setAttribute(name: string, value: string): void;
}

/** @internal */
export type EventPayloadMap<Definitions extends readonly EventDefinition<string, JsonValue>[]> = {
  [Definition in Definitions[number] as Definition['name']]: Definition extends EventDefinition<
    string,
    infer Payload
  >
    ? Payload
    : never;
};

/** @internal */
export interface TypedEvent<Name extends string = string, Payload = unknown> {
  name: Name;
  payload: Payload;
}

/** @internal */
export type EventListener<Payload> = (event: TypedEvent<string, Payload>) => void | Promise<void>;

/** @internal */
export interface EventSubscription {
  off(): void;
}

/** @internal */
export interface TypedEventBus<EventMap extends Record<string, unknown>> {
  emit<Name extends Extract<keyof EventMap, string>>(name: Name, payload: EventMap[Name]): void;
  events: readonly Extract<keyof EventMap, string>[];
  on<Name extends Extract<keyof EventMap, string>>(
    name: Name,
    listener: EventListener<EventMap[Name]>,
  ): EventSubscription;
}

/** @internal */
export interface EventBusOptions {
  onError?: (error: unknown, context: RuntimeErrorContext) => void;
  queryDataKeys?: readonly string[];
}

/** @internal */
export interface RuntimeErrorContext {
  event?: DelegatedEvent | TypedEvent<string, unknown>;
  phase:
    | 'delegated-event'
    | 'event-listener'
    | 'execution-trigger'
    | 'enhanced-mutation'
    | 'mutation-broadcast'
    | 'query-hydration';
}

/** @internal */
export function createEventBus<
  const Definitions extends readonly EventDefinition<string, JsonValue>[],
>(
  definitions: Definitions,
  options: EventBusOptions = {},
): TypedEventBus<EventPayloadMap<Definitions>> {
  const events = definitions.map((definition) => definition.name) as Extract<
    keyof EventPayloadMap<Definitions>,
    string
  >[];
  const allowed = new Set<string>(events);
  const queryDataKeys = new Set(options.queryDataKeys ?? []);
  const eventServerFactKeys = new Map(
    definitions.map((definition) => [definition.name, definition.serverFactKeys ?? []] as const),
  );
  const listeners = new Map<string, Set<EventListener<unknown>>>();

  return {
    emit(name, payload) {
      assertKnownEvent(allowed, name);
      assertPayloadDoesNotCarryQueryData(name, payload, eventServerFactKeys, queryDataKeys);

      const event = { name, payload };
      for (const listener of listeners.get(name) ?? []) {
        void Promise.resolve(listener(event)).catch((error) => {
          reportRuntimeContextError(options.onError, error, { event, phase: 'event-listener' });
        });
      }
    },
    events,
    on(name, listener) {
      assertKnownEvent(allowed, name);

      const existing = listeners.get(name) ?? new Set<EventListener<unknown>>();
      existing.add(listener as EventListener<unknown>);
      listeners.set(name, existing);

      return {
        off() {
          existing.delete(listener as EventListener<unknown>);
        },
      };
    },
  };
}

function assertKnownEvent(allowed: ReadonlySet<string>, name: string): void {
  if (!allowed.has(name)) {
    throw new Error(`Event is not declared in the registry: ${name}`);
  }
}

function assertPayloadDoesNotCarryQueryData(
  name: string,
  payload: unknown,
  eventServerFactKeys: ReadonlyMap<string, readonly string[]>,
  queryDataKeys: ReadonlySet<string>,
): void {
  if (queryDataKeys.size === 0) return;

  const declaredKeys = eventServerFactKeys.get(name) ?? [];
  const payloadKeys = typeof payload === 'object' && payload !== null ? Object.keys(payload) : [];
  const overlap = [...new Set([...declaredKeys, ...payloadKeys])].find((key) =>
    queryDataKeys.has(key),
  );
  if (!overlap) return;

  throw new Error(`${diagnosticDefinitions.KV320.message} event ${name} carries ${overlap}.`);
}
