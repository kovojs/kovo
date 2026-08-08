import type * as TS from 'typescript';

import { typescriptRuntime as ts } from '../ts-api.js';
import {
  compilerArrayAppend,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateSet,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerRegExpTest,
  compilerSetAdd,
  compilerSetForEach,
  compilerSetHas,
} from '../compiler-security-intrinsics.js';
import { unwrapExpression } from './ast.js';

/**
 * SPEC §9.4 (document surface of the `kovo-cache-influence/v1` manifest): scanner-owned facts for
 * one authored `route()` declaration. This is the compiler's *finite document cache language* —
 * everything a route page can do at request time is either (a) admitted because the scanner can
 * see it is derived from build-evaluated module state plus the route's own `params`/`search`
 * cache-key axes, or (b) recorded as a closing influence. One observed execution is never
 * positive evidence; an unmodeled feature closes shared caching (fail-closed).
 *
 * The scanner is deliberately same-module-scoped in v1: JSX component tags and helper calls are
 * admitted only when they resolve to function declarations in the route module itself, whose
 * bodies are then analyzed under the same rules. Imported components/values, awaits, dynamic
 * `import()`, construction, tagged templates, unknown globals, and any use of the request identity
 * all close the entry. This composes with `kovo check`'s capability closure (KV448) which refuses
 * undeclared ambient filesystem/process authority anywhere in app source.
 */
export interface RoutePageCacheInfluenceFact {
  /** Route handlers reach signing material or ambient environment state (`ctx.signUrl`, `process`). */
  secret?: true;
  /** Influences outside the finite document cache language; each entry closes shared caching. */
  unclassified?: readonly string[];
}

interface ModuleDeclarationModel {
  kind: 'const' | 'function' | 'import' | 'mutable' | 'other';
  /** Import provenance: source module specifier and the exported name bound locally. */
  importExportName?: string;
  importModule?: string;
  initializer?: TS.Expression;
  node?: TS.Node;
}

interface ScanState {
  readonly moduleDeclarations: ReadonlyMap<string, ModuleDeclarationModel>;
  secret: boolean;
  readonly sourceFile: TS.SourceFile;
  readonly staticConstMemo: Map<TS.Expression, boolean>;
  readonly unclassified: string[];
  readonly visitedFunctions: Set<TS.Node>;
}

const SAFE_CONTEXT_MEMBERS = ['params', 'path', 'search'] as const;

/** Globals that are inert values (never authority, never request-varying). */
const INERT_FREE_IDENTIFIERS = ['Infinity', 'NaN', 'undefined'] as const;

/** Globals admitted only as direct-call callees; results are pure functions of their inputs. */
const PURE_GLOBAL_CALLEES = [
  'Boolean',
  'Number',
  'String',
  'decodeURIComponent',
  'encodeURIComponent',
] as const;

/**
 * Framework exports admitted as direct-call callees: reviewed pure branded constructors whose
 * output is a deterministic function of their inputs (no authority, no clock, no randomness).
 * Everything else imported stays outside the finite document cache language.
 */
const PURE_FRAMEWORK_CALLEES: readonly { exportName: string; module: string }[] = [
  { exportName: 'trustedHtml', module: '@kovojs/browser' },
  { exportName: 'trustedUrl', module: '@kovojs/browser' },
];

/**
 * Method names admitted on non-authority receivers. Every listed member is a deterministic pure
 * function of receiver + arguments on the standard prototypes; callbacks passed to them are
 * analyzed as nested functions. `Math.random`, `Date` methods, and anything effectful are absent
 * on purpose — an unlisted member closes the entry.
 */
const PURE_METHOD_NAMES = [
  'at',
  'charAt',
  'charCodeAt',
  'codePointAt',
  'concat',
  'endsWith',
  'entries',
  'every',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flat',
  'flatMap',
  'includes',
  'indexOf',
  'join',
  'keys',
  'lastIndexOf',
  'localeCompare',
  'map',
  'normalize',
  'padEnd',
  'padStart',
  'reduce',
  'reduceRight',
  'repeat',
  'replace',
  'replaceAll',
  'slice',
  'some',
  'split',
  'startsWith',
  'substring',
  'toFixed',
  'toLowerCase',
  'toReversed',
  'toSorted',
  'toSpliced',
  'toString',
  'toUpperCase',
  'trim',
  'trimEnd',
  'trimStart',
  'values',
  'with',
] as const;

/** One analyzable route handler (page, region, meta source) with its authored expression. */
export interface RoutePageCacheHandlerInput {
  /** Handler expression or method declaration as authored on the route definition object. */
  node: TS.Node;
  /** Whether parameter 0 is the route context (`{ params, search, path, signUrl }`). */
  role: 'meta' | 'page' | 'region';
}

