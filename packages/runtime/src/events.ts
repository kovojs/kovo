import { diagnosticDefinitions } from '@jiso/core';
import type { EventDefinition, JsonValue } from '@jiso/core';

export interface DelegatedEvent {
  preventDefault?: () => void;
  type: string;
  target: EventTargetLike | null;
}

export interface EventTargetLike {
  closest?: (selector: string) => EventElementLike | null;
}

export interface EventElementLike {
  closest?: (selector: string) => EventElementLike | null;
  getAttribute(name: string): string | null;
  querySelectorAll?: (selector: string) => Iterable<UploadProgressElementLike>;
  setAttribute?: (name: string, value: string) => void;
  attributes?: Iterable<{ name: string; value: string }>;
}

export interface UploadProgressElementLike {
  removeAttribute?: (name: string) => void;
  setAttribute(name: string, value: string): void;
}

export type EventPayloadMap<Definitions extends readonly EventDefinition<string, JsonValue>[]> = {
  [Definition in Definitions[number] as Definition['name']]: Definition extends EventDefinition<
    string,
    infer Payload
  >
    ? Payload
    : never;
};

export interface TypedEvent<Name extends string = string, Payload = unknown> {
  name: Name;
  payload: Payload;
}

export type EventListener<Payload> = (event: TypedEvent<string, Payload>) => void | Promise<void>;

export interface EventSubscription {
  off(): void;
}

export interface TypedEventBus<EventMap extends Record<string, unknown>> {
  emit<Name extends Extract<keyof EventMap, string>>(name: Name, payload: EventMap[Name]): void;
  events: readonly Extract<keyof EventMap, string>[];
  on<Name extends Extract<keyof EventMap, string>>(
    name: Name,
    listener: EventListener<EventMap[Name]>,
  ): EventSubscription;
}

export interface EventBusOptions {
  onError?: (error: unknown, context: RuntimeErrorContext) => void;
  queryDataKeys?: readonly string[];
}

export interface RuntimeErrorContext {
  event?: DelegatedEvent | TypedEvent<string, unknown>;
  phase:
    | 'delegated-event'
    | 'event-listener'
    | 'execution-trigger'
    | 'enhanced-mutation'
    | 'query-hydration';
}

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
          options.onError?.(error, { event, phase: 'event-listener' });
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

  throw new Error(`${diagnosticDefinitions.FW320.message} event ${name} carries ${overlap}.`);
}
