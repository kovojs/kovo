import type { JsonValue } from './index.js';

/**
 * @internal
 * Clone JSON-shaped data through property access instead of `structuredClone`.
 * Optimistic drafts are proxy-backed, and the browser structured clone algorithm
 * rejects proxies with DataCloneError even when the value behind them is JSON.
 */
export function cloneJsonValue<Value extends JsonValue>(value: Value): Value {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item)) as Value;
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  const next: Record<string, JsonValue> = {};
  const record = value as Record<string, JsonValue>;
  for (const key of Object.keys(value)) {
    Object.defineProperty(next, key, {
      configurable: true,
      enumerable: true,
      value: cloneJsonValue(record[key] as JsonValue),
      writable: true,
    });
  }

  return next as Value;
}
