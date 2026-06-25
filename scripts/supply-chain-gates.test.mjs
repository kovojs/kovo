import { describe, expect, it } from 'vitest';

import { parseAuditFindings, verifyBuildScriptPolicy } from './supply-chain-gates.mjs';

describe('supply-chain gates', () => {
  it('allows low production advisories while failing the configured severity floor', () => {
    const audit = {
      vulnerabilities: {
        a: { name: 'low-only', severity: 'low' },
        b: { name: 'moderate-finding', severity: 'moderate' },
        c: { name: 'critical-finding', severity: 'critical' },
      },
    };

    expect(parseAuditFindings(audit, 'moderate').map((finding) => finding.name)).toEqual([
      'moderate-finding',
      'critical-finding',
    ]);
    expect(parseAuditFindings(audit, 'critical').map((finding) => finding.name)).toEqual([
      'critical-finding',
    ]);
  });

  it('enforces the approved build-script and lifecycle policy', () => {
    expect(() =>
      verifyBuildScriptPolicy(
        { pnpm: { onlyBuiltDependencies: ['better-sqlite3'] } },
        [{ name: '@kovojs/core', scripts: { 'build:dist': 'vp pack src/index.ts --dts' } }],
      ),
    ).not.toThrow();

    expect(() =>
      verifyBuildScriptPolicy(
        { pnpm: { onlyBuiltDependencies: ['better-sqlite3', 'esbuild'] } },
        [{ name: '@kovojs/core', scripts: {} }],
      ),
    ).toThrow('pnpm.onlyBuiltDependencies');

    expect(() =>
      verifyBuildScriptPolicy(
        { pnpm: { onlyBuiltDependencies: ['better-sqlite3'] } },
        [{ name: '@kovojs/core', scripts: { postinstall: 'node install.js' } }],
      ),
    ).toThrow('Unapproved lifecycle scripts');
  });
});
