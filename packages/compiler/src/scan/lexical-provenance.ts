import ts from 'typescript';

import type {
  ScannedBindingCandidate,
  ScannedImportBindingFact,
} from '../security/capability-closure-model.js';
import { frameworkExportPostureGroups } from '../security/framework-public-runtime-export-posture.generated.js';
import { isIntrinsicJsxTagName } from './jsx-tag.js';

export interface ScannedCallProvenance {
  readonly callee: ScannedUseProvenance;
  readonly firstArgument?: ScannedUseProvenance;
}
export interface ScannedUseProvenance {
  readonly candidates: readonly ScannedBindingCandidate[];
  readonly rootWideningRequired: boolean;
  readonly uncertain: boolean;
}
export interface ScannedLexicalProvenance {
  readonly budgetExhausted: boolean;
  readonly calls: ReadonlyMap<string, ScannedCallProvenance>;
}

interface Binding {
  readonly id: string;
  mutable: boolean;
  readonly name: string;
  readonly owner: string;
}
interface Scope {
  readonly bindings: Map<string, Binding>;
  readonly id: string;
  readonly owner: string;
  readonly parent?: Scope;
}

interface Value extends ScannedUseProvenance {
  readonly callables: readonly string[];
  readonly captured: readonly string[];
  readonly containsRoot: boolean;
  readonly effectsModeled: boolean;
  readonly effectSites: readonly string[];
}

type Environment = Map<string, Value>;

interface AnalysisState {
  abstractWorkRemaining: number;
  readonly activeInvocations: Set<string>;
  readonly accessors: Map<string, string>;
  budgetExhausted: boolean;
  readonly callables: Map<
    string,
    { readonly node: ts.FunctionLikeDeclaration; readonly parent: Scope }
  >;
  readonly calls: Map<string, { callee: Value; firstArgument?: Value }>;
  readonly history: Map<string, Value>;
  loopReanalysesRemaining: number;
  readonly sourceFile: ts.SourceFile;
}

const abstractWorkBudget = 16_384;
const loopReanalysisBudget = 16;
const unmodeledEffectsKey = '\0kovo:unmodeled-effects';
const valueCandidateBudget = 32;

/**
 * Only exact compiler-owned root factories have a reviewed call contract here: they construct a
 * declaration/adapter without synchronously handing arbitrary arguments back to app code, and the
 * returned declaration is not itself another root factory. Every other import remains opaque at
 * this syntax boundary even when its package has a separate raw-authority posture review.
 */
const reviewedFrameworkRootFactoryCalls = new Set(
  frameworkExportPostureGroups.flatMap(([packageName, , , rootKind, , members]) =>
    rootKind === 'none'
      ? []
      : members.flatMap(([subpath, names]) =>
          names
            .filter((name) => name !== '<module>')
            .map((name) => frameworkCallModelId(packageName, subpath, name)),
        ),
  ),
);

// `style.create` validates data-only style input and returns compiler-owned opaque style records.
// Argument expressions are still walked before the call; only the exact reviewed result object and
// its property reads are modeled here so large static TSX views do not consume the provenance
// effect budget merely by reading generated class records (SPEC §5.2, §6.6, §13.1).
const reviewedFrameworkOpaqueValueCalls = new Set([
  frameworkCallModelId('@kovojs/core', '.', 'component'),
  frameworkCallModelId('@kovojs/style', '.', 'create'),
]);
const reviewedFrameworkDeclarationFactoryCalls = new Set([
  frameworkCallModelId('@kovojs/server', '.', 'createMemoryVersionedClientModuleRegistry'),
]);
const reviewedFrameworkDeclarationReceiverMethods = new Map([
  [
    frameworkCallModelId('@kovojs/server', '.', 'createMemoryVersionedClientModuleRegistry'),
    new Set(['buildToken', 'entries', 'put', 'resolve']),
  ],
]);
// Keep this finite: frozen `s` declaration builders/modifiers return schema data. Parse, storage,
// callback-bearing, and otherwise effectful APIs intentionally remain opaque (SPEC §6.6, §13.1).
const reviewedSchemaBuilderMethods = new Set([
  'array',
  'boolean',
  'date',
  'datetime',
  'decimal',
  'file',
  'json',
  'number',
  'object',
  'record',
  'secret',
  'string',
]);
const reviewedSchemaModifierMethods = new Set([
  'accept',
  'allowControlChars',
  'default',
  'email',
  'format',
  'int',
  'matches',
  'max',
  'maxBytes',
  'min',
  'multiline',
  'optional',
  'pattern',
  'slug',
  'url',
  'uuid',
]);

/** Syntax-only lexical + flow abstraction for exact per-use capability provenance (SPEC §6.6). */
export function scanLexicalProvenance(
  sourceFile: ts.SourceFile,
  imports: readonly ScannedImportBindingFact[],
): ScannedLexicalProvenance {
  const root = createScope(sourceFile);
  const state: AnalysisState = {
    abstractWorkRemaining: abstractWorkBudget,
    activeInvocations: new Set(),
    accessors: new Map(),
    budgetExhausted: false,
    callables: new Map(),
    calls: new Map(),
    history: new Map(),
    loopReanalysesRemaining: loopReanalysisBudget,
    sourceFile,
  };
  let environment: Environment = new Map();
  for (const imported of imports) {
    const binding = findBinding(root, imported.local);
    if (binding === undefined) continue;
    const value = valueOf({
      exportName: imported.imported,
      kind: 'import',
      ...(imported.namespace ? { namespace: true } : {}),
      specifier: imported.specifier,
    });
    environment.set(stateKey(binding), value);
  }
  environment = runStatements(sourceFile.statements, environment, root, state);
  const callFacts = new Map<string, ScannedCallProvenance>();
  for (const [key, call] of state.calls) {
    callFacts.set(key, {
      callee: finalizeValue(call.callee, state.history, state),
      ...(call.firstArgument === undefined
        ? {}
        : { firstArgument: finalizeValue(call.firstArgument, state.history, state) }),
    });
  }
  return { budgetExhausted: state.budgetExhausted, calls: callFacts };
}

function createScope(node: ts.Node, parent?: Scope): Scope {
  const functionLike = ts.isFunctionLike(node);
  const id = `${ts.SyntaxKind[node.kind]}@${node.getStart()}`;
  const scope: Scope = {
    bindings: new Map(),
    id,
    owner: functionLike ? `function:${id}` : (parent?.owner ?? 'function:module'),
    ...(parent === undefined ? {} : { parent }),
  };
  const declare = (name: string, mutable: boolean): void => {
    const prior = scope.bindings.get(name);
    if (prior !== undefined) prior.mutable ||= mutable;
    else
      scope.bindings.set(name, { id: `binding:${id}:${name}`, mutable, name, owner: scope.owner });
  };
  if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) {
    for (const statement of node.statements)
      declareStatement(statement, declare, ts.isSourceFile(node));
    if (ts.isSourceFile(node)) collectVarNames(node, declare);
  } else if (functionLike) {
    if (ts.isFunctionExpression(node) && node.name) declare(node.name.text, false);
    for (const parameter of node.parameters)
      collectNames(parameter.name, (name) => declare(name, true));
    const body = (node as ts.FunctionLikeDeclaration).body;
    if (body) collectVarNames(body, declare);
  } else if (ts.isCatchClause(node) && node.variableDeclaration) {
    collectNames(node.variableDeclaration.name, (name) => declare(name, true));
  } else if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    if (node.initializer && ts.isVariableDeclarationList(node.initializer)) {
      for (const declaration of node.initializer.declarations) {
        collectNames(declaration.name, (name) => declare(name, true));
      }
    }
  } else if (ts.isSwitchStatement(node)) {
    for (const clause of node.caseBlock.clauses) {
      for (const statement of clause.statements) declareStatement(statement, declare, false);
    }
  }
  return scope;
}

