import { publicScopedKey } from '@kovojs/core';
import { DeclassifyPolicy, secret } from '@kovojs/core/security';
import {
  createMemoryStorage,
  installCoreSecurityDecisionBridge,
  principalScopedKey,
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
  it('records storage decisions with unrecordable principals redacted at the event door', async () => {
    const storage = createMemoryStorage();
    const unrecordablePrincipal = 'storage-principal\u0000must-not-leak';
    const validPrincipal = 'storage-principal-valid';
    const before = securityEventSnapshot().length;

    await storage.put(principalScopedKey(unrecordablePrincipal, 'object-redacted'), 'value');
    await storage.put(principalScopedKey(validPrincipal, 'object-recordable'), 'value');

    const records = securityEventSnapshot()
      .slice(before)
      .filter(
        (record) =>
          record.type === 'security-decision' &&
          record.decisionSite === 'framework:storage:scoped-key-admission',
      );
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      principal: {
        epoch: null,
        id: null,
        kind: 'unresolved',
        reason: 'principal-unrecordable',
        tenant: null,
      },
    });
    expect(records[1]).toMatchObject({
      principal: {
        epoch: null,
        id: validPrincipal,
        kind: 'unresolved',
        reason: 'epoch-unavailable',
        tenant: null,
      },
    });
    expect(JSON.stringify(records)).not.toContain(unrecordablePrincipal);
  });

  it('records task decisions with unrecordable principals redacted at the event door', async () => {
    const queue = new MemoryDurableTaskQueue();
    const unrecordablePrincipal = 'task-principal\u001fmust-not-leak';
    const validPrincipal = 'task-principal-valid';
    const before = securityEventSnapshot().length;

    await queue.enqueue({
      args: {},
      key: principalScopedKey(unrecordablePrincipal, 'task-redacted'),
      task: 'email.redacted',
    });
    await queue.enqueue({
      args: {},
      key: principalScopedKey(validPrincipal, 'task-recordable'),
      task: 'email.recordable',
    });

    const records = securityEventSnapshot()
      .slice(before)
      .filter(
        (record) =>
          record.type === 'security-decision' &&
          record.decisionSite === 'framework:task:enqueue-scope-admission',
      );
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      principal: {
        epoch: null,
        id: null,
        kind: 'unresolved',
        reason: 'principal-unrecordable',
        tenant: null,
      },
    });
    expect(records[1]).toMatchObject({
      principal: {
        epoch: null,
        id: validPrincipal,
        kind: 'unresolved',
        reason: 'epoch-unavailable',
        tenant: null,
      },
    });
    expect(JSON.stringify(records)).not.toContain(unrecordablePrincipal);
  });

  it('records allow and deny at every enrolled choke without payloads', async () => {
    await resolveLifecycleRequest(new Request('https://app.example/'), {
      sessionProvider: () => null,
    });
    await resolveLifecycleRequest(new Request('https://app.example/'), {
      sessionProvider: () => ({ user: { id: 'principal-a' } }),
    });

    await runAccessDecisionGuards(publicAccess('emission coverage test'), undefined, {});
    await runAccessDecisionGuards([() => false], undefined, {});

    const declassifyPolicy = DeclassifyPolicy.forSecretValue({
      ownerScope: 'framework',
      purpose: 'server-computation',
    });
    expect(secret('server-owned').reveal(declassifyPolicy)).toBe('server-owned');
    expect(() =>
      secret('server-owned').reveal(
        DeclassifyPolicy.forTrustedReveal({
          ownerScope: 'framework',
        }) as never,
      ),
    ).toThrow(/exact door/u);

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
    for (const door of [
      'auth',
      'authorization',
      'declassification',
      'egress',
      'storage',
      'task',
      'replay',
    ] as const) {
      const outcomes = records
        .filter((record) => record.type === 'security-decision' && record.door === door)
        .map((record) => record.outcome);
      expect(outcomes, door).toContain('allow');
      expect(outcomes, door).toContain('deny');
    }
    expect(records.every((record) => !('payload' in record))).toBe(true);
  });
});
