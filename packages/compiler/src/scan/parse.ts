import { createRequire } from 'node:module';
import * as ts from 'typescript';

import type { StaticLiteralValue } from './object.js';
import type {
  ArrowFunctionPartsModel,
  CallExpressionModel,
  ComponentModel,
  ComponentModuleModel,
  ComponentOptionEntry,
  DocumentElementActionModel,
  IdentifierReferenceModel,
  JsxCommentModel,
  JsxElementChildBody,
  JsxElementModel,
  JsxExpressionModel,
  ModuleScopeBindingModel,
  ModuleSpecifierModel,
  MutationHandlerModel,
  NamedImportModel,
  ObjectLiteralEntry,
  PropertyAccessPathModel,
  RenderHostModel,
  RenderInputModel,
  RenderSlotsModel,
  SourceSpan,
  StateReturnObjectModel,
  StringRenderModel,
  TemporalReadModel,
  ZeroArgArrowCallArgumentKind,
  ZeroArgArrowModel,
  WireSchemaBudgetFact,
  WireSchemaCollectionFact,
} from './model.js';

export type * from './model.js';

const mutableTs = ts as unknown as Record<string, unknown>;
if (!('ScriptTarget' in mutableTs))
  Object.assign(mutableTs, createRequire(import.meta.url)('typescript') as typeof ts);

/**
 * @internal FN7 (plans/compiler-refactoring.md): the canonical source parse. The scanner uses it,
 * and it is shared with the other compiler phases that must read app source (StyleX extraction and
 * its imported static-value modules) so the `ts.createSourceFile` boundary lives only in scan/
 * (SPEC.md §5.2 rule 9).
 */
export function parseSourceFile(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

export function parseComponentModule(fileName: string, source: string): ComponentModuleModel {
  const sourceFile = parseSourceFile(fileName, source);
  const calls: CallExpressionModel[] = [];
  const components: ComponentModel[] = [];
  const jsxComments: JsxCommentModel[] = [];
  const jsxExpressions: JsxExpressionModel[] = [];
  const jsxElements: JsxElementModel[] = [];
  const moduleScopeBindings: ModuleScopeBindingModel[] = [];
  const moduleScopeSecretBindings = new Map<string, ModuleScopeBindingModel['secretProvenance']>();
  const moduleSpecifiers: ModuleSpecifierModel[] = [];
  const mutationHandlers: MutationHandlerModel[] = [];
  const namedImports: NamedImportModel[] = [];
  const renderSourceReturns: StringRenderModel[] = [];
  const schemaBindings = moduleScopeSchemaInitializers(sourceFile);
  const wireSchemaBudgets: WireSchemaBudgetFact[] = [];

  const visit = (node: ts.Node): void => {
    const specifier = moduleSpecifierModel(node);
    if (specifier) moduleSpecifiers.push(specifier);
    namedImports.push(...namedImportModels(node));
    const bindings = moduleScopeBindingModels(sourceFile, source, node, moduleScopeSecretBindings);
    moduleScopeBindings.push(...bindings);
    for (const binding of bindings) {
      if (binding.secretProvenance) {
        moduleScopeSecretBindings.set(binding.name, binding.secretProvenance);
      }
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isExportedVariable(node)) {
      const model = componentModelFromInitializer(
        sourceFile,
        source,
        node.name.text,
        { end: node.name.getEnd(), start: node.name.getStart(sourceFile) },
        node.parent.parent.getEnd(),
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
      if (node.expression) jsxExpressions.push(jsxExpressionModel(sourceFile, source, node));
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      calls.push(callExpressionModel(sourceFile, source, node));
      if (node.expression.text === 'mutation') {
        mutationHandlers.push(...mutationHandlerModels(sourceFile, source, node));
      }
    }
    if (ts.isCallExpression(node)) {
      wireSchemaBudgets.push(...wireSchemaBudgetFactsFromCall(sourceFile, node, schemaBindings));
    }
    if (isExportedRenderSourceFunction(node)) {
      renderSourceReturns.push(
        ...stringRenderReturnsFromFunctionBody(sourceFile, source, node.body),
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  const model: ComponentModuleModel = {
    calls,
    components,
    jsxComments,
    jsxExpressions,
    jsxElements,
    moduleScopeBindings,
    moduleSpecifiers,
    mutationHandlers,
    namedImports,
    renderSourceReturns,
    sourceFile,
    wireSchemaBudgets,
  };
  // FN7: keep the scanner's SourceFile non-enumerable so post-parse phases (StyleX extraction)
  // reuse it rather than re-parsing the component, while the model stays a serializable fact bag.
  Object.defineProperty(model, 'sourceFile', { enumerable: false });
  return model;
}

function moduleSpecifierModel(node: ts.Node): ModuleSpecifierModel | null {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    ts.isStringLiteralLike(node.moduleSpecifier)
  ) {
    return {
      end: node.moduleSpecifier.getEnd(),
      specifier: node.moduleSpecifier.text,
      start: node.moduleSpecifier.getStart(),
    };
  }

  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const [argument] = node.arguments;
    if (argument && ts.isStringLiteralLike(argument)) {
      return {
        end: argument.getEnd(),
        specifier: argument.text,
        start: argument.getStart(),
      };
    }
  }

  return null;
}

function namedImportModels(node: ts.Node): NamedImportModel[] {
  if (
    !ts.isImportDeclaration(node) ||
    !node.moduleSpecifier ||
    !ts.isStringLiteralLike(node.moduleSpecifier)
  ) {
    return [];
  }

  const bindings = node.importClause?.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return [];
  const moduleSpecifier = node.moduleSpecifier.text;

  return bindings.elements.map((element) => ({
    importedName: element.propertyName?.text ?? element.name.text,
    localName: element.name.text,
    moduleSpecifier,
  }));
}

function moduleScopeSchemaInitializers(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, ts.Expression> {
  const bindings = new Map<string, ts.Expression>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      bindings.set(declaration.name.text, declaration.initializer);
    }
  }
  return bindings;
}

function wireSchemaBudgetFactsFromCall(
  sourceFile: ts.SourceFile,
  node: ts.CallExpression,
  schemaBindings: ReadonlyMap<string, ts.Expression>,
): WireSchemaBudgetFact[] {
  const surfaceKind = wireSurfaceKind(node.expression);
  if (!surfaceKind) return [];

  const options = node.arguments[1];
  if (!options) return [];
  const optionsObject = unwrapExpression(options);
  if (!ts.isObjectLiteralExpression(optionsObject)) return [];

  return wireSurfaceSchemaRoles(surfaceKind).flatMap((schemaRole) => {
    const schema = objectPropertyExpression(optionsObject, schemaRole);
    if (!schema) return [];
    const collections = wireSchemaCollections(sourceFile, schema, schemaBindings);
    if (collections.length === 0) return [];
    return [
      {
        collections,
        schemaRole,
        surfaceKind,
        surfaceName: wireSurfaceName(node, surfaceKind),
      },
    ];
  });
}

function wireSurfaceKind(
  expression: ts.LeftHandSideExpression,
): WireSchemaBudgetFact['surfaceKind'] | null {
  const callee = unwrapExpression(expression);
  if (!ts.isIdentifier(callee)) return null;
  if (
    callee.text === 'endpoint' ||
    callee.text === 'mutation' ||
    callee.text === 'query' ||
    callee.text === 'route' ||
    callee.text === 'webhook'
  ) {
    return callee.text;
  }
  return null;
}

function wireSurfaceSchemaRoles(
  surfaceKind: WireSchemaBudgetFact['surfaceKind'],
): readonly WireSchemaBudgetFact['schemaRole'][] {
  if (surfaceKind === 'query') return ['args'];
  if (surfaceKind === 'route') return ['params', 'search'];
  return ['input'];
}

function wireSurfaceName(
  node: ts.CallExpression,
  surfaceKind: WireSchemaBudgetFact['surfaceKind'],
): string {
  const [firstArg] = node.arguments;
  if (firstArg && ts.isStringLiteralLike(firstArg)) return firstArg.text;
  const declaration = node.parent;
  if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)) {
    return declaration.name.text;
  }
  return surfaceKind;
}

