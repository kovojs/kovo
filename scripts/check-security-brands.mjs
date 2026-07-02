#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const repoRoot = findRepoRoot();

export const defaultReachabilityFiles = [
  'packages/server/src/sql-safe-handle.ts',
  'packages/server/src/sql-write-allowlist.ts',
  'packages/server/src/response.ts',
  'packages/server/src/query.ts',
  'packages/server/src/mutation/wire-response.ts',
  'packages/server/src/mutation/streaming.ts',
  'packages/server/src/document-core.ts',
  'packages/server/src/app-system-response.ts',
  'packages/server/src/capability-url.ts',
  'packages/server/src/static-export-headers.ts',
  'packages/compiler/src/validate/trusted-html-provenance.ts',
  'packages/compiler/src/validate/confidentiality.ts',
  'packages/drizzle/src/static/query-shapes.ts',
  'packages/drizzle/src/static/framework-identity.ts',
];

export const requiredSecurityDecisions = [
  {
    file: 'packages/server/src/sql-safe-handle.ts',
    kind: 'classifier',
    names: [
      'assertReadSqlStatement',
      'assertSqlWriteTablesAllowed',
      'enforceManagedSql',
      'managedSqlSafetyMode',
      'parseManagedSqlWriteTables',
    ],
  },
  {
    file: 'packages/server/src/sql-write-allowlist.ts',
    kind: 'classifier',
    names: ['parseSqlWriteTables', 'unparsedSqliteWriteStatement', 'writeTablesForStatement'],
  },
  {
    file: 'packages/server/src/response.ts',
    kind: 'wire-emitter',
    names: [
      'blessRedirectResponse',
      'htmlServerErrorResponse',
      'redirectLocationHeader',
      'redirectLocationHeaderValue',
      'routeOutcomeHeaders',
      'routeOutcomeResponse',
      'routeResponseToDocumentResponse',
      'routeResponseToWebResponse',
      'serverResponseToWebResponse',
    ],
  },
  {
    file: 'packages/server/src/query.ts',
    kind: 'wire-emitter',
    names: [
      'queryJsonHeaders',
      'renderQueryEndpointChunk',
      'renderQueryEndpointResponse',
      'renderQueryRegistryEndpointResponse',
      'withQueryCacheHeaders',
    ],
  },
  {
    file: 'packages/server/src/mutation/wire-response.ts',
    kind: 'wire-emitter',
    names: [
      'enhancedMutationReauthResponse',
      'mutationWireFailureResponse',
      'mutationWireResponseHeaders',
      'renderMutationWireLifecycleResponse',
      'renderSuccessfulMutationWireResponse',
    ],
  },
  {
    file: 'packages/server/src/mutation/streaming.ts',
    kind: 'wire-emitter',
    names: ['renderStreamingMutationWireResponse'],
  },
  {
    file: 'packages/server/src/document-core.ts',
    kind: 'wire-emitter',
    names: ['renderDocument', 'renderErrorDocument', 'renderRouteDocumentResponse'],
  },
  {
    file: 'packages/server/src/app-system-response.ts',
    kind: 'wire-emitter',
    names: ['appSystemResponse'],
  },
  {
    file: 'packages/server/src/capability-url.ts',
    kind: 'classifier',
    names: ['verifyCapability'],
  },
  {
    file: 'packages/server/src/capability-url.ts',
    kind: 'wire-emitter',
    names: ['signCapability'],
  },
  {
    file: 'packages/server/src/static-export-headers.ts',
    kind: 'wire-emitter',
    names: ['createStaticExportHeaderSink', 'staticExportHeaders'],
  },
  {
    file: 'packages/compiler/src/validate/trusted-html-provenance.ts',
    kind: 'classifier',
    names: [
      'classifyExpression',
      'rawTrustSinkForCall',
      'rawTrustSinkForExpression',
      'validateTrustedHtmlProvenance',
    ],
  },
  {
    file: 'packages/compiler/src/validate/confidentiality.ts',
    kind: 'classifier',
    names: ['secretQueryShapePaths', 'tableRowQueryShapePaths', 'validateSecretQueryWire'],
  },
  {
    file: 'packages/drizzle/src/static/query-shapes.ts',
    kind: 'classifier',
    names: [
      'isOpaqueProjection',
      'isQueryShapeWrapper',
      'selectShapeFromQueryBody',
      'sourceDestructuredQueryReceiverDiagnostics',
      'typedSqlProjectionShape',
    ],
  },
  {
    file: 'packages/drizzle/src/static/framework-identity.ts',
    kind: 'classifier',
    names: [
      'canonicalExpression',
      'canonicalFrameworkExportForExpression',
      'frameworkIdentityExpressionKindResolution',
      'namespaceMemberIdentityForIdentifier',
    ],
  },
];

