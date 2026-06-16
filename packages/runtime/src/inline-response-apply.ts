import type { ElementChunk, InlineMutationResponseBodyChunks } from './wire-response-scanner.js';
import { p, type HtmlResponseFragmentApplyTarget } from './response-fragment-apply.js';

export interface InlineQueryEventInit {
  detail: {
    queries: Pick<ElementChunk, 'attrs' | 'content'>[];
  };
}

export interface InlineMutationResponseApplyOptions {
  findFragmentTarget(target: string): HtmlResponseFragmentApplyTarget | null | undefined;
}

export function applyInlineMutationResponseChunks(
  chunks: InlineMutationResponseBodyChunks,
  options: InlineMutationResponseApplyOptions,
): string[] {
  // SPEC.md §4.4/§9.1: the generated inline loader applies already-decoded
  // mutation response chunks through this runtime-owned fragment helper
  // closure, not a forked inline-only fragment apply path.
  return p(chunks.fragments, (target) => options.findFragmentTarget(target));
}
