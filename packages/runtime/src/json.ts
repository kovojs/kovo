import type { JsonValue } from '@jiso/core';

export function parseJsonValue(
  raw: string,
): { ok: true; value: JsonValue } | { error: unknown; ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) as JsonValue };
  } catch (error) {
    return { error, ok: false };
  }
}

export function malformedJsonError(context: string, cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new Error(`Malformed JSON in ${context}: ${message}`, { cause });
}
