import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { repoRoot } from './lib/repo-root.mjs';
import { sha256 } from './lib/security-evidence-subject.mjs';
import {
  collectSecurityConvergenceSnapshot,
  compareSnapshot,
  measureEgressObligations,
  measureImperativeDomSinkLexicon,
  measureLiveSecurityConvergence,
  measureProductionPredicateObligations,
  measureStaticPredicateObligations,
  main as runSecurityConvergenceGate,
  parsePeakRss,
  parseSecurityConvergenceMode,
  SECURITY_CONVERGENCE_SOURCE_PATHS,
  updateSecurityConvergenceRecord,
} from './security-convergence-baseline.mjs';

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function convergenceRepository() {
  const sourceRoot = repoRoot();
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-convergence-subject-'));
  temporaryRoots.push(root);
  const paths = new Set([
    ...SECURITY_CONVERGENCE_SOURCE_PATHS,
    'security/security-convergence-baseline.json',
    'security/security-convergence-audit-round-2026-07-18.json',
  ]);
  for (const relativePath of paths) {
    const destination = path.join(root, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(path.join(sourceRoot, relativePath), destination);
  }
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'convergence@example.test']);
  git(root, ['config', 'user.name', 'Convergence Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'measured convergence inputs']);
  const subjectSha = git(root, ['rev-parse', 'HEAD']);
  const baselinePath = path.join(root, 'security/security-convergence-baseline.json');
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const auditRoundPath = path.join(
    root,
    'security/security-convergence-audit-round-2026-07-18.json',
  );
  const auditRound = JSON.parse(readFileSync(auditRoundPath, 'utf8'));
  auditRound.auditedCodeSha = subjectSha;
  writeFileSync(auditRoundPath, `${JSON.stringify(auditRound, null, 2)}\n`);
  baseline.historicalRows[0].auditedCodeSha = subjectSha;
  baseline.historicalRows[0].auditRound.sha256 = sha256(readFileSync(auditRoundPath));
  const snapshot = collectSecurityConvergenceSnapshot({ repoRoot: root });
  writeFileSync(
    baselinePath,
    `${JSON.stringify(
      updateSecurityConvergenceRecord({
        baseline,
        codeSubjectSha: subjectSha,
        reason: 'test subject binding',
        repoRoot: root,
        snapshot,
      }),
      null,
      2,
    )}\n`,
  );
  return { baselinePath, root, subjectSha };
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${result.stderr}${result.stdout}`);
  return result.stdout.trim();
}

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
    expect(baseline.historicalRows[0]).not.toHaveProperty('snapshotSha256');
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
    expect(baseline.subjectProtocol).toMatchObject({
      schema: 'kovo.security-evidence-subject/v1',
    });
  });

  it('mechanically separates the clean code subject from its later evidence commit', () => {
    const baseline = JSON.parse(
      readFileSync(path.join(repoRoot(), 'security/security-convergence-baseline.json'), 'utf8'),
    );
    const snapshot = collectSecurityConvergenceSnapshot();
    const updated = updateSecurityConvergenceRecord({
      baseline,
      codeSubjectSha: '0123456789abcdef0123456789abcdef01234567',
      reason: 'exact test refresh',
      snapshot,
    });
    expect(updated).toMatchObject({
      currentSnapshot: {
        measuredCodeSha: '0123456789abcdef0123456789abcdef01234567',
        reason: 'exact test refresh',
        snapshot,
      },
      subjectProtocol: {
        evidenceCommit: expect.stringContaining('self-referential'),
      },
    });
    expect(updated).not.toHaveProperty('evidenceCommitSha');
    expect(() =>
      updateSecurityConvergenceRecord({
        baseline,
        codeSubjectSha: 'HEAD',
        reason: 'bad subject',
        snapshot,
      }),
    ).toThrow('full lowercase Git commit SHA');
  });

  it('binds the current convergence label to a real commit and its exact measured inputs', async () => {
    const { baselinePath, root } = convergenceRepository();
    expect(await runSecurityConvergenceGate({ args: [], repoRoot: root })).toBe(true);

    const nonexistent = JSON.parse(readFileSync(baselinePath, 'utf8'));
    nonexistent.currentSnapshot.measuredCodeSha = '0'.repeat(40);
    writeFileSync(baselinePath, `${JSON.stringify(nonexistent, null, 2)}\n`);
    expect(await runSecurityConvergenceGate({ args: [], repoRoot: root })).toBe(false);

    const { baselinePath: driftBaselinePath, root: driftRoot } = convergenceRepository();
    writeFileSync(path.join(driftRoot, SECURITY_CONVERGENCE_SOURCE_PATHS[0]), '// drift\n');
    expect(await runSecurityConvergenceGate({ args: [], repoRoot: driftRoot })).toBe(false);
    expect(readFileSync(driftBaselinePath, 'utf8')).toContain('test subject binding');
  });

  it('rejects decorative fields that are not joined to historical evidence', async () => {
    const { baselinePath, root } = convergenceRepository();
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    baseline.historicalRows[0].snapshotSha256 = '0'.repeat(64);
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    expect(await runSecurityConvergenceGate({ args: [], repoRoot: root })).toBe(false);
  });

  it('keeps check, live, and writer CLI modes explicit and mutually exclusive', () => {
    expect(parseSecurityConvergenceMode([])).toEqual({ mode: 'check' });
    expect(parseSecurityConvergenceMode(['--live'])).toEqual({ mode: 'live' });
    expect(
      parseSecurityConvergenceMode([
        '--write',
        '--subject-sha',
        '0123456789abcdef0123456789abcdef01234567',
        '--reason',
        'reviewed refresh',
      ]),
    ).toMatchObject({ mode: 'write' });
    expect(() =>
      parseSecurityConvergenceMode([
        '--live',
        '--write',
        '--subject-sha',
        '0123456789abcdef0123456789abcdef01234567',
        '--reason',
        'bad combination',
      ]),
    ).toThrow();
  });

  it('reports absolute D and W denominator counts from the validated inventories', () => {
    expect(collectSecurityConvergenceSnapshot()).toMatchObject({
      d: {
        checkedIntent: 0,
        derived: 2,
        reviewedExempt: 0,
        total: 8,
        uncovered: 6,
      },
      w: {
        reviewedExempt: 0,
        rewitnessed: 3,
        total: 9,
        uncovered: 6,
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
    expect(measured.files.every((row) => !Object.hasOwn(row, 'namedInventorySha256'))).toBe(true);
    expect(Object.keys(measured).sort()).toEqual(['fileCount', 'files', 'scopeFiles', 'total']);
    const sourceChanged = measureProductionPredicateObligations([
      { file: 'a-classifier.ts', source: `const NAMES = ['a', 'changed'];` },
      { file: 'z-classifier.ts', source: `if (name === 'z') accept();` },
    ]);
    expect(sourceChanged.scopeFiles).toEqual(measured.scopeFiles);
    expect(sourceChanged.files[0].sourceSha256).not.toBe(measured.files[0].sourceSha256);
    expect(
      measureProductionPredicateObligations([
        { file: 'moved/a-classifier.ts', source: `const NAMES = ['a', 'b'];` },
        { file: 'z-classifier.ts', source: `if (name === 'z') accept();` },
      ]).scopeFiles,
    ).not.toEqual(measured.scopeFiles);
    expect(compareSnapshot(measured, { ...measured, rowsSha256: '0'.repeat(64) })).toEqual([
      'deterministic convergence snapshot drifted',
    ]);
    expect(
      compareSnapshot(measured, {
        ...measured,
        files: [
          { ...measured.files[0], namedInventorySha256: '0'.repeat(64) },
          ...measured.files.slice(1),
        ],
      }),
    ).toEqual(['deterministic convergence snapshot drifted']);
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
