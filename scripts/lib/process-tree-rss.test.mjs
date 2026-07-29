import { describe, expect, it } from 'vitest';

import {
  PROCESS_TREE_RSS_SCHEMA,
  assertProcessTreeReport,
  measureProcessTreeCommand,
  processTreeRssBytes,
} from './process-tree-rss.mjs';

describe('process-tree RSS measurement', () => {
  it('sums a root and arbitrarily ordered descendants without sibling leakage', () => {
    const snapshot = [
      '400 300 7',
      '100 1 11',
      '300 100 5',
      '200 100 13',
      '999 1 1000',
      'malformed',
    ].join('\n');

    expect(processTreeRssBytes(snapshot, 100)).toBe((11 + 13 + 5 + 7) * 1024);
  });

  it('runs argv without a shell and returns supervisor-owned timing/RSS evidence', () => {
    const observation = measureProcessTreeCommand(
      [
        process.execPath,
        '--input-type=module',
        '--eval',
        "process.stdout.write('ok'); await new Promise((resolve) => setTimeout(resolve, 100));",
      ],
      { sampleIntervalMs: 20, timeoutMs: 5_000 },
    );

    expect(observation).toMatchObject({
      error: null,
      exitCode: 0,
      signal: null,
      stdout: 'ok',
    });
    expect(observation.durationMs).toBeGreaterThan(0);
    expect(observation.peakRssBytes).toBeGreaterThan(0);
    expect(observation.sampleCount).toBeGreaterThan(0);
  });

  it('retains timing and peak process-tree RSS when the bounded command times out', () => {
    const observation = measureProcessTreeCommand(
      [process.execPath, '--input-type=module', '--eval', 'setInterval(() => {}, 1_000);'],
      { sampleIntervalMs: 20, timeoutMs: 1_000 },
    );

    expect(observation).toMatchObject({
      error: 'command exceeded 1000ms',
      exitCode: null,
    });
    expect(observation.signal).toMatch(/^SIG/u);
    expect(observation.durationMs).toBeGreaterThanOrEqual(900);
    expect(observation.peakRssBytes).toBeGreaterThan(0);
    expect(observation.sampleCount).toBeGreaterThan(0);
  });

  it('rejects reports that can omit or relabel the process-tree measurement', () => {
    expect(() =>
      assertProcessTreeReport({
        durationMs: 10,
        error: null,
        exitCode: 0,
        peakRssBytes: 100,
        sampleCount: 2,
        sampleIntervalMs: 50,
        schema: PROCESS_TREE_RSS_SCHEMA,
        signal: null,
      }),
    ).not.toThrow();

    expect(() =>
      assertProcessTreeReport({
        durationMs: 10,
        error: null,
        exitCode: 0,
        peakRssBytes: 100,
        sampleCount: 2,
        sampleIntervalMs: 50,
        schema: 'process-rss/v0',
        signal: null,
      }),
    ).toThrow(/invalid evidence|schema/u);
  });
});
