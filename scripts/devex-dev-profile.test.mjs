import { describe, expect, it } from 'vitest';

import {
  formatDevProfileMarker,
  runDevProfile,
  waitForDevEvidence,
} from './devex-workloads/kovo-packed-check/package/dev-profile.mjs';
import {
  SOURCE_DIAGNOSTIC_VARIANT,
  SOURCE_VARIANTS,
} from './devex-workloads/kovo-packed-check/package/workload.mjs';

describe('packed Kovo dev latency profile', () => {
  it('measures readiness and both edit transitions against exact served evidence', async () => {
    let source = SOURCE_VARIANTS[0];
    let clockValue = 0;
    let starts = 0;
    let stops = 0;
    const servers = [];

    const evidence = await runDevProfile({
      clock() {
        const current = clockValue;
        clockValue += 1;
        return current;
      },
      delay: async () => {
        clockValue += 5;
      },
      readSource: () => source,
      request: async () => {
        if (source === SOURCE_DIAGNOSTIC_VARIANT) {
          return {
            body: '<main>KV235 src/components/counter-island.tsx</main>',
            status: 500,
          };
        }
        const revision = source === SOURCE_VARIANTS[0] ? 'zero' : 'one';
        return {
          body: `<main>Kovo packed reference app <button data-revision="${revision}"></button></main>`,
          status: 200,
        };
      },
      startServer: async () => {
        starts += 1;
        const server = {
          assertRunning() {},
          origin: `http://127.0.0.1:${4100 + starts}`,
          async stop() {
            stops += 1;
          },
          transcript() {
            return { stderr: '', stdout: '' };
          },
        };
        servers.push(server);
        return server;
      },
      writeSource(next) {
        source = next;
      },
    });

    expect(starts).toBe(2);
    expect(stops).toBe(2);
    expect(servers).toHaveLength(2);
    expect(evidence).toMatchObject({
      cold: { durationMs: expect.any(Number) },
      diagnostic: { code: 'KV235', durationMs: expect.any(Number) },
      served: { durationMs: expect.any(Number), revision: 1 },
      warm: { durationMs: expect.any(Number) },
    });
    expect(evidence.cold.durationMs).toBeGreaterThan(0);
    expect(evidence.warm.durationMs).toBeGreaterThan(0);
    expect(evidence.diagnostic.durationMs).toBeGreaterThan(0);
    expect(evidence.served.durationMs).toBeGreaterThan(0);
    expect(evidence.diagnostic.sourceDigest).not.toBe(evidence.served.sourceDigest);
    expect(source).toBe(SOURCE_VARIANTS[1]);
    expect(formatDevProfileMarker(evidence)).toMatch(/^kovo-dev-profile\/v1 \{.*\}\n$/u);
  });

  it('polls boundedly and returns only accepted response evidence', async () => {
    let now = 0;
    let requests = 0;
    const result = await waitForDevEvidence({
      accept(response) {
        return response.status === 200 ? { body: response.body } : null;
      },
      clock: () => now,
      delay: async () => {
        now += 5;
      },
      label: 'fixture transition',
      request: async () => {
        requests += 1;
        return requests === 3 ? { body: 'served', status: 200 } : { body: 'stale', status: 503 };
      },
      server: {
        assertRunning() {},
        origin: 'http://127.0.0.1:4173',
        transcript: () => ({ stderr: '', stdout: '' }),
      },
      timeoutMs: 20,
    });

    expect(requests).toBe(3);
    expect(result).toEqual({ durationMs: 10, evidence: { body: 'served' } });
  });

  it('does not mutate past HTTP readiness before the complete CLI ready report', async () => {
    let now = 0;
    let ready = false;
    let requests = 0;
    const result = await waitForDevEvidence({
      accept: (response) => ({ body: response.body }),
      clock: () => now,
      delay: async () => {
        now += 5;
        ready = true;
      },
      label: 'authenticated readiness fixture',
      request: async () => {
        requests += 1;
        return { body: 'HTTP graph already observable', status: 200 };
      },
      server: {
        assertRunning() {},
        isReady: () => ready,
        origin: 'http://127.0.0.1:4173',
        transcript: () => ({ stderr: '', stdout: '' }),
      },
      timeoutMs: 20,
    });

    expect(requests).toBe(2);
    expect(result).toEqual({
      durationMs: 5,
      evidence: { body: 'HTTP graph already observable' },
    });
  });

  it('stops a spawned server when transition evidence never appears', async () => {
    let source = SOURCE_VARIANTS[0];
    let now = 0;
    let stops = 0;

    await expect(
      runDevProfile({
        clock: () => {
          now += 60_001;
          return now;
        },
        delay: async () => {},
        readSource: () => source,
        request: async () => ({ body: 'not ready', status: 503 }),
        startServer: async () => ({
          assertRunning() {},
          origin: 'http://127.0.0.1:4173',
          async stop() {
            stops += 1;
          },
          transcript: () => ({ stderr: 'fixture stderr', stdout: 'fixture stdout' }),
        }),
        writeSource(next) {
          source = next;
        },
      }),
    ).rejects.toThrow('cold dev readiness timed out');
    expect(stops).toBe(1);
  });

  it('refuses unreviewed starting source before launching a server', async () => {
    let started = false;
    await expect(
      runDevProfile({
        readSource: () => 'export const forged = true;',
        startServer: async () => {
          started = true;
          throw new Error('must not launch');
        },
      }),
    ).rejects.toThrow('reviewed starting revision');
    expect(started).toBe(false);
  });
});
