import { isKovoTrustedHtml, kovoTrustedHtmlContent } from '@kovojs/browser/generated';

import {
  browserHarnessRenderedHtmlContent,
  escapeText,
} from '../../examples/gallery/src/interactive-gallery.browser-jsx-runtime.js';

export { trustedHtml, trustedUrl } from '@kovojs/browser';

export function renderRouteHtml(value: unknown): string {
  const renderedHtml = browserHarnessRenderedHtmlContent(value);
  if (renderedHtml !== undefined) return renderedHtml;
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return `${value}`;
  if (isKovoTrustedHtml(value)) {
    return kovoTrustedHtmlContent(value);
  }

  return String(escapeText(JSON.stringify(value) ?? ''));
}