export function routePageCacheInfluenceFact(
  sourceFile: TS.SourceFile,
  handlers: readonly RoutePageCacheHandlerInput[],
): RoutePageCacheInfluenceFact | undefined {
  const state: ScanState = {
    moduleDeclarations: moduleDeclarationModels(sourceFile),
    secret: false,
    sourceFile,
    staticConstMemo: compilerCreateMap<TS.Expression, boolean>(),
    unclassified: [],
    visitedFunctions: compilerCreateSet<TS.Node>(),
  };

  const handlerCount = compilerArrayLength(handlers, 'Route cache handlers');
  for (let index = 0; index < handlerCount; index += 1) {
    const handler = compilerOwnDataValue(
      handlers,
      index,
      'Route cache handlers',
    ) as RoutePageCacheHandlerInput;
    analyzeHandlerExpression(state, handler.node, handler.role);
  }
  analyzeAppDocumentConfiguration(state);

  if (!state.secret && state.unclassified.length === 0) return undefined;
  return {
    ...(state.secret ? { secret: true as const } : {}),
    ...(state.unclassified.length === 0 ? {} : { unclassified: state.unclassified }),
  };
}

function appendUnclassified(state: ScanState, detail: string): void {
  for (let index = 0; index < state.unclassified.length; index += 1) {
    if (state.unclassified[index] === detail) return;
  }
  compilerArrayAppend(state.unclassified, detail, 'Route cache unclassified influences');
}

function moduleDeclarationModels(
  sourceFile: TS.SourceFile,
): ReadonlyMap<string, ModuleDeclarationModel> {
  const declarations = compilerCreateMap<string, ModuleDeclarationModel>();
  const statements = sourceFile.statements;
  const statementCount = compilerArrayLength(statements, 'Route cache module statements');
  for (let index = 0; index < statementCount; index += 1) {
    const statement = compilerOwnDataValue(
      statements,
      index,
      'Route cache module statements',
    ) as TS.Statement;
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      compilerMapSet(declarations, statement.name.text, { kind: 'function', node: statement });
      continue;
    }
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (!clause) continue;
      const moduleSpecifier =
        statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : undefined;
      if (clause.name) {
        compilerMapSet(declarations, clause.name.text, {
          ...(moduleSpecifier === undefined ? {} : { importModule: moduleSpecifier }),
          importExportName: 'default',
          kind: 'import',
        });
      }
      const named = clause.namedBindings;
      if (named && ts.isNamedImports(named)) {
        const elementCount = compilerArrayLength(named.elements, 'Route cache import elements');
        for (let element = 0; element < elementCount; element += 1) {
          const specifier = compilerOwnDataValue(
            named.elements,
            element,
            'Route cache import elements',
          ) as TS.ImportSpecifier;
          compilerMapSet(declarations, specifier.name.text, {
            ...(moduleSpecifier === undefined ? {} : { importModule: moduleSpecifier }),
            importExportName: specifier.propertyName?.text ?? specifier.name.text,
            kind: 'import',
          });
        }
      } else if (named && ts.isNamespaceImport(named)) {
        compilerMapSet(declarations, named.name.text, {
          ...(moduleSpecifier === undefined ? {} : { importModule: moduleSpecifier }),
          kind: 'import',
        });
      }
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
      const declarationCount = compilerArrayLength(
        statement.declarationList.declarations,
        'Route cache module declarations',
      );
      for (let declaration = 0; declaration < declarationCount; declaration += 1) {
        const entry = compilerOwnDataValue(
          statement.declarationList.declarations,
          declaration,
          'Route cache module declarations',
        ) as TS.VariableDeclaration;
        if (!ts.isIdentifier(entry.name)) continue;
        if (!isConst) {
          compilerMapSet(declarations, entry.name.text, { kind: 'mutable' });
          continue;
        }
        compilerMapSet(
          declarations,
          entry.name.text,
          entry.initializer === undefined
            ? { kind: 'other' }
            : { initializer: entry.initializer, kind: 'const' },
        );
      }
      continue;
    }
    if (
      (ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      compilerMapSet(declarations, statement.name.text, { kind: 'other' });
    }
  }
  return declarations;
}

