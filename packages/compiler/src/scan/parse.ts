import ts from 'typescript';

import type { StaticLiteralValue } from './object.js';

export interface ComponentOptionEntry {
  key: string;
  objectEntries?: readonly ObjectLiteralEntry[];
  value: string;
}

export interface ObjectLiteralEntry {
  key: string;
  value?: string;
}

export interface MutationHandlerModel {
  body: string;
  bodyEnd: number;
  bodyPropertyAccesses: readonly PropertyAccessPathModel[];
  bodyStart: number;
  paramNames: readonly (string | undefined)[];
  params: readonly string[];
  paramSpans: readonly SourceSpan[];
}

export interface PropertyAccessPathModel {
  end: number;
  inferredType?: 'boolean' | 'number';
  path: string;
  start: number;
}

export interface DocumentElementActionModel {
  action: 'method' | 'toggle-open';
  method?: string;
  target: string;
}

export interface CallExpressionModel {
  arguments: readonly string[];
  argumentArrowFunctionParts: readonly (ArrowFunctionPartsModel | null)[];
  argumentObjectLiteralPaths: readonly (readonly string[])[];
  argumentPropertyAccesses: readonly (readonly PropertyAccessPathModel[])[];
  argumentSpans: readonly SourceSpan[];
  argumentStringLiteralArrayValues: readonly (readonly string[] | null)[];
  argumentStaticValues: readonly (StaticLiteralValue | undefined)[];
  end: number;
  exportedConstName?: string;
  name: string;
  start: number;
}

export interface ArrowFunctionPartsModel {
  expression: string;
  param: string;
}

export interface SourceSpan {
  end: number;
  start: number;
}

export interface JsxExpressionModel {
  end: number;
  expression: string;
  propertyAccesses: readonly PropertyAccessPathModel[];
  references: readonly string[];
  solePropertyAccessPath?: string;
  start: number;
}

export interface JsxCommentModel {
  end: number;
  start: number;
  text: string;
}

export interface JsxAttributeModel {
  end: number;
  expression?: string;
  expressionEnd?: number;
  expressionPropertyAccesses?: readonly PropertyAccessPathModel[];
  expressionReferences?: readonly string[];
  expressionStart?: number;
  expressionStaticValue?: StaticLiteralValue;
  name: string;
  start: number;
  value?: string;
  zeroArgArrow?: ZeroArgArrowModel;
}

export interface JsxElementModel {
  ancestorTags: readonly string[];
  attributes: readonly JsxAttributeModel[];
  closingStart: number;
  end: number;
  openingEnd: number;
  openingSource: string;
  selfClosing: boolean;
  start: number;
  tag: string;
}

export interface JsxElementChildBody {
  offset: number;
  source: string;
}

export interface ZeroArgArrowModel {
  body: string;
  bodyEnd: number;
  bodyKind: 'block' | 'expression';
  callArgumentPropertyAccesses?: readonly (readonly PropertyAccessPathModel[])[];
  callArgumentStaticValues?: readonly (StaticLiteralValue | undefined)[];
  bodyPropertyAccesses: readonly PropertyAccessPathModel[];
  bodyStart: number;
  callArguments?: readonly string[];
  documentElementAction?: DocumentElementActionModel;
  references: readonly string[];
}

export interface ComponentModel {
  explicitName?: string;
  localName?: string;
  options: readonly ComponentOptionEntry[];
  renderHost?: RenderHostModel;
  renderInputs: readonly RenderInputModel[];
  stateReturnObject?: StateReturnObjectModel;
  stringRenderReturns?: readonly StringRenderModel[];
}

export interface RenderHostModel {
  end: number;
  start: number;
}

export interface RenderInputModel {
  end: number;
  name: string;
  start: number;
}

export interface StateReturnObjectModel {
  end: number;
  entries: readonly ObjectLiteralEntry[];
  staticValue?: Record<string, StaticLiteralValue>;
  source: string;
  start: number;
}

export interface StringRenderModel {
  end: number;
  firstHtmlTagName?: string;
  source: string;
  start: number;
}

