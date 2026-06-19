import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = resolve(repoRoot, 'tests/compiler-determinism-worker.mjs');

describe('compiler determinism', () => {
  it('emits byte-identical perf-corpus artifacts in two fresh processes', () => {
    // SPEC.md §5.2 requires compiler output to be reproducible; the incremental cache relies on
    // identical declared inputs producing identical emitted bytes across process boundaries.
    const first = runDeterminismWorker();
    const second = runDeterminismWorker();

    expect(second).toBe(first);
    expect(JSON.parse(first)).toMatchObject({ fileCount: 125 });
  }, 120_000);
});

function runDeterminismWorker(): string {
  return execFileSync(process.execPath, [workerPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
