import type { RegisteredDiagnostic } from '../diagnostics.js';
import { diagnosticConstructors } from './diagnostics.js';
import { securityRegExpTest, securityStringCharCodeAt } from './security-witness-intrinsics.js';

// SPEC §5.2 / plans/10x-better-security-3.md §2.3: generated JavaScript and TypeScript
// data crosses one role-specific structural emission door. These brands are author-time
// guardrails only; the validating constructors and hostile parse-tree oracle own enforcement.
declare const structuralEmissionSourceBrand: unique symbol;

/** @internal The finite source grammar roles accepted by the structural emission door. */
export type StructuralEmissionRole =
  | 'import-specifier'
  | 'js-identifier'
  | 'js-string-literal'
  | 'ts-property-key';

/** @internal Runtime-validated source text for one exact JavaScript/TypeScript grammar role. */
export type StructuralEmissionSource<Role extends StructuralEmissionRole> = string & {
  readonly [structuralEmissionSourceBrand]: Role;
};

const identifierNamePattern = /^[$_\p{ID_Start}][$_\u200c\u200d\p{ID_Continue}]*$/u;

class StructuralEmissionDiagnosticError extends TypeError {
  readonly diagnostic: RegisteredDiagnostic<'KV451'>;

  constructor(diagnostic: RegisteredDiagnostic<'KV451'>) {
    super(`${diagnostic.code}: ${diagnostic.message}`);
    this.name = 'StructuralEmissionDiagnosticError';
    this.diagnostic = diagnostic;
  }
}

/**
 * @internal
 *
 * Encode one value as a double-quoted ECMAScript string-literal leaf. The encoder works over
 * UTF-16 code units and escapes controls, line separators, and surrogates so writing the returned
 * source through UTF-8 cannot change its value. A finite grammar pass validates the constructed
 * source before it leaves this module.
 */
export function jsStringLiteral(value: unknown): StructuralEmissionSource<'js-string-literal'> {
  if (typeof value !== 'string') {
    return failStructuralEmission('js-string-literal', 'the input must be a string');
  }

  if (isSafeSingleQuotedLiteralValue(value)) {
    const source = `'${value}'`;
    if (!isValidatedStringLiteralSource(source)) {
      return failStructuralEmission(
        'js-string-literal',
        'the encoded source failed the finite string-literal grammar',
      );
    }
    return source as StructuralEmissionSource<'js-string-literal'>;
  }

  return doubleQuotedStringLiteral(value);
}

function doubleQuotedStringLiteral(value: string): StructuralEmissionSource<'js-string-literal'> {
  let source = '"';
  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    switch (code) {
      case 0x08:
        source += '\\b';
        break;
      case 0x09:
        source += '\\t';
        break;
      case 0x0a:
        source += '\\n';
        break;
      case 0x0c:
        source += '\\f';
        break;
      case 0x0d:
        source += '\\r';
        break;
      case 0x22:
        source += '\\"';
        break;
      case 0x5c:
        source += '\\\\';
        break;
      default:
        source +=
          code < 0x20 || code === 0x2028 || code === 0x2029 || (code >= 0xd800 && code <= 0xdfff)
            ? unicodeEscape(code)
            : value[index];
    }
  }
  source += '"';

  if (!isValidatedStringLiteralSource(source)) {
    return failStructuralEmission(
      'js-string-literal',
      'the encoded source failed the finite string-literal grammar',
    );
  }
  return source as StructuralEmissionSource<'js-string-literal'>;
}

/**
 * @internal
 *
 * Validate one ECMAScript binding identifier. Invalid identifiers fail closed instead of being
 * quoted because binding/import/export positions do not accept string-literal substitution.
 */
export function jsIdentifier(value: unknown): StructuralEmissionSource<'js-identifier'> {
  if (
    typeof value !== 'string' ||
    !securityRegExpTest(identifierNamePattern, value) ||
    isReservedBindingIdentifier(value)
  ) {
    return failStructuralEmission(
      'js-identifier',
      'the input is not an unreserved ECMAScript binding identifier',
    );
  }
  return value as StructuralEmissionSource<'js-identifier'>;
}

/**
 * @internal
 *
 * Emit a TypeScript property key as a readable IdentifierName when possible and otherwise as one
 * validated string-literal leaf. Keywords are legal property names and remain readable here.
 */
