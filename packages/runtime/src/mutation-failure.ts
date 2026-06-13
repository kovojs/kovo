import type { JsonValue } from '@jiso/core';

import { parseJsonValue } from './json.js';
import { readElementChunks } from './wire-response-scanner.js';
import type { ElementChunk } from './wire-response-scanner.js';
import { readAttribute, unescapeHtml } from './wire-html.js';

export function parseMutationFailure(body: string): JsonValue {
  // SPEC.md §9.2: enhanced form failures travel as mutation wire HTML, so
  // quoted tag delimiters in attributes must follow the shared wire parser.
  const errorChunk = readElementChunks(body, 'fw-error')[0];
  if (errorChunk) return parseJsonOrUnknown(unescapeHtml(errorChunk.content));

  const outputFailure = parseFailureOutputChunks(readElementChunks(body, 'output'));
  if (outputFailure) return outputFailure;

  return parseJsonOrUnknown(body);
}

function parseJsonOrUnknown(raw: string): JsonValue {
  const parsed = parseJsonValue(raw);
  if (parsed.ok) return parsed.value;

  return { body: raw, code: 'unknown' };
}

function parseFailureOutputChunks(outputs: readonly ElementChunk[]): JsonValue | null {
  const fields: Record<string, string> = {};
  let declaredFailure: JsonValue | null = null;

  // SPEC.md §9.2: enhanced form failures are rendered as response-body HTML.
  // Keep all output classification on the shared wire element scanner, then
  // preserve the form contract that declared failures beat validation fields.
  for (const output of outputs) {
    const code = readAttribute(output.attrs, 'data-error-code');
    if (code && declaredFailure === null) {
      declaredFailure = {
        code,
        data: parseOutputPayload(output.content),
      };
    }

    const path = readAttribute(output.attrs, 'data-error-path');
    if (!path) continue;

    fields[path] = unescapeHtml(output.content).trim();
  }

  if (declaredFailure) return declaredFailure;
  return Object.keys(fields).length > 0 ? { code: 'VALIDATION', fields } : null;
}

function parseOutputPayload(content: string): JsonValue {
  const raw = unescapeHtml(content).trim();
  if (!raw) return {};

  const parsed = parseJsonValue(raw);
  return parsed.ok ? parsed.value : raw;
}
