import { createHash, randomBytes } from 'node:crypto';

/** Maximum time a lease witness may occupy its framework-owned renewal slot. */
export const POSTGRES_POSTURE_LEASE_WITNESS_TIMEOUT_MS = 10_000;
/** Fixed base renewal cadence before one process-stable +/-10% jitter is applied. */
export const POSTGRES_POSTURE_LEASE_RENEW_INTERVAL_MS = 30_000;
/** Hard freshness ceiling. There is no serve-degraded grace after this deadline. */
export const POSTGRES_POSTURE_LEASE_TTL_MS = 120_000;
/** Bounded catalog-fact denominator for one interval witness. */
export const POSTGRES_POSTURE_LEASE_MAX_FACTS = 2_048;
/** Bounded canonical catalog evidence accepted by one interval witness. */
export const POSTGRES_POSTURE_LEASE_MAX_CANONICAL_BYTES = 256 * 1_024;

const POSTGRES_POSTURE_LEASE_INITIAL_BACKOFF_MS = 1_000;
const POSTGRES_POSTURE_LEASE_MAX_BACKOFF_MS = 30_000;
const POSTGRES_POSTURE_LEASE_MAX_FACT_FIELD_BYTES = 4_096;
const POSTGRES_POSTURE_LEASE_DEFAULT_JITTER_RATIO = 0.1;

export interface PostgresPostureFact {
  key: string;
  kind: string;
  value: string;
}

export interface PostgresPosturePoolerStatementWitness {
  backendPid: string;
  currentDatabase: string;
  currentUser: string;
  probeValue: string;
  sessionUser: string;
}

export interface PostgresPostureLeaseWitness {
  facts: readonly PostgresPostureFact[];
  freshness: {
    migrationHead: string;
    postureEpoch: string;
  };
  pooler: {
    first: PostgresPosturePoolerStatementWitness;
    second: PostgresPosturePoolerStatementWitness;
  };
}

export type PostgresPostureLeaseFailureReason =
  | 'digest-diverged'
  | 'lease-expired'
  | 'renewal-failed';

export interface PostgresPostureLeaseSnapshot {
  baselineDigest?: string;
  currentDigest?: string;
  expiresAt?: number;
  failureCount: number;
  lastRenewedAt?: number;
  nextAttemptAt?: number;
  reason?: PostgresPostureLeaseFailureReason;
  renewIntervalMs: number;
  status: 'closed' | 'fresh' | 'renewing' | 'shed' | 'starting';
  ttlMs: number;
}

interface PostgresPostureLeaseTimer {
  clear(handle: ReturnType<typeof setTimeout>): void;
  now(): number;
  schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
}

export interface PostgresPostureLeaseOptions {
  /** Destroy/retire pooled sessions once per fresh -> shed transition. */
  drain?: () => Promise<void> | void;
  /** Internal deterministic-test seam. Production callers leave this unset. */
  jitterRatio?: number;
  /** Internal response-shell adapter. */
  mintAdmissionError?: (message: string, retryAfterMs: number) => Error;
  /** Internal deterministic-test seam. Production callers leave this unset. */
  timer?: PostgresPostureLeaseTimer;
  /** Re-derive the bounded authoritative catalog + pooler witness. */
  witness: () => Promise<PostgresPostureLeaseWitness>;
  /** Internal deterministic-test seam. Production callers leave this unset. */
  witnessTimeoutMs?: number;
}

export interface PostgresPostureLease {
  /** Fail closed before handing a request any DB capability. */
  admit(): Promise<void>;
  close(): void;
  /** A 42501 signal requests one coalesced authoritative renewal; it never loops per error. */
  noteSqlError(error: unknown): void;
  snapshot(): Readonly<PostgresPostureLeaseSnapshot>;
  /** Establish the immutable baseline before app readiness resolves. */
  start(): Promise<void>;
}

/**
 * Canonical bounded digest for the interval posture witness (SPEC §10.3).
 *
 * Physical backend ids and the random frame token prove same-transaction pooler behavior but are
 * deliberately excluded from the stable digest. The authenticated database/session identity,
 * catalog facts, migration head, and monotone posture epoch remain bound.
 */
