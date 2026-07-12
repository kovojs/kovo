import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const authorityFiles = [
  new URL('./secret.ts', import.meta.url),
  new URL('./json-clone.ts', import.meta.url),
  new URL('./verifier.ts', import.meta.url),
  new URL('./internal/framework-identity.ts', import.meta.url),
  new URL('./internal/framework-identity-catalog.ts', import.meta.url),
  new URL('./internal/route-pattern.ts', import.meta.url),
  new URL('./internal/sink-policy.ts', import.meta.url),
  new URL('./internal/sql-safety.ts', import.meta.url),
  new URL('../../browser/src/security-output.ts', import.meta.url),
  new URL('../../browser/src/dynamic-import-url.ts', import.meta.url),
  new URL('../../browser/src/handler-context.ts', import.meta.url),
  new URL('../../browser/src/handlers.ts', import.meta.url),
  new URL('../../drizzle/src/runtime.ts', import.meta.url),
  new URL('../../server/src/html.ts', import.meta.url),
  new URL('../../server/src/route.ts', import.meta.url),
  new URL('../../server/src/document-structured.ts', import.meta.url),
] as const;

const collectionConstructors = new Set(['Map', 'Set', 'WeakMap', 'WeakSet']);
const collectionMethods = new Set(['add', 'delete', 'get', 'has', 'set']);

// URLSearchParams is a platform encoder, not proof storage. Keep this exception narrow and
// receiver-specific; every authority-bearing Map/Set/WeakMap/WeakSet operation must route through
// the captured package helper instead.
const allowedDirectCalls = new Set(['core/src/internal/route-pattern.ts:search.set']);

describe('authority-bearing collection intrinsic census (SPEC §6.6)', () => {
  it('contains no ambient collection construction or proof-method dispatch', () => {
    const violations: string[] = [];
    for (const url of authorityFiles) {
      const path = fileURLToPath(url);
      const source = readFileSync(path, 'utf8');
      const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      const displayPath = path.slice(path.lastIndexOf('/packages/') + '/packages/'.length);

      const visit = (node: ts.Node): void => {
        if (
          ts.isNewExpression(node) &&
          ts.isIdentifier(node.expression) &&
          collectionConstructors.has(node.expression.text)
        ) {
          violations[violations.length] =
            `${displayPath}:${lineOf(sourceFile, node)} new ${node.expression.text}`;
        }

        if (ts.isCallExpression(node)) {
          const member = directMember(node.expression);
          if (member && collectionMethods.has(member.method)) {
            const exception = `${displayPath}:${member.receiver}.${member.method}`;
            if (!allowedDirectCalls.has(exception)) {
              violations[violations.length] =
                `${displayPath}:${lineOf(sourceFile, node)} ${member.receiver}.${member.method}()`;
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }

    expect(violations).toEqual([]);
  });
});

function directMember(
  expression: ts.LeftHandSideExpression,
): { method: string; receiver: string } | undefined {
  if (ts.isPropertyAccessExpression(expression)) {
    return {
      method: expression.name.text,
      receiver: expression.expression.getText(),
    };
  }
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    return {
      method: expression.argumentExpression.text,
      receiver: expression.expression.getText(),
    };
  }
  return undefined;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}
