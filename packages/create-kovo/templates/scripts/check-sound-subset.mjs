#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

const ts = await loadTypeScript();
const root = process.cwd();
const findings = [];
const RUNTIME_DB_MODULE_PATHS = new Set([
  'src/_kovo/app-runtime-db',
  'src/_kovo/app-runtime-db-options',
]);
const FRAMEWORK_GENERATED_SOUND_SUBSET_EXEMPT_FILES = new Set([
  'src/_kovo/app-runtime-db-options.ts',
  'src/_kovo/app-runtime-db.ts',
]);
const SECURITY_SURFACE_FILES = new Set([
  'src/app.test.ts',
  'src/app.tsx',
  'src/auth.ts',
  'src/components/auth-forms.tsx',
  'src/components/contacts.tsx',
  'src/db.ts',
  'src/endpoint-posture.test.ts',
  'src/model.ts',
  'src/mutations.ts',
  'src/queries.ts',
  'src/schema.ts',
]);
const SECURITY_SURFACE_ENROLLMENT_MESSAGE =
  'SPEC.md §6.6/§10.2/§10.3 sound subset must enroll the whole starter security surface';
const RUNTIME_DB_IMPORT_ALLOWLIST = new Map([
  [
    'src/app.tsx',
    new Set(['appRuntimeDbProvider', 'appRuntimeDbReady', 'appRuntimeMutationReplayStore']),
  ],
  ['src/auth.ts', new Set(['createAppAuthBindings'])],
  ['src/auth.sqlite.ts', new Set(['createAppAuthBindings'])],
  ['src/db.ts', new Set(['appRuntimeReadonlyDb'])],
  ['src/db.sqlite.ts', new Set(['appRuntimeReadonlyDb'])],
]);
const RUNTIME_DB_IMPORT_MESSAGE =
  'SPEC.md §6.6 sound subset bans non-type imports of src/_kovo/app-runtime-db or src/_kovo/app-runtime-db-options outside framework-owned starter files';
const AUTH_BINDING_FACTORY = 'createAppAuthBindings';
const AUTH_BINDING_SAFE_MEMBERS = new Set(['seedDemoUser', 'sessionProvider', 'signIn', 'signOut']);
const AUTH_BINDING_CONFINEMENT_MESSAGE =
  'SPEC.md §6.6/§10.3 confines the Better Auth instance and privileged adapter to the framework-owned runtime; ' +
  'auth.ts may export only the returned sanitized session provider, credential mutations, and fixed demo-seed operation';
const QUERY_LOADER_RAW_SQL_MESSAGE =
  'SPEC.md §6.6/§10.2 sound subset bans raw SQL in query loaders on the common path; ' +
  'use Drizzle typed builders or route explicit raw SQL through trustedSql(...) so runtime chokes stay authoritative';
const TRUST_SINK_CALLEE_MESSAGE =
  'SPEC.md §6.6 sound subset requires trustedHtml/trustedUrl/trustedSql callees to be statically resolvable; ' +
  'call the framework trust helper directly or through a literal namespace member';
const TRUST_SINK_EXPORTS = new Map([
  ['@kovojs/browser', new Set(['trustedHtml', 'trustedUrl'])],
  ['@kovojs/server', new Set(['trustedHtml', 'trustedUrl'])],
  ['@kovojs/drizzle', new Set(['trustedSql'])],
]);
const SQL_EXPORTS = new Map([
  ['@kovojs/drizzle', new Set(['sql', 'staticSql'])],
  ['drizzle-orm', new Set(['sql'])],
]);
const SQL_METHODS = new Set(['allow', 'identifier', 'join', 'raw']);

const enrolledSourceFiles = sourceFiles(join(root, 'src'));
reportMissingSecuritySurfaceFiles(enrolledSourceFiles);

for (const file of enrolledSourceFiles) {
  const source = readFileSync(file, 'utf8');
  const relativeFile = toPosixPath(relative(root, file));
  if (frameworkGeneratedSoundSubsetExempt(relativeFile)) continue;
  if (ts) {
    analyzeWithTypeScript(ts, source, relativeFile);
  } else {
    analyzeWithScanner(source, relativeFile);
  }
}

