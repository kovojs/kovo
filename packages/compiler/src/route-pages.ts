import ts from 'typescript';

import type {
  CompileRouteModuleOptions,
  CompileRouteModuleResult,
  RoutePageComponentFact,
  RoutePageComponentPropFact,
  RoutePageFact,
} from './types.js';
import type { StaticLiteralValue } from './scan/object.js';

/** Compile route-page JSX composition facts (SPEC.md §4.5/§9.1). */
export function compileRouteModule(options: CompileRouteModuleOptions): CompileRouteModuleResult {
  const sourceFile = ts.createSourceFile(
    options.fileName,
    options.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const routePageFacts: RoutePageFact[] = [];

  const visit = (node: ts.Node): void => {
    const fact = routePageFactFromCall(options.fileName, sourceFile, node);
    if (fact) routePageFacts.push(fact);
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return {
    diagnostics: [],
    routePageFacts,
  };
}

function routePageFactFromCall(
  fileName: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
): RoutePageFact | null {
  if (!ts.isCallExpression(node)) return null;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'route') return null;

  const [pathArg, definitionArg] = node.arguments;
  if (!pathArg || !ts.isStringLiteralLike(pathArg)) return null;
  if (!definitionArg || !ts.isObjectLiteralExpression(definitionArg)) return null;

  const pageInitializer = objectPropertyInitializer(definitionArg, 'page');
  if (!pageInitializer) return null;

  const pageJsx = pageJsxExpression(pageInitializer);
  if (!pageJsx) return null;

  return {
    components: routePageComponentFacts(sourceFile, pageJsx),
    fileName,
    route: pathArg.text,
  };
}

function objectPropertyInitializer(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | null {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.name) === name) return property.initializer;
  }
  return null;
}

function pageJsxExpression(expression: ts.Expression): ts.JsxElement | ts.JsxSelfClosingElement | null {
  const unwrapped = unwrapExpression(expression);
  if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
    if (ts.isBlock(unwrapped.body)) {
      return returnJsxExpression(unwrapped.body);
    }
    return jsxExpression(unwrapped.body);
  }
  return null;
}

function returnJsxExpression(block: ts.Block): ts.JsxElement | ts.JsxSelfClosingElement | null {
  const returns = block.statements.filter(ts.isReturnStatement);
  if (returns.length !== 1) return null;
  const expression = returns[0]?.expression;
  return expression ? jsxExpression(expression) : null;
}

function jsxExpression(expression: ts.Expression): ts.JsxElement | ts.JsxSelfClosingElement | null {
  const unwrapped = unwrapExpression(expression);
  if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped)) return unwrapped;
  return null;
}

function routePageComponentFacts(
  sourceFile: ts.SourceFile,
  root: ts.JsxElement | ts.JsxSelfClosingElement,
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
