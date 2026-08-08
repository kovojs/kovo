import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  analyzeShardBalance,
  formatShardBalance,
  readShardManifests,
  shardBalanceFindings,
  shardPrediction,
  SHARD_BALANCE_SCHEMA,
} from './ci-shard-balance.mjs';

const THRESHOLDS = { maxImbalance: 1.35, minCoverage: 0.6 };

function manifests(shards) {
  return shards.map((files, index) => ({
    files,
    index: index + 1,
    name: `vitest-${String(index + 1)}-of-${String(shards.length)}.txt`,
    total: shards.length,
  }));
}

describe('shardPrediction', () => {
  it('uses the measured duration when history has one and the default when it does not', () => {
    const prediction = shardPrediction(['a.test.ts', 'b.test.ts'], { 'a.test.ts': { seconds: 12 } }, 5);
    expect(prediction).toEqual({ covered: 1, fileCount: 2, seconds: 17 });
  });

  it('accepts a bare number history entry as well as a { seconds } record', () => {
    expect(shardPrediction(['a.test.ts'], { 'a.test.ts': 9 }, 5).seconds).toBe(9);
  });

  // Without the floors this gate reports a different plan than the one CI will run: the eight
  // floored monoliths read as 5-second files and the heaviest shard looks like the lightest.
  it('applies the reviewed duration floor when it exceeds the measured duration', () => {
    const floors = { 'heavy.test.ts': 300 };
    expect(shardPrediction(['heavy.test.ts'], { 'heavy.test.ts': { seconds: 4 } }, 5, floors).seconds).toBe(
      300,
    );
    expect(shardPrediction(['heavy.test.ts'], { 'heavy.test.ts': { seconds: 450 } }, 5, floors).seconds).toBe(
      450,
    );
  });

  it('treats a zero, negative or unparseable duration as uncovered', () => {
    const history = { 'a.test.ts': { seconds: 0 }, 'b.test.ts': { seconds: -3 }, 'c.test.ts': 'soon' };
    const prediction = shardPrediction(['a.test.ts', 'b.test.ts', 'c.test.ts'], history, 5);
    expect(prediction.covered).toBe(0);
    expect(prediction.seconds).toBe(15);
  });
});

describe('analyzeShardBalance', () => {
  const history = {
    'a.test.ts': { seconds: 10 },
    'b.test.ts': { seconds: 10 },
    'c.test.ts': { seconds: 10 },
    'd.test.ts': { seconds: 10 },
  };

  it('reports a perfectly balanced plan as imbalance 1.0 with full coverage', () => {
    const analysis = analyzeShardBalance(
      manifests([['a.test.ts', 'b.test.ts'], ['c.test.ts', 'd.test.ts']]),
      history,
      { floors: {} },
    );
    expect(analysis.schema).toBe(SHARD_BALANCE_SCHEMA);
    expect(analysis.imbalance).toBeCloseTo(1, 10);
    expect(analysis.coverage).toBe(1);
    expect(shardBalanceFindings(analysis, THRESHOLDS)).toEqual([]);
  });

  // The failure `ci-shards.mjs` cannot see: its budget check is a ceiling on the whole plan, so a
  // plan that piles everything into one shard passes it and still costs the pipeline the full time.
  it('fails a plan that piles every file into one shard', () => {
    const analysis = analyzeShardBalance(
      manifests([['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'], []]),
      history,
      { floors: {} },
    );
    expect(analysis.imbalance).toBeCloseTo(2, 10);
    const findings = shardBalanceFindings(analysis, THRESHOLDS);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('2.00x the mean');
  });

  // The other silent failure: the timing artifacts stop being restored, every file falls back to
  // the default duration, and the "balanced" plan is really a file-count split.
  it('fails when the timing history stopped covering the plan', () => {
    const analysis = analyzeShardBalance(
      manifests([['a.test.ts', 'b.test.ts'], ['c.test.ts', 'd.test.ts']]),
      {},
      { floors: {} },
    );
    expect(analysis.coverage).toBe(0);
    expect(analysis.imbalance).toBeCloseTo(1, 10);
    const findings = shardBalanceFindings(analysis, THRESHOLDS);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('file-count split');
  });

  it('reports an empty manifest set rather than dividing by zero', () => {
    const analysis = analyzeShardBalance([], {}, { floors: {} });
    expect(analysis.imbalance).toBe(1);
    expect(analysis.coverage).toBe(0);
    expect(shardBalanceFindings(analysis, THRESHOLDS)).toContain(
      'no shard manifests were found to verify',
    );
  });

  it('renders every shard so a reviewer can see which one is heavy', () => {
    const analysis = analyzeShardBalance(
      manifests([['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'], []]),
      history,
      { floors: {} },
    );
    const rendered = formatShardBalance(analysis, THRESHOLDS);
    expect(rendered).toContain('shard 1: 40.0s over 4 files (4 with history)');
    expect(rendered).toContain('shard 2: 0.0s over 0 files (0 with history)');
    expect(rendered).toContain('timing-history coverage: 100.0%');
  });
});

describe('readShardManifests', () => {
  it('reads only the manifests of the requested kind, in shard order', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kovo-shard-balance-'));
    try {
      writeFileSync(path.join(dir, 'vitest-2-of-2.txt'), 'c.test.ts\n\nd.test.ts\n', 'utf8');
      writeFileSync(path.join(dir, 'vitest-1-of-2.txt'), 'a.test.ts\nb.test.ts\n', 'utf8');
      writeFileSync(path.join(dir, 'integration-1-of-2.txt'), 'other.spec.ts\n', 'utf8');
      const read = readShardManifests(dir, 'vitest');
      expect(read.map((manifest) => manifest.index)).toEqual([1, 2]);
      // Blank lines are plan noise, not files.
      expect(read[1].files).toEqual(['c.test.ts', 'd.test.ts']);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