function declareStatement(
  statement: ts.Statement,
  declare: (name: string, mutable: boolean) => void,
  source: boolean,
): void {
  if (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly) {
    const clause = statement.importClause;
    if (clause?.name) declare(clause.name.text, false);
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) declare(bindings.name.text, false);
    else if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements)
        if (!element.isTypeOnly) declare(element.name.text, false);
    }
  } else if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly) {
    declare(statement.name.text, false);
  } else if (ts.isVariableStatement(statement)) {
    const blockScoped = (statement.declarationList.flags & ts.NodeFlags.BlockScoped) !== 0;
    if (source || blockScoped) {
      for (const item of statement.declarationList.declarations) {
        collectNames(item.name, (name) =>
          declare(
            name,
            blockScoped && (statement.declarationList.flags & ts.NodeFlags.Const) === 0,
          ),
        );
      }
    }
  } else if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement)) &&
    statement.name
  ) {
    declare(statement.name.text, false);
  }
}

function collectVarNames(node: ts.Node, declare: (name: string, mutable: boolean) => void): void {
  const visit = (child: ts.Node): void => {
    if (child !== node && ts.isFunctionLike(child)) return;
    if (ts.isVariableDeclarationList(child) && (child.flags & ts.NodeFlags.BlockScoped) === 0) {
      for (const item of child.declarations) collectNames(item.name, (name) => declare(name, true));
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
}

function collectNames(name: ts.BindingName, collect: (name: string) => void): void {
  if (ts.isIdentifier(name)) collect(name.text);
  else
    for (const item of name.elements)
      if (!ts.isOmittedExpression(item)) collectNames(item.name, collect);
}

function runStatements(
  statements: readonly ts.Statement[],
  input: Environment,
  scope: Scope,
  state: AnalysisState,
): Environment {
  let environment = input;
  const functions: ts.FunctionDeclaration[] = [];
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement)) {
      functions.push(statement);
      if (statement.name) {
        const binding = findBinding(scope, statement.name.text);
        if (binding) {
          environment = writeBinding(
            binding,
            '',
            callableValue(statement, scope, state, statement.name.text),
            environment,
            state,
            false,
          );
        }
      }
    } else environment = runStatement(statement, environment, scope, state);
  }
  for (const fn of functions) runFunction(fn, environment, scope, state);
  return environment;
}

function runStatement(
  node: ts.Statement,
  env: Environment,
  scope: Scope,
  state: AnalysisState,
): Environment {
  if (!consumeAbstractWork(state)) return env;
  if (ts.isBlock(node)) return runStatements(node.statements, env, createScope(node, scope), state);
  if (ts.isImportEqualsDeclaration(node) && !ts.isExternalModuleReference(node.moduleReference)) {
    const binding = findBinding(scope, node.name.text);
    return binding
      ? writeBinding(
          binding,
          '',
          readEntityName(node.moduleReference, env, scope, state),
          env,
          state,
          false,
        )
      : env;
  }
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (!declaration.initializer) continue;
      env = runExpression(declaration.initializer, env, scope, state);
      env = runBindingPatternEffects(declaration.name, declaration.initializer, env, scope, state);
      const value = readExpression(declaration.initializer, env, scope, state);
      env = bindName(declaration.name, value, env, scope, state, false);
      if (
        ts.isIdentifier(declaration.name) &&
        ts.isObjectLiteralExpression(declaration.initializer)
      ) {
        env = bindObjectMembers(declaration.name, declaration.initializer, env, scope, state);
      }
    }
    return env;
  }
  if (ts.isExpressionStatement(node)) return runExpression(node.expression, env, scope, state);
  if (ts.isIfStatement(node)) {
    const base = runExpression(node.expression, env, scope, state);
    const yes = runStatement(node.thenStatement, new Map(base), scope, state);
    const no = node.elseStatement
      ? runStatement(node.elseStatement, new Map(base), scope, state)
      : base;
    return joinEnvironments(yes, no, state);
  }
  if (ts.isWhileStatement(node)) {
    const base = runExpression(node.expression, env, scope, state);
    return loopEnvironment(
      base,
      (current) =>
        runExpression(
          node.expression,
          runStatement(node.statement, current, scope, state),
          scope,
          state,
        ),
      state,
    );
  }
  if (ts.isDoStatement(node)) {
    return loopEnvironment(
      env,
      (current) =>
        runExpression(
          node.expression,
          runStatement(node.statement, current, scope, state),
          scope,
          state,
        ),
      state,
    );
  }
  if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    const loop = createScope(node, scope);
    let base = env;
    if (node.initializer) {
      base = ts.isVariableDeclarationList(node.initializer)
        ? runVariableList(node.initializer, base, loop, state)
        : runExpression(node.initializer, base, loop, state);
    }
    if (ts.isForStatement(node) && node.condition)
      base = runExpression(node.condition, base, loop, state);
    return loopEnvironment(
      base,
      (current) => {
        let body = runStatement(node.statement, current, loop, state);
        if (ts.isForStatement(node) && node.incrementor)
          body = runExpression(node.incrementor, body, loop, state);
        if (ts.isForStatement(node) && node.condition)
          body = runExpression(node.condition, body, loop, state);
        return body;
      },
      state,
    );
  }
  if (ts.isTryStatement(node)) {
    const attempted = runStatement(node.tryBlock, new Map(env), scope, state);
    const caught = node.catchClause
      ? runStatement(
          node.catchClause.block,
          joinEnvironments(env, attempted, state),
          createScope(node.catchClause, scope),
          state,
        )
      : env;
    const joined = joinEnvironments(attempted, caught, state);
    return node.finallyBlock ? runStatement(node.finallyBlock, joined, scope, state) : joined;
  }
  if (ts.isSwitchStatement(node)) {
    const switchScope = createScope(node, scope);
    const base = runExpression(node.expression, env, switchScope, state);
    let result: Environment | undefined;
    for (const clause of node.caseBlock.clauses) {
      let arm = new Map(base);
      if (ts.isCaseClause(clause)) arm = runExpression(clause.expression, arm, switchScope, state);
      arm = runStatements(clause.statements, arm, switchScope, state);
      result = result === undefined ? arm : joinEnvironments(result, arm, state);
    }
    return joinEnvironments(base, result ?? base, state);
  }
  if (ts.isClassDeclaration(node)) {
    for (const decorator of ts.getDecorators(node) ?? []) {
      env = ts.isCallExpression(decorator.expression)
        ? runExpression(decorator.expression, env, scope, state)
        : runImplicitInvocation(decorator, decorator.expression, env, scope, state);
    }
    if (node.name) {
      const binding = findBinding(scope, node.name.text);
      if (binding) {
        env = writeBinding(binding, '', classValue(node, node.name.text), env, state, false);
      }
    }
    return runClassMembers(node.members, env, scope, state);
  }
  if ((ts.isReturnStatement(node) || ts.isThrowStatement(node)) && node.expression) {
    return runExpression(node.expression, env, scope, state);
  }
  let result = env;
  ts.forEachChild(node, (child) => {
    if (ts.isExpression(child)) result = runExpression(child, result, scope, state);
    else if (ts.isStatement(child)) result = runStatement(child, result, scope, state);
  });
  return result;
}

