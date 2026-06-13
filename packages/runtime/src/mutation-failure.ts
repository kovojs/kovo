import type { JsonValue } from '@jiso/core';

import { parseJsonValue } from './json.js';
import { readAttribute, readElementChunks, unescapeHtml } from './wire-response-scanner.js';

export function parseMutationFailure(body: string): JsonValue {
  // SPEC.md §9.2: enhanced form failures travel as mutation wire HTML, so
  // quoted tag delimiters in attributes must follow the shared wire parser.
  const errorChunk = readElementChunks(body, 'fw-error')[0];
  if (errorChunk) return parseJsonOrUnknown(unescapeHtml(errorChunk.content));

  const declaredFailure = parseDeclaredFailureOutput(body);
  if (declaredFailure) return declaredFailure;

  const validationFailure = parseValidationFailureOutput(body);
  if (validationFailure) return validationFailure;

  return parseJsonOrUnknown(body);
}

function parseJsonOrUnknown(raw: string): JsonValue {
  const parsed = parseJsonValue(raw);
  if (parsed.ok) return parsed.value;

  return { body: raw, code: 'unknown' };
}

function parseDeclaredFailureOutput(body: string): JsonValue | null {
  for (const output of readElementChunks(body, 'output')) {
    const code = readAttribute(output.attrs, 'data-error-code');
    if (!code) continue;

    return {
      code,
      data: parseOutputPayload(output.content),
    };
  }

  return null;
}

function parseValidationFailureOutput(body: string): JsonValue | null {
  const fields: Record<string, string> = {};

  for (const output of readElementChunks(body, 'output')) {
    const path = readAttribute(output.attrs, 'data-error-path');
    if (!path) continue;

    fields[path] = unescapeHtml(output.content).trim();
  }

  return Object.keys(fields).length > 0 ? { code: 'VALIDATION', fields } : null;
}

function parseOutputPayload(content: string): JsonValue {
  const raw = unescapeHtml(content).trim();
  if (!raw) return {};

  const parsed = parseJsonValue(raw);
  return parsed.ok ? parsed.value : raw;
}
