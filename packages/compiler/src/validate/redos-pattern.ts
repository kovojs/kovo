import * as ts from 'typescript';

import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
import { unwrapExpression } from '../scan/ast.js';
import type { ComponentModuleModel } from '../scan/parse.js';

/**
 * SPEC §6.6/§9.5: the COMPILE-TIME half of KV434 for `s.string().pattern(...)`.
 *
 * `pattern()` now runs on Kovo's bounded linear regex engine at runtime. The compiler therefore no
 * longer rejects backtracking-shaped literals such as `(a+)+`; those are safe in the linear engine.
 * It rejects only call shapes the compiler cannot see and literal syntax outside the supported
 * linear subset, routing those cases to the audited `unsafeRegex(re, justification)` escape.
 */
export function validateNonLiteralPattern(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];

  const visit = (node: ts.Node): void => {
    const flagged = unsupportedPatternCall(node);
    if (flagged) {
      found.push(
        diagnostics.at(
          'KV434',
          { length: flagged.end - flagged.start, start: flagged.start },
          flagged.reason,
        ),
      );
    }
    ts.forEachChild(node, visit);
  };

  visit(model.sourceFile);
  return found;
}

function unsupportedPatternCall(
  node: ts.Node,
): { end: number; reason: string; start: number } | null {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || identifierName(callee.name) !== 'pattern') {
    return null;
  }
  if (!receiverRootsAtStringSchema(callee.expression)) return null;

  const [arg] = node.arguments;
  if (!arg) return null;
  const literal = compileVisiblePatternLiteral(arg);
  if (literal === null) {
    return {
      end: node.getEnd(),
      reason:
        'non-literal pattern() argument (use a blessed format or unsafeRegex(re, justification))',
      start: callee.name.getStart(),
    };
  }
  if (!isSupportedLinearRegexLiteral(literal.source, literal.flags)) {
    return {
      end: node.getEnd(),
      reason:
        'pattern() literal uses regex syntax outside the linear subset (use unsafeRegex(re, justification))',
      start: callee.name.getStart(),
    };
  }

  return null;
}

function compileVisiblePatternLiteral(
  expression: ts.Expression,
): { flags: string; source: string } | null {
  const node = unwrapExpression(expression);

  if (ts.isRegularExpressionLiteral(node)) return regexLiteral(node);
  if (ts.isStringLiteralLike(node)) return { flags: '', source: node.text };
  if (ts.isNoSubstitutionTemplateLiteral(node)) return { flags: '', source: node.text };

  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = compileVisiblePatternLiteral(node.left);
    const right = compileVisiblePatternLiteral(node.right);
    if (left === null || right === null || left.flags !== '' || right.flags !== '') return null;
    return { flags: '', source: left.source + right.source };
  }

  return null;
}

function regexLiteral(node: ts.RegularExpressionLiteral): { flags: string; source: string } {
  const text = node.text;
  const lastSlash = text.lastIndexOf('/');
  return lastSlash > 0
    ? { flags: text.slice(lastSlash + 1), source: text.slice(1, lastSlash) }
    : { flags: '', source: text };
}

function receiverRootsAtStringSchema(receiver: ts.Expression): boolean {
  let current: ts.Expression = receiver;

  for (;;) {
    const unwrapped = unwrapExpression(current);

    if (ts.isCallExpression(unwrapped)) {
      const callee = unwrapped.expression;
      if (!ts.isPropertyAccessExpression(callee)) return false;
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

function isSupportedLinearRegexLiteral(source: string, flags: string): boolean {
  if (!supportedFlags(flags)) return false;
  if (flags.includes('i') && containsNonAscii(source)) return false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      const escaped = source[i + 1];
      if (escaped === undefined) return false;
      if (escaped === 'x' || escaped === 'u' || escaped === 'c') return false;
      if ((escaped >= '1' && escaped <= '9') || escaped === 'k') return false;
      if (escaped === 'p' || escaped === 'P') return false;
      if (escaped === '0' && isDigitCode(source.charCodeAt(i + 2))) return false;
      i += 1;
      continue;
    }
    if (ch === '[') {
      const close = classClose(source, i);
      if (close === -1) return false;
      i = close;
      continue;
    }
    if (ch === '(') {
      const next = source[i + 1];
      const after = source[i + 2];
      if (next === '?' && after !== ':') return false;
      continue;
    }
  }

  try {
    new RegExp(source, flags.replace(/[gy]/g, ''));
    return true;
  } catch {
    return false;
  }
}

function supportedFlags(flags: string): boolean {
  const seen = new Set<string>();
  for (const flag of flags) {
    if (seen.has(flag)) return false;
    seen.add(flag);
    if (flag !== 'i' && flag !== 'm' && flag !== 's' && flag !== 'g' && flag !== 'y') return false;
  }
  return true;
}

function classClose(source: string, open: number): number {
  for (let i = open + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      const escaped = source[i + 1];
      if (escaped === undefined) return -1;
      if (escaped === 'x' || escaped === 'u' || escaped === 'c') return -1;
      if (escaped >= '1' && escaped <= '9') return -1;
      if (escaped === 'p' || escaped === 'P' || escaped === 'k') return -1;
      if (escaped === '0' && isDigitCode(source.charCodeAt(i + 2))) return -1;
      i += 1;
      continue;
    }
    if (ch === ']' && i > open + 1) return i;
  }
  return -1;
}

function isDigitCode(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function containsNonAscii(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 0x7f) return true;
  }
  return false;
}

function identifierName(name: ts.MemberName): string | null {
  return ts.isIdentifier(name) ? String(name.escapedText) : null;
}
