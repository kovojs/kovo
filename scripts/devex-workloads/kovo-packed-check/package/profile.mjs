import { readFileSync, writeFileSync } from 'node:fs';

import {
  SOURCE_PATH,
  SOURCE_VARIANTS,
  runVerifiedCheck,
  runVerifiedIncrementalCheckSession,
} from './workload.mjs';

const phase = process.argv[2];
if (!['cold', 'warm', 'oneFileIncremental'].includes(phase)) {
  process.stderr.write('unknown Kovo packed-check benchmark phase\n');
  process.exit(2);
}

const requestedBaseline = process.env.KOVO_DEVEX_EDIT_BASELINE;
if (requestedBaseline !== undefined) {
  const baseline = Number(requestedBaseline);
  if ((baseline !== 0 && baseline !== 1) || phase === 'cold') {
    process.stderr.write('invalid Kovo benchmark edit baseline\n');
    process.exit(2);
  }
  if (phase === 'warm') writeFileSync(SOURCE_PATH, SOURCE_VARIANTS[baseline]);
}

let revision = SOURCE_VARIANTS.indexOf(readFileSync(SOURCE_PATH, 'utf8'));
if (revision === -1) {
  process.stderr.write('Kovo benchmark source does not match a reviewed edit variant\n');
  process.exit(2);
}
if (phase === 'oneFileIncremental' && process.env.KOVO_DEVEX_INCREMENTAL_SAMPLES !== undefined) {
  const samples = Number(process.env.KOVO_DEVEX_INCREMENTAL_SAMPLES);
  if (!Number.isSafeInteger(samples) || samples < 1) {
    process.stderr.write('invalid Kovo incremental session sample count\n');
    process.exit(2);
  }
  writeFileSync(SOURCE_PATH, SOURCE_VARIANTS[0]);
  try {
    const session = await runVerifiedIncrementalCheckSession(samples);
    process.stdout.write(
      `kovo-benchmark-incremental-session/v1 ${Buffer.from(JSON.stringify(session)).toString(
        'base64url',
      )}\n`,
    );
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
} else if (phase === 'oneFileIncremental') {
  revision = revision === 0 ? 1 : 0;
  writeFileSync(SOURCE_PATH, SOURCE_VARIANTS[revision]);
}

let evidence;
try {
  evidence = runVerifiedCheck();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

process.stdout.write(
  `kovo-benchmark-phase/v4 phase=${phase} revision=${revision} edit=${
    phase === 'oneFileIncremental' ? 'applied' : 'baseline'
  } analysis=${evidence.analysisDigest} graph=${evidence.checkGraphDigest} census=${Buffer.from(
    JSON.stringify(evidence.diagnosticPhases),
  ).toString('base64url')} duration=${evidence.durationMs.toFixed(6)} rss=${
    evidence.peakRssBytes ?? 'none'
  }\n`,
);
