import {
  decideRuntimeAttributeWrite,
  drainRuntimeSinkSecurityEvent,
  runtimeSinkFamilyForAttribute,
} from '@kovojs/core/internal/sink-policy';

import {
  applySecurityIntrinsic,
  defineSecurityProperties,
  freezeSecurityValue,
  securityHasInstance,
  securityMap,
  securityMapGet,
  securityMapSet,
  securitySet,
  securitySetAdd,
  securitySetHas,
  securityString,
  securityWeakMap,
  securityWeakMapGet,
  securityWeakMapHas,
  securityWeakMapSet,
  securityWeakSet,
  securityWeakSetAdd,
  securityWeakSetHas,
} from './security-witness-intrinsics.js';
import { kovoCreateHTML } from './trusted-types.js';

/**
 * Optional provenance attached to explicit trust escape hatches.
 */
export interface TrustedOutputMetadata {
  readonly reason?: string;
  readonly source?: string;
}

/**
 * Metadata accepted by `trustedHtml(...)` and `trustedUrl(...)`: a shorthand reason string or a
 * structured provenance object.
 */
export type TrustedOutputMetadataInput = string | TrustedOutputMetadata;

/**
 * Conservative rich-HTML sanitizer options for CMS/user-authored HTML. This is a
 * runtime defense-in-depth floor, not a by-construction XSS proof (SPEC §6.6).
 */
export interface SafeRichHtmlOptions extends TrustedOutputMetadata {
  /**
   * Optional additional element names to admit. Attribute filtering and URL-sink
   * checks still apply.
   */
  readonly allowedTags?: readonly string[];
}

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

const trustedHtmlBrand: unique symbol = Symbol('kovo.security.trustedHtml');
const trustedUrlBrand: unique symbol = Symbol('kovo.security.trustedUrl');

/**
 * Kovo's explicit raw HTML escape-hatch wrapper.
 */
export interface TrustedHtml {
  readonly [trustedHtmlBrand]: true;
  readonly reason?: string;
  readonly source?: string;
  readonly value: string | BrowserTrustedHTML;
}

// SPEC §6.6 honesty boundary: private unique-symbol brands are author-time guardrails, not
// the security proof. Only objects minted by this owner module and recorded in the WeakSets are
// recognized by raw HTML / URL sinks.
const trustedHtmlValues = securityWeakSet<object>();
const trustedUrlValues = securityWeakSet<object>();
// SPEC §6.6 rule 5: the public carrier is only an ergonomic view. Raw sinks consume the exact
// bytes snapshotted when Kovo minted (or first accepted) the capability, never a later read from a
// mutable `.value` field or foreign TrustedHTML wrapper.
const trustedHtmlSnapshots = securityWeakMap<object, string>();
const trustedUrlSnapshots = securityWeakMap<object, string>();
const browserTrustedHtmlSnapshots = securityWeakMap<object, string>();

interface TrustedTypesBrandFactory {
  isHTML(value: unknown): boolean;
}

// Capture the platform brand owners before evaluated app code can replace them. A late ambient
// `globalThis.TrustedHTML` class is never authority for a raw HTML sink. Requiring the platform
// factory's brand predicate as well as captured ordinary Function@@hasInstance also rejects the
// common Node/polyfill forgery where an app merely installs a lookalike constructor.
const importTimeTrustedHtmlConstructor = (globalThis as { TrustedHTML?: unknown }).TrustedHTML;
const importTimeTrustedTypesFactory = (
  globalThis as { trustedTypes?: Partial<TrustedTypesBrandFactory> }
).trustedTypes;
const importTimeTrustedTypesIsHtml = importTimeTrustedTypesFactory?.isHTML;

/**
 * Marks intentional raw HTML for Kovo sinks that require an explicit escape hatch.
 */
export function trustedHtml(
  value: string | BrowserTrustedHTML,
  metadata?: TrustedOutputMetadataInput,
): TrustedHtml {
  const snapshot = trustedHtmlValueContent(value);
  const trusted = {
    ...trustedOutputMetadata(metadata),
    value: snapshot,
  } as TrustedHtml;
  const stringify = () => snapshot;
  defineSecurityProperties(trusted, {
    [Symbol.toPrimitive]: { value: stringify },
    toString: { value: stringify },
  });
  securityWeakMapSet(trustedHtmlSnapshots, trusted, snapshot);
  securityWeakSetAdd(trustedHtmlValues, trusted);
  return freezeSecurityValue(trusted);
}