/** Resolve a route-definition handler expression to analyzable function(s), else close. */
function analyzeHandlerExpression(
  state: ScanState,
  node: TS.Node,
  role: RoutePageCacheHandlerInput['role'],
): void {
  if (ts.isMethodDeclaration(node)) {
    analyzeFunction(state, node, true);
    return;
  }
  if (!ts.isExpression(node)) {
    appendUnclassified(state, `route ${role} handler is not a statically analyzable expression`);
    return;
  }
  const expression = unwrapExpression(node);
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    analyzeFunction(state, expression, true);
    return;
  }
  if (ts.isIdentifier(expression)) {
    const declaration = compilerMapGet(state.moduleDeclarations, expression.text);
    if (declaration !== undefined && resolveModuleFunction(declaration) !== undefined) {
      analyzeFunction(state, resolveModuleFunction(declaration)!, true);
      return;
    }
    appendUnclassified(
      state,
      `route ${role} handler '${expression.text}' does not resolve to a module function literal`,
    );
    return;
  }
  if (role === 'meta') {
    if (ts.isArrayLiteralExpression(expression)) {
      const elementCount = compilerArrayLength(expression.elements, 'Route cache meta sources');
      for (let index = 0; index < elementCount; index += 1) {
        analyzeHandlerExpression(
          state,
          compilerOwnDataValue(expression.elements, index, 'Route cache meta sources') as TS.Node,
          'meta',
        );
      }
      return;
    }
    if (ts.isObjectLiteralExpression(expression)) {
      // A static meta object is evaluated once at module scope; it is build state, not a
      // per-request influence. Function-valued members would run per render — none are modeled,
      // so anything non-static below closes through the static-data test.
      if (!isStaticDataExpression(state, expression, compilerCreateSet<string>())) {
        appendUnclassified(state, 'route meta object is not proved build-constant');
      }
      return;
    }
  }
  appendUnclassified(state, `route ${role} handler is outside the finite document cache language`);
}

/**
 * SPEC §9.4 document surface: the app's `defineKovo({ renderRoute })` hook runs per request with
 * the rendered page value AND a context carrying the raw request, so an unproven renderRoute can
 * fold per-visitor identity into the document bytes invisibly to the per-route handlers. The
 * document proof therefore requires the route module to declare its own app configuration: a
 * same-module `defineKovo(...)` whose `renderRoute` is absent or a one-parameter function inside
 * the finite language. A route module with no visible defineKovo cannot prove the render hook of
 * whatever app later assembles it — fail closed.
 */
function analyzeAppDocumentConfiguration(state: ScanState): void {
  const defineKovoCalls: TS.CallExpression[] = [];
  const visit = (node: TS.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);
      if (ts.isIdentifier(callee)) {
        const declaration = compilerMapGet(state.moduleDeclarations, callee.text);
        if (
          declaration?.kind === 'import' &&
          declaration.importModule === '@kovojs/server' &&
          declaration.importExportName === 'defineKovo'
        ) {
          compilerArrayAppend(defineKovoCalls, node, 'Route cache defineKovo calls');
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(state.sourceFile);

  if (defineKovoCalls.length === 0) {
    appendUnclassified(
      state,
      'route module does not declare the app document configuration (defineKovo)',
    );
    return;
  }
  for (let index = 0; index < defineKovoCalls.length; index += 1) {
    const call = defineKovoCalls[index]!;
    const config = compilerOwnDataValue(call.arguments, 0, 'Route cache defineKovo arguments') as
      | TS.Expression
      | undefined;
    const configObject =
      config !== undefined && ts.isObjectLiteralExpression(unwrapExpression(config))
        ? (unwrapExpression(config) as TS.ObjectLiteralExpression)
        : undefined;
    if (configObject === undefined) {
      appendUnclassified(state, 'app definition is not a static object');
      continue;
    }
    const renderRoute = objectMemberFunction(configObject, 'renderRoute');
    if (renderRoute === undefined) {
      if (objectHasMember(configObject, 'renderRoute')) {
        appendUnclassified(state, 'app renderRoute is not a statically analyzable function');
      }
      continue;
    }
    const parameterCount = compilerArrayLength(
      (renderRoute as TS.FunctionLikeDeclaration).parameters,
      'Route cache renderRoute parameters',
    );
    if (parameterCount > 1) {
      // The second renderRoute parameter carries { params, request, route, search }.
      appendUnclassified(state, 'app renderRoute consumes the per-request render context');
      continue;
    }
    analyzeFunction(state, renderRoute, false);
  }
}

function objectHasMember(object: TS.ObjectLiteralExpression, name: string): boolean {
  const propertyCount = compilerArrayLength(object.properties, 'Route cache config properties');
  for (let index = 0; index < propertyCount; index += 1) {
    const property = compilerOwnDataValue(
      object.properties,
      index,
      'Route cache config properties',
    ) as TS.ObjectLiteralElementLike;
    const propertyName = property.name;
    if (
      propertyName !== undefined &&
      (ts.isIdentifier(propertyName) || ts.isStringLiteralLike(propertyName)) &&
      propertyName.text === name
    ) {
      return true;
    }
  }
  return false;
}

function objectMemberFunction(
  object: TS.ObjectLiteralExpression,
  name: string,
): TS.Node | undefined {
  const propertyCount = compilerArrayLength(object.properties, 'Route cache config properties');
  for (let index = 0; index < propertyCount; index += 1) {
    const property = compilerOwnDataValue(
      object.properties,
      index,
      'Route cache config properties',
    ) as TS.ObjectLiteralElementLike;
    const propertyName = property.name;
    if (
      propertyName === undefined ||
      (!ts.isIdentifier(propertyName) && !ts.isStringLiteralLike(propertyName)) ||
      propertyName.text !== name
    ) {
      continue;
    }
    if (ts.isMethodDeclaration(property)) return property;
    if (ts.isPropertyAssignment(property)) {
      const initializer = unwrapExpression(property.initializer);
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        return initializer;
      }
    }
    return undefined;
  }
  return undefined;
}

function resolveModuleFunction(declaration: ModuleDeclarationModel): TS.Node | undefined {
  if (declaration.kind === 'function') return declaration.node;
  if (declaration.kind === 'const' && declaration.initializer !== undefined) {
    const initializer = unwrapExpression(declaration.initializer);
    if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) return initializer;
  }
  return undefined;
}

