import { createRenderedFragmentHtml } from '@kovojs/core/internal/sink-policy';

import { reportMalformedJson, reportRuntimeError } from './error-policy.js';
import type { RuntimeErrorReporter } from './error-policy.js';
import { parseJsonValue } from './json.js';
import {
  applySecurityIntrinsic,
  securityArrayAppend,
  securityGetOwnPropertyDescriptor,
  securityOwnArrayEntry,
  securityRegExpTest,
  securityStringIndexOf,
  securityStringSlice,
  securityStringStartsWith,
  securityStringTrim,
} from './security-witness-intrinsics.js';
import { readRuntimeElementAttribute, readRuntimeNodeTextContent } from './runtime-dom-security.js';
import {
  readElementChunks,
  readMutationResponseBodyCore,
  readMutationResponseElementChunks,
  readStreamTextChunksFromElements,
} from './wire-response-scanner.js';
import type { ElementChunk, FragmentChunk, StreamTextChunk } from './wire-response-scanner.js';
import { readAttribute, unescapeHtml } from './wire-html.js';
import { readWireElementAttribute, type WireAttribute } from './wire-tokenizer.js';

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
}

/** The raw `{ attrs, content }` of a `<kovo-query>` element before decoding (SPEC §9.4). */
export interface QueryElementChunkLike {
  attributes?: readonly WireAttribute[];
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

    if (securityStringStartsWith(body, `${marker}--`, markerStart)) return chunks;

    const chunkStart = boundaryLineEnd(body, markerStart + marker.length);
    if (chunkStart === undefined) return chunks;

    const nextMarkerStart = nextBoundaryMarker(body, marker, chunkStart);
    const chunkEnd =
      nextMarkerStart === -1 ? body.length : trimBoundaryPrelude(body, nextMarkerStart);
    const chunk = securityStringSlice(body, chunkStart, chunkEnd);
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
      securityArrayAppend(chunks, chunk, 'Browser packages/browser/src/wire-parser.ts collection');
    }
    cursor = nextMarkerStart === -1 ? body.length : nextMarkerStart;
  }
}

function nextBoundaryMarker(body: string, marker: string, start: number): number {
  let cursor = start;

  while (cursor < body.length) {
    const markerStart = securityStringIndexOf(body, marker, cursor);
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

  const chunks = readElementChunks(body, 'kovo-query', {
    onMalformed(reason) {
      reportRuntimeError(onError, malformedQueryError(reason));
    },
  });
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) continue;
    const query = readQueryElementChunk(chunk, onError);
    if (query)
      securityArrayAppend(queries, query, 'Browser packages/browser/src/wire-parser.ts collection');
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
      delta: readWireElementAttribute(chunk, 'delta').present,
      key: readAttribute(chunk.attrs, 'key'),
      name: readAttribute(chunk.attrs, 'name'),
      settles: readAttribute(chunk.attrs, 'settles'),
    },
    onError,
  );
}

export function readQueryScriptChunks(
  scripts: Iterable<QueryScriptChunkLike>,
  onError?: RuntimeErrorReporter,
): QueryChunk[] {
  const queries: QueryChunk[] = [];
  const snapshot = snapshotQueryScripts(scripts);
  for (let index = 0; index < snapshot.length; index += 1) {
    const entry = securityOwnArrayEntry(snapshot, index);
    if (!entry.ok) throw new TypeError('Kovo query script snapshot must be dense.');
    const script = entry.value;
    const query = readQueryScriptChunk(script, onError);
    if (query) securityArrayAppend(queries, query, 'Browser hydrated query chunks');
  }

  return queries;
}

export function readQueryScriptChunk(
  script: QueryScriptChunkLike,
  onError?: RuntimeErrorReporter,
): QueryChunk | undefined {
  const name = readRuntimeElementAttribute(script, 'kovo-query');
  if (!name) return undefined;

  return readQueryChunkPayload(
    {
      content: readRuntimeNodeTextContent(script) ?? 'null',
      decodeHtmlEntities: false,
      key: readRuntimeElementAttribute(script, 'key'),
      name,
      settles: readRuntimeElementAttribute(script, 'settles'),
    },
    onError,
  );
}

const QueryScriptArray = Array;
const queryScriptArrayIsArray = QueryScriptArray.isArray;
const MAX_QUERY_SCRIPTS = 100_000;

function snapshotQueryScripts(scripts: Iterable<QueryScriptChunkLike>): QueryScriptChunkLike[] {
  const snapshot: QueryScriptChunkLike[] = [];
  if (
    applySecurityIntrinsic<boolean>(queryScriptArrayIsArray, QueryScriptArray, [scripts]) === true
  ) {
    const length = securityGetOwnPropertyDescriptor(scripts, 'length');
    if (
      !length ||
      !('value' in length) ||
      typeof length.value !== 'number' ||
      length.value < 0 ||
      length.value % 1 !== 0 ||
      length.value > MAX_QUERY_SCRIPTS
    ) {
      throw new TypeError('Kovo query script collection is invalid or too large.');
    }
    for (let index = 0; index < length.value; index += 1) {
      const entry = securityOwnArrayEntry(scripts as readonly QueryScriptChunkLike[], index);
      if (!entry.ok) throw new TypeError('Kovo query script collection must be dense.');
      securityArrayAppend(snapshot, entry.value, 'Browser query script snapshot');
    }
    return snapshot;
  }
  for (const script of scripts) {
    if (snapshot.length >= MAX_QUERY_SCRIPTS) {
      throw new TypeError('Kovo query script collection is too large.');
    }
    securityArrayAppend(snapshot, script, 'Browser query script snapshot');
  }
  return snapshot;
}

