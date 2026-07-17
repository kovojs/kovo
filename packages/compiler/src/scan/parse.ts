import * as ts from 'typescript';

import {
  canonicalFrameworkExportForExpression,
  expressionResolvesToFrameworkExport,
  frameworkExport,
  frameworkExportEquals,
  registerFrameworkIdentityProject,
  type FrameworkExportIdentity,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';
import type { SessionAuthorityFact } from '@kovojs/core/internal/graph';

import { isReviewedComponentEventBoundary } from '../component-event-boundary-registry.js';
import { offsetToPosition, type CompilerDiagnostic } from '../diagnostics.js';
import {
  compilerArrayAppend,
  compilerArrayJoin,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateNullRecord,
  compilerCreateSet,
  compilerDefineOwnDataProperty,
  compilerJsonStringify,
  compilerMapForEach,
  compilerMapGet,
  compilerMapSet,
  compilerNumberValue,
  compilerOwnDataValue,
  compilerRegExpExec,
  compilerRegExpReplace,
  compilerRegExpTest,
  compilerSetOwnDataProperty,
  compilerSetAdd,
  compilerSetDelete,
  compilerSetForEach,
  compilerSetHas,
  compilerSha256Hex,
  compilerSnapshotDenseArray,
  compilerStringIncludes,
  compilerStringCharCodeAt,
  compilerStringIndexOf,
  compilerStringEndsWith,
  compilerStringSlice,
  compilerStringSplit,
  compilerStringStartsWith,
  compilerStringToLowerCase,
  compilerStringToUpperCase,
  compilerStringTrim,
} from '../compiler-security-intrinsics.js';
import { deriveMutationKey } from '../mutation-names.js';
import { mutationFormProvenanceAttributeName } from '../mutation-form-provenance.js';
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
  ComponentIdentityAssignmentModel,
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
  StaticJsxWireAttributeEntry,
  StaticJsxWireAttributeValue,
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

interface ModuleScopeStaticStringBinding {
  readonly identifier: ts.Identifier;
  readonly value: string;
}

const COMPONENT_FACTORY_IDENTITY = frameworkExport('@kovojs/core', 'component');
const DOMAIN_FACTORY_IDENTITY = frameworkExport('@kovojs/server', 'domain');
const ENDPOINT_FACTORY_IDENTITY = frameworkExport('@kovojs/server', 'endpoint');
const MUTATION_FACTORY_IDENTITY = frameworkExport('@kovojs/server', 'mutation');
const TASK_FACTORY_IDENTITY = frameworkExport('@kovojs/server', 'task');
const WEBHOOK_FACTORY_IDENTITY = frameworkExport('@kovojs/server', 'webhook');
const SERVER_CALL_FACTORY_IDENTITIES: readonly FrameworkExportIdentity[] = [
  ENDPOINT_FACTORY_IDENTITY,
  MUTATION_FACTORY_IDENTITY,
  TASK_FACTORY_IDENTITY,
  WEBHOOK_FACTORY_IDENTITY,
];
const HANDLER_WRITE_SINK_OPERATIONS = compilerCreateSet<HandlerWriteSinkOperationKind>();
compilerSetAdd(HANDLER_WRITE_SINK_OPERATIONS, 'batch');
compilerSetAdd(HANDLER_WRITE_SINK_OPERATIONS, 'delete');
compilerSetAdd(HANDLER_WRITE_SINK_OPERATIONS, 'execute');
compilerSetAdd(HANDLER_WRITE_SINK_OPERATIONS, 'insert');
compilerSetAdd(HANDLER_WRITE_SINK_OPERATIONS, 'put');
compilerSetAdd(HANDLER_WRITE_SINK_OPERATIONS, 'run');
compilerSetAdd(HANDLER_WRITE_SINK_OPERATIONS, 'update');

const WEBHOOK_TRANSACTION_RAW_DRIVER_ESCAPE_PROPERTIES = compilerCreateSet<string>();
compilerSetAdd(WEBHOOK_TRANSACTION_RAW_DRIVER_ESCAPE_PROPERTIES, '$client');
compilerSetAdd(WEBHOOK_TRANSACTION_RAW_DRIVER_ESCAPE_PROPERTIES, 'client');
compilerSetAdd(WEBHOOK_TRANSACTION_RAW_DRIVER_ESCAPE_PROPERTIES, 'pglite');
compilerSetAdd(WEBHOOK_TRANSACTION_RAW_DRIVER_ESCAPE_PROPERTIES, 'session');
compilerSetAdd(WEBHOOK_TRANSACTION_RAW_DRIVER_ESCAPE_PROPERTIES, 'sqlite');

const TASK_CONTEXT_COMPOSITION_METHODS = compilerCreateSet<string>();
compilerSetAdd(TASK_CONTEXT_COMPOSITION_METHODS, 'runMutation');
compilerSetAdd(TASK_CONTEXT_COMPOSITION_METHODS, 'runQuery');
compilerSetAdd(TASK_CONTEXT_COMPOSITION_METHODS, 'schedule');

function appendDenseValues<Value>(target: Value[], values: readonly Value[], label: string): void {
  const length = compilerArrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    const value = compilerOwnDataValue(values, index, label) as Value | undefined;
    if (value === undefined) throw new TypeError(`${label}[${index}] must be own data.`);
    compilerArrayAppend(target, value, label);
  }
}

function ownOptionalString(
  values: readonly (string | undefined)[],
  index: number,
  label: string,
): string | undefined {
  const value = compilerOwnDataValue(values, index, label);
  if (value !== undefined && typeof value !== 'string') {
    throw new TypeError(`${label}[${index}] must be an own string or undefined.`);
  }
  return value;
}