function runVariableList(
  list: ts.VariableDeclarationList,
  env: Environment,
  scope: Scope,
  state: AnalysisState,
): Environment {
  let result = env;
  for (const declaration of list.declarations) {
    if (!declaration.initializer) continue;
    result = runExpression(declaration.initializer, result, scope, state);
    result = runBindingPatternEffects(
      declaration.name,
      declaration.initializer,
      result,
      scope,
      state,
    );
    result = bindName(
      declaration.name,
      readExpression(declaration.initializer, result, scope, state),
      result,
      scope,
      state,
      false,
    );
  }
  return result;
}

function runFunction(
  node: ts.FunctionLikeDeclaration,
  outer: Environment,
  parent: Scope,
  state: AnalysisState,
): Environment {
  const scope = createScope(node, parent);
  let env = new Map(outer);
  for (const parameter of node.parameters) {
    let value = unknownValue('function parameter', false);
    if (parameter.initializer) {
      env = runExpression(parameter.initializer, env, scope, state);
      value = joinValues(state, value, readExpression(parameter.initializer, env, scope, state));
    }
    env = bindName(parameter.name, value, env, scope, state, false);
  }
  if (node.body) {
    env = ts.isBlock(node.body)
      ? runStatements(node.body.statements, env, createScope(node.body, scope), state)
      : runExpression(node.body, env, scope, state);
  }
  return env;
}

function runExpression(
  node: ts.Expression,
  env: Environment,
  scope: Scope,
  state: AnalysisState,
): Environment {
  if (!consumeAbstractWork(state)) return env;
  const expression = unwrap(node);
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    registerCallable(expression, scope, state);
    runFunction(expression, env, scope, state);
    return env;
  }
  if (ts.isClassExpression(expression)) {
    return runClassMembers(expression.members, env, scope, state);
  }
  if (
    ts.isJsxElement(expression) ||
    ts.isJsxSelfClosingElement(expression) ||
    ts.isJsxFragment(expression)
  ) {
    return runJsxExpression(expression, env, scope, state);
  }
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    env = runExpression(expression.expression, env, scope, state);
    if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
      env = runExpression(expression.argumentExpression, env, scope, state);
    }
    const reference = expressionReference(expression, scope);
    if (reference) {
      const key = stateKey(reference.binding, reference.path);
      const accessor = state.accessors.get(key);
      if (accessor) return invokeCallable(accessor, env, state);
      if (
        reference.path !== '' &&
        !env.has(key) &&
        readBinding(reference.binding, '', env, scope, state).candidates.some(
          (candidate) => candidate.kind === 'local' || candidate.kind === 'unknown',
        )
      ) {
        const base = readBinding(reference.binding, '', env, scope, state);
        env.set(
          key,
          withCurrentEffects(
            unknownValue('proxyable or accessor-backed property read', base.containsRoot),
            env,
          ),
        );
        return markUnmodeledEffects(
          env,
          scope,
          state,
          lexicalNodeKey(expression, state.sourceFile),
        );
      }
      return env;
    }
    return markUnmodeledEffects(env, scope, state, lexicalNodeKey(expression, state.sourceFile));
  }
  if (ts.isCallExpression(expression)) {
    if (
      expression.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(expression.expression) &&
        expression.expression.text === 'require' &&
        findBinding(scope, 'require') === undefined)
    ) {
      for (const argument of expression.arguments) {
        env = runExpression(argument, env, scope, state);
      }
      return env;
    }
    return runInvocation(
      expression,
      expression.expression,
      expression.arguments,
      env,
      scope,
      state,
    );
  }
  if (ts.isNewExpression(expression)) {
    return runInvocation(
      expression,
      expression.expression,
      expression.arguments ?? [],
      env,
      scope,
      state,
    );
  }
  if (ts.isTaggedTemplateExpression(expression)) {
    const substitutions = ts.isTemplateExpression(expression.template)
      ? expression.template.templateSpans.map((span) => span.expression)
      : [];
    return runInvocation(expression, expression.tag, substitutions, env, scope, state);
  }
  if (ts.isConditionalExpression(expression)) {
    const base = runExpression(expression.condition, env, scope, state);
    return joinEnvironments(
      runExpression(expression.whenTrue, new Map(base), scope, state),
      runExpression(expression.whenFalse, new Map(base), scope, state),
      state,
    );
  }
  if (ts.isBinaryExpression(expression)) {
    if (isAssignment(expression.operatorToken.kind)) {
      env = runExpression(expression.right, env, scope, state);
      const right = readExpression(expression.right, env, scope, state);
      const value =
        expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
          ? right
          : joinValues(
              state,
              readExpression(expression.left, env, scope, state),
              right,
              unknownValue('compound assignment'),
            );
      return assignTarget(expression.left, value, env, scope, state, true);
    }
    if (
      expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      const base = runExpression(expression.left, env, scope, state);
      return joinEnvironments(
        base,
        runExpression(expression.right, new Map(base), scope, state),
        state,
      );
    }
  }
  if (ts.isObjectLiteralExpression(expression)) {
    for (const property of expression.properties) {
      if (property.name && ts.isComputedPropertyName(property.name)) {
        env = runExpression(property.name.expression, env, scope, state);
        env = markUnmodeledEffects(
          env,
          scope,
          state,
          lexicalNodeKey(property.name, state.sourceFile),
        );
      }
      if (ts.isPropertyAssignment(property))
        env = runExpression(property.initializer, env, scope, state);
      else if (ts.isShorthandPropertyAssignment(property) && property.objectAssignmentInitializer) {
        env = runExpression(property.objectAssignmentInitializer, env, scope, state);
      } else if (ts.isSpreadAssignment(property)) {
        env = runExpression(property.expression, env, scope, state);
        env = markUnmodeledEffects(env, scope, state, lexicalNodeKey(property, state.sourceFile));
      } else if (
        ts.isMethodDeclaration(property) ||
        ts.isGetAccessorDeclaration(property) ||
        ts.isSetAccessorDeclaration(property)
      )
        runFunction(property, env, scope, state);
    }
    return env;
  }
  let result = env;
  ts.forEachChild(expression, (child) => {
    if (ts.isExpression(child)) result = runExpression(child, result, scope, state);
  });
  if (hasImplicitExecution(expression)) {
    result = markUnmodeledEffects(
      result,
      scope,
      state,
      lexicalNodeKey(expression, state.sourceFile),
    );
  }
  return result;
}

