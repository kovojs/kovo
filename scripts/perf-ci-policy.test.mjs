import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  inspectDevPortAllocation,
  inspectHostEphemeralPortRanges,
} from '../benchmarks/harness/dev-port-allocation.mjs';
import {
  BASELINE_CPU_LABEL_ALIASES,
  BASELINE_FOCUS_LABEL_ALIASES,
  baselineCpuModelAdmission,
  baselineFamilyAdmission,
  baselineSelectorsFromLabels,
  runBaselineCpuModelAdmission,
} from '../.github/actions/kovo-perf-baseline-cpu-admission/check.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const workflow = readFileSync(path.join(repoRoot, '.github/workflows/perf-realistic.yml'), 'utf8');
const devGenerationRunner = readFileSync(
  path.join(repoRoot, 'scripts/perf-dev-generation-spike.mjs'),
  'utf8',
);
const baselineCpuAdmissionAction = readFileSync(
  path.join(repoRoot, '.github/actions/kovo-perf-baseline-cpu-admission/action.yml'),
  'utf8',
);
const baselineDispatchScope = [
  "github.event_name == 'schedule' ||",
  "github.event_name == 'workflow_dispatch' &&",
  "inputs.measurement_scope == 'baselines' || inputs.measurement_scope == 'all'",
];
const baselineLabelScope = [
  "github.event_name == 'pull_request' && github.event.action == 'labeled'",
  "github.event.label.name == 'perf-measure-baselines'",
];
const baselineProducerFamiliesByJob = new Map([
  ['check-scaling', 'check'],
  ['browser-matrix', 'browser'],
  ['dev-matrix', 'dev-n${{ matrix.corpus }}'],
  ['build-matrix', 'build-n${{ matrix.corpus }}'],
  ['server-matrix', 'server'],
]);
const publicationAuthenticatedBaselineIf = [
  '    if: >-\n',
  "      ${{ github.event_name == 'schedule' ||\n",
  "      (github.event_name == 'workflow_dispatch' &&\n",
  "      (inputs.measurement_scope == 'baselines' || inputs.measurement_scope == 'all')) ||\n",
  "      (github.event_name == 'pull_request' && github.event.action == 'labeled' &&\n",
  "      github.event.label.name == 'perf-measure-baselines') }}\n",
].join('');
const decisionDispatchScope = [
  "github.event_name == 'workflow_dispatch' &&",
  "inputs.measurement_scope == 'decisions' || inputs.measurement_scope == 'all'",
];
const decisionFocusByJob = new Map([
  ['check-watch-decision', 'check-watch'],
  ['dev-generation-decision', 'dev-generation'],
  ['build-source-trust-decision', 'build-source-trust'],
  ['compressed-cache-decision', 'compressed-cache'],
  ['cli-startup-decision', 'cli-startup'],
  ['runtime-diagnostics', 'runtime-diagnostics'],
  ['dev-edit-profile', 'dev-profile'],
  ['build-profile', 'build-profile'],
  ['loader-runtime-memo-decision', 'loader'],
]);
const measurementJobs = [
  'correctness-smoke',
  'bytes',
  'check-scaling',
  'browser-matrix',
  'dev-matrix',
  'build-matrix',
  'server-matrix',
  ...decisionFocusByJob.keys(),
];
const publishableMeasurementJobs = [
  'check-scaling',
  'browser-matrix',
  'dev-matrix',
  'build-matrix',
  'server-matrix',
  ...decisionFocusByJob.keys(),
];

