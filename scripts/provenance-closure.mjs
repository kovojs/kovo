#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import {
  assertProvenanceRelationIsTotal,
  browserAuthorityStates,
  browserValueProvenanceStates,
  provenanceClosureCounterexamples,
  provenanceDomainHonesty,
  provenanceReachability,
  securitySemanticBudgets,
  securitySemanticClosedReasons,
  serverAuthorityRelation,
  serverAuthorityStates,
  serverAuthorityTop,
  serverExpressionProvenanceArmCensus,
  serverMemberClassDefinitions,
  serverMemberClasses,
  serverMemberProvenanceTable,
  serverOperationDoorRelation,
  serverValueProvenanceStates,
} from '../packages/compiler/src/scan/security-provenance-relation.ts';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot } from './lib/repo-root.mjs';

export const provenanceRelationSchema = 'kovo-security-provenance-relation/v1';
export const defaultProvenanceRelationPath = 'security-provenance-relation/v1.json';
const scannerPath = 'packages/compiler/src/scan/security-operation-ir.ts';

const expectedServerExpressionArmOrder = [
  'identifier-environment-lookup',
  'object-literal-implicit-protocol-shape',
  'new-expression',
  'call-expression',
  'binary-expression',
  'conditional-expression',
  'static-member',
  'foreign-executable-containment',
  'unsafe-wire-data-containment',
  'authority-containment',
];

export function buildProvenanceRelationArtifact({ rootDir = repoRoot() } = {}) {
  assertProvenanceRelationIsTotal();
  const source = readFileSync(path.join(rootDir, scannerPath), 'utf8');
  const extractedArms = extractServerExpressionProvenanceArms(source);
  assertExactList(extractedArms, expectedServerExpressionArmOrder, 'server expression arms');

  const counterexamples = provenanceClosureCounterexamples();
  if (counterexamples.length > 0) {
    throw new Error(formatClosureCounterexamples(counterexamples));
  }

  return {
    schema: provenanceRelationSchema,
    authority: {
      browserStates: browserAuthorityStates,
      serverLeqAuthorityTop: serverAuthorityRelation,
      serverStates: serverAuthorityStates,
      serverTop: serverAuthorityTop,
      unknownStateDefault: 'authority-bearing',
    },
    browserStates: browserValueProvenanceStates,
    closedReasons: securitySemanticClosedReasons,
    domain: provenanceDomainHonesty,
    expressionArms: {
      census: serverExpressionProvenanceArmCensus,
      extractedOrder: extractedArms,
    },
    memberClasses: serverMemberClassDefinitions,
    operationDoorOwners: serverOperationDoorRelation,
    resourceBounds: securitySemanticBudgets,
    serverMemberRelation: serverMemberProvenanceTable,
    serverStates: serverValueProvenanceStates,
    summary: {
      browserStates: browserValueProvenanceStates.length,
      closedReasons: securitySemanticClosedReasons.length,
      memberClasses: serverMemberClasses.length,
      relationPairs: serverValueProvenanceStates.length * serverMemberClasses.length,
      serverStates: serverValueProvenanceStates.length,
    },
    reachability: provenanceReachability(),
  };
}

export function validateProvenanceRelationArtifact(document, { rootDir = repoRoot() } = {}) {
  const findings = [];
  let expected;
  try {
    expected = buildProvenanceRelationArtifact({ rootDir });
  } catch (error) {
    findings.push(error instanceof Error ? error.message : String(error));
    return { findings, ok: false };
  }
  if (canonicalJson(document) !== canonicalJson(expected)) {
    findings.push(
      `${defaultProvenanceRelationPath}: stale or mutated; run pnpm run generate:provenance-relation`,
    );
  }
  return {
    findings,
    ok: findings.length === 0,
    summary: expected.summary,
  };
}

