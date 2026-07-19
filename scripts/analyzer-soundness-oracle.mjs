#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import {
  securitySemanticBudgets,
  serverValueProvenanceStates,
} from '../packages/compiler/src/scan/security-provenance-relation.ts';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot } from './lib/repo-root.mjs';

export const analyzerSoundnessCensusSchema = 'kovo-security-abstract-interpreter-census/v1';
export const analyzerSoundnessCensusPath =
  'packages/compiler/src/scan/security-abstract-interpreter-census.v1.json';

const productionPaths = [
  'packages/compiler/src/scan/security-abstract-interpreter.ts',
  'packages/compiler/src/scan/security-operation-ir.ts',
  'packages/compiler/src/security-analyzer-soundness-oracle.ts',
];
const transferImplementationPath = productionPaths[0];
const scannerPath = productionPaths[1];
const generatorPath = productionPaths[2];

export function validateAnalyzerSoundnessCensus({
  census,
  generatorIds,
  productionSources,
  rootDir = repoRoot(),
} = {}) {
  const findings = [];
  const document =
    census ?? JSON.parse(readFileSync(path.join(rootDir, analyzerSoundnessCensusPath), 'utf8'));
  if (!plainObject(document)) return result(['census root must be an object']);
  if (document.schema !== analyzerSoundnessCensusSchema) {
    findings.push(`schema must be ${analyzerSoundnessCensusSchema}`);
  }
  if (document.version !== 1) findings.push('version must be 1');
  if (document.provenanceRelationSchema !== 'kovo-security-provenance-relation/v1') {
    findings.push('provenanceRelationSchema must bind the finite v1 provenance artifact');
  }

  const latticeElements = document.lattice?.elements;
  if (!exactStrings(latticeElements, serverValueProvenanceStates)) {
    findings.push('lattice.elements must equal the exact production server provenance vocabulary');
  }
  if (document.lattice?.top !== 'unknown-authority') {
    findings.push('lattice.top must remain unknown-authority');
  }
  if (!deepEqual(document.resourceBounds, securitySemanticBudgets)) {
    findings.push('resourceBounds must equal the production semantic resource ceilings');
  }
  validateLanguage(document.language, findings);
  const transferRows = Array.isArray(document.transfers) ? document.transfers : [];
  if (!Array.isArray(document.transfers)) findings.push('transfers must be an array');
  const transferIds = transferRows.map((row) => row?.id);
  const productions = transferRows.map((row) => row?.production);
  if (
    productions.some((value) => typeof value !== 'string' || value.length === 0) ||
    new Set(productions).size !== productions.length
  ) {
    findings.push('every transfer must own one non-empty unique generator production');
  }
  if (
    transferRows.some(
      (row) => !plainObject(row) || typeof row.semantics !== 'string' || row.semantics.length === 0,
    )
  ) {
    findings.push('every transfer must declare its finite abstract semantics');
  }

  const defaultSources = Object.fromEntries(
    productionPaths.map((file) => [file, readFileSync(path.join(rootDir, file), 'utf8')]),
  );
  const sources = { ...defaultSources, ...productionSources };
  const productionTransferIds = extractConstStringArray(
    sources[transferImplementationPath],
    transferImplementationPath,
    'securityAbstractTransferIds',
  );
  if (!exactStrings(transferIds, productionTransferIds)) {
    findings.push('transfer rows must equal the exact production transfer vocabulary in order');
  }
  if (new Set(transferIds).size !== transferIds.length) {
    findings.push('transfer rows must have unique ids');
  }
  for (const field of ['callDepth', 'nodes', 'operations', 'summaries']) {
    if (!sources[scannerPath].includes(`securityAbstractInterpreterBudgets.${field}`)) {
      findings.push(`production analyzer must consume census resource bound ${field}`);
    }
  }
  const markers = [];
  for (const [file, source] of Object.entries(sources)) {
    markers.push(...extractSecurityAbstractTransferMarkers(source, file));
  }
  const invalidMarkers = markers.filter((marker) => marker.id === undefined);
  for (const marker of invalidMarkers) {
    findings.push(`${marker.file}:${marker.line}: transfer marker must use one string literal id`);
  }
  const markerIds = [...new Set(markers.flatMap((marker) => (marker.id ? [marker.id] : [])))];
  for (const id of markerIds) {
    if (!transferIds.includes(id)) findings.push(`production transfer ${id} has no census row`);
  }
  for (const id of transferIds) {
    if (!markerIds.includes(id)) findings.push(`census transfer ${id} has no production marker`);
  }

  const actualGeneratorIds =
    generatorIds ??
    extractConstStringArray(sources[generatorPath], generatorPath, 'analyzerOracleProductionIds');
  if (!exactStrings(actualGeneratorIds, transferIds)) {
    findings.push('generator productions must cover the exact transfer census in order');
  }
  const witnessIds = extractSwitchCaseStrings(
    sources[generatorPath],
    generatorPath,
    'transferWitnessSource',
  );
  if (!sameStringSet(witnessIds, transferIds)) {
    findings.push('generated transfer witnesses must cover every census transfer exactly once');
  }
  if (!generatorWitnessesEveryLatticeElement(sources[generatorPath])) {
    findings.push('generator lattice witnesses must cover every declared lattice element');
  }

  return result(findings, {
    effectDoors: Array.isArray(document.language?.effectDoors)
      ? document.language.effectDoors.length
      : 0,
    latticeElements: Array.isArray(latticeElements) ? latticeElements.length : 0,
    productions: Array.isArray(actualGeneratorIds) ? actualGeneratorIds.length : 0,
    transfers: transferRows.length,
  });
}