if (findings.length > 0) {
  console.error(`Kovo starter sound-subset check failed:\n${findings.join('\n')}`);
  process.exit(1);
}

console.log('Kovo starter sound-subset check passed.');

function sourceFiles(dir) {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) return sourceFiles(path);
      return /\.[cm]?tsx?$/.test(entry) ? [path] : [];
    })
    .sort((left, right) => left.localeCompare(right));
}

async function loadTypeScript() {
  try {
    const module = await import('typescript');
    return module.default ?? module;
  } catch {
    return null;
  }
}

function analyzeWithTypeScript(ts, source, relativeFile) {
  const sourceFile = ts.createSourceFile(
    relativeFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(ts, relativeFile),
  );
  const bindings = frameworkBindingsForSourceFile(ts, sourceFile);
  bindings.runtimeAuth = runtimeAuthBindingsForSourceFile(ts, sourceFile, relativeFile);
  visitTypeScriptNode(ts, sourceFile, sourceFile, relativeFile, bindings, {
    insideQueryLoader: false,
    insideTrustedSqlEscape: false,
  });
}

function visitTypeScriptNode(ts, node, sourceFile, relativeFile, bindings, context) {
  reportRuntimeDbImportIfNeeded(ts, node, sourceFile, relativeFile);
  reportRuntimeAuthCapabilityUseIfNeeded(ts, node, sourceFile, relativeFile, bindings.runtimeAuth);

  if (node.kind === ts.SyntaxKind.AnyKeyword) {
    reportTypeScriptFinding(sourceFile, relativeFile, node, 'SPEC.md §6.6 sound subset bans any');
  } else if (
    ts.isAsExpression(node) &&
    !isConstAssertion(ts, node, sourceFile) &&
    !isFrameworkTransactionDbBridgeCast(ts, node, sourceFile)
  ) {
    reportTypeScriptFinding(
      sourceFile,
      relativeFile,
      node,
      'SPEC.md §6.6 sound subset bans unchecked casts',
    );
  } else if (ts.isNonNullExpression(node)) {
    reportTypeScriptFinding(
      sourceFile,
      relativeFile,
      node,
      'SPEC.md §6.6 sound subset bans non-null assertions',
    );
  }

  if (ts.isCallExpression(node)) {
    reportTrustSinkCalleeIfNeeded(ts, node, sourceFile, relativeFile, bindings);

    if (isQueryCall(ts, node.expression, bindings)) {
      visitQueryCall(ts, node, sourceFile, relativeFile, bindings, context);
      return;
    }

    if (isTrustedSqlCall(ts, node.expression, bindings)) {
      ts.forEachChild(node, (child) =>
        visitTypeScriptNode(ts, child, sourceFile, relativeFile, bindings, {
          ...context,
          insideTrustedSqlEscape: true,
        }),
      );
      return;
    }

    if (
      context.insideQueryLoader &&
      !context.insideTrustedSqlEscape &&
      isSqlHelperCall(ts, node.expression, bindings)
    ) {
      reportTypeScriptFinding(
        sourceFile,
        relativeFile,
        node.expression,
        QUERY_LOADER_RAW_SQL_MESSAGE,
      );
    }
  } else if (
    context.insideQueryLoader &&
    !context.insideTrustedSqlEscape &&
    ts.isTaggedTemplateExpression(node) &&
    isSqlTag(ts, node.tag, bindings)
  ) {
    reportTypeScriptFinding(sourceFile, relativeFile, node.tag, QUERY_LOADER_RAW_SQL_MESSAGE);
  }

  ts.forEachChild(node, (child) =>
    visitTypeScriptNode(ts, child, sourceFile, relativeFile, bindings, context),
  );
}