export interface ComponentModuleModel {
  calls: readonly CallExpressionModel[];
  components: readonly ComponentModel[];
  jsxComments: readonly JsxCommentModel[];
  jsxExpressions: readonly JsxExpressionModel[];
  jsxElements: readonly JsxElementModel[];
  mutationHandlers: readonly MutationHandlerModel[];
  renderSourceReturns: readonly StringRenderModel[];
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
  const jsxComments: JsxCommentModel[] = [];
  const jsxExpressions: JsxExpressionModel[] = [];
  const jsxElements: JsxElementModel[] = [];
  const mutationHandlers: MutationHandlerModel[] = [];
  const renderSourceReturns: StringRenderModel[] = [];

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
    if (ts.isJsxExpression(node)) {
      const comment = jsxCommentModel(sourceFile, source, node);
      if (comment) jsxComments.push(comment);
      if (node.expression)
        jsxExpressions.push(jsxExpressionModel(sourceFile, source, node.expression));
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      calls.push(callExpressionModel(sourceFile, source, node));
      if (node.expression.text === 'mutation') {
        mutationHandlers.push(...mutationHandlerModels(sourceFile, source, node));
      }
    }
    if (isExportedRenderSourceFunction(node)) {
      renderSourceReturns.push(
        ...stringRenderReturnsFromFunctionBody(sourceFile, source, node.body),
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return {
    calls,
    components,
    jsxComments,
    jsxExpressions,
    jsxElements,
    mutationHandlers,
    renderSourceReturns,
  };
}

function isExportedVariable(node: ts.VariableDeclaration): boolean {
  const statement = node.parent.parent;
  return ts.isVariableStatement(statement) && hasExportModifier(statement);
}

function hasExportModifier(node: ts.FunctionDeclaration | ts.VariableStatement): boolean {
  return Boolean(
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

function isExportedRenderSourceFunction(node: ts.Node): node is ts.FunctionDeclaration {
  return (
    ts.isFunctionDeclaration(node) && node.name?.text === 'renderSource' && hasExportModifier(node)
  );
}

export function firstComponentModel(model: ComponentModuleModel): ComponentModel | null {
  return model.components[0] ?? null;
}

export function inferComponentName(fileName: string, model: ComponentModuleModel): string {
  const component = firstComponentModel(model);
  if (component?.localName) return component.localName;

  const baseName =
    fileName
      .replace(/\.[^.]+$/, '')
      .split('/')
      .at(-1) ?? 'Component';
  return baseName
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('');
}

export function componentOptionSource(
  model: ComponentModuleModel,
  propertyName: string,
): string | null {
  return (
    firstComponentModel(model)?.options.find((option) => option.key === propertyName)?.value ?? null
  );
}

export function componentOptionObjectEntries(
  model: ComponentModuleModel,
  propertyName: string,
): ObjectLiteralEntry[] {
  return [
    ...(firstComponentModel(model)?.options.find((option) => option.key === propertyName)
      ?.objectEntries ?? []),
  ];
}

export function componentOptionObjectKeys(
  model: ComponentModuleModel,
  propertyName: string,
): string[] {
  return componentOptionObjectEntries(model, propertyName).map((entry) => entry.key);
}

export function componentRenderInputs(model: ComponentModuleModel): string[] {
  return componentRenderInputModels(model).map((input) => input.name);
}

export function componentRenderInputModels(model: ComponentModuleModel): RenderInputModel[] {
  return [...(firstComponentModel(model)?.renderInputs ?? [])];
}

export function componentRenderHost(model: ComponentModuleModel): RenderHostModel | null {
  return firstComponentModel(model)?.renderHost ?? null;
}

export function componentRenderHostElement(model: ComponentModuleModel): JsxElementModel | null {
  const host = componentRenderHost(model);
  if (!host) return null;

  return (
    model.jsxElements.find(
      (element) => element.start === host.start && element.openingEnd === host.end,
    ) ?? null
  );
}

export function componentStateReturnObject(model: ComponentModuleModel): string | null {
  return componentStateReturnObjectModel(model)?.source ?? null;
}

export function componentStateReturnObjectModel(
  model: ComponentModuleModel,
): StateReturnObjectModel | null {
  return firstComponentModel(model)?.stateReturnObject ?? null;
}

export function componentStateReturnObjectKeys(model: ComponentModuleModel): string[] {
  return [...(componentStateReturnObjectModel(model)?.entries.map((entry) => entry.key) ?? [])];
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

export function jsxElementChildBody(
  source: string,
  element: JsxElementModel,
): JsxElementChildBody | null {
  if (element.selfClosing) return null;

  const raw = source.slice(element.openingEnd, element.closingStart);
  const leadingWhitespace = /^\s*/.exec(raw)?.[0].length ?? 0;
  const body = raw.trim();
  if (!body) return null;

  return {
    offset: element.openingEnd + leadingWhitespace,
    source: body,
  };
}

export function callExpressions(model: ComponentModuleModel): CallExpressionModel[] {
  return [...model.calls];
}

export function jsxExpressions(model: ComponentModuleModel): JsxExpressionModel[] {
  return [...model.jsxExpressions];
}

export function jsxComments(model: ComponentModuleModel): JsxCommentModel[] {
  return [...model.jsxComments];
}

export function mutationHandlers(model: ComponentModuleModel): MutationHandlerModel[] {
  return [...model.mutationHandlers];
}

export function identifierReferences(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const declared = new Set<string>();
  const referenced: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      if (isDeclaredIdentifier(node)) declared.add(node.text);
      if (isReferenceIdentifier(node)) referenced.push(node.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return referenced.filter((name) => !declared.has(name));
}

export function propertyAccessPaths(fileName: string, source: string): string[] {
  const sourceFile = parseExpressionSource(fileName, source);
  return propertyAccessPathsFromSourceFile(sourceFile);
}

export function functionBodyPropertyAccessPaths(fileName: string, body: string): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    `function __jiso_scan__() {\n${body}\n}`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return propertyAccessPathsFromSourceFile(sourceFile);
}

function propertyAccessPathsFromSourceFile(sourceFile: ts.SourceFile): string[] {
  const paths: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node)
    ) {
      const path = propertyAccessPath(node);
      if (path) paths.push(path);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return paths;
}

export function solePropertyAccessPath(fileName: string, source: string): string | null {
  const sourceFile = parseExpressionSource(fileName, source);
  const initializer = firstVariableInitializer(sourceFile);
  if (!initializer || !ts.isPropertyAccessExpression(initializer)) return null;

  return propertyAccessPath(initializer);
}

export function soleWrappedPropertyAccessPath(fileName: string, source: string): string | null {
  const trimmed = source.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;

  return solePropertyAccessPath(fileName, trimmed.slice(1, -1).trim());
}

export function stringLiteralArrayValues(fileName: string, source: string): string[] | null {
  const sourceFile = parseExpressionSource(fileName, source);
  const initializer = firstVariableInitializer(sourceFile);
  return initializer ? stringLiteralArrayValuesFromExpression(initializer) : null;
}

export function arrowFunctionParts(
  fileName: string,
  source: string,
): ArrowFunctionPartsModel | null {
  const sourceFile = parseExpressionSource(fileName, source);
  const initializer = firstVariableInitializer(sourceFile);
  return initializer ? arrowFunctionPartsFromExpression(sourceFile, initializer) : null;
}

function stringLiteralArrayValuesFromExpression(expression: ts.Expression): string[] | null {
  if (!ts.isArrayLiteralExpression(expression)) return null;

  const values: string[] = [];
  for (const element of expression.elements) {
    if (!ts.isStringLiteralLike(element)) return null;
    values.push(element.text);
  }

  return values;
}

function arrowFunctionPartsFromExpression(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): ArrowFunctionPartsModel | null {
  if (!ts.isArrowFunction(expression)) return null;

  const param = expression.parameters[0];
  if (!param || expression.parameters.length !== 1 || !ts.isIdentifier(param.name)) return null;
  if (ts.isBlock(expression.body)) return null;

  return {
    expression: expression.body.getText(sourceFile).trim(),
    param: param.name.text,
  };
}

export function documentElementActionFromZeroArgArrow(
  fileName: string,
  source: string,
): DocumentElementActionModel | null {
  const sourceFile = parseExpressionSource(fileName, source);
  const initializer = firstVariableInitializer(sourceFile);
  if (!initializer || !ts.isArrowFunction(initializer) || initializer.parameters.length > 0) {
    return null;
  }
  if (ts.isBlock(initializer.body)) return null;

  return documentElementActionFromExpression(sourceFile, initializer.body);
}

function documentElementActionFromExpression(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): DocumentElementActionModel | null {
  const body = unwrapExpression(expression);
  const methodAction = documentElementMethodAction(sourceFile, body);
  if (methodAction) return methodAction;

  return documentElementToggleOpenAction(sourceFile, body);
}

export function objectLiteralPropertyPaths(fileName: string, source: string): string[] {
  const sourceFile = parseExpressionSource(fileName, source);
  const initializer = firstVariableInitializer(sourceFile);
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) return [];

  return objectLiteralPaths(initializer);
}

function parseExpressionSource(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    `const __jisoExpression = (${source});`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function firstVariableInitializer(sourceFile: ts.SourceFile): ts.Expression | null {
  const statement = sourceFile.statements[0];
  if (!statement || !ts.isVariableStatement(statement)) return null;

  const initializer = statement.declarationList.declarations[0]?.initializer;
  return initializer ? unwrapParenthesizedExpression(initializer) : null;
}

function propertyAccessPath(expression: ts.PropertyAccessExpression): string | null {
  const receiver = propertyAccessReceiverSegments(expression.expression);
  if (!receiver) return null;

  const segments = expression.questionDotToken ? markLastOptional(receiver) : receiver;
  segments.push(expression.name.text);
  return segments.join('.');
}

function propertyAccessReceiverSegments(expression: ts.Expression): string[] | null {
  if (ts.isIdentifier(expression)) return [expression.text];

  if (!ts.isPropertyAccessExpression(expression)) return null;

  return propertyAccessPath(expression)?.split('.') ?? null;
}

function markLastOptional(segments: readonly string[]): string[] {
  const result = [...segments];
  const last = result.at(-1);
  if (last) result[result.length - 1] = last.endsWith('?') ? last : `${last}?`;
  return result;
}

function objectLiteralPaths(expression: ts.ObjectLiteralExpression, prefix = ''): string[] {
  return expression.properties.flatMap((property) => {
    if (ts.isShorthandPropertyAssignment(property)) {
      return [pathWithPrefix(prefix, property.name.text)];
    }

    if (!ts.isPropertyAssignment(property)) return [];

    const key = propertyNameText(property.name);
    if (!key) return [];

    const path = pathWithPrefix(prefix, key);
    return ts.isObjectLiteralExpression(property.initializer)
      ? objectLiteralPaths(property.initializer, path)
      : [path];
  });
}

function pathWithPrefix(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

function documentElementMethodAction(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): DocumentElementActionModel | null {
  if (!ts.isCallExpression(expression) || expression.arguments.length > 0) return null;

  const callee = unwrapExpression(expression.expression);
  if (!ts.isPropertyAccessExpression(callee)) return null;

  const target = documentGetElementByIdTarget(sourceFile, callee.expression);
  return target ? { action: 'method', method: callee.name.text, target } : null;
}

function documentElementToggleOpenAction(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): DocumentElementActionModel | null {
  if (
    !ts.isBinaryExpression(expression) ||
    expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
  ) {
    return null;
  }

  const leftTarget = documentElementOpenTarget(sourceFile, expression.left);
  if (!leftTarget) return null;

  const right = unwrapExpression(expression.right);
  if (!ts.isPrefixUnaryExpression(right) || right.operator !== ts.SyntaxKind.ExclamationToken) {
    return null;
  }

  const rightTarget = documentElementOpenTarget(sourceFile, right.operand);
  return rightTarget === leftTarget ? { action: 'toggle-open', target: leftTarget } : null;
}

function documentElementOpenTarget(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): string | null {
  const property = unwrapExpression(expression);
  if (!ts.isPropertyAccessExpression(property) || property.name.text !== 'open') return null;
  return documentGetElementByIdTarget(sourceFile, property.expression);
}

function documentGetElementByIdTarget(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): string | null {
  const call = unwrapExpression(expression);
  if (!ts.isCallExpression(call) || call.arguments.length !== 1) return null;

  const callee = unwrapExpression(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'getElementById') {
    return null;
  }

  const receiver = unwrapExpression(callee.expression);
  if (!ts.isIdentifier(receiver) || receiver.text !== 'document') return null;

  const target = call.arguments[0];
  if (!target) return null;
  return ts.isStringLiteralLike(target) ? target.text : null;
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

function isDeclaredIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isFunctionExpression(parent) && parent.name === node) ||
    (ts.isClassDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.name === node)
  );
}

function isReferenceIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (isDeclaredIdentifier(node)) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false;
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return false;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  return true;
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
    ...(render ? renderHostModel(sourceFile, render) : {}),
    renderInputs: render ? arrowObjectPatternKeys(sourceFile, render) : [],
    ...(stateReturnObject === null ? {} : { stateReturnObject }),
    ...(render ? { stringRenderReturns: stringRenderReturns(sourceFile, source, render) } : {}),
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
        ...(ts.isObjectLiteralExpression(property.initializer)
          ? { objectEntries: objectLiteralEntries(sourceFile, source, property.initializer) }
          : {}),
        value: source.slice(
          property.initializer.getStart(sourceFile),
          property.initializer.getEnd(),
        ),
      },
    ];
  });
}

