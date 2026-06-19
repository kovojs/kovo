#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const devtoolRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(devtoolRoot, '../..');

for (const filter of [
  '@kovojs/example-commerce',
  '@kovojs/example-crm',
  '@kovojs/example-stackoverflow',
]) {
  execFileSync('pnpm', ['--filter', filter, 'run', 'emit-graph'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

process.stdout.write('emit-example-graphs/v1\nOK\n');
