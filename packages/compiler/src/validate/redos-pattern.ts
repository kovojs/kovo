import * as ts from 'typescript';

import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
import type { ComponentModuleModel } from '../scan/parse.js';

const CHAR_CARET = 0x5e;
const CHAR_COMMA = 0x2c;
const CHAR_HYPHEN = 0x2d;
const CHAR_LEFT_PAREN = 0x28;
const CHAR_RIGHT_BRACE = 0x7d;
const CHAR_RIGHT_BRACKET = 0x5d;

/**
 * SPEC §6.6/§9.5 + secure-framework Phase 6 (Tier 3): the COMPILE-TIME half of the KV434 ReDoS gate.
 *
 * `email`/`url`/`uuid`/`slug`, (b) rejects nested/overlapping-quantifier structure in a literal
 * pattern, and (c) caps input length. The cap is not a CPU bound. The compiler mirrors the literal
 * structural reject for the common catastrophic-backtracking class and flags a value it cannot see
 * (a variable, a call result, a template with substitutions) as unanalyzable, nudging the author to
 * a blessed format or the audited `unsafeRegex(re, justification)` escape (`.matches(...)`).
 *
 * Honesty (SPEC §6.6): blessed formats are by-construction; `pattern(literal)` is
 * by-construction-ISH (literal structural reject + runtime input-size cap). The full RE2/DFA
 * engine stays deferred, so this lint is intentionally conservative — it flags unanalyzable
 * non-literals and compile-visible literals with known exponential structure, never relabeling
 * `pattern()` as fully by-construction.
 *
 * Recognition is the narrowest sound shape: a `.pattern(<arg>)` call whose receiver chain provably
 * roots at the wire schema namespace `s.string()`, where `<arg>` is not a compile-visible
 * regex/string literal. The audited escape `.matches(unsafeRegex(...))` uses a different method name
 * and so is never flagged.
 */
export function validateNonLiteralPattern(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];

  const visit = (node: ts.Node): void => {
    const flagged = nonLiteralPatternCall(node);
    if (flagged) {
      found.push(
        diagnostics.at(
          'KV434',
          { length: flagged.end - flagged.start, start: flagged.start },
          'non-literal pattern() argument (use a blessed format or unsafeRegex(re, justification))',
        ),
      );
    }
    ts.forEachChild(node, visit);
  };

  visit(model.sourceFile);
  return found;
}

/**
 * If `node` is a `<s.string() chain>.pattern(<arg>)` call whose argument is NOT a compile-visible
 * literal, return its source span; otherwise `null`.
 */
function nonLiteralPatternCall(node: ts.Node): { end: number; start: number } | null {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || identifierName(callee.name) !== 'pattern') {
    return null;
  }

  // Only flag a pattern() that is provably part of a wire string schema (`s.string()...`). This is
  // the conservative gate: an unrelated `.pattern(...)` method on some other object is left alone.
  if (!receiverRootsAtStringSchema(callee.expression)) return null;

  const [arg] = node.arguments;
  // No argument is a malformed call the type checker already rejects; do not double-flag it.
  if (!arg) return null;
  const literal = compileVisiblePatternLiteralSource(arg);
  if (literal === null) return { end: node.getEnd(), start: callee.name.getStart() };
  if (!isLinearSafeLiteralPattern(literal))
    return { end: node.getEnd(), start: callee.name.getStart() };

  return null;
}

function compileVisiblePatternLiteralSource(expression: ts.Expression): string | null {
  const node = unwrapExpression(expression);

  if (ts.isRegularExpressionLiteral(node)) return regexLiteralSource(node);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;

  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = compileVisiblePatternLiteralSource(node.left);
    const right = compileVisiblePatternLiteralSource(node.right);
    return left === null || right === null ? null : left + right;
  }

  return null;
}

/**
 * A `.pattern(...)` receiver provably roots at `s.string()`: walk down the call/property-access
 * chain (e.g. `s.string().min(3)` → `s.string()` → `s.string`) until it bottoms out at the wire
 * schema namespace identifier `s` accessed as `.string`.
 */
