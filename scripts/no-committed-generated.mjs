#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

export const inScopeGeneratedPatterns = [
  'examples/*/src/generated/**',
  'site/src/generated/**',
  'site/tutorial/steps/*/src/generated/**',
  'packages/create-kovo/templates/graph.json',
];

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
  const matchers = [
    /^examples\/[^/]+\/src\/generated\//,
    /^site\/src\/generated\//,
    /^site\/tutorial\/steps\/[^/]+\/src\/generated\//,
    /^packages\/create-kovo\/templates\/graph\.json$/,
  ];
  return files.filter((file) => matchers.some((matcher) => matcher.test(file)));
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
