#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

import {
  GENERATED_ARTIFACT_CATEGORIES,
  generatedArtifactPathsInCategory,
  generatedArtifactPathspecs,
} from './generated-artifacts.mjs';

export const inScopeGeneratedPatterns = generatedArtifactPathspecs(
  GENERATED_ARTIFACT_CATEGORIES.mustNotCommit,
);

export function committedGeneratedArtifacts({ cwd = process.cwd() } = {}) {
  const output = execFileSync('git', ['ls-files', ...inScopeGeneratedPatterns], {
    cwd,
    encoding: 'utf8',
  });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function trackedGeneratedViolations(files) {
  return generatedArtifactPathsInCategory(files, GENERATED_ARTIFACT_CATEGORIES.mustNotCommit);
}

export function runNoCommittedGeneratedCheck(options = {}) {
  const files = trackedGeneratedViolations(committedGeneratedArtifacts(options));
  if (files.length === 0) {
    process.stdout.write('no-committed-generated/v1\nOK\n');
    return 0;
  }

  process.stderr.write(
    `no-committed-generated/v1\nFAIL tracked generated artifacts:\n${files
      .map((file) => `- ${file}`)
      .join('\n')}\n`,
  );
  return 1;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(runNoCommittedGeneratedCheck());
}
