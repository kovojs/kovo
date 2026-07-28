import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const phase = process.argv[2];
if (!['cold', 'warm', 'oneFileIncremental'].includes(phase)) {
  process.stderr.write('unknown Kovo packed-check benchmark phase\n');
  process.exit(2);
}

const sourcePath = 'src/check-subject.ts';
const sourceVariants = [
  "export const benchmarkRevision = 0;\nexport const benchmarkDomain = 'cart';\n",
  "export const benchmarkRevision = 1;\nexport const benchmarkDomain = 'cart';\n",
];
const requestedBaseline = process.env.KOVO_DEVEX_EDIT_BASELINE;
if (requestedBaseline !== undefined) {
  const baseline = Number(requestedBaseline);
  if ((baseline !== 0 && baseline !== 1) || phase === 'cold') {
    process.stderr.write('invalid Kovo benchmark edit baseline\n');
    process.exit(2);
  }
  if (phase === 'warm') writeFileSync(sourcePath, sourceVariants[baseline]);
}

let revision = sourceVariants.indexOf(readFileSync(sourcePath, 'utf8'));
if (revision === -1) {
  process.stderr.write('Kovo benchmark source does not match a reviewed edit variant\n');
  process.exit(2);
}
if (phase === 'oneFileIncremental') {
  revision = revision === 0 ? 1 : 0;
  writeFileSync(sourcePath, sourceVariants[revision]);
}

const graph = {
  queries: [{ domains: ['cart'], query: 'cart' }],
  touchGraph: {
    'cart.addItem': {
      touches: [
        {
          domain: 'cart',
          keys: null,
          site: `src/check-subject.ts:${revision + 1}`,
          via: 'cart_items',
        },
      ],
      unresolved: [],
    },
  },
};
writeFileSync('graph.json', `${JSON.stringify(graph, null, 2)}\n`);

const cli = path.resolve('node_modules/@kovojs/cli/dist/bin.mjs');
const result = spawnSync(process.execPath, [cli, 'check', 'graph.json'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (result.status !== 0 || result.signal || result.error) {
  process.stderr.write(
    result.error?.message ??
      result.signal ??
      result.stderr ??
      result.stdout ??
      `kovo check exited ${String(result.status)}`,
  );
  process.exit(1);
}
if (!/^kovo-check\/v1\r?\n(?:OK|SUMMARY)/mu.test(result.stdout)) {
  process.stderr.write('packed kovo check returned an unrecognized result\n');
  process.exit(1);
}
process.stdout.write(
  `kovo-benchmark-phase/v1 phase=${phase} revision=${revision} edit=${
    phase === 'oneFileIncremental' ? 'applied' : 'baseline'
  }\n`,
);
