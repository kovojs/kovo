import { describe, expect, it } from 'vitest';

import {
  assertPackedVerifierManifest,
  assertVerifierReportFindingParity,
  findingsFromHumanVerifierReport,
} from './check-packed-verifier-consumer.mjs';

const manifest = {
  name: '@kovojs/verify',
  version: '0.2.0',
  bin: { 'kovo-verify': './dist/bin.mjs' },
  exports: {
    '.': {
      default: './dist/index.mjs',
      types: './dist/index.d.mts',
    },
  },
};

describe('packed standalone verifier consumer gate', () => {
  it('requires a self-contained packed manifest', () => {
    expect(() => assertPackedVerifierManifest(manifest)).not.toThrow();
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      expect(() =>
        assertPackedVerifierManifest({
          ...manifest,
          [field]: { '@kovojs/server': '0.2.0' },
        }),
      ).toThrow(new RegExp(`packed ${field} must be empty`, 'u'));
    }
  });

  it('parses human findings and requires exact JSON parity', () => {
    const human =
      'kovo-verify/v1 FAIL artifacts=1 edges=0 roots=0 doors=0 opaque=0 capabilities=0 findings=1\n' +
      'STABILITY local-capability-missing module imports filesystem\n';
    const findings = [
      {
        code: 'local-capability-missing',
        message: 'module imports filesystem',
        obligation: 'stability',
      },
    ];
    expect(findingsFromHumanVerifierReport(human)).toEqual(findings);
    expect(
      assertVerifierReportFindingParity(
        human,
        `${JSON.stringify({
          diagnostics: findings.map(({ code, message }) => ({
            category: 'proof',
            code,
            help: 'rerun',
            message,
            severity: 'error',
            version: 'kovo-diagnostic/v1',
          })),
          result: {
            command: 'verify',
            exitCode: 1,
            findings,
            ok: false,
            protocol: 'kovo.verify-report/v1',
            schema: 'kovo.verify-report/v1',
            stats: {
              artifacts: 1,
              capabilities: 0,
              doors: 0,
              edges: 0,
              opaque: 0,
              roots: 0,
            },
            status: 'findings',
            text: human,
          },
          version: 'kovo-diagnostic/v1',
        })}\n`,
      ),
    ).toMatchObject({ findings, ok: false });
    expect(() =>
      assertVerifierReportFindingParity(
        human,
        JSON.stringify({
          diagnostics: [],
          result: {
            command: 'verify',
            exitCode: 1,
            findings,
            ok: false,
            protocol: 'kovo.verify-report/v1',
            schema: 'kovo.verify-report/v1',
            stats: {
              artifacts: 1,
              capabilities: 0,
              doors: 0,
              edges: 0,
              opaque: 0,
              roots: 0,
            },
            status: 'findings',
            text: human,
          },
          version: 'kovo-diagnostic/v1',
        }),
      ),
    ).toThrow(/different findings/u);
  });
});
