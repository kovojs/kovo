import * as ts from 'typescript';

import {
  expressionResolvesToFrameworkExport,
  frameworkExport,
  registerFrameworkIdentityProject,
  type FrameworkExportIdentity,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';
import type { SessionAuthorityFact } from '@kovojs/core/internal/graph';

import { offsetToPosition, type CompilerDiagnostic } from '../diagnostics.js';
import {
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateSet,
  compilerJsonStringify,
  compilerMapForEach,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerSetAdd,
  compilerSetDelete,
  compilerSetHas,
  compilerSha256Hex,
  compilerSnapshotDenseArray,
  compilerStringIncludes,
  compilerStringSlice,
  compilerStringStartsWith,
  compilerStringToLowerCase,
} from '../compiler-security-intrinsics.js';
import { deriveMutationKey } from '../mutation-names.js';
import { deriveRegistryIdentity } from '../registry-identities.js';
import { normalizeComponentFileName } from '../shared.js';
import { ensureTypescriptRuntime, hasModifier } from '../ts-api.js';
import {
  callExpressionReceiverSegments,
  propertyAccessPath,
  propertyNameText,
  unwrapExpression,
} from './ast.js';
import type { StaticLiteralValue } from './object.js';
import type {
  ArrowFunctionPartsModel,
  CallExpressionModel,
  ConditionalExpressionModel,
  ComponentModel,
  ComponentModuleModel,
  ComponentOptionEntry,
  DocumentElementActionModel,
  HandlerWriteSinkFact,
  HandlerWriteSinkOperationKind,
  HandlerWriteSinkOwner,
  HandlerWriteSinkSurface,
  IdentifierReferenceModel,
  JsxCommentModel,
  JsxElementChildBody,
  JsxElementModel,
  JsxExpressionModel,
  LocalConstAliasModel,
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
  TaskRunHandlerModel,
  TemporalReadModel,
  WebhookRecordChangeFact,
  WebhookHandlerModel,
  ZeroArgArrowCallArgumentKind,
  ZeroArgArrowModel,
} from './model.js';

export type * from './model.js';

ensureTypescriptRuntime(ts);

interface ComponentFactoryBindings {
  readonly sourceFile: ts.SourceFile;
}

const COMPONENT_FACTORY_IDENTITY = frameworkExport('@kovojs/core', 'component');
const DOMAIN_FACTORY_IDENTITY = frameworkExport('@kovojs/server', 'domain');
const ENDPOINT_FACTORY_IDENTITY = frameworkExport('@kovojs/server', 'endpoint');
const MUTATION_FACTORY_IDENTITY = frameworkExport('@kovojs/server', 'mutation');
const TASK_FACTORY_IDENTITY = frameworkExport('@kovojs/server', 'task');
const WEBHOOK_FACTORY_IDENTITY = frameworkExport('@kovojs/server', 'webhook');
const HANDLER_WRITE_SINK_OPERATIONS = new Set<HandlerWriteSinkOperationKind>([
  'batch',
  'delete',
  'execute',
  'insert',
  'put',
  'run',
  'update',
]);
const WEBHOOK_TRANSACTION_RAW_DRIVER_ESCAPE_PROPERTIES = new Set([
  '$client',
  'client',
  'pglite',
  'session',
  'sqlite',
]);
const TASK_CONTEXT_COMPOSITION_METHODS = new Set(['runMutation', 'runQuery', 'schedule']);

/**
 * @internal FN7 (plans/compiler-refactoring.md): the canonical source parse. The scanner uses it,
 * and it is shared with the other compiler phases that must read app source (StyleX extraction and
 * its imported static-value modules) so the `ts.createSourceFile` boundary lives only in scan/
 * (SPEC.md §5.2 rule 9).
 */
export function parseSourceFile(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    normalizeComponentFileName(fileName),
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

export { normalizeComponentFileName };

export interface ParseComponentModuleOptions {
  readonly frameworkIdentityFiles?: readonly {
    readonly fileName: string;
    readonly source: string;
  }[];
}

export function parseDiagnosticsForSourceFile(
  sourceFile: ts.SourceFile,
  source: string,
): CompilerDiagnostic[] {
  const parseDiagnostics =
    (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics ?? [];

  return parseDiagnostics.map((diagnostic: ts.Diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    const start = diagnostic.start ?? 0;
    const length = diagnostic.length ?? Math.max(1, source.length - start);
    return {
      code: 'KV245',
      fileName: sourceFile.fileName,
      help: [
        'Would lower to: typed JSX facts before generated server, client, CSS, and registry artifacts.',
        'Blocked reason: TypeScript could not parse the authored TSX, so later compiler phases would operate on a recovery tree.',
        'Fixes: correct the TSX syntax at this location and re-run the compiler.',
        'SPEC §5.2 requires app source to be TSX and generated artifacts to come only from parsed compiler facts.',
      ].join('\n'),
      length,
      message: `TypeScript/TSX parse failed. ${message}`,
      severity: 'error',
      start: offsetToPosition(source, start),
    };
  });
}

/**
 * @internal Parse one authored component module into the compiler's source model. Shared by
 * compiler phases and build-time graph preflight only; app authors must not depend on this shape.
 */
export function parseComponentModule(
  fileName: string,
  source: string,
  options: ParseComponentModuleOptions = {},
): ComponentModuleModel {
  const sourceFile = parseSourceFile(fileName, source);
  if (options.frameworkIdentityFiles?.length) {
    registerFrameworkIdentityProject(
      sourceFile,
      options.frameworkIdentityFiles.map((file) => parseSourceFile(file.fileName, file.source)),
    );
  }
  const componentFactories = componentFactoryBindings(sourceFile);
  const calls: CallExpressionModel[] = [];
  const components: ComponentModel[] = [];
  const endpointHandlers: MutationHandlerModel[] = [];
  const jsxComments: JsxCommentModel[] = [];
  const jsxExpressions: JsxExpressionModel[] = [];
  const jsxElements: JsxElementModel[] = [];
  const moduleScopeBindings: ModuleScopeBindingModel[] = [];
  const moduleSpecifiers: ModuleSpecifierModel[] = [];
  const mutationHandlers: MutationHandlerModel[] = [];
  const namedImports = sourceFile.statements.flatMap((statement) => namedImportModels(statement));
  const renderSourceReturns: StringRenderModel[] = [];
  const taskRunHandlers: TaskRunHandlerModel[] = [];
  const webhookHandlers: WebhookHandlerModel[] = [];
  const moduleScopeObjectEntries = moduleScopeObjectEntryModels(sourceFile, source);
  const domainBindings = domainBindingKeys(sourceFile);

  const visit = (node: ts.Node): void => {
    const specifier = moduleSpecifierModel(node);
    if (specifier) moduleSpecifiers.push(specifier);
    moduleScopeBindings.push(...moduleScopeBindingModels(sourceFile, source, node));

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isExportedVariable(node)) {
      const model = componentModelFromInitializer(
        sourceFile,
        source,
        node.name.text,
        { end: node.name.getEnd(), start: node.name.getStart(sourceFile) },
        node.parent.parent.getEnd(),
        node.initializer,
        componentFactories,
      );
      if (model) components.push(model);
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      jsxElements.push(
        jsxElementModel(sourceFile, source, node, moduleScopeObjectEntries, namedImports),
      );
    }
    if (ts.isJsxExpression(node)) {
      const comment = jsxCommentModel(sourceFile, source, node);
      if (comment) jsxComments.push(comment);
      if (node.expression) jsxExpressions.push(jsxExpressionModel(sourceFile, source, node));
    }
    if (
      ts.isCallExpression(node) &&
      (ts.isIdentifier(node.expression) || ts.isPropertyAccessExpression(node.expression))
    ) {
      calls.push(callExpressionModel(sourceFile, source, node));
      if (isFrameworkExpression(sourceFile, node.expression, ENDPOINT_FACTORY_IDENTITY)) {
        endpointHandlers.push(...endpointHandlerModels(sourceFile, source, node));
      }
      if (isFrameworkExpression(sourceFile, node.expression, MUTATION_FACTORY_IDENTITY)) {
        mutationHandlers.push(...mutationHandlerModels(sourceFile, source, node));
      }
      if (isFrameworkExpression(sourceFile, node.expression, TASK_FACTORY_IDENTITY)) {
        taskRunHandlers.push(...taskRunHandlerModels(sourceFile, source, node));
      }
      if (isFrameworkExpression(sourceFile, node.expression, WEBHOOK_FACTORY_IDENTITY)) {
        webhookHandlers.push(...webhookHandlerModels(sourceFile, source, node, domainBindings));
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

  const model: ComponentModuleModel = {
    calls,
    components,
    endpointHandlers,
    jsxComments,
    jsxExpressions,
    jsxElements,
    moduleScopeBindings,
    moduleSpecifiers,
    mutationHandlers,
    namedImports,
    renderSourceReturns,
    sourceFile,
    taskRunHandlers,
    webhookHandlers,
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

function moduleScopeBindingModels(
  sourceFile: ts.SourceFile,
  source: string,
  node: ts.Node,
): ModuleScopeBindingModel[] {
  if (!ts.isVariableStatement(node) || node.parent !== sourceFile) return [];

  return node.declarationList.declarations.flatMap((declaration) => {
    if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) return [];

    const value = staticLiteralValue(declaration.initializer);
    if (value === undefined) return [];

    return [
      {
        name: declaration.name.text,
        source: source.slice(
          declaration.initializer.getStart(sourceFile),
          declaration.initializer.getEnd(),
        ),
        staticValue: value,
      },
    ];
  });
}

function moduleScopeObjectEntryModels(
  sourceFile: ts.SourceFile,
  source: string,
): ReadonlyMap<string, readonly ObjectLiteralEntry[]> {
  const stringBindings = moduleScopeStaticStringValues(sourceFile);
  const objectEntries = new Map<string, readonly ObjectLiteralEntry[]>();

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const initializer = unwrapExpression(declaration.initializer);
      if (!ts.isObjectLiteralExpression(initializer)) continue;

      const entries = completeJsxSpreadObjectLiteralEntries(
        sourceFile,
        source,
        initializer,
        stringBindings,
      );
      if (entries !== undefined) objectEntries.set(declaration.name.text, entries);
    }
  }

  return objectEntries;
}

function moduleScopeStaticStringValues(sourceFile: ts.SourceFile): ReadonlyMap<string, string> {
  const strings = new Map<string, string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const value = staticLiteralValue(declaration.initializer);
      if (typeof value === 'string') strings.set(declaration.name.text, value);
    }
  }

  return strings;
}

function domainBindingKeys(sourceFile: ts.SourceFile): ReadonlyMap<string, string> {
  const domains = new Map<string, string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const domainKey = domainKeyFromExpression(sourceFile, declaration.initializer, domains);
      if (domainKey !== undefined && domainKey !== 'UNRESOLVED') {
        domains.set(declaration.name.text, domainKey);
      }
    }
  }

  return domains;
}

function isExportedVariable(node: ts.VariableDeclaration): boolean {
  const statement = node.parent.parent;
  return ts.isVariableStatement(statement) && hasExportModifier(statement);
}

function hasExportModifier(node: ts.FunctionDeclaration | ts.VariableStatement): boolean {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword);
}

function componentFactoryBindings(sourceFile: ts.SourceFile): ComponentFactoryBindings {
  return { sourceFile };
}

function isComponentFactoryReference(
  expression: ts.Expression,
  bindings: ComponentFactoryBindings,
): boolean {
  return isFrameworkExpression(bindings.sourceFile, expression, COMPONENT_FACTORY_IDENTITY);
}

