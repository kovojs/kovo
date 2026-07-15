import * as ts from 'typescript';

import {
  canonicalFrameworkExportForExpression,
  expressionResolvesToFrameworkExport,
  frameworkExport,
  type FrameworkExportIdentity,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';
import { securityClassifier } from '@kovojs/core/internal/security-markers';

import {
  reviewedCanonicalClientHandlerImportTarget,
  reviewedClientHandlerImportTarget,
  type ClientHandlerImportKind,
} from '../client-handler-import-policy.js';
import type { CompilerDiagnostic, DiagnosticFactory } from '../diagnostics.js';
import {
  compilerArrayAppend,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateSet,
  compilerFailClosed,
  compilerFreeze,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerSetAdd,
  compilerSetHas,
} from '../compiler-security-intrinsics.js';
import {
  identifierIsShadowedBeforeScope,
  jsxElements,
  type ComponentModuleModel,
} from '../scan/parse.js';
import type { JsxElementModel } from '../scan/model.js';
import type { ClientImportDependencyProvenance, PublishToClientFact } from '../types.js';
import { isCompilerAuditText } from '../security/audit-text.js';

/**
 * SPEC §6.6/§6.2 + secure-framework Phase 4 / Tier 0 item 3: gate the named-import
 * handler-closure secret-emit channel.
 *
 * The probe-confirmed live hole: a client handler such as `() => sendPayment(STRIPE_SECRET_KEY)`
 * captures a cross-module import; lowering re-emits `import { STRIPE_SECRET_KEY } from "…"` verbatim
 * into the `*.client.js` module, so the bundler resolves and INLINES the evaluated secret into the
 * browser bundle. KV435 covers only the query wire, not this channel.
 *
 * The gate is **whole-channel and fail-closed by construction**, not a narrow `process.env`/`Secret`
 * brand check. The compiler has no CallExpression provenance (a call-wrapped secret —
 * `publishKey(loadSecret())` — escapes a brand check), so we cannot soundly decide "this binding is
 * a secret". Instead we refuse to ship the EVALUATED VALUE of ANY captured cross-module import into
 * the client unless it is provably client-safe:
 *
 *   - **exact reviewed executable identity** — a finite compiler registry, optionally reached
 *     through compiler-proven local re-exports, identifies the callable and its browser ABI.
 *   - **publishToClient(value, { reason })** — an audited escape only for a compiler-proven,
 *     pristine same-file `const` primitive. Lowering snapshots the literal source; it never emits
 *     an imported module merely because one of its exports was wrapped. The site+reason are
 *     recorded for `kovo explain --capabilities`.
 *
 * Every other value-position capture (call argument, bare operand, member object, spread, …) is a
 * potential serialized-secret channel and is refused: KV437 at the capture site, and the import
 * specifier is withheld from the emitted `*.client.js` (the by-construction half lives in
 * lower/handlers.ts, which consumes {@link emitAllowedImportLocalNames}).
 *
 * Callee position alone never establishes trust: arbitrary relative modules, bare packages, Node
 * builtins, loader forms, and aliases are refused and their whole handler artifact is omitted.
 */

const PUBLISH_TO_CLIENT_IDENTITY = frameworkExport('@kovojs/core', 'publishToClient');
const PUBLISH_TO_CLIENT_REASON_PROPERTY = 'reason';
const COMMONJS_REQUIRE_IDENTIFIER = 'require';
const IMPORT_META_IDENTIFIER = 'meta';

interface ImportBinding {
  source: 'import';
  /** Local name the handler closure can reference. */
  localName: string;
  /** Named / default / namespace — covers all laundering forms the threat model lists. */
  kind: ClientHandlerImportKind | 'local-alias';
  importedName: string;
  /** Surface module specifier (followed only as a label; the binding itself is the resolved fact). */
  moduleSpecifier: string;
}

interface ModuleConstantBinding {
  source: 'module-constant';
  /** Local name the handler closure can reference. */
  localName: string;
  /** Compiler proof that lowering can snapshot this binding as inert primitive data. */
  publishablePrimitive: boolean;
}

type CaptureBinding = ImportBinding | ModuleConstantBinding;

interface CaptureUse {
  /** Start of the JSX attribute that owns the generated handler. */
  attributeStart: number;
  binding: CaptureBinding;
  /** True when the import is the callee of a call expression (position only; never provenance). */
  callee: boolean;
  /** True when this value-position use is the first arg of a recognized publishToClient(...) call. */
  published: boolean;
  publishReason?: string;
  reviewedIdentity?: FrameworkExportIdentity;
  start: number;
  length: number;
}

interface UnsafeCaptureUse extends CaptureUse {
  reason: 'client-import-policy' | 'client-value-capture' | 'module-constant-capture';
}

interface HandlerExecutionPolicyUse {
  /** Start of the JSX attribute whose handler must be omitted wholesale. */
  attributeStart: number;
  length: number;
  reason: 'dynamic-code';
  start: number;
}

export interface ClientCaptureAnalysis {
  /** Un-wrapped value-position captures: each is a KV437 site. */
  unsafeUses: readonly UnsafeCaptureUse[];
  /** Audited publishToClient escapes recorded for the capabilities ledger. */
  publishFacts: readonly PublishToClientFact[];
  /** Import local names whose every value-position use is callee-only or published → safe to emit. */
  emitAllowed: ReadonlySet<string>;
  /** Immutable compiler proof carried to the final client import sink. */
  emitImportProvenance: ReadonlyMap<string, ClientImportDependencyProvenance>;
  /** Same-file module constants whose every value-position use is publishToClient-wrapped. */
  emitAllowedModuleConstants: ReadonlySet<string>;
  /** Handler attributes omitted wholesale because one of their captures is closed. */
  blockedHandlerAttributeStarts: ReadonlySet<number>;
  /** Executable uses that violate the value-only or dynamic-code handler grammar. */
  executionPolicyUses: readonly HandlerExecutionPolicyUse[];
}

/**
 * Collect every import binding the module declares, in all three forms the laundering threat model
 * names. We follow the RESOLVED binding (the local name a handler can capture), not the surface
 * specifier, so a barrel/re-export cannot bypass the gate: re-exporting a secret through `index.ts`
 * still produces a captured local binding here.
 */
function importBindings(sourceFile: ts.SourceFile): ImportBinding[] {
  const bindings: ImportBinding[] = [];

  const statementLength = compilerArrayLength(sourceFile.statements, 'Client-capture statements');
  for (let statementIndex = 0; statementIndex < statementLength; statementIndex += 1) {
    const statement = compilerOwnDataValue(
      sourceFile.statements,
      statementIndex,
      'Client-capture statements',
    ) as ts.Statement | undefined;
    if (!statement)
      throw new TypeError(`Client-capture statements[${statementIndex}] must be dense.`);
    if (ts.isImportEqualsDeclaration(statement)) {
      const expression = ts.isExternalModuleReference(statement.moduleReference)
        ? statement.moduleReference.expression
        : undefined;
      appendImportBinding(bindings, {
        importedName: '*',
        kind: statement.isTypeOnly ? 'type-only' : 'import-equals',
        localName: statement.name.text,
        moduleSpecifier:
          expression && ts.isStringLiteralLike(expression) ? expression.text : '<import-equals>',
        source: 'import',
      });
      continue;
    }
    if (!ts.isImportDeclaration(statement)) {
      appendCommonJsBindings(bindings, statement);
      continue;
    }
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const moduleSpecifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause) continue;
    const clauseKind: ClientHandlerImportKind | undefined = clause.isTypeOnly
      ? 'type-only'
      : undefined;

    if (clause.name) {
      appendImportBinding(bindings, {
        importedName: 'default',
        kind: clauseKind ?? 'default',
        localName: clause.name.text,
        moduleSpecifier,
        source: 'import',
      });
    }

    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) {
      appendImportBinding(bindings, {
        importedName: '*',
        kind: clauseKind ?? 'namespace',
        localName: named.name.text,
        moduleSpecifier,
        source: 'import',
      });
    } else if (named && ts.isNamedImports(named)) {
      const elementLength = compilerArrayLength(named.elements, 'Client-capture named imports');
      for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
        const element = compilerOwnDataValue(
          named.elements,
          elementIndex,
          'Client-capture named imports',
        ) as ts.ImportSpecifier | undefined;
        if (!element) {
          throw new TypeError(`Client-capture named imports[${elementIndex}] must be dense.`);
        }
        appendImportBinding(bindings, {
          importedName: element.propertyName?.text ?? element.name.text,
          kind: clauseKind ?? (element.isTypeOnly ? 'type-only' : 'named'),
          localName: element.name.text,
          moduleSpecifier,
          source: 'import',
        });
      }
    }
  }

  return bindings;
}

