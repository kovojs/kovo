import { describe, expect, it } from 'vitest';

import {
  measureProcessTreeWindow,
  parseProcessCpuSeconds,
  processTreeMetrics,
} from './process-tree-metrics.mjs';

describe('process-tree runtime metrics', () => {
  it('parses portable ps CPU clocks', () => {
    expect(parseProcessCpuSeconds('01:02.50')).toBe(62.5);
    expect(parseProcessCpuSeconds('02:03:04')).toBe(7_384);
    expect(parseProcessCpuSeconds('1-02:03:04.5')).toBe(93_784.5);
    expect(parseProcessCpuSeconds('broken')).toBeNull();
  });

  it('sums only the root and transitive descendants', () => {
    expect(
      processTreeMetrics(
        '10 1 100 00:01.00\n11 10 200 00:02.50\n12 11 300 00:03.00\n99 1 9000 01:00.00\n',
        10,
      ),
    ).toEqual({ cpuSeconds: 6.5, processCount: 3, rssBytes: 600 * 1024 });
  });

  it('reports CPU delta and peak RSS around exactly one task', async () => {
    const snapshots = [
      { cpuSeconds: 1, processCount: 1, rssBytes: 100 },
      { cpuSeconds: 2, processCount: 2, rssBytes: 300 },
      { cpuSeconds: 3, processCount: 1, rssBytes: 200 },
    ];
    const result = await measureProcessTreeWindow(
      10,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return 'done';
      },
      {
        intervalMs: 25,
        snapshot: async () =>
          snapshots.shift() ?? { cpuSeconds: 3, processCount: 1, rssBytes: 200 },
      },
    );
    expect(result.value).toBe('done');
    expect(result.metrics).toMatchObject({
      cpuMs: 2_000,
      peakRssBytes: 300,
      samplingError: null,
    });
    expect(result.metrics.rssSamples).toBeGreaterThanOrEqual(3);
  });
});
