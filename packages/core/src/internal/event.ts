import type { JsonValue } from '../json.js';

/**
 * @internal A typed event descriptor: its name, payload type, and
 * server-populated payload keys (SPEC §4.3). Repo-internal declaration family;
 * app authors do not construct these directly.
 */
export interface EventDefinition<Name extends string, Payload extends JsonValue = JsonValue> {
  name: Name;
  payload?: Payload;
  serverFactKeys?: readonly string[];
}

/** @internal Extract the payload type of an `EventDefinition`. */
export type EventPayload<Definition> =
  Definition extends EventDefinition<string, infer Payload> ? Payload : never;

/** @internal Options for `event()`: which payload keys the server is allowed to supply. */
export interface EventOptions<Payload extends JsonValue = JsonValue> {
  serverFactKeys?: readonly Extract<keyof Payload, string>[];
}

/**
 * @internal Declare a typed client event with a serializable payload. Handlers
 * dispatch and listen for events by this name; `serverFactKeys` marks payload
 * fields the server is allowed to populate (SPEC §4.3). Repo-internal helper.
 *
 * @param name - Event name used when dispatching and listening.
 * @param options - Optional `serverFactKeys` naming server-provided payload fields.
 * @returns An `EventDefinition` whose `payload` type is `Payload`.
 */
export function event<const Name extends string, Payload extends JsonValue = JsonValue>(
  name: Name,
  options: EventOptions<Payload> = {},
): EventDefinition<Name, Payload> {
  return {
    name,
    ...(options.serverFactKeys === undefined ? {} : { serverFactKeys: options.serverFactKeys }),
  };
}