export const defaultReachabilityRoots = requiredSecurityDecisions.flatMap((decision) =>
  decision.names.map((name) => ({ file: decision.file, kind: decision.kind, name })),
);

const wrapperByKind = {
  classifier: 'securityClassifier',
  'wire-emitter': 'wireEmitter',
};

export function checkSecurityBrands(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const exists = options.exists ?? ((relativePath) => existsSync(path.join(root, relativePath)));
  const decisions =
    options.decisions ??
    deriveRequiredSecurityDecisions({
      exists,
      files: options.reachabilityFiles,
      readText,
      requireUnbrandedReachable: options.requireUnbrandedReachable,
      roots: options.reachabilityRoots,
    });
  const findings = [];

  for (const decision of decisions) {
    if (!exists(decision.file)) {
      findings.push(`${decision.file}: security-decision file is missing`);
      continue;
    }
    const text = readText(decision.file);
    const wrapped = wrappedSecurityFunctions(decision.file, text);
    const declarations = declaredFunctions(decision.file, text);
    for (const name of decision.names) {
      const actual = wrapped.get(name);
      if (!actual) {
        const declaration = declarations.get(name);
        findings.push(
          declaration === undefined
            ? `${decision.file}: ${name} must exist and be branded with ${wrapperByKind[decision.kind]}()`
            : `${decision.file}:${declaration.line}: ${name} is an unbranded security-decision function; wrap it with ${wrapperByKind[decision.kind]}()`,
        );
        continue;
      }
      if (actual.kind !== decision.kind) {
        findings.push(
          `${decision.file}:${actual.line}: ${name} uses ${actual.wrapper}() but expected ${wrapperByKind[decision.kind]}()`,
        );
      }
    }
  }

  return {
    findings,
    ok: findings.length === 0,
    summary:
      findings.length === 0
        ? `OK ${decisionCount(decisions)} branded security-decision functions`
        : `${findings.length} security brand violation(s)`,
  };
}

export function deriveRequiredSecurityDecisions(options = {}) {
  const files = options.files ?? defaultReachabilityFiles;
  const roots = options.roots ?? defaultReachabilityRoots;
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8'));
  const exists =
    options.exists ?? ((relativePath) => existsSync(path.join(repoRoot, relativePath)));
  const graph = buildLocalCallGraph({ exists, files, readText });
  const required = new Map();

  for (const root of roots) {
    const rootKey = functionKey(root.file, root.name);
    const reachable = reachableFunctionKeys(graph, rootKey);
    for (const key of reachable) {
      const fn = graph.functions.get(key);
      if (!fn) continue;
      const kind = fn.wrapperKind ?? root.kind;
      if (!fn.wrapperKind && options.requireUnbrandedReachable !== true) continue;
      const groupKey = `${fn.file}\0${kind}`;
      const group = required.get(groupKey) ?? { file: fn.file, kind, names: [] };
      if (!group.names.includes(fn.name)) group.names.push(fn.name);
      required.set(groupKey, group);
    }
  }

  return [...required.values()]
    .map((decision) => ({ ...decision, names: decision.names.sort() }))
    .sort((left, right) =>
      `${left.file}\0${left.kind}`.localeCompare(`${right.file}\0${right.kind}`),
    );
}

export function main(options = {}) {
  const result = checkSecurityBrands(options);
  process.stdout.write(`check-security-brands/v1 ${result.summary}\n`);
  for (const finding of result.findings) process.stderr.write(`${finding}\n`);
  return result.ok;
}