/**
 * Sanitizes legitimate CMS/rich-text HTML through Kovo's conservative allowlist,
 * then returns the existing explicit trusted-HTML brand. Browser calls also route
 * the sanitized string through Kovo's sole Trusted Types policy before it reaches a
 * DOM raw-HTML sink.
 *
 * This is a runtime-DiD sanitizer floor for rich text, not a by-construction XSS
 * elimination claim; app-authored raw strings still need the explicit
 * {@link trustedHtml} escape hatch.
 */
export function safeRichHtml(value: string, options?: SafeRichHtmlOptions): TrustedHtml {
  const sanitized = sanitizeRichHtml(value, options);
  return trustedHtml(
    kovoCreateHTML(sanitized) as unknown as string | BrowserTrustedHTML,
    options?.source === undefined
      ? { reason: options?.reason ?? 'safe rich HTML sanitizer floor' }
      : { reason: options.reason ?? 'safe rich HTML sanitizer floor', source: options.source },
  );
}

/**
 * Sanitizes a CMS/rich-text HTML fragment with a conservative element/attribute
 * allowlist and Kovo's existing URL/event/raw-sink runtime policy.
 */
export function sanitizeRichHtml(value: string, options?: SafeRichHtmlOptions): string {
  const allowedTags = securitySetOf(
    [...DEFAULT_RICH_HTML_TAGS, ...(options?.allowedTags ?? [])].map((tag) => tag.toLowerCase()),
  );
  return sanitizeRichHtmlFragment(value, allowedTags);
}

/**
 * Returns whether a value is a process-minted Kovo trusted-HTML brand. SPEC §4.8
 * KV236 / §6.6: checks the non-forgeable module-private witness, NOT any userland
 * property shape, so a wire/query-JSON object is never honored as author-vouched
 * raw HTML.
 */
export function isKovoTrustedHtml(value: unknown): value is TrustedHtml {
  return (
    typeof value === 'object' &&
    value !== null &&
    securityWeakSetHas(trustedHtmlValues, value) &&
    securityWeakMapHas(trustedHtmlSnapshots, value)
  );
}

/**
 * Kovo's explicit trusted-URL escape-hatch wrapper — the URL-scheme counterpart
 * of {@link TrustedHtml} (SPEC §4.8). Brands a URL the author vouches for so
 * URL-bearing sinks (`href`/`src`/`action`/…) emit it verbatim instead of
 * neutralizing it against the scheme allowlist.
 */
export interface TrustedUrl {
  readonly [trustedUrlBrand]: true;
  readonly reason?: string;
  readonly source?: string;
  readonly value: string;
}

/**
 * Marks an intentional, author-vouched URL for Kovo's URL-bearing sinks,
 * suppressing the `javascript:`/`data:` scheme neutralization that would
 * otherwise rewrite it to `#` (SPEC §4.8, KV236). The URL-scheme counterpart of
 * {@link trustedHtml}: you take responsibility for the URL's safety, and the
 * brand is visible in source and `kovo explain`.
 */
export function trustedUrl(value: string, metadata?: TrustedOutputMetadataInput): TrustedUrl {
  const snapshot = securityString(value);
  const trusted = { ...trustedOutputMetadata(metadata), value: snapshot } as TrustedUrl;
  securityWeakMapSet(trustedUrlSnapshots, trusted, snapshot);
  securityWeakSetAdd(trustedUrlValues, trusted);
  return freezeSecurityValue(trusted);
}

/**
 * Returns whether a value is a process-minted Kovo trusted-URL brand. SPEC §4.8
 * KV236 / §6.6: checks the non-forgeable module-private witness, NOT any userland
 * property shape, so a wire/query-JSON object is never honored as an
 * author-vouched URL.
 */
export function isKovoTrustedUrl(value: unknown): value is TrustedUrl {
  return (
    typeof value === 'object' &&
    value !== null &&
    securityWeakSetHas(trustedUrlValues, value) &&
    securityWeakMapHas(trustedUrlSnapshots, value)
  );
}