function appendImportBinding(bindings: ImportBinding[], binding: ImportBinding): void {
  compilerArrayAppend(bindings, binding, 'Client-capture import bindings');
}

function appendCommonJsBindings(bindings: ImportBinding[], statement: ts.Statement): void {
  if (!ts.isVariableStatement(statement)) return;
  const declarationLength = compilerArrayLength(
    statement.declarationList.declarations,
    'Client-capture CommonJS declarations',
  );
  for (let declarationIndex = 0; declarationIndex < declarationLength; declarationIndex += 1) {
    const declaration = compilerOwnDataValue(
      statement.declarationList.declarations,
      declarationIndex,
      'Client-capture CommonJS declarations',
    ) as ts.VariableDeclaration | undefined;
    if (!declaration?.initializer) continue;
    const required = commonJsRequirement(declaration.initializer);
    if (!required) continue;
    if (ts.isIdentifier(declaration.name)) {
      appendImportBinding(bindings, {
        importedName: required.importedName,
        kind: 'commonjs',
        localName: declaration.name.text,
        moduleSpecifier: required.moduleSpecifier,
        source: 'import',
      });
      continue;
    }
    if (!ts.isObjectBindingPattern(declaration.name)) continue;
    const elementLength = compilerArrayLength(
      declaration.name.elements,
      'Client-capture CommonJS binding elements',
    );
    for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
      const element = compilerOwnDataValue(
        declaration.name.elements,
        elementIndex,
        'Client-capture CommonJS binding elements',
      ) as ts.BindingElement | undefined;
      if (!element || !ts.isIdentifier(element.name)) continue;
      appendImportBinding(bindings, {
        importedName:
          element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : element.name.text,
        kind: 'commonjs',
        localName: element.name.text,
        moduleSpecifier: required.moduleSpecifier,
        source: 'import',
      });
    }
  }
}

function commonJsRequirement(
  expression: ts.Expression,
): { importedName: string; moduleSpecifier: string } | undefined {
  let current = unwrapClientCaptureExpression(expression);
  let importedName = '*';
  if (ts.isPropertyAccessExpression(current)) {
    importedName = current.name.text;
    current = unwrapClientCaptureExpression(current.expression);
  }
  if (
    !ts.isCallExpression(current) ||
    !ts.isIdentifier(current.expression) ||
    clientCaptureIdentifierName(current.expression) !== COMMONJS_REQUIRE_IDENTIFIER
  ) {
    return undefined;
  }
  const argument = current.arguments[0];
  return {
    importedName,
    moduleSpecifier: argument && ts.isStringLiteralLike(argument) ? argument.text : '<dynamic>',
  };
}

function unwrapClientCaptureExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Parser-owned semantic identifier fact; post-parse policy never compares raw source slices. */
function clientCaptureIdentifierName(identifier: ts.Identifier): string {
  return ts.idText(identifier);
}