function stringRenderReturns(
  sourceFile: ts.SourceFile,
  source: string,
  render: ts.Expression,
): StringRenderModel[] {
  if (!ts.isArrowFunction(render) && !ts.isFunctionExpression(render)) return [];

  if (ts.isBlock(render.body)) {
    return stringRenderReturnsFromFunctionBody(sourceFile, source, render.body);
  }

  return stringRenderModel(sourceFile, source, render.body);
}

function stringRenderReturnsFromFunctionBody(
  sourceFile: ts.SourceFile,
  source: string,
  body: ts.Block | undefined,
): StringRenderModel[] {
  if (!body) return [];

  return body.statements.flatMap((statement) =>
    ts.isReturnStatement(statement) && statement.expression
      ? stringRenderModel(sourceFile, source, statement.expression)
      : [],
  );
}

function stringRenderModel(
  sourceFile: ts.SourceFile,
  source: string,
  expression: ts.Expression,
): StringRenderModel[] {
  const unwrapped = unwrapParentheses(expression);
  if (
    !ts.isStringLiteralLike(unwrapped) &&
    !ts.isNoSubstitutionTemplateLiteral(unwrapped) &&
    !ts.isTemplateExpression(unwrapped)
  ) {
    return [];
  }

  return [
    {
      end: unwrapped.getEnd(),
      ...optionalFirstHtmlTagName(unwrapped),
      source: source.slice(unwrapped.getStart(sourceFile), unwrapped.getEnd()),
      start: unwrapped.getStart(sourceFile),
    },
  ];
}

