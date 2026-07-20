import { describe, expect, it } from 'vitest';

import {
  checkResponseObservation,
  responseObservationAuthLifecycle,
  responseObservationBetterAuthInternal,
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

const futureDoors = [
  {
    id: 'better-auth.sign-up-email',
    normalizer: 'normalizeBetterAuthAccountOperation',
    reachability: 'structurally-unreachable',
    source: 'packages/better-auth/src/response-observation.ts',
    upstreamApi: 'signUpEmail',
  },
];

const authLifecycle = {
  kovoOwnedTransitions: [
    { devOnly: false, id: 'signIn', upstreamApi: 'signInEmail' },
    { devOnly: false, id: 'signOut', upstreamApi: 'signOut' },
    { devOnly: true, id: 'seedSignUp', upstreamApi: 'signUpEmail' },
    {
      devOnly: false,
      feature: 'password-reset-mail',
      id: 'requestPasswordReset',
      upstreamApi: 'requestPasswordReset',
    },
  ],
  schema: 'kovo-auth-lifecycle-boundary/v1',
  structurallyUnreachable: [{ id: 'unsafe-method-provider-lifecycle' }],
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
  futureDoors,
  surfaces: [
    {
      class: 'account-recovery',
      id: 'better-auth.request-password-reset',
      source: 'packages/better-auth/src/response-observation.ts',
      tuple,
      worlds: ['account-present', 'account-absent'],
    },
    {
      class: 'account-recovery',
      id: 'auth.reset',
      source: 'packages/server/src/reset.ts',
      tuple,
      worlds: ['account-present', 'account-absent'],
    },
  ],
};

function run(source, nextManifest = manifest, lifecycle = authLifecycle) {
  const files = {
    [responseObservationAuthLifecycle]: JSON.stringify(lifecycle),
    [responseObservationBetterAuthInternal]: `
export { normalizeBetterAuthAccountOperation, normalizeBetterAuthPasswordResetResponse };
`,
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
    'packages/better-auth/src/response-observation.ts': `
/** @kovo-response-observation-future-door better-auth.sign-up-email */
export async function normalizeBetterAuthAccountOperation() {}
/** @kovo-response-observation-candidate better-auth.request-password-reset */
export async function normalizeBetterAuthPasswordResetResponse() {}
`,
    'packages/server/src/reset.ts': source,
  };
  return checkResponseObservation({
    manifest: nextManifest,
    readText: (file) => files[file] ?? '',
    repoRoot: '/repo',
    sourceFiles: [
      'packages/better-auth/src/response-observation.ts',
      'packages/server/src/reset.ts',
    ],
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

  it('fails closed when a remotely reachable Better Auth door loses its policy', () => {
    const unreachableLifecycle = {
      ...authLifecycle,
      kovoOwnedTransitions: authLifecycle.kovoOwnedTransitions.filter(
        (transition) => transition.id !== 'requestPasswordReset',
      ),
    };
    const withoutPolicy = run(
      '// @kovo-response-observation-candidate auth.reset',
      { ...manifest, surfaces: manifest.surfaces.slice(1) },
      authLifecycle,
    );
    expect(withoutPolicy.ok).toBe(false);
    expect(withoutPolicy.findings.join('\n')).toContain(
      'better-auth.request-password-reset: remotely reachable Better Auth lifecycle needs a surface policy',
    );
    const missingFutureDoor = run(
      '// @kovo-response-observation-candidate auth.reset',
      { ...manifest, futureDoors: [] },
      unreachableLifecycle,
    );
    expect(missingFutureDoor.ok).toBe(false);
    expect(missingFutureDoor.findings.join('\n')).toContain(
      'missing closed future door better-auth.request-password-reset',
    );
  });

  it('rejects deletion of the nightly run or persisted-counterexample upload', () => {
    const files = {
      [responseObservationAuthLifecycle]: JSON.stringify(authLifecycle),
      [responseObservationBetterAuthInternal]: `
export { normalizeBetterAuthAccountOperation, normalizeBetterAuthPasswordResetResponse };
`,
      [responseObservationPackageManifest]: JSON.stringify({
        scripts: {
          'test:response-indistinguishability-nightly':
            'KOVO_RESPONSE_TIMING_ORACLE=1 vitest --run security/response-indistinguishability.nightly.test.ts --reporter=dot',
        },
      }),
      [responseObservationManifest]: JSON.stringify(manifest),
      [responseObservationWorkflow]: 'name: deleted timing controls',
      'packages/better-auth/src/response-observation.ts': `
/** @kovo-response-observation-future-door better-auth.sign-up-email */
export async function normalizeBetterAuthAccountOperation() {}
/** @kovo-response-observation-candidate better-auth.request-password-reset */
export async function normalizeBetterAuthPasswordResetResponse() {}
`,
      'packages/server/src/reset.ts': '// @kovo-response-observation-candidate auth.reset',
    };
    const result = checkResponseObservation({
      manifest,
      readText: (file) => files[file] ?? '',
      repoRoot: '/repo',
      sourceFiles: [
        'packages/better-auth/src/response-observation.ts',
        'packages/server/src/reset.ts',
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.findings.join('\n')).toContain('nightly timing oracle is not enrolled');
    expect(result.findings.join('\n')).toContain('counterexample artifact upload is missing');
  });
});