function moduleConstantBindings(model: ComponentModuleModel): ModuleConstantBinding[] {
  const bindingCounts = compilerCreateMap<string, number>();
  const declarations = compilerCreateMap<string, ts.VariableDeclaration>();
  const variableNames: string[] = [];
  const seenVariables = compilerCreateSet<string>();
  const recordBinding = (name: string, declaration?: ts.VariableDeclaration): void => {
    compilerMapSet(bindingCounts, name, (compilerMapGet(bindingCounts, name) ?? 0) + 1);
    if (!declaration) return;
    compilerMapSet(declarations, name, declaration);
    if (compilerSetHas(seenVariables, name)) return;
    compilerSetAdd(seenVariables, name);
    compilerArrayAppend(variableNames, name, 'Module-scope variable names');
  };

  const statements = model.sourceFile.statements;
  const length = compilerArrayLength(statements, 'Module-scope capture statements');
  for (let index = 0; index < length; index += 1) {
    const statement = compilerOwnDataValue(statements, index, 'Module-scope capture statements') as
      | ts.Statement
      | undefined;
    if (!statement) {
      compilerFailClosed(`Module-scope capture statements[${index}] must be own data.`);
    }
    if (ts.isVariableStatement(statement)) {
      const declarationLength = compilerArrayLength(
        statement.declarationList.declarations,
        'Module-scope capture declarations',
      );
      for (let declarationIndex = 0; declarationIndex < declarationLength; declarationIndex += 1) {
        const declaration = compilerOwnDataValue(
          statement.declarationList.declarations,
          declarationIndex,
          'Module-scope capture declarations',
        ) as ts.VariableDeclaration | undefined;
        if (declaration) {
          markBindingName(declaration.name, (name) => recordBinding(name, declaration));
        }
      }
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      recordBinding(statement.name.text);
      continue;
    }
    if (ts.isImportEqualsDeclaration(statement)) {
      if (!statement.isTypeOnly) recordBinding(statement.name.text);
      continue;
    }
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const clause = statement.importClause;
    if (clause.isTypeOnly) continue;
    if (clause.name) recordBinding(clause.name.text);
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) {
      recordBinding(named.name.text);
    } else if (named && ts.isNamedImports(named)) {
      const elementLength = compilerArrayLength(
        named.elements,
        'Published primitive import elements',
      );
      for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
        const element = compilerOwnDataValue(
          named.elements,
          elementIndex,
          'Published primitive import elements',
        ) as ts.ImportSpecifier | undefined;
        if (element && !element.isTypeOnly) recordBinding(element.name.text);
      }
    }
  }

  const bindings: ModuleConstantBinding[] = [];
  for (let index = 0; index < variableNames.length; index += 1) {
    const name = variableNames[index]!;
    const declaration = compilerMapGet(declarations, name);
    const declarationList = declaration?.parent;
    const publishablePrimitive =
      compilerMapGet(bindingCounts, name) === 1 &&
      !!declaration?.initializer &&
      ts.isIdentifier(declaration.name) &&
      !!declarationList &&
      ts.isVariableDeclarationList(declarationList) &&
      (declarationList.flags & ts.NodeFlags.Const) !== 0 &&
      expressionIsStaticPublishablePrimitive(declaration.initializer);
    compilerArrayAppend(
      bindings,
      { localName: name, publishablePrimitive, source: 'module-constant' },
      'Client-capture module-constant bindings',
    );
  }
  return bindings;
}

function markBindingName(name: ts.BindingName, mark: (name: string) => void): void {
  if (ts.isIdentifier(name)) {
    mark(name.text);
    return;
  }
  const length = compilerArrayLength(name.elements, 'Published primitive binding elements');
  for (let index = 0; index < length; index += 1) {
    const element = compilerOwnDataValue(
      name.elements,
      index,
      'Published primitive binding elements',
    ) as ts.ArrayBindingElement | undefined;
    if (element && ts.isBindingElement(element)) markBindingName(element.name, mark);
  }
}

function expressionIsStaticPublishablePrimitive(expression: ts.Expression): boolean {
  const node = unwrapClientCaptureExpression(expression);
  return (
    ts.isStringLiteralLike(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(node.operand))
  );
}

interface HandlerCaptureRoot {
  attributeStart: number;
  directCallable: boolean;
  root: ts.Node;
  scopeBoundary: ts.Node;
}

/** Every parser-proven host/reviewed-UI event expression that lowering can emit. */
function handlerCaptureRoots(model: ComponentModuleModel): HandlerCaptureRoot[] {
  const sourceFile = model.sourceFile;
  const handlerAttributeStarts = compilerCreateSet<number>();
  const elements = jsxElements(model);
  const elementLength = compilerArrayLength(elements, 'Client-capture JSX elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(elements, elementIndex, 'Client-capture JSX elements') as
      | JsxElementModel
      | undefined;
    if (!element)
      throw new TypeError(`Client-capture JSX elements[${elementIndex}] must be dense.`);
    const attributeLength = compilerArrayLength(
      element.attributes,
      'Client-capture JSX attributes',
    );
    for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
      const attribute = compilerOwnDataValue(
        element.attributes,
        attributeIndex,
        'Client-capture JSX attributes',
      ) as JsxElementModel['attributes'][number] | undefined;
      if (
        attribute?.domEventName !== undefined &&
        attribute.expression !== undefined &&
        attribute.componentEventProp !== true
      ) {
        compilerSetAdd(handlerAttributeStarts, attribute.start);
      }
    }
  }

  const roots: HandlerCaptureRoot[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      compilerSetHas(handlerAttributeStarts, node.getStart(sourceFile)) &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression
    ) {
      const expression = node.initializer.expression;
      compilerArrayAppend(
        roots,
        {
          attributeStart: node.getStart(sourceFile),
          directCallable: !ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression),
          root:
            ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)
              ? expression.body
              : expression,
          scopeBoundary: node,
        },
        'Client-capture handler roots',
      );
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return roots;
}

const DYNAMIC_CODE_PROPERTIES = compilerCreateSet<string>();
compilerSetAdd(DYNAMIC_CODE_PROPERTIES, '__proto__');
compilerSetAdd(DYNAMIC_CODE_PROPERTIES, 'constructor');
compilerSetAdd(DYNAMIC_CODE_PROPERTIES, 'prototype');

const DYNAMIC_CODE_REFLECTION_METHODS = compilerCreateSet<string>();
compilerSetAdd(DYNAMIC_CODE_REFLECTION_METHODS, 'defineProperties');
compilerSetAdd(DYNAMIC_CODE_REFLECTION_METHODS, 'defineProperty');
compilerSetAdd(DYNAMIC_CODE_REFLECTION_METHODS, 'getOwnPropertyDescriptor');
compilerSetAdd(DYNAMIC_CODE_REFLECTION_METHODS, 'getOwnPropertyDescriptors');
compilerSetAdd(DYNAMIC_CODE_REFLECTION_METHODS, 'getPrototypeOf');
compilerSetAdd(DYNAMIC_CODE_REFLECTION_METHODS, 'setPrototypeOf');

const DYNAMIC_CODE_GLOBAL_IDENTIFIERS = compilerCreateSet<string>();
compilerSetAdd(DYNAMIC_CODE_GLOBAL_IDENTIFIERS, 'eval');
compilerSetAdd(DYNAMIC_CODE_GLOBAL_IDENTIFIERS, 'Function');

const GLOBAL_OBJECT_IDENTIFIERS = compilerCreateSet<string>();
compilerSetAdd(GLOBAL_OBJECT_IDENTIFIERS, 'globalThis');
compilerSetAdd(GLOBAL_OBJECT_IDENTIFIERS, 'self');
compilerSetAdd(GLOBAL_OBJECT_IDENTIFIERS, 'window');

const MAX_HANDLER_EXECUTION_POLICY_NODES = 100_000;

