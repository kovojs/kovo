export type BrowserTrustedHTML = { toString(): string };

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

export interface TrustedHtml {
  readonly __kovoTrustedHtml: true;
  readonly value: string | BrowserTrustedHTML;
}

export function trustedHtml(value: string | BrowserTrustedHTML): TrustedHtml {
  return { __kovoTrustedHtml: true, value };
}

export function kovoEscapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function kovoSafeUrl(value: unknown): string {
  const rendered = String(value ?? '');
  return hasUnsafeUrlScheme(rendered) ? '#' : rendered;
}

export function kovoBoundAttributeValue(name: string, value: unknown): string {
  const rendered = formatOutputValue(value);
  return isUrlAttributeName(name) ? kovoSafeUrl(rendered) : rendered;
}

export function kovoStyleProperty(name: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';

  const propertyName = normalizeCssPropertyName(name);
  if (propertyName === 'view-transition-name') {
    return `view-transition-name: ${sanitizeCssIdentifier(String(value))}`;
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

const SAFE_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

function isUrlAttributeName(name: string): boolean {
  return URL_BOUND_ATTRIBUTES.has(name.toLowerCase());
}

function hasUnsafeUrlScheme(value: string): boolean {
  const normalized = value.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
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
