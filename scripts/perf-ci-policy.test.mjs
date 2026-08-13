import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const workflow = readFileSync(path.join(repoRoot, '.github/workflows/perf-realistic.yml'), 'utf8');

describe('realistic performance CI policy', () => {
  it('keeps deterministic bytes and a bounded matched correctness smoke on every PR', () => {
    expect(workflow).toContain('  pull_request:\n');
    const bytes = jobSource('bytes');
    const smoke = jobSource('correctness-smoke');
    expect(bytes).not.toContain("github.event_name != 'pull_request'");
    expect(bytes).toContain('scripts/perf-gate.mjs');
    expect(bytes).toContain('--suite bytes');
    expect(smoke).toContain('uses: ./.github/actions/playwright-install');
    expect(smoke).toContain(
      'vp exec pnpm --dir benchmarks/nextjs install --ignore-workspace --frozen-lockfile',
    );
    expect(smoke).toContain('vp exec pnpm --dir benchmarks/kovo run build');
    expect(smoke).toContain('vp exec pnpm --dir benchmarks/nextjs run build');
    expect(smoke).toContain('vp exec node benchmarks/compare.mjs');
    expect(smoke).toContain('--lanes matched-l0,matched-l1');
    expect(smoke).toContain('--iterations 2');
    expect(smoke).toContain('--warmups 0');
    expect(smoke).toContain('--skip-lighthouse');
    expect(smoke).toContain('--bfcache-iterations 2');
    expect(smoke.indexOf('playwright-install')).toBeLessThan(
      smoke.indexOf('benchmarks/compare.mjs'),
    );
  });

  it('serializes each load-sensitive matrix on a pinned runner label with authenticated facts', () => {
    expect(workflow).toContain('cancel-in-progress: false');
    for (const job of ['browser-matrix', 'dev-matrix', 'build-matrix', 'server-matrix']) {
      const source = jobSource(job);
      expect(source, job).toContain("if: ${{ github.event_name != 'pull_request' }}");
      expect(source, job).toContain('runs-on: ubuntu-24.04');
      expect(source, job).toContain('KOVO_PERF_RUNNER_IMAGE=github-actions/ubuntu-24.04');
      expect(source, job).toContain('vp exec node benchmarks/compare.mjs');
      expect(source, job).toContain('if: always()');
      expect(source, job).toContain(
        'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
      );
      expect(source, job).toContain('retention-days: 30');
    }
  });

  it('retains the exact publishable sample policies in the scheduled commands', () => {
    expect(jobSource('browser-matrix')).toEqual(expect.stringContaining('--iterations 30'));
    for (const token of ['--lighthouse-runs 5', '--bfcache-iterations 10']) {
      expect(jobSource('browser-matrix')).toContain(token);
    }
    for (const token of [
      '--corpus-size 216',
      '--dev-ready-iterations 15',
      '--dev-iterations 30',
      '--dev-warmups 3',
    ]) {
      expect(jobSource('dev-matrix')).toContain(token);
    }
    for (const token of ['--corpus-size 216', '--iterations 10', '--warmups 3']) {
      expect(jobSource('build-matrix')).toContain(token);
    }
    for (const token of [
      '--server-samples 7',
      '--server-warmup-ms 5000',
      '--server-duration-ms 15000',
      '--server-concurrencies 1,8,32',
      '--server-routes listing,detail',
      '--server-encodings identity,br',
      '--server-modes HIT,304,dynamic',
    ]) {
      expect(jobSource('server-matrix')).toContain(token);
    }
  });

  it('uses the setup-provided vp command and pins every remote action by commit', () => {
    expect(workflow).not.toMatch(/^\s*run:\s+pnpm\b/gmu);
    for (const line of workflow.split('\n').filter((line) => line.includes('uses: actions/'))) {
      expect(line).toMatch(/@[0-9a-f]{40}\s*$/u);
    }
  });
});

function jobSource(name) {
  const marker = `  ${name}:\n`;
  const start = workflow.indexOf(marker);
  if (start === -1) throw new Error(`missing workflow job ${name}`);
  const tail = workflow.slice(start + marker.length);
  const next = /^  [a-z0-9-]+:\n/gmu.exec(tail);
  return next === null ? tail : tail.slice(0, next.index);
}
