import path from 'node:path';

import ts from 'typescript';

export type BetterAuthCredentialCensusSource =
  | 'better-auth.callable'
  | 'better-auth.constructor'
  | 'cookie.snapshot'
  | 'password.hash'
  | 'password.verify'
  | 'rate-limit.constructor'
  | 'session.reconstruction';

export interface BetterAuthCredentialSourceFile {
  file: string;
  source: string;
}

export interface BetterAuthCredentialSourceInvocation {
  consumers: readonly string[];
  file: string;
  line: number;
  source: BetterAuthCredentialCensusSource;
}

export interface BetterAuthCredentialSourceCensus {
  invocations: readonly BetterAuthCredentialSourceInvocation[];
  issues: readonly string[];
}

type Provenance =
  | `module:${string}`
  | `raw:${BetterAuthCredentialCensusSource}`
  | 'auth-api'
  | 'auth-instance'
  | 'captured-callable'
  | 'capture-api'
  | 'capture-method'
  | 'freeze-own'
  | 'gate-apply'
  | 'gate-source-callable'
  | 'gate-run'
  | 'reflect'
  | 'reflect-apply'
  | 'token-registry'
  | `token:${string}`;

const virtualRoot = '/__kovo_better_auth_credential_census__';

/**
 * Test-only structural/symbol census for the package-private Better Auth credential door.
 *
 * SPEC §6.6/§10.3 C9-C10: raw dependency consumers are discovered from import/local symbol
 * identity and value flow, including aliases, destructuring, literal computed access, `.call`,
 * `Reflect.apply`, callback aliases, and local re-exports. External raw authority is admitted only
 * through the exact-source runtime door; the sole generic callback is package-owned session
 * reconstruction.
 */
