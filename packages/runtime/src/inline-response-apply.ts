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
  dispatchQuery(query: Pick<ElementChunk, 'attrs' | 'content'>): void;
  findFragmentTarget(target: string): InlineResponseApplyTarget | null | undefined;
  readBody(body: string): InlineMutationResponseBodyChunks;
}

export interface ResponseFragmentApplyOptions<Target> {
  appendFragment(target: Target, html: string): void;
  findFragmentTarget(target: string): Target | null | undefined;
  replaceFragment(target: Target, html: string): void;
}

export function applyInlineMutationResponseBody(
  body: string,
  options: InlineMutationResponseApplyOptions,
): void {
  // SPEC.md §4.4/§9.1: the generated inline loader must apply parsed mutation
  // response chunks through this runtime-owned helper closure, not a forked
  // inline-only query/fragment apply path.
  applyInlineMutationResponseChunks(options.readBody(body), options);
}

function applyInlineMutationResponseChunks(
  chunks: InlineMutationResponseBodyChunks,
  options: InlineMutationResponseApplyOptions,
): void {
  chunks.queries.forEach((query) => options.dispatchQuery(query));
  chunks.fragments.forEach((fragment) =>
    applyResponseFragment(fragment, {
      appendFragment: appendInlineFragment,
      findFragmentTarget: (target) => options.findFragmentTarget(target),
      replaceFragment: replaceInlineFragment,
    }),
  );
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
