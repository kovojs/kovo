#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

import { dec10GreenCorpusRows } from '../packages/conformance-fixtures/src/adversarial-corpus.ts';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';

export function evaluateGreenCorpus(options = {}) {
  const rows = options.rows ?? dec10GreenCorpusRows();
  const run = options.run ?? runGreenCorpusVitest;
  const result = run();
  const findings = result.ok ? [] : [result.output || 'green corpus vitest failed'];

  return {
    findings,
    ok: findings.length === 0,
    rows: rows.length,
  };
}

export function main(options = {}) {
  const result = evaluateGreenCorpus(options);
  process.stdout.write(`check-green-corpus/v1 ${result.ok ? 'OK' : 'FAIL'} rows=${result.rows}\n`);
  for (const finding of result.findings) process.stderr.write(`${finding}\n`);
  return result.ok;
}

function runGreenCorpusVitest() {
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'vitest',
      '--run',
      'packages/conformance-fixtures/src/adversarial-corpus.green.test.ts',
    ],
    { encoding: 'utf8' },
  );
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

if (isMainEntry(import.meta.url)) await runGate(main);