export function censusBetterAuthCredentialSources(
  sources: readonly BetterAuthCredentialSourceFile[],
): BetterAuthCredentialSourceCensus {
  const virtualFiles = new Map<string, string>();
  for (const source of sources) {
    virtualFiles.set(virtualFileName(source.file), source.source);
  }

  const options: ts.CompilerOptions = {
    allowJs: false,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
  };
  const host = ts.createCompilerHost(options, true);
  const nativeFileExists = host.fileExists.bind(host);
  const nativeReadFile = host.readFile.bind(host);
  const nativeGetSourceFile = host.getSourceFile.bind(host);
  host.getCurrentDirectory = () => virtualRoot;
  host.fileExists = (fileName) =>
    virtualFiles.has(normalize(fileName)) || nativeFileExists(fileName);
  host.readFile = (fileName) => virtualFiles.get(normalize(fileName)) ?? nativeReadFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = virtualFiles.get(normalize(fileName));
    return source === undefined
      ? nativeGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(fileName, source, languageVersion, true, ts.ScriptKind.TS);
  };
  host.resolveModuleNames = (moduleNames, containingFile) =>
    moduleNames.map((moduleName) => {
      if (moduleName.startsWith('.')) {
        const requested = normalize(
          path.posix.resolve(path.posix.dirname(containingFile), moduleName),
        );
        const candidates = [
          requested,
          requested.replace(/\.js$/u, '.ts'),
          `${requested}.ts`,
          normalize(path.posix.join(requested, 'index.ts')),
        ];
        for (const candidate of candidates) {
          if (virtualFiles.has(candidate)) {
            return {
              extension: ts.Extension.Ts,
              isExternalLibraryImport: false,
              resolvedFileName: candidate,
            };
          }
        }
      }
      return ts.resolveModuleName(moduleName, containingFile, options, host).resolvedModule;
    });

  const program = ts.createProgram({
    host,
    options,
    rootNames: [...virtualFiles.keys()],
  });
  const checker = program.getTypeChecker();
  const sourceFiles = [...virtualFiles.keys()]
    .map((file) => program.getSourceFile(file))
    .filter((file): file is ts.SourceFile => file !== undefined);
  const calls: ts.CallExpression[] = [];
  for (const sourceFile of sourceFiles) {
    walk(sourceFile, (node) => {
      if (ts.isCallExpression(node)) calls.push(node);
    });
  }

  const symbolStack = new Set<ts.Symbol>();
  const expressionStack = new Set<ts.Node>();
  const functionCallCache = new Map<ts.CallExpression, readonly ts.FunctionLikeDeclaration[]>();

  function localFunctionNodesForCall(
    call: ts.CallExpression,
  ): readonly ts.FunctionLikeDeclaration[] {
    const cached = functionCallCache.get(call);
    if (cached !== undefined) return cached;
    const result = localFunctionNodes(call.expression);
    functionCallCache.set(call, result);
    return result;
  }

  function localFunctionNodes(expression: ts.Expression): readonly ts.FunctionLikeDeclaration[] {
    const node = unwrap(expression);
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return [node];
    if (!ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node)) return [];
    const symbol = checker.getSymbolAtLocation(node);
    if (symbol === undefined) return [];
    return functionNodesForSymbol(symbol);
  }

  function functionNodesForSymbol(symbol: ts.Symbol): readonly ts.FunctionLikeDeclaration[] {
    const declarations = symbol.declarations ?? [];
    const result: ts.FunctionLikeDeclaration[] = [];
    for (const declaration of declarations) {
      if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) {
        result.push(declaration);
      } else if (
        (ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration)) &&
        declaration.initializer !== undefined &&
        (ts.isArrowFunction(unwrap(declaration.initializer)) ||
          ts.isFunctionExpression(unwrap(declaration.initializer)))
      ) {
        result.push(unwrap(declaration.initializer) as ts.FunctionExpression | ts.ArrowFunction);
      } else if (ts.isImportSpecifier(declaration) || ts.isExportSpecifier(declaration)) {
        const target = resolveAliasedSymbol(checker, symbol);
        if (target !== symbol) result.push(...functionNodesForSymbol(target));
      }
    }
    return uniqueNodes(result);
  }

  function expressionProvenance(expression: ts.Expression): Set<Provenance> {
    const node = unwrap(expression);
    if (expressionStack.has(node)) return new Set();
    expressionStack.add(node);
    try {
      if (ts.isIdentifier(node)) {
        if (node.text === 'Reflect') {
          return new Set(['reflect']);
        }
        const symbol = checker.getSymbolAtLocation(node);
        return symbol === undefined ? new Set() : symbolProvenance(symbol);
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const key = staticPropertyName(node);
        const base = propertyBase(node);
        return propertyProvenance(base, key);
      }
      if (ts.isCallExpression(node)) {
        const callee = expressionProvenance(node.expression);
        const result = new Set<Provenance>();
        if (callee.has('raw:better-auth.constructor')) result.add('auth-instance');
        if (callee.has('capture-api')) result.add('captured-callable');
        if (callee.has('capture-method') && staticString(node.arguments[1]) === 'handler') {
          result.add('captured-callable');
        }
        if (hasRaw(callee) && isBindCall(node.expression)) addRaw(result, callee);
        if (callee.has('freeze-own') && node.arguments[0] !== undefined) {
          addAll(result, expressionProvenance(node.arguments[0]));
        }
        for (const fn of localFunctionNodesForCall(node)) {
          for (const returned of functionReturnExpressions(fn)) {
            addAll(result, expressionProvenance(returned));
          }
        }
        return result;
      }
      if (ts.isConditionalExpression(node)) {
        return union(expressionProvenance(node.whenTrue), expressionProvenance(node.whenFalse));
      }
      if (ts.isBinaryExpression(node)) {
        return union(expressionProvenance(node.left), expressionProvenance(node.right));
      }
      if (ts.isObjectLiteralExpression(node)) return new Set();
      return new Set();
    } finally {
      expressionStack.delete(node);
    }
  }

  function symbolProvenance(symbol: ts.Symbol): Set<Provenance> {
    if (symbolStack.has(symbol)) return new Set();
    symbolStack.add(symbol);
    try {
      const result = new Set<Provenance>();
      for (const declaration of symbol.declarations ?? []) {
        if (ts.isImportSpecifier(declaration)) {
          const moduleName = importModuleName(declaration);
          const imported = (declaration.propertyName ?? declaration.name).text;
          addSeed(result, moduleName, imported);
          if (result.size === 0) {
            const target = resolveAliasedSymbol(checker, symbol);
            if (target !== symbol) addAll(result, symbolProvenance(target));
          }
        } else if (ts.isNamespaceImport(declaration)) {
          result.add(`module:${importModuleName(declaration)}`);
        } else if (ts.isImportClause(declaration) && declaration.name === declaration.name) {
          addSeed(result, importModuleName(declaration), 'default');
        } else if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
          addAll(result, expressionProvenance(declaration.initializer));
        } else if (ts.isBindingElement(declaration)) {
          const key = bindingPropertyName(declaration);
          const root = bindingRootInitializer(declaration);
          if (root !== undefined) addAll(result, propertyProvenance(root, key));
        } else if (ts.isParameter(declaration)) {
          addAll(result, parameterProvenance(declaration));
        } else if (ts.isFunctionDeclaration(declaration) && declaration.name !== undefined) {
          addLocalSourceSeed(result, declaration.name.text);
        } else if (ts.isExportSpecifier(declaration)) {
          const target = resolveAliasedSymbol(checker, symbol);
          if (target !== symbol) addAll(result, symbolProvenance(target));
        }
      }
      return result;
    } finally {
      symbolStack.delete(symbol);
    }
  }

  function parameterProvenance(parameter: ts.ParameterDeclaration): Set<Provenance> {
    const fn = parameter.parent;
    if (!isRuntimeFunctionLike(fn)) return new Set();
    const index = fn.parameters.indexOf(parameter);
    if (index < 0) return new Set();
    const result = new Set<Provenance>();
    for (const call of calls) {
      if (!localFunctionNodesForCall(call).includes(fn)) continue;
      const argument = call.arguments[index];
      if (argument !== undefined) addAll(result, expressionProvenance(argument));
    }
    return result;
  }

  function propertyProvenance(
    baseExpression: ts.Expression,
    key: string | undefined,
  ): Set<Provenance> {
    const base = unwrap(baseExpression);
    const structural = structuralPropertyProvenance(base, key);
    const facts = expressionProvenance(base);
    const result = new Set<Provenance>(structural);
    for (const fact of facts) {
      if (fact.startsWith('module:') && key !== undefined) {
        addSeed(result, fact.slice('module:'.length), key);
      } else if (fact === 'token-registry') {
        result.add(`token:${key ?? '<computed>'}`);
      } else if (fact === 'auth-instance' && key === 'api') {
        result.add('auth-api');
      } else if (fact === 'auth-instance' && key === 'handler') {
        result.add('raw:better-auth.callable');
      } else if (fact === 'auth-api') {
        result.add('raw:better-auth.callable');
      } else if (fact === 'captured-callable' && key === 'method') {
        result.add('raw:better-auth.callable');
      } else if (fact === 'reflect' && key === 'apply') {
        result.add('reflect-apply');
      } else if (fact.startsWith('raw:') && (key === 'call' || key === 'apply' || key === 'bind')) {
        result.add(fact);
      }
    }

    // Within this package an `.api` carrier and a `.handler` callable are credential authority.
    // This conservative fallback makes a future differently-typed Better Auth alias fail closed.
    if (key === 'api') result.add('auth-api');
    if (key === 'handler') result.add('raw:better-auth.callable');
    if (key === 'method' && isPinnedBetterAuthCredentialMethod(base)) {
      result.add('raw:better-auth.callable');
    }
    return result;
  }

  function isPinnedBetterAuthCredentialMethod(expression: ts.Expression): boolean {
    const property = checker.getPropertyOfType(checker.getTypeAtLocation(expression), 'method');
    return (property?.declarations ?? []).some(
      (declaration) =>
        ts.isPropertySignature(declaration) &&
        ts.isInterfaceDeclaration(declaration.parent) &&
        declaration.parent.name.text === 'PinnedBetterAuthApiCallable' &&
        displayFile(declaration.getSourceFile().fileName) === 'internal/trusted-plaintext.ts',
    );
  }

  function structuralPropertyProvenance(
    expression: ts.Expression,
    key: string | undefined,
  ): Set<Provenance> {
    if (key === undefined) return new Set();
    const node = unwrap(expression);
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol === undefined || symbolStack.has(symbol)) return new Set();
      const result = new Set<Provenance>();
      symbolStack.add(symbol);
      try {
        for (const declaration of symbol.declarations ?? []) {
          if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
            addAll(result, structuralPropertyProvenance(declaration.initializer, key));
          } else if (ts.isParameter(declaration)) {
            const fn = declaration.parent;
            if (!isRuntimeFunctionLike(fn)) continue;
            const index = fn.parameters.indexOf(declaration);
            if (index >= 0) {
              for (const call of calls) {
                if (!localFunctionNodesForCall(call).includes(fn)) continue;
                const argument = call.arguments[index];
                if (argument !== undefined) {
                  addAll(result, propertyProvenance(argument, key));
                }
              }
            }
          }
        }
      } finally {
        symbolStack.delete(symbol);
      }
      return result;
    }
    if (ts.isObjectLiteralExpression(node)) {
      const result = new Set<Provenance>();
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property) && propertyName(property.name) === key) {
          addAll(result, expressionProvenance(property.initializer));
        } else if (ts.isShorthandPropertyAssignment(property) && property.name.text === key) {
          addAll(result, expressionProvenance(property.name));
        } else if (ts.isSpreadAssignment(property)) {
          addAll(result, propertyProvenance(property.expression, key));
        }
      }
      return result;
    }
    if (ts.isCallExpression(node)) {
      const result = new Set<Provenance>();
      const callee = expressionProvenance(node.expression);
      if (callee.has('freeze-own') && node.arguments[0] !== undefined) {
        addAll(result, propertyProvenance(node.arguments[0], key));
      }
      for (const fn of localFunctionNodesForCall(node)) {
        for (const returned of functionReturnExpressions(fn)) {
          addAll(result, propertyProvenance(returned, key));
        }
      }
      const callFacts = expressionProvenance(node);
      if (callFacts.has('captured-callable') && key === 'method') {
        result.add('raw:better-auth.callable');
      }
      return result;
    }
    if (ts.isConditionalExpression(node)) {
      return union(propertyProvenance(node.whenTrue, key), propertyProvenance(node.whenFalse, key));
    }
    return new Set();
  }

  const gateCallbacks = new Map<ts.FunctionLikeDeclaration, Set<string>>();
  for (const call of calls) {
    if (!expressionProvenance(call.expression).has('gate-run')) continue;
    const consumer = call.arguments[0];
    const callback = call.arguments[1];
    if (consumer === undefined || callback === undefined) continue;
    const tokens = consumerTokens(expressionProvenance(consumer));
    for (const fn of localFunctionNodes(callback)) {
      const existing = gateCallbacks.get(fn) ?? new Set<string>();
      for (const token of tokens) existing.add(token);
      gateCallbacks.set(fn, existing);
    }
  }

  const invocations: BetterAuthCredentialSourceInvocation[] = [];
  const issues: string[] = [];
  for (const call of calls) {
    const calleeFacts = expressionProvenance(call.expression);
    const sourceFile = call.getSourceFile();
    const file = displayFile(sourceFile.fileName);
    const line = sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile)).line + 1;
    const declaredSource = calleeFacts.has('gate-source-callable')
      ? credentialSource(call.arguments[1])
      : undefined;
    if (calleeFacts.has('gate-source-callable') && declaredSource === undefined) {
      issues.push(
        `KV439: exact Better Auth credential source in ${file}:${line} is not statically resolved`,
      );
      continue;
    }
    if (declaredSource !== undefined) {
      const method = call.arguments[2];
      const methodSources =
        method === undefined
          ? new Set<BetterAuthCredentialCensusSource>()
          : rawSources(expressionProvenance(method));
      if (methodSources.size === 0 || !methodSources.has(declaredSource)) {
        issues.push(
          `KV439: Better Auth credential source ${declaredSource} in ${file}:${line} is not backed by the reviewed raw callable symbol`,
        );
        continue;
      }
    }
    const invokedSources = invokedRawSources(call, declaredSource);
    if (invokedSources.size === 0) continue;
    if (isCredentialSourceDoorImplementation(call, calleeFacts)) continue;
    const callback = nearestFunction(call);
    const consumers = calleeFacts.has('gate-source-callable')
      ? consumerTokens(
          call.arguments[0] === undefined
            ? new Set<Provenance>()
            : expressionProvenance(call.arguments[0]),
        )
      : callback === undefined
        ? undefined
        : gateCallbacks.get(callback);
    if (consumers === undefined || consumers.size === 0 || consumers.has('<computed>')) {
      for (const rawSource of invokedSources) {
        issues.push(
          `KV439: raw Better Auth credential source ${rawSource} in ${file}:${line} is not owned by an exact runtime consumer callback`,
        );
      }
      continue;
    }
    for (const rawSource of invokedSources) {
      invocations.push({
        consumers: [...consumers].sort(),
        file,
        line,
        source: rawSource,
      });
    }
  }

  invocations.sort((left, right) =>
    `${left.file}:${left.line}:${left.source}:${left.consumers.join(',')}`.localeCompare(
      `${right.file}:${right.line}:${right.source}:${right.consumers.join(',')}`,
    ),
  );
  issues.sort();
  return { invocations, issues };

  function invokedRawSources(
    call: ts.CallExpression,
    declaredSource: BetterAuthCredentialCensusSource | undefined,
  ): Set<BetterAuthCredentialCensusSource> {
    const callee = expressionProvenance(call.expression);
    const result = rawSources(callee);
    if (callee.has('gate-source-callable') && declaredSource !== undefined) {
      result.add(declaredSource);
    }
    if (callee.has('gate-apply') || callee.has('reflect-apply')) {
      const target = call.arguments[0];
      if (target !== undefined) {
        addAll(result, rawSources(expressionProvenance(target)));
      }
    }
    return result;
  }

  function isCredentialSourceDoorImplementation(
    call: ts.CallExpression,
    callee: ReadonlySet<Provenance>,
  ): boolean {
    if (
      displayFile(call.getSourceFile().fileName) !== 'internal/credential-runtime-gate.ts' ||
      !callee.has('gate-apply')
    ) {
      return false;
    }
    const fn = nearestFunction(call);
    if (
      fn === undefined ||
      !ts.isFunctionDeclaration(fn) ||
      (fn.name?.text !== 'runBetterAuthCredentialSourceCallable' &&
        fn.name?.text !== 'runBetterAuthCredentialSourceCallableAsync') ||
      fn.parameters.length < 5
    ) {
      return false;
    }
    const method = call.arguments[0];
    const receiver = call.arguments[1];
    return (
      method !== undefined &&
      receiver !== undefined &&
      sameSymbol(method, fn.parameters[2]!.name) &&
      sameSymbol(receiver, fn.parameters[3]!.name)
    );
  }

  function sameSymbol(expression: ts.Expression, name: ts.BindingName): boolean {
    if (!ts.isIdentifier(unwrap(expression)) || !ts.isIdentifier(name)) return false;
    return checker.getSymbolAtLocation(unwrap(expression)) === checker.getSymbolAtLocation(name);
  }
}

