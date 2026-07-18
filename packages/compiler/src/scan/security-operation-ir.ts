import * as ts from 'typescript';

import {
  canonicalFrameworkExportForExpression,
  frameworkExport,
  frameworkExportEquals,
  resolveFrameworkIdentityProjectSourceFile,
  type FrameworkExportIdentity,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';
import { securityOperationDoorForKind } from '@kovojs/core/internal/security-operation-ir';
import type {
  BrowserSecurityOperationKind,
  SecuritySemanticBudgets,
  SecuritySemanticClosedReason,
  SecuritySemanticHelperInvocationFact,
  SecuritySemanticRoot,
  SecuritySemanticRootBinding,
  SecuritySemanticSummary,
  SecuritySemanticTrace,
  ServerSecurityOperationKind,
} from '@kovojs/core/internal/security-operation-ir';

import {
  compilerArrayAppend,
  compilerArrayJoin,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateSet,
  compilerCreateWeakMap,
  compilerFailClosed,
  compilerMapForEach,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerSetAdd,
  compilerSetDelete,
  compilerSetForEach,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerStringSlice,
  compilerStringStartsWith,
  compilerStringTrim,
  compilerWeakMapGet,
  compilerWeakMapSet,
} from '../compiler-security-intrinsics.js';
import type {
  BrowserSecurityOperationModel,
  SecurityOperationSurface,
  SecurityOperationViolationModel,
  ServerSecurityOperationModel,
} from './model.js';

interface SecurityOperationScanResult<Operation> {
  readonly operations: readonly Operation[];
  readonly semanticRoot?: SecuritySemanticRoot;
  readonly violations: readonly SecurityOperationViolationModel[];
}

/** Parser/scanner-shared exact same-file root or helper callable. */
export interface ResolvedSecurityIrCallable {
  readonly body: ts.ConciseBody;
  readonly declaration:
    | ts.ArrowFunction
    | ts.FunctionDeclaration
    | ts.FunctionExpression
    | ts.MethodDeclaration;
  readonly name: string;
  readonly parameters: ts.NodeArray<ts.ParameterDeclaration>;
}

type BrowserValueProvenance =
  | 'dom'
  | 'event'
  | 'form'
  | 'local'
  | 'raw-browser'
  | 'state'
  | 'unknown'
  | 'unknown-authority'
  | `operation:${BrowserSecurityOperationKind}`;
type ServerValueProvenance =
  | 'context'
  | 'database'
  | 'database-read-namespace'
  | 'database-relational-query-namespace'
  | 'database-relational-table-namespace'
  | 'database-table-namespace'
  | 'database-write-namespace'
  | 'headers'
  | 'global-object'
  | 'foreign-executable'
  | 'intrinsic-identity-call'
  | 'intrinsic-object'
  | 'local'
  | 'respond'
  | 'request'
  | 'response-constructor'
  | 'response-outcome'
  | 'safe-call'
  | 'scope-call'
  | 'storage'
  | 'unknown-authority'
  | `operation:${ServerSecurityOperationKind}`;

const REDIRECT_IDENTITY = frameworkExport('@kovojs/server', 'redirect');
const TRUSTED_SQL_IDENTITY = frameworkExport('@kovojs/drizzle', 'trustedSql');
const TRUSTED_HTML_IDENTITIES = [
  frameworkExport('@kovojs/browser', 'trustedHtml'),
  frameworkExport('@kovojs/server', 'trustedHtml'),
] as const;
const RUN_COMMAND_IDENTITY = frameworkExport('@kovojs/server', 'runCommand');
const SERVER_STORAGE_FACTORY_IDENTITIES = [
  frameworkExport('@kovojs/core', 'createFileSystemStorage'),
  frameworkExport('@kovojs/core', 'createS3CompatibleStorage'),
] as const;
const SERVER_OPERATION_LEGACY_IDENTITIES = [
  REDIRECT_IDENTITY,
  TRUSTED_SQL_IDENTITY,
  TRUSTED_HTML_IDENTITIES[0],
  TRUSTED_HTML_IDENTITIES[1],
] as const;
const SERVER_REVIEWED_DATA_HELPER_IDENTITIES = [
  frameworkExport('@kovojs/server', 'serverValue'),
  frameworkExport('@kovojs/server', 'trustedAssign'),
  frameworkExport('drizzle-orm', 'and'),
  frameworkExport('drizzle-orm', 'arrayContained'),
  frameworkExport('drizzle-orm', 'arrayContains'),
  frameworkExport('drizzle-orm', 'arrayOverlaps'),
  frameworkExport('drizzle-orm', 'asc'),
  frameworkExport('drizzle-orm', 'avg'),
  frameworkExport('drizzle-orm', 'avgDistinct'),
  frameworkExport('drizzle-orm', 'between'),
  frameworkExport('drizzle-orm', 'count'),
  frameworkExport('drizzle-orm', 'countDistinct'),
  frameworkExport('drizzle-orm', 'desc'),
  frameworkExport('drizzle-orm', 'eq'),
  frameworkExport('drizzle-orm', 'exists'),
  frameworkExport('drizzle-orm', 'gt'),
  frameworkExport('drizzle-orm', 'gte'),
  frameworkExport('drizzle-orm', 'ilike'),
  frameworkExport('drizzle-orm', 'inArray'),
  frameworkExport('drizzle-orm', 'isNotNull'),
  frameworkExport('drizzle-orm', 'isNull'),
  frameworkExport('drizzle-orm', 'like'),
  frameworkExport('drizzle-orm', 'lt'),
  frameworkExport('drizzle-orm', 'lte'),
  frameworkExport('drizzle-orm', 'max'),
  frameworkExport('drizzle-orm', 'min'),
  frameworkExport('drizzle-orm', 'ne'),
  frameworkExport('drizzle-orm', 'not'),
  frameworkExport('drizzle-orm', 'notBetween'),
  frameworkExport('drizzle-orm', 'notExists'),
  frameworkExport('drizzle-orm', 'notIlike'),
  frameworkExport('drizzle-orm', 'notInArray'),
  frameworkExport('drizzle-orm', 'or'),
  frameworkExport('drizzle-orm', 'sum'),
  frameworkExport('drizzle-orm', 'sumDistinct'),
] as const;
const SERVER_REVIEWED_DATA_TAG_IDENTITIES = [
  frameworkExport('@kovojs/drizzle', 'sql'),
  frameworkExport('@kovojs/drizzle', 'staticSql'),
  frameworkExport('drizzle-orm', 'sql'),
] as const;
const SERVER_REVIEWED_DATABASE_TABLE_FACTORY_IDENTITIES = [
  frameworkExport('drizzle-orm', 'pgTable'),
  frameworkExport('drizzle-orm', 'sqliteTable'),
] as const;

function finiteStringSet(values: readonly string[]): ReadonlySet<string> {
  const result = compilerCreateSet<string>();
  const length = compilerArrayLength(values, 'Finite security-IR vocabulary');
  for (let index = 0; index < length; index += 1) {
    const value = compilerOwnDataValue(values, index, 'Finite security-IR vocabulary');
    if (typeof value !== 'string') {
      throw new TypeError(`Finite security-IR vocabulary[${index}] must be own string data.`);
    }
    compilerSetAdd(result, value);
  }
  return result;
}

const browserPureGlobalCalls = finiteStringSet([
  'BigInt',
  'Boolean',
  'Number',
  'Object',
  'String',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',
]);
const browserPureConstructors = finiteStringSet([
  'Map',
  'Promise',
  'Set',
  'URL',
  'WeakMap',
  'WeakSet',
]);
const serverPureConstructors = finiteStringSet(['Error']);
const serverPureGlobalMemberCalls = finiteStringSet(['crypto.randomUUID']);
const serverReviewedDatabaseBuilderMethods = finiteStringSet([
  'from',
  'limit',
  'orderBy',
  'set',
  'values',
  'where',
]);
const serverReviewedDatabaseSchemaValueCache = compilerCreateWeakMap<ts.Expression, boolean>();

interface SecurityIrIndexedDeclarationFact {
  callable?: ResolvedSecurityIrCallable;
  callableStart?: number;
  immutableInitializer?: ts.Expression;
  immutableStart?: number;
  matches: number;
}

interface SecurityIrSourceIndex {
  readonly assignedNames: ReadonlySet<string>;
  readonly declarationsByContainer: WeakMap<
    ts.Block | ts.SourceFile,
    ReadonlyMap<string, SecurityIrIndexedDeclarationFact>
  >;
  readonly foreignImportNames: ReadonlySet<string>;
  readonly moduleConstDeclarations: readonly ts.VariableDeclaration[];
}

const securityIrSourceIndexCache = compilerCreateWeakMap<ts.SourceFile, SecurityIrSourceIndex>();

/**
 * SPEC §5.2/§6.6 source boundary index. The AST is immutable after parsing, so one conservative
 * spelling-based pass can retain the exact old assignment and declaration answers without
 * rescanning the entire source for every helper edge.
 */
function securityIrSourceIndex(sourceFile: ts.SourceFile): SecurityIrSourceIndex {
  const cached = compilerWeakMapGet(securityIrSourceIndexCache, sourceFile);
  if (cached) return cached;

  const assignedNames = compilerCreateSet<string>();
  const declarationsByContainer = compilerCreateWeakMap<
    ts.Block | ts.SourceFile,
    ReadonlyMap<string, SecurityIrIndexedDeclarationFact>
  >();
  const foreignImportNames = compilerCreateSet<string>();
  const moduleConstDeclarations: ts.VariableDeclaration[] = [];

  const indexContainer = (container: ts.Block | ts.SourceFile): void => {
    const declarations = compilerCreateMap<string, SecurityIrIndexedDeclarationFact>();
    const statements = compilerSnapshotDenseArray(
      container.statements,
      'Finite security-IR indexed statements',
    );
    for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
      const statement = statements[statementIndex]!;
      if (ts.isFunctionDeclaration(statement) && statement.name) {
        securityIrIndexDeclaration(declarations, statement.name.text, {
          ...(statement.body
            ? {
                callable: {
                  body: statement.body,
                  declaration: statement,
                  name: statement.name.text,
                  parameters: statement.parameters,
                },
              }
            : {}),
        });
        continue;
      }
      if ((ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) {
        securityIrIndexDeclaration(declarations, statement.name.text);
        continue;
      }
      if (ts.isImportDeclaration(statement)) {
        const importNames = securityIrImportBindingNames(statement);
        compilerSetForEach(importNames, (name) => {
          securityIrIndexDeclaration(declarations, name);
          if (ts.isSourceFile(container)) compilerSetAdd(foreignImportNames, name);
        });
        continue;
      }
      if (!ts.isVariableStatement(statement)) continue;
      const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
      const variableDeclarations = compilerSnapshotDenseArray(
        statement.declarationList.declarations,
        'Finite security-IR indexed declarations',
      );
      for (
        let declarationIndex = 0;
        declarationIndex < variableDeclarations.length;
        declarationIndex += 1
      ) {
        const declaration = variableDeclarations[declarationIndex]!;
        if (ts.isSourceFile(container) && isConst) {
          compilerArrayAppend(
            moduleConstDeclarations,
            declaration,
            'Finite security-IR module const declarations',
          );
        }
        const names = compilerCreateSet<string>();
        collectBindingNames(declaration.name, names);
        compilerSetForEach(names, (name) => {
          const initializer = declaration.initializer && unwrapExpression(declaration.initializer);
          const exactIdentifier =
            ts.isIdentifier(declaration.name) && declaration.name.text === name;
          const declarationStart = declaration.getStart(sourceFile);
          securityIrIndexDeclaration(declarations, name, {
            ...(exactIdentifier && isConst && declaration.initializer
              ? {
                  immutableInitializer: declaration.initializer,
                  immutableStart: declarationStart,
                }
              : {}),
            ...(exactIdentifier &&
            isConst &&
            initializer &&
            (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
              ? {
                  callable: {
                    body: initializer.body,
                    declaration: initializer,
                    name,
                    parameters: initializer.parameters,
                  },
                  callableStart: declarationStart,
                }
              : {}),
          });
        });
      }
    }
    compilerWeakMapSet(declarationsByContainer, container, declarations);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isSourceFile(node) || ts.isBlock(node)) indexContainer(node);
    if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
      collectSecurityIrAssignmentTargetNames(node.left, assignedNames);
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      ts.isIdentifier(node.operand)
    ) {
      compilerSetAdd(assignedNames, node.operand.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const index: SecurityIrSourceIndex = {
    assignedNames,
    declarationsByContainer,
    foreignImportNames,
    moduleConstDeclarations,
  };
  compilerWeakMapSet(securityIrSourceIndexCache, sourceFile, index);
  return index;
}

function securityIrIndexDeclaration(
  declarations: Map<string, SecurityIrIndexedDeclarationFact>,
  name: string,
  candidate: Omit<SecurityIrIndexedDeclarationFact, 'matches'> = {},
): void {
  const fact = compilerMapGet(declarations, name) ?? { matches: 0 };
  fact.matches += 1;
  if (candidate.callable) fact.callable = candidate.callable;
  if (candidate.callableStart !== undefined) fact.callableStart = candidate.callableStart;
  if (candidate.immutableInitializer) {
    fact.immutableInitializer = candidate.immutableInitializer;
  }
  if (candidate.immutableStart !== undefined) fact.immutableStart = candidate.immutableStart;
  compilerMapSet(declarations, name, fact);
}

function securityIrImportBindingNames(statement: ts.ImportDeclaration): Set<string> {
  const names = compilerCreateSet<string>();
  const clause = statement.importClause;
  if (!clause) return names;
  if (clause.name) compilerSetAdd(names, clause.name.text);
  const bindings = clause.namedBindings;
  if (!bindings) return names;
  if (ts.isNamespaceImport(bindings)) {
    compilerSetAdd(names, bindings.name.text);
    return names;
  }
  const elements = compilerSnapshotDenseArray(bindings.elements, 'Finite security-IR imports');
  for (let index = 0; index < elements.length; index += 1) {
    compilerSetAdd(names, elements[index]!.name.text);
  }
  return names;
}

function securityIrDeclarationFact(
  sourceFile: ts.SourceFile,
  container: ts.Block | ts.SourceFile,
  name: string,
): SecurityIrIndexedDeclarationFact | undefined {
  const declarations = compilerWeakMapGet(
    securityIrSourceIndex(sourceFile).declarationsByContainer,
    container,
  );
  if (!declarations) {
    compilerFailClosed('Security-IR declaration index omitted a lexical statement container.');
  }
  return compilerMapGet(declarations, name);
}

function collectSecurityIrAssignmentTargetNames(node: ts.Node, names: Set<string>): void {
  const current =
    ts.isExpression(node) &&
    (ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node))
      ? unwrapExpression(node)
      : node;
  if (ts.isIdentifier(current)) {
    compilerSetAdd(names, current.text);
    return;
  }
  if (ts.isArrayLiteralExpression(current)) {
    const elements = compilerSnapshotDenseArray(
      current.elements,
      'Finite security-IR assignment targets',
    );
    for (let index = 0; index < elements.length; index += 1) {
      collectSecurityIrAssignmentTargetNames(elements[index]!, names);
    }
    return;
  }
  if (ts.isObjectLiteralExpression(current)) {
    const properties = compilerSnapshotDenseArray(
      current.properties,
      'Finite security-IR assignment targets',
    );
    for (let index = 0; index < properties.length; index += 1) {
      const property = properties[index]!;
      if (ts.isShorthandPropertyAssignment(property)) {
        compilerSetAdd(names, property.name.text);
      } else if (ts.isPropertyAssignment(property)) {
        collectSecurityIrAssignmentTargetNames(property.initializer, names);
      } else if (ts.isSpreadAssignment(property)) {
        collectSecurityIrAssignmentTargetNames(property.expression, names);
      }
    }
  }
  if (ts.isSpreadElement(current)) {
    collectSecurityIrAssignmentTargetNames(current.expression, names);
  }
}
const browserPureGlobalMemberCalls = finiteStringSet([
  'Array.from',
  'Array.isArray',
  'Date.now',
  'JSON.parse',
  'JSON.stringify',
  'Math.abs',
  'Math.ceil',
  'Math.floor',
  'Math.max',
  'Math.min',
  'Math.round',
  'Math.sign',
  'Math.trunc',
  'Number.isFinite',
  'Number.isInteger',
  'Number.isNaN',
  'Object.assign',
  'Object.entries',
  'Object.freeze',
  'Object.fromEntries',
  'Object.hasOwn',
  'Object.is',
  'Object.keys',
  'Object.values',
  'Promise.all',
  'Promise.allSettled',
  'Promise.race',
  'Promise.reject',
  'Promise.resolve',
  'String.fromCharCode',
  'String.fromCodePoint',
]);
const browserEventControlMethods = finiteStringSet([
  'preventDefault',
  'stopImmediatePropagation',
  'stopPropagation',
]);
const serverCallbackInvokingMemberCalls = finiteStringSet([
  'catch',
  'every',
  'filter',
  'finally',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flatMap',
  'forEach',
  'map',
  'reduce',
  'reduceRight',
  'some',
  'sort',
  'then',
  'toSorted',
]);
const serverImplicitObjectProtocolMembers = finiteStringSet([
  'asyncIterator',
  'hasInstance',
  'iterator',
  'match',
  'matchAll',
  'replace',
  'search',
  'split',
  'then',
  'toJSON',
  'toPrimitive',
  'toString',
  'valueOf',
]);
const browserEventScalarMembers = finiteStringSet([
  'altKey',
  'animationName',
  'bubbles',
  'button',
  'buttons',
  'cancelable',
  'clientX',
  'clientY',
  'code',
  'ctrlKey',
  'data',
  'defaultPrevented',
  'deltaMode',
  'deltaX',
  'deltaY',
  'deltaZ',
  'detail',
  'elapsedTime',
  'inputType',
  'isComposing',
  'isTrusted',
  'key',
  'location',
  'metaKey',
  'movementX',
  'movementY',
  'offsetX',
  'offsetY',
  'pageX',
  'pageY',
  'pointerId',
  'pressure',
  'repeat',
  'screenX',
  'screenY',
  'shiftKey',
  'timeStamp',
  'type',
  'which',
]);
const browserDomScalarMembers = finiteStringSet([
  'checked',
  'disabled',
  'hidden',
  'id',
  'innerHTML',
  'name',
  'open',
  'outerHTML',
  'selected',
  'selectionDirection',
  'selectionEnd',
  'selectionStart',
  'textContent',
  'type',
  'value',
]);
const browserDomReadMethods = finiteStringSet([
  'checkValidity',
  'closest',
  'getAttribute',
  'hasAttribute',
  'matches',
  'querySelector',
  'querySelectorAll',
  'toString',
  'valueOf',
]);
const browserStateMutatorMethods = finiteStringSet([
  'copyWithin',
  'fill',
  'pop',
  'push',
  'reverse',
  'shift',
  'sort',
  'splice',
  'unshift',
]);
const rawBrowserGlobalNames = finiteStringSet([
  'document',
  'globalThis',
  'history',
  'localStorage',
  'location',
  'navigator',
  'sessionStorage',
  'window',
]);

/**
 * Resolve one exact immutable same-file function used as a structured root or authority-bearing
 * helper edge. Imported, aliased, reassigned, multiply-declared, or lexically shadowed bindings do
 * not resolve here; Phase 2C may later discharge them through an explicit semantic summary.
 */
export function resolveSameFileSecurityIrCallable(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): ResolvedSecurityIrCallable | undefined {
  const current = unwrapExpression(expression);
  if (!ts.isIdentifier(current)) {
    return resolveSameFileSecurityIrMemberCallable(sourceFile, current);
  }
  if (!ts.isIdentifier(current) || moduleBindingIsAssigned(sourceFile, current.text)) {
    return undefined;
  }

  // Walk the exact lexical statement containers from the use site outward. The first container
  // that declares the name owns identity; an ineligible declaration stops resolution instead of
  // falling through to a same-named outer helper. This admits nested handler helpers without a
  // checker or general module evaluation while preserving the single immutable declaration rule.
  let cursor: ts.Node | undefined = current.parent;
  while (cursor) {
    if (ts.isBlock(cursor) || ts.isSourceFile(cursor)) {
      const resolved = securityIrCallableDeclaredInStatements(sourceFile, current, cursor);
      if (resolved.matched) return resolved.callable;
      if (ts.isSourceFile(cursor)) return undefined;
    }
    if (isSecurityIrFunctionScope(cursor)) {
      const parameters = compilerSnapshotDenseArray(
        cursor.parameters,
        'Finite security-IR lexical parameters',
      );
      for (let index = 0; index < parameters.length; index += 1) {
        const names = compilerCreateSet<string>();
        collectBindingNames(parameters[index]!.name, names);
        if (compilerSetHas(names, current.text)) return undefined;
      }
      if (
        (ts.isFunctionExpression(cursor) || ts.isFunctionDeclaration(cursor)) &&
        cursor.name?.text === current.text
      ) {
        return undefined;
      }
    }
    if (securityIrControlScopeDeclaresName(cursor, current.text)) {
      return undefined;
    }
    cursor = cursor.parent;
  }
  return undefined;
}

function resolveSameFileSecurityIrMemberCallable(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): ResolvedSecurityIrCallable | undefined {
  const properties: string[] = [];
  let root = unwrapExpression(expression);
  while (true) {
    const member = staticMember(root);
    if (!member) break;
    properties.unshift(member.name);
    root = unwrapExpression(member.receiver);
  }
  if (properties.length === 0) return undefined;
  return resolveSecurityIrCallableValue(
    sourceFile,
    root,
    properties,
    compilerCreateSet<string>(),
    0,
  );
}

function resolveSecurityIrCallableValue(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  properties: readonly string[],
  active: Set<string>,
  depth: number,
): ResolvedSecurityIrCallable | undefined {
  if (depth > SECURITY_SEMANTIC_CALL_DEPTH_BUDGET) return undefined;
  const current = unwrapExpression(expression);
  if (properties.length === 0) {
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      return {
        body: current.body,
        declaration: current,
        name: '<anonymous-member>',
        parameters: current.parameters,
      };
    }
    if (ts.isIdentifier(current)) {
      return resolveSameFileSecurityIrCallable(sourceFile, current);
    }
    return undefined;
  }

  if (ts.isIdentifier(current)) {
    const initializer = securityIrImmutableBindingInitializer(sourceFile, current);
    if (!initializer) return undefined;
    const key = `${initializer.getStart(sourceFile)}:${initializer.getEnd()}`;
    if (compilerSetHas(active, key)) return undefined;
    compilerSetAdd(active, key);
    try {
      return resolveSecurityIrCallableValue(sourceFile, initializer, properties, active, depth + 1);
    } finally {
      compilerSetDelete(active, key);
    }
  }

  if (ts.isCallExpression(current)) {
    const callee = unwrapExpression(current.expression);
    const member = staticMember(callee);
    const globalRoot = member && unwrapExpression(member.receiver);
    if (
      member &&
      (member.name === 'freeze' || member.name === 'seal' || member.name === 'preventExtensions') &&
      globalRoot !== undefined &&
      ts.isIdentifier(globalRoot) &&
      globalRoot.text === 'Object' &&
      !identifierIsShadowedWithinBoundary(globalRoot, sourceFile) &&
      current.arguments.length === 1
    ) {
      return resolveSecurityIrCallableValue(
        sourceFile,
        current.arguments[0]!,
        properties,
        active,
        depth + 1,
      );
    }
    return undefined;
  }

  if (!ts.isObjectLiteralExpression(current)) return undefined;
  const propertyName = properties[0]!;
  const remaining = properties.slice(1);
  let match: ts.ObjectLiteralElementLike | undefined;
  const members = compilerSnapshotDenseArray(
    current.properties,
    'Finite security-IR callable containers',
  );
  for (let index = 0; index < members.length; index += 1) {
    const candidate = members[index]!;
    if (ts.isSpreadAssignment(candidate)) return undefined;
    if (staticPropertyName(candidate.name) !== propertyName) continue;
    if (match !== undefined) return undefined;
    match = candidate;
  }
  if (!match) return undefined;
  if (ts.isMethodDeclaration(match)) {
    if (remaining.length > 0 || !match.body) return undefined;
    return {
      body: match.body,
      declaration: match,
      name: propertyName,
      parameters: match.parameters,
    };
  }
  if (ts.isPropertyAssignment(match)) {
    return resolveSecurityIrCallableValue(
      sourceFile,
      match.initializer,
      remaining,
      active,
      depth + 1,
    );
  }
  if (ts.isShorthandPropertyAssignment(match)) {
    return resolveSecurityIrCallableValue(sourceFile, match.name, remaining, active, depth + 1);
  }
  return undefined;
}

function securityIrImmutableBindingInitializer(
  sourceFile: ts.SourceFile,
  use: ts.Identifier,
): ts.Expression | undefined {
  if (moduleBindingIsAssigned(sourceFile, use.text)) return undefined;
  let cursor: ts.Node | undefined = use.parent;
  while (cursor) {
    if (ts.isBlock(cursor) || ts.isSourceFile(cursor)) {
      const resolved = securityIrImmutableBindingDeclaredInStatements(sourceFile, use, cursor);
      if (resolved.matched) return resolved.initializer;
      if (ts.isSourceFile(cursor)) return undefined;
    }
    if (isSecurityIrFunctionScope(cursor)) {
      const parameters = compilerSnapshotDenseArray(
        cursor.parameters,
        'Finite security-IR lexical parameters',
      );
      for (let index = 0; index < parameters.length; index += 1) {
        const names = compilerCreateSet<string>();
        collectBindingNames(parameters[index]!.name, names);
        if (compilerSetHas(names, use.text)) return undefined;
      }
      if (
        (ts.isFunctionExpression(cursor) || ts.isFunctionDeclaration(cursor)) &&
        cursor.name?.text === use.text
      ) {
        return undefined;
      }
    }
    if (securityIrControlScopeDeclaresName(cursor, use.text)) return undefined;
    cursor = cursor.parent;
  }
  return undefined;
}

function securityIrImmutableBindingDeclaredInStatements(
  sourceFile: ts.SourceFile,
  use: ts.Identifier,
  container: ts.Block | ts.SourceFile,
): { initializer?: ts.Expression; matched: boolean } {
  const fact = securityIrDeclarationFact(sourceFile, container, use.text);
  if (!fact) return { matched: false };
  const initializer =
    fact.matches === 1 &&
    fact.immutableInitializer &&
    fact.immutableStart !== undefined &&
    fact.immutableStart < use.getStart(sourceFile)
      ? fact.immutableInitializer
      : undefined;
  return { ...(initializer ? { initializer } : {}), matched: true };
}

function securityIrCallableDeclaredInStatements(
  sourceFile: ts.SourceFile,
  use: ts.Identifier,
  container: ts.Block | ts.SourceFile,
): { callable?: ResolvedSecurityIrCallable; matched: boolean } {
  const fact = securityIrDeclarationFact(sourceFile, container, use.text);
  if (!fact) return { matched: false };
  const callable =
    fact.matches === 1 &&
    fact.callable &&
    (fact.callableStart === undefined || fact.callableStart < use.getStart(sourceFile))
      ? fact.callable
      : undefined;
  return { ...(callable ? { callable } : {}), matched: true };
}

function moduleBindingIsAssigned(sourceFile: ts.SourceFile, name: string): boolean {
  return compilerSetHas(securityIrSourceIndex(sourceFile).assignedNames, name);
}

function securityIrControlScopeDeclaresName(node: ts.Node, name: string): boolean {
  let declaration: ts.VariableDeclarationList | ts.VariableDeclaration | undefined;
  if (ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isForStatement(node)) {
    const initializer = node.initializer;
    if (initializer && ts.isVariableDeclarationList(initializer)) declaration = initializer;
  } else if (ts.isCatchClause(node)) {
    declaration = node.variableDeclaration;
  }
  if (!declaration) return false;
  const names = compilerCreateSet<string>();
  if (ts.isVariableDeclaration(declaration)) {
    collectBindingNames(declaration.name, names);
  } else {
    const declarations = compilerSnapshotDenseArray(
      declaration.declarations,
      'Finite security-IR control bindings',
    );
    for (let index = 0; index < declarations.length; index += 1) {
      collectBindingNames(declarations[index]!.name, names);
    }
  }
  return compilerSetHas(names, name);
}

function securityIrImportDeclaresName(statement: ts.ImportDeclaration, name: string): boolean {
  const clause = statement.importClause;
  if (!clause) return false;
  if (clause.name?.text === name) return true;
  const bindings = clause.namedBindings;
  if (!bindings) return false;
  if (ts.isNamespaceImport(bindings)) return bindings.name.text === name;
  const elements = compilerSnapshotDenseArray(bindings.elements, 'Finite security-IR imports');
  for (let index = 0; index < elements.length; index += 1) {
    if (elements[index]!.name.text === name) return true;
  }
  return false;
}

function securityIrExpressionUsesDirectImportBinding(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): boolean {
  const current = unwrapExpression(expression);
  const member = staticMember(current);
  const directName = ts.isIdentifier(current) ? current.text : undefined;
  const namespaceName =
    member && ts.isIdentifier(unwrapExpression(member.receiver))
      ? (unwrapExpression(member.receiver) as ts.Identifier).text
      : undefined;
  if (directName === undefined && namespaceName === undefined) return false;

  const statements = compilerSnapshotDenseArray(
    sourceFile.statements,
    'Finite security-IR direct import bindings',
  );
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index]!;
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    if (directName !== undefined) {
      if (clause.name?.text === directName) return true;
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        const elements = compilerSnapshotDenseArray(
          bindings.elements,
          'Finite security-IR direct named imports',
        );
        for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
          if (elements[elementIndex]!.name.text === directName) return true;
        }
      }
    }
    if (
      namespaceName !== undefined &&
      clause.namedBindings &&
      ts.isNamespaceImport(clause.namedBindings) &&
      clause.namedBindings.name.text === namespaceName
    ) {
      return true;
    }
  }
  return false;
}