// SPEC §5.2 rule 10: JSX is executable typed syntax. Walk its attribute and child expression
// containers explicitly because `ts.forEachChild()` exposes the containers themselves, not their
// nested expressions, to the generic expression callback. Missing one here would turn an ordinary
// nested call into absent lexical provenance and make capability-root synthesis depend on an
// unrelated transitive import.
function runJsxExpression(
  expression: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment,
  env: Environment,
  scope: Scope,
  state: AnalysisState,
): Environment {
  const opening = ts.isJsxElement(expression)
    ? expression.openingElement
    : ts.isJsxSelfClosingElement(expression)
      ? expression
      : undefined;
  let invocation: { readonly callee: Value; readonly node: ts.JsxOpeningLikeElement } | undefined;
  if (opening !== undefined) {
    const callee = jsxTagExpression(opening.tagName);
    // Intrinsic JSX tags lower to string names; there is no ambient component getter or invocation
    // to model. Attributes and children remain executable and are walked below.
    if (callee && !isIntrinsicJsxTagName(opening.tagName)) {
      const begun = beginImplicitInvocation(opening, callee, env, scope, state);
      env = begun.env;
      invocation = { callee: begun.callee, node: opening };
    }
    for (const attribute of opening.attributes.properties) {
      if (ts.isJsxSpreadAttribute(attribute)) {
        env = runExpression(attribute.expression, env, scope, state);
        env = markUnmodeledEffects(env, scope, state, lexicalNodeKey(attribute, state.sourceFile));
        continue;
      }
      const initializer = attribute.initializer;
      if (initializer === undefined || ts.isStringLiteral(initializer)) continue;
      if (ts.isJsxExpression(initializer)) {
        if (initializer.expression !== undefined) {
          env = runExpression(initializer.expression, env, scope, state);
        }
      } else {
        env = runExpression(initializer, env, scope, state);
      }
    }
  }

  const children = ts.isJsxSelfClosingElement(expression) ? [] : expression.children;
  for (const child of children) {
    if (ts.isJsxExpression(child)) {
      if (child.expression === undefined) continue;
      env = runExpression(child.expression, env, scope, state);
      if (child.dotDotDotToken !== undefined) {
        env = markUnmodeledEffects(env, scope, state, lexicalNodeKey(child, state.sourceFile));
      }
    } else if (
      ts.isJsxElement(child) ||
      ts.isJsxSelfClosingElement(child) ||
      ts.isJsxFragment(child)
    ) {
      env = runJsxExpression(child, env, scope, state);
    }
  }
  if (invocation !== undefined) {
    env = finishImplicitInvocation(invocation.node, invocation.callee, env, scope, state);
  }
  return env;
}

function hasImplicitExecution(expression: ts.Expression): boolean {
  return (
    ts.isAwaitExpression(expression) ||
    ts.isYieldExpression(expression) ||
    ts.isSpreadElement(expression) ||
    ts.isDeleteExpression(expression) ||
    ts.isPrefixUnaryExpression(expression) ||
    ts.isPostfixUnaryExpression(expression) ||
    ts.isTemplateExpression(expression) ||
    (ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken &&
      expression.operatorToken.kind !== ts.SyntaxKind.BarBarToken &&
      expression.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken &&
      !isAssignment(expression.operatorToken.kind))
  );
}

function runInvocation(
  node: ts.CallExpression | ts.NewExpression | ts.TaggedTemplateExpression,
  calleeExpression: ts.Expression,
  arguments_: readonly ts.Expression[],
  env: Environment,
  scope: Scope,
  state: AnalysisState,
): Environment {
  env = runExpression(calleeExpression, env, scope, state);
  const callee = closeUnreviewedFrameworkDeclarationReceiver(
    readExpression(calleeExpression, env, scope, state),
  );
  const first = arguments_[0];
  const key = lexicalCallKey(node, state.sourceFile);
  const prior = state.calls.get(key);
  state.calls.set(key, {
    callee: prior ? joinValues(state, prior.callee, callee) : callee,
    ...(first === undefined
      ? {}
      : {
          firstArgument: prior?.firstArgument
            ? joinValues(state, prior.firstArgument, readExpression(first, env, scope, state))
            : readExpression(first, env, scope, state),
        }),
  });
  for (const argument of arguments_) {
    if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
      env = joinEnvironments(env, runFunction(argument, new Map(env), scope, state), state);
    } else env = runExpression(argument, env, scope, state);
  }
  env = invokeKnownCallables(callee, env, state);
  if (!callEffectsAreModeled(callee)) {
    env = invokeTransferredCallables(arguments_, env, scope, state);
    env = widenPassedObjectMembers(arguments_, env, scope);
    env = markUnmodeledEffects(env, scope, state, lexicalNodeKey(node, state.sourceFile));
  }
  return env;
}

function invokeTransferredCallables(
  arguments_: readonly ts.Expression[],
  env: Environment,
  scope: Scope,
  state: AnalysisState,
): Environment {
  let result = env;
  for (const argument of arguments_) {
    const value = readExpression(argument, env, scope, state);
    if (value.callables.length === 0) continue;
    result = joinEnvironments(result, invokeKnownCallables(value, new Map(env), state), state);
  }
  return result;
}

function runImplicitInvocation(
  node: ts.Decorator | ts.JsxOpeningLikeElement,
  calleeExpression: ts.Expression,
  env: Environment,
  scope: Scope,
  state: AnalysisState,
): Environment {
  const invocation = beginImplicitInvocation(node, calleeExpression, env, scope, state);
  return finishImplicitInvocation(node, invocation.callee, invocation.env, scope, state);
}

function beginImplicitInvocation(
  node: ts.Decorator | ts.JsxOpeningLikeElement,
  calleeExpression: ts.Expression,
  env: Environment,
  scope: Scope,
  state: AnalysisState,
): { readonly callee: Value; readonly env: Environment } {
  env = runExpression(calleeExpression, env, scope, state);
  const callee = closeUnreviewedFrameworkDeclarationReceiver(
    readExpression(calleeExpression, env, scope, state),
  );
  const key = lexicalCallKey(node, state.sourceFile);
  const prior = state.calls.get(key);
  state.calls.set(key, {
    callee: prior ? joinValues(state, prior.callee, callee) : callee,
  });
  return { callee, env };
}

function finishImplicitInvocation(
  node: ts.Decorator | ts.JsxOpeningLikeElement,
  callee: Value,
  env: Environment,
  scope: Scope,
  state: AnalysisState,
): Environment {
  env = invokeKnownCallables(callee, env, state);
  if (!callEffectsAreModeled(callee)) {
    env = markUnmodeledEffects(env, scope, state, lexicalNodeKey(node, state.sourceFile));
  }
  return env;
}

function jsxTagExpression(tag: ts.JsxTagNameExpression): ts.Expression | undefined {
  return ts.isIdentifier(tag) ||
    ts.isPropertyAccessExpression(tag) ||
    tag.kind === ts.SyntaxKind.ThisKeyword
    ? (tag as ts.Expression)
    : undefined;
}

