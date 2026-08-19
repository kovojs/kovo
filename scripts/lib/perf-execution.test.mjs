import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import {
  executionIdentityFindings,
  mintServerBenchmarkRuntimeEnvironment,
  performanceExecutionIdentity,
} from './perf-execution.mjs';

describe('performance execution identity', () => {
  it('mints only one frozen exact server benchmark runtime environment', async () => {
    const first = mintServerBenchmarkRuntimeEnvironment();
    const second = mintServerBenchmarkRuntimeEnvironment();
    const prefix = 'deployment:kovo-server-benchmark-';

    expect(Object.isFrozen(first)).toBe(true);
    expect(Reflect.ownKeys(first)).toEqual([
      'KOVO_ATTESTATION_DEPLOYMENT_ID',
      'KOVO_ATTESTATION_SECRET',
      'NODE_ENV',
    ]);
    expect(first.KOVO_ATTESTATION_DEPLOYMENT_ID).toMatch(
      /^deployment:kovo-server-benchmark-[0-9a-f]{12}$/u,
    );
    expect(
      Buffer.from(first.KOVO_ATTESTATION_DEPLOYMENT_ID.slice(prefix.length), 'hex'),
    ).toHaveLength(6);
    expect(first.KOVO_ATTESTATION_SECRET).toMatch(/^[0-9a-f]{64}$/u);
    expect(Buffer.from(first.KOVO_ATTESTATION_SECRET, 'hex')).toHaveLength(32);
    expect(first.NODE_ENV).toBe('production');
    expect(second.KOVO_ATTESTATION_DEPLOYMENT_ID).not.toBe(first.KOVO_ATTESTATION_DEPLOYMENT_ID);
    expect(second.KOVO_ATTESTATION_SECRET).not.toBe(first.KOVO_ATTESTATION_SECRET);
    expect(await import('./perf-execution.mjs')).not.toHaveProperty('randomBytes');
  });

  it('keeps benchmark entropy encoding pinned after late Buffer.toString poisoning', () => {
    const original = Buffer.prototype.toString;
    try {
      Buffer.prototype.toString = () => 'poisoned';
      const environment = mintServerBenchmarkRuntimeEnvironment();
      const execution = performanceExecutionIdentity({
        env: {},
        pid: 42,
        startedAt: '2026-08-13T12:00:00.000Z',
      });

      expect(environment.KOVO_ATTESTATION_DEPLOYMENT_ID).toMatch(
        /^deployment:kovo-server-benchmark-[0-9a-f]{12}$/u,
      );
      expect(environment.KOVO_ATTESTATION_SECRET).toMatch(/^[0-9a-f]{64}$/u);
      expect(execution.local.nonce).toMatch(/^[0-9a-f]{32}$/u);
    } finally {
      Buffer.prototype.toString = original;
    }
  });

  it('binds a PR-head source and event SHA to one directly derived Actions run', () => {
    const execution = performanceExecutionIdentity({
      env: {
        GITHUB_JOB: 'browser-matrix',
        GITHUB_REPOSITORY: 'example/kovo',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_RUN_ID: '1234',
        GITHUB_SERVER_URL: 'https://github.example',
        GITHUB_SHA: 'a'.repeat(40),
        GITHUB_WORKFLOW_REF: 'example/kovo/.github/workflows/perf-realistic.yml@refs/heads/main',
        GITHUB_WORKFLOW_SHA: 'c'.repeat(40),
        KOVO_PERF_SOURCE_SHA: 'b'.repeat(40),
      },
      startedAt: '2026-08-13T12:00:00.000Z',
    });

    expect(execution).toMatchObject({
      complete: true,
      github: {
        eventSha: 'a'.repeat(40),
        job: 'browser-matrix',
        runUrl: 'https://github.example/example/kovo/actions/runs/1234',
        sha: 'b'.repeat(40),
        workflowSha: 'c'.repeat(40),
      },
      provider: 'github-actions',
      schema: 'kovo-performance-execution/v1',
    });
    expect(executionIdentityFindings(execution, { requireProvider: 'github-actions' })).toEqual([]);
  });

  it('falls back to the event SHA when no explicit source SHA is supplied', () => {
    const execution = performanceExecutionIdentity({
      env: githubEnvironment(),
      startedAt: '2026-08-13T12:00:00.000Z',
    });

    expect(execution.github).toMatchObject({
      eventSha: 'a'.repeat(40),
      sha: 'a'.repeat(40),
    });
    expect(executionIdentityFindings(execution)).toEqual([]);
  });

  it('fails closed on malformed event/source SHAs and digest-bound SHA tampering', () => {
    const malformedSource = performanceExecutionIdentity({
      env: { ...githubEnvironment(), KOVO_PERF_SOURCE_SHA: 'B'.repeat(40) },
      startedAt: '2026-08-13T12:00:00.000Z',
    });
    expect(executionIdentityFindings(malformedSource)).toEqual(
      expect.arrayContaining([
        'execution identity is incomplete',
        'GitHub source SHA is malformed',
      ]),
    );

    const malformedEvent = performanceExecutionIdentity({
      env: { ...githubEnvironment(), GITHUB_SHA: 'short', KOVO_PERF_SOURCE_SHA: 'b'.repeat(64) },
      startedAt: '2026-08-13T12:00:00.000Z',
    });
    expect(executionIdentityFindings(malformedEvent)).toEqual(
      expect.arrayContaining(['execution identity is incomplete', 'GitHub event SHA is malformed']),
    );

    const malformedWorkflow = performanceExecutionIdentity({
      env: { ...githubEnvironment(), GITHUB_WORKFLOW_SHA: 'short' },
      startedAt: '2026-08-13T12:00:00.000Z',
    });
    expect(executionIdentityFindings(malformedWorkflow)).toEqual(
      expect.arrayContaining([
        'execution identity is incomplete',
        'GitHub workflow SHA is malformed',
      ]),
    );

    const complete = performanceExecutionIdentity({
      env: githubEnvironment(),
      startedAt: '2026-08-13T12:00:00.000Z',
    });
    complete.github.sha = 'b'.repeat(40);
    expect(executionIdentityFindings(complete)).toContain(
      'execution digest is not derived from its facts',
    );
  });

  it('fails closed on a partial GitHub environment or changed facts', () => {
    const partial = performanceExecutionIdentity({
      env: { GITHUB_RUN_ID: '1234' },
      startedAt: '2026-08-13T12:00:00.000Z',
    });
    expect(executionIdentityFindings(partial)).toContain('execution identity is incomplete');

    const sourceWithoutActions = performanceExecutionIdentity({
      env: { KOVO_PERF_SOURCE_SHA: 'a'.repeat(40) },
      startedAt: '2026-08-13T12:00:00.000Z',
    });
    expect(sourceWithoutActions.provider).toBe('github-actions');
    expect(executionIdentityFindings(sourceWithoutActions)).toEqual(
      expect.arrayContaining(['execution identity is incomplete', 'GitHub event SHA is malformed']),
    );

    const local = performanceExecutionIdentity({
      env: {},
      nonce: 'a'.repeat(32),
      pid: 42,
      startedAt: '2026-08-13T12:00:00.000Z',
    });
    expect(executionIdentityFindings(local)).toEqual([]);
    expect(executionIdentityFindings({ ...local, startedAt: 'changed' })).toContain(
      'execution digest is not derived from its facts',
    );
    expect(executionIdentityFindings(local, { requireProvider: 'github-actions' })).toContain(
      'execution provider is local, expected github-actions',
    );
  });
});

function githubEnvironment() {
  return {
    GITHUB_JOB: 'browser-matrix',
    GITHUB_REPOSITORY: 'example/kovo',
    GITHUB_RUN_ATTEMPT: '2',
    GITHUB_RUN_ID: '1234',
    GITHUB_SERVER_URL: 'https://github.example',
    GITHUB_SHA: 'a'.repeat(40),
    GITHUB_WORKFLOW_REF: 'example/kovo/.github/workflows/perf-realistic.yml@refs/heads/main',
    GITHUB_WORKFLOW_SHA: 'c'.repeat(40),
  };
}