function runtimeAuthBindingsForSourceFile(ts, sourceFile, relativeFile) {
  const factories = new Set();
  const containers = new Set();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = stringLiteralText(ts, statement.moduleSpecifier);
    if (!specifier || !isRuntimeDbModuleSpecifier(relativeFile, specifier)) continue;
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const element of named.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported === AUTH_BINDING_FACTORY) factories.add(element.name.text);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (ts.isIdentifier(node.initializer) && factories.has(node.initializer.text)) {
          const size = factories.size;
          factories.add(node.name.text);
          changed = factories.size !== size || changed;
        } else if (
          ts.isCallExpression(node.initializer) &&
          ts.isIdentifier(node.initializer.expression) &&
          factories.has(node.initializer.expression.text)
        ) {
          const size = containers.size;
          containers.add(node.name.text);
          changed = containers.size !== size || changed;
        } else if (ts.isIdentifier(node.initializer) && containers.has(node.initializer.text)) {
          const size = containers.size;
          containers.add(node.name.text);
          changed = containers.size !== size || changed;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return { containers, factories };
}

function reportRuntimeAuthCapabilityUseIfNeeded(ts, node, sourceFile, relativeFile, runtimeAuth) {
  if (!runtimeAuth) return;

  if (
    (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
    ts.isIdentifier(node.expression) &&
    runtimeAuth.containers.has(node.expression.text)
  ) {
    const member = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : stringLiteralText(ts, node.argumentExpression);
    if (member === null || !AUTH_BINDING_SAFE_MEMBERS.has(member)) {
      reportTypeScriptFinding(sourceFile, relativeFile, node, AUTH_BINDING_CONFINEMENT_MESSAGE);
    }
    return;
  }

  if (ts.isCallExpression(node) && resolvesToRuntimeAuthFactory(ts, node.expression, runtimeAuth)) {
    const declaration = node.parent;
    const statement =
      ts.isVariableDeclaration(declaration) && ts.isVariableDeclarationList(declaration.parent)
        ? declaration.parent.parent
        : undefined;
    if (
      !ts.isVariableDeclaration(declaration) ||
      !ts.isIdentifier(declaration.name) ||
      !statement ||
      !ts.isVariableStatement(statement) ||
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      reportTypeScriptFinding(sourceFile, relativeFile, node, AUTH_BINDING_CONFINEMENT_MESSAGE);
    }
    return;
  }

  if (!ts.isIdentifier(node)) return;

  if (runtimeAuth.containers.has(node.text)) {
    const parent = node.parent;
    if (
      (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === node
    ) {
      return;
    }
    if (ts.isVariableDeclaration(parent) && parent.name === node) return;
    if (
      ts.isVariableDeclaration(parent) &&
      parent.initializer === node &&
      ts.isIdentifier(parent.name) &&
      runtimeAuth.containers.has(parent.name.text)
    ) {
      return;
    }
    reportTypeScriptFinding(sourceFile, relativeFile, node, AUTH_BINDING_CONFINEMENT_MESSAGE);
    return;
  }

  if (!runtimeAuth.factories.has(node.text)) return;
  const parent = node.parent;
  if (ts.isImportSpecifier(parent)) return;
  if (ts.isCallExpression(parent) && parent.expression === node) return;
  if (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === node &&
    ts.isIdentifier(parent.name) &&
    runtimeAuth.factories.has(parent.name.text) &&
    ts.isVariableDeclarationList(parent.parent) &&
    ts.isVariableStatement(parent.parent.parent) &&
    !parent.parent.parent.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  ) {
    return;
  }
  reportTypeScriptFinding(sourceFile, relativeFile, node, AUTH_BINDING_CONFINEMENT_MESSAGE);
}

function resolvesToRuntimeAuthFactory(ts, expression, runtimeAuth) {
  return ts.isIdentifier(expression) && runtimeAuth.factories.has(expression.text);
}

function visitQueryCall(ts, call, sourceFile, relativeFile, bindings, context) {
  for (const argument of call.arguments) {
    if (ts.isObjectLiteralExpression(argument)) {
      visitQueryConfigObject(ts, argument, sourceFile, relativeFile, bindings, context);
    } else {
      visitTypeScriptNode(ts, argument, sourceFile, relativeFile, bindings, context);
    }
  }
}

function visitQueryConfigObject(ts, object, sourceFile, relativeFile, bindings, context) {
  for (const property of object.properties) {
    const isLoad =
      ts.isPropertyAssignment(property) && propertyNameText(ts, property.name) === 'load';
    const isLoadMethod =
      ts.isMethodDeclaration(property) && propertyNameText(ts, property.name) === 'load';
    if (isLoad) {
      visitTypeScriptNode(ts, property.initializer, sourceFile, relativeFile, bindings, {
        ...context,
        insideQueryLoader: true,
      });
    } else if (isLoadMethod) {
      visitTypeScriptNode(ts, property, sourceFile, relativeFile, bindings, {
        ...context,
        insideQueryLoader: true,
      });
    } else {
      visitTypeScriptNode(ts, property, sourceFile, relativeFile, bindings, context);
    }
  }
}

function reportTrustSinkCalleeIfNeeded(ts, call, sourceFile, relativeFile, bindings) {
  const callee = call.expression;
  if (ts.isIdentifier(callee) && bindings.dynamicTrustAliases.has(callee.text)) {
    reportTypeScriptFinding(sourceFile, relativeFile, callee, TRUST_SINK_CALLEE_MESSAGE);
    return;
  }
  if (!isDynamicFrameworkTrustMember(ts, callee, bindings)) return;
  reportTypeScriptFinding(sourceFile, relativeFile, callee, TRUST_SINK_CALLEE_MESSAGE);
}

function reportRuntimeDbImportIfNeeded(ts, node, sourceFile, relativeFile) {
  if (ts.isImportDeclaration(node)) {
    const specifier = stringLiteralText(ts, node.moduleSpecifier);
    if (
      specifier &&
      isRuntimeDbModuleSpecifier(relativeFile, specifier) &&
      !isTypeOnlyImportDeclaration(ts, node) &&
      !isAllowedRuntimeDbImport(ts, node, relativeFile)
    ) {
      reportTypeScriptFinding(
        sourceFile,
        relativeFile,
        node.moduleSpecifier,
        RUNTIME_DB_IMPORT_MESSAGE,
      );
    }
    return;
  }

  if (ts.isExportDeclaration(node)) {
    const specifier = node.moduleSpecifier ? stringLiteralText(ts, node.moduleSpecifier) : null;
    if (
      specifier &&
      isRuntimeDbModuleSpecifier(relativeFile, specifier) &&
      !isTypeOnlyExportDeclaration(ts, node)
    ) {
      reportTypeScriptFinding(
        sourceFile,
        relativeFile,
        node.moduleSpecifier,
        RUNTIME_DB_IMPORT_MESSAGE,
      );
    }
    return;
  }

  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length > 0
  ) {
    const specifier = stringLiteralText(ts, node.arguments[0]);
    if (specifier && isRuntimeDbModuleSpecifier(relativeFile, specifier)) {
      reportTypeScriptFinding(
        sourceFile,
        relativeFile,
        node.arguments[0],
        RUNTIME_DB_IMPORT_MESSAGE,
      );
    }
  }
}

function isTypeOnlyImportDeclaration(ts, node) {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name) return false;
  const bindings = clause.namedBindings;
  if (!bindings) return false;
  if (ts.isNamespaceImport(bindings)) return false;
  return (
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
}

function isTypeOnlyExportDeclaration(ts, node) {
  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  if (!clause || !ts.isNamedExports(clause)) return false;
  return clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly);
}

