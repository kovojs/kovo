#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildDecidedSurfaceArtifact,
  defaultDecidedSurfacePath,
  validateDecidedSurfaceArtifact,
} from './decided-surface-gate.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import { formatRepositoryJson } from './lib/repository-json.mjs';
import {
  assertCleanCurrentCodeSubject,
  parseExactCliArguments,
} from './lib/security-evidence-subject.mjs';
import {
  collectSecurityConvergenceSnapshot,
  defaultSecurityConvergenceBaselinePath,
  updateSecurityConvergenceRecord,
  validateSecurityConvergenceRecord,
} from './security-convergence-baseline.mjs';

export function parseFinalSecurityEvidenceArguments(args) {
  return parseExactCliArguments(args, {
    command: '--write',
    valueFlags: ['--subject-sha', '--reason'],
  });
}

/**
 * Generate both final-candidate artifacts from one clean code subject. All computation and
 * validation happens before either destination changes, and both artifacts must name the same
 * subject. The individual artifact writers remain strict for standalone use.
 */
export async function writeFinalSecurityEvidence({
  codeSubjectSha,
  operations = {},
  reason,
  repoRoot = findRepoRoot(),
} = {}) {
  const baselinePath = path.join(repoRoot, defaultSecurityConvergenceBaselinePath);
  const decidedPath = path.join(repoRoot, defaultDecidedSurfacePath);
  const assertClean = operations.assertCleanCurrentCodeSubject ?? assertCleanCurrentCodeSubject;
  const readBaseline =
    operations.readBaseline ?? (() => JSON.parse(readFileSync(baselinePath, 'utf8')));
  const collectSnapshot =
    operations.collectSecurityConvergenceSnapshot ?? collectSecurityConvergenceSnapshot;
  const updateRecord =
    operations.updateSecurityConvergenceRecord ?? updateSecurityConvergenceRecord;
  const buildDecided = operations.buildDecidedSurfaceArtifact ?? buildDecidedSurfaceArtifact;
  const validateConvergence =
    operations.validateSecurityConvergenceRecord ?? validateSecurityConvergenceRecord;
  const validateDecided =
    operations.validateDecidedSurfaceArtifact ?? validateDecidedSurfaceArtifact;
  const writeFiles = operations.writeFinalSecurityEvidenceFiles ?? writeFinalSecurityEvidenceFiles;
  const formatJson = operations.formatRepositoryJson ?? formatRepositoryJson;

  assertClean({ repoRoot, subjectSha: codeSubjectSha });

  const snapshot = collectSnapshot({ repoRoot });
  const convergence = updateRecord({
    baseline: readBaseline(),
    codeSubjectSha,
    reason,
    repoRoot,
    snapshot,
  });
  const decided = buildDecided({ codeSubjectSha, repoRoot });

  if (
    convergence?.currentSnapshot?.measuredCodeSha !== codeSubjectSha ||
    decided?.subject?.codeSubjectSha !== codeSubjectSha
  ) {
    throw new Error('final security evidence artifacts must name the same requested code subject');
  }

  const convergenceCheck = validateConvergence(convergence, {
    actualSnapshot: snapshot,
    repoRoot,
    requireLive: true,
  });
  if (!convergenceCheck?.ok) {
    throw new Error(
      `generated convergence evidence is invalid:\n${convergenceCheck?.findings?.join('\n') ?? 'unknown validation failure'}`,
    );
  }
  const decidedCheck = validateDecided(decided, { repoRoot });
  if (!decidedCheck?.ok) {
    throw new Error(
      `generated decided-surface evidence is invalid:\n${decidedCheck?.findings?.join('\n') ?? 'unknown validation failure'}`,
    );
  }

  const formatted = await Promise.all([
    formatJson(baselinePath, convergence),
    formatJson(decidedPath, decided),
  ]);
  writeFiles([
    { contents: formatted[0], path: baselinePath },
    { contents: formatted[1], path: decidedPath },
  ]);
  return Object.freeze({ codeSubjectSha, convergence, decided });
}

/** Write a prevalidated evidence set with rollback if an ordinary filesystem operation fails. */
export function writeFinalSecurityEvidenceFiles(files, fsOperations = {}) {
  if (!Array.isArray(files) || files.length < 2) {
    throw new TypeError('final security evidence must contain at least two files');
  }
  const paths = files.map((file) => file?.path);
  if (
    paths.some((filePath) => typeof filePath !== 'string' || !path.isAbsolute(filePath)) ||
    new Set(paths).size !== paths.length
  ) {
    throw new TypeError('final security evidence paths must be unique absolute paths');
  }
  const exists = fsOperations.existsSync ?? existsSync;
  const mkdir = fsOperations.mkdirSync ?? mkdirSync;
  const read = fsOperations.readFileSync ?? readFileSync;
  const remove = fsOperations.rmSync ?? rmSync;
  const write = fsOperations.writeFileSync ?? writeFileSync;
  const originals = files.map((file) => {
    const existed = exists(file.path);
    return {
      existed,
      path: file.path,
      value: existed ? read(file.path) : undefined,
    };
  });

  try {
    for (const file of files) {
      mkdir(path.dirname(file.path), { recursive: true });
      write(file.path, file.contents, 'utf8');
    }
  } catch (writeError) {
    const rollbackErrors = [];
    for (const original of [...originals].reverse()) {
      try {
        if (original.existed) write(original.path, original.value);
        else remove(original.path, { force: true });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [writeError, ...rollbackErrors],
        'final security evidence write and rollback both failed',
      );
    }
    throw writeError;
  }
}

async function main() {
  const options = parseFinalSecurityEvidenceArguments(process.argv.slice(2));
  const result = await writeFinalSecurityEvidence({
    codeSubjectSha: options['subject-sha'],
    reason: options.reason,
  });
  process.stdout.write(
    `kovo.final-security-evidence/v1 subject=${result.codeSubjectSha} artifacts=2 OK\n`,
  );
}

if (isMainEntry(import.meta.url)) await runGate(main);
