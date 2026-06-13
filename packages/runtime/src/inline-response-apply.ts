import type { ElementChunk, InlineMutationResponseBodyChunks } from './wire-response-scanner.js';
import { applyResponseFragments } from './response-fragment-apply.js';

export interface InlineResponseFragmentApplyTarget {
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
  findFragmentTarget(target: string): InlineResponseFragmentApplyTarget | null | undefined;
}

export function applyInlineMutationResponseChunks(
  chunks: InlineMutationResponseBodyChunks,
  options: InlineMutationResponseApplyOptions,
): string[] {
  // SPEC.md §4.4/§9.1: the generated inline loader applies already-decoded
  // mutation response chunks through this runtime-owned helper closure, not a
  // forked inline-only query/fragment apply path.
  dispatchInlineMutationQueries(chunks.queries, options);
  return applyHtmlResponseFragments(chunks.fragments, (target) =>
    options.findFragmentTarget(target),
  );
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

function applyHtmlResponseFragments(
  fragments: InlineMutationResponseBodyChunks['fragments'],
  findFragmentTarget: (target: string) => InlineResponseFragmentApplyTarget | null | undefined,
): string[] {
  // SPEC.md §4.4/§9.1: the inline HTML adapter is private to the generated
  // bootstrap while target filtering still enters the shared fragment primitive.
  return applyResponseFragments(fragments, {
    appendFragment: appendHtmlResponseFragment,
    findFragmentTarget,
    replaceFragment: replaceHtmlResponseFragment,
  });
}

function appendHtmlResponseFragment(
  element: InlineResponseFragmentApplyTarget,
  html: string,
): void {
  element.insertAdjacentHTML('beforeend', html);
}

function replaceHtmlResponseFragment(
  element: InlineResponseFragmentApplyTarget,
  html: string,
): void {
  element.innerHTML = html;
}
