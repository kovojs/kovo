import { malformedJsonError, parseJsonValue } from './json.js';

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

export function readQueryChunks(body: string, onError?: (error: unknown) => void): QueryChunk[] {
  const queries: QueryChunk[] = [];

  for (const match of body.matchAll(/<fw-query\b(?<attrs>[^>]*)>(?<json>[\s\S]*?)<\/fw-query>/g)) {
    const attrs = match.groups?.attrs ?? '';
    const name = readAttribute(attrs, 'name');
    if (!name) continue;
    const key = readAttribute(attrs, 'key') ?? undefined;

    const parsed = parseJsonValue(unescapeHtml(match.groups?.json ?? 'null'));
    if (!parsed.ok) {
      onError?.(malformedJsonError(`fw-query ${name}`, parsed.error));
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

export function readFragmentChunks(
  body: string,
  onError?: (error: unknown) => void,
): FragmentChunk[] {
  const fragments: FragmentChunk[] = [];
  const fragmentTag = /<\/?fw-fragment\b/gi;
  let offset = 0;

  while (offset < body.length) {
    fragmentTag.lastIndex = offset;
    const match = fragmentTag.exec(body);
    if (!match) break;
    if (match[0].startsWith('</')) {
      offset = match.index + match[0].length;
      continue;
    }

    const openingEnd = tagClose(body, match.index + match[0].length);
    if (openingEnd === undefined) {
      onError?.(malformedFragmentError('missing opening tag close'));
      break;
    }
    const end = matchingFragmentEnd(body, match.index);
    if (!end) {
      onError?.(malformedFragmentError('missing closing tag'));
      break;
    }

    const attrs = body.slice(match.index + match[0].length, openingEnd);
    const target = readAttribute(attrs, 'target');
    if (!target) {
      offset = end.end;
      continue;
    }

    fragments.push({
      html: body.slice(openingEnd + 1, end.closeStart),
      ...(readAttribute(attrs, 'mode') === 'append' ? { mode: 'append' } : {}),
      target,
    });
    offset = end.end;
  }

  return fragments;
}

export function malformedFragmentError(reason: string): Error {
  return new Error(`Malformed fw-fragment chunk: ${reason}`);
}

function matchingFragmentEnd(
  body: string,
  start: number,
): { closeStart: number; end: number } | null {
  const fragmentTag = /<\/?fw-fragment\b/gi;
  fragmentTag.lastIndex = start;
  let depth = 0;

  for (let match = fragmentTag.exec(body); match; match = fragmentTag.exec(body)) {
    const close = tagClose(body, match.index + match[0].length);
    if (close === undefined) return null;

    if (match[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return { closeStart: match.index, end: close + 1 };
    } else if (!/\/\s*>$/.test(body.slice(match.index, close + 1))) {
      depth += 1;
    }

    fragmentTag.lastIndex = close + 1;
  }

  return null;
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
