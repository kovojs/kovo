import { fragmentHtml } from './html-fragment.js';

/**
 * A rendered-page assertion handle returned by the harness `page()` API: the
 * full `html`, plus `fragment(target)` to extract a named fragment (SPEC.md §9.1).
 */
export interface PageAssertion {
  fragment(target: string): string;
  html: string;
}

/** @internal Build a `PageAssertion` from rendered HTML; wrapped by the harness `page()` API. */
export function createPageAssertion(html: string): PageAssertion {
  return {
    fragment(target: string): string {
      return fragmentHtml(html, target);
    },
    html,
  };
}
