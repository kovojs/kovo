import { readAttribute, tagClose } from './wire-html.js';

export interface FragmentChunk {
  html: string;
  mode?: 'append' | 'replace';
  target: string;
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

export function readMutationResponseBodyCore(
  body: string,
  options: ReadMutationResponseElementChunksOptions = {},
): InlineMutationResponseBodyChunks {
  // SPEC.md §4.4/§9.1: the inline bootstrap and the modular runtime share this
  // single scan+fragment-decode skeleton; both project the wire body through the
  // canonical element scanner and the shared fragment decoder. Queries are kept
  // as raw element chunks here so the inline reader can defer kovo-query JSON
  // decoding to the modular runtime to stay under the SPEC.md §4.4 8KB gzip
  // budget, while wire-parser.ts JSON-decodes the same raw chunks itself.
  const chunks = readMutationResponseElementChunks(body, options);

  return {
    fragments: readFragmentChunksFromElements(chunks.fragments),
    queries: chunks.queries,
  };
}

export function readInlineMutationResponseBodyChunks(
  body: string,
): InlineMutationResponseBodyChunks {
  // SPEC.md §4.4/§9.1: thin inline wrapper over the shared scan+fragment core.
  // The inline bootstrap intentionally returns kovo-query chunks UNDECODED and
  // defers JSON decode to the modular runtime, keeping the always-loaded loader
  // under the SPEC.md §4.4 8KB gzip budget; wire-parser.ts decodes the same
  // chunks via readQueryElementChunk.
  return readMutationResponseBodyCore(body);
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
    queries: readElementChunks(body, 'kovo-query', queryOptions),
    fragments: readElementChunks(body, 'kovo-fragment', fragmentOptions),
  };
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

export function readFragmentChunksFromElements(
  chunks: Iterable<Pick<ElementChunk, 'attrs' | 'content'>>,
): FragmentChunk[] {
  const fragments: FragmentChunk[] = [];

  for (const chunk of chunks) {
    const fragment = readFragmentElementChunk(chunk);
    if (fragment) fragments.push(fragment);
  }

  return fragments;
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
