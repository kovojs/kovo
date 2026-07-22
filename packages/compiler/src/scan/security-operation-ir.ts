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

import { reviewedCanonicalClientHandlerImportTarget } from '../client-handler-import-policy.js';
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
  compilerSha256Utf16leHex,
  compilerSnapshotDenseArray,
  compilerStringEndsWith,
  compilerStringSlice,
  compilerStringStartsWith,
  compilerStringToLowerCase,
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
import {
  serverMemberProvenanceFromRelation,
  serverProvenanceAtOrBelowAuthorityTop,
  type BrowserValueProvenance,
  type ServerValueProvenance,
} from './security-provenance-relation.js';
import {
  securityAbstractHelperTransfer,
  securityAbstractEffectInvocationTransfer,
  securityAbstractInterpreterBudgets,
  securityAbstractTransfer,
  serverAliasJoinTransfer,
  serverAliasDeclarationTransfer,
  serverBinaryTransfer,
  serverBindingDefaultTransfer,
  serverBindingProjectionTransfer,
  serverConditionalTransfer,
} from './security-abstract-interpreter.js';
import { serverPrecisionGrant } from './security-provenance-precision-grants.js';

interface SecurityOperationScanResult<Operation> {
  readonly operations: readonly Operation[];
  readonly runtimeOmitted?: true;
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

type ServerSecurityScanSurface = SecurityOperationSurface | 'route';

const REDIRECT_IDENTITY = frameworkExport('@kovojs/server', 'redirect');
const TRUSTED_SQL_IDENTITY = frameworkExport('@kovojs/drizzle', 'trustedSql');
const KOVO_SQL_IDENTITY = frameworkExport('@kovojs/drizzle', 'sql');
const DECLARE_SECRET_READ_CAPABILITY_IDENTITY = frameworkExport(
  '@kovojs/server',
  'declareSecretReadCapability',
);
const SECRET_IDENTITY = frameworkExport('@kovojs/core', 'secret');
const DECLASSIFY_POLICY_IDENTITY = frameworkExport('@kovojs/core', 'DeclassifyPolicy');
const TRUSTED_REVEAL_IDENTITY = frameworkExport('@kovojs/core', 'trustedReveal');
const DRIZZLE_ALIAS_IDENTITY = frameworkExport('drizzle-orm', 'alias');
const TRUSTED_HTML_IDENTITIES = [
  frameworkExport('@kovojs/browser', 'trustedHtml'),
  frameworkExport('@kovojs/server', 'trustedHtml'),
] as const;
const RUN_COMMAND_IDENTITY = frameworkExport('@kovojs/server', 'runCommand');
const PUBLIC_SCOPED_KEY_IDENTITIES = [
  frameworkExport('@kovojs/core', 'publicScopedKey'),
  frameworkExport('@kovojs/server', 'publicScopedKey'),
] as const;
const SCOPED_KEY_IDENTITY = frameworkExport('@kovojs/server', 'scopedKey');
const DERIVED_IDENTITY = frameworkExport('@kovojs/server', 'derived');
const RESPOND_IDENTITY = frameworkExport('@kovojs/server', 'respond');
const PUBLISH_TO_CLIENT_IDENTITY = frameworkExport('@kovojs/core', 'publishToClient');
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
const browserReviewedAmbientGlobalNames = finiteStringSet([
  'Array',
  'BigInt',
  'Boolean',
  'Date',
  'JSON',
  'Math',
  'Number',
  'Object',
  'Promise',
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
  'innerJoin',
  'limit',
  'orderBy',
  'set',
  'union',
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
const browserStateDerivedBindingNamesCache = compilerCreateWeakMap<
  ts.ConciseBody,
  ReadonlySet<string>
>();

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
        securityIrIndexDeclaration(
          declarations,
          statement.name.text,
          statement.body
            ? {
                callable: {
                  body: statement.body,
                  declaration: statement,
                  name: statement.name.text,
                  parameters: statement.parameters,
                },
              }
            : {},
        );
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
const browserAsynchronousGlobalMemberCalls = finiteStringSet([
  'Promise.all',
  'Promise.allSettled',
  'Promise.race',
  'Promise.reject',
  'Promise.resolve',
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
// The delegated handler currently receives the native event carrier. A property name alone is not
// a scalar proof: CustomEvent.detail is arbitrary, and a synthetic event can shadow names such as
// clientX with opaque own data. Event values therefore remain capability-bearing until a future
// compiler/runtime operation snapshots an exact primitive through boot-pinned platform getters.
const browserStateMutatorMethods = finiteStringSet(['pop', 'push', 'reverse', 'shift', 'unshift']);
// SPEC §4.3/§5.2: browser state is JSON data. Calls through a state value are admitted only for
// this finite intrinsic data-method vocabulary; an arbitrary `state.saved()` is never a reviewed
// state read. A JSON own property can shadow one of these names and cause a TypeError, but cannot
// carry executable identity across the state channel.
const browserStateReadMethods = finiteStringSet([
  'endsWith',
  'includes',
  'indexOf',
  'lastIndexOf',
  'replace',
  'replaceAll',
  'startsWith',
  'toLowerCase',
  'toUpperCase',
  'trim',
  'trimEnd',
  'trimStart',
]);
const browserReviewedLocalArrayCallbackMethods = finiteStringSet(['map']);
const BROWSER_SECURITY_OPERATION_LIMIT = 256;
// Authored inline calls to reviewed framework helpers stay closed until the generated registry owns
// an exact per-export argument/container/return summary. Import identity alone is not such a proof.
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
  const stateWriteValues: BrowserStateWriteValueCandidate[] = [];
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
  const appendStateWriteValue = (node: ts.Expression, detail: string) => {
    compilerArrayAppend(stateWriteValues, { detail, node }, 'Browser state-write JSON values');
  };

  const handlerOwner = isSecurityIrFunctionScope(body.parent) ? body.parent : undefined;
  if (handlerOwner && browserFunctionIsAsyncOrGenerator(handlerOwner)) {
    appendViolation(
      handlerOwner,
      'computed-security-operation',
      'async and generator browser handlers are outside the synchronous finite handler IR',
    );
  }
  if (!ts.isBlock(body) && !browserHandlerOutcomeIsReviewed(sourceFile, body, body, aliases)) {
    appendViolation(
      body,
      'computed-security-operation',
      'concise browser handler outcomes must be closed data or an exact finite operation',
    );
  }

  const visit = (node: ts.Node): void => {
    if (
      node !== handlerOwner &&
      isSecurityIrFunctionScope(node) &&
      browserFunctionIsAsyncOrGenerator(node)
    ) {
      appendViolation(
        node,
        'computed-security-operation',
        'async and generator helpers are outside the synchronous finite handler IR',
      );
    }
    if (ts.isAwaitExpression(node) || ts.isYieldExpression(node)) {
      appendViolation(
        node,
        'computed-security-operation',
        'await and yield are outside the synchronous finite handler IR',
      );
    }
    if (
      ts.isReturnStatement(node) &&
      node.expression !== undefined &&
      browserReturnBelongsToHandler(node, body) &&
      !browserHandlerOutcomeIsReviewed(sourceFile, body, node.expression, aliases)
    ) {
      appendViolation(
        node.expression,
        'computed-security-operation',
        'browser handler returns must be closed data and cannot carry authority or thenables',
      );
    }
    if (
      ts.isBindingElement(node) &&
      node.propertyName !== undefined &&
      ts.isComputedPropertyName(node.propertyName)
    ) {
      appendViolation(
        node.propertyName,
        'computed-security-operation',
        'computed destructuring keys are outside the finite handler IR',
      );
    }
    if (
      (ts.isBindingElement(node) && node.initializer !== undefined) ||
      (ts.isParameter(node) && node.initializer !== undefined) ||
      (ts.isShorthandPropertyAssignment(node) && node.objectAssignmentInitializer !== undefined) ||
      (ts.isBinaryExpression(node) && browserBinaryExpressionIsAssignmentPatternDefault(node))
    ) {
      appendViolation(
        node,
        'computed-security-operation',
        'binding and assignment default initializers are outside the finite handler IR',
      );
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      appendViolation(
        node,
        'computed-security-operation',
        'class definitions can execute heritage and computed-key protocols and are outside the finite handler IR',
      );
    }
    if (ts.isTryStatement(node)) {
      appendViolation(
        node,
        'computed-security-operation',
        'try/catch/finally control is outside the finite handler IR because exception values have no closed provenance',
      );
    }
    if (ts.isThrowStatement(node)) {
      appendViolation(
        node,
        'computed-security-operation',
        'throw transfers an unreviewed exception value outside the finite handler IR',
      );
    }
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      appendViolation(
        node,
        'computed-security-operation',
        'this is an ambient receiver and is outside the finite handler IR',
      );
    }
    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      appendViolation(
        node.expression,
        'computed-security-operation',
        'for-in/of iteration invokes an unreviewed iterator or property protocol',
      );
    }
    if (
      (ts.isSpreadElement(node) &&
        !ts.isCallExpression(node.parent) &&
        !ts.isNewExpression(node.parent)) ||
      ts.isSpreadAssignment(node)
    ) {
      appendViolation(
        node,
        'computed-security-operation',
        'spread syntax invokes an unreviewed iterator or property protocol',
      );
    }
    if (ts.isComputedPropertyName(node)) {
      const unsafeKey = browserScalarizationInputEscapeNode(
        sourceFile,
        body,
        node.expression,
        aliases,
        compilerCreateSet<string>(),
      );
      if (unsafeKey !== undefined) {
        appendViolation(
          unsafeKey,
          'computed-security-operation',
          'an authority-bearing computed property key can execute an unreviewed coercion protocol',
        );
      }
    }
    if (
      ts.isElementAccessExpression(node) &&
      node.argumentExpression !== undefined &&
      staticMember(node) === undefined
    ) {
      if (browserExpressionProvenance(node.expression, aliases, body) === 'state') {
        appendViolation(
          node,
          'computed-security-operation',
          'computed state read targets are outside the finite handler IR',
        );
      }
      const unsafeKey = browserScalarizationInputEscapeNode(
        sourceFile,
        body,
        node.argumentExpression,
        aliases,
        compilerCreateSet<string>(),
      );
      if (unsafeKey !== undefined) {
        appendViolation(
          unsafeKey,
          'computed-security-operation',
          'an authority-bearing computed member key can execute an unreviewed coercion protocol',
        );
      }
    }
    if (ts.isTemplateSpan(node)) {
      const unsafeValue = browserScalarizationInputEscapeNode(
        sourceFile,
        body,
        node.expression,
        aliases,
        compilerCreateSet<string>(),
      );
      if (unsafeValue !== undefined) {
        appendViolation(
          unsafeValue,
          'computed-security-operation',
          'template interpolation cannot coerce an authority-bearing value',
        );
      }
    }
    if (
      ts.isPrefixUnaryExpression(node) &&
      (node.operator === ts.SyntaxKind.PlusToken ||
        node.operator === ts.SyntaxKind.MinusToken ||
        node.operator === ts.SyntaxKind.TildeToken)
    ) {
      const unsafeOperand = browserScalarizationInputEscapeNode(
        sourceFile,
        body,
        node.operand,
        aliases,
        compilerCreateSet<string>(),
      );
      if (unsafeOperand !== undefined) {
        appendViolation(
          unsafeOperand,
          'computed-security-operation',
          'unary arithmetic cannot coerce an authority-bearing value',
        );
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      serverBinaryOperatorExecutesCoercion(node.operatorToken.kind)
    ) {
      const unsafeOperand =
        browserScalarizationInputEscapeNode(
          sourceFile,
          body,
          node.left,
          aliases,
          compilerCreateSet<string>(),
        ) ??
        browserScalarizationInputEscapeNode(
          sourceFile,
          body,
          node.right,
          aliases,
          compilerCreateSet<string>(),
        );
      if (unsafeOperand !== undefined) {
        appendViolation(
          unsafeOperand,
          'computed-security-operation',
          'binary coercion cannot consume an authority-bearing value',
        );
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InKeyword) {
      appendViolation(
        node,
        'computed-security-operation',
        'the in operator can invoke an unreviewed property protocol and is outside the finite handler IR',
      );
    }
    if (
      ts.isVariableDeclaration(node) &&
      !ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (browserProvenanceCarriesAuthority(
        browserExpressionProvenance(node.initializer, aliases, body),
      ) ||
        expressionContainsBrowserAuthority(node.initializer, aliases, body))
    ) {
      appendViolation(
        node,
        'computed-security-operation',
        'browser authority cannot escape through a destructuring binding',
      );
    }
    const executableStateUse = browserExecutableStateUse(sourceFile, body, node, aliases, locals);
    if (executableStateUse !== undefined) {
      appendViolation(
        executableStateUse.node,
        'computed-security-operation',
        executableStateUse.detail,
      );
    }
    if (ts.isCallExpression(node)) {
      appendBrowserSpreadArgumentViolations(node.arguments, appendViolation);
      classifyBrowserCall(
        sourceFile,
        body,
        node,
        locals,
        aliases,
        appendOperation,
        appendViolation,
        appendStateWriteValue,
      );
    } else if (ts.isNewExpression(node)) {
      appendBrowserSpreadArgumentViolations(node.arguments ?? [], appendViolation);
      appendViolation(
        node,
        'computed-security-operation',
        `browser constructor ${nodeName(unwrapExpression(node.expression))} is outside the finite handler IR`,
      );
    } else if (ts.isTaggedTemplateExpression(node)) {
      const tag = unwrapExpression(node.tag);
      appendViolation(
        node,
        'computed-security-operation',
        `browser template tag ${nodeName(tag)} is outside the finite handler IR`,
      );
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword
    ) {
      const constructor = unwrapExpression(node.right);
      appendViolation(
        node,
        'computed-security-operation',
        `browser instanceof target ${nodeName(constructor)} is outside the finite handler IR`,
      );
    } else if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
      const destructuredStateTarget =
        (ts.isArrayLiteralExpression(unwrapExpression(node.left)) ||
          ts.isObjectLiteralExpression(unwrapExpression(node.left))) &&
        browserAssignmentPatternContainsStateTarget(node.left, aliases, body);
      const stateTarget = destructuredStateTarget
        ? 'computed'
        : browserStateMutationTargetKind(node.left, aliases, body);
      const provenance = browserMutationTargetProvenance(node.left, aliases, body);
      const mutationReceiver = browserMutationTargetReceiver(node.left);
      const wrappedStateTarget =
        stateTarget === 'none' &&
        mutationReceiver !== undefined &&
        browserExpressionMayCarryState(mutationReceiver, aliases, body);
      const wrappedAuthorityTarget =
        !wrappedStateTarget &&
        mutationReceiver !== undefined &&
        expressionContainsBrowserAuthority(mutationReceiver, aliases, body);
      if (destructuredStateTarget) {
        appendViolation(
          node.left,
          'computed-security-operation',
          'destructuring state writes are outside the finite handler IR',
        );
      } else if (stateTarget === 'computed' || wrappedStateTarget) {
        appendViolation(
          node.left,
          'computed-security-operation',
          'computed state write targets are outside the finite handler IR',
        );
      } else if (stateTarget === 'static') {
        appendOperation(
          'browser.state.write',
          node.left,
          browserCanonicalStateTarget(sourceFile, node.left, aliases, body) ??
            browserExpressionTarget(node.left),
        );
        appendStateWriteValue(node.right, 'state assignment');
      } else if (browserProvenanceCarriesAuthority(provenance) || wrappedAuthorityTarget) {
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
        stateTarget === 'none' &&
        (browserExpressionMayCarryState(node.right, aliases, body) ||
          browserProvenanceCarriesAuthority(rightProvenance) ||
          expressionContainsBrowserAuthority(node.right, aliases, body))
      ) {
        appendViolation(
          node.right,
          'computed-security-operation',
          'browser authority or state JSON cannot move through a mutable or computed alias',
        );
      }
    } else if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      if (
        node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken
      ) {
        const operand = node.operand;
        const provenance = browserMutationTargetProvenance(operand, aliases, body);
        const stateTarget = browserStateMutationTargetKind(operand, aliases, body);
        const mutationReceiver = browserMutationTargetReceiver(operand);
        const wrappedStateTarget =
          stateTarget === 'none' &&
          mutationReceiver !== undefined &&
          browserExpressionMayCarryState(mutationReceiver, aliases, body);
        const wrappedAuthorityTarget =
          !wrappedStateTarget &&
          mutationReceiver !== undefined &&
          expressionContainsBrowserAuthority(mutationReceiver, aliases, body);
        if (stateTarget === 'computed' || wrappedStateTarget) {
          appendViolation(
            operand,
            'computed-security-operation',
            'computed state update targets are outside the finite handler IR',
          );
        } else if (stateTarget === 'static') {
          appendOperation(
            'browser.state.write',
            operand,
            browserCanonicalStateTarget(sourceFile, operand, aliases, body) ??
              browserExpressionTarget(operand),
          );
        } else if (browserProvenanceCarriesAuthority(provenance) || wrappedAuthorityTarget) {
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
      const stateTarget = browserStateMutationTargetKind(node.expression, aliases, body);
      const mutationReceiver = browserMutationTargetReceiver(node.expression);
      const wrappedStateTarget =
        stateTarget === 'none' &&
        mutationReceiver !== undefined &&
        browserExpressionMayCarryState(mutationReceiver, aliases, body);
      const wrappedAuthorityTarget =
        !wrappedStateTarget &&
        mutationReceiver !== undefined &&
        expressionContainsBrowserAuthority(mutationReceiver, aliases, body);
      if (stateTarget === 'computed' || wrappedStateTarget) {
        appendViolation(
          node.expression,
          'computed-security-operation',
          'computed state delete targets are outside the finite handler IR',
        );
      } else if (stateTarget === 'static') {
        appendOperation(
          'browser.state.write',
          node.expression,
          browserCanonicalStateTarget(sourceFile, node.expression, aliases, body) ??
            browserExpressionTarget(node.expression),
        );
      } else if (browserProvenanceCarriesAuthority(provenance) || wrappedAuthorityTarget) {
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
    } else if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      !browserMemberUseIsOwnedByParent(node)
    ) {
      const receiverProvenance = browserExpressionProvenance(node.expression, aliases, body);
      const receiverMayCarryState =
        receiverProvenance !== 'state' &&
        browserExpressionMayCarryState(node.expression, aliases, body);
      const receiverMayCarryOtherAuthority =
        !receiverMayCarryState &&
        receiverProvenance !== 'state' &&
        expressionContainsBrowserAuthority(node.expression, aliases, body);
      if (receiverMayCarryState) {
        appendViolation(
          node,
          'computed-security-operation',
          'state JSON cannot be projected through an unreviewed wrapper before a member read',
        );
      } else if (
        receiverProvenance === 'raw-browser' ||
        receiverProvenance === 'unknown-authority' ||
        receiverMayCarryOtherAuthority
      ) {
        appendViolation(
          node,
          'computed-security-operation',
          `raw browser member ${browserExpressionTarget(node) ?? 'computed'} is outside the finite handler IR`,
        );
      } else if (receiverProvenance === 'event') {
        appendViolation(
          node,
          'raw-dom-operation',
          'raw event members require a framework-pinned operation and are outside authored handlers',
        );
      } else if (isDomProvenance(receiverProvenance)) {
        appendViolation(
          node,
          'raw-dom-operation',
          'raw DOM members require a framework-pinned operation and are outside authored handlers',
        );
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(body);

  const stateWriteSnapshot = compilerSnapshotDenseArray(
    stateWriteValues,
    'Browser state-write JSON values',
  );
  for (let index = 0; index < stateWriteSnapshot.length; index += 1) {
    const candidate = stateWriteSnapshot[index]!;
    const unsafe = browserStateWriteExecutableEscapeNode(
      sourceFile,
      body,
      candidate.node,
      aliases,
      compilerCreateSet<string>(),
    );
    if (unsafe !== undefined) {
      appendViolation(
        unsafe,
        'computed-security-operation',
        `${candidate.detail} is outside the compiler's closed JSON/scalar state vocabulary; runtime validation separately enforces recursive JsonValue data`,
      );
    }
  }

  const dedupedOperations = dedupeBrowserOperations(operations);
  if (dedupedOperations.length > BROWSER_SECURITY_OPERATION_LIMIT) {
    appendViolation(
      body,
      'computed-security-operation',
      `browser handlers may contain at most ${BROWSER_SECURITY_OPERATION_LIMIT} distinct finite operations`,
    );
    return {
      operations: [],
      runtimeOmitted: true,
      violations: dedupeViolations(violations),
    };
  }
  return { operations: dedupedOperations, violations: dedupeViolations(violations) };
}

function browserFunctionIsAsyncOrGenerator(node: ts.FunctionLikeDeclaration): boolean {
  const modifiers = compilerSnapshotDenseArray(
    ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [],
    'Finite browser-handler modifiers',
  );
  for (let index = 0; index < modifiers.length; index += 1) {
    if (modifiers[index]!.kind === ts.SyntaxKind.AsyncKeyword) return true;
  }
  return (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node)) &&
    node.asteriskToken !== undefined
  );
}

function browserExpressionIsVoidOutcome(expression: ts.Expression, boundary: ts.Node): boolean {
  const current = unwrapExpression(expression);
  return (
    ts.isVoidExpression(current) ||
    (ts.isIdentifier(current) &&
      current.text === 'undefined' &&
      !identifierIsShadowedWithinBoundary(current, boundary))
  );
}

function browserHandlerOutcomeIsReviewed(
  sourceFile: ts.SourceFile,
  boundary: ts.ConciseBody,
  expression: ts.Expression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
): boolean {
  if (browserExpressionIsVoidOutcome(expression, boundary)) return true;
  const current = unwrapExpression(expression);
  if (ts.isCallExpression(current)) {
    const callee = unwrapExpression(current.expression);
    if (
      browserOperationProvenanceKind(browserExpressionProvenance(callee, aliases, boundary)) !==
        undefined ||
      browserExpressionIsReviewedFrameworkCall(sourceFile, callee) ||
      browserReviewedStateMethodCall(callee, aliases, boundary) !== undefined ||
      browserReviewedLocalArrayMethodCall(sourceFile, callee, boundary, aliases) !== undefined
    ) {
      return true;
    }
    // Call admission is classified exactly once by the CallExpression visitor below. Treating an
    // unreviewed call as a second outcome violation obscures the precise closed sink.
    return true;
  }
  // Constructor admission is likewise classified exactly once by the NewExpression branch.
  if (ts.isNewExpression(current) || ts.isTaggedTemplateExpression(current)) return true;
  if (
    ts.isBinaryExpression(current) &&
    isAssignmentOperator(current.operatorToken.kind) &&
    browserStateMutationTargetKind(current.left, aliases, boundary) === 'static'
  ) {
    return true;
  }
  if (
    (ts.isPrefixUnaryExpression(current) || ts.isPostfixUnaryExpression(current)) &&
    (current.operator === ts.SyntaxKind.PlusPlusToken ||
      current.operator === ts.SyntaxKind.MinusMinusToken) &&
    browserStateMutationTargetKind(current.operand, aliases, boundary) === 'static'
  ) {
    return true;
  }
  return (
    browserStateWriteExecutableEscapeNode(
      sourceFile,
      boundary,
      current,
      aliases,
      compilerCreateSet<string>(),
    ) === undefined
  );
}

function browserReturnBelongsToHandler(node: ts.ReturnStatement, body: ts.ConciseBody): boolean {
  let cursor: ts.Node | undefined = node.parent;
  while (cursor && cursor !== body) {
    if (isSecurityIrFunctionScope(cursor)) return false;
    cursor = cursor.parent;
  }
  return cursor === body;
}

function appendBrowserSpreadArgumentViolations(
  argumentsList: readonly ts.Expression[],
  appendViolation: (
    node: ts.Node,
    kind: SecurityOperationViolationModel['kind'],
    detail: string,
  ) => void,
): void {
  const argumentsSnapshot = compilerSnapshotDenseArray(
    argumentsList,
    'Finite browser-handler call arguments',
  );
  for (let index = 0; index < argumentsSnapshot.length; index += 1) {
    const argument = argumentsSnapshot[index]!;
    if (!ts.isSpreadElement(argument)) continue;
    appendViolation(
      argument,
      'computed-security-operation',
      'spread call arguments invoke an unreviewed iterator protocol',
    );
  }
}

type BrowserStateMutationTargetKind = 'computed' | 'none' | 'static';

function browserStateMutationTargetKind(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  boundary: ts.ConciseBody,
): BrowserStateMutationTargetKind {
  let current = unwrapExpression(expression);
  let computed = false;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    if (ts.isElementAccessExpression(current) && staticMember(current) === undefined) {
      computed = true;
    }
    current = unwrapExpression(current.expression);
  }
  return browserExpressionProvenance(current, aliases, boundary) === 'state'
    ? computed
      ? 'computed'
      : 'static'
    : 'none';
}

function browserMutationTargetReceiver(expression: ts.Expression): ts.Expression | undefined {
  const current = unwrapExpression(expression);
  return ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)
    ? current.expression
    : undefined;
}

function browserBinaryExpressionIsAssignmentPatternDefault(node: ts.BinaryExpression): boolean {
  if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  let current: ts.Node = node;
  let parent = current.parent;
  while (
    ts.isArrayLiteralExpression(parent) ||
    ts.isObjectLiteralExpression(parent) ||
    (ts.isPropertyAssignment(parent) && parent.initializer === current) ||
    ts.isParenthesizedExpression(parent)
  ) {
    current = parent;
    parent = current.parent;
  }
  return (
    ts.isBinaryExpression(parent) &&
    isAssignmentOperator(parent.operatorToken.kind) &&
    parent.left === current
  );
}

function browserAssignmentPatternContainsStateTarget(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  boundary: ts.ConciseBody,
): boolean {
  const current = unwrapExpression(expression);
  if (browserStateMutationTargetKind(current, aliases, boundary) !== 'none') return true;
  if (ts.isArrayLiteralExpression(current)) {
    const elements = compilerSnapshotDenseArray(
      current.elements,
      'Finite browser state assignment pattern',
    );
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index]!;
      if (
        !ts.isOmittedExpression(element) &&
        browserAssignmentPatternContainsStateTarget(
          ts.isSpreadElement(element) ? element.expression : element,
          aliases,
          boundary,
        )
      )
        return true;
    }
  }
  if (ts.isObjectLiteralExpression(current)) {
    const properties = compilerSnapshotDenseArray(
      current.properties,
      'Finite browser state assignment pattern',
    );
    for (let index = 0; index < properties.length; index += 1) {
      const property = properties[index]!;
      const target = ts.isPropertyAssignment(property)
        ? property.initializer
        : ts.isShorthandPropertyAssignment(property)
          ? property.name
          : ts.isSpreadAssignment(property)
            ? property.expression
            : undefined;
      if (target && browserAssignmentPatternContainsStateTarget(target, aliases, boundary)) {
        return true;
      }
    }
  }
  return false;
}

interface BrowserExecutableStateUse {
  readonly detail: string;
  readonly node: ts.Node;
}

interface BrowserStateWriteValueCandidate {
  readonly detail: string;
  readonly node: ts.Expression;
}

/**
 * SPEC §4.3/§5.2: state is a JSON data channel. These are the syntax positions that ask the JS
 * runtime to obtain or invoke executable behavior from a value. The fact is consumed both by the
 * finite browser-IR verdict and by element-param lowering, so a scalar cannot be laundered through
 * a state write before reaching one of these positions.
 */
function browserExecutableStateUse(
  sourceFile: ts.SourceFile,
  boundary: ts.ConciseBody,
  node: ts.Node,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  locals: ReadonlySet<string>,
): BrowserExecutableStateUse | undefined {
  const executable = (expression: ts.Expression): boolean =>
    browserExpressionMayCarryState(expression, aliases, boundary);
  const result = (target: ts.Node, detail: string): BrowserExecutableStateUse => ({
    detail,
    node: target,
  });

  if (ts.isCallExpression(node)) {
    const callee = unwrapExpression(node.expression);
    const calleeProvenance = browserExpressionProvenance(callee, aliases, boundary);
    const operationKind = browserOperationProvenanceKind(calleeProvenance);
    if (operationKind === 'browser.timer.schedule') {
      const callback = node.arguments[0];
      return callback !== undefined && executable(callback)
        ? result(callback, 'state-derived JSON cannot be used as a timer callback')
        : undefined;
    }
    if (operationKind !== undefined) return undefined;

    const stateMethod = browserReviewedStateMethodCall(callee, aliases, boundary);
    if (stateMethod !== undefined) {
      const argumentsSnapshot = compilerSnapshotDenseArray(
        node.arguments,
        `State ${stateMethod} executable arguments`,
      );
      for (let index = 0; index < argumentsSnapshot.length; index += 1) {
        const argumentKind = browserStateMethodExecutableArgumentKind(stateMethod, index);
        if (
          argumentKind !== undefined &&
          executable(argumentsSnapshot[index]!) &&
          !browserStateExecutableArgumentIsReviewed(
            sourceFile,
            boundary,
            argumentsSnapshot[index]!,
            argumentKind,
            locals,
            aliases,
          )
        ) {
          return result(
            argumentsSnapshot[index]!,
            `state-derived JSON cannot be used in executable state.${stateMethod} argument ${index}`,
          );
        }
      }
      return undefined;
    }

    const sameFileCallable = resolveSameFileSecurityIrCallable(sourceFile, callee);
    if (sameFileCallable !== undefined) {
      const argumentsSnapshot = compilerSnapshotDenseArray(
        node.arguments,
        'State executable helper arguments',
      );
      for (let index = 0; index < argumentsSnapshot.length; index += 1) {
        const argument = argumentsSnapshot[index]!;
        if (executable(argument)) {
          return result(argument, 'state-derived JSON cannot pass through an unsummarized helper');
        }
      }
      return undefined;
    }
    if (ts.isIdentifier(callee) && !compilerSetHas(locals, callee.text)) return undefined;

    if (
      executable(callee) &&
      !browserCallbackIsReviewedExecutable(boundary, callee, locals, aliases)
    ) {
      return result(callee, 'state-derived JSON cannot be used as a browser call target');
    }

    return undefined;
  }

  if (ts.isNewExpression(node) && executable(node.expression)) {
    return result(node.expression, 'state-derived JSON cannot be used as a constructor');
  }
  if (ts.isTaggedTemplateExpression(node) && executable(node.tag)) {
    return result(node.tag, 'state-derived JSON cannot be used as a template tag');
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
    executable(node.right)
  ) {
    return result(node.right, 'state-derived JSON cannot be an instanceof target');
  }
  if (
    ts.isExpressionWithTypeArguments(node) &&
    ts.isHeritageClause(node.parent) &&
    node.parent.token === ts.SyntaxKind.ExtendsKeyword &&
    executable(node.expression)
  ) {
    return result(node.expression, 'state-derived JSON cannot be a class heritage constructor');
  }
  return undefined;
}

function browserExpressionMayCarryState(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  boundary: ts.ConciseBody,
): boolean {
  const active = compilerCreateSet<string>();
  const visitExpression = (candidate: ts.Expression): boolean => {
    const current = unwrapExpression(candidate);
    const sourceFile = current.getSourceFile();
    const key = `${current.getStart(sourceFile)}:${current.getEnd()}`;
    if (compilerSetHas(active, key)) return false;
    compilerSetAdd(active, key);
    try {
      if (browserExpressionProvenance(current, aliases, boundary) === 'state') return true;
      if (ts.isIdentifier(current)) {
        const initializer = securityIrImmutableBindingInitializer(sourceFile, current);
        if (initializer !== undefined && visitExpression(initializer)) return true;
      }
      let found = false;
      const visitChild = (child: ts.Node): void => {
        if (found) return;
        if (ts.isExpression(child)) {
          if (visitExpression(child)) found = true;
          return;
        }
        // Object/binding members are not themselves expressions. Descend through their structural
        // wrapper so `{ value: String(state.value) }` and nested carrier literals retain origin.
        ts.forEachChild(child, visitChild);
      };
      ts.forEachChild(current, visitChild);
      return found;
    } finally {
      compilerSetDelete(active, key);
    }
  };
  return visitExpression(expression);
}

/**
 * Conservative backward slice for values copied out of handler state before a deferred callback.
 * The ordinary provenance map deliberately treats scalarized state reads as data, but delayed work
 * must still remember their origin: the synchronous state snapshot has retired before the callback
 * runs. Track binding-pattern projections and local carrier mutations to a fixpoint so array/object
 * destructuring cannot erase that temporal provenance (SPEC §4.3/§5.2).
 */
function browserStateDerivedBindingNames(
  boundary: ts.ConciseBody,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
): ReadonlySet<string> {
  const cached = compilerWeakMapGet(browserStateDerivedBindingNamesCache, boundary);
  if (cached !== undefined) return cached;
  const derived = compilerCreateSet<string>();
  let changed = true;
  while (changed) {
    changed = false;
    const mark = (names: ReadonlySet<string>): void => {
      compilerSetForEach(names, (name) => {
        if (compilerSetHas(derived, name)) return;
        compilerSetAdd(derived, name);
        changed = true;
      });
    };
    const markTarget = (target: ts.Node): void => {
      const names = compilerCreateSet<string>();
      const expression = ts.isExpression(target) ? unwrapExpression(target) : undefined;
      const member = expression === undefined ? undefined : staticMember(expression);
      const root = member === undefined ? undefined : rootIdentifier(member.receiver);
      if (root !== undefined) compilerSetAdd(names, root);
      else collectSecurityIrAssignmentTargetNames(target, names);
      mark(names);
    };
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer !== undefined &&
        browserExpressionMayCarryStateOrDerived(
          node.initializer,
          derived,
          aliases,
          boundary,
        )
      ) {
        const names = compilerCreateSet<string>();
        collectBindingNames(node.name, names);
        mark(names);
      } else if (
        ts.isBinaryExpression(node) &&
        isAssignmentOperator(node.operatorToken.kind) &&
        browserExpressionMayCarryStateOrDerived(node.right, derived, aliases, boundary)
      ) {
        markTarget(node.left);
      } else if (ts.isCallExpression(node)) {
        const callee = unwrapExpression(node.expression);
        const member = staticMember(callee);
        if (
          member !== undefined &&
          (member.name === 'push' ||
            member.name === 'unshift' ||
            member.name === 'splice' ||
            member.name === 'fill')
        ) {
          const argumentsSnapshot = compilerSnapshotDenseArray(
            node.arguments,
            'Deferred state carrier arguments',
          );
          for (let index = 0; index < argumentsSnapshot.length; index += 1) {
            if (
              browserExpressionMayCarryStateOrDerived(
                argumentsSnapshot[index]!,
                derived,
                aliases,
                boundary,
              )
            ) {
              markTarget(member.receiver);
              break;
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(boundary);
  }
  compilerWeakMapSet(browserStateDerivedBindingNamesCache, boundary, derived);
  return derived;
}

function browserExpressionMayCarryStateOrDerived(
  expression: ts.Expression,
  derived: ReadonlySet<string>,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  boundary: ts.ConciseBody,
): boolean {
  if (browserExpressionMayCarryState(expression, aliases, boundary)) return true;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isIdentifier(node) &&
      browserIdentifierIsValueReference(node) &&
      compilerSetHas(derived, node.text)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

function browserReviewedStateMethodCall(
  callee: ts.Expression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  boundary: ts.ConciseBody,
): string | undefined {
  const member = staticMember(callee);
  if (!member || !browserExpressionIsReviewedStateData(member.receiver, aliases, boundary)) {
    return undefined;
  }
  if (
    !compilerSetHas(browserStateReadMethods, member.name) &&
    !compilerSetHas(browserStateMutatorMethods, member.name)
  ) {
    return undefined;
  }
  return member.name;
}

function browserReviewedLocalArrayMethodCall(
  sourceFile: ts.SourceFile,
  callee: ts.Expression,
  boundary: ts.ConciseBody,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
): string | undefined {
  const member = staticMember(callee);
  if (
    !member ||
    !compilerSetHas(browserReviewedLocalArrayCallbackMethods, member.name) ||
    !browserExpressionIsReviewedLocalArrayData(
      sourceFile,
      member.receiver,
      boundary,
      aliases,
      compilerCreateSet<string>(),
    )
  )
    return undefined;
  return member.name;
}

function browserExpressionIsReviewedLocalArrayData(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  boundary: ts.ConciseBody,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  active: Set<string>,
): boolean {
  const current = unwrapExpression(expression);
  const key = `${current.getStart(sourceFile)}:${current.getEnd()}`;
  if (compilerSetHas(active, key)) return false;
  compilerSetAdd(active, key);
  try {
    if (ts.isArrayLiteralExpression(current)) {
      const elements = compilerSnapshotDenseArray(current.elements, 'Reviewed local array data');
      for (let index = 0; index < elements.length; index += 1) {
        const element = elements[index]!;
        if (
          ts.isOmittedExpression(element) ||
          ts.isSpreadElement(element) ||
          browserExpressionMayCarryState(element, aliases, boundary) ||
          expressionContainsBrowserAuthority(element, aliases, boundary) ||
          browserStateWriteExecutableEscapeNode(
            sourceFile,
            boundary,
            element,
            aliases,
            compilerCreateSet<string>(),
          )
        )
          return false;
      }
      return true;
    }
    if (ts.isIdentifier(current)) {
      const initializer = securityIrImmutableBindingInitializer(sourceFile, current);
      return (
        initializer !== undefined &&
        browserExpressionIsReviewedLocalArrayData(
          sourceFile,
          initializer,
          boundary,
          aliases,
          active,
        )
      );
    }
    if (ts.isCallExpression(current)) {
      return (
        browserReviewedLocalArrayMethodCall(
          sourceFile,
          unwrapExpression(current.expression),
          boundary,
          aliases,
        ) !== undefined
      );
    }
    return false;
  } finally {
    compilerSetDelete(active, key);
  }
}

function browserExpressionIsReviewedStateData(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  boundary: ts.ConciseBody,
): boolean {
  const current = unwrapExpression(expression);
  if (browserExpressionProvenance(current, aliases, boundary) === 'state') {
    return expressionPath(current) !== 'state';
  }
  if (!ts.isCallExpression(current)) return false;
  const member = staticMember(unwrapExpression(current.expression));
  return (
    member !== undefined &&
    (compilerSetHas(browserStateReadMethods, member.name) ||
      compilerSetHas(browserStateMutatorMethods, member.name)) &&
    browserExpressionIsReviewedStateData(member.receiver, aliases, boundary)
  );
}

type BrowserStateExecutableArgumentKind = 'scalar' | 'stored-json';

function browserStateMethodExecutableArgumentKind(
  method: string,
  index: number,
): BrowserStateExecutableArgumentKind | undefined {
  if (method === 'push' || method === 'unshift') return 'stored-json';
  if (
    (method === 'endsWith' ||
      method === 'includes' ||
      method === 'indexOf' ||
      method === 'lastIndexOf' ||
      method === 'replace' ||
      method === 'replaceAll' ||
      method === 'startsWith') &&
    index < 2
  ) {
    return 'scalar';
  }
  return undefined;
}

function browserStateExecutableArgumentIsReviewed(
  sourceFile: ts.SourceFile,
  boundary: ts.ConciseBody,
  expression: ts.Expression,
  kind: BrowserStateExecutableArgumentKind,
  locals: ReadonlySet<string>,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
): boolean {
  void locals;
  if (kind === 'scalar') {
    return browserStateMethodScalarArgumentIsReviewed(
      sourceFile,
      boundary,
      expression,
      aliases,
      compilerCreateSet<string>(),
    );
  }
  return (
    browserStateWriteExecutableEscapeNode(
      sourceFile,
      boundary,
      expression,
      aliases,
      compilerCreateSet<string>(),
    ) === undefined
  );
}

function browserStateMethodScalarArgumentIsReviewed(
  sourceFile: ts.SourceFile,
  boundary: ts.ConciseBody,
  expression: ts.Expression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  active: Set<string>,
): boolean {
  const current = unwrapExpression(expression);
  const key = `${current.getStart(sourceFile)}:${current.getEnd()}`;
  if (compilerSetHas(active, key)) return false;
  compilerSetAdd(active, key);
  try {
    if (
      ts.isStringLiteralLike(current) ||
      ts.isNumericLiteral(current) ||
      current.kind === ts.SyntaxKind.TrueKeyword ||
      current.kind === ts.SyntaxKind.FalseKeyword ||
      current.kind === ts.SyntaxKind.NullKeyword
    )
      return true;
    if (ts.isIdentifier(current)) {
      const initializer = securityIrImmutableBindingInitializer(sourceFile, current);
      return (
        initializer !== undefined &&
        browserStateMethodScalarArgumentIsReviewed(
          sourceFile,
          boundary,
          initializer,
          aliases,
          active,
        )
      );
    }
    if (ts.isCallExpression(current)) {
      const callee = unwrapExpression(current.expression);
      return (
        ts.isIdentifier(callee) &&
        (callee.text === 'Boolean' || callee.text === 'Number' || callee.text === 'String') &&
        !identifierIsShadowedWithinBoundary(callee, boundary) &&
        browserScalarCallResultIsReviewed(sourceFile, boundary, current, aliases, active)
      );
    }
    return false;
  } finally {
    compilerSetDelete(active, key);
  }
}

function browserStateMethodStoredArguments(
  call: ts.CallExpression,
  method: string,
): readonly ts.Expression[] {
  if (method === 'push' || method === 'unshift') {
    return compilerSnapshotDenseArray(call.arguments, `State ${method} insertions`);
  }
  if (method === 'splice') {
    const argumentsSnapshot = compilerSnapshotDenseArray(call.arguments, 'State splice insertions');
    const values: ts.Expression[] = [];
    for (let index = 2; index < argumentsSnapshot.length; index += 1) {
      compilerArrayAppend(values, argumentsSnapshot[index]!, 'State splice insertions');
    }
    return values;
  }
  const first = method === 'fill' ? call.arguments[0] : undefined;
  return first === undefined ? [] : [first];
}

/**
 * SPEC §4.3/§5.2 static half of the state-data boundary. Keep this deliberately finite: reject
 * values that syntax/provenance proves are executable or browser capabilities, including values
 * nested in literal containers and immutable aliases. The browser runtime separately validates the
 * complete recursive JsonValue invariant after every handler.
 */
function browserStateWriteExecutableEscapeNode(
  sourceFile: ts.SourceFile,
  boundary: ts.ConciseBody,
  expression: ts.Expression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  active: Set<string>,
): ts.Node | undefined {
  const current = unwrapExpression(expression);
  const key = `${current.getStart(sourceFile)}:${current.getEnd()}`;
  if (compilerSetHas(active, key)) return current;
  compilerSetAdd(active, key);
  try {
    if (
      ts.isStringLiteralLike(current) ||
      ts.isNumericLiteral(current) ||
      current.kind === ts.SyntaxKind.TrueKeyword ||
      current.kind === ts.SyntaxKind.FalseKeyword ||
      current.kind === ts.SyntaxKind.NullKeyword
    )
      return undefined;
    if (
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current) ||
      ts.isClassExpression(current) ||
      ts.isRegularExpressionLiteral(current) ||
      ts.isBigIntLiteral(current) ||
      ts.isNewExpression(current) ||
      ts.isAwaitExpression(current) ||
      ts.isYieldExpression(current) ||
      ts.isVoidExpression(current)
    )
      return current;

    if (ts.isIdentifier(current)) {
      if (current.text === 'undefined' && !identifierIsShadowedWithinBoundary(current, boundary)) {
        return current;
      }
      if (browserExpressionUsesDirectModuleImport(sourceFile, current)) return current;
      const initializer = securityIrImmutableBindingInitializer(sourceFile, current);
      if (initializer !== undefined) {
        return browserStateWriteExecutableEscapeNode(
          sourceFile,
          boundary,
          initializer,
          aliases,
          active,
        );
      }
      const provenance = browserExpressionProvenance(current, aliases, boundary);
      if (provenance === 'state') return undefined;
      if (
        provenance === 'raw-browser' ||
        provenance === 'event' ||
        provenance === 'dom' ||
        provenance === 'form' ||
        provenance === 'unknown-authority' ||
        browserOperationProvenanceKind(provenance) !== undefined
      ) {
        return current;
      }
      return current;
    }

    if (ts.isObjectLiteralExpression(current)) {
      const properties = compilerSnapshotDenseArray(
        current.properties,
        'State executable-escape object properties',
      );
      for (let index = 0; index < properties.length; index += 1) {
        const property = properties[index]!;
        if (ts.isSpreadAssignment(property)) return property;
        if (
          ts.isMethodDeclaration(property) ||
          ts.isGetAccessor(property) ||
          ts.isSetAccessor(property) ||
          staticPropertyName(property.name) === undefined
        ) {
          return property;
        }
        const value = ts.isPropertyAssignment(property)
          ? property.initializer
          : ts.isShorthandPropertyAssignment(property)
            ? (property.objectAssignmentInitializer ?? property.name)
            : undefined;
        if (value === undefined) return property;
        const unsafe = browserStateWriteExecutableEscapeNode(
          sourceFile,
          boundary,
          value,
          aliases,
          active,
        );
        if (unsafe !== undefined) return unsafe;
      }
      return undefined;
    }

    if (ts.isArrayLiteralExpression(current)) {
      const elements = compilerSnapshotDenseArray(
        current.elements,
        'State executable-escape array elements',
      );
      for (let index = 0; index < elements.length; index += 1) {
        const element = elements[index]!;
        if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) return element;
        const unsafe = browserStateWriteExecutableEscapeNode(
          sourceFile,
          boundary,
          element,
          aliases,
          active,
        );
        if (unsafe !== undefined) return unsafe;
      }
      return undefined;
    }

    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      if (browserExpressionUsesDirectModuleImport(sourceFile, current)) return current;
      if (resolveSameFileSecurityIrCallable(sourceFile, current) !== undefined) return current;
      const provenance = browserExpressionProvenance(current, aliases, boundary);
      if (provenance === 'state') return undefined;
      const member = staticMember(current);
      if (!member) return current;
      const receiver = unwrapExpression(member.receiver);
      if (
        member.name === 'length' &&
        ts.isCallExpression(receiver) &&
        browserReviewedLocalArrayMethodCall(
          sourceFile,
          unwrapExpression(receiver.expression),
          boundary,
          aliases,
        ) !== undefined
      )
        return undefined;
      if (ts.isIdentifier(receiver)) {
        const initializer = securityIrImmutableBindingInitializer(sourceFile, receiver);
        if (initializer && ts.isObjectLiteralExpression(unwrapExpression(initializer))) {
          const property = browserStaticObjectPropertyValue(initializer, member.name);
          return property
            ? browserStateWriteExecutableEscapeNode(sourceFile, boundary, property, aliases, active)
            : current;
        }
      }
      return current;
    }

    if (ts.isConditionalExpression(current)) {
      return (
        browserStateWriteExecutableEscapeNode(
          sourceFile,
          boundary,
          current.whenTrue,
          aliases,
          active,
        ) ??
        browserStateWriteExecutableEscapeNode(
          sourceFile,
          boundary,
          current.whenFalse,
          aliases,
          active,
        )
      );
    }

    if (ts.isBinaryExpression(current)) {
      if (current.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        return browserStateWriteExecutableEscapeNode(
          sourceFile,
          boundary,
          current.right,
          aliases,
          active,
        );
      }
      if (
        current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        current.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        return (
          browserStateWriteExecutableEscapeNode(
            sourceFile,
            boundary,
            current.left,
            aliases,
            active,
          ) ??
          browserStateWriteExecutableEscapeNode(
            sourceFile,
            boundary,
            current.right,
            aliases,
            active,
          )
        );
      }
      if (
        current.operatorToken.kind === ts.SyntaxKind.InKeyword ||
        current.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword ||
        isAssignmentOperator(current.operatorToken.kind)
      )
        return current;
      return (
        browserScalarizationInputEscapeNode(sourceFile, boundary, current.left, aliases, active) ??
        browserScalarizationInputEscapeNode(sourceFile, boundary, current.right, aliases, active)
      );
    }

    if (ts.isPrefixUnaryExpression(current)) {
      return browserScalarizationInputEscapeNode(
        sourceFile,
        boundary,
        current.operand,
        aliases,
        active,
      );
    }
    if (ts.isTypeOfExpression(current)) {
      return browserScalarizationInputEscapeNode(
        sourceFile,
        boundary,
        current.expression,
        aliases,
        active,
      );
    }
    if (ts.isTemplateExpression(current)) {
      const spans = compilerSnapshotDenseArray(current.templateSpans, 'State JSON template spans');
      for (let index = 0; index < spans.length; index += 1) {
        const unsafe = browserScalarizationInputEscapeNode(
          sourceFile,
          boundary,
          spans[index]!.expression,
          aliases,
          active,
        );
        if (unsafe) return unsafe;
      }
      return undefined;
    }
    if (ts.isCallExpression(current)) {
      const publishToClientSummary = browserPublishToClientSummary(
        sourceFile,
        boundary,
        current,
        aliases,
      );
      if (publishToClientSummary !== undefined) {
        return publishToClientSummary.returnValue === undefined
          ? (publishToClientSummary.violation?.node ?? current)
          : browserStateWriteExecutableEscapeNode(
              sourceFile,
              boundary,
              publishToClientSummary.returnValue,
              aliases,
              active,
            );
      }
      if (browserScalarCallResultIsReviewed(sourceFile, boundary, current, aliases, active)) {
        return undefined;
      }
      const stateMethod = browserReviewedStateMethodCall(
        unwrapExpression(current.expression),
        aliases,
        boundary,
      );
      if (stateMethod && !compilerSetHas(browserStateMutatorMethods, stateMethod)) {
        const argumentsSnapshot = compilerSnapshotDenseArray(
          current.arguments,
          `State ${stateMethod} JSON result arguments`,
        );
        for (let index = 0; index < argumentsSnapshot.length; index += 1) {
          const kind = browserStateMethodExecutableArgumentKind(stateMethod, index);
          if (
            kind === undefined ||
            !browserStateExecutableArgumentIsReviewed(
              sourceFile,
              boundary,
              argumentsSnapshot[index]!,
              kind,
              localBindingNames(boundary),
              aliases,
            )
          )
            return argumentsSnapshot[index]!;
        }
        return undefined;
      }
      return current;
    }
    return current;
  } finally {
    compilerSetDelete(active, key);
  }
}

function browserStaticObjectPropertyValue(
  expression: ts.Expression,
  name: string,
): ts.Expression | undefined {
  const current = unwrapExpression(expression);
  if (!ts.isObjectLiteralExpression(current)) return undefined;
  const properties = compilerSnapshotDenseArray(
    current.properties,
    'State JSON static object properties',
  );
  let value: ts.Expression | undefined;
  for (let index = 0; index < properties.length; index += 1) {
    const property = properties[index]!;
    if (staticPropertyName(property.name) !== name) continue;
    if (value !== undefined) return undefined;
    value = ts.isPropertyAssignment(property)
      ? property.initializer
      : ts.isShorthandPropertyAssignment(property)
        ? (property.objectAssignmentInitializer ?? property.name)
        : undefined;
  }
  return value;
}

function browserScalarizationInputEscapeNode(
  sourceFile: ts.SourceFile,
  boundary: ts.ConciseBody,
  expression: ts.Expression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  active: Set<string>,
): ts.Node | undefined {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) {
    if (browserExpressionUsesDirectModuleImport(sourceFile, current)) return current;
    const initializer = securityIrImmutableBindingInitializer(sourceFile, current);
    if (initializer) {
      return browserScalarizationInputEscapeNode(
        sourceFile,
        boundary,
        initializer,
        aliases,
        active,
      );
    }
    const provenance = browserExpressionProvenance(current, aliases, boundary);
    if (browserProvenanceCarriesAuthority(provenance) && provenance !== 'state') return current;
    return undefined;
  }
  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    if (browserExpressionUsesDirectModuleImport(sourceFile, current)) return current;
    const provenance = browserExpressionProvenance(current, aliases, boundary);
    if (browserProvenanceCarriesAuthority(provenance) && provenance !== 'state') return current;
    const member = staticMember(current);
    if (!member) return current;
    const receiverProvenance = browserExpressionProvenance(member.receiver, aliases, boundary);
    if (
      receiverProvenance !== 'state' &&
      (browserExpressionMayCarryState(member.receiver, aliases, boundary) ||
        expressionContainsBrowserAuthority(member.receiver, aliases, boundary))
    ) {
      return current;
    }
    return ts.isCallExpression(unwrapExpression(member.receiver)) ? current : undefined;
  }
  if (ts.isCallExpression(current)) {
    const publishToClientSummary = browserPublishToClientSummary(
      sourceFile,
      boundary,
      current,
      aliases,
    );
    if (publishToClientSummary !== undefined) {
      return publishToClientSummary.returnValue === undefined
        ? (publishToClientSummary.violation?.node ?? current)
        : browserScalarizationInputEscapeNode(
            sourceFile,
            boundary,
            publishToClientSummary.returnValue,
            aliases,
            active,
          );
    }
    return browserScalarCallResultIsReviewed(sourceFile, boundary, current, aliases, active)
      ? undefined
      : current;
  }
  if (ts.isNewExpression(current)) return current;
  return browserStateWriteExecutableEscapeNode(sourceFile, boundary, current, aliases, active);
}

