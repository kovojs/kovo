import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import type { EventDefinition } from '@kovojs/core/internal/event';
import type { JsonValue } from '@kovojs/core';
import type {
  AttributeElementLike,
  AttributeWriterLike,
  ClosestElementLike,
  OptionalQuerySelectorAllRootLike,
} from './dom-like.js';
import { reportRuntimeContextError } from './error-policy.js';
import {
  freezeSecurityValue,
  securityArrayAppend,
  securityGetOwnPropertyDescriptor,
  securityMap,
  securityMapGet,
  securityMapSet,
  securityObjectKeys,
  securityOwnArrayEntry,
  securitySet,
  securitySetAdd,
  securitySetDelete,
  securitySetForEach,
  securitySetHas,
} from './security-witness-intrinsics.js';

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface DelegatedEvent {
  preventDefault?: () => void;
  submitter?: unknown;
  type: string;
  target: EventTargetLike | null;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface EventTargetLike extends ClosestElementLike<EventElementLike> {}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface EventElementLike
  extends
    AttributeElementLike,
    ClosestElementLike<EventElementLike>,
    OptionalQuerySelectorAllRootLike<UploadProgressElementLike> {}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface UploadProgressElementLike extends AttributeWriterLike {
  setAttribute(name: string, value: string): void;
}

/** @internal Map an `EventDefinition` tuple to its `{ name: payload }` event map (SPEC §4.3). */
export type EventPayloadMap<Definitions extends readonly EventDefinition<string, JsonValue>[]> = {
  [Definition in Definitions[number] as Definition['name']]: Definition extends EventDefinition<
    string,
    infer Payload
  >
    ? Payload
    : never;
};

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface TypedEvent<Name extends string = string, Payload = unknown> {
  name: Name;
  payload: Payload;
}

/** @internal A typed event-bus listener invoked with a {@link TypedEvent} (SPEC §4.3). */
export type EventListener<Payload> = (event: TypedEvent<string, Payload>) => void | Promise<void>;

/** @internal A handle returned by `on()` whose `off()` unsubscribes the listener (SPEC §4.3). */
export interface EventSubscription {
  off(): void;
}

/** @internal The typed cross-island event bus: `emit`/`on` over a declared event map (SPEC §4.3). */
export interface TypedEventBus<EventMap extends Record<string, unknown>> {
  emit<Name extends Extract<keyof EventMap, string>>(name: Name, payload: EventMap[Name]): void;
  events: readonly Extract<keyof EventMap, string>[];
  on<Name extends Extract<keyof EventMap, string>>(
    name: Name,
    listener: EventListener<EventMap[Name]>,
  ): EventSubscription;
}

/** @internal Options for {@link createEventBus}: an error hook and query-data guard keys (SPEC §4.3). */
export interface EventBusOptions {
  onError?: (error: unknown, context: RuntimeErrorContext) => void;
  queryDataKeys?: readonly string[];
}

/** Runtime API used by Kovo applications and generated runtime integration. */
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

/** @internal Build a typed cross-island event bus from declared `EventDefinition`s (SPEC §4.3). */
export function createEventBus<
  const Definitions extends readonly EventDefinition<string, JsonValue>[],
>(
  definitions: Definitions,
  options: EventBusOptions = {},
): TypedEventBus<EventPayloadMap<Definitions>> {
  // SPEC §4.3/§6.6: registry facts govern both allowed dispatch and the query-data
  // confidentiality guard. Snapshot exact dense own-data declarations before authored modules can
  // replace collection methods or mutate retained definition carriers.
  const events: string[] = [];
  const allowed = securitySet<string>();
  const eventServerFactKeys = securityMap<string, readonly string[]>();
  const definitionEntries = snapshotEventArrayEntries(
    definitions,
    'Kovo event registry definitions',
  );
  for (let index = 0; index < definitionEntries.length; index += 1) {
    const definitionEntry = securityOwnArrayEntry(definitionEntries, index);
    if (
      !definitionEntry.ok ||
      definitionEntry.value === null ||
      typeof definitionEntry.value !== 'object'
    ) {
      throw new TypeError('Kovo event registry definitions must be objects.');
    }
    const name = eventOwnData(definitionEntry.value, 'name', 'Kovo event definition name');
    if (typeof name !== 'string' || name === '') {
      throw new TypeError('Kovo event definition names must be non-empty strings.');
    }
    if (securitySetHas(allowed, name)) {
      throw new TypeError(`Kovo event registry contains duplicate name: ${name}.`);
    }
    const declaredKeys = snapshotEventStringArray(
      eventOwnData(definitionEntry.value, 'serverFactKeys', `Kovo event ${name} server fact keys`),
      `Kovo event ${name} server fact keys`,
    );
    securityArrayAppend(events, name, 'Browser event registry names');
    securitySetAdd(allowed, name);
    securityMapSet(eventServerFactKeys, name, freezeSecurityValue(declaredKeys));
  }
  const typedEvents = freezeSecurityValue(events) as Extract<
    keyof EventPayloadMap<Definitions>,
    string
  >[];
  const queryDataKeyEntries = snapshotEventStringArray(
    eventOwnData(options, 'queryDataKeys', 'Kovo event query-data keys'),
    'Kovo event query-data keys',
  );
  const queryDataKeys = securitySet<string>();
  for (let index = 0; index < queryDataKeyEntries.length; index += 1) {
    const entry = securityOwnArrayEntry(queryDataKeyEntries, index);
    if (entry.ok) securitySetAdd(queryDataKeys, entry.value);
  }
  const queryDataKeyCount = queryDataKeyEntries.length;
  const listeners = securityMap<string, Set<EventListener<unknown>>>();
  const onError = eventOwnData(options, 'onError', 'Kovo event error hook');
  if (onError !== undefined && typeof onError !== 'function') {
    throw new TypeError('Kovo event error hook must be a function.');
  }

  return {
    emit(name, payload) {
      assertKnownEvent(allowed, name);
      assertPayloadDoesNotCarryQueryData(
        name,
        payload,
        eventServerFactKeys,
        queryDataKeys,
        queryDataKeyCount,
      );

      const event = freezeSecurityValue({ name, payload });
      const listenerSnapshot: EventListener<unknown>[] = [];
      const registered = securityMapGet(listeners, name);
      if (registered) {
        securitySetForEach(registered, (listener) => {
          securityArrayAppend(listenerSnapshot, listener, 'Browser event listener snapshot');
        });
      }
      for (let index = 0; index < listenerSnapshot.length; index += 1) {
        const listener = securityOwnArrayEntry(listenerSnapshot, index);
        if (!listener.ok) continue;
        // Async-function continuation uses the realm's intrinsic Promise machinery, not mutable
        // global Promise.resolve/catch methods exposed to authored modules.
        void (async () => {
          try {
            await listener.value(event);
          } catch (error) {
            reportRuntimeContextError(
              onError as ((error: unknown, context: RuntimeErrorContext) => void) | undefined,
              error,
              { event, phase: 'event-listener' },
            );
          }
        })();
      }
    },
    events: typedEvents,
    on(name, listener) {
      assertKnownEvent(allowed, name);

      const existing = securityMapGet(listeners, name) ?? securitySet<EventListener<unknown>>();
      securitySetAdd(existing, listener as EventListener<unknown>);
      securityMapSet(listeners, name, existing);

      return {
        off() {
          securitySetDelete(existing, listener as EventListener<unknown>);
        },
      };
    },
  };
}

function assertKnownEvent(allowed: Set<string>, name: string): void {
  if (!securitySetHas(allowed, name)) {
    throw new Error(`Event is not declared in the registry: ${name}`);
  }
}

function assertPayloadDoesNotCarryQueryData(
  name: string,
  payload: unknown,
  eventServerFactKeys: Map<string, readonly string[]>,
  queryDataKeys: Set<string>,
  queryDataKeyCount: number,
): void {
  if (queryDataKeyCount === 0) return;

  const declaredKeys = securityMapGet(eventServerFactKeys, name) ?? [];
  const payloadKeys =
    typeof payload === 'object' && payload !== null ? securityObjectKeys(payload) : [];
  const overlap =
    firstQueryDataOverlap(declaredKeys, queryDataKeys) ??
    firstQueryDataOverlap(payloadKeys, queryDataKeys);
  if (!overlap) return;

  throw new Error(`${diagnosticDefinitions.KV320.message} event ${name} carries ${overlap}.`);
}

function firstQueryDataOverlap(
  keys: readonly string[],
  queryDataKeys: Set<string>,
): string | undefined {
  for (let index = 0; index < keys.length; index += 1) {
    const entry = securityOwnArrayEntry(keys, index);
    if (entry.ok && securitySetHas(queryDataKeys, entry.value)) return entry.value;
  }
  return undefined;
}

function eventOwnData(value: object, property: PropertyKey, label: string): unknown {
  const descriptor = securityGetOwnPropertyDescriptor(value, property);
  if (!descriptor) return undefined;
  if (!('value' in descriptor)) throw new TypeError(`${label} must be an own-data property.`);
  return descriptor.value;
}

function snapshotEventArrayEntries(value: object, label: string): unknown[] {
  const length = eventOwnData(value, 'length', `${label} length`);
  if (typeof length !== 'number' || length < 0 || length > 100_000 || length % 1 !== 0) {
    throw new TypeError(`${label} must be a bounded dense array.`);
  }
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const entry = securityOwnArrayEntry(value as readonly unknown[], index);
    if (!entry.ok) throw new TypeError(`${label} must be a bounded dense array.`);
    securityArrayAppend(snapshot, entry.value, label);
  }
  return snapshot;
}

function snapshotEventStringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (value === null || typeof value !== 'object') {
    throw new TypeError(`${label} must be a dense string array.`);
  }
  const entries = snapshotEventArrayEntries(value, label);
  const snapshot: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = securityOwnArrayEntry(entries, index);
    if (!entry.ok || typeof entry.value !== 'string') {
      throw new TypeError(`${label} must be a dense string array.`);
    }
    securityArrayAppend(snapshot, entry.value, label);
  }
  return snapshot;
}