/**
 * Returns whether a value matches the browser TrustedHTML brand accepted by Kovo.
 */
export function isBrowserTrustedHtml(value: unknown): value is BrowserTrustedHTML {
  if (
    typeof importTimeTrustedHtmlConstructor !== 'function' ||
    typeof importTimeTrustedTypesIsHtml !== 'function' ||
    importTimeTrustedTypesFactory === undefined ||
    typeof value !== 'object' ||
    value === null
  ) {
    return false;
  }

  try {
    return (
      securityHasInstance(importTimeTrustedHtmlConstructor, value) &&
      applySecurityIntrinsic<boolean>(importTimeTrustedTypesIsHtml, importTimeTrustedTypesFactory, [
        value,
      ]) === true
    );
  } catch {
    return false;
  }
}

/**
 * Unwraps trusted raw HTML values and safely no-ops untrusted dynamic values.
 */
export function kovoTrustedHtmlContent(value: unknown): string {
  if (isKovoTrustedHtml(value)) return securityWeakMapGet(trustedHtmlSnapshots, value) ?? '';
  if (isBrowserTrustedHtml(value)) return snapshotBrowserTrustedHtml(value);

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
  if (isKovoTrustedUrl(value)) return securityWeakMapGet(trustedUrlSnapshots, value) ?? '#';
  const rendered = formatOutputValue(value);
  const decision = decideRuntimeAttributeWrite('href', rendered);
  drainRuntimeSinkSecurityEvent(decision.event);
  return decision.action === 'neutralize' ? (decision.value ?? '#') : rendered;
}

/**
 * Formats a generated bound attribute value with URL attributes sanitized.
 * Returns null when the attribute write must be suppressed entirely (on*, srcdoc).
 */
export function kovoBoundAttributeValue(name: string, value: unknown): string | null {
  // URL attributes route the RAW value through kovoSafeUrl so a `trustedUrl`
  // brand survives (formatting it first would stringify the wrapper object).
  if (runtimeSinkFamilyForAttribute(name) === 'url') return kovoSafeUrl(value);

  const rendered = formatOutputValue(value);
  const decision = decideRuntimeAttributeWrite(name, rendered);
  drainRuntimeSinkSecurityEvent(decision.event);
  return decision.action === 'remove' ? null : (decision.value ?? rendered);
}