function objectPropertyExpression(
  object: ts.ObjectLiteralExpression,
  propertyName: string,
): ts.Expression | null {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.name) === propertyName) return property.initializer;
  }
  return null;
}

function wireSchemaCollections(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  schemaBindings: ReadonlyMap<string, ts.Expression>,
): WireSchemaCollectionFact[] {
  const collections: WireSchemaCollectionFact[] = [];
  const seenBindings = new Set<string>();

  const visit = (node: ts.Node, boundedByCollectionMax = false): void => {
    if (ts.isExpression(node)) {
      const unwrapped = unwrapExpression(node);
      if (unwrapped !== node) {
        visit(unwrapped, boundedByCollectionMax);
        return;
      }
    }

    if (ts.isIdentifier(node)) {
      if (!isReferenceIdentifier(node)) return;
      const binding = schemaBindings.get(node.text);
      if (!binding || seenBindings.has(node.text)) return;
      seenBindings.add(node.text);
      visit(binding, boundedByCollectionMax);
      seenBindings.delete(node.text);
      return;
    }

    if (ts.isCallExpression(node)) {
      if (isSchemaHelperCall(node, 'lazy')) return;

      if (isSchemaCollectionCall(node, 'array') || isSchemaCollectionCall(node, 'record')) {
        collections.push({
          bounded: boundedByCollectionMax,
          end: node.expression.getEnd(),
          kind: schemaCollectionKind(node),
          start: node.expression.getStart(sourceFile),
        });
        node.arguments.forEach((argument) => visit(argument, false));
        return;
      }

      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'max') {
        visit(node.expression.expression, true);
        node.arguments.forEach((argument) => visit(argument, false));
        return;
      }
    }

    ts.forEachChild(node, (child) => visit(child, boundedByCollectionMax));
  };

  visit(expression);
  return collections;
}

function isSchemaCollectionCall(
  node: ts.CallExpression,
  kind: WireSchemaCollectionFact['kind'],
): boolean {
  return isSchemaHelperCall(node, kind);
}

function schemaCollectionKind(node: ts.CallExpression): WireSchemaCollectionFact['kind'] {
  return isSchemaCollectionCall(node, 'record') ? 'record' : 'array';
}

function isSchemaHelperCall(node: ts.CallExpression, methodName: string): boolean {
  const callee = unwrapExpression(node.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== methodName) return false;
  const receiver = unwrapExpression(callee.expression);
  return ts.isIdentifier(receiver) && receiver.text === 's';
}