function stringLiteralText(ts, node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}

function isConstAssertion(ts, node, sourceFile) {
  return (
    node.type.kind === ts.SyntaxKind.TypeReference && node.type.getText(sourceFile) === 'const'
  );
}

function isFrameworkTransactionDbBridgeCast(ts, node, sourceFile) {
  if (isFrameworkTransactionDbBridgeOuterCast(ts, node, sourceFile)) return true;
  return (
    ts.isAsExpression(node.parent) &&
    node.parent.expression === node &&
    isFrameworkTransactionDbBridgeOuterCast(ts, node.parent, sourceFile)
  );
}

function isFrameworkTransactionDbBridgeOuterCast(ts, node, sourceFile) {
  if (!ts.isAsExpression(node.expression)) return false;
  if (node.expression.type.getText(sourceFile) !== 'unknown') return false;
  if (!/Db(?:\b|[<.])/.test(node.type.getText(sourceFile))) return false;

  const property = node.parent;
  if (!ts.isPropertyAssignment(property)) return false;
  if (property.name.getText(sourceFile) !== 'db') return false;

  const object = property.parent;
  if (!ts.isObjectLiteralExpression(object)) return false;
  if (!object.properties.some((candidate) => ts.isSpreadAssignment(candidate))) return false;

  const call = object.parent;
  if (!ts.isCallExpression(call)) return false;
  if (call.arguments[0] !== object) return false;
  if (call.expression.getText(sourceFile) !== 'run') return false;

  return isInsideTransactionDefinition(ts, call);
}

