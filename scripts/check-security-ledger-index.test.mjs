import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  defaultRepoRoot,
  securityLedgerSchema,
  transientLedgerMarker,
  validateSecurityLedgerIndex,
} from './check-security-ledger-index.mjs';

describe('security-ledger index gate', () => {
  it('accepts the checked-in explicit registry at its reconciliation date', () => {
    expect(
      validateSecurityLedgerIndex({ rootDir: defaultRepoRoot, today: '2026-07-18' }),
    ).toMatchObject({ ok: true, findings: [] });
  });

  it('allows zero transient ledgers and ignores ledger-like filenames without markers', async () => {
    const { rootDir } = await fixture({ transientLedgers: [] });
    await writeFile(path.join(rootDir, 'plans/bugz-999.md'), '# Historical-looking file\n');
    await writeFile(path.join(rootDir, 'plans/papercuts-999.md'), '# Another file\n');

    expect(validateSecurityLedgerIndex({ rootDir, today: '2026-07-10' })).toMatchObject({
      ok: true,
      findings: [],
    });
  });

  it('allows multiple explicitly registered transient ledgers', async () => {
    const transientLedgers = [
      transientLedger({ path: 'plans/findings-alpha.md', archivePath: 'plans/history/alpha.md' }),
      transientLedger({
        path: 'plans/findings-beta.md',
        archivePath: 'plans/history/beta.md',
        kind: 'papercuts',
      }),
    ];
    const { rootDir } = await fixture({ transientLedgers });

    expect(validateSecurityLedgerIndex({ rootDir, today: '2026-07-10' })).toMatchObject({
      ok: true,
      findings: [],
    });
  });

  it('requires every marked transient ledger to be registered explicitly', async () => {
    const { rootDir } = await fixture({ transientLedgers: [] });
    await writeFile(
      path.join(rootDir, 'plans/custom-findings.md'),
      `# Findings\n\n${transientLedgerMarker}\n`,
    );

    expect(validateSecurityLedgerIndex({ rootDir, today: '2026-07-10' }).findings).toContain(
      'plans/custom-findings.md: transient marker requires registration in transientLedgers',
    );
  });

  it('requires every registered transient ledger to carry the content marker', async () => {
    const ledger = transientLedger();
    const { rootDir } = await fixture({ transientLedgers: [ledger], markedPaths: [] });

    expect(validateSecurityLedgerIndex({ rootDir, today: '2026-07-10' }).findings).toContain(
      `plans/findings.md: registered transient ledger is missing ${transientLedgerMarker}`,
    );
  });

  it('keeps archived ledgers in the dedup scope without treating them as active', async () => {
    const { rootDir } = await fixture({ transientLedgers: [] });
    await mkdir(path.join(rootDir, 'plans/history'), { recursive: true });
    await writeFile(
      path.join(rootDir, 'plans/history/old-findings.md'),
      '# Old findings\n\n<!-- kovo-security-ledger: archived -->\n',
    );

    expect(validateSecurityLedgerIndex({ rootDir, today: '2026-07-10' })).toMatchObject({
      ok: true,
      findings: [],
    });
  });

  it('rejects expired and non-finite-in-practice archive horizons', async () => {
    const expired = transientLedger({ archiveBy: '2026-07-09' });
    const tooLong = transientLedger({
      path: 'plans/long-lived.md',
      archiveBy: '2026-08-15',
      archivePath: 'plans/history/long-lived.md',
    });
    const { rootDir } = await fixture({ transientLedgers: [expired, tooLong] });
    const findings = validateSecurityLedgerIndex({ rootDir, today: '2026-07-10' }).findings;

    expect(findings).toContain(
      'plans/security-ledger-index.json: transientLedgers[0].archiveBy has expired; publish/archive the ledger or extend with review',
    );
    expect(findings).toContain(
      'plans/security-ledger-index.json: transientLedgers[1].archiveBy must be between openedOn and 30 days later',
    );
  });

  it('enforces closure and publication state evidence', async () => {
    const closedWithoutDate = transientLedger({ state: 'closed-pending-publication' });
    const publishedWithoutProof = transientLedger({
      path: 'plans/published.md',
      archivePath: 'plans/history/published.md',
      state: 'published-pending-archive',
      closedOn: '2026-07-08',
    });
    const { rootDir } = await fixture({
      transientLedgers: [closedWithoutDate, publishedWithoutProof],
    });
    const findings = validateSecurityLedgerIndex({ rootDir, today: '2026-07-10' }).findings;

    expect(findings).toContain(
      'plans/security-ledger-index.json: transientLedgers[0].closedOn is required after closure',
    );
    expect(findings).toContain(
      'plans/security-ledger-index.json: transientLedgers[1].publication must record commit, ref, and verifiedOn',
    );
  });

  it('accepts publication proof while the ledger waits for archival', async () => {
    const ledger = transientLedger({
      state: 'published-pending-archive',
      closedOn: '2026-07-08',
      publication: {
        commit: 'abcdef1234567',
        ref: 'origin/main',
        verifiedOn: '2026-07-09',
      },
    });
    const { rootDir } = await fixture({ transientLedgers: [ledger] });

    expect(validateSecurityLedgerIndex({ rootDir, today: '2026-07-10' })).toMatchObject({
      ok: true,
      findings: [],
    });
  });
});

function transientLedger(overrides = {}) {
  return {
    path: 'plans/findings.md',
    kind: 'bugz',
    state: 'open',
    openedOn: '2026-07-01',
    archiveBy: '2026-07-20',
    archivePath: 'plans/history/findings.md',
    summary: 'Fixture findings.',
    ...overrides,
  };
}

async function fixture({ transientLedgers, markedPaths } = {}) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'kovo-security-ledger-index-'));
  await mkdir(path.join(rootDir, 'plans'), { recursive: true });
  await writeFile(path.join(rootDir, 'plans/roadmap.md'), '# Roadmap\n');
  await writeFile(path.join(rootDir, 'plans/history-source.md'), '# History\n');

  const ledgers = transientLedgers ?? [transientLedger()];
  const marked = new Set(markedPaths ?? ledgers.map((ledger) => ledger.path));
  for (const ledger of ledgers) {
    await mkdir(path.dirname(path.join(rootDir, ledger.path)), { recursive: true });
    await writeFile(
      path.join(rootDir, ledger.path),
      `# Findings\n${marked.has(ledger.path) ? `\n${transientLedgerMarker}\n` : ''}`,
    );
  }

  const index = {
    schema: securityLedgerSchema,
    ledgerKinds: {
      bugz: { nextSequence: 2, pathTemplate: 'plans/bugz-{sequence}.md' },
      papercuts: { nextSequence: 2, pathTemplate: 'plans/papercuts-{sequence}.md' },
    },
    activeRoadmaps: [
      { path: 'plans/roadmap.md', role: 'test', summary: 'Fixture active roadmap.' },
    ],
    transientLedgers: ledgers,
    history: {
      dedupRoots: ['plans'],
      series: [
        {
          id: 'history',
          summary: 'Fixture history.',
          representativePaths: ['plans/history-source.md'],
        },
      ],
    },
  };
  await writeFile(
    path.join(rootDir, 'plans/security-ledger-index.json'),
    `${JSON.stringify(index, null, 2)}\n`,
  );
  return { rootDir, index };
}
