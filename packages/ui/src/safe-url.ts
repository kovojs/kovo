const safeUrlSchemes = new Set(['http', 'https', 'mailto', 'tel', 'ftp']);
const urlSchemePattern = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const htmlColonReferencePattern = /&(?:#0*58(?![0-9])|#[xX]0*3[aA](?![0-9a-fA-F])|colon);?/;
// eslint-disable-next-line no-control-regex
const urlSchemeStripPattern = /[\u0000-\u0020\u007f-\u009f]+/g;

/**
 * Browser-safe URL sink adapter for UI components.
 *
 * Keep this policy aligned with `@kovojs/core/internal/security-url`; UI modules
 * can be served as browser-visible source through the docs/gallery pipeline.
 */
export function safeUrl(value: string | null | undefined, fallback = '#'): string {
  if (value === undefined || value === null) return fallback;

  const normalized = normalizedUrlForSchemeCheck(value);
  if (normalized === '') return fallback;

  return hasUnsafeUrlScheme(value) ? fallback : value;
}

function hasUnsafeUrlScheme(value: string): boolean {
  const normalized = normalizedUrlForSchemeCheck(value);
  if (hasHtmlColonReferenceInSchemePosition(normalized)) return true;

  const match = urlSchemePattern.exec(normalized);
  if (!match) return false;

  return !safeUrlSchemes.has((match[1] ?? '').toLowerCase());
}

function normalizedUrlForSchemeCheck(value: string): string {
  return value.replace(urlSchemeStripPattern, '');
}

function hasHtmlColonReferenceInSchemePosition(value: string): boolean {
  const colonReference = htmlColonReferencePattern.exec(value);
  if (!colonReference) return false;

  const prefix = value.slice(0, colonReference.index);
  return /^[a-zA-Z][a-zA-Z0-9+.-]*$/.test(prefix);
}
