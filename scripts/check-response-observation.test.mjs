import { describe, expect, it } from 'vitest';

import {
  checkResponseObservation,
  responseObservationManifest,
  responseObservationPackageManifest,
  responseObservationWorkflow,
} from './check-response-observation.mjs';

const tuple = {
  body: 'generic-accepted-equal-length',
  connection: 'complete',
  cookiesAndTokens: 'none',
  headers: ['cache-control', 'content-type', 'vary'],
  redirect: 'equal',
  status: 'equal',
  timingBudget: 'nightly-v1',
  workFactor: 'account-handler-v1',
};

const manifest = {
  schema: 'kovo-response-observation/v1',
  timingBudgets: [
    {
      absoluteEffectThresholdMs: 5,
      counterexampleDirectory: '.kovo/security-failures/response-indistinguishability',
      id: 'nightly-v1',
      madMultiplier: 4,
      noiseModel: 'paired-alternating-median-mad',
      relativeEffectThreshold: 0.2,
      sampleSize: 64,
      warmupSamples: 8,
    },
  ],
  surfaces: [
    {
      class: 'account-recovery',
      id: 'auth.reset',
      source: 'packages/server/src/reset.ts',
      tuple,
      worlds: ['account-present', 'account-absent'],
    },
  ],
};

function run(source, nextManifest = manifest) {
  const files = {
    [responseObservationPackageManifest]: JSON.stringify({
      scripts: {
        'test:response-indistinguishability-nightly':
          'KOVO_RESPONSE_TIMING_ORACLE=1 vitest --run security/response-indistinguishability.nightly.test.ts --reporter=dot',
      },
    }),
    [responseObservationManifest]: JSON.stringify(nextManifest),
    [responseObservationWorkflow]: `
run: vp exec pnpm run test:response-indistinguishability-nightly
path: .kovo/security-failures/**
`,
    'packages/server/src/reset.ts': source,
  };
  return checkResponseObservation({
    manifest: nextManifest,
    readText: (file) => files[file] ?? '',
    repoRoot: '/repo',
    sourceFiles: ['packages/server/src/reset.ts'],
  });
}

describe('check-response-observation', () => {
  it('accepts an exact versioned surface policy and full tuple', () => {
    expect(run('// @kovo-response-observation-candidate auth.reset').ok).toBe(true);
  });

  it('fails closed when a remotely reachable candidate has no policy', () => {
    const result = run('// @kovo-response-observation-candidate auth.future', {
      ...manifest,
      surfaces: [],
    });
    expect(result.ok).toBe(false);
    expect(result.findings.join('\n')).toContain(
      'unclassified remotely reachable surface auth.future',
    );
  });

  it('rejects a policy that omits a tuple axis or selects the wrong worlds', () => {
    const result = run('// @kovo-response-observation-candidate auth.reset', {
      ...manifest,
      surfaces: [
        {
          ...manifest.surfaces[0],
          tuple: { ...tuple, workFactor: '' },
          worlds: ['exists-not-owned', 'absent'],
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.findings.join('\n')).toContain('class/world pair is not canonical');
    expect(result.findings.join('\n')).toContain('attacker observation tuple is incomplete');
  });

  it('rejects a policy with no production candidate', () => {
    const result = run('export const reset = true;');
    expect(result.ok).toBe(false);
    expect(result.findings.join('\n')).toContain('policy auth.reset has no production candidate');
  });

  it('rejects deletion of the nightly run or persisted-counterexample upload', () => {
    const files = {
      [responseObservationPackageManifest]: JSON.stringify({
        scripts: {
          'test:response-indistinguishability-nightly':
            'KOVO_RESPONSE_TIMING_ORACLE=1 vitest --run security/response-indistinguishability.nightly.test.ts --reporter=dot',
        },
      }),
      [responseObservationManifest]: JSON.stringify(manifest),
      [responseObservationWorkflow]: 'name: deleted timing controls',
      'packages/server/src/reset.ts': '// @kovo-response-observation-candidate auth.reset',
    };
    const result = checkResponseObservation({
      manifest,
      readText: (file) => files[file] ?? '',
      repoRoot: '/repo',
      sourceFiles: ['packages/server/src/reset.ts'],
    });
    expect(result.ok).toBe(false);
    expect(result.findings.join('\n')).toContain('nightly timing oracle is not enrolled');
    expect(result.findings.join('\n')).toContain('counterexample artifact upload is missing');
  });
});
