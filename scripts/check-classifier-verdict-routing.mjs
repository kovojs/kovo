#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { staticClassifierGateResult } from './lib/paranoid-mode.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import { collectSourceFiles, securityMarkerSourceRoots } from './lib/source-files.mjs';

export const repoRoot = findRepoRoot();

export function checkClassifierVerdictRouting(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const roots = options.roots ?? securityMarkerSourceRoots(root);
  const files =
    options.files ??
    collectSourceFiles(root, roots, {
      productionRoots: options.productionRoots ?? roots,
    });
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const findings = [];

  for (const file of files) {
    const sourceFile = ts.createSourceFile(
      file,
      readText(file),
      ts.ScriptTarget.Latest,
      true,
      scriptKind(file),
    );
    findings.push(...classifySourceFile(sourceFile));
  }

  const denialSites =
    options.denialSites ??
    (options.files === undefined && options.repoRoot === undefined
      ? loadSecurityEventDenialSites(root, files, readText, findings)
      : []);
  for (const site of denialSites) {
    findings.push(...classifyDenialSite(site, readText));
  }

  return staticClassifierGateResult(
    {
      findings,
      scanned: files.length,
      cleanSummary: (scanned, paranoidMode) =>
        `OK ${scanned} source file(s) scanned${
          paranoidMode
            ? ' (paranoid static classifiers advisory; runtime chokes are proof boundary)'
            : ''
        }`,
      violationSummary: (count, paranoidMode) =>
        `${count} classifier verdict routing violation(s)${
          paranoidMode
            ? ' (advisory under KOVO_PARANOID=1; runtime chokes remain the proof boundary)'
            : ''
        }`,
    },
    options,
  );
}

function loadSecurityEventDenialSites(root, files, readText, findings) {
  const file = path.join(root, 'security/security-event-denial-sites.json');
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      parsed.schema !== 'kovo-security-event-denial-sites/v1' ||
      !Array.isArray(parsed.denialSites)
    ) {
      findings.push('security/security-event-denial-sites.json: invalid denial-site census');
      return [];
    }
    const runtimeTypes = runtimeSecurityEventTypes(root, findings).sort(compareStrings);
    findings.push(...securityEventTypeProjectionFindings(parsed.denialSites, runtimeTypes));
    findings.push(...securityEventDenialMarkerCensusFindings(parsed.denialSites, files, readText));
    return parsed.denialSites;
  } catch {
    findings.push(
      'security/security-event-denial-sites.json: missing or unreadable denial-site census',
    );
    return [];
  }
}

export function securityEventTypeProjectionFindings(denialSites, runtimeTypes) {
  const projected = [...new Set(denialSites.map((site) => site?.eventType))].sort(compareStrings);
  const declared = [...runtimeTypes].sort(compareStrings);
  return JSON.stringify(projected) === JSON.stringify(declared)
    ? []
    : [
        'packages/server/src/security-event.ts: SECURITY_EVENT_TYPES must equal the denial-site census projection',
      ];
}

function runtimeSecurityEventTypes(root, findings) {
  const relativePath = 'packages/server/src/security-event.ts';
  let source;
  try {
    source = readFileSync(path.join(root, relativePath), 'utf8');
  } catch {
    findings.push(`${relativePath}: runtime security-event taxonomy source is missing`);
    return [];
  }
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'SECURITY_EVENT_TYPES') {
        continue;
      }
      let initializer = declaration.initializer;
      if (initializer === undefined) break;
      initializer = unwrapExpression(initializer);
      if (ts.isCallExpression(initializer)) initializer = initializer.arguments[0];
      if (initializer === undefined) break;
      initializer = unwrapExpression(initializer);
      if (!ts.isArrayLiteralExpression(initializer)) break;
      const values = [];
      for (const element of initializer.elements) {
        if (!ts.isStringLiteralLike(element)) {
          findings.push(`${relativePath}: SECURITY_EVENT_TYPES must contain only string literals`);
          return [];
        }
        values.push(element.text);
      }
      return values;
    }
  }
  findings.push(`${relativePath}: SECURITY_EVENT_TYPES literal registry is missing`);
  return [];
}

export function securityEventDenialMarkerCensusFindings(denialSites, files, readText) {
  const findings = [];
  const reviewed = new Set();
  for (const site of denialSites) {
    if (site === null || typeof site !== 'object') continue;
    if (typeof site.file !== 'string' || typeof site.marker !== 'string') continue;
    const identity = `${site.file}\0${site.marker}`;
    if (reviewed.has(identity)) {
      findings.push(
        `security/security-event-denial-sites.json: duplicate row ${site.file} ${site.marker}`,
      );
    }
    reviewed.add(identity);
  }

  const discovered = new Set();
  const markerPattern = /@kovo-security-denial\s+[a-z0-9-]+\s+[a-z0-9-]+/gu;
  for (const file of files) {
    const source = readText(file);
    for (const match of source.matchAll(markerPattern)) discovered.add(`${file}\0${match[0]}`);
  }
  for (const identity of discovered) {
    if (!reviewed.has(identity)) {
      const [file, marker] = identity.split('\0');
      findings.push(`${file}: unreviewed security-event denial marker ${marker}`);
    }
  }
  for (const identity of reviewed) {
    if (!discovered.has(identity)) {
      const [file, marker] = identity.split('\0');
      findings.push(`${file}: stale security-event denial census marker ${marker}`);
    }
  }
  return findings;
}

