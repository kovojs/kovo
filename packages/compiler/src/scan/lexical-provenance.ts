import ts from 'typescript';

import type {
  ScannedBindingCandidate,
  ScannedImportBindingFact,
} from '../security/capability-closure-model.js';

export interface ScannedCallProvenance { readonly callee: ScannedUseProvenance; readonly firstArgument?: ScannedUseProvenance }
export interface ScannedUseProvenance { readonly candidates: readonly ScannedBindingCandidate[]; readonly uncertain: boolean }
export interface ScannedLexicalProvenance { readonly calls: ReadonlyMap<number, ScannedCallProvenance> }

interface Binding { readonly id: string; mutable: boolean; readonly name: string; readonly owner: string }
interface Scope { readonly bindings: Map<string, Binding>; readonly id: string; readonly owner: string; readonly parent?: Scope }

interface Value extends ScannedUseProvenance {
  readonly captured: readonly string[];
}

type Environment = Map<string, Value>;

interface AnalysisState { readonly calls: Map<number, { callee: Value; firstArgument?: Value }>; readonly history: Map<string, Value>; readonly sourceFile: ts.SourceFile }

/** Syntax-only lexical + flow abstraction for exact per-use capability provenance (SPEC §6.6). */
export function scanLexicalProvenance(
  sourceFile: ts.SourceFile,
  imports: readonly ScannedImportBindingFact[],
): ScannedLexicalProvenance {
  const root = createScope(sourceFile);
  const state: AnalysisState = { calls: new Map(), history: new Map(), sourceFile };
  let environment: Environment = new Map();
  for (const imported of imports) {
    const binding = findBinding(root, imported.local);
    if (binding === undefined) continue;
    environment.set(
      stateKey(binding),
      valueOf({
        exportName: imported.imported,
        kind: 'import',
        ...(imported.namespace ? { namespace: true } : {}),
        specifier: imported.specifier,
      }),
    );
  }
  environment = runStatements(sourceFile.statements, environment, root, state);
  const callFacts = new Map<number, ScannedCallProvenance>();
  for (const [start, call] of state.calls) {
    callFacts.set(start, {
      callee: finalizeValue(call.callee, state.history),
      ...(call.firstArgument === undefined
        ? {}
        : { firstArgument: finalizeValue(call.firstArgument, state.history) }),
    });
  }
  return { calls: callFacts };
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
    else scope.bindings.set(name, { id: `binding:${id}:${name}`, mutable, name, owner: scope.owner });
  };
  if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) {
    for (const statement of node.statements) declareStatement(statement, declare, ts.isSourceFile(node));
    if (ts.isSourceFile(node)) collectVarNames(node, declare);
  } else if (functionLike) {
    if (ts.isFunctionExpression(node) && node.name) declare(node.name.text, false);
    for (const parameter of node.parameters) collectNames(parameter.name, (name) => declare(name, true));
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
      for (const element of bindings.elements) if (!element.isTypeOnly) declare(element.name.text, false);
    }
  } else if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly) {
    declare(statement.name.text, false);
  } else if (ts.isVariableStatement(statement)) {
    const blockScoped = (statement.declarationList.flags & ts.NodeFlags.BlockScoped) !== 0;
    if (source || blockScoped) {
      for (const item of statement.declarationList.declarations) {
        collectNames(item.name, (name) => declare(name, blockScoped && (statement.declarationList.flags & ts.NodeFlags.Const) === 0));
      }
    }
  } else if (
    (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) &&
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
  else for (const item of name.elements) if (!ts.isOmittedExpression(item)) collectNames(item.name, collect);
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
    if (ts.isFunctionDeclaration(statement)) functions.push(statement);
    else environment = runStatement(statement, environment, scope, state);
  }
  for (const fn of functions) runFunction(fn, environment, scope, state);
  return environment;
}

