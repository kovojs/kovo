import { describe, expect, it, vi } from 'vitest';

import { trustedSuccessfulCheckNames, validateReleaseInput } from './verify-release-input.mjs';

describe('verify-release-input', () => {
  it('reports already-published packages while allowing missing ones', () => {
    const log = vi.fn();
    validateReleaseInput('1.2.3', {
      env: {},
      log,
      releasePackagesFn: () => [
        { name: '@kovojs/a', version: '1.2.3' },
        { name: '@kovojs/b', version: '1.2.3' },
      ],
      npmPublishedState: (name) =>
        name === '@kovojs/a' ? { state: 'published' } : { state: 'missing' },
    });

    expect(log).toHaveBeenCalledWith(
      'Release 1.2.3 is partially published; these packages will be skipped on publish:\n  @kovojs/a@1.2.3',
    );
    expect(log).toHaveBeenCalledWith('Release input 1.2.3 is valid for 2 public packages.');
  });

  it('fails closed on npm registry errors', () => {
    expect(() =>
      validateReleaseInput('1.2.3', {
        env: {},
        releasePackagesFn: () => [{ name: '@kovojs/a', version: '1.2.3' }],
        npmPublishedState: () => ({ state: 'error', detail: 'npm ERR! code E401' }),
      }),
    ).toThrowError(
      'Failed to verify npm published state for release 1.2.3:\n  @kovojs/a@1.2.3: npm ERR! code E401',
    );
  });

  it('refuses a non-main release before consulting package or registry state', () => {
    const releasePackagesFn = vi.fn();
    const npmPublishedState = vi.fn();

    expect(() =>
      validateReleaseInput('1.2.3', {
        env: { GITHUB_REF: 'refs/heads/attacker-release' },
        releasePackagesFn,
        npmPublishedState,
      }),
    ).toThrow('Release workflow must run from refs/heads/main');
    expect(releasePackagesFn).not.toHaveBeenCalled();
    expect(npmPublishedState).not.toHaveBeenCalled();
  });

  it('does not let an environment override skip exact-commit checks in GitHub Actions', () => {
    const verifyExactCommitChecksFn = vi.fn();

    validateReleaseInput('1.2.3', {
      env: {
        GITHUB_ACTIONS: 'true',
        GITHUB_REF: 'refs/heads/main',
        SKIP_RELEASE_CHECKS: '1',
        SKIP_NPM_PUBLISHED_CHECK: '1',
      },
      npmPublishedState: () => ({ state: 'missing' }),
      releasePackagesFn: () => [{ name: '@kovojs/a', version: '1.2.3' }],
      verifyExactCommitChecksFn,
    });

    expect(verifyExactCommitChecksFn).toHaveBeenCalledOnce();
  });

  it('does not let an environment override skip registry-state verification', () => {
    expect(() =>
      validateReleaseInput('1.2.3', {
        env: { SKIP_NPM_PUBLISHED_CHECK: '1' },
        npmPublishedState: () => ({ state: 'error', detail: 'registry unavailable' }),
        releasePackagesFn: () => [{ name: '@kovojs/a', version: '1.2.3' }],
      }),
    ).toThrow('registry unavailable');
  });

  it('accepts successful exact-SHA GitHub Actions checks but rejects structural lookalikes', () => {
    const expectedSha = '0123456789abcdef';
    const passed = trustedSuccessfulCheckNames(
      [
        {
          app: { id: 15368, owner: { id: 9919, login: 'github' }, slug: 'github-actions' },
          conclusion: 'success',
          head_sha: expectedSha,
          name: 'check',
          status: 'completed',
        },
        {
          app: { id: 999999, slug: 'attacker-check-app' },
          conclusion: 'success',
          head_sha: expectedSha,
          name: 'forged-app',
          status: 'completed',
        },
        {
          app: { id: 15368, owner: { id: 9919, login: 'github' }, slug: 'github-actions' },
          conclusion: 'success',
          head_sha: 'stale-sha',
          name: 'stale-check',
          status: 'completed',
        },
        {
          app: { id: 15368, owner: { id: 1234, login: 'attacker' }, slug: 'github-actions' },
          conclusion: 'success',
          head_sha: expectedSha,
          name: 'owner-lookalike',
          status: 'completed',
        },
      ],
      expectedSha,
    );

    expect([...passed]).toEqual(['check']);
  });
});
