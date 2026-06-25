import * as ts from 'typescript';

import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
import type { ComponentModuleModel } from '../scan/parse.js';

/**
 * SPEC §6.6/§9.5 + secure-framework Phase 6 (Tier 3): the COMPILE-TIME half of the KV434 ReDoS gate.
 *
 * The runtime (`@kovojs/server` `s.string().pattern(...)`) already (a) blesses the linear matchers
 * `email`/`url`/`uuid`/`slug`, (b) statically rejects nested/overlapping-quantifier structure in a
 * literal pattern, and (c) caps input length under a step-budget. What runtime cannot do is flag the
 * authored site when `pattern(...)` is given a value the compiler cannot see — a variable, a call
 * result, a template with substitutions. Such a pattern is unanalyzable, so the build nudges the
 * author to a blessed format or the audited `unsafeRegex(re, justification)` escape (`.matches(...)`).
 *
 * Honesty (SPEC §6.6): blessed formats are by-construction; `pattern(literal)` is
 * by-construction-ISH (compile-time non-literal reject + runtime step-budget). The full RE2/DFA
 * engine stays deferred, so this lint is intentionally conservative — it flags ONLY a genuinely
 * non-literal `pattern()` argument and never relabels `pattern()` as fully by-construction.
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
  if (isCompileVisiblePatternLiteral(arg)) return null;

  return { end: node.getEnd(), start: callee.name.getStart() };
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
function isCompileVisiblePatternLiteral(expression: ts.Expression): boolean {
  const node = unwrapExpression(expression);

  if (ts.isRegularExpressionLiteral(node)) return true;
  if (ts.isStringLiteralLike(node)) return true;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return true;

  // `'^a' + '$'`: a `+` concatenation is literal only when both operands are.
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return isCompileVisiblePatternLiteral(node.left) && isCompileVisiblePatternLiteral(node.right);
  }

  // A template literal is compile-visible only if it has no substitutions; a `${...}` makes it
  // unanalyzable. (A no-substitution template is handled above; this covers `head` with spans.)
  if (ts.isTemplateExpression(node)) return false;

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
