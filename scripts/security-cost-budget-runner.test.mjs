import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PLAN3_SECURITY_GATE_DENOMINATOR,
  evaluateGateBudget,
  loadPlan3CostBudgetManifest,
  parsePlan3CostBudgetArguments,
  parseTimePeakRssKiB,
  runBudgetedGate,
  sumDescendantRssKiB,
  validatePlan3CostBudgetManifest,
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
    ).toEqual(['artifact-provenance-build', 'certificate']);
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
  });

  it('kills denominator, threshold, build-scope, and reviewed-N/A drift', () => {
    const manifest = loadPlan3CostBudgetManifest();

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