function runBindingPatternEffects(
  name: ts.BindingName,
  initializer: ts.Expression,
  env: Environment,
  scope: Scope,
  state: AnalysisState,
): Environment {
  if (ts.isIdentifier(name)) return env;
  if (ts.isArrayBindingPattern(name)) {
    return markUnmodeledEffects(env, scope, state, lexicalNodeKey(name, state.sourceFile));
  }
  const base = expressionReference(initializer, scope);
  for (const element of name.elements) {
    if (
      element.dotDotDotToken ||
      (element.propertyName && propertyText(element.propertyName) === undefined)
    ) {
      env = markUnmodeledEffects(env, scope, state, lexicalNodeKey(element, state.sourceFile));
      continue;
    }
    const member = element.propertyName
      ? propertyText(element.propertyName)
      : ts.isIdentifier(element.name)
        ? element.name.text
        : undefined;
    if (base && member) {
      const accessor = state.accessors.get(stateKey(base.binding, appendMember(base.path, member)));
      if (accessor) env = invokeCallable(accessor, env, state);
    }
  }
  return env;
}

function widenPassedObjectMembers(
  arguments_: readonly ts.Expression[],
  env: Environment,
  scope: Scope,
): Environment {
  for (const argument of arguments_) {
    const reference = expressionReference(argument, scope);
    if (!reference) continue;
    const prefix = stateKey(reference.binding, reference.path);
    for (const [key, value] of env) {
      if (key !== prefix && key.startsWith(prefix)) {
        env.set(key, { ...value, containsRoot: true, rootWideningRequired: true });
      }
    }
  }
  return env;
}

function runClassMembers(
  members: ts.NodeArray<ts.ClassElement>,
  env: Environment,
  scope: Scope,
  state: AnalysisState,
): Environment {
  for (const member of members) {
    for (const decorator of (ts.canHaveDecorators(member) ? ts.getDecorators(member) : []) ?? []) {
      env = ts.isCallExpression(decorator.expression)
        ? runExpression(decorator.expression, env, scope, state)
        : runImplicitInvocation(decorator, decorator.expression, env, scope, state);
    }
    if (
      ts.isMethodDeclaration(member) ||
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member)
    ) {
      runFunction(member, env, scope, state);
    } else if (ts.isPropertyDeclaration(member) && member.initializer) {
      env = runExpression(member.initializer, env, scope, state);
    } else if (ts.isClassStaticBlockDeclaration(member)) {
      env = runStatement(member.body, env, scope, state);
    }
  }
  return env;
}

function bindName(
  name: ts.BindingName,
  value: Value,
  env: Environment,
  scope: Scope,
  state: AnalysisState,
  assignment: boolean,
): Environment {
  if (ts.isIdentifier(name)) {
    const binding = findBinding(scope, name.text);
    return binding ? writeBinding(binding, '', value, env, state, assignment) : env;
  }
  for (let index = 0; index < name.elements.length; index += 1) {
    const item = name.elements[index]!;
    if (ts.isOmittedExpression(item)) continue;
    const member = ts.isObjectBindingPattern(name)
      ? item.propertyName
        ? propertyText(item.propertyName)
        : ts.isIdentifier(item.name)
          ? item.name.text
          : undefined
      : String(index);
    let projected =
      item.dotDotDotToken || member === undefined
        ? joinValues(state, value, unknownValue('rest or computed destructuring'))
        : projectValue(value, member);
    if (item.initializer)
      projected = joinValues(state, projected, readExpression(item.initializer, env, scope, state));
    env = bindName(item.name, projected, env, scope, state, assignment);
  }
  return env;
}

function assignTarget(
  target: ts.Expression,
  value: Value,
  env: Environment,
  scope: Scope,
  state: AnalysisState,
  assignment: boolean,
): Environment {
  const expression = unwrap(target);
  const reference = expressionReference(expression, scope);
  if (reference)
    return writeBinding(reference.binding, reference.path, value, env, state, assignment);
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    return assignTarget(
      expression.left,
      joinValues(state, value, readExpression(expression.right, env, scope, state)),
      env,
      scope,
      state,
      assignment,
    );
  }
  if (ts.isObjectLiteralExpression(expression)) {
    for (const property of expression.properties) {
      if (ts.isShorthandPropertyAssignment(property))
        env = assignTarget(
          property.name,
          projectValue(value, property.name.text),
          env,
          scope,
          state,
          assignment,
        );
      else if (ts.isPropertyAssignment(property)) {
        const member = propertyText(property.name);
        env = assignTarget(
          property.initializer,
          member ? projectValue(value, member) : unknownValue('computed destructuring'),
          env,
          scope,
          state,
          assignment,
        );
      } else if (ts.isSpreadAssignment(property))
        env = assignTarget(
          property.expression,
          joinValues(state, value, unknownValue('rest destructuring')),
          env,
          scope,
          state,
          assignment,
        );
    }
  } else if (ts.isArrayLiteralExpression(expression)) {
    for (let index = 0; index < expression.elements.length; index += 1) {
      const item = expression.elements[index]!;
      if (!ts.isOmittedExpression(item))
        env = assignTarget(
          ts.isSpreadElement(item) ? item.expression : item,
          ts.isSpreadElement(item)
            ? joinValues(state, value, unknownValue('rest destructuring'))
            : projectValue(value, String(index)),
          env,
          scope,
          state,
          assignment,
        );
    }
  }
  return env;
}

function bindObjectMembers(
  name: ts.Identifier,
  object: ts.ObjectLiteralExpression,
  env: Environment,
  scope: Scope,
  state: AnalysisState,
): Environment {
  const binding = findBinding(scope, name.text);
  if (!binding) return env;
  for (const property of object.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      const memberValue = readExpression(property.name, env, scope, state);
      env = writeBinding(binding, property.name.text, memberValue, env, state, false);
      env = markContainerRoot(binding, memberValue, env);
    } else if (ts.isPropertyAssignment(property)) {
      const member = propertyText(property.name);
      if (member) {
        const memberValue = readExpression(property.initializer, env, scope, state);
        env = writeBinding(binding, member, memberValue, env, state, false);
        env = markContainerRoot(binding, memberValue, env);
      }
    } else if (ts.isMethodDeclaration(property)) {
      const member = propertyText(property.name);
      if (member) {
        env = writeBinding(
          binding,
          member,
          callableValue(property, scope, state, member),
          env,
          state,
          false,
        );
      }
    } else if (ts.isGetAccessorDeclaration(property) || ts.isSetAccessorDeclaration(property)) {
      const member = propertyText(property.name);
      if (member) {
        const key = stateKey(binding, member);
        state.accessors.set(key, registerCallable(property, scope, state));
        env.set(
          key,
          withCurrentEffects(
            unknownValue('accessor return value is not a finite binding reference', true),
            env,
          ),
        );
      }
    }
  }
  return env;
}

