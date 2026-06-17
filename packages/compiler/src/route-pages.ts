import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';

import type {
  CompileRouteModuleOptions,
  CompileRouteModuleResult,
  RoutePageComponentFact,
  RoutePageComponentPropFact,
  RoutePageFact,
} from './types.js';
import type { StaticLiteralValue } from './scan/object.js';
import { applySourceReplacements, replaceExtension, type SourceReplacement } from './shared.js';

interface CompiledRoutePage {
  fact: RoutePageFact;
  pageReplacement: SourceReplacement;
}

interface RoutePageHandler {
  node: ts.Node;
  replacementEnd: number;
  replacementPrefix: string;
  replacementStart: number;
  sourceExpression: string;
}

/** Compile route-page JSX composition facts (SPEC.md §4.5/§9.1). */
export function compileRouteModule(options: CompileRouteModuleOptions): CompileRouteModuleResult {
  const sourceFile = ts.createSourceFile(
    options.fileName,
    options.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const routePages: CompiledRoutePage[] = [];

  const visit = (node: ts.Node): void => {
    const routePage = routePageFromCall(options.fileName, sourceFile, node);
    if (routePage) routePages.push(routePage);
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  const routePageFacts = routePages.map((routePage) => routePage.fact);

  const artifactFileName = options.artifactFileName ?? routeArtifactFileName(options.fileName);

  return {
    diagnostics: [],
    files:
      routePages.length === 0
        ? []
        : [
            {
              fileName: artifactFileName,
              kind: 'route',
              source: emitCompiledRouteModule({
                artifactFileName,
                routePages,
                source: options.source,
                sourceFile,
              }),
            },
          ],
    routePageFacts,
  };
}

function routePageFromCall(
  fileName: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
): CompiledRoutePage | null {
  if (!ts.isCallExpression(node)) return null;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'route') return null;

  const [pathArg, definitionArg] = node.arguments;
  if (!pathArg || !ts.isStringLiteralLike(pathArg)) return null;
  if (!definitionArg || !ts.isObjectLiteralExpression(definitionArg)) return null;

  const pageHandler = objectPageHandler(definitionArg, 'page', sourceFile);
  if (!pageHandler) return null;

  const components = routePageComponentFacts(sourceFile, pageHandler.node);
  if (components.length === 0) return null;
  const fact = {
    components,
    fileName,
    route: pathArg.text,
  };

  return {
    fact,
    pageReplacement: {
      end: pageHandler.replacementEnd,
      replacement: `${pageHandler.replacementPrefix}__kovoDefineCompiledRoutePage(${JSON.stringify(fact)}, ${pageHandler.sourceExpression})`,
      start: pageHandler.replacementStart,
    },
  };
}

function objectPageHandler(
  object: ts.ObjectLiteralExpression,
  name: string,
  sourceFile: ts.SourceFile,
): RoutePageHandler | null {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && propertyNameText(property.name) === name) {
      const start = property.initializer.getStart(sourceFile);
      return {
        node: property.initializer,
        replacementEnd: property.initializer.getEnd(),
        replacementPrefix: '',
        replacementStart: start,
        sourceExpression: sourceFile.text.slice(start, property.initializer.getEnd()),
      };
    }

    if (ts.isMethodDeclaration(property) && propertyNameText(property.name) === name) {
      return {
        node: property,
        replacementEnd: property.getEnd(),
        replacementPrefix: `${name}: `,
        replacementStart: property.getStart(sourceFile),
        sourceExpression: methodDeclarationFunctionExpression(property, sourceFile),
      };
    }
  }
  return null;
}

function methodDeclarationFunctionExpression(
  method: ts.MethodDeclaration,
  sourceFile: ts.SourceFile,
): string {
  const asyncKeyword = method.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
    ? 'async '
    : '';
  const typeParameters =
    method.typeParameters && method.typeParameters.length > 0
      ? `<${method.typeParameters.map((parameter) => parameter.getText(sourceFile)).join(', ')}>`
      : '';
  const parameters = method.parameters.map((parameter) => parameter.getText(sourceFile)).join(', ');
  const returnType = method.type ? `: ${method.type.getText(sourceFile)}` : '';
  const body = method.body?.getText(sourceFile) ?? '{}';
  return `${asyncKeyword}function ${propertyNameText(method.name) ?? 'page'}${typeParameters}(${parameters})${returnType} ${body}`;
}

