#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { serverValueProvenanceStates } from '../packages/compiler/src/scan/security-provenance-relation.ts';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const repoRoot = findRepoRoot();
export const precisionRegisterPath =
  'packages/compiler/src/scan/security-provenance-precision-grants.v1.json';
export const precisionDoorPath =
  'packages/compiler/src/scan/security-provenance-precision-grants.ts';
export const precisionExtractorPath = 'packages/compiler/src/scan/security-operation-ir.ts';
export const precisionGeneratorPath = 'packages/compiler/src/security-analyzer-soundness-oracle.ts';

const expectedSchema = 'kovo-security-provenance-precision-grants/v1';
const expectedExtractor = `${precisionExtractorPath}#serverExpressionProvenance`;
const expectedFinalPrerequisites = Object.freeze([
  'serverObjectLiteralHasImplicitCallable',
  'expressionContainsServerForeignExecutable',
  'expressionContainsServerAuthority',
]);

export function loadProvenancePrecisionRegisterInputs({ root = repoRoot } = {}) {
  return {
    document: JSON.parse(readFileSync(path.join(root, precisionRegisterPath), 'utf8')),
    sources: {
      [precisionDoorPath]: readFileSync(path.join(root, precisionDoorPath), 'utf8'),
      [precisionExtractorPath]: readFileSync(path.join(root, precisionExtractorPath), 'utf8'),
      [precisionGeneratorPath]: readFileSync(path.join(root, precisionGeneratorPath), 'utf8'),
    },
  };
}

export function evaluateProvenancePrecisionRegister({ document, sources }) {
  const findings = [];
  if (!plainObject(document)) {
    return result(['precision-grant register must be an object']);
  }
  if (document.schema !== expectedSchema) findings.push(`schema must be ${expectedSchema}`);
  if (document.authorityTop !== 'unknown-authority') {
    findings.push('authorityTop must remain unknown-authority');
  }
  if (document.extractor !== expectedExtractor) {
    findings.push(`extractor must be ${expectedExtractor}`);
  }

  const rows = Array.isArray(document.rows) ? document.rows : [];
  if (!Array.isArray(document.rows)) findings.push('rows must be an array');
  const rowIds = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!plainObject(row) || typeof row.id !== 'string' || row.id.length === 0) {
      findings.push(`row ${index} must have a non-empty id`);
      continue;
    }
    rowIds.push(row.id);
    if (typeof row.owner !== 'string' || row.owner.trim().length === 0) {
      findings.push(`${row.id}: ownerless precision grants are forbidden`);
    }
    if (typeof row.semanticsWitness !== 'string' || row.semanticsWitness.trim().length < 80) {
      findings.push(`${row.id}: JS-semantics witness must contain at least 80 characters`);
    }
    if (typeof row.generatorTransfer !== 'string' || row.generatorTransfer.length === 0) {
      findings.push(`${row.id}: generatorTransfer must be non-empty`);
    }
    if (
      !serverValueProvenanceStates.includes(row.generatorExpectedProvenance) ||
      row.generatorExpectedProvenance === 'unknown-authority'
    ) {
      findings.push(`${row.id}: generator must witness a declared concrete below-top provenance`);
    }
    if (
      !Array.isArray(row.prerequisites) ||
      row.prerequisites.some((value) => typeof value !== 'string' || value.length === 0)
    ) {
      findings.push(`${row.id}: prerequisites must be an array of non-empty names`);
    }
  }
  if (new Set(rowIds).size !== rowIds.length) findings.push('precision-grant ids must be unique');

  const extractorSource = sources[precisionExtractorPath];
  const doorSource = sources[precisionDoorPath];
  const generatorSource = sources[precisionGeneratorPath];
  if (typeof extractorSource !== 'string') findings.push(`${precisionExtractorPath}: missing`);
  if (typeof doorSource !== 'string') findings.push(`${precisionDoorPath}: missing`);
  if (typeof generatorSource !== 'string') findings.push(`${precisionGeneratorPath}: missing`);
  if (findings.some((finding) => finding.endsWith(': missing'))) return result(findings, rows);

  const grants = extractPrecisionReturns(extractorSource);
  for (const missing of grants.unregistered) {
    findings.push(`${precisionExtractorPath}:${missing}: below-top return has no precision grant`);
  }
  if (!exactStrings(grants.ids, rowIds)) {
    findings.push(
      `extractor precision grants must equal register rows in order; extractor=${grants.ids.join(',')} register=${rowIds.join(',')}`,
    );
  }

  const doorIds = extractConstStringArray(
    doorSource,
    precisionDoorPath,
    'serverProvenancePrecisionGrantIds',
  );
  if (!exactStrings(doorIds, rowIds)) {
    findings.push('runtime precision-grant ids must equal register rows in order');
  }
  for (const required of [
    'validatePrecisionGrantDocument',
    'captureServerProvenancePrecisionGrants',
    "provenance !== 'unknown-authority'",
  ]) {
    if (!doorSource.includes(required)) {
      findings.push(`${precisionDoorPath}: missing fail-closed runtime fragment ${required}`);
    }
  }

  const finalRow = rows.find((row) => row?.id === 'fallthrough-contained-local');
  if (!exactStrings(finalRow?.prerequisites, expectedFinalPrerequisites)) {
    findings.push(
      `fallthrough-contained-local prerequisites must equal ${expectedFinalPrerequisites.join(',')}`,
    );
  }
  const finalGrant = grants.argumentsById.get('fallthrough-contained-local') ?? '';
  for (const prerequisite of expectedFinalPrerequisites) {
    if (
      !extractorSource.includes(prerequisite) ||
      !finalGrant.includes('expressionContainsServerAuthority')
    ) {
      findings.push(`final local grant must remain behind ${prerequisite}`);
    }
  }

  const generatorCases = extractSwitchCaseStrings(
    generatorSource,
    precisionGeneratorPath,
    'precisionGrantWitnessSource',
  );
  if (!exactStrings(generatorCases, rowIds)) {
    findings.push('precision witness generator cases must equal register rows in order');
  }
  for (const fragment of [
    'serverProvenancePrecisionGrantRows.map',
    'captureServerProvenancePrecisionGrants',
    'witnessedPrecisionGrants',
    'candidate.id === witness.id',
    'candidate.provenance === witness.expectedProvenance',
    'abstractCapture.witnessedTransfers.includes(witness.transferId)',
  ]) {
    if (!generatorSource.includes(fragment)) {
      findings.push(`${precisionGeneratorPath}: register-derived generator missing ${fragment}`);
    }
  }

  return result(findings, rows);
}

