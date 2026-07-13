import { afterEach, describe, expect, it, vi } from 'vitest';

const ENVIRONMENT_KEYS = [
  'IDENTITY_ENDPOINT',
  'KOVO_DATABASE_URL',
  'KOVO_LIVE_TARGET_SECRET',
  'KOVO_VERIFY_ENDPOINT_POSTURE',
  'NODE_ENV',
  'OPERATOR_BOOT_TOKEN',
] as const;

const originalEnvironment = new Map<string, string | undefined>();
for (const key of ENVIRONMENT_KEYS) originalEnvironment.set(key, process.env[key]);

function setEnvironment(name: (typeof ENVIRONMENT_KEYS)[number], value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  for (const key of ENVIRONMENT_KEYS) setEnvironment(key, originalEnvironment.get(key));
  vi.resetModules();
});

describe('server runtime operator-environment authority (SPEC §6.6 rule 6)', () => {
  it('keeps production boot posture pinned after authored app code mutates process.env', async () => {
    vi.resetModules();
    setEnvironment('NODE_ENV', 'production');
    setEnvironment('KOVO_VERIFY_ENDPOINT_POSTURE', undefined);
    setEnvironment('KOVO_DATABASE_URL', 'postgres://app@127.0.0.1:54321/app');
    setEnvironment('IDENTITY_ENDPOINT', 'http://127.0.0.1:40342/msi/token');
    setEnvironment('KOVO_LIVE_TARGET_SECRET', 'operator-live-target-secret-0123456789abcdef');
    setEnvironment('OPERATOR_BOOT_TOKEN', 'operator-value');

    await import('./security-bootstrap.ts?operator-environment-production');

    // This is the authored app-module top-level: it shares the process, but it does not own the
    // operator's boot posture. Every security decision below must retain the pre-app values.
    setEnvironment('NODE_ENV', 'test');
    setEnvironment('KOVO_DATABASE_URL', 'postgres://attacker@127.0.0.1:54322/app');
    setEnvironment('IDENTITY_ENDPOINT', 'http://127.0.0.1:40343/msi/token');
    setEnvironment('KOVO_LIVE_TARGET_SECRET', 'attacker-live-target-secret-b-0123456789');
    setEnvironment('OPERATOR_BOOT_TOKEN', undefined);

    const [appApi, cookies, egress, env, endpointApi, mutationWire, response, schema] =
      await Promise.all([
        import('./app.ts?operator-environment-production-app'),
        import('./cookies.ts?operator-environment-production-cookies'),
        import('./egress.ts?operator-environment-production-egress'),
        import('./env.ts?operator-environment-production-env'),
        import('./endpoint.ts?operator-environment-production-endpoint'),
        import('./mutation-wire.ts?operator-environment-production-live-target'),
        import('./response.ts?operator-environment-production-response'),
        import('./schema.ts?operator-environment-production-schema'),
      ]);

    expect(env.resolveBootMode()).toBe('production');
    expect(() =>
      appApi.createApp({
        csrf: { secret: 'weak', sessionId: () => null },
        egress: { enabled: false, justification: 'isolated authority regression' },
      }),
    ).toThrow(/refused to boot/u);
    const liveTargetRenderer = {
      component: 'components/operator-env',
      render: () => '<operator-env />',
    };
    expect(() =>
      appApi.createApp({
        egress: { enabled: false, justification: 'isolated authority regression' },
        liveTargetRenderers: [liveTargetRenderer],
      }),
    ).toThrow(/Production apps with live-target renderers require createApp\(\{ appId \}\)/u);
    expect(() =>
      appApi.createApp({
        appId: 'c1f7a1bc-3ded-4205-b0e0-a6120b56d18e',
        egress: { enabled: false, justification: 'isolated authority regression' },
        liveTargetRenderers: [liveTargetRenderer],
      }),
    ).not.toThrow();
    expect(() =>
      env.validateAppEnv(
        {},
        {
          env: schema.s.object({ OPERATOR_BOOT_TOKEN: schema.s.string() }),
          mode: 'production',
        },
      ),
    ).not.toThrow();

    expect(cookies.serializeCookie('sid', 'credential')).toContain('; Secure');
    expect(response.shouldEmitDocumentHsts(true)).toBe(true);

    const mismatched = endpointApi.endpoint('/operator-env/posture', {
      csrf: false,
      csrfJustification: 'operator environment response-posture regression',
      handler: () =>
        new Response('{"ok":true}', {
          headers: { 'Cache-Control': 'public', 'Content-Type': 'text/plain' },
        }),
      method: 'POST',
      reason: 'operator environment response-posture regression',
      response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
    });
    const requestHandler = appApi.createRequestHandler(
      appApi.createApp({
        egress: { enabled: false, justification: 'isolated authority regression' },
        endpoints: [mismatched],
        onError: () => {},
      }),
    );
    expect(
      (
        await requestHandler(
          new Request('https://app.example/operator-env/posture', { method: 'POST' }),
        )
      ).status,
    ).toBe(500);

    const descriptor = {
      component: 'components/operator-env',
      props: { id: '1' },
      target: 'operator-env',
    };
    const firstAttestation = mutationWire.createLiveTargetAttestation(descriptor, {
      buildToken: 'runtime-environment-test-build',
      request: {},
    });
    setEnvironment('KOVO_LIVE_TARGET_SECRET', 'attacker-live-target-secret-c-0123456789');
    expect(
      mutationWire.createLiveTargetAttestation(descriptor, {
        buildToken: 'runtime-environment-test-build',
        request: {},
      }),
    ).toBe(firstAttestation);
    expect(
      mutationWire.createLiveTargetAttestation(descriptor, {
        buildToken: 'runtime-environment-test-build',
        csrf: {
          secret: 'explicit-rotation-secret-a-0123456789abcdef',
          sessionId: () => undefined,
        },
        request: {},
      }),
    ).not.toBe(
      mutationWire.createLiveTargetAttestation(descriptor, {
        buildToken: 'runtime-environment-test-build',
        csrf: {
          secret: 'explicit-rotation-secret-b-0123456789abcdef',
          sessionId: () => undefined,
        },
        request: {},
      }),
    );

    const policy = egress.resolveEgressPolicy(undefined, () => {});
    expect(
      egress.evaluateEgress({
        host: '127.0.0.1',
        policy,
        port: 54321,
        resolvedIp: '127.0.0.1',
      }),
    ).toBeNull();
    expect(
      egress.evaluateEgress({
        host: '127.0.0.1',
        policy,
        port: 54322,
        resolvedIp: '127.0.0.1',
      }),
    ).toMatchObject({ classification: 'loopback' });
    expect(
      egress.evaluateEgress({
        host: '127.0.0.1',
        policy,
        port: 40342,
        resolvedIp: '127.0.0.1',
      }),
    ).toMatchObject({ classification: 'metadata' });
    expect(
      egress.evaluateEgress({
        host: '127.0.0.1',
        policy,
        port: 40343,
        resolvedIp: '127.0.0.1',
      }),
    ).toMatchObject({ classification: 'loopback' });

    const explicitRotationPolicy = egress.resolveEgressPolicy(undefined, () => {}, {
      databaseUrls: ['postgres://rotated@127.0.0.1:54322/app'],
      identityEndpoint: 'http://127.0.0.1:40343/msi/token',
    });
    expect(
      egress.evaluateEgress({
        host: '127.0.0.1',
        policy: explicitRotationPolicy,
        port: 54322,
        resolvedIp: '127.0.0.1',
      }),
    ).toBeNull();
    expect(
      egress.evaluateEgress({
        host: '127.0.0.1',
        policy: explicitRotationPolicy,
        port: 40343,
        resolvedIp: '127.0.0.1',
      }),
    ).toMatchObject({ classification: 'metadata' });
  });

  it('does not let app code add a missing production live-target secret after bootstrap', async () => {
    vi.resetModules();
    setEnvironment('NODE_ENV', 'production');
    setEnvironment('KOVO_LIVE_TARGET_SECRET', undefined);
    await import('./security-bootstrap.ts?operator-environment-missing-live-target');

    setEnvironment('NODE_ENV', 'development');
    setEnvironment('KOVO_LIVE_TARGET_SECRET', 'late-app-secret-0123456789abcdef012345');
    const mutationWire =
      await import('./mutation-wire.ts?operator-environment-missing-live-target');

    expect(() =>
      mutationWire.createLiveTargetAttestation(
        { component: 'components/missing-secret', props: {}, target: 'missing-secret' },
        { buildToken: 'runtime-environment-test-build', request: {} },
      ),
    ).toThrow(/KOVO_LIVE_TARGET_SECRET is required/u);
  });

  it('keeps development posture pinned while explicit security signals still strengthen it', async () => {
    vi.resetModules();
    setEnvironment('NODE_ENV', 'development');
    await import('./security-bootstrap.ts?operator-environment-development');

    setEnvironment('NODE_ENV', 'production');
    const [cookies, env, response] = await Promise.all([
      import('./cookies.ts?operator-environment-development-cookies'),
      import('./env.ts?operator-environment-development-env'),
      import('./response.ts?operator-environment-development-response'),
    ]);

    expect(env.resolveBootMode()).toBe('development');
    expect(env.resolveBootMode('production')).toBe('production');
    expect(cookies.serializeCookie('sid', 'credential')).not.toContain('; Secure');
    expect(cookies.serializeCookie('sid', 'credential', { secure: true })).toContain('; Secure');
    expect(response.shouldEmitDocumentHsts(true)).toBe(false);
  });
});
