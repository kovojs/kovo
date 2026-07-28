import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BASELINE_KNOWN_FAILURE_IDS,
  knownFailureSummary,
  runKnownFailureProbes,
  validateKnownFailureRegister,
} from './known-failure-register.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const register = JSON.parse(
  readFileSync(path.join(repoRoot, 'scripts/known-failure-register.json'), 'utf8'),
);
const budgets = JSON.parse(readFileSync(path.join(repoRoot, 'devex-budgets.json'), 'utf8'));

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
          entry.probe.packedInput === true &&
          entry.probe.timeoutMs >= 1000 &&
          entry.probe.timeoutMs <= 600000,
      ),
    ).toBe(true);
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

    expect(xfail.pass).toBe(true);
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