export function wrappedSecurityFunctions(fileName, text) {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const wrapped = new Map();

  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const call = unwrapCall(node.initializer);
      const wrapper = callWrapperName(call);
      if (wrapper) {
        wrapped.set(node.name.text, {
          decision: stringLiteralArgument(call, 0),
          kind: wrapper === 'securityClassifier' ? 'classifier' : 'wire-emitter',
          line: lineOf(sourceFile, node),
          wrapper,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return wrapped;
}

function declaredFunctions(fileName, text) {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = new Map();

  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      declarations.set(node.name.text, { line: lineOf(sourceFile, node) });
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      declarations.set(node.name.text, { line: lineOf(sourceFile, node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return declarations;
}

function buildLocalCallGraph({ exists, files, readText }) {
  const functions = new Map();

  for (const file of files) {
    if (!exists(file)) continue;
    const text = readText(file);
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const importMap = importedIdentifiers(sourceFile, file);
    const localNames = new Set();

    for (const statement of sourceFile.statements) {
      const name = topLevelFunctionName(statement);
      if (name) localNames.add(name);
    }

    for (const statement of sourceFile.statements) {
      const name = topLevelFunctionName(statement);
      if (!name) continue;
      const body = topLevelFunctionBody(statement);
      const wrapper = topLevelWrapper(statement);
      const calls = new Set();
      if (body) {
        collectCalls(body, (calledName) => {
          if (localNames.has(calledName)) {
            calls.add(functionKey(file, calledName));
            return;
          }
          const imported = importMap.get(calledName);
          if (imported) calls.add(functionKey(imported.file, imported.name));
        });
      }
      functions.set(functionKey(file, name), {
        calls,
        file,
        line: lineOf(sourceFile, statement),
        name,
        wrapper: wrapper?.wrapper,
        wrapperKind: wrapper?.kind,
      });
    }
  }

  return { functions };
}

function reachableFunctionKeys(graph, rootKey) {
  const seen = new Set();
  const pending = [rootKey];
  while (pending.length > 0) {
    const key = pending.pop();
    if (seen.has(key)) continue;
    seen.add(key);
    const fn = graph.functions.get(key);
    if (!fn) continue;
    for (const called of fn.calls) pending.push(called);
  }
  return seen;
}

function importedIdentifiers(sourceFile, fromFile) {
  const imports = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const importedFile = resolveImportPath(fromFile, statement.moduleSpecifier.text);
    if (!importedFile) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) imports.set(clause.name.text, { file: importedFile, name: 'default' });
    const bindings = clause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      imports.set(element.name.text, {
        file: importedFile,
        name: element.propertyName?.text ?? element.name.text,
      });
    }
  }
  return imports;
}

function resolveImportPath(fromFile, specifier) {
  if (!specifier.startsWith('.')) return undefined;
  const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  return normalized.replace(/\.(?:js|jsx|mjs|cjs)$/u, '.ts');
}

function topLevelFunctionName(statement) {
  if (ts.isFunctionDeclaration(statement) && statement.name) return statement.name.text;
  if (!ts.isVariableStatement(statement)) return undefined;
  if (statement.declarationList.declarations.length !== 1) return undefined;
  const declaration = statement.declarationList.declarations[0];
  return ts.isIdentifier(declaration.name) ? declaration.name.text : undefined;
}

function topLevelFunctionBody(statement) {
  if (ts.isFunctionDeclaration(statement)) return statement.body;
  if (!ts.isVariableStatement(statement)) return undefined;
  const declaration = statement.declarationList.declarations[0];
  const initializer = declaration?.initializer;
  const call = unwrapCall(initializer);
  if (callWrapperName(call)) {
    const implementation = call.arguments[1] ?? call.arguments[0];
    return functionLikeBody(implementation);
  }
  return functionLikeBody(initializer);
}

function topLevelWrapper(statement) {
  if (!ts.isVariableStatement(statement)) return undefined;
  const declaration = statement.declarationList.declarations[0];
  const call = unwrapCall(declaration?.initializer);
  const wrapper = callWrapperName(call);
  if (!wrapper) return undefined;
  return { kind: wrapper === 'securityClassifier' ? 'classifier' : 'wire-emitter', wrapper };
}

function functionLikeBody(node) {
  if (!node) return undefined;
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return node.body;
  return undefined;
}

function collectCalls(node, onCall) {
  const visit = (current) => {
    if (ts.isCallExpression(current)) {
      const name = calledIdentifierName(current.expression);
      if (name) onCall(name);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
}

function calledIdentifierName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function functionKey(file, name) {
  return `${file}#${name}`;
}

function unwrapCall(expression) {
  let current = expression;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current && ts.isCallExpression(current) ? current : undefined;
}

function callWrapperName(call) {
  if (!call) return undefined;
  const expression = call.expression;
  if (!ts.isIdentifier(expression)) return undefined;
  return expression.text === 'securityClassifier' || expression.text === 'wireEmitter'
    ? expression.text
    : undefined;
}

function stringLiteralArgument(call, index) {
  const argument = call?.arguments[index];
  return argument && ts.isStringLiteral(argument) ? argument.text : undefined;
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function decisionCount(decisions) {
  return decisions.reduce((sum, decision) => sum + decision.names.length, 0);
}

if (isMainEntry(import.meta.url)) await runGate(main);
