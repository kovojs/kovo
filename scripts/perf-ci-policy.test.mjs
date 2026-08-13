import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const workflow = readFileSync(path.join(repoRoot, '.github/workflows/perf-realistic.yml'), 'utf8');
const baselineScope = [
  "github.event_name == 'schedule' ||",
  "github.event_name == 'workflow_dispatch' &&",
  "inputs.measurement_scope == 'baselines' || inputs.measurement_scope == 'all'",
];
const decisionScope = [
  "github.event_name == 'workflow_dispatch' &&",
  "inputs.measurement_scope == 'decisions' || inputs.measurement_scope == 'all'",
];

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
    expect(smoke).toContain('vp exec node benchmarks/compare.mjs');
    expect(smoke).toContain('--lanes matched-l0,matched-l1');
    expect(smoke).toContain('--iterations 2');
    expect(smoke).toContain('--warmups 0');
    expect(smoke).toContain('--skip-lighthouse');
    expect(smoke).toContain('--bfcache-iterations 2');
    expect(smoke).not.toContain('--skip-build');
    expect(smoke.indexOf('playwright-install')).toBeLessThan(
      smoke.indexOf('benchmarks/compare.mjs'),
    );
  });

  it('keeps scheduled matrices serialized while independent manual evidence runs can overlap', () => {
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain(
      "group: perf-realistic-${{ github.event_name == 'workflow_dispatch' && github.run_id || github.ref }}",
    );
    expect(workflow).toContain('      measurement_scope:\n');
    expect(workflow).toContain('        default: baselines\n');
    for (const option of ['baselines', 'decisions', 'all']) {
      expect(workflow).toContain(`          - ${option}\n`);
    }
    for (const input of [
      'check_watch_baseline_sha',
      'check_watch_candidate_sha',
      'loader_baseline_sha',
      'loader_candidate_sha',
    ]) {
      expect(workflow).toContain(`      ${input}:\n`);
      expect(workflow.slice(workflow.indexOf(`      ${input}:\n`))).toMatch(
        /^      [a-z_]+:\n        description: .+\n        required: true\n        type: string\n/mu,
      );
    }
    for (const job of ['browser-matrix', 'dev-matrix', 'build-matrix', 'server-matrix']) {
      const source = jobSource(job);
      for (const token of baselineScope) expect(source, job).toContain(token);
      expect(source, job).toContain('runs-on: ubuntu-24.04');
      expect(source, job).toContain('KOVO_PERF_RUNNER_IMAGE=github-actions/ubuntu-24.04');
      expect(source, job).toContain('vp exec node benchmarks/compare.mjs');
      expect(source, job).toContain('if: always()');
      expect(source, job).toContain(
        'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
      );
      expect(source, job).toContain('retention-days: 30');
    }
    for (const token of baselineScope) expect(jobSource('check-scaling')).toContain(token);
  });

  it('retains the exact publishable sample policies in the scheduled commands', () => {
    expect(jobSource('browser-matrix')).toEqual(expect.stringContaining('--iterations 30'));
    for (const token of ['--lighthouse-runs 5', '--bfcache-iterations 10']) {
      expect(jobSource('browser-matrix')).toContain(token);
    }
    expect(jobSource('browser-matrix')).not.toContain('--skip-build');
    for (const job of ['dev-matrix', 'build-matrix']) {
      expect(jobSource(job)).toContain('corpus: [24, 216]');
      expect(jobSource(job)).toContain('--corpus-size "$KOVO_PERF_CORPUS_SIZE"');
    }
    for (const token of ['--dev-ready-iterations 15', '--dev-iterations 30', '--dev-warmups 3']) {
      expect(jobSource('dev-matrix')).toContain(token);
    }
    for (const token of ['--iterations 10', '--warmups 3']) {
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

  it('runs the authenticated full check-watch candidate decision from exact clean worktrees', () => {
    const source = decisionJob('check-watch-decision');
    expect(source).toContain('fetch-depth: 0');
    expect(source).toContain(
      'KOVO_CHECK_WATCH_BASELINE_SHA: ${{ inputs.check_watch_baseline_sha }}',
    );
    expect(source).toContain(
      'KOVO_CHECK_WATCH_CANDIDATE_SHA: ${{ inputs.check_watch_candidate_sha }}',
    );
    expect(source).toContain(
      'KOVO_CHECK_WATCH_CANDIDATE_COMMIT: eb1a1663b40826240a7bb5080fd54cb66bf4bab8',
    );
    expect(source).toContain(
      'KOVO_CHECK_WATCH_BASELINE_COMMIT: cc475b3ab2d54ff8201de059e713cc1d7e54400c',
    );
    expect(source).toContain(
      'KOVO_CHECK_WATCH_EVIDENCE_REF: refs/heads/perf-spike/check-watch-sealed-20260813',
    );
    expect(source).toContain(
      'KOVO_CHECK_WATCH_CANDIDATE_PATCH_ID: 97a1cc7b8f0e46d6cbd44cb61d4708433f523aef',
    );
    expect(source).toContain('check_watch_baseline_sha must be exactly 40 lowercase hexadecimal');
    expect(source).toContain('check_watch_candidate_sha must be exactly 40 lowercase hexadecimal');
    expect(source).toContain('git fetch --no-tags origin');
    expect(source).toContain(
      '"+$KOVO_CHECK_WATCH_EVIDENCE_REF:refs/perf-evidence/check-watch-sealed"',
    );
    expect(source).toContain(
      'candidate_commit="$(git rev-parse --verify refs/perf-evidence/check-watch-sealed^{commit})"',
    );
    expect(source).toContain(
      'test "$(git rev-parse "$baseline_commit^")" = "$KOVO_CHECK_WATCH_BASELINE_COMMIT"',
    );
    expect(source).toContain('check-watch baseline seal changed unapproved path');
    expect(source).toContain(
      'test "$(git merge-base "$baseline_commit" "$candidate_commit")" = "$baseline_commit"',
    );
    expect(source).toContain('candidate_range_count="$(git rev-list --count');
    expect(source).toContain('test "$candidate_range_count" = 2');
    expect(source).toContain('test "$(git rev-parse "$candidate_commit^")" = "$production_commit"');
    expect(source).toContain('git patch-id --stable');
    expect(source).toContain('test "$production_patch_id" = "$KOVO_CHECK_WATCH_CANDIDATE_PATCH_ID"');
    expect(source).toContain('check-watch candidate seal changed unapproved path');
    expect(source).toContain('git worktree add --detach "$baseline_root" "$baseline_commit"');
    expect(source).toContain('git worktree add --detach "$candidate_root" "$candidate_commit"');
    expect(count(source, 'install --offline --frozen-lockfile --ignore-scripts')).toBe(2);
    expect(source).toContain('KOVO_DEVEX_OS_IMAGE=github-actions/ubuntu-24.04@sha256:');
    expect(source).toContain(
      'KOVO_DEVEX_RUNNER_NAME=github-hosted-ubuntu-24.04-accepted',
    );
    expectPnpmBridge(source);
    expect(source).not.toContain('revert --no-edit');
    expect(count(source, '--prepare-kovo-scenario')).toBe(2);
    expect(source).toContain('scripts/perf-check-watch-spike.mjs');
    expect(source).toContain(
      '--spike-repo "$RUNNER_TEMP/kovo-check-watch-candidate"',
    );
    expect(source).toContain('--samples 30');
    expect(source).toContain('--warmups 3');
    expectRawArtifact(source, 'kovo-perf-check-watch-decision');
  });

  it('runs both full browser-visible historical fresh-generation decisions', () => {
    const source = decisionJob('dev-generation-decision');
    expect(source).toContain('corpus: [24, 216]');
    expect(source).toContain('fetch-depth: 0');
    expect(source).toContain('uses: ./.github/actions/playwright-install');
    expectPnpmBridge(source);
    expect(source).toContain(
      'KOVO_DEV_GENERATION_CANDIDATE_COMMIT: 44da3f3449dcbac2cc29951604b89488c90faa6f',
    );
    expect(source).toContain(
      'KOVO_DEV_GENERATION_CANDIDATE_REF: refs/heads/perf-spike/dev-generation-44da3f344',
    );
    expect(source).toContain('git fetch --no-tags origin');
    expect(source).toContain(
      '"+$KOVO_DEV_GENERATION_CANDIDATE_REF:refs/perf-evidence/dev-generation-candidate"',
    );
    expect(source).toContain(
      'test "$resolved_candidate" = "$KOVO_DEV_GENERATION_CANDIDATE_COMMIT"',
    );
    expect(count(source, 'git worktree add --detach')).toBe(2);
    expect(source).toContain("-c user.name='Kovo Performance CI'");
    expect(source).toContain('cherry-pick "$KOVO_DEV_GENERATION_CANDIDATE_COMMIT"');
    expect(source).toContain('scripts/perf-dev-generation-spike.mjs');
    for (const token of [
      '--size "$KOVO_PERF_CORPUS_SIZE"',
      '--ready-samples 15',
      '--edit-samples 30',
      '--warmups 3',
      '--measure',
    ]) {
      expect(source).toContain(token);
    }
    expectRawArtifact(source, 'kovo-perf-dev-generation-n${{ matrix.corpus }}');
  });

  it('keeps the remaining decision measurements full-policy, parallel, and raw', () => {
    const cache = decisionJob('compressed-cache-decision');
    expect(cache).toContain('scripts/perf-compressed-cache-ab.mjs');
    expect(cache).not.toContain('--samples');
    expect(cache).not.toContain('--quick-smoke');
    expectRawArtifact(cache, 'kovo-perf-compressed-cache-decision');

    const cli = decisionJob('cli-startup-decision');
    expect(cli).toContain('scripts/perf-cli-startup-benchmark.mjs');
    expectPnpmBridge(cli);
    expect(cli).not.toContain('--samples');
    expect(cli).not.toContain('--warmups');
    expect(cli).not.toContain('--quick-smoke');
    expectRawArtifact(cli, 'kovo-perf-cli-startup-decision');

    const diagnostics = decisionJob('runtime-diagnostics');
    expect(diagnostics).toContain('scripts/perf-server-profile.mjs');
    expect(diagnostics).toContain('--route listing');
    expect(diagnostics).toContain('--warmup-ms 5000');
    expect(diagnostics).toContain('--duration-ms 15000');
    expect(diagnostics).toContain('forced-dynamic.cpuprofile');
    expect(diagnostics).toContain('scripts/perf-route-css.mjs');
    expectRawArtifact(diagnostics, 'kovo-perf-runtime-diagnostics');

    const devProfile = decisionJob('dev-edit-profile');
    expect(devProfile).toContain('corpus: [24, 216]');
    expect(devProfile).toContain('uses: ./.github/actions/playwright-install');
    expect(devProfile).toContain('scripts/perf-dev-edit-profile.mjs owns these Inspector windows');
    expect(devProfile).toContain('benchmarks/corpora/generate.mjs');
    expect(devProfile).toContain('benchmarks/corpora/dev-loop.mjs');
    expect(devProfile).toContain('--iterations 30');
    expect(devProfile).toContain('--ready-iterations 1');
    expect(devProfile).toContain('--warmups 3');
    expect(devProfile).toContain('--inspector-port 49121');
    expect(devProfile).toContain('--profile-dir "$output_root/raw"');
    expectRawArtifact(devProfile, 'kovo-perf-dev-profile-n${{ matrix.corpus }}');

    const loaderMemo = decisionJob('loader-runtime-memo-decision');
    expect(loaderMemo).toContain('fetch-depth: 0');
    expect(loaderMemo).toContain('KOVO_LOADER_BASELINE_SHA: ${{ inputs.loader_baseline_sha }}');
    expect(loaderMemo).toContain('KOVO_LOADER_CANDIDATE_SHA: ${{ inputs.loader_candidate_sha }}');
    expect(loaderMemo).toContain(
      'KOVO_LOADER_HISTORICAL_COMMIT: e54c595b5906df9ab9b9b5e3fbf18e76c99e79b9',
    );
    expect(loaderMemo).toContain(
      'KOVO_LOADER_HISTORICAL_REF: refs/heads/perf-spike/loader-memo-e54c595b5',
    );
    expect(loaderMemo).toContain('git fetch --no-tags origin');
    expect(loaderMemo).toContain(
      '"+$KOVO_LOADER_HISTORICAL_REF:refs/perf-evidence/loader-memo-historical"',
    );
    expect(loaderMemo).toContain(
      'test "$resolved_historical" = "$KOVO_LOADER_HISTORICAL_COMMIT"',
    );
    expect(loaderMemo).toContain('loader_baseline_sha must be exactly 40 lowercase hexadecimal');
    expect(loaderMemo).toContain('loader_candidate_sha must be exactly 40 lowercase hexadecimal');
    expect(loaderMemo).toContain('git worktree add --detach "$baseline_root" "$baseline_commit"');
    expect(loaderMemo).toContain('git worktree add --detach "$spike_root" "$candidate_commit"');
    expect(loaderMemo).toContain(
      'test "$(git rev-parse "$candidate_commit^")" = "$baseline_commit"',
    );
    expect(loaderMemo).toContain(
      'test "$(git rev-list --count "$baseline_commit..$candidate_commit")" = 1',
    );
    expect(loaderMemo).toContain(
      'git merge-base --is-ancestor "$candidate_commit" "$GITHUB_SHA"',
    );
    expectPnpmBridge(loaderMemo);
    expect(count(loaderMemo, 'install --offline --frozen-lockfile --ignore-scripts')).toBe(2);
    expect(count(loaderMemo, 'scripts/perf-loader-runtime-memo-ab.mjs')).toBe(2);
    expect(loaderMemo).toContain('--prepare-only');
    expect(loaderMemo).toContain('--measure');
    expect(loaderMemo).toContain('--profile-dir');
    for (const token of [
      '--samples 7',
      '--warmup-ms 5000',
      '--duration-ms 15000',
      '--concurrencies 1,8,32',
      '--routes listing,detail',
    ]) {
      expect(loaderMemo).toContain(token);
    }
    expect(loaderMemo).not.toContain('$GITHUB_SHA^');
    expectRawArtifact(loaderMemo, 'kovo-perf-loader-runtime-memo-decision');
  });

  it('never interpolates dispatch inputs directly into a run script', () => {
    expect(workflow).not.toMatch(/^\s+run:.*\$\{\{ inputs\./gmu);
    for (const run of workflow.matchAll(/^\s+run:\s*(?:\||>-)\n((?: {10,}.*(?:\n|$))*)/gmu)) {
      expect(run[1]).not.toContain('${{ inputs.');
    }
  });
});

function decisionJob(name) {
  const source = jobSource(name);
  for (const token of decisionScope) expect(source, name).toContain(token);
  expect(source, name).toContain('runs-on: ubuntu-24.04');
  expect(source, name).toContain('KOVO_PERF_RUNNER_IMAGE=github-actions/ubuntu-24.04');
  return source;
}

function expectRawArtifact(source, name) {
  expect(source).toContain('if: always()');
  expect(source).toContain('if-no-files-found: warn');
  expect(source).toContain(`name: ${name}`);
  expect(source).toContain('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
  expect(source).toContain('retention-days: 30');
}

function count(source, token) {
  return source.split(token).length - 1;
}

function expectPnpmBridge(source) {
  expect(source).toContain('Expose pnpm to authenticated benchmark subprocesses');
  expect(source).toContain(`'exec vp exec pnpm "$@"'`);
  expect(source).toContain('printf \'%s\\n\' "$tool_bin" >> "$GITHUB_PATH"');
}

function jobSource(name) {
  const marker = `  ${name}:\n`;
  const start = workflow.indexOf(marker);
  if (start === -1) throw new Error(`missing workflow job ${name}`);
  const tail = workflow.slice(start + marker.length);
  const next = /^  [a-z0-9-]+:\n/gmu.exec(tail);
  return next === null ? tail : tail.slice(0, next.index);
}