export function extractPrecisionReturns(source) {
  const sourceFile = ts.createSourceFile(
    precisionExtractorPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declaration = findFunction(sourceFile, 'serverExpressionProvenance');
  if (declaration?.body === undefined) {
    return { argumentsById: new Map(), ids: [], unregistered: ['missing-extractor'] };
  }
  const argumentsById = new Map();
  const ids = [];
  const unregistered = [];
  const visit = (node) => {
    if (node !== declaration && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      const expression = node.expression;
      if (ts.isStringLiteralLike(expression) && expression.text === 'unknown-authority') return;
      if (
        ts.isCallExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === 'serverPrecisionGrant' &&
        expression.arguments.length === 2 &&
        ts.isStringLiteralLike(expression.arguments[0])
      ) {
        const id = expression.arguments[0].text;
        ids.push(id);
        argumentsById.set(id, expression.arguments[1].getText(sourceFile));
      } else {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        unregistered.push(line);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration);
  return { argumentsById, ids, unregistered };
}

function extractConstStringArray(source, file, name) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let declaration;
  const visit = (node) => {
    if (
      declaration === undefined &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      declaration = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  let initializer = declaration?.initializer;
  while (initializer && (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer))) {
    initializer = initializer.expression;
  }
  return ts.isArrayLiteralExpression(initializer)
    ? initializer.elements.flatMap((element) =>
        ts.isStringLiteralLike(element) ? [element.text] : [],
      )
    : [];
}

function extractSwitchCaseStrings(source, file, name) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const declaration = findFunction(sourceFile, name);
  if (declaration?.body === undefined) return [];
  const cases = [];
  const visit = (node) => {
    if (ts.isCaseClause(node) && ts.isStringLiteralLike(node.expression)) {
      cases.push(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.body);
  return cases;
}

function findFunction(sourceFile, name) {
  let declaration;
  const visit = (node) => {
    if (declaration === undefined && ts.isFunctionDeclaration(node) && node.name?.text === name) {
      declaration = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return declaration;
}

function exactStrings(actual, expected) {
  return (
    Array.isArray(actual) &&
    Array.isArray(expected) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function result(findings, rows = []) {
  return {
    findings: [...new Set(findings)].sort(),
    ok: findings.length === 0,
    ownerless: rows.filter((row) => typeof row?.owner !== 'string' || row.owner.trim() === '')
      .length,
    rows: rows.length,
  };
}

export async function main(options = {}) {
  const evaluation = evaluateProvenancePrecisionRegister(
    loadProvenancePrecisionRegisterInputs(options),
  );
  process.stdout.write(
    `${expectedSchema} ${evaluation.ok ? 'OK' : 'FAIL'} rows=${evaluation.rows} ownerless=${evaluation.ownerless}\n`,
  );
  for (const finding of evaluation.findings) process.stderr.write(`- ${finding}\n`);
  return evaluation.ok;
}

if (isMainEntry(import.meta.url)) await runGate(main);
