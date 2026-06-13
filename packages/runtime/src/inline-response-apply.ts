import type { ElementChunk, InlineMutationResponseBodyChunks } from './wire-response-scanner.js';
import { applyResponseFragments } from './response-fragment-apply.js';

export interface InlineResponseApplyTarget {
  innerHTML: string;
  insertAdjacentHTML(position: 'beforeend', html: string): void;
}

export interface InlineQueryEventInit {
  detail: {
    queries: Pick<ElementChunk, 'attrs' | 'content'>[];
  };
}

export interface InlineMutationResponseApplyOptions {
  dispatchQueryEvent(type: 'jiso:query', init: InlineQueryEventInit): void;
  findFragmentTarget(target: string): InlineResponseApplyTarget | null | undefined;
}

export function applyInlineMutationResponseChunks(
  chunks: InlineMutationResponseBodyChunks,
  options: InlineMutationResponseApplyOptions,
): string[] {
  // SPEC.md §4.4/§9.1: the generated inline loader applies already-decoded
  // mutation response chunks through this runtime-owned helper closure, not a
  // forked inline-only query/fragment apply path.
  dispatchInlineMutationQueries(chunks.queries, options);
  return applyResponseFragments(chunks.fragments, {
    appendFragment: appendInlineFragment,
    findFragmentTarget: (target) => options.findFragmentTarget(target),
    replaceFragment: replaceInlineFragment,
  });
}

function dispatchInlineMutationQueries(
  queries: readonly Pick<ElementChunk, 'attrs' | 'content'>[],
  options: InlineMutationResponseApplyOptions,
): void {
  options.dispatchQueryEvent('jiso:query', {
    detail: {
      queries: queries.map((query) => ({ attrs: query.attrs, content: query.content })),
    },
  });
}

function appendInlineFragment(element: InlineResponseApplyTarget, html: string): void {
  element.insertAdjacentHTML('beforeend', html);
}

function replaceInlineFragment(element: InlineResponseApplyTarget, html: string): void {
  element.innerHTML = html;
}