/**
 * Close dynamic-code carriers before handler emission.
 *
 * SPEC §4.3/§5.2: only the finite reviewed executable registry grants authored client authority.
 * Constructor/prototype reflection, eval/Function, and string-capable timers escape that registry,
 * so the entire handler is omitted. Published values need no second taint grammar: the capture gate
 * permits only pristine same-file primitive constants and emits their literal source, never an
 * imported module binding.
 */
function handlerExecutionPolicyUses(root: HandlerCaptureRoot): HandlerExecutionPolicyUse[] {
  const uses: HandlerExecutionPolicyUse[] = [];
  let nodeCount = 0;
  let foundDynamicCode = false;

  const visit = (node: ts.Node): void => {
    nodeCount += 1;
    if (nodeCount > MAX_HANDLER_EXECUTION_POLICY_NODES) {
      compilerFailClosed(
        `Client-handler execution policy exceeds the ${MAX_HANDLER_EXECUTION_POLICY_NODES}-node bound.`,
      );
    }
    if (nodeUsesDynamicCode(node, root.scopeBoundary)) {
      foundDynamicCode = true;
      compilerArrayAppend(
        uses,
        {
          attributeStart: root.attributeStart,
          length: node.getEnd() - node.getStart(),
          reason: 'dynamic-code',
          start: node.getStart(),
        },
        'Client-handler execution policy uses',
      );
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root.root);
  return foundDynamicCode ? uses : [];
}

function nodeUsesDynamicCode(node: ts.Node, scopeBoundary: ts.Node): boolean {
  if (ts.isIdentifier(node) && isValueReferenceIdentifier(node)) {
    if (
      handlerIdentifierIsUnshadowedGlobal(node, 'eval', scopeBoundary) ||
      handlerIdentifierIsUnshadowedGlobal(node, 'Function', scopeBoundary)
    ) {
      return true;
    }
    if (
      handlerIdentifierIsUnshadowedGlobal(node, 'setTimeout', scopeBoundary) ||
      handlerIdentifierIsUnshadowedGlobal(node, 'setInterval', scopeBoundary)
    ) {
      const call = handlerOwningDirectCall(node);
      return !call || handlerTimerCallCanExecuteCode(call);
    }
    if (
      handlerIdentifierNamesGlobalObject(node) &&
      !identifierIsShadowedBeforeScope(node, undefined, scopeBoundary)
    ) {
      const parent = node.parent;
      if (
        (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
        parent.expression === node
      ) {
        return false;
      }
      return true;
    }
  }
  if (ts.isPropertyAccessExpression(node)) {
    if (compilerSetHas(DYNAMIC_CODE_PROPERTIES, node.name.text)) return true;
    const globalMember = handlerGlobalMemberName(node.expression, node.name.text, scopeBoundary);
    if (globalMember === 'eval' || globalMember === 'Function') return true;
    if (globalMember === 'setTimeout' || globalMember === 'setInterval') {
      const call = handlerOwningDirectCall(node);
      return !call || handlerTimerCallCanExecuteCode(call);
    }
    return false;
  }
  if (ts.isElementAccessExpression(node)) {
    const name = node.argumentExpression ? staticHandlerString(node.argumentExpression) : undefined;
    if (name !== undefined && compilerSetHas(DYNAMIC_CODE_PROPERTIES, name)) return true;
    const globalMember = handlerGlobalMemberName(
      node.expression,
      name ?? '<computed>',
      scopeBoundary,
    );
    if (globalMember === undefined) return false;
    if (name === undefined) return true;
    if (globalMember === 'eval' || globalMember === 'Function') return true;
    if (globalMember === 'setTimeout' || globalMember === 'setInterval') {
      const call = handlerOwningDirectCall(node);
      return !call || handlerTimerCallCanExecuteCode(call);
    }
    return false;
  }
  if (ts.isBindingElement(node)) {
    const name = node.propertyName
      ? handlerPropertyName(node.propertyName)
      : ts.isIdentifier(node.name)
        ? node.name.text
        : undefined;
    return name !== undefined && compilerSetHas(DYNAMIC_CODE_PROPERTIES, name);
  }
  if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return false;

  const callee = unwrapClientCaptureExpression(node.expression);
  if (handlerDynamicCodeCallee(callee, scopeBoundary)) return true;
  if (ts.isCallExpression(node) && handlerTimerCalleeName(callee, scopeBoundary) !== undefined) {
    return handlerTimerCallCanExecuteCode(node);
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(callee)) {
    if (compilerSetHas(DYNAMIC_CODE_REFLECTION_METHODS, callee.name.text)) return true;
  }
  if (
    ts.isCallExpression(node) &&
    ts.isElementAccessExpression(callee) &&
    callee.argumentExpression
  ) {
    const name = staticHandlerString(callee.argumentExpression);
    if (name !== undefined && compilerSetHas(DYNAMIC_CODE_REFLECTION_METHODS, name)) return true;
  }
  return false;
}

function handlerDynamicCodeCallee(callee: ts.Expression, scopeBoundary: ts.Node): boolean {
  if (ts.isIdentifier(callee)) {
    return (
      handlerIdentifierIsUnshadowedGlobal(callee, 'eval', scopeBoundary) ||
      handlerIdentifierIsUnshadowedGlobal(callee, 'Function', scopeBoundary)
    );
  }
  if (ts.isPropertyAccessExpression(callee)) {
    const member = clientCaptureIdentifierName(callee.name);
    return (
      compilerSetHas(DYNAMIC_CODE_GLOBAL_IDENTIFIERS, member) &&
      handlerGlobalMemberName(callee.expression, member, scopeBoundary) !== undefined
    );
  }
  if (ts.isElementAccessExpression(callee) && callee.argumentExpression) {
    const name = staticHandlerString(callee.argumentExpression);
    return (
      (name === 'eval' || name === 'Function') &&
      handlerGlobalMemberName(callee.expression, name, scopeBoundary) !== undefined
    );
  }
  return false;
}

function handlerGlobalMemberName(
  receiver: ts.Expression,
  name: string,
  scopeBoundary: ts.Node,
): string | undefined {
  let object = unwrapClientCaptureExpression(receiver);
  while (ts.isPropertyAccessExpression(object) || ts.isElementAccessExpression(object)) {
    object = unwrapClientCaptureExpression(object.expression);
  }
  if (!ts.isIdentifier(object)) return undefined;
  return handlerIdentifierNamesGlobalObject(object) &&
    !identifierIsShadowedBeforeScope(object, undefined, scopeBoundary)
    ? name
    : undefined;
}

function handlerTimerCalleeName(
  callee: ts.Expression,
  scopeBoundary: ts.Node,
): 'setInterval' | 'setTimeout' | undefined {
  if (ts.isIdentifier(callee)) {
    if (handlerIdentifierIsUnshadowedGlobal(callee, 'setInterval', scopeBoundary)) {
      return 'setInterval';
    }
    return handlerIdentifierIsUnshadowedGlobal(callee, 'setTimeout', scopeBoundary)
      ? 'setTimeout'
      : undefined;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    const name = callee.name.text;
    return (name === 'setInterval' || name === 'setTimeout') &&
      handlerGlobalMemberName(callee.expression, name, scopeBoundary) !== undefined
      ? name
      : undefined;
  }
  if (ts.isElementAccessExpression(callee) && callee.argumentExpression) {
    const name = staticHandlerString(callee.argumentExpression);
    return (name === 'setInterval' || name === 'setTimeout') &&
      handlerGlobalMemberName(callee.expression, name, scopeBoundary) !== undefined
      ? name
      : undefined;
  }
  return undefined;
}

function handlerTimerCallCanExecuteCode(call: ts.CallExpression): boolean {
  const callback = call.arguments[0];
  return !callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback));
}

