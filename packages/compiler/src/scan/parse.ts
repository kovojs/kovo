import ts from 'typescript';

export interface ComponentOptionEntry {
  key: string;
  value: string;
}

export interface CallExpressionModel {
  arguments: readonly string[];
  end: number;
  name: string;
  start: number;
}

export interface JsxExpressionModel {
  end: number;
  expression: string;
  start: number;
}

export interface JsxAttributeModel {
  end: number;
  expression?: string;
  expressionEnd?: number;
  expressionStart?: number;
  name: string;
  start: number;
  value?: string;
}

export interface JsxElementModel {
  attributes: readonly JsxAttributeModel[];
  closingStart: number;
  end: number;
  openingEnd: number;
  selfClosing: boolean;
  start: number;
  tag: string;
}

export interface ComponentModel {
  explicitName?: string;
  localName?: string;
  options: readonly ComponentOptionEntry[];
  renderInputs: readonly string[];
  stateReturnObject?: string;
}

export interface ComponentModuleModel {
  calls: readonly CallExpressionModel[];
  components: readonly ComponentModel[];
  jsxExpressions: readonly JsxExpressionModel[];
  jsxElements: readonly JsxElementModel[];
}

export function parseComponentModule(fileName: string, source: string): ComponentModuleModel {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const calls: CallExpressionModel[] = [];
  const components: ComponentModel[] = [];
  const jsxExpressions: JsxExpressionModel[] = [];
  const jsxElements: JsxElementModel[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isExportedVariable(node)) {
      const model = componentModelFromInitializer(
        sourceFile,
        source,
        node.name.text,
        node.initializer,
      );
      if (model) components.push(model);
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      jsxElements.push(jsxElementModel(sourceFile, source, node));
    }
    if (ts.isJsxExpression(node) && node.expression) {
      jsxExpressions.push(jsxExpressionModel(sourceFile, source, node.expression));
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      calls.push(callExpressionModel(sourceFile, source, node));
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return { calls, components, jsxExpressions, jsxElements };
}

function isExportedVariable(node: ts.VariableDeclaration): boolean {
  const statement = node.parent.parent;
  return ts.isVariableStatement(statement) && hasExportModifier(statement);
}

function hasExportModifier(node: ts.VariableStatement): boolean {
  return Boolean(
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

export function firstComponentModel(model: ComponentModuleModel): ComponentModel | null {
  return model.components[0] ?? null;
}

export function componentOptionSource(
  model: ComponentModuleModel,
  propertyName: string,
): string | null {
  return (
    firstComponentModel(model)?.options.find((option) => option.key === propertyName)?.value ?? null
  );
}

export function componentRenderInputs(model: ComponentModuleModel): string[] {
  return [...(firstComponentModel(model)?.renderInputs ?? [])];
}

export function componentStateReturnObject(model: ComponentModuleModel): string | null {
  return firstComponentModel(model)?.stateReturnObject ?? null;
}

export function componentExplicitNames(model: ComponentModuleModel): string[] {
  return model.components.flatMap((component) =>
    component.explicitName === undefined ? [] : [component.explicitName],
  );
}

export function componentFragmentTargetNames(model: ComponentModuleModel): string[] {
  return model.components.flatMap((component) => {
    if (component.options.find((option) => option.key === 'fragmentTarget')?.value !== 'true') {
      return [];
    }

    return [component.localName, component.explicitName].filter(
      (name): name is string => name !== undefined,
    );
  });
}

export function jsxElements(model: ComponentModuleModel): JsxElementModel[] {
  return [...model.jsxElements];
}

export function callExpressions(model: ComponentModuleModel): CallExpressionModel[] {
  return [...model.calls];
}

export function jsxExpressions(model: ComponentModuleModel): JsxExpressionModel[] {
  return [...model.jsxExpressions];
}

function componentModelFromInitializer(
  sourceFile: ts.SourceFile,
  source: string,
  localName: string,
  initializer: ts.Expression | undefined,
): ComponentModel | null {
  if (!initializer || !ts.isCallExpression(initializer)) return null;
  if (!ts.isIdentifier(initializer.expression) || initializer.expression.text !== 'component')
    return null;

  const [nameArg, optionsArg] = initializer.arguments;
  const explicitName = nameArg && ts.isStringLiteralLike(nameArg) ? nameArg.text : undefined;
  const options =
    optionsArg && ts.isObjectLiteralExpression(optionsArg)
      ? componentOptions(sourceFile, source, optionsArg)
      : [];
  const render = componentPropertyInitializer(optionsArg, 'render');
  const state = componentPropertyInitializer(optionsArg, 'state');
  const stateReturnObject = state ? arrowReturnObjectSource(sourceFile, source, state) : null;

  return {
    ...(explicitName === undefined ? {} : { explicitName }),
    localName,
    options,
    renderInputs: render ? arrowObjectPatternKeys(render) : [],
    ...(stateReturnObject === null ? {} : { stateReturnObject }),
  };
}

function componentPropertyInitializer(
  optionsObject: ts.Expression | undefined,
  propertyName: string,
): ts.Expression | null {
  if (!optionsObject || !ts.isObjectLiteralExpression(optionsObject)) return null;

  for (const property of optionsObject.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.name) === propertyName) return property.initializer;
  }

  return null;
}

function componentOptions(
  sourceFile: ts.SourceFile,
  source: string,
  optionsObject: ts.ObjectLiteralExpression,
): ComponentOptionEntry[] {
  return optionsObject.properties.flatMap((property) => {
    if (!ts.isPropertyAssignment(property)) return [];

    const key = propertyNameText(property.name);
    if (!key) return [];

    return [
      {
        key,
        value: source.slice(
          property.initializer.getStart(sourceFile),
          property.initializer.getEnd(),
        ),
      },
    ];
  });
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return null;
}

function jsxElementModel(
  sourceFile: ts.SourceFile,
  source: string,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
): JsxElementModel {
  const openingElement = ts.isJsxElement(node) ? node.openingElement : node;
  const closingStart = ts.isJsxElement(node)
    ? node.closingElement.getStart(sourceFile)
    : node.getEnd();

  return {
    attributes: openingElement.attributes.properties.flatMap((property) => {
      if (!ts.isJsxAttribute(property)) return [];

      const value = staticJsxAttributeValue(property);
      const expression = jsxAttributeExpression(sourceFile, source, property);
      return [
        {
          end: property.getEnd(),
          name: property.name.getText(sourceFile),
          start: property.getStart(sourceFile),
          ...(expression === null ? {} : expression),
          ...(value === undefined ? {} : { value }),
        },
      ];
    }),
    closingStart,
    end: node.getEnd(),
    openingEnd: openingElement.getEnd(),
    selfClosing: !ts.isJsxElement(node),
    start: node.getStart(sourceFile),
    tag: openingElement.tagName.getText(sourceFile),
  };
}

function staticJsxAttributeValue(attribute: ts.JsxAttribute): string | undefined {
  const initializer = attribute.initializer;
  return initializer && ts.isStringLiteral(initializer) ? initializer.text : undefined;
}

function callExpressionModel(
  sourceFile: ts.SourceFile,
  source: string,
  node: ts.CallExpression,
): CallExpressionModel {
  return {
    arguments: node.arguments.map((argument) =>
      source.slice(argument.getStart(sourceFile), argument.getEnd()),
    ),
    end: node.getEnd(),
    name: node.expression.getText(sourceFile),
    start: node.getStart(sourceFile),
  };
}

function jsxExpressionModel(
  sourceFile: ts.SourceFile,
  source: string,
  expression: ts.Expression,
): JsxExpressionModel {
  const start = expression.getStart(sourceFile);
  const end = expression.getEnd();
  return {
    end,
    expression: source.slice(start, end).trim(),
    start,
  };
}

function jsxAttributeExpression(
  sourceFile: ts.SourceFile,
  source: string,
  attribute: ts.JsxAttribute,
): { expression: string; expressionEnd: number; expressionStart: number } | null {
  const initializer = attribute.initializer;
  if (!initializer || !ts.isJsxExpression(initializer) || !initializer.expression) return null;

  const expressionStart = initializer.expression.getStart(sourceFile);
  const expressionEnd = initializer.expression.getEnd();
  return {
    expression: source.slice(expressionStart, expressionEnd).trim(),
    expressionEnd,
    expressionStart,
  };
}

function arrowObjectPatternKeys(expression: ts.Expression): string[] {
  if (!ts.isArrowFunction(expression)) return [];

  const firstParam = expression.parameters[0];
  if (!firstParam || !ts.isObjectBindingPattern(firstParam.name)) return [];

  return firstParam.name.elements.flatMap((element) =>
    ts.isIdentifier(element.name) ? [element.name.text] : [],
  );
}

function arrowReturnObjectSource(
  sourceFile: ts.SourceFile,
  source: string,
  expression: ts.Expression,
): string | null {
  if (!ts.isArrowFunction(expression)) return null;

  const body = ts.isParenthesizedExpression(expression.body)
    ? expression.body.expression
    : expression.body;
  if (!ts.isObjectLiteralExpression(body)) return null;

  return source.slice(body.getStart(sourceFile), body.getEnd());
}