function receiverRootsAtStringSchema(receiver: ts.Expression): boolean {
  let current: ts.Expression = receiver;

  for (;;) {
    const unwrapped = unwrapExpression(current);

    if (ts.isCallExpression(unwrapped)) {
      const callee = unwrapped.expression;
      if (!ts.isPropertyAccessExpression(callee)) return false;
      // `s.string()` is the root we are looking for: `s` identifier accessed as `.string`.
      if (
        identifierName(callee.name) === 'string' &&
        ts.isIdentifier(callee.expression) &&
        identifierName(callee.expression) === 's'
      ) {
        return true;
      }
      current = callee.expression;
      continue;
    }

    if (ts.isPropertyAccessExpression(unwrapped)) {
      current = unwrapped.expression;
      continue;
    }

    return false;
  }
}

/**
 * A compile-visible pattern literal the runtime already validates: a regex literal, a plain string
 * literal, a no-substitution template, or a string concatenation / template whose every leaf is one
 * of those. Anything else (an identifier, a call result, a template WITH substitutions) is
 * unanalyzable and earns KV434.
 */
function regexLiteralSource(node: ts.RegularExpressionLiteral): string {
  const text = node.text;
  const lastSlash = text.lastIndexOf('/');
  return lastSlash > 0 ? text.slice(1, lastSlash) : text;
}

function isLinearSafeLiteralPattern(source: string): boolean {
  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) !== CHAR_LEFT_PAREN) continue;
    const close = matchGroupClose(source, i);
    if (close === -1) continue;
    if (quantifierAt(source, close + 1) === null) continue;
    const body = stripGroupPrefix(source.slice(i + 1, close));
    if (containsQuantifier(body) || hasOverlappingAlternatives(body)) return false;
  }
  return !hasAdjacentOverlappingQuantifiers(source);
}

function containsQuantifier(source: string): boolean {
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '+' || ch === '*' || ch === '{') return true;
  }
  return false;
}

function quantifierAt(source: string, index: number): number | null {
  const ch = source[index];
  if (ch === '+' || ch === '*' || ch === '?') return index + 1;
  if (ch !== '{') return null;
  let i = index + 1;
  if (!isAsciiDigitCode(source.charCodeAt(i))) return null;
  while (isAsciiDigitCode(source.charCodeAt(i))) i += 1;
  if (source.charCodeAt(i) === CHAR_COMMA) {
    i += 1;
    while (isAsciiDigitCode(source.charCodeAt(i))) i += 1;
  }
  return source.charCodeAt(i) === CHAR_RIGHT_BRACE ? i + 1 : null;
}

