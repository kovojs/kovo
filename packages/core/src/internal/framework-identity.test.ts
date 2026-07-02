import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  canonicalFrameworkExportForExpression,
  expressionAtSpan,
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

function expectedExpressionSyntaxKinds(): readonly ts.SyntaxKind[] {
  return [
    ts.SyntaxKind.PropertyAccessExpression,
    ts.SyntaxKind.ElementAccessExpression,
    ts.SyntaxKind.NewExpression,
    ts.SyntaxKind.CallExpression,
    ts.SyntaxKind.JsxElement,
    ts.SyntaxKind.JsxSelfClosingElement,
    ts.SyntaxKind.JsxFragment,
    ts.SyntaxKind.TaggedTemplateExpression,
    ts.SyntaxKind.ArrayLiteralExpression,
    ts.SyntaxKind.ParenthesizedExpression,
    ts.SyntaxKind.ObjectLiteralExpression,
    ts.SyntaxKind.ClassExpression,
    ts.SyntaxKind.FunctionExpression,
    ts.SyntaxKind.Identifier,
    ts.SyntaxKind.PrivateIdentifier,
    ts.SyntaxKind.RegularExpressionLiteral,
    ts.SyntaxKind.NumericLiteral,
    ts.SyntaxKind.BigIntLiteral,
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateExpression,
    ts.SyntaxKind.FalseKeyword,
    ts.SyntaxKind.NullKeyword,
    ts.SyntaxKind.ThisKeyword,
    ts.SyntaxKind.TrueKeyword,
    ts.SyntaxKind.SuperKeyword,
    ts.SyntaxKind.NonNullExpression,
    ts.SyntaxKind.ExpressionWithTypeArguments,
    ts.SyntaxKind.MetaProperty,
    ts.SyntaxKind.ImportKeyword,
    ts.SyntaxKind.MissingDeclaration,
    ts.SyntaxKind.PrefixUnaryExpression,
    ts.SyntaxKind.PostfixUnaryExpression,
    ts.SyntaxKind.DeleteExpression,
    ts.SyntaxKind.TypeOfExpression,
    ts.SyntaxKind.VoidExpression,
    ts.SyntaxKind.AwaitExpression,
    ts.SyntaxKind.TypeAssertionExpression,
    ts.SyntaxKind.ConditionalExpression,
    ts.SyntaxKind.YieldExpression,
    ts.SyntaxKind.ArrowFunction,
    ts.SyntaxKind.BinaryExpression,
    ts.SyntaxKind.SpreadElement,
    ts.SyntaxKind.AsExpression,
    ts.SyntaxKind.OmittedExpression,
    ts.SyntaxKind.CommaListExpression,
    ts.SyntaxKind.PartiallyEmittedExpression,
    ts.SyntaxKind.SatisfiesExpression,
  ];
}

describe('framework identity resolver', () => {
  it('publishes an expression-kind table with a fail-closed default', () => {
    const rows = frameworkIdentityExpressionKindRows(ts);
    const expressionRows = rows.filter((row) => row.kind !== 'default');
    const resolutionByKind = new Map(expressionRows.map((row) => [row.kind, row.resolution]));
    const statusByKind = new Map(expressionRows.map((row) => [row.kind, row.status]));

    expect(rows.at(-1)).toEqual({
      kind: 'default',
      resolution: 'fail-closed',
      status: 'fails-closed',
    });
    expect(new Set(expressionRows.map((row) => row.kind))).toEqual(
      new Set(expectedExpressionSyntaxKinds()),
    );
    expect(rows).toHaveLength(expectedExpressionSyntaxKinds().length + 1);
    expect(new Set(rows.map((row) => row.status))).toEqual(new Set(['resolved', 'fails-closed']));
    expect(resolutionByKind.get(ts.SyntaxKind.Identifier)).toBe('resolve-identifier');
    expect(statusByKind.get(ts.SyntaxKind.Identifier)).toBe('resolved');
    expect(resolutionByKind.get(ts.SyntaxKind.PropertyAccessExpression)).toBe(
      'resolve-property-access',
    );
    expect(statusByKind.get(ts.SyntaxKind.PropertyAccessExpression)).toBe('resolved');
    expect(resolutionByKind.get(ts.SyntaxKind.ElementAccessExpression)).toBe(
      'resolve-element-access',
    );
    expect(statusByKind.get(ts.SyntaxKind.ElementAccessExpression)).toBe('resolved');
    expect(resolutionByKind.get(ts.SyntaxKind.ParenthesizedExpression)).toBe('unwrap-expression');
    expect(statusByKind.get(ts.SyntaxKind.ParenthesizedExpression)).toBe('resolved');
    expect(resolutionByKind.get(ts.SyntaxKind.AsExpression)).toBe('unwrap-expression');
    expect(resolutionByKind.get(ts.SyntaxKind.SatisfiesExpression)).toBe('unwrap-expression');
    expect(resolutionByKind.get(ts.SyntaxKind.TypeAssertionExpression)).toBe('unwrap-expression');
    expect(resolutionByKind.get(ts.SyntaxKind.NonNullExpression)).toBe('unwrap-expression');
    expect(resolutionByKind.get(ts.SyntaxKind.CallExpression)).toBe('resolve-call-expression');
    expect(statusByKind.get(ts.SyntaxKind.CallExpression)).toBe('resolved');
    expect(resolutionByKind.get(ts.SyntaxKind.BinaryExpression)).toBe('fail-closed');
    expect(statusByKind.get(ts.SyntaxKind.BinaryExpression)).toBe('fails-closed');
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
        "import * as safeHtml from './browser-barrel.js';",
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

  it('resolves framework exports through local object literal members', () => {
    const usage = sourceFile(
      '/app/usage.tsx',
      [
        "import { trustedHtml } from '@kovojs/browser';",
        'const trust = { html: trustedHtml };',
        'const alias = trust;',
        "trust.html('<strong>ok</strong>');",
        "alias.html('<strong>ok</strong>');",
        "trust['html']('<strong>ok</strong>');",
        "trust[String('html')]('<strong>opaque</strong>');",
      ].join('\n'),
    );

    expect(
      canonicalFrameworkExportForExpression(
        ts,
        usage,
        callExpressionByText(usage, 'trust.html').expression,
      ),
    ).toEqual(trustedHtmlIdentity);
    expect(
      canonicalFrameworkExportForExpression(
        ts,
        usage,
        callExpressionByText(usage, 'alias.html').expression,
      ),
    ).toEqual(trustedHtmlIdentity);
    expect(
      canonicalFrameworkExportForExpression(
        ts,
        usage,
        callExpressionByText(usage, "trust['html']").expression,
      ),
    ).toEqual(trustedHtmlIdentity);
    expect(
      canonicalFrameworkExportForExpression(
        ts,
        usage,
        callExpressionByText(usage, "trust[String('html')]").expression,
      ),
    ).toBeUndefined();
  });

  it('indexes fail-closed expression kinds for source span lookups', () => {
    const usage = sourceFile(
      '/app/usage.tsx',
      [
        "import { trustedHtml } from '@kovojs/browser';",
        "const mixed = trustedHtml('<strong>safe</strong>') + taint;",
      ].join('\n'),
    );
    const expression = initializerByName(usage, 'mixed');
    const indexed = expressionAtSpan(ts, usage, {
      end: expression.getEnd(),
      start: expression.getStart(usage),
    });

    expect(indexed?.kind).toBe(ts.SyntaxKind.BinaryExpression);
    expect(canonicalFrameworkExportForExpression(ts, usage, indexed!)).toBeUndefined();
  });
});