function readExpression(
  node: ts.Expression,
  env: Environment,
  scope: Scope,
  state: AnalysisState,
): Value {
  const expression = unwrap(node);
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return callableValue(expression, scope, state, expression.name?.text ?? 'anonymous');
  }
  if (ts.isClassExpression(expression)) {
    return classValue(expression, expression.name?.text ?? 'anonymous-class');
  }
  const reference = expressionReference(expression, scope);
  if (reference) return readBinding(reference.binding, reference.path, env, scope, state);
  if (ts.isPropertyAccessExpression(expression)) {
    const projected = projectValue(
      readExpression(expression.expression, env, scope, state),
      expression.name.text,
    );
    if (
      projected.candidates.length > 0 &&
      projected.candidates.every(isReviewedSchemaValueCallCandidate)
    ) {
      return projected;
    }
  }
  // An ambient/global value is not itself evidence of a Kovo root-factory binding. Invoking it is
  // still effectful, and its unsupported result remains root-bearing below; raw platform globals
  // are closed independently by the capability scanner.
  if (ts.isIdentifier(expression)) return unknownValue('unbound or ambient value', false);
  if (ts.isConditionalExpression(expression)) {
    return joinValues(
      state,
      readExpression(expression.whenTrue, env, scope, state),
      readExpression(expression.whenFalse, env, scope, state),
    );
  }
  if (
    ts.isBinaryExpression(expression) &&
    (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  )
    return joinValues(
      state,
      readExpression(expression.left, env, scope, state),
      readExpression(expression.right, env, scope, state),
    );
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.CommaToken
  ) {
    return {
      ...readExpression(expression.right, env, scope, state),
      rootWideningRequired: true,
      uncertain: true,
    };
  }
  if (
    ts.isCallExpression(expression) ||
    ts.isNewExpression(expression) ||
    ts.isTaggedTemplateExpression(expression)
  ) {
    const calleeExpression = ts.isTaggedTemplateExpression(expression)
      ? expression.tag
      : expression.expression;
    const callee = readExpression(calleeExpression, env, scope, state);
    const arguments_ = ts.isTaggedTemplateExpression(expression)
      ? ts.isTemplateExpression(expression.template)
        ? expression.template.templateSpans.map((span) => span.expression)
        : []
      : (expression.arguments ?? []);
    const argumentValues = arguments_.map((argument) =>
      readExpression(argument, env, scope, state),
    );
    const reviewedRootFactory = isReviewedFrameworkRootFactoryCall(callee);
    const reviewedDeclarationFactory = isReviewedFrameworkDeclarationFactoryCall(callee);
    const reviewedOpaqueValue = isReviewedFrameworkOpaqueValueCall(callee);
    if (reviewedOpaqueValue) {
      const containsRoot = argumentValues.some((argument) => argument.containsRoot);
      return {
        ...callee,
        callables: [],
        captured: [],
        containsRoot,
        effectsModeled: true,
        effectSites: currentEffectSites(env),
        rootWideningRequired: containsRoot,
        uncertain: containsRoot,
      };
    }
    const canReturnFrameworkRoot =
      !reviewedRootFactory &&
      !reviewedDeclarationFactory &&
      (callee.containsRoot ||
        argumentValues.some((argument) => argument.containsRoot) ||
        callee.candidates.some(candidateCallResultMayContainRoot));
    const unknownResult = unknownValue(
      'call result is not a finite binding reference',
      canReturnFrameworkRoot,
    );
    if (reviewedRootFactory || reviewedDeclarationFactory) {
      // Arguments and callbacks were already walked above. The declaration value returned by an
      // exact reviewed factory is framework data, not another callable framework root.
      return {
        ...unknownResult,
        candidates: callee.candidates.map((candidate) => {
          if (candidate.kind !== 'import') return candidate;
          const factoryId = frameworkCallModelIdForCandidate(candidate);
          return factoryId === undefined
            ? candidate
            : {
                ...candidate,
                reviewedDeclarationFactory: factoryId,
              };
        }),
        effectsModeled: true,
        effectSites: currentEffectSites(env),
        rootWideningRequired: false,
        uncertain: false,
      };
    }
    return argumentValues.length === 0
      ? unknownResult
      : joinValues(state, unknownResult, ...argumentValues);
  }
  if (ts.isElementAccessExpression(expression)) {
    const base = expressionReference(expression.expression, scope);
    if (base) {
      const prefix = stateKey(base.binding);
      const values = [...env.entries()]
        .filter(([key]) => key !== prefix && key.startsWith(prefix))
        .map(([, value]) => value);
      if (values.length > 0) {
        return joinValues(
          state,
          ...values,
          unknownValue(
            'computed member selection is ambiguous',
            values.some((value) => value.containsRoot),
          ),
        );
      }
    }
  }
  let containsRoot = false;
  ts.forEachChild(expression, (child) => {
    if (ts.isExpression(child) && readExpression(child, env, scope, state).containsRoot) {
      containsRoot = true;
    }
  });
  return unknownValue('expression is not a finite binding reference', containsRoot, false);
}

function readEntityName(
  name: ts.EntityName,
  env: Environment,
  scope: Scope,
  state: AnalysisState,
): Value {
  return ts.isIdentifier(name)
    ? readExpression(name, env, scope, state)
    : projectValue(readEntityName(name.left, env, scope, state), name.right.text);
}

function expressionReference(
  node: ts.Expression,
  scope: Scope,
): { binding: Binding; path: string } | undefined {
  const expression = unwrap(node);
  if (ts.isIdentifier(expression)) {
    const binding = findBinding(scope, expression.text);
    return binding ? { binding, path: '' } : undefined;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const base = expressionReference(expression.expression, scope);
    return base ? { ...base, path: appendMember(base.path, expression.name.text) } : undefined;
  }
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    const base = expressionReference(expression.expression, scope);
    return base
      ? { ...base, path: appendMember(base.path, expression.argumentExpression.text) }
      : undefined;
  }
  return undefined;
}

function readBinding(
  binding: Binding,
  path: string,
  env: Environment,
  scope: Scope,
  state: AnalysisState,
): Value {
  const key = stateKey(binding, path);
  let value = env.get(key);
  const exact = value !== undefined;
  if (!value && path) {
    value = projectValue(readBinding(binding, '', env, scope, state), path);
    const historicalBase = binding.mutable ? state.history.get(stateKey(binding)) : undefined;
    if (historicalBase !== undefined) {
      value = joinValues(state, value, projectValue(historicalBase, path));
    }
  }
  value ??= valueOf({
    exportName: binding.name,
    kind: 'local',
    ...(path ? { members: path.split('.') } : {}),
  });
  if (binding.owner !== scope.owner && (binding.mutable || !exact)) {
    value = joinValues(state, value, state.history.get(key) ?? value);
    value = { ...value, captured: [...new Set([...value.captured, key])], uncertain: true };
  }
  return {
    ...value,
    rootWideningRequired:
      value.rootWideningRequired ||
      (binding.mutable && hasUnseenEffects(value, env, binding.owner)) ||
      path === 'call' ||
      path === 'apply',
    uncertain: value.uncertain || binding.mutable || (path !== '' && exact),
  };
}

function writeBinding(
  binding: Binding,
  path: string,
  value: Value,
  env: Environment,
  state: AnalysisState,
  assignment: boolean,
): Environment {
  const key = stateKey(binding, path);
  if (!path)
    for (const existing of env.keys())
      if (existing.startsWith(`${binding.id}\0`) && existing !== key) env.delete(existing);
  const written = {
    ...value,
    effectSites: currentEffectSites(env),
    uncertain: value.uncertain || assignment || path !== '',
  };
  env.set(key, written);
  state.history.set(key, joinValues(state, state.history.get(key) ?? written, written));
  return env;
}

