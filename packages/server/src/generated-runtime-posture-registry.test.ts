import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publicScopedKey } from '@kovojs/core';
import { createMemoryStorage } from '@kovojs/core/internal/storage';

import {
  registerGeneratedRuntimePostureManifest,
  runtimePostureAttestationResponse,
} from './generated-runtime-posture-registry.js';
import { securityDecisionEventRecorderArmed, securityEventSnapshot } from './security-event.js';

const originalDeployment = process.env.KOVO_ATTESTATION_DEPLOYMENT_ID;
const originalSecret = process.env.KOVO_ATTESTATION_SECRET;

beforeAll(() => {
  process.env.KOVO_ATTESTATION_DEPLOYMENT_ID = 'deployment:test-registry';
  process.env.KOVO_ATTESTATION_SECRET =
    'generated-runtime-posture-test-secret-0123456789abcdef0123456789abcdef';
  registerGeneratedRuntimePostureManifest({
    artifactSubject: `sha256:${'a'.repeat(64)}`,
    facts: { endpointAuth: [], egressAllowlist: [], irVersions: [], trustEscapes: [] },
    postureDigest: `sha256:${'b'.repeat(64)}`,
    schema: 'kovo-runtime-posture/v1',
  });
});

afterAll(() => {
  if (originalDeployment === undefined) delete process.env.KOVO_ATTESTATION_DEPLOYMENT_ID;
  else process.env.KOVO_ATTESTATION_DEPLOYMENT_ID = originalDeployment;
  if (originalSecret === undefined) delete process.env.KOVO_ATTESTATION_SECRET;
  else process.env.KOVO_ATTESTATION_SECRET = originalSecret;
});

describe('generated runtime posture registry', () => {
  it('arms the single event door and connects core decisions before app evaluation', async () => {
    expect(securityDecisionEventRecorderArmed()).toBe(true);
    const storage = createMemoryStorage();
    await storage.put(publicScopedKey('answerability-object'), 'value');
    expect(securityEventSnapshot()).toContainEqual(
      expect.objectContaining({
        decisionSite: 'framework:storage:scoped-key-admission',
        door: 'storage',
        outcome: 'allow',
        principal: { epoch: null, id: null, kind: 'anonymous', tenant: null },
        resourceScope: {
          identity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
          kind: 'object',
        },
        type: 'security-decision',
      }),
    );
  });

  it('serves a no-store nonce-bound envelope and refuses replay', async () => {
    const nonce = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const first = await runtimePostureAttestationResponse(
      new Request('https://app.example/_kovo/attest', {
        body: JSON.stringify({ nonce }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
      { method: 'POST', surface: 'other' },
    );
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(await first.json()).toMatchObject({
      payload: {
        artifactSubject: `sha256:${'a'.repeat(64)}`,
        deploymentId: 'deployment:test-registry',
        nonce,
      },
    });

    const replay = await runtimePostureAttestationResponse(
      new Request('https://app.example/_kovo/attest', {
        body: JSON.stringify({ nonce }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
      { method: 'POST', surface: 'other' },
    );
    expect(replay.status).toBe(409);
  });

  it('allows only POST', async () => {
    const response = await runtimePostureAttestationResponse(
      new Request('https://app.example/_kovo/attest'),
      { method: 'GET', surface: 'other' },
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });
});
