import { reportMalformedJson, reportRuntimeError } from './error-policy.js';
import type { RuntimeErrorReporter } from './error-policy.js';
import { parseJsonValue } from './json.js';
import {
  readAttribute,
  readElementChunks,
  readFragmentChunksFromElements,
  readMutationResponseElementChunks,
  unescapeHtml,
} from './wire-response-scanner.js';
import type { FragmentChunk } from './wire-response-scanner.js';

export interface QueryChunk {
  key?: string;
  name: string;
  value: unknown;
}

export interface QueryElementChunkLike {
  attrs: string;
  content: string;
}

export interface MutationResponseBodyChunks {
  fragments: FragmentChunk[];
  queries: QueryChunk[];
}

export interface QueryScriptChunkLike {
  getAttribute(name: string): string | null;
  textContent: string | null;
}

export function deferredStreamChunks(body: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  const chunks: string[] = [];
  let cursor = 0;

  while (true) {
    const markerStart = nextBoundaryMarker(body, marker, cursor);
    if (markerStart === -1) return chunks;

    if (body.startsWith(`${marker}--`, markerStart)) return chunks;

    const chunkStart = boundaryLineEnd(body, markerStart + marker.length);
    if (chunkStart === undefined) return chunks;

    const nextMarkerStart = nextBoundaryMarker(body, marker, chunkStart);
    const chunkEnd =
      nextMarkerStart === -1 ? body.length : trimBoundaryPrelude(body, nextMarkerStart);
    const chunk = body.slice(chunkStart, chunkEnd);
    let containsMutationResponseElement = false;
    const responseElements = readMutationResponseElementChunks(chunk, {
      onMalformedFragment() {
        containsMutationResponseElement = true;
      },
      onMalformedQuery() {
        containsMutationResponseElement = true;
      },
    });
    if (
      containsMutationResponseElement ||
      responseElements.queries.length > 0 ||
      responseElements.fragments.length > 0
    ) {
      chunks.push(chunk);
    }
    cursor = nextMarkerStart === -1 ? body.length : nextMarkerStart;
  }
}

function nextBoundaryMarker(body: string, marker: string, start: number): number {
  let cursor = start;

  while (cursor < body.length) {
    const markerStart = body.indexOf(marker, cursor);
    if (markerStart === -1) return -1;
    if (markerStart === 0 || body[markerStart - 1] === '\n') return markerStart;
    cursor = markerStart + marker.length;
  }

  return -1;
}

function boundaryLineEnd(body: string, start: number): number | undefined {
  if (body[start] === '\r' && body[start + 1] === '\n') return start + 2;
  if (body[start] === '\n') return start + 1;
  return undefined;
}

function trimBoundaryPrelude(body: string, markerStart: number): number {
  if (body[markerStart - 1] !== '\n') return markerStart;
  return body[markerStart - 2] === '\r' ? markerStart - 2 : markerStart - 1;
}

export function readQueryChunks(body: string, onError?: RuntimeErrorReporter): QueryChunk[] {
  const queries: QueryChunk[] = [];

  for (const chunk of readElementChunks(body, 'fw-query', {
    onMalformed(reason) {
      reportRuntimeError(onError, malformedQueryError(reason));
    },
  })) {
    const query = readQueryElementChunk(chunk, onError);
    if (query) queries.push(query);
  }

  return queries;
}

export function readQueryElementChunk(
  chunk: QueryElementChunkLike,
  onError?: RuntimeErrorReporter,
): QueryChunk | undefined {
  return readQueryChunkPayload(
    {
      content: chunk.content,
      decodeHtmlEntities: true,
      key: readAttribute(chunk.attrs, 'key'),
      name: readAttribute(chunk.attrs, 'name'),
    },
    onError,
  );
}

export function readQueryScriptChunks(
  scripts: Iterable<QueryScriptChunkLike>,
  onError?: RuntimeErrorReporter,
): QueryChunk[] {
  const queries: QueryChunk[] = [];

  for (const script of scripts) {
    const query = readQueryScriptChunk(script, onError);
    if (query) queries.push(query);
  }

  return queries;
}

export function readQueryScriptChunk(
  script: QueryScriptChunkLike,
  onError?: RuntimeErrorReporter,
): QueryChunk | undefined {
  const name = script.getAttribute('fw-query');
  if (!name) return undefined;

  return readQueryChunkPayload(
    {
      content: script.textContent ?? 'null',
      decodeHtmlEntities: false,
      key: script.getAttribute('key'),
      name,
    },
    onError,
  );
}

interface QueryChunkPayload {
  content: string;
  decodeHtmlEntities: boolean;
  key?: string | null;
  name: string | null;
}

function readQueryChunkPayload(
  payload: QueryChunkPayload,
  onError?: RuntimeErrorReporter,
): QueryChunk | undefined {
  if (!payload.name) return undefined;

  const parsed = parseJsonValue(
    payload.decodeHtmlEntities ? unescapeHtml(payload.content) : payload.content,
  );
  if (!parsed.ok) {
    reportMalformedJson(onError, `fw-query ${payload.name}`, parsed.error);
    return undefined;
  }

  const identity = readQueryChunkIdentity(payload.name, payload.key);
  return {
    ...(identity.key === undefined ? {} : { key: identity.key }),
    name: identity.name,
    value: parsed.value,
  };
}

function readQueryChunkIdentity(name: string, key?: string | null): { key?: string; name: string } {
  if (key != null) return { key, name };

  const separator = name.indexOf(':');
  if (separator <= 0 || separator === name.length - 1) return { name };

  // SPEC.md §9.4/§10.2: typed reads and hydration may carry the canonical
  // instance key directly as `name:key`, while the runtime store still applies
  // decoded chunks as `{ name, key }`.
  return {
    key: name.slice(separator + 1),
    name: name.slice(0, separator),
  };
}

export function readMutationResponseBodyChunks(
  body: string,
  onError?: RuntimeErrorReporter,
): MutationResponseBodyChunks {
  // SPEC.md §9.1: mutation responses carry fw-query truth and fw-fragment DOM
  // patches in one wire body, so runtime apply paths consume one decoded shape.
  const malformedFragments: string[] = [];
  const chunks = readMutationResponseElementChunks(body, {
    onMalformedFragment(reason) {
      malformedFragments.push(reason);
    },
    onMalformedQuery(reason) {
      reportRuntimeError(onError, malformedQueryError(reason));
    },
  });
  const queries: QueryChunk[] = [];

  for (const chunk of chunks.queries) {
    const query = readQueryElementChunk(chunk, onError);
    if (query) queries.push(query);
  }
  for (const reason of malformedFragments) {
    reportRuntimeError(onError, malformedFragmentError(reason));
  }

  return { fragments: readFragmentChunksFromElements(chunks.fragments), queries };
}

function malformedQueryError(reason: string): Error {
  return new Error(`Malformed fw-query chunk: ${reason}`);
}

function malformedFragmentError(reason: string): Error {
  return new Error(`Malformed fw-fragment chunk: ${reason}`);
}
