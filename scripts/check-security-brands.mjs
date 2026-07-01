#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const repoRoot = findRepoRoot();

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

const wrapperByKind = {
  classifier: 'securityClassifier',
  'wire-emitter': 'wireEmitter',
};

export function checkSecurityBrands(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const decisions = options.decisions ?? requiredSecurityDecisions;
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const exists = options.exists ?? ((relativePath) => existsSync(path.join(root, relativePath)));
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

export function main(options = {}) {
  const result = checkSecurityBrands(options);
  process.stdout.write(`check-security-brands/v1 ${result.summary}\n`);
  for (const finding of result.findings) process.stderr.write(`${finding}\n`);
  return result.ok;
}

function wrappedSecurityFunctions(fileName, text) {
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

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function decisionCount(decisions) {
  return decisions.reduce((sum, decision) => sum + decision.names.length, 0);
}

if (isMainEntry(import.meta.url)) await runGate(main);