function valueOf(
  candidate: ScannedBindingCandidate,
  rootWideningRequired = candidate.kind === 'unknown',
): Value {
  return {
    callables: [],
    candidates: [candidate],
    captured: [],
    containsRoot:
      rootWideningRequired ||
      (candidate.kind === 'import' &&
        ((candidate.namespace === true && candidate.specifier.startsWith('@kovojs/')) ||
          isReviewedFrameworkRootFactoryCandidate(candidate))),
    effectsModeled: false,
    effectSites: [],
    rootWideningRequired,
    uncertain: candidate.kind === 'unknown',
  };
}

function unknownValue(reason: string, rootWideningRequired = true, effectsModeled = false): Value {
  return {
    ...valueOf({ kind: 'unknown', reason }, rootWideningRequired),
    effectsModeled,
  };
}

function markContainerRoot(binding: Binding, memberValue: Value, env: Environment): Environment {
  if (!memberValue.containsRoot) return env;
  const key = stateKey(binding);
  const base = env.get(key);
  if (base) env.set(key, { ...base, containsRoot: true });
  return env;
}

function projectValue(value: Value, member: string): Value {
  const members = member.split('.');
  return {
    ...value,
    candidates: value.candidates.map((candidate) =>
      candidate.kind === 'unknown'
        ? candidate
        : { ...candidate, members: [...(candidate.members ?? []), ...members] },
    ),
  };
}

function joinValues(state: AnalysisState, ...values: Value[]): Value {
  const callables = new Set<string>();
  const candidates = new Map<string, ScannedBindingCandidate>();
  const captured = new Set<string>();
  let overflow = false;
  for (const value of values) {
    for (const callable of value.callables) {
      if (callables.size >= valueCandidateBudget || !consumeAbstractWork(state)) {
        overflow = true;
        continue;
      }
      callables.add(callable);
    }
    for (const candidate of value.candidates) {
      const key = JSON.stringify(candidate);
      if (candidates.has(key)) continue;
      if (candidates.size >= valueCandidateBudget || !consumeAbstractWork(state)) {
        overflow = true;
        continue;
      }
      candidates.set(key, candidate);
    }
    for (const key of value.captured) {
      if (captured.has(key)) continue;
      if (captured.size >= valueCandidateBudget || !consumeAbstractWork(state)) {
        overflow = true;
        continue;
      }
      captured.add(key);
    }
  }
  const finiteCandidates = [...candidates.values()];
  return {
    callables: [...callables],
    candidates: finiteCandidates,
    captured: [...captured],
    containsRoot: values.some((value) => value.containsRoot),
    effectsModeled: values.every((value) => value.effectsModeled),
    effectSites:
      values.length === 0
        ? []
        : values[0]!.effectSites.filter((site) =>
            values.slice(1).every((value) => value.effectSites.includes(site)),
          ),
    rootWideningRequired: overflow || values.some((value) => value.rootWideningRequired),
    uncertain:
      overflow ||
      finiteCandidates.length !== 1 ||
      finiteCandidates[0]?.kind === 'unknown' ||
      values.some((value) => value.uncertain),
  };
}

function callableValue(
  node: ts.FunctionLikeDeclaration,
  parent: Scope,
  state: AnalysisState,
  name: string,
): Value {
  const id = registerCallable(node, parent, state);
  return {
    ...valueOf({ exportName: name, kind: 'local' }, false),
    callables: [id],
    effectsModeled: true,
  };
}

function classValue(node: ts.ClassDeclaration | ts.ClassExpression, name: string): Value {
  const hasImplicitMembers = node.members.some(
    (member) =>
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member) ||
      (member.name !== undefined && ts.isComputedPropertyName(member.name)),
  );
  return {
    ...valueOf({ exportName: name, kind: 'local' }, false),
    containsRoot: hasImplicitMembers,
  };
}

function registerCallable(
  node: ts.FunctionLikeDeclaration,
  parent: Scope,
  state: AnalysisState,
): string {
  const id = `callable:${node.getStart(state.sourceFile)}:${node.end}`;
  state.callables.set(id, { node, parent });
  return id;
}

function invokeKnownCallables(callee: Value, env: Environment, state: AnalysisState): Environment {
  if (callee.callables.length === 0) return env;
  let result: Environment | undefined;
  for (const id of callee.callables) {
    const branch = invokeCallable(id, new Map(env), state);
    result = result === undefined ? branch : joinEnvironments(result, branch, state);
  }
  return result ?? env;
}

function invokeCallable(id: string, env: Environment, state: AnalysisState): Environment {
  const callable = state.callables.get(id);
  if (callable === undefined || state.activeInvocations.has(id)) {
    state.budgetExhausted = true;
    return env;
  }
  state.activeInvocations.add(id);
  const result = runFunction(callable.node, env, callable.parent, state);
  state.activeInvocations.delete(id);
  return result;
}

function isReviewedFrameworkRootFactoryCall(callee: Value): boolean {
  return (
    callee.candidates.length > 0 && callee.candidates.every(isReviewedFrameworkRootFactoryCandidate)
  );
}

function isReviewedFrameworkOpaqueValueCall(callee: Value): boolean {
  return (
    !callee.rootWideningRequired &&
    callee.candidates.length > 0 &&
    callee.candidates.every((candidate) => {
      if (isReviewedSchemaValueCallCandidate(candidate)) return true;
      if (isReviewedFrameworkDeclarationReceiverCandidate(candidate)) return true;
      const id = frameworkCallModelIdForCandidate(candidate);
      return id !== undefined && reviewedFrameworkOpaqueValueCalls.has(id);
    })
  );
}

function isReviewedFrameworkDeclarationFactoryCall(callee: Value): boolean {
  return (
    !callee.rootWideningRequired &&
    callee.candidates.length > 0 &&
    callee.candidates.every((candidate) => {
      const id = frameworkCallModelIdForCandidate(candidate);
      return id !== undefined && reviewedFrameworkDeclarationFactoryCalls.has(id);
    })
  );
}

function isReviewedFrameworkDeclarationReceiverCandidate(
  candidate: ScannedBindingCandidate,
): boolean {
  if (candidate.kind !== 'import' || candidate.reviewedDeclarationFactory === undefined) {
    return false;
  }
  const members = candidate.members ?? [];
  if (members.length === 0) return false;
  const { reviewedDeclarationFactory: factoryWitness, ...factoryCandidate } = candidate;
  const factory = {
    ...factoryCandidate,
    members: members.slice(0, -1),
  };
  const factoryId = frameworkCallModelIdForCandidate(factory);
  return (
    factoryId === factoryWitness &&
    reviewedFrameworkDeclarationReceiverMethods
      .get(factoryWitness)
      ?.has(members.at(-1)!) === true
  );
}

function closeUnreviewedFrameworkDeclarationReceiver(callee: Value): Value {
  const hasDeclarationResult = callee.candidates.some(
    (candidate) => candidate.kind === 'import' && candidate.reviewedDeclarationFactory !== undefined,
  );
  return hasDeclarationResult &&
    !callee.candidates.every(isReviewedFrameworkDeclarationReceiverCandidate)
    ? { ...callee, rootWideningRequired: true, uncertain: true }
    : callee;
}

