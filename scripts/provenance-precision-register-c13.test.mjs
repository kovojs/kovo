import { readFileSync } from 'node:fs';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourcePath = new URL(
  '../packages/compiler/src/scan/security-operation-ir.ts',
  import.meta.url,
);

function serverExpressionProvenanceFunction(sourceFile) {
  let match;
  const visit = (node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === 'serverExpressionProvenance'
    ) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!match) throw new Error('serverExpressionProvenance must remain an exact declaration');
  return match;
}

function unregisteredPrecisionReturns(sourceFile, declaration) {
  const missing = [];
  const visit = (node) => {
    if (node !== declaration && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) {
      const expression = node.expression;
      const isAuthorityTop =
        ts.isStringLiteral(expression) && expression.text === 'unknown-authority';
      const isRegistered =
        ts.isCallExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === 'serverPrecisionGrant' &&
        expression.arguments.length === 2 &&
        ts.isStringLiteral(expression.arguments[0]);
      if (!isAuthorityTop && !isRegistered) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        missing.push(`${line}:${node.getText(sourceFile)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration);
  return missing;
}

// @kovo-security-certifies C13 provenance-precision-grant-register
describe('server provenance precision-grant register (Plan 3 §4.5)', () => {
  it('routes every non-top extractor return through an exact reviewed grant identity', () => {
    const source = readFileSync(sourcePath, 'utf8');
    const sourceFile = ts.createSourceFile(
      sourcePath.pathname,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const declaration = serverExpressionProvenanceFunction(sourceFile);

    expect(unregisteredPrecisionReturns(sourceFile, declaration)).toEqual([]);
  });
});
