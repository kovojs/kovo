import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const phase = process.argv[2];
if (!['cold', 'warm', 'oneFileIncremental'].includes(phase)) {
  process.stderr.write('unknown Kovo packed-check benchmark phase\n');
  process.exit(2);
}

if (phase === 'oneFileIncremental') {
  const graph = JSON.parse(readFileSync('graph.json', 'utf8'));
  graph.components = [];
  writeFileSync('graph.json', `${JSON.stringify(graph, null, 2)}\n`);
}

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
