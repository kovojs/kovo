#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

import {
  GENERATED_ARTIFACT_CATEGORIES,
  generatedArtifactGeneratorCheckCommand,
  generatedArtifactPoliciesForCategory,
} from './generated-artifacts.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot } from './public-packages.mjs';

/** Return every unique generator that owns a committed must-match artifact. */
export function committedGeneratedArtifactGenerators() {
  return [
    ...new Set(
      generatedArtifactPoliciesForCategory(GENERATED_ARTIFACT_CATEGORIES.mustMatchGenerator).map(
        (entry) => entry.generatorId,
      ),
    ),
  ].sort(compareStrings);
}

/** Run each registered freshness command. A missing command is itself policy drift. */
export function runGeneratedArtifactChecks({
  cwd = repoRoot,
  execute = executeGeneratorCheck,
} = {}) {
  const generators = committedGeneratedArtifactGenerators();
  for (const generator of generators) {
    const command = generatedArtifactGeneratorCheckCommand(generator);
    if (command === null) {
      throw new Error(`Generated artifact generator ${generator} has no freshness command.`);
    }
    const result = execute(command, cwd);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error || result.signal || result.status !== 0) {
      throw new Error(
        `Generated artifact check ${generator} failed${
          result.status === null ? '' : ` with status ${String(result.status)}`
        }: ${result.error?.message ?? result.signal ?? '<see output above>'}`,
      );
    }
  }
  process.stdout.write(
    `generated-artifacts/v1 generators=${generators.length} policies=${generatedArtifactPoliciesForCategory(GENERATED_ARTIFACT_CATEGORIES.mustMatchGenerator).length} OK\n`,
  );
  return 0;
}

function executeGeneratorCheck(command, cwd) {
  return spawnSync(command[0], command.slice(1), {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

if (isMainEntry(import.meta.url)) await runGate(runGeneratedArtifactChecks);
