import type { ElementChunk, InlineMutationResponseBodyChunks } from './wire-response-scanner.js';
import { p, type HtmlResponseFragmentApplyTarget } from './response-fragment-apply.js';

export interface InlineQueryEventInit {
  detail: {
    queries: Pick<ElementChunk, 'attrs' | 'content'>[];
  };
}

export interface InlineMutationResponseApplyOptions {
  dispatchQueryEvent(type: 'kovo:query', init: InlineQueryEventInit): void;
  findFragmentTarget(target: string): HtmlResponseFragmentApplyTarget | null | undefined;
}

export function applyInlineMutationResponseChunks(
  chunks: InlineMutationResponseBodyChunks,
  options: InlineMutationResponseApplyOptions,
): string[] {
  // SPEC.md §4.4/§9.1: the generated inline loader applies already-decoded
  // mutation response chunks through this runtime-owned helper closure, not a
  // forked inline-only query/fragment apply path.
  options.dispatchQueryEvent('kovo:query', {
    detail: {
      queries: chunks.queries.map((query) => ({ attrs: query.attrs, content: query.content })),
    },
  });
  return p(chunks.fragments, (target) => options.findFragmentTarget(target));
}
