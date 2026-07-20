import { readFileSync } from 'node:fs';

import type * as CoreGraph from '@kovojs/core/internal/graph';
import { describe, expect, it } from 'vitest';

import { escapeObligationManifestForBuild } from './build-export.js';

const artifactSubject = `sha256:${'b'.repeat(64)}` as const;
const obligation = {
  evidence: {
    digest: `sha256:${'a'.repeat(64)}` as const,
    kind: 'test' as const,
    reference: 'tests/authz/admin-role-grant',
  },
  invariant: 'governed-write.authorized-principal' as const,
  why: { guard: 'guards.role:admin', kind: 'guard-chain' as const },
};

describe('build escape-obligation emission (SPEC §§6.6, 11.2)', () => {
  it('emits unsigned artifact-bound subjects and fails closed on analyzer gaps', () => {
    const graph = {
      capabilities: [
        {
          kind: 'serverValue',
          obligation,
          site: 'src/mutations.ts:44',
          siteIdentity: 'src/mutations.ts:1200:1510',
          target: 'trustedAssign',
        },
      ],
      runtimePosture: {
        artifactSubject,
        facts: { endpointAuth: [], egressAllowlist: [], irVersions: [], trustEscapes: [] },
        postureDigest: `sha256:${'c'.repeat(64)}`,
        schema: 'kovo-runtime-posture/v1',
      },
    } satisfies CoreGraph.KovoCheckInput;

    expect(escapeObligationManifestForBuild(graph)).toEqual({
      artifactSubject,
      schema: 'kovo.escape-obligations/v1',
      subjects: [
        {
          artifactSubject,
          obligation,
          schema: 'kovo.escape-obligation-review/v1',
          siteIdentity: 'src/mutations.ts:1200:1510',
        },
      ],
    });
    expect(() =>
      escapeObligationManifestForBuild({
        ...graph,
        capabilities: [
          {
            kind: 'serverValue',
            site: 'src/mutations.ts:44',
            siteIdentity: 'src/mutations.ts:1200:1510',
            target: 'trustedAssign',
          },
        ],
      }),
    ).toThrow(/KV438.*structured obligation/u);

    expect(() =>
      escapeObligationManifestForBuild({
        ...graph,
        capabilities: [
          { kind: 'serverValue', obligation, site: 'src/mutations.ts:44', target: 'trustedAssign' },
        ],
      }),
    ).toThrow(/KV438.*call-site identity/u);
  });

  it('keeps private signing authority outside the build implementation', () => {
    const source = readFileSync(new URL('./build-export.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('createRuntimeAttestationCryptoHandle');
    expect(source).not.toContain('createEscapeObligationReviewEnvelope');
    expect(source).not.toMatch(/\.sign\s*\(/u);
  });
});