function securityIrLeftmostExecutableRoot(expression: ts.Expression): ts.Identifier | undefined {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return current;
  const member = staticMember(current);
  if (member) return securityIrLeftmostExecutableRoot(member.receiver);
  if (ts.isCallExpression(current) || ts.isNewExpression(current)) {
    return securityIrLeftmostExecutableRoot(current.expression);
  }
  return undefined;
}

function securityIrIdentifierBindingScope(
  sourceFile: ts.SourceFile,
  use: ts.Identifier,
): 'local' | 'module' | 'unresolved' {
  let cursor: ts.Node | undefined = use.parent;
  while (cursor) {
    if (ts.isBlock(cursor) || ts.isSourceFile(cursor)) {
      if (securityIrDeclarationFact(sourceFile, cursor, use.text)) {
        return ts.isSourceFile(cursor) ? 'module' : 'local';
      }
      if (ts.isSourceFile(cursor)) return 'unresolved';
    }
    if (isSecurityIrFunctionScope(cursor)) {
      const parameters = compilerSnapshotDenseArray(
        cursor.parameters,
        'Finite security-IR lexical parameters',
      );
      for (let index = 0; index < parameters.length; index += 1) {
        const names = compilerCreateSet<string>();
        collectBindingNames(parameters[index]!.name, names);
        if (compilerSetHas(names, use.text)) return 'local';
      }
      if (
        (ts.isFunctionExpression(cursor) || ts.isFunctionDeclaration(cursor)) &&
        cursor.name?.text === use.text
      ) {
        return 'local';
      }
    }
    if (securityIrControlScopeDeclaresName(cursor, use.text)) return 'local';
    cursor = cursor.parent;
  }
  return sourceFile === use.getSourceFile() ? 'unresolved' : 'module';
}

