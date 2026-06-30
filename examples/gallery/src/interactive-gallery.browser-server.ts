export { trustedHtml, trustedUrl } from '@kovojs/browser';

export function renderRouteHtml(value: unknown): string {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return `${value}`;
  if (typeof value === 'object' && typeof (value as { html?: unknown }).html === 'string') {
    return (value as { html: string }).html;
  }

  return JSON.stringify(value) ?? '';
}