function handlerOwningDirectCall(callee: ts.Expression): ts.CallExpression | undefined {
  let current: ts.Expression = callee;
  let parent = current.parent;
  while (
    parent &&
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isTypeAssertionExpression(parent))
  ) {
    current = parent;
    parent = current.parent;
  }
  return parent && ts.isCallExpression(parent) && parent.expression === current
    ? parent
    : undefined;
}

function handlerIdentifierNamesGlobalObject(identifier: ts.Identifier): boolean {
  return compilerSetHas(GLOBAL_OBJECT_IDENTIFIERS, clientCaptureIdentifierName(identifier));
}

function handlerIdentifierIsUnshadowedGlobal(
  identifier: ts.Identifier,
  name: string,
  scopeBoundary: ts.Node,
): boolean {
  return (
    identifier.text === name &&
    !identifierIsShadowedBeforeScope(identifier, undefined, scopeBoundary)
  );
}

function handlerPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return ts.isComputedPropertyName(name) ? staticHandlerString(name.expression) : undefined;
}

function staticHandlerString(expression: ts.Expression): string | undefined {
  const node = unwrapClientCaptureExpression(expression);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticHandlerString(node.left);
    const right = staticHandlerString(node.right);
    return left === undefined || right === undefined ? undefined : `${left}${right}`;
  }
  return undefined;
}

/**
 * Classify, within one handler body, every captured-import identifier as callee-position (safe),
 * publishToClient-wrapped (audited escape), or an un-wrapped value-position use (the leak).
 */
function classifyCaptures(
  captureRoot: HandlerCaptureRoot,
  bindingByName: ReadonlyMap<string, CaptureBinding>,
  fileName: string,
  uses: CaptureUse[],
  publishFacts: PublishToClientFact[],
): void {
  const { attributeStart, directCallable, root, scopeBoundary } = captureRoot;

  const visit = (node: ts.Node): void => {
    const loaderBinding = moduleLoaderBinding(node);
    if (loaderBinding) {
      compilerArrayAppend(
        uses,
        {
          attributeStart,
          binding: loaderBinding,
          callee: true,
          length: node.getEnd() - node.getStart(),
          published: false,
          start: node.getStart(),
        },
        'Client-capture uses',
      );
    }
    if (ts.isIdentifier(node) && isValueReferenceIdentifier(node)) {
      const binding = compilerMapGet(bindingByName as Map<string, CaptureBinding>, node.text);
      if (binding && !identifierIsShadowedBeforeScope(node, undefined, scopeBoundary)) {
        const parent = node.parent;
        const callee =
          isDirectCalleeReferenceIdentifier(node) ||
          (directCallable && isDirectHandlerCallableReference(node, root));
        const publishReason = isPublishToClientArgument(node, parent)
          ? publishToClientReason(parent as ts.CallExpression)
          : null;
        // SPEC §6.6: the exact recorded reason must remain unambiguous in source,
        // `kovo explain`, CI logs, and review tooling.
        const published = publishReason !== null && isCompilerAuditText(publishReason);
        const canonicalIdentity =
          binding.source === 'import' && binding.kind === 'named'
            ? canonicalFrameworkExportForExpression(
                ts as FrameworkIdentityTypeScript,
                node.getSourceFile(),
                node,
              )
            : undefined;
        const reviewedIdentity =
          canonicalIdentity &&
          reviewedCanonicalClientHandlerImportTarget(
            canonicalIdentity.module,
            canonicalIdentity.exportName,
          ) !== undefined
            ? canonicalIdentity
            : undefined;
        if (published && binding.source === 'module-constant' && binding.publishablePrimitive) {
          compilerArrayAppend(
            publishFacts,
            {
              fileName,
              localName: binding.localName,
              moduleSpecifier: `${fileName}#module-scope`,
              reason: publishReason,
              site: sourceSite(fileName, root.getSourceFile(), node.getStart()),
              start: node.getStart(),
            },
            'Client-capture publish facts',
          );
        }
        compilerArrayAppend(
          uses,
          {
            attributeStart,
            binding,
            callee,
            length: node.getEnd() - node.getStart(),
            published,
            ...(published && publishReason !== null ? { publishReason } : {}),
            ...(reviewedIdentity ? { reviewedIdentity } : {}),
            start: node.getStart(),
          },
          'Client-capture uses',
        );
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(root);
}

function moduleLoaderBinding(node: ts.Node): ImportBinding | undefined {
  if (
    ts.isMetaProperty(node) &&
    node.keywordToken === ts.SyntaxKind.ImportKeyword &&
    clientCaptureIdentifierName(node.name) === IMPORT_META_IDENTIFIER
  ) {
    return {
      importedName: 'meta',
      kind: 'dynamic',
      localName: 'import.meta',
      moduleSpecifier: '<import.meta>',
      source: 'import',
    };
  }
  if (!ts.isCallExpression(node)) return undefined;
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const argument = node.arguments[0];
    return {
      importedName: '*',
      kind: 'dynamic',
      localName: 'import()',
      moduleSpecifier: argument && ts.isStringLiteralLike(argument) ? argument.text : '<dynamic>',
      source: 'import',
    };
  }
  if (
    ts.isIdentifier(node.expression) &&
    clientCaptureIdentifierName(node.expression) === COMMONJS_REQUIRE_IDENTIFIER
  ) {
    const argument = node.arguments[0];
    return {
      importedName: '*',
      kind: 'commonjs',
      localName: 'require()',
      moduleSpecifier: argument && ts.isStringLiteralLike(argument) ? argument.text : '<dynamic>',
      source: 'import',
    };
  }
  return undefined;
}

function isDirectCalleeReferenceIdentifier(node: ts.Identifier): boolean {
  let current: ts.Node = node;
  let parent = current.parent;
  while (
    parent &&
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isTypeAssertionExpression(parent))
  ) {
    current = parent;
    parent = current.parent;
  }
  return !!parent && ts.isCallExpression(parent) && parent.expression === current;
}

function isDirectHandlerCallableReference(node: ts.Identifier, root: ts.Node): boolean {
  let current: ts.Node = node;
  let parent = current.parent;
  while (
    parent &&
    ((ts.isPropertyAccessExpression(parent) && parent.expression === current) ||
      (ts.isElementAccessExpression(parent) && parent.expression === current) ||
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isTypeAssertionExpression(parent))
  ) {
    current = parent;
    parent = current.parent;
  }
  return current === root;
}

/** True when `node` is the first argument of a `publishToClient(value, …)` call. */
function isPublishToClientArgument(node: ts.Identifier, parent: ts.Node): boolean {
  if (!ts.isCallExpression(parent)) return false;
  if (parent.arguments[0] !== node) return false;
  return expressionResolvesToFrameworkExport(
    ts as FrameworkIdentityTypeScript,
    parent.getSourceFile(),
    parent.expression,
    PUBLISH_TO_CLIENT_IDENTITY,
  );
}

/** Extract the `reason` string from `publishToClient(value, { reason: '…' })` for the audit ledger. */
function publishToClientReason(call: ts.CallExpression): string {
  const options = call.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return '';
  const propertyLength = compilerArrayLength(
    options.properties,
    'publishToClient reason properties',
  );
  for (let index = 0; index < propertyLength; index += 1) {
    const property = compilerOwnDataValue(
      options.properties,
      index,
      'publishToClient reason properties',
    ) as ts.ObjectLiteralElementLike | undefined;
    if (!property)
      throw new TypeError(`publishToClient reason properties[${index}] must be dense.`);
    if (
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === PUBLISH_TO_CLIENT_REASON_PROPERTY &&
      ts.isStringLiteralLike(property.initializer)
    ) {
      return property.initializer.text;
    }
  }
  return '';
}

function sourceSite(fileName: string, sourceFile: ts.SourceFile, position: number): string {
  const { line } = sourceFile.getLineAndCharacterOfPosition(position);
  return `${fileName}:${line + 1}`;
}

// A value reference (not a declaration site, property name, or import binding name). Reused from the
// scanner's own `isReferenceIdentifier` discipline: a callee identifier IS a value reference (we
// then separate callee vs non-callee by parent shape, not by excluding it here).
function isValueReferenceIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
    // `{ track }` — shorthand IS a value read of `track`.
    return true;
  }
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.name === node) return false;
  return true;
}