function isFrameworkExpression(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  identity: FrameworkExportIdentity,
): boolean {
  return expressionResolvesToFrameworkExport(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    expression,
    identity,
    { legacyGlobals: [identity] },
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

export function componentOptionStaticValueFor(
  component: ComponentModel,
  propertyName: string,
): StaticLiteralValue | undefined {
  return componentOptionFor(component, propertyName)?.staticValue;
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
  const component = firstComponentModel(model);
  return component ? componentOptionStaticValueFor(component, propertyName) : undefined;
}

export function componentOptionStaticTemplateValue(
  model: ComponentModuleModel,
  propertyName: string,
): string | undefined {
  const component = firstComponentModel(model);
  return component ? componentOptionFor(component, propertyName)?.staticTemplateValue : undefined;
}

export function componentOptionObjectEntries(
  model: ComponentModuleModel,
  propertyName: string,
): ObjectLiteralEntry[] {
  const component = firstComponentModel(model);
  return component ? componentOptionObjectEntriesFor(component, propertyName) : [];
}

export function componentOptionObjectEntriesFor(
  component: ComponentModel,
  propertyName: string,
): ObjectLiteralEntry[] {
  return snapshotCompilerModelArray(
    componentOptionFor(component, propertyName)?.objectEntries ?? [],
    `Component option ${propertyName} object entries`,
  );
}

/**
 * @internal Return object-literal entries for a component option across every component in a module.
 * Used by graph/build checks that must consider multi-component modules.
 */
export function allComponentOptionObjectEntries(
  model: ComponentModuleModel,
  propertyName: string,
): ObjectLiteralEntry[] {
  const result: ObjectLiteralEntry[] = [];
  const components = snapshotCompilerModelArray(model.components, 'Components');
  for (let index = 0; index < components.length; index += 1) {
    const entries = componentOptionObjectEntriesFor(components[index]!, propertyName);
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      result[result.length] = entries[entryIndex]!;
    }
  }
  return result;
}

export function componentOptionObjectKeys(
  model: ComponentModuleModel,
  propertyName: string,
): string[] {
  return objectEntryKeys(componentOptionObjectEntries(model, propertyName));
}

export function componentOptionObjectKeysFor(
  component: ComponentModel,
  propertyName: string,
): string[] {
  return objectEntryKeys(componentOptionObjectEntriesFor(component, propertyName));
}

export function allComponentOptionObjectKeys(
  model: ComponentModuleModel,
  propertyName: string,
): string[] {
  return objectEntryKeys(allComponentOptionObjectEntries(model, propertyName));
}

function componentOptionFor(
  component: ComponentModel,
  propertyName: string,
): ComponentOptionEntry | undefined {
  const options = snapshotCompilerModelArray(component.options, 'Component options');
  for (let index = 0; index < options.length; index += 1) {
    if (options[index]!.key === propertyName) return options[index];
  }
  return undefined;
}

function objectEntryKeys(entries: readonly ObjectLiteralEntry[]): string[] {
  const source = snapshotCompilerModelArray(entries, 'Component option object entries');
  const keys: string[] = [];
  for (let index = 0; index < source.length; index += 1) keys[index] = source[index]!.key;
  return keys;
}

export function componentRenderInputs(model: ComponentModuleModel): string[] {
  const inputs = componentRenderInputModels(model);
  const names: string[] = [];
  for (let index = 0; index < inputs.length; index += 1) names[index] = inputs[index]!.name;
  return names;
}

export function componentRenderInputModels(model: ComponentModuleModel): RenderInputModel[] {
  return snapshotCompilerModelArray(
    firstComponentModel(model)?.renderInputs ?? [],
    'Component render inputs',
  );
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
  const component = firstComponentModel(model);
  return component ? componentRenderHostElementFor(model, component) : null;
}

export function componentRenderHostElementFor(
  model: ComponentModuleModel,
  component: ComponentModel,
): JsxElementModel | null {
  const host = component.renderHost ?? null;
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

export function componentModelForSourceSpan(
  model: ComponentModuleModel,
  span: SourceSpan,
): ComponentModel | null {
  const containing = model.components.filter((component) => {
    const start = component.localNameSpan?.start ?? 0;
    return span.start >= start && span.end <= component.declarationEnd;
  });

  return (
    containing.sort(
      (left, right) =>
        left.declarationEnd -
        (left.localNameSpan?.start ?? 0) -
        (right.declarationEnd - (right.localNameSpan?.start ?? 0)),
    )[0] ?? null
  );
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
  return model.components.some(componentHasInferredFragmentTarget);
}

export function jsxElements(model: ComponentModuleModel): JsxElementModel[] {
  return snapshotCompilerModelArray(model.jsxElements, 'JSX elements');
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

  const expressions = snapshotCompilerModelArray(model.jsxExpressions, 'JSX expressions');
  for (let index = 0; index < expressions.length; index += 1) {
    const expression = expressions[index]!;
    if (
      expression.containerStart === container.start &&
      expression.containerEnd === container.end
    ) {
      return expression;
    }
  }
  return null;
}

export function callExpressions(model: ComponentModuleModel): CallExpressionModel[] {
  return snapshotCompilerModelArray(model.calls, 'Call expressions');
}

export function jsxExpressions(model: ComponentModuleModel): JsxExpressionModel[] {
  return snapshotCompilerModelArray(model.jsxExpressions, 'JSX expressions');
}

function snapshotCompilerModelArray<Value>(values: readonly Value[], label: string): Value[] {
  const length = compilerArrayLength(values, label);
  const snapshot: Value[] = [];
  for (let index = 0; index < length; index += 1) {
    const value = compilerOwnDataValue(values, index, label) as Value | undefined;
    if (value === undefined) {
      throw new TypeError(`${label}[${index}] must be an own compiler model fact.`);
    }
    snapshot[index] = value;
  }
  return snapshot;
}

export function jsxComments(model: ComponentModuleModel): JsxCommentModel[] {
  return snapshotCompilerModelArray(model.jsxComments, 'JSX comments');
}

export function mutationHandlers(model: ComponentModuleModel): MutationHandlerModel[] {
  return snapshotCompilerModelArray(model.mutationHandlers, 'Mutation handlers');
}

/**
 * @internal Producer-owned browser-authority provenance for SPEC §6.6 / KV418. Positive
 * facts override the ordinary guard/session-derived mutation posture in the build
 * graph; runtime request neutralization remains the enforcement proof.
 */
export function mutationSessionAuthorityFacts(model: ComponentModuleModel): SessionAuthorityFact[] {
  const facts: SessionAuthorityFact[] = [];
  const addFact = (
    owner: HandlerWriteSinkOwner | undefined,
    referencesSession: boolean,
    detail: string,
    handlerFingerprint?: string,
  ): void => {
    const ownerName = owner?.value;
    if (ownerName === undefined) return;
    const unresolvedName = ownerName === 'UNRESOLVED';
    const name = unresolvedName ? 'UNRESOLVED' : ownerName;
    let previousIndex = -1;
    for (let index = 0; index < facts.length; index += 1) {
      if (facts[index]!.name === name) {
        previousIndex = index;
        break;
      }
    }
    const previous = previousIndex < 0 ? undefined : facts[previousIndex];
    if (previous?.referencesSession === true && !referencesSession) return;
    const handlerFingerprints: string[] = [];
    if (!referencesSession) {
      const previousFingerprints = previous?.handlerFingerprints ?? [];
      const previousLength = compilerArrayLength(
        previousFingerprints,
        'Mutation authority handler fingerprints',
      );
      for (let index = 0; index < previousLength; index += 1) {
        const value = compilerOwnDataValue(
          previousFingerprints,
          index,
          'Mutation authority handler fingerprints',
        );
        if (typeof value !== 'string') {
          throw new TypeError('Mutation authority handler fingerprints must be strings.');
        }
        handlerFingerprints[handlerFingerprints.length] = value;
      }
      if (handlerFingerprint !== undefined) {
        let duplicate = false;
        for (let index = 0; index < handlerFingerprints.length; index += 1) {
          if (handlerFingerprints[index] === handlerFingerprint) {
            duplicate = true;
            break;
          }
        }
        if (!duplicate) handlerFingerprints[handlerFingerprints.length] = handlerFingerprint;
      }
    }
    const fact: SessionAuthorityFact = {
      detail,
      ...(handlerFingerprints.length === 0 ? {} : { handlerFingerprints }),
      kind: 'mutation',
      name,
      referencesSession,
      source: 'session-authority',
      ...(unresolvedName ? { unresolvedName: true as const } : {}),
    };
    if (previousIndex < 0) facts[facts.length] = fact;
    else facts[previousIndex] = fact;
  };

  const handlerLength = compilerArrayLength(model.mutationHandlers, 'Mutation handlers');
  for (let index = 0; index < handlerLength; index += 1) {
    const handler = compilerOwnDataValue(model.mutationHandlers, index, 'Mutation handlers') as
      | MutationHandlerModel
      | undefined;
    if (handler === undefined) throw new TypeError(`Mutation handlers[${index}] must be dense.`);
    addFact(
      handler.mutationOwner,
      handler.readsAmbientCookie === true,
      handler.readsAmbientCookie === true
        ? 'handler reads or may expose ambient request authority'
        : 'handler has no statically observed ambient request authority',
      handler.authorityFingerprint,
    );
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      (ts.isIdentifier(node.expression) || ts.isPropertyAccessExpression(node.expression)) &&
      isFrameworkExpression(model.sourceFile, node.expression, MUTATION_FACTORY_IDENTITY) &&
      !mutationHandlerAuthorityIsStaticallyInspectable(node)
    ) {
      // An imported/referenced handler, options object, spread, accessor, or dynamic
      // property can hide a browser-authority read or sink. Keep KV418 fail-closed: authors may
      // use these shapes for ordinary CSRF-protected mutations, but an exempt mutation
      // must keep its handler inline so ambient-authority absence is provable.
      addFact(
        mutationOwner(model.sourceFile, node),
        true,
        'handler authority cannot be proven statically',
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(model.sourceFile);

  const sorted: SessionAuthorityFact[] = [];
  for (let index = 0; index < facts.length; index += 1) {
    const fact = facts[index]!;
    let insertAt = sorted.length;
    while (insertAt > 0 && fact.name < sorted[insertAt - 1]!.name) {
      sorted[insertAt] = sorted[insertAt - 1]!;
      insertAt -= 1;
    }
    sorted[insertAt] = fact;
  }
  return sorted;
}

/** @internal Canonicalize a runtime handler's native source for build/source identity proof. */
export function mutationHandlerFingerprintFromRuntimeSource(source: string): string | undefined {
  return (
    mutationHandlerSourceFingerprint(source, 'expression') ??
    mutationHandlerSourceFingerprint(source, 'method')
  );
}

function mutationHandlerFingerprint(
  sourceFile: ts.SourceFile,
  source: string,
  handler: ts.ArrowFunction | ts.FunctionExpression | ts.MethodDeclaration,
): string | undefined {
  return mutationHandlerSourceFingerprint(
    compilerStringSlice(source, handler.getStart(sourceFile), handler.getEnd()),
    ts.isMethodDeclaration(handler) ? 'method' : 'expression',
  );
}

function mutationHandlerSourceFingerprint(
  source: string,
  kind: 'expression' | 'method',
): string | undefined {
  const wrapped =
    kind === 'method'
      ? `const __kovoHandler = { ${source} };`
      : `const __kovoHandler = (${source});`;
  const transpiled = ts.transpileModule(wrapped, {
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
      target: ts.ScriptTarget.ESNext,
    },
    fileName: 'kovo-handler-fingerprint.tsx',
    reportDiagnostics: true,
  });
  const diagnostics = transpiled.diagnostics ?? [];
  const diagnosticLength = compilerArrayLength(diagnostics, 'Handler transpile diagnostics');
  for (let index = 0; index < diagnosticLength; index += 1) {
    const diagnostic = compilerOwnDataValue(diagnostics, index, 'Handler transpile diagnostics') as
      | ts.Diagnostic
      | undefined;
    if (diagnostic === undefined) return undefined;
    if (
      compilerOwnDataValue(diagnostic, 'category', 'Handler transpile diagnostic') ===
      ts.DiagnosticCategory.Error
    ) {
      return undefined;
    }
  }
  const canonicalFile = ts.createSourceFile(
    'kovo-handler-fingerprint.jsx',
    transpiled.outputText,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  );
  let statement: ts.VariableStatement | undefined;
  const statementLength = compilerArrayLength(canonicalFile.statements, 'Canonical statements');
  for (let index = 0; index < statementLength; index += 1) {
    const candidate = compilerOwnDataValue(canonicalFile.statements, index, 'Canonical statements');
    if (candidate !== undefined && ts.isVariableStatement(candidate as ts.Node)) {
      statement = candidate as ts.VariableStatement;
      break;
    }
  }
  const declaration = statement?.declarationList.declarations[0];
  const initializer = declaration?.initializer;
  if (!initializer) return undefined;
  let handler: ts.Expression | ts.MethodDeclaration | undefined = initializer;
  if (kind === 'method' && ts.isObjectLiteralExpression(initializer)) {
    handler = undefined;
    const propertyLength = compilerArrayLength(
      initializer.properties,
      'Canonical handler properties',
    );
    for (let index = 0; index < propertyLength; index += 1) {
      const candidate = compilerOwnDataValue(
        initializer.properties,
        index,
        'Canonical handler properties',
      );
      if (candidate !== undefined && ts.isMethodDeclaration(candidate as ts.Node)) {
        handler = candidate as ts.MethodDeclaration;
        break;
      }
    }
  }
  if (!handler) return undefined;

  return compilerSha256Hex(canonicalHandlerAst(handler, canonicalFile));
}

function canonicalHandlerAst(node: ts.Node, sourceFile: ts.SourceFile): string {
  let output = '';
  const visit = (current: ts.Node): void => {
    output += `${current.kind}:`;
    if (ts.isIdentifier(current)) output += `id=${current.text};`;
    else if (ts.isStringLiteralLike(current)) {
      output += `string=${compilerJsonStringify(current.text)};`;
    } else if (ts.isNumericLiteral(current) || ts.isBigIntLiteral(current)) {
      output += `number=${current.text};`;
    } else if (
      ts.isNoSubstitutionTemplateLiteral(current) ||
      ts.isTemplateHead(current) ||
      ts.isTemplateMiddle(current) ||
      ts.isTemplateTail(current)
    ) {
      output += `template=${compilerJsonStringify(current.text)};`;
    } else if (current.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      output += `regexp=${compilerStringSlice(
        sourceFile.text,
        current.getStart(sourceFile),
        current.getEnd(),
      )};`;
    }
    const children = current.getChildren(sourceFile);
    const childLength = compilerArrayLength(children, 'Canonical handler AST children');
    for (let index = 0; index < childLength; index += 1) {
      const child = compilerOwnDataValue(children, index, 'Canonical handler AST children');
      if (child === undefined) {
        throw new TypeError(`Canonical handler AST children[${index}] must be dense.`);
      }
      visit(child as ts.Node);
    }
    output += ';';
  };
  visit(node);
  return output;
}

function mutationHandlerAuthorityIsStaticallyInspectable(call: ts.CallExpression): boolean {
  const options = [...call.arguments].find(ts.isObjectLiteralExpression);
  if (!options) return false;

  let handlerCount = 0;
  for (const property of options.properties) {
    if (ts.isSpreadAssignment(property) || propertyNameText(property.name) === null) return false;
    if (propertyNameText(property.name) !== 'handler') continue;
    handlerCount += 1;
    if (ts.isMethodDeclaration(property)) {
      if (!property.body) return false;
      continue;
    }
    if (!ts.isPropertyAssignment(property)) return false;
    const initializer = unwrapExpression(property.initializer);
    if (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer)) return false;
  }

  return handlerCount > 0;
}

export function taskRunHandlers(model: ComponentModuleModel): TaskRunHandlerModel[] {
  return [...model.taskRunHandlers];
}

export function endpointHandlers(model: ComponentModuleModel): MutationHandlerModel[] {
  return [...model.endpointHandlers];
}

export function webhookHandlers(model: ComponentModuleModel): WebhookHandlerModel[] {
  return [...model.webhookHandlers];
}

export function handlerWriteSinks(model: ComponentModuleModel): HandlerWriteSinkFact[] {
  return [
    ...model.endpointHandlers.flatMap((handler) => handler.handlerWriteSinks ?? []),
    ...model.mutationHandlers.flatMap((handler) => handler.handlerWriteSinks ?? []),
    ...model.taskRunHandlers.flatMap((handler) => handler.handlerWriteSinks ?? []),
    ...model.webhookHandlers.flatMap((handler) => handler.handlerWriteSinks ?? []),
  ];
}

export function webhookRecordChanges(model: ComponentModuleModel): WebhookRecordChangeFact[] {
  return model.webhookHandlers.flatMap((handler) => handler.webhookRecordChanges ?? []);
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
  // Platform DOM lowering is structural, but the `document` receiver must still be the unshadowed
  // browser global; a local lookalike is ordinary user code, not a declarative behavior proof.
  if (
    !ts.isIdentifier(receiver) ||
    !identifierResolvesToUnshadowedGlobal(sourceFile, receiver, 'document')
  ) {
    return null;
  }

  const target = call.arguments[0];
  if (!target) return null;
  return ts.isStringLiteralLike(target) ? target.text : null;
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

function identifierResolvesToUnshadowedGlobal(
  sourceFile: ts.SourceFile,
  identifier: ts.Identifier,
  globalName: string,
): boolean {
  return (
    identifier.text === globalName &&
    !identifierIsShadowedBeforeScope(identifier, undefined, sourceFile) &&
    !scopeDeclaresIdentifierNamed(sourceFile, globalName, undefined)
  );
}

function identifierIsShadowedBeforeScope(
  identifier: ts.Identifier,
  binding: ts.Identifier | undefined,
  boundary: ts.Node,
): boolean {
  let current: ts.Node | undefined = identifier.parent;
  while (current && current !== boundary) {
    if (
      isLexicalScopeNode(current) &&
      scopeDeclaresIdentifierNamed(current, identifier.text, binding)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function scopeDeclaresIdentifierNamed(
  scope: ts.Node,
  name: string,
  excluded: ts.Identifier | undefined,
): boolean {
  let found = false;

  const visitBindingName = (bindingName: ts.BindingName): void => {
    if (ts.isIdentifier(bindingName)) {
      if (bindingName !== excluded && bindingName.text === name) found = true;
      return;
    }
    for (const element of bindingName.elements) {
      if (ts.isBindingElement(element)) visitBindingName(element.name);
    }
  };

  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== scope && isFunctionScopeNode(node)) {
      if (ts.isFunctionDeclaration(node) && node.name) visitBindingName(node.name);
      return;
    }
    if (node !== scope && ts.isClassDeclaration(node)) {
      if (node.name) visitBindingName(node.name);
      return;
    }
    if (ts.isImportClause(node) && node.name) visitBindingName(node.name);
    if (ts.isNamespaceImport(node)) visitBindingName(node.name);
    if (ts.isImportSpecifier(node)) visitBindingName(node.name);
    if (ts.isParameter(node)) visitBindingName(node.name);
    if (ts.isVariableDeclaration(node)) visitBindingName(node.name);
    if (ts.isFunctionDeclaration(node) && node.name) visitBindingName(node.name);
    if (ts.isClassDeclaration(node) && node.name) visitBindingName(node.name);
    ts.forEachChild(node, visit);
  };

  visit(scope);
  return found;
}

function isLexicalScopeNode(node: ts.Node): boolean {
  return (
    ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) || isFunctionScopeNode(node)
  );
}

function isFunctionScopeNode(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node)
  );
}

function componentModelFromInitializer(
  sourceFile: ts.SourceFile,
  source: string,
  localName: string,
  localNameSpan: SourceSpan,
  declarationEnd: number,
  initializer: ts.Expression | undefined,
  componentFactories: ComponentFactoryBindings,
): ComponentModel | null {
  if (!initializer || !ts.isCallExpression(initializer)) return null;
  if (!isComponentFactoryReference(initializer.expression, componentFactories)) return null;

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
    renderLocalNames: render ? renderLocalDeclarationNames(render) : [],
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
        ...leadingJustifiedDiagnostics(source, property),
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

function leadingJustifiedDiagnostics(
  source: string,
  node: ts.Node,
): { justifiedDiagnostics: readonly string[] } | {} {
  const ranges = ts.getLeadingCommentRanges(source, node.getFullStart()) ?? [];
  const codes = new Set<string>();
  for (const range of ranges) {
    if (range.end > node.getStart(node.getSourceFile())) continue;
    for (const code of parseJustifiedDiagnostics(source.slice(range.pos, range.end))) {
      codes.add(code);
    }
  }

  return codes.size === 0 ? {} : { justifiedDiagnostics: [...codes] };
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
  const owner = mutationOwner(sourceFile, call);
  const entries = handlerPropertyEntries(sourceFile, source, call);
  const result: MutationHandlerModel[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const { body, handler, model, parameters } = entries[index]!;
    const directDbTargets = mutationDirectDbTargetIdentities(sourceFile, body, parameters);
    const authorityFingerprint = mutationHandlerFingerprint(sourceFile, source, handler);
    result[result.length] = {
      ...model,
      ...(authorityFingerprint === undefined ? {} : { authorityFingerprint }),
      handlerWriteSinks: handlerWriteSinkFacts(sourceFile, source, body, {
        owner,
        resolvedTargetFilter: (identity) =>
          compilerSetHas(directDbTargets, identity) || looksLikeDbTargetIdentity(identity),
        surface: 'mutation',
      }),
      mutationOwner: owner,
      ...(handlerReadsAmbientCookie(body, parameters) ? { readsAmbientCookie: true as const } : {}),
    };
  }
  return result;
}

/**
 * Trace the handler's second (request) parameter to Headers aliases and classify
 * Cookie reads. Decisions are AST/provenance-based, never raw source text. A
 * dynamic header name or an escaped/enumerated Headers carrier fails closed,
 * while a statically non-Cookie `headers.get("x-signature")` stays green.
 */
function handlerReadsAmbientCookie(
  body: ts.ConciseBody,
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
): boolean {
  const parameterSnapshot = compilerSnapshotDenseArray(parameters, 'Mutation handler parameters');
  const runtimeParameters: ts.ParameterDeclaration[] = [];
  const runtimeParameterStart =
    parameterSnapshot[0] &&
    ts.isIdentifier(parameterSnapshot[0].name) &&
    parameterSnapshot[0].name.text === 'this'
      ? 1
      : 0;
  for (let index = runtimeParameterStart; index < parameterSnapshot.length; index += 1) {
    runtimeParameters[runtimeParameters.length] = parameterSnapshot[index]!;
  }
  if (runtimeParameters[0]?.dotDotDotToken || runtimeParameters[1]?.dotDotDotToken) return true;
  if (handlerReferencesUnprovenFreeAuthority(body, parameters)) return true;
  if (handlerMutatesBrowserState(body, runtimeParameters[2])) return true;
  if (!ts.isArrowFunction(body.parent) && handlerBodyReferencesArguments(body)) {
    return true;
  }

  const requestNames = compilerCreateSet<string>();
  const headersNames = compilerCreateSet<string>();
  const staticStrings = handlerStaticStrings(body);
  const requestParameter = runtimeParameters[1];
  if (requestParameter && requestBindingMayExposeAmbientAuthority(requestParameter.name)) {
    return true;
  }
  if (requestParameter) {
    collectRequestParameterAuthority(requestParameter.name, requestNames, headersNames);
  }

  let changed = true;
  while (changed) {
    changed = false;
    const visitAliases = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        changed =
          collectAuthorityAlias(node.name, node.initializer, requestNames, headersNames) || changed;
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left)
      ) {
        const kind = requestAuthorityExpressionKind(node.right, requestNames, headersNames);
        if (kind === 'request' && !compilerSetHas(requestNames, node.left.text)) {
          compilerSetAdd(requestNames, node.left.text);
          changed = true;
        }
        if (kind === 'headers' && !compilerSetHas(headersNames, node.left.text)) {
          compilerSetAdd(headersNames, node.left.text);
          changed = true;
        }
      }
      ts.forEachChild(node, visitAliases);
    };
    visitAliases(body);
  }

  let readsCookie = false;
  const visitReads = (node: ts.Node): void => {
    if (readsCookie) return;
    if (isDynamicHandlerCodeExecution(node)) {
      readsCookie = true;
      return;
    }
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);
      const receiver = headerMethodReceiver(callee, requestNames, headersNames);
      if (receiver && (receiver.method === 'get' || receiver.method === 'has')) {
        const header = staticHeaderName(node.arguments[0], staticStrings);
        if (header === undefined || !isProvablyNonAmbientMutationHeader(header)) {
          readsCookie = true;
          return;
        }
      }
    }
    if (
      isHeaderCarrierExpression(node, requestNames, headersNames) &&
      !isSafeHeaderCarrierUse(node, requestNames, headersNames)
    ) {
      readsCookie = true;
      return;
    }
    if (
      isRequestCarrierExpression(node, requestNames, headersNames) &&
      !isSafeRequestCarrierUse(node, requestNames, headersNames)
    ) {
      readsCookie = true;
      return;
    }
    ts.forEachChild(node, visitReads);
  };
  visitReads(body);
  return readsCookie;
}

