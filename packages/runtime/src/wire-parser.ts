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
    if (/<fw-(?:query|fragment)\b/.test(chunk)) {
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
    const name = readAttribute(chunk.attrs, 'name');
    if (!name) {
      continue;
    }

    const key = readAttribute(chunk.attrs, 'key') ?? undefined;
    const parsed = parseJsonValue(unescapeHtml(chunk.content));
    if (!parsed.ok) {
      reportMalformedJson(onError, `fw-query ${name}`, parsed.error);
      continue;
    }

    queries.push({
      ...(key === undefined ? {} : { key }),
      name,
      value: parsed.value,
    });
  }

  return queries;
}

export function readQueryScriptChunks(
  scripts: Iterable<QueryScriptChunkLike>,
  onError?: RuntimeErrorReporter,
): QueryChunk[] {
  const queries: QueryChunk[] = [];

  for (const script of scripts) {
    const name = script.getAttribute('fw-query');
    if (!name) continue;

    const key = script.getAttribute('key') ?? undefined;
    const parsed = parseJsonValue(script.textContent ?? 'null');
    if (!parsed.ok) {
      reportMalformedJson(onError, `fw-query ${name}`, parsed.error);
      continue;
    }

    queries.push({
      ...(key === undefined ? {} : { key }),
      name,
      value: parsed.value,
    });
  }

  return queries;
}

function malformedQueryError(reason: string): Error {
  return new Error(`Malformed fw-query chunk: ${reason}`);
}

export function readFragmentChunks(body: string, onError?: RuntimeErrorReporter): FragmentChunk[] {
  const fragments: FragmentChunk[] = [];

  for (const chunk of readElementChunks(body, 'fw-fragment', {
    nested: true,
    onMalformed(reason) {
      reportRuntimeError(onError, malformedFragmentError(reason));
    },
  })) {
    const target = readAttribute(chunk.attrs, 'target');
    if (!target) {
      continue;
    }

    fragments.push({
      html: chunk.content,
      ...(readAttribute(chunk.attrs, 'mode') === 'append' ? { mode: 'append' } : {}),
      target,
    });
  }

  return fragments;
}

export function malformedFragmentError(reason: string): Error {
  return new Error(`Malformed fw-fragment chunk: ${reason}`);
}

export function readElementChunks(
  body: string,
  tagName: string,
  options: ReadElementChunksOptions = {},
): ElementChunk[] {
  const chunks: ElementChunk[] = [];
  const tag = new RegExp(`</?${escapeRegExp(tagName)}\\b`, 'gi');
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
    const closingTag = new RegExp(`</${escapeRegExp(tagName)}\\s*>`, 'gi');
    closingTag.lastIndex = openingEnd + 1;
    const match = closingTag.exec(body);
    return match ? { closeStart: match.index, end: match.index + match[0].length } : null;
  }

  const elementTag = new RegExp(`</?${escapeRegExp(tagName)}\\b`, 'gi');
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
    `(?:^|\\s)${escapedName}(?=\\s|=|$|/)(?:\\s*=\\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\\s"'=<>\`]+)))?(?=\\s|$|/|>)`,
    'i',
  );
  const match = pattern.exec(attrs);
  return (
    unescapeHtml(match?.groups?.double ?? match?.groups?.single ?? match?.groups?.bare ?? '') ||
    null
  );
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
