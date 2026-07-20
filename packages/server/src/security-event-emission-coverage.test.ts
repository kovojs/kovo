import { publicScopedKey } from '@kovojs/core';
import {
  createMemoryStorage,
  installCoreSecurityDecisionBridge,
} from '@kovojs/core/internal/storage';
import { describe, expect, it } from 'vitest';

import { publicAccess } from './access.js';
import { createSecurityEventCryptoHandle } from './crypto-authority.js';
import { evaluateEgress, resolveEgressPolicy } from './egress.js';
import { resolveLifecycleRequest, runAccessDecisionGuards } from './guards.js';
import { reserveReplayBeforeRun } from './replay.js';
import {
  armSecurityDecisionEventRecorder,
  createSecurityEventJournal,
  installSecurityEventJournal,
  securityEvent,
  securityEventSnapshot,
} from './security-event.js';
import { MemoryDurableTaskQueue } from './task-queue.js';

const authority = createSecurityEventCryptoHandle(
  'security-event-emission-coverage-test-secret-0123456789abcdef0123456789abcdef',
  'deployment:emission-coverage-test',
);
installSecurityEventJournal(
  createSecurityEventJournal({ authority, now: () => 1_720_000_000_000 }),
);
installCoreSecurityDecisionBridge((event) => {
  securityEvent(event);
});
armSecurityDecisionEventRecorder();

describe('security-decision production emission coverage (SPEC §11.2)', () => {
  it('records allow and deny at every enrolled non-declassification choke without payloads', async () => {
    await resolveLifecycleRequest(new Request('https://app.example/'), {
      sessionProvider: () => null,
    });
    await resolveLifecycleRequest(new Request('https://app.example/'), {
      sessionProvider: () => ({ user: { id: 'principal-a' } }),
    });

    await runAccessDecisionGuards(publicAccess('emission coverage test'), undefined, {});
    await runAccessDecisionGuards([() => false], undefined, {});

    const egressPolicy = resolveEgressPolicy(undefined, () => {}, { databaseUrls: [] });
    expect(
      evaluateEgress({
        host: 'api.example.test',
        port: 443,
        protocol: 'https:',
        resolvedIp: '8.8.8.8',
        policy: egressPolicy,
      }),
    ).toBeNull();
    expect(
      evaluateEgress({
        host: 'internal.example.test',
        port: 80,
        protocol: 'http:',
        resolvedIp: '127.0.0.1',
        policy: egressPolicy,
      }),
    ).not.toBeNull();

    const storage = createMemoryStorage();
    await storage.put(publicScopedKey('object-a'), 'value');
    await expect(storage.get('bare-key' as never)).rejects.toThrow(/ScopedKey/u);

    const queue = new MemoryDurableTaskQueue();
    await queue.enqueue({ args: {}, task: 'email.send' });
    await expect(
      queue.enqueue({ args: {}, key: 'bare-key' as never, task: 'email.send' }),
    ).rejects.toThrow(/ScopedKey/u);

    await reserveReplayBeforeRun({ idem: undefined, scope: null, store: undefined });
    await expect(
      reserveReplayBeforeRun({
        idem: 'idem-a',
        scope: 'scope-a',
        store: { get: () => undefined, reserve: () => undefined },
      }),
    ).resolves.toEqual({ kind: 'unavailable' });

    const records = securityEventSnapshot().filter((record) => record.type === 'security-decision');
    for (const door of ['auth', 'authorization', 'egress', 'storage', 'task', 'replay'] as const) {
      const outcomes = records
        .filter((record) => record.type === 'security-decision' && record.door === door)
        .map((record) => record.outcome);
      expect(outcomes, door).toContain('allow');
      expect(outcomes, door).toContain('deny');
    }
    expect(records.every((record) => !('payload' in record))).toBe(true);
  });
});
