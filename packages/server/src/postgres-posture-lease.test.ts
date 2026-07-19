import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPostgresPostureDigest,
  createPostgresPostureLease,
  POSTGRES_POSTURE_LEASE_RENEW_INTERVAL_MS,
  POSTGRES_POSTURE_LEASE_TTL_MS,
  type PostgresPostureLeaseWitness,
} from './postgres-posture-lease.js';

const BASE_WITNESS: PostgresPostureLeaseWitness = {
  facts: [
    { key: 'public.notes', kind: 'policy', value: 'force-rls:kovo_owner_scope' },
    { key: 'app->kovo_reader', kind: 'membership', value: 'true' },
  ],
  freshness: {
    migrationHead: '001-initial:sha256:aaa',
    postureEpoch: '7',
  },
  pooler: {
    first: {
      backendPid: '41',
      currentDatabase: 'app',
      currentUser: 'app_login',
      probeValue: 'lease-probe',
      sessionUser: 'app_login',
    },
    second: {
      backendPid: '41',
      currentDatabase: 'app',
      currentUser: 'app_login',
      probeValue: 'lease-probe',
      sessionUser: 'app_login',
    },
  },
};

function cloneWitness(
  overrides: Partial<PostgresPostureLeaseWitness> = {},
): PostgresPostureLeaseWitness {
  return {
    facts: BASE_WITNESS.facts.map((fact) => ({ ...fact })),
    freshness: { ...BASE_WITNESS.freshness },
    pooler: {
      first: { ...BASE_WITNESS.pooler.first },
      second: { ...BASE_WITNESS.pooler.second },
    },
    ...overrides,
  };
}

async function settleTimers(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
  await Promise.resolve();
}

describe('Postgres posture digest', () => {
  it('is stable across fact order and physical backend changes', () => {
    const reordered = cloneWitness({ facts: [...BASE_WITNESS.facts].reverse() });
    reordered.pooler.first.backendPid = '99';
    reordered.pooler.second.backendPid = '99';

    expect(createPostgresPostureDigest(reordered)).toBe(createPostgresPostureDigest(BASE_WITNESS));
  });

  it('changes on one added grant or a monotone-freshness rollback', () => {
    const addedGrant = cloneWitness({
      facts: [
        ...BASE_WITNESS.facts,
        { key: 'pg_read_all_data->app_login', kind: 'membership', value: 'true' },
      ],
    });
    const restoredBackup = cloneWitness({
      freshness: { ...BASE_WITNESS.freshness, postureEpoch: '6' },
    });

    expect(createPostgresPostureDigest(addedGrant)).not.toBe(
      createPostgresPostureDigest(BASE_WITNESS),
    );
    expect(createPostgresPostureDigest(restoredBackup)).not.toBe(
      createPostgresPostureDigest(BASE_WITNESS),
    );
  });

  it('rejects a pooler that moves either statement to a different backend or loses the frame', () => {
    const moved = cloneWitness();
    moved.pooler.second.backendPid = '42';
    expect(() => createPostgresPostureDigest(moved)).toThrow(/KV433.*pooler.*backend/isu);

    const lostFrame = cloneWitness();
    lostFrame.pooler.second.probeValue = '';
    expect(() => createPostgresPostureDigest(lostFrame)).toThrow(/KV433.*pooler.*frame/isu);
  });
});

describe('Postgres posture lease', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renews on a fixed interval and keeps a finite zero-grace TTL', async () => {
    const witness = vi.fn(async () => cloneWitness());
    const lease = createPostgresPostureLease({ jitterRatio: 0, witness });

    await lease.start();
    expect(lease.snapshot()).toMatchObject({
      status: 'fresh',
      ttlMs: POSTGRES_POSTURE_LEASE_TTL_MS,
    });
    expect(witness).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POSTGRES_POSTURE_LEASE_RENEW_INTERVAL_MS);
    expect(witness).toHaveBeenCalledTimes(2);
    await expect(lease.admit()).resolves.toBeUndefined();

    lease.close();
  });

  it('sheds at expiry when renewal fails, drains once, then recovers after an authoritative match', async () => {
    const networkFailure = new Error('catalog unavailable');
    const witnesses: Array<PostgresPostureLeaseWitness | Error> = [
      cloneWitness(),
      networkFailure,
      networkFailure,
      cloneWitness(),
    ];
    const witness = vi.fn(async () => {
      const next = witnesses.shift();
      if (next instanceof Error) throw next;
      return next ?? cloneWitness();
    });
    const drain = vi.fn(async () => undefined);
    const lease = createPostgresPostureLease({ drain, jitterRatio: 0, witness });
    await lease.start();

    await vi.advanceTimersByTimeAsync(POSTGRES_POSTURE_LEASE_RENEW_INTERVAL_MS);
    expect(lease.snapshot()).toMatchObject({ status: 'shed' });
    expect(drain).toHaveBeenCalledTimes(1);
    await expect(lease.admit()).rejects.toThrow(/KV433.*posture lease/isu);

    await vi.advanceTimersByTimeAsync(1_000);
    await settleTimers();
    expect(drain).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    await settleTimers();
    expect(lease.snapshot()).toMatchObject({ status: 'fresh' });
    await expect(lease.admit()).resolves.toBeUndefined();

    lease.close();
  });

  it('coalesces a burst of 42501 errors without creating an attacker-triggerable renewal loop', async () => {
    let releaseRenewal!: (value: PostgresPostureLeaseWitness) => void;
    const pendingRenewal = new Promise<PostgresPostureLeaseWitness>((resolve) => {
      releaseRenewal = resolve;
    });
    const witness = vi
      .fn<() => Promise<PostgresPostureLeaseWitness>>()
      .mockResolvedValueOnce(cloneWitness())
      .mockReturnValueOnce(pendingRenewal);
    const lease = createPostgresPostureLease({ jitterRatio: 0, witness });
    await lease.start();

    for (let index = 0; index < 100; index += 1) {
      lease.noteSqlError({ code: '42501' });
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(witness).toHaveBeenCalledTimes(2);

    for (let index = 0; index < 100; index += 1) {
      lease.noteSqlError({ code: '42501' });
    }
    expect(witness).toHaveBeenCalledTimes(2);

    releaseRenewal(cloneWitness());
    await Promise.resolve();
    await Promise.resolve();
    expect(lease.snapshot()).toMatchObject({ status: 'fresh' });

    lease.close();
  });

  it('drains and stays shed on a one-fact digest divergence until the baseline returns', async () => {
    const drifted = cloneWitness({
      facts: [
        ...BASE_WITNESS.facts,
        { key: 'pg_read_all_data->app_login', kind: 'membership', value: 'true' },
      ],
    });
    const witness = vi
      .fn<() => Promise<PostgresPostureLeaseWitness>>()
      .mockResolvedValueOnce(cloneWitness())
      .mockResolvedValueOnce(drifted)
      .mockResolvedValueOnce(cloneWitness());
    const drain = vi.fn(async () => undefined);
    const lease = createPostgresPostureLease({ drain, jitterRatio: 0, witness });
    await lease.start();

    lease.noteSqlError({ code: '42501' });
    await vi.advanceTimersByTimeAsync(0);
    expect(lease.snapshot()).toMatchObject({ reason: 'digest-diverged', status: 'shed' });
    await expect(lease.admit()).rejects.toThrow(/KV433.*digest diverged/isu);
    expect(drain).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    await settleTimers();
    expect(lease.snapshot()).toMatchObject({ status: 'fresh' });

    lease.close();
  });
});
