/**
 * Shared safe-URL helper for `@kovojs/ui` anchor primitives and the headless
 * navigation-menu link attributes.
 *
 * Addresses SECURITY_FINDINGS.md H3: `escapeAttribute` (`@kovojs/server`
 * `packages/server/src/html.ts`) only neutralizes `& < > "` and does NOT strip
 * dangerous URL schemes, so a caller `href="javascript:..."` survives byte-for-
 * byte and executes on click. There was previously no safe-URL helper anywhere
 * in the foundation; this module is that single allowlist enforcement point.
 *
 * Policy (default-deny):
 *   - Relative paths (`/...`, `./`, `../`), fragments (`#...`), and query-only
 *     (`?...`) values are always allowed.
 *   - Absolute URLs are allowed only when their scheme is in the allowlist
 *     {http, https, mailto, tel}; everything else (`javascript:`, `data:`,
 *     `vbscript:`, `file:`, ...) is neutralized to `fallback`.
 *
 * Obfuscation handling: leading/trailing/embedded ASCII whitespace and control
 * chars are stripped before the scheme check, the scheme is lowercased, and a
 * control char in the scheme position (e.g. `java\tscript:`) or an HTML-entity-
 * encoded colon (e.g. `javascript&#58;...`) makes the value unsafe.
 */

const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

// A scheme per RFC 3986: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) followed by
// ":". Matched only AFTER whitespace/control chars are stripped.
const SCHEME_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

// ASCII space + C0/C1 control characters and DEL. Browsers strip these from
// URLs, so an attacker can hide a dangerous scheme behind them (e.g.
// `java\tscript:`); we strip them everywhere before the scheme determination
// so the de-obfuscated form is what we judge.
// eslint-disable-next-line no-control-regex
const STRIP_PATTERN = /[\u0000-\u0020\u007f-\u009f]+/g;

/**
 * Returns `value` when it is a safe URL per the allowlist policy above,
 * otherwise returns `fallback`. A nullish `value` returns `fallback`.
 */
export function safeUrl(value: string | undefined, fallback = '#'): string {
  if (value === undefined || value === null) return fallback;

  // Strip ALL leading/trailing/embedded ASCII whitespace and control chars for
  // the scheme determination. Stripping everywhere (not just the ends) defeats
  // `java\tscript:` and similar split-scheme obfuscation; the stripped form is
  // used only for the check, so the original `value` is what we return.
  const stripped = value.replace(STRIP_PATTERN, '');
  if (stripped === '') return fallback;

  // An HTML character reference that decodes to a colon (`&#58;`, `&#x3a;`,
  // `&colon;`, with optional leading zeros and a possibly-missing terminating
  // `;`) is not matched by SCHEME_PATTERN, yet the browser decodes it to the `:`
  // that forms a scheme (e.g. `javascript&#58;alert(1)`). bugz-3 L9 (this module
  // / SECURITY_FINDINGS H3): only treat `&` as an obfuscated scheme separator
  // when it begins such a colon reference in the *scheme position* — before the
  // first real `/` or `?` that starts a path/query. A bare `&` in a relative
  // first path segment (e.g. `AT&T/products`) or a query string is NOT an entity
  // reference and is kept verbatim (the previous check over-blocked it to `#`).
  const pathBoundary = stripped.search(/[/?]/);
  const schemePosition = pathBoundary < 0 ? stripped : stripped.slice(0, pathBoundary);
  if (/&(?:#0*58(?![0-9])|#[xX]0*3[aA](?![0-9a-fA-F])|colon);?/.test(schemePosition))
    return fallback;

  const schemeMatch = SCHEME_PATTERN.exec(stripped);
  if (schemeMatch === null) {
    // No scheme: relative path, fragment, or query-only value. Always allowed.
    return value;
  }

  const scheme = (schemeMatch[1] ?? '').toLowerCase();
  return ALLOWED_SCHEMES.has(scheme) ? value : fallback;
}
