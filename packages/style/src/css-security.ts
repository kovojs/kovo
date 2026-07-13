import type { StylePrimitive } from './engine.js';
import { styleJsonStringify } from './style-security-intrinsics.js';

const CUSTOM_PROPERTY_PREFIX = '--';

/** Render a validated CSS primitive without consulting the mutable global `String` binding. */
export function cssPrimitiveText(value: StylePrimitive): string {
  if (typeof value === 'string') return value;
  if (typeof value !== 'number' || value !== value || value === Infinity || value === -Infinity) {
    throw new TypeError('CSS primitives must be strings or finite numbers.');
  }
  return `${value}`;
}

/** Reject a value that can escape its CSS declaration or an inline `<style>` element. */
export function assertCssValueSafe(
  value: StylePrimitive,
  apiName: string,
  token: string,
  options: { allowBackslash?: boolean } = {},
): void {
  if (typeof value !== 'string') return;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    const unsafeDelimiter =
      isUnsafeCssDelimiter(character) && !(options.allowBackslash && character === '\\');
    if (isCssControl(character) || unsafeDelimiter) {
      throw new TypeError(
        `${apiName} rejected an unsafe CSS value for token "${token}": value must not contain ` +
          `${styleJsonStringify(character)} (a CSS rule/declaration delimiter or markup/control character).`,
      );
    }
  }
}

export function assertCssSyntaxFragmentSafe(
  value: string,
  apiName: string,
  role: string,
  rejectWhitespace = false,
): void {
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (
      isCssControl(character) ||
      (rejectWhitespace && isAsciiWhitespace(character)) ||
      isUnsafeCssDelimiter(character)
    ) {
      throw new TypeError(
        `${apiName} rejected an unsafe CSS ${role} "${value}": names/fragments must not ` +
          `contain ${styleJsonStringify(character)} (a CSS rule/declaration delimiter, markup, or ` +
          'control character).',
      );
    }
  }
}

/** Selectors are flexible, but may never close/open a rule or escape an inline style element. */
export function assertCssSelectorSafe(value: string, apiName: string, role: string): void {
  if (value.length === 0) {
    throw new TypeError(`${apiName} requires CSS ${role} to be non-empty.`);
  }
  assertCssSyntaxFragmentSafe(value, apiName, role);
}

export function assertCssCustomPropertyNameSafe(
  cssProperty: string,
  apiName: string,
  token: string,
): void {
  if (!isCssCustomPropertyName(cssProperty)) {
    throw new TypeError(
      `${apiName} rejected CSS-invalid token "${token}": generated custom property ` +
        `${styleJsonStringify(cssProperty)} is not a valid unescaped CSS custom-property name.`,
    );
  }
}

export function assertCssVarReferenceSafe(value: unknown, apiName: string, token: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(
      `${apiName} rejected token "${token}": base token must be a style.defineVars() ` +
        'variable reference.',
    );
  }
  if (
    value.length < 7 ||
    value[0] !== 'v' ||
    value[1] !== 'a' ||
    value[2] !== 'r' ||
    value[3] !== '(' ||
    value[value.length - 1] !== ')'
  ) {
    throw invalidVarReference(apiName, token, value);
  }
  let property = '';
  for (let index = 4; index < value.length - 1; index += 1) property += value[index] ?? '';
  if (!isCssCustomPropertyName(property)) throw invalidVarReference(apiName, token, value);
  return property;
}

function invalidVarReference(apiName: string, token: string, value: string): TypeError {
  return new TypeError(
    `${apiName} rejected token "${token}": base token reference ${styleJsonStringify(value)} ` +
      'does not contain a valid unescaped CSS custom-property name.',
  );
}

function isCssCustomPropertyName(value: string): boolean {
  if (value[0] !== CUSTOM_PROPERTY_PREFIX[0] || value[1] !== CUSTOM_PROPERTY_PREFIX[1])
    return false;
  if (!isCssNameStart(value[2])) return false;
  for (let index = 3; index < value.length; index += 1) {
    if (!isCssNameCharacter(value[index])) return false;
  }
  return true;
}

function isCssNameStart(character: string | undefined): boolean {
  return character === '_' || isAsciiAlpha(character);
}

function isCssNameCharacter(character: string | undefined): boolean {
  return (
    character === '_' || character === '-' || isAsciiAlpha(character) || isAsciiDigit(character)
  );
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

function isAsciiWhitespace(character: string): boolean {
  return (
    character === ' ' ||
    character === '\t' ||
    character === '\n' ||
    character === '\r' ||
    character === '\f'
  );
}

function isCssControl(character: string): boolean {
  return character <= '\u001f' || character === '\u007f';
}

function isUnsafeCssDelimiter(character: string): boolean {
  switch (character) {
    case '<':
    case '>':
    case '{':
    case '}':
    case ';':
    case '\\':
      return true;
    default:
      return false;
  }
}