function addSeed(result: Set<Provenance>, moduleName: string, imported: string): void {
  const normalized = moduleName.replace(/\\/g, '/');
  if (normalized === 'better-auth' && imported === 'betterAuth') {
    result.add('raw:better-auth.constructor');
  } else if (normalized === '@kovojs/server' && imported === 'hashPassword') {
    result.add('raw:password.hash');
  } else if (normalized === '@kovojs/server' && imported === 'verifyPassword') {
    result.add('raw:password.verify');
  } else if (
    normalized.endsWith('/postgres-rate-limit-storage.js') &&
    imported === 'createBetterAuthPostgresRateLimitStorage'
  ) {
    result.add('raw:rate-limit.constructor');
  } else if (
    normalized.endsWith('/sqlite-rate-limit-storage.js') &&
    imported === 'createBetterAuthSqliteRateLimitStorage'
  ) {
    result.add('raw:rate-limit.constructor');
  } else if (
    normalized.endsWith('/credential-runtime-gate.js') &&
    imported === 'runBetterAuthCredentialConsumer'
  ) {
    result.add('gate-run');
  } else if (
    normalized.endsWith('/credential-runtime-gate.js') &&
    (imported === 'runBetterAuthCredentialSourceCallable' ||
      imported === 'runBetterAuthCredentialSourceCallableAsync')
  ) {
    result.add('gate-source-callable');
  } else if (
    normalized.endsWith('/credential-runtime-gate.js') &&
    imported === 'betterAuthCredentialConsumers'
  ) {
    result.add('token-registry');
  } else if (normalized.endsWith('/intrinsics.js') && imported === 'betterAuthApply') {
    result.add('gate-apply');
  } else if (normalized.endsWith('/intrinsics.js') && imported === 'betterAuthFreezeOwn') {
    result.add('freeze-own');
  } else if (
    normalized.endsWith('/intrinsics.js') &&
    imported === 'betterAuthCaptureOwnApiMethod'
  ) {
    result.add('capture-api');
  } else if (normalized.endsWith('/intrinsics.js') && imported === 'betterAuthCaptureOwnMethod') {
    result.add('capture-method');
  }
}

