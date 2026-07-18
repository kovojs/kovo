import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './lib/repo-root.mjs';
import {
  collectSecurityConvergenceSnapshot,
  compareSnapshot,
  measureEgressObligations,
  measureImperativeDomSinkLexicon,
  measureLiveSecurityConvergence,
  measureTrustStaticObligations,
  parsePeakRss,
} from './security-convergence-baseline.mjs';

describe('security convergence baseline', () => {
  it('keeps the committed deterministic snapshot synchronized', () => {
    const baseline = JSON.parse(
      readFileSync(path.join(repoRoot(), 'security/security-convergence-baseline.json'), 'utf8'),
    );
    expect(compareSnapshot(baseline.snapshot, collectSecurityConvergenceSnapshot())).toEqual([]);
  });

  it('counts complete-file syntax and name obligations rather than LOC', () => {
    const measured = measureTrustStaticObligations(`
      const REVIEWED_NAMES = new Set(['alpha', 'beta']);
      function classify(node, name) {
        if (Node.isCallExpression(node)) return SyntaxKind.CallExpression;
        if (name === 'direct') return ['one', 'two'].includes(name);
        switch (name) { case 'switch': return true; default: return false; }
      }
    `);
    expect(measured).toMatchObject({
      directNamePredicates: 1,
      inlineMembershipEntries: 2,
      nameBranches: 6,
      namedInventoryEntries: 2,
      namedInventoryTableCount: 1,
      switchLiteralCases: 1,
      syntaxBranches: 2,
      syntaxGuardSites: 1,
      syntaxKindSites: 1,
      total: 8,
    });
  });

  it('derives the imperative DOM deny lexicon from its classifier branches', () => {
    const measured = measureImperativeDomSinkLexicon(`
      function unregisteredSinksForSourceFile() {
        if (member !== 'innerHTML' && member !== 'outerHTML') return;
        if (unshadowedGlobalIdentifier(callee, 'Function')) return;
      }
      function dangerousCallSink() {
        if (name === 'eval' || name === 'setTimeout' || name === 'setInterval') return;
        if (method === 'write' || method === 'writeln') return;
      }
    `);
    expect(measured.sinkNames).toEqual([
      'Function',
      'eval',
      'innerHTML',
      'outerHTML',
      'setInterval',
      'setTimeout',
      'write',
      'writeln',
    ]);
  });

  it('counts egress ranges, exact metadata identities, and every direct allow path', () => {
    const measured = measureEgressObligations(`
      const IANA_IPV4_SPECIAL_PURPOSE_PREFIXES = [['10.0.0.0/8', 'private']];
      const CONSERVATIVE_IPV4_CLOSED_PREFIXES = [['224.0.0.0/4', 'special']];
      const IANA_IPV6_SPECIAL_PURPOSE_PREFIXES = [[[0xfc00], 7, 'private']];
      function classifyIpv4(ip) {
        if (ip === '169.254.169.254') return 'metadata';
      }
      function classifyIpv6Bytes(ip) {
        if (canonicalize(ip) === 'fd00:ec2::254') return 'metadata';
      }
      function evaluateEgressDecision() {
        if (cls === 'public') return null;
        if (allowInternal.has(host)) return null;
      }
      function evaluateDestinationAllowlist() {
        if (allowDestinations.has(origin)) return null;
      }
    `);
    expect(measured).toMatchObject({
      exactMetadataAddressCount: 2,
      opaqueAllowPathCount: 2,
      opaqueAllowPaths: ['allowDestinations.has(origin)', 'allowInternal.has(host)'],
      rangeEntryCount: 3,
    });
  });

  it('parses Darwin and GNU peak-RSS output into bytes', () => {
    expect(parsePeakRss('  468713472 maximum resident set size\n', 'darwin')).toBe(468713472);
    expect(parsePeakRss('Maximum resident set size (kbytes): 1024\n', 'linux')).toBe(1048576);
  });

  it('reports live mutation survivors instead of treating catalog presence as a kill', async () => {
    const result = await measureLiveSecurityConvergence({
      measureGreen: () => ({ durationMs: 5, peakRssBytes: 10, platform: 'test' }),
      mutants: [{ name: 'killed' }, { name: 'survived' }],
      runMutants: async () => [
        { name: 'killed', status: 'killed' },
        { name: 'survived', status: 'survived' },
      ],
    });
    expect(result.m).toEqual({
      killed: 1,
      survivors: [{ name: 'survived', status: 'survived' }],
      total: 2,
    });
  });
});