function optionalFirstHtmlTagName(
  expression: ts.StringLiteralLike | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression,
): { firstHtmlTagName: string } | {} {
  const tagName = firstHtmlTagNameFromLiteralText(stringRenderLiteralText(expression));
  return tagName ? { firstHtmlTagName: tagName } : {};
}

function stringRenderLiteralText(
  expression: ts.StringLiteralLike | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression,
): string {
  if (ts.isTemplateExpression(expression)) {
    return [
      expression.head.text,
      ...expression.templateSpans.map((span) => span.literal.text),
    ].join('{}');
  }

  return expression.text;
}

function firstHtmlTagNameFromLiteralText(source: string): string | null {
  return /<\s*([A-Za-z][\w:-]*)(?:\s|>|\/)/.exec(source)?.[1] ?? null;
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function mutationHandlerModels(
  sourceFile: ts.SourceFile,
  source: string,
  call: ts.CallExpression,
): MutationHandlerModel[] {
  const options = call.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return [];

  return options.properties.flatMap((property) => {
    if (ts.isMethodDeclaration(property) && propertyNameText(property.name) === 'handler') {
      return property.body
        ? [
            {
              body: source.slice(property.body.getStart(sourceFile), property.body.getEnd()),
              bodyEnd: property.body.getEnd(),
              bodyPropertyAccesses: propertyAccessPathModels(sourceFile, property.body),
              bodyStart: property.body.getStart(sourceFile),
              paramNames: property.parameters.map((param) => parameterName(param.name)),
              params: property.parameters.map((param) =>
                source.slice(param.getStart(sourceFile), param.getEnd()),
              ),
              paramSpans: property.parameters.map((param) => ({
                end: param.getEnd(),
                start: param.getStart(sourceFile),
              })),
            },
          ]
        : [];
    }

    if (!ts.isPropertyAssignment(property) || propertyNameText(property.name) !== 'handler') {
      return [];
    }

    const initializer = property.initializer;
    if (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer)) return [];

    return [
      {
        body: source.slice(initializer.body.getStart(sourceFile), initializer.body.getEnd()),
        bodyEnd: initializer.body.getEnd(),
        bodyPropertyAccesses: propertyAccessPathModels(sourceFile, initializer.body),
        bodyStart: initializer.body.getStart(sourceFile),
        paramNames: initializer.parameters.map((param) => parameterName(param.name)),
        params: initializer.parameters.map((param) =>
          source.slice(param.getStart(sourceFile), param.getEnd()),
        ),
        paramSpans: initializer.parameters.map((param) => ({
          end: param.getEnd(),
          start: param.getStart(sourceFile),
        })),
      },
    ];
  });
}