function denseStringArrayIncludes(
  values: readonly string[],
  search: string,
  label: string,
): boolean {
  const length = compilerArrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    const value = compilerOwnDataValue(values, index, label);
    if (typeof value !== 'string') throw new TypeError(`${label}[${index}] must be an own string.`);
    if (value === search) return true;
  }
  return false;
}

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

  const result: CompilerDiagnostic[] = [];
  const diagnosticLength = compilerArrayLength(parseDiagnostics, 'Parse diagnostics');
  for (let index = 0; index < diagnosticLength; index += 1) {
    const diagnostic = compilerOwnDataValue(parseDiagnostics, index, 'Parse diagnostics') as
      | ts.Diagnostic
      | undefined;
    if (!diagnostic) throw new TypeError(`Parse diagnostics[${index}] must be own data.`);
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    const start = diagnostic.start ?? 0;
    const remainingLength = source.length - start;
    const length = diagnostic.length ?? (remainingLength > 1 ? remainingLength : 1);
    compilerArrayAppend(
      result,
      {
        code: 'KV245',
        fileName: sourceFile.fileName,
        help: compilerArrayJoin(
          [
            'Would lower to: typed JSX facts before generated server, client, CSS, and registry artifacts.',
            'Blocked reason: TypeScript could not parse the authored TSX, so later compiler phases would operate on a recovery tree.',
            'Fixes: correct the TSX syntax at this location and re-run the compiler.',
            'SPEC §5.2 requires app source to be TSX and generated artifacts to come only from parsed compiler facts.',
          ],
          '\n',
        ),
        length,
        message: `TypeScript/TSX parse failed. ${message}`,
        severity: 'error',
        start: offsetToPosition(source, start),
      },
      'Parse diagnostic facts',
    );
  }
  return result;
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
    const identityFiles: ts.SourceFile[] = [];
    const identityFileLength = compilerArrayLength(
      options.frameworkIdentityFiles,
      'Framework identity files',
    );
    for (let index = 0; index < identityFileLength; index += 1) {
      const file = compilerOwnDataValue(
        options.frameworkIdentityFiles,
        index,
        'Framework identity files',
      ) as { fileName: string; source: string } | undefined;
      if (!file) throw new TypeError(`Framework identity files[${index}] must be own data.`);
      compilerArrayAppend(
        identityFiles,
        parseSourceFile(file.fileName, file.source),
        'Framework identity source files',
      );
    }
    registerFrameworkIdentityProject(sourceFile, identityFiles);
  }
  const componentFactories = componentFactoryBindings(sourceFile);
  const calls: CallExpressionModel[] = [];
  const componentIdentityAssignments: ComponentIdentityAssignmentModel[] = [];
  const components: ComponentModel[] = [];
  const endpointHandlers: MutationHandlerModel[] = [];
  const jsxComments: JsxCommentModel[] = [];
  const jsxExpressions: JsxExpressionModel[] = [];
  const jsxElements: JsxElementModel[] = [];
  const moduleScopeBindings: ModuleScopeBindingModel[] = [];
  const moduleSpecifiers: ModuleSpecifierModel[] = [];
  const mutationHandlers: MutationHandlerModel[] = [];
  const namedImports: NamedImportModel[] = [];
  const statementLength = compilerArrayLength(sourceFile.statements, 'Source file statements');
  for (let index = 0; index < statementLength; index += 1) {
    const statement = compilerOwnDataValue(
      sourceFile.statements,
      index,
      'Source file statements',
    ) as ts.Statement | undefined;
    if (!statement) throw new TypeError(`Source file statements[${index}] must be own data.`);
    appendDenseValues(namedImports, namedImportModels(statement), 'Named import models');
  }
  const renderSourceReturns: StringRenderModel[] = [];
  const taskRunHandlers: TaskRunHandlerModel[] = [];
  const webhookHandlers: WebhookHandlerModel[] = [];
  const moduleScopeObjectEntries = moduleScopeObjectEntryModels(sourceFile, source);
  const moduleScopeMutationFormControlNames = moduleScopeMutationFormControlNameModels(sourceFile);
  const moduleScopeStaticStringBindings = moduleScopeConstStaticStringBindings(sourceFile);
  const domainBindings = domainBindingKeys(sourceFile);

  const visit = (node: ts.Node): void => {
    const identityAssignment = componentIdentityAssignmentModel(sourceFile, node);
    if (identityAssignment !== null) {
      compilerArrayAppend(
        componentIdentityAssignments,
        identityAssignment,
        'Component identity assignment models',
      );
    }
    const specifier = moduleSpecifierModel(node);
    if (specifier) {
      compilerArrayAppend(moduleSpecifiers, specifier, 'Module specifier models');
    }
    appendDenseValues(
      moduleScopeBindings,
      moduleScopeBindingModels(sourceFile, source, node),
      'Module-scope binding models',
    );

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
      if (model) compilerArrayAppend(components, model, 'Component models');
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      compilerArrayAppend(
        jsxElements,
        jsxElementModel(
          sourceFile,
          source,
          node,
          moduleScopeObjectEntries,
          moduleScopeMutationFormControlNames,
          moduleScopeStaticStringBindings,
          namedImports,
        ),
        'JSX element models',
      );
    }
    if (ts.isJsxExpression(node)) {
      const comment = jsxCommentModel(sourceFile, source, node);
      if (comment) compilerArrayAppend(jsxComments, comment, 'JSX comment models');
      if (node.expression) {
        compilerArrayAppend(
          jsxExpressions,
          jsxExpressionModel(sourceFile, source, node),
          'JSX expression models',
        );
      }
    }
    if (
      ts.isCallExpression(node) &&
      (ts.isIdentifier(node.expression) || ts.isPropertyAccessExpression(node.expression))
    ) {
      const factoryIdentity = canonicalFrameworkExportForExpression(
        ts as FrameworkIdentityTypeScript,
        sourceFile,
        node.expression,
        { legacyGlobals: SERVER_CALL_FACTORY_IDENTITIES },
      );
      const frameworkFactory = frameworkExportEquals(factoryIdentity, ENDPOINT_FACTORY_IDENTITY)
        ? 'endpoint'
        : frameworkExportEquals(factoryIdentity, MUTATION_FACTORY_IDENTITY)
          ? 'mutation'
          : frameworkExportEquals(factoryIdentity, TASK_FACTORY_IDENTITY)
            ? 'task'
            : frameworkExportEquals(factoryIdentity, WEBHOOK_FACTORY_IDENTITY)
              ? 'webhook'
              : undefined;
      compilerArrayAppend(
        calls,
        callExpressionModel(sourceFile, source, node, frameworkFactory),
        'Call models',
      );
      if (frameworkExportEquals(factoryIdentity, ENDPOINT_FACTORY_IDENTITY)) {
        appendDenseValues(
          endpointHandlers,
          endpointHandlerModels(sourceFile, source, node),
          'Endpoint handler models',
        );
      }
      if (frameworkExportEquals(factoryIdentity, MUTATION_FACTORY_IDENTITY)) {
        appendDenseValues(
          mutationHandlers,
          mutationHandlerModels(sourceFile, source, node),
          'Mutation handler models',
        );
      }
      if (frameworkExportEquals(factoryIdentity, TASK_FACTORY_IDENTITY)) {
        appendDenseValues(
          taskRunHandlers,
          taskRunHandlerModels(sourceFile, source, node),
          'Task run handler models',
        );
      }
      if (frameworkExportEquals(factoryIdentity, WEBHOOK_FACTORY_IDENTITY)) {
        appendDenseValues(
          webhookHandlers,
          webhookHandlerModels(sourceFile, source, node, domainBindings),
          'Webhook handler models',
        );
      }
    }
    if (isExportedRenderSourceFunction(node)) {
      appendDenseValues(
        renderSourceReturns,
        stringRenderReturnsFromFunctionBody(sourceFile, source, node.body),
        'String render models',
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  const model: ComponentModuleModel = {
    calls,
    componentIdentityAssignments,
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
  compilerDefineOwnDataProperty(model, 'sourceFile', sourceFile, false);
  return model;
}

function componentIdentityAssignmentModel(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): ComponentIdentityAssignmentModel | null {
  if (!ts.isExpressionStatement(node) || !ts.isBinaryExpression(node.expression)) return null;
  const assignment = node.expression;
  if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return null;
  if (
    !ts.isPropertyAccessExpression(assignment.left) ||
    !ts.isIdentifier(assignment.left.expression) ||
    assignment.left.name.text !== 'name' ||
    !ts.isStringLiteralLike(assignment.right)
  ) {
    return null;
  }
  return {
    end: node.getEnd(),
    start: node.getStart(sourceFile),
    target: assignment.left.expression.text,
    value: assignment.right.text,
  };
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
    const argument = callArgument(node, 0);
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

  const importClause = node.importClause;
  if (!importClause || importClause.isTypeOnly) return [];
  const bindings = importClause.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return [];
  const moduleSpecifier = node.moduleSpecifier.text;
  const result: NamedImportModel[] = [];
  const elementLength = compilerArrayLength(bindings.elements, 'Named import elements');
  for (let index = 0; index < elementLength; index += 1) {
    const element = compilerOwnDataValue(bindings.elements, index, 'Named import elements') as
      | ts.ImportSpecifier
      | undefined;
    if (!element) throw new TypeError(`Named import elements[${index}] must be own data.`);
    if (element.isTypeOnly) continue;
    compilerArrayAppend(
      result,
      {
        importedName: element.propertyName?.text ?? element.name.text,
        localName: element.name.text,
        moduleSpecifier,
      },
      'Named import models',
    );
  }
  return result;
}

function moduleScopeBindingModels(
  sourceFile: ts.SourceFile,
  source: string,
  node: ts.Node,
): ModuleScopeBindingModel[] {
  if (!ts.isVariableStatement(node) || node.parent !== sourceFile) return [];
  const result: ModuleScopeBindingModel[] = [];
  const declarationLength = compilerArrayLength(
    node.declarationList.declarations,
    'Module-scope declarations',
  );
  for (let index = 0; index < declarationLength; index += 1) {
    const declaration = compilerOwnDataValue(
      node.declarationList.declarations,
      index,
      'Module-scope declarations',
    ) as ts.VariableDeclaration | undefined;
    if (!declaration) throw new TypeError(`Module-scope declarations[${index}] must be own data.`);
    if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
    const value = staticLiteralValue(declaration.initializer);
    if (value === undefined) continue;
    compilerArrayAppend(
      result,
      {
        name: declaration.name.text,
        source: compilerStringSlice(
          source,
          declaration.initializer.getStart(sourceFile),
          declaration.initializer.getEnd(),
        ),
        staticValue: value,
      },
      'Module-scope binding models',
    );
  }
  return result;
}

function moduleScopeObjectEntryModels(
  sourceFile: ts.SourceFile,
  source: string,
): ReadonlyMap<string, readonly ObjectLiteralEntry[]> {
  const stringBindings = moduleScopeStaticStringValues(sourceFile);
  const objectEntries = compilerCreateMap<string, readonly ObjectLiteralEntry[]>();
  const statementLength = compilerArrayLength(sourceFile.statements, 'Source file statements');
  for (let statementIndex = 0; statementIndex < statementLength; statementIndex += 1) {
    const statement = compilerOwnDataValue(
      sourceFile.statements,
      statementIndex,
      'Source file statements',
    ) as ts.Statement | undefined;
    if (!statement)
      throw new TypeError(`Source file statements[${statementIndex}] must be own data.`);
    if (!ts.isVariableStatement(statement)) continue;
    const declarationLength = compilerArrayLength(
      statement.declarationList.declarations,
      'Module-scope object declarations',
    );
    for (let declarationIndex = 0; declarationIndex < declarationLength; declarationIndex += 1) {
      const declaration = compilerOwnDataValue(
        statement.declarationList.declarations,
        declarationIndex,
        'Module-scope object declarations',
      ) as ts.VariableDeclaration | undefined;
      if (!declaration) {
        throw new TypeError(
          `Module-scope object declarations[${declarationIndex}] must be own data.`,
        );
      }
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const initializer = unwrapExpression(declaration.initializer);
      if (!ts.isObjectLiteralExpression(initializer)) continue;

      const entries = completeJsxSpreadObjectLiteralEntries(
        sourceFile,
        source,
        initializer,
        stringBindings,
      );
      if (entries !== undefined) compilerMapSet(objectEntries, declaration.name.text, entries);
    }
  }

  return objectEntries;
}

function moduleScopeMutationFormControlNameModels(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, readonly string[]> {
  const staticStringValues = moduleScopeStaticStringValues(sourceFile);
  const controlsByBinding = compilerCreateMap<string, readonly string[]>();
  const statementLength = compilerArrayLength(
    sourceFile.statements,
    'Module-scope mutation form control declarations',
  );
  for (let statementIndex = 0; statementIndex < statementLength; statementIndex += 1) {
    const statement = compilerOwnDataValue(
      sourceFile.statements,
      statementIndex,
      'Module-scope mutation form control declarations',
    ) as ts.Statement | undefined;
    if (!statement) {
      throw new TypeError(
        `Module-scope mutation form control declarations[${statementIndex}] must be own data.`,
      );
    }
    if (!ts.isVariableStatement(statement)) continue;
    const declarationLength = compilerArrayLength(
      statement.declarationList.declarations,
      'Module-scope mutation form control bindings',
    );
    for (let declarationIndex = 0; declarationIndex < declarationLength; declarationIndex += 1) {
      const declaration = compilerOwnDataValue(
        statement.declarationList.declarations,
        declarationIndex,
        'Module-scope mutation form control bindings',
      ) as ts.VariableDeclaration | undefined;
      if (!declaration) {
        throw new TypeError(
          `Module-scope mutation form control bindings[${declarationIndex}] must be own data.`,
        );
      }
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const names = mutationFormControlNamesFromExpression(
        declaration.initializer,
        staticStringValues,
        controlsByBinding,
      );
      if (names.length > 0) compilerMapSet(controlsByBinding, declaration.name.text, names);
    }
  }
  return controlsByBinding;
}

function mutationFormControlNamesFromExpression(
  expression: ts.Expression,
  staticStringValues: ReadonlyMap<string, string>,
  controlsByBinding: ReadonlyMap<string, readonly string[]>,
): string[] {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    return snapshotCompilerModelArray(
      compilerMapGet(controlsByBinding, unwrapped.text) ?? [],
      'Aliased mutation form control names',
    );
  }
  if (!ts.isObjectLiteralExpression(unwrapped)) return [];

  const names: string[] = [];
  const seen = compilerCreateSet<string>();
  const propertyLength = compilerArrayLength(
    unwrapped.properties,
    'Mutation form control object properties',
  );
  for (let propertyIndex = 0; propertyIndex < propertyLength; propertyIndex += 1) {
    const property = compilerOwnDataValue(
      unwrapped.properties,
      propertyIndex,
      'Mutation form control object properties',
    ) as ts.ObjectLiteralElementLike | undefined;
    if (!property) {
      throw new TypeError(
        `Mutation form control object properties[${propertyIndex}] must be own data.`,
      );
    }
    if (ts.isSpreadAssignment(property)) {
      appendUniqueMutationFormControlNames(
        names,
        seen,
        mutationFormControlNamesFromExpression(
          property.expression,
          staticStringValues,
          controlsByBinding,
        ),
      );
      continue;
    }
    const name = mutationFormProvenanceAttributeName(
      propertyNameText(property.name, { staticStringValues }) ?? '',
    );
    if (name !== null && !compilerSetHas(seen, name)) {
      compilerSetAdd(seen, name);
      compilerArrayAppend(names, name, 'Mutation form control names');
    }
  }
  return names;
}

function appendUniqueMutationFormControlNames(
  target: string[],
  seen: Set<string>,
  values: readonly string[],
): void {
  const snapshot = compilerSnapshotDenseArray(values, 'Nested mutation form control names');
  for (let index = 0; index < snapshot.length; index += 1) {
    const value = snapshot[index]!;
    if (compilerSetHas(seen, value)) continue;
    compilerSetAdd(seen, value);
    compilerArrayAppend(target, value, 'Mutation form control names');
  }
}

function moduleScopeStaticStringValues(sourceFile: ts.SourceFile): ReadonlyMap<string, string> {
  const strings = compilerCreateMap<string, string>();
  const statementLength = compilerArrayLength(sourceFile.statements, 'Source file statements');
  for (let statementIndex = 0; statementIndex < statementLength; statementIndex += 1) {
    const statement = compilerOwnDataValue(
      sourceFile.statements,
      statementIndex,
      'Source file statements',
    ) as ts.Statement | undefined;
    if (!statement)
      throw new TypeError(`Source file statements[${statementIndex}] must be own data.`);
    if (!ts.isVariableStatement(statement)) continue;
    const declarationLength = compilerArrayLength(
      statement.declarationList.declarations,
      'Module-scope string declarations',
    );
    for (let declarationIndex = 0; declarationIndex < declarationLength; declarationIndex += 1) {
      const declaration = compilerOwnDataValue(
        statement.declarationList.declarations,
        declarationIndex,
        'Module-scope string declarations',
      ) as ts.VariableDeclaration | undefined;
      if (!declaration) {
        throw new TypeError(
          `Module-scope string declarations[${declarationIndex}] must be own data.`,
        );
      }
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const value = staticLiteralValue(declaration.initializer);
      if (typeof value === 'string') compilerMapSet(strings, declaration.name.text, value);
    }
  }

  return strings;
}

/**
 * Module constants that may name a computed object property without runtime ambiguity.
 * Unlike the older broad string-value inventory, this keeps the declaration identity so a local
 * shadow or duplicate module binding makes the security fact unknown rather than manufacturing a
 * static key (SPEC §5.2 rule 10).
 */
function moduleScopeConstStaticStringBindings(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, ModuleScopeStaticStringBinding> {
  const strings = compilerCreateMap<string, ModuleScopeStaticStringBinding>();
  const statementLength = compilerArrayLength(
    sourceFile.statements,
    'Module-scope const string statements',
  );
  for (let statementIndex = 0; statementIndex < statementLength; statementIndex += 1) {
    const statement = compilerOwnDataValue(
      sourceFile.statements,
      statementIndex,
      'Module-scope const string statements',
    ) as ts.Statement | undefined;
    if (!statement) {
      throw new TypeError(
        `Module-scope const string statements[${statementIndex}] must be own data.`,
      );
    }
    if (!ts.isVariableStatement(statement)) continue;
    const declarations = statement.declarationList.declarations;
    const declarationLength = compilerArrayLength(
      declarations,
      'Module-scope const string declarations',
    );
    for (let declarationIndex = 0; declarationIndex < declarationLength; declarationIndex += 1) {
      const declaration = compilerOwnDataValue(
        declarations,
        declarationIndex,
        'Module-scope const string declarations',
      ) as ts.VariableDeclaration | undefined;
      if (!declaration) {
        throw new TypeError(
          `Module-scope const string declarations[${declarationIndex}] must be own data.`,
        );
      }
      if (
        !isConstVariableDeclaration(declaration) ||
        !ts.isIdentifier(declaration.name) ||
        declaration.initializer === undefined
      ) {
        continue;
      }
      const value = staticLiteralValue(declaration.initializer);
      if (typeof value !== 'string') continue;
      compilerMapSet(strings, declaration.name.text, {
        identifier: declaration.name,
        value,
      });
    }
  }
  return strings;
}

function domainBindingKeys(sourceFile: ts.SourceFile): ReadonlyMap<string, string> {
  const domains = compilerCreateMap<string, string>();
  const statementLength = compilerArrayLength(sourceFile.statements, 'Source file statements');
  for (let statementIndex = 0; statementIndex < statementLength; statementIndex += 1) {
    const statement = compilerOwnDataValue(
      sourceFile.statements,
      statementIndex,
      'Source file statements',
    ) as ts.Statement | undefined;
    if (!statement)
      throw new TypeError(`Source file statements[${statementIndex}] must be own data.`);
    if (!ts.isVariableStatement(statement)) continue;
    const declarationLength = compilerArrayLength(
      statement.declarationList.declarations,
      'Domain binding declarations',
    );
    for (let declarationIndex = 0; declarationIndex < declarationLength; declarationIndex += 1) {
      const declaration = compilerOwnDataValue(
        statement.declarationList.declarations,
        declarationIndex,
        'Domain binding declarations',
      ) as ts.VariableDeclaration | undefined;
      if (!declaration) {
        throw new TypeError(`Domain binding declarations[${declarationIndex}] must be own data.`);
      }
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const domainKey = domainKeyFromExpression(sourceFile, declaration.initializer, domains);
      if (domainKey !== undefined && domainKey !== 'UNRESOLVED') {
        compilerMapSet(domains, declaration.name.text, domainKey);
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
  return (
    (compilerOwnDataValue(model.components, 0, 'Component models') as ComponentModel | undefined) ??
    null
  );
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

  let basenameStart = 0;
  let extensionStart = fileName.length;
  for (let index = 0; index < fileName.length; index += 1) {
    const char = fileName[index];
    if (char === '/') {
      basenameStart = index + 1;
      extensionStart = fileName.length;
    } else if (char === '.') {
      extensionStart = index;
    }
  }
  const baseName = compilerStringSlice(fileName, basenameStart, extensionStart) || 'Component';
  let result = '';
  let partStart = 0;
  for (let index = 0; index <= baseName.length; index += 1) {
    const char = baseName[index];
    if (index !== baseName.length && char !== '-' && char !== '_') continue;
    if (index > partStart) {
      result += compilerStringToUpperCase(baseName[partStart] ?? '');
      result += compilerStringSlice(baseName, partStart + 1, index);
    }
    partStart = index + 1;
  }
  return result;
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
      compilerArrayAppend(
        result,
        entries[entryIndex]!,
        'Compiler packages/compiler/src/scan/parse.ts collection',
      );
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
  for (let index = 0; index < source.length; index += 1) {
    compilerArrayAppend(keys, source[index]!.key, 'Component option object keys');
  }
  return keys;
}

export function componentRenderInputs(model: ComponentModuleModel): string[] {
  const inputs = componentRenderInputModels(model);
  const names: string[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    compilerArrayAppend(names, inputs[index]!.name, 'Component render input names');
  }
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

  const elements = snapshotCompilerModelArray(model.jsxElements, 'JSX elements');
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (element.start === host.start && element.openingEnd === host.end) return element;
  }
  return null;
}

export function componentStateReturnObjectModel(
  model: ComponentModuleModel,
): StateReturnObjectModel | null {
  return firstComponentModel(model)?.stateReturnObject ?? null;
}

export function componentStateReturnObjectKeys(model: ComponentModuleModel): string[] {
  const entries = componentStateReturnObjectModel(model)?.entries ?? [];
  const result: string[] = [];
  const length = compilerArrayLength(entries, 'Component state return entries');
  for (let index = 0; index < length; index += 1) {
    const entry = compilerOwnDataValue(entries, index, 'Component state return entries') as
      | ObjectLiteralEntry
      | undefined;
    if (!entry) throw new TypeError(`Component state return entries[${index}] must be own data.`);
    compilerArrayAppend(result, entry.key, 'Component state return keys');
  }
  return result;
}

export function componentModelForSourceSpan(
  model: ComponentModuleModel,
  span: SourceSpan,
): ComponentModel | null {
  const components = snapshotCompilerModelArray(model.components, 'Components');
  let containing: ComponentModel | null = null;
  let containingWidth: number | undefined;
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index]!;
    const start = component.localNameSpan?.start ?? 0;
    if (span.start < start || span.end > component.declarationEnd) continue;
    const width = component.declarationEnd - start;
    if (containingWidth === undefined || width < containingWidth) {
      containing = component;
      containingWidth = width;
    }
  }
  return containing;
}

export function componentFragmentTargetNames(model: ComponentModuleModel): string[] {
  const result: string[] = [];
  const components = snapshotCompilerModelArray(model.components, 'Components');
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index]!;
    if (!componentHasInferredFragmentTarget(component) || component.localName === undefined) {
      continue;
    }
    compilerArrayAppend(result, component.localName, 'Component fragment target names');
  }
  return result;
}

export function componentHasInferredServerRefreshTarget(model: ComponentModuleModel): boolean {
  const components = snapshotCompilerModelArray(model.components, 'Components');
  for (let index = 0; index < components.length; index += 1) {
    if (componentHasInferredFragmentTarget(components[index]!)) return true;
  }
  return false;
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

  const container = compilerOwnDataValue(
    element.childExpressionContainers,
    0,
    'JSX child expression containers',
  ) as SourceSpan | undefined;
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
  return compilerSnapshotDenseArray(values, label);
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
        compilerArrayAppend(
          handlerFingerprints,
          value,
          'Compiler packages/compiler/src/scan/parse.ts collection',
        );
      }
      if (handlerFingerprint !== undefined) {
        let duplicate = false;
        for (let index = 0; index < handlerFingerprints.length; index += 1) {
          if (handlerFingerprints[index] === handlerFingerprint) {
            duplicate = true;
            break;
          }
        }
        if (!duplicate)
          compilerArrayAppend(
            handlerFingerprints,
            handlerFingerprint,
            'Compiler packages/compiler/src/scan/parse.ts collection',
          );
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
    if (previousIndex < 0)
      compilerArrayAppend(facts, fact, 'Compiler packages/compiler/src/scan/parse.ts collection');
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
  const declaration = statement
    ? (compilerOwnDataValue(
        statement.declarationList.declarations,
        0,
        'Canonical handler declarations',
      ) as ts.VariableDeclaration | undefined)
    : undefined;
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
  let options: ts.ObjectLiteralExpression | undefined;
  const argumentLength = compilerArrayLength(call.arguments, 'Mutation arguments');
  for (let index = 0; index < argumentLength; index += 1) {
    const argument = compilerOwnDataValue(call.arguments, index, 'Mutation arguments') as
      | ts.Expression
      | undefined;
    if (!argument) throw new TypeError(`Mutation arguments[${index}] must be own data.`);
    if (ts.isObjectLiteralExpression(argument)) {
      options = argument;
      break;
    }
  }
  if (!options) return false;

  let handlerCount = 0;
  const propertyLength = compilerArrayLength(options.properties, 'Mutation option properties');
  for (let index = 0; index < propertyLength; index += 1) {
    const property = compilerOwnDataValue(
      options.properties,
      index,
      'Mutation option properties',
    ) as ts.ObjectLiteralElementLike | undefined;
    if (!property) throw new TypeError(`Mutation option properties[${index}] must be own data.`);
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
  return compilerSnapshotDenseArray(model.taskRunHandlers, 'Task run handlers');
}

export function endpointHandlers(model: ComponentModuleModel): MutationHandlerModel[] {
  return compilerSnapshotDenseArray(model.endpointHandlers, 'Endpoint handlers');
}

export function webhookHandlers(model: ComponentModuleModel): WebhookHandlerModel[] {
  return compilerSnapshotDenseArray(model.webhookHandlers, 'Webhook handlers');
}

export function handlerWriteSinks(model: ComponentModuleModel): HandlerWriteSinkFact[] {
  const result: HandlerWriteSinkFact[] = [];
  appendHandlerWriteSinks(result, model.endpointHandlers, 'Endpoint handler write sinks');
  appendHandlerWriteSinks(result, model.mutationHandlers, 'Mutation handler write sinks');
  appendHandlerWriteSinks(result, model.taskRunHandlers, 'Task handler write sinks');
  appendHandlerWriteSinks(result, model.webhookHandlers, 'Webhook handler write sinks');
  return result;
}

export function webhookRecordChanges(model: ComponentModuleModel): WebhookRecordChangeFact[] {
  const result: WebhookRecordChangeFact[] = [];
  const handlerLength = compilerArrayLength(model.webhookHandlers, 'Webhook handlers');
  for (let index = 0; index < handlerLength; index += 1) {
    const handler = compilerOwnDataValue(model.webhookHandlers, index, 'Webhook handlers') as
      | WebhookHandlerModel
      | undefined;
    if (!handler) throw new TypeError(`Webhook handlers[${index}] must be own data.`);
    appendDenseValues(
      result,
      handler.webhookRecordChanges ?? [],
      `Webhook handler ${index} record changes`,
    );
  }
  return result;
}

function appendHandlerWriteSinks<Handler extends MutationHandlerModel>(
  target: HandlerWriteSinkFact[],
  handlers: readonly Handler[],
  label: string,
): void {
  const handlerLength = compilerArrayLength(handlers, label);
  for (let index = 0; index < handlerLength; index += 1) {
    const handler = compilerOwnDataValue(handlers, index, label) as Handler | undefined;
    if (!handler) throw new TypeError(`${label}[${index}] must be own data.`);
    appendDenseValues(target, handler.handlerWriteSinks ?? [], `${label}[${index}]`);
  }
}

function stringLiteralArrayValuesFromExpression(expression: ts.Expression): string[] | null {
  if (!ts.isArrayLiteralExpression(expression)) return null;

  const values: string[] = [];
  const elementLength = compilerArrayLength(expression.elements, 'String literal array elements');
  for (let index = 0; index < elementLength; index += 1) {
    const element = compilerOwnDataValue(
      expression.elements,
      index,
      'String literal array elements',
    ) as ts.Expression | ts.SpreadElement | undefined;
    if (!element) throw new TypeError(`String literal array elements[${index}] must be own data.`);
    if (!ts.isStringLiteralLike(element)) return null;
    compilerArrayAppend(values, element.text, 'String literal array values');
  }

  return values;
}

function arrowFunctionPartsFromExpression(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): ArrowFunctionPartsModel | null {
  if (!ts.isArrowFunction(expression)) return null;

  const paramNames: string[] = [];
  const parameterLength = compilerArrayLength(expression.parameters, 'Arrow parameters');
  if (parameterLength === 0) return null;
  for (let index = 0; index < parameterLength; index += 1) {
    const parameter = compilerOwnDataValue(expression.parameters, index, 'Arrow parameters') as
      | ts.ParameterDeclaration
      | undefined;
    if (!parameter) throw new TypeError(`Arrow parameters[${index}] must be own data.`);
    if (!ts.isIdentifier(parameter.name)) return null;
    compilerArrayAppend(paramNames, parameter.name.text, 'Arrow parameter names');
  }
  if (ts.isBlock(expression.body)) return null;

  return {
    expression: compilerStringTrim(
      compilerStringSlice(
        sourceFile.text,
        expression.body.getStart(sourceFile),
        expression.body.getEnd(),
      ),
    ),
    param: paramNames[0] ?? '',
    params: paramNames,
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
  const result: string[] = [];
  const propertyLength = compilerArrayLength(
    expression.properties,
    'Object-literal path properties',
  );
  for (let index = 0; index < propertyLength; index += 1) {
    const property = compilerOwnDataValue(
      expression.properties,
      index,
      'Object-literal path properties',
    ) as ts.ObjectLiteralElementLike | undefined;
    if (!property)
      throw new TypeError(`Object-literal path properties[${index}] must be own data.`);
    if (ts.isShorthandPropertyAssignment(property)) {
      compilerArrayAppend(
        result,
        pathWithPrefix(prefix, property.name.text),
        'Object-literal paths',
      );
      continue;
    }

    if (!ts.isPropertyAssignment(property)) continue;

    const key = propertyNameText(property.name);
    if (!key) continue;

    const path = pathWithPrefix(prefix, key);
    if (ts.isObjectLiteralExpression(property.initializer)) {
      appendDenseValues(
        result,
        objectLiteralPaths(property.initializer, path),
        'Nested object-literal paths',
      );
    } else {
      compilerArrayAppend(result, path, 'Object-literal paths');
    }
  }
  return result;
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

  const target = callArgument(call, 0);
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

export function identifierIsShadowedBeforeScope(
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
    const elementLength = compilerArrayLength(bindingName.elements, 'Scope binding elements');
    for (let index = 0; index < elementLength; index += 1) {
      const element = compilerOwnDataValue(
        bindingName.elements,
        index,
        'Scope binding elements',
      ) as ts.ArrayBindingElement | undefined;
      if (element && ts.isBindingElement(element)) visitBindingName(element.name);
    }
  };

  const visit = (node: ts.Node, insideNestedLexicalBlock: boolean): void => {
    if (found) return;
    if (node !== scope && isFunctionScopeNode(node)) {
      if (ts.isFunctionDeclaration(node) && node.name && !insideNestedLexicalBlock) {
        visitBindingName(node.name);
      }
      return;
    }
    if (node !== scope && ts.isClassDeclaration(node)) {
      if (node.name && !insideNestedLexicalBlock) visitBindingName(node.name);
      return;
    }
    if (ts.isImportClause(node) && node.name) visitBindingName(node.name);
    if (ts.isNamespaceImport(node)) visitBindingName(node.name);
    if (ts.isImportSpecifier(node)) visitBindingName(node.name);
    if (ts.isParameter(node)) visitBindingName(node.name);
    if (ts.isVariableDeclaration(node)) {
      const declarationList = ts.isVariableDeclarationList(node.parent) ? node.parent : undefined;
      const blockScoped =
        declarationList !== undefined && (declarationList.flags & ts.NodeFlags.BlockScoped) !== 0;
      if (!insideNestedLexicalBlock || !blockScoped) visitBindingName(node.name);
    }
    if (ts.isFunctionDeclaration(node) && node.name && !insideNestedLexicalBlock) {
      visitBindingName(node.name);
    }
    if (ts.isClassDeclaration(node) && node.name && !insideNestedLexicalBlock) {
      visitBindingName(node.name);
    }
    const nestedForChildren =
      insideNestedLexicalBlock || (node !== scope && (ts.isBlock(node) || ts.isModuleBlock(node)));
    ts.forEachChild(node, (child) => visit(child, nestedForChildren));
  };

  visit(scope, false);
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

  const optionsArg = callArgument(initializer, 0);
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

  const propertyLength = compilerArrayLength(optionsObject.properties, 'Component properties');
  for (let index = 0; index < propertyLength; index += 1) {
    const property = compilerOwnDataValue(
      optionsObject.properties,
      index,
      'Component properties',
    ) as ts.ObjectLiteralElementLike | undefined;
    if (!property) throw new TypeError(`Component properties[${index}] must be own data.`);
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
  const result: ComponentOptionEntry[] = [];
  const propertyLength = compilerArrayLength(
    optionsObject.properties,
    'Component option properties',
  );
  for (let index = 0; index < propertyLength; index += 1) {
    const property = compilerOwnDataValue(
      optionsObject.properties,
      index,
      'Component option properties',
    ) as ts.ObjectLiteralElementLike | undefined;
    if (!property) throw new TypeError(`Component option properties[${index}] must be own data.`);
    if (!ts.isPropertyAssignment(property)) continue;

    const key = propertyNameText(property.name);
    if (!key) continue;

    compilerArrayAppend(
      result,
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
      'Component option facts',
    );
  }
  return result;
}

function leadingJustifiedDiagnostics(
  source: string,
  node: ts.Node,
): { justifiedDiagnostics: readonly string[] } | {} {
  const ranges = ts.getLeadingCommentRanges(source, node.getFullStart()) ?? [];
  const seen = compilerCreateSet<string>();
  const codes: string[] = [];
  const rangeLength = compilerArrayLength(ranges, 'Leading comment ranges');
  for (let rangeIndex = 0; rangeIndex < rangeLength; rangeIndex += 1) {
    const range = compilerOwnDataValue(ranges, rangeIndex, 'Leading comment ranges') as
      | ts.CommentRange
      | undefined;
    if (!range) throw new TypeError(`Leading comment ranges[${rangeIndex}] must be own data.`);
    if (range.end > node.getStart(node.getSourceFile())) continue;
    const parsed = parseJustifiedDiagnostics(compilerStringSlice(source, range.pos, range.end));
    const parsedLength = compilerArrayLength(parsed, 'Parsed justified diagnostics');
    for (let codeIndex = 0; codeIndex < parsedLength; codeIndex += 1) {
      const code = compilerOwnDataValue(parsed, codeIndex, 'Parsed justified diagnostics');
      if (typeof code !== 'string') {
        throw new TypeError(`Parsed justified diagnostics[${codeIndex}] must be an own string.`);
      }
      if (compilerSetHas(seen, code)) continue;
      compilerSetAdd(seen, code);
      compilerArrayAppend(codes, code, 'Justified diagnostic codes');
    }
  }

  return codes.length === 0 ? {} : { justifiedDiagnostics: codes };
}

// SPEC §4.9: a query-backed component without disableServerRefresh infers a server-refreshable
// fragment target. Exposed per-`ComponentModel` (not just the module's first component) so KV420 can
// classify every parent in a multi-component module, not only `firstComponentModel`.
export function componentHasInferredFragmentTarget(component: ComponentModel): boolean {
  if (componentOptionStaticValueFor(component, 'disableServerRefresh') === true) {
    return false;
  }

  const queries = componentOptionObjectEntriesFor(component, 'queries');
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
  if (componentOptionStaticValueFor(component, 'isomorphic') === true) {
    return false;
  }

  const entries = snapshotCompilerModelArray(
    component.stateReturnObject?.entries ?? [],
    'Component state return entries',
  );
  if (entries.length === 0) return false;

  const renderOnceStateKeys = renderOnceStateKeysInSpan(
    model,
    component.localNameSpan?.start ?? component.declarationEnd,
    component.declarationEnd,
  );
  for (let index = 0; index < entries.length; index += 1) {
    if (!compilerSetHas(renderOnceStateKeys, entries[index]!.key)) return true;
  }
  return false;
}

function renderOnceStateKeysInSpan(
  model: ComponentModuleModel,
  spanStart: number,
  spanEnd: number,
): Set<string> {
  const keys = compilerCreateSet<string>();
  const calls = snapshotCompilerModelArray(model.calls, 'Call expressions');
  for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
    const call = calls[callIndex]!;
    if (call.name !== 'renderOnce') continue;
    if (call.start < spanStart || call.end > spanEnd) continue;
    const argumentAccesses = snapshotCompilerModelArray(
      call.argumentPropertyAccesses,
      'Render-once argument property accesses',
    );
    for (let argumentIndex = 0; argumentIndex < argumentAccesses.length; argumentIndex += 1) {
      const accesses = snapshotCompilerModelArray(
        argumentAccesses[argumentIndex]!,
        `Render-once argument ${argumentIndex} property accesses`,
      );
      for (let accessIndex = 0; accessIndex < accesses.length; accessIndex += 1) {
        const access = accesses[accessIndex]!;
        if (!compilerStringStartsWith(access.path, 'state.')) continue;
        const remainder = compilerStringSlice(access.path, 'state.'.length);
        const separatorIndex = compilerStringIndexOf(remainder, '.');
        const key =
          separatorIndex < 0 ? remainder : compilerStringSlice(remainder, 0, separatorIndex);
        if (key) compilerSetAdd(keys, key);
      }
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
    staticTemplateValue: compilerStringSlice(
      source,
      unwrapped.getStart(sourceFile) + 1,
      unwrapped.getEnd() - 1,
    ),
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
  const result: StringRenderModel[] = [];
  const statementLength = compilerArrayLength(body.statements, 'String-render statements');
  for (let index = 0; index < statementLength; index += 1) {
    const statement = compilerOwnDataValue(body.statements, index, 'String-render statements') as
      | ts.Statement
      | undefined;
    if (!statement) throw new TypeError(`String-render statements[${index}] must be own data.`);
    if (!ts.isReturnStatement(statement) || !statement.expression) continue;
    appendDenseValues(
      result,
      stringRenderModel(sourceFile, source, statement.expression),
      'String-render models',
    );
  }
  return result;
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
      source: compilerStringSlice(source, unwrapped.getStart(sourceFile), unwrapped.getEnd()),
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
    let result = expression.head.text;
    const spanLength = compilerArrayLength(expression.templateSpans, 'Template spans');
    for (let index = 0; index < spanLength; index += 1) {
      const span = compilerOwnDataValue(expression.templateSpans, index, 'Template spans') as
        | ts.TemplateSpan
        | undefined;
      if (!span) throw new TypeError(`Template spans[${index}] must be own data.`);
      result += `{}` + span.literal.text;
    }
    return result;
  }

  return expression.text;
}

function firstHtmlTagNameFromLiteralText(source: string): string | null {
  const match = compilerRegExpExec(/<\s*([A-Za-z][\w:-]*)(?:\s|>|\/)/, source);
  const tagName = match ? compilerOwnDataValue(match, 1, 'First HTML tag-name match') : undefined;
  return typeof tagName === 'string' ? tagName : null;
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
    compilerArrayAppend(
      result,
      {
        ...model,
        ...(authorityFingerprint === undefined ? {} : { authorityFingerprint }),
        handlerWriteSinks: handlerWriteSinkFacts(sourceFile, source, body, {
          owner,
          resolvedTargetFilter: (identity) =>
            compilerSetHas(directDbTargets, identity) || looksLikeDbTargetIdentity(identity),
          surface: 'mutation',
        }),
        mutationOwner: owner,
        ...(handlerReadsAmbientCookie(body, parameters)
          ? { readsAmbientCookie: true as const }
          : {}),
      },
      'Compiler packages/compiler/src/scan/parse.ts collection',
    );
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
    compilerArrayAppend(
      runtimeParameters,
      parameterSnapshot[index]!,
      'Compiler packages/compiler/src/scan/parse.ts collection',
    );
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
        const header = staticHeaderName(callArgument(node, 0), staticStrings);
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
    compilerArrayAppend(
      bindings,
      { name: root.name.text, scope: root },
      'Compiler packages/compiler/src/scan/parse.ts collection',
    );
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
      compilerArrayAppend(
        bindings,
        {
          name: node.name.text,
          scope: handlerLexicalBindingScope(node, root),
        },
        'Compiler packages/compiler/src/scan/parse.ts collection',
      );
    } else if (
      (ts.isFunctionExpression(node) || ts.isClassExpression(node)) &&
      node.name !== undefined
    ) {
      compilerArrayAppend(
        bindings,
        { name: node.name.text, scope: node },
        'Compiler packages/compiler/src/scan/parse.ts collection',
      );
    }

    if (node !== root && ts.isFunctionLike(node) && !ts.isArrowFunction(node)) {
      compilerArrayAppend(
        bindings,
        { name: 'arguments', scope: node },
        'Compiler packages/compiler/src/scan/parse.ts collection',
      );
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
    compilerArrayAppend(
      bindings,
      { name: name.text, scope },
      'Compiler packages/compiler/src/scan/parse.ts collection',
    );
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
    return !compilerRegExpTest(/^[a-z]/, node.text);
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
  const entries = handlerPropertyEntries(sourceFile, source, call);
  const result: MutationHandlerModel[] = [];
  const entryLength = compilerArrayLength(entries, 'Endpoint handler entries');
  for (let index = 0; index < entryLength; index += 1) {
    const entry = compilerOwnDataValue(entries, index, 'Endpoint handler entries') as
      | HandlerPropertyEntry
      | undefined;
    if (!entry) throw new TypeError(`Endpoint handler entries[${index}] must be own data.`);
    compilerArrayAppend(
      result,
      {
        ...entry.model,
        handlerWriteSinks: handlerWriteSinkFacts(sourceFile, source, entry.body, {
          owner,
          surface: 'endpoint',
        }),
      },
      'Endpoint handler models',
    );
  }
  return result;
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
        compilerArrayAppend(
          result,
          {
            body: property.body,
            handler: property,
            model: functionBodyModel(sourceFile, source, property.body, property.parameters),
            parameters: property.parameters,
          },
          'Compiler packages/compiler/src/scan/parse.ts collection',
        );
      }
      continue;
    }

    if (!ts.isPropertyAssignment(property) || propertyNameText(property.name) !== 'handler') {
      continue;
    }

    const initializer = unwrapExpression(property.initializer);
    if (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer)) continue;

    compilerArrayAppend(
      result,
      {
        body: initializer.body,
        handler: initializer,
        model: functionBodyModel(sourceFile, source, initializer.body, initializer.parameters),
        parameters: initializer.parameters,
      },
      'Compiler packages/compiler/src/scan/parse.ts collection',
    );
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
  const entries = handlerPropertyEntries(sourceFile, source, call);
  const result: WebhookHandlerModel[] = [];
  const entryLength = compilerArrayLength(entries, 'Webhook handler entries');
  for (let index = 0; index < entryLength; index += 1) {
    const entry = compilerOwnDataValue(entries, index, 'Webhook handler entries') as
      | HandlerPropertyEntry
      | undefined;
    if (!entry) throw new TypeError(`Webhook handler entries[${index}] must be own data.`);
    const contextParamName = ownOptionalString(entry.model.paramNames, 1, 'Webhook parameters');
    const handlerWriteSinks = handlerWriteSinkFacts(sourceFile, source, entry.body, {
      owner,
      surface: 'webhook',
    });
    appendDenseValues(
      handlerWriteSinks,
      webhookTransactionRawDriverEscapeFacts(sourceFile, entry.body, {
        contextParamName,
        owner,
      }),
      'Webhook handler write sinks',
    );
    const recordChangeParameter = compilerOwnDataValue(
      entry.parameters,
      1,
      'Webhook handler parameters',
    ) as ts.ParameterDeclaration | undefined;
    compilerArrayAppend(
      result,
      {
        ...entry.model,
        handlerWriteSinks: sortHandlerWriteSinkFacts(handlerWriteSinks),
        webhookRecordChanges: webhookRecordChangeFacts(sourceFile, entry.body, {
          contextParamName,
          declaredWriteKeys,
          domainBindings,
          owner,
          recordChangeParamNames: webhookRecordChangeParamNames(recordChangeParameter?.name),
        }),
        declaredWriteKeys,
        owner,
        runMutationEdges: taskCompositionEdges(
          sourceFile,
          source,
          entry.body,
          contextParamName,
          'runMutation',
        ),
      },
      'Webhook handler models',
    );
  }
  return result;
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
  const result: TaskRunHandlerModel[] = [];
  const propertyLength = compilerArrayLength(definition.properties, 'Task definition properties');
  for (let index = 0; index < propertyLength; index += 1) {
    const property = compilerOwnDataValue(
      definition.properties,
      index,
      'Task definition properties',
    ) as ts.ObjectLiteralElementLike | undefined;
    if (!property) throw new TypeError(`Task definition properties[${index}] must be own data.`);
    const handler = runHandlerModel(sourceFile, source, property);
    if (!handler) continue;
    const ctxParam = ownOptionalString(handler.model.paramNames, 1, 'Task handler parameters');
    compilerArrayAppend(
      result,
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
      'Task run handler models',
    );
  }
  return result;
}

function taskDefinitionObject(call: ts.CallExpression): ts.ObjectLiteralExpression | null {
  const argumentLength = compilerArrayLength(call.arguments, 'Handler factory arguments');
  const definition = callArgument(call, argumentLength >= 2 ? 1 : 0);
  return definition && ts.isObjectLiteralExpression(definition) ? definition : null;
}

function callArgument(call: ts.CallExpression, index: number): ts.Expression | undefined {
  const length = compilerArrayLength(call.arguments, 'Handler factory arguments');
  if (index < 0 || index >= length) return undefined;
  const argument = compilerOwnDataValue(call.arguments, index, 'Handler factory arguments') as
    | ts.Expression
    | undefined;
  if (!argument) throw new TypeError(`Handler factory arguments[${index}] must be own data.`);
  return argument;
}

function taskKey(sourceFile: ts.SourceFile, call: ts.CallExpression): string {
  const first = callArgument(call, 0);
  if (first && ts.isStringLiteralLike(first)) return first.text;

  const exported = exportedConstInitializerName(call);
  if ('exportedConstName' in exported) {
    return deriveRegistryIdentity(sourceFile.fileName, exported.exportedConstName).key;
  }
  return sourceFile.fileName;
}

function mutationOwner(sourceFile: ts.SourceFile, call: ts.CallExpression): HandlerWriteSinkOwner {
  const first = callArgument(call, 0);
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
  const requestParamNames = compilerCreateSet<string>();
  const targets = compilerCreateSet<string>();

  const parameterLength = compilerArrayLength(parameters, 'Mutation handler parameters');
  for (let index = 0; index < parameterLength; index += 1) {
    const parameter = compilerOwnDataValue(parameters, index, 'Mutation handler parameters') as
      | ts.ParameterDeclaration
      | undefined;
    if (!parameter) throw new TypeError(`Mutation handler parameters[${index}] must be own data.`);
    collectDirectDbBindingNames(parameter.name, targets);
    if (ts.isIdentifier(parameter.name) && isRequestLikeParamName(parameter.name.text)) {
      compilerSetAdd(requestParamNames, parameter.name.text);
      compilerSetAdd(targets, `${parameter.name.text}.db`);
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
      initializerName !== undefined && compilerSetHas(requestParamNames, initializerName);
    if (!target && !requestLikeInitializer) return;

    if (ts.isIdentifier(name)) {
      compilerSetAdd(targets, name.text);
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
    if (name.text === 'db' || looksLikeDbTargetIdentity(name.text)) {
      compilerSetAdd(targets, name.text);
    }
    return;
  }

  if (!ts.isObjectBindingPattern(name)) return;

  const elementLength = compilerArrayLength(name.elements, 'Direct-db object binding elements');
  for (let index = 0; index < elementLength; index += 1) {
    const element = compilerOwnDataValue(
      name.elements,
      index,
      'Direct-db object binding elements',
    ) as ts.BindingElement | undefined;
    if (!element) {
      throw new TypeError(`Direct-db object binding elements[${index}] must be own data.`);
    }
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
    compilerSetAdd(targets, name.text);
    return;
  }

  if (ts.isObjectBindingPattern(name)) {
    const elementLength = compilerArrayLength(name.elements, 'Object binding elements');
    for (let index = 0; index < elementLength; index += 1) {
      const element = compilerOwnDataValue(name.elements, index, 'Object binding elements') as
        | ts.BindingElement
        | undefined;
      if (!element) throw new TypeError(`Object binding elements[${index}] must be own data.`);
      collectBindingIdentifiers(element.name, targets);
    }
    return;
  }

  const elementLength = compilerArrayLength(name.elements, 'Array binding elements');
  for (let index = 0; index < elementLength; index += 1) {
    const element = compilerOwnDataValue(name.elements, index, 'Array binding elements') as
      | ts.ArrayBindingElement
      | undefined;
    if (element && ts.isBindingElement(element)) collectBindingIdentifiers(element.name, targets);
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
  if (identity && (compilerSetHas(targets, identity) || looksLikeDbTargetIdentity(identity))) {
    return identity;
  }
  return undefined;
}

function expressionTargetIdentity(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return propertyAccessPath(expression) ?? undefined;
  const receiver = callExpressionReceiverSegments(expression);
  if (receiver) return compilerArrayJoin(receiver, '.');
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
  const normalized = compilerStringToLowerCase(identity);
  return compilerStringIncludes(normalized, 'db') || compilerStringIncludes(normalized, 'database');
}

const requestLikeContextParamNames = compilerCreateSet<string>();
compilerSetAdd(requestLikeContextParamNames, 'context');
compilerSetAdd(requestLikeContextParamNames, 'ctx');

function isRequestLikeParamName(param: string): boolean {
  if (compilerSetHas(requestLikeContextParamNames, param)) return true;
  return compilerStringEndsWith(compilerStringToLowerCase(param), 'request');
}

function webhookOwner(sourceFile: ts.SourceFile, call: ts.CallExpression): HandlerWriteSinkOwner {
  const first = callArgument(call, 0);
  if (first && ts.isStringLiteralLike(first)) return { kind: 'path', value: first.text };

  const definition = taskDefinitionObject(call);
  const path = definition ? staticStringObjectProperty(definition, 'path') : undefined;
  if (path !== undefined) return { kind: 'path', value: path };

  const exported = exportedConstInitializerName(call);
  if ('exportedConstName' in exported) return { kind: 'path', value: exported.exportedConstName };
  return { kind: 'path', value: 'UNRESOLVED' };
}

function endpointOwner(call: ts.CallExpression): HandlerWriteSinkOwner {
  const first = callArgument(call, 0);
  if (first && ts.isStringLiteralLike(first)) return { kind: 'path', value: first.text };

  return { kind: 'path', value: 'UNRESOLVED' };
}

function webhookDeclaredWriteKeys(
  sourceFile: ts.SourceFile,
  definition: ts.ObjectLiteralExpression,
  domainBindings: ReadonlyMap<string, string>,
): string[] {
  let writes: ts.PropertyAssignment | undefined;
  const propertyLength = compilerArrayLength(
    definition.properties,
    'Webhook definition properties',
  );
  for (let index = 0; index < propertyLength; index += 1) {
    const property = compilerOwnDataValue(
      definition.properties,
      index,
      'Webhook definition properties',
    ) as ts.ObjectLiteralElementLike | undefined;
    if (!property) throw new TypeError(`Webhook definition properties[${index}] must be own data.`);
    if (ts.isPropertyAssignment(property) && propertyNameText(property.name) === 'writes') {
      writes = property;
      break;
    }
  }
  if (!writes) return [];

  const initializer = unwrapExpression(writes.initializer);
  if (!ts.isArrayLiteralExpression(initializer)) return ['UNRESOLVED'];

  const result: string[] = [];
  const elementLength = compilerArrayLength(initializer.elements, 'Webhook writes elements');
  for (let index = 0; index < elementLength; index += 1) {
    const element = compilerOwnDataValue(initializer.elements, index, 'Webhook writes elements') as
      | ts.Expression
      | ts.SpreadElement
      | undefined;
    if (!element) throw new TypeError(`Webhook writes elements[${index}] must be own data.`);
    const expression = ts.isSpreadElement(element) ? element.expression : element;
    compilerArrayAppend(
      result,
      domainKeyFromExpression(sourceFile, expression, domainBindings) ?? 'UNRESOLVED',
      'Webhook declared write keys',
    );
  }
  return result;
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

  const txTargets = compilerCreateSet<string>();
  compilerSetAdd(txTargets, `${options.contextParamName}.tx`);
  const facts = compilerCreateMap<string, HandlerWriteSinkFact>();

  const addTxAlias = (name: ts.BindingName, initializer: ts.Expression | undefined): void => {
    if (!initializer) return;
    const identity = expressionTargetIdentity(unwrapExpression(initializer));
    if (identity !== `${options.contextParamName}.tx`) return;

    if (ts.isIdentifier(name)) {
      compilerSetAdd(txTargets, name.text);
      return;
    }

    collectBindingIdentifiers(name, txTargets);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) addTxAlias(node.name, node.initializer);

    if (ts.isPropertyAccessExpression(node)) {
      const propertyName = node.name.text;
      if (compilerSetHas(WEBHOOK_TRANSACTION_RAW_DRIVER_ESCAPE_PROPERTIES, propertyName)) {
        const targetIdentity = expressionTargetIdentity(unwrapExpression(node.expression));
        if (targetIdentity !== undefined && compilerSetHas(txTargets, targetIdentity)) {
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
          compilerMapSet(facts, handlerWriteSinkFactKey(fact), fact);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(body);
  return sortedHandlerWriteSinkFacts(facts);
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
  if (
    !contextParamName &&
    compilerArrayLength(options.recordChangeParamNames, 'Webhook recordChange parameter names') ===
      0
  ) {
    return [];
  }

  const facts: WebhookRecordChangeFact[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const fact = webhookRecordChangeFact(sourceFile, node, options);
      if (fact) compilerArrayAppend(facts, fact, 'Webhook record-change facts');
    }
    ts.forEachChild(node, visit);
  };

  visit(body);
  return sortWebhookRecordChangeFacts(facts);
}

function sortWebhookRecordChangeFacts(
  facts: readonly WebhookRecordChangeFact[],
): WebhookRecordChangeFact[] {
  const result: WebhookRecordChangeFact[] = [];
  const length = compilerArrayLength(facts, 'Webhook record-change facts to sort');
  for (let index = 0; index < length; index += 1) {
    const fact = compilerOwnDataValue(facts, index, 'Webhook record-change facts to sort') as
      | WebhookRecordChangeFact
      | undefined;
    if (!fact) {
      throw new TypeError(`Webhook record-change facts to sort[${index}] must be own data.`);
    }
    const resultLength = compilerArrayLength(result, 'Sorted webhook record-change facts');
    compilerArrayAppend(result, fact, 'Sorted webhook record-change facts');
    let insertionIndex = resultLength;
    while (insertionIndex > 0) {
      const previous = compilerOwnDataValue(
        result,
        insertionIndex - 1,
        'Sorted webhook record-change facts',
      ) as WebhookRecordChangeFact | undefined;
      if (!previous) {
        throw new TypeError(
          `Sorted webhook record-change facts[${insertionIndex - 1}] must be own data.`,
        );
      }
      if (previous.span.start <= fact.span.start) break;
      compilerSetOwnDataProperty(result, insertionIndex, previous);
      insertionIndex -= 1;
    }
    compilerSetOwnDataProperty(result, insertionIndex, fact);
  }
  return result;
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
  } else if (
    !ts.isIdentifier(callee) ||
    !denseStringArrayIncludes(
      options.recordChangeParamNames,
      callee.text,
      'Webhook recordChange parameter names',
    )
  ) {
    return null;
  }

  const domainArgument = callArgument(call, 0);
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

  const result: string[] = [];
  const elementLength = compilerArrayLength(name.elements, 'Webhook context binding elements');
  for (let index = 0; index < elementLength; index += 1) {
    const element = compilerOwnDataValue(
      name.elements,
      index,
      'Webhook context binding elements',
    ) as ts.BindingElement | undefined;
    if (!element)
      throw new TypeError(`Webhook context binding elements[${index}] must be own data.`);
    const propertyName = element.propertyName;
    if (
      propertyName !== undefined &&
      (!ts.isIdentifier(propertyName) || propertyName.text !== 'recordChange')
    ) {
      continue;
    }
    const bindingName = element.name;
    if (!ts.isIdentifier(bindingName)) continue;
    if (propertyName === undefined && bindingName.text !== 'recordChange') continue;
    compilerArrayAppend(result, bindingName.text, 'Webhook recordChange parameter names');
  }
  return result;
}

function domainKeyFromExpression(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  domainBindings: ReadonlyMap<string, string>,
): string | undefined {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    return compilerMapGet(domainBindings, unwrapped.text) ?? 'UNRESOLVED';
  }
  if (!ts.isCallExpression(unwrapped)) return undefined;
  if (!isFrameworkExpression(sourceFile, unwrapped.expression, DOMAIN_FACTORY_IDENTITY)) {
    return undefined;
  }
  const key = callArgument(unwrapped, 0);
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
  const paramNames: (string | undefined)[] = [];
  const params: string[] = [];
  const paramSpans: SourceSpan[] = [];
  const parameterLength = compilerArrayLength(parameters, 'Handler parameters');
  for (let index = 0; index < parameterLength; index += 1) {
    const parameter = compilerOwnDataValue(parameters, index, 'Handler parameters') as
      | ts.ParameterDeclaration
      | undefined;
    if (!parameter) throw new TypeError(`Handler parameters[${index}] must be own data.`);
    compilerArrayAppend(paramNames, parameterName(parameter.name), 'Handler parameter names');
    compilerArrayAppend(
      params,
      compilerStringSlice(source, parameter.getStart(sourceFile), parameter.getEnd()),
      'Handler parameter sources',
    );
    compilerArrayAppend(
      paramSpans,
      { end: parameter.getEnd(), start: parameter.getStart(sourceFile) },
      'Handler parameter spans',
    );
  }
  return {
    body: compilerStringSlice(source, body.getStart(sourceFile), body.getEnd()),
    bodyEnd: body.getEnd(),
    bodyPropertyAccesses: propertyAccessPathModels(sourceFile, body),
    bodyStart: body.getStart(sourceFile),
    paramNames,
    params,
    paramSpans,
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
  const facts = compilerCreateMap<string, HandlerWriteSinkFact>();
  const bodyPropertyAccesses = propertyAccessPathModels(sourceFile, body);

  const accessLength = compilerArrayLength(
    bodyPropertyAccesses,
    'Handler write-sink property accesses',
  );
  for (let index = 0; index < accessLength; index += 1) {
    const access = compilerOwnDataValue(
      bodyPropertyAccesses,
      index,
      'Handler write-sink property accesses',
    ) as PropertyAccessPathModel | undefined;
    if (!access) {
      throw new TypeError(`Handler write-sink property accesses[${index}] must be own data.`);
    }
    if (!isHandlerWriteSinkOperation(access.terminalName)) continue;
    const fact = resolvedHandlerWriteSinkFact(access, options);
    if (
      options.resolvedTargetFilter &&
      !options.resolvedTargetFilter(fact.canonicalTarget.identity)
    ) {
      continue;
    }
    compilerMapSet(facts, handlerWriteSinkFactKey(fact), fact);
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const unresolved = unresolvedHandlerWriteSinkFact(sourceFile, source, node, options);
      if (unresolved) compilerMapSet(facts, handlerWriteSinkFactKey(unresolved), unresolved);
    }
    ts.forEachChild(node, visit);
  };

  visit(body);
  return sortedHandlerWriteSinkFacts(facts);
}

function sortedHandlerWriteSinkFacts(
  facts: ReadonlyMap<string, HandlerWriteSinkFact>,
): HandlerWriteSinkFact[] {
  const result: HandlerWriteSinkFact[] = [];
  compilerMapForEach(facts, (fact) => {
    insertHandlerWriteSinkFact(result, fact);
  });
  return result;
}

function sortHandlerWriteSinkFacts(facts: readonly HandlerWriteSinkFact[]): HandlerWriteSinkFact[] {
  const result: HandlerWriteSinkFact[] = [];
  const length = compilerArrayLength(facts, 'Handler write-sink facts to sort');
  for (let index = 0; index < length; index += 1) {
    const fact = compilerOwnDataValue(facts, index, 'Handler write-sink facts to sort') as
      | HandlerWriteSinkFact
      | undefined;
    if (!fact) throw new TypeError(`Handler write-sink facts to sort[${index}] must be own data.`);
    insertHandlerWriteSinkFact(result, fact);
  }
  return result;
}

function insertHandlerWriteSinkFact(
  result: HandlerWriteSinkFact[],
  fact: HandlerWriteSinkFact,
): void {
  const length = compilerArrayLength(result, 'Sorted handler write-sink facts');
  compilerArrayAppend(result, fact, 'Sorted handler write-sink facts');
  let insertionIndex = length;
  while (insertionIndex > 0) {
    const previous = compilerOwnDataValue(
      result,
      insertionIndex - 1,
      'Sorted handler write-sink facts',
    ) as HandlerWriteSinkFact | undefined;
    if (!previous) {
      throw new TypeError(
        `Sorted handler write-sink facts[${insertionIndex - 1}] must be own data.`,
      );
    }
    if (previous.span.start <= fact.span.start) break;
    compilerSetOwnDataProperty(result, insertionIndex, previous);
    insertionIndex -= 1;
  }
  compilerSetOwnDataProperty(result, insertionIndex, fact);
}

function resolvedHandlerWriteSinkFact(
  access: PropertyAccessPathModel,
  options: HandlerWriteSinkFactOptions,
): HandlerWriteSinkFact {
  const operationKind = handlerWriteSinkOperation(access.terminalName);
  const suffix = `.${access.terminalName}`;
  const targetIdentity = compilerStringEndsWith(access.path, suffix)
    ? compilerStringSlice(access.path, 0, -1 * suffix.length)
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
    const receiver = compilerStringTrim(
      compilerStringSlice(
        source,
        callee.expression.getStart(sourceFile),
        callee.expression.getEnd(),
      ),
    );
    if (compilerSetHas(TASK_CONTEXT_COMPOSITION_METHODS, receiver)) return null;
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
  return compilerSetHas(HANDLER_WRITE_SINK_OPERATIONS, name as HandlerWriteSinkOperationKind);
}

function handlerWriteSinkOperation(name: string): HandlerWriteSinkOperationKind {
  return isHandlerWriteSinkOperation(name) ? (name as HandlerWriteSinkOperationKind) : 'UNRESOLVED';
}

function handlerWriteSinkFactKey(fact: HandlerWriteSinkFact): string {
  return `${fact.surface}\0${fact.owner.kind}\0${fact.owner.value}\0${fact.operationKind}\0${fact.path}\0${fact.span.start}\0${fact.span.end}`;
}

function taskCompositionEdges(
  sourceFile: ts.SourceFile,
  source: string,
  body: ts.ConciseBody,
  ctxParam: string | undefined,
  method: 'runMutation' | 'runQuery' | 'schedule',
): string[] {
  const edges = compilerCreateSet<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression;
      const receiverText = compilerStringTrim(
        compilerStringSlice(source, receiver.getStart(sourceFile), receiver.getEnd()),
      );
      if (
        node.expression.name.text === method &&
        (ctxParam === undefined || receiverText === ctxParam)
      ) {
        compilerSetAdd(
          edges,
          taskCompositionTarget(sourceFile, source, callArgument(node, 0)) ?? `${method}:?`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(body);
  const result: string[] = [];
  compilerSetForEach(edges, (edge) => insertSortedString(result, edge));
  return result;
}

function insertSortedString(values: string[], value: string): void {
  let insertionIndex = compilerArrayLength(values, 'Sorted strings');
  compilerArrayAppend(values, value, 'Sorted strings');
  while (insertionIndex > 0) {
    const previous = compilerOwnDataValue(values, insertionIndex - 1, 'Sorted strings');
    if (typeof previous !== 'string') {
      throw new TypeError(`Sorted strings[${insertionIndex - 1}] must be own data.`);
    }
    if (previous <= value) break;
    compilerSetOwnDataProperty(values, insertionIndex, previous);
    insertionIndex -= 1;
  }
  compilerSetOwnDataProperty(values, insertionIndex, value);
}

function taskCompositionTarget(
  sourceFile: ts.SourceFile,
  source: string,
  expression: ts.Expression | undefined,
): string | undefined {
  if (!expression) return undefined;
  if (ts.isStringLiteralLike(expression)) return expression.text;
  return compilerStringTrim(
    compilerRegExpReplace(
      /\s+/g,
      compilerStringSlice(source, expression.getStart(sourceFile), expression.getEnd()),
      ' ',
    ),
  );
}

function parameterName(name: ts.BindingName): string | undefined {
  if (ts.isIdentifier(name)) return name.text;
  if (!ts.isObjectBindingPattern(name)) return undefined;
  const element = compilerOwnDataValue(name.elements, 0, 'Parameter binding elements') as
    | ts.BindingElement
    | undefined;
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
    const segments = compilerStringSplit(rootPath, '.');
    const segmentLength = compilerArrayLength(segments, 'Property-access root segments');
    const terminalName =
      segmentLength === 0
        ? rootPath
        : (compilerOwnDataValue(
            segments,
            segmentLength - 1,
            'Property-access root segments',
          ) as string);
    compilerArrayAppend(
      paths,
      {
        end: node.getEnd(),
        path: rootPath,
        start: node.getStart(sourceFile),
        terminalName,
      },
      'Property-access path models',
    );
  };

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && !isReceiverOfOuterAccess(node)) {
      const path = propertyAccessPath(node);
      if (path) {
        compilerArrayAppend(
          paths,
          {
            end: node.getEnd(),
            ...propertyAccessInferredType(sourceFile, node),
            path,
            start: node.getStart(sourceFile),
            terminalName: node.name.text,
          },
          'Property-access path models',
        );
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
  return compilerRegExpTest(/^-?\d(?:\d|\.)*$/, node.getText(sourceFile));
}

function staticConstructorTypeEntry(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): { staticConstructorType: NonNullable<ObjectLiteralEntry['staticConstructorType']> } | {} {
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
  staticStringValues: ReadonlyMap<string, string> = compilerCreateMap<string, string>(),
): ObjectLiteralEntry[] {
  const result: ObjectLiteralEntry[] = [];
  const propertyLength = compilerArrayLength(expression.properties, 'Object literal properties');
  for (let index = 0; index < propertyLength; index += 1) {
    const property = compilerOwnDataValue(
      expression.properties,
      index,
      'Object literal properties',
    ) as ts.ObjectLiteralElementLike | undefined;
    if (!property) throw new TypeError(`Object literal properties[${index}] must be own data.`);
    if (ts.isPropertyAssignment(property)) {
      const key = propertyNameText(property.name, { staticStringValues });
      if (!key) continue;

      compilerArrayAppend(
        result,
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
          ...(ts.isStringLiteralLike(property.initializer) ||
          ts.isNoSubstitutionTemplateLiteral(property.initializer)
            ? { staticStringValue: property.initializer.text }
            : {}),
          ...objectLiteralEntryPropertyAccesses(sourceFile, property.initializer),
          value: compilerStringSlice(
            source,
            property.initializer.getStart(sourceFile),
            property.initializer.getEnd(),
          ),
        },
        'Object literal entries',
      );
      continue;
    }

    if (ts.isShorthandPropertyAssignment(property)) {
      compilerArrayAppend(
        result,
        { key: property.name.text, value: property.name.text },
        'Object literal entries',
      );
      continue;
    }

    if (ts.isMethodDeclaration(property)) {
      const key = propertyNameText(property.name, { staticStringValues });
      if (key) compilerArrayAppend(result, { key }, 'Object literal entries');
    }
  }
  return result;
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
  staticStringValues: ReadonlyMap<string, string> = compilerCreateMap<string, string>(),
): ObjectLiteralEntry[] | undefined {
  const propertyLength = compilerArrayLength(expression.properties, 'JSX spread object properties');
  for (let index = 0; index < propertyLength; index += 1) {
    const property = compilerOwnDataValue(
      expression.properties,
      index,
      'JSX spread object properties',
    ) as ts.ObjectLiteralElementLike | undefined;
    if (!property) throw new TypeError(`JSX spread object properties[${index}] must be own data.`);
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
  moduleScopeMutationFormControlNames: ReadonlyMap<string, readonly string[]>,
  moduleScopeStaticStringBindings: ReadonlyMap<string, ModuleScopeStaticStringBinding>,
  namedImports: readonly NamedImportModel[],
): JsxElementModel {
  const openingElement = ts.isJsxElement(node) ? node.openingElement : node;
  const closingStart = ts.isJsxElement(node)
    ? node.closingElement.getStart(sourceFile)
    : node.getEnd();
  const childSource = ts.isJsxElement(node)
    ? compilerStringSlice(source, openingElement.getEnd(), closingStart)
    : '';
  const selfClosing = !ts.isJsxElement(node);
  const tag = openingElement.tagName.getText(sourceFile);
  const componentTag = jsxTagIsComponent(openingElement.tagName, tag);
  const unreviewedComponentTag =
    componentTag &&
    !jsxTagHasReviewedKovoUiEventBoundary(sourceFile, openingElement.tagName, tag, namedImports);

  return {
    ancestorTags: jsxAncestorTags(sourceFile, node),
    attributes: jsxAttributeModels(sourceFile, source, openingElement, unreviewedComponentTag),
    childBody: jsxChildBody(childSource, openingElement.getEnd(), selfClosing),
    ...jsxChildFacts(node, sourceFile),
    closingStart,
    end: node.getEnd(),
    ...(componentTag ? {} : { intrinsicTagName: compilerStringToLowerCase(tag) }),
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
    spreadAttributes: jsxSpreadAttributeModels(
      sourceFile,
      source,
      openingElement,
      moduleScopeObjectEntries,
      moduleScopeMutationFormControlNames,
      moduleScopeStaticStringBindings,
      namedImports,
      unreviewedComponentTag,
    ),
    start: node.getStart(sourceFile),
    tag,
  };
}

function jsxAttributeModels(
  sourceFile: ts.SourceFile,
  source: string,
  openingElement: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  unreviewedComponentTag: boolean,
): JsxElementModel['attributes'][number][] {
  const result: JsxElementModel['attributes'][number][] = [];
  const properties = openingElement.attributes.properties;
  const propertyLength = compilerArrayLength(properties, 'JSX attributes');
  for (let index = 0; index < propertyLength; index += 1) {
    const property = compilerOwnDataValue(properties, index, 'JSX attributes') as
      | ts.JsxAttribute
      | ts.JsxSpreadAttribute
      | undefined;
    if (!property) throw new TypeError(`JSX attributes[${index}] must be own data.`);
    if (!ts.isJsxAttribute(property)) continue;

    const value = staticJsxAttributeValue(property);
    const expression = jsxAttributeExpression(sourceFile, source, property);
    const name = property.name.getText(sourceFile);
    const eventFacts = jsxAttributeEventFacts(name);
    compilerArrayAppend(
      result,
      {
        ...eventFacts,
        ...(unreviewedComponentTag && eventFacts.domEventName !== undefined
          ? { componentEventProp: true as const }
          : {}),
        end: property.getEnd(),
        leadingStart: attributeLeadingStart(source, property.getStart(sourceFile)),
        name,
        start: property.getStart(sourceFile),
        ...(expression === null ? {} : expression),
        ...(value === undefined ? {} : { value }),
      },
      'JSX attributes',
    );
  }
  return result;
}

function jsxTagIsComponent(tagName: ts.JsxTagNameExpression, tag: string): boolean {
  // TypeScript's JSX runtime treats namespaced and dashed names as intrinsic strings. A plain
  // identifier is intrinsic only when it starts with ASCII lowercase; `_`, `$`, and every
  // non-ASCII identifier are lexical component references even when they are not PascalCase.
  // SPEC §5.2: a component callback prop must never reach host-event lowering by naming style.
  if (ts.isJsxNamespacedName(tagName) || compilerStringIncludes(tag, '-')) return false;
  if (!ts.isIdentifier(tagName)) return true;
  const first = compilerStringCharCodeAt(tag, 0);
  return first < 0x61 || first > 0x7a;
}

/**
 * `@kovojs/ui` components are framework-reviewed host/primitive boundaries whose event props the
 * compiler intentionally lowers. Every other component tag remains an unresolved prop boundary.
 * The decision is parser-owned and import-identity based so post-parse phases consume only facts.
 */
function jsxTagHasReviewedKovoUiEventBoundary(
  sourceFile: ts.SourceFile,
  tagName: ts.JsxTagNameExpression,
  tag: string,
  namedImports: readonly NamedImportModel[],
): boolean {
  if (
    compilerStringIncludes(tag, '.') ||
    !ts.isIdentifier(tagName) ||
    identifierIsShadowedBeforeScope(tagName, undefined, sourceFile)
  ) {
    return false;
  }
  const importLength = compilerArrayLength(namedImports, 'Reviewed Kovo UI event imports');
  for (let importIndex = 0; importIndex < importLength; importIndex += 1) {
    const entry = compilerOwnDataValue(
      namedImports,
      importIndex,
      'Reviewed Kovo UI event imports',
    ) as NamedImportModel | undefined;
    if (!entry) {
      throw new TypeError(`Reviewed Kovo UI event imports[${importIndex}] must be own data.`);
    }
    if (
      entry.localName === tag &&
      isReviewedComponentEventBoundary(entry.moduleSpecifier, entry.importedName)
    ) {
      return true;
    }
  }
  return false;
}

function jsxSpreadAttributeModels(
  sourceFile: ts.SourceFile,
  source: string,
  openingElement: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  moduleScopeObjectEntries: ReadonlyMap<string, readonly ObjectLiteralEntry[]>,
  moduleScopeMutationFormControlNames: ReadonlyMap<string, readonly string[]>,
  moduleScopeStaticStringBindings: ReadonlyMap<string, ModuleScopeStaticStringBinding>,
  namedImports: readonly NamedImportModel[],
  unreviewedComponentTag: boolean,
): JsxElementModel['spreadAttributes'][number][] {
  const result: JsxElementModel['spreadAttributes'][number][] = [];
  const properties = openingElement.attributes.properties;
  const propertyLength = compilerArrayLength(properties, 'JSX spread attributes');
  for (let index = 0; index < propertyLength; index += 1) {
    const property = compilerOwnDataValue(properties, index, 'JSX spread attributes') as
      | ts.JsxAttribute
      | ts.JsxSpreadAttribute
      | undefined;
    if (!property) throw new TypeError(`JSX spread attributes[${index}] must be own data.`);
    if (!ts.isJsxSpreadAttribute(property)) continue;

    const expression = property.expression;
    const unwrapped = unwrapExpression(expression);
    const bareIdentifierName = ts.isIdentifier(unwrapped) ? unwrapped.text : undefined;
    const callExpression = ts.isCallExpression(unwrapped) ? unwrapped : undefined;
    const callIdentifier =
      callExpression && ts.isIdentifier(callExpression.expression)
        ? callExpression.expression
        : undefined;
    const callName = callIdentifier?.text;
    let callImport: NamedImportModel | undefined;
    const importLength = compilerArrayLength(namedImports, 'Named imports');
    for (let importIndex = 0; importIndex < importLength; importIndex += 1) {
      const candidate = compilerOwnDataValue(namedImports, importIndex, 'Named imports') as
        | NamedImportModel
        | undefined;
      if (!candidate) throw new TypeError(`Named imports[${importIndex}] must be own data.`);
      if (
        candidate.localName === callName &&
        callIdentifier !== undefined &&
        !identifierIsShadowedBeforeScope(callIdentifier, undefined, sourceFile)
      ) {
        callImport = candidate;
        break;
      }
    }
    const firstCallArgument = callExpression ? callArgument(callExpression, 0) : undefined;
    const unwrappedCallArgument = firstCallArgument
      ? unwrapExpression(firstCallArgument)
      : undefined;
    const callArgumentBareIdentifierName =
      unwrappedCallArgument && ts.isIdentifier(unwrappedCallArgument)
        ? unwrappedCallArgument.text
        : undefined;
    const objectEntries = ts.isObjectLiteralExpression(unwrapped)
      ? completeJsxSpreadObjectLiteralEntries(sourceFile, source, unwrapped)
      : bareIdentifierName === undefined
        ? undefined
        : compilerMapGet(moduleScopeObjectEntries, bareIdentifierName);
    const staticWireAttributeEntries = ts.isObjectLiteralExpression(unwrapped)
      ? completeStaticJsxWireAttributeEntries(
          sourceFile,
          unwrapped,
          moduleScopeStaticStringBindings,
        )
      : undefined;
    const mutationFormControlNames = ts.isObjectLiteralExpression(unwrapped)
      ? mutationFormControlNamesFromExpression(
          unwrapped,
          moduleScopeStaticStringValues(sourceFile),
          moduleScopeMutationFormControlNames,
        )
      : bareIdentifierName === undefined
        ? []
        : snapshotCompilerModelArray(
            compilerMapGet(moduleScopeMutationFormControlNames, bareIdentifierName) ?? [],
            'JSX spread mutation form control names',
          );
    const componentEventPropNames = unreviewedComponentTag
      ? componentEventPropNamesForEntries(objectEntries)
      : undefined;
    compilerArrayAppend(
      result,
      {
        ...(componentEventPropNames === undefined ? {} : { componentEventPropNames }),
        end: property.getEnd(),
        expression: compilerStringTrim(
          compilerStringSlice(source, expression.getStart(sourceFile), expression.getEnd()),
        ),
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
        ...(mutationFormControlNames.length === 0 ? {} : { mutationFormControlNames }),
        ...(objectEntries === undefined ? {} : { objectEntries }),
        start: property.getStart(sourceFile),
        ...(staticWireAttributeEntries === undefined ? {} : { staticWireAttributeEntries }),
      },
      'JSX spread attributes',
    );
  }
  return result;
}

/**
 * Reconstruct only the enumerable key/value facts needed by the HTML cross-attribute classifier.
 * A nested inline object spread is flattened in JavaScript property insertion order, including
 * exact-key overwrites. Any carrier, accessor, method, dynamic key, or non-literal nested spread
 * keeps the whole fact unknown so the emitted runtime sink remains authoritative.
 */
function completeStaticJsxWireAttributeEntries(
  sourceFile: ts.SourceFile,
  expression: ts.ObjectLiteralExpression,
  moduleScopeStaticStringBindings: ReadonlyMap<string, ModuleScopeStaticStringBinding>,
): StaticJsxWireAttributeEntry[] | undefined {
  const entries: StaticJsxWireAttributeEntry[] = [];
  const properties = expression.properties;
  const propertyLength = compilerArrayLength(properties, 'Static JSX wire spread properties');
  for (let index = 0; index < propertyLength; index += 1) {
    const property = compilerOwnDataValue(
      properties,
      index,
      'Static JSX wire spread properties',
    ) as ts.ObjectLiteralElementLike | undefined;
    if (!property) {
      throw new TypeError(`Static JSX wire spread properties[${index}] must be own data.`);
    }
    if (ts.isSpreadAssignment(property)) {
      const nestedExpression = unwrapExpression(property.expression);
      if (staticJsxWireSpreadHasNoEnumerableKeys(sourceFile, nestedExpression)) continue;
      if (!ts.isObjectLiteralExpression(nestedExpression)) return undefined;
      const nested = completeStaticJsxWireAttributeEntries(
        sourceFile,
        nestedExpression,
        moduleScopeStaticStringBindings,
      );
      if (nested === undefined) return undefined;
      appendDenseValues(entries, nested, 'Nested static JSX wire spread entries');
      continue;
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      compilerArrayAppend(
        entries,
        { key: property.name.text, value: { kind: 'unknown' } },
        'Static JSX wire spread entries',
      );
      continue;
    }
    if (!ts.isPropertyAssignment(property)) return undefined;
    const key = staticJsxWireAttributeKey(
      sourceFile,
      property.name,
      moduleScopeStaticStringBindings,
    );
    // `__proto__` object-literal setters are deliberately left on the runtime path. A computed
    // own `['__proto__']` key is harmless here but keeping both shapes opaque avoids inventing an
    // own attribute for the setter spelling.
    if (!key || key === '__proto__') return undefined;
    compilerArrayAppend(
      entries,
      {
        key,
        value: staticJsxWireAttributeValue(sourceFile, property.initializer),
      },
      'Static JSX wire spread entries',
    );
  }
  return entries;
}

function staticJsxWireAttributeValue(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): StaticJsxWireAttributeValue {
  const unwrapped = unwrapExpression(expression);
  if (
    ts.isVoidExpression(unwrapped) ||
    (ts.isIdentifier(unwrapped) &&
      identifierResolvesToUnshadowedGlobal(sourceFile, unwrapped, 'undefined'))
  ) {
    return { kind: 'known', value: undefined };
  }
  const value = staticLiteralValue(unwrapped);
  return value === undefined ? { kind: 'unknown' } : { kind: 'known', value };
}

function staticJsxWireSpreadHasNoEnumerableKeys(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): boolean {
  return (
    expression.kind === ts.SyntaxKind.NullKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    ts.isVoidExpression(expression) ||
    (ts.isIdentifier(expression) &&
      identifierResolvesToUnshadowedGlobal(sourceFile, expression, 'undefined'))
  );
}

function staticJsxWireAttributeKey(
  sourceFile: ts.SourceFile,
  name: ts.PropertyName,
  moduleScopeStaticStringBindings: ReadonlyMap<string, ModuleScopeStaticStringBinding>,
): string | null {
  if (!ts.isComputedPropertyName(name) || !ts.isIdentifier(name.expression)) {
    return propertyNameText(name);
  }
  const binding = compilerMapGet(moduleScopeStaticStringBindings, name.expression.text);
  if (
    binding === undefined ||
    identifierIsShadowedBeforeScope(name.expression, binding.identifier, sourceFile) ||
    scopeDeclaresIdentifierNamed(sourceFile, name.expression.text, binding.identifier)
  ) {
    return null;
  }
  return binding.value;
}

function componentEventPropNamesForEntries(
  entries: readonly ObjectLiteralEntry[] | undefined,
): string[] | undefined {
  if (entries === undefined) return undefined;
  const names: string[] = [];
  const length = compilerArrayLength(entries, 'Component event spread entries');
  for (let index = 0; index < length; index += 1) {
    const entry = compilerOwnDataValue(entries, index, 'Component event spread entries') as
      | ObjectLiteralEntry
      | undefined;
    if (!entry) throw new TypeError(`Component event spread entries[${index}] must be own data.`);
    const event = jsxDomEventName(entry.key);
    if ('domEventName' in event) {
      compilerArrayAppend(names, entry.key, 'Component event spread names');
    }
  }
  return names.length > 0 ? names : undefined;
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
  if (!compilerRegExpTest(/^on[A-Z][A-Za-z0-9]*$/, name)) return {};
  return { domEventName: compilerStringToLowerCase(compilerStringSlice(name, 2)) };
}

function jsxExecutionTriggerName(name: string): { executionTriggerName: string } | {} {
  if (!compilerStringStartsWith(name, 'on:')) return {};
  const triggerName = compilerStringSlice(name, 'on:'.length);
  if (!validExecutionTriggerName(triggerName)) return {};
  return { executionTriggerName: triggerName };
}

function validExecutionTriggerName(name: string): boolean {
  if (name === '') return false;
  if (!isLowerAlpha(name[0] ?? '')) return false;
  for (let index = 1; index < name.length; index += 1) {
    if (!isExecutionTriggerNameChar(name[index] ?? '')) return false;
  }
  return true;
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

  let leadingWhitespace = 0;
  while (
    leadingWhitespace < childSource.length &&
    compilerRegExpTest(/^\s$/u, childSource[leadingWhitespace] ?? '')
  ) {
    leadingWhitespace += 1;
  }
  const body = compilerStringTrim(childSource);
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

  return compilerRegExpTest(/\s/u, source[openingElement.getEnd() - 3] ?? '');
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

  const childLength = compilerArrayLength(node.children, 'JSX children');
  for (let index = 0; index < childLength; index += 1) {
    const child = compilerOwnDataValue(node.children, index, 'JSX children') as
      | ts.JsxChild
      | undefined;
    if (!child) throw new TypeError(`JSX children[${index}] must be own data.`);
    if (ts.isJsxText(child)) {
      if (!child.containsOnlyTriviaWhiteSpaces) childNonWhitespaceCount += 1;
      continue;
    }

    if (ts.isJsxExpression(child)) {
      if (child.expression) {
        childNonWhitespaceCount += 1;
        compilerArrayAppend(
          childExpressionContainers,
          {
            end: child.getEnd(),
            start: child.getStart(sourceFile),
          },
          'JSX child expression containers',
        );
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
  while (leadingStart > 0 && compilerRegExpTest(/\s/u, source[leadingStart - 1] ?? '')) {
    leadingStart -= 1;
  }
  return leadingStart;
}

function jsxAncestorTags(sourceFile: ts.SourceFile, node: ts.Node): string[] {
  const tags: string[] = [];
  let current = node.parent;

  while (current) {
    if (ts.isJsxElement(current)) {
      compilerArrayAppend(
        tags,
        current.openingElement.tagName.getText(sourceFile),
        'JSX ancestor tags',
      );
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
  if (callArgument(call, 0) === callback && ts.isPropertyAccessExpression(call.expression)) {
    // `.map` / `.flatMap` are structural array-iteration recognizers for JSX repeatability.
    return call.expression.name.text === 'map' || call.expression.name.text === 'flatMap';
  }

  if (callArgument(call, 1) !== callback || !ts.isPropertyAccessExpression(call.expression)) {
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
  frameworkFactory: CallExpressionModel['frameworkFactory'],
): CallExpressionModel {
  const argumentSources: string[] = [];
  const argumentArrowFunctionParts: (ArrowFunctionPartsModel | null)[] = [];
  const argumentObjectLiteralPaths: string[][] = [];
  const argumentPropertyAccesses: PropertyAccessPathModel[][] = [];
  const argumentSpans: SourceSpan[] = [];
  const argumentStringLiteralArrayValues: (string[] | null)[] = [];
  const argumentStaticValues: (StaticLiteralValue | undefined)[] = [];
  const argumentTemporalReads: TemporalReadModel[][] = [];
  const argumentLength = compilerArrayLength(node.arguments, 'Call expression arguments');
  for (let index = 0; index < argumentLength; index += 1) {
    const argument = compilerOwnDataValue(node.arguments, index, 'Call expression arguments') as
      | ts.Expression
      | undefined;
    if (!argument) throw new TypeError(`Call expression arguments[${index}] must be own data.`);
    compilerArrayAppend(
      argumentSources,
      compilerStringSlice(source, argument.getStart(sourceFile), argument.getEnd()),
      'Call argument sources',
    );
    compilerArrayAppend(
      argumentArrowFunctionParts,
      arrowFunctionPartsFromExpression(sourceFile, argument),
      'Call argument arrow-function facts',
    );
    compilerArrayAppend(
      argumentObjectLiteralPaths,
      ts.isObjectLiteralExpression(argument) ? objectLiteralPaths(argument) : [],
      'Call argument object-literal paths',
    );
    compilerArrayAppend(
      argumentPropertyAccesses,
      propertyAccessPathModels(sourceFile, argument),
      'Call argument property accesses',
    );
    compilerArrayAppend(
      argumentSpans,
      { end: argument.getEnd(), start: argument.getStart(sourceFile) },
      'Call argument spans',
    );
    compilerArrayAppend(
      argumentStringLiteralArrayValues,
      stringLiteralArrayValuesFromExpression(argument),
      'Call argument string arrays',
    );
    compilerArrayAppend(
      argumentStaticValues,
      staticLiteralValue(argument),
      'Call argument static values',
    );
    compilerArrayAppend(
      argumentTemporalReads,
      temporalReadModels(sourceFile, argument),
      'Call argument temporal reads',
    );
  }
  return {
    arguments: argumentSources,
    argumentArrowFunctionParts,
    argumentObjectLiteralPaths,
    argumentPropertyAccesses,
    argumentSpans,
    argumentStringLiteralArrayValues,
    argumentStaticValues,
    argumentTemporalReads,
    end: node.getEnd(),
    ...exportedConstInitializerName(node),
    ...(frameworkFactory === undefined ? {} : { frameworkFactory }),
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
  const staticValue = staticLiteralValue(expression);
  const localNames: string[] = [];
  appendUniqueStrings(localNames, localIdentifierNames(expression), 'JSX expression local names');
  appendUniqueStrings(localNames, enclosingLocalNames(node), 'JSX expression local names');
  return {
    ...(callName === undefined ? {} : { callName }),
    containerEnd: node.getEnd(),
    containerStart: node.getStart(sourceFile),
    end,
    expression: compilerStringTrim(compilerStringSlice(source, start, end)),
    localConstAliases: localConstAliasModels(sourceFile, source, expression, start),
    localNames,
    propertyAccesses: propertyAccessPathModels(sourceFile, expression),
    references: referenceIdentifiers(expression),
    ...(solePath ? { solePropertyAccessPath: solePath } : {}),
    start,
    ...(staticValue === undefined ? {} : { staticValue }),
    temporalReads: temporalReadModels(sourceFile, expression),
  };
}

function appendUniqueStrings(target: string[], values: readonly string[], label: string): void {
  const source = snapshotCompilerModelArray(values, label);
  for (let index = 0; index < source.length; index += 1) {
    if (!denseStringArrayIncludes(target, source[index]!, label)) {
      compilerArrayAppend(target, source[index]!, label);
    }
  }
}

function localConstAliasModels(
  sourceFile: ts.SourceFile,
  source: string,
  expression: ts.Expression,
  expressionStart: number,
): readonly LocalConstAliasModel[] {
  const references = compilerCreateSet<string>();
  const referenceNames = referenceIdentifiers(expression);
  for (let index = 0; index < referenceNames.length; index += 1) {
    compilerSetAdd(references, referenceNames[index]!);
  }
  if (referenceNames.length === 0) return [];

  const body = smallestFunctionBlockContaining(sourceFile, expressionStart);
  if (!body) return [];

  const aliases: LocalConstAliasModel[] = [];
  const seen = compilerCreateSet<string>();
  const visit = (node: ts.Node): void => {
    if (node.getStart(sourceFile) >= expressionStart) return;
    if (node !== body && isFunctionOrClassLike(node)) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text;
      if (compilerSetHas(references, name) && isConstVariableDeclaration(node)) {
        const accesses = propertyAccessPathModels(sourceFile, node.initializer);
        if (accesses.length > 0 && !compilerSetHas(seen, name)) {
          const start = node.initializer.getStart(sourceFile);
          const end = node.initializer.getEnd();
          compilerSetAdd(seen, name);
          compilerArrayAppend(
            aliases,
            {
              accesses,
              expression: compilerStringTrim(compilerStringSlice(source, start, end)),
              name,
              references: referenceIdentifiers(node.initializer),
              start: node.getStart(sourceFile),
            },
            'Local const aliases',
          );
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
  const text = compilerStringSlice(source, start, end);
  if (!compilerRegExpTest(/^\{\s*\/\*[\s\S]*\*\/\s*\}$/, text)) return null;

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
  const seen = compilerCreateSet<string>();
  const codes: string[] = [];
  const pattern = /KV\d{3}/g;
  while (true) {
    const match = compilerRegExpExec(pattern, commentText);
    if (!match) break;
    const code = compilerOwnDataValue(match, 0, 'Justified diagnostic match');
    if (typeof code !== 'string') {
      throw new TypeError('Justified diagnostic match must contain an own string.');
    }
    if (compilerSetHas(seen, code)) continue;
    compilerSetAdd(seen, code);
    compilerArrayAppend(codes, code, 'Justified diagnostic codes');
  }
  return codes;
}

function directlyFollowingJsxElementAttributeStart(
  sourceFile: ts.SourceFile,
  node: ts.JsxExpression,
): { attachedAttributeStart: number } | {} {
  const parent = node.parent;
  if (!ts.isJsxElement(parent)) return {};

  const childLength = compilerArrayLength(parent.children, 'JSX sibling children');
  let childIndex = -1;
  for (let index = 0; index < childLength; index += 1) {
    if (compilerOwnDataValue(parent.children, index, 'JSX sibling children') === node) {
      childIndex = index;
      break;
    }
  }
  if (childIndex === -1) return {};

  for (let index = childIndex + 1; index < childLength; index += 1) {
    const sibling = compilerOwnDataValue(parent.children, index, 'JSX sibling children') as
      | ts.JsxChild
      | undefined;
    if (!sibling) throw new TypeError(`JSX sibling children[${index}] must be own data.`);
    if (ts.isJsxText(sibling) && sibling.containsOnlyTriviaWhiteSpaces) continue;
    if (ts.isJsxElement(sibling) || ts.isJsxSelfClosingElement(sibling)) {
      const openingElement = ts.isJsxElement(sibling) ? sibling.openingElement : sibling;
      const attribute = compilerOwnDataValue(
        openingElement.attributes.properties,
        0,
        'Following JSX element attributes',
      ) as ts.JsxAttribute | ts.JsxSpreadAttribute | undefined;
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
    expression: compilerStringTrim(compilerStringSlice(source, expressionStart, expressionEnd)),
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
      compilerArrayAppend(
        facts,
        {
          condition: compilerStringTrim(compilerStringSlice(source, conditionStart, conditionEnd)),
          conditionEnd,
          conditionPropertyAccesses: propertyAccessPathModels(sourceFile, current.condition),
          conditionStart,
          end: current.getEnd(),
          start: current.getStart(sourceFile),
        },
        'Conditional expression facts',
      );
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
      compilerArrayAppend(
        reads,
        {
          end: current.getEnd(),
          kind: 'Date.now',
          start: current.getStart(sourceFile),
        },
        'Temporal read facts',
      );
    } else if (isZeroArgNewDate(sourceFile, current)) {
      compilerArrayAppend(
        reads,
        {
          end: current.getEnd(),
          kind: 'new Date',
          start: current.getStart(sourceFile),
        },
        'Temporal read facts',
      );
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
  const rawBodySource = compilerStringSlice(source, bodyStart, bodyEnd);
  const bodySource = compilerStringTrim(rawBodySource);
  let leadingWhitespace = 0;
  while (
    leadingWhitespace < rawBodySource.length &&
    compilerRegExpTest(/^\s$/u, rawBodySource[leadingWhitespace] ?? '')
  ) {
    leadingWhitespace += 1;
  }
  const bodySourceStart = bodyStart + leadingWhitespace;
  let callArguments: string[] | undefined;
  let callArgumentPropertyAccesses: PropertyAccessPathModel[][] | undefined;
  let callArgumentReferences: IdentifierReferenceModel[][] | undefined;
  let callArgumentStaticValues: (StaticLiteralValue | undefined)[] | undefined;
  let callArgumentKinds: ZeroArgArrowCallArgumentKind[] | undefined;
  if (!ts.isBlock(body) && ts.isCallExpression(body)) {
    callArguments = [];
    callArgumentPropertyAccesses = [];
    callArgumentReferences = [];
    callArgumentStaticValues = [];
    callArgumentKinds = [];
    const argumentLength = compilerArrayLength(body.arguments, 'Zero-arg arrow call arguments');
    for (let index = 0; index < argumentLength; index += 1) {
      const argument = compilerOwnDataValue(
        body.arguments,
        index,
        'Zero-arg arrow call arguments',
      ) as ts.Expression | undefined;
      if (!argument)
        throw new TypeError(`Zero-arg arrow call arguments[${index}] must be own data.`);
      compilerArrayAppend(
        callArguments,
        compilerStringSlice(source, argument.getStart(sourceFile), argument.getEnd()),
        'Zero-arg arrow call argument sources',
      );
      compilerArrayAppend(
        callArgumentPropertyAccesses,
        propertyAccessPathModels(sourceFile, argument),
        'Zero-arg arrow call property accesses',
      );
      compilerArrayAppend(
        callArgumentReferences,
        referenceIdentifierModels(sourceFile, argument),
        'Zero-arg arrow call references',
      );
      compilerArrayAppend(
        callArgumentStaticValues,
        staticLiteralValue(argument),
        'Zero-arg arrow call static values',
      );
      compilerArrayAppend(
        callArgumentKinds,
        zeroArgArrowCallArgumentKind(argument),
        'Zero-arg arrow call argument kinds',
      );
    }
  }

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
      compilerArrayAppend(names, child.name.text, 'Local declaration names');
    }

    ts.forEachChild(child, visit);
  };

  ts.forEachChild(node, visit);
  const unique: string[] = [];
  appendUniqueStrings(unique, names, 'Local declaration names');
  return unique;
}

function collectBindingNames(name: ts.BindingName, names: string[]): void {
  if (ts.isIdentifier(name)) {
    compilerArrayAppend(names, name.text, 'Binding names');
    return;
  }

  const elementLength = compilerArrayLength(name.elements, 'Binding elements');
  for (let index = 0; index < elementLength; index += 1) {
    const element = compilerOwnDataValue(name.elements, index, 'Binding elements') as
      | ts.ArrayBindingElement
      | undefined;
    if (element && ts.isBindingElement(element)) collectBindingNames(element.name, names);
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
  const references = referenceIdentifierModels(root.getSourceFile(), root);
  const result: string[] = [];
  for (let index = 0; index < references.length; index += 1) {
    compilerArrayAppend(result, references[index]!.name, 'Reference identifier names');
  }
  return result;
}

function referenceIdentifierModels(
  sourceFile: ts.SourceFile,
  root: ts.Node,
): IdentifierReferenceModel[] {
  const declared = compilerCreateSet<string>();
  const referenced: IdentifierReferenceModel[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      if (isDeclaredIdentifier(node)) compilerSetAdd(declared, node.text);
      if (isReferenceIdentifier(node)) {
        compilerArrayAppend(
          referenced,
          {
            end: node.getEnd(),
            name: node.text,
            start: node.getStart(sourceFile),
          },
          'Reference identifier models',
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(root);
  const result: IdentifierReferenceModel[] = [];
  for (let index = 0; index < referenced.length; index += 1) {
    const reference = referenced[index]!;
    if (!compilerSetHas(declared, reference.name)) {
      compilerArrayAppend(result, reference, 'Undeclared reference identifier models');
    }
  }
  return result;
}

function arrowObjectPatternKeys(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): RenderInputModel[] {
  if (!ts.isArrowFunction(expression)) return [];

  const firstParam = compilerOwnDataValue(expression.parameters, 0, 'Render parameters') as
    | ts.ParameterDeclaration
    | undefined;
  if (!firstParam || !ts.isObjectBindingPattern(firstParam.name)) return [];
  const result: RenderInputModel[] = [];
  const elementLength = compilerArrayLength(firstParam.name.elements, 'Render input elements');
  for (let index = 0; index < elementLength; index += 1) {
    const element = compilerOwnDataValue(
      firstParam.name.elements,
      index,
      'Render input elements',
    ) as ts.BindingElement | undefined;
    if (!element) throw new TypeError(`Render input elements[${index}] must be own data.`);
    if (!ts.isIdentifier(element.name)) continue;
    compilerArrayAppend(
      result,
      {
        end: element.name.getEnd(),
        name: element.name.text,
        start: element.name.getStart(sourceFile),
        ...bindingElementSourceKey(element),
      },
      'Render input models',
    );
  }
  return result;
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
    if (ts.isIdentifier(child) && isDeclaredIdentifier(child)) {
      compilerArrayAppend(names, child.text, 'Local identifier names');
    }
    ts.forEachChild(child, visit);
  };

  ts.forEachChild(node, visit);
  const unique: string[] = [];
  appendUniqueStrings(unique, names, 'Local identifier names');
  return unique;
}

function enclosingLocalNames(node: ts.Node): string[] {
  const names: string[] = [];
  let current: ts.Node | undefined = node.parent;

  while (current !== undefined) {
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      !isRenderPropertyInitializer(current)
    ) {
      const parameterLength = compilerArrayLength(current.parameters, 'Enclosing parameters');
      for (let index = 0; index < parameterLength; index += 1) {
        const param = compilerOwnDataValue(current.parameters, index, 'Enclosing parameters') as
          | ts.ParameterDeclaration
          | undefined;
        if (!param) throw new TypeError(`Enclosing parameters[${index}] must be own data.`);
        collectBindingNames(param.name, names);
      }
    }

    current = current.parent;
  }

  const unique: string[] = [];
  appendUniqueStrings(unique, names, 'Enclosing local names');
  return unique;
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

  const thirdParam = compilerOwnDataValue(expression.parameters, 2, 'Render parameters') as
    | ts.ParameterDeclaration
    | undefined;
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

  const thirdParam = compilerOwnDataValue(expression.parameters, 2, 'Render parameters') as
    | ts.ParameterDeclaration
    | undefined;
  if (!thirdParam) return {};

  const names: string[] = [];
  if (ts.isObjectBindingPattern(thirdParam.name)) {
    const elementLength = compilerArrayLength(thirdParam.name.elements, 'Render slot elements');
    for (let index = 0; index < elementLength; index += 1) {
      const element = compilerOwnDataValue(
        thirdParam.name.elements,
        index,
        'Render slot elements',
      ) as ts.BindingElement | undefined;
      if (!element) throw new TypeError(`Render slot elements[${index}] must be own data.`);
      if (ts.isIdentifier(element.name)) {
        compilerArrayAppend(names, element.name.text, 'Render slot names');
      }
    }
  } else if (ts.isIdentifier(thirdParam.name)) {
    compilerArrayAppend(names, thirdParam.name.text, 'Render slot names');
  }

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
    const statementLength = compilerArrayLength(body.statements, 'Render body statements');
    for (let index = 0; index < statementLength; index += 1) {
      const statement = compilerOwnDataValue(body.statements, index, 'Render body statements') as
        | ts.Statement
        | undefined;
      if (!statement) throw new TypeError(`Render body statements[${index}] must be own data.`);
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
  const value = compilerCreateNullRecord<StaticLiteralValue>();
  const propertyLength = compilerArrayLength(
    expression.properties,
    'Static object-literal properties',
  );
  for (let index = 0; index < propertyLength; index += 1) {
    const property = compilerOwnDataValue(
      expression.properties,
      index,
      'Static object-literal properties',
    ) as ts.ObjectLiteralElementLike | undefined;
    if (!property) {
      throw new TypeError(`Static object-literal properties[${index}] must be own data.`);
    }
    if (!ts.isPropertyAssignment(property)) return undefined;

    const key = propertyNameText(property.name);
    if (!key) return undefined;

    const literal = staticLiteralValue(property.initializer);
    if (literal === undefined) return undefined;
    compilerSetOwnDataProperty(value, key, literal);
  }

  return value;
}

function staticLiteralValue(expression: ts.Expression): StaticLiteralValue | undefined {
  const unwrapped = unwrapExpression(expression);

  if (ts.isStringLiteralLike(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
    return unwrapped.text;
  }

  if (ts.isNumericLiteral(unwrapped)) return compilerNumberValue(unwrapped.text);
  if (
    ts.isPrefixUnaryExpression(unwrapped) &&
    unwrapped.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(unwrapped.operand)
  ) {
    return -compilerNumberValue(unwrapped.operand.text);
  }

  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (unwrapped.kind === ts.SyntaxKind.NullKeyword) return null;

  if (ts.isArrayLiteralExpression(unwrapped)) {
    const values: StaticLiteralValue[] = [];
    const elementLength = compilerArrayLength(unwrapped.elements, 'Static array elements');
    for (let index = 0; index < elementLength; index += 1) {
      const element = compilerOwnDataValue(unwrapped.elements, index, 'Static array elements') as
        | ts.Expression
        | ts.SpreadElement
        | ts.OmittedExpression
        | undefined;
      if (!element) throw new TypeError(`Static array elements[${index}] must be own data.`);
      if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) return undefined;
      const value = staticLiteralValue(element);
      if (value === undefined) return undefined;
      compilerArrayAppend(values, value, 'Static array values');
    }
    return values;
  }

  return ts.isObjectLiteralExpression(unwrapped) ? staticObjectLiteralValue(unwrapped) : undefined;
}