/** Sets one dynamic DOM attribute through Kovo's safe attribute sink rules. */
export function kovoSetSafeAttribute(
  element: {
    removeAttribute?(name: string): void;
    setAttribute?(name: string, value: string): void;
  },
  name: string,
  value: unknown,
): void {
  const rendered = kovoBoundAttributeValue(name, value);
  if (rendered === null) {
    element.removeAttribute?.(name);
    return;
  }
  element.setAttribute?.(name, rendered);
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

  if (securitySetHas(SAFE_LENGTH_PROPERTIES, propertyName)) {
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
  return typeof value === 'string' ? value : securityString(value);
}

function snapshotBrowserTrustedHtml(value: BrowserTrustedHTML): string {
  const existing = securityWeakMapGet(browserTrustedHtmlSnapshots, value);
  if (existing !== undefined) return existing;
  const snapshot = securityString(value);
  securityWeakMapSet(browserTrustedHtmlSnapshots, value, snapshot);
  return snapshot;
}

function trustedOutputMetadata(
  metadata: TrustedOutputMetadataInput | undefined,
): TrustedOutputMetadata {
  if (metadata === undefined) return {};
  if (typeof metadata === 'string') return { reason: metadata };
  return {
    ...(metadata.reason === undefined ? {} : { reason: metadata.reason }),
    ...(metadata.source === undefined ? {} : { source: metadata.source }),
  };
}

const DEFAULT_RICH_HTML_TAGS = [
  'a',
  'abbr',
  'article',
  'b',
  'blockquote',
  'br',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'details',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'ins',
  'kbd',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
  'var',
] as const;

const RICH_HTML_DROP_SUBTREE_TAGS = securitySetOf([
  'base',
  'embed',
  'iframe',
  'link',
  'math',
  'meta',
  'noscript',
  'object',
  'script',
  'style',
  'svg',
  'template',
]);

const GLOBAL_RICH_HTML_ATTRIBUTES = securitySetOf([
  'aria-describedby',
  'aria-hidden',
  'aria-label',
  'aria-labelledby',
  'class',
  'dir',
  'id',
  'lang',
  'role',
  'title',
]);

const RICH_HTML_ATTRIBUTES_BY_TAG = securityMapOf<string, Set<string>>([
  ['a', securitySetOf(['href', 'rel', 'target'])],
  ['blockquote', securitySetOf(['cite'])],
  ['col', securitySetOf(['span'])],
  ['colgroup', securitySetOf(['span'])],
  ['img', securitySetOf(['alt', 'height', 'loading', 'src', 'srcset', 'width'])],
  ['q', securitySetOf(['cite'])],
  ['td', securitySetOf(['colspan', 'headers', 'rowspan'])],
  ['th', securitySetOf(['abbr', 'colspan', 'headers', 'rowspan', 'scope'])],
]);

const VOID_RICH_HTML_TAGS = securitySetOf(['br', 'col', 'hr', 'img']);

function sanitizeRichHtmlFragment(value: string, allowedTags: Set<string>): string {
  let html = '';
  let offset = 0;
  const stack: string[] = [];
  const droppedSubtrees: string[] = [];

  while (offset < value.length) {
    const tagStart = value.indexOf('<', offset);
    if (tagStart === -1) {
      html += escapeHtmlText(value.slice(offset));
      break;
    }

    if (droppedSubtrees.length === 0) {
      html += escapeHtmlText(value.slice(offset, tagStart));
    }

    if (value.startsWith('<!--', tagStart)) {
      const commentEnd = value.indexOf('-->', tagStart + 4);
      offset = commentEnd === -1 ? value.length : commentEnd + 3;
      continue;
    }

    const token = readHtmlTagToken(value, tagStart);
    if (token === null) {
      html += '&lt;';
      offset = tagStart + 1;
      continue;
    }
    offset = token.end;

    if (droppedSubtrees.length > 0) {
      if (token.closing && token.name === droppedSubtrees[droppedSubtrees.length - 1]) {
        droppedSubtrees.pop();
      } else if (!token.closing && securitySetHas(RICH_HTML_DROP_SUBTREE_TAGS, token.name)) {
        droppedSubtrees.push(token.name);
      }
      continue;
    }

    if (securitySetHas(RICH_HTML_DROP_SUBTREE_TAGS, token.name)) {
      if (!token.closing && !token.selfClosing) droppedSubtrees.push(token.name);
      continue;
    }

    if (!securitySetHas(allowedTags, token.name)) continue;

    if (token.closing) {
      const lastIndex = stack.lastIndexOf(token.name);
      if (lastIndex === -1) continue;
      for (let index = stack.length - 1; index >= lastIndex; index -= 1) {
        const tag = stack.pop();
        if (tag !== undefined) html += `</${tag}>`;
      }
      continue;
    }

    const attrs = sanitizeRichHtmlAttributes(token.name, token.attributes);
    html += `<${token.name}${attrs}>`;
    if (!token.selfClosing && !securitySetHas(VOID_RICH_HTML_TAGS, token.name)) {
      stack.push(token.name);
    }
  }

  while (stack.length > 0) {
    html += `</${stack.pop()}>`;
  }

  return html;
}

interface HtmlTagToken {
  readonly attributes: string;
  readonly closing: boolean;
  readonly end: number;
  readonly name: string;
  readonly selfClosing: boolean;
}

function readHtmlTagToken(value: string, start: number): HtmlTagToken | null {
  let offset = start + 1;
  let closing = false;
  if (value[offset] === '/') {
    closing = true;
    offset += 1;
  }

  while (isAsciiWhitespace(value[offset])) offset += 1;
  const nameStart = offset;
  while (/[A-Za-z0-9:-]/.test(value[offset] ?? '')) offset += 1;
  if (offset === nameStart) return null;

  const name = value.slice(nameStart, offset).toLowerCase();
  let quote: '"' | "'" | undefined;
  for (; offset < value.length; offset += 1) {
    const char = value[offset];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') {
      const rawInside = value.slice(nameStart + name.length, offset);
      if (containsLessThanOutsideQuotes(rawInside)) return null;
      return {
        attributes: closing ? '' : rawInside,
        closing,
        end: offset + 1,
        name,
        selfClosing: /\/\s*$/.test(rawInside),
      };
    }
  }

  return null;
}

