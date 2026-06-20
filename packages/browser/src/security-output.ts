/**
 * Browser Trusted Types `TrustedHTML` values accepted by Kovo raw HTML sinks.
 */
export interface BrowserTrustedHTML {
  readonly [Symbol.toStringTag]: 'TrustedHTML';
  toString(): string;
}

/**
 * Output contexts understood by Kovo generated rendering helpers.
 */
export type KovoOutputContext =
  | 'text'
  | 'attribute'
  | 'boolean-attribute'
  | 'url-attribute'
  | 'style-property'
  | 'css-text'
  | 'html-fragment'
  | 'script-text'
  | 'trusted-html';

/**
 * Kovo's explicit raw HTML escape-hatch wrapper.
 */
export interface TrustedHtml {
  readonly __kovoTrustedHtml: true;
  readonly value: string | BrowserTrustedHTML;
}

/**
 * Marks intentional raw HTML for Kovo sinks that require an explicit escape hatch.
 */
export function trustedHtml(value: string | BrowserTrustedHTML): TrustedHtml {
  return { __kovoTrustedHtml: true, value };
}

/**
 * Returns whether a value uses Kovo's explicit raw HTML wrapper.
 */
export function isKovoTrustedHtml(value: unknown): value is TrustedHtml {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __kovoTrustedHtml?: unknown }).__kovoTrustedHtml === true
  );
}

/**
 * Kovo's explicit trusted-URL escape-hatch wrapper — the URL-scheme counterpart
 * of {@link TrustedHtml} (SPEC §4.8). Brands a URL the author vouches for so
 * URL-bearing sinks (`href`/`src`/`action`/…) emit it verbatim instead of
 * neutralizing it against the scheme allowlist.
 */
export interface TrustedUrl {
  readonly __kovoTrustedUrl: true;
  readonly value: string;
}

/**
 * Marks an intentional, author-vouched URL for Kovo's URL-bearing sinks,
 * suppressing the `javascript:`/`data:` scheme neutralization that would
 * otherwise rewrite it to `#` (SPEC §4.8, KV236). The URL-scheme counterpart of
 * {@link trustedHtml}: you take responsibility for the URL's safety, and the
 * brand is visible in source and `kovo explain`.
 */
export function trustedUrl(value: string): TrustedUrl {
  return { __kovoTrustedUrl: true, value };
}

/**
 * Returns whether a value uses Kovo's explicit trusted-URL wrapper.
 */
export function isKovoTrustedUrl(value: unknown): value is TrustedUrl {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __kovoTrustedUrl?: unknown }).__kovoTrustedUrl === true
  );
}

/**
 * Returns whether a value matches the browser TrustedHTML brand accepted by Kovo.
 */
export function isBrowserTrustedHtml(value: unknown): value is BrowserTrustedHTML {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag] === 'TrustedHTML' &&
    typeof (value as { toString?: unknown }).toString === 'function'
  );
}

/**
 * Unwraps trusted raw HTML values and safely no-ops untrusted dynamic values.
 */
export function kovoTrustedHtmlContent(value: unknown): string {
  if (isKovoTrustedHtml(value)) return trustedHtmlValueContent(value.value);
  if (isBrowserTrustedHtml(value)) return value.toString();

  return '';
}

/**
 * Escapes text for generated HTML-fragment interpolation.
 */
export function kovoEscapeHtml(value: unknown): string {
  return formatOutputValue(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Neutralizes unsafe URL schemes for generated URL-bearing attributes.
 */
export function kovoSafeUrl(value: unknown): string {
  if (isKovoTrustedUrl(value)) return value.value;
  const rendered = formatOutputValue(value);
  return hasUnsafeUrlScheme(rendered) ? '#' : rendered;
}

/**
 * Formats a generated bound attribute value with URL attributes sanitized.
 * Returns null when the attribute write must be suppressed entirely (on*, srcdoc).
 */
export function kovoBoundAttributeValue(name: string, value: unknown): string | null {
  // KV236: refuse event-handler and srcdoc sinks at runtime regardless of value.
  if (/^on/i.test(name) || name.toLowerCase() === 'srcdoc') return null;
  // URL attributes route the RAW value through kovoSafeUrl so a `trustedUrl`
  // brand survives (formatting it first would stringify the wrapper object).
  if (isUrlAttributeName(name)) return kovoSafeUrl(value);
  return formatOutputValue(value);
}

/**
 * Sanitizes one compiler-generated CSS property declaration.
 */
export function kovoStyleProperty(name: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';

  const propertyName = normalizeCssPropertyName(name);
  if (propertyName === 'view-transition-name') {
    return `view-transition-name: ${sanitizeCssIdentifier(formatOutputValue(value))}`;
  }

  if (SAFE_LENGTH_PROPERTIES.has(propertyName)) {
    const rendered = sanitizeCssLengthPercentage(value);
    return rendered === null ? '' : `${propertyName}: ${rendered}`;
  }

  if (propertyName === 'transform') {
    const rendered = sanitizeCssTransform(value);
    return rendered === null ? '' : `${propertyName}: ${rendered}`;
  }

  return '';
}

export function kovoStyleProperties(properties: Record<string, unknown>): string {
  return Object.entries(properties)
    .map(([name, value]) => kovoStyleProperty(name, value))
    .filter(Boolean)
    .join('; ');
}

function formatOutputValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return '';
}

function trustedHtmlValueContent(value: string | BrowserTrustedHTML): string {
  return typeof value === 'string' ? value : value.toString();
}

const URL_BOUND_ATTRIBUTES = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'poster',
  'background',
  'cite',
  'data',
  'ping',
  'xlink:href',
]);

const SAFE_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'ftp']);

function isUrlAttributeName(name: string): boolean {
  return URL_BOUND_ATTRIBUTES.has(name.toLowerCase());
}

function hasUnsafeUrlScheme(value: string): boolean {
  const normalized = Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 0x20;
    })
    .join('')
    .toLowerCase();
  const match = /^([a-z][a-z0-9+.-]*):/.exec(normalized);
  if (!match) return false;

  return !SAFE_URL_SCHEMES.has(match[1] ?? '');
}

function sanitizeCssIdentifier(value: string): string {
  const trimmed = value.trim();
  if (/^-?[_a-zA-Z][-_a-zA-Z0-9]*$/.test(trimmed)) return trimmed;

  return trimmed.replace(/[^-_a-zA-Z0-9]/g, '-').replace(/^-?[^_a-zA-Z]+/, 'kovo-');
}

const SAFE_LENGTH_PROPERTIES = new Set([
  'bottom',
  'height',
  'left',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'right',
  'top',
  'width',
]);

function normalizeCssPropertyName(name: string): string {
  if (name.startsWith('--')) return name;
  return name.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`).toLowerCase();
}

function sanitizeCssLengthPercentage(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;

  const rendered = String(value).trim();
  if (/^-?(?:\d+|\d*\.\d+)(?:%|px|rem|em|vh|vw|vmin|vmax|ch|ex|lh|rlh)?$/.test(rendered)) {
    return rendered;
  }

  return null;
}

function sanitizeCssTransform(value: unknown): string | null {
  const rendered = String(value).trim();
  const match = /^translate(?:3d|X|Y)?\((.*)\)$/.exec(rendered);
  if (!match) return null;

  const parts = (match[1] ?? '').split(',').map((part) => part.trim());
  if (parts.length < 1 || parts.length > 3) return null;
  return parts.every((part) => sanitizeCssLengthPercentage(part) !== null) ? rendered : null;
}