export function extractServerExpressionProvenanceArms(source) {
  const sourceFile = ts.createSourceFile(scannerPath, source, ts.ScriptTarget.Latest, true);
  let declaration;
  const visit = (node) => {
    if (
      declaration === undefined &&
      ts.isFunctionDeclaration(node) &&
      node.name?.text === 'serverExpressionProvenance'
    ) {
      declaration = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!declaration?.body) throw new Error(`${scannerPath}: serverExpressionProvenance is missing`);

  const arms = [];
  for (const statement of declaration.body.statements) {
    if (ts.isIfStatement(statement)) {
      appendIfChainArms(statement, arms, sourceFile);
      continue;
    }
    if (ts.isReturnStatement(statement) && statement.expression) {
      const payload = precisionGrantPayload(statement.expression, 'fallthrough-contained-local');
      const calls = payload === undefined ? new Set() : calledNames(payload);
      if (payload !== undefined && exactCalledNames(calls, ['expressionContainsServerAuthority'])) {
        arms.push('authority-containment');
      } else {
        arms.push(`unclassified-return:${ts.SyntaxKind[statement.expression.kind]}`);
      }
      continue;
    }
    if (isKnownSetupDeclaration(statement)) {
      continue;
    }
    arms.push(`unclassified-statement:${ts.SyntaxKind[statement.kind]}`);
  }
  return arms;
}

function precisionGrantPayload(expression, expectedId) {
  if (
    !ts.isCallExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== 'serverPrecisionGrant' ||
    expression.arguments.length !== 2 ||
    !ts.isStringLiteralLike(expression.arguments[0]) ||
    expression.arguments[0].text !== expectedId
  ) {
    return undefined;
  }
  return expression.arguments[1];
}

function appendIfChainArms(statement, arms, sourceFile) {
  let current = statement;
  while (current) {
    arms.push(classifyIfArm(current.expression, sourceFile));
    if (current.elseStatement === undefined) return;
    if (!ts.isIfStatement(current.elseStatement)) {
      arms.push(`unclassified-else:${ts.SyntaxKind[current.elseStatement.kind]}`);
      return;
    }
    current = current.elseStatement;
  }
}

function classifyIfArm(expression, sourceFile) {
  const calls = calledNames(expression);
  if (exactCalledNames(calls, ['isIdentifier'])) return 'identifier-environment-lookup';
  if (
    exactCalledNames(calls, ['isObjectLiteralExpression', 'serverObjectLiteralHasImplicitCallable'])
  ) {
    return 'object-literal-implicit-protocol-shape';
  }
  if (exactCalledNames(calls, ['isNewExpression'])) return 'new-expression';
  if (exactCalledNames(calls, ['isCallExpression'])) return 'call-expression';
  if (exactCalledNames(calls, ['isBinaryExpression'])) return 'binary-expression';
  if (exactCalledNames(calls, ['isConditionalExpression'])) return 'conditional-expression';
  if (exactCalledNames(calls, ['expressionContainsServerForeignExecutable'])) {
    return 'foreign-executable-containment';
  }
  if (exactCalledNames(calls, ['expressionContainsServerUnsafeWireData'])) {
    return 'unsafe-wire-data-containment';
  }
  if (ts.isIdentifier(expression) && expression.text === 'member') return 'static-member';
  const callSignature = [...calls].sort((left, right) => left.localeCompare(right)).join('+');
  return `unclassified:${callSignature || ts.SyntaxKind[expression.kind]}:${expression.getText(sourceFile)}`;
}

function exactCalledNames(actual, expected) {
  if (actual.size !== expected.length) return false;
  return expected.every((name) => actual.has(name));
}

function isKnownSetupDeclaration(statement) {
  if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) {
    return false;
  }
  const declaration = statement.declarationList.declarations[0];
  if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) return false;
  const expectedCall =
    declaration.name.text === 'current'
      ? 'unwrapExpression'
      : declaration.name.text === 'member'
        ? 'staticMember'
        : undefined;
  return (
    expectedCall !== undefined &&
    exactCalledNames(calledNames(declaration.initializer), [expectedCall])
  );
}

function calledNames(node) {
  const names = new Set();
  const visit = (current) => {
    if (ts.isCallExpression(current)) {
      if (ts.isIdentifier(current.expression)) names.add(current.expression.text);
      else if (ts.isPropertyAccessExpression(current.expression)) {
        names.add(current.expression.name.text);
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return names;
}

function assertExactList(actual, expected, label) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      `${label} differ: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
    );
  }
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function formatClosureCounterexamples(counterexamples) {
  return `provenance closure failed:\n${counterexamples
    .map(
      ({ detail, from, path: counterexamplePath, to }) =>
        `${from}${counterexamplePath.map((edge) => ` --${edge}-->`).join('')} ${to}: ${detail}`,
    )
    .join('\n')}`;
}

async function main() {
  const rootDir = repoRoot();
  const artifactPath = path.join(rootDir, defaultProvenanceRelationPath);
  if (process.argv.includes('--write')) {
    mkdirSync(path.dirname(artifactPath), { recursive: true });
    writeFileSync(
      artifactPath,
      canonicalJson(buildProvenanceRelationArtifact({ rootDir })),
      'utf8',
    );
  }
  let document;
  try {
    document = JSON.parse(readFileSync(artifactPath, 'utf8'));
  } catch (error) {
    throw new Error(`${defaultProvenanceRelationPath}: cannot read valid JSON: ${error.message}`);
  }
  const result = validateProvenanceRelationArtifact(document, { rootDir });
  if (!result.ok) throw new Error(result.findings.join('\n'));
  process.stdout.write(
    `${provenanceRelationSchema} server=${result.summary.serverStates} browser=${result.summary.browserStates} pairs=${result.summary.relationPairs} OK\n`,
  );
}

if (isMainEntry(import.meta.url)) await runGate(main);