export function createPostgresPostureDigest(witness: PostgresPostureLeaseWitness): string {
  assertPoolerWitness(witness.pooler);
  const facts = normalizePostureFacts(witness.facts);
  const first = witness.pooler.first;
  const canonical = JSON.stringify({
    facts,
    freshness: {
      migrationHead: boundedWitnessString(witness.freshness.migrationHead, 'migration-ledger head'),
      postureEpoch: boundedWitnessString(witness.freshness.postureEpoch, 'posture epoch'),
    },
    runtimeIdentity: {
      currentDatabase: boundedWitnessString(first.currentDatabase, 'current database'),
      currentUser: boundedWitnessString(first.currentUser, 'current user'),
      sessionUser: boundedWitnessString(first.sessionUser, 'session user'),
    },
    schema: 'kovo-postgres-posture-digest/v1',
  });
  if (Buffer.byteLength(canonical, 'utf8') > POSTGRES_POSTURE_LEASE_MAX_CANONICAL_BYTES) {
    throw new Error(
      `KV433: Postgres posture lease evidence exceeds ${POSTGRES_POSTURE_LEASE_MAX_CANONICAL_BYTES} canonical bytes (SPEC §10.3).`,
    );
  }
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

export function createPostgresPostureLease(
  options: PostgresPostureLeaseOptions,
): PostgresPostureLease {
  const timer = options.timer ?? nativePostureLeaseTimer();
  const jitterRatio = normalizeJitterRatio(options.jitterRatio);
  const renewIntervalMs = jitteredRenewInterval(jitterRatio);
  const witnessTimeoutMs = normalizeWitnessTimeout(options.witnessTimeoutMs);
  const mintAdmissionError =
    options.mintAdmissionError ??
    ((message: string): Error => {
      return new Error(message);
    });

  let baselineDigest: string | undefined;
  let currentDigest: string | undefined;
  let expiresAt: number | undefined;
  let failureCount = 0;
  let inFlight: Promise<void> | undefined;
  let lastRenewedAt: number | undefined;
  let nextAttemptAt: number | undefined;
  let reason: PostgresPostureLeaseFailureReason | undefined;
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  let started = false;
  let status: PostgresPostureLeaseSnapshot['status'] = 'starting';
  let drainPromise: Promise<void> | undefined;
  let drainedForOutage = false;

  const clearScheduled = (): void => {
    if (scheduled === undefined) return;
    timer.clear(scheduled);
    scheduled = undefined;
  };

  const scheduleAt = (at: number): void => {
    if (status === 'closed') return;
    clearScheduled();
    const delay = Math.max(0, at - timer.now());
    scheduled = timer.schedule(() => {
      scheduled = undefined;
      void renew('scheduled').catch(() => {
        // The state transition already recorded the fail-closed outcome and retry schedule.
      });
    }, delay);
    scheduled.unref?.();
  };

  const scheduleFreshRenewal = (now: number): void => {
    nextAttemptAt = now + renewIntervalMs;
    scheduleAt(nextAttemptAt);
  };

  const scheduleRetry = (now: number): void => {
    const exponent = Math.max(0, failureCount - 1);
    const backoffMs = Math.min(
      POSTGRES_POSTURE_LEASE_MAX_BACKOFF_MS,
      POSTGRES_POSTURE_LEASE_INITIAL_BACKOFF_MS * 2 ** exponent,
    );
    nextAttemptAt = now + backoffMs;
    scheduleAt(nextAttemptAt);
  };

  const transitionShed = async (
    failureReason: PostgresPostureLeaseFailureReason,
  ): Promise<void> => {
    status = 'shed';
    reason = failureReason;
    if (!drainedForOutage) {
      drainedForOutage = true;
      drainPromise = Promise.resolve(options.drain?.());
    }
    await drainPromise;
  };

  const markFresh = async (digest: string, now: number): Promise<void> => {
    await drainPromise;
    currentDigest = digest;
    expiresAt = now + POSTGRES_POSTURE_LEASE_TTL_MS;
    failureCount = 0;
    lastRenewedAt = now;
    reason = undefined;
    status = 'fresh';
    drainPromise = undefined;
    drainedForOutage = false;
    scheduleFreshRenewal(now);
  };

  const authoritativeWitness = async (): Promise<string> => {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = timer.schedule(() => {
        reject(
          new Error(
            `KV433: Postgres posture lease witness exceeded ${witnessTimeoutMs}ms (SPEC §10.3).`,
          ),
        );
      }, witnessTimeoutMs);
      timeoutHandle.unref?.();
    });
    try {
      const witness = await Promise.race([options.witness(), timeout]);
      return createPostgresPostureDigest(witness);
    } finally {
      if (timeoutHandle !== undefined) timer.clear(timeoutHandle);
    }
  };

  const isFresh = (): boolean => status === 'fresh';
  const isShed = (): boolean => status === 'shed';

  const renew = (trigger: 'admission' | 'permission' | 'scheduled' | 'start'): Promise<void> => {
    if (status === 'closed') return Promise.resolve();
    if (inFlight !== undefined) return inFlight;
    if (
      trigger !== 'start' &&
      status === 'shed' &&
      nextAttemptAt !== undefined &&
      timer.now() < nextAttemptAt
    ) {
      return Promise.reject(admissionError());
    }

    status = trigger === 'start' ? 'starting' : 'renewing';
    clearScheduled();
    const renewal = (async (): Promise<void> => {
      try {
        const digest = await authoritativeWitness();
        const now = timer.now();
        if (baselineDigest === undefined) {
          baselineDigest = digest;
        } else if (digest !== baselineDigest) {
          currentDigest = digest;
          failureCount += 1;
          await transitionShed('digest-diverged');
          scheduleRetry(now);
          throw admissionError();
        }
        await markFresh(digest, now);
      } catch (error) {
        if (!isShed()) {
          failureCount += 1;
          const now = timer.now();
          const failureReason: PostgresPostureLeaseFailureReason =
            expiresAt !== undefined && now >= expiresAt ? 'lease-expired' : 'renewal-failed';
          await transitionShed(failureReason);
          scheduleRetry(now);
        }
        throw error;
      } finally {
        inFlight = undefined;
      }
    })();
    inFlight = renewal;
    return renewal;
  };

  const admissionError = (): Error => {
    const retryAfterMs = Math.max(1_000, (nextAttemptAt ?? timer.now() + 1_000) - timer.now());
    const detail =
      reason === 'digest-diverged'
        ? 'digest diverged from the boot-authorized baseline'
        : reason === 'lease-expired'
          ? 'lease expired with zero grace'
          : 'authoritative renewal failed';
    return mintAdmissionError(
      `KV433: Postgres posture lease is fail-closed: ${detail} (SPEC §10.3).`,
      retryAfterMs,
    );
  };

  const start = async (): Promise<void> => {
    if (status === 'closed') throw admissionError();
    if (started) {
      if (inFlight !== undefined) await inFlight;
      if (status !== 'fresh') throw admissionError();
      return;
    }
    started = true;
    await renew('start');
  };

  return {
    async admit(): Promise<void> {
      if (!started) await start();
      if (status === 'closed') throw admissionError();
      const now = timer.now();
      if (status === 'fresh' && expiresAt !== undefined && now < expiresAt) {
        if (nextAttemptAt !== undefined && now >= nextAttemptAt) {
          await renew('admission');
        }
        if (isFresh()) return;
      }
      if (inFlight !== undefined) {
        try {
          await inFlight;
        } catch {
          throw admissionError();
        }
        if (isFresh()) return;
      }
      if (status === 'shed' && nextAttemptAt !== undefined && now >= nextAttemptAt) {
        try {
          await renew('admission');
        } catch {
          throw admissionError();
        }
        if (isFresh()) return;
      }
      if (status === 'fresh' && expiresAt !== undefined && now >= expiresAt) {
        await transitionShed('lease-expired');
      }
      throw admissionError();
    },
    close(): void {
      clearScheduled();
      status = 'closed';
    },
    noteSqlError(error: unknown): void {
      if (!isPostgresInsufficientPrivilegeError(error) || status === 'closed') return;
      if (status === 'fresh') {
        nextAttemptAt = timer.now();
        scheduleAt(nextAttemptAt);
      } else if (status === 'renewing' || inFlight !== undefined) {
        return;
      } else if (status === 'shed' && nextAttemptAt !== undefined) {
        scheduleAt(nextAttemptAt);
      }
    },
    snapshot(): Readonly<PostgresPostureLeaseSnapshot> {
      return Object.freeze({
        ...(baselineDigest === undefined ? {} : { baselineDigest }),
        ...(currentDigest === undefined ? {} : { currentDigest }),
        ...(expiresAt === undefined ? {} : { expiresAt }),
        failureCount,
        ...(lastRenewedAt === undefined ? {} : { lastRenewedAt }),
        ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
        ...(reason === undefined ? {} : { reason }),
        renewIntervalMs,
        status,
        ttlMs: POSTGRES_POSTURE_LEASE_TTL_MS,
      });
    },
    start,
  };
}

