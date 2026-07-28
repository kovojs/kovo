import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const phase = process.argv[2];
if (!['cold', 'warm', 'oneFileIncremental'].includes(phase)) {
  process.stderr.write('unknown packed benchmark phase\n');
  process.exit(2);
}

const packageManifest = JSON.parse(readFileSync('package.json', 'utf8'));
const workload = JSON.parse(readFileSync('workload.json', 'utf8'));
if (
  packageManifest.name !== '@fixture/kovo-packed-benchmark' ||
  workload.kind !== 'kovo-check-input'
) {
  process.stderr.write('packed benchmark workload identity mismatch\n');
  process.exit(2);
}

if (phase === 'oneFileIncremental') {
  writeFileSync('.kovo-benchmark-one-file.json', `${JSON.stringify({ revision: 1 })}\n`);
}

const digest = createHash('sha256')
  .update(readFileSync('workload.json'))
  .update(readFileSync('bootstrap-a.mjs'))
  .update(readFileSync('bootstrap-b.css'))
  .digest('hex');
process.stdout.write(`${phase} ${digest}\n`);