function moduleScopeBindingModels(
  sourceFile: ts.SourceFile,
  source: string,
  node: ts.Node,
  secretBindings: ReadonlyMap<string, ModuleScopeBindingModel['secretProvenance']>,
): ModuleScopeBindingModel[] {
  if (!ts.isVariableStatement(node) || node.parent !== sourceFile) return [];

  return node.declarationList.declarations.flatMap((declaration) => {
    if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) return [];

    const value = staticLiteralValue(declaration.initializer);
    const secretProvenance = moduleScopeSecretProvenance(declaration.initializer, secretBindings);
    const publishToClient = moduleScopePublishToClient(sourceFile, source, declaration.initializer);
    if (value === undefined && secretProvenance === undefined && publishToClient === undefined)
      return [];

    return [
      {
        name: declaration.name.text,
        ...(publishToClient === undefined ? {} : { publishToClient }),
        ...(secretProvenance === undefined ? {} : { secretProvenance }),
        source: source.slice(
          declaration.initializer.getStart(sourceFile),
          declaration.initializer.getEnd(),
        ),
        ...(value === undefined ? {} : { staticValue: value }),
      },
    ];
  });
}

function moduleScopeSecretProvenance(
  initializer: ts.Expression,
  secretBindings: ReadonlyMap<string, ModuleScopeBindingModel['secretProvenance']>,
): ModuleScopeBindingModel['secretProvenance'] | undefined {
  let found: ModuleScopeBindingModel['secretProvenance'] | undefined;

  const visit = (node: ts.Node): void => {
    if (found) return;
    const path = ts.isPropertyAccessExpression(node) ? propertyAccessPath(node) : null;
    if (path === 'process.env' || path?.startsWith('process.env.')) {
      found = { kind: 'process-env' };
      return;
    }
    if (ts.isCallExpression(node) && isSecretCallExpression(node)) {
      found = { kind: 'secret-call' };
      return;
    }
    if (ts.isIdentifier(node) && isReferenceIdentifier(node) && secretBindings.has(node.text)) {
      found = { kind: 'derived' };
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(initializer);
  return found;
}

function moduleScopePublishToClient(
  sourceFile: ts.SourceFile,
  source: string,
  initializer: ts.Expression,
): ModuleScopeBindingModel['publishToClient'] | undefined {
  const call = unwrapExpression(initializer);
  if (!ts.isCallExpression(call) || !isPublishToClientCallExpression(call)) return undefined;

  const [value, options] = call.arguments;
  if (!value || !options || !ts.isObjectLiteralExpression(options)) return undefined;

  const reason = publishToClientReason(options);
  if (!reason?.trim()) return undefined;

  return {
    reason,
    source: source.slice(value.getStart(sourceFile), value.getEnd()),
  };
}

function publishToClientReason(options: ts.ObjectLiteralExpression): string | undefined {
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property) || propertyNameText(property.name) !== 'reason') {
      continue;
    }

    const value = staticLiteralValue(property.initializer);
    return typeof value === 'string' ? value : undefined;
  }

  return undefined;
}

function isSecretCallExpression(node: ts.CallExpression): boolean {
  const callee = unwrapExpression(node.expression);
  if (ts.isIdentifier(callee)) return callee.text === 'secret';
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text === 'secret';
  return false;
}