function generatorWitnessesEveryLatticeElement(source) {
  const sourceFile = ts.createSourceFile(generatorPath, source, ts.ScriptTarget.Latest, true);
  let valid = false;
  const visit = (node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === 'generateAnalyzerOracleLatticeWitnesses' &&
      node.body
    ) {
      const [statement] = node.body.statements;
      const expression = ts.isReturnStatement(statement) ? statement.expression : undefined;
      const callback = ts.isCallExpression(expression) ? expression.arguments[0] : undefined;
      valid =
        node.body.statements.length === 1 &&
        ts.isCallExpression(expression) &&
        expression.expression.getText(sourceFile) ===
          'securityAbstractInterpreterCensus.lattice.elements.map' &&
        expression.arguments.length === 1 &&
        ts.isArrowFunction(callback) &&
        callback.parameters.length === 1 &&
        callback.parameters[0]?.name.getText(sourceFile) === 'element' &&
        callback.body.getText(sourceFile).includes('element') &&
        callback.body.getText(sourceFile).includes("production: 'lattice-element'");
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return valid;
}

export function extractSecurityAbstractTransferMarkers(source, file = '<source>') {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const markers = [];
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'securityAbstractTransfer') {
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'securityAbstractTransfer'
    ) {
      const argument = node.arguments[0];
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      markers.push({
        file,
        id: argument && ts.isStringLiteralLike(argument) ? argument.text : undefined,
        line,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return markers;
}

export function extractConstStringArray(source, file, name) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let initializer;
  const visit = (node) => {
    if (
      initializer === undefined &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      initializer = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  let current = initializer;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current))
  ) {
    current = current.expression;
  }
  if (!current || !ts.isArrayLiteralExpression(current)) return [];
  return current.elements.flatMap((element) =>
    ts.isStringLiteralLike(element) ? [element.text] : [],
  );
}

export function extractSwitchCaseStrings(source, file, functionName) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let declaration;
  const visit = (node) => {
    if (
      declaration === undefined &&
      ts.isFunctionDeclaration(node) &&
      node.name?.text === functionName
    ) {
      declaration = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!declaration?.body) return [];
  const cases = [];
  const collect = (node) => {
    if (ts.isCaseClause(node) && ts.isStringLiteralLike(node.expression)) {
      cases.push(node.expression.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(declaration.body);
  return cases;
}

function validateLanguage(language, findings) {
  if (!plainObject(language)) {
    findings.push('language must be an object');
    return;
  }
  if (language.schema !== 'kovo-security-analyzer-language/v1') {
    findings.push('language.schema must be kovo-security-analyzer-language/v1');
  }
  if (language.seedAlgorithm !== 'mulberry32' || language.defaultSeed !== '0x4b564149') {
    findings.push('language must pin mulberry32 seed 0x4b564149');
  }
  for (const [name, minimum] of [
    ['generatedProgramBudget', 9],
    ['maxAliasDepth', 1],
    ['maxHelperDepth', 1],
    ['maxStatements', 1],
  ]) {
    if (!Number.isSafeInteger(language[name]) || language[name] < minimum) {
      findings.push(`language.${name} must be an integer at least ${minimum}`);
    }
  }
  if (
    typeof language.observation !== 'string' ||
    !language.observation.includes('effect-door') ||
    !language.observation.includes('no Proxy')
  ) {
    findings.push('language.observation must require explicit effect-door stubs and forbid Proxy');
  }
  if (
    !Array.isArray(language.excludedJavaScriptSemantics) ||
    language.excludedJavaScriptSemantics.length < 6 ||
    language.excludedJavaScriptSemantics.some(
      (entry) => typeof entry !== 'string' || entry.length === 0,
    )
  ) {
    findings.push('language must publish at least six explicit non-empty JavaScript exclusions');
  }
  if (
    !Array.isArray(language.effectDoors) ||
    language.effectDoors.length !== 9 ||
    new Set(language.effectDoors).size !== language.effectDoors.length
  ) {
    findings.push('language.effectDoors must keep the nine explicit generated observation doors');
  }
}

function exactStrings(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function sameStringSet(actual, expected) {
  return (
    new Set(actual).size === actual.length &&
    new Set(expected).size === expected.length &&
    exactStrings(
      [...actual].sort((left, right) => left.localeCompare(right)),
      [...expected].sort((left, right) => left.localeCompare(right)),
    )
  );
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function result(findings, summary = {}) {
  return { findings, ok: findings.length === 0, summary };
}

async function main() {
  const check = validateAnalyzerSoundnessCensus();
  if (!check.ok) throw new Error(check.findings.join('\n'));
  process.stdout.write(
    `analyzer-soundness-census/v1 lattice=${check.summary.latticeElements} transfers=${check.summary.transfers} productions=${check.summary.productions} doors=${check.summary.effectDoors} OK\n`,
  );
}

if (isMainEntry(import.meta.url)) await runGate(main);
