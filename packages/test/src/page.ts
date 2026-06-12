import { fragmentHtml } from './html-fragment.js';

export interface PageAssertion {
  fragment(target: string): string;
  html: string;
}

export function createPageAssertion(html: string): PageAssertion {
  return {
    fragment(target: string): string {
      return fragmentHtml(html, target);
    },
    html,
  };
}