function addLocalSourceSeed(result: Set<Provenance>, name: string): void {
  if (name === 'snapshotBetterAuthSetCookie') result.add('raw:cookie.snapshot');
  if (name === 'sanitizeBetterAuthRow') result.add('raw:session.reconstruction');
}

function importModuleName(node: ts.Node): string {
  let current: ts.Node | undefined = node;
  while (current !== undefined && !ts.isImportDeclaration(current)) current = current.parent;
  return current !== undefined && ts.isStringLiteral(current.moduleSpecifier)
    ? current.moduleSpecifier.text
    : '';
}

function bindingRootInitializer(element: ts.BindingElement): ts.Expression | undefined {
  let current: ts.Node = element.parent;
  while (ts.isObjectBindingPattern(current) || ts.isArrayBindingPattern(current)) {
    current = current.parent;
  }
  if (ts.isVariableDeclaration(current)) return current.initializer;
  if (ts.isParameter(current)) return undefined;
  return undefined;
}

function bindingPropertyName(element: ts.BindingElement): string | undefined {
  return element.propertyName === undefined
    ? ts.isIdentifier(element.name)
      ? element.name.text
      : undefined
    : propertyName(element.propertyName);
}

function propertyBase(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): ts.Expression {
  return node.expression;
}

function staticPropertyName(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | undefined {
  return ts.isPropertyAccessExpression(node)
    ? node.name.text
    : staticString(node.argumentExpression);
}

function staticString(expression: ts.Expression | undefined): string | undefined {
  if (expression === undefined) return undefined;
  const node = unwrap(expression);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isIdentifier(node)) {
    const declaration = node.parent;
    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.name === node &&
      declaration.initializer !== undefined
    ) {
      return staticString(declaration.initializer);
    }
  }
  return undefined;
}

