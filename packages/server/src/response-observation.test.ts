import { describe, expect, it, vi } from 'vitest';

import {
  compareResponseObservations,
  defineResponseObservationPolicy,
  requireResponseObservationPolicy,
  RESPONSE_OBSERVATION_SCHEMA,
  runUniformWork,
  type ResponseObservation,
} from './response-observation.js';

const policy = defineResponseObservationPolicy({
  class: 'resource-concealment',
  id: 'server.storage-download',
  schema: RESPONSE_OBSERVATION_SCHEMA,
  tuple: {
    body: 'equal-content-and-length',
    connection: 'complete',
    cookiesAndTokens: 'none',
    headers: ['cache-control', 'content-type', 'vary'],
    redirect: 'equal',
    status: 'equal',
    timingBudget: 'nightly-v1',
    workFactor: 'storage-capability-lookup-v1',
  },
  worlds: ['exists-not-owned', 'absent'],
});

function observation(overrides: Partial<ResponseObservation> = {}): ResponseObservation {
  return {
    body: { content: 'Not Found', length: 9, mediaType: 'text/plain; charset=utf-8' },
    connection: 'complete',
    cookiesAndTokens: [],
    headers: {
      'cache-control': 'private, no-store',
      'content-type': 'text/plain; charset=utf-8',
      vary: 'Cookie',
    },
    redirect: null,
    status: 404,
    timingMs: 2,
    workFactor: 'storage-capability-lookup-v1',
    ...overrides,
  };
}

describe('response observation policy', () => {
  it('fails closed for an unclassified remotely reachable candidate', () => {
    expect(() => requireResponseObservationPolicy('app.account-lookup', undefined)).toThrow(
      'Unclassified remotely reachable response-observation surface app.account-lookup',
    );
    expect(() =>
      requireResponseObservationPolicy('app.account-lookup', {
        ...policy,
      }),
    ).toThrow('Unclassified remotely reachable response-observation surface app.account-lookup');
  });

  it('rejects a class whose explicit world pair has drifted', () => {
    expect(() =>
      defineResponseObservationPolicy({
        ...policy,
        class: 'account-recovery',
      }),
    ).toThrow('requires worlds account-present:account-absent');
  });

  it('compares the declared tuple instead of raw response-object equality', () => {
    const left = observation({ timingMs: 1 });
    const right = observation({
      headers: { ...left.headers, 'x-unselected-debug': 'different' },
      timingMs: 99,
    });
    expect(compareResponseObservations(policy, left, right)).toEqual({
      differences: [],
      equal: true,
    });
  });

  it('reports each declared attacker-visible mismatch', () => {
    const verdict = compareResponseObservations(
      policy,
      observation(),
      observation({
        body: { content: 'Missing', length: 7, mediaType: 'application/json' },
        connection: 'reset',
        cookiesAndTokens: ['session:present'],
        headers: {
          'cache-control': 'public',
          'content-type': 'application/json',
          vary: '',
        },
        redirect: '/login',
        status: 403,
        workFactor: 'fast-miss',
      }),
    );
    expect(verdict.equal).toBe(false);
    expect(new Set(verdict.differences.map((difference) => difference.axis))).toEqual(
      new Set([
        'body',
        'connection',
        'cookiesAndTokens',
        'headers',
        'redirect',
        'status',
        'workFactor',
      ]),
    );
  });
});

describe('runUniformWork', () => {
  it.each([
    ['primary', 'stored-digest'],
    ['decoy', undefined],
  ] as const)(
    'routes the %s world through the same work and normalizer',
    async (world, candidate) => {
      const decoy = vi.fn(() => 'decoy-digest');
      const work = vi.fn((digest: string) => `verified:${digest}`);
      const normalize = vi.fn((result: string, selected: string) => `${selected}:${result}`);

      await expect(runUniformWork({ candidate, decoy, normalize, work })).resolves.toBe(
        `${world}:verified:${candidate ?? 'decoy-digest'}`,
      );
      expect(work).toHaveBeenCalledTimes(1);
      expect(normalize).toHaveBeenCalledTimes(1);
      expect(decoy).toHaveBeenCalledTimes(world === 'decoy' ? 1 : 0);
    },
  );
});