function parameterName(name: ts.BindingName): string | undefined {
  if (ts.isIdentifier(name)) return name.text;
  if (!ts.isObjectBindingPattern(name)) return undefined;
  const element = name.elements[0];
  if (
    element &&
    name.elements.length === 1 &&
    ts.isIdentifier(element.name) &&
    element.propertyName === undefined
  ) {
    return element.name.text;
  }
  return undefined;
}

function propertyAccessPathModels(
  sourceFile: ts.SourceFile,
  root: ts.Node,
): PropertyAccessPathModel[] {
  const paths: PropertyAccessPathModel[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node)
    ) {
      const path = propertyAccessPath(node);
      if (path) {
        paths.push({
          end: node.getEnd(),
          ...propertyAccessInferredType(sourceFile, node),
          path,
          start: node.getStart(sourceFile),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(root);

  return paths;
}

function propertyAccessInferredType(
  sourceFile: ts.SourceFile,
  node: ts.PropertyAccessExpression,
): { inferredType: 'boolean' | 'number' } | {} {
  const inferredType = expressionUsageType(sourceFile, node);
  if (inferredType) return { inferredType };

  return {};
}

export function expressionUsageType(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): 'boolean' | 'number' | undefined {
  if (isBooleanUsage(sourceFile, node)) return 'boolean';
  if (isNumberUsage(sourceFile, node)) return 'number';
  return undefined;
}

function isBooleanUsage(sourceFile: ts.SourceFile, node: ts.Node): boolean {
  const parent = node.parent;

  if (ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken) {
    return parent.operand === node;
  }

  if (ts.isConditionalExpression(parent) && parent.condition === node) return true;
  if (ts.isIfStatement(parent) && parent.expression === node) return true;
  if (ts.isWhileStatement(parent) && parent.expression === node) return true;
  if (ts.isDoStatement(parent) && parent.expression === node) return true;

  if (!ts.isBinaryExpression(parent)) return false;

  if (
    parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    parent.operatorToken.kind === ts.SyntaxKind.BarBarToken
  ) {
    return parent.left === node || parent.right === node;
  }

  return (
    isEqualityOperator(parent.operatorToken.kind) &&
    ((parent.left === node && isBooleanLiteral(sourceFile, parent.right)) ||
      (parent.right === node && isBooleanLiteral(sourceFile, parent.left)))
  );
}

function isNumberUsage(sourceFile: ts.SourceFile, node: ts.Node): boolean {
  const parent = node.parent;
  if (!ts.isBinaryExpression(parent)) return false;

  if (
    isArithmeticOperator(parent.operatorToken.kind) ||
    isArithmeticAssignmentOperator(parent.operatorToken.kind)
  ) {
    return parent.left === node || parent.right === node;
  }

  return (
    (isEqualityOperator(parent.operatorToken.kind) ||
      isOrderingOperator(parent.operatorToken.kind)) &&
    ((parent.left === node && isNumericLiteral(sourceFile, parent.right)) ||
      (parent.right === node && isNumericLiteral(sourceFile, parent.left)))
  );
}

function isEqualityOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    kind === ts.SyntaxKind.EqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsToken
  );
}

function isOrderingOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.LessThanToken ||
    kind === ts.SyntaxKind.LessThanEqualsToken ||
    kind === ts.SyntaxKind.GreaterThanToken ||
    kind === ts.SyntaxKind.GreaterThanEqualsToken
  );
}

function isArithmeticOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.MinusToken ||
    kind === ts.SyntaxKind.AsteriskToken ||
    kind === ts.SyntaxKind.SlashToken ||
    kind === ts.SyntaxKind.PercentToken
  );
}

function isArithmeticAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.PlusEqualsToken ||
    kind === ts.SyntaxKind.MinusEqualsToken ||
    kind === ts.SyntaxKind.AsteriskEqualsToken ||
    kind === ts.SyntaxKind.SlashEqualsToken ||
    kind === ts.SyntaxKind.PercentEqualsToken
  );
}

function isBooleanLiteral(sourceFile: ts.SourceFile, node: ts.Node): boolean {
  const text = node.getText(sourceFile);
  return text === 'true' || text === 'false';
}

function isNumericLiteral(sourceFile: ts.SourceFile, node: ts.Node): boolean {
  return /^-?\d(?:\d|\.)*$/.test(node.getText(sourceFile));
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return null;
}

function objectLiteralEntries(
  sourceFile: ts.SourceFile,
  source: string,
  expression: ts.ObjectLiteralExpression,
): ObjectLiteralEntry[] {
  return expression.properties.flatMap((property) => {
    if (ts.isPropertyAssignment(property)) {
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
    }

    if (ts.isShorthandPropertyAssignment(property)) {
      return [{ key: property.name.text, value: property.name.text }];
    }

    if (ts.isMethodDeclaration(property)) {
      const key = propertyNameText(property.name);
      return key ? [{ key }] : [];
    }

    return [];
  });
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
    ancestorTags: jsxAncestorTags(sourceFile, node),
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
    openingSource: source.slice(openingElement.getStart(sourceFile), openingElement.getEnd()),
    selfClosing: !ts.isJsxElement(node),
    start: node.getStart(sourceFile),
    tag: openingElement.tagName.getText(sourceFile),
  };
}

function jsxAncestorTags(sourceFile: ts.SourceFile, node: ts.Node): string[] {
  const tags: string[] = [];
  let current = node.parent;

  while (current) {
    if (ts.isJsxElement(current)) {
      tags.push(current.openingElement.tagName.getText(sourceFile));
    }
    current = current.parent;
  }

  return tags;
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
    argumentArrowFunctionParts: node.arguments.map((argument) =>
      arrowFunctionPartsFromExpression(sourceFile, argument),
    ),
    argumentObjectLiteralPaths: node.arguments.map((argument) =>
      ts.isObjectLiteralExpression(argument) ? objectLiteralPaths(argument) : [],
    ),
    argumentPropertyAccesses: node.arguments.map((argument) =>
      propertyAccessPathModels(sourceFile, argument),
    ),
    argumentSpans: node.arguments.map((argument) => ({
      end: argument.getEnd(),
      start: argument.getStart(sourceFile),
    })),
    argumentStringLiteralArrayValues: node.arguments.map((argument) =>
      stringLiteralArrayValuesFromExpression(argument),
    ),
    argumentStaticValues: node.arguments.map((argument) => staticLiteralValue(argument)),
    end: node.getEnd(),
    ...exportedConstInitializerName(node),
    name: node.expression.getText(sourceFile),
    start: node.getStart(sourceFile),
  };
}

