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
  measureProductionPredicateObligations,
  measureStaticPredicateObligations,
  parsePeakRss,
} from './security-convergence-baseline.mjs';

describe('security convergence baseline', () => {
  it('keeps the committed deterministic snapshot synchronized', () => {
    const baseline = JSON.parse(
      readFileSync(path.join(repoRoot(), 'security/security-convergence-baseline.json'), 'utf8'),
    );
    expect(
      compareSnapshot(baseline.currentSnapshot.snapshot, collectSecurityConvergenceSnapshot()),
    ).toEqual([]);
    expect(baseline.historicalRows[0]).toMatchObject({
      auditedCodeSha: 'e5f613be9f1bb1f1cfc568a53e88ee741b3a4ded',
      measurements: { c13: '17 corpora / 143 anchors', p: 5956 },
    });
    expect(baseline.currentSnapshot).toMatchObject({
      measuredCodeSha: 'fa326cdfdde18c027b95aee2702b82771d396fbe',
      snapshot: {
        c13: { anchorCount: 198, corpusCount: 21 },
        p: {
          category: 'conservative-production-predicate-lower-bound',
          staticPredicates: { fileCount: 13, total: 7964 },
          total: 8021,
        },
      },
    });
  });

  it('counts generic Node/TypeScript syntax and name obligations rather than LOC', () => {
    const measured = measureStaticPredicateObligations(`
      const REVIEWED_ARRAY = (['alpha', 'beta'] as const)!;
      const REVIEWED_RECORD = ({ alpha: 1, beta: 2 } as const);
      const REVIEWED_SET = new Set((['charlie', 'delta'] as const).filter(Boolean));
      const REVIEWED_MAP = new Map(([['key', 'value']] as const).map((entry) => entry));
      const REVIEWED_MAPPED = ((['echo', 'foxtrot'] as const).map(String)) satisfies readonly string[];
      function classify(node, name) {
        if (Node.isCallExpression(node)) return SyntaxKind.CallExpression;
        if (ts.isIdentifier(node)) return ts.SyntaxKind.Identifier;
        if (name === 'direct') return ['one', 'two'].includes(name);
        if (new Set((['three', 'four'] as const).map(String)).has(name)) return true;
        switch (name) { case 'switch': return true; default: return false; }
      }
    `);
    expect(measured).toMatchObject({
      directNamePredicates: 1,
      inlineMembershipEntries: 4,
      nameBranches: 15,
      namedInventoryEntries: 9,
      namedInventoryTableCount: 5,
      switchLiteralCases: 1,
      syntaxBranches: 4,
      syntaxGuardSites: 2,
      syntaxKindSites: 2,
      total: 19,
    });
  });

  it('aggregates the explicit production scope into stable sorted per-file rows', () => {
    const measured = measureProductionPredicateObligations([
      { file: 'z-classifier.ts', source: `if (name === 'z') accept();` },
      {
        file: 'a-classifier.ts',
        source: `const NAMES = ['a', 'b']; if (ts.isIdentifier(node)) accept();`,
      },
    ]);
    expect(measured).toMatchObject({
      fileCount: 2,
      files: [
        { file: 'a-classifier.ts', namedInventoryEntries: 2, syntaxGuardSites: 1, total: 3 },
        { file: 'z-classifier.ts', directNamePredicates: 1, total: 1 },
      ],
      scopeFiles: ['a-classifier.ts', 'z-classifier.ts'],
      total: 4,
    });
    expect(measured.files.every((row) => /^[0-9a-f]{64}$/u.test(row.sourceSha256))).toBe(true);
    expect(measured.rowsSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(measured.scopeSha256).toMatch(/^[0-9a-f]{64}$/u);
    const sourceChanged = measureProductionPredicateObligations([
      { file: 'a-classifier.ts', source: `const NAMES = ['a', 'changed'];` },
      { file: 'z-classifier.ts', source: `if (name === 'z') accept();` },
    ]);
    expect(sourceChanged.scopeSha256).toBe(measured.scopeSha256);
    expect(sourceChanged.rowsSha256).not.toBe(measured.rowsSha256);
    expect(
      measureProductionPredicateObligations([
        { file: 'moved/a-classifier.ts', source: `const NAMES = ['a', 'b'];` },
        { file: 'z-classifier.ts', source: `if (name === 'z') accept();` },
      ]).scopeSha256,
    ).not.toBe(measured.scopeSha256);
  });

  it('derives the residual dangerous-call lexicon without the deleted raw-handler classifier', () => {
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
    expect(measured.sinkNames).toEqual(['eval', 'setInterval', 'setTimeout', 'write', 'writeln']);
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