function browserScalarCallResultIsReviewed(
  sourceFile: ts.SourceFile,
  boundary: ts.ConciseBody,
  call: ts.CallExpression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  active: Set<string>,
): boolean {
  const callee = unwrapExpression(call.expression);
  const scalarIdentifier =
    ts.isIdentifier(callee) &&
    (callee.text === 'Boolean' ||
      callee.text === 'Number' ||
      callee.text === 'String' ||
      callee.text === 'isFinite' ||
      callee.text === 'isNaN' ||
      callee.text === 'parseFloat' ||
      callee.text === 'parseInt') &&
    !identifierIsShadowedWithinBoundary(callee, boundary);
  const member = staticMember(callee);
  const globalMember = member ? `${rootIdentifier(member.receiver)}.${member.name}` : undefined;
  const globalRoot = member ? rootIdentifierNode(member.receiver) : undefined;
  const scalarMember =
    globalMember !== undefined &&
    (globalMember === 'Array.isArray' ||
      globalMember === 'Date.now' ||
      globalMember === 'JSON.stringify' ||
      compilerStringStartsWith(globalMember, 'Math.') ||
      compilerStringStartsWith(globalMember, 'Number.') ||
      globalMember === 'Object.hasOwn' ||
      globalMember === 'Object.is' ||
      globalMember === 'String.fromCharCode' ||
      globalMember === 'String.fromCodePoint') &&
    globalRoot !== undefined &&
    !identifierIsShadowedWithinBoundary(globalRoot, boundary);
  if (!scalarIdentifier && !scalarMember) return false;
  if (globalMember === 'Date.now' && call.arguments.length === 0) return true;
  const argumentsSnapshot = compilerSnapshotDenseArray(
    call.arguments,
    'State scalar call arguments',
  );
  for (let index = 0; index < argumentsSnapshot.length; index += 1) {
    if (
      browserScalarizationInputEscapeNode(
        sourceFile,
        boundary,
        argumentsSnapshot[index]!,
        aliases,
        active,
      )
    )
      return false;
  }
  return true;
}

