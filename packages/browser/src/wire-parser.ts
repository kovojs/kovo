import { reportMalformedJson, reportRuntimeError } from './error-policy.js';
import type { RuntimeErrorReporter } from './error-policy.js';
import { parseJsonValue } from './json.js';
import {
  readElementChunks,
  readMutationResponseBodyCore,
  readMutationResponseElementChunks,
  readStreamTextChunksFromElements,
} from './wire-response-scanner.js';
import type { ElementChunk, FragmentChunk, StreamTextChunk } from './wire-response-scanner.js';
import { readAttribute, unescapeHtml } from './wire-html.js';

/**
 * One decoded query value from a wire response or inline script: its `name`,
 * optional instance `key`, and `value` (a full value, or a QueryDelta envelope
 * when `delta` is set) (SPEC §9.1.1, §9.4). Named by `QueryApplyInterposition`.
 */
export interface QueryChunk {
  /** When true, `value` is a QueryDelta envelope (SPEC §9.1.1), not a full value. */
  delta?: boolean;
  key?: string;
  name: string;
  /**
   * Settlement set (SPEC §9.1.1 line 828, §10.4 line 1118): the `Kovo-Idem` tokens of the
   * committed mutations whose effects this re-run truth already reflects. The client MUST drop
   * every pending optimistic transform whose token is in this set BEFORE re-applying the rest, so
   * an already-committed transform is never double-counted. Absent ⇒ settle only the triggering
   * token (legacy fallback).
   */
  settles?: readonly string[];
  value: unknown;
  /** Row/version token emitted by server reads for optimistic concurrency (Phase 6 TOCTOU). */
  version?: string;
}

/** The raw `{ attrs, content }` of a `<kovo-query>` element before decoding (SPEC §9.4). */
export interface QueryElementChunkLike {
  attrs: string;
  content: string;
}

export interface MutationResponseBodyChunks {
  fragments: FragmentChunk[];
  queries: QueryChunk[];
  texts?: StreamTextChunk[];
}