function isInsideTransactionDefinition(ts, node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isMethodDeclaration(current)) {
      return current.name?.getText() === 'transaction';
    }
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isPropertyAssignment(current.parent)
    ) {
      return current.parent.name.getText() === 'transaction';
    }
  }
  return false;
}

function frameworkBindingsForSourceFile(ts, sourceFile) {
  const dynamicTrustAliases = new Set();
  const namedImports = new Map();
  const namespaceImports = new Map();
  const localAliases = new Map();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const module = stringLiteralText(ts, statement.moduleSpecifier);
    if (!module) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;

    const bindings = clause.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaceImports.set(bindings.name.text, module);
      continue;
    }
    if (!ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const exported = element.propertyName?.text ?? element.name.text;
      namedImports.set(element.name.text, { module, exported });
    }
  }

  const bindings = { dynamicTrustAliases, localAliases, namedImports, namespaceImports };
  collectFrameworkAliases(ts, sourceFile, bindings);

  return bindings;
}

function collectFrameworkAliases(ts, sourceFile, bindings) {
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        changed =
          collectFrameworkAliasFromBinding(ts, node.name, node.initializer, bindings) || changed;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
}

function collectFrameworkAliasFromBinding(ts, name, initializer, bindings) {
  if (ts.isIdentifier(name)) {
    if (isDynamicFrameworkTrustMember(ts, initializer, bindings)) {
      const size = bindings.dynamicTrustAliases.size;
      bindings.dynamicTrustAliases.add(name.text);
      return bindings.dynamicTrustAliases.size !== size;
    }
    if (ts.isIdentifier(initializer) && bindings.dynamicTrustAliases.has(initializer.text)) {
      const size = bindings.dynamicTrustAliases.size;
      bindings.dynamicTrustAliases.add(name.text);
      return bindings.dynamicTrustAliases.size !== size;
    }
    const resolved = resolvedFrameworkMember(ts, initializer, bindings);
    if (!resolved) return false;
    const previous = bindings.localAliases.get(name.text);
    bindings.localAliases.set(name.text, resolved);
    return !sameResolvedFrameworkMember(previous, resolved);
  }

  if (!ts.isObjectBindingPattern(name)) return false;
  const resolved = resolvedFrameworkMember(ts, initializer, bindings);
  if (!resolved || resolved.member) return false;

  let changed = false;
  for (const element of name.elements) {
    if (!ts.isIdentifier(element.name)) continue;
    const property = element.propertyName
      ? propertyNameText(ts, element.propertyName)
      : element.name.text;
    if (!property) continue;
    const member = { ...resolved, member: property };
    const previous = bindings.localAliases.get(element.name.text);
    bindings.localAliases.set(element.name.text, member);
    changed = !sameResolvedFrameworkMember(previous, member) || changed;
  }
  return changed;
}

function sameResolvedFrameworkMember(left, right) {
  return (
    left?.module === right.module &&
    left.exported === right.exported &&
    left.member === right.member
  );
}

function isQueryCall(ts, expression, bindings) {
  return expressionResolvesToExport(ts, expression, bindings, '@kovojs/server', 'query');
}

