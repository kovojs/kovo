import { afterEach, describe, expect, it, vi } from 'vitest';

const ENVIRONMENT_KEYS = [
  'KOVO_ATTESTATION_DEPLOYMENT_ID',
  'KOVO_ATTESTATION_SECRET',
  'NODE_ENV',
] as const;

const originalEnvironment = new Map<string, string | undefined>();
for (const key of ENVIRONMENT_KEYS) originalEnvironment.set(key, process.env[key]);

const manifest = {
  artifactSubject: `sha256:${'a'.repeat(64)}` as const,
  facts: { endpointAuth: [], egressAllowlist: [], irVersions: [], trustEscapes: [] },
  postureDigest: `sha256:${'b'.repeat(64)}` as const,
  schema: 'kovo-runtime-posture/v1' as const,
};

function setEnvironment(name: (typeof ENVIRONMENT_KEYS)[number], value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  for (const key of ENVIRONMENT_KEYS) setEnvironment(key, originalEnvironment.get(key));
  vi.resetModules();
});

describe('generated runtime posture journal boot contract (SPEC §11.2)', () => {
  it('fails production registration before arming when both journal keys are absent', async () => {
    setEnvironment('NODE_ENV', 'production');
    setEnvironment('KOVO_ATTESTATION_DEPLOYMENT_ID', undefined);
    setEnvironment('KOVO_ATTESTATION_SECRET', undefined);
    await import('./security-bootstrap.ts?runtime-journal-production-missing');

    // Authored code cannot evade the operator-pinned production posture by rewriting process.env.
    setEnvironment('NODE_ENV', 'test');
    const [registry, events] = await Promise.all([
      import('./generated-runtime-posture-registry.ts?runtime-journal-production-missing'),
      import('./security-event.js'),
    ]);

    expect(() => registry.registerGeneratedRuntimePostureManifest(manifest)).toThrow(
      /Production runtime posture registration requires KOVO_ATTESTATION_DEPLOYMENT_ID and KOVO_ATTESTATION_SECRET/u,
    );
    // A failed call must not commit registration state that lets a same-manifest retry bypass boot.
    expect(() => registry.registerGeneratedRuntimePostureManifest(manifest)).toThrow(
      /Production runtime posture registration requires KOVO_ATTESTATION_DEPLOYMENT_ID and KOVO_ATTESTATION_SECRET/u,
    );
    expect(events.securityDecisionEventRecorderArmed()).toBe(false);
  });

  it.each([
    {
      deploymentId: 'deployment:one-sided',
      label: 'deployment id only',
      secret: undefined,
    },
    {
      deploymentId: undefined,
      label: 'secret only',
      secret: 'one-sided-runtime-posture-secret-0123456789abcdef0123456789abcdef',
    },
  ])('fails closed with $label', async ({ deploymentId, secret }) => {
    setEnvironment('NODE_ENV', 'test');
    setEnvironment('KOVO_ATTESTATION_DEPLOYMENT_ID', deploymentId);
    setEnvironment('KOVO_ATTESTATION_SECRET', secret);
    await import('./security-bootstrap.ts?runtime-journal-one-sided');
    const [registry, events] = await Promise.all([
      import('./generated-runtime-posture-registry.ts?runtime-journal-one-sided'),
      import('./security-event.js'),
    ]);

    expect(() => registry.registerGeneratedRuntimePostureManifest(manifest)).toThrow(
      /requires both KOVO_ATTESTATION_DEPLOYMENT_ID and KOVO_ATTESTATION_SECRET/u,
    );
    expect(events.securityDecisionEventRecorderArmed()).toBe(false);
  });

  it('installs the journal and arms when production has both keys', async () => {
    setEnvironment('NODE_ENV', 'production');
    setEnvironment('KOVO_ATTESTATION_DEPLOYMENT_ID', 'deployment:production-journal');
    setEnvironment(
      'KOVO_ATTESTATION_SECRET',
      'production-runtime-posture-secret-0123456789abcdef0123456789abcdef',
    );
    await import('./security-bootstrap.ts?runtime-journal-production-configured');
    const [registry, events] = await Promise.all([
      import('./generated-runtime-posture-registry.ts?runtime-journal-production-configured'),
      import('./security-event.js'),
    ]);

    expect(() => registry.registerGeneratedRuntimePostureManifest(manifest)).not.toThrow();
    expect(events.securityDecisionEventRecorderArmed()).toBe(true);
    expect(
      events.securityEvent({
        decisionSite: 'framework:authorization:runtime-journal-boot-test',
        door: 'authorization',
        outcome: 'allow',
        principal: { epoch: null, id: null, kind: 'anonymous', tenant: null },
        resourceScope: { identity: 'global', kind: 'resource' },
        type: 'security-decision',
      }),
    ).toMatchObject({ sequence: 1, type: 'security-decision' });
  });

  it('leaves an ordinary test registration unarmed when neither key is configured', async () => {
    setEnvironment('NODE_ENV', 'test');
    setEnvironment('KOVO_ATTESTATION_DEPLOYMENT_ID', undefined);
    setEnvironment('KOVO_ATTESTATION_SECRET', undefined);
    await import('./security-bootstrap.ts?runtime-journal-test-unconfigured');

    // The pinned test posture remains authoritative even if app code later writes production.
    setEnvironment('NODE_ENV', 'production');
    const [registry, events] = await Promise.all([
      import('./generated-runtime-posture-registry.ts?runtime-journal-test-unconfigured'),
      import('./security-event.js'),
    ]);

    expect(() => registry.registerGeneratedRuntimePostureManifest(manifest)).not.toThrow();
    expect(events.securityDecisionEventRecorderArmed()).toBe(false);
    expect(
      events.securityEvent({
        decisionSite: 'framework:authorization:runtime-journal-boot-test',
        door: 'authorization',
        outcome: 'allow',
        principal: { epoch: null, id: null, kind: 'anonymous', tenant: null },
        resourceScope: { identity: 'global', kind: 'resource' },
        type: 'security-decision',
      }),
    ).toBeUndefined();
  });
});