function securityIrMemberCallableIsStable(
  sourceFile: ts.SourceFile,
  callee: ts.Expression,
  call: ts.CallExpression | ts.NewExpression,
): boolean {
  const root = securityIrLeftmostExecutableRoot(callee);
  if (!root) return true;
  const boundary =
    securityIrIdentifierBindingScope(sourceFile, root) === 'local'
      ? securityIrEnclosingFunctionBody(call)
      : sourceFile;
  let stable = true;
  const visit = (node: ts.Node): void => {
    if (!stable || node === call) return;
    if (
      ts.isBinaryExpression(node) &&
      isAssignmentOperator(node.operatorToken.kind) &&
      securityIrNodeContainsValueIdentifier(node.left, root.text, call)
    ) {
      stable = false;
      return;
    }
    if (
      (ts.isDeleteExpression(node) ||
        ts.isPrefixUnaryExpression(node) ||
        ts.isPostfixUnaryExpression(node)) &&
      securityIrNodeContainsValueIdentifier(node, root.text, call)
    ) {
      stable = false;
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      securityIrNodeContainsValueIdentifier(node.initializer, root.text, call)
    ) {
      stable = false;
      return;
    }
    if (
      ts.isCallExpression(node) &&
      compilerSnapshotDenseArray(node.arguments, 'Finite security-IR call arguments').some(
        (argument) => securityIrNodeContainsValueIdentifier(argument, root.text, call),
      )
    ) {
      stable = false;
      return;
    }
    if (
      (ts.isReturnStatement(node) || ts.isThrowStatement(node)) &&
      node.expression &&
      securityIrNodeContainsValueIdentifier(node.expression, root.text, call)
    ) {
      stable = false;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(boundary);
  return stable;
}

function securityIrEnclosingFunctionBody(node: ts.Node): ts.ConciseBody | ts.SourceFile {
  let cursor: ts.Node | undefined = node.parent;
  while (cursor) {
    if (isSecurityIrFunctionScope(cursor) && cursor.body) return cursor.body;
    cursor = cursor.parent;
  }
  return node.getSourceFile();
}

function securityIrNodeContainsValueIdentifier(
  node: ts.Node,
  name: string,
  ignored: ts.Node,
): boolean {
  let found = false;
  const visit = (current: ts.Node): void => {
    if (found || current === ignored) return;
    if (ts.isCallExpression(current) || ts.isNewExpression(current)) {
      const argumentsList = compilerSnapshotDenseArray(
        current.arguments ?? [],
        'Finite security-IR executable arguments',
      );
      for (let index = 0; index < argumentsList.length; index += 1) {
        visit(argumentsList[index]!);
      }
      return;
    }
    if (ts.isIdentifier(current) && current.text === name) {
      const parent = current.parent;
      if (
        !(
          (ts.isPropertyAccessExpression(parent) && parent.name === current) ||
          (ts.isPropertyAssignment(parent) && parent.name === current)
        )
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

/** Scanner/source-text boundary for SPEC §4.3/§5.2 finite browser effects. */
export function scanBrowserSecurityOperations(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
): SecurityOperationScanResult<BrowserSecurityOperationModel> {
  const operations: BrowserSecurityOperationModel[] = [];
  const violations: SecurityOperationViolationModel[] = [];
  const locals = localBindingNames(body);
  const aliases = browserAliasProvenance(body);

  const appendOperation = (kind: BrowserSecurityOperationKind, node: ts.Node, target?: string) => {
    if (
      kind === 'browser.timer.schedule' &&
      ts.isCallExpression(node) &&
      browserTimerCallbackIsSourceText(node.arguments[0])
    ) {
      appendViolation(
        node.arguments[0]!,
        'raw-dom-operation',
        'string timer callbacks execute source text and are outside the finite handler IR',
      );
      return;
    }
    compilerArrayAppend(
      operations,
      {
        door: securityOperationDoorForKind(kind),
        kind,
        span: { end: node.getEnd(), start: node.getStart(sourceFile) },
        ...(target === undefined ? {} : { target }),
      },
      'Browser security operations',
    );
  };
  const appendViolation = (
    node: ts.Node,
    kind: SecurityOperationViolationModel['kind'],
    detail: string,
  ) => {
    compilerArrayAppend(
      violations,
      {
        detail,
        kind,
        span: { end: node.getEnd(), start: node.getStart(sourceFile) },
        surface: 'browser',
      },
      'Browser security-operation violations',
    );
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      classifyBrowserCall(
        sourceFile,
        body,
        node,
        locals,
        aliases,
        appendOperation,
        appendViolation,
      );
    } else if (ts.isNewExpression(node)) {
      const constructor = unwrapExpression(node.expression);
      const reviewedConstructor =
        ts.isIdentifier(constructor) &&
        (compilerSetHas(locals, constructor.text) ||
          compilerSetHas(browserPureConstructors, constructor.text));
      if (!reviewedConstructor) {
        appendViolation(
          node,
          'unknown-security-operation',
          `browser constructor ${nodeName(constructor)} is outside the finite handler IR`,
        );
      } else if (browserArgumentsContainAuthority(node.arguments ?? [], aliases, body)) {
        appendViolation(
          node,
          'computed-security-operation',
          `browser constructor ${nodeName(constructor)} cannot receive browser authority`,
        );
      }
    } else if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
      const provenance = browserMutationTargetProvenance(node.left, aliases, body);
      if (provenance === 'state') {
        appendOperation('browser.state.write', node.left, browserExpressionTarget(node.left));
      } else if (browserProvenanceCarriesAuthority(provenance)) {
        appendViolation(
          node.left,
          provenance === 'raw-browser' || provenance === 'unknown-authority'
            ? 'computed-security-operation'
            : 'raw-dom-operation',
          `raw browser assignment ${browserExpressionTarget(node.left) ?? 'computed'} is not a finite operation`,
        );
      } else if (provenance === 'unknown' && staticMember(unwrapExpression(node.left))) {
        appendViolation(
          node.left,
          'unknown-security-operation',
          `browser assignment ${browserExpressionTarget(node.left) ?? 'computed'} has no reviewed finite operation`,
        );
      }
      const rightProvenance = browserExpressionProvenance(node.right, aliases, body);
      if (
        provenance !== 'state' &&
        (browserProvenanceCarriesAuthority(rightProvenance) ||
          expressionContainsBrowserAuthority(node.right, aliases, body))
      ) {
        appendViolation(
          node.right,
          'computed-security-operation',
          'browser authority cannot move through a mutable or computed alias',
        );
      }
    } else if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      if (
        node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken
      ) {
        const operand = node.operand;
        const provenance = browserMutationTargetProvenance(operand, aliases, body);
        if (provenance === 'state') {
          appendOperation('browser.state.write', operand, browserExpressionTarget(operand));
        } else if (browserProvenanceCarriesAuthority(provenance)) {
          appendViolation(
            operand,
            'raw-dom-operation',
            `raw DOM update ${browserExpressionTarget(operand) ?? 'computed'} is not a finite operation`,
          );
        } else if (provenance === 'unknown' && staticMember(unwrapExpression(operand))) {
          appendViolation(
            operand,
            'unknown-security-operation',
            `browser update ${browserExpressionTarget(operand) ?? 'computed'} has no reviewed finite operation`,
          );
        }
      }
    } else if (ts.isDeleteExpression(node)) {
      const provenance = browserMutationTargetProvenance(node.expression, aliases, body);
      if (provenance === 'state') {
        appendOperation(
          'browser.state.write',
          node.expression,
          browserExpressionTarget(node.expression),
        );
      } else if (browserProvenanceCarriesAuthority(provenance)) {
        appendViolation(
          node,
          'raw-dom-operation',
          'deleting a DOM member is outside the finite handler IR',
        );
      } else if (provenance === 'unknown' && staticMember(unwrapExpression(node.expression))) {
        appendViolation(
          node.expression,
          'unknown-security-operation',
          `browser delete ${browserExpressionTarget(node.expression) ?? 'computed'} has no reviewed finite operation`,
        );
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(body);

  return {
    operations: dedupeBrowserOperations(operations),
    violations: dedupeViolations(violations),
  };
}

function browserTimerCallbackIsSourceText(expression: ts.Expression | undefined): boolean {
  if (expression === undefined) return false;
  const current = unwrapExpression(expression);
  return (
    ts.isStringLiteral(current) ||
    ts.isNoSubstitutionTemplateLiteral(current) ||
    ts.isTemplateExpression(current)
  );
}

function classifyBrowserCall(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  call: ts.CallExpression,
  locals: ReadonlySet<string>,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  appendOperation: (kind: BrowserSecurityOperationKind, node: ts.Node, target?: string) => void,
  appendViolation: (
    node: ts.Node,
    kind: SecurityOperationViolationModel['kind'],
    detail: string,
  ) => void,
): void {
  const callee = unwrapExpression(call.expression);
  if (ts.isIdentifier(callee)) {
    const provenance = browserExpressionProvenance(callee, aliases, body);
    const operationKind = browserOperationProvenanceKind(provenance);
    if (operationKind !== undefined) {
      appendOperation(operationKind, call, callee.text);
      return;
    }
    if (browserProvenanceCarriesAuthority(provenance)) {
      appendViolation(
        callee,
        'computed-security-operation',
        `browser capability alias ${callee.text} is outside the finite handler IR`,
      );
      return;
    }
    if (
      (callee.text === 'setTimeout' || callee.text === 'setInterval') &&
      !identifierIsShadowedWithinBoundary(callee, body)
    ) {
      appendOperation('browser.timer.schedule', call, callee.text);
      return;
    }
    if (
      (callee.text === 'clearTimeout' || callee.text === 'clearInterval') &&
      !identifierIsShadowedWithinBoundary(callee, body)
    ) {
      appendOperation('browser.timer.cancel', call, callee.text);
      return;
    }
    if (compilerSetHas(locals, callee.text)) {
      if (callArgumentsContainBrowserAuthority(call, aliases, body)) {
        appendViolation(
          call,
          'computed-security-operation',
          `browser authority cannot pass through local helper ${callee.text}`,
        );
      }
      return;
    }
    if (compilerSetHas(browserPureGlobalCalls, callee.text)) {
      return;
    }
    appendOperation('browser.framework.call', call, callee.text);
    return;
  }

  const member = staticMember(callee);
  if (!member) {
    if (browserExpressionProvenance(callee, aliases, body) !== 'local') {
      appendViolation(
        callee,
        'computed-security-operation',
        'computed browser call target is outside the finite handler IR',
      );
    }
    return;
  }

  const calleeOperationKind = browserOperationProvenanceKind(
    browserExpressionProvenance(callee, aliases, body),
  );
  if (calleeOperationKind !== undefined) {
    appendOperation(calleeOperationKind, call, browserExpressionTarget(callee) ?? member.name);
    return;
  }

  // `Object(element)['focus']?.call(element)` is the safe focus idiom used by reviewed primitives.
  const callableMember = staticMember(unwrapExpression(member.receiver));
  if (member.name === 'call' && callableMember) {
    const callableProvenance = browserExpressionProvenance(callableMember.receiver, aliases, body);
    if (callableMember.name === 'focus' && isDomProvenance(callableProvenance)) {
      appendOperation('browser.dom.focus', call, browserExpressionTarget(callableMember.receiver));
      return;
    }
  }

  const provenance = browserExpressionProvenance(member.receiver, aliases, body);
  if (provenance === 'state') {
    appendOperation(
      compilerSetHas(browserStateMutatorMethods, member.name)
        ? 'browser.state.write'
        : 'browser.state.read',
      call,
      member.name,
    );
    return;
  }
  if (provenance === 'event') {
    if (compilerSetHas(browserEventControlMethods, member.name)) {
      appendOperation('browser.event.control', call, member.name);
      return;
    }
    if (compilerSetHas(browserDomReadMethods, member.name)) {
      appendOperation('browser.event.read', call, member.name);
      return;
    }
  }
  if (isDomProvenance(provenance)) {
    if (compilerSetHas(browserDomReadMethods, member.name)) {
      appendOperation('browser.event.read', call, member.name);
      return;
    }
    if (member.name === 'focus') {
      appendOperation('browser.dom.focus', call, browserExpressionTarget(member.receiver));
      return;
    }
    if (member.name === 'reset') {
      appendOperation('browser.form.reset', call, 'reset');
      return;
    }
    if (member.name === 'requestSubmit') {
      appendOperation('browser.form.submit', call, 'requestSubmit');
      return;
    }
    if (member.name === 'showModal' || member.name === 'showPopover') {
      appendOperation('browser.dialog.open', call, member.name);
      return;
    }
    if (
      member.name === 'close' ||
      member.name === 'requestClose' ||
      member.name === 'hidePopover'
    ) {
      appendOperation('browser.dialog.close', call, member.name);
      return;
    }
    appendViolation(
      call,
      'raw-dom-operation',
      `DOM method ${member.name} is outside the finite handler IR`,
    );
    return;
  }

  const root = rootIdentifier(member.receiver);
  if (provenance === 'raw-browser' && root === 'document' && member.name === 'getElementById') {
    appendOperation('browser.event.read', call, 'document.getElementById');
    return;
  }
  if (provenance === 'raw-browser' || provenance === 'unknown-authority') {
    appendViolation(
      call,
      'computed-security-operation',
      `browser capability call ${browserExpressionTarget(callee) ?? member.name} is outside the finite handler IR`,
    );
    return;
  }

  if (root && !compilerSetHas(locals, root) && compilerSetHas(rawBrowserGlobalNames, root)) {
    // A literal document lookup is only a carrier. Its eventual dialog/focus/form operation is
    // classified at the outer call; all other document/global methods close here.
    if (root === 'document' && member.name === 'getElementById') {
      appendOperation('browser.event.read', call, 'document.getElementById');
      return;
    }
    appendViolation(
      call,
      'raw-dom-operation',
      `raw browser global operation ${root}.${member.name} is outside the finite handler IR`,
    );
    return;
  }

  if (
    (provenance === 'local' || (root !== undefined && compilerSetHas(locals, root))) &&
    callArgumentsContainBrowserAuthority(call, aliases, body)
  ) {
    appendViolation(
      call,
      'computed-security-operation',
      `browser authority cannot pass through local call ${member.name}`,
    );
    return;
  }

  const globalMember = root ? `${root}.${member.name}` : undefined;
  if (
    provenance === 'unknown' &&
    globalMember !== undefined &&
    compilerSetHas(browserPureGlobalMemberCalls, globalMember)
  ) {
    if (callArgumentsContainBrowserAuthority(call, aliases, body)) {
      appendViolation(
        call,
        'computed-security-operation',
        `${globalMember} cannot receive browser authority in the finite handler IR`,
      );
    }
    return;
  }

  if (provenance === 'unknown' && (!root || !compilerSetHas(locals, root))) {
    appendViolation(
      call,
      'unknown-security-operation',
      `browser call ${browserExpressionTarget(callee) ?? member.name} has no reviewed finite operation`,
    );
  }
}

/** Scanner/source-text boundary for structured server effects. */
const SECURITY_SEMANTIC_CALL_DEPTH_BUDGET = 16;
const SECURITY_SEMANTIC_NODE_BUDGET = 50_000;
const SECURITY_SEMANTIC_OPERATION_BUDGET = 4_096;
const SECURITY_SEMANTIC_SUMMARY_BUDGET = 256;

interface SecuritySemanticState {
  readonly active: Set<string>;
  readonly summaryKeys: Set<string>;
  nodes: number;
  operations: number;
  summaries: number;
}

interface SecuritySemanticInvocationResult {
  readonly closed: boolean;
  readonly helperInvocations: readonly SecuritySemanticHelperInvocationFact[];
  readonly operations: readonly ServerSecurityOperationModel[];
  readonly summaries: readonly SecuritySemanticSummary[];
  readonly traces: readonly SecuritySemanticTrace[];
  readonly violations: readonly SecurityOperationViolationModel[];
}

interface ServerModuleAliasEnvironment {
  readonly sourceFile: ts.SourceFile;
  readonly values: ReadonlyMap<string, ServerValueProvenance>;
}

interface ServerAliasEnvironment {
  readonly module: ServerModuleAliasEnvironment;
  readonly sourceFile: ts.SourceFile;
  readonly values: ReadonlyMap<string, ServerValueProvenance>;
}

const serverRootModuleAliasEnvironmentCache = compilerCreateWeakMap<
  ts.SourceFile,
  ServerModuleAliasEnvironment
>();
const serverInheritedModuleAliasEnvironmentCache = compilerCreateWeakMap<
  ServerAliasEnvironment,
  ServerModuleAliasEnvironment
>();

interface SecuritySemanticHelperInvocation {
  readonly authorityInputs: readonly string[];
  readonly call: ts.CallExpression;
  readonly callable: ResolvedSecurityIrCallable;
  readonly inheritedEnvironment: ServerAliasEnvironment;
  readonly parameterProvenances: readonly ServerValueProvenance[];
  readonly transfer: string;
  readonly unsupportedDetail?: string;
}

/**
 * SPEC §5.2/§6.6 narrow normalized abstract interpreter.
 *
 * The finite scanner remains the syntax-to-operation boundary. This pass consumes only its exact
 * same-file `server.helper.call` edges, evaluates the small provenance lattice above, and builds
 * bottom-up summaries. It deliberately does not execute or otherwise model general JavaScript.
 */
export function scanServerSecurityOperations(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  surface: SecurityOperationSurface,
  parameters: readonly ts.ParameterDeclaration[],
  root: string,
  binding: SecuritySemanticRootBinding,
): SecurityOperationScanResult<ServerSecurityOperationModel> {
  const state: SecuritySemanticState = {
    active: compilerCreateSet<string>(),
    nodes: 0,
    operations: 0,
    summaryKeys: compilerCreateSet<string>(),
    summaries: 0,
  };
  const result = analyzeServerSecurityCallable({
    body,
    callable: undefined,
    depth: 0,
    inheritedEnvironment: undefined,
    parameterProvenances: undefined,
    parameters,
    root,
    sourceFile,
    state,
    surface,
    transfers: [],
  });
  return {
    operations: dedupeServerOperations(result.operations),
    semanticRoot: {
      binding,
      helperInvocations: dedupeSemanticHelperInvocations(result.helperInvocations),
      root,
      summaries: dedupeSemanticSummaries(result.summaries),
      traces: dedupeSemanticTraces(result.traces),
    },
    violations: dedupeViolations(result.violations),
  };
}

function analyzeServerSecurityCallable(options: {
  body: ts.ConciseBody;
  callable: ResolvedSecurityIrCallable | undefined;
  depth: number;
  inheritedEnvironment: ServerAliasEnvironment | undefined;
  parameterProvenances: readonly ServerValueProvenance[] | undefined;
  parameters: readonly ts.ParameterDeclaration[];
  root: string;
  sourceFile: ts.SourceFile;
  state: SecuritySemanticState;
  surface: SecurityOperationSurface;
  transfers: readonly string[];
}): SecuritySemanticInvocationResult {
  const {
    body,
    callable,
    depth,
    inheritedEnvironment,
    parameterProvenances,
    parameters,
    root,
    sourceFile,
    state,
    surface,
    transfers,
  } = options;
  const helperInvocations: SecuritySemanticHelperInvocationFact[] = [];
  const operations: ServerSecurityOperationModel[] = [];
  const summaries: SecuritySemanticSummary[] = [];
  const traces: SecuritySemanticTrace[] = [];
  const violations: SecurityOperationViolationModel[] = [];
  const authorityInputs = semanticAuthorityInputs(parameterProvenances ?? []);
  const signature =
    callable === undefined
      ? undefined
      : `${surface}\0${callable.name}\0${compilerArrayJoin(authorityInputs, ',')}`;

  if (signature !== undefined && compilerSetHas(state.active, signature)) {
    appendSemanticClosure(
      sourceFile,
      callable?.declaration ?? body,
      root,
      transfers,
      surface,
      'helper-cycle',
      `recursive semantic helper cycle at local:${callable?.name ?? '<unknown>'}`,
      traces,
      violations,
    );
    compilerArrayAppend(
      summaries,
      {
        authorityInputs,
        callable: `local:${callable?.name ?? '<unknown>'}`,
        callableSpan: {
          end: (callable?.declaration ?? body).getEnd(),
          start: (callable?.declaration ?? body).getStart(sourceFile),
        },
        operationKinds: [],
        verdict: 'closed',
      },
      'Closed semantic helper summaries',
    );
    return { closed: true, helperInvocations, operations, summaries, traces, violations };
  }

  if (callable !== undefined) {
    if (signature === undefined) {
      compilerFailClosed(
        'Semantic helper summary signature was not constructed for a resolved callable.',
      );
    }
    if (!compilerSetHas(state.summaryKeys, signature)) {
      compilerSetAdd(state.summaryKeys, signature);
      state.summaries += 1;
      if (state.summaries > SECURITY_SEMANTIC_SUMMARY_BUDGET) {
        appendSemanticClosure(
          sourceFile,
          callable.declaration,
          root,
          transfers,
          surface,
          'budget-summary-count',
          `semantic helper summary budget exceeded at local:${callable.name}`,
          traces,
          violations,
        );
        compilerArrayAppend(
          summaries,
          {
            authorityInputs,
            callable: `local:${callable.name}`,
            callableSpan: {
              end: callable.declaration.getEnd(),
              start: callable.declaration.getStart(sourceFile),
            },
            operationKinds: [],
            verdict: 'closed',
          },
          'Budget-closed semantic helper summaries',
        );
        return { closed: true, helperInvocations, operations, summaries, traces, violations };
      }
    }
    compilerSetAdd(state.active, signature);
  }

  let closed = false;
  try {
    const regions = securityIrCallableRegions(body, parameters);
    const regionSnapshot = compilerSnapshotDenseArray(regions, 'Semantic callable regions');
    for (let index = 0; index < regionSnapshot.length; index += 1) {
      state.nodes += semanticNodeCount(regionSnapshot[index]!);
    }
    if (state.nodes > SECURITY_SEMANTIC_NODE_BUDGET) {
      appendSemanticClosure(
        sourceFile,
        callable?.declaration ?? body,
        root,
        transfers,
        surface,
        'budget-node-count',
        `semantic node budget exceeded while analyzing ${callable ? `local:${callable.name}` : root}`,
        traces,
        violations,
      );
      closed = true;
    } else {
      const directOperations: ServerSecurityOperationModel[] = [];
      const directViolations: SecurityOperationViolationModel[] = [];
      const regionEnvironments: ServerAliasEnvironment[] = [];
      for (let index = 0; index < regionSnapshot.length; index += 1) {
        const environment = serverAliasProvenance(
          sourceFile,
          regionSnapshot[index]!,
          parameters,
          surface,
          parameterProvenances,
          inheritedEnvironment,
        );
        compilerArrayAppend(
          regionEnvironments,
          environment,
          'Semantic callable-region environments',
        );
        const region = scanServerSecurityOperationsDirect(
          sourceFile,
          regionSnapshot[index]!,
          surface,
          parameters,
          parameterProvenances,
          inheritedEnvironment,
          environment,
        );
        appendServerOperations(directOperations, region.operations);
        appendSemanticViolations(directViolations, region.violations);
      }
      const direct = { operations: directOperations, violations: directViolations };
      appendServerOperations(operations, direct.operations);
      state.operations += direct.operations.length;
      if (state.operations > SECURITY_SEMANTIC_OPERATION_BUDGET) {
        appendSemanticClosure(
          sourceFile,
          callable?.declaration ?? body,
          root,
          transfers,
          surface,
          'budget-operation-count',
          `semantic operation budget exceeded while analyzing ${callable ? `local:${callable.name}` : root}`,
          traces,
          violations,
        );
        closed = true;
      }

      const operationSnapshot = compilerSnapshotDenseArray(
        direct.operations,
        'Direct semantic operations',
      );
      for (let index = 0; index < operationSnapshot.length; index += 1) {
        const operation = operationSnapshot[index]!;
        if (operation.kind === 'server.helper.call' || operation.kind === 'server.handler.root') {
          continue;
        }
        compilerArrayAppend(
          traces,
          {
            root,
            sink: {
              door: operation.door,
              kind: operation.kind,
              ...(operation.target === undefined ? {} : { target: operation.target }),
            },
            transfers: compilerSnapshotDenseArray(transfers, 'Semantic transfer path'),
            verdict: 'proved',
          },
          'Proved semantic traces',
        );
      }

      const violationSnapshot = compilerSnapshotDenseArray(
        direct.violations,
        'Direct semantic violations',
      );
      for (let index = 0; index < violationSnapshot.length; index += 1) {
        const violation = violationSnapshot[index]!;
        const reason = semanticReasonForViolation(violation);
        const trace: SecuritySemanticTrace = {
          detail: violation.detail,
          reason,
          root,
          sink: violation.detail,
          transfers: compilerSnapshotDenseArray(transfers, 'Semantic transfer path'),
          verdict: 'closed',
        };
        compilerArrayAppend(traces, trace, 'Closed semantic traces');
        compilerArrayAppend(
          violations,
          {
            ...violation,
            detail: semanticClosedDetail(root, transfers, violation.detail, reason),
          },
          'Rooted semantic violations',
        );
        closed = true;
      }

      if (!closed || state.operations <= SECURITY_SEMANTIC_OPERATION_BUDGET) {
        const helpers: SecuritySemanticHelperInvocation[] = [];
        const regionEnvironmentSnapshot = compilerSnapshotDenseArray(
          regionEnvironments,
          'Semantic callable-region environments',
        );
        for (let index = 0; index < regionSnapshot.length; index += 1) {
          const region = regionSnapshot[index]!;
          const regionHelpers = semanticHelperInvocations(
            sourceFile,
            region,
            direct.operations,
            regionEnvironmentSnapshot[index]!,
          );
          const helperRegionSnapshot = compilerSnapshotDenseArray(
            regionHelpers,
            'Semantic callable-region helpers',
          );
          for (let helperIndex = 0; helperIndex < helperRegionSnapshot.length; helperIndex += 1) {
            compilerArrayAppend(
              helpers,
              helperRegionSnapshot[helperIndex]!,
              'Semantic callable helpers',
            );
          }
        }
        const helperSnapshot = compilerSnapshotDenseArray(
          helpers,
          'Normalized semantic helper invocations',
        );
        for (let index = 0; index < helperSnapshot.length; index += 1) {
          const helper = helperSnapshot[index]!;
          const nextTransfers = appendSemanticTransfer(transfers, helper.transfer);
          if (helper.unsupportedDetail !== undefined) {
            appendSemanticClosure(
              sourceFile,
              helper.call,
              root,
              nextTransfers,
              surface,
              'opaque-transfer',
              helper.unsupportedDetail,
              traces,
              violations,
            );
            compilerArrayAppend(
              summaries,
              {
                authorityInputs: helper.authorityInputs,
                callable: `local:${helper.callable.name}`,
                callableSpan: {
                  end: helper.callable.declaration.getEnd(),
                  start: helper.callable.declaration.getStart(sourceFile),
                },
                operationKinds: [],
                verdict: 'closed',
              },
              'Unsupported semantic helper summaries',
            );
            compilerArrayAppend(
              helperInvocations,
              semanticHelperInvocationFact(sourceFile, helper, nextTransfers, [], 'closed'),
              'Unsupported semantic helper invocations',
            );
            closed = true;
            continue;
          }
          if (depth + 1 > SECURITY_SEMANTIC_CALL_DEPTH_BUDGET) {
            appendSemanticClosure(
              sourceFile,
              helper.call,
              root,
              nextTransfers,
              surface,
              'budget-call-depth',
              `semantic call-depth budget exceeded at local:${helper.callable.name}`,
              traces,
              violations,
            );
            compilerArrayAppend(
              summaries,
              {
                authorityInputs: helper.authorityInputs,
                callable: `local:${helper.callable.name}`,
                callableSpan: {
                  end: helper.callable.declaration.getEnd(),
                  start: helper.callable.declaration.getStart(sourceFile),
                },
                operationKinds: [],
                verdict: 'closed',
              },
              'Depth-closed semantic helper summaries',
            );
            compilerArrayAppend(
              helperInvocations,
              semanticHelperInvocationFact(sourceFile, helper, nextTransfers, [], 'closed'),
              'Depth-closed semantic helper invocations',
            );
            closed = true;
            continue;
          }

          const child = analyzeServerSecurityCallable({
            body: helper.callable.body,
            callable: helper.callable,
            depth: depth + 1,
            inheritedEnvironment: helper.inheritedEnvironment,
            parameterProvenances: helper.parameterProvenances,
            parameters: helper.callable.parameters,
            root,
            sourceFile,
            state,
            surface,
            transfers: nextTransfers,
          });
          compilerArrayAppend(
            helperInvocations,
            semanticHelperInvocationFact(
              sourceFile,
              helper,
              nextTransfers,
              semanticOperationKinds(child.operations),
              child.closed ? 'closed' : 'proved',
            ),
            'Normalized semantic helper invocations',
          );
          appendSemanticHelperInvocations(helperInvocations, child.helperInvocations);
          appendServerOperations(operations, child.operations);
          appendSemanticSummaries(summaries, child.summaries);
          appendSemanticTraces(traces, child.traces);
          appendSemanticViolations(violations, child.violations);
          if (child.closed) closed = true;
        }
      }
    }

    if (callable !== undefined) {
      const operationKinds = semanticOperationKinds(operations);
      compilerArrayAppend(
        summaries,
        {
          authorityInputs,
          callable: `local:${callable.name}`,
          callableSpan: {
            end: callable.declaration.getEnd(),
            start: callable.declaration.getStart(sourceFile),
          },
          operationKinds,
          verdict: closed ? 'closed' : 'proved',
        },
        'Bottom-up semantic helper summaries',
      );
    }
    return { closed, helperInvocations, operations, summaries, traces, violations };
  } finally {
    if (signature !== undefined) compilerSetDelete(state.active, signature);
  }
}

function securityIrCallableRegions(
  body: ts.ConciseBody,
  parameters: readonly ts.ParameterDeclaration[],
): ts.ConciseBody[] {
  const regions: ts.ConciseBody[] = [body];
  const parameterSnapshot = compilerSnapshotDenseArray(parameters, 'Semantic callable parameters');
  const appendBindingInitializers = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) return;
    const elements = compilerSnapshotDenseArray(
      name.elements,
      'Semantic parameter binding elements',
    );
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index]!;
      if (ts.isOmittedExpression(element)) continue;
      if (element.initializer) {
        compilerArrayAppend(regions, element.initializer, 'Semantic parameter initializers');
      }
      appendBindingInitializers(element.name);
    }
  };
  for (let index = 0; index < parameterSnapshot.length; index += 1) {
    const parameter = parameterSnapshot[index]!;
    if (parameter.initializer) {
      compilerArrayAppend(regions, parameter.initializer, 'Semantic parameter initializers');
    }
    appendBindingInitializers(parameter.name);
  }
  return regions;
}

function semanticHelperInvocations(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  operations: readonly ServerSecurityOperationModel[],
  environment: ServerAliasEnvironment,
): SecuritySemanticHelperInvocation[] {
  const helperEdges = compilerCreateSet<string>();
  const operationSnapshot = compilerSnapshotDenseArray(
    operations,
    'Semantic helper-edge operations',
  );
  for (let index = 0; index < operationSnapshot.length; index += 1) {
    const operation = operationSnapshot[index]!;
    if (operation.kind !== 'server.helper.call' || operation.target === undefined) continue;
    compilerSetAdd(
      helperEdges,
      `${operation.span.start}\0${operation.span.end}\0${operation.target}`,
    );
  }

  const helpers: SecuritySemanticHelperInvocation[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);
      const callable = resolveSameFileSecurityIrCallable(sourceFile, callee);
      const edgeKey = callable
        ? `${node.getStart(sourceFile)}\0${node.getEnd()}\0local:${callable.name}`
        : undefined;
      if (callable && edgeKey && compilerSetHas(helperEdges, edgeKey)) {
        compilerArrayAppend(
          helpers,
          semanticHelperInvocation(sourceFile, node, callable, environment),
          'Normalized semantic helper invocations',
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return helpers;
}

function semanticHelperInvocation(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  callable: ResolvedSecurityIrCallable,
  environment: ServerAliasEnvironment,
): SecuritySemanticHelperInvocation {
  const aliases = environment.values;
  const argumentSnapshot = compilerSnapshotDenseArray(call.arguments, 'Semantic helper arguments');
  const parameterSnapshot = compilerSnapshotDenseArray(
    callable.parameters,
    'Semantic helper parameters',
  );
  const parameterProvenances: ServerValueProvenance[] = [];
  const authorityInputs: string[] = [];
  let unsupportedDetail: string | undefined;
  let restParameterIndex: number | undefined;
  for (let index = 0; index < parameterSnapshot.length; index += 1) {
    if (parameterSnapshot[index]?.dotDotDotToken) {
      restParameterIndex = index;
      break;
    }
  }

  for (let index = 0; index < argumentSnapshot.length; index += 1) {
    const argument = argumentSnapshot[index]!;
    const spread = ts.isSpreadElement(argument);
    const expression = spread ? argument.expression : argument;
    const provenance = serverExpressionProvenance(expression, aliases);
    if (serverProvenanceCarriesAuthority(provenance)) {
      compilerArrayAppend(
        authorityInputs,
        `arg${index}=${provenance}`,
        'Semantic helper authority inputs',
      );
      if (spread) {
        unsupportedDetail = `authority-bearing spread argument into local:${callable.name} has no finite parameter mapping`;
      } else if (restParameterIndex !== undefined && index >= restParameterIndex) {
        unsupportedDetail = `authority-bearing rest argument into local:${callable.name} is outside the finite summary semantics`;
      } else if (index >= parameterSnapshot.length) {
        unsupportedDetail = `authority-bearing extra argument into local:${callable.name} has no finite parameter mapping`;
      }
    }
    if (index < parameterSnapshot.length) {
      compilerArrayAppend(parameterProvenances, provenance, 'Semantic helper parameter provenance');
    }
  }
  while (parameterProvenances.length < parameterSnapshot.length) {
    compilerArrayAppend(parameterProvenances, 'local', 'Semantic helper parameter provenance');
  }

  for (let index = 0; index < parameterSnapshot.length; index += 1) {
    const parameter = parameterSnapshot[index]!;
    if (parameter.dotDotDotToken && serverProvenanceCarriesAuthority(parameterProvenances[index])) {
      unsupportedDetail = `authority-bearing rest parameter in local:${callable.name} is outside the finite summary semantics`;
    }
  }
  if (authorityInputs.length > 0 && semanticBodyUsesArguments(callable.body)) {
    unsupportedDetail = `arguments-object authority recovery in local:${callable.name} is outside the finite summary semantics`;
  }

  const transfer = `local:${callable.name}[${compilerArrayJoin(authorityInputs, ',')}]`;
  return {
    authorityInputs,
    call,
    callable,
    inheritedEnvironment: environment,
    parameterProvenances,
    transfer,
    ...(unsupportedDetail === undefined ? {} : { unsupportedDetail }),
  };
}

function semanticHelperInvocationFact(
  sourceFile: ts.SourceFile,
  helper: SecuritySemanticHelperInvocation,
  transfers: readonly string[],
  operationKinds: readonly ServerSecurityOperationKind[],
  verdict: SecuritySemanticHelperInvocationFact['verdict'],
): SecuritySemanticHelperInvocationFact {
  const argumentSpans: Array<{ readonly end: number; readonly start: number }> = [];
  const argumentsSnapshot = compilerSnapshotDenseArray(
    helper.call.arguments,
    'Semantic helper invocation arguments',
  );
  for (let index = 0; index < argumentsSnapshot.length; index += 1) {
    compilerArrayAppend(
      argumentSpans,
      {
        end: argumentsSnapshot[index]!.getEnd(),
        start: argumentsSnapshot[index]!.getStart(sourceFile),
      },
      'Semantic helper invocation argument spans',
    );
  }
  return {
    argumentSpans,
    authorityInputs: compilerSnapshotDenseArray(
      helper.authorityInputs,
      'Semantic helper invocation authority inputs',
    ),
    callable: `local:${helper.callable.name}`,
    callableSpan: {
      end: helper.callable.declaration.getEnd(),
      start: helper.callable.declaration.getStart(sourceFile),
    },
    callSpan: {
      end: helper.call.getEnd(),
      start: helper.call.getStart(sourceFile),
    },
    operationKinds: compilerSnapshotDenseArray(
      operationKinds,
      'Semantic helper invocation operation kinds',
    ),
    transfers: compilerSnapshotDenseArray(transfers, 'Semantic helper invocation transfers'),
    verdict,
  };
}

function semanticBodyUsesArguments(body: ts.ConciseBody): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === 'arguments') {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

function semanticNodeCount(node: ts.Node): number {
  let count = 0;
  const visit = (current: ts.Node): void => {
    count += 1;
    ts.forEachChild(current, visit);
  };
  visit(node);
  return count;
}

function semanticAuthorityInputs(provenances: readonly ServerValueProvenance[]): string[] {
  const result: string[] = [];
  const snapshot = compilerSnapshotDenseArray(provenances, 'Semantic parameter provenance');
  for (let index = 0; index < snapshot.length; index += 1) {
    if (!serverProvenanceCarriesAuthority(snapshot[index])) continue;
    compilerArrayAppend(
      result,
      `arg${index}=${snapshot[index]}`,
      'Semantic authority-input summary',
    );
  }
  return result;
}

function semanticOperationKinds(
  operations: readonly ServerSecurityOperationModel[],
): ServerSecurityOperationKind[] {
  const result: ServerSecurityOperationKind[] = [];
  const seen = compilerCreateSet<ServerSecurityOperationKind>();
  const snapshot = compilerSnapshotDenseArray(operations, 'Semantic summary operations');
  for (let index = 0; index < snapshot.length; index += 1) {
    const kind = snapshot[index]!.kind;
    if (
      kind === 'server.handler.root' ||
      kind === 'server.helper.call' ||
      compilerSetHas(seen, kind)
    ) {
      continue;
    }
    compilerSetAdd(seen, kind);
    compilerArrayAppend(result, kind, 'Semantic summary operation kinds');
  }
  return result;
}

function semanticReasonForViolation(
  violation: SecurityOperationViolationModel,
): SecuritySemanticClosedReason {
  switch (violation.kind) {
    case 'computed-security-operation':
      return 'opaque-transfer';
    case 'unknown-security-operation':
      return 'unknown-operation';
    case 'incomplete-mutation-form':
    case 'raw-capability-operation':
    case 'raw-dom-operation':
      return 'unsupported-authority-use';
  }
}

function appendSemanticClosure(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  root: string,
  transfers: readonly string[],
  surface: SecurityOperationSurface,
  reason: SecuritySemanticClosedReason,
  detail: string,
  traces: SecuritySemanticTrace[],
  violations: SecurityOperationViolationModel[],
): void {
  const transferSnapshot = compilerSnapshotDenseArray(transfers, 'Semantic transfer path');
  compilerArrayAppend(
    traces,
    {
      detail,
      reason,
      root,
      sink: detail,
      transfers: transferSnapshot,
      verdict: 'closed',
    },
    'Synthetic closed semantic traces',
  );
  compilerArrayAppend(
    violations,
    {
      detail: semanticClosedDetail(root, transfers, detail, reason),
      kind: 'computed-security-operation',
      span: { end: node.getEnd(), start: node.getStart(sourceFile) },
      surface,
    },
    'Synthetic closed semantic violations',
  );
}

function semanticClosedDetail(
  root: string,
  transfers: readonly string[],
  sink: string,
  reason: SecuritySemanticClosedReason,
): string {
  const path = transfers.length === 0 ? '<direct>' : compilerArrayJoin(transfers, ' -> ');
  return `semantic root=${root}; transfers=${path}; sink=${sink}; verdict=closed:${reason}`;
}

function appendSemanticTransfer(transfers: readonly string[], transfer: string): string[] {
  const result = compilerSnapshotDenseArray(transfers, 'Semantic transfer path');
  compilerArrayAppend(result, transfer, 'Semantic transfer path');
  return result;
}

function appendServerOperations(
  target: ServerSecurityOperationModel[],
  values: readonly ServerSecurityOperationModel[],
): void {
  const snapshot = compilerSnapshotDenseArray(values, 'Semantic server operations');
  for (let index = 0; index < snapshot.length; index += 1) {
    compilerArrayAppend(target, snapshot[index]!, 'Semantic server operations');
  }
}

function appendSemanticSummaries(
  target: SecuritySemanticSummary[],
  values: readonly SecuritySemanticSummary[],
): void {
  const snapshot = compilerSnapshotDenseArray(values, 'Semantic helper summaries');
  for (let index = 0; index < snapshot.length; index += 1) {
    compilerArrayAppend(target, snapshot[index]!, 'Semantic helper summaries');
  }
}

function appendSemanticHelperInvocations(
  target: SecuritySemanticHelperInvocationFact[],
  values: readonly SecuritySemanticHelperInvocationFact[],
): void {
  const snapshot = compilerSnapshotDenseArray(values, 'Semantic helper invocation facts');
  for (let index = 0; index < snapshot.length; index += 1) {
    compilerArrayAppend(target, snapshot[index]!, 'Semantic helper invocation facts');
  }
}

function appendSemanticTraces(
  target: SecuritySemanticTrace[],
  values: readonly SecuritySemanticTrace[],
): void {
  const snapshot = compilerSnapshotDenseArray(values, 'Semantic traces');
  for (let index = 0; index < snapshot.length; index += 1) {
    compilerArrayAppend(target, snapshot[index]!, 'Semantic traces');
  }
}

function appendSemanticViolations(
  target: SecurityOperationViolationModel[],
  values: readonly SecurityOperationViolationModel[],
): void {
  const snapshot = compilerSnapshotDenseArray(values, 'Semantic violations');
  for (let index = 0; index < snapshot.length; index += 1) {
    compilerArrayAppend(target, snapshot[index]!, 'Semantic violations');
  }
}

function dedupeSemanticSummaries(
  values: readonly SecuritySemanticSummary[],
): SecuritySemanticSummary[] {
  return dedupeByKey(
    values,
    (value) =>
      `${value.callable}\0${value.callableSpan.start}\0${value.callableSpan.end}\0${compilerArrayJoin(value.authorityInputs, ',')}\0${compilerArrayJoin(value.operationKinds, ',')}\0${value.verdict}`,
  );
}

function dedupeSemanticHelperInvocations(
  values: readonly SecuritySemanticHelperInvocationFact[],
): SecuritySemanticHelperInvocationFact[] {
  return dedupeByKey(
    values,
    (value) =>
      `${value.callable}\0${value.callableSpan.start}\0${value.callableSpan.end}\0${value.callSpan.start}\0${value.callSpan.end}\0${semanticArgumentSpansKey(value.argumentSpans)}\0${compilerArrayJoin(value.authorityInputs, ',')}\0${compilerArrayJoin(value.operationKinds, ',')}\0${compilerArrayJoin(value.transfers, '\0')}\0${value.verdict}`,
  );
}

function semanticArgumentSpansKey(
  spans: readonly { readonly end: number; readonly start: number }[],
): string {
  const parts: string[] = [];
  const snapshot = compilerSnapshotDenseArray(spans, 'Semantic helper argument spans');
  for (let index = 0; index < snapshot.length; index += 1) {
    const span = snapshot[index]!;
    compilerArrayAppend(parts, `${span.start}:${span.end}`, 'Semantic helper argument span key');
  }
  return compilerArrayJoin(parts, ',');
}

function dedupeSemanticTraces(values: readonly SecuritySemanticTrace[]): SecuritySemanticTrace[] {
  return dedupeByKey(values, (value) => {
    const sink =
      value.verdict === 'proved'
        ? `${value.sink.kind}\0${value.sink.door}\0${value.sink.target ?? ''}`
        : `${value.reason}\0${value.sink}\0${value.detail}`;
    return `${value.root}\0${compilerArrayJoin(value.transfers, '\0')}\0${value.verdict}\0${sink}`;
  });
}

export function serverSecuritySemanticBudgets(): SecuritySemanticBudgets {
  return {
    callDepth: SECURITY_SEMANTIC_CALL_DEPTH_BUDGET,
    nodes: SECURITY_SEMANTIC_NODE_BUDGET,
    operations: SECURITY_SEMANTIC_OPERATION_BUDGET,
    summaries: SECURITY_SEMANTIC_SUMMARY_BUDGET,
  };
}

function scanServerSecurityOperationsDirect(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  surface: SecurityOperationSurface,
  parameters: readonly ts.ParameterDeclaration[] = [],
  parameterProvenances?: readonly ServerValueProvenance[],
  inheritedEnvironment?: ServerAliasEnvironment,
  precomputedEnvironment?: ServerAliasEnvironment,
): SecurityOperationScanResult<ServerSecurityOperationModel> {
  const operations: ServerSecurityOperationModel[] = [];
  const violations: SecurityOperationViolationModel[] = [];
  const environment =
    precomputedEnvironment ??
    serverAliasProvenance(
      sourceFile,
      body,
      parameters,
      surface,
      parameterProvenances,
      inheritedEnvironment,
    );
  if (environment.sourceFile !== sourceFile) {
    compilerFailClosed('Security-IR callable environment crossed an immutable source boundary.');
  }
  const aliases = environment.values;
  const appendOperation = (
    kind: ServerSecurityOperationKind,
    node: ts.Node,
    target?: string,
    justification?: string,
  ) => {
    compilerArrayAppend(
      operations,
      {
        door: securityOperationDoorForKind(kind),
        kind,
        span: { end: node.getEnd(), start: node.getStart(sourceFile) },
        ...(target === undefined ? {} : { target }),
        ...(justification === undefined ? {} : { justification }),
      },
      'Server security operations',
    );
  };
  const appendViolation = (
    node: ts.Node,
    kind: SecurityOperationViolationModel['kind'],
    detail: string,
  ) => {
    compilerArrayAppend(
      violations,
      {
        detail,
        kind,
        span: { end: node.getEnd(), start: node.getStart(sourceFile) },
        surface,
      },
      'Server security-operation violations',
    );
  };

  const parameterSnapshot = compilerSnapshotDenseArray(
    parameters,
    'Finite server callable parameters',
  );
  for (let index = 0; index < parameterSnapshot.length; index += 1) {
    const parameter = parameterSnapshot[index]!;
    if (parameter.dotDotDotToken) {
      appendViolation(
        parameter,
        'computed-security-operation',
        'rest parameters are outside the finite server handler language',
      );
    }
  }

  const visit = (node: ts.Node): void => {
    if (isSecurityIrFunctionScope(node)) {
      if (nestedServerFunctionCapturesAuthority(node, aliases)) {
        appendViolation(
          node,
          'computed-security-operation',
          'server authority cannot be captured by an unsummarized nested callable',
        );
      }
      if (securityIrFunctionIsImmediateCallback(node)) {
        const callbackRegions = securityIrCallableRegions(node.body, node.parameters);
        const callbackRegionSnapshot = compilerSnapshotDenseArray(
          callbackRegions,
          'Immediate server callback regions',
        );
        for (let index = 0; index < callbackRegionSnapshot.length; index += 1) {
          const callback = scanServerSecurityOperationsDirect(
            sourceFile,
            callbackRegionSnapshot[index]!,
            surface,
            node.parameters,
            undefined,
            environment,
          );
          appendServerOperations(operations, callback.operations);
          appendSemanticViolations(violations, callback.violations);
        }
      }
      return;
    }
    if (
      ts.isIdentifier(node) &&
      node.text === 'arguments' &&
      !(
        (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
        (ts.isPropertyAssignment(node.parent) && node.parent.name === node) ||
        (ts.isMethodDeclaration(node.parent) && node.parent.name === node)
      )
    ) {
      appendViolation(
        node,
        'computed-security-operation',
        'the implicit arguments object is outside the finite server handler language',
      );
    }
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      appendViolation(
        node,
        'computed-security-operation',
        'this-bound handler authority is outside the finite server handler language',
      );
    }
    if (
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isModuleDeclaration(node)
    ) {
      appendViolation(
        node,
        'computed-security-operation',
        'handler-local runtime declarations are outside the finite server handler language',
      );
      return;
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const initializerProvenance = serverExpressionProvenance(node.initializer, aliases);
      if (initializerProvenance === 'unknown-authority') {
        appendViolation(
          node.initializer,
          'computed-security-operation',
          'server authority cannot move through an opaque container or control-flow join',
        );
      } else if (!ts.isIdentifier(node.name) && initializerProvenance === 'foreign-executable') {
        appendViolation(
          node.initializer,
          'computed-security-operation',
          'destructuring an imported or foreign value can execute an unreviewed protocol',
        );
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Using) !== 0
    ) {
      appendViolation(
        node,
        'computed-security-operation',
        'using declarations execute an unsupported disposal protocol outside the finite server IR',
      );
    }
    if (
      ts.isBindingElement(node) &&
      node.initializer &&
      serverExpressionProvenance(node.initializer, aliases) === 'foreign-executable'
    ) {
      appendViolation(
        node.initializer,
        'computed-security-operation',
        'a binding default cannot receive an imported or foreign executable value',
      );
    }
    if (ts.isCallExpression(node)) {
      classifyServerCall(sourceFile, node, surface, aliases, appendOperation, appendViolation);
    } else if (ts.isTaggedTemplateExpression(node)) {
      const tag = unwrapExpression(node.tag);
      const identity = canonicalFrameworkExportForExpression(
        ts as FrameworkIdentityTypeScript,
        sourceFile,
        tag,
      );
      if (!frameworkIdentityIn(identity, SERVER_REVIEWED_DATA_TAG_IDENTITIES)) {
        appendViolation(
          node,
          'computed-security-operation',
          'unresolved, imported, aliased, or local server template tag is outside the finite server IR',
        );
      }
    } else if (ts.isNewExpression(node)) {
      const unsupportedCallback = serverUnreviewedCallbackArgument(sourceFile, node);
      if (unsupportedCallback) {
        appendViolation(
          unsupportedCallback,
          'computed-security-operation',
          'a callback-invoking server constructor requires an inline finite callback',
        );
      }
      const callee = unwrapExpression(node.expression);
      const provenance = serverExpressionProvenance(callee, aliases);
      if (provenance === 'response-constructor') {
        if (surface === 'endpoint' || surface === 'webhook') {
          appendOperation(
            'server.response.raw',
            node,
            'new Response',
            `${surface} access/CSRF posture`,
          );
        } else {
          appendViolation(
            node,
            'raw-capability-operation',
            `raw Response is not a supported ${surface} outcome`,
          );
        }
      } else if (provenance === 'foreign-executable') {
        appendViolation(
          node,
          'computed-security-operation',
          'imported, aliased, or foreign server constructor is outside the finite server IR',
        );
      } else if (provenance === 'unknown-authority') {
        appendViolation(
          node,
          'computed-security-operation',
          'computed server capability constructor is outside the finite server IR',
        );
      } else if (serverArgumentsContainAuthority(node.arguments ?? [], aliases)) {
        appendViolation(
          node,
          'computed-security-operation',
          'server authority cannot pass through an unreviewed constructor',
        );
      } else if (
        !(
          ts.isIdentifier(callee) &&
          (compilerSetHas(browserPureConstructors, callee.text) ||
            compilerSetHas(browserPureGlobalCalls, callee.text) ||
            (compilerSetHas(serverPureConstructors, callee.text) &&
              securityIrMemberCallableIsStable(sourceFile, callee, node))) &&
          !identifierIsShadowedWithinBoundary(callee, sourceFile) &&
          !serverArgumentsContainForeignExecutable(node.arguments ?? [], aliases)
        )
      ) {
        appendViolation(
          node,
          'computed-security-operation',
          'unresolved, local, or aliased server constructor is outside the finite server IR',
        );
      }
    } else if (
      ts.isElementAccessExpression(node) &&
      node.argumentExpression &&
      serverExpressionProvenance(node.argumentExpression, aliases) === 'foreign-executable'
    ) {
      appendViolation(
        node,
        'computed-security-operation',
        'an imported or foreign computed property key can execute an unreviewed coercion protocol',
      );
    } else if (
      ts.isComputedPropertyName(node) &&
      serverExpressionProvenance(node.expression, aliases) === 'foreign-executable'
    ) {
      appendViolation(
        node,
        'computed-security-operation',
        'an imported or foreign computed property key can execute an unreviewed coercion protocol',
      );
    } else if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword ||
        node.operatorToken.kind === ts.SyntaxKind.InKeyword) &&
      serverExpressionProvenance(node.right, aliases) === 'foreign-executable'
    ) {
      appendViolation(
        node,
        'computed-security-operation',
        `${node.operatorToken.getText(sourceFile)} against an imported or foreign value can execute an unreviewed protocol`,
      );
    } else if (
      ts.isBinaryExpression(node) &&
      serverBinaryOperatorExecutesCoercion(node.operatorToken.kind) &&
      (serverExpressionProvenance(node.left, aliases) === 'foreign-executable' ||
        serverExpressionProvenance(node.right, aliases) === 'foreign-executable')
    ) {
      appendViolation(
        node,
        'computed-security-operation',
        `${node.operatorToken.getText(sourceFile)} with an imported or foreign operand can execute an unreviewed coercion protocol`,
      );
    } else if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
      const left = unwrapExpression(node.left);
      if (
        ts.isIdentifier(left) &&
        serverProvenanceCarriesAuthority(compilerMapGet(aliases, left.text))
      ) {
        appendViolation(
          left,
          'raw-capability-operation',
          `server capability alias ${left.text} cannot be reassigned`,
        );
      }
      if (!ts.isIdentifier(left) && serverExpressionCarriesAuthority(left, aliases)) {
        appendViolation(
          left,
          'raw-capability-operation',
          'server capability members and containers cannot be mutated',
        );
      }
      if (
        !ts.isIdentifier(left) &&
        serverExpressionProvenance(left, aliases) === 'foreign-executable'
      ) {
        appendViolation(
          left,
          'computed-security-operation',
          'an imported or foreign assignment target is outside the finite server IR',
        );
      }
      if (
        serverExpressionCarriesAuthority(node.right, aliases) ||
        serverExpressionProvenance(node.right, aliases) === 'foreign-executable'
      ) {
        appendViolation(
          node.right,
          'computed-security-operation',
          'server authority cannot move through a mutable or computed alias',
        );
      }
    } else if (
      ts.isDeleteExpression(node) &&
      (serverExpressionCarriesAuthority(node.expression, aliases) ||
        serverExpressionProvenance(node.expression, aliases) === 'foreign-executable')
    ) {
      appendViolation(
        node,
        'raw-capability-operation',
        'server capability members and containers cannot be deleted',
      );
    } else if (
      ts.isPrefixUnaryExpression(node) &&
      (node.operator === ts.SyntaxKind.PlusToken ||
        node.operator === ts.SyntaxKind.MinusToken ||
        node.operator === ts.SyntaxKind.TildeToken) &&
      serverExpressionProvenance(node.operand, aliases) === 'foreign-executable'
    ) {
      appendViolation(
        node,
        'computed-security-operation',
        'unary coercion of an imported or foreign value is outside the finite server IR',
      );
    } else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      (serverExpressionCarriesAuthority(node.operand, aliases) ||
        serverExpressionProvenance(node.operand, aliases) === 'foreign-executable')
    ) {
      appendViolation(
        node,
        'raw-capability-operation',
        'server capability members and containers cannot be incremented or decremented',
      );
    } else if (
      ts.isForInStatement(node) &&
      serverExpressionProvenance(node.expression, aliases) === 'foreign-executable'
    ) {
      appendViolation(
        node.expression,
        'computed-security-operation',
        'enumerating an imported or foreign value can execute an unreviewed property protocol',
      );
    } else if (
      ts.isForOfStatement(node) &&
      serverExpressionProvenance(node.expression, aliases) === 'foreign-executable'
    ) {
      appendViolation(
        node.expression,
        'computed-security-operation',
        'iterating an imported or foreign value can execute an unreviewed iterator protocol',
      );
    } else if (
      (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) &&
      serverExpressionProvenance(node.expression, aliases) === 'foreign-executable'
    ) {
      appendViolation(
        node,
        'computed-security-operation',
        'spreading an imported or foreign value can execute an unreviewed iterator or property protocol',
      );
    } else if (
      ts.isAwaitExpression(node) &&
      serverExpressionProvenance(node.expression, aliases) === 'foreign-executable'
    ) {
      appendViolation(
        node,
        'computed-security-operation',
        'awaiting an imported or foreign value can execute an unreviewed thenable protocol',
      );
    } else if (
      ts.isYieldExpression(node) &&
      node.expression &&
      serverExpressionProvenance(node.expression, aliases) === 'foreign-executable'
    ) {
      appendViolation(
        node,
        'computed-security-operation',
        node.asteriskToken
          ? 'delegating to an imported or foreign iterator is outside the finite server IR'
          : 'yielding an imported or foreign value is outside the finite server IR',
      );
    } else if ((ts.isReturnStatement(node) || ts.isThrowStatement(node)) && node.expression) {
      const outcome = serverExpressionProvenance(node.expression, aliases);
      const isReviewedRawResponseOutcome =
        ts.isReturnStatement(node) &&
        (surface === 'endpoint' || surface === 'webhook') &&
        outcome === 'response-outcome';
      if (outcome === 'foreign-executable') {
        appendViolation(
          node.expression,
          'computed-security-operation',
          'an imported, aliased, or foreign value cannot escape as a structured handler outcome',
        );
      } else if (serverProvenanceCarriesAuthority(outcome) && !isReviewedRawResponseOutcome) {
        appendViolation(
          node.expression,
          'raw-capability-operation',
          'server capability cannot escape a structured handler outcome',
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  const conciseOutcome = !ts.isBlock(body) ? serverExpressionProvenance(body, aliases) : undefined;
  if (
    conciseOutcome !== undefined &&
    (conciseOutcome === 'foreign-executable' || serverProvenanceCarriesAuthority(conciseOutcome)) &&
    !((surface === 'endpoint' || surface === 'webhook') && conciseOutcome === 'response-outcome')
  ) {
    appendViolation(
      body,
      'raw-capability-operation',
      'server capability cannot escape a structured handler outcome',
    );
  }
  visit(body);

  return {
    operations: dedupeServerOperations(operations),
    violations: dedupeViolations(violations),
  };
}

function securityIrFunctionIsImmediateCallback(
  node: ts.FunctionLikeDeclaration,
): node is ts.ArrowFunction | ts.FunctionExpression {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return false;
  let expression: ts.Expression = node;
  let parent = expression.parent;
  while (
    parent &&
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isTypeAssertionExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent))
  ) {
    expression = parent;
    parent = parent.parent;
  }
  if (!parent || (!ts.isCallExpression(parent) && !ts.isNewExpression(parent))) return false;
  const argumentsList = compilerSnapshotDenseArray(
    parent.arguments ?? [],
    'Immediate server callback arguments',
  );
  for (let index = 0; index < argumentsList.length; index += 1) {
    if (argumentsList[index] === expression) return true;
  }
  return false;
}

function nestedServerFunctionCapturesAuthority(
  functionNode: ts.Node,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== functionNode && isSecurityIrFunctionScope(node)) return;
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      if (
        !(
          (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
          (ts.isPropertyAssignment(parent) && parent.name === node)
        ) &&
        serverProvenanceCarriesAuthority(compilerMapGet(aliases, node.text)) &&
        !identifierIsShadowedWithinBoundary(node, functionNode)
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(functionNode);
  return found;
}

function classifyServerCall(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  surface: SecurityOperationSurface,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
  appendOperation: (
    kind: ServerSecurityOperationKind,
    node: ts.Node,
    target?: string,
    justification?: string,
  ) => void,
  appendViolation: (
    node: ts.Node,
    kind: SecurityOperationViolationModel['kind'],
    detail: string,
  ) => void,
): void {
  const callee = unwrapExpression(call.expression);
  const frameworkIdentity = canonicalFrameworkExportForExpression(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    callee,
    { legacyGlobals: SERVER_OPERATION_LEGACY_IDENTITIES },
  );
  if (frameworkExportEquals(frameworkIdentity, REDIRECT_IDENTITY)) {
    appendOperation('server.response.redirect', call, 'redirect');
    return;
  }
  if (frameworkExportEquals(frameworkIdentity, TRUSTED_SQL_IDENTITY)) {
    appendOperation(
      'server.database.trusted-sql',
      call,
      'trustedSql',
      justificationFromCall(call) ?? 'missing',
    );
    return;
  }
  if (frameworkIdentityIn(frameworkIdentity, TRUSTED_HTML_IDENTITIES)) {
    appendOperation(
      'server.output.trusted-html',
      call,
      'trustedHtml',
      justificationFromCall(call) ?? 'missing',
    );
    return;
  }
  if (frameworkIdentityIn(frameworkIdentity, SERVER_REVIEWED_DATA_HELPER_IDENTITIES)) {
    // These exact framework exports construct plain validation/query-expression data. They do not
    // receive a capability or own a runtime sink; aliases and same-spelled app/import exports do
    // not inherit this reviewed identity.
    if (serverArgumentsContainAuthority(call.arguments, aliases)) {
      appendViolation(
        call,
        'computed-security-operation',
        `reviewed server data helper ${nodeName(callee)} cannot receive server authority`,
      );
    } else if (
      frameworkIdentity?.module === 'drizzle-orm'
        ? serverArgumentsContainUnreviewedForeignExecutable(sourceFile, call.arguments, aliases)
        : serverArgumentsContainForeignExecutable(call.arguments, aliases)
    ) {
      appendViolation(
        call,
        'computed-security-operation',
        `reviewed server data helper ${nodeName(callee)} cannot receive an unreviewed imported executable value`,
      );
    } else if (!securityIrMemberCallableIsStable(sourceFile, callee, call)) {
      appendViolation(
        call,
        'computed-security-operation',
        `mutable, escaped, or aliased reviewed server data helper ${nodeName(callee)} is outside the finite server IR`,
      );
    }
    return;
  }
  if (frameworkExportEquals(frameworkIdentity, RUN_COMMAND_IDENTITY)) {
    // SPEC §6.6: command execution terminates at the exact framework capability door. KV424 owns
    // the Command/allowlist provenance proof and runCommand revalidates its private runtime
    // sentinel; finite IR admits only the direct immutable framework import, never an alias or a
    // same-spelled foreign callable.
    if (
      !securityIrExpressionUsesDirectImportBinding(sourceFile, callee) ||
      !securityIrMemberCallableIsStable(sourceFile, callee, call) ||
      serverArgumentsContainAuthority(call.arguments, aliases) ||
      serverArgumentsContainForeignExecutable(call.arguments, aliases)
    ) {
      appendViolation(
        call,
        'computed-security-operation',
        `mutable, escaped, aliased, or authority-bearing command door ${nodeName(callee)} is outside the finite server IR`,
      );
    }
    return;
  }
  const unsupportedCallback = serverUnreviewedCallbackArgument(sourceFile, call);
  if (unsupportedCallback) {
    appendViolation(
      unsupportedCallback,
      'computed-security-operation',
      'a callback-invoking server operation requires an inline or reviewed finite callback',
    );
    return;
  }
  if (ts.isIdentifier(callee)) {
    const authorityTransfer = serverArgumentsContainAuthority(call.arguments, aliases);
    const classified = classifyServerProvenanceCall(
      serverExpressionProvenance(callee, aliases),
      call,
      callee.text,
      surface,
      appendOperation,
      appendViolation,
    );
    if (!classified) {
      const local = resolveSameFileSecurityIrCallable(sourceFile, callee);
      if (local) {
        // SPEC §5.2/§6.6: exact same-file call edges are part of the finite graph even when the
        // invocation carries no authority. A helper can itself construct or return a privileged
        // outcome, so authority-at-the-call-site is not a sound enrollment condition.
        appendOperation('server.helper.call', call, `local:${local.name}`);
      } else if (
        compilerSetHas(browserPureGlobalCalls, callee.text) &&
        !identifierIsShadowedWithinBoundary(callee, sourceFile) &&
        !authorityTransfer &&
        !serverArgumentsContainForeignExecutable(call.arguments, aliases)
      ) {
        // Reviewed scalar/data intrinsics are the only foreign identifier calls in the finite
        // server language. A same-spelled local/import or authority-bearing invocation is not the
        // intrinsic and remains closed.
        return;
      } else {
        appendViolation(
          call,
          'computed-security-operation',
          `unresolved, imported, aliased, or foreign server helper ${callee.text} is outside the finite server IR`,
        );
      }
    }
    return;
  }

  const member = staticMember(callee);
  if (!member) {
    const provenance = serverExpressionProvenance(callee, aliases);
    const root = rootIdentifier(callee);
    if (provenance === 'unknown-authority' || (root && isStructuredServerReceiver(root))) {
      appendViolation(
        callee,
        'computed-security-operation',
        `computed ${root} operation is outside the finite server IR`,
      );
    } else {
      appendViolation(
        call,
        'computed-security-operation',
        'computed server helper is outside the finite server IR',
      );
    }
    return;
  }
  const path = expressionPath(member.receiver);
  const target = path ? `${path}.${member.name}` : member.name;
  const globalRoot = unwrapExpression(member.receiver);
  const globalMember = ts.isIdentifier(globalRoot)
    ? `${globalRoot.text}.${member.name}`
    : undefined;
  if (
    globalMember !== undefined &&
    compilerSetHas(serverPureGlobalMemberCalls, globalMember) &&
    ts.isIdentifier(globalRoot) &&
    !identifierIsShadowedWithinBoundary(globalRoot, sourceFile) &&
    securityIrMemberCallableIsStable(sourceFile, callee, call) &&
    !serverArgumentsContainAuthority(call.arguments, aliases) &&
    !serverArgumentsContainForeignExecutable(call.arguments, aliases)
  ) {
    // SPEC §5.2/§6.6: this is one exact ambient data operation. The ambient root is seeded as
    // foreign executable below so aliases, containers, getters, and replacement fall back to the
    // closed provenance path instead of inheriting this direct-call verdict.
    return;
  }
  const provenance = serverExpressionProvenance(callee, aliases);
  if (
    classifyServerProvenanceCall(
      provenance,
      call,
      target,
      surface,
      appendOperation,
      appendViolation,
    )
  ) {
    return;
  }
  if (
    globalMember !== undefined &&
    compilerSetHas(browserPureGlobalMemberCalls, globalMember) &&
    ts.isIdentifier(globalRoot) &&
    !identifierIsShadowedWithinBoundary(globalRoot, sourceFile) &&
    !serverArgumentsContainAuthority(call.arguments, aliases) &&
    !serverArgumentsContainForeignExecutable(call.arguments, aliases)
  ) {
    return;
  }
  if (serverCallDescendsFromReviewedDatabaseOperation(callee, aliases)) {
    if (
      compilerSetHas(serverReviewedDatabaseBuilderMethods, member.name) &&
      !serverArgumentsContainAuthority(call.arguments, aliases) &&
      !serverArgumentsContainUnreviewedForeignExecutable(sourceFile, call.arguments, aliases)
    ) {
      // SPEC §5.2/§6.6: a Drizzle continuation is reviewed only while it remains an inline static
      // chain rooted in an exact managed database operation. A detached, replaced, imported, or
      // same-spelled method never reaches this branch.
      return;
    }
    appendViolation(
      call,
      'computed-security-operation',
      `unknown or authority-bearing managed database builder continuation ${member.name} is outside the finite server IR`,
    );
    return;
  }
  if (!securityIrMemberCallableIsStable(sourceFile, callee, call)) {
    appendViolation(
      call,
      'computed-security-operation',
      `mutable, escaped, or aliased server helper ${target} is outside the finite server IR`,
    );
    return;
  }
  if (member.name === 'call' || member.name === 'apply' || member.name === 'bind') {
    appendViolation(
      call,
      'computed-security-operation',
      `server helper invocation through ${member.name} is outside the finite server IR`,
    );
    return;
  }
  const local = resolveSameFileSecurityIrCallable(sourceFile, callee);
  if (local) {
    appendOperation('server.helper.call', call, `local:${local.name}`);
    return;
  }
  if (provenance === 'safe-call') return;
  const localRoot = securityIrLeftmostExecutableRoot(callee);
  if (
    provenance === 'local' &&
    (localRoot === undefined || securityIrIdentifierBindingScope(sourceFile, localRoot) === 'local')
  ) {
    if (
      serverArgumentsContainForeignExecutable(call.arguments, aliases) &&
      !serverCallDescendsFromReviewedDatabaseOperation(callee, aliases)
    ) {
      appendViolation(
        call,
        'computed-security-operation',
        `generic local server helper ${target} cannot receive an imported or foreign executable value`,
      );
      return;
    }
    // Plain values produced inside the enrolled callable may use ordinary data methods. Exact
    // callable-valued object members were enrolled above; module/import/unresolved roots remain
    // closed so a foreign helper cannot masquerade as a plain method.
    return;
  }
  appendViolation(
    call,
    'computed-security-operation',
    `unresolved, imported, aliased, or foreign server helper ${target} is outside the finite server IR`,
  );
}

function serverCallDescendsFromReviewedDatabaseOperation(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  const current = unwrapExpression(expression);
  if (ts.isCallExpression(current)) {
    const calleeProvenance = serverExpressionProvenance(current.expression, aliases);
    if (
      calleeProvenance === 'operation:server.database.read' ||
      calleeProvenance === 'operation:server.database.write'
    ) {
      return true;
    }
    return serverCallDescendsFromReviewedDatabaseOperation(current.expression, aliases);
  }
  const member = staticMember(current);
  return member ? serverCallDescendsFromReviewedDatabaseOperation(member.receiver, aliases) : false;
}

interface ServerImportedProjectValue {
  readonly exportName: string;
  readonly specifier: string;
}

function serverArgumentsContainUnreviewedForeignExecutable(
  sourceFile: ts.SourceFile,
  argumentsList: readonly ts.Expression[],
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  const snapshot = compilerSnapshotDenseArray(
    argumentsList,
    'Finite managed database builder arguments',
  );
  for (let index = 0; index < snapshot.length; index += 1) {
    const argument = snapshot[index]!;
    if (ts.isSpreadElement(argument)) {
      if (serverExpressionProvenance(argument.expression, aliases) === 'foreign-executable') {
        return true;
      }
      continue;
    }
    if (
      serverExpressionProvenance(argument, aliases) === 'foreign-executable' &&
      !serverExpressionIsReviewedDatabaseSchemaValue(sourceFile, argument)
    ) {
      return true;
    }
  }
  return false;
}

function serverExpressionIsReviewedDatabaseSchemaValue(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): boolean {
  const current = unwrapExpression(expression);
  const cached = compilerWeakMapGet(serverReviewedDatabaseSchemaValueCache, current);
  if (cached !== undefined) return cached;
  const member = staticMember(current);
  const reviewed =
    serverExpressionIsReviewedDatabaseTable(sourceFile, current) ||
    (member !== undefined && serverExpressionIsReviewedDatabaseTable(sourceFile, member.receiver));
  compilerWeakMapSet(serverReviewedDatabaseSchemaValueCache, current, reviewed);
  return reviewed;
}

function serverExpressionIsReviewedDatabaseTable(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): boolean {
  const imported = serverImportedProjectValue(sourceFile, expression);
  if (!imported) return false;
  const target = resolveFrameworkIdentityProjectSourceFile(sourceFile, imported.specifier);
  if (!target) return false;

  let declaration: ts.VariableDeclaration | undefined;
  const statements = compilerSnapshotDenseArray(
    target.statements,
    'Finite database schema source statements',
  );
  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const statement = statements[statementIndex]!;
    if (
      !ts.isVariableStatement(statement) ||
      !securityIrNodeHasExportModifier(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0
    ) {
      continue;
    }
    const declarations = compilerSnapshotDenseArray(
      statement.declarationList.declarations,
      'Finite database schema export declarations',
    );
    for (let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex += 1) {
      const candidate = declarations[declarationIndex]!;
      if (!ts.isIdentifier(candidate.name) || candidate.name.text !== imported.exportName) continue;
      if (declaration) return false;
      declaration = candidate;
    }
  }
  if (!declaration?.initializer || serverBindingOrMemberIsAssigned(target, imported.exportName)) {
    return false;
  }
  const initializer = unwrapExpression(declaration.initializer);
  if (!ts.isCallExpression(initializer)) return false;
  const factoryIdentity = canonicalFrameworkExportForExpression(
    ts as FrameworkIdentityTypeScript,
    target,
    initializer.expression,
  );
  return frameworkIdentityIn(factoryIdentity, SERVER_REVIEWED_DATABASE_TABLE_FACTORY_IDENTITIES);
}

function serverImportedProjectValue(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): ServerImportedProjectValue | undefined {
  const current = unwrapExpression(expression);
  const member = staticMember(current);
  const identifier = ts.isIdentifier(current)
    ? current
    : member && ts.isIdentifier(unwrapExpression(member.receiver))
      ? (unwrapExpression(member.receiver) as ts.Identifier)
      : undefined;
  if (!identifier) return undefined;

  let resolved: ServerImportedProjectValue | undefined;
  const statements = compilerSnapshotDenseArray(
    sourceFile.statements,
    'Finite server import statements',
  );
  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const statement = statements[statementIndex]!;
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    let exportName: string | undefined;
    if (ts.isNamedImports(bindings) && ts.isIdentifier(current)) {
      const elements = compilerSnapshotDenseArray(bindings.elements, 'Finite server named imports');
      for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
        const element = elements[elementIndex]!;
        if (element.name.text === identifier.text) {
          exportName = element.propertyName?.text ?? element.name.text;
          break;
        }
      }
    } else if (
      ts.isNamespaceImport(bindings) &&
      member !== undefined &&
      bindings.name.text === identifier.text
    ) {
      exportName = member.name;
    }
    if (!exportName) continue;
    if (resolved) return undefined;
    resolved = { exportName, specifier: statement.moduleSpecifier.text };
  }
  return resolved;
}

function securityIrNodeHasExportModifier(
  node: ts.Node & { readonly modifiers?: ts.NodeArray<ts.ModifierLike> },
): boolean {
  const modifiers = node.modifiers;
  if (!modifiers) return false;
  const snapshot = compilerSnapshotDenseArray(modifiers, 'Finite source modifiers');
  for (let index = 0; index < snapshot.length; index += 1) {
    if (snapshot[index]!.kind === ts.SyntaxKind.ExportKeyword) return true;
  }
  return false;
}

function serverBindingOrMemberIsAssigned(sourceFile: ts.SourceFile, name: string): boolean {
  let assigned = false;
  const visit = (node: ts.Node): void => {
    if (assigned) return;
    if (
      ts.isBinaryExpression(node) &&
      isAssignmentOperator(node.operatorToken.kind) &&
      rootIdentifier(node.left) === name
    ) {
      assigned = true;
      return;
    }
    const mutationOperand = ts.isDeleteExpression(node)
      ? node.expression
      : (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
          (node.operator === ts.SyntaxKind.PlusPlusToken ||
            node.operator === ts.SyntaxKind.MinusMinusToken)
        ? node.operand
        : undefined;
    if (mutationOperand && rootIdentifier(mutationOperand) === name) {
      assigned = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return assigned;
}

function serverUnreviewedCallbackArgument(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression | ts.NewExpression,
): ts.Expression | undefined {
  const callee = unwrapExpression(call.expression);
  let callbackIndex: number | undefined;
  if (ts.isNewExpression(call)) {
    if (
      ts.isIdentifier(callee) &&
      callee.text === 'Promise' &&
      !identifierIsShadowedWithinBoundary(callee, sourceFile)
    ) {
      callbackIndex = 0;
    }
  } else {
    const member = staticMember(callee);
    if (!member) return undefined;
    const receiver = unwrapExpression(member.receiver);
    const globalMember = ts.isIdentifier(receiver) ? `${receiver.text}.${member.name}` : undefined;
    callbackIndex =
      globalMember === 'Array.from'
        ? 1
        : compilerSetHas(serverCallbackInvokingMemberCalls, member.name)
          ? 0
          : undefined;
  }
  const argumentsList = call.arguments ?? [];
  if (callbackIndex === undefined || callbackIndex >= argumentsList.length) return undefined;
  const argument = argumentsList[callbackIndex]!;
  if (ts.isSpreadElement(argument)) return argument;
  const current = unwrapExpression(argument);
  if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) return undefined;
  if (
    ts.isIdentifier(current) &&
    ((current.text === 'undefined' && !identifierIsShadowedWithinBoundary(current, sourceFile)) ||
      (compilerSetHas(browserPureGlobalCalls, current.text) &&
        !identifierIsShadowedWithinBoundary(current, sourceFile)))
  ) {
    return undefined;
  }
  if (current.kind === ts.SyntaxKind.NullKeyword) return undefined;
  return argument;
}

function classifyServerProvenanceCall(
  provenance: ServerValueProvenance,
  call: ts.CallExpression,
  target: string,
  surface: SecurityOperationSurface,
  appendOperation: (
    kind: ServerSecurityOperationKind,
    node: ts.Node,
    target?: string,
    justification?: string,
  ) => void,
  appendViolation: (
    node: ts.Node,
    kind: SecurityOperationViolationModel['kind'],
    detail: string,
  ) => void,
): boolean {
  if (provenance === 'foreign-executable') {
    appendViolation(
      call,
      'computed-security-operation',
      `imported, aliased, or foreign server helper ${target} is outside the finite server IR`,
    );
    return true;
  }
  if (provenance === 'unknown-authority') {
    appendViolation(
      call,
      'computed-security-operation',
      `computed server capability call ${target} is outside the finite server IR`,
    );
    return true;
  }
  if (provenance === 'scope-call') {
    appendOperation('server.authority.scope', call, target);
    return true;
  }
  if (provenance === 'database-read-namespace') {
    appendOperation('server.database.read', call, target);
    return true;
  }
  if (provenance === 'database-write-namespace') {
    appendOperation('server.database.write', call, target);
    if (surface === 'query') {
      appendViolation(
        call,
        'raw-capability-operation',
        'query loaders cannot perform a managed database write',
      );
    }
    return true;
  }
  if (!compilerStringStartsWith(provenance, 'operation:')) {
    if (serverProvenanceCarriesAuthority(provenance)) {
      appendViolation(
        call,
        'raw-capability-operation',
        `server capability call ${target} has no reviewed finite operation`,
      );
      return true;
    }
    return false;
  }
  const kind = compilerStringSlice(provenance, 'operation:'.length) as ServerSecurityOperationKind;
  if (surface === 'query' && kind === 'server.database.write') {
    appendOperation(kind, call, target);
    appendViolation(
      call,
      'raw-capability-operation',
      'query loaders cannot perform a managed database write',
    );
    return true;
  }
  if (kind === 'server.response.raw') {
    if (surface === 'endpoint' || surface === 'webhook') {
      appendOperation(kind, call, target, `${surface} access/CSRF posture`);
    } else {
      appendViolation(
        call,
        'raw-capability-operation',
        `raw Response is not a supported ${surface} outcome`,
      );
    }
    return true;
  }
  appendOperation(kind, call, target);
  return true;
}

function serverAliasProvenance(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  parameters: readonly ts.ParameterDeclaration[],
  surface: SecurityOperationSurface,
  parameterProvenances?: readonly ServerValueProvenance[],
  inheritedEnvironment?: ServerAliasEnvironment,
): ServerAliasEnvironment {
  const module = serverModuleAliasEnvironment(sourceFile, inheritedEnvironment);
  const aliases = compilerCreateMap<string, ServerValueProvenance>();
  compilerMapForEach(module.values, (value, name) => compilerMapSet(aliases, name, value));

  const parameterSnapshot = compilerSnapshotDenseArray(parameters, 'Security-IR parameters');
  for (let index = 0; index < parameterSnapshot.length; index += 1) {
    setServerAliasPattern(
      parameterSnapshot[index]!.name,
      parameterProvenances === undefined ? 'local' : (parameterProvenances[index] ?? 'local'),
      aliases,
    );
  }
  if (parameterProvenances === undefined) {
    const contextParameter = parameterSnapshot[surface === 'mutation' ? 2 : 1];
    if (contextParameter) setServerAliasPattern(contextParameter.name, 'context', aliases);
    if (surface === 'mutation' && parameterSnapshot[1]) {
      setServerAliasPattern(parameterSnapshot[1]!.name, 'request', aliases);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node)) {
        const initializer = node.initializer;
        let provenance: ServerValueProvenance = 'local';
        if (initializer) {
          const derived = serverExpressionProvenance(initializer, aliases);
          const authority = derived;
          provenance =
            isConstVariableDeclaration(node) || authority === 'foreign-executable'
              ? authority
              : serverProvenanceCarriesAuthority(authority)
                ? 'unknown-authority'
                : 'local';
        }
        if (bindServerAliasPattern(node.name, provenance, aliases)) changed = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
  }
  return { module, sourceFile, values: aliases };
}

function serverModuleAliasEnvironment(
  sourceFile: ts.SourceFile,
  inheritedEnvironment?: ServerAliasEnvironment,
): ServerModuleAliasEnvironment {
  if (inheritedEnvironment) {
    if (
      inheritedEnvironment.sourceFile !== sourceFile ||
      inheritedEnvironment.module.sourceFile !== sourceFile
    ) {
      compilerFailClosed('Security-IR inherited aliases crossed an immutable source boundary.');
    }
    const inherited = compilerWeakMapGet(
      serverInheritedModuleAliasEnvironmentCache,
      inheritedEnvironment,
    );
    if (inherited) return inherited;
  } else {
    const root = compilerWeakMapGet(serverRootModuleAliasEnvironmentCache, sourceFile);
    if (root) return root;
  }

  const aliases = compilerCreateMap<string, ServerValueProvenance>();
  if (inheritedEnvironment) {
    compilerMapForEach(inheritedEnvironment.values, (value, name) =>
      compilerMapSet(aliases, name, value),
    );
  } else {
    compilerMapSet(aliases, 'Response', 'response-constructor');
    compilerMapSet(aliases, 'globalThis', 'global-object');
    compilerMapSet(aliases, 'Object', 'intrinsic-object');
    // Direct crypto.randomUUID() has one exact reviewed branch. Treat every other movement of the
    // ambient executable object like foreign code so aliases and opaque containers stay KV449.
    compilerMapSet(aliases, 'crypto', 'foreign-executable');
    compilerSetForEach(securityIrSourceIndex(sourceFile).foreignImportNames, (name) =>
      compilerMapSet(aliases, name, 'foreign-executable'),
    );
  }

  // SPEC §5.2/§6.6: solve the exact old module-alias fixed point once for this immutable lexical
  // parent. Caching by parent-environment identity preserves conservative name collisions while
  // avoiding an O(helper-count * module-size) rewalk of emitted semantic graphs.
  let moduleChanged = true;
  while (moduleChanged) {
    moduleChanged = false;
    const declarations = compilerSnapshotDenseArray(
      securityIrSourceIndex(sourceFile).moduleConstDeclarations,
      'Security-IR module aliases',
    );
    for (let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex += 1) {
      const declaration = declarations[declarationIndex]!;
      const initializer = declaration.initializer;
      if (!initializer) continue;
      let provenance =
        serverModuleFrameworkCapabilityFactoryProvenance(sourceFile, initializer, aliases) ??
        serverExpressionProvenance(initializer, aliases);
      if (
        !serverProvenanceCarriesAuthority(provenance) &&
        serverModuleInitializerReturnsAuthority(
          sourceFile,
          initializer,
          aliases,
          compilerCreateSet<string>(),
          0,
        )
      ) {
        provenance = 'unknown-authority';
      }
      if (
        ts.isIdentifier(declaration.name) &&
        moduleBindingIsAssigned(sourceFile, declaration.name.text) &&
        serverProvenanceCarriesAuthority(provenance)
      ) {
        provenance = 'unknown-authority';
      }
      if (bindServerAliasPattern(declaration.name, provenance, aliases)) moduleChanged = true;
    }
  }

  const environment: ServerModuleAliasEnvironment = { sourceFile, values: aliases };
  if (inheritedEnvironment) {
    compilerWeakMapSet(
      serverInheritedModuleAliasEnvironmentCache,
      inheritedEnvironment,
      environment,
    );
  } else {
    compilerWeakMapSet(serverRootModuleAliasEnvironmentCache, sourceFile, environment);
  }
  return environment;
}

function serverModuleFrameworkCapabilityFactoryProvenance(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): ServerValueProvenance | undefined {
  const current = unwrapExpression(expression);
  if (!ts.isCallExpression(current)) return undefined;
  const callee = unwrapExpression(current.expression);
  const identity = canonicalFrameworkExportForExpression(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    callee,
  );
  if (!frameworkIdentityIn(identity, SERVER_STORAGE_FACTORY_IDENTITIES)) return undefined;
  if (
    !securityIrExpressionUsesDirectImportBinding(sourceFile, callee) ||
    !securityIrMemberCallableIsStable(sourceFile, callee, current) ||
    serverArgumentsContainAuthority(current.arguments, aliases) ||
    serverArgumentsContainForeignExecutable(current.arguments, aliases)
  ) {
    return 'unknown-authority';
  }
  // SPEC §6.6: a module-scope immutable result of the exact reviewed storage factory is a finite
  // storage capability. Request-time factories and mutable/aliased/lookalike callables never reach
  // this module-constant fixed point.
  return 'storage';
}

function serverModuleInitializerReturnsAuthority(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
  active: Set<string>,
  depth: number,
): boolean {
  if (depth > SECURITY_SEMANTIC_CALL_DEPTH_BUDGET) return true;
  const current = unwrapExpression(expression);
  if (!ts.isCallExpression(current)) return false;
  const callee = unwrapExpression(current.expression);
  if (!ts.isIdentifier(callee)) return false;
  const callable = resolveSameFileSecurityIrCallable(sourceFile, callee);
  if (!callable) return false;
  const key = `${callable.declaration.getStart(sourceFile)}:${callable.declaration.getEnd()}`;
  if (compilerSetHas(active, key)) return true;
  compilerSetAdd(active, key);
  try {
    const callableAliases = compilerCreateMap<string, ServerValueProvenance>();
    compilerMapForEach(aliases, (value, name) => compilerMapSet(callableAliases, name, value));
    const argumentsList = compilerSnapshotDenseArray(
      current.arguments,
      'Security-IR module helper arguments',
    );
    const parameters = compilerSnapshotDenseArray(
      callable.parameters,
      'Security-IR module helper parameters',
    );
    for (let index = 0; index < parameters.length; index += 1) {
      const argument = argumentsList[index];
      setServerAliasPattern(
        parameters[index]!.name,
        argument === undefined ? 'local' : serverExpressionProvenance(argument, aliases),
        callableAliases,
      );
    }

    let changed = true;
    while (changed) {
      changed = false;
      const visitBindings = (node: ts.Node): void => {
        if (node !== callable.body && isSecurityIrFunctionScope(node)) return;
        if (ts.isVariableDeclaration(node)) {
          const provenance = node.initializer
            ? serverExpressionProvenance(node.initializer, callableAliases)
            : 'local';
          if (bindServerAliasPattern(node.name, provenance, callableAliases)) changed = true;
        }
        ts.forEachChild(node, visitBindings);
      };
      visitBindings(callable.body);
    }

    const returnExpressions: ts.Expression[] = [];
    if (!ts.isBlock(callable.body)) {
      compilerArrayAppend(returnExpressions, callable.body, 'Security-IR module helper returns');
    } else {
      const visitReturns = (node: ts.Node): void => {
        if (node !== callable.body && isSecurityIrFunctionScope(node)) return;
        if (ts.isReturnStatement(node) && node.expression) {
          compilerArrayAppend(
            returnExpressions,
            node.expression,
            'Security-IR module helper returns',
          );
          return;
        }
        ts.forEachChild(node, visitReturns);
      };
      visitReturns(callable.body);
    }
    const returns = compilerSnapshotDenseArray(
      returnExpressions,
      'Security-IR module helper returns',
    );
    for (let index = 0; index < returns.length; index += 1) {
      const returned = returns[index]!;
      if (serverExpressionCarriesAuthority(returned, callableAliases)) return true;
      if (
        serverModuleInitializerReturnsAuthority(
          sourceFile,
          returned,
          callableAliases,
          active,
          depth + 1,
        )
      ) {
        return true;
      }
    }
    return false;
  } finally {
    compilerSetDelete(active, key);
  }
}

function bindServerAliasPattern(
  name: ts.BindingName,
  provenance: ServerValueProvenance,
  aliases: Map<string, ServerValueProvenance>,
): boolean {
  if (ts.isIdentifier(name)) {
    return joinServerAlias(name.text, provenance, aliases);
  }
  let changed = false;
  const elements = compilerSnapshotDenseArray(name.elements, 'Security-IR server bindings');
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (ts.isOmittedExpression(element)) continue;
    const property =
      staticPropertyName(
        element.propertyName ?? (ts.isIdentifier(element.name) ? element.name : undefined),
      ) ?? 'computed';
    const projectedProvenance = element.dotDotDotToken
      ? serverProvenanceCarriesAuthority(provenance)
        ? 'unknown-authority'
        : 'local'
      : serverMemberProvenance(provenance, property);
    const elementProvenance = serverProvenanceWithBindingDefault(
      projectedProvenance,
      element.initializer,
      aliases,
    );
    if (bindServerAliasPattern(element.name, elementProvenance, aliases)) changed = true;
  }
  return changed;
}

function setServerAliasPattern(
  name: ts.BindingName,
  provenance: ServerValueProvenance,
  aliases: Map<string, ServerValueProvenance>,
): void {
  if (ts.isIdentifier(name)) {
    compilerMapSet(aliases, name.text, provenance);
    return;
  }
  const elements = compilerSnapshotDenseArray(name.elements, 'Security-IR server parameters');
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (ts.isOmittedExpression(element)) continue;
    const property =
      staticPropertyName(
        element.propertyName ?? (ts.isIdentifier(element.name) ? element.name : undefined),
      ) ?? 'computed';
    const projectedProvenance = element.dotDotDotToken
      ? serverProvenanceCarriesAuthority(provenance)
        ? 'unknown-authority'
        : 'local'
      : serverMemberProvenance(provenance, property);
    const elementProvenance = serverProvenanceWithBindingDefault(
      projectedProvenance,
      element.initializer,
      aliases,
    );
    setServerAliasPattern(element.name, elementProvenance, aliases);
  }
}

function serverProvenanceWithBindingDefault(
  projected: ServerValueProvenance,
  initializer: ts.Expression | undefined,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): ServerValueProvenance {
  if (!initializer) return projected;
  const fallback = serverExpressionProvenance(initializer, aliases);
  if (serverProvenanceCarriesAuthority(projected) || serverProvenanceCarriesAuthority(fallback)) {
    return projected === fallback ? projected : 'unknown-authority';
  }
  return projected === 'foreign-executable' || fallback === 'foreign-executable'
    ? 'foreign-executable'
    : projected;
}

function joinServerAlias(
  name: string,
  provenance: ServerValueProvenance,
  aliases: Map<string, ServerValueProvenance>,
): boolean {
  const previous = compilerMapGet(aliases, name);
  if (previous === provenance || previous === 'unknown-authority') return false;
  compilerMapSet(aliases, name, previous === undefined ? provenance : 'unknown-authority');
  return true;
}

function serverExpressionProvenance(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): ServerValueProvenance {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return compilerMapGet(aliases, current.text) ?? 'local';
  if (ts.isObjectLiteralExpression(current) && serverObjectLiteralHasImplicitCallable(current)) {
    return 'unknown-authority';
  }
  if (ts.isNewExpression(current)) {
    const constructor = serverExpressionProvenance(current.expression, aliases);
    if (constructor === 'response-constructor') return 'response-outcome';
    if (constructor === 'foreign-executable') return 'foreign-executable';
    if (
      serverProvenanceCarriesAuthority(constructor) ||
      serverArgumentsContainAuthority(current.arguments ?? [], aliases)
    ) {
      return 'unknown-authority';
    }
    return 'local';
  }
  if (ts.isCallExpression(current)) {
    const callee = serverExpressionProvenance(current.expression, aliases);
    if (callee === 'scope-call') return 'context';
    if (callee === 'intrinsic-identity-call') {
      return current.arguments.length === 1
        ? serverExpressionProvenance(current.arguments[0]!, aliases)
        : 'unknown-authority';
    }
    if (callee === 'response-constructor' || callee === 'operation:server.response.raw') {
      return 'response-outcome';
    }
    if (callee === 'unknown-authority') return 'unknown-authority';
    return 'local';
  }
  if (ts.isBinaryExpression(current)) {
    const left = serverExpressionProvenance(current.left, aliases);
    const right = serverExpressionProvenance(current.right, aliases);
    if (serverProvenanceCarriesAuthority(left) || serverProvenanceCarriesAuthority(right)) {
      return 'unknown-authority';
    }
    return left === 'foreign-executable' || right === 'foreign-executable'
      ? 'foreign-executable'
      : 'local';
  }
  if (ts.isConditionalExpression(current)) {
    const whenTrue = serverExpressionProvenance(current.whenTrue, aliases);
    const whenFalse = serverExpressionProvenance(current.whenFalse, aliases);
    if (whenTrue === whenFalse) return whenTrue;
    if (serverProvenanceCarriesAuthority(whenTrue) || serverProvenanceCarriesAuthority(whenFalse)) {
      return 'unknown-authority';
    }
    return whenTrue === 'foreign-executable' || whenFalse === 'foreign-executable'
      ? 'foreign-executable'
      : 'local';
  }
  const member = staticMember(current);
  if (member) {
    return serverMemberProvenance(
      serverExpressionProvenance(member.receiver, aliases),
      member.name,
    );
  }
  if (expressionContainsServerForeignExecutable(current, aliases)) return 'foreign-executable';
  return expressionContainsServerAuthority(current, aliases) ? 'unknown-authority' : 'local';
}

function serverObjectLiteralHasImplicitCallable(object: ts.ObjectLiteralExpression): boolean {
  const properties = compilerSnapshotDenseArray(
    object.properties,
    'Finite server object properties',
  );
  for (let index = 0; index < properties.length; index += 1) {
    const property = properties[index]!;
    if (ts.isGetAccessor(property) || ts.isSetAccessor(property)) return true;
    if (
      (ts.isMethodDeclaration(property) ||
        ts.isPropertyAssignment(property) ||
        ts.isShorthandPropertyAssignment(property)) &&
      serverObjectPropertyIsImplicitProtocol(property.name)
    ) {
      return true;
    }
  }
  return false;
}

function serverObjectPropertyIsImplicitProtocol(name: ts.PropertyName): boolean {
  const direct = staticPropertyName(name);
  if (direct && compilerSetHas(serverImplicitObjectProtocolMembers, direct)) return true;
  if (!ts.isComputedPropertyName(name)) return false;
  const member = staticMember(name.expression);
  if (!member || !compilerSetHas(serverImplicitObjectProtocolMembers, member.name)) return false;
  const receiver = unwrapExpression(member.receiver);
  return ts.isIdentifier(receiver) && receiver.text === 'Symbol';
}

function expressionContainsServerForeignExecutable(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== expression && isSecurityIrFunctionScope(node)) return;
    if (node !== expression && (ts.isCallExpression(node) || ts.isNewExpression(node))) return;
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      if (
        !(
          (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
          (ts.isPropertyAssignment(parent) && parent.name === node)
        ) &&
        compilerMapGet(aliases, node.text) === 'foreign-executable'
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

function serverMemberProvenance(
  receiver: ServerValueProvenance,
  member: string,
): ServerValueProvenance {
  if (receiver === 'unknown-authority') return receiver;
  if (receiver === 'foreign-executable') return receiver;
  // Every other finite operation is an exact callable sink, not a first-class capability object.
  if (compilerStringStartsWith(receiver, 'operation:')) return 'unknown-authority';
  if (receiver === 'context') {
    if (member === 'db' || member === 'readonlyAppDb' || member === 'tx') return 'database';
    if (member === 'headers') return 'headers';
    if (member === 'respond') return 'respond';
    if (member === 'storage') return 'storage';
    if (member === 'request') return 'request';
    if (member === 'tx') return 'database';
    if (member === 'fetch') return serverOperationProvenance('server.egress.request');
    if (
      member === 'forwardSetCookie' ||
      member === 'setCookie' ||
      member === 'setSessionRevocationClearSiteData'
    ) {
      return serverOperationProvenance('server.response.cookie');
    }
    if (member === 'fail') return serverOperationProvenance('server.response.outcome');
    if (
      member === 'invalidate' ||
      member === 'recordChange' ||
      member === 'runMutation' ||
      member === 'runQuery' ||
      member === 'schedule'
    ) {
      return serverOperationProvenance('server.task.compose');
    }
    if (member === 'actAs' || member === 'declareSystemRead' || member === 'declareSystemWrite') {
      return 'scope-call';
    }
    if (member === 'header') return 'safe-call';
    return 'unknown-authority';
  }
  if (receiver === 'request') {
    if (member === 'db' || member === 'readonlyAppDb' || member === 'tx') return 'database';
    if (member === 'cancel' || member === 'schedule') {
      return serverOperationProvenance('server.task.compose');
    }
    return 'local';
  }
  if (receiver === 'database') {
    if (member === 'read') return 'database-read-namespace';
    if (member === 'write') return 'database-write-namespace';
    if (member === 'query') return 'database-relational-query-namespace';
    const kind = databaseOperationKind(member);
    if (kind) return serverOperationProvenance(kind);
    if (isRawDatabaseCapabilityMember(member)) {
      return 'unknown-authority';
    }
    // Managed request handles support one exact static table namespace before a reviewed terminal
    // (`request.db.products.get`). Further unknown namespace traversal closes below.
    return 'database-table-namespace';
  }
  if (receiver === 'database-read-namespace') {
    if (member === 'query') return 'database-relational-query-namespace';
    return databaseOperationKind(member) === 'server.database.read'
      ? serverOperationProvenance('server.database.read')
      : 'unknown-authority';
  }
  if (receiver === 'database-write-namespace') {
    return databaseOperationKind(member) === 'server.database.write'
      ? serverOperationProvenance('server.database.write')
      : 'unknown-authority';
  }
  if (receiver === 'database-table-namespace') {
    // The generic one-member namespace exists for plain application table collections such as
    // `request.db.products.get(...)`. It is not a second raw-driver door: SQL/execution and write
    // terminals stay on the exact managed DB receiver/`read`/`write` namespaces, while an
    // arbitrary `db.driver.execute(...)`-shaped chain remains absorbing unknown authority.
    return member === 'all' || member === 'count' || member === 'get' || member === 'values'
      ? serverOperationProvenance('server.database.read')
      : 'unknown-authority';
  }
  if (receiver === 'database-relational-query-namespace') {
    // Drizzle relational queries admit one exact static table member. Computed members never reach
    // this transition because `staticMember` rejects them into absorbing unknown authority.
    return 'database-relational-table-namespace';
  }
  if (receiver === 'database-relational-table-namespace') {
    return member === 'findFirst' || member === 'findMany'
      ? serverOperationProvenance('server.database.read')
      : 'unknown-authority';
  }
  if (receiver === 'headers') {
    if (member === 'append' || member === 'delete' || member === 'set') {
      return serverOperationProvenance('server.response.header');
    }
    if (member === 'entries' || member === 'get' || member === 'has' || member === 'keys') {
      return 'safe-call';
    }
    return 'unknown-authority';
  }
  if (receiver === 'storage') {
    if (member === 'get' || member === 'list' || member === 'signUrl' || member === 'stat') {
      return serverOperationProvenance('server.storage.read');
    }
    if (member === 'delete' || member === 'put') {
      return serverOperationProvenance('server.storage.write');
    }
    return 'unknown-authority';
  }
  if (receiver === 'respond') {
    if (member === 'file' || member === 'stream') {
      return serverOperationProvenance('server.response.outcome');
    }
    return 'unknown-authority';
  }
  if (receiver === 'global-object') {
    return member === 'Response' ? 'response-constructor' : 'unknown-authority';
  }
  if (receiver === 'intrinsic-object') {
    return member === 'freeze' || member === 'seal' || member === 'preventExtensions'
      ? 'intrinsic-identity-call'
      : 'local';
  }
  if (receiver === 'response-constructor') {
    if (member === 'error' || member === 'json' || member === 'redirect') {
      return serverOperationProvenance('server.response.raw');
    }
    return 'unknown-authority';
  }
  if (receiver === 'response-outcome') return 'unknown-authority';
  return 'local';
}

function isRawDatabaseCapabilityMember(member: string): boolean {
  return (
    member === '$client' ||
    member === 'client' ||
    member === 'pglite' ||
    member === 'session' ||
    member === 'sqlite'
  );
}

function serverOperationProvenance(
  kind: ServerSecurityOperationKind,
): `operation:${ServerSecurityOperationKind}` {
  return `operation:${kind}`;
}

function serverProvenanceCarriesAuthority(provenance: ServerValueProvenance | undefined): boolean {
  return (
    provenance !== undefined &&
    provenance !== 'foreign-executable' &&
    provenance !== 'intrinsic-identity-call' &&
    provenance !== 'intrinsic-object' &&
    provenance !== 'local' &&
    provenance !== 'safe-call'
  );
}

function expressionContainsServerAuthority(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const result = serverExpressionProvenance(node, aliases);
      if (serverProvenanceCarriesAuthority(result)) found = true;
      // A reviewed operation consumes its receiver and returns plain data. An unreviewed call that
      // receives authority is diagnosed at that call site; its result is not itself a capability.
      return;
    }
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      if (
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node)
      ) {
        return;
      }
      if (serverProvenanceCarriesAuthority(compilerMapGet(aliases, node.text))) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

function serverExpressionCarriesAuthority(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  return serverProvenanceCarriesAuthority(serverExpressionProvenance(expression, aliases));
}

function serverArgumentsContainAuthority(
  argumentsList: readonly ts.Expression[],
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  const snapshot = compilerSnapshotDenseArray(
    argumentsList,
    'Server security-operation call arguments',
  );
  for (let index = 0; index < snapshot.length; index += 1) {
    if (serverExpressionCarriesAuthority(snapshot[index]!, aliases)) return true;
  }
  return false;
}

function serverArgumentsContainForeignExecutable(
  argumentsList: readonly ts.Expression[],
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  const snapshot = compilerSnapshotDenseArray(
    argumentsList,
    'Server security-operation foreign arguments',
  );
  for (let index = 0; index < snapshot.length; index += 1) {
    const argument = snapshot[index]!;
    const expression = ts.isSpreadElement(argument) ? argument.expression : argument;
    if (serverExpressionProvenance(expression, aliases) === 'foreign-executable') return true;
  }
  return false;
}

function isConstVariableDeclaration(declaration: ts.VariableDeclaration): boolean {
  const list = declaration.parent;
  return ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
}

function databaseOperationKind(method: string): ServerSecurityOperationKind | undefined {
  if (
    method === 'count' ||
    method === 'findFirst' ||
    method === 'findMany' ||
    method === 'read' ||
    method === 'select' ||
    method === 'get' ||
    method === 'all' ||
    method === 'values' ||
    method === 'rawRead'
  ) {
    return 'server.database.read';
  }
  if (
    method === 'batch' ||
    method === 'delete' ||
    method === 'execute' ||
    method === 'insert' ||
    method === 'put' ||
    method === 'run' ||
    method === 'transaction' ||
    method === 'update' ||
    method === 'write'
  ) {
    return 'server.database.write';
  }
  return undefined;
}

function isStructuredServerReceiver(root: string): boolean {
  return (
    root === 'Response' ||
    root === 'context' ||
    root === 'ctx' ||
    root === 'db' ||
    root === 'headers' ||
    root === 'readonlyAppDb' ||
    root === 'respond' ||
    root === 'storage' ||
    root === 'tx'
  );
}

function justificationFromCall(call: ts.CallExpression): string | undefined {
  const argumentsSnapshot = compilerSnapshotDenseArray(call.arguments, 'Security escape arguments');
  // Argument zero is the trusted value itself; only trailing metadata can justify the escape.
  for (let index = argumentsSnapshot.length - 1; index >= 1; index -= 1) {
    const argument = unwrapExpression(argumentsSnapshot[index]!);
    if (ts.isStringLiteralLike(argument) && compilerStringTrim(argument.text).length > 0) {
      return argument.text;
    }
    if (!ts.isObjectLiteralExpression(argument)) continue;
    const properties = compilerSnapshotDenseArray(
      argument.properties,
      'Security escape option properties',
    );
    for (let propertyIndex = 0; propertyIndex < properties.length; propertyIndex += 1) {
      const property = properties[propertyIndex]!;
      if (!ts.isPropertyAssignment(property)) continue;
      const name = staticPropertyName(property.name);
      if (name !== 'justification' && name !== 'reason') continue;
      const value = unwrapExpression(property.initializer);
      return ts.isStringLiteralLike(value) && compilerStringTrim(value.text).length > 0
        ? value.text
        : undefined;
    }
  }
  return undefined;
}

function frameworkIdentityIn(
  candidate: FrameworkExportIdentity | undefined,
  expected: readonly FrameworkExportIdentity[],
): boolean {
  if (candidate === undefined) return false;
  const length = compilerArrayLength(expected, 'Finite server-operation identities');
  for (let index = 0; index < length; index += 1) {
    const identity = compilerOwnDataValue(expected, index, 'Finite server-operation identities') as
      | FrameworkExportIdentity
      | undefined;
    if (!identity) {
      throw new TypeError(`Finite server-operation identities[${index}] must be own data.`);
    }
    if (frameworkExportEquals(candidate, identity)) return true;
  }
  return false;
}

function browserAliasProvenance(body: ts.ConciseBody): ReadonlyMap<string, BrowserValueProvenance> {
  const aliases = compilerCreateMap<string, BrowserValueProvenance>();
  compilerMapSet(aliases, 'state', 'state');
  compilerMapSet(aliases, 'event', 'event');
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node)) {
        const initializer = node.initializer;
        const derived = initializer
          ? browserExpressionProvenance(initializer, aliases, body)
          : 'local';
        const authority: BrowserValueProvenance =
          derived !== 'unknown'
            ? derived
            : initializer && expressionContainsBrowserAuthority(initializer, aliases, body)
              ? 'unknown-authority'
              : 'unknown';
        const provenance =
          isConstVariableDeclaration(node) || !browserProvenanceCarriesAuthority(authority)
            ? authority
            : 'unknown-authority';
        if (provenance !== 'unknown' && bindBrowserAliasPattern(node.name, provenance, aliases)) {
          changed = true;
        }
      } else if (ts.isParameter(node)) {
        if (bindBrowserAliasPattern(node.name, 'local', aliases)) changed = true;
      } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
        if (joinBrowserAlias(node.name.text, 'local', aliases)) changed = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
  }
  return aliases;
}

