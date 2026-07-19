#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { dec10GreenCorpusRows } from '../packages/conformance-fixtures/src/adversarial-corpus.ts';
import { REQUIRED_CLASSIFIER_CORPORA } from './check-security-classifier-corpus.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import {
  SECURITY_GATE_MUTANTS,
  runSecurityGateMutationHarness,
} from './security-gate-mutations.mjs';

const BASELINE_SCHEMA = 'kovo-security-convergence-baseline/v2';
const CHARTER_SCHEMA = 'kovo-security-audit-charter/v1';
const DEFAULT_BASELINE_FILE = 'security/security-convergence-baseline.json';
const DEFAULT_CHARTER_FILE = 'security/security-convergence-audit-charter.json';
const TRUST_STATIC_FILE = 'packages/drizzle/src/trust-escapes-static.ts';
const EGRESS_FILE = 'packages/server/src/egress.ts';

// Keep this scope explicit. These are the production files that own the enumerative static
// classifier predicates measured by P. A classifier move must update this list, which changes the
// committed path digest and the per-file rows instead of silently shrinking the denominator.
export const SECURITY_PREDICATE_PRODUCTION_FILES = Object.freeze([
  TRUST_STATIC_FILE,
  'packages/compiler/src/scan/security-operation-ir.ts',
  'packages/compiler/src/scan/capability-closure.ts',
  'packages/compiler/src/security/capability-closure.ts',
  'packages/compiler/src/scan/parse.ts',
  'packages/cli/src/commands/build-export.ts',
  'packages/cli/src/commands/compile.ts',
  'packages/compiler/src/security/capability-closure-model.ts',
  'packages/compiler/src/validate/security-operation-ir.ts',
  'packages/compiler/src/validate/pipeline.ts',
  'packages/compiler/src/compile.ts',
  'packages/compiler/src/emit/server-render.ts',
  'packages/compiler/src/lower/handlers.ts',
]);

const EGRESS_RANGE_TABLES = [
  'IANA_IPV4_SPECIAL_PURPOSE_PREFIXES',
  'CONSERVATIVE_IPV4_CLOSED_PREFIXES',
  'IANA_IPV6_SPECIAL_PURPOSE_PREFIXES',
];

export function collectSecurityConvergenceSnapshot(options = {}) {
  const root = options.repoRoot ?? findRepoRoot();
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const predicateSources = SECURITY_PREDICATE_PRODUCTION_FILES.map((file) => ({
    file,
    source: readText(file),
  }));
  const trustSource = predicateSources.find((row) => row.file === TRUST_STATIC_FILE)?.source;
  if (trustSource === undefined) {
    throw new TypeError(`${TRUST_STATIC_FILE} must remain in the production predicate scope.`);
  }
  const egressSource = readText(EGRESS_FILE);
  const charterSource = readText(options.charterFile ?? DEFAULT_CHARTER_FILE);
  const charter = JSON.parse(charterSource);
  if (charter.schema !== CHARTER_SCHEMA) {
    throw new TypeError(`Security audit charter must use ${CHARTER_SCHEMA}.`);
  }

  const staticPredicates = measureProductionPredicateObligations(predicateSources);
  const imperativeDom = measureImperativeDomSinkLexicon(trustSource);
  const egress = measureEgressObligations(egressSource);
  const corpora = options.corpora ?? REQUIRED_CLASSIFIER_CORPORA;
  const greenRows = options.greenRows ?? dec10GreenCorpusRows();
  const mutants = options.mutants ?? SECURITY_GATE_MUTANTS;
  const classifierTestFiles = new Set(corpora.flatMap((corpus) => corpus.testFiles));

  return {
    schema: BASELINE_SCHEMA,
    charter: {
      id: charter.id,
      sha256: sha256(charterSource),
      version: charter.version,
    },
    m: {
      mutantCount: mutants.length,
      mutantNames: mutants.map((mutant) => mutant.name).sort(compareText),
    },
    p: {
      category: 'conservative-production-predicate-lower-bound',
      egress,
      imperativeDom,
      total:
        staticPredicates.total +
        imperativeDom.sinkNames.length +
        egress.rangeEntryCount +
        egress.exactMetadataAddressCount +
        egress.opaqueAllowPathCount,
      staticPredicates,
    },
    g: {
      acceptedFullApps: 0,
      acceptedFixtureRows: greenRows.length,
      unexpectedClosedVerdicts: 0,
    },
    c13: {
      anchorCount: corpora.reduce(
        (count, corpus) => count + (corpus.verdictAnchors?.length ?? 0),
        0,
      ),
      corpusCount: corpora.length,
      testFileCount: classifierTestFiles.size,
    },
    informational: {
      egressLoc: lineCount(egressSource),
      trustStaticLoc: lineCount(trustSource),
    },
  };
}