const BROWSER_STATE_MUTATION_SINKS = new Set([
  'forwardSetCookie',
  'setCookie',
  'setSessionRevocationClearSiteData',
]);
const SAFE_MUTATION_CONTEXT_MEMBERS = new Set(['fail', 'invalidate']);

function handlerMutatesBrowserState(
  body: ts.ConciseBody,
  contextParameter: ts.ParameterDeclaration | undefined,
): boolean {
  if (!contextParameter) return false;
  if (contextParameter.dotDotDotToken) return true;

  const contextNames = compilerCreateSet<string>();
  const sinkNames = compilerCreateSet<string>();
  if (ts.isIdentifier(contextParameter.name)) {
    compilerSetAdd(contextNames, contextParameter.name.text);
  } else if (ts.isObjectBindingPattern(contextParameter.name)) {
    const elements = compilerSnapshotDenseArray(
      contextParameter.name.elements,
      'Mutation context binding elements',
    );
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index]!;
      if (element.dotDotDotToken) return true;
      const property =
        propertyNameText(element.propertyName) ??
        (ts.isIdentifier(element.name) ? element.name.text : undefined);
      if (property === undefined) return true;
      if (compilerSetHas(BROWSER_STATE_MUTATION_SINKS, property)) {
        if (!ts.isIdentifier(element.name)) return true;
        compilerSetAdd(sinkNames, element.name.text);
      }
    }
  } else {
    return true;
  }

  let unsafe = false;
  const visit = (node: ts.Node): void => {
    if (unsafe) return;
    if (ts.isIdentifier(node) && compilerSetHas(sinkNames, node.text)) {
      if (ts.isBindingElement(node.parent) && node.parent.name === node) return;
      unsafe = true;
      return;
    }
    if (ts.isExpression(node)) {
      const member = requestAuthorityMember(node);
      const receiver = member && unwrapExpression(member.receiver);
      if (receiver && ts.isIdentifier(receiver) && compilerSetHas(contextNames, receiver.text)) {
        if (
          compilerSetHas(BROWSER_STATE_MUTATION_SINKS, member.name) ||
          !compilerSetHas(SAFE_MUTATION_CONTEXT_MEMBERS, member.name)
        ) {
          unsafe = true;
        }
        return;
      }
    }
    if (ts.isIdentifier(node) && compilerSetHas(contextNames, node.text)) {
      const parent = node.parent;
      if ((ts.isParameter(parent) || ts.isVariableDeclaration(parent)) && parent.name === node) {
        return;
      }
      if (
        (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
        parent.expression === node &&
        requestAuthorityMember(parent) !== undefined
      ) {
        return;
      }
      unsafe = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return unsafe;
}

function isProvablyNonAmbientMutationHeader(value: string): boolean {
  const header = compilerStringToLowerCase(value);
  return (
    header === 'accept' ||
    header === 'content-length' ||
    header === 'content-type' ||
    header === 'user-agent' ||
    compilerStringIncludes(header, 'signature') ||
    compilerStringIncludes(header, 'hmac') ||
    compilerStringStartsWith(header, 'kovo-') ||
    compilerStringStartsWith(header, 'webhook-') ||
    compilerStringStartsWith(header, 'x-kovo-') ||
    compilerStringStartsWith(header, 'x-machine-')
  );
}

function isDynamicHandlerCodeExecution(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return false;
  const callee = unwrapExpression(node.expression);
  if (ts.isIdentifier(callee)) return callee.text === 'eval' || callee.text === 'Function';
  const member = requestAuthorityMember(callee);
  if (member?.name === 'constructor') return true;
  if (member?.name !== 'eval' && member?.name !== 'Function') return false;
  const receiver = unwrapExpression(member.receiver);
  return (
    ts.isIdentifier(receiver) &&
    (receiver.text === 'globalThis' || receiver.text === 'self' || receiver.text === 'window')
  );
}

function handlerBodyReferencesArguments(body: ts.ConciseBody): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== body && ts.isFunctionLike(node) && !ts.isArrowFunction(node)) return;
    if (ts.isIdentifier(node) && node.text === 'arguments') {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

interface HandlerLocalBinding {
  readonly name: string;
  readonly scope: ts.Node;
}

const INERT_FREE_HANDLER_IDENTIFIERS = new Set(['Infinity', 'NaN', 'undefined']);

/**
 * KV418's compiler proof must describe the executable handler, including closure authority.
 * Function source text does not encode which lexical cell a free identifier resolves to, so two
 * byte-identical handlers can have different authority. Fail every module/global/object/function
 * capture closed; handler-local declarations (including recursively composed literal constants)
 * remain inspectable by the existing request/header provenance pass.
 */
function handlerReferencesUnprovenFreeAuthority(
  body: ts.ConciseBody,
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
): boolean {
  const handler = body.parent;
  const root = ts.isFunctionLike(handler) ? handler : body;
  const bindings: HandlerLocalBinding[] = [];

  const parameterSnapshot = compilerSnapshotDenseArray(parameters, 'Handler authority parameters');
  for (let index = 0; index < parameterSnapshot.length; index += 1) {
    const parameter = parameterSnapshot[index]!;
    recordHandlerBindingName(bindings, parameter.name, root);
  }
  if ((ts.isFunctionExpression(root) || ts.isClassExpression(root)) && root.name !== undefined) {
    bindings[bindings.length] = { name: root.name.text, scope: root };
  }

  const collectBindings = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      recordHandlerBindingName(bindings, node.name, handlerVariableBindingScope(node, root));
    } else if (ts.isParameter(node) && !handlerParameterIsDeclared(parameterSnapshot, node)) {
      recordHandlerBindingName(bindings, node.name, node.parent);
    } else if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
      recordHandlerBindingName(bindings, node.variableDeclaration.name, node);
    } else if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isEnumDeclaration(node)) &&
      node.name !== undefined
    ) {
      bindings[bindings.length] = {
        name: node.name.text,
        scope: handlerLexicalBindingScope(node, root),
      };
    } else if (
      (ts.isFunctionExpression(node) || ts.isClassExpression(node)) &&
      node.name !== undefined
    ) {
      bindings[bindings.length] = { name: node.name.text, scope: node };
    }

    if (node !== root && ts.isFunctionLike(node) && !ts.isArrowFunction(node)) {
      bindings[bindings.length] = { name: 'arguments', scope: node };
    }
    ts.forEachChild(node, collectBindings);
  };
  for (let index = 0; index < parameterSnapshot.length; index += 1) {
    const parameter = parameterSnapshot[index]!;
    if (parameter.initializer !== undefined) collectBindings(parameter.initializer);
  }
  collectBindings(body);

  let unsafe = false;
  const visit = (node: ts.Node): void => {
    if (unsafe) return;
    if (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.SuperKeyword) {
      unsafe = true;
      return;
    }
    if (
      ts.isIdentifier(node) &&
      isRuntimeIdentifierReference(node, root) &&
      !compilerSetHas(INERT_FREE_HANDLER_IDENTIFIERS, node.text) &&
      !handlerBindingCoversIdentifier(bindings, node)
    ) {
      unsafe = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  for (let index = 0; index < parameterSnapshot.length; index += 1) {
    const parameter = parameterSnapshot[index]!;
    if (parameter.initializer !== undefined) visit(parameter.initializer);
  }
  visit(body);
  return unsafe;
}

function handlerParameterIsDeclared(
  parameters: readonly ts.ParameterDeclaration[],
  candidate: ts.ParameterDeclaration,
): boolean {
  for (let index = 0; index < parameters.length; index += 1) {
    if (parameters[index] === candidate) return true;
  }
  return false;
}

function handlerBindingCoversIdentifier(
  bindings: readonly HandlerLocalBinding[],
  identifier: ts.Identifier,
): boolean {
  const snapshot = compilerSnapshotDenseArray(bindings, 'Handler-local authority bindings');
  for (let index = 0; index < snapshot.length; index += 1) {
    const binding = snapshot[index]!;
    if (binding.name === identifier.text && handlerNodeIsWithin(identifier, binding.scope)) {
      return true;
    }
  }
  return false;
}

function recordHandlerBindingName(
  bindings: HandlerLocalBinding[],
  name: ts.BindingName,
  scope: ts.Node,
): void {
  if (ts.isIdentifier(name)) {
    bindings[bindings.length] = { name: name.text, scope };
    return;
  }
  const elements = compilerSnapshotDenseArray(name.elements, 'Handler binding elements');
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (ts.isOmittedExpression(element)) continue;
    recordHandlerBindingName(bindings, element.name, scope);
  }
}

