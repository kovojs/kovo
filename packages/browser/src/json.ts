import type { JsonValue } from '@kovojs/core';
import { malformedWireJsonError, parseWireJsonValue } from '@kovojs/core/internal/wire-json';

export function parseJsonValue(
  raw: string,
): { ok: true; value: JsonValue } | { error: unknown; ok: false } {
  const parsed = parseWireJsonValue(raw);
  return parsed.ok ? { ok: true, value: parsed.value as JsonValue } : parsed;
}

export function malformedJsonError(context: string, cause: unknown): Error {
  return malformedWireJsonError(context, cause);
}
