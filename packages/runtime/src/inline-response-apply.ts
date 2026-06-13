import type { ElementChunk, InlineMutationResponseBodyChunks } from './wire-response-scanner.js';
import { applyResponseFragments } from './response-fragment-apply.js';

export interface InlineResponseApplyTarget {
  innerHTML: string;
  insertAdjacentHTML(position: 'beforeend', html: string): void;
}

export interface InlineMutationResponseApplyOptions {
  dispatchQueries(queries: readonly Pick<ElementChunk, 'attrs' | 'content'>[]): void;
  findFragmentTarget(target: string): InlineResponseApplyTarget | null | undefined;
}

export function applyInlineMutationResponseChunks(
  chunks: InlineMutationResponseBodyChunks,
  options: InlineMutationResponseApplyOptions,
): string[] {
  // SPEC.md §4.4/§9.1: the generated inline loader applies already-decoded
  // mutation response chunks through this runtime-owned helper closure, not a
  // forked inline-only query/fragment apply path.
  options.dispatchQueries(chunks.queries);
  return applyResponseFragments(chunks.fragments, {
    appendFragment: appendInlineFragment,
    findFragmentTarget: (target) => options.findFragmentTarget(target),
    replaceFragment: replaceInlineFragment,
  });
}

function appendInlineFragment(element: InlineResponseApplyTarget, html: string): void {
  element.insertAdjacentHTML('beforeend', html);
}

function replaceInlineFragment(element: InlineResponseApplyTarget, html: string): void {
  element.innerHTML = html;
}