function routePageComponentFacts(
  sourceFile: ts.SourceFile,
  root: ts.Node,
): RoutePageComponentFact[] {
  const facts: RoutePageComponentFact[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      const tag = jsxTagName(node.openingElement.tagName);
      if (tag && componentTagName(tag)) {
        facts.push(routePageComponentFact(sourceFile, tag, node.openingElement.attributes));
      }
    } else if (ts.isJsxSelfClosingElement(node)) {
      const tag = jsxTagName(node.tagName);
      if (tag && componentTagName(tag)) {
        facts.push(routePageComponentFact(sourceFile, tag, node.attributes));
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(root);
  return facts;
}

function routePageComponentFact(
  sourceFile: ts.SourceFile,
  localName: string,
  attributes: ts.JsxAttributes,
): RoutePageComponentFact {
  const allProps = routePageComponentProps(sourceFile, attributes);
  const key = allProps.find((prop) => prop.name === 'key');
  const props = allProps.filter((prop) => prop.name !== 'key');
  const propsExpression = routePagePropsExpression(props);

  return {
    ...(key ? { keyExpression: key.expression } : {}),
    localName,
    props,
    propsExpression,
    serializedPropsExpression: `JSON.stringify(${propsExpression})`,
  };
}

function routePageComponentProps(
  sourceFile: ts.SourceFile,
  attributes: ts.JsxAttributes,
): RoutePageComponentPropFact[] {
  return attributes.properties.flatMap((attribute) => {
    if (!ts.isJsxAttribute(attribute)) return [];
    if (!ts.isIdentifier(attribute.name)) return [];
    const name = attribute.name.text;

    if (attribute.initializer === undefined) {
      return [{ expression: 'true', name, staticValue: true }];
    }

    if (ts.isStringLiteral(attribute.initializer)) {
      return [{ expression: attribute.initializer.getText(sourceFile), name, staticValue: attribute.initializer.text }];
    }

    if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) return [];

    const expression = attribute.initializer.expression;
    const staticValue = staticLiteralValue(expression);
    const propertyAccesses = propertyAccessPaths(expression);
    return [
      {
        expression: expression.getText(sourceFile),
        name,
        ...(propertyAccesses.length > 0 ? { propertyAccesses } : {}),
        ...(staticValue === undefined ? {} : { staticValue }),
      },
    ];
  });
}

function routePagePropsExpression(props: readonly RoutePageComponentPropFact[]): string {
  if (props.length === 0) return '{}';
  return `{ ${props.map((prop) => `${prop.name}: ${prop.expression}`).join(', ')} }`;
}

function componentTagName(tag: string): boolean {
  return /^[A-Z]/.test(tag);
}

function jsxTagName(name: ts.JsxTagNameExpression): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isPropertyAccessExpression(name)) return name.getText();
  return null;
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function staticLiteralValue(expression: ts.Expression): StaticLiteralValue | undefined {
  const unwrapped = unwrapExpression(expression);
  if (ts.isStringLiteralLike(unwrapped)) return unwrapped.text;
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (unwrapped.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isNumericLiteral(unwrapped)) return Number(unwrapped.text);
  if (ts.isPrefixUnaryExpression(unwrapped) && ts.isNumericLiteral(unwrapped.operand)) {
    if (unwrapped.operator === ts.SyntaxKind.MinusToken) return -Number(unwrapped.operand.text);
    if (unwrapped.operator === ts.SyntaxKind.PlusToken) return Number(unwrapped.operand.text);
  }
  return undefined;
}

function propertyAccessPaths(expression: ts.Expression): string[] {
  const paths: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      const path = propertyAccessPath(node);
      if (path) paths.push(path);
    }
    ts.forEachChild(node, visit);
  };

  visit(expression);
  return [...new Set(paths)];
}

function propertyAccessPath(expression: ts.PropertyAccessExpression): string | null {
  const receiver = propertyAccessReceiverSegments(expression.expression);
  if (!receiver) return null;
  return [...receiver, expression.name.text].join('.');
}

function propertyAccessReceiverSegments(expression: ts.Expression): string[] | null {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (!ts.isPropertyAccessExpression(expression)) return null;
  const path = propertyAccessPath(expression);
  return path ? path.split('.') : null;
}

function emitCompiledRouteModule(options: {
  artifactFileName: string;
  routePages: readonly CompiledRoutePage[];
  source: string;
  sourceFile: ts.SourceFile;
}): string {
  const replacements: SourceReplacement[] = options.routePages.map(
    (routePage) => routePage.pageReplacement,
  );
  const lowered = applySourceReplacements(options.source, [
    ...rebaseRelativeImportReplacements(options.sourceFile, options.artifactFileName),
    ...replacements,
  ]);
  const importSource =
    "import { defineCompiledRoutePage as __kovoDefineCompiledRoutePage } from '@kovojs/server/internal/route';\n";
  const insertAt = routeModuleImportInsertionIndex(lowered);

  return [
    `// @kovojs-ir - lowered route module generated by @kovojs/compiler (SPEC.md section 4.5). Do not edit.\n`,
    lowered.slice(0, insertAt),
    importSource,
    lowered.slice(insertAt),
  ].join('');
}

function routeModuleImportInsertionIndex(source: string): number {
  const shebang = source.startsWith('#!') ? source.indexOf('\n') + 1 : 0;
  const leading = source.slice(shebang);
  const jsxImportSource = leading.match(/^\/\*\*?\s*@jsxImportSource[\s\S]*?\*\/\s*/);
  if (jsxImportSource) return shebang + jsxImportSource[0].length;
  return shebang;
}

function routeArtifactFileName(fileName: string): string {
  return replaceExtension(fileName, '.kovo-route.tsx');
}

function rebaseRelativeImportReplacements(
  sourceFile: ts.SourceFile,
  artifactFileName: string,
): SourceReplacement[] {
  if (sameDirectory(sourceFile.fileName, artifactFileName)) return [];

  const replacements: SourceReplacement[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      const rebased = rebaseRelativeSpecifier(specifier, sourceFile.fileName, artifactFileName);
      if (rebased && rebased !== specifier) {
        replacements.push({
          end: node.moduleSpecifier.getEnd(),
          replacement: JSON.stringify(rebased),
          start: node.moduleSpecifier.getStart(sourceFile),
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return replacements;
}

function sameDirectory(leftFileName: string, rightFileName: string): boolean {
  return normalizePath(dirname(leftFileName)) === normalizePath(dirname(rightFileName));
}

function rebaseRelativeSpecifier(
  specifier: string,
  sourceFileName: string,
  artifactFileName: string,
): string | null {
  if (!specifier.startsWith('.')) return null;

  const absoluteTarget = resolve(dirname(sourceFileName), specifier);
  const relativeTarget = normalizePath(relative(dirname(artifactFileName), absoluteTarget));
  return relativeTarget.startsWith('.') ? relativeTarget : `./${relativeTarget}`;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}
