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
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (Array.isArray(value)) return value.map((item) => escapeText(item)).join('');

  // Mirrors renderJsxChildren's `String(children)` coercion exactly (objects render as
  // "[object Object]"), so escaped text is byte-identical to the unescaped path for safe values.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return escapeHtml(String(value));
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