function browserExpressionUsesDirectModuleImport(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): boolean {
  if (!securityIrExpressionUsesDirectImportBinding(sourceFile, expression)) return false;
  const root = securityIrLeftmostExecutableRoot(expression);
  return root !== undefined && securityIrIdentifierBindingScope(sourceFile, root) === 'module';
}

function browserCallbackIsReviewedExecutable(
  boundary: ts.ConciseBody,
  expression: ts.Expression,
  locals: ReadonlySet<string>,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
): boolean {
  const current = unwrapExpression(expression);
  if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) return true;
  if (!ts.isIdentifier(current)) return false;
  if (
    compilerSetHas(browserPureGlobalCalls, current.text) &&
    !identifierIsShadowedWithinBoundary(current, boundary)
  ) {
    return true;
  }
  return (
    compilerSetHas(locals, current.text) &&
    resolveSameFileSecurityIrCallable(current.getSourceFile(), current) !== undefined &&
    !browserLocalCallableAliasIsOpaque(boundary, current.text, compilerCreateSet<string>())
  );
}

function browserMemberUseIsOwnedByParent(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): boolean {
  const parent = node.parent;
  return (
    ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === node) ||
    ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node) ||
    (ts.isTaggedTemplateExpression(parent) && parent.tag === node) ||
    (ts.isBinaryExpression(parent) &&
      (isAssignmentOperator(parent.operatorToken.kind) ||
        parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) &&
      (parent.left === node || parent.right === node)) ||
    ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
      parent.operand === node) ||
    (ts.isDeleteExpression(parent) && parent.expression === node)
  );
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

function browserTimerCallbackIsReviewed(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  expression: ts.Expression | undefined,
  locals: ReadonlySet<string>,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
): boolean {
  if (
    expression === undefined ||
    browserTimerCallbackIsSourceText(expression) ||
    !browserCallbackIsReviewedExecutable(body, expression, locals, aliases)
  ) {
    return false;
  }
  const current = unwrapExpression(expression);
  const callable =
    ts.isArrowFunction(current) || ts.isFunctionExpression(current)
      ? current
      : resolveSameFileSecurityIrCallable(sourceFile, current)?.declaration;
  return callable !== undefined && callable.parameters.length === 0;
}

function browserTimerCallbackStateCaptureNode(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  expression: ts.Expression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
): ts.Node | undefined {
  const current = unwrapExpression(expression);
  const callable =
    ts.isArrowFunction(current) || ts.isFunctionExpression(current)
      ? { body: current.body, declaration: current }
      : resolveSameFileSecurityIrCallable(sourceFile, current);
  if (!callable) return expression;
  const stateDerivedBindings = browserStateDerivedBindingNames(body, aliases);
  let captured: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (captured !== undefined) return;
    if (
      ts.isIdentifier(node) &&
      browserIdentifierIsValueReference(node) &&
      !identifierIsShadowedWithinBoundary(node, callable.declaration) &&
      (browserExpressionMayCarryState(node, aliases, body) ||
        compilerSetHas(stateDerivedBindings, node.text))
    ) {
      captured = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(callable.body);
  return captured;
}

function browserIdentifierIsValueReference(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (ts.isPropertyAssignment(parent) && parent.name === identifier) ||
    (ts.isMethodDeclaration(parent) && parent.name === identifier) ||
    (ts.isGetAccessorDeclaration(parent) && parent.name === identifier) ||
    (ts.isSetAccessorDeclaration(parent) && parent.name === identifier) ||
    (ts.isVariableDeclaration(parent) && parent.name === identifier) ||
    (ts.isParameter(parent) && parent.name === identifier) ||
    (ts.isBindingElement(parent) && parent.name === identifier) ||
    ((ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent)) &&
      parent.name === identifier) ||
    ts.isPropertySignature(parent) ||
    ts.isTypeReferenceNode(parent) ||
    ts.isTypeQueryNode(parent) ||
    ts.isQualifiedName(parent) ||
    ts.isLabeledStatement(parent) ||
    ts.isBreakStatement(parent) ||
    ts.isContinueStatement(parent)
  ) {
    return false;
  }
  return true;
}