interface FunctionScope {
  /** Names bound by this function's parameters and lexical declarations (safe data). */
  readonly locals: Set<string>;
  /** Aliases of the whole route context object; members are policed individually. */
  readonly contextNames: Set<string>;
}

function analyzeFunction(state: ScanState, fn: TS.Node, routeContextParameter: boolean): void {
  if (compilerSetHas(state.visitedFunctions, fn)) return;
  compilerSetAdd(state.visitedFunctions, fn);
  if (
    !ts.isArrowFunction(fn) &&
    !ts.isFunctionExpression(fn) &&
    !ts.isFunctionDeclaration(fn) &&
    !ts.isMethodDeclaration(fn)
  ) {
    appendUnclassified(state, 'route handler is not a statically analyzable function literal');
    return;
  }
  const body = fn.body;
  if (body === undefined) {
    appendUnclassified(state, 'route handler has no analyzable body');
    return;
  }
  if (functionIsAsyncOrGenerator(fn)) {
    appendUnclassified(state, 'route handler renders asynchronously at request time');
    return;
  }

  const scope: FunctionScope = {
    contextNames: compilerCreateSet<string>(),
    locals: compilerCreateSet<string>(),
  };
  const parameterCount = compilerArrayLength(fn.parameters, 'Route cache handler parameters');
  if (routeContextParameter) {
    if (parameterCount > 1) {
      // SPEC §9.4: the second route handler parameter is the (guarded) request identity. Reading
      // it can fold per-visitor headers into the document bytes; v1 closes instead of modeling
      // named header reads as Vary axes.
      appendUnclassified(state, 'route handler consumes the request identity');
    }
    if (parameterCount >= 1) {
      bindContextParameter(
        state,
        scope,
        compilerOwnDataValue(fn.parameters, 0, 'Route cache handler parameters') as
          | TS.ParameterDeclaration
          | undefined,
      );
    }
  } else {
    // Helper/component functions receive only values produced inside the finite language, so
    // every parameter is safe data.
    for (let index = 0; index < parameterCount; index += 1) {
      const parameter = compilerOwnDataValue(
        fn.parameters,
        index,
        'Route cache handler parameters',
      ) as TS.ParameterDeclaration;
      collectBindingNames(parameter.name, scope.locals);
      if (parameter.initializer !== undefined) analyzeBody(state, scope, parameter.initializer);
    }
  }

  collectLexicalBindings(body, scope.locals);
  collectContextAliases(state, body, scope);
  analyzeBody(state, scope, body);
}

function functionIsAsyncOrGenerator(fn: TS.Node): boolean {
  const functionLike = fn as TS.FunctionLikeDeclaration;
  if (functionLike.asteriskToken !== undefined) return true;
  const modifiers = ts.canHaveModifiers(fn) ? ts.getModifiers(fn) : undefined;
  if (modifiers === undefined) return false;
  const modifierCount = compilerArrayLength(modifiers, 'Route cache handler modifiers');
  for (let index = 0; index < modifierCount; index += 1) {
    const modifier = compilerOwnDataValue(
      modifiers,
      index,
      'Route cache handler modifiers',
    ) as TS.Modifier;
    if (modifier.kind === ts.SyntaxKind.AsyncKeyword) return true;
  }
  return false;
}