function assertPoolerWitness(witness: PostgresPostureLeaseWitness['pooler']): void {
  const first = witness.first;
  const second = witness.second;
  const firstBackend = boundedWitnessString(first.backendPid, 'first pooler backend id');
  const secondBackend = boundedWitnessString(second.backendPid, 'second pooler backend id');
  if (firstBackend !== secondBackend) {
    throw new Error(
      'KV433: Postgres pooler witness moved two transaction statements between backend sessions (SPEC §10.3).',
    );
  }
  const firstProbe = boundedWitnessString(first.probeValue, 'first pooler frame');
  const secondProbe = boundedWitnessString(second.probeValue, 'second pooler frame');
  if (firstProbe === '' || firstProbe !== secondProbe) {
    throw new Error(
      'KV433: Postgres pooler witness lost its transaction-local frame between statements (SPEC §10.3).',
    );
  }
  for (const field of ['currentDatabase', 'currentUser', 'sessionUser'] as const) {
    const left = boundedWitnessString(first[field], `first pooler ${field}`);
    const right = boundedWitnessString(second[field], `second pooler ${field}`);
    if (left !== right) {
      throw new Error(
        `KV433: Postgres pooler witness changed ${field} inside one transaction (SPEC §10.3).`,
      );
    }
  }
}

