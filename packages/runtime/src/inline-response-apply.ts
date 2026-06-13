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
    applyInlineFragment(fragment, (target) => options.findFragmentTarget(target)),
  );
}

function applyInlineFragment(
  fragment: FragmentChunk,
  findFragmentTarget: InlineMutationResponseApplyOptions['findFragmentTarget'],
): void {
  const element = findFragmentTarget(fragment.target);
  if (!element) return;

  if (fragment.mode === 'append') {
    element.insertAdjacentHTML('beforeend', fragment.html);
  } else {
    element.innerHTML = fragment.html;
  }
}