function isAsciiDigitCode(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

/**
 * Index of the `)` closing the group opened at `open`, accounting for nesting, escapes, and
 * character-class spans (SPEC §6.6 / KV434 soundness). A `)` inside `[...]` is a literal
 * character, not a group delimiter — ignoring class spans caused `matchGroupClose` to
 * mis-locate the group close for patterns like `([\w)]+)+`, hiding the nested quantifier.
 * Fix: mirror the `classDepth` tracking already present in `splitTopLevelAlternatives`.
 */
function matchGroupClose(source: string, open: number): number {
  let depth = 0;
  let classDepth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (classDepth > 0) {
      if (ch === ']') classDepth -= 1;
      continue;
    }
    if (ch === '[') {
      classDepth += 1;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function stripGroupPrefix(body: string): string {
  if (!body.startsWith('?')) return body;
  if (body.startsWith('?:') || body.startsWith('?=') || body.startsWith('?!')) return body.slice(2);
  if (body.startsWith('?<=') || body.startsWith('?<!')) return body.slice(3);
  return body;
}

function hasOverlappingAlternatives(body: string): boolean {
  const alternatives = splitTopLevelAlternatives(body);
  if (alternatives.length < 2) return false;
  const firstSets = alternatives.map((alternative) => firstTokenSet(alternative));
  for (let i = 0; i < firstSets.length; i += 1) {
    for (let j = i + 1; j < firstSets.length; j += 1) {
      const left = firstSets[i];
      const right = firstSets[j];
      if (left && right && setsOverlap(left, right)) return true;
    }
  }
  return false;
}

function splitTopLevelAlternatives(source: string): string[] {
  const alternatives: string[] = [];
  let depth = 0;
  let classDepth = 0;
  let start = 0;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (classDepth > 0) {
      if (ch === ']') classDepth -= 1;
      continue;
    }
    if (ch === '[') {
      classDepth += 1;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === '|' && depth === 0) {
      alternatives.push(source.slice(start, i));
      start = i + 1;
    }
  }
  alternatives.push(source.slice(start));
  return alternatives;
}

type TokenSet = ReadonlySet<string> | 'unknown';

function firstTokenSet(source: string): TokenSet {
  const atom = readAtom(source, 0);
  return atom?.set ?? 'unknown';
}

function hasAdjacentOverlappingQuantifiers(source: string): boolean {
  let previousQuantified: TokenSet | null = null;
  for (let i = 0; i < source.length; ) {
    const atom = readAtom(source, i);
    if (!atom) {
      previousQuantified = null;
      i += 1;
      continue;
    }
    const quantifierEnd = quantifierAt(source, atom.end);
    if (quantifierEnd === null) {
      previousQuantified = null;
      i = atom.end;
      continue;
    }
    if (previousQuantified && setsOverlap(previousQuantified, atom.set)) return true;
    previousQuantified = atom.set;
    i = quantifierEnd;
  }
  return false;
}

function readAtom(source: string, start: number): { end: number; set: TokenSet } | null {
  const ch = source[start];
  if (!ch || ch === '^' || ch === '$' || ch === '|') return null;
  if (ch === '\\') return readEscapedAtom(source, start);
  if (ch === '[') return readClassAtom(source, start);
  if (ch === '(') {
    const close = matchGroupClose(source, start);
    if (close === -1) return { end: start + 1, set: 'unknown' };
    return { end: close + 1, set: firstTokenSet(stripGroupPrefix(source.slice(start + 1, close))) };
  }
  if (ch === '.') return { end: start + 1, set: 'unknown' };
  return { end: start + 1, set: new Set([ch]) };
}

function readEscapedAtom(source: string, start: number): { end: number; set: TokenSet } {
  const escaped = source[start + 1];
  if (!escaped) return { end: start + 1, set: 'unknown' };
  if (escaped === 'd') return { end: start + 2, set: asciiRange('0', '9') };
  if (escaped === 'w') {
    return {
      end: start + 2,
      set: unionSets(
        asciiRange('0', '9'),
        asciiRange('A', 'Z'),
        asciiRange('a', 'z'),
        new Set(['_']),
      ),
    };
  }
  if (escaped === 's') return { end: start + 2, set: new Set([' ', '\t', '\n', '\r', '\f', '\v']) };
  if (escaped === 'D' || escaped === 'W' || escaped === 'S' || escaped === 'p' || escaped === 'P') {
    return { end: start + 2, set: 'unknown' };
  }
  return { end: start + 2, set: new Set([escaped]) };
}

function readClassAtom(source: string, start: number): { end: number; set: TokenSet } {
  const set = new Set<string>();
  let negated = false;
  let i = start + 1;
  if (source.charCodeAt(i) === CHAR_CARET) {
    negated = true;
    i += 1;
  }
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (!ch) return { end: source.length, set: 'unknown' };
    if (ch === ']') return { end: i + 1, set: negated ? 'unknown' : set };
    if (ch === '\\') {
      const escaped = readEscapedAtom(source, i);
      if (escaped.set === 'unknown') return { end: i + 2, set: 'unknown' };
      for (const value of escaped.set) set.add(value);
      i = escaped.end - 1;
      continue;
    }
    const rangeEndCode = source.charCodeAt(i + 2);
    if (
      source.charCodeAt(i + 1) === CHAR_HYPHEN &&
      !Number.isNaN(rangeEndCode) &&
      rangeEndCode !== CHAR_RIGHT_BRACKET
    ) {
      for (let code = ch.charCodeAt(0); code <= rangeEndCode; code += 1) {
        set.add(String.fromCharCode(code));
      }
      i += 2;
      continue;
    }
    set.add(ch);
  }
  return { end: source.length, set: 'unknown' };
}

function asciiRange(first: string, last: string): Set<string> {
  const set = new Set<string>();
  for (let code = first.charCodeAt(0); code <= last.charCodeAt(0); code += 1) {
    set.add(String.fromCharCode(code));
  }
  return set;
}

function unionSets(...sets: ReadonlySet<string>[]): Set<string> {
  const union = new Set<string>();
  for (const set of sets) for (const value of set) union.add(value);
  return union;
}

function setsOverlap(a: TokenSet, b: TokenSet): boolean {
  if (a === 'unknown' || b === 'unknown') return true;
  for (const value of a) if (b.has(value)) return true;
  return false;
}

function identifierName(name: ts.MemberName): string | null {
  return ts.isIdentifier(name) ? String(name.escapedText) : null;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}
