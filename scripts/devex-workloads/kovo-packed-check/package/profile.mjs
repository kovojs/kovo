import { readFileSync, writeFileSync } from 'node:fs';

import { SOURCE_PATH, SOURCE_VARIANTS, runVerifiedBuild } from './workload.mjs';

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
if (phase === 'oneFileIncremental') {
  revision = revision === 0 ? 1 : 0;
  writeFileSync(SOURCE_PATH, SOURCE_VARIANTS[revision]);
}

let evidence;
try {
  evidence = runVerifiedBuild();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

process.stdout.write(
  `kovo-benchmark-phase/v3 phase=${phase} revision=${revision} edit=${
    phase === 'oneFileIncremental' ? 'applied' : 'baseline'
  } analysis=${evidence.analysisDigest} client=${evidence.clientDigest} duration=${evidence.durationMs.toFixed(
    6,
  )} rss=${evidence.peakRssBytes ?? 'none'}\n`,
);