function browserExpressionProvenance(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  boundary: ts.ConciseBody,
): BrowserValueProvenance {
  const current = unwrapExpression(expression);
  if (
    ts.isStringLiteralLike(current) ||
    ts.isNumericLiteral(current) ||
    ts.isRegularExpressionLiteral(current) ||
    current.kind === ts.SyntaxKind.TrueKeyword ||
    current.kind === ts.SyntaxKind.FalseKeyword ||
    current.kind === ts.SyntaxKind.NullKeyword
  ) {
    return 'local';
  }
  if (ts.isIdentifier(current)) {
    if (
      (current.text === 'setTimeout' || current.text === 'setInterval') &&
      !identifierIsShadowedWithinBoundary(current, boundary)
    ) {
      return browserOperationProvenance('browser.timer.schedule');
    }
    if (
      (current.text === 'clearTimeout' || current.text === 'clearInterval') &&
      !identifierIsShadowedWithinBoundary(current, boundary)
    ) {
      return browserOperationProvenance('browser.timer.cancel');
    }
    if (
      compilerSetHas(rawBrowserGlobalNames, current.text) &&
      !identifierIsShadowedWithinBoundary(current, boundary)
    ) {
      return 'raw-browser';
    }
    return compilerMapGet(aliases, current.text) ?? 'unknown';
  }
  if (ts.isCallExpression(current)) {
    const callee = unwrapExpression(current.expression);
    if (
      ts.isIdentifier(callee) &&
      callee.text === 'Object' &&
      !identifierIsShadowedWithinBoundary(callee, boundary)
    ) {
      const first = current.arguments[0];
      return first ? browserExpressionProvenance(first, aliases, boundary) : 'unknown';
    }
    if (ts.isIdentifier(callee)) {
      // The call itself is independently required to be a local callable, a finite global, or an
      // exact reviewed client export. Its return is plain data unless one of the explicit DOM
      // carrier methods below says otherwise.
      return 'local';
    }
    const member = staticMember(callee);
    if (member) {
      const receiver = browserExpressionProvenance(member.receiver, aliases, boundary);
      if (receiver === 'local') return 'local';
      if (member.name === 'closest' || member.name === 'querySelector') {
        return isDomProvenance(receiver) || receiver === 'event' ? 'dom' : 'unknown';
      }
      if (member.name === 'getElementById' && rootIdentifier(member.receiver) === 'document') {
        return 'dom';
      }
      return 'local';
    }
  }
  const member = staticMember(current);
  if (member) {
    const receiver = browserExpressionProvenance(member.receiver, aliases, boundary);
    const receiverOperation = browserOperationProvenanceKind(receiver);
    if (receiverOperation !== undefined) {
      return member.name === 'call' || member.name === 'apply' || member.name === 'bind'
        ? receiver
        : 'unknown-authority';
    }
    if (receiver === 'state') return 'state';
    if (receiver === 'event') {
      if (member.name === 'form') return 'form';
      if (member.name === 'target' || member.name === 'currentTarget') return 'dom';
      if (compilerSetHas(browserEventControlMethods, member.name)) {
        return browserOperationProvenance('browser.event.control');
      }
      if (compilerSetHas(browserDomReadMethods, member.name)) {
        return browserOperationProvenance('browser.event.read');
      }
      if (compilerSetHas(browserEventScalarMembers, member.name)) return 'local';
      return 'event';
    }
    if (receiver === 'dom' || receiver === 'form') {
      if (member.name === 'form') return 'form';
      if (compilerSetHas(browserDomReadMethods, member.name)) {
        return browserOperationProvenance('browser.event.read');
      }
      if (compilerSetHas(browserDomScalarMembers, member.name)) return 'local';
      return receiver;
    }
    if (receiver === 'raw-browser') {
      if (member.name === 'setTimeout' || member.name === 'setInterval') {
        return browserOperationProvenance('browser.timer.schedule');
      }
      if (member.name === 'clearTimeout' || member.name === 'clearInterval') {
        return browserOperationProvenance('browser.timer.cancel');
      }
      return receiver;
    }
    if (receiver === 'unknown-authority') {
      return 'unknown-authority';
    }
    const root = rootIdentifier(member.receiver);
    if (root === 'document') return 'dom';
  }
  return 'unknown';
}