describe('realistic performance CI policy', () => {
  it('keeps deterministic bytes and a bounded matched correctness smoke on every PR', () => {
    expect(workflow).toContain(
      '  pull_request:\n    types: [opened, synchronize, reopened, labeled]\n',
    );
    const bytes = jobSource('bytes');
    const smoke = jobSource('correctness-smoke');
    for (const source of [bytes, smoke]) {
      expect(count(source, "if: ${{ github.event_name == 'pull_request' }}")).toBe(1);
    }
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
      "group: perf-realistic-${{ (github.event_name == 'workflow_dispatch' || (github.event_name == 'pull_request' && github.event.action == 'labeled' && startsWith(github.event.label.name, 'perf-measure-'))) && github.run_id || github.ref }}",
    );
    expect(workflow).toContain('      measurement_scope:\n');
    expect(workflow).toContain('        default: baselines\n');
    for (const option of ['baselines', 'decisions', 'all']) {
      expect(workflow).toContain(`          - ${option}\n`);
    }
    const baselineFocus = dispatchInputSource('baseline_focus');
    expect(baselineFocus).toContain('        default: all\n');
    for (const option of [
      'all',
      'check',
      'browser',
      'dev-n24',
      'dev-n216',
      'build-n24',
      'build-n216',
      'server',
    ]) {
      expect(baselineFocus).toContain(`          - ${option}\n`);
    }
    const baselineCpu = dispatchInputSource('baseline_cpu_model_sha256');
    expect(baselineCpu).toContain(
      '        description: Optional exact lowercase SHA-256 of Node os.cpus()[0].model\n',
    );
    expect(baselineCpu).toContain('        required: false\n');
    expect(baselineCpu).toContain('        type: string\n');
    expect(workflow).toContain('      decision_focus:\n');
    expect(workflow).toContain('        default: all\n');
    for (const option of ['all', ...decisionFocusByJob.values()]) {
      expect(dispatchInputSource('decision_focus')).toContain(`          - ${option}\n`);
    }
    for (const input of [
      'check_watch_baseline_sha',
      'check_watch_candidate_sha',
      'loader_baseline_sha',
      'loader_candidate_sha',
    ]) {
      const source = dispatchInputSource(input);
      expect(source).toMatch(/^        description: .+; required when decisions run$/mu);
      expect(source).toContain('        required: false\n');
      expect(source).toContain('        type: string\n');
    }
    for (const job of ['browser-matrix', 'dev-matrix', 'build-matrix', 'server-matrix']) {
      const source = jobSource(job);
      for (const token of [...baselineDispatchScope, ...baselineLabelScope]) {
        expect(source, job).toContain(token);
      }
      expect(source, job).toContain('runs-on: ubuntu-24.04');
      expect(source, job).toContain('KOVO_PERF_RUNNER_IMAGE=github-actions/ubuntu-24.04');
      expect(source, job).toContain('vp exec node benchmarks/compare.mjs');
      expect(source, job).toContain('if: always()');
      expect(source, job).toContain(
        'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
      );
      expect(source, job).toContain('retention-days: 90');
    }
    expect(count(jobSource('dev-matrix'), 'timeout-minutes:')).toBe(1);
    expect(count(jobSource('dev-matrix'), 'name: kovo-perf-dev-n${{ matrix.corpus }}')).toBe(1);
    for (const token of [...baselineDispatchScope, ...baselineLabelScope]) {
      expect(jobSource('check-scaling')).toContain(token);
    }
    expect(jobSource('check-scaling')).toContain(
      'KOVO_PERF_RUNNER_IMAGE=github-actions/ubuntu-24.04',
    );
    expect(jobSource('check-scaling')).toContain('--samples 1');
    expect(jobSource('check-scaling')).toContain('retention-days: 90');
  });

  it('runs sustained PR evidence only for an explicit maintainer-applied measurement label', () => {
    for (const job of [
      'check-scaling',
      'browser-matrix',
      'dev-matrix',
      'build-matrix',
      'server-matrix',
    ]) {
      const source = jobSource(job);
      expect(source, job).toContain("github.event.action == 'labeled'");
      expect(source, job).toContain("github.event.label.name == 'perf-measure-baselines'");
    }
    for (const [job, focus] of decisionFocusByJob) {
      const source = jobSource(job);
      expect(source, job).toContain("github.event.action == 'labeled'");
      expect(source, job).toContain("github.event.label.name == 'perf-measure-decisions'");
      expect(source, job).toContain(`github.event.label.name == 'perf-measure-${focus}'`);
      expect(source, job).toContain(
        `inputs.decision_focus == 'all' || inputs.decision_focus == '${focus}'`,
      );
    }
  });

  it('keeps dispatch baseline producers independent from the per-PR smoke and byte jobs', () => {
    for (const job of [
      'check-scaling',
      'browser-matrix',
      'dev-matrix',
      'build-matrix',
      'server-matrix',
    ]) {
      expect(jobSource(job), job).not.toMatch(/^    needs:/mu);
    }
  });

  it('preserves publication-authenticated job conditions while targeting retries before setup', () => {
    for (const [job, family] of baselineProducerFamiliesByJob) {
      const source = jobSource(job);
      expect(jobIfSource(source), job).toBe(publicationAuthenticatedBaselineIf);
      expect(count(source, 'uses: ./.github/actions/kovo-perf-baseline-cpu-admission'), job).toBe(
        1,
      );
      expect(count(source, `KOVO_PERF_BASELINE_FAMILY: ${family}`), job).toBe(1);
      expect(
        count(
          source,
          "KOVO_PERF_BASELINE_FOCUS: ${{ github.event_name == 'workflow_dispatch' && inputs.baseline_focus || '' }}",
        ),
        job,
      ).toBe(1);
      expect(
        count(
          source,
          "KOVO_PERF_BASELINE_CPU_MODEL_SHA256: ${{ github.event_name == 'workflow_dispatch' && inputs.baseline_cpu_model_sha256 || '' }}",
        ),
        job,
      ).toBe(1);
      expect(
        count(
          source,
          'KOVO_PERF_BASELINE_SELECTOR_LABELS_JSON: ${{ toJSON(github.event.pull_request.labels.*.name) }}',
        ),
        job,
      ).toBe(1);
      const admission = source.indexOf('uses: ./.github/actions/kovo-perf-baseline-cpu-admission');
      expect(admission, job).toBeGreaterThan(
        source.indexOf('Authenticate checked-out performance source'),
      );
      expect(admission, job).toBeLessThan(source.indexOf('uses: ./.github/actions/kovo-setup'));
    }

    const dev = jobSource('dev-matrix');
    expect(count(dev, 'corpus: ${{ fromJSON(')).toBe(1);
    expect(dev).toContain("inputs.baseline_focus == 'dev-n24' && '[24]'");
    expect(dev).toContain("inputs.baseline_focus == 'dev-n216' && '[216]'");
    expect(dev).toContain("|| '[24,216]') }}");
    const build = jobSource('build-matrix');
    expect(count(build, 'corpus: ${{ fromJSON(')).toBe(1);
    expect(build).toContain("inputs.baseline_focus == 'build-n24' && '[24]'");
    expect(build).toContain("inputs.baseline_focus == 'build-n216' && '[216]'");
    expect(build).toContain("|| '[24,216]') }}");

    const buildProfile = jobSource('build-profile');
    expect(count(buildProfile, 'uses: ./.github/actions/kovo-perf-baseline-cpu-admission')).toBe(1);
    expect(buildProfile).toContain('KOVO_PERF_BASELINE_FAMILY: build-n216');
    expect(buildProfile).toContain(
      "KOVO_PERF_BASELINE_FOCUS: ${{ github.event_name == 'workflow_dispatch' && inputs.baseline_focus || '' }}",
    );
    expect(buildProfile).toContain(
      'KOVO_PERF_BASELINE_SELECTOR_LABELS_JSON: ${{ toJSON(github.event.pull_request.labels.*.name) }}',
    );
    expect(buildProfile.indexOf('kovo-perf-baseline-cpu-admission')).toBeLessThan(
      buildProfile.indexOf('uses: ./.github/actions/kovo-setup'),
    );
    expect(count(workflow, 'inputs.baseline_cpu_model_sha256')).toBe(6);
    expect(count(workflow, 'inputs.baseline_focus')).toBe(10);
    expect(count(workflow, 'toJSON(github.event.pull_request.labels.*.name)')).toBe(6);
    expect(baselineCpuAdmissionAction).toContain("        NODE_OPTIONS: ''");
    expect(baselineCpuAdmissionAction).toContain('run: node "$GITHUB_ACTION_PATH/check.mjs"');
    expect(baselineCpuAdmissionAction).not.toContain('${{ inputs.');
  });

  it('admits only an exact lowercase CPU-model digest and the selected baseline family', () => {
    const amdModel = 'AMD EPYC 7763 64-Core Processor';
    const amdSha256 = 'f56edd1ddb32e98359af80267bba52d80fedc60bf40440adea1c3ea0e0f429c7';
    expect(
      baselineCpuModelAdmission({ cpuModel: amdModel, expectedSha256: amdSha256 }),
    ).toMatchObject({ actualSha256: amdSha256, admitted: true, constrained: true });
    expect(baselineCpuModelAdmission({ cpuModel: undefined, expectedSha256: '' })).toEqual({
      admitted: true,
      constrained: false,
    });
    for (const malformed of [amdSha256.slice(0, -5), amdSha256.toUpperCase(), ` ${amdSha256}`]) {
      expect(() =>
        baselineCpuModelAdmission({ cpuModel: amdModel, expectedSha256: malformed }),
      ).toThrow('exactly 64 lowercase hexadecimal');
    }
    expect(() =>
      baselineCpuModelAdmission({ cpuModel: amdModel, expectedSha256: '0'.repeat(64) }),
    ).toThrow('baseline CPU model mismatch');
    expect(baselineFamilyAdmission({ family: 'dev-n24', focus: 'dev-n24' })).toMatchObject({
      admitted: true,
      constrained: true,
    });
    expect(() => baselineFamilyAdmission({ family: 'dev-n216', focus: 'dev-n24' })).toThrow(
      'stopping before setup',
    );
    expect(() => baselineFamilyAdmission({ family: 'server', focus: 'not-a-family' })).toThrow(
      'unsupported baseline_focus',
    );
    expect(() =>
      runBaselineCpuModelAdmission({
        cpus: [{ model: amdModel }],
        env: {
          KOVO_PERF_BASELINE_CPU_MODEL_SHA256: amdSha256.slice(0, -5),
          KOVO_PERF_BASELINE_FAMILY: 'server',
          KOVO_PERF_BASELINE_FOCUS: 'browser',
        },
      }),
    ).toThrow('exactly 64 lowercase hexadecimal');
  });

  it('derives only the reviewed PR-label selectors and rejects ambiguity', () => {
    const amdSha256 = 'f56edd1ddb32e98359af80267bba52d80fedc60bf40440adea1c3ea0e0f429c7';
    expect(BASELINE_CPU_LABEL_ALIASES).toEqual({
      'perf-baseline-cpu-amd-7763': amdSha256,
    });
    expect(BASELINE_FOCUS_LABEL_ALIASES).toEqual({
      'perf-baseline-focus-browser': 'browser',
      'perf-baseline-focus-build-n24': 'build-n24',
      'perf-baseline-focus-build-n216': 'build-n216',
      'perf-baseline-focus-check': 'check',
      'perf-baseline-focus-dev-n24': 'dev-n24',
      'perf-baseline-focus-dev-n216': 'dev-n216',
      'perf-baseline-focus-server': 'server',
    });
    for (const empty of [undefined, '', 'null', '[]']) {
      expect(baselineSelectorsFromLabels(empty)).toEqual({ cpuModelSha256: '', focus: '' });
    }
    expect(
      baselineSelectorsFromLabels(
        JSON.stringify([
          'unrelated-label',
          'perf-baseline-cpu-amd-7763',
          'perf-baseline-focus-dev-n216',
        ]),
      ),
    ).toEqual({ cpuModelSha256: amdSha256, focus: 'dev-n216' });
    expect(() => baselineSelectorsFromLabels('{')).toThrow('not valid JSON');
    expect(() => baselineSelectorsFromLabels(JSON.stringify({ label: 'not-an-array' }))).toThrow(
      'JSON array of strings',
    );
    expect(() =>
      baselineSelectorsFromLabels(JSON.stringify(['perf-baseline-cpu-unknown'])),
    ).toThrow('unknown baseline CPU selector label');
    expect(() => baselineSelectorsFromLabels(JSON.stringify(['perf-baseline-focus-all']))).toThrow(
      'unknown baseline focus selector label',
    );
    expect(() =>
      baselineSelectorsFromLabels(
        JSON.stringify(['perf-baseline-cpu-amd-7763', 'perf-baseline-cpu-amd-7763']),
      ),
    ).toThrow('ambiguous baseline CPU selector labels');
    expect(() =>
      baselineSelectorsFromLabels(
        JSON.stringify(['perf-baseline-focus-dev-n24', 'perf-baseline-focus-server']),
      ),
    ).toThrow('ambiguous baseline focus selector labels');

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(
        runBaselineCpuModelAdmission({
          cpus: [{ model: 'AMD EPYC 7763 64-Core Processor' }],
          env: {
            KOVO_PERF_BASELINE_FAMILY: 'server',
            KOVO_PERF_BASELINE_SELECTOR_LABELS_JSON: JSON.stringify([
              'perf-baseline-cpu-amd-7763',
              'perf-baseline-focus-server',
            ]),
          },
        }),
      ).toMatchObject({
        cpu: { actualSha256: amdSha256, constrained: true },
        family: { family: 'server', constrained: true },
      });
    } finally {
      log.mockRestore();
    }
    expect(() =>
      runBaselineCpuModelAdmission({
        cpus: [{ model: 'AMD EPYC 7763 64-Core Processor' }],
        env: {
          KOVO_PERF_BASELINE_CPU_MODEL_SHA256: '0'.repeat(64),
          KOVO_PERF_BASELINE_SELECTOR_LABELS_JSON: JSON.stringify(['perf-baseline-cpu-amd-7763']),
        },
      }),
    ).toThrow('baseline CPU model mismatch');
  });

  it('retains the exact publishable sample policies in the scheduled commands', () => {
    expect(jobSource('browser-matrix')).toEqual(expect.stringContaining('--iterations 30'));
    for (const token of ['--lighthouse-runs 5', '--bfcache-iterations 10']) {
      expect(jobSource('browser-matrix')).toContain(token);
    }
    expect(jobSource('browser-matrix')).not.toContain('--skip-build');
    for (const job of ['dev-matrix', 'build-matrix']) {
      expect(jobSource(job)).toContain("|| '[24,216]') }}");
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
      '--server-host-settle-max-ms 30000',
      '--server-concurrencies 1,8,32',
      '--server-routes listing,detail',
      '--server-encodings identity,br',
      '--server-modes HIT,304,dynamic',
    ]) {
      expect(jobSource('server-matrix')).toContain(token);
    }
    expect(jobSource('server-matrix')).toContain('timeout --signal=TERM --kill-after=30s 330m');
    expect(jobSource('server-matrix')).toContain('timeout-minutes: 360');
  });

  it('fails closed when a publishable measurement lacks hosted-runner identity', () => {
    for (const job of publishableMeasurementJobs) {
      const source = jobSource(job);
      expect(
        count(source, ': "${ImageOS:?GitHub hosted runner did not expose ImageOS}"'),
        job,
      ).toBe(1);
      expect(
        count(source, ': "${ImageVersion:?GitHub hosted runner did not expose ImageVersion}"'),
        job,
      ).toBe(1);
      expect(source, job).not.toContain(':-unknown');
    }
  });

  it('runs the N=216 build profile only as a diagnostic decision with complete raw custody', () => {
    const source = decisionJob('build-profile');
    expect(source).toContain('name: N=216 build CPU profiles');
    expect(source).toContain('sudo apt-get install --yes --no-install-recommends strace');
    expect(source).toContain('test "$(command -v strace)" = /usr/bin/strace');
    expect(source).toContain('benchmarks/corpora/generate.mjs --sizes 216');
    expect(source).toContain('scripts/perf-build-session-profile.mjs');
    expect(source).toContain('--require-provider github-actions');
    expect(source).toContain('name: kovo-perf-build-profile-n216');
    expect(source).toContain('path: ${{ runner.temp }}/kovo-perf/build-profile-n216');
    expect(source).toContain('Profiled durations are intentionally absent');
    expect(source).not.toContain('--duration');
    expectRawArtifact(source, 'kovo-perf-build-profile-n216');
  });

  it('keeps all seven publication artifact families and their ratifier report paths', () => {
    expect(jobSource('check-scaling')).toContain('name: kovo-perf-check-scaling');
    expect(jobSource('check-scaling')).toContain(
      'path: ${{ runner.temp }}/kovo-perf/check-scaling.json',
    );
    expect(jobSource('browser-matrix')).toContain('name: kovo-perf-browser-matrix');
    expect(jobSource('browser-matrix')).toContain('path: ${{ runner.temp }}/kovo-perf/browser');
    expect(jobSource('dev-matrix')).toContain("inputs.baseline_focus == 'dev-n24' && '[24]'");
    expect(jobSource('dev-matrix')).toContain('name: kovo-perf-dev-n${{ matrix.corpus }}');
    expect(jobSource('dev-matrix')).toContain(
      'path: ${{ runner.temp }}/kovo-perf/dev-n${{ matrix.corpus }}',
    );
    expect(jobSource('build-matrix')).toContain("inputs.baseline_focus == 'build-n24' && '[24]'");
    expect(jobSource('build-matrix')).toContain('name: kovo-perf-build-n${{ matrix.corpus }}');
    expect(jobSource('build-matrix')).toContain(
      'path: ${{ runner.temp }}/kovo-perf/build-n${{ matrix.corpus }}',
    );
    expect(jobSource('server-matrix')).toContain('name: kovo-perf-server-matrix');
    expect(jobSource('server-matrix')).toContain('path: ${{ runner.temp }}/kovo-perf/server');
  });

  it('uses the setup-provided vp command and pins every remote action by commit', () => {
    expect(workflow).not.toMatch(/^\s*run:\s+pnpm\b/gmu);
    for (const line of workflow.split('\n').filter((line) => line.includes('uses: actions/'))) {
      expect(line).toMatch(/@[0-9a-f]{40}\s*$/u);
    }
  });

  it('checks out and authenticates one workflow-controlled source commit in every job', () => {
    expect(workflow).toContain(
      "KOVO_PERF_SOURCE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}",
    );
    for (const job of measurementJobs) {
      const source = jobSource(job);
      expect(count(source, 'uses: actions/checkout@'), job).toBe(1);
      expect(count(source, 'ref: ${{ env.KOVO_PERF_SOURCE_SHA }}'), job).toBe(1);
      expect(count(source, 'Authenticate checked-out performance source'), job).toBe(1);
      expect(count(source, 'test "$(git rev-parse HEAD)" = "$KOVO_PERF_SOURCE_SHA"'), job).toBe(1);
      expect(source.indexOf('ref: ${{ env.KOVO_PERF_SOURCE_SHA }}'), job).toBeLessThan(
        source.indexOf('uses: ./.github/actions/kovo-setup'),
      );
    }
    expect(count(workflow, 'uses: actions/checkout@')).toBe(measurementJobs.length);
    expect(count(workflow, 'ref: ${{ env.KOVO_PERF_SOURCE_SHA }}')).toBe(measurementJobs.length);
    expect(workflow).not.toContain('"$GITHUB_SHA"');
  });

  it('runs the authenticated full check-watch candidate decision from exact clean worktrees', () => {
    const source = decisionJob('check-watch-decision');
    expect(source).toContain('fetch-depth: 0');
    expect(source).toContain(
      "KOVO_CHECK_WATCH_BASELINE_SHA: ${{ inputs.check_watch_baseline_sha || 'e3a78ca901035ada82a564943db808255c94ac82' }}",
    );
    expect(source).toContain(
      "KOVO_CHECK_WATCH_CANDIDATE_SHA: ${{ inputs.check_watch_candidate_sha || '2ce61f50b4df290796272e7ea836369e51537e22' }}",
    );
    expect(source).toContain(
      'KOVO_CHECK_WATCH_CANDIDATE_PRODUCTION_COMMIT: 0590083172c0cbdeef4d58219ea384da7cb9f985',
    );
    expect(source).toContain(
      'KOVO_CHECK_WATCH_BASELINE_COMMIT: cc475b3ab2d54ff8201de059e713cc1d7e54400c',
    );
    expect(source).toContain(
      'KOVO_CHECK_WATCH_EVIDENCE_REF: refs/heads/perf-spike/check-watch-repaired-sealed-20260814',
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
    expect(source).toContain('assert_equal()');
    expect(source).toContain('check-watch authentication failed: %s');
    expect(source).toContain(
      'assert_equal \'baseline seal parent\' "$KOVO_CHECK_WATCH_BASELINE_COMMIT"',
    );
    expect(source).toContain('check-watch baseline seal changed unapproved path');
    expect(source).toContain("assert_equal 'candidate ancestry merge base'");
    expect(source).toContain('candidate_range_count="$(git rev-list --count');
    expect(source).toContain("assert_equal 'candidate sealed range commit count' 2");
    expect(source).toContain("assert_equal 'candidate seal parent'");
    expect(source).toContain("assert_equal 'candidate production commit'");
    expect(source).not.toContain('git patch-id --stable');
    expect(source).toContain("assert_equal 'production changed-path count' 7");
    expect(source).toContain('check-watch candidate changed unapproved production path');
    expect(source).toContain('check-watch candidate seal changed unapproved path');
    expect(source).toContain('git worktree add --detach "$baseline_root" "$baseline_commit"');
    expect(source).toContain('git worktree add --detach "$candidate_root" "$candidate_commit"');
    expect(count(source, 'install --offline --frozen-lockfile --ignore-scripts')).toBe(2);
    expect(source).toContain('KOVO_DEVEX_OS_IMAGE=github-actions/ubuntu-24.04@sha256:');
    expect(source).toContain('KOVO_DEVEX_RUNNER_NAME=github-hosted-ubuntu-24.04-accepted');
    expectPnpmBridge(source);
    expect(source).not.toContain('revert --no-edit');
    expect(count(source, '--prepare-kovo-scenario')).toBe(2);
    expect(source).toContain('KOVO_SOURCE_COMMIT="$baseline_commit"');
    expect(source).toContain('KOVO_SOURCE_COMMIT="$candidate_commit"');
    expect(source).toContain('scripts/perf-check-watch-spike.mjs');
    expect(source).toContain('--spike-repo "$RUNNER_TEMP/kovo-check-watch-candidate"');
    expect(source).toContain('--samples 30');
    expect(source).toContain('--warmups 3');
    expectRawArtifact(source, 'kovo-perf-check-watch-decision');
  });

  it('runs both full browser-visible profile-driven critical-path decisions', () => {
    const source = decisionJob('dev-generation-decision');
    expect(source).toContain('packed-product dev critical-path candidate decision');
    expect(source).toContain('corpus: [24, 216]');
    expect(source).toContain('fetch-depth: 0');
    expect(source).toContain('uses: ./.github/actions/playwright-install');
    expectPnpmBridge(source);
    expect(source).toContain(
      'KOVO_DEV_GENERATION_CANDIDATE_COMMIT: 1c591eca2fa7d1ba9c5cf90673cea36c54ee158f',
    );
    expect(source).toContain(
      'KOVO_DEV_GENERATION_CANDIDATE_FIRST_COMMIT: 1aea7dd0678254ceeaa869c537b8f5317777cb08',
    );
    expect(source).toContain(
      'KOVO_DEV_GENERATION_CANDIDATE_PARENT: eb16f11734a2ab635a8207f2e6ece4612713f248',
    );
    expect(source).toContain(
      'KOVO_DEV_GENERATION_CANDIDATE_REF: refs/heads/perf-spike/dev-async-analysis-only-20260814',
    );
    expect(source).toContain(
      'KOVO_DEV_GENERATION_CANDIDATE_SECOND_COMMIT: 07d6e5b23245df0d48fc071f78397329750705ee',
    );
    expect(source).toContain('git fetch --no-tags origin');
    expect(source).toContain(
      '"+$KOVO_DEV_GENERATION_CANDIDATE_REF:$KOVO_DEV_GENERATION_CANDIDATE_REF"',
    );
    expect(source).toContain(
      '"+$KOVO_DEV_GENERATION_CANDIDATE_REF:refs/perf-evidence/dev-generation-candidate"',
    );
    expect(source).toContain(
      'resolved_ref="$(git rev-parse --verify "$KOVO_DEV_GENERATION_CANDIDATE_REF^{commit}")"',
    );
    expect(source).toContain('test "$resolved_ref" = "$KOVO_DEV_GENERATION_CANDIDATE_COMMIT"');
    expect(source).toContain(
      'test "$resolved_candidate" = "$KOVO_DEV_GENERATION_CANDIDATE_COMMIT"',
    );
    expect(source).toContain(
      'test "$(git rev-parse "$KOVO_DEV_GENERATION_CANDIDATE_FIRST_COMMIT^")" = "$KOVO_DEV_GENERATION_CANDIDATE_PARENT"',
    );
    expect(source).toContain(
      'test "$(git rev-parse "$KOVO_DEV_GENERATION_CANDIDATE_SECOND_COMMIT^")" = "$KOVO_DEV_GENERATION_CANDIDATE_FIRST_COMMIT"',
    );
    expect(source).toContain(
      'test "$(git rev-parse "$KOVO_DEV_GENERATION_CANDIDATE_COMMIT^")" = "$KOVO_DEV_GENERATION_CANDIDATE_SECOND_COMMIT"',
    );
    expect(count(source, 'git worktree add --detach')).toBe(2);
    expect(source).toContain('git worktree add --detach "$baseline_root" "$KOVO_PERF_SOURCE_SHA"');
    expect(source).toContain('git worktree add --detach "$spike_root" "$KOVO_PERF_SOURCE_SHA"');
    expect(source).toContain("-c user.name='Kovo Performance CI'");
    expect(source).toContain('cherry-pick \\');
    expect(source).toContain('"$KOVO_DEV_GENERATION_CANDIDATE_FIRST_COMMIT"');
    expect(source).toContain('"$KOVO_DEV_GENERATION_CANDIDATE_SECOND_COMMIT"');
    expect(source).toContain('"$KOVO_DEV_GENERATION_CANDIDATE_COMMIT"');
    expect(source).toContain('git -C "$spike_root" rev-parse HEAD~3');
    expect(source).toContain(
      'test "$(git -C "$spike_root" rev-list --count "$KOVO_PERF_SOURCE_SHA..HEAD")" = 3',
    );
    expect(source).toContain('git -C "$baseline_root" status --porcelain=v1 --untracked-files=all');
    expect(source).toContain('git -C "$spike_root" status --porcelain=v1 --untracked-files=all');
    expect(source).toContain('scripts/perf-dev-generation-spike.mjs');
    expect(source).toContain('Run the full packed-product browser-visible critical-path decision');
    // The v3 runner owns separate build/pack/frozen-install and deferred external-corpus
    // preparation for both exact worktrees. Workflow-side corpus generation or links would change
    // the authenticated product topology before the runner can attest it.
    expect(source).not.toContain('install --dir "$baseline_root/benchmarks/kovo"');
    expect(source).not.toContain('install --dir "$spike_root/benchmarks/kovo"');
    expect(source).not.toContain('benchmarks/corpora/generate.mjs');
    expect(source).not.toContain('benchmarks/kovo/.corpora');
    expect(devGenerationRunner).toContain(
      "export const DEV_GENERATION_SPIKE_SCHEMA = 'kovo-dev-generation-spike-comparison/v3'",
    );
    expect(devGenerationRunner).toContain("dependencyMode: 'deferred'");
    expect(devGenerationRunner).toContain("'--packed-product'");
    expect(devGenerationRunner).toContain("'--packed-product-digest'");
    for (const token of [
      '--size "$KOVO_PERF_CORPUS_SIZE"',
      '--ready-samples 15',
      '--ready-timeout-ms 600000',
      '--edit-samples 30',
      '--warmups 3',
      '--timeout-ms 3600000',
      '--measure',
    ]) {
      expect(source).toContain(token);
    }
    expectRawArtifact(source, 'kovo-perf-dev-generation-n${{ matrix.corpus }}');
  });

  it('runs the exact packed-product build source-trust decision on both corpora', () => {
    const source = decisionJob('build-source-trust-decision');
    expect(source).toContain('corpus: [24, 216]');
    expect(source).toContain('fetch-depth: 0');
    expect(source).not.toContain('playwright-install');
    expectPnpmBridge(source);
    expect(source).toContain(
      'KOVO_BUILD_SOURCE_TRUST_CANDIDATE_COMMIT: c89e179a9e9b179dd75b0bebabd357f4aa9e36a6',
    );
    expect(source).toContain(
      'KOVO_BUILD_SOURCE_TRUST_CANDIDATE_REF: refs/heads/perf-spike/build-source-trust-20260814',
    );
    expect(source).toContain('git fetch --no-tags origin');
    expect(source).toContain(
      '"+$KOVO_BUILD_SOURCE_TRUST_CANDIDATE_REF:refs/perf-evidence/build-source-trust-candidate"',
    );
    expect(source).toContain(
      'test "$resolved_candidate" = "$KOVO_BUILD_SOURCE_TRUST_CANDIDATE_COMMIT"',
    );
    expect(count(source, 'git worktree add --detach')).toBe(2);
    expect(source).toContain('git worktree add --detach "$baseline_root" "$KOVO_PERF_SOURCE_SHA"');
    expect(source).toContain('git worktree add --detach "$spike_root" "$KOVO_PERF_SOURCE_SHA"');
    expect(source).toContain("-c user.name='Kovo Performance CI'");
    expect(source).toContain('cherry-pick "$KOVO_BUILD_SOURCE_TRUST_CANDIDATE_COMMIT"');
    expect(source).toContain('git -C "$spike_root" rev-parse HEAD^');
    expect(source).toContain('git -C "$spike_root" rev-list --count "$KOVO_PERF_SOURCE_SHA..HEAD"');
    expect(source).toContain('git -C "$baseline_root" status --porcelain=v1 --untracked-files=all');
    expect(source).toContain('git -C "$spike_root" status --porcelain=v1 --untracked-files=all');
    expect(source).toContain('scripts/perf-build-source-trust-spike.mjs');
    for (const token of [
      '--size "$KOVO_PERF_CORPUS_SIZE"',
      '--repetitions 5',
      '--install-timeout-ms 600000',
      '--timeout-ms 1800000',
      '--measure',
    ]) {
      expect(source).toContain(token);
    }
    expect(source).not.toContain('--warmups');
    expectRawArtifact(source, 'kovo-perf-build-source-trust-n${{ matrix.corpus }}');
  });

  it('keeps the remaining decision measurements full-policy, parallel, and raw', async () => {
    const cache = decisionJob('compressed-cache-decision');
    expect(cache).toContain('scripts/perf-compressed-cache-ab.mjs');
    expect(cache).not.toContain('--samples');
    expect(cache).not.toContain('--quick-smoke');
    expectRawArtifact(cache, 'kovo-perf-compressed-cache-decision');

    const cli = decisionJob('cli-startup-decision');
    expect(cli).toContain('scripts/perf-cli-startup-benchmark.mjs');
    expect(cli).toContain('--packed-fast-budget-ms 1000');
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
    expect(devProfile).not.toContain('pnpm --dir benchmarks/kovo install');
    expect(devProfile).toContain('--iterations 3');
    expect(devProfile).not.toContain('--iterations 30');
    expect(devProfile).toContain('--ready-iterations 1');
    expect(devProfile).toContain('--warmups 3');
    expect(devProfile).toContain('24|216) ;;');
    expect(devProfile).toContain('dev_port=$((20000 + KOVO_PERF_CORPUS_SIZE))');
    expect(devProfile).toContain('inspector_port=$((21000 + KOVO_PERF_CORPUS_SIZE))');
    expect(devProfile).toContain('--port "$dev_port"');
    expect(devProfile).toContain('--inspector-port "$inspector_port"');
    expect(devProfile).toContain('--ready-timeout-ms 600000');
    expect(devProfile).toContain('--profile-dir "$output_root/raw"');
    expect(devProfile).toContain('scripts/perf-dev-edit-profile-audit.mjs');
    expect(devProfile).toContain('--out "$output_root/audit.json"');
    expect(devProfile).toContain('--require-provider github-actions');
    expect(devProfile).toContain('test "$benchmark_status" -eq 0');
    expect(devProfile).toContain('test "$audit_status" -eq 0');
    expectRawArtifact(devProfile, 'kovo-perf-dev-profile-n${{ matrix.corpus }}');

    const linux = await inspectHostEphemeralPortRanges({
      platform: 'linux',
      readLinuxRange: async () => Buffer.from('32768 60999\n'),
    });
    const darwin = await inspectHostEphemeralPortRanges({
      platform: 'darwin',
      readDarwinRanges: async () => Buffer.from('49152\n65535\n49152\n65535\n1023\n600\n'),
    });
    for (const corpus of [24, 216]) {
      const devPort = 20_000 + corpus;
      const inspectorPort = 21_000 + corpus;
      expect(Math.max(devPort + 1, inspectorPort)).toBeLessThan(32_768);
      for (const host of [linux, darwin]) {
        await expect(
          inspectDevPortAllocation(
            {
              basePort: devPort,
              inspectorPorts: [inspectorPort],
              ports: [devPort, devPort + 1],
            },
            { inspectHostRanges: async () => host },
          ),
        ).resolves.toMatchObject({ complete: true, overlaps: [] });
      }
    }

    const loaderMemo = decisionJob('loader-runtime-memo-decision');
    expect(loaderMemo).toContain('fetch-depth: 0');
    expect(loaderMemo).toContain(
      "KOVO_LOADER_BASELINE_SHA: ${{ inputs.loader_baseline_sha || '3010e8df33869413727003c659bb555ac824d104' }}",
    );
    expect(loaderMemo).toContain(
      "KOVO_LOADER_CANDIDATE_SHA: ${{ inputs.loader_candidate_sha || 'd87b4a1320087c512e25f02a57e88920ae9b1777' }}",
    );
    expect(loaderMemo).toContain(
      'KOVO_LOADER_HISTORICAL_COMMIT: e54c595b5906df9ab9b9b5e3fbf18e76c99e79b9',
    );
    expect(loaderMemo).toContain(
      'KOVO_LOADER_HISTORICAL_REF: refs/heads/perf-spike/loader-memo-e54c595b5',
    );
    expect(loaderMemo).toContain(
      'KOVO_LOADER_PROFILED_PAIR_REF: refs/heads/perf-spike/loader-memo-profiled-pair-20260813',
    );
    expect(loaderMemo).toContain(
      '"+$KOVO_LOADER_PROFILED_PAIR_REF:refs/perf-evidence/loader-memo-profiled-pair"',
    );
    expect(loaderMemo).toContain('test "$resolved_profiled_pair" = "$KOVO_LOADER_CANDIDATE_SHA"');
    expect(loaderMemo).toContain('git fetch --no-tags origin');
    expect(loaderMemo).toContain(
      '"+$KOVO_LOADER_HISTORICAL_REF:refs/perf-evidence/loader-memo-historical"',
    );
    expect(loaderMemo).toContain('test "$resolved_historical" = "$KOVO_LOADER_HISTORICAL_COMMIT"');
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
      'git merge-base --is-ancestor "$candidate_commit" "$KOVO_PERF_SOURCE_SHA"',
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
      expect(run[1]).not.toContain('toJSON(github.event.pull_request.labels');
    }
  });
});

function decisionJob(name) {
  const source = jobSource(name);
  const focus = decisionFocusByJob.get(name);
  if (focus === undefined) throw new Error(`missing decision focus mapping for ${name}`);
  for (const token of decisionDispatchScope) expect(source, name).toContain(token);
  expect(source, name).toContain(
    `inputs.decision_focus == 'all' || inputs.decision_focus == '${focus}'`,
  );
  expect(source, name).toContain("github.event.action == 'labeled'");
  expect(source, name).toContain("github.event.label.name == 'perf-measure-decisions'");
  expect(source, name).toContain(`github.event.label.name == 'perf-measure-${focus}'`);
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

function jobIfSource(source) {
  const start = source.indexOf('    if: >-\n');
  const end = source.indexOf('    runs-on:', start);
  if (start === -1 || end === -1) throw new Error('missing job if expression');
  return source.slice(start, end);
}

function dispatchInputSource(name) {
  const marker = `      ${name}:\n`;
  const start = workflow.indexOf(marker);
  if (start === -1) throw new Error(`missing workflow dispatch input ${name}`);
  const tail = workflow.slice(start + marker.length);
  const next = /^      [a-z_]+:\n/gmu.exec(tail);
  return next === null ? tail : tail.slice(0, next.index);
}