function credentialSource(
  expression: ts.Expression | undefined,
): BetterAuthCredentialCensusSource | undefined {
  const value = staticString(expression);
  switch (value) {
    case 'better-auth.callable':
    case 'better-auth.constructor':
    case 'cookie.snapshot':
    case 'password.hash':
    case 'password.verify':
    case 'rate-limit.constructor':
    case 'session.reconstruction':
      return value;
    default:
      return undefined;
  }
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return ts.isComputedPropertyName(name) ? staticString(name.expression) : undefined;
}

function functionReturnExpressions(fn: ts.FunctionLikeDeclaration): readonly ts.Expression[] {
  if (fn.body === undefined) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const result: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== fn.body && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      result.push(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return result;
}

function nearestFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (isRuntimeFunctionLike(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function isRuntimeFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function isBindCall(expression: ts.Expression): boolean {
  return (
    (ts.isPropertyAccessExpression(expression) && expression.name.text === 'bind') ||
    (ts.isElementAccessExpression(expression) &&
      staticString(expression.argumentExpression) === 'bind')
  );
}

function consumerTokens(facts: ReadonlySet<Provenance>): Set<string> {
  const result = new Set<string>();
  for (const fact of facts) {
    if (fact.startsWith('token:')) result.add(fact.slice('token:'.length));
  }
  return result;
}

function rawSources(facts: ReadonlySet<Provenance>): Set<BetterAuthCredentialCensusSource> {
  const result = new Set<BetterAuthCredentialCensusSource>();
  for (const fact of facts) {
    if (fact.startsWith('raw:')) {
      result.add(fact.slice('raw:'.length) as BetterAuthCredentialCensusSource);
    }
  }
  return result;
}

function hasRaw(facts: ReadonlySet<Provenance>): boolean {
  for (const fact of facts) if (fact.startsWith('raw:')) return true;
  return false;
}

function addRaw(target: Set<Provenance>, source: ReadonlySet<Provenance>): void {
  for (const fact of source) if (fact.startsWith('raw:')) target.add(fact);
}

function addAll<Value>(target: Set<Value>, source: ReadonlySet<Value>): void {
  for (const value of source) target.add(value);
}

function union<Value>(...sets: readonly ReadonlySet<Value>[]): Set<Value> {
  const result = new Set<Value>();
  for (const set of sets) addAll(result, set);
  return result;
}

function resolveAliasedSymbol(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  if (!(symbol.flags & ts.SymbolFlags.Alias)) return symbol;
  try {
    return checker.getAliasedSymbol(symbol);
  } catch {
    return symbol;
  }
}

function uniqueNodes<Value extends ts.Node>(nodes: readonly Value[]): Value[] {
  return [...new Set(nodes)];
}

function unwrap(expression: ts.Expression): ts.Expression {
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

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function virtualFileName(file: string): string {
  return normalize(path.posix.join(virtualRoot, file.replace(/\\/g, '/')));
}

function displayFile(file: string): string {
  return normalize(file).slice(`${virtualRoot}/`.length);
}

function normalize(file: string): string {
  return path.posix.normalize(file.replace(/\\/g, '/'));
}
