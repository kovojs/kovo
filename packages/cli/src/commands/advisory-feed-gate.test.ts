import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { KOVO_ADVISORY_FEED_SCHEMA, KOVO_ADVISORY_SCHEMA } from './advisories.js';
import { collectAdvisoryFeedGateFindings } from './advisory-feed-gate.js';

const root = new URL('../../../../', import.meta.url);

function fencedJson(path: string, label: string): unknown {
  const source = readFileSync(new URL(path, root), 'utf8');
  const match = new RegExp('```json ' + label + '\\n([\\s\\S]*?)\\n```').exec(source);
  if (!match?.[1]) throw new Error(`${path} is missing its ${label} JSON block`);
  return JSON.parse(match[1]) as unknown;
}

function fixture() {
  const advisory = {
    affectedRange: '>=0.1.0 <0.3.0',
    fixedIn: '0.3.0',
    graphSchemaVersion: 'kovo.graph/v1',
    id: 'GHSA-test-0001',
    retracts: ['guarantee.one'],
    schema: KOVO_ADVISORY_SCHEMA,
    severity: 'high',
    tcbChokes: ['choke.one'],
  };
  return {
    advisory,
    feed: {
      advisories: [advisory],
      epoch: 1,
      issuedAt: '2026-07-20T12:00:00.000Z',
      maxFeedAgeSeconds: 7_776_000,
      schema: KOVO_ADVISORY_FEED_SCHEMA,
    },
    guarantees: {
      advisories: [{ id: advisory.id, retracts: advisory.retracts, status: 'open' }],
      guarantees: [{ id: 'guarantee.one' }],
    },
    tcb: { entries: [{ id: 'choke.one' }] },
  };
}

describe('live advisory feed repository gate', () => {
  it('keeps the checked-in feed canonical, fresh, and cross-ledger closed', () => {
    const source = readFileSync(new URL('security/advisories/feed.json', root), 'utf8');
    const result = collectAdvisoryFeedGateFindings(
      JSON.parse(source),
      fencedJson('SECURITY.md', 'security-guarantees'),
      fencedJson('security/TCB.md', 'tcb-manifest'),
      Date.now(),
    );
    expect(result.findings).toEqual([]);
    expect(source).toBe(`${JSON.stringify(result.feed, null, 2)}\n`);
  });

  it('rejects omissions and unknown guarantee/TCB bindings', () => {
    const valid = fixture();
    expect(
      collectAdvisoryFeedGateFindings(
        valid.feed,
        valid.guarantees,
        valid.tcb,
        Date.parse(valid.feed.issuedAt),
      ).findings,
    ).toEqual([]);

    expect(
      collectAdvisoryFeedGateFindings(
        { ...valid.feed, advisories: [] },
        valid.guarantees,
        valid.tcb,
        Date.parse(valid.feed.issuedAt),
      ).findings,
    ).toContain('SECURITY advisory GHSA-test-0001 is missing from the live advisory feed');

    const unknown = {
      ...valid.advisory,
      retracts: ['guarantee.missing'],
      tcbChokes: ['choke.missing'],
    };
    const findings = collectAdvisoryFeedGateFindings(
      { ...valid.feed, advisories: [unknown] },
      valid.guarantees,
      valid.tcb,
      Date.parse(valid.feed.issuedAt),
    ).findings;
    expect(findings).toContain(
      'GHSA-test-0001 retracts unknown SECURITY guarantee guarantee.missing',
    );
    expect(findings).toContain('GHSA-test-0001 names unknown TCB choke choke.missing');
    expect(findings).toContain('GHSA-test-0001 retracts drift from the SECURITY advisory register');
  });

  it('rejects stale, over-long, future-dated, and unsorted feeds', () => {
    const valid = fixture();
    const now = Date.parse(valid.feed.issuedAt);
    expect(
      collectAdvisoryFeedGateFindings(
        { ...valid.feed, maxFeedAgeSeconds: 7_776_001 },
        valid.guarantees,
        valid.tcb,
        now,
      ).findings,
    ).toContain('live advisory feed maxFeedAgeSeconds exceeds the 90-day release ceiling');
    expect(
      collectAdvisoryFeedGateFindings(
        valid.feed,
        valid.guarantees,
        valid.tcb,
        now + valid.feed.maxFeedAgeSeconds * 1_000 + 1,
      ).findings,
    ).toContain('live advisory feed is stale beyond maxFeedAgeSeconds');
    expect(
      collectAdvisoryFeedGateFindings(valid.feed, valid.guarantees, valid.tcb, now - 300_001)
        .findings,
    ).toContain('live advisory feed is future-dated');

    const second = { ...valid.advisory, id: 'GHSA-aaaa-0000' };
    const ledgers = {
      ...valid.guarantees,
      advisories: [
        ...(valid.guarantees.advisories as readonly unknown[]),
        { id: second.id, retracts: second.retracts, status: 'open' },
      ],
    };
    expect(
      collectAdvisoryFeedGateFindings(
        { ...valid.feed, advisories: [valid.advisory, second] },
        ledgers,
        valid.tcb,
        now,
      ).findings,
    ).toContain('live advisory feed advisories must be sorted by id');
  });
});
