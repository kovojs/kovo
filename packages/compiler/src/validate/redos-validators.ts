import * as ts from 'typescript';

import type { CompilerDiagnostic, DiagnosticFactory } from '../diagnostics.js';
import type { ComponentModuleModel } from '../scan/parse.js';

export function validateStringPatterns(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): readonly CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isPatternCall(node)) {
      const [pattern] = node.arguments;
      const unsafeEscape = pattern && ts.isCallExpression(pattern) && isUnsafeRegexCall(pattern);
      if (!pattern || unsafeEscape) {
        ts.forEachChild(node, visit);
        return;
      }
      if (!isStringPatternLiteral(pattern)) {
        found.push(patternDiagnostic(diagnostics, pattern, 'pattern argument is not a literal'));
      } else {
        const reason = unsafeRegexReason(pattern.text);
        if (reason) found.push(patternDiagnostic(diagnostics, pattern, reason));
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(model.sourceFile);
  return found;
}

function patternDiagnostic(
  diagnostics: DiagnosticFactory,
  node: ts.Node,
  detail: string,
): CompilerDiagnostic {
  return diagnostics.at(
    'KV434',
    { start: node.getStart(modelSourceFile(node)), length: node.getWidth(modelSourceFile(node)) },
    detail,
  );
}

function modelSourceFile(node: ts.Node): ts.SourceFile {
  return node.getSourceFile();
}

function isPatternCall(node: ts.CallExpression): boolean {
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'pattern' &&
    node.arguments.length > 0
  );
}

function isUnsafeRegexCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'unsafeRegex';
  return ts.isPropertyAccessExpression(callee) && callee.name.text === 'unsafeRegex';
}

function isStringPatternLiteral(
  node: ts.Expression,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function unsafeRegexReason(source: string): string | undefined {
  try {
    new RegExp(`^(?:${source})$`, 'u');
  } catch (error) {
    return `invalid pattern: ${error instanceof Error ? error.message : String(error)}`;
  }

  const stack: boolean[] = [];
  let escaped = false;
  let inClass = false;
  let lastAtom: string | undefined;
  let previousQuantified: string | undefined;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (inClass) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === ']') {
        inClass = false;
        lastAtom = 'class';
        if (!isQuantifier(source[index + 1] ?? '')) previousQuantified = undefined;
      }
      continue;
    }
    if (escaped) {
      if (/[1-9]/u.test(char) || char === 'k') return 'backreferences are not linear-safe';
      lastAtom = escapedAtomKey(char);
      if (!isQuantifier(source[index + 1] ?? '')) previousQuantified = undefined;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '[') {
      inClass = true;
      continue;
    }
    if (char === '(') {
      if (source[index + 1] === '?' && ['=', '!', '<'].includes(source[index + 2] ?? '')) {
        return 'lookaround assertions are not accepted in safe patterns';
      }
      stack.push(false);
      lastAtom = undefined;
      previousQuantified = undefined;
      if (source[index + 1] === '?' && source[index + 2] === ':') index += 2;
      continue;
    }
    if (char === ')') {
      const quantifiedInside = stack.pop();
      if (quantifiedInside === undefined) return 'unbalanced group close';
      const next = source[index + 1] ?? '';
      const quantified = isQuantifier(next);
      if (quantified && quantifiedInside) {
        return 'nested quantified groups can backtrack exponentially';
      }
      lastAtom = 'group';
      if (quantified) {
        if (next === '{') index = skipCountQuantifier(source, index + 1);
        else index += 1;
        previousQuantified = 'group';
      }
      continue;
    }
    if (char === '|') {
      lastAtom = undefined;
      previousQuantified = undefined;
      continue;
    }
    if (isQuantifier(char)) {
      if (!lastAtom) return 'quantifier has no literal atom';
      if (previousQuantified && atomsOverlap(previousQuantified, lastAtom)) {
        return 'adjacent or overlapping quantified atoms can backtrack exponentially';
      }
      if (stack.length > 0) stack[stack.length - 1] = true;
      previousQuantified = lastAtom;
      if (char === '{') index = skipCountQuantifier(source, index);
      continue;
    }
    if (char === '^' || char === '$') {
      lastAtom = undefined;
      previousQuantified = undefined;
      continue;
    }
    lastAtom = char;
    if (!isQuantifier(source[index + 1] ?? '')) previousQuantified = undefined;
  }

  if (escaped) return 'dangling escape';
  if (inClass) return 'unterminated character class';
  if (stack.length > 0) return 'unbalanced group open';
  return undefined;
}

function escapedAtomKey(char: string): string {
  if (char === 'd' || char === 'w' || char === 's') return 'class';
  if (char === 'D' || char === 'W' || char === 'S') return 'unknown';
  if (char === 'b' || char === 'B') return '';
  return char;
}

function atomsOverlap(left: string, right: string): boolean {
  if (left === '' || right === '') return false;
  if (left === 'unknown' || right === 'unknown' || left === 'class' || right === 'class') {
    return true;
  }
  return left === right;
}

function isQuantifier(char: string): boolean {
  return char === '*' || char === '+' || char === '?' || char === '{';
}

function skipCountQuantifier(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length && source[index] !== '}') index += 1;
  return index < source.length ? index : start;
}
