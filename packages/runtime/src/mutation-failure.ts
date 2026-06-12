import type { JsonValue } from '@jiso/core';

import { parseJsonValue } from './json.js';
import { readAttribute, tagClose, unescapeHtml } from './wire-parser.js';

export function parseMutationFailure(body: string): JsonValue {
  // SPEC.md §9.2: enhanced form failures travel as mutation wire HTML, so
  // quoted tag delimiters in attributes must follow the shared wire parser.
  const errorChunk = readFirstElementChunk(body, 'fw-error');
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

function readFirstElementChunk(
  body: string,
  tagName: string,
): { attrs: string; content: string } | null {
  return readElementChunks(body, tagName)[0] ?? null;
}

function readElementChunks(
  body: string,
  tagName: string,
): Array<{ attrs: string; content: string }> {
  const chunks: Array<{ attrs: string; content: string }> = [];
  const openingTag = new RegExp(`<${tagName}\\b`, 'gi');

  for (let match = openingTag.exec(body); match; match = openingTag.exec(body)) {
    const openingEnd = tagClose(body, match.index + match[0].length);
    if (openingEnd === undefined) break;

    const closingTag = new RegExp(`</${tagName}\\s*>`, 'gi');
    closingTag.lastIndex = openingEnd + 1;
    const close = closingTag.exec(body);
    if (!close) break;

    chunks.push({
      attrs: body.slice(match.index + match[0].length, openingEnd),
      content: body.slice(openingEnd + 1, close.index),
    });
    openingTag.lastIndex = closingTag.lastIndex;
  }

  return chunks;
}

function parseOutputPayload(content: string): JsonValue {
  const raw = unescapeHtml(content).trim();
  if (!raw) return {};

  const parsed = parseJsonValue(raw);
  return parsed.ok ? parsed.value : raw;
}