function runStatement(node: ts.Statement, env: Environment, scope: Scope, state: AnalysisState): Environment {
  if (ts.isBlock(node)) return runStatements(node.statements, env, createScope(node, scope), state);
  if (ts.isImportEqualsDeclaration(node) && !ts.isExternalModuleReference(node.moduleReference)) {
    const binding = findBinding(scope, node.name.text);
    return binding ? writeBinding(binding, '', readEntityName(node.moduleReference, env, scope, state), env, state, false) : env;
  }
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (!declaration.initializer) continue;
      env = runExpression(declaration.initializer, env, scope, state);
      const value = readExpression(declaration.initializer, env, scope, state);
      env = bindName(declaration.name, value, env, scope, state, false);
      if (ts.isIdentifier(declaration.name) && ts.isObjectLiteralExpression(declaration.initializer)) {
        env = bindObjectMembers(declaration.name, declaration.initializer, env, scope, state);
      }
    }
    return env;
  }
  if (ts.isExpressionStatement(node)) return runExpression(node.expression, env, scope, state);
  if (ts.isIfStatement(node)) {
    const base = runExpression(node.expression, env, scope, state);
    const yes = runStatement(node.thenStatement, new Map(base), scope, state);
    const no = node.elseStatement ? runStatement(node.elseStatement, new Map(base), scope, state) : base;
    return joinEnvironments(yes, no);
  }
  if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
    const base = runExpression(node.expression, env, scope, state);
    return joinEnvironments(base, runStatement(node.statement, new Map(base), scope, state));
  }
  if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    const loop = createScope(node, scope);
    let base = env;
    if (node.initializer) {
      base = ts.isVariableDeclarationList(node.initializer)
        ? runVariableList(node.initializer, base, loop, state)
        : runExpression(node.initializer, base, loop, state);
    }
    if (ts.isForStatement(node) && node.condition) base = runExpression(node.condition, base, loop, state);
    let body = runStatement(node.statement, new Map(base), loop, state);
    if (ts.isForStatement(node) && node.incrementor) body = runExpression(node.incrementor, body, loop, state);
    return joinEnvironments(base, body);
  }
  if (ts.isTryStatement(node)) {
    const attempted = runStatement(node.tryBlock, new Map(env), scope, state);
    const caught = node.catchClause
      ? runStatements(node.catchClause.block.statements, new Map(env), createScope(node.catchClause, scope), state)
      : env;
    const joined = joinEnvironments(attempted, caught);
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
      result = result === undefined ? arm : joinEnvironments(result, arm);
    }
    return joinEnvironments(base, result ?? base);
  }
  if (ts.isClassDeclaration(node)) {
    for (const member of node.members) {
      if (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
        runFunction(member, env, scope, state);
      } else if (ts.isPropertyDeclaration(member) && member.initializer) {
        env = runExpression(member.initializer, env, scope, state);
      }
    }
    return env;
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

function runVariableList(list: ts.VariableDeclarationList, env: Environment, scope: Scope, state: AnalysisState): Environment {
  let result = env;
  for (const declaration of list.declarations) {
    if (!declaration.initializer) continue;
    result = runExpression(declaration.initializer, result, scope, state);
    result = bindName(declaration.name, readExpression(declaration.initializer, result, scope, state), result, scope, state, false);
  }
  return result;
}

function runFunction(node: ts.FunctionLikeDeclaration, outer: Environment, parent: Scope, state: AnalysisState): Environment {
  const scope = createScope(node, parent);
  let env = new Map(outer);
  for (const parameter of node.parameters) {
    let value = unknownValue('function parameter');
    if (parameter.initializer) {
      env = runExpression(parameter.initializer, env, scope, state);
      value = joinValues(value, readExpression(parameter.initializer, env, scope, state));
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

function runExpression(node: ts.Expression, env: Environment, scope: Scope, state: AnalysisState): Environment {
  const expression = unwrap(node);
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    runFunction(expression, env, scope, state);
    return env;
  }
  if (ts.isCallExpression(expression)) {
    env = runExpression(expression.expression, env, scope, state);
    const callee = readExpression(expression.expression, env, scope, state);
    const first = expression.arguments[0];
    const prior = state.calls.get(expression.getStart(state.sourceFile));
    state.calls.set(expression.getStart(state.sourceFile), {
      callee: prior ? joinValues(prior.callee, callee) : callee,
      ...(first === undefined
        ? {}
        : {
            firstArgument: prior?.firstArgument
              ? joinValues(prior.firstArgument, readExpression(first, env, scope, state))
              : readExpression(first, env, scope, state),
          }),
    });
    for (const argument of expression.arguments) {
      if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
        env = joinEnvironments(env, runFunction(argument, new Map(env), scope, state));
      } else env = runExpression(argument, env, scope, state);
    }
    return env;
  }
  if (ts.isConditionalExpression(expression)) {
    const base = runExpression(expression.condition, env, scope, state);
    return joinEnvironments(
      runExpression(expression.whenTrue, new Map(base), scope, state),
      runExpression(expression.whenFalse, new Map(base), scope, state),
    );
  }
  if (ts.isBinaryExpression(expression)) {
    if (isAssignment(expression.operatorToken.kind)) {
      env = runExpression(expression.right, env, scope, state);
      const right = readExpression(expression.right, env, scope, state);
      const value = expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
        ? right
        : joinValues(readExpression(expression.left, env, scope, state), right, unknownValue('compound assignment'));
      return assignTarget(expression.left, value, env, scope, state, true);
    }
    if (
      expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      const base = runExpression(expression.left, env, scope, state);
      return joinEnvironments(base, runExpression(expression.right, new Map(base), scope, state));
    }
  }
  if (ts.isObjectLiteralExpression(expression)) {
    for (const property of expression.properties) {
      if (ts.isPropertyAssignment(property)) env = runExpression(property.initializer, env, scope, state);
      else if (ts.isShorthandPropertyAssignment(property) && property.objectAssignmentInitializer) {
        env = runExpression(property.objectAssignmentInitializer, env, scope, state);
      } else if (ts.isSpreadAssignment(property)) env = runExpression(property.expression, env, scope, state);
      else if (ts.isMethodDeclaration(property)) runFunction(property, env, scope, state);
    }
    return env;
  }
  let result = env;
  ts.forEachChild(expression, (child) => {
    if (ts.isExpression(child)) result = runExpression(child, result, scope, state);
  });
  return result;
}

function bindName(name: ts.BindingName, value: Value, env: Environment, scope: Scope, state: AnalysisState, assignment: boolean): Environment {
  if (ts.isIdentifier(name)) {
    const binding = findBinding(scope, name.text);
    return binding ? writeBinding(binding, '', value, env, state, assignment) : env;
  }
  for (let index = 0; index < name.elements.length; index += 1) {
    const item = name.elements[index]!;
    if (ts.isOmittedExpression(item)) continue;
    const member = ts.isObjectBindingPattern(name)
      ? item.propertyName ? propertyText(item.propertyName) : ts.isIdentifier(item.name) ? item.name.text : undefined
      : String(index);
    let projected = item.dotDotDotToken || member === undefined
      ? joinValues(value, unknownValue('rest or computed destructuring'))
      : projectValue(value, member);
    if (item.initializer) projected = joinValues(projected, readExpression(item.initializer, env, scope, state));
    env = bindName(item.name, projected, env, scope, state, assignment);
  }
  return env;
}

function assignTarget(target: ts.Expression, value: Value, env: Environment, scope: Scope, state: AnalysisState, assignment: boolean): Environment {
  const expression = unwrap(target);
  const reference = expressionReference(expression, scope);
  if (reference) return writeBinding(reference.binding, reference.path, value, env, state, assignment);
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return assignTarget(expression.left, joinValues(value, readExpression(expression.right, env, scope, state)), env, scope, state, assignment);
  }
  if (ts.isObjectLiteralExpression(expression)) {
    for (const property of expression.properties) {
      if (ts.isShorthandPropertyAssignment(property)) env = assignTarget(property.name, projectValue(value, property.name.text), env, scope, state, assignment);
      else if (ts.isPropertyAssignment(property)) {
        const member = propertyText(property.name);
        env = assignTarget(property.initializer, member ? projectValue(value, member) : unknownValue('computed destructuring'), env, scope, state, assignment);
      } else if (ts.isSpreadAssignment(property)) env = assignTarget(property.expression, joinValues(value, unknownValue('rest destructuring')), env, scope, state, assignment);
    }
  } else if (ts.isArrayLiteralExpression(expression)) {
    for (let index = 0; index < expression.elements.length; index += 1) {
      const item = expression.elements[index]!;
      if (!ts.isOmittedExpression(item)) env = assignTarget(ts.isSpreadElement(item) ? item.expression : item, ts.isSpreadElement(item) ? joinValues(value, unknownValue('rest destructuring')) : projectValue(value, String(index)), env, scope, state, assignment);
    }
  }
  return env;
}

function bindObjectMembers(name: ts.Identifier, object: ts.ObjectLiteralExpression, env: Environment, scope: Scope, state: AnalysisState): Environment {
  const binding = findBinding(scope, name.text);
  if (!binding) return env;
  for (const property of object.properties) {
    if (ts.isShorthandPropertyAssignment(property)) env = writeBinding(binding, property.name.text, readExpression(property.name, env, scope, state), env, state, false);
    else if (ts.isPropertyAssignment(property)) {
      const member = propertyText(property.name);
      if (member) env = writeBinding(binding, member, readExpression(property.initializer, env, scope, state), env, state, false);
    }
  }
  return env;
}

function readExpression(node: ts.Expression, env: Environment, scope: Scope, state: AnalysisState): Value {
  const expression = unwrap(node);
  const reference = expressionReference(expression, scope);
  if (reference) return readBinding(reference.binding, reference.path, env, scope, state);
  if (ts.isConditionalExpression(expression)) {
    return joinValues(readExpression(expression.whenTrue, env, scope, state), readExpression(expression.whenFalse, env, scope, state));
  }
  if (ts.isBinaryExpression(expression) && (
    expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
    expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
  )) return joinValues(readExpression(expression.left, env, scope, state), readExpression(expression.right, env, scope, state));
  return unknownValue('expression is not a finite binding reference');
}

function readEntityName(name: ts.EntityName, env: Environment, scope: Scope, state: AnalysisState): Value {
  return ts.isIdentifier(name)
    ? readExpression(name, env, scope, state)
    : projectValue(readEntityName(name.left, env, scope, state), name.right.text);
}

function expressionReference(node: ts.Expression, scope: Scope): { binding: Binding; path: string } | undefined {
  const expression = unwrap(node);
  if (ts.isIdentifier(expression)) {
    const binding = findBinding(scope, expression.text);
    return binding ? { binding, path: '' } : undefined;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const base = expressionReference(expression.expression, scope);
    return base ? { ...base, path: appendMember(base.path, expression.name.text) } : undefined;
  }
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression && ts.isStringLiteralLike(expression.argumentExpression)) {
    const base = expressionReference(expression.expression, scope);
    return base ? { ...base, path: appendMember(base.path, expression.argumentExpression.text) } : undefined;
  }
  return undefined;
}

