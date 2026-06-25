import { describe, expect, it } from 'vitest';

import { bucketJobDurations, formatSummary, summarizeRuns } from './ci-timing-report.mjs';

describe('ci-timing-report', () => {
  it('buckets jobs outside the 2-5 minute target', () => {
    expect(
      bucketJobDurations([
        {
          completedAt: '2026-06-25T00:01:00Z',
          name: 'too-short',
          startedAt: '2026-06-25T00:00:00Z',
        },
        {
          completedAt: '2026-06-25T00:03:00Z',
          name: 'healthy',
          startedAt: '2026-06-25T00:00:00Z',
        },
        {
          completedAt: '2026-06-25T00:07:00Z',
          name: 'too-long',
          startedAt: '2026-06-25T00:00:00Z',
        },
      ]).map((job) => job.name),
    ).toEqual(['too-long', 'too-short']);
  });

  it('summarizes completed runs with success and failure conclusions', () => {
    const summary = summarizeRuns([
      {
        conclusion: 'failure',
        createdAt: '2026-06-25T00:00:00Z',
        databaseId: 123,
        jobs: [
          {
            completedAt: '2026-06-25T00:06:00Z',
            conclusion: 'failure',
            name: 'integration',
            startedAt: '2026-06-25T00:00:00Z',
          },
        ],
        status: 'completed',
        updatedAt: '2026-06-25T00:06:10Z',
        url: 'https://example.test/run/123',
      },
      {
        conclusion: 'success',
        createdAt: '2026-06-25T01:00:00Z',
        databaseId: 124,
        jobs: [],
        status: 'completed',
        updatedAt: '2026-06-25T01:03:00Z',
        url: 'https://example.test/run/124',
      },
    ]);

    expect(formatSummary(summary)).toContain('123: failure wall=6m10s');
    expect(formatSummary(summary)).toContain('124: success wall=3m00s');
    expect(formatSummary(summary)).toContain('outside target: integration 6m00s');
  });
});
