/**
 * @internal Shared URL sink facts for server render, browser runtime writes, and compiler
 * output-context classification (SPEC.md §4.8, §5.2 rule 10).
 */
export const URL_ATTRIBUTE_NAMES = [
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
] as const;

/** @internal URL schemes accepted by Kovo server/client URL sinks (SPEC.md §4.8). */
export const SAFE_URL_SCHEMES = ['http', 'https', 'mailto', 'tel', 'ftp'] as const;

const urlAttributeNames = new Set<string>(URL_ATTRIBUTE_NAMES);
const safeUrlSchemes = new Set<string>(SAFE_URL_SCHEMES);

/** @internal True when an HTML attribute is URL-bearing and needs scheme checks. */
export function isUrlAttributeName(name: string): boolean {
  return urlAttributeNames.has(name.toLowerCase());
}

/**
 * Returns true when the URL string carries an unsafe scheme. Strips control
 * characters <= U+0020 before extracting the scheme so `java\nscript:` is caught.
 */
export function hasUnsafeUrlScheme(value: string): boolean {
  const normalized = Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 0x20;
    })
    .join('')
    .toLowerCase();
  const match = /^([a-z][a-z0-9+.-]*):/.exec(normalized);
  if (!match) return false;

  return !safeUrlSchemes.has(match[1] ?? '');
}