function isReviewedSchemaValueCallCandidate(candidate: ScannedBindingCandidate): boolean {
  if (candidate.kind !== 'import' || candidate.namespace === true) return false;
  const specifier = frameworkPackageSubpath(candidate.specifier);
  if (
    specifier?.packageName !== '@kovojs/server' ||
    specifier.subpath !== '.' ||
    candidate.exportName !== 's'
  ) {
    return false;
  }
  const members = candidate.members ?? [];
  return (
    members.length > 0 &&
    reviewedSchemaBuilderMethods.has(members[0]!) &&
    members.slice(1).every((member) => reviewedSchemaModifierMethods.has(member))
  );
}

function isReviewedFrameworkRootFactoryCandidate(candidate: ScannedBindingCandidate): boolean {
  if (candidate.kind === 'import' && candidate.reviewedDeclarationFactory !== undefined) {
    return false;
  }
  const id = frameworkCallModelIdForCandidate(candidate);
  return id !== undefined && reviewedFrameworkRootFactoryCalls.has(id);
}

function candidateCallResultMayContainRoot(candidate: ScannedBindingCandidate): boolean {
  if (candidate.kind !== 'import') return candidate.kind === 'local';
  return (
    candidate.specifier.startsWith('.') ||
    (candidate.specifier.startsWith('@kovojs/') &&
      !isReviewedFrameworkRootFactoryCandidate(candidate))
  );
}

function frameworkCallModelIdForCandidate(candidate: ScannedBindingCandidate): string | undefined {
  if (candidate.kind !== 'import') return undefined;
  const specifier = frameworkPackageSubpath(candidate.specifier);
  if (specifier === undefined) return undefined;
  const members = candidate.members ?? [];
  const exportName =
    candidate.namespace === true && candidate.exportName === '*'
      ? members.length === 1
        ? members[0]
        : undefined
      : members.length === 0
        ? candidate.exportName
        : undefined;
  return exportName === undefined
    ? undefined
    : frameworkCallModelId(specifier.packageName, specifier.subpath, exportName);
}

function frameworkPackageSubpath(
  specifier: string,
): { readonly packageName: string; readonly subpath: string } | undefined {
  if (!specifier.startsWith('@kovojs/')) return undefined;
  const parts = specifier.split('/');
  if (parts.length < 2) return undefined;
  return {
    packageName: parts.slice(0, 2).join('/'),
    subpath: parts.length === 2 ? '.' : `./${parts.slice(2).join('/')}`,
  };
}

function frameworkCallModelId(packageName: string, subpath: string, exportName: string): string {
  return `${packageName}\0${subpath}\0${exportName}`;
}

function callEffectsAreModeled(callee: Value): boolean {
  return (
    !callee.rootWideningRequired &&
    (callee.effectsModeled ||
      isReviewedFrameworkRootFactoryCall(callee) ||
      isReviewedFrameworkDeclarationFactoryCall(callee) ||
      isReviewedFrameworkOpaqueValueCall(callee))
  );
}

function currentEffectSites(env: Environment): readonly string[] {
  return env.get(unmodeledEffectsKey)?.effectSites ?? [];
}

function withCurrentEffects(value: Value, env: Environment): Value {
  return { ...value, effectSites: currentEffectSites(env) };
}

function hasUnseenEffects(value: Value, env: Environment, owner: string): boolean {
  return currentEffectSites(env).some(
    (effect) => effect.startsWith(`${owner}\u0001`) && !value.effectSites.includes(effect),
  );
}

function markUnmodeledEffects(
  env: Environment,
  scope: Scope,
  state: AnalysisState,
  site: string,
): Environment {
  const effectSites = new Set(currentEffectSites(env));
  for (let current: Scope | undefined = scope; current; current = current.parent) {
    if (current.owner !== scope.owner || scope.owner === 'function:module') {
      effectSites.add(`${current.owner}\u0001${site}`);
    }
  }
  if (effectSites.size > valueCandidateBudget) {
    state.budgetExhausted = true;
    return env;
  }
  env.set(unmodeledEffectsKey, {
    ...unknownValue('unmodeled executable expression effects', false),
    effectSites: [...effectSites],
  });
  return env;
}

function joinEnvironments(
  left: Environment,
  right: Environment,
  state: AnalysisState,
): Environment {
  const result = new Map(left);
  for (const [key, value] of right) {
    if (key === unmodeledEffectsKey) {
      const prior = result.get(key);
      const effectSites = [...new Set([...(prior?.effectSites ?? []), ...value.effectSites])];
      if (effectSites.length > valueCandidateBudget) state.budgetExhausted = true;
      result.set(key, { ...value, effectSites: effectSites.slice(0, valueCandidateBudget) });
      continue;
    }
    result.set(key, result.has(key) ? joinValues(state, result.get(key)!, value) : value);
  }
  return result;
}

function loopEnvironment(
  base: Environment,
  transfer: (current: Environment) => Environment,
  state: AnalysisState,
): Environment {
  for (let result = base; ; ) {
    const next = joinEnvironments(result, transfer(new Map(result)), state);
    if (JSON.stringify([...next]) === JSON.stringify([...result])) return next;
    if (state.loopReanalysesRemaining === 0) {
      state.budgetExhausted = true;
      return next;
    }
    state.loopReanalysesRemaining -= 1;
    result = next;
  }
}

function finalizeValue(
  value: Value,
  history: ReadonlyMap<string, Value>,
  state: AnalysisState,
): ScannedUseProvenance {
  let result = value;
  const seen = new Set<string>();
  const pending = [...value.captured];
  while (pending.length > 0) {
    const key = pending.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const historical = history.get(key);
    if (historical) {
      result = joinValues(state, result, historical);
      pending.push(...historical.captured);
    }
  }
  return {
    candidates: result.candidates,
    rootWideningRequired: result.rootWideningRequired,
    uncertain: result.uncertain || seen.size > 0,
  };
}

function consumeAbstractWork(state: AnalysisState): boolean {
  if (state.abstractWorkRemaining === 0) {
    state.budgetExhausted = true;
    return false;
  }
  state.abstractWorkRemaining -= 1;
  return true;
}

export function lexicalCallKey(node: ts.Node, sourceFile: ts.SourceFile): string {
  return lexicalNodeKey(node, sourceFile);
}

function lexicalNodeKey(node: ts.Node, sourceFile: ts.SourceFile): string {
  return `${node.getStart(sourceFile)}:${node.end}`;
}

function findBinding(scope: Scope, name: string): Binding | undefined {
  for (let current: Scope | undefined = scope; current; current = current.parent) {
    const binding = current.bindings.get(name);
    if (binding) return binding;
  }
  return undefined;
}

function stateKey(binding: Binding, path = ''): string {
  return `${binding.id}\0${path}`;
}
function appendMember(path: string, member: string): string {
  return path ? `${path}.${member}` : member;
}
function isAssignment(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}
function propertyText(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}
function unwrap(node: ts.Expression): ts.Expression {
  let value = node;
  while (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isTypeAssertionExpression(value) ||
    ts.isNonNullExpression(value) ||
    ts.isSatisfiesExpression(value)
  )
    value = value.expression;
  return value;
}
