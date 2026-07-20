#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { REQUIRED_CLASSIFIER_CORPORA } from './check-security-classifier-corpus.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import {
  canonicalJson,
  evaluateSecurityCarrierGrammar,
  evaluateSecurityCoverageManifest,
  extractSecurityCoverageVocabularyFromCoreSource,
  generatedCarrierGrammarDocument,
  generatedCoverageDocument,
  securityCarrierProductions,
  securityCoverageVocabulary,
} from './security-coverage.mjs';

export const repoRoot = findRepoRoot();
export const securityCoverageManifestPath = 'security/security-coverage.json';
export const securityCarrierGrammarPath = 'security/security-carrier-grammar.json';
const coreInventoryPath = 'packages/core/src/internal/security-operation-ir.ts';
const reviewedCoverageCellCount = 48;

export function evaluateSecurityCoverageFiles({ rootDir = repoRoot } = {}) {
  const findings = [];
  let vocabulary;
  try {
    vocabulary = extractSecurityCoverageVocabularyFromCoreSource(
      readFileSync(path.join(rootDir, coreInventoryPath), 'utf8'),
    );
  } catch (error) {
    findings.push(error instanceof Error ? error.message : String(error));
  }
  if (vocabulary) {
    const actualCellCount = Object.values(vocabulary).reduce(
      (count, values) => count + values.length,
      0,
    );
    if (actualCellCount !== reviewedCoverageCellCount) {
      findings.push(
        `security coverage denominator changed: expected ${reviewedCoverageCellCount}, received ${actualCellCount}`,
      );
    }
  }

  const coverage = readJson(rootDir, securityCoverageManifestPath, findings);
  const grammar = readJson(rootDir, securityCarrierGrammarPath, findings);
  const coverageResult = evaluateSecurityCoverageManifest({
    corpora: REQUIRED_CLASSIFIER_CORPORA,
    document: coverage,
    vocabulary: vocabulary ?? {},
  });
  const grammarResult = evaluateSecurityCarrierGrammar({
    corpora: REQUIRED_CLASSIFIER_CORPORA,
    document: grammar,
  });
  findings.push(...coverageResult.findings, ...grammarResult.findings);
  return {
    findings,
    ok: findings.length === 0,
    summary: { ...coverageResult.summary, ...grammarResult.summary },
  };
}

export function writeSecurityCoverageFiles({ rootDir = repoRoot } = {}) {
  const vocabulary = securityCoverageVocabulary();
  const coveragePath = path.join(rootDir, securityCoverageManifestPath);
  const grammarPath = path.join(rootDir, securityCarrierGrammarPath);
  const coverage = generatedCoverageDocument({
    existing: existsSync(coveragePath) ? JSON.parse(readFileSync(coveragePath, 'utf8')) : undefined,
    vocabulary,
  });
  const grammar = generatedCarrierGrammarDocument({
    corpora: REQUIRED_CLASSIFIER_CORPORA,
    existing: existsSync(grammarPath) ? JSON.parse(readFileSync(grammarPath, 'utf8')) : undefined,
    productions: securityCarrierProductions,
  });
  writeFileSync(coveragePath, canonicalJson(coverage));
  writeFileSync(grammarPath, canonicalJson(grammar));
}

export function main({ rootDir = repoRoot, write = process.argv.includes('--write') } = {}) {
  if (write) writeSecurityCoverageFiles({ rootDir });
  const result = evaluateSecurityCoverageFiles({ rootDir });
  process.stdout.write(
    `security-coverage/v1 ${result.ok ? 'OK' : 'FAIL'} cells=${result.summary.cells ?? 0} witnessed=${result.summary.witnessed ?? 0} inapplicable=${result.summary.inapplicable ?? 0} anchors=${result.summary.historicalWitnesses ?? 0}\n`,
  );
  for (const finding of result.findings) process.stderr.write(`${finding}\n`);
  return result.ok;
}

function readJson(rootDir, relativePath, findings) {
  try {
    return JSON.parse(readFileSync(path.join(rootDir, relativePath), 'utf8'));
  } catch (error) {
    findings.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

if (isMainEntry(import.meta.url)) await runGate(main);