export function tsPropertyKey(value: unknown): StructuralEmissionSource<'ts-property-key'> {
  if (typeof value !== 'string') {
    return failStructuralEmission('ts-property-key', 'the input must be a string');
  }
  if (value === '__proto__') {
    const literal: string = doubleQuotedStringLiteral(value);
    return `[${literal}]` as StructuralEmissionSource<'ts-property-key'>;
  }
  return (
    securityRegExpTest(identifierNamePattern, value) ? value : doubleQuotedStringLiteral(value)
  ) as StructuralEmissionSource<'ts-property-key'>;
}

/**
 * @internal
 *
 * Emit a non-empty, NUL-free module specifier as one validated string-literal leaf. Resolution is
 * deliberately left to the owning compiler/build graph; this door owns source grammar only.
 */
export function importSpecifier(value: unknown): StructuralEmissionSource<'import-specifier'> {
  if (typeof value !== 'string' || value.length === 0 || containsCodeUnit(value, 0x00)) {
    return failStructuralEmission(
      'import-specifier',
      'the input must be a non-empty NUL-free module specifier',
    );
  }
  const source: string = jsStringLiteral(value);
  return source as StructuralEmissionSource<'import-specifier'>;
}

function failStructuralEmission(role: StructuralEmissionRole, reason: string): never {
  const diagnostic = diagnosticConstructors.KV451(
    { role },
    { detail: `Role ${role}: ${reason}.`, includeHelp: true },
  );
  throw new StructuralEmissionDiagnosticError(diagnostic);
}

function containsCodeUnit(value: string, expected: number): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (securityStringCharCodeAt(value, index) === expected) return true;
  }
  return false;
}

function isSafeSingleQuotedLiteralValue(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if (
      code < 0x20 ||
      code === 0x27 ||
      code === 0x5c ||
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0xd800 && code <= 0xdfff)
    ) {
      return false;
    }
  }
  return true;
}

function unicodeEscape(code: number): string {
  const digits = '0123456789abcdef';
  return `\\u${digits[(code >>> 12) & 0x0f]}${digits[(code >>> 8) & 0x0f]}${
    digits[(code >>> 4) & 0x0f]
  }${digits[code & 0x0f]}`;
}

function isValidatedStringLiteralSource(source: string): boolean {
  const quote = securityStringCharCodeAt(source, 0);
  if (
    source.length < 2 ||
    (quote !== 0x22 && quote !== 0x27) ||
    securityStringCharCodeAt(source, source.length - 1) !== quote
  ) {
    return false;
  }
  for (let index = 1; index < source.length - 1; index += 1) {
    const code = securityStringCharCodeAt(source, index);
    if (code === quote || code < 0x20 || code === 0x2028 || code === 0x2029) return false;
    if (code !== 0x5c) continue;
    index += 1;
    if (index >= source.length - 1) return false;
    const escaped = securityStringCharCodeAt(source, index);
    if (
      escaped === 0x22 ||
      escaped === 0x27 ||
      escaped === 0x5c ||
      escaped === 0x2f ||
      escaped === 0x62 ||
      escaped === 0x66 ||
      escaped === 0x6e ||
      escaped === 0x72 ||
      escaped === 0x74
    ) {
      continue;
    }
    if (escaped !== 0x75 || index + 4 >= source.length) return false;
    for (let digit = 1; digit <= 4; digit += 1) {
      if (!isLowerHexCode(securityStringCharCodeAt(source, index + digit))) return false;
    }
    index += 4;
  }
  return true;
}

function isLowerHexCode(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x61 && code <= 0x66);
}

function isReservedBindingIdentifier(value: string): boolean {
  switch (value) {
    case 'arguments':
    case 'await':
    case 'break':
    case 'case':
    case 'catch':
    case 'class':
    case 'const':
    case 'continue':
    case 'debugger':
    case 'default':
    case 'delete':
    case 'do':
    case 'else':
    case 'enum':
    case 'eval':
    case 'export':
    case 'extends':
    case 'false':
    case 'finally':
    case 'for':
    case 'function':
    case 'if':
    case 'implements':
    case 'import':
    case 'in':
    case 'instanceof':
    case 'interface':
    case 'let':
    case 'new':
    case 'null':
    case 'package':
    case 'private':
    case 'protected':
    case 'public':
    case 'return':
    case 'static':
    case 'super':
    case 'switch':
    case 'this':
    case 'throw':
    case 'true':
    case 'try':
    case 'typeof':
    case 'var':
    case 'void':
    case 'while':
    case 'with':
    case 'yield':
      return true;
    default:
      return false;
  }
}