/** A `<kovo-query>` script chunk exposing `getAttribute`/`textContent` for hydration (SPEC §9.4). */
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
      onMalformedText() {
        containsMutationResponseElement = true;
      },
    });
    if (
      containsMutationResponseElement ||
      responseElements.queries.length > 0 ||
      responseElements.fragments.length > 0 ||
      responseElements.texts.length > 0
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

  for (const chunk of readElementChunks(body, 'kovo-query', {
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
  // SPEC §9.1.1: the boolean `delta` attribute (present = true, no value) marks
  // the body JSON as a QueryDelta envelope rather than a full query value.
  // readAttribute cannot distinguish absent from valueless (both return null);
  // use a dedicated presence check on the attrs string instead.
  return readQueryChunkPayload(
    {
      content: chunk.content,
      decodeHtmlEntities: true,
      delta: hasBooleanAttribute(chunk.attrs, 'delta'),
      key: readAttribute(chunk.attrs, 'key'),
      name: readAttribute(chunk.attrs, 'name'),
      settles: readAttribute(chunk.attrs, 'settles'),
      version: readAttribute(chunk.attrs, 'version'),
    },
    onError,
  );
}

/**
 * Test whether a boolean HTML attribute is present in an attrs string (presence
 * only — no value). Returns true when the attribute name appears, false when
 * absent. Does not distinguish valueless from valued; use `readAttribute` for
 * valued attributes.
 */
function hasBooleanAttribute(attrs: string, name: string): boolean {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:^|\\s)' + escapedName + '(?:\\s|=|$|/|>)', 'i').test(attrs);
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
  const name = script.getAttribute('kovo-query');
  if (!name) return undefined;

  return readQueryChunkPayload(
    {
      content: script.textContent ?? 'null',
      decodeHtmlEntities: false,
      key: script.getAttribute('key'),
      name,
      settles: script.getAttribute('settles'),
      version: script.getAttribute('version'),
    },
    onError,
  );
}

interface QueryChunkPayload {
  content: string;
  decodeHtmlEntities: boolean;
  delta?: boolean;
  key?: string | null;
  name: string | null;
  settles?: string | null;
  version?: string | null;
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
    reportMalformedJson(onError, `kovo-query ${payload.name}`, parsed.error);
    return undefined;
  }

  const identity = readQueryChunkIdentity(payload.name, payload.key);
  const settles = parseSettlementSet(payload.settles);
  return {
    ...(payload.delta ? { delta: true } : {}),
    ...(identity.key === undefined ? {} : { key: identity.key }),
    name: identity.name,
    ...(settles.length > 0 ? { settles } : {}),
    value: parsed.value,
    ...(payload.version === undefined || payload.version === null
      ? {}
      : { version: payload.version }),
  };
}

/**
 * Parse the `settles` attribute (SPEC §9.1.1): a space-separated list of `Kovo-Idem` tokens whose
 * committed effects this truth chunk already reflects. Returns `[]` when absent.
 */
function parseSettlementSet(settles?: string | null): string[] {
  if (!settles) return [];
  return settles
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
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
  // SPEC.md §9.1: mutation responses carry kovo-query truth and kovo-fragment DOM
  // patches in one wire body, so runtime apply paths consume one decoded shape.
  // SPEC.md §4.4/§9.1: the scan + fragment-decode skeleton is shared with the
  // inline bootstrap via readMutationResponseBodyCore; this modular reader keeps
  // raw kovo-query chunks (deferred by the inline loader for its 8KB gzip budget)
  // and JSON-decodes them here via readQueryElementChunk.
  //
  // Malformed-reporting ORDER is observable (see wire-parser.test.ts): kovo-query
  // errors are reported during decode below, then kovo-fragment errors after, so
  // fragment malformed reasons are buffered during the shared scan and replayed
  // only once the query decode loop has finished.
  const malformedFragments: string[] = [];
  const malformedTexts: string[] = [];
  const chunks = readMutationResponseBodyCore(body, {
    onMalformedFragment(reason) {
      malformedFragments.push(reason);
    },
    onMalformedQuery(reason) {
      reportRuntimeError(onError, malformedQueryError(reason));
    },
    onMalformedText(reason) {
      malformedTexts.push(reason);
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
  for (const reason of malformedTexts) {
    reportRuntimeError(onError, malformedTextError(reason));
  }

  return {
    fragments: chunks.fragments,
    queries,
    ...(chunks.texts === undefined ? {} : { texts: decodeStreamTextChunks(chunks.texts) }),
  };
}

export function readMutationResponseBodyPrefixChunks(
  body: string,
  onError?: RuntimeErrorReporter,
): { chunks: MutationResponseBodyChunks; consumed: number } {
  const elements = readMutationResponseElementChunks(body);
  const consumed = consumedElementEnd(elements.queries, elements.fragments, elements.texts);
  const queries: QueryChunk[] = [];

  for (const chunk of elements.queries) {
    const query = readQueryElementChunk(chunk, onError);
    if (query) queries.push(query);
  }

  return {
    chunks: {
      fragments: readMutationResponseBodyCore(body.slice(0, consumed)).fragments,
      queries,
      ...(elements.texts.length === 0
        ? {}
        : { texts: decodeStreamTextChunks(readStreamTextChunksFromElements(elements.texts)) }),
    },
    consumed,
  };
}

function consumedElementEnd(...groups: readonly ElementChunk[][]): number {
  let end = 0;
  for (const group of groups) {
    for (const chunk of group) {
      end = Math.max(end, chunk.end);
    }
  }
  return end;
}

function decodeStreamTextChunks(chunks: readonly StreamTextChunk[]): StreamTextChunk[] {
  return chunks.map((chunk) => ({
    ...chunk,
    text: unescapeHtml(chunk.text),
  }));
}

function malformedQueryError(reason: string): Error {
  return new Error(`Malformed kovo-query chunk: ${reason}`);
}

function malformedFragmentError(reason: string): Error {
  return new Error(`Malformed kovo-fragment chunk: ${reason}`);
}

function malformedTextError(reason: string): Error {
  return new Error(`Malformed kovo-text chunk: ${reason}`);
}