function exportedConstInitializerName(node: ts.CallExpression): { exportedConstName: string } | {} {
  const declaration = node.parent;
  if (
    !ts.isVariableDeclaration(declaration) ||
    declaration.initializer !== node ||
    !ts.isIdentifier(declaration.name) ||
    !isExportedVariable(declaration)
  ) {
    return {};
  }

  return { exportedConstName: declaration.name.text };
}

function jsxExpressionModel(
  sourceFile: ts.SourceFile,
  source: string,
  expression: ts.Expression,
): JsxExpressionModel {
  const start = expression.getStart(sourceFile);
  const end = expression.getEnd();
  const solePath = solePropertyAccessPathFromExpression(expression);
  return {
    end,
    expression: source.slice(start, end).trim(),
    propertyAccesses: propertyAccessPathModels(sourceFile, expression),
    references: referenceIdentifiers(expression),
    ...(solePath ? { solePropertyAccessPath: solePath } : {}),
    start,
  };
}

function jsxCommentModel(
  sourceFile: ts.SourceFile,
  source: string,
  node: ts.JsxExpression,
): JsxCommentModel | null {
  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  const text = source.slice(start, end);
  if (!/^\{\s*\/\*[\s\S]*\*\/\s*\}$/.test(text)) return null;

  return {
    end,
    start,
    text,
  };
}

function jsxAttributeExpression(
  sourceFile: ts.SourceFile,
  source: string,
  attribute: ts.JsxAttribute,
): {
  expression: string;
  expressionEnd: number;
  expressionPropertyAccesses: readonly PropertyAccessPathModel[];
  expressionReferences: readonly string[];
  expressionStart: number;
  expressionStaticValue?: StaticLiteralValue;
  zeroArgArrow?: ZeroArgArrowModel;
} | null {
  const initializer = attribute.initializer;
  if (!initializer || !ts.isJsxExpression(initializer) || !initializer.expression) return null;

  const expressionStart = initializer.expression.getStart(sourceFile);
  const expressionEnd = initializer.expression.getEnd();
  return {
    expression: source.slice(expressionStart, expressionEnd).trim(),
    expressionEnd,
    expressionPropertyAccesses: propertyAccessPathModels(sourceFile, initializer.expression),
    expressionReferences: referenceIdentifiers(initializer.expression),
    expressionStart,
    ...jsxAttributeExpressionStaticValue(initializer.expression),
    ...zeroArgArrowModel(sourceFile, source, initializer.expression),
  };
}

function jsxAttributeExpressionStaticValue(
  expression: ts.Expression,
): { expressionStaticValue: StaticLiteralValue } | {} {
  const value = staticLiteralValue(expression);
  return value === undefined ? {} : { expressionStaticValue: value };
}

function solePropertyAccessPathFromExpression(expression: ts.Expression): string | null {
  const unwrapped = unwrapExpression(expression);
  return ts.isPropertyAccessExpression(unwrapped) ? propertyAccessPath(unwrapped) : null;
}

function zeroArgArrowModel(
  sourceFile: ts.SourceFile,
  source: string,
  expression: ts.Expression,
): { zeroArgArrow: ZeroArgArrowModel } | {} {
  if (!ts.isArrowFunction(expression) || expression.parameters.length > 0) return {};

  const body = expression.body;
  const bodyStart = ts.isBlock(body) ? body.getStart(sourceFile) + 1 : body.getStart(sourceFile);
  const bodyEnd = ts.isBlock(body) ? body.getEnd() - 1 : body.getEnd();
  const bodySource = source.slice(bodyStart, bodyEnd).trim();
  const callArguments =
    !ts.isBlock(body) && ts.isCallExpression(body)
      ? body.arguments.map((argument) =>
          source.slice(argument.getStart(sourceFile), argument.getEnd()),
        )
      : undefined;
  const callArgumentPropertyAccesses =
    !ts.isBlock(body) && ts.isCallExpression(body)
      ? body.arguments.map((argument) => propertyAccessPathModels(sourceFile, argument))
      : undefined;
  const callArgumentStaticValues =
    !ts.isBlock(body) && ts.isCallExpression(body)
      ? body.arguments.map((argument) => staticLiteralValue(argument))
      : undefined;

  return {
    zeroArgArrow: {
      body: bodySource,
      bodyEnd,
      bodyKind: ts.isBlock(body) ? 'block' : 'expression',
      ...(callArgumentPropertyAccesses === undefined ? {} : { callArgumentPropertyAccesses }),
      ...(callArgumentStaticValues === undefined ? {} : { callArgumentStaticValues }),
      bodyPropertyAccesses: propertyAccessPathModels(sourceFile, body),
      bodyStart,
      ...(callArguments === undefined ? {} : { callArguments }),
      ...documentElementActionModel(sourceFile, body),
      references: referenceIdentifiers(body),
    },
  };
}