function bindContextParameter(
  state: ScanState,
  scope: FunctionScope,
  parameter: TS.ParameterDeclaration | undefined,
): void {
  if (parameter === undefined) return;
  const name = parameter.name;
  if (ts.isIdentifier(name)) {
    compilerSetAdd(scope.contextNames, name.text);
    return;
  }
  if (!ts.isObjectBindingPattern(name)) {
    appendUnclassified(state, 'route context binding is outside the finite document cache language');
    return;
  }
  const elementCount = compilerArrayLength(name.elements, 'Route cache context bindings');
  for (let index = 0; index < elementCount; index += 1) {
    const element = compilerOwnDataValue(
      name.elements,
      index,
      'Route cache context bindings',
    ) as TS.BindingElement;
    if (element.dotDotDotToken !== undefined) {
      collectBindingNames(element.name, scope.contextNames);
      continue;
    }
    const property =
      element.propertyName !== undefined
        ? bindingPropertyName(element.propertyName)
        : ts.isIdentifier(element.name)
          ? element.name.text
          : undefined;
    if (property === undefined) {
      appendUnclassified(state, 'computed route context member');
      continue;
    }
    if (property === 'signUrl') {
      state.secret = true;
      continue;
    }
    if (isSafeContextMember(property)) {
      collectBindingNames(element.name, scope.locals);
      continue;
    }
    appendUnclassified(state, `route context member '${property}'`);
  }
}

function bindingPropertyName(name: TS.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return undefined;
}

function isSafeContextMember(name: string): boolean {
  for (let index = 0; index < SAFE_CONTEXT_MEMBERS.length; index += 1) {
    if (SAFE_CONTEXT_MEMBERS[index] === name) return true;
  }
  return false;
}

function collectBindingNames(name: TS.BindingName, target: Set<string>): void {
  if (ts.isIdentifier(name)) {
    compilerSetAdd(target, name.text);
    return;
  }
  const elements = name.elements;
  const elementCount = compilerArrayLength(elements, 'Route cache binding elements');
  for (let index = 0; index < elementCount; index += 1) {
    const element = compilerOwnDataValue(
      elements,
      index,
      'Route cache binding elements',
    ) as TS.ArrayBindingElement;
    if (ts.isBindingElement(element)) collectBindingNames(element.name, target);
  }
}

/**
 * Collect every name lexically bound anywhere inside the handler (nested functions, callbacks,
 * catch clauses, for-of bindings). Shadowing is resolved conservatively in the safe direction:
 * a name is only treated as a context carrier when it is a context alias AND never rebound
 * locally — a rebound name stays policed as a carrier, which can only over-close, never widen.
 */
function collectLexicalBindings(root: TS.Node, target: Set<string>): void {
  const visit = (node: TS.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      collectBindingNames(node.name, target);
    } else if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) &&
      node !== root
    ) {
      const parameterCount = compilerArrayLength(node.parameters, 'Route cache nested parameters');
      for (let index = 0; index < parameterCount; index += 1) {
        const parameter = compilerOwnDataValue(
          node.parameters,
          index,
          'Route cache nested parameters',
        ) as TS.ParameterDeclaration;
        collectBindingNames(parameter.name, target);
      }
      if (node.name !== undefined && ts.isIdentifier(node.name)) {
        compilerSetAdd(target, node.name.text);
      }
    } else if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
      collectBindingNames(node.variableDeclaration.name, target);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
}

/** One-pass fixpoint: `const alias = ctx` re-registers the alias as a context carrier. */
function collectContextAliases(state: ScanState, body: TS.Node, scope: FunctionScope): void {
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: TS.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer !== undefined &&
        ts.isIdentifier(node.name)
      ) {
        const initializer = unwrapExpression(node.initializer);
        if (
          ts.isIdentifier(initializer) &&
          compilerSetHas(scope.contextNames, initializer.text) &&
          !compilerSetHas(scope.contextNames, node.name.text)
        ) {
          compilerSetAdd(scope.contextNames, node.name.text);
          changed = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
  }
}

