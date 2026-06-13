import { reportMalformedJson, reportRuntimeError } from './error-policy.js';
import type { RuntimeErrorReporter } from './error-policy.js';
import { parseJsonValue } from './json.js';

export interface FragmentChunk {
  html: string;
  mode?: 'append' | 'replace';
  target: string;
}

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

export interface InlineMutationResponseBodyChunks {
  fragments: FragmentChunk[];
  queries: ElementChunk[];
}

export interface MutationResponseElementChunks {
  fragments: ElementChunk[];
  queries: ElementChunk[];
}

export interface ReadMutationResponseElementChunksOptions {
  onMalformedFragment?: (reason: string) => void;
  onMalformedQuery?: (reason: string) => void;
}

export interface QueryScriptChunkLike {
  getAttribute(name: string): string | null;
  textContent: string | null;
}

export interface ElementChunk {
  attrs: string;
  content: string;
  end: number;
  start: number;
}

export interface ReadElementChunksOptions {
  nested?: boolean;
  onMalformed?: (reason: string) => void;
}

export function deferredStreamChunks(body: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  const chunks: string[] = [];
  let cursor = 0;

  while (true) {
    const markerStart = body.indexOf(marker, cursor);
    if (markerStart === -1) return chunks;

    const chunkStart = body.indexOf('\n', markerStart);
    if (chunkStart === -1) return chunks;
    if (body.startsWith(`${marker}--`, markerStart)) return chunks;

    const nextMarkerStart = body.indexOf(`\n${marker}`, chunkStart + 1);
    const chunk =
      nextMarkerStart === -1
        ? body.slice(chunkStart + 1)
        : body.slice(chunkStart + 1, nextMarkerStart);
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
    cursor = nextMarkerStart === -1 ? body.length : nextMarkerStart + 1;
  }
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

  return {
    ...(payload.key == null ? {} : { key: payload.key }),
    name: payload.name,
    value: parsed.value,
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

export function readInlineMutationResponseBodyChunks(
  body: string,
): InlineMutationResponseBodyChunks {
  // SPEC.md §4.4/§9.1: the inline bootstrap may defer fw-query JSON decoding
  // to the modular runtime, but fragment decoding still follows this canonical
  // response body projection instead of an inline-only apply parser.
  const chunks = readMutationResponseElementChunks(body);

  return {
    fragments: readFragmentChunksFromElements(chunks.fragments),
    queries: chunks.queries,
  };
}

export function readMutationResponseElementChunks(
  body: string,
  options: ReadMutationResponseElementChunksOptions = {},
): MutationResponseElementChunks {
  // SPEC.md §4.4/§9.1: inline and modular enhanced responses share the same
  // transport element scanner before their separate tiny/runtime apply steps.
  const queryOptions: ReadElementChunksOptions = options.onMalformedQuery
    ? { onMalformed: options.onMalformedQuery }
    : {};
  const fragmentOptions: ReadElementChunksOptions = options.onMalformedFragment
    ? { nested: true, onMalformed: options.onMalformedFragment }
    : { nested: true };

  return {
    queries: readElementChunks(body, 'fw-query', queryOptions),
    fragments: readElementChunks(body, 'fw-fragment', fragmentOptions),
  };
}

function malformedQueryError(reason: string): Error {
  return new Error(`Malformed fw-query chunk: ${reason}`);
}

export function readFragmentChunks(body: string, onError?: RuntimeErrorReporter): FragmentChunk[] {
  return readFragmentChunksFromElements(
    readElementChunks(body, 'fw-fragment', {
      nested: true,
      onMalformed(reason) {
        reportRuntimeError(onError, malformedFragmentError(reason));
      },
    }),
  );
}

function readFragmentElementChunk(
  chunk: Pick<ElementChunk, 'attrs' | 'content'>,
): FragmentChunk | undefined {
  const target = readAttribute(chunk.attrs, 'target');
  if (!target) return undefined;

  return {
    html: chunk.content,
    ...(readAttribute(chunk.attrs, 'mode') === 'append' ? { mode: 'append' } : {}),
    target,
  };
}

function readFragmentChunksFromElements(
  chunks: Iterable<Pick<ElementChunk, 'attrs' | 'content'>>,
): FragmentChunk[] {
  const fragments: FragmentChunk[] = [];

  for (const chunk of chunks) {
    const fragment = readFragmentElementChunk(chunk);
    if (fragment) fragments.push(fragment);
  }

  return fragments;
}

function malformedFragmentError(reason: string): Error {
  return new Error(`Malformed fw-fragment chunk: ${reason}`);
}

export function readElementChunks(
  body: string,
  tagName: string,
  options: ReadElementChunksOptions = {},
): ElementChunk[] {
  const chunks: ElementChunk[] = [];
  const tag = new RegExp('</?' + escapeRegExp(tagName) + '\\b', 'gi');
  let offset = 0;

  while (offset < body.length) {
    tag.lastIndex = offset;
    const match = tag.exec(body);
    if (!match) break;
    if (match[0].startsWith('</')) {
      offset = match.index + match[0].length;
      continue;
    }

    const openingEnd = tagClose(body, match.index + match[0].length);
    if (openingEnd === undefined) {
      options.onMalformed?.('missing opening tag close');
      break;
    }

    const end = matchingElementEnd(body, tagName, match.index, openingEnd, options.nested ?? false);
    if (!end) {
      options.onMalformed?.('missing closing tag');
      break;
    }

    chunks.push({
      attrs: body.slice(match.index + match[0].length, openingEnd),
      content: body.slice(openingEnd + 1, end.closeStart),
      end: end.end,
      start: match.index,
    });
    offset = end.end;
  }

  return chunks;
}

function matchingElementEnd(
  body: string,
  tagName: string,
  start: number,
  openingEnd: number,
  nested: boolean,
): { closeStart: number; end: number } | null {
  if (!nested) {
    const closingTag = new RegExp('</' + escapeRegExp(tagName) + '\\s*>', 'gi');
    closingTag.lastIndex = openingEnd + 1;
    const match = closingTag.exec(body);
    return match ? { closeStart: match.index, end: match.index + match[0].length } : null;
  }

  const elementTag = new RegExp('</?' + escapeRegExp(tagName) + '\\b', 'gi');
  elementTag.lastIndex = start;
  let depth = 0;

  for (let match = elementTag.exec(body); match; match = elementTag.exec(body)) {
    const close = tagClose(body, match.index + match[0].length);
    if (close === undefined) return null;

    if (match[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return { closeStart: match.index, end: close + 1 };
    } else if (!/\/\s*>$/.test(body.slice(match.index, close + 1))) {
      depth += 1;
    }

    elementTag.lastIndex = close + 1;
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function tagClose(source: string, start: number): number | undefined {
  let quote: '"' | "'" | undefined;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '>') return index;
  }

  return undefined;
}

export function readAttribute(attrs: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    '(?:^|\\s)' +
      escapedName +
      '(?=\\s|=|$|/)(?:\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'=<>\\x60]+)))?(?=\\s|$|/|>)',
    'i',
  );
  const match = pattern.exec(attrs);
  return unescapeHtml((match && (match[1] ?? match[2] ?? match[3])) || '') || null;
}

export function unescapeHtml(value: string): string {
  return value
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}