function handlerVariableBindingScope(node: ts.VariableDeclaration, root: ts.Node): ts.Node {
  const list = ts.isVariableDeclarationList(node.parent) ? node.parent : undefined;
  if (list && (ts.getCombinedNodeFlags(list) & ts.NodeFlags.BlockScoped) === 0) {
    let current: ts.Node | undefined = node.parent;
    while (current && current !== root) {
      if (ts.isFunctionLike(current)) return current;
      current = current.parent;
    }
    return root;
  }

  let current: ts.Node | undefined = node.parent;
  while (current && current !== root) {
    if (
      ts.isForStatement(current) ||
      ts.isForInStatement(current) ||
      ts.isForOfStatement(current) ||
      ts.isBlock(current) ||
      ts.isCaseBlock(current) ||
      ts.isCatchClause(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return root;
}

function handlerLexicalBindingScope(node: ts.Node, root: ts.Node): ts.Node {
  let current: ts.Node | undefined = node.parent;
  while (current && current !== root) {
    if (
      ts.isBlock(current) ||
      ts.isCaseBlock(current) ||
      ts.isCatchClause(current) ||
      ts.isForStatement(current) ||
      ts.isForInStatement(current) ||
      ts.isForOfStatement(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return root;
}

function handlerNodeIsWithin(node: ts.Node, scope: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current !== undefined) {
    if (current === scope) return true;
    current = current.parent;
  }
  return false;
}

function isRuntimeIdentifierReference(node: ts.Identifier, root: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current && current !== root) {
    if (ts.isTypeNode(current)) return false;
    current = current.parent;
  }

  const parent = node.parent;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isGetAccessorDeclaration(parent) && parent.name === node) ||
    (ts.isSetAccessorDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isEnumMember(parent) && parent.name === node) ||
    (ts.isLabeledStatement(parent) && parent.label === node) ||
    (ts.isBreakOrContinueStatement(parent) && parent.label === node) ||
    (ts.isJsxAttribute(parent) && parent.name === node)
  ) {
    return false;
  }
  if (identifierBelongsToBindingName(node)) return false;
  if (
    ((ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isEnumDeclaration(parent)) &&
      parent.name === node) ||
    (ts.isImportSpecifier(parent) && (parent.name === node || parent.propertyName === node)) ||
    (ts.isExportSpecifier(parent) && (parent.name === node || parent.propertyName === node))
  ) {
    return false;
  }
  if (
    (ts.isJsxOpeningElement(parent) ||
      ts.isJsxClosingElement(parent) ||
      ts.isJsxSelfClosingElement(parent)) &&
    parent.tagName === node
  ) {
    return !/^[a-z]/.test(node.text);
  }
  return true;
}

function identifierBelongsToBindingName(node: ts.Identifier): boolean {
  let current: ts.Node = node;
  while (true) {
    const parent = current.parent;
    if (ts.isBindingElement(parent)) {
      return parent.name === current || parent.propertyName === current;
    }
    if (ts.isObjectBindingPattern(parent) || ts.isArrayBindingPattern(parent)) {
      current = parent;
      continue;
    }
    if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent)) && parent.name === current) {
      return true;
    }
    return false;
  }
}

