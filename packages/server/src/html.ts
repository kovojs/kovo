import { hasUnsafeUrlScheme, isUrlAttributeName } from '@kovojs/core/internal/security-url';
import { kovoTrustedHtmlContent } from '@kovojs/browser/internal/output';

/**
 * @internal HTML-coercion helper the compiler injects into emitted server modules
 * (SPEC.md §6.x rendering). Escapes `&`/`<`/`>` so interpolated app/DB strings cannot
 * inject markup. Exported only for compiler-emitted code and in-repo callers, not app
 * authors.
 */
export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * @internal HTML-coercion helper the compiler injects into emitted server modules
 * (SPEC.md §6.x rendering). Escapes attribute values (`escapeHtml` plus `"`). Exported
 * only for compiler-emitted code and in-repo callers, not app authors.
 */
export function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', '&quot;');
}

const kovoRenderedHtml = Symbol.for('kovo.renderedHtml');
const coercedRenderedHtmlPrefix = `\uE000kovo-rendered-html:${Math.random().toString(36).slice(2)}:`;
const coercedRenderedHtmlSuffix = '\uE001';
const coercedRenderedHtmlValues = new Map<string, string>();
let coercedRenderedHtmlId = 0;

/** @internal framework-rendered HTML, distinct from app-authored text strings. */
export type RenderedHtml = string & {
  readonly [kovoRenderedHtml]: true;
  readonly html: string;
  [Symbol.toPrimitive](): string;
  toJSON(): string;
  toString(): string;
};

/** @internal create a branded framework-rendered HTML value. */
export function renderedHtml(html: string): RenderedHtml {
  return {
    [kovoRenderedHtml]: true,
    html,
    [Symbol.toPrimitive](hint: string) {
      return hint === 'default' ? coerceRenderedHtml(html) : html;
    },
    toString() {
      return html;
    },
    toJSON() {
      return html;
    },
  } as unknown as RenderedHtml;
}

/** @internal true for values produced by the server JSX/runtime HTML renderer. */
export function isRenderedHtml(value: unknown): value is RenderedHtml {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<RenderedHtml>)[kovoRenderedHtml] === true &&
    typeof (value as { html?: unknown }).html === 'string'
  );
}

/**
 * @internal Default page/component value renderer. Unwraps framework-rendered HTML
 * and escapes app-authored scalar strings as text (SPEC.md §4.5, §5.2).
 */
export function renderHtmlValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (isRenderedHtml(value)) return value.html;
  if (typeof value === 'object') {
    const trustedHtml = kovoTrustedHtmlContent(value);
    if (trustedHtml !== '') return trustedHtml;
  }
  if (typeof value === 'string') return escapeTextWithRenderedHtml(value);
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return escapeText(value);
  }

  return escapeText(JSON.stringify(value) ?? '');
}

/** @internal escape text while preserving framework-rendered HTML coerced via `+`. */
export function escapeTextWithRenderedHtml(value: unknown): string {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (isRenderedHtml(value)) return coerceRenderedHtml(value.html);
  if (Array.isArray(value)) return value.map((item) => escapeTextWithRenderedHtml(item)).join('');

  // Mirrors renderJsxChildren's scalar coercion so escaped text stays byte-identical for safe values.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return renderStringWithCoercedRenderedHtml(String(value), escapeHtml);
}

/** @internal unwrap framework-rendered HTML coerced via `+`, leaving other text raw. */
export function unwrapCoercedRenderedHtml(value: string): string {
  return renderStringWithCoercedRenderedHtml(value, (text) => text);
}

function coerceRenderedHtml(html: string): string {
  const marker = `${coercedRenderedHtmlPrefix}${(coercedRenderedHtmlId += 1)}${coercedRenderedHtmlSuffix}`;
  coercedRenderedHtmlValues.set(marker, html);
  return marker;
}

function renderStringWithCoercedRenderedHtml(
  value: string,
  renderText: (text: string) => string,
): string {
  if (!value.includes(coercedRenderedHtmlPrefix)) return renderText(value);

  let html = '';
  let offset = 0;
  while (offset < value.length) {
    const markerStart = value.indexOf(coercedRenderedHtmlPrefix, offset);
    if (markerStart === -1) {
      html += renderText(value.slice(offset));
      break;
    }

    html += renderText(value.slice(offset, markerStart));
    const markerEnd = value.indexOf(coercedRenderedHtmlSuffix, markerStart);
    if (markerEnd === -1) {
      html += renderText(value.slice(markerStart));
      break;
    }

    const marker = value.slice(markerStart, markerEnd + coercedRenderedHtmlSuffix.length);
    const rendered = coercedRenderedHtmlValues.get(marker);
    html += rendered === undefined ? renderText(marker) : rendered;
    offset = markerEnd + coercedRenderedHtmlSuffix.length;
  }

  return html;
}

/**
 * @internal Sanitize and escape a URL-bearing attribute value for server HTML output
 * (SPEC.md §4.8 + §5.2#10). For URL-bearing attribute names (href, src, action,
 * formaction, poster, background, cite, data, ping, xlink:href) this returns `'#'`
 * when the value carries an unsafe scheme, otherwise the standard `escapeAttribute`
 * result. For all other attribute names it falls through to plain `escapeAttribute`.
 * Exported only for compiler-emitted code and in-repo callers, not app authors.
 */
export function safeUrlAttribute(name: string, value: string): string {
  if (isUrlAttributeName(name) && hasUnsafeUrlScheme(value)) {
    return '#';
  }
  return escapeAttribute(value);
}

/**
 * @internal part-4 L-i18n-meta-1: scheme-check a URL-bearing VALUE that is emitted into a
 * non-URL-named attribute (e.g. `<meta property="og:image" content="…">`). Returns `'#'`
 * for an unsafe scheme (javascript:/data:/etc), otherwise the value verbatim. The caller is
 * responsible for `escapeAttribute`-ing the result. SPEC.md §4.8 + §5.2#10 URL-sink allowlist.
 */
export function safeUrlValue(value: string): string {
  return hasUnsafeUrlScheme(value) ? '#' : value;
}

/**
 * @internal HTML-coercion helper the compiler injects into emitted server modules
 * (SPEC.md §6.x rendering). SECURITY (SECURITY_FINDINGS.md C1): safe coercion for an
 * interpolated text child. Mirrors the jsx runtime's renderJsxChildren coercion
 * (null/undefined/boolean render as '', arrays flatten) and HTML-escapes scalar values
 * so app/DB strings cannot inject markup. The compiler wraps data-path text
 * interpolations in this helper during lowering so generated components are
 * safe-by-default; it is a no-op for values without HTML metacharacters. Exported only
 * for compiler-emitted code, not app authors.
 */
export function escapeText(value: unknown): string {
  return escapeTextWithRenderedHtml(value);
}

/**
 * @internal HTML-coercion helper the compiler injects into emitted server modules
 * (SPEC.md §6.x rendering). Escapes `<` inside JSON embedded in inline `<script>` so a
 * payload string cannot terminate the script element early. Exported only for
 * compiler-emitted code and in-repo callers, not app authors.
 */
export function escapeScriptJson(value: string): string {
  return value.replaceAll('<', '\\u003c');
}
