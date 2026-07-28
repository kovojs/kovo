import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BASELINE_KNOWN_FAILURE_IDS,
  DESIRED_BEHAVIOR_EXIT_CODE,
  INFRASTRUCTURE_ERROR_EXIT_CODE,
  REPRODUCED_DEFECT_EXIT_CODE,
  knownFailureSummary,
  runKnownFailureProbes,
  validateKnownFailureRegister,
} from './known-failure-register.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const register = JSON.parse(
  readFileSync(path.join(repoRoot, 'scripts/known-failure-register.json'), 'utf8'),
);
const budgets = JSON.parse(readFileSync(path.join(repoRoot, 'devex-budgets.json'), 'utf8'));
const packedProbeSource = readFileSync(
  path.join(repoRoot, 'scripts/known-failure-probes/packed-cli-contract.mjs'),
  'utf8',
);

describe('known-failure register', () => {
  it('covers the exact ten named baseline defects with stable IDs and bounded packed mappings', () => {
    expect(validateKnownFailureRegister(register, { repoRoot })).toEqual([]);
    expect(register.entries.map((entry) => entry.id)).toEqual(BASELINE_KNOWN_FAILURE_IDS);
    expect(knownFailureSummary(register)).toEqual({
      executable: 2,
      'pending-repro': 8,
      retired: 0,
    });
    expect(
      register.entries.every(
        (entry) =>
          entry.owner.length > 0 &&
          entry.childLedger === 'devex-gates.md' &&
          entry.planOwnership.registerTrack === 'Track 0' &&
          entry.planOwnership.reproducerTrack === 'Track 2' &&
          entry.planOwnership.scorecardGates.length > 0 &&
          entry.observedLayer.length > 0 &&
          entry.retirementCondition.length > 0 &&
          entry.probe.packedInput === true &&
          entry.probe.timeoutMs >= 1000 &&
          entry.probe.timeoutMs <= 600000,
      ),
    ).toBe(true);
  });

  it('separates valid register data from still-incomplete executable closure', () => {
    const script = path.join(repoRoot, 'scripts/known-failure-register.mjs');
    const schema = spawnSync('node', [script, '--validate-schema'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const closure = spawnSync('node', [script, '--require-executable'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(schema.status).toBe(0);
    expect(schema.stdout).toContain('SCHEMA_VALID');
    expect(schema.stdout).toContain('EXECUTABLE_CLOSURE_INCOMPLETE');
    expect(schema.stdout).not.toContain('\nOK\n');
    expect(closure.status).toBe(1);
    expect(closure.stderr).toContain('repro coverage is incomplete');
  });

  it('owns probe exit semantics in code and rejects a data-defined protocol', () => {
    expect(DESIRED_BEHAVIOR_EXIT_CODE).toBe(0);
    expect(REPRODUCED_DEFECT_EXIT_CODE).toBe(1);
    expect(INFRASTRUCTURE_ERROR_EXIT_CODE).toBe(2);
    const redefined = structuredClone(register);
    redefined.protocol = { reproducedDefectExitCode: 0 };
    expect(validateKnownFailureRegister(redefined, { repoRoot })).toContain(
      'protocol is runner-owned and must not be redefined by register data',
    );
  });

  it('materializes authenticated tarballs without running a dependency install', () => {
    expect(packedProbeSource).toContain('validatedPackageTarballEntries');
    expect(packedProbeSource).toContain('verifyPackedAttestationBytes');
    expect(packedProbeSource).not.toMatch(/\bpnpm\s+install\b/u);
    expect(packedProbeSource).not.toContain('--no-frozen-lockfile');
    expect(packedProbeSource).not.toContain('--ignore-scripts');
  });

  it('keeps the full-catalog known failure linked to a non-binding provisional RSS target', () => {
    expect(budgets.metrics['ui.fullCatalog.peakRssBytes']).toMatchObject({
      unit: 'bytes',
      provisionalTarget: 2 * 1024 * 1024 * 1024,
      ratification: null,
      knownFailure: 'KF-DEVEX-007',
    });
  });

  it('reports missing IDs, missing probe files, and stale unregistered probe files', () => {
    const missingId = structuredClone(register);
    missingId.entries = missingId.entries.slice(1);
    expect(validateKnownFailureRegister(missingId, { repoRoot })).toContain(
      'missing baseline known-failure ID: KF-DEVEX-001',
    );

    const missingProbe = structuredClone(register);
    missingProbe.entries[0].probe.path = 'scripts/known-failure-probes/absent.mjs';
    missingProbe.entries[0].probe.command[1] = 'scripts/known-failure-probes/absent.mjs';
    expect(validateKnownFailureRegister(missingProbe, { repoRoot })).toContain(
      'KF-DEVEX-001: mapped probe is missing: scripts/known-failure-probes/absent.mjs',
    );

    const noMappings = structuredClone(register);
    noMappings.entries = noMappings.entries.map((entry) => ({
      ...entry,
      probe: {
        ...entry.probe,
        path: 'scripts/known-failure-probes/absent.mjs',
        command: ['node', 'scripts/known-failure-probes/absent.mjs'],
      },
    }));
    expect(validateKnownFailureRegister(noMappings, { repoRoot })).toEqual(
      expect.arrayContaining([
        'stale unregistered probe: scripts/known-failure-probes/packed-cli-contract.mjs',
        'stale unregistered probe: scripts/known-failure-probes/pending.mjs',
      ]),
    );
  });

  it('keeps reproduced defects green and makes an unexpected pass red until retirement', () => {
    const xfail = runKnownFailureProbes(register, {
      repoRoot,
      packedManifest: 'fixture-packed-manifest.json',
      spawnSync: () => processResult(1),
    });
    const xpass = runKnownFailureProbes(register, {
      repoRoot,
      packedManifest: 'fixture-packed-manifest.json',
      spawnSync: () => processResult(0),
    });

    expect(xfail.availableProbesPass).toBe(true);
    expect(xfail.executableClosureComplete).toBe(false);
    expect(xfail.pass).toBe(false);
    expect(xfail.results.filter((result) => result.status === 'xfail')).toEqual([
      expect.objectContaining({ id: 'KF-DEVEX-003' }),
      expect.objectContaining({ id: 'KF-DEVEX-004' }),
    ]);
    expect(xpass.pass).toBe(false);
    expect(xpass.results.filter((result) => result.status === 'xpass')).toEqual([
      expect.objectContaining({ id: 'KF-DEVEX-003' }),
      expect.objectContaining({ id: 'KF-DEVEX-004' }),
    ]);
  });

  it('does not mistake an infrastructure error for defect reproduction', () => {
    const result = runKnownFailureProbes(register, {
      repoRoot,
      packedManifest: 'fixture-packed-manifest.json',
      spawnSync: () => processResult(2),
    });
    expect(result.pass).toBe(false);
    expect(result.results.filter((item) => item.status === 'infrastructure-error')).toEqual([
      expect.objectContaining({ id: 'KF-DEVEX-003' }),
      expect.objectContaining({ id: 'KF-DEVEX-004' }),
    ]);
  });
});

function processResult(status) {
  return {
    status,
    signal: null,
    error: null,
    stdout: '',
    stderr: status === 1 ? 'reproduced' : status === 2 ? 'infrastructure' : '',
  };
}