export function measureProductionPredicateObligations(sources) {
  const sourcePaths = sources.map(({ file }) => file);
  if (new Set(sourcePaths).size !== sourcePaths.length) {
    throw new TypeError('Security predicate production scope must not contain duplicate files.');
  }
  const files = sources
    .map(({ file, source }) => ({
      file,
      sourceSha256: sha256(source),
      ...measureStaticPredicateObligations(source, file),
    }))
    .sort((left, right) => compareText(left.file, right.file));
  const scopeFiles = files.map((row) => row.file);
  return {
    fileCount: files.length,
    files,
    rowsSha256: sha256(JSON.stringify(files)),
    scopeFiles,
    scopeSha256: sha256(JSON.stringify(scopeFiles)),
    total: files.reduce((count, row) => count + row.total, 0),
  };
}

export function measureStaticPredicateObligations(source, fileName = 'security-predicates.ts') {
  const sourceFile = parseTypescript(source, fileName);
  const inventories = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !/^[A-Z][A-Z0-9_]+$/u.test(declaration.name.text)) {
        continue;
      }
      const initializer = declaration.initializer && unwrapExpression(declaration.initializer);
      const inventory = initializer && staticInventory(initializer);
      if (!inventory) continue;
      inventories.push({
        count: inventory.count,
        kind: inventory.kind,
        name: declaration.name.text,
      });
    }
  }

  let syntaxGuardSites = 0;
  let syntaxKindSites = 0;
  let directNamePredicates = 0;
  let inlineMembershipEntries = 0;
  let switchLiteralCases = 0;

  visit(sourceFile, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      isSyntaxGuardNamespace(node.expression.expression) &&
      /^is[A-Z]/u.test(node.expression.name.text)
    ) {
      syntaxGuardSites += 1;
    }
    if (ts.isPropertyAccessExpression(node) && isSyntaxKindNamespace(node.expression)) {
      syntaxKindSites += 1;
    }
    if (
      ts.isBinaryExpression(node) &&
      isEqualityOperator(node.operatorToken.kind) &&
      (isStaticNameLiteral(node.left) || isStaticNameLiteral(node.right))
    ) {
      directNamePredicates += 1;
    }
    if (ts.isCaseClause(node) && isStaticNameLiteral(node.expression)) {
      switchLiteralCases += 1;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'includes'
    ) {
      const receiver = unwrapExpression(node.expression.expression);
      if (ts.isArrayLiteralExpression(receiver)) {
        inlineMembershipEntries += receiver.elements.filter(isStaticNameLiteral).length;
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'has'
    ) {
      const receiver = unwrapExpression(node.expression.expression);
      if (
        ts.isNewExpression(receiver) &&
        ts.isIdentifier(receiver.expression) &&
        receiver.expression.text === 'Set'
      ) {
        inlineMembershipEntries += arrayLiteralEntryCount(receiver.arguments?.[0]);
      }
    }
  });

  inventories.sort((left, right) => compareText(left.name, right.name));
  const namedInventoryEntries = inventories.reduce((count, row) => count + row.count, 0);
  const syntaxBranches = syntaxGuardSites + syntaxKindSites;
  const nameBranches =
    namedInventoryEntries + directNamePredicates + inlineMembershipEntries + switchLiteralCases;
  return {
    directNamePredicates,
    inlineMembershipEntries,
    nameBranches,
    namedInventoryEntries,
    namedInventorySha256: sha256(JSON.stringify(inventories)),
    namedInventoryTableCount: inventories.length,
    switchLiteralCases,
    syntaxBranches,
    syntaxGuardSites,
    syntaxKindSites,
    total: syntaxBranches + nameBranches,
  };
}

