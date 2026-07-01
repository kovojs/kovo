import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  canonicalFrameworkExportForExpression,
  frameworkExport,
  frameworkIdentityExpressionKindRows,
  registerFrameworkIdentityProject,
} from './framework-identity.js';

const trustedHtmlIdentity = frameworkExport('@kovojs/browser', 'trustedHtml');

function sourceFile(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function callExpressionByText(source: ts.SourceFile, text: string): ts.CallExpression {
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node) && node.expression.getText(source) === text) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!found) throw new Error(`Call expression not found: ${text}`);
  return found;
}

function initializerByName(source: ts.SourceFile, name: string): ts.Expression {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!found) throw new Error(`Initializer not found: ${name}`);
  return found;
}

describe('framework identity resolver', () => {
  it('publishes an expression-kind table with a fail-closed default', () => {
    expect(frameworkIdentityExpressionKindRows(ts)).toEqual([
      { kind: ts.SyntaxKind.Identifier, resolution: 'resolve-identifier' },
      { kind: ts.SyntaxKind.PropertyAccessExpression, resolution: 'resolve-property-access' },
      { kind: ts.SyntaxKind.ElementAccessExpression, resolution: 'resolve-element-access' },
      { kind: ts.SyntaxKind.ParenthesizedExpression, resolution: 'unwrap-expression' },
      { kind: ts.SyntaxKind.AsExpression, resolution: 'unwrap-expression' },
      { kind: ts.SyntaxKind.SatisfiesExpression, resolution: 'unwrap-expression' },
      { kind: ts.SyntaxKind.TypeAssertionExpression, resolution: 'unwrap-expression' },
      { kind: ts.SyntaxKind.NonNullExpression, resolution: 'unwrap-expression' },
      { kind: 'default', resolution: 'fail-closed' },
    ]);
  });

  it('resolves star-barrel literal element access and rejects non-literal computed keys', () => {
    const root = sourceFile(
      '/app/browser-root.ts',
      "export { trustedHtml as html } from '@kovojs/browser';",
    );
    const barrel = sourceFile('/app/browser-barrel.ts', "export * from './browser-root';");
    const usage = sourceFile(
      '/app/usage.tsx',
      [
        "import * as safeHtml from './browser-barrel';",
        "const key = 'html';",
        "safeHtml['html']('<strong>ok</strong>');",
        "safeHtml[key]('<strong>opaque</strong>');",
      ].join('\n'),
    );

    registerFrameworkIdentityProject(usage, [root, barrel]);

    expect(
      canonicalFrameworkExportForExpression(
        ts,
        usage,
        callExpressionByText(usage, "safeHtml['html']").expression,
      ),
    ).toEqual(trustedHtmlIdentity);
    expect(
      canonicalFrameworkExportForExpression(
        ts,
        usage,
        callExpressionByText(usage, 'safeHtml[key]').expression,
      ),
    ).toBeUndefined();
  });

  it('resolves local export declarations and fails closed for unsupported expression kinds', () => {
    const local = sourceFile(
      '/app/browser-local.ts',
      [
        "import { trustedHtml } from '@kovojs/browser';",
        'const localTrustedHtml = trustedHtml;',
        'export { localTrustedHtml as html };',
      ].join('\n'),
    );
    const usage = sourceFile(
      '/app/usage.tsx',
      [
        "import { html } from './browser-local';",
        'html("<strong>ok</strong>");',
        'const opaque = html || fallback;',
      ].join('\n'),
    );

    registerFrameworkIdentityProject(usage, [local]);

    expect(
      canonicalFrameworkExportForExpression(
        ts,
        usage,
        callExpressionByText(usage, 'html').expression,
      ),
    ).toEqual(trustedHtmlIdentity);
    expect(
      canonicalFrameworkExportForExpression(ts, usage, initializerByName(usage, 'opaque')),
    ).toBeUndefined();
  });
});