type RequestAuthorityExpressionKind = 'headers' | 'request' | undefined;

function requestBindingMayExposeAmbientAuthority(name: ts.BindingName): boolean {
  if (ts.isIdentifier(name)) return false;
  if (!ts.isObjectBindingPattern(name)) return true;

  const elements = compilerSnapshotDenseArray(name.elements, 'Request binding elements');
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (element.dotDotDotToken) return true;
    const property =
      propertyNameText(element.propertyName) ??
      (ts.isIdentifier(element.name) ? element.name.text : undefined);
    if (property === undefined) return true;
    if (compilerStringToLowerCase(property) === 'headers') {
      if (!ts.isIdentifier(element.name)) return true;
      continue;
    }
    if (!compilerSetHas(NON_AMBIENT_REQUEST_MEMBERS, property)) return true;
  }

  return false;
}

function collectRequestParameterAuthority(
  name: ts.BindingName,
  requestNames: Set<string>,
  headersNames: Set<string>,
): void {
  if (ts.isIdentifier(name)) {
    compilerSetAdd(requestNames, name.text);
    return;
  }
  if (!ts.isObjectBindingPattern(name)) return;
  const elements = compilerSnapshotDenseArray(name.elements, 'Request parameter binding elements');
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    const property =
      propertyNameText(element.propertyName) ??
      (ts.isIdentifier(element.name) ? element.name.text : undefined);
    if (
      property !== undefined &&
      compilerStringToLowerCase(property) === 'headers' &&
      ts.isIdentifier(element.name)
    ) {
      compilerSetAdd(headersNames, element.name.text);
    }
  }
}

function collectAuthorityAlias(
  name: ts.BindingName,
  initializer: ts.Expression,
  requestNames: Set<string>,
  headersNames: Set<string>,
): boolean {
  const kind = requestAuthorityExpressionKind(initializer, requestNames, headersNames);
  let changed = false;
  if (ts.isIdentifier(name)) {
    const target =
      kind === 'request' ? requestNames : kind === 'headers' ? headersNames : undefined;
    if (target && !compilerSetHas(target, name.text)) {
      compilerSetAdd(target, name.text);
      changed = true;
    }
    return changed;
  }
  if (kind !== 'request' || !ts.isObjectBindingPattern(name)) return false;
  const elements = compilerSnapshotDenseArray(name.elements, 'Request alias binding elements');
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    const property =
      propertyNameText(element.propertyName) ??
      (ts.isIdentifier(element.name) ? element.name.text : undefined);
    if (
      property !== undefined &&
      compilerStringToLowerCase(property) === 'headers' &&
      ts.isIdentifier(element.name) &&
      !compilerSetHas(headersNames, element.name.text)
    ) {
      compilerSetAdd(headersNames, element.name.text);
      changed = true;
    }
  }
  return changed;
}

function requestAuthorityExpressionKind(
  expression: ts.Expression,
  requestNames: ReadonlySet<string>,
  headersNames: ReadonlySet<string>,
): RequestAuthorityExpressionKind {
  const value = unwrapExpression(expression);
  if (ts.isIdentifier(value)) {
    if (compilerSetHas(requestNames, value.text)) return 'request';
    if (compilerSetHas(headersNames, value.text)) return 'headers';
    return undefined;
  }
  if (ts.isCallExpression(value)) {
    const member = requestAuthorityMember(unwrapExpression(value.expression));
    if (
      member?.name === 'clone' &&
      requestAuthorityExpressionKind(member.receiver, requestNames, headersNames) === 'request'
    ) {
      return 'request';
    }
  }
  if (
    ts.isElementAccessExpression(value) &&
    requestAuthorityMember(value) === undefined &&
    requestAuthorityExpressionKind(value.expression, requestNames, headersNames) === 'request'
  ) {
    // A computed request member can be `headers`; fail closed when its identity
    // cannot be proven statically.
    return 'headers';
  }
  const member = requestAuthorityMember(value);
  return member !== undefined &&
    compilerStringToLowerCase(member.name) === 'headers' &&
    requestAuthorityExpressionKind(member.receiver, requestNames, headersNames) === 'request'
    ? 'headers'
    : undefined;
}

function requestAuthorityMember(
  expression: ts.Expression,
): { name: string; receiver: ts.Expression } | undefined {
  if (ts.isPropertyAccessExpression(expression)) {
    return { name: expression.name.text, receiver: expression.expression };
  }
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
    const argument = unwrapExpression(expression.argumentExpression);
    if (ts.isStringLiteralLike(argument)) {
      return { name: argument.text, receiver: expression.expression };
    }
  }
  return undefined;
}

function headerMethodReceiver(
  expression: ts.Expression,
  requestNames: ReadonlySet<string>,
  headersNames: ReadonlySet<string>,
): { method: string } | undefined {
  const member = requestAuthorityMember(expression);
  if (!member) return undefined;
  return requestAuthorityExpressionKind(member.receiver, requestNames, headersNames) === 'headers'
    ? { method: member.name }
    : undefined;
}

function isHeaderCarrierExpression(
  node: ts.Node,
  requestNames: ReadonlySet<string>,
  headersNames: ReadonlySet<string>,
): node is ts.Expression {
  return (
    ts.isExpression(node) &&
    requestAuthorityExpressionKind(node, requestNames, headersNames) === 'headers'
  );
}

function isRequestCarrierExpression(
  node: ts.Node,
  requestNames: ReadonlySet<string>,
  headersNames: ReadonlySet<string>,
): node is ts.Expression {
  return (
    ts.isExpression(node) &&
    requestAuthorityExpressionKind(node, requestNames, headersNames) === 'request'
  );
}

const NON_AMBIENT_REQUEST_MEMBERS = new Set([
  'args',
  'arrayBuffer',
  'blob',
  'body',
  'bodyUsed',
  'bytes',
  'cache',
  'clone',
  'credentials',
  'db',
  'destination',
  'formData',
  'headers',
  'integrity',
  'json',
  'keepalive',
  'method',
  'mode',
  'redirect',
  'referrer',
  'referrerPolicy',
  'signal',
  'text',
  'url',
]);

function isSafeRequestCarrierUse(
  node: ts.Expression,
  requestNames: ReadonlySet<string>,
  headersNames: ReadonlySet<string>,
): boolean {
  const parent = node.parent;
  if (ts.isIdentifier(node) && ts.isPropertyAccessExpression(parent) && parent.name === node) {
    return true;
  }
  if (
    (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)) &&
    parent.name === node
  ) {
    return true;
  }
  if (
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent)) &&
    parent.expression === node
  ) {
    return true;
  }
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
    return !requestBindingMayExposeAmbientAuthority(parent.name);
  }
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    if (parent.left === node) return true;
    if (parent.right === node) return ts.isIdentifier(parent.left);
  }
  if (
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === node
  ) {
    const member = requestAuthorityMember(parent);
    if (!member || !compilerSetHas(NON_AMBIENT_REQUEST_MEMBERS, member.name)) return false;
    if (member.name !== 'clone') return true;
    return (
      ts.isCallExpression(parent.parent) && unwrapExpression(parent.parent.expression) === parent
    );
  }
  if (ts.isCallExpression(node)) {
    // `request.clone()` is itself a request carrier; it is safe only while being
    // aliased or selecting a statically non-ambient member, handled above.
    return false;
  }
  return requestAuthorityExpressionKind(node, requestNames, headersNames) !== 'request';
}

function isSafeHeaderCarrierUse(
  node: ts.Expression,
  requestNames: ReadonlySet<string>,
  headersNames: ReadonlySet<string>,
): boolean {
  const parent = node.parent;
  if (ts.isIdentifier(node) && ts.isPropertyAccessExpression(parent) && parent.name === node) {
    return true;
  }
  if (
    (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)) &&
    parent.name === node
  ) {
    return true;
  }
  if (
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    return true;
  }
  if (
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent)) &&
    parent.expression === node
  ) {
    return true;
  }
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
    return ts.isIdentifier(parent.name);
  }
  if (
    ts.isBinaryExpression(parent) &&
    parent.right === node &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    return ts.isIdentifier(parent.left);
  }
  const member =
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === node
      ? requestAuthorityMember(parent)
      : undefined;
  if (!member || (member.name !== 'get' && member.name !== 'has')) return false;
  const call = parent.parent;
  return (
    ts.isCallExpression(call) &&
    unwrapExpression(call.expression) === parent &&
    requestAuthorityExpressionKind(node, requestNames, headersNames) === 'headers'
  );
}

