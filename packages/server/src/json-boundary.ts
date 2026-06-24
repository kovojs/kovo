import type { JsonValue } from '@kovojs/core';

/**
 * A compile-time JSON boundary for named DTO types. `JsonValue` remains the runtime wire
 * vocabulary; this helper maps structurally JSON-compatible app interfaces into that vocabulary
 * while rejecting functions and common non-JSON objects before they reach client-bound sinks.
 */
export type JsonSerializable<Value = JsonValue> = unknown extends Value
  ? JsonValue
  : Value extends JsonValue
    ? Value
    : Value extends (...args: never[]) => unknown
      ? never
      : Value extends
            | Date
            | Map<unknown, unknown>
            | Set<unknown>
            | WeakMap<object, unknown>
            | WeakSet<object>
        ? never
        : Value extends readonly (infer Item)[]
          ? readonly JsonSerializable<Item>[]
          : Value extends object
            ? { [Key in keyof Value]: JsonSerializable<Value[Key]> }
            : never;
