import {
  safeRichHtml as browserSafeRichHtml,
  type SafeRichHtmlOptions,
  type TrustedHtml,
} from '@kovojs/browser';

/**
 * Sanitizes CMS/rich-text HTML with Kovo's conservative runtime floor and returns
 * the explicit trusted-HTML brand accepted by server rendering sinks.
 *
 * The sanitizer is runtime defense-in-depth (SPEC §6.6): it parses and drops
 * executable markup, event handlers, `javascript:` URLs, and unsafe URL-bearing
 * attributes before branding. It is not a by-construction XSS elimination claim.
 */
export function safeRichHtml(value: string, options?: SafeRichHtmlOptions): TrustedHtml {
  return browserSafeRichHtml(value, options);
}

export type { SafeRichHtmlOptions };