function handlerStaticStrings(body: ts.ConciseBody): ReadonlyMap<string, string> {
  const candidates = compilerCreateMap<string, ts.Expression>();
  const invalid = compilerCreateSet<string>();
  const invalidateBindings = (name: ts.BindingName): void => {
    const names: string[] = [];
    collectBindingNames(name, names);
    const snapshot = compilerSnapshotDenseArray(names, 'Invalidated handler bindings');
    for (let index = 0; index < snapshot.length; index += 1) {
      compilerSetAdd(invalid, snapshot[index]!);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      if (
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.Const) !== 0
      ) {
        if (compilerMapGet(candidates, node.name.text) !== undefined) {
          compilerSetAdd(invalid, node.name.text);
        } else {
          compilerMapSet(candidates, node.name.text, node.initializer);
        }
      } else {
        invalidateBindings(node.name);
      }
    }
    if (ts.isParameter(node)) invalidateBindings(node.name);
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name !== undefined
    ) {
      compilerSetAdd(invalid, node.name.text);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      const target = unwrapExpression(node.left);
      if (ts.isIdentifier(target)) compilerSetAdd(invalid, target.text);
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      const target = unwrapExpression(node.operand);
      if (ts.isIdentifier(target)) compilerSetAdd(invalid, target.text);
    }
    if (
      (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
      ts.isIdentifier(node.initializer)
    ) {
      compilerSetAdd(invalid, node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);

  const values = compilerCreateMap<string, string>();
  const resolving = compilerCreateSet<string>();
  const resolve = (name: string): string | undefined => {
    if (compilerSetHas(invalid, name)) return undefined;
    const known = compilerMapGet(values, name);
    if (known !== undefined) return known;
    if (compilerSetHas(resolving, name)) return undefined;
    const initializer = compilerMapGet(candidates, name);
    if (!initializer) return undefined;

    compilerSetAdd(resolving, name);
    const expression = unwrapExpression(initializer);
    const value =
      ts.isStringLiteralLike(expression) || ts.isNoSubstitutionTemplateLiteral(expression)
        ? expression.text
        : ts.isIdentifier(expression)
          ? resolve(expression.text)
          : undefined;
    compilerSetDelete(resolving, name);
    if (value !== undefined) compilerMapSet(values, name, value);
    return value;
  };

  compilerMapForEach(candidates, (_initializer, name) => {
    resolve(name);
  });
  return values;
}

function staticHeaderName(
  expression: ts.Expression | undefined,
  values: ReadonlyMap<string, string>,
): string | undefined {
  if (!expression) return undefined;
  const value = unwrapExpression(expression);
  if (ts.isStringLiteralLike(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  return ts.isIdentifier(value) ? compilerMapGet(values, value.text) : undefined;
}

function endpointHandlerModels(
  sourceFile: ts.SourceFile,
  source: string,
  call: ts.CallExpression,
): MutationHandlerModel[] {
  const owner = endpointOwner(call);
  return handlerPropertyEntries(sourceFile, source, call).map(({ body, model }) => ({
    ...model,
    handlerWriteSinks: handlerWriteSinkFacts(sourceFile, source, body, {
      owner,
      surface: 'endpoint',
    }),
  }));
}

interface HandlerPropertyEntry {
  body: ts.ConciseBody;
  handler: ts.ArrowFunction | ts.FunctionExpression | ts.MethodDeclaration;
  model: MutationHandlerModel;
  parameters: ts.NodeArray<ts.ParameterDeclaration>;
}

function handlerPropertyEntries(
  sourceFile: ts.SourceFile,
  source: string,
  call: ts.CallExpression,
): HandlerPropertyEntry[] {
  let options: ts.ObjectLiteralExpression | undefined;
  const argumentLength = compilerArrayLength(call.arguments, 'Handler factory arguments');
  for (let index = 0; index < argumentLength; index += 1) {
    const argument = compilerOwnDataValue(call.arguments, index, 'Handler factory arguments') as
      | ts.Expression
      | undefined;
    if (!argument) throw new TypeError(`Handler factory arguments[${index}] must be own data.`);
    if (ts.isObjectLiteralExpression(argument)) {
      options = argument;
      break;
    }
  }
  if (!options || !ts.isObjectLiteralExpression(options)) return [];

  const result: HandlerPropertyEntry[] = [];
  const propertyLength = compilerArrayLength(options.properties, 'Handler factory properties');
  for (let index = 0; index < propertyLength; index += 1) {
    const property = compilerOwnDataValue(
      options.properties,
      index,
      'Handler factory properties',
    ) as ts.ObjectLiteralElementLike | undefined;
    if (!property) throw new TypeError(`Handler factory properties[${index}] must be own data.`);
    if (ts.isMethodDeclaration(property) && propertyNameText(property.name) === 'handler') {
      if (property.body) {
        result[result.length] = {
          body: property.body,
          handler: property,
          model: functionBodyModel(sourceFile, source, property.body, property.parameters),
          parameters: property.parameters,
        };
      }
      continue;
    }

    if (!ts.isPropertyAssignment(property) || propertyNameText(property.name) !== 'handler') {
      continue;
    }

    const initializer = unwrapExpression(property.initializer);
    if (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer)) continue;

    result[result.length] = {
      body: initializer.body,
      handler: initializer,
      model: functionBodyModel(sourceFile, source, initializer.body, initializer.parameters),
      parameters: initializer.parameters,
    };
  }
  return result;
}

function webhookHandlerModels(
  sourceFile: ts.SourceFile,
  source: string,
  call: ts.CallExpression,
  domainBindings: ReadonlyMap<string, string>,
): WebhookHandlerModel[] {
  const owner = webhookOwner(sourceFile, call);
  const definition = taskDefinitionObject(call);
  const declaredWriteKeys = definition
    ? webhookDeclaredWriteKeys(sourceFile, definition, domainBindings)
    : [];
  return handlerPropertyEntries(sourceFile, source, call).map(({ body, model, parameters }) => ({
    ...model,
    handlerWriteSinks: [
      ...handlerWriteSinkFacts(sourceFile, source, body, {
        owner,
        surface: 'webhook',
      }),
      ...webhookTransactionRawDriverEscapeFacts(sourceFile, body, {
        contextParamName: model.paramNames[1],
        owner,
      }),
    ].sort((left, right) => left.span.start - right.span.start),
    webhookRecordChanges: webhookRecordChangeFacts(sourceFile, body, {
      contextParamName: model.paramNames[1],
      declaredWriteKeys,
      domainBindings,
      owner,
      recordChangeParamNames: webhookRecordChangeParamNames(parameters[1]?.name),
    }),
    declaredWriteKeys,
    owner,
    runMutationEdges: taskCompositionEdges(
      sourceFile,
      source,
      body,
      model.paramNames[1],
      'runMutation',
    ),
  }));
}

function taskRunHandlerModels(
  sourceFile: ts.SourceFile,
  source: string,
  call: ts.CallExpression,
): TaskRunHandlerModel[] {
  const definition = taskDefinitionObject(call);
  if (!definition) return [];

  const key = taskKey(sourceFile, call);
  const cron = staticStringObjectProperty(definition, 'cron');

  return definition.properties.flatMap((property) => {
    const handler = runHandlerModel(sourceFile, source, property);
    if (!handler) return [];
    const ctxParam = handler.model.paramNames[1];

    return [
      {
        ...handler.model,
        ...(cron === undefined ? {} : { cron }),
        handlerWriteSinks: handlerWriteSinkFacts(sourceFile, source, handler.body, {
          owner: { kind: 'key', value: key },
          surface: 'task',
        }),
        key,
        runMutationEdges: taskCompositionEdges(
          sourceFile,
          source,
          handler.body,
          ctxParam,
          'runMutation',
        ),
        runQueryEdges: taskCompositionEdges(sourceFile, source, handler.body, ctxParam, 'runQuery'),
        scheduleEdges: taskCompositionEdges(sourceFile, source, handler.body, ctxParam, 'schedule'),
      },
    ];
  });
}

function taskDefinitionObject(call: ts.CallExpression): ts.ObjectLiteralExpression | null {
  const definition = call.arguments.length >= 2 ? call.arguments[1] : call.arguments[0];
  return definition && ts.isObjectLiteralExpression(definition) ? definition : null;
}

function taskKey(sourceFile: ts.SourceFile, call: ts.CallExpression): string {
  const [first] = call.arguments;
  if (first && ts.isStringLiteralLike(first)) return first.text;

  const exported = exportedConstInitializerName(call);
  if ('exportedConstName' in exported) {
    return deriveRegistryIdentity(sourceFile.fileName, exported.exportedConstName).key;
  }
  return sourceFile.fileName;
}

function mutationOwner(sourceFile: ts.SourceFile, call: ts.CallExpression): HandlerWriteSinkOwner {
  const [first] = call.arguments;
  const firstValue = first ? unwrapExpression(first) : undefined;
  if (firstValue && ts.isStringLiteralLike(firstValue)) {
    return { kind: 'key', value: firstValue.text };
  }
  // Object-form declarations derive their key from an exported binding. A
  // non-literal legacy key is runtime data, so attaching this fact to the export-
  // derived name would falsely green-light the actual registry key. Preserve an
  // unresolved owner and let KV418 conservatively apply it to every exempt mutation.
  if (firstValue && !ts.isObjectLiteralExpression(firstValue)) {
    return { kind: 'key', value: 'UNRESOLVED' };
  }

  const exported = exportedConstInitializerName(call);
  if ('exportedConstName' in exported) {
    return {
      kind: 'key',
      value: deriveMutationKey(sourceFile.fileName, exported.exportedConstName),
    };
  }
  return { kind: 'key', value: 'UNRESOLVED' };
}

function mutationDirectDbTargetIdentities(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
): ReadonlySet<string> {
  const requestParamNames = new Set<string>();
  const targets = new Set<string>();

  for (const parameter of parameters) {
    collectDirectDbBindingNames(parameter.name, targets);
    if (ts.isIdentifier(parameter.name) && isRequestLikeParamName(parameter.name.text)) {
      requestParamNames.add(parameter.name.text);
      targets.add(`${parameter.name.text}.db`);
    }
  }

  const addAlias = (name: ts.BindingName, initializer: ts.Expression | undefined): void => {
    if (!initializer) return;
    const target = mutationDirectDbTargetIdentityFromExpression(initializer, targets);
    const unwrappedInitializer = unwrapExpression(initializer);
    const initializerName = ts.isIdentifier(unwrappedInitializer)
      ? unwrappedInitializer.text
      : undefined;
    const requestLikeInitializer =
      initializerName !== undefined && requestParamNames.has(initializerName);
    if (!target && !requestLikeInitializer) return;

    if (ts.isIdentifier(name)) {
      targets.add(name.text);
      return;
    }
    collectDirectDbBindingNames(name, targets);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) addAlias(node.name, node.initializer);
    ts.forEachChild(node, visit);
  };

  visit(body);
  return targets;
}

function collectDirectDbBindingNames(name: ts.BindingName, targets: Set<string>): void {
  if (ts.isIdentifier(name)) {
    if (name.text === 'db' || looksLikeDbTargetIdentity(name.text)) targets.add(name.text);
    return;
  }

  if (!ts.isObjectBindingPattern(name)) return;

  for (const element of name.elements) {
    const propertyName = element.propertyName;
    const bindingName = element.name;
    const bindsDbProperty =
      propertyName === undefined
        ? ts.isIdentifier(bindingName) && bindingName.text === 'db'
        : bindingPropertyNameText(propertyName) === 'db';
    if (bindsDbProperty) collectBindingIdentifiers(bindingName, targets);
  }
}

function collectBindingIdentifiers(name: ts.BindingName, targets: Set<string>): void {
  if (ts.isIdentifier(name)) {
    targets.add(name.text);
    return;
  }

  if (ts.isObjectBindingPattern(name)) {
    for (const element of name.elements) collectBindingIdentifiers(element.name, targets);
    return;
  }

  for (const element of name.elements) {
    if (ts.isBindingElement(element)) collectBindingIdentifiers(element.name, targets);
  }
}

function bindingPropertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function mutationDirectDbTargetIdentityFromExpression(
  expression: ts.Expression,
  targets: ReadonlySet<string>,
): string | undefined {
  const unwrapped = unwrapExpression(expression);
  const identity = expressionTargetIdentity(unwrapped);
  if (identity && (targets.has(identity) || looksLikeDbTargetIdentity(identity))) return identity;
  return undefined;
}

function expressionTargetIdentity(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return propertyAccessPath(expression) ?? undefined;
  const receiver = callExpressionReceiverSegments(expression);
  if (receiver) return receiver.join('.');
  if (ts.isCallExpression(expression)) {
    if (ts.isIdentifier(expression.expression)) return `${expression.expression.text}()`;
    if (ts.isPropertyAccessExpression(expression.expression)) {
      const path = propertyAccessPath(expression.expression);
      return path ? `${path}()` : undefined;
    }
  }
  return undefined;
}

function looksLikeDbTargetIdentity(identity: string): boolean {
  const normalized = identity.toLowerCase();
  return normalized.includes('db') || normalized.includes('database');
}

const requestLikeContextParamNames = new Set(['context', 'ctx']);

function isRequestLikeParamName(param: string): boolean {
  if (requestLikeContextParamNames.has(param)) return true;
  return param.toLowerCase().endsWith('request');
}

function webhookOwner(sourceFile: ts.SourceFile, call: ts.CallExpression): HandlerWriteSinkOwner {
  const [first] = call.arguments;
  if (first && ts.isStringLiteralLike(first)) return { kind: 'path', value: first.text };

  const definition = taskDefinitionObject(call);
  const path = definition ? staticStringObjectProperty(definition, 'path') : undefined;
  if (path !== undefined) return { kind: 'path', value: path };

  const exported = exportedConstInitializerName(call);
  if ('exportedConstName' in exported) return { kind: 'path', value: exported.exportedConstName };
  return { kind: 'path', value: 'UNRESOLVED' };
}

function endpointOwner(call: ts.CallExpression): HandlerWriteSinkOwner {
  const [first] = call.arguments;
  if (first && ts.isStringLiteralLike(first)) return { kind: 'path', value: first.text };

  return { kind: 'path', value: 'UNRESOLVED' };
}

function webhookDeclaredWriteKeys(
  sourceFile: ts.SourceFile,
  definition: ts.ObjectLiteralExpression,
  domainBindings: ReadonlyMap<string, string>,
): string[] {
  const writes = definition.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && propertyNameText(property.name) === 'writes',
  );
  if (!writes) return [];

  const initializer = unwrapExpression(writes.initializer);
  if (!ts.isArrayLiteralExpression(initializer)) return ['UNRESOLVED'];

  return initializer.elements.map((element) => {
    const expression = ts.isSpreadElement(element) ? element.expression : element;
    return domainKeyFromExpression(sourceFile, expression, domainBindings) ?? 'UNRESOLVED';
  });
}