interface QueryChunkPayload {
  content: string;
  decodeHtmlEntities: boolean;
  delta?: boolean;
  key?: string | null;
  name: string | null;
  settles?: string | null;
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
  };
}

/**
 * Parse the `settles` attribute (SPEC §9.1.1): a space-separated list of `Kovo-Idem` tokens whose
 * committed effects this truth chunk already reflects. Returns `[]` when absent.
 */
function parseSettlementSet(settles?: string | null): string[] {
  if (!settles) return [];
  const value = securityStringTrim(settles);
  const tokens: string[] = [];
  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    if (index < value.length && !securityRegExpTest(/\s/u, value[index] ?? '')) continue;
    if (index > start)
      securityArrayAppend(
        tokens,
        securityStringSlice(value, start, index),
        'Browser packages/browser/src/wire-parser.ts collection',
      );
    start = index + 1;
  }
  return tokens;
}

function readQueryChunkIdentity(name: string, key?: string | null): { key?: string; name: string } {
  if (key != null) return { key, name };

  const separator = securityStringIndexOf(name, ':');
  if (separator <= 0 || separator === name.length - 1) return { name };

  // SPEC.md §9.4/§10.2: typed reads and hydration may carry the canonical
  // instance key directly as `name:key`, while the runtime store still applies
  // decoded chunks as `{ name, key }`.
  return {
    key: securityStringSlice(name, separator + 1),
    name: securityStringSlice(name, 0, separator),
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
  // raw kovo-query chunks (deferred by the always-loaded bootstrap for its gzip
  // budget) and JSON-decodes them here via readQueryElementChunk.
  //
  // Malformed-reporting ORDER is observable (see wire-parser.test.ts): kovo-query
  // errors are reported during decode below, then kovo-fragment errors after, so
  // fragment malformed reasons are buffered during the shared scan and replayed
  // only once the query decode loop has finished.
  const malformedFragments: string[] = [];
  const malformedTexts: string[] = [];
  const chunks = readMutationResponseBodyCore(body, {
    onMalformedFragment(reason) {
      securityArrayAppend(
        malformedFragments,
        reason,
        'Browser packages/browser/src/wire-parser.ts collection',
      );
    },
    onMalformedQuery(reason) {
      reportRuntimeError(onError, malformedQueryError(reason));
    },
    onMalformedText(reason) {
      securityArrayAppend(
        malformedTexts,
        reason,
        'Browser packages/browser/src/wire-parser.ts collection',
      );
    },
  });
  const queries: QueryChunk[] = [];

  for (let index = 0; index < chunks.queries.length; index += 1) {
    const chunk = chunks.queries[index];
    if (!chunk) continue;
    const query = readQueryElementChunk(chunk, onError);
    if (query)
      securityArrayAppend(queries, query, 'Browser packages/browser/src/wire-parser.ts collection');
  }
  for (let index = 0; index < malformedFragments.length; index += 1) {
    const reason = malformedFragments[index];
    if (reason !== undefined) reportRuntimeError(onError, malformedFragmentError(reason));
  }
  for (let index = 0; index < malformedTexts.length; index += 1) {
    const reason = malformedTexts[index];
    if (reason !== undefined) reportRuntimeError(onError, malformedTextError(reason));
  }

  return {
    fragments: pinScannedFragmentChunks(chunks.fragments),
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

  for (let index = 0; index < elements.queries.length; index += 1) {
    const chunk = elements.queries[index];
    if (!chunk) continue;
    const query = readQueryElementChunk(chunk, onError);
    if (query)
      securityArrayAppend(queries, query, 'Browser packages/browser/src/wire-parser.ts collection');
  }

  return {
    chunks: {
      fragments: pinScannedFragmentChunks(
        readMutationResponseBodyCore(securityStringSlice(body, 0, consumed)).fragments,
      ),
      queries,
      ...(elements.texts.length === 0
        ? {}
        : { texts: decodeStreamTextChunks(readStreamTextChunksFromElements(elements.texts)) }),
    },
    consumed,
  };
}

function pinScannedFragmentChunks(chunks: readonly FragmentChunk[]): FragmentChunk[] {
  const pinned: FragmentChunk[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) continue;
    // The shared scanner must also be extractable into the dependency-free inline loader. At the
    // modular boundary, immediately convert its exact transport bytes into the private witnessed
    // carrier consumed by DOM sinks (SPEC §6.6 / bugz-26 H1).
    securityArrayAppend(
      pinned,
      {
        html: createRenderedFragmentHtml(chunk.html.html),
        ...(chunk.mode === undefined ? {} : { mode: chunk.mode }),
        target: chunk.target,
      },
      'Browser packages/browser/src/wire-parser.ts collection',
    );
  }
  return pinned;
}

function consumedElementEnd(...groups: readonly ElementChunk[][]): number {
  let end = 0;
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    if (!group) continue;
    for (let index = 0; index < group.length; index += 1) {
      const chunk = group[index];
      if (chunk && chunk.end > end) end = chunk.end;
    }
  }
  return end;
}

function decodeStreamTextChunks(chunks: readonly StreamTextChunk[]): StreamTextChunk[] {
  const decoded: StreamTextChunk[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) continue;
    securityArrayAppend(
      decoded,
      {
        ...(chunk.mode === undefined ? {} : { mode: chunk.mode }),
        target: chunk.target,
        text: unescapeHtml(chunk.text),
      },
      'Browser packages/browser/src/wire-parser.ts collection',
    );
  }
  return decoded;
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