export function measureImperativeDomSinkLexicon(source) {
  const sourceFile = parseTypescript(source, TRUST_STATIC_FILE);
  // The former raw-handler callback classifier was deleted under C13. Only the residual global
  // dangerous-call recognizer used by authoritative request/process reachability belongs here.
  const functionNames = new Set(['dangerousCallSink']);
  const sinkNames = new Set();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isFunctionDeclaration(statement) ||
      !statement.name ||
      !functionNames.has(statement.name.text)
    ) {
      continue;
    }
    visit(statement, (node) => {
      if (ts.isBinaryExpression(node) && isEqualityOperator(node.operatorToken.kind)) {
        const literal = staticStringOperand(node.left) ?? staticStringOperand(node.right);
        if (
          literal &&
          [
            'innerHTML',
            'outerHTML',
            'eval',
            'setTimeout',
            'setInterval',
            'write',
            'writeln',
          ].includes(literal)
        ) {
          sinkNames.add(literal);
        }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'unshadowedGlobalIdentifier' &&
        node.arguments[1] &&
        ts.isStringLiteralLike(node.arguments[1]) &&
        node.arguments[1].text === 'Function'
      ) {
        sinkNames.add('Function');
      }
    });
  }

  return { sinkNames: [...sinkNames].sort(compareText) };
}

export function measureEgressObligations(source) {
  const sourceFile = parseTypescript(source, EGRESS_FILE);
  const rangeTables = new Map();
  const metadataAddresses = new Set();
  const allowConditions = [];

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          !ts.isIdentifier(declaration.name) ||
          !EGRESS_RANGE_TABLES.includes(declaration.name.text)
        ) {
          continue;
        }
        const initializer = declaration.initializer && unwrapExpression(declaration.initializer);
        if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
          throw new TypeError(`${declaration.name.text} must remain one explicit range table.`);
        }
        rangeTables.set(declaration.name.text, initializer.elements.length);
      }
    }
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === 'classifyIpv4') {
      visit(statement, (node) => {
        if (!ts.isStringLiteralLike(node)) return;
        if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(node.text)) metadataAddresses.add(node.text);
      });
    }
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === 'classifyIpv6Bytes') {
      visit(statement, (node) => {
        if (ts.isStringLiteralLike(node) && node.text === 'fd00:ec2::254') {
          metadataAddresses.add(node.text);
        }
      });
    }
    if (
      ts.isFunctionDeclaration(statement) &&
      (statement.name?.text === 'evaluateEgressDecision' ||
        statement.name?.text === 'evaluateDestinationAllowlist')
    ) {
      visit(statement, (node) => {
        if (!ts.isIfStatement(node) || !directlyReturnsNull(node.thenStatement)) return;
        const condition = normalizeSourceText(node.expression.getText(sourceFile));
        if (condition === "cls === 'public'") return;
        allowConditions.push(condition);
      });
    }
  }

  const rangeTableRows = EGRESS_RANGE_TABLES.map((name) => {
    const count = rangeTables.get(name);
    if (count === undefined) throw new TypeError(`Missing egress range table ${name}.`);
    return { count, name };
  });
  const opaqueAllowPaths = [...new Set(allowConditions)].sort(compareText);
  return {
    exactMetadataAddressCount: metadataAddresses.size,
    exactMetadataAddresses: [...metadataAddresses].sort(compareText),
    opaqueAllowPathCount: opaqueAllowPaths.length,
    opaqueAllowPaths,
    rangeEntryCount: rangeTableRows.reduce((count, row) => count + row.count, 0),
    rangeTables: rangeTableRows,
  };
}