function analyzeBody(state: ScanState, scope: FunctionScope, body: TS.Node): void {
  const visit = (node: TS.Node): void => {
    if (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.SuperKeyword) {
      appendUnclassified(state, 'route handler uses this/super');
      return;
    }
    if (ts.isAwaitExpression(node)) {
      appendUnclassified(state, 'route handler awaits at render time');
    }
    if (ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node)) {
      appendUnclassified(state, 'construction outside the finite document cache language');
    }
    if (ts.isJsxSpreadAttribute(node)) {
      appendUnclassified(state, 'JSX spread outside the finite document cache language');
    }
    if (
      ts.isJsxElement(node) ||
      ts.isJsxSelfClosingElement(node)
    ) {
      const tagName = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
      analyzeJsxTag(state, tagName);
    }
    if (ts.isCallExpression(node)) {
      analyzeCall(state, scope, node);
    }
    if (ts.isIdentifier(node) && isValueReference(node)) {
      analyzeIdentifierReference(state, scope, node);
    }
    if (ts.isElementAccessExpression(node)) {
      const receiver = unwrapExpression(node.expression);
      if (ts.isIdentifier(receiver) && isContextCarrier(scope, receiver.text)) {
        appendUnclassified(state, 'computed route context member');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

function isContextCarrier(scope: FunctionScope, name: string): boolean {
  // Shadowing resolves toward policing: a name that is both locally bound and a context alias is
  // still treated as a carrier (over-closing is safe; widening is not).
  return compilerSetHas(scope.contextNames, name);
}

function analyzeJsxTag(state: ScanState, tagName: TS.JsxTagNameExpression): void {
  if (!ts.isIdentifier(tagName)) {
    appendUnclassified(state, 'JSX member tag outside the finite document cache language');
    return;
  }
  const text = tagName.text;
  if (!compilerRegExpTest(/^[A-Z]/u, text)) return; // intrinsic element
  const declaration = compilerMapGet(state.moduleDeclarations, text);
  const fn = declaration === undefined ? undefined : resolveModuleFunction(declaration);
  if (fn !== undefined) {
    analyzeFunction(state, fn, false);
    return;
  }
  if (declaration?.kind === 'import') {
    appendUnclassified(
      state,
      `imported component '${text}' is outside the finite document cache language`,
    );
    return;
  }
  appendUnclassified(state, `component '${text}' does not resolve to a module function literal`);
}

function analyzeCall(state: ScanState, scope: FunctionScope, node: TS.CallExpression): void {
  const callee = unwrapExpression(node.expression);
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    appendUnclassified(state, 'dynamic import at render time');
    return;
  }
  if (ts.isIdentifier(callee)) {
    if (isContextCarrier(scope, callee.text)) {
      appendUnclassified(state, 'route context authority leaves the finite document cache language');
      return;
    }
    if (compilerSetHas(scope.locals, callee.text)) return;
    const declaration = compilerMapGet(state.moduleDeclarations, callee.text);
    if (declaration !== undefined) {
      const fn = resolveModuleFunction(declaration);
      if (fn !== undefined) {
        analyzeFunction(state, fn, false);
        return;
      }
      if (declaration.kind === 'import' && isPureFrameworkCallee(declaration)) return;
      // Falls through to the identifier-reference rules, which close on imports/mutables and
      // admit static const data (a call on data still closes below).
      appendUnclassified(state, `call target '${callee.text}' is not a module function literal`);
      return;
    }
    if (isPureGlobalCallee(callee.text)) return;
    appendUnclassified(state, `call outside the finite document cache language ('${callee.text}')`);
    return;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    const receiver = unwrapExpression(callee.expression);
    if (ts.isIdentifier(receiver) && isContextCarrier(scope, receiver.text)) {
      // `ctx.signUrl(...)`/`ctx.<member>(...)` — member policing happens in the identifier pass;
      // signUrl marks secret there. A safe-member call like `ctx.params.slug` never lands here
      // because the receiver of the call is then a property access, handled below.
      return;
    }
    if (isPureMethodName(callee.name.text)) return;
    appendUnclassified(
      state,
      `method call '${callee.name.text}' outside the finite document cache language`,
    );
    return;
  }
  appendUnclassified(state, 'call outside the finite document cache language');
}

function isPureGlobalCallee(name: string): boolean {
  for (let index = 0; index < PURE_GLOBAL_CALLEES.length; index += 1) {
    if (PURE_GLOBAL_CALLEES[index] === name) return true;
  }
  return false;
}

function isPureFrameworkCallee(declaration: ModuleDeclarationModel): boolean {
  if (declaration.importModule === undefined || declaration.importExportName === undefined) {
    return false;
  }
  for (let index = 0; index < PURE_FRAMEWORK_CALLEES.length; index += 1) {
    const candidate = PURE_FRAMEWORK_CALLEES[index]!;
    if (
      candidate.module === declaration.importModule &&
      candidate.exportName === declaration.importExportName
    ) {
      return true;
    }
  }
  return false;
}

function isPureMethodName(name: string): boolean {
  for (let index = 0; index < PURE_METHOD_NAMES.length; index += 1) {
    if (PURE_METHOD_NAMES[index] === name) return true;
  }
  return false;
}

/** True when the identifier is a value reference (not a declaration name, label, or member name). */
function isValueReference(node: TS.Identifier): boolean {
  const parent = node.parent;
  if (parent === undefined) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isBindingElement(parent) ||
      ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent)) &&
    (parent as { name?: TS.Node }).name === node
  ) {
    return false;
  }
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) return true;
  if ((ts.isJsxAttribute(parent) as boolean) && (parent as TS.JsxAttribute).name === node) {
    return false;
  }
  if (
    (ts.isJsxOpeningElement(parent) ||
      ts.isJsxSelfClosingElement(parent) ||
      ts.isJsxClosingElement(parent)) &&
    parent.tagName === node
  ) {
    return false; // JSX tags are analyzed by analyzeJsxTag
  }
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) {
    return false;
  }
  if (ts.isTypeNode(parent) || ts.isTypeReferenceNode(parent as TS.Node)) return false;
  if (ts.isQualifiedName(parent)) return false;
  if (ts.isBreakOrContinueStatement(parent) && parent.label === node) return false;
  if (ts.isLabeledStatement(parent) && parent.label === node) return false;
  return true;
}

