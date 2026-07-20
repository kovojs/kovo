#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { diagnosticConformanceEvidencePath, repoRoot } from './check-spec-conformance-closure.mjs';

const evidence = JSON.parse(
  readFileSync(path.join(repoRoot, diagnosticConformanceEvidencePath), 'utf8'),
);
const witnesses = new Map();
const mandatoryExecutions = new Map([
  [
    'scripts/check-spec-conformance-closure.test.mjs',
    new Set([
      'binds the live registry, generated constructors, production sites, and evidence ledger',
      'C13 mutation: production posture cannot disable the compiler validator dispatcher',
    ]),
  ],
  [
    'packages/core/src/diagnostic-registry.test.ts',
    new Set([
      'binds every definition to one enforcement class and typed constructor',
      'freezes generated registry and constructor authority',
    ]),
  ],
  [
    'site/scripts/diagnostics-ref.test.mjs',
    new Set([
      'decodes runtime KV spellings and walks every JS/TS module extension',
      'does not let one ignore comment launder later occurrences of the same code',
    ]),
  ],
]);

function addWitness(file, test) {
  if (typeof file !== 'string' || typeof test !== 'string') return;
  const normalized = file.replaceAll(path.sep, '/');
  const tests = witnesses.get(normalized) ?? new Set();
  tests.add(test);
  witnesses.set(normalized, tests);
}

addWitness(evidence.compilerMatrix?.test, evidence.compilerMatrix?.testName);
for (const row of Object.values(evidence.diagnostics ?? {})) {
  for (const role of ['red', 'green', 'ownLayer', 'mutation']) {
    addWitness(row?.[role]?.file, row?.[role]?.test);
  }
}

const files = [...mandatoryExecutions.keys(), ...witnesses.keys()].filter(
  (file, index, values) => values.indexOf(file) === index,
);
const outputDirectory = mkdtempSync(path.join(tmpdir(), 'kovo-spec-conformance-'));
const outputFile = path.join(outputDirectory, 'vitest-report.json');

try {
  const child = spawnSync(
    'pnpm',
    ['exec', 'vitest', '--run', ...files, '--reporter=json', `--outputFile=${outputFile}`],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.error !== undefined) throw child.error;

  if (!existsSync(outputFile)) {
    throw new Error(
      `spec-conformance-evidence-tests/v1 FAIL: Vitest produced no JSON receipt (status ${child.status ?? '<signal>'})`,
    );
  }
  const report = JSON.parse(readFileSync(outputFile, 'utf8'));
  const resultsByFile = new Map(
    (report.testResults ?? []).map((result) => [
      path.relative(repoRoot, result.name).replaceAll(path.sep, '/'),
      result.assertionResults ?? [],
    ]),
  );
  const findings = [];
  let witnessCount = 0;
  let mandatoryCount = 0;
  for (const [kind, required] of [
    ['mandatory', mandatoryExecutions],
    ['evidence', witnesses],
  ]) {
    for (const [file, expectedTests] of required) {
      const assertions = resultsByFile.get(file) ?? [];
      for (const test of expectedTests) {
        if (kind === 'mandatory') mandatoryCount += 1;
        else witnessCount += 1;
        const matches = assertions.filter((assertion) => assertion.title === test);
        if (matches.length !== 1) {
          findings.push(
            `${file}#${test}: expected one executed ${kind} Vitest result, received ${matches.length}`,
          );
        } else if (matches[0].status !== 'passed') {
          findings.push(`${file}#${test}: expected passed, received ${matches[0].status}`);
        }
      }
    }
  }

  if (child.status !== 0) {
    findings.push(`Vitest evidence suite exited with status ${child.status ?? '<signal>'}`);
  }
  if (findings.length > 0) {
    throw new Error(
      [
        'spec-conformance-evidence-tests/v1 FAIL',
        ...findings.map((finding) => `- ${finding}`),
      ].join('\n'),
    );
  }
  process.stdout.write(
    `spec-conformance-evidence-tests/v1 OK files=${witnesses.size} witnesses=${witnessCount} mandatory=${mandatoryCount}\n`,
  );
} finally {
  rmSync(outputDirectory, { force: true, recursive: true });
}