function browserMutationTargetProvenance(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  boundary: ts.ConciseBody,
): BrowserValueProvenance {
  const current = unwrapExpression(expression);
  const member = staticMember(current);
  return member
    ? browserExpressionProvenance(member.receiver, aliases, boundary)
    : browserExpressionProvenance(current, aliases, boundary);
}

function bindBrowserAliasPattern(
  name: ts.BindingName,
  provenance: BrowserValueProvenance,
  aliases: Map<string, BrowserValueProvenance>,
): boolean {
  if (ts.isIdentifier(name)) return joinBrowserAlias(name.text, provenance, aliases);
  let changed = false;
  const elements = compilerSnapshotDenseArray(name.elements, 'Security-IR browser bindings');
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (ts.isOmittedExpression(element)) continue;
    const childProvenance = browserProvenanceCarriesAuthority(provenance)
      ? provenance === 'state'
        ? 'state'
        : provenance === 'raw-browser'
          ? 'raw-browser'
          : provenance === 'unknown-authority'
            ? 'unknown-authority'
            : provenance
      : 'local';
    if (bindBrowserAliasPattern(element.name, childProvenance, aliases)) changed = true;
  }
  return changed;
}

function joinBrowserAlias(
  name: string,
  provenance: BrowserValueProvenance,
  aliases: Map<string, BrowserValueProvenance>,
): boolean {
  const previous = compilerMapGet(aliases, name);
  if (previous === provenance || previous === 'unknown-authority') return false;
  compilerMapSet(aliases, name, previous === undefined ? provenance : 'unknown-authority');
  return true;
}