export async function measureLiveSecurityConvergence(options = {}) {
  const mutationResults = await (options.runMutants ?? runSecurityGateMutationHarness)({
    mutants: options.mutants ?? SECURITY_GATE_MUTANTS,
  });
  const killed = mutationResults.filter((result) => result.status === 'killed');
  const green = (options.measureGreen ?? measureGreenCorpusCommand)({
    repoRoot: options.repoRoot ?? findRepoRoot(),
  });
  return {
    g: green,
    m: {
      killed: killed.length,
      survivors: mutationResults
        .filter((result) => result.status !== 'killed')
        .map((result) => ({ name: result.name, status: result.status })),
      total: mutationResults.length,
    },
  };
}

export function measureGreenCorpusCommand(options = {}) {
  const root = options.repoRoot ?? findRepoRoot();
  const platform = options.platform ?? process.platform;
  const runner = options.runner ?? spawnSync;
  const timeArgs = platform === 'darwin' ? ['-l'] : ['-v'];
  const started = process.hrtime.bigint();
  const result = runner('/usr/bin/time', [...timeArgs, 'pnpm', 'run', 'check:green-corpus'], {
    cwd: root,
    encoding: 'utf8',
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) {
    throw new Error(`Green-corpus measurement failed.\n${output.trim()}`);
  }
  const peakRssBytes = parsePeakRss(output, platform);
  if (peakRssBytes === undefined) {
    throw new Error(`Could not parse peak RSS from /usr/bin/time output on ${platform}.`);
  }
  return {
    durationMs: Math.round(durationMs),
    peakRssBytes,
    platform,
  };
}

export function parsePeakRss(output, platform) {
  if (platform === 'darwin') {
    const match = /^\s*(\d+)\s+maximum resident set size\s*$/imu.exec(output);
    return match?.[1] ? Number(match[1]) : undefined;
  }
  const match = /Maximum resident set size \(kbytes\):\s*(\d+)/iu.exec(output);
  return match?.[1] ? Number(match[1]) * 1024 : undefined;
}

export function compareSnapshot(expected, actual) {
  const expectedText = `${JSON.stringify(expected, null, 2)}\n`;
  const actualText = `${JSON.stringify(actual, null, 2)}\n`;
  return expectedText === actualText ? [] : ['deterministic convergence snapshot drifted'];
}

export async function main(options = {}) {
  const root = options.repoRoot ?? findRepoRoot();
  const baselinePath = path.join(root, options.baselineFile ?? DEFAULT_BASELINE_FILE);
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const actual = collectSecurityConvergenceSnapshot({ repoRoot: root });
  const findings = compareSnapshot(baseline.currentSnapshot?.snapshot, actual);
  if (baseline.schema !== 'kovo-security-convergence-record/v2') {
    findings.push('committed convergence record schema is unsupported');
  }
  if (!/^[0-9a-f]{40}$/u.test(baseline.currentSnapshot?.measuredCodeSha ?? '')) {
    findings.push('current structural snapshot is missing its exact measured code SHA');
  }
  if (!Array.isArray(baseline.historicalRows) || baseline.historicalRows.length === 0) {
    findings.push('convergence record must preserve at least one immutable historical row');
  }
  for (const [index, row] of (baseline.historicalRows ?? []).entries()) {
    const auditRound = row?.auditRound;
    if (
      typeof auditRound?.file !== 'string' ||
      typeof auditRound?.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(row?.snapshotSha256 ?? '')
    ) {
      findings.push(`historical convergence row ${index} is incomplete`);
      continue;
    }
    const auditRoundSource = readFileSync(path.join(root, auditRound.file), 'utf8');
    if (sha256(auditRoundSource) !== auditRound.sha256) {
      findings.push(`executed audit-round record ${index} drifted`);
    }
  }
  if (findings.length > 0) {
    process.stderr.write(
      `${BASELINE_SCHEMA} FAIL: deterministic metrics changed; review and record a new exact-SHA row.\n`,
    );
    return false;
  }
  if (options.live === true) {
    const live = await measureLiveSecurityConvergence({ repoRoot: root });
    if (live.m.survivors.length > 0) {
      process.stderr.write(`${BASELINE_SCHEMA} FAIL survivors=${live.m.survivors.length}\n`);
      return false;
    }
    process.stdout.write(
      `${BASELINE_SCHEMA} LIVE mutants=${live.m.killed}/${live.m.total} greenMs=${live.g.durationMs} peakRssBytes=${live.g.peakRssBytes}\n`,
    );
  } else {
    process.stdout.write(
      `${BASELINE_SCHEMA} OK sha=${baseline.currentSnapshot.measuredCodeSha} mutants=${actual.m.mutantCount} P=${actual.p.total} greenRows=${actual.g.acceptedFixtureRows} c13=${actual.c13.corpusCount}/${actual.c13.anchorCount}\n`,
    );
  }
  return true;
}

function parseTypescript(source, fileName) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function staticInventory(initializer) {
  const unwrapped = unwrapExpression(initializer);
  if (ts.isArrayLiteralExpression(unwrapped)) {
    return { count: unwrapped.elements.length, kind: 'array' };
  }
  if (ts.isObjectLiteralExpression(unwrapped)) {
    return { count: unwrapped.properties.length, kind: 'record' };
  }
  if (
    ts.isNewExpression(unwrapped) &&
    ts.isIdentifier(unwrapped.expression) &&
    (unwrapped.expression.text === 'Set' || unwrapped.expression.text === 'Map')
  ) {
    const count = staticArrayEntryCount(unwrapped.arguments?.[0]);
    if (count === undefined) return undefined;
    return { count, kind: unwrapped.expression.text.toLowerCase() };
  }
  if (
    ts.isCallExpression(unwrapped) &&
    ts.isPropertyAccessExpression(unwrapped.expression) &&
    (unwrapped.expression.name.text === 'map' || unwrapped.expression.name.text === 'filter')
  ) {
    const count = staticArrayEntryCount(unwrapped.expression.expression);
    if (count === undefined) return undefined;
    return { count, kind: `array-${unwrapped.expression.name.text}` };
  }
  return undefined;
}

function arrayLiteralEntryCount(expression) {
  return staticArrayEntryCount(expression) ?? 0;
}

function staticArrayEntryCount(expression) {
  if (!expression) return 0;
  const unwrapped = unwrapExpression(expression);
  if (ts.isArrayLiteralExpression(unwrapped)) return unwrapped.elements.length;
  if (
    ts.isCallExpression(unwrapped) &&
    ts.isPropertyAccessExpression(unwrapped.expression) &&
    (unwrapped.expression.name.text === 'map' || unwrapped.expression.name.text === 'filter')
  ) {
    return staticArrayEntryCount(unwrapped.expression.expression);
  }
  return undefined;
}

function isEqualityOperator(kind) {
  return (
    kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    kind === ts.SyntaxKind.EqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsToken
  );
}

function isStaticNameLiteral(node) {
  return ts.isStringLiteralLike(node) || ts.isNumericLiteral(node);
}

function isSyntaxGuardNamespace(node) {
  return (
    (ts.isIdentifier(node) && node.text === 'Node') || (ts.isIdentifier(node) && node.text === 'ts')
  );
}

function isSyntaxKindNamespace(node) {
  if (ts.isIdentifier(node)) return node.text === 'SyntaxKind';
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'ts' &&
    node.name.text === 'SyntaxKind'
  );
}

function staticStringOperand(node) {
  return ts.isStringLiteralLike(node) ? node.text : undefined;
}

function directlyReturnsNull(statement) {
  if (ts.isReturnStatement(statement))
    return statement.expression?.kind === ts.SyntaxKind.NullKeyword;
  if (!ts.isBlock(statement) || statement.statements.length !== 1) return false;
  return directlyReturnsNull(statement.statements[0]);
}

function normalizeSourceText(source) {
  return source.replace(/\s+/gu, ' ').trim();
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function lineCount(source) {
  return source.length === 0 ? 0 : source.split('\n').length;
}

function sha256(source) {
  return createHash('sha256').update(source).digest('hex');
}

if (isMainEntry(import.meta.url)) {
  await runGate(() => main({ live: process.argv.includes('--live') }));
}