function analyzeIdentifierReference(
  state: ScanState,
  scope: FunctionScope,
  node: TS.Identifier,
): void {
  const text = node.text;
  if (text === 'process' || text === 'Deno' || text === 'Bun') {
    // Ambient runtime environment bags are secret-bearing state even before `.env` is read.
    state.secret = true;
    return;
  }
  if (isContextCarrier(scope, text)) {
    analyzeContextCarrierUse(state, node);
    return;
  }
  if (compilerSetHas(scope.locals, text)) return;
  if (isInertFreeIdentifier(text)) return;
  const declaration = compilerMapGet(state.moduleDeclarations, text);
  if (declaration !== undefined) {
    if (declaration.kind === 'function') {
      analyzeFunction(state, resolveModuleFunction(declaration)!, false);
      return;
    }
    if (declaration.kind === 'const') {
      const fn = resolveModuleFunction(declaration);
      if (fn !== undefined) {
        analyzeFunction(state, fn, false);
        return;
      }
      if (
        declaration.initializer !== undefined &&
        isStaticDataExpression(state, declaration.initializer, compilerCreateSet<string>())
      ) {
        return;
      }
      appendUnclassified(state, `module value '${text}' is not proved build-constant`);
      return;
    }
    if (declaration.kind === 'import') {
      if (
        isPureFrameworkCallee(declaration) &&
        ts.isCallExpression(node.parent) &&
        node.parent.expression === node
      ) {
        return;
      }
      appendUnclassified(
        state,
        `imported module value '${text}' is outside the finite document cache language`,
      );
      return;
    }
    if (declaration.kind === 'mutable') {
      appendUnclassified(state, `module value '${text}' is mutable`);
      return;
    }
    appendUnclassified(state, `module value '${text}' is outside the finite document cache language`);
    return;
  }
  if (isPureGlobalCallee(text) && ts.isCallExpression(node.parent) && node.parent.expression === node) {
    return;
  }
  appendUnclassified(state, `free identifier '${text}' is outside the finite document cache language`);
}

function isInertFreeIdentifier(text: string): boolean {
  for (let index = 0; index < INERT_FREE_IDENTIFIERS.length; index += 1) {
    if (INERT_FREE_IDENTIFIERS[index] === text) return true;
  }
  return false;
}

/** Context carriers may only be dereferenced through the safe member set or aliased wholesale. */
function analyzeContextCarrierUse(state: ScanState, node: TS.Identifier): void {
  let use: TS.Node = node;
  let parent = node.parent;
  while (
    parent !== undefined &&
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent)) &&
    parent.expression === use
  ) {
    use = parent;
    parent = parent.parent;
  }
  if (parent === undefined) {
    appendUnclassified(state, 'route context authority leaves the finite document cache language');
    return;
  }
  if (ts.isPropertyAccessExpression(parent) && parent.expression === use) {
    const member = parent.name.text;
    if (member === 'signUrl') {
      state.secret = true;
      return;
    }
    if (isSafeContextMember(member)) return;
    appendUnclassified(state, `route context member '${member}'`);
    return;
  }
  if (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === use &&
    ts.isIdentifier(parent.name)
  ) {
    return; // alias registered by collectContextAliases
  }
  appendUnclassified(state, 'route context authority leaves the finite document cache language');
}