function browserProvenanceCarriesAuthority(
  provenance: BrowserValueProvenance | undefined,
): boolean {
  return provenance !== undefined && provenance !== 'local' && provenance !== 'unknown';
}

function browserOperationProvenance(
  kind: BrowserSecurityOperationKind,
): `operation:${BrowserSecurityOperationKind}` {
  return `operation:${kind}`;
}

function browserOperationProvenanceKind(
  provenance: BrowserValueProvenance,
): BrowserSecurityOperationKind | undefined {
  return compilerStringStartsWith(provenance, 'operation:')
    ? (compilerStringSlice(provenance, 'operation:'.length) as BrowserSecurityOperationKind)
    : undefined;
}

function expressionContainsBrowserAuthority(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  boundary: ts.ConciseBody,
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      node !== expression &&
      ts.isExpression(node) &&
      browserExpressionProvenance(node, aliases, boundary) === 'local'
    ) {
      // A finite scalar read (for example event.target.value) has discharged the carrier. Do not
      // rediscover the DOM root by descending through that already-classified value expression.
      return;
    }
    if (
      node !== expression &&
      ts.isExpression(node) &&
      browserExpressionProvenance(node, aliases, boundary) === 'state' &&
      browserStateValueIsConsumedAsScalar(node)
    ) {
      return;
    }
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      if (
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node)
      ) {
        return;
      }
      if (browserProvenanceCarriesAuthority(browserExpressionProvenance(node, aliases, boundary))) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