function browserTimerCallViolation(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  call: ts.CallExpression,
  locals: ReadonlySet<string>,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
):
  | {
      readonly detail: string;
      readonly kind: SecurityOperationViolationModel['kind'];
      readonly node: ts.Node;
    }
  | undefined {
  const callback = call.arguments[0];
  if (browserTimerCallbackIsSourceText(callback)) {
    return {
      detail: 'string timer callbacks execute source text and are outside the finite handler IR',
      kind: 'raw-dom-operation',
      node: callback!,
    };
  }
  if (!browserTimerCallbackIsReviewed(sourceFile, body, callback, locals, aliases)) {
    return {
      detail:
        'timer callbacks must be exact zero-parameter reviewed local executables, never source text',
      kind: 'computed-security-operation',
      node: callback ?? call,
    };
  }
  const stateCapture = browserTimerCallbackStateCaptureNode(sourceFile, body, callback!, aliases);
  if (stateCapture !== undefined) {
    return {
      detail:
        'deferred timer callbacks cannot read, write, or capture handler state without a queued state transaction',
      kind: 'computed-security-operation',
      node: stateCapture,
    };
  }
  if (call.arguments.length !== 2) {
    return {
      detail: 'timers require exactly one reviewed callback and one primitive delay',
      kind: 'computed-security-operation',
      node: call,
    };
  }
  const delay = call.arguments[1]!;
  if (
    !browserStateMethodScalarArgumentIsReviewed(
      sourceFile,
      body,
      delay,
      aliases,
      compilerCreateSet<string>(),
    )
  ) {
    return {
      detail: 'timer delay must be an exact reviewed primitive without coercion protocols',
      kind: 'computed-security-operation',
      node: delay,
    };
  }
  return undefined;
}

function browserTimerCancelCallViolation(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  call: ts.CallExpression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
):
  | {
      readonly detail: string;
      readonly kind: SecurityOperationViolationModel['kind'];
      readonly node: ts.Node;
    }
  | undefined {
  if (call.arguments.length !== 1) {
    return {
      detail: 'timer cancellation requires exactly one reviewed primitive timer handle',
      kind: 'computed-security-operation',
      node: call,
    };
  }
  const handle = call.arguments[0]!;
  if (
    browserTimerHandleIsReviewed(sourceFile, body, handle, aliases, compilerCreateSet<string>())
  ) {
    return undefined;
  }
  return {
    detail:
      'timer cancellation handle must be primitive or the exact result of a finite timer schedule',
    kind: 'computed-security-operation',
    node: handle,
  };
}

function browserTimerHandleIsReviewed(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  expression: ts.Expression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  active: Set<string>,
): boolean {
  const current = unwrapExpression(expression);
  const key = `${current.getStart(sourceFile)}:${current.getEnd()}`;
  if (compilerSetHas(active, key)) return false;
  if (browserExpressionIsVoidOutcome(current, body)) return true;
  if (
    browserStateMethodScalarArgumentIsReviewed(
      sourceFile,
      body,
      current,
      aliases,
      compilerCreateSet<string>(),
    )
  ) {
    return true;
  }
  compilerSetAdd(active, key);
  try {
    if (ts.isIdentifier(current)) {
      const initializer = securityIrImmutableBindingInitializer(sourceFile, current);
      return (
        initializer !== undefined &&
        browserTimerHandleIsReviewed(sourceFile, body, initializer, aliases, active)
      );
    }
    return (
      ts.isCallExpression(current) &&
      browserOperationProvenanceKind(
        browserExpressionProvenance(unwrapExpression(current.expression), aliases, body),
      ) === 'browser.timer.schedule'
    );
  } finally {
    compilerSetDelete(active, key);
  }
}

function browserPureCallUnsafeArgument(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  call: ts.CallExpression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
): ts.Expression | undefined {
  const argumentsSnapshot = compilerSnapshotDenseArray(
    call.arguments,
    'Finite browser intrinsic arguments',
  );
  for (let index = 0; index < argumentsSnapshot.length; index += 1) {
    const argument = argumentsSnapshot[index]!;
    if (
      ts.isSpreadElement(argument) ||
      browserScalarizationInputEscapeNode(
        sourceFile,
        body,
        argument,
        aliases,
        compilerCreateSet<string>(),
      ) !== undefined
    ) {
      return argument;
    }
  }
  return undefined;
}

function browserExpressionIsReviewedFrameworkCall(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): boolean {
  const identity = canonicalFrameworkExportForExpression(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    unwrapExpression(expression),
  );
  return (
    identity !== undefined &&
    reviewedCanonicalClientHandlerImportTarget(identity.module, identity.exportName) !== undefined
  );
}

interface BrowserPublishToClientSummary {
  readonly matched: true;
  readonly returnValue?: ts.Expression;
  readonly violation?: { readonly detail: string; readonly node: ts.Node };
}

/**
 * Exact finite summary for the one authored framework call whose runtime contract is a primitive
 * identity. Import identity alone never opens a helper: the positional value, closed options
 * container, and return transfer are all pinned here and independently enforced at runtime.
 */
function browserPublishToClientSummary(
  sourceFile: ts.SourceFile,
  boundary: ts.ConciseBody,
  call: ts.CallExpression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
): BrowserPublishToClientSummary | undefined {
  const identity = canonicalFrameworkExportForExpression(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    unwrapExpression(call.expression),
  );
  if (!identity || !frameworkExportEquals(identity, PUBLISH_TO_CLIENT_IDENTITY)) return undefined;
  const argumentsSnapshot = compilerSnapshotDenseArray(
    call.arguments,
    'publishToClient finite summary arguments',
  );
  if (argumentsSnapshot.length !== 2) {
    return {
      matched: true,
      violation: {
        detail: 'publishToClient requires exactly value and a closed literal reason object',
        node: call,
      },
    };
  }
  const value = argumentsSnapshot[0]!;
  const options = unwrapExpression(argumentsSnapshot[1]!);
  if (!ts.isObjectLiteralExpression(options) || options.properties.length !== 1) {
    return {
      matched: true,
      violation: {
        detail: 'publishToClient options must be exactly { reason: <non-empty string literal> }',
        node: argumentsSnapshot[1]!,
      },
    };
  }
  const reason = options.properties[0]!;
  if (
    !ts.isPropertyAssignment(reason) ||
    staticPropertyName(reason.name) !== 'reason' ||
    !ts.isStringLiteralLike(reason.initializer) ||
    compilerStringTrim(reason.initializer.text).length === 0
  ) {
    return {
      matched: true,
      violation: {
        detail: 'publishToClient options must be exactly { reason: <non-empty string literal> }',
        node: reason,
      },
    };
  }
  const unsafeValue = browserPublishedPrimitiveEscapeNode(
    sourceFile,
    boundary,
    value,
    aliases,
    compilerCreateSet<string>(),
  );
  if (unsafeValue !== undefined) {
    return {
      matched: true,
      violation: {
        detail: 'publishToClient value must be a compiler-proven primitive literal snapshot',
        node: unsafeValue,
      },
    };
  }
  return { matched: true, returnValue: value };
}