function containsLessThanOutsideQuotes(value: string): boolean {
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '<') return true;
  }
  return false;
}

function sanitizeRichHtmlAttributes(tag: string, raw: string): string {
  const tagAttributes = securityMapGet(RICH_HTML_ATTRIBUTES_BY_TAG, tag);
  const attributes: string[] = [];
  const seen = securitySet<string>();
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw)) !== null) {
    const name = (match[1] ?? '').toLowerCase();
    if (!isAllowedRichHtmlAttribute(name, tagAttributes) || securitySetHas(seen, name)) continue;
    securitySetAdd(seen, name);

    const value = match[2] ?? match[3] ?? match[4] ?? '';
    const sanitized = sanitizeRichHtmlAttributeValue(tag, name, value);
    if (sanitized === null) continue;
    attributes.push(`${name}="${escapeHtmlAttribute(sanitized)}"`);
  }

  return attributes.length === 0 ? '' : ` ${attributes.join(' ')}`;
}

function isAllowedRichHtmlAttribute(name: string, tagAttributes: Set<string> | undefined): boolean {
  if (name.startsWith('data-')) return true;
  return (
    securitySetHas(GLOBAL_RICH_HTML_ATTRIBUTES, name) ||
    (tagAttributes !== undefined && securitySetHas(tagAttributes, name))
  );
}

function sanitizeRichHtmlAttributeValue(tag: string, name: string, value: string): string | null {
  const decision = decideRuntimeAttributeWrite(name, value);
  drainRuntimeSinkSecurityEvent(decision.event);
  if (decision.action === 'remove') return null;
  if (decision.action === 'neutralize') return decision.value ?? '';

  if (tag === 'a' && name === 'target') {
    return value === '_blank' || value === '_self' || value === '_parent' || value === '_top'
      ? value
      : null;
  }

  if (tag === 'a' && name === 'rel') {
    const rel = sanitizeRelList(value);
    return rel === '' ? null : rel;
  }

  return decision.value ?? value;
}

function sanitizeRelList(value: string): string {
  const allowed = securitySetOf(['nofollow', 'noopener', 'noreferrer']);
  return value
    .split(/\s+/)
    .map((part) => part.toLowerCase())
    .filter((part, index, parts) => securitySetHas(allowed, part) && parts.indexOf(part) === index)
    .join(' ');
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value).replace(/"/g, '&quot;');
}

function isAsciiWhitespace(value: string | undefined): boolean {
  return value === ' ' || value === '\n' || value === '\r' || value === '\t' || value === '\f';
}

function sanitizeCssIdentifier(value: string): string {
  const trimmed = value.trim();
  if (/^-?[_a-zA-Z][-_a-zA-Z0-9]*$/.test(trimmed)) return trimmed;

  return trimmed.replace(/[^-_a-zA-Z0-9]/g, '-').replace(/^-?[^_a-zA-Z]+/, 'kovo-');
}

const SAFE_LENGTH_PROPERTIES = securitySetOf([
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
  if (typeof value === 'number') return Number.isFinite(value) ? securityString(value) : null;

  const rendered = securityString(value).trim();
  if (/^-?(?:\d+|\d*\.\d+)(?:%|px|rem|em|vh|vw|vmin|vmax|ch|ex|lh|rlh)?$/.test(rendered)) {
    return rendered;
  }

  return null;
}

function sanitizeCssTransform(value: unknown): string | null {
  const rendered = securityString(value).trim();
  const match = /^translate(?:3d|X|Y)?\((.*)\)$/.exec(rendered);
  if (!match) return null;

  const parts = (match[1] ?? '').split(',').map((part) => part.trim());
  if (parts.length < 1 || parts.length > 3) return null;
  return parts.every((part) => sanitizeCssLengthPercentage(part) !== null) ? rendered : null;
}

function securitySetOf<T>(values: readonly T[]): Set<T> {
  const set = securitySet<T>();
  for (const value of values) securitySetAdd(set, value);
  return set;
}

function securityMapOf<K, V>(entries: readonly (readonly [K, V])[]): Map<K, V> {
  const map = securityMap<K, V>();
  for (const [key, value] of entries) securityMapSet(map, key, value);
  return map;
}