interface ModuleBindingDeclaration {
  localName: string;
  node: ts.Node;
}

function appendTaintedModuleBindings(
  sourceFile: ts.SourceFile,
  bindingByName: Map<string, CaptureBinding>,
): void {
  const declarations = moduleBindingDeclarations(sourceFile);
  for (let pass = 0; pass <= declarations.length; pass += 1) {
    let changed = false;
    for (let index = 0; index < declarations.length; index += 1) {
      const declaration = declarations[index]!;
      if (compilerMapGet(bindingByName, declaration.localName) !== undefined) continue;
      const dependency = closedModuleDependency(declaration.node, bindingByName);
      if (!dependency) continue;
      compilerMapSet(bindingByName, declaration.localName, {
        importedName: dependency.importedName,
        kind: 'local-alias',
        localName: declaration.localName,
        moduleSpecifier: dependency.moduleSpecifier,
        source: 'import',
      });
      changed = true;
    }
    if (!changed) return;
  }
}

function moduleBindingDeclarations(sourceFile: ts.SourceFile): ModuleBindingDeclaration[] {
  const declarations: ModuleBindingDeclaration[] = [];
  const statementLength = compilerArrayLength(
    sourceFile.statements,
    'Client-capture module declarations',
  );
  for (let statementIndex = 0; statementIndex < statementLength; statementIndex += 1) {
    const statement = compilerOwnDataValue(
      sourceFile.statements,
      statementIndex,
      'Client-capture module declarations',
    ) as ts.Statement | undefined;
    if (!statement) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      compilerArrayAppend(
        declarations,
        { localName: statement.name.text, node: statement.body },
        'Client-capture module declarations',
      );
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    const declarationLength = compilerArrayLength(
      statement.declarationList.declarations,
      'Client-capture module variable declarations',
    );
    for (let declarationIndex = 0; declarationIndex < declarationLength; declarationIndex += 1) {
      const declaration = compilerOwnDataValue(
        statement.declarationList.declarations,
        declarationIndex,
        'Client-capture module variable declarations',
      ) as ts.VariableDeclaration | undefined;
      if (!declaration?.initializer || !ts.isIdentifier(declaration.name)) continue;
      compilerArrayAppend(
        declarations,
        { localName: declaration.name.text, node: declaration.initializer },
        'Client-capture module declarations',
      );
    }
  }
  return declarations;
}

