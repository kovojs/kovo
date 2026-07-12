import type { RenderedFragmentHtml } from '@kovojs/core/internal/sink-policy';

import { readAttribute } from './wire-html.js';
import { readWireElementTokens, type WireAttribute } from './wire-tokenizer.js';
import { securityArrayAppend } from './security-witness-intrinsics.js';

export interface FragmentChunk {
  html: RenderedFragmentHtml;
  // SPEC §9.3: append (END) and prepend (START, load-older) are the explicit
  // ordered-insert vocabularies; absent ⇒ replace (DOM-morph the target whole).
  mode?: 'append' | 'prepend' | 'replace';
  target: string;
}

export interface StreamTextChunk {
  mode?: 'append' | 'checkpoint';
  target: string;
  text: string;
}

export interface InlineMutationResponseBodyChunks {
  fragments: FragmentChunk[];
  queries: ElementChunk[];
  texts?: StreamTextChunk[];
}

export interface MutationResponseElementChunks {
  fragments: ElementChunk[];
  queries: ElementChunk[];
  texts: ElementChunk[];
}

export interface ReadMutationResponseElementChunksOptions {
  onMalformedFragment?: (reason: string) => void;
  onMalformedQuery?: (reason: string) => void;
  onMalformedText?: (reason: string) => void;
}

export interface ElementChunk {
  attributes?: readonly WireAttribute[];
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
  // as raw element chunks here so the always-loaded bootstrap can defer
  // kovo-query JSON decoding to the uncapped deferred runtime, while
  // wire-parser.ts JSON-decodes the same raw chunks itself.
  const chunks = readMutationResponseElementChunks(body, options);

  return {
    fragments: readFragmentChunksFromElements(chunks.fragments),
    queries: chunks.queries,
    ...(chunks.texts.length === 0 ? {} : { texts: readStreamTextChunksFromElements(chunks.texts) }),
  };
}

export function readInlineMutationResponseBodyChunks(
  body: string,
): InlineMutationResponseBodyChunks {
  // SPEC.md §4.4/§9.1: thin inline wrapper over the shared scan+fragment core.
  // The inline bootstrap intentionally returns kovo-query chunks UNDECODED and
  // defers JSON decode to the uncapped deferred runtime, keeping the
  // always-loaded bootstrap under the SPEC.md §4.4 gzip budget; wire-parser.ts
  // decodes the same chunks via readQueryElementChunk.
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
  const textOptions: ReadElementChunksOptions = options.onMalformedText
    ? { onMalformed: options.onMalformedText }
    : {};

  return {
    queries: readElementChunks(body, 'kovo-query', queryOptions),
    fragments: readElementChunks(body, 'kovo-fragment', fragmentOptions),
    texts: readElementChunks(body, 'kovo-text', textOptions),
  };
}

function readFragmentElementChunk(
  chunk: Pick<ElementChunk, 'attrs' | 'content'>,
): FragmentChunk | undefined {
  const target = readAttribute(chunk.attrs, 'target');
  if (!target) return undefined;

  // SPEC §9.3: carry only the explicit ordered-insert modes; any other value is
  // the default replace path.
  const mode = readAttribute(chunk.attrs, 'mode');
  return {
    html: createRenderedFragmentHtml(chunk.content),
    ...(mode === 'append' || mode === 'prepend' ? { mode: mode as 'append' | 'prepend' } : {}),
    target,
  };
}

export function readFragmentChunksFromElements(
  chunks: readonly Pick<ElementChunk, 'attrs' | 'content'>[],
): FragmentChunk[] {
  const fragments: FragmentChunk[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) continue;
    const fragment = readFragmentElementChunk(chunk);
    if (fragment)
      securityArrayAppend(
        fragments,
        fragment,
        'Browser packages/browser/src/wire-response-scanner.ts collection',
      );
  }

  return fragments;
}

function createRenderedFragmentHtml(html: string): RenderedFragmentHtml {
  // This dependency-free carrier exists only between the synchronous inline
  // scanner and DOM adapter. Do not dispatch through ambient Object.freeze:
  // a late replacement could rewrite `html` before the modular boundary mints
  // its private core witness (SPEC.md §6.6/§9.4).
  return {
    html,
    toJSON() {
      return html;
    },
    toString() {
      return html;
    },
  };
}

function readStreamTextElementChunk(
  chunk: Pick<ElementChunk, 'attrs' | 'content'>,
): StreamTextChunk | undefined {
  const target = readAttribute(chunk.attrs, 'target');
  if (!target) return undefined;

  const mode = readAttribute(chunk.attrs, 'mode');
  return {
    ...(mode === 'checkpoint' ? { mode: 'checkpoint' as const } : {}),
    target,
    text: chunk.content,
  };
}

export function readStreamTextChunksFromElements(
  chunks: readonly Pick<ElementChunk, 'attrs' | 'content'>[],
): StreamTextChunk[] {
  const texts: StreamTextChunk[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) continue;
    const text = readStreamTextElementChunk(chunk);
    if (text)
      securityArrayAppend(
        texts,
        text,
        'Browser packages/browser/src/wire-response-scanner.ts collection',
      );
  }

  return texts;
}

export function readElementChunks(
  body: string,
  tagName: string,
  options: ReadElementChunksOptions = {},
): ElementChunk[] {
  const chunks: ElementChunk[] = [];
  const tokens = readWireElementTokens(body, tagName, options);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    securityArrayAppend(
      chunks,
      {
        attrs: token.attrs,
        content: token.content,
        end: token.end,
        start: token.start,
      },
      'Browser packages/browser/src/wire-response-scanner.ts collection',
    );
  }

  return chunks;
}