function normalizePostureFacts(facts: readonly PostgresPostureFact[]): PostgresPostureFact[] {
  if (!Array.isArray(facts)) {
    throw new TypeError('KV433: Postgres posture lease facts must be an array (SPEC §10.3).');
  }
  if (facts.length > POSTGRES_POSTURE_LEASE_MAX_FACTS) {
    throw new Error(
      `KV433: Postgres posture lease returned ${facts.length} facts; the interval budget is ${POSTGRES_POSTURE_LEASE_MAX_FACTS} (SPEC §10.3).`,
    );
  }
  const normalized = facts.map((fact, index) => ({
    key: boundedWitnessString(fact.key, `fact[${index}].key`),
    kind: boundedWitnessString(fact.kind, `fact[${index}].kind`),
    value: boundedWitnessString(fact.value, `fact[${index}].value`),
  }));
  normalized.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
    if (left.key !== right.key) return left.key < right.key ? -1 : 1;
    if (left.value !== right.value) return left.value < right.value ? -1 : 1;
    return 0;
  });
  return normalized;
}

function boundedWitnessString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`KV433: Postgres posture lease ${label} must be a string (SPEC §10.3).`);
  }
  if (Buffer.byteLength(value, 'utf8') > POSTGRES_POSTURE_LEASE_MAX_FACT_FIELD_BYTES) {
    throw new Error(
      `KV433: Postgres posture lease ${label} exceeds ${POSTGRES_POSTURE_LEASE_MAX_FACT_FIELD_BYTES} bytes (SPEC §10.3).`,
    );
  }
  return value;
}

function isPostgresInsufficientPrivilegeError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  return descriptor !== undefined && 'value' in descriptor && descriptor.value === '42501';
}

function normalizeJitterRatio(value: number | undefined): number {
  const ratio = value ?? POSTGRES_POSTURE_LEASE_DEFAULT_JITTER_RATIO;
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 0.25) {
    throw new TypeError('Postgres posture lease jitterRatio must be between 0 and 0.25.');
  }
  return ratio;
}

function normalizeWitnessTimeout(value: number | undefined): number {
  const timeout = value ?? POSTGRES_POSTURE_LEASE_WITNESS_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > 60_000) {
    throw new TypeError('Postgres posture lease witnessTimeoutMs must be 1000..60000.');
  }
  return timeout;
}

function jitteredRenewInterval(jitterRatio: number): number {
  if (jitterRatio === 0) return POSTGRES_POSTURE_LEASE_RENEW_INTERVAL_MS;
  const unit = randomBytes(1)[0]! / 255;
  const offset = (unit * 2 - 1) * jitterRatio;
  return Math.round(POSTGRES_POSTURE_LEASE_RENEW_INTERVAL_MS * (1 + offset));
}

function nativePostureLeaseTimer(): PostgresPostureLeaseTimer {
  return {
    clear: (handle) => clearTimeout(handle),
    now: () => Date.now(),
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  };
}