function webhookTransactionRawDriverEscapeFacts(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  options: {
    readonly contextParamName: string | undefined;
    readonly owner: HandlerWriteSinkOwner;
  },
): HandlerWriteSinkFact[] {
  if (options.contextParamName === undefined) return [];

  const txTargets = new Set([`${options.contextParamName}.tx`]);
  const facts = new Map<string, HandlerWriteSinkFact>();

  const addTxAlias = (name: ts.BindingName, initializer: ts.Expression | undefined): void => {
    if (!initializer) return;
    const identity = expressionTargetIdentity(unwrapExpression(initializer));
    if (identity !== `${options.contextParamName}.tx`) return;

    if (ts.isIdentifier(name)) {
      txTargets.add(name.text);
      return;
    }

    collectBindingIdentifiers(name, txTargets);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) addTxAlias(node.name, node.initializer);

    if (ts.isPropertyAccessExpression(node)) {
      const propertyName = node.name.text;
      if (WEBHOOK_TRANSACTION_RAW_DRIVER_ESCAPE_PROPERTIES.has(propertyName)) {
        const targetIdentity = expressionTargetIdentity(unwrapExpression(node.expression));
        if (targetIdentity !== undefined && txTargets.has(targetIdentity)) {
          const path = `${targetIdentity}.${propertyName}`;
          const fact: HandlerWriteSinkFact = {
            canonicalTarget: {
              identity: targetIdentity,
              provenance: 'property-access-path',
            },
            operationKind: 'raw-driver-escape',
            owner: options.owner,
            path,
            span: { end: node.getEnd(), start: node.getStart(sourceFile) },
            surface: 'webhook',
          };
          facts.set(handlerWriteSinkFactKey(fact), fact);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(body);
  return [...facts.values()].sort((left, right) => left.span.start - right.span.start);
}

function webhookRecordChangeFacts(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  options: {
    readonly contextParamName: string | undefined;
    readonly declaredWriteKeys: readonly string[];
    readonly domainBindings: ReadonlyMap<string, string>;
    readonly owner: HandlerWriteSinkOwner;
    readonly recordChangeParamNames: readonly string[];
  },
): WebhookRecordChangeFact[] {
  const contextParamName = options.contextParamName;
  if (!contextParamName && options.recordChangeParamNames.length === 0) return [];

  const facts: WebhookRecordChangeFact[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const fact = webhookRecordChangeFact(sourceFile, node, options);
      if (fact) facts.push(fact);
    }
    ts.forEachChild(node, visit);
  };

  visit(body);
  return facts.sort((left, right) => left.span.start - right.span.start);
}

function webhookRecordChangeFact(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  options: {
    readonly contextParamName: string | undefined;
    readonly declaredWriteKeys: readonly string[];
    readonly domainBindings: ReadonlyMap<string, string>;
    readonly owner: HandlerWriteSinkOwner;
    readonly recordChangeParamNames: readonly string[];
  },
): WebhookRecordChangeFact | null {
  const callee = unwrapExpression(call.expression);
  if (ts.isPropertyAccessExpression(callee)) {
    if (callee.name.text !== 'recordChange') return null;
    const receiver = unwrapExpression(callee.expression);
    if (
      !options.contextParamName ||
      !ts.isIdentifier(receiver) ||
      receiver.text !== options.contextParamName
    ) {
      return null;
    }
  } else if (!ts.isIdentifier(callee) || !options.recordChangeParamNames.includes(callee.text)) {
    return null;
  }

  const [domainArgument] = call.arguments;
  const domainKey =
    domainArgument === undefined
      ? 'UNRESOLVED'
      : (domainKeyFromExpression(sourceFile, domainArgument, options.domainBindings) ??
        'UNRESOLVED');
  const spanTarget = domainArgument ?? callee;
  return {
    declaredWriteKeys: options.declaredWriteKeys,
    domainKey,
    owner: options.owner,
    span: {
      end: spanTarget.getEnd(),
      start: spanTarget.getStart(sourceFile),
    },
  };
}

function webhookRecordChangeParamNames(name: ts.BindingName | undefined): string[] {
  if (!name || !ts.isObjectBindingPattern(name)) return [];

  return name.elements.flatMap((element) => {
    const propertyName = element.propertyName;
    if (
      propertyName !== undefined &&
      (!ts.isIdentifier(propertyName) || propertyName.text !== 'recordChange')
    ) {
      return [];
    }
    const bindingName = element.name;
    if (!ts.isIdentifier(bindingName)) return [];
    if (propertyName === undefined && bindingName.text !== 'recordChange') return [];
    return [bindingName.text];
  });
}

function domainKeyFromExpression(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  domainBindings: ReadonlyMap<string, string>,
): string | undefined {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) return domainBindings.get(unwrapped.text) ?? 'UNRESOLVED';
  if (!ts.isCallExpression(unwrapped)) return undefined;
  if (!isFrameworkExpression(sourceFile, unwrapped.expression, DOMAIN_FACTORY_IDENTITY)) {
    return undefined;
  }
  const [key] = unwrapped.arguments;
  return key && ts.isStringLiteralLike(key) ? key.text : 'UNRESOLVED';
}

function runHandlerModel(
  sourceFile: ts.SourceFile,
  source: string,
  property: ts.ObjectLiteralElementLike,
): { body: ts.ConciseBody; model: MutationHandlerModel } | null {
  if (ts.isMethodDeclaration(property) && propertyNameText(property.name) === 'run') {
    if (!property.body) return null;
    return {
      body: property.body,
      model: functionBodyModel(sourceFile, source, property.body, property.parameters),
    };
  }

  if (!ts.isPropertyAssignment(property) || propertyNameText(property.name) !== 'run') return null;

  const initializer = property.initializer;
  if (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer)) return null;

  return {
    body: initializer.body,
    model: functionBodyModel(sourceFile, source, initializer.body, initializer.parameters),
  };
}

function functionBodyModel(
  sourceFile: ts.SourceFile,
  source: string,
  body: ts.ConciseBody,
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
): MutationHandlerModel {
  return {
    body: source.slice(body.getStart(sourceFile), body.getEnd()),
    bodyEnd: body.getEnd(),
    bodyPropertyAccesses: propertyAccessPathModels(sourceFile, body),
    bodyStart: body.getStart(sourceFile),
    paramNames: parameters.map((param) => parameterName(param.name)),
    params: parameters.map((param) => source.slice(param.getStart(sourceFile), param.getEnd())),
    paramSpans: parameters.map((param) => ({
      end: param.getEnd(),
      start: param.getStart(sourceFile),
    })),
  };
}

function staticStringObjectProperty(
  object: ts.ObjectLiteralExpression,
  propertyName: string,
): string | undefined {
  const initializer = componentPropertyInitializer(object, propertyName);
  return initializer && ts.isStringLiteralLike(initializer) ? initializer.text : undefined;
}

interface HandlerWriteSinkFactOptions {
  readonly owner: HandlerWriteSinkOwner;
  readonly resolvedTargetFilter?: (identity: string) => boolean;
  readonly surface: HandlerWriteSinkSurface;
}

function handlerWriteSinkFacts(
  sourceFile: ts.SourceFile,
  source: string,
  body: ts.ConciseBody,
  options: HandlerWriteSinkFactOptions,
): HandlerWriteSinkFact[] {
  const facts = new Map<string, HandlerWriteSinkFact>();
  const bodyPropertyAccesses = propertyAccessPathModels(sourceFile, body);

  for (const access of bodyPropertyAccesses) {
    if (!isHandlerWriteSinkOperation(access.terminalName)) continue;
    const fact = resolvedHandlerWriteSinkFact(access, options);
    if (
      options.resolvedTargetFilter &&
      !options.resolvedTargetFilter(fact.canonicalTarget.identity)
    ) {
      continue;
    }
    facts.set(handlerWriteSinkFactKey(fact), fact);
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const unresolved = unresolvedHandlerWriteSinkFact(sourceFile, source, node, options);
      if (unresolved) facts.set(handlerWriteSinkFactKey(unresolved), unresolved);
    }
    ts.forEachChild(node, visit);
  };

  visit(body);
  return [...facts.values()].sort((left, right) => left.span.start - right.span.start);
}

function resolvedHandlerWriteSinkFact(
  access: PropertyAccessPathModel,
  options: HandlerWriteSinkFactOptions,
): HandlerWriteSinkFact {
  const operationKind = handlerWriteSinkOperation(access.terminalName);
  const suffix = `.${access.terminalName}`;
  const targetIdentity = access.path.endsWith(suffix)
    ? access.path.slice(0, -1 * suffix.length)
    : 'UNRESOLVED';
  return {
    canonicalTarget: {
      identity: targetIdentity.length === 0 ? 'UNRESOLVED' : targetIdentity,
      provenance:
        targetIdentity.length === 0 ? 'unresolved-property-access' : 'property-access-path',
    },
    operationKind,
    owner: options.owner,
    path: access.path,
    span: { end: access.end, start: access.start },
    surface: options.surface,
  };
}

function unresolvedHandlerWriteSinkFact(
  sourceFile: ts.SourceFile,
  source: string,
  node: ts.CallExpression,
  options: HandlerWriteSinkFactOptions,
): HandlerWriteSinkFact | null {
  const callee = unwrapParentheses(node.expression);
  if (ts.isPropertyAccessExpression(callee)) {
    if (!isHandlerWriteSinkOperation(callee.name.text)) return null;
    if (propertyAccessPath(callee)) return null;
    const operationKind = handlerWriteSinkOperation(callee.name.text);
    return {
      canonicalTarget: { identity: 'UNRESOLVED', provenance: 'unresolved-property-access' },
      operationKind,
      owner: options.owner,
      path: 'UNRESOLVED',
      span: {
        end: callee.getEnd(),
        start: callee.getStart(sourceFile),
      },
      surface: options.surface,
    };
  }

  if (ts.isElementAccessExpression(callee)) {
    const receiver = source
      .slice(callee.expression.getStart(sourceFile), callee.expression.getEnd())
      .trim();
    if (TASK_CONTEXT_COMPOSITION_METHODS.has(receiver)) return null;
    return {
      canonicalTarget: { identity: 'UNRESOLVED', provenance: 'computed-member' },
      operationKind: 'UNRESOLVED',
      owner: options.owner,
      path: 'UNRESOLVED',
      span: {
        end: callee.getEnd(),
        start: callee.getStart(sourceFile),
      },
      surface: options.surface,
    };
  }

  return null;
}

function isHandlerWriteSinkOperation(name: string): boolean {
  return HANDLER_WRITE_SINK_OPERATIONS.has(name as HandlerWriteSinkOperationKind);
}

function handlerWriteSinkOperation(name: string): HandlerWriteSinkOperationKind {
  return isHandlerWriteSinkOperation(name) ? (name as HandlerWriteSinkOperationKind) : 'UNRESOLVED';
}

function handlerWriteSinkFactKey(fact: HandlerWriteSinkFact): string {
  return [
    fact.surface,
    fact.owner.kind,
    fact.owner.value,
    fact.operationKind,
    fact.path,
    fact.span.start,
    fact.span.end,
  ].join('\0');
}

