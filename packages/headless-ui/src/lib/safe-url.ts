/**
 * Browser-safe URL sink adapter for headless primitives.
 *
 * Keep this policy aligned with `@kovojs/core/internal/security-url`; headless
 * primitives are served as browser modules and therefore cannot re-export a bare
 * internal core package specifier from client-visible source.
 *
 * This classifier intentionally uses only language-level string indexing and
 * comparison. A component dependency can run authored code before the sink is
 * called, so late-bound `RegExp.prototype.exec`, `String.prototype.replace`, or
 * `Set.prototype.has` would let that code redefine what the URL allowlist means.
 */
export function safeUrl(value: string | null | undefined, fallback = '#'): string {
  if (typeof value !== 'string') return fallback;

  const normalized = normalizedUrlForSchemeCheck(value);
  if (normalized === '') return fallback;

  return hasUnsafeUrlScheme(normalized) ? fallback : value;
}

function hasUnsafeUrlScheme(value: string): boolean {
  if (!isAsciiAlpha(value[0])) return false;

  let index = 1;
  while (index < value.length && isSchemeCharacter(value[index])) index += 1;
  if (value[index] === ':') return !isAllowedScheme(value, index);
  // Browsers/HTML parsers can decode these references before URL handling. Treat
  // an encoded colon in the scheme position as unsafe even for an allowlisted
  // spelling, matching the prior conservative policy.
  return value[index] === '&' && isHtmlColonReference(value, index);
}

function normalizedUrlForSchemeCheck(value: string): string {
  let normalized = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (character <= '\u0020' || (character >= '\u007f' && character <= '\u009f')) {
      continue;
    }
    normalized += character;
  }
  return normalized;
}

function isAsciiAlpha(character: string | undefined): boolean {
  return (
    character !== undefined &&
    ((character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z'))
  );
}

function isAsciiDigit(character: string | undefined): boolean {
  return character !== undefined && character >= '0' && character <= '9';
}

function isAsciiHex(character: string | undefined): boolean {
  return (
    isAsciiDigit(character) ||
    (character !== undefined &&
      ((character >= 'A' && character <= 'F') || (character >= 'a' && character <= 'f')))
  );
}

function isSchemeCharacter(character: string | undefined): boolean {
  return (
    isAsciiAlpha(character) ||
    isAsciiDigit(character) ||
    character === '+' ||
    character === '.' ||
    character === '-'
  );
}

function isAllowedScheme(value: string, end: number): boolean {
  let scheme = '';
  for (let index = 0; index < end; index += 1) {
    const character = value[index] ?? '';
    scheme += character >= 'A' && character <= 'Z' ? asciiLower(character) : character;
  }
  switch (scheme) {
    case 'ftp':
    case 'http':
    case 'https':
    case 'mailto':
    case 'tel':
      return true;
    default:
      return false;
  }
}

function asciiLower(character: string): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  for (let index = 0; index < upper.length; index += 1) {
    if (upper[index] === character) return lower[index] ?? character;
  }
  return character;
}

function isHtmlColonReference(value: string, start: number): boolean {
  if (matches(value, start, '&colon')) return true;
  if (value[start + 1] !== '#') return false;

  let index = start + 2;
  const hexadecimal = value[index] === 'x' || value[index] === 'X';
  if (hexadecimal) index += 1;
  while (value[index] === '0') index += 1;

  if (hexadecimal) {
    if (value[index] !== '3' || (value[index + 1] !== 'a' && value[index + 1] !== 'A')) {
      return false;
    }
    return !isAsciiHex(value[index + 2]);
  }

  if (value[index] !== '5' || value[index + 1] !== '8') return false;
  return !isAsciiDigit(value[index + 2]);
}

function matches(value: string, start: number, expected: string): boolean {
  if (start + expected.length > value.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (value[start + index] !== expected[index]) return false;
  }
  return true;
}