function isPublishToClientCallExpression(node: ts.CallExpression): boolean {
  const callee = unwrapExpression(node.expression);
  if (ts.isIdentifier(callee)) return callee.text === 'publishToClient';
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text === 'publishToClient';
  return false;
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

export function componentOptionStaticValue(
  model: ComponentModuleModel,
  propertyName: string,
): StaticLiteralValue | undefined {
  return firstComponentModel(model)?.options.find((option) => option.key === propertyName)
    ?.staticValue;
}

export function componentOptionStaticTemplateValue(
  model: ComponentModuleModel,
  propertyName: string,
): string | undefined {
  return firstComponentModel(model)?.options.find((option) => option.key === propertyName)
    ?.staticTemplateValue;
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

export function componentRenderSlotsParam(model: ComponentModuleModel): RenderInputModel | null {
  return firstComponentModel(model)?.renderSlotsParam ?? null;
}

// SPEC §4.5/§4.8 (KV316): present iff the component's render declares a children/named-slot
// channel (the render arrow's third parameter), in either spelling.
export function componentRenderSlots(model: ComponentModuleModel): RenderSlotsModel | null {
  return firstComponentModel(model)?.renderSlots ?? null;
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

export function componentStateReturnObjectModel(
  model: ComponentModuleModel,
): StateReturnObjectModel | null {
  return firstComponentModel(model)?.stateReturnObject ?? null;
}

export function componentStateReturnObjectKeys(model: ComponentModuleModel): string[] {
  return [...(componentStateReturnObjectModel(model)?.entries.map((entry) => entry.key) ?? [])];
}

export function componentFragmentTargetNames(model: ComponentModuleModel): string[] {
  return model.components.flatMap((component) => {
    if (!componentHasInferredFragmentTarget(component)) {
      return [];
    }

    return component.localName === undefined ? [] : [component.localName];
  });
}

export function componentHasInferredServerRefreshTarget(model: ComponentModuleModel): boolean {
  const component = firstComponentModel(model);
  return component ? componentHasInferredFragmentTarget(component) : false;
}

export function jsxElements(model: ComponentModuleModel): JsxElementModel[] {
  return [...model.jsxElements];
}

export function jsxElementChildBody(element: JsxElementModel): JsxElementChildBody | null {
  return element.childBody;
}

export function soleJsxExpressionChild(
  element: JsxElementModel,
  model: ComponentModuleModel,
): JsxExpressionModel | null {
  if (element.childNonWhitespaceCount !== 1) return null;

  const [container] = element.childExpressionContainers;
  if (!container) return null;

  return (
    model.jsxExpressions.find(
      (expression) =>
        expression.containerStart === container.start && expression.containerEnd === container.end,
    ) ?? null
  );
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

  const params = expression.parameters.map((parameter) => parameter.name);
  if (params.length === 0 || !params.every(ts.isIdentifier)) return null;
  if (ts.isBlock(expression.body)) return null;

  return {
    expression: expression.body.getText(sourceFile).trim(),
    param: params[0]?.text ?? '',
    params: params.map((param) => param.text),
  };
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

/**
 * SPEC §4.8/§4.9 (A1): resolve the static reactive root of an element/computed access chain
 * (`rows[i]`, `rows[i].name`, `rows[0].name`, `a.b[i]`) to the leading dotted path before the
 * first index operator. A read that bottoms out at a computed access still reads a reactive root
 * (`rows`), so the §4.9 dependency/derive-input extractor must see that root or it will emit a
 * derive that references an unbound query (ReferenceError) and drop the query dependency (silent
 * staleness). Descends through trailing property accesses, then through chained element accesses,
 * and returns the dotted path of the first element access's receiver. Returns null when the chain
 * is not statically rooted at an identifier (e.g. `getRows()[0]`), so a non-trackable read does
 * not masquerade as a tracked path.
 */
function elementAccessRootPath(node: ts.Expression): string | null {
  let current: ts.Expression = node;
  while (ts.isPropertyAccessExpression(current)) {
    current = current.expression;
  }
  while (
    ts.isElementAccessExpression(current) &&
    ts.isElementAccessExpression(current.expression)
  ) {
    current = current.expression;
  }
  if (!ts.isElementAccessExpression(current)) return null;

  const receiver = current.expression;
  if (ts.isIdentifier(receiver)) return receiver.text;
  if (ts.isPropertyAccessExpression(receiver)) return propertyAccessPath(receiver);
  return null;
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
  localNameSpan: SourceSpan,
  declarationEnd: number,
  initializer: ts.Expression | undefined,
): ComponentModel | null {
  if (!initializer || !ts.isCallExpression(initializer)) return null;
  if (!ts.isIdentifier(initializer.expression) || initializer.expression.text !== 'component')
    return null;

  const [optionsArg] = initializer.arguments;
  if (!optionsArg || !ts.isObjectLiteralExpression(optionsArg)) return null;

  const options =
    optionsArg && ts.isObjectLiteralExpression(optionsArg)
      ? componentOptions(sourceFile, source, optionsArg)
      : [];
  const render = componentPropertyInitializer(optionsArg, 'render');
  const state = componentPropertyInitializer(optionsArg, 'state');
  const stateReturnObject = state ? arrowReturnObjectSource(sourceFile, source, state) : null;

  return {
    declarationEnd,
    localName,
    localNameSpan,
    options,
    ...(render ? renderHostModel(sourceFile, render) : {}),
    renderInputs: render ? arrowObjectPatternKeys(sourceFile, render) : [],
    ...(render ? renderSlots(sourceFile, render) : {}),
    ...(render ? renderSlotsParam(sourceFile, render) : {}),
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
        end: property.name.getEnd(),
        key,
        ...(ts.isObjectLiteralExpression(property.initializer)
          ? { objectEntries: objectLiteralEntries(sourceFile, source, property.initializer) }
          : {}),
        start: property.name.getStart(sourceFile),
        ...componentOptionStaticValueEntry(property.initializer),
        ...componentOptionStaticTemplateValueEntry(sourceFile, source, property.initializer),
      },
    ];
  });
}

// SPEC §4.9: a query-backed component without disableServerRefresh infers a server-refreshable
// fragment target. Exposed per-`ComponentModel` (not just the module's first component) so KV420 can
// classify every parent in a multi-component module, not only `firstComponentModel`.
export function componentHasInferredFragmentTarget(component: ComponentModel): boolean {
  if (
    component.options.find((option) => option.key === 'disableServerRefresh')?.staticValue === true
  ) {
    return false;
  }

  const queries = component.options.find((option) => option.key === 'queries')?.objectEntries ?? [];
  return queries.length > 0;
}

// SPEC §4.5/§4.9 (KV420): a component declares mutable island-local `state` when its `state` arrow
// returns at least one entry that is not frozen to a document-lifetime-immutable `renderOnce`
// value. The `renderOnce` escape is scoped to this component's source span so a `renderOnce` call in
// a sibling component never masks this one's live state. An isomorphic island self-renders (§4.8)
// and so is never clobbered by an enclosing fragment morph — it does not declare a KV420-relevant
// state position.
export function componentDeclaresMutableLocalState(
  component: ComponentModel,
  model: ComponentModuleModel,
): boolean {
  if (component.options.find((option) => option.key === 'isomorphic')?.staticValue === true) {
    return false;
  }

  const entries = component.stateReturnObject?.entries ?? [];
  if (entries.length === 0) return false;

  const renderOnceStateKeys = renderOnceStateKeysInSpan(
    model,
    component.localNameSpan?.start ?? component.declarationEnd,
    component.declarationEnd,
  );
  return entries.some((entry) => !renderOnceStateKeys.has(entry.key));
}

function renderOnceStateKeysInSpan(
  model: ComponentModuleModel,
  spanStart: number,
  spanEnd: number,
): Set<string> {
  const keys = new Set<string>();
  for (const call of model.calls) {
    if (call.name !== 'renderOnce') continue;
    if (call.start < spanStart || call.end > spanEnd) continue;
    for (const access of call.argumentPropertyAccesses.flat()) {
      if (!access.path.startsWith('state.')) continue;
      const key = access.path.slice('state.'.length).split('.')[0];
      if (key) keys.add(key);
    }
  }
  return keys;
}

function componentOptionStaticValueEntry(
  expression: ts.Expression,
): { staticValue: StaticLiteralValue } | {} {
  const value = staticLiteralValue(expression);
  return value === undefined ? {} : { staticValue: value };
}

function componentOptionStaticTemplateValueEntry(
  sourceFile: ts.SourceFile,
  source: string,
  expression: ts.Expression,
): { staticTemplateValue: string } | {} {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isNoSubstitutionTemplateLiteral(unwrapped)) return {};

  return {
    staticTemplateValue: source.slice(unwrapped.getStart(sourceFile) + 1, unwrapped.getEnd() - 1),
  };
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

  const pushElementAccessRoot = (node: ts.Expression): void => {
    const rootPath = elementAccessRootPath(node);
    if (!rootPath) return;
    paths.push({
      end: node.getEnd(),
      path: rootPath,
      start: node.getStart(sourceFile),
      terminalName: rootPath.split('.').at(-1) ?? rootPath,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && !isReceiverOfOuterAccess(node)) {
      const path = propertyAccessPath(node);
      if (path) {
        paths.push({
          end: node.getEnd(),
          ...propertyAccessInferredType(sourceFile, node),
          path,
          start: node.getStart(sourceFile),
          terminalName: node.name.text,
        });
      } else {
        // SPEC §4.8/§4.9 (A1): the dotted-path grammar could not represent this access because
        // its receiver bottoms out at a computed/element access (`rows[i].name`, `rows[0].name`).
        // The read is still rooted at a reactive query/state (`rows`); surface that root so the
        // derive-input/dependency extractor never emits a derive that references an unbound query
        // (ReferenceError) and silently drops the query dependency.
        pushElementAccessRoot(node);
      }
    }

    // A bare outermost computed access with no trailing property read (`rows[i]`, `rows[0]`) still
    // reads a reactive root; surface it the same way. Inner receivers are skipped so the root is
    // modeled once per chain.
    if (ts.isElementAccessExpression(node) && !isReceiverOfOuterAccess(node)) {
      pushElementAccessRoot(node);
    }

    ts.forEachChild(node, visit);
  };

  visit(root);

  return paths;
}

// SPEC §4.8/§4.9 (A1): a node is the receiver of an outer access (`X.foo` / `X[i]`) when its
// parent is a property/element access reading through it. The outermost access of a chain emits
// the modeled path, so inner receivers are skipped to avoid duplicate roots.
function isReceiverOfOuterAccess(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === node
  );
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

function staticConstructorTypeEntry(
  expression: ts.Expression,
): { staticConstructorType: ObjectLiteralEntry['staticConstructorType'] } | {} {
  if (!ts.isIdentifier(expression)) return {};
  if (expression.text === 'String') return { staticConstructorType: 'string' };
  if (expression.text === 'Number') return { staticConstructorType: 'number' };
  if (expression.text === 'Boolean') return { staticConstructorType: 'boolean' };
  return {};
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  if (
    ts.isComputedPropertyName(name) &&
    (ts.isStringLiteralLike(name.expression) || ts.isNumericLiteral(name.expression))
  ) {
    return name.expression.text;
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
          ...(ts.isObjectLiteralExpression(property.initializer)
            ? { objectEntries: objectLiteralEntries(sourceFile, source, property.initializer) }
            : {}),
          ...staticConstructorTypeEntry(property.initializer),
          ...objectLiteralEntryPropertyAccesses(sourceFile, property.initializer),
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

function objectLiteralEntryPropertyAccesses(
  sourceFile: ts.SourceFile,
  initializer: ts.Expression,
): { valuePropertyAccesses: readonly PropertyAccessPathModel[] } | {} {
  const valuePropertyAccesses = propertyAccessPathModels(sourceFile, initializer);
  return valuePropertyAccesses.length > 0 ? { valuePropertyAccesses } : {};
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
  const childSource = ts.isJsxElement(node)
    ? source.slice(openingElement.getEnd(), closingStart)
    : '';
  const selfClosing = !ts.isJsxElement(node);

  return {
    ancestorTags: jsxAncestorTags(sourceFile, node),
    attributes: openingElement.attributes.properties.flatMap((property) => {
      if (!ts.isJsxAttribute(property)) return [];

      const value = staticJsxAttributeValue(property);
      const expression = jsxAttributeExpression(sourceFile, source, property);
      const name = property.name.getText(sourceFile);
      return [
        {
          ...jsxAttributeEventFacts(name),
          end: property.getEnd(),
          leadingStart: attributeLeadingStart(source, property.getStart(sourceFile)),
          name,
          start: property.getStart(sourceFile),
          ...(expression === null ? {} : expression),
          ...(value === undefined ? {} : { value }),
        },
      ];
    }),
    childBody: jsxChildBody(childSource, openingElement.getEnd(), selfClosing),
    ...jsxChildFacts(node, sourceFile),
    closingStart,
    end: node.getEnd(),
    openingEnd: openingElement.getEnd(),
    openingTagNameEnd: openingElement.tagName.getEnd(),
    openingTagNameStart: openingElement.tagName.getStart(sourceFile),
    repeatable: isInsideArrayMapCallback(node),
    selfClosing,
    selfClosingSlashHasLeadingWhitespace: selfClosingSlashHasLeadingWhitespace(
      source,
      openingElement,
      node,
    ),
    spreadAttributes: openingElement.attributes.properties.flatMap((property) => {
      if (!ts.isJsxSpreadAttribute(property)) return [];

      const expression = property.expression;
      const unwrapped = unwrapExpression(expression);
      const bareIdentifierName = ts.isIdentifier(unwrapped) ? unwrapped.text : undefined;
      const callExpression = ts.isCallExpression(unwrapped) ? unwrapped : undefined;
      const callName =
        callExpression && ts.isIdentifier(callExpression.expression)
          ? callExpression.expression.text
          : undefined;
      const [firstCallArgument] = callExpression?.arguments ?? [];
      const callArgument = firstCallArgument ? unwrapExpression(firstCallArgument) : undefined;
      const callArgumentBareIdentifierName =
        callArgument && ts.isIdentifier(callArgument) ? callArgument.text : undefined;
      return [
        {
          end: property.getEnd(),
          expression: source.slice(expression.getStart(sourceFile), expression.getEnd()).trim(),
          ...(callName === undefined ? {} : { expressionCallName: callName }),
          ...(callArgumentBareIdentifierName === undefined
            ? {}
            : { expressionCallArgumentBareIdentifierName: callArgumentBareIdentifierName }),
          ...(bareIdentifierName === undefined
            ? {}
            : {
                expressionBareIdentifierName: bareIdentifierName,
                expressionIsBareIdentifier: true,
              }),
          ...(ts.isObjectLiteralExpression(expression)
            ? { objectEntries: objectLiteralEntries(sourceFile, source, expression) }
            : {}),
          start: property.getStart(sourceFile),
        },
      ];
    }),
    start: node.getStart(sourceFile),
    tag: openingElement.tagName.getText(sourceFile),
  };
}

function jsxAttributeEventFacts(name: string): {
  domEventName?: string;
  executionTriggerName?: string;
} {
  return {
    ...jsxDomEventName(name),
    ...jsxExecutionTriggerName(name),
  };
}

function jsxDomEventName(name: string): { domEventName: string } | {} {
  if (!/^on[A-Z][A-Za-z0-9]*$/.test(name)) return {};
  return { domEventName: name.slice(2).toLowerCase() };
}

function jsxExecutionTriggerName(name: string): { executionTriggerName: string } | {} {
  if (!name.startsWith('on:')) return {};
  const triggerName = name.slice('on:'.length);
  if (!validExecutionTriggerName(triggerName)) return {};
  return { executionTriggerName: triggerName };
}

function validExecutionTriggerName(name: string): boolean {
  if (name === '') return false;
  const [first, ...rest] = name;
  if (!first || !isLowerAlpha(first)) return false;
  return rest.every(isExecutionTriggerNameChar);
}

function isExecutionTriggerNameChar(char: string): boolean {
  return isLowerAlpha(char) || isDigit(char) || char === '-';
}

function isLowerAlpha(char: string): boolean {
  return char >= 'a' && char <= 'z';
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function jsxChildBody(
  childSource: string,
  openingEnd: number,
  selfClosing: boolean,
): JsxElementChildBody | null {
  if (selfClosing) return null;

  const leadingWhitespace = /^\s*/.exec(childSource)?.[0].length ?? 0;
  const body = childSource.trim();
  if (!body) return null;

  return {
    offset: openingEnd + leadingWhitespace,
    source: body,
  };
}

function selfClosingSlashHasLeadingWhitespace(
  source: string,
  openingElement: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
): boolean {
  if (ts.isJsxElement(node)) return false;

  return /\s/.test(source[openingElement.getEnd() - 3] ?? '');
}

function jsxChildFacts(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile,
): Pick<JsxElementModel, 'childExpressionContainers' | 'childNonWhitespaceCount'> {
  if (!ts.isJsxElement(node)) {
    return {
      childExpressionContainers: [],
      childNonWhitespaceCount: 0,
    };
  }

  const childExpressionContainers: SourceSpan[] = [];
  let childNonWhitespaceCount = 0;

  for (const child of node.children) {
    if (ts.isJsxText(child)) {
      if (!child.containsOnlyTriviaWhiteSpaces) childNonWhitespaceCount += 1;
      continue;
    }

    if (ts.isJsxExpression(child)) {
      if (child.expression) {
        childNonWhitespaceCount += 1;
        childExpressionContainers.push({
          end: child.getEnd(),
          start: child.getStart(sourceFile),
        });
      }
      continue;
    }

    childNonWhitespaceCount += 1;
  }

  return {
    childExpressionContainers,
    childNonWhitespaceCount,
  };
}

function attributeLeadingStart(source: string, start: number): number {
  let leadingStart = start;
  while (leadingStart > 0 && /\s/.test(source[leadingStart - 1] ?? '')) {
    leadingStart -= 1;
  }
  return leadingStart;
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

function isInsideArrayMapCallback(node: ts.Node): boolean {
  let current = node.parent;

  while (current) {
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isCallExpression(current.parent) &&
      current.parent.arguments[0] === current &&
      ts.isPropertyAccessExpression(current.parent.expression) &&
      current.parent.expression.name.text === 'map'
    ) {
      return true;
    }
    current = current.parent;
  }

  return false;
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
    argumentTemporalReads: node.arguments.map((argument) =>
      temporalReadModels(sourceFile, argument),
    ),
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
  node: ts.JsxExpression,
): JsxExpressionModel {
  const expression = node.expression;
  if (!expression) throw new Error('jsxExpressionModel requires an expression');
  const start = expression.getStart(sourceFile);
  const end = expression.getEnd();
  const solePath = solePropertyAccessPathFromExpression(expression);
  const unwrapped = unwrapExpression(expression);
  const callName =
    ts.isCallExpression(unwrapped) && ts.isIdentifier(unwrapped.expression)
      ? unwrapped.expression.text
      : undefined;
  return {
    ...(callName === undefined ? {} : { callName }),
    containerEnd: node.getEnd(),
    containerStart: node.getStart(sourceFile),
    end,
    expression: source.slice(start, end).trim(),
    propertyAccesses: propertyAccessPathModels(sourceFile, expression),
    references: referenceIdentifiers(expression),
    ...(solePath ? { solePropertyAccessPath: solePath } : {}),
    start,
    temporalReads: temporalReadModels(sourceFile, expression),
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

  // SPEC §5.2: the parser is the source-text boundary, so the KV codes a comment justifies are
  // extracted here into a typed fact (`justifiedDiagnostics`). Post-parse validators consume that
  // fact instead of re-scanning the raw comment text for diagnostic codes.
  const justifiedDiagnostics = parseJustifiedDiagnostics(text);

  return {
    ...directlyFollowingJsxElementAttributeStart(sourceFile, node),
    end,
    ...(justifiedDiagnostics.length === 0 ? {} : { justifiedDiagnostics }),
    start,
    text,
  };
}

function parseJustifiedDiagnostics(commentText: string): string[] {
  const codes = new Set<string>();
  for (const match of commentText.matchAll(/KV\d{3}/g)) codes.add(match[0]);
  return [...codes];
}

function directlyFollowingJsxElementAttributeStart(
  sourceFile: ts.SourceFile,
  node: ts.JsxExpression,
): { attachedAttributeStart: number } | {} {
  const parent = node.parent;
  if (!ts.isJsxElement(parent)) return {};

  const childIndex = parent.children.findIndex((child) => child === node);
  if (childIndex === -1) return {};

  for (const sibling of parent.children.slice(childIndex + 1)) {
    if (ts.isJsxText(sibling) && sibling.containsOnlyTriviaWhiteSpaces) continue;
    if (ts.isJsxElement(sibling) || ts.isJsxSelfClosingElement(sibling)) {
      const openingElement = ts.isJsxElement(sibling) ? sibling.openingElement : sibling;
      const [attribute] = openingElement.attributes.properties;
      return attribute && ts.isJsxAttribute(attribute)
        ? { attachedAttributeStart: attribute.getStart(sourceFile) }
        : {};
    }

    return {};
  }

  return {};
}

function jsxAttributeExpression(
  sourceFile: ts.SourceFile,
  source: string,
  attribute: ts.JsxAttribute,
): {
  expression: string;
  expressionEnd: number;
  expressionIsBareIdentifier: boolean;
  expressionBareIdentifierName?: string;
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
  // SPEC §5.2: decide bare-identifier-ness from the ts node (formatting-resistant), not by
  // regex-matching the raw snippet. Parentheses/whitespace/comments around the identifier are
  // unwrapped so `onClick={(handleClick)}` lowers identically to `onClick={handleClick}`, and the
  // identifier's name is carried as a typed fact for the lowered export name / call-through.
  const unwrapped = unwrapExpression(initializer.expression);
  const bareIdentifierName = ts.isIdentifier(unwrapped) ? unwrapped.text : undefined;
  return {
    expression: source.slice(expressionStart, expressionEnd).trim(),
    expressionEnd,
    expressionIsBareIdentifier: bareIdentifierName !== undefined,
    ...(bareIdentifierName === undefined
      ? {}
      : { expressionBareIdentifierName: bareIdentifierName }),
    ...(ts.isObjectLiteralExpression(unwrapped)
      ? { expressionObjectEntries: objectLiteralEntries(sourceFile, source, unwrapped) }
      : {}),
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

function temporalReadModels(sourceFile: ts.SourceFile, node: ts.Node): TemporalReadModel[] {
  const reads: TemporalReadModel[] = [];

  const visit = (current: ts.Node): void => {
    if (isDateNowCall(current)) {
      reads.push({
        end: current.getEnd(),
        kind: 'Date.now',
        start: current.getStart(sourceFile),
      });
    } else if (isZeroArgNewDate(current)) {
      reads.push({
        end: current.getEnd(),
        kind: 'new Date',
        start: current.getStart(sourceFile),
      });
    }

    ts.forEachChild(current, visit);
  };

  visit(node);
  return reads;
}

function isDateNowCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    node.arguments.length === 0 &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'Date' &&
    node.expression.name.text === 'now'
  );
}

function isZeroArgNewDate(node: ts.Node): node is ts.NewExpression {
  return (
    ts.isNewExpression(node) &&
    node.arguments !== undefined &&
    node.arguments.length === 0 &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'Date'
  );
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
  const rawBodySource = source.slice(bodyStart, bodyEnd);
  const bodySource = rawBodySource.trim();
  const bodySourceStart = bodyStart + rawBodySource.length - rawBodySource.trimStart().length;
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
  const callArgumentReferences =
    !ts.isBlock(body) && ts.isCallExpression(body)
      ? body.arguments.map((argument) => referenceIdentifierModels(sourceFile, argument))
      : undefined;
  const callArgumentStaticValues =
    !ts.isBlock(body) && ts.isCallExpression(body)
      ? body.arguments.map((argument) => staticLiteralValue(argument))
      : undefined;
  const callArgumentKinds =
    !ts.isBlock(body) && ts.isCallExpression(body)
      ? body.arguments.map((argument) => zeroArgArrowCallArgumentKind(argument))
      : undefined;

  return {
    zeroArgArrow: {
      body: bodySource,
      bodyEnd,
      bodyKind: ts.isBlock(body) ? 'block' : 'expression',
      ...(callArgumentReferences === undefined ? {} : { callArgumentReferences }),
      ...(callArgumentPropertyAccesses === undefined ? {} : { callArgumentPropertyAccesses }),
      ...(callArgumentStaticValues === undefined ? {} : { callArgumentStaticValues }),
      ...(callArgumentKinds === undefined ? {} : { callArgumentKinds }),
      bodyLocalNames: localDeclarationNames(body),
      bodyPropertyAccesses: propertyAccessPathModels(sourceFile, body),
      bodyReferences: referenceIdentifierModels(sourceFile, body),
      bodyStart,
      bodySourceStart,
      ...(callArguments === undefined ? {} : { callArguments }),
      ...documentElementActionModel(sourceFile, body),
      references: referenceIdentifiers(body),
    },
  };
}

// SPEC §5.2: classify a zero-arg-arrow call argument from its ts node so handler lowering can
// decide element-param eligibility from a typed kind instead of comparing the raw argument source.
function zeroArgArrowCallArgumentKind(argument: ts.Expression): ZeroArgArrowCallArgumentKind {
  if (staticLiteralValue(argument) !== undefined) return 'static';

  const unwrapped = unwrapExpression(argument);
  if (ts.isIdentifier(unwrapped)) return unwrapped.text === 'state' ? 'state' : 'reference';
  if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
    return 'member';
  }

  return 'other';
}

function localDeclarationNames(node: ts.Node): string[] {
  const names: string[] = [];

  const visit = (child: ts.Node): void => {
    if (ts.isVariableDeclaration(child)) {
      collectBindingNames(child.name, names);
    }
    if (
      (ts.isFunctionDeclaration(child) || ts.isClassDeclaration(child)) &&
      child.name !== undefined
    ) {
      names.push(child.name.text);
    }

    ts.forEachChild(child, visit);
  };

  ts.forEachChild(node, visit);
  return [...new Set(names)];
}

function collectBindingNames(name: ts.BindingName, names: string[]): void {
  if (ts.isIdentifier(name)) {
    names.push(name.text);
    return;
  }

  for (const element of name.elements) {
    if (ts.isBindingElement(element)) collectBindingNames(element.name, names);
  }
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
  return referenceIdentifierModels(root.getSourceFile(), root).map((reference) => reference.name);
}

function referenceIdentifierModels(
  sourceFile: ts.SourceFile,
  root: ts.Node,
): IdentifierReferenceModel[] {
  const declared = new Set<string>();
  const referenced: IdentifierReferenceModel[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      if (isDeclaredIdentifier(node)) declared.add(node.text);
      if (isReferenceIdentifier(node)) {
        referenced.push({
          end: node.getEnd(),
          name: node.text,
          ...identifierReferenceRole(node),
          start: node.getStart(sourceFile),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(root);
  return referenced.filter((reference) => !declared.has(reference.name));
}

function identifierReferenceRole(node: ts.Identifier): { role: 'call-callee' } | {} {
  const parent = node.parent;
  if (ts.isCallExpression(parent) && unwrapExpression(parent.expression) === node) {
    return { role: 'call-callee' };
  }

  return {};
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

function renderSlotsParam(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): { renderSlotsParam: RenderInputModel } | {} {
  if (!ts.isArrowFunction(expression)) return {};

  const thirdParam = expression.parameters[2];
  if (!thirdParam || !ts.isIdentifier(thirdParam.name)) return {};

  return {
    renderSlotsParam: {
      end: thirdParam.name.getEnd(),
      name: thirdParam.name.text,
      start: thirdParam.name.getStart(sourceFile),
    },
  };
}

// SPEC §4.5/§4.8: a component "accepts children/slots" iff its render arrow declares a third
// parameter (the projected-children/named-slot channel). Captures both spellings — an identifier
// (`slots`) and an object binding pattern (`{ children, footer }`) — so KV316 can flag a
// children/slot-accepting isomorphic island whose self-render has no slot arguments.
function renderSlots(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): { renderSlots: RenderSlotsModel } | {} {
  if (!ts.isArrowFunction(expression)) return {};

  const thirdParam = expression.parameters[2];
  if (!thirdParam) return {};

  const names = ts.isObjectBindingPattern(thirdParam.name)
    ? thirdParam.name.elements.flatMap((element) =>
        ts.isIdentifier(element.name) ? [element.name.text] : [],
      )
    : ts.isIdentifier(thirdParam.name)
      ? [thirdParam.name.text]
      : [];

  return {
    renderSlots: {
      end: thirdParam.getEnd(),
      names,
      start: thirdParam.getStart(sourceFile),
    },
  };
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