function readBinding(binding: Binding, path: string, env: Environment, scope: Scope, state: AnalysisState): Value {
  const key = stateKey(binding, path);
  let value = env.get(key);
  const exact = value !== undefined;
  if (!value && path) value = projectValue(readBinding(binding, '', env, scope, state), path);
  value ??= valueOf({ exportName: binding.name, kind: 'local', ...(path ? { members: path.split('.') } : {}) });
  if (binding.owner !== scope.owner && binding.mutable) {
    value = joinValues(value, state.history.get(key) ?? value);
    value = { ...value, captured: [...new Set([...value.captured, key])], uncertain: true };
  }
  return { ...value, uncertain: value.uncertain || binding.mutable || (path !== '' && exact) };
}

function writeBinding(binding: Binding, path: string, value: Value, env: Environment, state: AnalysisState, assignment: boolean): Environment {
  const key = stateKey(binding, path);
  if (!path) for (const existing of [...env.keys()]) if (existing.startsWith(`${binding.id}\0`) && existing !== key) env.delete(existing);
  const written = { ...value, uncertain: value.uncertain || assignment || path !== '' };
  env.set(key, written);
  if (binding.mutable || assignment || path) state.history.set(key, joinValues(state.history.get(key) ?? written, written));
  return env;
}

function valueOf(candidate: ScannedBindingCandidate): Value {
  return { candidates: [candidate], captured: [], uncertain: candidate.kind === 'unknown' };
}