function taskCompositionEdges(
  sourceFile: ts.SourceFile,
  source: string,
  body: ts.ConciseBody,
  ctxParam: string | undefined,
  method: 'runMutation' | 'runQuery' | 'schedule',
): string[] {
  const edges = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression;
      const receiverText = source.slice(receiver.getStart(sourceFile), receiver.getEnd()).trim();
      if (
        node.expression.name.text === method &&
        (ctxParam === undefined || receiverText === ctxParam)
      ) {
        edges.add(taskCompositionTarget(sourceFile, source, node.arguments[0]) ?? `${method}:?`);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(body);
  return [...edges].sort();
}

function taskCompositionTarget(
  sourceFile: ts.SourceFile,
  source: string,
  expression: ts.Expression | undefined,
): string | undefined {
  if (!expression) return undefined;
  if (ts.isStringLiteralLike(expression)) return expression.text;
  return source
    .slice(expression.getStart(sourceFile), expression.getEnd())
    .replace(/\s+/g, ' ')
    .trim();
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

export function propertyAccessPathModels(
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
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): { staticConstructorType: ObjectLiteralEntry['staticConstructorType'] } | {} {
  if (!ts.isIdentifier(expression)) return {};
  // Component prop constructor shorthand uses platform globals. Local aliases named String/Number/
  // Boolean are app values and must not become static prop schema facts.
  if (identifierResolvesToUnshadowedGlobal(sourceFile, expression, 'String')) {
    return { staticConstructorType: 'string' };
  }
  if (identifierResolvesToUnshadowedGlobal(sourceFile, expression, 'Number')) {
    return { staticConstructorType: 'number' };
  }
  if (identifierResolvesToUnshadowedGlobal(sourceFile, expression, 'Boolean')) {
    return { staticConstructorType: 'boolean' };
  }
  return {};
}

function objectLiteralEntries(
  sourceFile: ts.SourceFile,
  source: string,
  expression: ts.ObjectLiteralExpression,
  staticStringValues: ReadonlyMap<string, string> = new Map(),
): ObjectLiteralEntry[] {
  return expression.properties.flatMap((property) => {
    if (ts.isPropertyAssignment(property)) {
      const key = propertyNameText(property.name, { staticStringValues });
      if (!key) return [];

      return [
        {
          key,
          ...(ts.isObjectLiteralExpression(property.initializer)
            ? {
                objectEntries: objectLiteralEntries(
                  sourceFile,
                  source,
                  property.initializer,
                  staticStringValues,
                ),
              }
            : {}),
          ...staticConstructorTypeEntry(sourceFile, property.initializer),
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
      const key = propertyNameText(property.name, { staticStringValues });
      return key ? [{ key }] : [];
    }

    return [];
  });
}

/**
 * Return object entries only when the JSX primitive-spread lowerer can account for every own
 * enumerable property the object literal creates. A partial fact bag is unsafe here: if an
 * unmodelled spread/accessor/computed name remains at runtime while the lowerer removes the JSX
 * spread, control metadata can either evade contextual analysis or be reconstructed without the
 * runtime control-name boundary (SPEC §4.7/§4.8, §5.2 rule 10, §6.6).
 *
 * Methods and accessors deliberately remain runtime spreads. Static property assignments and
 * shorthands are the only shapes whose names and value expressions the primitive pass preserves
 * exactly. `__proto__` object-literal setters do not create an own enumerable property, so they
 * also stay on the runtime path rather than being invented as an HTML attribute.
 */
function completeJsxSpreadObjectLiteralEntries(
  sourceFile: ts.SourceFile,
  source: string,
  expression: ts.ObjectLiteralExpression,
  staticStringValues: ReadonlyMap<string, string> = new Map(),
): ObjectLiteralEntry[] | undefined {
  for (const property of expression.properties) {
    if (ts.isShorthandPropertyAssignment(property)) continue;
    if (!ts.isPropertyAssignment(property)) return undefined;

    const key = propertyNameText(property.name, { staticStringValues });
    if (!key || key === '__proto__') return undefined;
  }
  return objectLiteralEntries(sourceFile, source, expression, staticStringValues);
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
  moduleScopeObjectEntries: ReadonlyMap<string, readonly ObjectLiteralEntry[]>,
  namedImports: readonly NamedImportModel[],
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
    repeatable: isInsideStaticRepeatCallback(node),
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
      const callImport = namedImports.find((entry) => entry.localName === callName);
      const [firstCallArgument] = callExpression?.arguments ?? [];
      const callArgument = firstCallArgument ? unwrapExpression(firstCallArgument) : undefined;
      const callArgumentBareIdentifierName =
        callArgument && ts.isIdentifier(callArgument) ? callArgument.text : undefined;
      const objectEntries = ts.isObjectLiteralExpression(unwrapped)
        ? completeJsxSpreadObjectLiteralEntries(sourceFile, source, unwrapped)
        : bareIdentifierName === undefined
          ? undefined
          : moduleScopeObjectEntries.get(bareIdentifierName);
      return [
        {
          end: property.getEnd(),
          expression: source.slice(expression.getStart(sourceFile), expression.getEnd()).trim(),
          ...(callName === undefined ? {} : { expressionCallName: callName }),
          ...(callImport === undefined
            ? {}
            : {
                expressionCallImportedName: callImport.importedName,
                expressionCallModuleSpecifier: callImport.moduleSpecifier,
              }),
          ...(callArgumentBareIdentifierName === undefined
            ? {}
            : { expressionCallArgumentBareIdentifierName: callArgumentBareIdentifierName }),
          ...(bareIdentifierName === undefined
            ? {}
            : {
                expressionBareIdentifierName: bareIdentifierName,
                expressionIsBareIdentifier: true,
              }),
          ...(objectEntries === undefined ? {} : { objectEntries }),
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

function isInsideStaticRepeatCallback(node: ts.Node): boolean {
  let current = node.parent;

  while (current) {
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isCallExpression(current.parent) &&
      isStaticRepeatCallback(current.parent, current)
    ) {
      return true;
    }
    current = current.parent;
  }

  return false;
}

function isStaticRepeatCallback(call: ts.CallExpression, callback: ts.Expression): boolean {
  if (call.arguments[0] === callback && ts.isPropertyAccessExpression(call.expression)) {
    // `.map` / `.flatMap` are structural array-iteration recognizers for JSX repeatability.
    return call.expression.name.text === 'map' || call.expression.name.text === 'flatMap';
  }

  if (call.arguments[1] !== callback || !ts.isPropertyAccessExpression(call.expression)) {
    return false;
  }

  return (
    call.expression.name.text === 'from' &&
    ts.isIdentifier(call.expression.expression) &&
    identifierResolvesToUnshadowedGlobal(call.getSourceFile(), call.expression.expression, 'Array')
  );
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
    localConstAliases: localConstAliasModels(sourceFile, source, expression, start),
    localNames: [...new Set([...localIdentifierNames(expression), ...enclosingLocalNames(node)])],
    propertyAccesses: propertyAccessPathModels(sourceFile, expression),
    references: referenceIdentifiers(expression),
    ...(solePath ? { solePropertyAccessPath: solePath } : {}),
    start,
    temporalReads: temporalReadModels(sourceFile, expression),
  };
}

function localConstAliasModels(
  sourceFile: ts.SourceFile,
  source: string,
  expression: ts.Expression,
  expressionStart: number,
): readonly LocalConstAliasModel[] {
  const references = new Set(referenceIdentifiers(expression));
  if (references.size === 0) return [];

  const body = smallestFunctionBlockContaining(sourceFile, expressionStart);
  if (!body) return [];

  const aliases: LocalConstAliasModel[] = [];
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (node.getStart(sourceFile) >= expressionStart) return;
    if (node !== body && isFunctionOrClassLike(node)) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text;
      if (references.has(name) && isConstVariableDeclaration(node)) {
        const accesses = propertyAccessPathModels(sourceFile, node.initializer);
        if (accesses.length > 0 && !seen.has(name)) {
          const start = node.initializer.getStart(sourceFile);
          const end = node.initializer.getEnd();
          seen.add(name);
          aliases.push({
            accesses,
            expression: source.slice(start, end).trim(),
            name,
            references: referenceIdentifiers(node.initializer),
            start: node.getStart(sourceFile),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return aliases;
}

function smallestFunctionBlockContaining(
  sourceFile: ts.SourceFile,
  position: number,
): ts.Block | null {
  let best: ts.Block | null = null;
  const visit = (node: ts.Node): void => {
    if (position < node.getStart(sourceFile) || position > node.getEnd()) return;
    best = functionBlockBody(node) ?? best;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return best;
}

function functionBlockBody(node: ts.Node): ts.Block | null {
  if (
    !(
      ts.isArrowFunction(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    )
  ) {
    return null;
  }
  return node.body && ts.isBlock(node.body) ? node.body : null;
}

function isFunctionOrClassLike(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node)
  );
}

function isConstVariableDeclaration(node: ts.VariableDeclaration): boolean {
  const list = node.parent;
  return ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
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
  expressionConditionalFacts: readonly ConditionalExpressionModel[];
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
    expressionConditionalFacts: conditionalExpressionModels(
      sourceFile,
      source,
      initializer.expression,
    ),
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

function conditionalExpressionModels(
  sourceFile: ts.SourceFile,
  source: string,
  node: ts.Node,
): ConditionalExpressionModel[] {
  const facts: ConditionalExpressionModel[] = [];

  const visit = (current: ts.Node): void => {
    if (ts.isConditionalExpression(current)) {
      const conditionStart = current.condition.getStart(sourceFile);
      const conditionEnd = current.condition.getEnd();
      facts.push({
        condition: source.slice(conditionStart, conditionEnd).trim(),
        conditionEnd,
        conditionPropertyAccesses: propertyAccessPathModels(sourceFile, current.condition),
        conditionStart,
        end: current.getEnd(),
        start: current.getStart(sourceFile),
      });
    }
    ts.forEachChild(current, visit);
  };

  visit(node);
  return facts;
}

function solePropertyAccessPathFromExpression(expression: ts.Expression): string | null {
  const unwrapped = unwrapExpression(expression);
  return ts.isPropertyAccessExpression(unwrapped) ? propertyAccessPath(unwrapped) : null;
}

function temporalReadModels(sourceFile: ts.SourceFile, node: ts.Node): TemporalReadModel[] {
  const reads: TemporalReadModel[] = [];

  const visit = (current: ts.Node): void => {
    if (isDateNowCall(sourceFile, current)) {
      reads.push({
        end: current.getEnd(),
        kind: 'Date.now',
        start: current.getStart(sourceFile),
      });
    } else if (isZeroArgNewDate(sourceFile, current)) {
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

function isDateNowCall(sourceFile: ts.SourceFile, node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    node.arguments.length === 0 &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    identifierResolvesToUnshadowedGlobal(sourceFile, node.expression.expression, 'Date') &&
    node.expression.name.text === 'now'
  );
}

function isZeroArgNewDate(sourceFile: ts.SourceFile, node: ts.Node): node is ts.NewExpression {
  return (
    ts.isNewExpression(node) &&
    node.arguments !== undefined &&
    node.arguments.length === 0 &&
    ts.isIdentifier(node.expression) &&
    identifierResolvesToUnshadowedGlobal(sourceFile, node.expression, 'Date')
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
          start: node.getStart(sourceFile),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(root);
  return referenced.filter((reference) => !declared.has(reference.name));
}

function arrowObjectPatternKeys(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): RenderInputModel[] {
  if (!ts.isArrowFunction(expression)) return [];

  const firstParam = expression.parameters[0];
  if (!firstParam || !ts.isObjectBindingPattern(firstParam.name)) return [];

  return firstParam.name.elements.flatMap((element) => {
    if (!ts.isIdentifier(element.name)) return [];

    return [
      {
        end: element.name.getEnd(),
        name: element.name.text,
        start: element.name.getStart(sourceFile),
        ...bindingElementSourceKey(element),
      },
    ];
  });
}

function bindingElementSourceKey(element: ts.BindingElement): { sourceKey: string } | {} {
  const propertyName = element.propertyName;
  if (!propertyName) return {};
  if (ts.isIdentifier(propertyName) || ts.isStringLiteralLike(propertyName)) {
    return { sourceKey: propertyName.text };
  }
  return {};
}

function renderLocalDeclarationNames(expression: ts.Expression): string[] {
  if (!ts.isArrowFunction(expression)) return [];
  return localDeclarationNames(expression.body);
}

function localIdentifierNames(node: ts.Node): string[] {
  const names: string[] = [];

  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child) && isDeclaredIdentifier(child)) names.push(child.text);
    ts.forEachChild(child, visit);
  };

  ts.forEachChild(node, visit);
  return [...new Set(names)];
}

function enclosingLocalNames(node: ts.Node): string[] {
  const names: string[] = [];
  let current: ts.Node | undefined = node.parent;

  while (current !== undefined) {
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      !isRenderPropertyInitializer(current)
    ) {
      for (const param of current.parameters) collectBindingNames(param.name, names);
    }

    current = current.parent;
  }

  return [...new Set(names)];
}

function isRenderPropertyInitializer(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    parent !== undefined &&
    ts.isPropertyAssignment(parent) &&
    propertyNameText(parent.name) === 'render' &&
    parent.initializer === node
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

  const returned = renderReturnExpression(expression.body);
  if (!returned) return null;

  const body = unwrapStateReturnExpression(returned);
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

function unwrapStateReturnExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  let changed = true;
  while (changed) {
    changed = false;
    while (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      changed = true;
    }
    if (
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current)
    ) {
      current = current.expression;
      changed = true;
    }
  }
  return current;
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

  if (ts.isArrayLiteralExpression(unwrapped)) {
    const values: StaticLiteralValue[] = [];
    for (const element of unwrapped.elements) {
      if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) return undefined;
      const value = staticLiteralValue(element);
      if (value === undefined) return undefined;
      values.push(value);
    }
    return values;
  }

  return ts.isObjectLiteralExpression(unwrapped) ? staticObjectLiteralValue(unwrapped) : undefined;
}
