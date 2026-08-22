import { describe, expect, it } from 'vitest';

import { assertMeasurementIntegrity, measurementIntegrityFindings } from './integrity.mjs';

const cleanNetwork = {
  errorResponses: 0,
  failedRequests: 0,
  pageErrors: 0,
  rateLimitedResponses: 0,
  tracked: true,
};

describe('browser measurement integrity', () => {
  it('accepts Lighthouse evidence without reading an out-of-scope traversal iteration', () => {
    const run = {
      app: 'kovo',
      bfcache: { iterations: [{ evidenceComplete: true, network: cleanNetwork }] },
      conditions: {},
      integrity: { complete: true, errors: [] },
      lighthouse: [{ formFactor: 'mobile', network: cleanNetwork, path: '/', repeats: 5 }],
    };
    expect(() => assertMeasurementIntegrity([run], () => undefined)).not.toThrow();
  });

  it('attributes incomplete traversal evidence to the bfcache iteration', () => {
    const findings = measurementIntegrityFindings([
      {
        app: 'nextjs',
        bfcache: { iterations: [{ evidenceComplete: false, network: cleanNetwork }] },
        conditions: {},
        integrity: { complete: true, errors: [] },
        lighthouse: [],
      },
    ]);
    expect(findings.problems).toEqual([
      'nextjs/bfcache/0: history traversal evidence was incomplete.',
    ]);
  });
});