function unknownValue(reason: string): Value {
  return valueOf({ kind: 'unknown', reason });
}

function projectValue(value: Value, member: string): Value {
  const members = member.split('.');
  return {
    ...value,
    candidates: value.candidates.map((candidate) => candidate.kind === 'unknown'
      ? candidate
      : { ...candidate, members: [...(candidate.members ?? []), ...members] }),
  };
}

function joinValues(...values: Value[]): Value {
  const candidates = [...new Map(values.flatMap((value) => value.candidates).map((candidate) => [JSON.stringify(candidate), candidate])).values()];
  return {
    candidates,
    captured: [...new Set(values.flatMap((value) => value.captured))],
    uncertain: candidates.length !== 1 || candidates[0]?.kind === 'unknown' || values.some((value) => value.uncertain),
  };
}

function joinEnvironments(left: Environment, right: Environment): Environment {
  const result = new Map(left);
  for (const [key, value] of right) result.set(key, result.has(key) ? joinValues(result.get(key)!, value) : value);
  return result;
}

function finalizeValue(value: Value, history: ReadonlyMap<string, Value>): ScannedUseProvenance {
  let result = value;
  const seen = new Set<string>();
  const pending = [...value.captured];
  while (pending.length > 0) {
    const key = pending.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const historical = history.get(key);
    if (historical) {
      result = joinValues(result, historical);
      pending.push(...historical.captured);
    }
  }
  return { candidates: result.candidates, uncertain: result.uncertain || seen.size > 0 };
}

function findBinding(scope: Scope, name: string): Binding | undefined {
  for (let current: Scope | undefined = scope; current; current = current.parent) {
    const binding = current.bindings.get(name);
    if (binding) return binding;
  }
  return undefined;
}

function stateKey(binding: Binding, path = ''): string { return `${binding.id}\0${path}`; }
function appendMember(path: string, member: string): string { return path ? `${path}.${member}` : member; }
function isAssignment(kind: ts.SyntaxKind): boolean { return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment; }
function propertyText(name: ts.PropertyName): string | undefined { return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : undefined; }
function unwrap(node: ts.Expression): ts.Expression {
  let value = node;
  while (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isTypeAssertionExpression(value) || ts.isNonNullExpression(value) || ts.isSatisfiesExpression(value)) value = value.expression;
  return value;
}
