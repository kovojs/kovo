import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PLAN3_SECURITY_GATE_DENOMINATOR,
  evaluateGateBudget,
  evaluateRunnerCalibration,
  loadPlan3CostBudgetManifest,
  loadPlan3GateCommandRegistry,
  parsePlan3CostBudgetArguments,
  parseTimePeakRssKiB,
  runBudgetedGate,
  runnerMatches,
  sumDescendantRssKiB,
  validatePlan3CostBudgetManifest,
  validatePlan3CostRepositoryBindings,
  validatePlan3GateCommandRegistry,
  validatePlan3WorkflowRunnerBindings,
} from './security-cost-budget-runner.mjs';
import { repoRoot } from './lib/repo-root.mjs';

describe('Plan 3 security-gate cost budgets', () => {
  it('freezes every Plan 3 gate, Phase 3 focused suite, and build-integrated proof row', () => {
    const manifest = loadPlan3CostBudgetManifest();
    expect(manifest.gates.map((gate) => gate.id)).toEqual(PLAN3_SECURITY_GATE_DENOMINATOR);
    expect(manifest.gates).toHaveLength(31);
    expect(
      manifest.gates.filter((gate) => gate.groups.includes('phase3')).map((gate) => gate.id),
    ).toEqual([
      'phase3-agent-mediation',
      'phase3-grant-graph',
      'phase3-environment-contract',
      'phase3-derived-dataset',
      'phase3-dependency-capabilities',
    ]);
    expect(
      manifest.gates.filter((gate) => gate.buildTime.status === 'enforced').map((gate) => gate.id),
    ).toEqual([
      'artifact-provenance-build',
      'certificate',
      'phase3-dependency-capabilities',
      'escape-census',
    ]);
    expect(
      manifest.gates.every(
        (gate) =>
          Number.isSafeInteger(gate.wallTimeCeilingMs) &&
          Number.isSafeInteger(gate.peakRssCeilingMiB),
      ),
    ).toBe(true);
  });

  it('binds package entrypoints to the measuring runner rather than adding a duplicate all-gates pass', () => {
    const root = repoRoot();
    const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const manifest = loadPlan3CostBudgetManifest();
    for (const gate of manifest.gates) {
      const scriptName = gate.entrypoint.slice('pnpm run '.length);
      const expected =
        gate.execution === 'self-check'
          ? 'node scripts/security-cost-budget-runner.mjs --check'
          : gate.groups.includes('phase3')
            ? 'node scripts/security-cost-budget-runner.mjs --group phase3'
            : `node scripts/security-cost-budget-runner.mjs --gate ${gate.id}`;
      expect(packageJson.scripts[scriptName], gate.id).toBe(expected);
    }
    expect(packageJson.scripts.check).toContain('pnpm run check:plan3-cost-budgets');
    expect(packageJson.scripts.check).toContain('pnpm run check:artifact-provenance-build');
    expect(packageJson.scripts.check).toContain('pnpm run check:plan3-phase3-gates');
    expect(packageJson.scripts.check).toContain('pnpm run check:analyzable-fragment');
    expect(packageJson.scripts.check).not.toContain(
      'node scripts/security-cost-budget-runner.mjs --all',
    );
    // The unsharded root suite must not scale heavyweight compiler/build
    // proofs past the four-core CI resource envelope. CI shards independently
    // tighten this to one file at a time with --no-file-parallelism.
    expect(packageJson.scripts.test).toBe('vitest --run --maxWorkers=1');
  });

  it('routes already-built pack gates through the existing publish-readiness job', () => {
    const workflow = readFileSync(path.join(repoRoot(), '.github/workflows/ci.yml'), 'utf8');
    const publishJob = workflow.slice(
      workflow.indexOf('  publish-readiness:'),
      workflow.indexOf('  reproducible-pack:'),
    );
    expect(publishJob).toContain('vp exec pnpm run check:pack-security');
    expect(publishJob).toContain('vp exec pnpm run check:certificate-module-identity');
    expect(publishJob.indexOf('vp exec pnpm run check:publish')).toBeLessThan(
      publishJob.indexOf('vp exec pnpm run check:pack-security'),
    );
    expect(workflow).toContain('run: vp exec pnpm run check:hermetic-proof-stage');
    expect(workflow).not.toContain('run: vp exec node scripts/hermetic-proof-stage.mjs');
    for (const job of ['static-core', 'hermetic-proof', 'publish-readiness']) {
      const jobText = workflow.slice(workflow.indexOf(`  ${job}:`));
      expect(jobText.slice(0, 120), job).toContain('runs-on: ubuntu-24.04');
    }
  });

  it('keeps the advisory-feed proofs within a bounded 2.25-GiB budget by serializing files', () => {
    const gate = loadPlan3CostBudgetManifest().gates.find(
      (candidate) => candidate.id === 'advisory-feed',
    );
    expect(gate.peakRssCeilingMiB).toBe(2304);
    expect(gate.steps).toEqual([
      {
        command: [
          'vp',
          'exec',
          'vitest',
          '--run',
          'packages/cli/src/commands/advisory-feed-gate.test.ts',
          '--maxWorkers=1',
          '--pool=threads',
          '--reporter=dot',
        ],
      },
      {
        command: [
          'vp',
          'exec',
          'vitest',
          '--run',
          'packages/cli/src/commands/advisories.test.ts',
          '--maxWorkers=1',
          '--pool=threads',
          '--testNamePattern=^(?!.*real Sigstore trust boundary)',
          '--reporter=dot',
        ],
      },
      {
        command: [
          'vp',
          'exec',
          'vitest',
          '--run',
          'packages/cli/src/commands/advisories.test.ts',
          '--maxWorkers=1',
          '--pool=threads',
          '--testNamePattern=real Sigstore trust boundary',
          '--reporter=dot',
        ],
      },
    ]);
  });

  it('labels only the exact CI image, architecture, and Node calibration as intended', () => {
    const intended = loadPlan3CostBudgetManifest().intendedRunner;
    const exact = {
      architecture: 'x64',
      env: {
        GITHUB_ACTIONS: 'true',
        ImageOS: 'ubuntu24',
        RUNNER_OS: 'Linux',
      },
      node: '24.18.0',
      osRelease: 'ID=ubuntu\nVERSION_ID="24.04"\n',
      platform: 'linux',
    };
    expect(runnerMatches(intended, exact)).toBe(true);
    expect(runnerMatches(intended, { ...exact, node: '24.19.0' })).toBe(false);
    expect(runnerMatches(intended, { ...exact, env: {} })).toBe(false);
    expect(
      runnerMatches(intended, {
        ...exact,
        osRelease: 'ID=ubuntu\nVERSION_ID="22.04"\n',
      }),
    ).toBe(false);
    expect(evaluateRunnerCalibration(intended, exact)).toEqual([]);
    expect(
      evaluateRunnerCalibration(intended, {
        ...exact,
        node: '24.19.0',
      }).join('\n'),
    ).toContain('exact reviewed GitHub Actions calibration');
    expect(
      evaluateRunnerCalibration(intended, {
        ...exact,
        env: { ...exact.env, GITHUB_ACTIONS: 'false' },
        node: '24.19.0',
      }),
    ).toEqual([]);
  });

  it('kills denominator, threshold, build-scope, and reviewed-N/A drift', () => {
    const manifest = loadPlan3CostBudgetManifest();
    const commands = loadPlan3GateCommandRegistry();

    const missing = structuredClone(manifest);
    missing.gates.splice(4, 1);
    expect(validatePlan3CostBudgetManifest(missing).join('\n')).toContain(
      'gate denominator/order drifted',
    );

    const unbounded = structuredClone(manifest);
    delete unbounded.gates[3].peakRssCeilingMiB;
    expect(validatePlan3CostBudgetManifest(unbounded).join('\n')).toContain(
      'peakRssCeilingMiB must be an enforced integer ceiling',
    );

    const unmeasuredBuild = structuredClone(manifest);
    delete unmeasuredBuild.gates[1].steps.find((step) => step.buildIntegrated).buildIntegrated;
    expect(validatePlan3CostBudgetManifest(unmeasuredBuild).join('\n')).toContain(
      'enforces build time but marks no build-integrated step',
    );

    const dishonestNa = structuredClone(manifest);
    dishonestNa.gates[2].buildTime.reviewedReason = 'N/A';
    expect(validatePlan3CostBudgetManifest(dishonestNa).join('\n')).toContain(
      'must explain the reviewed N/A decision',
    );

    const divertedHermeticWorker = structuredClone(manifest);
    divertedHermeticWorker.gates.find(
      (gate) => gate.id === 'hermetic-proof-stage',
    ).steps[0].command = ['node', 'scripts/no-op.mjs'];
    expect(validatePlan3CostBudgetManifest(divertedHermeticWorker).join('\n')).toContain(
      'exact measured hermetic-proof-stage worker command',
    );

    const widenedHermeticHost = structuredClone(manifest);
    widenedHermeticHost.gates.find(
      (gate) => gate.id === 'hermetic-proof-stage',
    ).peakRssCeilingMiB += 1;
    expect(validatePlan3CostBudgetManifest(widenedHermeticHost).join('\n')).toContain(
      'exact combined ceiling',
    );

    expect(validatePlan3CostRepositoryBindings(manifest)).toEqual([]);

    const workflow = readFileSync(path.join(repoRoot(), '.github/workflows/ci.yml'), 'utf8');
    expect(validatePlan3WorkflowRunnerBindings(manifest, workflow)).toEqual([]);
    const poisonedWorkflow = workflow.replace(
      '  static-core:\n    runs-on: ubuntu-24.04',
      '  static-core:\n    # runs-on: ubuntu-24.04\n    runs-on: ubuntu-22.04',
    );
    expect(validatePlan3WorkflowRunnerBindings(manifest, poisonedWorkflow).join('\n')).toContain(
      'static-core must run on exact image ubuntu-24.04',
    );

    const divertedBudgetStep = structuredClone(manifest);
    divertedBudgetStep.gates.find((gate) => gate.id === 'security-guarantee').steps[0].command = [
      'node',
      'scripts/no-op.mjs',
    ];
    expect(validatePlan3GateCommandRegistry(commands, divertedBudgetStep).join('\n')).toContain(
      'differs from its independently reviewed steps',
    );

    const divertedCommandStep = structuredClone(commands);
    divertedCommandStep.gates.find((gate) => gate.id === 'security-guarantee').steps[0].command = [
      'node',
      'scripts/no-op.mjs',
    ];
    expect(validatePlan3GateCommandRegistry(divertedCommandStep, manifest).join('\n')).toContain(
      'differs from its independently reviewed steps',
    );

    const coherentEvalNoOpManifest = structuredClone(manifest);
    const coherentEvalNoOpCommands = structuredClone(commands);
    coherentEvalNoOpManifest.gates.find(
      (gate) => gate.id === 'security-guarantee',
    ).steps[0].command = ['node', '-e', 'process.exit(0)'];
    coherentEvalNoOpCommands.gates.find(
      (gate) => gate.id === 'security-guarantee',
    ).steps[0].command = ['node', '-e', 'process.exit(0)'];
    expect(
      validatePlan3GateCommandRegistry(coherentEvalNoOpCommands, coherentEvalNoOpManifest).join(
        '\n',
      ),
    ).toContain('opaque shell/eval vector');
  });

  it('enforces wall, peak-RSS, and end-to-end build ceilings as verdicts', () => {
    const gate = loadPlan3CostBudgetManifest().gates.find(
      (candidate) => candidate.id === 'certificate',
    );
    expect(
      evaluateGateBudget(gate, {
        buildTimeMs: gate.buildTime.ceilingMs,
        peakRssMiB: gate.peakRssCeilingMiB,
        wallTimeMs: gate.wallTimeCeilingMs,
      }),
    ).toEqual({ findings: [], ok: true });

    const failed = evaluateGateBudget(gate, {
      buildTimeMs: gate.buildTime.ceilingMs + 1,
      peakRssMiB: gate.peakRssCeilingMiB + 1,
      wallTimeMs: gate.wallTimeCeilingMs + 1,
    });
    expect(failed.ok).toBe(false);
    expect(failed.findings.join('\n')).toContain('wall');
    expect(failed.findings.join('\n')).toContain('peak RSS');
    expect(failed.findings.join('\n')).toContain('build');
  });

  it('measures a real child process, writes ignored evidence, and carries no SHA stamp', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kovo-plan3-cost-test-'));
    try {
      const manifest = loadPlan3CostBudgetManifest();
      const gate = {
        ...manifest.gates.find((candidate) => candidate.id === 'security-guarantee'),
        id: 'synthetic-child',
        peakRssCeilingMiB: 1024,
        steps: [{ command: [process.execPath, '-e', 'Buffer.alloc(1024 * 1024);'] }],
        wallTimeCeilingMs: 10000,
      };
      const result = await runBudgetedGate(gate, manifest, {
        repoRoot: repoRoot(),
        reportDirectory: directory,
      });
      expect(result.verdict.ok).toBe(true);
      expect(result.measurement.wallTimeMs).toBeGreaterThan(0);
      expect(result.measurement.peakRssMiB).toBeGreaterThan(0);
      const report = readFileSync(path.join(directory, 'synthetic-child.json'), 'utf8');
      expect(report).toContain('kovo.plan3-security-gate-cost-report/v1');
      expect(report).not.toMatch(/sha(?:1|256|512)?/iu);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('terminates a command when the enforced wall ceiling binds', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kovo-plan3-cost-timeout-'));
    try {
      const manifest = loadPlan3CostBudgetManifest();
      const gate = {
        ...manifest.gates.find((candidate) => candidate.id === 'security-guarantee'),
        id: 'synthetic-timeout',
        peakRssCeilingMiB: 1024,
        steps: [{ command: [process.execPath, '-e', 'setTimeout(() => {}, 10_000);'] }],
        wallTimeCeilingMs: 100,
      };
      await expect(
        runBudgetedGate(gate, manifest, {
          repoRoot: repoRoot(),
          reportDirectory: directory,
        }),
      ).rejects.toThrow('time ceiling exceeded');
      const report = JSON.parse(
        readFileSync(path.join(directory, 'synthetic-timeout.json'), 'utf8'),
      );
      expect(report.result).toMatchObject({ ok: false });
      expect(report.result.failedStep.terminationReason).toContain('time ceiling exceeded');
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it.runIf(process.platform !== 'win32')(
    'kills a SIGTERM-ignoring descendant before a timed-out gate returns',
    async () => {
      const directory = mkdtempSync(path.join(os.tmpdir(), 'kovo-plan3-cost-tree-timeout-'));
      const pidFile = path.join(directory, 'descendant.pid');
      try {
        const manifest = loadPlan3CostBudgetManifest();
        const descendantSource = "process.on('SIGTERM', () => {}); setInterval(() => {}, 10_000);";
        const parentSource = [
          "const { spawn } = require('node:child_process');",
          "const { writeFileSync } = require('node:fs');",
          `const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendantSource)}], { stdio: 'ignore' });`,
          `writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
          'setInterval(() => {}, 10_000);',
        ].join('\n');
        const gate = {
          ...manifest.gates.find((candidate) => candidate.id === 'security-guarantee'),
          id: 'synthetic-tree-timeout',
          peakRssCeilingMiB: 1024,
          steps: [{ command: [process.execPath, '-e', parentSource] }],
          wallTimeCeilingMs: 250,
        };

        await expect(
          runBudgetedGate(gate, manifest, {
            repoRoot: repoRoot(),
            reportDirectory: directory,
          }),
        ).rejects.toThrow('time ceiling exceeded');
        expect(existsSync(pidFile)).toBe(true);
        const descendantPid = Number(readFileSync(pidFile, 'utf8'));
        expect(() => process.kill(descendantPid, 0)).toThrow();
      } finally {
        rmSync(directory, { force: true, recursive: true });
      }
    },
  );

  it('normalizes GNU/Linux and macOS high-water RSS units and sums descendants', () => {
    expect(parseTimePeakRssKiB('Maximum resident set size (kbytes): 12345\n', 'linux')).toBe(12345);
    expect(parseTimePeakRssKiB('  12641280  maximum resident set size\n', 'darwin')).toBe(12345);
    expect(
      sumDescendantRssKiB(10, [
        { parentPid: 1, pid: 10, rssKiB: 100 },
        { parentPid: 10, pid: 11, rssKiB: 200 },
        { parentPid: 11, pid: 12, rssKiB: 300 },
        { parentPid: 1, pid: 99, rssKiB: 9000 },
      ]),
    ).toBe(600);
  });

  it('keeps forwarded writer arguments scoped to one gate', () => {
    expect(parsePlan3CostBudgetArguments(['--check'])).toEqual({
      forwardedArgs: [],
      mode: 'check',
    });
    expect(parsePlan3CostBudgetArguments(['--group', 'phase3'])).toEqual({
      forwardedArgs: [],
      group: 'phase3',
      mode: 'group',
    });
    expect(parsePlan3CostBudgetArguments(['--gate', 'pack-security', '--', '--write'])).toEqual({
      forwardedArgs: ['--write'],
      gateId: 'pack-security',
      mode: 'gate',
    });
    expect(() => parsePlan3CostBudgetArguments(['--all', '--write'])).toThrow();
  });
});