function browserPublishedPrimitiveEscapeNode(
  sourceFile: ts.SourceFile,
  boundary: ts.ConciseBody,
  expression: ts.Expression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  active: Set<string>,
): ts.Node | undefined {
  const current = unwrapExpression(expression);
  const key = `${current.getStart(sourceFile)}:${current.getEnd()}`;
  if (compilerSetHas(active, key)) return current;
  compilerSetAdd(active, key);
  try {
    if (
      ts.isStringLiteralLike(current) ||
      ts.isNumericLiteral(current) ||
      current.kind === ts.SyntaxKind.TrueKeyword ||
      current.kind === ts.SyntaxKind.FalseKeyword ||
      current.kind === ts.SyntaxKind.NullKeyword
    )
      return undefined;
    if (ts.isIdentifier(current)) {
      const initializer = securityIrImmutableBindingInitializer(sourceFile, current);
      return initializer
        ? browserPublishedPrimitiveEscapeNode(sourceFile, boundary, initializer, aliases, active)
        : current;
    }
    if (
      ts.isPrefixUnaryExpression(current) &&
      (current.operator === ts.SyntaxKind.PlusToken ||
        current.operator === ts.SyntaxKind.MinusToken) &&
      ts.isNumericLiteral(unwrapExpression(current.operand))
    ) {
      return undefined;
    }
    if (
      ts.isCallExpression(current) &&
      browserScalarCallResultIsReviewed(sourceFile, boundary, current, aliases, active)
    ) {
      return undefined;
    }
    return current;
  } finally {
    compilerSetDelete(active, key);
  }
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
  appendStateWriteValue: (node: ts.Expression, detail: string) => void,
): void {
  const callee = unwrapExpression(call.expression);
  const publishToClientSummary = browserPublishToClientSummary(sourceFile, body, call, aliases);
  if (publishToClientSummary !== undefined) {
    if (publishToClientSummary.violation !== undefined) {
      appendViolation(
        publishToClientSummary.violation.node,
        'computed-security-operation',
        publishToClientSummary.violation.detail,
      );
      return;
    }
    appendOperation('browser.framework.call', call, 'publishToClient');
    return;
  }
  if (ts.isIdentifier(callee)) {
    const provenance = browserExpressionProvenance(callee, aliases, body);
    const operationKind = browserOperationProvenanceKind(provenance);
    if (operationKind !== undefined) {
      if (operationKind === 'browser.timer.schedule') {
        const violation = browserTimerCallViolation(sourceFile, body, call, locals, aliases);
        if (violation) {
          appendViolation(violation.node, violation.kind, violation.detail);
          return;
        }
      } else if (operationKind === 'browser.timer.cancel') {
        const violation = browserTimerCancelCallViolation(sourceFile, body, call, aliases);
        if (violation) {
          appendViolation(violation.node, violation.kind, violation.detail);
          return;
        }
      } else if (operationKind === 'browser.framework.call') {
        appendViolation(
          call,
          'computed-security-operation',
          'authored inline framework-helper calls require an exact per-export security summary',
        );
        return;
      }
      appendOperation(operationKind, call, callee.text);
      return;
    }
    if (compilerSetHas(locals, callee.text)) {
      appendViolation(
        call,
        'computed-security-operation',
        `local helper ${callee.text} is outside the finite handler language; inline the finite expression`,
      );
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
      const violation = browserTimerCallViolation(sourceFile, body, call, locals, aliases);
      if (violation) {
        appendViolation(violation.node, violation.kind, violation.detail);
        return;
      }
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
    if (
      compilerSetHas(browserPureGlobalCalls, callee.text) &&
      !identifierIsShadowedWithinBoundary(callee, body)
    ) {
      const unsafeArgument = browserPureCallUnsafeArgument(sourceFile, body, call, aliases);
      if (unsafeArgument !== undefined) {
        appendViolation(
          unsafeArgument,
          'computed-security-operation',
          `${callee.text} cannot invoke coercion or object protocols on an unproved browser value`,
        );
      }
      return;
    }
    appendViolation(
      call,
      'unknown-security-operation',
      `browser call ${callee.text} has no exact reviewed finite identity`,
    );
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
    if (member.name === 'call' || member.name === 'apply' || member.name === 'bind') {
      appendViolation(
        call,
        'computed-security-operation',
        `browser operation ${member.name} indirection is outside the exact finite call shape`,
      );
      return;
    }
    if (calleeOperationKind === 'browser.timer.schedule') {
      const violation = browserTimerCallViolation(sourceFile, body, call, locals, aliases);
      if (violation) {
        appendViolation(violation.node, violation.kind, violation.detail);
        return;
      }
    } else if (calleeOperationKind === 'browser.timer.cancel') {
      const violation = browserTimerCancelCallViolation(sourceFile, body, call, aliases);
      if (violation) {
        appendViolation(violation.node, violation.kind, violation.detail);
        return;
      }
    } else if (calleeOperationKind === 'browser.framework.call') {
      appendViolation(
        call,
        'computed-security-operation',
        'authored inline framework-helper calls require an exact per-export security summary',
      );
      return;
    }
    appendOperation(calleeOperationKind, call, browserExpressionTarget(callee) ?? member.name);
    return;
  }

  const localArrayMethod = browserReviewedLocalArrayMethodCall(sourceFile, callee, body, aliases);
  if (localArrayMethod !== undefined) {
    const callback = call.arguments[0];
    if (
      call.arguments.length !== 1 ||
      callback === undefined ||
      !browserCallbackIsReviewedExecutable(body, callback, locals, aliases)
    ) {
      appendViolation(
        call,
        'computed-security-operation',
        `local array ${localArrayMethod} requires one exact reviewed callback`,
      );
    }
    return;
  }

  const stateMethod = browserReviewedStateMethodCall(callee, aliases, body);
  if (stateMethod !== undefined) {
    const argumentsSnapshot = compilerSnapshotDenseArray(
      call.arguments,
      `State ${stateMethod} executable arguments`,
    );
    for (let index = 0; index < argumentsSnapshot.length; index += 1) {
      const kind = browserStateMethodExecutableArgumentKind(stateMethod, index);
      if (
        kind === undefined ||
        !browserStateExecutableArgumentIsReviewed(
          sourceFile,
          body,
          argumentsSnapshot[index]!,
          kind,
          locals,
          aliases,
        )
      ) {
        appendViolation(
          argumentsSnapshot[index]!,
          'computed-security-operation',
          `state ${stateMethod} argument ${index} is outside the closed own-data/scalar vocabulary`,
        );
        return;
      }
    }
    appendOperation(
      compilerSetHas(browserStateMutatorMethods, stateMethod)
        ? 'browser.state.write'
        : 'browser.state.read',
      call,
      browserCanonicalStateTarget(sourceFile, callee, aliases, body) ?? stateMethod,
    );
    const storedArguments = browserStateMethodStoredArguments(call, stateMethod);
    for (let index = 0; index < storedArguments.length; index += 1) {
      appendStateWriteValue(storedArguments[index]!, `state.${stateMethod} insertion`);
    }
    return;
  }

  const provenance = browserExpressionProvenance(member.receiver, aliases, body);
  const reviewedLocalMember = resolveSameFileSecurityIrCallable(sourceFile, callee);
  if (reviewedLocalMember !== undefined) {
    appendViolation(
      call,
      'computed-security-operation',
      `local member helper ${reviewedLocalMember.name} is outside the finite handler language`,
    );
    return;
  }
  if (provenance === 'state') {
    appendViolation(
      callee,
      'computed-security-operation',
      `state JSON member ${member.name} is not a reviewed callable data method`,
    );
    return;
  }
  if (provenance === 'event') {
    appendViolation(
      call,
      'computed-security-operation',
      `raw event operation ${member.name} has no framework-pinned receiver and is outside the finite handler IR`,
    );
    return;
  }
  if (isDomProvenance(provenance)) {
    appendViolation(
      call,
      'raw-dom-operation',
      `raw DOM method ${member.name} has no framework-pinned receiver and is outside the finite handler IR`,
    );
    return;
  }

  const root = rootIdentifier(member.receiver);
  if (provenance === 'raw-browser' || provenance === 'unknown-authority') {
    appendViolation(
      call,
      'computed-security-operation',
      `browser capability call ${browserExpressionTarget(callee) ?? member.name} is outside the finite handler IR`,
    );
    return;
  }

  if (root && !compilerSetHas(locals, root) && compilerSetHas(rawBrowserGlobalNames, root)) {
    appendViolation(
      call,
      'raw-dom-operation',
      `raw browser global operation ${root}.${member.name} is outside the finite handler IR`,
    );
    return;
  }

  if (provenance === 'local' || (root !== undefined && compilerSetHas(locals, root))) {
    appendViolation(
      call,
      'computed-security-operation',
      `local member call ${member.name} is outside the finite handler language`,
    );
    return;
  }

  const globalMember = root ? `${root}.${member.name}` : undefined;
  if (
    provenance === 'unknown' &&
    globalMember !== undefined &&
    compilerSetHas(browserAsynchronousGlobalMemberCalls, globalMember)
  ) {
    appendViolation(
      call,
      'computed-security-operation',
      `${globalMember} creates asynchronous work outside the synchronous finite handler IR`,
    );
    return;
  }
  if (
    provenance === 'unknown' &&
    globalMember === 'Object.assign' &&
    call.arguments[0] !== undefined &&
    browserExpressionMayCarryState(call.arguments[0], aliases, body)
  ) {
    appendViolation(
      call.arguments[0],
      'computed-security-operation',
      'Object.assign cannot mutate state outside an exact compiler-owned state-write operation',
    );
    return;
  }
  if (
    provenance === 'unknown' &&
    globalMember !== undefined &&
    compilerSetHas(browserPureGlobalMemberCalls, globalMember)
  ) {
    const unsafeArgument = browserPureCallUnsafeArgument(sourceFile, body, call, aliases);
    if (unsafeArgument !== undefined) {
      appendViolation(
        unsafeArgument,
        'computed-security-operation',
        `${globalMember} cannot invoke callbacks, coercion, or object protocols on an unproved value`,
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

function browserLocalCallableAliasIsOpaque(
  body: ts.ConciseBody,
  name: string,
  seen: Set<string>,
): boolean {
  if (compilerSetHas(seen, name)) return true;
  if (moduleBindingIsAssigned(body.getSourceFile(), name)) return true;
  compilerSetAdd(seen, name);
  let foundBinding = false;
  let opaque = false;
  const visit = (node: ts.Node): void => {
    if (opaque) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      foundBinding = true;
      return;
    }
    if (ts.isClassDeclaration(node) && node.name?.text === name) {
      foundBinding = true;
      opaque = true;
      return;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      foundBinding = true;
      if (!node.initializer) {
        opaque = true;
        return;
      }
      const initializer = unwrapExpression(node.initializer);
      if (
        ts.isArrowFunction(initializer) ||
        ts.isFunctionExpression(initializer) ||
        ts.isClassExpression(initializer)
      ) {
        return;
      }
      if (ts.isIdentifier(initializer)) {
        opaque = browserLocalCallableAliasIsOpaque(body, initializer.text, seen);
        return;
      }
      opaque = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return foundBinding ? opaque : !compilerSetHas(localBindingNames(body), name);
}

/** Scanner/source-text boundary for structured server effects. */
const SECURITY_SEMANTIC_CALL_DEPTH_BUDGET = securityAbstractInterpreterBudgets.callDepth;
const SECURITY_SEMANTIC_NODE_BUDGET = securityAbstractInterpreterBudgets.nodes;
const SECURITY_SEMANTIC_OPERATION_BUDGET = securityAbstractInterpreterBudgets.operations;
const SECURITY_SEMANTIC_SUMMARY_BUDGET = securityAbstractInterpreterBudgets.summaries;

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

/**
 * Route pages predate the full server semantic-root manifest, but their storage/download doors
 * share the same ScopedKey obligation (SPEC §6.6). Reuse the exact scanner and expose only KV450
 * closures until route pages are enrolled as first-class finite-IR roots.
 */
export function scanServerScopedKeySinkViolations(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  parameters: readonly ts.ParameterDeclaration[],
): readonly SecurityOperationViolationModel[] {
  const facts = scanServerSecurityOperationsDirect(sourceFile, body, 'route', parameters);
  const violations: SecurityOperationViolationModel[] = [];
  const snapshot = compilerSnapshotDenseArray(facts.violations, 'Route scoped-key sink violations');
  for (let index = 0; index < snapshot.length; index += 1) {
    const violation = snapshot[index]!;
    if (violation.kind === 'unscoped-state-key') {
      compilerArrayAppend(violations, violation, 'Route scoped-key sink violations');
    }
  }
  return dedupeViolations(violations);
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
      : `${surface}\0${callable.name}\0${compilerArrayJoin(parameterProvenances ?? [], ',')}`;

  if (signature !== undefined && compilerSetHas(state.active, signature)) {
    securityAbstractTransfer('helper.cycle-close');
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
        securityAbstractTransfer('budget.summary-count-close');
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
      securityAbstractTransfer('budget.node-count-close');
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
        securityAbstractTransfer('budget.operation-count-close');
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
              sliceHash: `sha256:${compilerSha256Utf16leHex(
                compilerStringSlice(sourceFile.text, operation.span.start, operation.span.end),
              )}`,
              span: { end: operation.span.end, start: operation.span.start },
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
            securityAbstractTransfer('budget.call-depth-close');
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
        securityAbstractTransfer('helper.spread-close');
        unsupportedDetail = `authority-bearing spread argument into local:${callable.name} has no finite parameter mapping`;
      } else if (restParameterIndex !== undefined && index >= restParameterIndex) {
        securityAbstractTransfer('helper.rest-argument-close');
        unsupportedDetail = `authority-bearing rest argument into local:${callable.name} is outside the finite summary semantics`;
      } else if (index >= parameterSnapshot.length) {
        securityAbstractTransfer('helper.extra-argument-close');
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
      securityAbstractTransfer('helper.rest-parameter-close');
      unsupportedDetail = `authority-bearing rest parameter in local:${callable.name} is outside the finite summary semantics`;
    }
  }
  if (authorityInputs.length > 0 && semanticBodyUsesArguments(callable.body)) {
    securityAbstractTransfer('helper.arguments-close');
    unsupportedDetail = `arguments-object authority recovery in local:${callable.name} is outside the finite summary semantics`;
  }

  const transfer = securityAbstractHelperTransfer(callable.name, authorityInputs);
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
    case 'derived-dataset-scope':
    case 'governed-data-persistence':
    case 'incomplete-mutation-form':
    case 'raw-capability-operation':
    case 'raw-dom-operation':
    case 'unscoped-state-key':
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
        ? `${value.sink.kind}\0${value.sink.door}\0${value.sink.sliceHash}\0${value.sink.span.start}\0${value.sink.span.end}\0${value.sink.target ?? ''}`
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
  surface: ServerSecurityScanSurface,
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
          appendUnsafeWireBodyViolation(
            node.arguments?.[0],
            'new Response',
            aliases,
            appendViolation,
          );
          appendForbiddenResponseInitHeaderViolation(
            sourceFile,
            node.arguments?.[1],
            'new Response',
            appendViolation,
          );
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

interface ServerScopedKeySink {
  readonly closedOptions?: ts.Node;
  readonly exactRespond?: boolean;
  readonly key?: ts.Node;
  readonly proven: boolean;
  readonly target: string;
}

interface ServerDerivedDatasetCall {
  readonly kind: 'query' | 'upsert';
  readonly request: ts.Node;
  readonly requestScoped: boolean;
  readonly target: string;
}

/**
 * Recognize only operations on the module-constant handle returned by the exact framework
 * `derived()` constructor. Structural lookalikes never acquire `derived-dataset` provenance.
 */
function serverDerivedDatasetCall(
  call: ts.CallExpression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): ServerDerivedDatasetCall | undefined {
  const callee = unwrapExpression(call.expression);
  const calleeProvenance = serverExpressionProvenance(callee, aliases);
  const kind =
    calleeProvenance === 'derived-query-call'
      ? 'query'
      : calleeProvenance === 'derived-upsert-call'
        ? 'upsert'
        : undefined;
  if (kind === undefined) return undefined;

  const request = call.arguments[0] ?? call;
  return {
    kind,
    request,
    requestScoped:
      call.arguments.length === 2 &&
      call.arguments[0] !== undefined &&
      serverExpressionProvenance(call.arguments[0], aliases) === 'request',
    target: expressionPath(callee) ?? `derived.${kind}`,
  };
}

/**
 * SPEC §6.6/§10.3 C9: governed data may leave the managed engine only through `derived()`.
 * This vocabulary deliberately names the existing durable non-engine doors rather than trying to
 * classify arbitrary JavaScript effects.
 */
function serverPersistentNonEngineSink(
  call: ts.CallExpression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): ts.Expression | undefined {
  const member = staticMember(unwrapExpression(call.expression));
  if (!member) return undefined;
  const receiver = serverExpressionProvenance(member.receiver, aliases);
  let firstPayloadIndex: number | undefined;
  if (receiver === 'storage' && member.name === 'put') {
    firstPayloadIndex = 1;
  } else if (receiver === 'context' && member.name === 'fetch') {
    firstPayloadIndex = 0;
  } else if ((receiver === 'request' || receiver === 'context') && member.name === 'schedule') {
    firstPayloadIndex = 1;
  }
  if (firstPayloadIndex === undefined) return undefined;

  const argumentsList = compilerSnapshotDenseArray(
    call.arguments,
    'Persistent non-engine sink arguments',
  );
  for (let index = firstPayloadIndex; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]!;
    const expression = ts.isSpreadElement(argument) ? argument.expression : argument;
    if (serverExpressionProvenance(expression, aliases) === 'governed-data') return expression;
  }
  return undefined;
}

type ServerExactObjectProperty =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly values: readonly ts.Expression[] }
  | { readonly kind: 'unknown' };

function serverScopedKeySink(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  surface: ServerSecurityScanSurface,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): ServerScopedKeySink | undefined {
  const callee = unwrapExpression(call.expression);
  const member = staticMember(callee);
  if (!member) return undefined;
  const receiverProvenance = serverExpressionProvenance(member.receiver, aliases);
  const target = `${expressionPath(member.receiver) ?? 'computed'}.${member.name}`;
  const exactRespond = serverCallUsesExactRespondNamespace(sourceFile, call, member.receiver);

  if (exactRespond && member.name !== 'storedFile') {
    return member.name === 'file' || member.name === 'stream'
      ? { exactRespond: true, proven: true, target }
      : undefined;
  }

  if (
    (receiverProvenance === 'storage' &&
      (member.name === 'delete' ||
        member.name === 'get' ||
        member.name === 'put' ||
        member.name === 'stat' ||
        member.name === 'stream')) ||
    ((receiverProvenance === 'respond' || exactRespond) && member.name === 'storedFile')
  ) {
    const keyIndex = member.name === 'storedFile' ? 1 : 0;
    const key = call.arguments[keyIndex] ?? call;
    return {
      ...(exactRespond ? { exactRespond: true } : {}),
      key,
      proven:
        call.arguments[keyIndex] !== undefined &&
        serverExpressionIsExactScopedKey(
          sourceFile,
          call.arguments[keyIndex]!,
          surface,
          aliases,
          compilerCreateSet<number>(),
          0,
        ),
      target,
    };
  }

  if (receiverProvenance === 'context' && member.name === 'signUrl') {
    const options = call.arguments[0];
    if (!options) return { closedOptions: call, proven: false, target };
    const property = serverExactOwnObjectProperty(
      sourceFile,
      options,
      'key',
      compilerCreateSet<number>(),
      0,
    );
    if (property.kind !== 'present') {
      return { closedOptions: options, proven: false, target };
    }
    const proven = serverEveryExpressionIsExactScopedKey(
      sourceFile,
      property.values,
      surface,
      aliases,
    );
    return { key: property.values[0] ?? options, proven, target };
  }

  if (
    (receiverProvenance === 'request' || receiverProvenance === 'context') &&
    member.name === 'schedule' &&
    call.arguments[2] !== undefined
  ) {
    const options = call.arguments[2]!;
    const property = serverExactOwnObjectProperty(
      sourceFile,
      options,
      'key',
      compilerCreateSet<number>(),
      0,
    );
    if (property.kind === 'absent') return undefined;
    if (property.kind === 'unknown') {
      return { closedOptions: options, proven: false, target };
    }
    const proven = serverEveryExpressionIsExactScopedKey(
      sourceFile,
      property.values,
      surface,
      aliases,
    );
    return { key: property.values[0] ?? options, proven, target };
  }
  return undefined;
}

function serverEveryExpressionIsExactScopedKey(
  sourceFile: ts.SourceFile,
  values: readonly ts.Expression[],
  surface: ServerSecurityScanSurface,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  const snapshot = compilerSnapshotDenseArray(values, 'Finite scoped-key object properties');
  if (snapshot.length === 0) return false;
  for (let index = 0; index < snapshot.length; index += 1) {
    if (
      !serverExpressionIsExactScopedKey(
        sourceFile,
        snapshot[index]!,
        surface,
        aliases,
        compilerCreateSet<number>(),
        0,
      )
    ) {
      return false;
    }
  }
  return true;
}

function serverExpressionIsExactScopedKey(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  surface: ServerSecurityScanSurface,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
  active: Set<number>,
  depth: number,
): boolean {
  if (depth > SECURITY_SEMANTIC_CALL_DEPTH_BUDGET) return false;
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) {
    const initializer = securityIrImmutableBindingInitializer(sourceFile, current);
    if (!initializer) return false;
    const key = initializer.getStart(sourceFile);
    if (compilerSetHas(active, key)) return false;
    compilerSetAdd(active, key);
    try {
      return serverExpressionIsExactScopedKey(
        sourceFile,
        initializer,
        surface,
        aliases,
        active,
        depth + 1,
      );
    } finally {
      compilerSetDelete(active, key);
    }
  }
  if (ts.isConditionalExpression(current)) {
    return (
      serverExpressionIsExactScopedKey(
        sourceFile,
        current.whenTrue,
        surface,
        aliases,
        active,
        depth + 1,
      ) &&
      serverExpressionIsExactScopedKey(
        sourceFile,
        current.whenFalse,
        surface,
        aliases,
        active,
        depth + 1,
      )
    );
  }
  return (
    ts.isCallExpression(current) &&
    serverCallIsExactScopedKeyConstructor(sourceFile, current, surface, aliases)
  );
}

function serverCallIsExactScopedKeyConstructor(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  surface: ServerSecurityScanSurface,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  const callee = unwrapExpression(call.expression);
  if (
    frameworkIdentityIn(
      canonicalFrameworkExportForExpression(ts as FrameworkIdentityTypeScript, sourceFile, callee),
      PUBLIC_SCOPED_KEY_IDENTITIES,
    )
  ) {
    return !!(
      ts.isIdentifier(callee) &&
      callee.text === 'publicScopedKey' &&
      securityIrExpressionUsesDirectImportBinding(sourceFile, callee) &&
      securityIrMemberCallableIsStable(sourceFile, callee, call) &&
      call.arguments.length === 1 &&
      !serverArgumentsContainAuthority(call.arguments, aliases) &&
      !serverArgumentsContainForeignExecutable(call.arguments, aliases)
    );
  }
  if (
    serverCallUsesExactNamedFrameworkImport(
      sourceFile,
      call,
      callee,
      'scopedKey',
      SCOPED_KEY_IDENTITY,
    )
  ) {
    return !!(
      call.arguments.length === 2 &&
      serverExpressionProvenance(call.arguments[0]!, aliases) === 'request' &&
      !serverExpressionCarriesAuthority(call.arguments[1]!, aliases) &&
      serverExpressionProvenance(call.arguments[1]!, aliases) !== 'foreign-executable'
    );
  }
  const member = staticMember(callee);
  if (!member || surface !== 'task' || call.arguments.length !== 1) return false;
  if (
    serverExpressionCarriesAuthority(call.arguments[0]!, aliases) ||
    serverExpressionProvenance(call.arguments[0]!, aliases) === 'foreign-executable' ||
    !securityIrMemberCallableIsStable(sourceFile, callee, call)
  ) {
    return false;
  }
  if (member.name === 'systemStateKey') {
    return serverExpressionProvenance(member.receiver, aliases) === 'context';
  }
  return (
    member.name === 'stateKey' &&
    serverExpressionIsExactTaskScope(
      sourceFile,
      member.receiver,
      aliases,
      compilerCreateSet<number>(),
      0,
    )
  );
}

function serverExpressionIsExactTaskScope(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
  active: Set<number>,
  depth: number,
): boolean {
  if (depth > SECURITY_SEMANTIC_CALL_DEPTH_BUDGET) return false;
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) {
    const initializer = securityIrImmutableBindingInitializer(sourceFile, current);
    if (!initializer) return false;
    const key = initializer.getStart(sourceFile);
    if (compilerSetHas(active, key)) return false;
    compilerSetAdd(active, key);
    try {
      return serverExpressionIsExactTaskScope(sourceFile, initializer, aliases, active, depth + 1);
    } finally {
      compilerSetDelete(active, key);
    }
  }
  if (!ts.isCallExpression(current)) return false;
  const callee = unwrapExpression(current.expression);
  const member = staticMember(callee);
  return !!(
    member &&
    (member.name === 'actAs' ||
      member.name === 'declareSystemRead' ||
      member.name === 'declareSystemWrite') &&
    serverExpressionProvenance(member.receiver, aliases) === 'context' &&
    current.arguments.length === 1 &&
    !serverArgumentsContainAuthority(current.arguments, aliases) &&
    !serverArgumentsContainForeignExecutable(current.arguments, aliases) &&
    securityIrMemberCallableIsStable(sourceFile, callee, current)
  );
}

function serverExactOwnObjectProperty(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  propertyName: string,
  active: Set<number>,
  depth: number,
): ServerExactObjectProperty {
  if (depth > SECURITY_SEMANTIC_CALL_DEPTH_BUDGET) return { kind: 'unknown' };
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) {
    const initializer = securityIrImmutableBindingInitializer(sourceFile, current);
    if (!initializer) return { kind: 'unknown' };
    const key = initializer.getStart(sourceFile);
    if (compilerSetHas(active, key)) return { kind: 'unknown' };
    compilerSetAdd(active, key);
    try {
      return serverExactOwnObjectProperty(sourceFile, initializer, propertyName, active, depth + 1);
    } finally {
      compilerSetDelete(active, key);
    }
  }
  if (ts.isConditionalExpression(current)) {
    const whenTrue = serverExactOwnObjectProperty(
      sourceFile,
      current.whenTrue,
      propertyName,
      active,
      depth + 1,
    );
    const whenFalse = serverExactOwnObjectProperty(
      sourceFile,
      current.whenFalse,
      propertyName,
      active,
      depth + 1,
    );
    if (whenTrue.kind === 'absent' && whenFalse.kind === 'absent') return { kind: 'absent' };
    if (whenTrue.kind !== 'present' || whenFalse.kind !== 'present') return { kind: 'unknown' };
    const values: ts.Expression[] = [];
    const trueValues = compilerSnapshotDenseArray(
      whenTrue.values,
      'Finite conditional object property values',
    );
    const falseValues = compilerSnapshotDenseArray(
      whenFalse.values,
      'Finite conditional object property values',
    );
    for (let index = 0; index < trueValues.length; index += 1) {
      compilerArrayAppend(values, trueValues[index]!, 'Finite conditional object property values');
    }
    for (let index = 0; index < falseValues.length; index += 1) {
      compilerArrayAppend(values, falseValues[index]!, 'Finite conditional object property values');
    }
    return { kind: 'present', values };
  }
  if (!ts.isObjectLiteralExpression(current)) return { kind: 'unknown' };
  let value: ts.Expression | undefined;
  const properties = compilerSnapshotDenseArray(
    current.properties,
    'Finite scoped-key sink options',
  );
  for (let index = 0; index < properties.length; index += 1) {
    const property = properties[index]!;
    if (ts.isSpreadAssignment(property) || ts.isComputedPropertyName(property.name)) {
      return { kind: 'unknown' };
    }
    if (staticPropertyName(property.name) !== propertyName) continue;
    if (value !== undefined) return { kind: 'unknown' };
    if (ts.isPropertyAssignment(property)) {
      value = property.initializer;
    } else if (ts.isShorthandPropertyAssignment(property)) {
      value = property.name;
    } else {
      return { kind: 'unknown' };
    }
  }
  return value === undefined ? { kind: 'absent' } : { kind: 'present', values: [value] };
}

function serverCallUsesExactRespondNamespace(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  receiver: ts.Expression,
): boolean {
  const current = unwrapExpression(receiver);
  return !!(
    ts.isIdentifier(current) &&
    current.text === 'respond' &&
    frameworkExportEquals(
      canonicalFrameworkExportForExpression(ts as FrameworkIdentityTypeScript, sourceFile, current),
      RESPOND_IDENTITY,
    ) &&
    securityIrExpressionUsesDirectImportBinding(sourceFile, current) &&
    securityIrMemberCallableIsStable(sourceFile, unwrapExpression(call.expression), call)
  );
}

function classifyServerCall(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  surface: ServerSecurityScanSurface,
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
  const derivedCall = serverDerivedDatasetCall(call, aliases);
  if (derivedCall !== undefined) {
    if (!derivedCall.requestScoped) {
      appendViolation(
        derivedCall.request,
        'derived-dataset-scope',
        `${derivedCall.target} requires the exact framework request principal binding`,
      );
    }
    appendOperation(
      derivedCall.kind === 'query' ? 'server.storage.read' : 'server.storage.write',
      call,
      derivedCall.target,
    );
    return;
  }
  const persistentSink = serverPersistentNonEngineSink(call, aliases);
  if (persistentSink !== undefined) {
    appendViolation(
      persistentSink,
      'governed-data-persistence',
      'owner-scoped or governed data reaches a persistent non-engine sink; use the framework-owned derived() door',
    );
  }
  if (serverCallIsExactScopedKeyConstructor(sourceFile, call, surface, aliases)) {
    // SPEC §6.6: these are the only app-authored constructors whose module identity and request or
    // task authority let a key reach a non-database stateful sink. Runtime witness validation at
    // every sink remains the security proof; this exact syntax gate rejects strings and casts
    // before lowering.
    return;
  }
  const scopedKeySink = serverScopedKeySink(sourceFile, call, surface, aliases);
  if (scopedKeySink?.key !== undefined && !scopedKeySink.proven) {
    appendViolation(
      scopedKeySink.key,
      'unscoped-state-key',
      `${scopedKeySink.target} requires a key derived by an exact scopedKey, publicScopedKey, or task stateKey constructor`,
    );
  }
  if (scopedKeySink?.closedOptions !== undefined) {
    appendViolation(
      scopedKeySink.closedOptions,
      'unscoped-state-key',
      `${scopedKeySink.target} options must be a finite object whose key posture is statically closed`,
    );
  }
  if (scopedKeySink?.exactRespond === true) {
    appendOperation('server.response.outcome', call, scopedKeySink.target);
    return;
  }
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
  if (serverCallIsExactTrustedSqlRaw(sourceFile, call)) {
    // SPEC §6.6: the raw constructor is plain reviewed SQL data only as argument zero of the
    // exact trustedSql(static sql.raw literal, { justification }) door. A free-standing,
    // dynamic, computed, aliased, or mutable raw constructor falls through to KV449.
    return;
  }
  if (serverCallIsExactDeclaredSecretReadCapability(sourceFile, call, aliases)) {
    // The Drizzle request analyzer independently proves declaration-before-one-execution and the
    // runtime validates the private statement witness. Finite IR admits only the same exact
    // public constructor and immutable trustedSql statement shape.
    return;
  }
  if (serverCallIsExactDeclassifyPolicyConstructor(sourceFile, call)) {
    // The runtime constructor independently validates and registers the immutable policy. Static
    // admission requires the same direct class import and closed literal registry tuple.
    return;
  }
  if (frameworkExportEquals(frameworkIdentity, TRUSTED_REVEAL_IDENTITY)) {
    const policy = serverExactTrustedRevealPolicy(sourceFile, call);
    const released = call.arguments[0];
    const releaseProvenance = released
      ? serverDeclassifyExpressionProvenance(sourceFile, released, aliases)
      : 'unknown-authority';
    const condition = serverDeclassifyEnablingCondition(call, aliases);
    if (
      !serverCallUsesExactNamedFrameworkImport(
        sourceFile,
        call,
        callee,
        'trustedReveal',
        TRUSTED_REVEAL_IDENTITY,
      ) ||
      call.arguments.length !== 2 ||
      policy === undefined
    ) {
      appendViolation(
        call,
        'computed-security-operation',
        'trustedReveal declassification requires an exact named import and inline validated DeclassifyPolicy.create tuple',
      );
    } else if (!serverDeclassifyProvenanceIsRobust(releaseProvenance)) {
      appendViolation(
        released ?? call,
        'computed-security-operation',
        `declassification released expression has attacker-controlled or unknown integrity (${releaseProvenance})`,
      );
    } else if (condition !== undefined) {
      appendViolation(
        condition.node,
        'computed-security-operation',
        `declassification enabling condition has attacker-controlled or unknown integrity (${condition.provenance})`,
      );
    } else if (
      serverArgumentsContainAuthority(call.arguments, aliases) ||
      serverArgumentsContainForeignExecutable(call.arguments, aliases)
    ) {
      appendViolation(
        call,
        'computed-security-operation',
        'declassification cannot receive server authority or foreign executable values',
      );
    } else {
      appendOperation('server.data.declassify', call, 'trustedReveal', policy.label);
    }
    return;
  }
  if (serverCallIsExactSecretBox(sourceFile, call, aliases)) {
    // secret() boxes one plain value. It may not receive a server capability or travel through a
    // renamed, aliased, mutable, computed, or foreign callable.
    return;
  }
  if (serverCallIsExactDrizzleTableAlias(sourceFile, call, aliases)) {
    // A schema alias is reviewed data only for an exact Drizzle alias(table, staticName) call over
    // an independently proven project table declaration.
    return;
  }
  if (serverCallIsExactGeneratedReadonlyAppDbRead(sourceFile, call)) {
    // SPEC §6.6 / §9.4 / §10.3: the generated app DB re-export is a read-only managed door only
    // through its exact direct import and reviewed generated source graph. Local aliases,
    // computed members, forged exports, and mutable re-exports never reach this branch.
    appendOperation('server.database.read', call, nodeName(callee));
    return;
  }
  if (serverCallIsExactDeclaredSecretReadExecution(sourceFile, call, aliases)) {
    // SPEC §6.6: one declaration-before-one-execution sequence is the finite read form for a
    // runtime-validated secret SQL witness. The declaration, statement binding, and managed DB
    // receiver must all remain direct and linear; aliases, extra references, and late declarations
    // stay on the generic execute-as-write path below.
    appendOperation('server.database.read', call, nodeName(callee));
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
      sourceFile,
      serverExpressionProvenance(callee, aliases),
      call,
      callee.text,
      surface,
      aliases,
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
      sourceFile,
      provenance,
      call,
      target,
      surface,
      aliases,
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
  if (serverCallDescendsFromExactGeneratedReadonlyAppDbRead(sourceFile, callee, aliases)) {
    if (
      ts.isPropertyAccessExpression(callee) &&
      compilerSetHas(serverReviewedDatabaseBuilderMethods, member.name) &&
      !serverArgumentsContainAuthority(call.arguments, aliases) &&
      !serverArgumentsContainUnreviewedForeignExecutable(sourceFile, call.arguments, aliases)
    ) {
      return;
    }
    appendViolation(
      call,
      'computed-security-operation',
      `unknown or authority-bearing generated readonly database builder continuation ${member.name} ` +
        'is outside the finite server IR',
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
  if (
    provenance === 'safe-call' ||
    provenance === 'governed-data' ||
    provenance === 'unsafe-wire-data'
  ) {
    return;
  }
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

function serverCallIsExactTrustedSqlRaw(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
): boolean {
  const callee = unwrapExpression(call.expression);
  const member = staticMember(callee);
  if (
    !ts.isPropertyAccessExpression(callee) ||
    !member ||
    member.name !== 'raw' ||
    call.arguments.length !== 1 ||
    !serverExpressionIsNonEmptyStaticString(call.arguments[0]!) ||
    !frameworkExportEquals(
      canonicalFrameworkExportForExpression(
        ts as FrameworkIdentityTypeScript,
        sourceFile,
        unwrapExpression(member.receiver),
      ),
      KOVO_SQL_IDENTITY,
    ) ||
    !securityIrExpressionUsesDirectImportBinding(sourceFile, member.receiver) ||
    !securityIrMemberCallableIsStable(sourceFile, callee, call)
  ) {
    return false;
  }

  const parent = call.parent;
  if (
    !ts.isCallExpression(parent) ||
    parent.arguments[0] !== call ||
    parent.arguments.length !== 2
  ) {
    return false;
  }
  const trustedSqlCallee = unwrapExpression(parent.expression);
  return !!(
    frameworkExportEquals(
      canonicalFrameworkExportForExpression(
        ts as FrameworkIdentityTypeScript,
        sourceFile,
        trustedSqlCallee,
      ),
      TRUSTED_SQL_IDENTITY,
    ) &&
    securityIrExpressionUsesDirectImportBinding(sourceFile, trustedSqlCallee) &&
    securityIrMemberCallableIsStable(sourceFile, trustedSqlCallee, parent) &&
    serverExpressionIsExactJustificationOptions(parent.arguments[1]!)
  );
}

function serverCallIsExactDeclaredSecretReadCapability(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  const callee = unwrapExpression(call.expression);
  if (
    !serverCallUsesExactNamedFrameworkImport(
      sourceFile,
      call,
      callee,
      'declareSecretReadCapability',
      DECLARE_SECRET_READ_CAPABILITY_IDENTITY,
    ) ||
    call.arguments.length !== 2 ||
    serverArgumentsContainAuthority(call.arguments, aliases) ||
    serverArgumentsContainForeignExecutable(call.arguments, aliases) ||
    !serverExpressionIsExactSecretReadDeclaration(call.arguments[1]!)
  ) {
    return false;
  }

  const statement = unwrapExpression(call.arguments[0]!);
  if (!ts.isIdentifier(statement)) return false;
  const initializer = securityIrImmutableBindingInitializer(sourceFile, statement);
  if (!initializer) return false;
  const trustedSqlCall = unwrapExpression(initializer);
  if (!ts.isCallExpression(trustedSqlCall) || trustedSqlCall.arguments.length !== 2) return false;
  const trustedSqlCallee = unwrapExpression(trustedSqlCall.expression);
  if (
    !frameworkExportEquals(
      canonicalFrameworkExportForExpression(
        ts as FrameworkIdentityTypeScript,
        sourceFile,
        trustedSqlCallee,
      ),
      TRUSTED_SQL_IDENTITY,
    ) ||
    !securityIrExpressionUsesDirectImportBinding(sourceFile, trustedSqlCallee) ||
    !securityIrMemberCallableIsStable(sourceFile, trustedSqlCallee, trustedSqlCall) ||
    !serverExpressionIsExactJustificationOptions(trustedSqlCall.arguments[1]!)
  ) {
    return false;
  }
  const raw = unwrapExpression(trustedSqlCall.arguments[0]!);
  return ts.isCallExpression(raw) && serverCallIsExactTrustedSqlRaw(sourceFile, raw);
}

interface ServerExactDeclassifyPolicy {
  readonly door: 'trustedReveal';
  readonly label: string;
  readonly ownerScope: 'application' | 'current-principal' | 'current-tenant' | 'framework';
  readonly purpose: 'public-projection';
}

function serverExactTrustedRevealPolicy(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
): ServerExactDeclassifyPolicy | undefined {
  if (call.arguments.length !== 2) return undefined;
  const policyExpression = unwrapExpression(call.arguments[1]!);
  if (!ts.isCallExpression(policyExpression)) return undefined;
  return serverExactDeclassifyPolicy(sourceFile, policyExpression, 'trustedReveal');
}

function serverCallIsExactDeclassifyPolicyConstructor(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
): boolean {
  return serverExactDeclassifyPolicy(sourceFile, call, 'trustedReveal') !== undefined;
}

function serverExactDeclassifyPolicy(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  expectedDoor: 'trustedReveal',
): ServerExactDeclassifyPolicy | undefined {
  const callee = unwrapExpression(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'create') return undefined;
  const receiver = unwrapExpression(callee.expression);
  if (
    !ts.isIdentifier(receiver) ||
    receiver.text !== 'DeclassifyPolicy' ||
    !frameworkExportEquals(
      canonicalFrameworkExportForExpression(
        ts as FrameworkIdentityTypeScript,
        sourceFile,
        receiver,
      ),
      DECLASSIFY_POLICY_IDENTITY,
    ) ||
    !securityIrExpressionUsesDirectImportBinding(sourceFile, receiver) ||
    !securityIrMemberCallableIsStable(sourceFile, callee, call) ||
    call.arguments.length !== 1
  ) {
    return undefined;
  }
  const options = unwrapExpression(call.arguments[0]!);
  if (!ts.isObjectLiteralExpression(options) || options.properties.length !== 3) return undefined;
  let door: string | undefined;
  let ownerScope: string | undefined;
  let purpose: string | undefined;
  const seen = compilerCreateSet<string>();
  const properties = compilerSnapshotDenseArray(
    options.properties,
    'Finite DeclassifyPolicy options',
  );
  for (let index = 0; index < properties.length; index += 1) {
    const property = properties[index]!;
    if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) {
      return undefined;
    }
    const name = staticPropertyName(property.name);
    const value = unwrapExpression(property.initializer);
    if (
      !name ||
      (name !== 'door' && name !== 'ownerScope' && name !== 'purpose') ||
      compilerSetHas(seen, name) ||
      !ts.isStringLiteralLike(value)
    ) {
      return undefined;
    }
    compilerSetAdd(seen, name);
    if (name === 'door') door = value.text;
    else if (name === 'ownerScope') ownerScope = value.text;
    else purpose = value.text;
  }
  if (
    door !== expectedDoor ||
    purpose !== 'public-projection' ||
    (ownerScope !== 'application' &&
      ownerScope !== 'current-principal' &&
      ownerScope !== 'current-tenant' &&
      ownerScope !== 'framework')
  ) {
    return undefined;
  }
  return {
    door,
    label: `${purpose}:${door}:${ownerScope}`,
    ownerScope,
    purpose,
  };
}

function serverDeclassifyExpressionProvenance(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): ServerValueProvenance {
  const current = unwrapExpression(expression);
  if (ts.isCallExpression(current)) {
    if (serverCallIsExactSecretBox(sourceFile, current, aliases)) {
      const value = current.arguments[0];
      return value === undefined
        ? 'unknown-authority'
        : serverDeclassifyExpressionProvenance(sourceFile, value, aliases);
    }
    const callee = serverExpressionProvenance(current.expression, aliases);
    if (callee === 'foreign-executable' || callee === 'unknown-authority') {
      return 'unknown-authority';
    }
  }
  return serverExpressionProvenance(current, aliases);
}

function serverDeclassifyProvenanceIsRobust(provenance: ServerValueProvenance): boolean {
  return (
    provenance !== 'foreign-executable' &&
    provenance !== 'unsafe-wire-data' &&
    provenance !== 'unknown-authority'
  );
}

interface ServerDeclassifyClosedCondition {
  readonly node: ts.Node;
  readonly provenance: ServerValueProvenance;
}

function serverDeclassifyEnablingCondition(
  call: ts.CallExpression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): ServerDeclassifyClosedCondition | undefined {
  let child: ts.Node = call;
  for (let parent = call.parent; parent; child = parent, parent = parent.parent) {
    if (isSecurityIrFunctionScope(parent)) return undefined;
    let condition: ts.Expression | undefined;
    if (ts.isIfStatement(parent) && !serverNodeContains(parent.expression, child)) {
      condition = parent.expression;
    } else if (ts.isConditionalExpression(parent) && !serverNodeContains(parent.condition, child)) {
      condition = parent.condition;
    } else if (
      ts.isBinaryExpression(parent) &&
      parent.right === child &&
      (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        parent.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      condition = parent.left;
    } else if (
      (ts.isWhileStatement(parent) || ts.isDoStatement(parent)) &&
      !serverNodeContains(parent.expression, child)
    ) {
      condition = parent.expression;
    } else if (
      ts.isForStatement(parent) &&
      parent.condition !== undefined &&
      !serverNodeContains(parent.condition, child)
    ) {
      condition = parent.condition;
    } else if (ts.isSwitchStatement(parent) && !serverNodeContains(parent.expression, child)) {
      condition = parent.expression;
    } else if (ts.isCatchClause(parent)) {
      return { node: parent, provenance: 'unknown-authority' };
    }
    if (condition === undefined) continue;
    const provenance = serverExpressionProvenance(condition, aliases);
    if (!serverDeclassifyProvenanceIsRobust(provenance)) {
      return { node: condition, provenance };
    }
  }
  return undefined;
}

function serverNodeContains(container: ts.Node, candidate: ts.Node): boolean {
  return (
    candidate.getStart(container.getSourceFile()) >=
      container.getStart(container.getSourceFile()) && candidate.getEnd() <= container.getEnd()
  );
}

function serverCallIsExactSecretBox(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  const callee = unwrapExpression(call.expression);
  return !!(
    serverCallUsesExactNamedFrameworkImport(sourceFile, call, callee, 'secret', SECRET_IDENTITY) &&
    call.arguments.length === 1 &&
    !serverArgumentsContainAuthority(call.arguments, aliases) &&
    !serverArgumentsContainForeignExecutable(call.arguments, aliases)
  );
}

function serverCallIsExactDrizzleTableAlias(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  const callee = unwrapExpression(call.expression);
  return !!(
    serverCallUsesExactNamedFrameworkImport(
      sourceFile,
      call,
      callee,
      'alias',
      DRIZZLE_ALIAS_IDENTITY,
    ) &&
    call.arguments.length === 2 &&
    !serverArgumentsContainAuthority(call.arguments, aliases) &&
    serverExpressionIsReviewedDatabaseTable(sourceFile, call.arguments[0]!) &&
    serverExpressionIsNonEmptyStaticString(call.arguments[1]!)
  );
}

function serverCallIsExactDeclaredSecretReadExecution(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  const callee = unwrapExpression(call.expression);
  if (
    !ts.isPropertyAccessExpression(callee) ||
    callee.name.text !== 'execute' ||
    call.arguments.length !== 1 ||
    !securityIrMemberCallableIsStable(sourceFile, callee, call)
  ) {
    return false;
  }
  const receiverProvenance = serverExpressionProvenance(callee.expression, aliases);
  if (receiverProvenance !== 'database' && receiverProvenance !== 'database-read-namespace') {
    return false;
  }

  const statementUse = unwrapExpression(call.arguments[0]!);
  if (!ts.isIdentifier(statementUse)) return false;
  const initializer = securityIrImmutableBindingInitializer(sourceFile, statementUse);
  if (!initializer) return false;
  const trustedSqlCall = unwrapExpression(initializer);
  if (!ts.isCallExpression(trustedSqlCall) || trustedSqlCall.arguments.length !== 2) return false;
  const raw = unwrapExpression(trustedSqlCall.arguments[0]!);
  if (!ts.isCallExpression(raw) || !serverCallIsExactTrustedSqlRaw(sourceFile, raw)) return false;

  const declaration = serverExactVariableDeclarationForInitializer(initializer, statementUse.text);
  const declarationLocation = declaration ? serverDirectStatementLocation(declaration) : undefined;
  const executionLocation = serverDirectStatementLocation(call);
  if (
    !declaration ||
    !declarationLocation ||
    !executionLocation ||
    declarationLocation.block !== executionLocation.block ||
    declarationLocation.index >= executionLocation.index
  ) {
    return false;
  }

  let capabilityDeclaration: ts.CallExpression | undefined;
  let capabilityDeclarationCount = 0;
  const visit = (node: ts.Node): void => {
    if (node !== executionLocation.block && isSecurityIrFunctionScope(node)) return;
    if (ts.isCallExpression(node)) {
      const argument = node.arguments.length > 0 ? unwrapExpression(node.arguments[0]!) : undefined;
      if (
        argument &&
        ts.isIdentifier(argument) &&
        argument.text === statementUse.text &&
        serverCallIsExactDeclaredSecretReadCapability(sourceFile, node, aliases)
      ) {
        capabilityDeclarationCount += 1;
        if (capabilityDeclarationCount === 1) capabilityDeclaration = node;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(executionLocation.block);
  if (capabilityDeclarationCount !== 1 || !capabilityDeclaration) return false;

  const capabilityLocation = serverDirectStatementLocation(capabilityDeclaration);
  if (
    !capabilityLocation ||
    capabilityLocation.block !== executionLocation.block ||
    capabilityLocation.index <= declarationLocation.index ||
    capabilityLocation.index >= executionLocation.index
  ) {
    return false;
  }

  const declarationArgument = unwrapExpression(capabilityDeclaration.arguments[0]!);
  if (!ts.isIdentifier(declarationArgument)) return false;
  const allowedReferences = compilerCreateSet<ts.Identifier>();
  compilerSetAdd(allowedReferences, declaration.name as ts.Identifier);
  compilerSetAdd(allowedReferences, declarationArgument);
  compilerSetAdd(allowedReferences, statementUse);
  let escaped = false;
  const findEscape = (node: ts.Node): void => {
    if (escaped) return;
    if (
      ts.isIdentifier(node) &&
      node.text === statementUse.text &&
      !compilerSetHas(allowedReferences, node)
    ) {
      escaped = true;
      return;
    }
    ts.forEachChild(node, findEscape);
  };
  findEscape(executionLocation.block);
  return !escaped;
}

function serverExactVariableDeclarationForInitializer(
  initializer: ts.Expression,
  name: string,
): ts.VariableDeclaration | undefined {
  let cursor: ts.Node = initializer;
  while (cursor.parent && !ts.isVariableDeclaration(cursor.parent)) {
    if (ts.isStatement(cursor.parent) || isSecurityIrFunctionScope(cursor.parent)) return undefined;
    cursor = cursor.parent;
  }
  const declaration = cursor.parent;
  return declaration &&
    ts.isVariableDeclaration(declaration) &&
    ts.isIdentifier(declaration.name) &&
    declaration.name.text === name &&
    isConstVariableDeclaration(declaration)
    ? declaration
    : undefined;
}

interface ServerDirectStatementLocation {
  readonly block: ts.Block;
  readonly index: number;
}

function serverDirectStatementLocation(node: ts.Node): ServerDirectStatementLocation | undefined {
  let cursor: ts.Node = node;
  while (cursor.parent) {
    const parent = cursor.parent;
    if (ts.isBlock(parent) && ts.isStatement(cursor)) {
      const statements = compilerSnapshotDenseArray(
        parent.statements,
        'Finite declared secret-read statements',
      );
      const index = statements.indexOf(cursor);
      return index >= 0 ? { block: parent, index } : undefined;
    }
    if (isSecurityIrFunctionScope(parent)) return undefined;
    cursor = parent;
  }
  return undefined;
}

function serverCallUsesExactNamedFrameworkImport(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  callee: ts.Expression,
  exportName: string,
  identity: FrameworkExportIdentity,
): boolean {
  return !!(
    ts.isIdentifier(callee) &&
    callee.text === exportName &&
    frameworkExportEquals(
      canonicalFrameworkExportForExpression(ts as FrameworkIdentityTypeScript, sourceFile, callee),
      identity,
    ) &&
    securityIrExpressionUsesDirectImportBinding(sourceFile, callee) &&
    securityIrMemberCallableIsStable(sourceFile, callee, call)
  );
}

function serverExpressionIsExactJustificationOptions(expression: ts.Expression): boolean {
  const options = unwrapExpression(expression);
  if (!ts.isObjectLiteralExpression(options) || options.properties.length !== 1) return false;
  const property = options.properties[0]!;
  return !!(
    ts.isPropertyAssignment(property) &&
    !ts.isComputedPropertyName(property.name) &&
    staticPropertyName(property.name) === 'justification' &&
    serverExpressionIsNonEmptyStaticString(property.initializer)
  );
}

function serverExpressionIsExactSecretReadDeclaration(expression: ts.Expression): boolean {
  const options = unwrapExpression(expression);
  if (!ts.isObjectLiteralExpression(options) || options.properties.length !== 4) return false;
  const expected = finiteStringSet(['columns', 'justification', 'source', 'table']);
  const seen = compilerCreateSet<string>();
  const properties = compilerSnapshotDenseArray(
    options.properties,
    'Finite declared secret-read options',
  );
  for (let index = 0; index < properties.length; index += 1) {
    const property = properties[index]!;
    if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name))
      return false;
    const name = staticPropertyName(property.name);
    if (!name || !compilerSetHas(expected, name) || compilerSetHas(seen, name)) return false;
    compilerSetAdd(seen, name);
    if (name === 'columns') {
      const columns = unwrapExpression(property.initializer);
      if (!ts.isArrayLiteralExpression(columns) || columns.elements.length === 0) return false;
      const elements = compilerSnapshotDenseArray(columns.elements, 'Finite secret-read columns');
      for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
        const element = elements[elementIndex]!;
        if (
          ts.isSpreadElement(element) ||
          !serverExpressionIsNonEmptyStaticString(element as ts.Expression)
        ) {
          return false;
        }
      }
    } else if (!serverExpressionIsNonEmptyStaticString(property.initializer)) {
      return false;
    }
  }
  return true;
}

function serverExpressionIsNonEmptyStaticString(expression: ts.Expression): boolean {
  const value = unwrapExpression(expression);
  return ts.isStringLiteralLike(value) && compilerStringTrim(value.text).length > 0;
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

function serverCallIsExactGeneratedReadonlyAppDbRead(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
): boolean {
  const callee = unwrapExpression(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.questionDotToken) return false;
  const receiver = unwrapExpression(callee.expression);
  if (
    !ts.isIdentifier(receiver) ||
    !serverExpressionIsExactGeneratedReadonlyAppDb(sourceFile, receiver) ||
    !securityIrMemberCallableIsStable(sourceFile, callee, call)
  ) {
    return false;
  }
  return (
    serverMemberProvenanceFromRelation('database-read-namespace', callee.name.text) ===
    'operation:server.database.read'
  );
}

function serverCallDescendsFromExactGeneratedReadonlyAppDbRead(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  const current = unwrapExpression(expression);
  if (ts.isCallExpression(current)) {
    if (serverCallIsExactGeneratedReadonlyAppDbRead(sourceFile, current)) return true;
    const callee = unwrapExpression(current.expression);
    if (
      !ts.isPropertyAccessExpression(callee) ||
      callee.questionDotToken ||
      !compilerSetHas(serverReviewedDatabaseBuilderMethods, callee.name.text) ||
      serverArgumentsContainAuthority(current.arguments, aliases) ||
      serverArgumentsContainUnreviewedForeignExecutable(sourceFile, current.arguments, aliases)
    ) {
      return false;
    }
    return serverCallDescendsFromExactGeneratedReadonlyAppDbRead(
      sourceFile,
      callee.expression,
      aliases,
    );
  }
  if (ts.isPropertyAccessExpression(current) && !current.questionDotToken) {
    return serverCallDescendsFromExactGeneratedReadonlyAppDbRead(
      sourceFile,
      current.expression,
      aliases,
    );
  }
  return false;
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

function serverExpressionIsExactGeneratedReadonlyAppDb(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): boolean {
  const current = unwrapExpression(expression);
  if (
    !ts.isIdentifier(current) ||
    current.text !== 'readonlyAppDb' ||
    !securityIrExpressionUsesDirectImportBinding(sourceFile, current)
  ) {
    return false;
  }
  const imported = serverImportedProjectValue(sourceFile, current);
  if (!imported || imported.exportName !== 'readonlyAppDb') return false;
  const dbSource = resolveFrameworkIdentityProjectSourceFile(sourceFile, imported.specifier);
  if (!dbSource) return false;

  const dbExport = serverExactModuleConstDeclaration(dbSource, 'readonlyAppDb', true);
  const dbInitializer = dbExport?.initializer ? unwrapExpression(dbExport.initializer) : undefined;
  if (
    !dbExport ||
    !dbInitializer ||
    !ts.isIdentifier(dbInitializer) ||
    dbInitializer.text !== 'appRuntimeReadonlyDb' ||
    !securityIrExpressionUsesDirectImportBinding(dbSource, dbInitializer) ||
    !serverBindingHasOnlyExactValueUses(dbSource, 'readonlyAppDb', []) ||
    !serverBindingHasOnlyExactValueUses(dbSource, 'appRuntimeReadonlyDb', [dbInitializer])
  ) {
    return false;
  }

  const runtimeImport = serverImportedProjectValue(dbSource, dbInitializer);
  if (!runtimeImport || runtimeImport.exportName !== 'appRuntimeReadonlyDb') return false;
  const runtimeSource = resolveFrameworkIdentityProjectSourceFile(
    dbSource,
    runtimeImport.specifier,
  );
  if (!runtimeSource) return false;
  const runtimeExport = serverExactModuleConstDeclaration(
    runtimeSource,
    'appRuntimeReadonlyDb',
    true,
  );
  const runtimeInitializer = runtimeExport?.initializer
    ? unwrapExpression(runtimeExport.initializer)
    : undefined;
  const runtimeMember = runtimeInitializer ? staticMember(runtimeInitializer) : undefined;
  const databaseIdentifier = runtimeMember ? unwrapExpression(runtimeMember.receiver) : undefined;
  if (
    !runtimeExport ||
    !runtimeInitializer ||
    !ts.isPropertyAccessExpression(runtimeInitializer) ||
    runtimeMember?.name !== 'readonlyDb' ||
    !databaseIdentifier ||
    !ts.isIdentifier(databaseIdentifier) ||
    databaseIdentifier.text !== 'appDatabase' ||
    !serverBindingHasOnlyExactValueUses(runtimeSource, 'appRuntimeReadonlyDb', []) ||
    !serverGeneratedAppDatabaseUsesAreExact(runtimeSource, databaseIdentifier.text)
  ) {
    return false;
  }

  const databaseDeclaration = serverExactModuleConstDeclaration(
    runtimeSource,
    databaseIdentifier.text,
    false,
  );
  const databaseInitializer = databaseDeclaration?.initializer
    ? unwrapExpression(databaseDeclaration.initializer)
    : undefined;
  if (!databaseInitializer || !ts.isCallExpression(databaseInitializer)) return false;
  const factory = unwrapExpression(databaseInitializer.expression);
  return !!(
    serverExpressionIsExactGeneratedAppDatabaseFactory(runtimeSource, factory) &&
    securityIrMemberCallableIsStable(runtimeSource, factory, databaseInitializer)
  );
}

function serverExpressionIsExactGeneratedAppDatabaseFactory(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): boolean {
  const current = unwrapExpression(expression);
  if (!ts.isIdentifier(current)) return false;
  const expectedSpecifier =
    current.text === 'createPostgresAppRuntimeDb'
      ? '@kovojs/server'
      : current.text === 'createSqliteAppRuntime'
        ? '@kovojs/server/sqlite'
        : undefined;
  if (!expectedSpecifier) return false;

  let matches = 0;
  const statements = compilerSnapshotDenseArray(
    sourceFile.statements,
    'Finite generated app database imports',
  );
  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const statement = statements[statementIndex]!;
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== expectedSpecifier
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const elements = compilerSnapshotDenseArray(
      bindings.elements,
      'Finite generated app database named imports',
    );
    for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
      const element = elements[elementIndex]!;
      if (element.name.text === current.text && element.propertyName === undefined) matches += 1;
    }
  }
  return matches === 1;
}

function serverExactModuleConstDeclaration(
  sourceFile: ts.SourceFile,
  name: string,
  exported: boolean,
): ts.VariableDeclaration | undefined {
  let found: ts.VariableDeclaration | undefined;
  const statements = compilerSnapshotDenseArray(
    sourceFile.statements,
    'Finite generated app database statements',
  );
  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const statement = statements[statementIndex]!;
    if (
      !ts.isVariableStatement(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0 ||
      securityIrNodeHasExportModifier(statement) !== exported
    ) {
      continue;
    }
    const declarations = compilerSnapshotDenseArray(
      statement.declarationList.declarations,
      'Finite generated app database declarations',
    );
    for (let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex += 1) {
      const declaration = declarations[declarationIndex]!;
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      if (found) return undefined;
      found = declaration;
    }
  }
  const indexed = securityIrDeclarationFact(sourceFile, sourceFile, name);
  return found && indexed?.matches === 1 && !serverBindingOrMemberIsAssigned(sourceFile, name)
    ? found
    : undefined;
}

function serverBindingHasOnlyExactValueUses(
  sourceFile: ts.SourceFile,
  name: string,
  allowedUses: readonly ts.Identifier[],
): boolean {
  const allowed = compilerCreateSet<ts.Identifier>();
  const uses = compilerSnapshotDenseArray(allowedUses, 'Finite generated DB allowed uses');
  for (let index = 0; index < uses.length; index += 1) compilerSetAdd(allowed, uses[index]!);
  let exact = true;
  const visit = (node: ts.Node): void => {
    if (!exact) return;
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && node.text === name) {
      const parent = node.parent;
      if (
        compilerSetHas(allowed, node) ||
        (ts.isVariableDeclaration(parent) && parent.name === node) ||
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node)
      ) {
        return;
      }
      exact = false;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return exact;
}

function serverGeneratedAppDatabaseUsesAreExact(sourceFile: ts.SourceFile, name: string): boolean {
  let exact = true;
  const visit = (node: ts.Node): void => {
    if (!exact) return;
    if (ts.isIdentifier(node) && node.text === name) {
      const parent = node.parent;
      if (ts.isVariableDeclaration(parent) && parent.name === node) return;
      if (!ts.isPropertyAccessExpression(parent) || parent.expression !== node) {
        exact = false;
        return;
      }
      const member = parent.name.text;
      if (member === 'systemDb') {
        const call = parent.parent;
        if (!ts.isCallExpression(call) || unwrapExpression(call.expression) !== parent) {
          exact = false;
        }
        return;
      }
      const expected =
        member === 'db'
          ? 'appRuntimeDbProvider'
          : member === 'mutationReplayStore'
            ? 'appRuntimeMutationReplayStore'
            : member === 'readonlyDb'
              ? 'appRuntimeReadonlyDb'
              : member === 'ready'
                ? 'appRuntimeDbReady'
                : undefined;
      if (
        !expected ||
        serverExactVariableDeclarationForInitializer(parent, expected) === undefined
      ) {
        exact = false;
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return exact;
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
  sourceFile: ts.SourceFile,
  provenance: ServerValueProvenance,
  call: ts.CallExpression,
  target: string,
  surface: ServerSecurityScanSurface,
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
    if (securityAbstractEffectInvocationTransfer()) {
      appendOperation('server.authority.scope', call, target);
    }
    return true;
  }
  if (provenance === 'database-read-namespace') {
    if (securityAbstractEffectInvocationTransfer()) {
      appendOperation('server.database.read', call, target);
    }
    return true;
  }
  if (provenance === 'database-write-namespace') {
    if (!securityAbstractEffectInvocationTransfer()) return true;
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
  if (!securityAbstractEffectInvocationTransfer()) return true;
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
      if (compilerStringEndsWith(target, '.json')) {
        appendUnsafeWireBodyViolation(call.arguments[0], target, aliases, appendViolation);
        appendForbiddenResponseInitHeaderViolation(
          sourceFile,
          call.arguments[1],
          target,
          appendViolation,
        );
      }
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

function appendUnsafeWireBodyViolation(
  body: ts.Expression | undefined,
  target: string,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
  appendViolation: (
    node: ts.Node,
    kind: SecurityOperationViolationModel['kind'],
    detail: string,
  ) => void,
): void {
  if (body === undefined || serverExpressionProvenance(body, aliases) !== 'unsafe-wire-data') {
    return;
  }
  appendViolation(
    body,
    'computed-security-operation',
    `${target} body carries catch-bound error or request-derived data outside an audited render door`,
  );
}

function appendForbiddenResponseInitHeaderViolation(
  sourceFile: ts.SourceFile,
  init: ts.Expression | undefined,
  target: string,
  appendViolation: (
    node: ts.Node,
    kind: SecurityOperationViolationModel['kind'],
    detail: string,
  ) => void,
): void {
  if (init === undefined) return;
  const refreshHeader = responseInitRefreshHeader(sourceFile, init, compilerCreateSet<number>(), 0);
  if (refreshHeader === undefined) return;
  appendViolation(
    refreshHeader,
    'raw-capability-operation',
    `${target} Response init header Refresh triggers browser navigation outside Kovo's typed Location redirect posture`,
  );
}

function responseInitRefreshHeader(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  active: Set<number>,
  depth: number,
): ts.Node | undefined {
  const resolution = responseInitHeadersResolution(sourceFile, expression, active, depth);
  return resolution.kind === 'present' ? resolution.refreshHeader : undefined;
}

type ResponseInitHeadersResolution =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly refreshHeader: ts.Node | undefined }
  | { readonly kind: 'unknown' };

function responseInitHeadersResolution(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  active: Set<number>,
  depth: number,
): ResponseInitHeadersResolution {
  if (depth > SECURITY_SEMANTIC_CALL_DEPTH_BUDGET) return { kind: 'unknown' };
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) {
    const initializer = securityIrImmutableBindingInitializer(sourceFile, current);
    if (initializer === undefined) return { kind: 'unknown' };
    const key = initializer.getStart(sourceFile);
    if (compilerSetHas(active, key)) return { kind: 'unknown' };
    compilerSetAdd(active, key);
    try {
      return responseInitHeadersResolution(sourceFile, initializer, active, depth + 1);
    } finally {
      compilerSetDelete(active, key);
    }
  }
  if (ts.isConditionalExpression(current)) {
    const whenTrue = responseInitHeadersResolution(sourceFile, current.whenTrue, active, depth + 1);
    const whenFalse = responseInitHeadersResolution(
      sourceFile,
      current.whenFalse,
      active,
      depth + 1,
    );
    if (whenTrue.kind === 'present' && whenTrue.refreshHeader !== undefined) return whenTrue;
    if (whenFalse.kind === 'present' && whenFalse.refreshHeader !== undefined) return whenFalse;
    if (whenTrue.kind === 'present' && whenFalse.kind === 'present') {
      return { kind: 'present', refreshHeader: undefined };
    }
    if (whenTrue.kind === 'absent' && whenFalse.kind === 'absent') return { kind: 'absent' };
    return { kind: 'unknown' };
  }
  if (responseInitObjectWrapper(sourceFile, current)) {
    return responseInitHeadersResolution(sourceFile, current.arguments[0]!, active, depth + 1);
  }
  if (!ts.isObjectLiteralExpression(current)) return { kind: 'unknown' };
  const properties = compilerSnapshotDenseArray(current.properties, 'Raw Response init properties');
  // Resolve ordinary object-literal overwrite order from right to left. A later spread known to own
  // `headers` must win before an earlier explicit field is considered; an unresolved spread stays
  // conservative, so an earlier statically visible Refresh remains closed until runtime proves the
  // actual response header bag.
  for (let index = properties.length - 1; index >= 0; index -= 1) {
    const property = properties[index]!;
    if (ts.isSpreadAssignment(property)) {
      const spreadResolution = responseInitHeadersResolution(
        sourceFile,
        property.expression,
        active,
        depth + 1,
      );
      if (spreadResolution.kind === 'present') return spreadResolution;
      continue;
    }
    if (responseInitPropertyName(property.name) !== 'headers') continue;
    if (ts.isPropertyAssignment(property)) {
      return {
        kind: 'present',
        refreshHeader: responseHeaderCollectionRefreshHeader(
          sourceFile,
          property.initializer,
          active,
          depth + 1,
        ),
      };
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      return {
        kind: 'present',
        refreshHeader: responseHeaderCollectionRefreshHeader(
          sourceFile,
          property.name,
          active,
          depth + 1,
        ),
      };
    }
    return { kind: 'present', refreshHeader: undefined };
  }
  return { kind: 'absent' };
}

function responseHeaderCollectionRefreshHeader(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  active: Set<number>,
  depth: number,
): ts.Node | undefined {
  if (depth > SECURITY_SEMANTIC_CALL_DEPTH_BUDGET) return undefined;
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) {
    const initializer = securityIrImmutableBindingInitializer(sourceFile, current);
    if (initializer === undefined) return undefined;
    return withResponseInitExpression(
      sourceFile,
      initializer,
      active,
      depth,
      responseHeaderCollectionRefreshHeader,
    );
  }
  if (ts.isConditionalExpression(current)) {
    return (
      responseHeaderCollectionRefreshHeader(sourceFile, current.whenTrue, active, depth + 1) ??
      responseHeaderCollectionRefreshHeader(sourceFile, current.whenFalse, active, depth + 1)
    );
  }
  if (responseInitObjectWrapper(sourceFile, current)) {
    return responseHeaderCollectionRefreshHeader(
      sourceFile,
      current.arguments[0]!,
      active,
      depth + 1,
    );
  }
  if (
    ts.isNewExpression(current) &&
    responseInitUsesAmbientHeaders(sourceFile, current.expression)
  ) {
    const headers = current.arguments?.[0];
    return headers === undefined
      ? undefined
      : responseHeaderCollectionRefreshHeader(sourceFile, headers, active, depth + 1);
  }
  if (ts.isObjectLiteralExpression(current)) {
    const properties = compilerSnapshotDenseArray(
      current.properties,
      'Raw Response init header properties',
    );
    for (let index = 0; index < properties.length; index += 1) {
      const property = properties[index]!;
      if (ts.isSpreadAssignment(property)) {
        const spreadMatch = responseHeaderCollectionRefreshHeader(
          sourceFile,
          property.expression,
          active,
          depth + 1,
        );
        if (spreadMatch !== undefined) return spreadMatch;
        continue;
      }
      const name = responseInitPropertyName(property.name);
      if (name !== undefined && compilerStringToLowerCase(name) === 'refresh') {
        return property.name ?? property;
      }
    }
    return undefined;
  }
  if (ts.isArrayLiteralExpression(current)) {
    const elements = compilerSnapshotDenseArray(
      current.elements,
      'Raw Response init header entries',
    );
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index]!;
      if (ts.isSpreadElement(element)) {
        const spreadMatch = responseHeaderCollectionRefreshHeader(
          sourceFile,
          element.expression,
          active,
          depth + 1,
        );
        if (spreadMatch !== undefined) return spreadMatch;
        continue;
      }
      const entry = unwrapExpression(element);
      if (!ts.isArrayLiteralExpression(entry) || entry.elements.length === 0) continue;
      const name = responseInitHeaderNameExpression(entry.elements[0]!);
      if (name !== undefined && compilerStringToLowerCase(name) === 'refresh') {
        return entry.elements[0]!;
      }
    }
  }
  return undefined;
}

function withResponseInitExpression(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  active: Set<number>,
  depth: number,
  inspect: (
    sourceFile: ts.SourceFile,
    expression: ts.Expression,
    active: Set<number>,
    depth: number,
  ) => ts.Node | undefined,
): ts.Node | undefined {
  const key = expression.getStart(sourceFile);
  if (compilerSetHas(active, key)) return undefined;
  compilerSetAdd(active, key);
  try {
    return inspect(sourceFile, expression, active, depth + 1);
  } finally {
    compilerSetDelete(active, key);
  }
}

function responseInitObjectWrapper(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): expression is ts.CallExpression {
  if (!ts.isCallExpression(expression) || expression.arguments.length !== 1) return false;
  const member = staticMember(unwrapExpression(expression.expression));
  const root = member === undefined ? undefined : unwrapExpression(member.receiver);
  return !!(
    member !== undefined &&
    (member.name === 'freeze' || member.name === 'seal' || member.name === 'preventExtensions') &&
    root !== undefined &&
    ts.isIdentifier(root) &&
    root.text === 'Object' &&
    !identifierIsShadowedWithinBoundary(root, sourceFile)
  );
}

function responseInitUsesAmbientHeaders(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): boolean {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) {
    return current.text === 'Headers' && !identifierIsShadowedWithinBoundary(current, sourceFile);
  }
  const member = staticMember(current);
  const root = member === undefined ? undefined : unwrapExpression(member.receiver);
  return !!(
    member?.name === 'Headers' &&
    root !== undefined &&
    ts.isIdentifier(root) &&
    root.text === 'globalThis' &&
    !identifierIsShadowedWithinBoundary(root, sourceFile)
  );
}

function responseInitPropertyName(name: ts.PropertyName | undefined): string | undefined {
  if (name === undefined) return undefined;
  if (ts.isComputedPropertyName(name)) return responseInitHeaderNameExpression(name.expression);
  return staticPropertyName(name);
}

function responseInitHeaderNameExpression(expression: ts.Expression): string | undefined {
  const current = unwrapExpression(expression);
  return ts.isStringLiteralLike(current) ? current.text : undefined;
}

function serverAliasProvenance(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  parameters: readonly ts.ParameterDeclaration[],
  surface: ServerSecurityScanSurface,
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
    const contextParameter =
      parameterSnapshot[surface === 'mutation' ? 2 : surface === 'route' ? 0 : 1];
    if (contextParameter) setServerAliasPattern(contextParameter.name, 'context', aliases);
    if (surface === 'mutation' && parameterSnapshot[1]) {
      setServerAliasPattern(parameterSnapshot[1]!.name, 'request', aliases);
    }
    if (surface === 'mutation' && parameterSnapshot[0]) {
      setServerAliasPattern(parameterSnapshot[0]!.name, 'unsafe-wire-data', aliases);
    } else if (
      (surface === 'endpoint' || surface === 'query' || surface === 'webhook') &&
      parameterSnapshot[0]
    ) {
      setServerAliasPattern(parameterSnapshot[0]!.name, 'unsafe-wire-data', aliases);
    }
  }

  // SPEC §9.2: catch-bound internals and remotely influenced request values share one
  // non-authority provenance state. That state is inert during ordinary computation and closes
  // only when an unaudited raw response body attempts to consume it.
  const seedCatchBindings = (node: ts.Node): void => {
    if (node !== body && isSecurityIrFunctionScope(node)) return;
    if (ts.isCatchClause(node) && node.variableDeclaration) {
      setServerAliasPattern(node.variableDeclaration.name, 'unsafe-wire-data', aliases);
    }
    ts.forEachChild(node, seedCatchBindings);
  };
  seedCatchBindings(body);

  securityAbstractTransfer('alias.fixed-point');
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
          provenance = serverAliasDeclarationTransfer(authority, isConstVariableDeclaration(node));
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
  if (frameworkExportEquals(identity, DERIVED_IDENTITY)) {
    if (
      !securityIrExpressionUsesDirectImportBinding(sourceFile, callee) ||
      !securityIrMemberCallableIsStable(sourceFile, callee, current) ||
      !serverCallHasExactDerivedOptions(current)
    ) {
      return 'unknown-authority';
    }
    // SPEC §6.6/§10.3 C9: derived() is the reviewed containment door for one foreign vector
    // adapter. Its module-constant result is authority, but the adapter never receives an
    // app-selected namespace; each runtime operation reconstructs one from the request ScopedKey.
    return 'derived-dataset';
  }
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

function serverCallHasExactDerivedOptions(call: ts.CallExpression): boolean {
  const argumentsList = compilerSnapshotDenseArray(
    call.arguments,
    'Finite derived dataset constructor arguments',
  );
  if (argumentsList.length !== 2) return false;
  for (let index = 0; index < argumentsList.length; index += 1) {
    if (ts.isSpreadElement(argumentsList[index]!)) return false;
  }
  const options = unwrapExpression(argumentsList[1]!);
  if (!ts.isObjectLiteralExpression(options)) return false;

  let key: string | undefined;
  let kind: string | undefined;
  const properties = compilerSnapshotDenseArray(
    options.properties,
    'Finite derived dataset options',
  );
  if (properties.length !== 2) return false;
  for (let index = 0; index < properties.length; index += 1) {
    const property = properties[index]!;
    if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) {
      return false;
    }
    const name = staticPropertyName(property.name);
    const value = unwrapExpression(property.initializer);
    if (!ts.isStringLiteralLike(value)) return false;
    if (name === 'key' && key === undefined) {
      key = value.text;
    } else if (name === 'kind' && kind === undefined) {
      kind = value.text;
    } else {
      return false;
    }
  }
  return key !== undefined && key.length > 0 && key.length <= 960 && kind === 'vector';
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
    const projectedProvenance = serverBindingProjectionTransfer(
      provenance,
      property,
      element.dotDotDotToken !== undefined,
    );
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
    const projectedProvenance = serverBindingProjectionTransfer(
      provenance,
      property,
      element.dotDotDotToken !== undefined,
    );
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
  return serverBindingDefaultTransfer(projected, fallback);
}

function joinServerAlias(
  name: string,
  provenance: ServerValueProvenance,
  aliases: Map<string, ServerValueProvenance>,
): boolean {
  const previous = compilerMapGet(aliases, name);
  const joined = serverAliasJoinTransfer(previous, provenance);
  if (joined === undefined) return false;
  compilerMapSet(aliases, name, joined);
  return true;
}

function serverExpressionProvenance(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): ServerValueProvenance {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) {
    securityAbstractTransfer('expression.identifier');
    return serverPrecisionGrant(
      'identifier-environment-lookup',
      compilerMapGet(aliases, current.text) ?? 'local',
    );
  }
  if (ts.isObjectLiteralExpression(current) && serverObjectLiteralHasImplicitCallable(current)) {
    securityAbstractTransfer('expression.implicit-protocol');
    return 'unknown-authority';
  }
  if (ts.isNewExpression(current)) {
    securityAbstractTransfer('expression.new');
    const constructor = serverExpressionProvenance(current.expression, aliases);
    if (constructor === 'response-constructor') {
      return serverPrecisionGrant('new-response-outcome', 'response-outcome');
    }
    if (constructor === 'foreign-executable') {
      return serverPrecisionGrant('new-foreign-executable', 'foreign-executable');
    }
    if (
      serverProvenanceCarriesAuthority(constructor) ||
      serverArgumentsContainAuthority(current.arguments ?? [], aliases)
    ) {
      return 'unknown-authority';
    }
    if (serverArgumentsContainUnsafeWireData(current.arguments ?? [], aliases)) {
      return serverPrecisionGrant('new-unsafe-wire-data', 'unsafe-wire-data');
    }
    return serverPrecisionGrant('new-local-constructor', 'local');
  }
  if (ts.isCallExpression(current)) {
    const callee = serverExpressionProvenance(current.expression, aliases);
    if (callee === 'scope-call') {
      securityAbstractTransfer('expression.call-scope');
      return serverPrecisionGrant('call-principal-scope', 'context');
    }
    if (callee === 'scoped-key-call') {
      securityAbstractTransfer('expression.call-scoped-key');
      return serverPrecisionGrant('call-scoped-key', 'local');
    }
    if (callee === 'intrinsic-identity-call') {
      securityAbstractTransfer('expression.call-intrinsic-identity');
      return serverPrecisionGrant(
        'call-intrinsic-identity',
        current.arguments.length === 1
          ? serverExpressionProvenance(current.arguments[0]!, aliases)
          : 'unknown-authority',
      );
    }
    if (callee === 'response-constructor' || callee === 'operation:server.response.raw') {
      securityAbstractTransfer('expression.call-response');
      return serverPrecisionGrant('call-response-constructor', 'response-outcome');
    }
    if (callee === 'unknown-authority') {
      securityAbstractTransfer('expression.call-unknown-authority');
      return 'unknown-authority';
    }
    if (
      callee === 'governed-data' ||
      callee === 'operation:server.database.read' ||
      serverCallReadsDerivedDataset(current, aliases) ||
      serverArgumentsContainGovernedData(current.arguments, aliases)
    ) {
      securityAbstractTransfer('expression.call-local');
      return serverPrecisionGrant('call-governed-data', 'governed-data');
    }
    if (
      callee === 'unsafe-wire-data' ||
      serverArgumentsContainUnsafeWireData(current.arguments, aliases)
    ) {
      securityAbstractTransfer('expression.call-local');
      return serverPrecisionGrant('call-unsafe-wire-data', 'unsafe-wire-data');
    }
    securityAbstractTransfer('expression.call-local');
    return serverPrecisionGrant('call-local', 'local');
  }
  if (ts.isBinaryExpression(current)) {
    const left = serverExpressionProvenance(current.left, aliases);
    const right = serverExpressionProvenance(current.right, aliases);
    return serverPrecisionGrant('binary-finite-join', serverBinaryTransfer(left, right));
  }
  if (ts.isConditionalExpression(current)) {
    const whenTrue = serverExpressionProvenance(current.whenTrue, aliases);
    const whenFalse = serverExpressionProvenance(current.whenFalse, aliases);
    return serverPrecisionGrant(
      'conditional-finite-join',
      serverConditionalTransfer(whenTrue, whenFalse),
    );
  }
  const member = staticMember(current);
  if (member) {
    securityAbstractTransfer('expression.static-member');
    return serverPrecisionGrant(
      'static-member-relation',
      serverMemberProvenance(serverExpressionProvenance(member.receiver, aliases), member.name),
    );
  }
  if (expressionContainsServerForeignExecutable(current, aliases)) {
    securityAbstractTransfer('expression.fallthrough-foreign');
    return serverPrecisionGrant('fallthrough-foreign-containment', 'foreign-executable');
  }
  if (expressionContainsServerGovernedData(current, aliases)) {
    securityAbstractTransfer('expression.fallthrough-authority');
    return serverPrecisionGrant('fallthrough-governed-data-containment', 'governed-data');
  }
  if (expressionContainsServerUnsafeWireData(current, aliases)) {
    securityAbstractTransfer('expression.fallthrough-authority');
    return serverPrecisionGrant('fallthrough-unsafe-wire-data', 'unsafe-wire-data');
  }
  return serverPrecisionGrant(
    'fallthrough-contained-local',
    expressionContainsServerAuthority(current, aliases) ? 'unknown-authority' : 'local',
  );
}

function serverCallReadsDerivedDataset(
  call: ts.CallExpression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  return serverExpressionProvenance(call.expression, aliases) === 'derived-query-call';
}

function expressionContainsServerGovernedData(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== expression && isSecurityIrFunctionScope(node)) return;
    if (ts.isIdentifier(node) && compilerMapGet(aliases, node.text) === 'governed-data') {
      found = true;
      return;
    }
    if (
      node !== expression &&
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      serverExpressionProvenance(node, aliases) === 'governed-data'
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

function expressionContainsServerUnsafeWireData(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== expression && isSecurityIrFunctionScope(node)) return;
    if (ts.isIdentifier(node) && compilerMapGet(aliases, node.text) === 'unsafe-wire-data') {
      found = true;
      return;
    }
    if (
      node !== expression &&
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      serverExpressionProvenance(node, aliases) === 'unsafe-wire-data'
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
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
  return serverMemberProvenanceFromRelation(receiver, member);
}

function serverProvenanceCarriesAuthority(provenance: ServerValueProvenance | undefined): boolean {
  return serverProvenanceAtOrBelowAuthorityTop(provenance);
}

function expressionContainsServerAuthority(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  securityAbstractTransfer('expression.fallthrough-authority');
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

function serverArgumentsContainGovernedData(
  argumentsList: readonly ts.Expression[],
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  const snapshot = compilerSnapshotDenseArray(argumentsList, 'Server governed-data call arguments');
  for (let index = 0; index < snapshot.length; index += 1) {
    const argument = snapshot[index]!;
    const expression = ts.isSpreadElement(argument) ? argument.expression : argument;
    if (serverExpressionProvenance(expression, aliases) === 'governed-data') return true;
  }
  return false;
}

function serverArgumentsContainUnsafeWireData(
  argumentsList: readonly ts.Expression[],
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  const snapshot = compilerSnapshotDenseArray(
    argumentsList,
    'Server response-body provenance arguments',
  );
  for (let index = 0; index < snapshot.length; index += 1) {
    const argument = snapshot[index]!;
    const expression = ts.isSpreadElement(argument) ? argument.expression : argument;
    if (serverExpressionProvenance(expression, aliases) === 'unsafe-wire-data') return true;
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
        const containsAuthority =
          initializer !== undefined &&
          !browserDirectImportedCallResultIsData(body.getSourceFile(), initializer) &&
          expressionContainsBrowserAuthority(initializer, aliases, body);
        const plainContainer =
          initializer !== undefined &&
          (ts.isObjectLiteralExpression(unwrapExpression(initializer)) ||
            ts.isArrayLiteralExpression(unwrapExpression(initializer)));
        const authority: BrowserValueProvenance = browserProvenanceCarriesAuthority(derived)
          ? derived
          : containsAuthority
            ? 'unknown-authority'
            : derived === 'unknown' && plainContainer
              ? 'local'
              : derived;
        const provenance =
          isConstVariableDeclaration(node) || !browserProvenanceCarriesAuthority(authority)
            ? authority
            : 'unknown-authority';
        if (provenance !== 'unknown' && bindBrowserAliasPattern(node.name, provenance, aliases)) {
          changed = true;
        }
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        const left = unwrapExpression(node.left);
        // A member write mutates the container; it does not rebind the receiver. Teaching the root
        // the RHS provenance would turn a captured unknown receiver into a trusted local alias.
        const target = ts.isIdentifier(left) ? left.text : undefined;
        const derived = browserExpressionProvenance(node.right, aliases, body);
        const authority =
          derived !== 'unknown'
            ? derived
            : expressionContainsBrowserAuthority(node.right, aliases, body)
              ? 'unknown-authority'
              : 'unknown';
        const provenance = browserProvenanceCarriesAuthority(authority)
          ? 'unknown-authority'
          : authority;
        if (
          target !== undefined &&
          target !== 'state' &&
          target !== 'event' &&
          provenance !== 'unknown' &&
          joinBrowserAlias(target, provenance, aliases)
        ) {
          changed = true;
        }
      } else if (ts.isCallExpression(node)) {
        const member = staticMember(unwrapExpression(node.expression));
        const target = member ? rootIdentifier(member.receiver) : undefined;
        const targetProvenance = target ? compilerMapGet(aliases, target) : undefined;
        if (
          member !== undefined &&
          (member.name === 'push' ||
            member.name === 'unshift' ||
            member.name === 'splice' ||
            member.name === 'fill') &&
          target !== undefined &&
          target !== 'state' &&
          target !== 'event' &&
          targetProvenance !== undefined &&
          browserArgumentsContainAuthority(node.arguments, aliases, body) &&
          joinBrowserAlias(target, 'unknown-authority', aliases)
        ) {
          changed = true;
        }
      } else if (ts.isParameter(node)) {
        if (bindBrowserAliasPattern(node.name, 'local', aliases)) changed = true;
      } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
        if (joinBrowserAlias(node.name.text, 'unknown-authority', aliases)) changed = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
  }
  return aliases;
}

function browserDirectImportedCallResultIsData(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): boolean {
  const current = unwrapExpression(expression);
  return (
    ts.isCallExpression(current) &&
    browserExpressionUsesDirectModuleImport(sourceFile, current.expression)
  );
}

function browserExpressionProvenance(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  boundary: ts.ConciseBody,
): BrowserValueProvenance {
  const current = unwrapExpression(expression);
  if (
    ts.isArrowFunction(current) ||
    ts.isFunctionExpression(current) ||
    ts.isClassExpression(current)
  ) {
    return 'unknown-authority';
  }
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
      (current.text === 'state' || current.text === 'event') &&
      identifierIsShadowedWithinBoundary(current, boundary)
    ) {
      return 'local';
    }
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
    if (browserExpressionIsReviewedFrameworkCall(current.getSourceFile(), current)) {
      return browserOperationProvenance('browser.framework.call');
    }
    const seededAlias = compilerMapGet(aliases, current.text);
    if (seededAlias !== undefined) return seededAlias;
    const bindingScope = securityIrIdentifierBindingScope(current.getSourceFile(), current);
    if (
      bindingScope === 'module' ||
      (bindingScope === 'unresolved' &&
        !compilerSetHas(browserReviewedAmbientGlobalNames, current.text))
    ) {
      return 'unknown-authority';
    }
    return 'unknown';
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
      return 'event';
    }
    if (receiver === 'dom' || receiver === 'form') {
      if (member.name === 'form') return 'form';
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
  if (ts.isIdentifier(name)) {
    // `state` and `event` are seeded handler roots. Same-spelled callback/block bindings are
    // resolved lexically at each use and must never poison the outer root's name-keyed summary.
    if (name.text === 'state' || name.text === 'event') return false;
    return joinBrowserAlias(name.text, provenance, aliases);
  }
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
      ts.isExpression(node) &&
      securityIrExpressionUsesDirectImportBinding(node.getSourceFile(), node)
    ) {
      const importedRoot = securityIrLeftmostExecutableRoot(node);
      if (
        importedRoot !== undefined &&
        securityIrIdentifierBindingScope(node.getSourceFile(), importedRoot) === 'module'
      ) {
        found = true;
        return;
      }
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isClassExpression(node)) {
      found = true;
      return;
    }
    if (ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) {
      found = true;
      return;
    }
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
  return rootIdentifierNode(expression)?.text;
}

