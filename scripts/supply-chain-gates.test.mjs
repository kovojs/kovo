import { describe, expect, it } from 'vitest';

import {
  parsePnpmAuditResult,
  parseAuditFindings,
  verifyBuildScriptPolicy,
  verifyNpmPublishAuthority,
} from './supply-chain-gates.mjs';

function advisory(id, severity, moduleName = `module-${id}`) {
  return {
    id,
    github_advisory_id: `GHSA-${id}`,
    module_name: moduleName,
    severity,
    findings: [{ version: '1.0.0', paths: [`root>${moduleName}`] }],
  };
}

function auditReport(rows = []) {
  const vulnerabilities = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const row of rows) vulnerabilities[row.severity] += 1;
  return {
    actions: [],
    advisories: Object.fromEntries(rows.map((row) => [String(row.id), row])),
    muted: [],
    metadata: {
      vulnerabilities,
      dependencies: 3,
      devDependencies: 0,
      optionalDependencies: 1,
      totalDependencies: 4,
    },
  };
}

function commandResult(status, report) {
  return { status, signal: null, error: undefined, stdout: JSON.stringify(report), stderr: '' };
}

describe('supply-chain gates', () => {
  it('accepts exact pnpm 10 zero and nonzero advisory reports', () => {
    const zero = parsePnpmAuditResult(commandResult(0, auditReport()));
    expect(parseAuditFindings(zero, 'moderate')).toEqual([]);

    const audit = parsePnpmAuditResult(
      commandResult(
        1,
        auditReport([
          advisory(101, 'low', 'low-only'),
          advisory(102, 'moderate', 'moderate-finding'),
          advisory(103, 'critical', 'critical-finding'),
        ]),
      ),
    );
    expect(parseAuditFindings(audit, 'moderate').map((finding) => finding.module_name)).toEqual([
      'moderate-finding',
      'critical-finding',
    ]);
    expect(parseAuditFindings(audit, 'critical').map((finding) => finding.module_name)).toEqual([
      'critical-finding',
    ]);
  });

  it('rejects execution errors and exit/report mismatches', () => {
    expect(() =>
      parsePnpmAuditResult(commandResult(1, { error: { code: 'ERR_INVALID_URL' } })),
    ).toThrow('pnpm audit output');
    expect(() =>
      parsePnpmAuditResult({
        status: null,
        signal: 'SIGTERM',
        error: new Error('timed out'),
        stdout: '',
        stderr: '',
      }),
    ).toThrow('pnpm audit execution failed');
    expect(() => parsePnpmAuditResult(commandResult(2, auditReport()))).toThrow(
      'unexpected status 2',
    );
    expect(() => parsePnpmAuditResult(commandResult(1, auditReport()))).toThrow(
      'status 1 disagrees',
    );
    expect(() =>
      parsePnpmAuditResult(commandResult(0, auditReport([advisory(101, 'low')]))),
    ).toThrow('status 0 disagrees');
  });

  it('rejects malformed, surplus, muted, and count-inconsistent report shapes', () => {
    const missing = auditReport();
    delete missing.metadata;
    expect(() => parsePnpmAuditResult(commandResult(0, missing))).toThrow('top-level keys');

    expect(() =>
      parsePnpmAuditResult(commandResult(0, { ...auditReport(), unexpected: true })),
    ).toThrow('top-level keys');
    expect(() =>
      parsePnpmAuditResult(commandResult(0, { ...auditReport(), advisories: [] })),
    ).toThrow('advisories must be an object');
    expect(() => parsePnpmAuditResult(commandResult(0, { ...auditReport(), muted: [{}] }))).toThrow(
      'muted advisories',
    );

    const unknownMetadataSeverity = auditReport();
    unknownMetadataSeverity.metadata.vulnerabilities.urgent = 0;
    expect(() => parsePnpmAuditResult(commandResult(0, unknownMetadataSeverity))).toThrow(
      'metadata.vulnerabilities keys',
    );

    const inconsistentCount = auditReport([advisory(101, 'high')]);
    inconsistentCount.metadata.vulnerabilities.high = 2;
    expect(() => parsePnpmAuditResult(commandResult(1, inconsistentCount))).toThrow(
      'metadata vulnerability counts disagree',
    );
  });

  it('rejects malformed advisory identities, rows, paths, and severities', () => {
    const mismatchedId = auditReport([advisory(101, 'high')]);
    mismatchedId.advisories['101'].id = 102;
    expect(() => parsePnpmAuditResult(commandResult(1, mismatchedId))).toThrow('advisory 101 id');

    const missingModule = auditReport([advisory(101, 'high')]);
    missingModule.advisories['101'].module_name = '';
    expect(() => parsePnpmAuditResult(commandResult(1, missingModule))).toThrow('module_name');

    const malformedPaths = auditReport([advisory(101, 'high')]);
    malformedPaths.advisories['101'].findings[0].paths = [];
    expect(() => parsePnpmAuditResult(commandResult(1, malformedPaths))).toThrow('paths');

    const unknownSeverity = auditReport([advisory(101, 'high')]);
    unknownSeverity.advisories['101'].severity = 'urgent';
    expect(() => parsePnpmAuditResult(commandResult(1, unknownSeverity))).toThrow(
      'unknown severity',
    );
  });

  it('enforces the approved build-script and lifecycle policy', () => {
    expect(() =>
      verifyBuildScriptPolicy(
        { pnpm: { onlyBuiltDependencies: ['@node-rs/argon2', 'better-sqlite3'] } },
        [{ name: '@kovojs/core', scripts: { 'build:dist': 'vp pack src/index.ts --dts' } }],
      ),
    ).not.toThrow();

    expect(() =>
      verifyBuildScriptPolicy({ pnpm: { onlyBuiltDependencies: ['better-sqlite3', 'esbuild'] } }, [
        { name: '@kovojs/core', scripts: {} },
      ]),
    ).toThrow('pnpm.onlyBuiltDependencies');

    expect(() =>
      verifyBuildScriptPolicy(
        { pnpm: { onlyBuiltDependencies: ['@node-rs/argon2', 'better-sqlite3'] } },
        [{ name: '@kovojs/core', scripts: { postinstall: 'node install.js' } }],
      ),
    ).toThrow('Unapproved lifecycle scripts');
  });

  it('keeps npm mutation authority confined to the attested publisher', () => {
    const publisher = {
      path: 'scripts/publish-packed-packages.mjs',
      text: `exec(releaseNpmExecutable(), ['publish', tarball])`,
    };
    expect(() => verifyNpmPublishAuthority([publisher])).not.toThrow();
    expect(() =>
      verifyNpmPublishAuthority([
        publisher,
        {
          path: 'scripts/alternate-publisher.mjs',
          text: `execFileSync('npm', ['publish', '--access', 'public'])`,
        },
      ]),
    ).toThrow('npm publish authority must be exactly');
    expect(() =>
      verifyNpmPublishAuthority([
        publisher,
        {
          path: '.github/actions/kovo-release-node/action.yml',
          text: `run: npm publish attacker.tgz`,
        },
      ]),
    ).toThrow('npm publish authority must be exactly');
    expect(() => verifyNpmPublishAuthority([])).toThrow('npm publish authority must be exactly');
    expect(() =>
      verifyNpmPublishAuthority([
        {
          path: 'scripts/publish-packed-packages.mjs',
          text: `exec(process.env.NPM, ['publish', tarball])`,
        },
      ]),
    ).toThrow('checksum-bound npm authority');
  });
});