function compareStrings(left, right) {
  return String(left).localeCompare(String(right));
}

function classifyDenialSite(site, readText) {
  if (
    site === null ||
    typeof site !== 'object' ||
    typeof site.file !== 'string' ||
    typeof site.marker !== 'string' ||
    typeof site.eventType !== 'string'
  ) {
    return ['security-event denial-site census contains an invalid row'];
  }
  let source;
  try {
    source = readText(site.file);
  } catch {
    return [`${site.file}: security-event denial-site census file is missing`];
  }
  const markerIndex = source.indexOf(site.marker);
  if (markerIndex < 0) {
    return [`${site.file}: security-event denial-site marker is missing: ${site.marker}`];
  }
  const functionStart = Math.max(
    source.lastIndexOf('function ', markerIndex),
    source.lastIndexOf('constructor(', markerIndex),
  );
  const relevant = source.slice(
    functionStart < 0 ? Math.max(0, markerIndex - 2_000) : functionStart,
    markerIndex,
  );
  const singleQuoted = `type: '${site.eventType}'`;
  const doubleQuoted = `type: "${site.eventType}"`;
  if (
    relevant.includes('securityEvent(') &&
    (relevant.includes(singleQuoted) || relevant.includes(doubleQuoted))
  ) {
    return [];
  }
  return [
    `${site.file}: denial site must emit securityEvent({ type: "${site.eventType}" }) before closing`,
  ];
}

export function main(options = {}) {
  const result = checkClassifierVerdictRouting(options);
  process.stdout.write(`check-classifier-verdict-routing/v1 ${result.summary}\n`);
  for (const finding of result.findings) process.stderr.write(`${finding}\n`);
  return result.ok;
}

function classifySourceFile(sourceFile) {
  const findings = [];
  const visit = (node) => {
    if (ts.isIfStatement(node)) collectIfStatementFinding(sourceFile, node, findings);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...new Set(findings)];
}

function collectIfStatementFinding(sourceFile, statement, findings) {
  const unsafeVariables = provenUnsafeKindVariables(statement.expression);
  if (unsafeVariables.size === 0) return;
  if (conditionClosesUnproven(statement.expression, unsafeVariables)) return;
  if (elseBranchClosesUnproven(statement.elseStatement, unsafeVariables)) return;

  findings.push(
    `${sourceFile.fileName}:${lineOf(sourceFile, statement.expression)}: ClassifierVerdict branch closes proven-unsafe without an unproven companion branch; SPEC §10.3/§11.2 require UNPROVEN to route to the same closed action`,
  );
}

function provenUnsafeKindVariables(expression) {
  const variables = new Set();
  const visit = (node) => {
    const match = kindComparison(node, 'proven-unsafe');
    if (match) variables.add(match);
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return variables;
}

function conditionClosesUnproven(expression, unsafeVariables) {
  let closes = false;
  const visit = (node) => {
    const match = kindComparison(node, 'unproven');
    if (match && unsafeVariables.has(match)) closes = true;
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return closes;
}

function elseBranchClosesUnproven(statement, unsafeVariables) {
  if (!statement) return false;
  let closes = false;
  const visit = (node) => {
    if (ts.isIfStatement(node) && conditionClosesUnproven(node.expression, unsafeVariables)) {
      closes = statementCloses(node.thenStatement);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(statement);
  return closes;
}

function statementCloses(statement) {
  if (ts.isThrowStatement(statement)) return true;
  if (ts.isBlock(statement))
    return statement.statements.some((child) => ts.isThrowStatement(child));
  return false;
}

function kindComparison(node, expected) {
  if (!ts.isBinaryExpression(node)) return undefined;
  if (!isEqualityOperator(node.operatorToken.kind)) return undefined;
  return (
    kindComparisonSide(node.left, node.right, expected) ??
    kindComparisonSide(node.right, node.left, expected)
  );
}

function kindComparisonSide(left, right, expected) {
  const kindAccess = unwrapExpression(left);
  const literal = unwrapExpression(right);
  if (!ts.isPropertyAccessExpression(kindAccess) || kindAccess.name.text !== 'kind')
    return undefined;
  if (!ts.isStringLiteralLike(literal) || literal.text !== expected) return undefined;
  const expression = unwrapExpression(kindAccess.expression);
  return ts.isIdentifier(expression) ? expression.text : undefined;
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isEqualityOperator(kind) {
  return kind === ts.SyntaxKind.EqualsEqualsToken || kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function scriptKind(file) {
  if (file.endsWith('.tsx') || file.endsWith('.mtsx') || file.endsWith('.ctsx')) {
    return ts.ScriptKind.TSX;
  }
  return ts.ScriptKind.TS;
}

if (isMainEntry(import.meta.url)) await runGate(main);