function browserStateValueIsConsumedAsScalar(expression: ts.Expression): boolean {
  const parent = expression.parent;
  return (
    ts.isBinaryExpression(parent) ||
    ts.isConditionalExpression(parent) ||
    ts.isTemplateSpan(parent) ||
    ts.isPrefixUnaryExpression(parent) ||
    ts.isPostfixUnaryExpression(parent) ||
    ts.isTypeOfExpression(parent)
  );
}

function callArgumentsContainBrowserAuthority(
  call: ts.CallExpression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  boundary: ts.ConciseBody,
): boolean {
  return browserArgumentsContainAuthority(call.arguments, aliases, boundary);
}

function browserArgumentsContainAuthority(
  argumentsList: readonly ts.Expression[],
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  boundary: ts.ConciseBody,
): boolean {
  const argumentsSnapshot = compilerSnapshotDenseArray(
    argumentsList,
    'Browser security-operation call arguments',
  );
  for (let index = 0; index < argumentsSnapshot.length; index += 1) {
    const argument = argumentsSnapshot[index]!;
    if (
      browserProvenanceCarriesAuthority(browserExpressionProvenance(argument, aliases, boundary)) ||
      expressionContainsBrowserAuthority(argument, aliases, boundary)
    ) {
      return true;
    }
  }
  return false;
}