function documentElementActionModel(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
): { documentElementAction: DocumentElementActionModel } | {} {
  if (ts.isBlock(body)) return {};

  const action = documentElementActionFromExpression(sourceFile, body);
  return action ? { documentElementAction: action } : {};
}

function referenceIdentifiers(root: ts.Node): string[] {
  const declared = new Set<string>();
  const referenced: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      if (isDeclaredIdentifier(node)) declared.add(node.text);
      if (isReferenceIdentifier(node)) referenced.push(node.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(root);
  return referenced.filter((name) => !declared.has(name));
}

function arrowObjectPatternKeys(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): RenderInputModel[] {
  if (!ts.isArrowFunction(expression)) return [];

  const firstParam = expression.parameters[0];
  if (!firstParam || !ts.isObjectBindingPattern(firstParam.name)) return [];

  return firstParam.name.elements.flatMap((element) =>
    ts.isIdentifier(element.name)
      ? [
          {
            end: element.name.getEnd(),
            name: element.name.text,
            start: element.name.getStart(sourceFile),
          },
        ]
      : [],
  );
}

function renderHostModel(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): { renderHost: RenderHostModel } | null {
  if (!ts.isArrowFunction(expression)) return null;

  const returned = renderReturnExpression(expression.body);
  if (!returned) return null;

  const host = unwrapParenthesizedExpression(returned);
  if (ts.isJsxElement(host)) {
    return {
      renderHost: {
        end: host.openingElement.getEnd(),
        start: host.openingElement.getStart(sourceFile),
      },
    };
  }

  if (ts.isJsxSelfClosingElement(host)) {
    return {
      renderHost: {
        end: host.getEnd(),
        start: host.getStart(sourceFile),
      },
    };
  }

  return null;
}

function renderReturnExpression(body: ts.ConciseBody): ts.Expression | null {
  if (ts.isBlock(body)) {
    for (const statement of body.statements) {
      if (ts.isReturnStatement(statement) && statement.expression) return statement.expression;
    }
    return null;
  }

  return body;
}

function unwrapParenthesizedExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function arrowReturnObjectSource(
  sourceFile: ts.SourceFile,
  source: string,
  expression: ts.Expression,
): StateReturnObjectModel | null {
  if (!ts.isArrowFunction(expression)) return null;

  const body = ts.isParenthesizedExpression(expression.body)
    ? expression.body.expression
    : expression.body;
  if (!ts.isObjectLiteralExpression(body)) return null;

  const start = body.getStart(sourceFile);
  const end = body.getEnd();
  return {
    end,
    entries: objectLiteralEntries(sourceFile, source, body),
    ...stateReturnStaticValue(body),
    source: source.slice(start, end),
    start,
  };
}

function stateReturnStaticValue(
  expression: ts.ObjectLiteralExpression,
): { staticValue: Record<string, StaticLiteralValue> } | {} {
  const value = staticObjectLiteralValue(expression);
  return value === undefined ? {} : { staticValue: value };
}

function staticObjectLiteralValue(
  expression: ts.ObjectLiteralExpression,
): Record<string, StaticLiteralValue> | undefined {
  const value: Record<string, StaticLiteralValue> = {};

  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) return undefined;

    const key = propertyNameText(property.name);
    if (!key) return undefined;

    const literal = staticLiteralValue(property.initializer);
    if (literal === undefined) return undefined;
    value[key] = literal;
  }

  return value;
}

function staticLiteralValue(expression: ts.Expression): StaticLiteralValue | undefined {
  const unwrapped = unwrapExpression(expression);

  if (ts.isStringLiteralLike(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
    return unwrapped.text;
  }

  if (ts.isNumericLiteral(unwrapped)) return Number(unwrapped.text);
  if (
    ts.isPrefixUnaryExpression(unwrapped) &&
    unwrapped.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(unwrapped.operand)
  ) {
    return -Number(unwrapped.operand.text);
  }

  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (unwrapped.kind === ts.SyntaxKind.NullKeyword) return null;

  return ts.isObjectLiteralExpression(unwrapped) ? staticObjectLiteralValue(unwrapped) : undefined;
}