function isTrustedSqlCall(ts, expression, bindings) {
  return expressionResolvesToExport(ts, expression, bindings, '@kovojs/drizzle', 'trustedSql');
}

function isSqlTag(ts, tag, bindings) {
  return (
    expressionResolvesToAnyExport(ts, tag, bindings, SQL_EXPORTS) ||
    (ts.isCallExpression(tag) &&
      expressionResolvesToAnyExport(ts, tag.expression, bindings, SQL_EXPORTS))
  );
}

function isSqlHelperCall(ts, expression, bindings) {
  const resolved = resolvedFrameworkMember(ts, expression, bindings);
  if (!resolved) return false;
  if (!SQL_EXPORTS.get(resolved.module)?.has(resolved.exported)) return false;
  return resolved.member ? SQL_METHODS.has(resolved.member) : false;
}

function isDynamicFrameworkTrustMember(ts, expression, bindings) {
  if (!ts.isElementAccessExpression(expression)) return false;
  if (stringLiteralText(ts, expression.argumentExpression)) return false;

  const receiver = expression.expression;
  if (ts.isIdentifier(receiver)) {
    const module = bindings.namespaceImports.get(receiver.text);
    return hasTrustExports(module);
  }

  const resolvedReceiver = resolvedFrameworkMember(ts, receiver, bindings);
  return Boolean(
    resolvedReceiver &&
    TRUST_SINK_EXPORTS.get(resolvedReceiver.module)?.has(resolvedReceiver.exported),
  );
}

function expressionResolvesToAnyExport(ts, expression, bindings, exportsByModule) {
  const resolved = resolvedFrameworkMember(ts, expression, bindings);
  if (!resolved || resolved.member) return false;
  return exportsByModule.get(resolved.module)?.has(resolved.exported) === true;
}

function expressionResolvesToExport(ts, expression, bindings, module, exported) {
  const resolved = resolvedFrameworkMember(ts, expression, bindings);
  return (
    resolved?.module === module && resolved.exported === exported && resolved.member === undefined
  );
}

function resolvedFrameworkMember(ts, expression, bindings) {
  if (ts.isIdentifier(expression)) {
    const named =
      bindings.localAliases.get(expression.text) ?? bindings.namedImports.get(expression.text);
    return named ? { ...named } : null;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    const receiver = expression.expression;
    const property = expression.name.text;
    if (ts.isIdentifier(receiver)) {
      const module = bindings.namespaceImports.get(receiver.text);
      if (module) return { module, exported: property };
    }
    const resolvedReceiver = resolvedFrameworkMember(ts, receiver, bindings);
    if (resolvedReceiver && !resolvedReceiver.member) {
      return { ...resolvedReceiver, member: property };
    }
    return null;
  }

  if (ts.isElementAccessExpression(expression)) {
    const property = stringLiteralText(ts, expression.argumentExpression);
    if (!property) return null;
    const receiver = expression.expression;
    if (ts.isIdentifier(receiver)) {
      const module = bindings.namespaceImports.get(receiver.text);
      if (module) return { module, exported: property };
    }
    const resolvedReceiver = resolvedFrameworkMember(ts, receiver, bindings);
    if (resolvedReceiver && !resolvedReceiver.member) {
      return { ...resolvedReceiver, member: property };
    }
  }

  return null;
}

function reportMissingSecuritySurfaceFiles(files) {
  const enrolled = new Set(files.map((file) => toPosixPath(relative(root, file))));
  for (const file of SECURITY_SURFACE_FILES) {
    if (enrolled.has(file)) continue;
    findings.push(`${file}:1: ${SECURITY_SURFACE_ENROLLMENT_MESSAGE}; missing from src/ scan`);
  }
}

function propertyNameText(ts, name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function hasTrustExports(module) {
  return Boolean(module && TRUST_SINK_EXPORTS.has(module));
}

function reportTypeScriptFinding(sourceFile, relativeFile, node, message) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  findings.push(`${relativeFile}:${line + 1}: ${message}`);
}

