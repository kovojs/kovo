import type {
  ElementChunk,
  FragmentChunk,
  InlineMutationResponseBodyChunks,
} from './wire-parser.js';

export interface InlineResponseApplyTarget {
  innerHTML: string;
  insertAdjacentHTML(position: 'beforeend', html: string): void;
}

export interface InlineMutationResponseApplyOptions {
  dispatchQueries(queries: readonly Pick<ElementChunk, 'attrs' | 'content'>[]): void;
  findFragmentTarget(target: string): InlineResponseApplyTarget | null | undefined;
}

export interface ResponseFragmentApplyOptions<Target> {
  appendFragment(target: Target, html: string): void;
  findFragmentTarget(target: string): Target | null | undefined;
  replaceFragment(target: Target, html: string): void;
}

export function applyInlineMutationResponseChunks(
  chunks: InlineMutationResponseBodyChunks,
  options: InlineMutationResponseApplyOptions,
): string[] {
  // SPEC.md §4.4/§9.1: the generated inline loader applies already-decoded
  // mutation response chunks through this runtime-owned helper closure, not a
  // forked inline-only query/fragment apply path.
  options.dispatchQueries(chunks.queries);
  const appliedFragments: string[] = [];
  for (const fragment of chunks.fragments) {
    const wasApplied = applyResponseFragment(fragment, {
      appendFragment: appendInlineFragment,
      findFragmentTarget: (target) => options.findFragmentTarget(target),
      replaceFragment: replaceInlineFragment,
    });
    if (wasApplied) appliedFragments.push(fragment.target);
  }
  return appliedFragments;
}

export function applyResponseFragment<Target>(
  fragment: FragmentChunk,
  options: ResponseFragmentApplyOptions<Target>,
): boolean {
  const element = options.findFragmentTarget(fragment.target);
  if (!element) return false;

  if (fragment.mode === 'append') {
    options.appendFragment(element, fragment.html);
  } else {
    options.replaceFragment(element, fragment.html);
  }
  return true;
}

function appendInlineFragment(element: InlineResponseApplyTarget, html: string): void {
  element.insertAdjacentHTML('beforeend', html);
}

function replaceInlineFragment(element: InlineResponseApplyTarget, html: string): void {
  element.innerHTML = html;
}