function closedModuleDependency(
  root: ts.Node,
  bindingByName: ReadonlyMap<string, CaptureBinding>,
): ImportBinding | undefined {
  let found: ImportBinding | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    const loader = moduleLoaderBinding(node);
    if (loader) {
      found = loader;
      return;
    }
    if (ts.isIdentifier(node) && isValueReferenceIdentifier(node)) {
      const binding = compilerMapGet(bindingByName as Map<string, CaptureBinding>, node.text);
      if (binding?.source === 'import') {
        if (binding.kind !== 'named') {
          found = binding;
          return;
        }
        const identity = canonicalFrameworkExportForExpression(
          ts as FrameworkIdentityTypeScript,
          node.getSourceFile(),
          node,
        );
        const target = identity
          ? reviewedCanonicalClientHandlerImportTarget(identity.module, identity.exportName)
          : reviewedClientHandlerImportTarget(
              binding.moduleSpecifier,
              binding.importedName,
              binding.kind,
            );
        if (target === undefined) {
          found = binding;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/**
 * Run the whole-channel capture analysis over a parsed component module. Pure over `model.sourceFile`
 * so the diagnostic validator and the lowering emit gate share ONE definition of "client-safe".
 */
export function analyzeClientCaptures(model: ComponentModuleModel): ClientCaptureAnalysis {
  const sourceFile = model.sourceFile;
  const fileName = sourceFile.fileName;
  const bindings = importBindings(sourceFile);
  const constants = moduleConstantBindings(model);
  const bindingByName = compilerCreateMap<string, CaptureBinding>();
  for (let index = 0; index < bindings.length; index += 1) {
    const binding = bindings[index]!;
    compilerMapSet(bindingByName, binding.localName, binding);
  }
  appendTaintedModuleBindings(sourceFile, bindingByName);
  for (let index = 0; index < constants.length; index += 1) {
    const binding = constants[index]!;
    if (compilerMapGet(bindingByName, binding.localName) === undefined) {
      compilerMapSet(bindingByName, binding.localName, binding);
    }
  }

  const allUses: CaptureUse[] = [];
  const executionPolicyUses: HandlerExecutionPolicyUse[] = [];
  const publishFacts: PublishToClientFact[] = [];
  const roots = handlerCaptureRoots(model);
  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index]!;
    classifyCaptures(root, bindingByName, fileName, allUses, publishFacts);
    const rootPolicyUses = handlerExecutionPolicyUses(root);
    const policyUseLength = compilerArrayLength(
      rootPolicyUses,
      'Client-handler root execution policy uses',
    );
    for (let policyUseIndex = 0; policyUseIndex < policyUseLength; policyUseIndex += 1) {
      const use = compilerOwnDataValue(
        rootPolicyUses,
        policyUseIndex,
        'Client-handler root execution policy uses',
      ) as HandlerExecutionPolicyUse | undefined;
      if (!use) {
        compilerFailClosed(
          `Client-handler root execution policy uses[${policyUseIndex}] must be own data.`,
        );
      }
      compilerArrayAppend(executionPolicyUses, use, 'Client-handler execution policy uses');
    }
  }

  // An import is UNSAFE at a use iff that use is value-position (not callee) and not published.
  // Same-file serializable module constants are stricter: they are evaluated into `*.client.js`, so
  // every captured use must be explicitly publishToClient-wrapped and the declaration must carry
  // the pristine same-file const-primitive proof. A bare callee-position use remains blocked.
  const unsafeUses: UnsafeCaptureUse[] = [];
  const blockedHandlerAttributeStarts = compilerCreateSet<number>();
  const blockedImports: string[] = [];
  const referencedImports: string[] = [];
  const blockedConstants: string[] = [];
  const referencedConstants: string[] = [];
  for (let index = 0; index < allUses.length; index += 1) {
    const use = allUses[index]!;
    const reason = unsafeCaptureReason(use);
    if (reason !== undefined) {
      compilerArrayAppend(unsafeUses, { ...use, reason }, 'Unsafe client-capture uses');
      compilerSetAdd(blockedHandlerAttributeStarts, use.attributeStart);
    }
    const referenced = use.binding.source === 'import' ? referencedImports : referencedConstants;
    appendUniqueName(referenced, use.binding.localName);
    if (reason !== undefined) {
      const blocked = use.binding.source === 'import' ? blockedImports : blockedConstants;
      appendUniqueName(blocked, use.binding.localName);
    }
  }

  const executionPolicyUseLength = compilerArrayLength(
    executionPolicyUses,
    'Client-handler execution policy uses',
  );
  for (let index = 0; index < executionPolicyUseLength; index += 1) {
    const use = compilerOwnDataValue(
      executionPolicyUses,
      index,
      'Client-handler execution policy uses',
    ) as HandlerExecutionPolicyUse | undefined;
    if (!use) {
      compilerFailClosed(`Client-handler execution policy uses[${index}] must be own data.`);
    }
    compilerSetAdd(blockedHandlerAttributeStarts, use.attributeStart);
  }

  // Import emission is module-global, while handlers are emitted independently. If any use closes
  // one binding, every handler that references that binding must be omitted; otherwise a separately
  // published use could survive with an unbound identifier after the import is withheld.
  for (let index = 0; index < allUses.length; index += 1) {
    const use = allUses[index]!;
    const blocked = use.binding.source === 'import' ? blockedImports : blockedConstants;
    if (captureNameIsListed(blocked, use.binding.localName)) {
      compilerSetAdd(blockedHandlerAttributeStarts, use.attributeStart);
    }
  }

  // Cross-module emit is allowed only for finite reviewed executable identities. Same-file
  // constant emit is a separate literal-data channel gated by pristine const-primitive provenance.
  const emitAllowed = allowedCaptureNames(referencedImports, blockedImports);
  const emitAllowedModuleConstants = allowedCaptureNames(referencedConstants, blockedConstants);
  const emitImportProvenance = clientImportProvenance(allUses, emitAllowed);

  return {
    blockedHandlerAttributeStarts,
    emitAllowed,
    emitAllowedModuleConstants,
    emitImportProvenance,
    executionPolicyUses,
    publishFacts,
    unsafeUses,
  };
}

function unsafeCaptureReason(use: CaptureUse): UnsafeCaptureUse['reason'] | undefined {
  if (use.binding.source === 'module-constant') {
    return use.published && use.binding.publishablePrimitive
      ? undefined
      : 'module-constant-capture';
  }
  // Import evaluation itself is browser executable authority. An audit wrapper around one export
  // cannot make the imported module inert; only the reviewed executable registry may emit it.
  if (use.published) return 'client-value-capture';
  if (use.binding.kind !== 'named') return 'client-import-policy';
  if (reviewedTargetForUse(use) !== undefined) {
    return use.callee || use.published ? undefined : 'client-import-policy';
  }
  if (use.published) return undefined;
  return use.callee ? 'client-import-policy' : 'client-value-capture';
}

function reviewedTargetForUse(use: CaptureUse): string | undefined {
  if (use.binding.source !== 'import' || use.binding.kind !== 'named') return undefined;
  if (use.reviewedIdentity) {
    return reviewedCanonicalClientHandlerImportTarget(
      use.reviewedIdentity.module,
      use.reviewedIdentity.exportName,
    );
  }
  return reviewedClientHandlerImportTarget(
    use.binding.moduleSpecifier,
    use.binding.importedName,
    use.binding.kind,
  );
}

function clientImportProvenance(
  uses: readonly CaptureUse[],
  emitAllowed: ReadonlySet<string>,
): ReadonlyMap<string, ClientImportDependencyProvenance> {
  const result = compilerCreateMap<string, ClientImportDependencyProvenance>();
  for (let index = 0; index < uses.length; index += 1) {
    const use = uses[index]!;
    if (
      use.binding.source !== 'import' ||
      !compilerSetHas(emitAllowed, use.binding.localName) ||
      compilerMapGet(result, use.binding.localName) !== undefined
    ) {
      continue;
    }
    const target = reviewedTargetForUse(use);
    if (target !== undefined) {
      compilerMapSet(
        result,
        use.binding.localName,
        compilerFreeze({
          canonicalExportName: use.reviewedIdentity?.exportName ?? use.binding.importedName,
          canonicalModule: use.reviewedIdentity?.module ?? use.binding.moduleSpecifier,
          emittedModuleSpecifier: target,
          kind: 'reviewed-executable' as const,
        }),
      );
    }
  }
  return result;
}

function appendUniqueName(names: string[], name: string): void {
  for (let index = 0; index < names.length; index += 1) {
    if (names[index] === name) return;
  }
  compilerArrayAppend(names, name, 'Client-capture names');
}

function captureNameIsListed(names: readonly string[], name: string): boolean {
  for (let index = 0; index < names.length; index += 1) {
    if (names[index] === name) return true;
  }
  return false;
}

function allowedCaptureNames(
  referenced: readonly string[],
  blocked: readonly string[],
): Set<string> {
  const result = compilerCreateSet<string>();
  for (let index = 0; index < referenced.length; index += 1) {
    const name = referenced[index]!;
    let denied = false;
    for (let blockedIndex = 0; blockedIndex < blocked.length; blockedIndex += 1) {
      if (blocked[blockedIndex] === name) {
        denied = true;
        break;
      }
    }
    if (!denied) compilerSetAdd(result, name);
  }
  return result;
}

/**
 * The set of import local names lower/handlers.ts is permitted to re-emit into `*.client.js`. Any
 * captured named import outside this set is withheld (fail-closed): the secret specifier never
 * reaches the client bundle.
 */
export function emitAllowedImportLocalNames(model: ComponentModuleModel): ReadonlySet<string> {
  return analyzeClientCaptures(model).emitAllowed;
}

/**
 * The set of same-file module constants lower/handlers.ts is permitted to inline into
 * `*.client.js`. A literal constant is emitted only when its captured use is explicitly
 * publishToClient-wrapped, matching the KV437 teaching diagnostic.
 */
export function emitAllowedModuleConstantNames(model: ComponentModuleModel): ReadonlySet<string> {
  return analyzeClientCaptures(model).emitAllowedModuleConstants;
}

/**
 * Compiler validator: emit KV437 at every un-wrapped value-position capture of a cross-module
 * import inside a client handler closure. The matching by-construction refusal (withholding the
 * specifier) happens in lower/handlers.ts via {@link emitAllowedImportLocalNames}.
 */
export function validateClientHandlerSecretCapture(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const analysis = analyzeClientCaptures(model);
  const found: CompilerDiagnostic[] = [];
  const length = compilerArrayLength(analysis.unsafeUses, 'Unsafe client-capture uses');
  for (let index = 0; index < length; index += 1) {
    const use = compilerOwnDataValue(analysis.unsafeUses, index, 'Unsafe client-capture uses') as
      | UnsafeCaptureUse
      | undefined;
    if (!use) {
      throw new TypeError(`Unsafe client-capture uses[${index}] must be an own capture fact.`);
    }
    if (use.reason === 'client-import-policy') continue;
    compilerArrayAppend(
      found,
      diagnostics.at(
        'KV437',
        { length: use.length, start: use.start },
        use.binding.source === 'import'
          ? `import="${use.binding.localName}" from="${use.binding.moduleSpecifier}" form=${use.binding.kind}`
          : `moduleConstant="${use.binding.localName}" scope=same-file`,
      ),
      'Client-capture diagnostics',
    );
  }
  return found;
}

/**
 * SPEC §5.2 executable-code boundary: generated browser handlers may call only an exact reviewed
 * import identity. A relative barrel is accepted only when finite project identity resolution
 * proves that it re-exports one of those identities, after which emission bypasses the barrel.
 */
export const validateClientHandlerImportPolicy = securityClassifier(
  'compiler.client-handler-import.validate',
  function (diagnostics: DiagnosticFactory, model: ComponentModuleModel): CompilerDiagnostic[] {
    const analysis = analyzeClientCaptures(model);
    const found: CompilerDiagnostic[] = [];
    const length = compilerArrayLength(analysis.unsafeUses, 'Closed client-handler import uses');
    for (let index = 0; index < length; index += 1) {
      const use = compilerOwnDataValue(
        analysis.unsafeUses,
        index,
        'Closed client-handler import uses',
      ) as UnsafeCaptureUse | undefined;
      if (!use) {
        throw new TypeError(`Closed client-handler import uses[${index}] must be own data.`);
      }
      if (use.reason !== 'client-import-policy') continue;
      const binding = use.binding;
      compilerArrayAppend(
        found,
        diagnostics.at(
          'KV201',
          { length: use.length, start: use.start },
          binding.source === 'import'
            ? `clientImport="${binding.localName}" from="${binding.moduleSpecifier}" form=${binding.kind} reviewed=false`
            : `moduleConstant="${binding.localName}" reviewed=false`,
        ),
        'Closed client-handler import diagnostics',
      );
    }
    return found;
  },
);

/**
 * SPEC §4.3/§5.2 executable boundary. Dynamic-code constructors/prototype reflection and
 * string-capable timers are outside the finite generated-handler ABI.
 */
export const validateClientHandlerExecutionPolicy = securityClassifier(
  'compiler.client-handler-execution.validate',
  function (diagnostics: DiagnosticFactory, model: ComponentModuleModel): CompilerDiagnostic[] {
    const analysis = analyzeClientCaptures(model);
    const found: CompilerDiagnostic[] = [];
    const length = compilerArrayLength(
      analysis.executionPolicyUses,
      'Closed client-handler execution uses',
    );
    for (let index = 0; index < length; index += 1) {
      const use = compilerOwnDataValue(
        analysis.executionPolicyUses,
        index,
        'Closed client-handler execution uses',
      ) as HandlerExecutionPolicyUse | undefined;
      if (!use) {
        compilerFailClosed(`Closed client-handler execution uses[${index}] must be own data.`);
      }
      compilerArrayAppend(
        found,
        diagnostics.at(
          'KV201',
          { length: use.length, start: use.start },
          'clientHandlerExecution=dynamic-code reviewed=false',
        ),
        'Closed client-handler execution diagnostics',
      );
    }
    return found;
  },
);
