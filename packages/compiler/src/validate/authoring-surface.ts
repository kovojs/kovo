import { diagnosticDefinitions } from '@jiso/core';
import ts from 'typescript';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import { compilerIrHeader, cssIrHeader } from '../ir.js';
import type { CompileComponentOptions } from '../types.js';

interface StringRender {
  length: number;
  source: string;
  start: number;
}

export function validateAuthoringSurface(options: CompileComponentOptions): CompilerDiagnostic[] {
  if ((options.sourceProvenance ?? 'app') !== 'app') return [];

  if (isCompilerIrArtifact(options.source)) {
    return [
      fw235Diagnostic({
        fileName: options.fileName,
        source: options.source,
        start: 0,
        length: options.source.startsWith(compilerIrHeader)
          ? compilerIrHeader.length
          : cssIrHeader.length,
        stringSource: options.source,
      }),
    ];
  }

  return stringRenderedComponents(options.fileName, options.source).map((render) =>
    fw235Diagnostic({
      fileName: options.fileName,
      source: options.source,
      start: render.start,
      length: render.length,
      stringSource: render.source,
    }),
  );
}

export function isCompilerIrArtifact(source: string): boolean {
  return source.startsWith(compilerIrHeader) || source.startsWith(cssIrHeader);
}

function stringRenderedComponents(fileName: string, source: string): StringRender[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const renders: StringRender[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'component') {
        renders.push(...componentStringRenderReturns(sourceFile, source, node));
      }
    }

    if (ts.isFunctionDeclaration(node) && node.name?.text === 'renderSource' && isExported(node)) {
      renders.push(...htmlStringReturns(sourceFile, source, node.body));
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return renders;
}

function componentStringRenderReturns(
  sourceFile: ts.SourceFile,
  source: string,
  node: ts.CallExpression,
): StringRender[] {
  const options = node.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return [];

  const render = options.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && propertyNameText(property.name) === 'render',
  );
  if (!render) return [];

  const initializer = render.initializer;
  if (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer)) return [];

  if (ts.isBlock(initializer.body)) {
    return htmlStringReturns(sourceFile, source, initializer.body);
  }

  return htmlStringLiteral(sourceFile, source, initializer.body);
}

function htmlStringReturns(
  sourceFile: ts.SourceFile,
  source: string,
  body: ts.Block | undefined,
): StringRender[] {
  if (!body) return [];

  return body.statements.flatMap((statement) =>
    ts.isReturnStatement(statement) && statement.expression
      ? htmlStringLiteral(sourceFile, source, statement.expression)
      : [],
  );
}

function htmlStringLiteral(
  sourceFile: ts.SourceFile,
  source: string,
  expression: ts.Expression,
): StringRender[] {
  const unwrapped = unwrapParentheses(expression);
  if (
    !ts.isStringLiteralLike(unwrapped) &&
    !ts.isNoSubstitutionTemplateLiteral(unwrapped) &&
    !ts.isTemplateExpression(unwrapped)
  ) {
    return [];
  }

  const renderSource = source.slice(unwrapped.getStart(sourceFile), unwrapped.getEnd());
  if (!containsHtmlTag(renderSource)) return [];

  return [
    {
      length: unwrapped.getEnd() - unwrapped.getStart(sourceFile),
      source: renderSource,
      start: unwrapped.getStart(sourceFile),
    },
  ];
}

function fw235Diagnostic({
  fileName,
  length,
  source,
  start,
  stringSource,
}: {
  fileName: string;
  length: number;
  source: string;
  start: number;
  stringSource: string;
}): CompilerDiagnostic {
  const tag = firstHtmlTagName(stringSource);
  const tsxDirection = tag
    ? `TSX equivalent direction: render with JSX, for example \`render: (...) => (<${tag}>...</${tag}>)\`, and use typed expressions such as \`{cart.count}\` instead of data-bind strings.`
    : 'TSX equivalent direction: render with JSX and use typed expressions such as `{cart.count}` instead of data-bind strings.';

  return {
    ...diagnosticFor(fileName, 'FW235', source, start, length),
    help: [diagnosticDefinitions.FW235.help, tsxDirection].join('\n'),
  };
}

function containsHtmlTag(source: string): boolean {
  return /<\s*[a-zA-Z][\w:-]*(?:\s|>|\/)/.test(source);
}

function firstHtmlTagName(source: string): string | null {
  return /<\s*([a-zA-Z][\w:-]*)(?:\s|>|\/)/.exec(source)?.[1] ?? null;
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return null;
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function isExported(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;

  return Boolean(
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}