function isAllowedRuntimeDbImport(ts, node, relativeFile) {
  const allowed = RUNTIME_DB_IMPORT_ALLOWLIST.get(toPosixPath(relativeFile));
  if (allowed === undefined) return false;
  const clause = node.importClause;
  if (!clause || clause.name) return false;
  const bindings = clause.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return false;
  return bindings.elements.every((element) => {
    if (element.isTypeOnly) return true;
    const imported = element.propertyName?.text ?? element.name.text;
    return allowed.has(imported);
  });
}

function frameworkGeneratedSoundSubsetExempt(relativeFile) {
  return FRAMEWORK_GENERATED_SOUND_SUBSET_EXEMPT_FILES.has(toPosixPath(relativeFile));
}

function isRuntimeDbModuleSpecifier(relativeFile, specifier) {
  if (!specifier.startsWith('.')) return false;
  const resolved = stripModuleExtension(
    toPosixPath(normalize(join(dirname(relativeFile), specifier))),
  );
  return RUNTIME_DB_MODULE_PATHS.has(resolved);
}

function stripModuleExtension(value) {
  return value.replace(/\.(?:[cm]?[jt]sx?)$/u, '');
}

function toPosixPath(value) {
  return value.replaceAll('\\', '/');
}

function scriptKind(ts, file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (file.endsWith('.mts')) return ts.ScriptKind.MTS;
  if (file.endsWith('.cts')) return ts.ScriptKind.CTS;
  if (file.endsWith('.ts')) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function analyzeWithScanner(source, relativeFile) {
  scanRuntimeDbImports(source, relativeFile);

  const lines = maskIgnoredText(source).split('\n');
  for (const [index, line] of lines.entries()) {
    if (/\bany\b/.test(line)) {
      findings.push(`${relativeFile}:${index + 1}: SPEC.md §6.6 sound subset bans any`);
    }
    if (/\bas\s+(?!const\b)[A-Za-z_{]/.test(line)) {
      findings.push(`${relativeFile}:${index + 1}: SPEC.md §6.6 sound subset bans unchecked casts`);
    }
    if (/[A-Za-z0-9_$)\]]!\s*(?:[.;,\])}]|\?|$)/.test(line)) {
      findings.push(
        `${relativeFile}:${index + 1}: SPEC.md §6.6 sound subset bans non-null assertions`,
      );
    }
  }
}