function rootIdentifierNode(expression: ts.Expression): ts.Identifier | undefined {
  let current = unwrapExpression(expression);
  while (true) {
    if (ts.isIdentifier(current)) return current;
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

function browserCanonicalStateTarget(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  boundary: ts.ConciseBody,
  active: Set<string> = compilerCreateSet<string>(),
): string | undefined {
  const current = unwrapExpression(expression);
  const key = `${current.getStart(sourceFile)}:${current.getEnd()}`;
  if (compilerSetHas(active, key)) return undefined;
  compilerSetAdd(active, key);
  try {
    if (ts.isIdentifier(current)) {
      if (current.text === 'state' && !identifierIsShadowedWithinBoundary(current, boundary)) {
        return 'state';
      }
      if (browserExpressionProvenance(current, aliases, boundary) !== 'state') return undefined;
      const initializer = securityIrImmutableBindingInitializer(sourceFile, current);
      return initializer
        ? browserCanonicalStateTarget(sourceFile, initializer, aliases, boundary, active)
        : undefined;
    }
    const member = staticMember(current);
    if (member !== undefined) {
      const receiver = browserCanonicalStateTarget(
        sourceFile,
        member.receiver,
        aliases,
        boundary,
        active,
      );
      return receiver ? `${receiver}.${member.name}` : undefined;
    }
    if (ts.isCallExpression(current)) {
      const callee = unwrapExpression(current.expression);
      if (
        ts.isIdentifier(callee) &&
        callee.text === 'Object' &&
        !identifierIsShadowedWithinBoundary(callee, boundary) &&
        current.arguments.length === 1
      ) {
        return browserCanonicalStateTarget(
          sourceFile,
          current.arguments[0]!,
          aliases,
          boundary,
          active,
        );
      }
      if (browserReviewedStateMethodCall(callee, aliases, boundary) !== undefined) {
        return browserCanonicalStateTarget(sourceFile, callee, aliases, boundary, active);
      }
    }
    return undefined;
  } finally {
    compilerSetDelete(active, key);
  }
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