/**
 * True when the expression is a build-constant data literal tree: literals, template strings whose
 * substitutions are static, array/object literals of static entries, references to other static
 * module consts, and property access on static data. Calls, `new`, functions-as-data, spreads of
 * non-static values, and anything else fail the test.
 */
function isStaticDataExpression(
  state: ScanState,
  expression: TS.Expression,
  visiting: ReadonlySet<string>,
): boolean {
  const memo = compilerMapGet(state.staticConstMemo, expression);
  if (memo !== undefined) return memo;
  const result = staticDataExpressionUncached(state, expression, visiting);
  compilerMapSet(state.staticConstMemo, expression, result);
  return result;
}

function staticDataExpressionUncached(
  state: ScanState,
  expression: TS.Expression,
  visiting: ReadonlySet<string>,
): boolean {
  const value = unwrapExpression(expression);
  if (
    ts.isStringLiteralLike(value) ||
    ts.isNumericLiteral(value) ||
    value.kind === ts.SyntaxKind.TrueKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword ||
    value.kind === ts.SyntaxKind.NullKeyword
  ) {
    return true;
  }
  if (ts.isPrefixUnaryExpression(value)) {
    return (
      (value.operator === ts.SyntaxKind.MinusToken ||
        value.operator === ts.SyntaxKind.PlusToken) &&
      staticDataExpressionUncached(state, value.operand as TS.Expression, visiting)
    );
  }
  if (ts.isTemplateExpression(value)) {
    const spanCount = compilerArrayLength(value.templateSpans, 'Route cache template spans');
    for (let index = 0; index < spanCount; index += 1) {
      const span = compilerOwnDataValue(
        value.templateSpans,
        index,
        'Route cache template spans',
      ) as TS.TemplateSpan;
      if (!isStaticDataExpression(state, span.expression, visiting)) return false;
    }
    return true;
  }
  if (ts.isArrayLiteralExpression(value)) {
    const elementCount = compilerArrayLength(value.elements, 'Route cache array elements');
    for (let index = 0; index < elementCount; index += 1) {
      const element = compilerOwnDataValue(
        value.elements,
        index,
        'Route cache array elements',
      ) as TS.Expression;
      if (ts.isSpreadElement(element)) {
        if (!isStaticDataExpression(state, element.expression, visiting)) return false;
        continue;
      }
      if (ts.isOmittedExpression(element)) continue;
      if (!isStaticDataExpression(state, element, visiting)) return false;
    }
    return true;
  }
  if (ts.isObjectLiteralExpression(value)) {
    const propertyCount = compilerArrayLength(value.properties, 'Route cache object properties');
    for (let index = 0; index < propertyCount; index += 1) {
      const property = compilerOwnDataValue(
        value.properties,
        index,
        'Route cache object properties',
      ) as TS.ObjectLiteralElementLike;
      if (ts.isPropertyAssignment(property)) {
        if (property.name !== undefined && ts.isComputedPropertyName(property.name)) return false;
        if (!isStaticDataExpression(state, property.initializer, visiting)) return false;
        continue;
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        if (!staticConstReference(state, property.name.text, visiting)) return false;
        continue;
      }
      return false;
    }
    return true;
  }
  if (ts.isIdentifier(value)) {
    return staticConstReference(state, value.text, visiting);
  }
  if (ts.isPropertyAccessExpression(value)) {
    return staticDataExpressionUncached(state, value.expression, visiting);
  }
  if (ts.isBinaryExpression(value)) {
    return (
      staticDataExpressionUncached(state, value.left, visiting) &&
      staticDataExpressionUncached(state, value.right, visiting)
    );
  }
  if (ts.isConditionalExpression(value)) {
    return (
      staticDataExpressionUncached(state, value.condition, visiting) &&
      staticDataExpressionUncached(state, value.whenTrue, visiting) &&
      staticDataExpressionUncached(state, value.whenFalse, visiting)
    );
  }
  return false;
}

function staticConstReference(
  state: ScanState,
  name: string,
  visiting: ReadonlySet<string>,
): boolean {
  if (compilerSetHas(visiting, name)) return false;
  const declaration = compilerMapGet(state.moduleDeclarations, name);
  if (declaration === undefined || declaration.kind !== 'const') return false;
  if (declaration.initializer === undefined) return false;
  const nextVisiting = compilerCreateSet<string>();
  compilerSetForEach(visiting, (entry) => {
    compilerSetAdd(nextVisiting, entry);
  });
  compilerSetAdd(nextVisiting, name);
  return isStaticDataExpression(state, declaration.initializer, nextVisiting);
}