function scanRuntimeDbImports(source, relativeFile) {
  const importPatterns = [
    { kind: 'import', pattern: /^\s*import\s+(?!type\b)([^'";]*?\s+from\s*)?['"]([^'"]+)['"]/gmsu },
    { kind: 'export', pattern: /^\s*export\s+(?!type\b)[^'";]*?\s+from\s*['"]([^'"]+)['"]/gmsu },
    { kind: 'dynamic', pattern: /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu },
  ];

  for (const { kind, pattern } of importPatterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = kind === 'import' ? match[2] : match[1];
      if (!specifier || !isRuntimeDbModuleSpecifier(relativeFile, specifier)) continue;
      if (kind === 'import' && isAllowedRuntimeDbImportByScanner(match[1] ?? '', relativeFile)) {
        continue;
      }
      findings.push(
        `${relativeFile}:${lineNumberAt(source, match.index ?? 0)}: ${RUNTIME_DB_IMPORT_MESSAGE}`,
      );
    }
  }
}

function isAllowedRuntimeDbImportByScanner(importClause, relativeFile) {
  const allowed = RUNTIME_DB_IMPORT_ALLOWLIST.get(toPosixPath(relativeFile));
  if (allowed === undefined) return false;
  const named = /^\s*\{\s*([^}]+?)\s*\}\s+from\s*$/su.exec(importClause);
  if (!named) return false;
  return named[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .every((part) => {
      if (part.startsWith('type ')) return true;
      const imported = part.split(/\s+as\s+/u)[0]?.trim();
      return imported !== undefined && allowed.has(imported);
    });
}

function lineNumberAt(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function maskIgnoredText(source) {
  const chars = [...source];
  const expressionStack = [];
  let state = 'code';
  let pendingJsxTag = null;

  for (let index = 0; index < chars.length; index += 1) {
    const current = chars[index] ?? '';
    const next = chars[index + 1] ?? '';

    if (state === 'line-comment') {
      if (current !== '\n') chars[index] = ' ';
      else state = restoreState(expressionStack, 'code');
      continue;
    }

    if (state === 'block-comment') {
      if (current === '*' && next === '/') {
        chars[index] = ' ';
        chars[index + 1] = ' ';
        index += 1;
        state = restoreState(expressionStack, 'code');
      } else if (current !== '\n') {
        chars[index] = ' ';
      }
      continue;
    }

    if (state === 'single-quote' || state === 'double-quote') {
      if (current === '\\') {
        chars[index] = ' ';
        if (next && next !== '\n') chars[index + 1] = ' ';
        index += 1;
        continue;
      }
      if (current !== '\n') chars[index] = ' ';
      if (
        (state === 'single-quote' && current === "'") ||
        (state === 'double-quote' && current === '"')
      ) {
        state = restoreState(expressionStack, 'code');
      }
      continue;
    }

    if (state === 'template') {
      if (current === '\\') {
        chars[index] = ' ';
        if (next && next !== '\n') chars[index + 1] = ' ';
        index += 1;
        continue;
      }
      if (current === '$' && next === '{') {
        chars[index] = ' ';
        chars[index + 1] = '{';
        expressionStack.push({ braceDepth: 1, returnState: 'template' });
        state = 'code';
        index += 1;
        continue;
      }
      if (current !== '\n') chars[index] = ' ';
      if (current === '`') state = restoreState(expressionStack, 'code');
      continue;
    }

    if (state === 'jsx-text') {
      if (current === '{') {
        expressionStack.push({ braceDepth: 1, returnState: 'jsx-text' });
        state = 'code';
        continue;
      }
      if (current === '<' && startsJsxTag(chars, index)) {
        pendingJsxTag = classifyJsxTag(chars, index);
        state = 'jsx-tag';
        continue;
      }
      if (current !== '\n') chars[index] = ' ';
      continue;
    }

    if (state === 'jsx-tag') {
      if (current === "'" || current === '"') {
        state = current === "'" ? 'single-quote' : 'double-quote';
        continue;
      }
      if (current === '{') {
        expressionStack.push({ braceDepth: 1, returnState: 'jsx-tag' });
        state = 'code';
        continue;
      }
      if (current === '>') {
        if (pendingJsxTag === 'open') state = 'jsx-text';
        else state = restoreState(expressionStack, 'code');
        pendingJsxTag = null;
      }
      continue;
    }

    if (current === '/' && next === '/') {
      chars[index] = ' ';
      chars[index + 1] = ' ';
      state = 'line-comment';
      index += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      chars[index] = ' ';
      chars[index + 1] = ' ';
      state = 'block-comment';
      index += 1;
      continue;
    }
    if (current === "'" || current === '"') {
      state = current === "'" ? 'single-quote' : 'double-quote';
      continue;
    }
    if (current === '`') {
      state = 'template';
      continue;
    }
    if (current === '<' && startsJsxTag(chars, index)) {
      pendingJsxTag = classifyJsxTag(chars, index);
      state = 'jsx-tag';
      continue;
    }

    const expression = expressionStack.at(-1);
    if (expression) {
      if (current === '{') expression.braceDepth += 1;
      if (current === '}') {
        expression.braceDepth -= 1;
        if (expression.braceDepth === 0) {
          expressionStack.pop();
          state = expression.returnState;
        }
      }
    }
  }

  return chars.join('');
}

function startsJsxTag(chars, index) {
  const next = chars[index + 1] ?? '';
  if (next === '/' || next === '>') return true;
  return /[A-Za-z]/.test(next);
}

function classifyJsxTag(chars, index) {
  return chars[index + 1] === '/' ? 'close' : 'open';
}

function restoreState(expressionStack, fallback) {
  const current = expressionStack.at(-1);
  return current ? current.returnState : fallback;
}