function isDomProvenance(value: BrowserValueProvenance): boolean {
  return value === 'dom' || value === 'form';
}

function localBindingNames(node: ts.Node): ReadonlySet<string> {
  const names = compilerCreateSet<string>();
  const visit = (current: ts.Node): void => {
    if (ts.isVariableDeclaration(current) || ts.isParameter(current)) {
      collectBindingNames(current.name, names);
    } else if (
      (ts.isFunctionDeclaration(current) || ts.isClassDeclaration(current)) &&
      current.name
    ) {
      compilerSetAdd(names, current.name.text);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return names;
}

/**
 * Lexical identity check for the few ambient browser names in the finite IR. A flat name census
 * is not sufficient: a nested shadow must not make an outer `document`/timer use look local, and
 * a sibling shadow must not launder ambient authority. This mirrors the parser's symbol-identity
 * rule without requiring a TypeScript type checker.
 */
function identifierIsShadowedWithinBoundary(identifier: ts.Identifier, boundary: ts.Node): boolean {
  let current: ts.Node | undefined = identifier.parent;
  while (current && current !== boundary) {
    if (
      isSecurityIrLexicalScope(current) &&
      securityIrScopeDeclaresName(current, identifier.text)
    ) {
      return true;
    }
    current = current.parent;
  }
  return securityIrScopeDeclaresName(boundary, identifier.text);
}

function securityIrScopeDeclaresName(scope: ts.Node, name: string): boolean {
  let found = false;

  const visitBindingName = (bindingName: ts.BindingName): void => {
    if (ts.isIdentifier(bindingName)) {
      if (bindingName.text === name) found = true;
      return;
    }
    const elements = compilerSnapshotDenseArray(
      bindingName.elements,
      'Security-IR lexical binding elements',
    );
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index]!;
      if (!ts.isOmittedExpression(element)) visitBindingName(element.name);
    }
  };

  const visit = (node: ts.Node, insideNestedLexicalBlock: boolean): void => {
    if (found) return;
    if (node !== scope && isSecurityIrFunctionScope(node)) {
      if (ts.isFunctionDeclaration(node) && node.name && !insideNestedLexicalBlock) {
        visitBindingName(node.name);
      }
      return;
    }
    if (node !== scope && ts.isClassDeclaration(node)) {
      if (node.name && !insideNestedLexicalBlock) visitBindingName(node.name);
      return;
    }
    if (
      ts.isImportDeclaration(node) &&
      !insideNestedLexicalBlock &&
      securityIrImportDeclaresName(node, name)
    ) {
      found = true;
      return;
    }
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

function isSecurityIrLexicalScope(node: ts.Node): boolean {
  return (
    ts.isSourceFile(node) ||
    ts.isBlock(node) ||
    ts.isModuleBlock(node) ||
    isSecurityIrFunctionScope(node)
  );
}

function isSecurityIrFunctionScope(node: ts.Node): node is ts.FunctionLikeDeclaration {
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

function collectBindingNames(name: ts.BindingName, target: Set<string>): void {
  if (ts.isIdentifier(name)) {
    compilerSetAdd(target, name.text);
    return;
  }
  const elements = compilerSnapshotDenseArray(name.elements, 'Security IR binding elements');
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (!ts.isOmittedExpression(element)) collectBindingNames(element.name, target);
  }
}

function staticMember(
  expression: ts.Expression,
): { name: string; receiver: ts.Expression } | undefined {
  const current = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(current)) {
    return { name: current.name.text, receiver: current.expression };
  }
  if (ts.isElementAccessExpression(current) && current.argumentExpression) {
    const key = unwrapExpression(current.argumentExpression);
    if (ts.isStringLiteralLike(key)) return { name: key.text, receiver: current.expression };
  }
  return undefined;
}

function rootIdentifier(expression: ts.Expression): string | undefined {
  let current = unwrapExpression(expression);
  while (true) {
    if (ts.isIdentifier(current)) return current.text;
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = unwrapExpression(current.expression);
      continue;
    }
    if (ts.isCallExpression(current)) {
      const callee = unwrapExpression(current.expression);
      if (ts.isIdentifier(callee) && callee.text === 'Object' && current.arguments[0]) {
        current = unwrapExpression(current.arguments[0]!);
        continue;
      }
    }
    return undefined;
  }
}

function expressionPath(expression: ts.Expression): string | undefined {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return current.text;
  const member = staticMember(current);
  if (!member) return undefined;
  const receiver = expressionPath(member.receiver);
  return receiver ? `${receiver}.${member.name}` : undefined;
}

function browserExpressionTarget(expression: ts.Expression): string | undefined {
  return expressionPath(expression);
}

function nodeName(node: ts.Node): string {
  if (ts.isIdentifier(node)) return node.text;
  const member = ts.isExpression(node) ? staticMember(node) : undefined;
  return member?.name ?? 'computed';
}

function staticPropertyName(name: ts.PropertyName | undefined): string | undefined {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isAwaitExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function serverBinaryOperatorExecutesCoercion(kind: ts.SyntaxKind): boolean {
  switch (kind) {
    case ts.SyntaxKind.AsteriskToken:
    case ts.SyntaxKind.AsteriskAsteriskToken:
    case ts.SyntaxKind.BarToken:
    case ts.SyntaxKind.CaretToken:
    case ts.SyntaxKind.EqualsEqualsToken:
    case ts.SyntaxKind.ExclamationEqualsToken:
    case ts.SyntaxKind.GreaterThanEqualsToken:
    case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
    case ts.SyntaxKind.GreaterThanGreaterThanToken:
    case ts.SyntaxKind.GreaterThanToken:
    case ts.SyntaxKind.LessThanEqualsToken:
    case ts.SyntaxKind.LessThanLessThanToken:
    case ts.SyntaxKind.LessThanToken:
    case ts.SyntaxKind.MinusToken:
    case ts.SyntaxKind.PercentToken:
    case ts.SyntaxKind.PlusToken:
    case ts.SyntaxKind.SlashToken:
    case ts.SyntaxKind.AmpersandToken:
      return true;
    default:
      return false;
  }
}

function dedupeBrowserOperations(
  values: readonly BrowserSecurityOperationModel[],
): BrowserSecurityOperationModel[] {
  return dedupeByKey(
    values,
    (value) =>
      `${value.kind}\0${value.door}\0${value.target ?? ''}\0${value.span.start}\0${value.span.end}`,
  );
}

function dedupeServerOperations(
  values: readonly ServerSecurityOperationModel[],
): ServerSecurityOperationModel[] {
  return dedupeByKey(
    values,
    (value) =>
      `${value.kind}\0${value.door}\0${value.root ?? ''}\0${value.target ?? ''}\0${value.justification ?? ''}\0${value.span.start}\0${value.span.end}`,
  );
}

function dedupeViolations(
  values: readonly SecurityOperationViolationModel[],
): SecurityOperationViolationModel[] {
  return dedupeByKey(
    values,
    (value) =>
      `${value.surface}\0${value.kind}\0${value.detail}\0${value.span.start}\0${value.span.end}`,
  );
}

function dedupeByKey<Value>(values: readonly Value[], keyFor: (value: Value) => string): Value[] {
  const result: Value[] = [];
  const seen = compilerCreateSet<string>();
  const length = compilerArrayLength(values, 'Security IR facts');
  for (let index = 0; index < length; index += 1) {
    const value = compilerOwnDataValue(values, index, 'Security IR facts') as Value | undefined;
    if (value === undefined) throw new TypeError(`Security IR facts[${index}] must be own data.`);
    const key = keyFor(value);
    if (compilerSetHas(seen, key)) continue;
    compilerSetAdd(seen, key);
    compilerArrayAppend(result, value, 'Security IR facts');
  }
  return result;
}
