import { describe, expect, it } from 'vitest';

import { executionIdentityFindings, performanceExecutionIdentity } from './perf-execution.mjs';

describe('performance execution identity', () => {
  it('binds a complete GitHub Actions run to a directly derived URL', () => {
    const execution = performanceExecutionIdentity({
      env: {
        GITHUB_JOB: 'browser-matrix',
        GITHUB_REPOSITORY: 'example/kovo',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_RUN_ID: '1234',
        GITHUB_SERVER_URL: 'https://github.example',
        GITHUB_SHA: 'a'.repeat(40),
        GITHUB_WORKFLOW_REF: 'example/kovo/.github/workflows/perf-realistic.yml@refs/heads/main',
      },
      startedAt: '2026-08-13T12:00:00.000Z',
    });

    expect(execution).toMatchObject({
      complete: true,
      github: {
        job: 'browser-matrix',
        runUrl: 'https://github.example/example/kovo/actions/runs/1234',
      },
      provider: 'github-actions',
      schema: 'kovo-performance-execution/v1',
    });
    expect(executionIdentityFindings(execution, { requireProvider: 'github-actions' })).toEqual([]);
  });

  it('fails closed on a partial GitHub environment or changed facts', () => {
    const partial = performanceExecutionIdentity({
      env: { GITHUB_RUN_ID: '1234' },
      startedAt: '2026-08-13T12:00:00.000Z',
    });
    expect(executionIdentityFindings(partial)).toContain('execution identity is incomplete');

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
