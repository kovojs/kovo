import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  REQUIRED_DIALECT_MATRIX_DIALECTS,
  REQUIRED_DIALECT_MATRIX_SINKS,
  REQUIRED_RESOLVER_EXPRESSION_KINDS,
  evaluateFundamentalFixesCensus,
  extractPlanCensusRows,
  loadCensusManifest,
} from './fundamental-fixes-census-gate.mjs';

const planText = readFileSync('plans/fundamental-fixes-followup.md', 'utf8');

describe('fundamental-fixes-census-gate', () => {
  it('extracts the M4 sink and handle denominator from the active plan', () => {
    const rows = extractPlanCensusRows(planText);

    expect(rows.filter((row) => row.kind === 'write-capable-handle')).toHaveLength(6);
    expect(rows.filter((row) => row.kind === 'output-wire-sink')).toHaveLength(10);
    expect(rows.map((row) => row.id)).toContain(
      'unknown-future-drizzle-method-or-driver-dialect-fails-closed-by-default-not-a-matrix-update',
    );
    expect(
      rows.find((row) => row.id === 'raw-html-sinks-trustedhtml-trustedurl-internal-renderedhtml')
        ?.owner,
    ).toEqual(['C2', 'B3']);
  });

  it('keeps the default manifest structurally valid without falsely claiming completion', () => {
    const report = evaluateFundamentalFixesCensus({
      manifest: loadCensusManifest(),
      planText,
    });

    expect(report.ok).toBe(true);
    expect(report.complete).toBe(false);
    expect(report.denominator).toEqual({
      dialectMatrixRows:
        REQUIRED_DIALECT_MATRIX_DIALECTS.length * REQUIRED_DIALECT_MATRIX_SINKS.length,
      outputWireSinkRows: 10,
      resolverExpressionKindRows: REQUIRED_RESOLVER_EXPRESSION_KINDS.length,
      writeCapableHandleRows: 6,
    });
    expect(report.openRows).toHaveLength(report.rowCount);
  });

  it('rejects missing owner/status/evidence placeholders and M5-deferring statuses', () => {
    const missing = cloneDefaultManifest();
    delete missing.rows[0].owner;
    delete missing.rows[0].status;
    delete missing.rows[0].evidence;

    expect(evaluateFundamentalFixesCensus({ manifest: missing, planText }).violations).toEqual(
      expect.arrayContaining([
        'readonlydb-read-only-loader-endpoint-handle-6-call-sites-bugz-25-b1: census row is missing owner',
        'readonlydb-read-only-loader-endpoint-handle-6-call-sites-bugz-25-b1: census row is missing status',
        'readonlydb-read-only-loader-endpoint-handle-6-call-sites-bugz-25-b1: census row is missing evidence placeholder',
      ]),
    );

    const deferred = cloneDefaultManifest();
    deferred.rows[0].status = 'future';

    expect(evaluateFundamentalFixesCensus({ manifest: deferred, planText }).violations).toContain(
      'readonlydb-read-only-loader-endpoint-handle-6-call-sites-bugz-25-b1: M5 forbids status "future"',
    );
  });

  it('fails when the manifest drifts away from plan rows or M4 matrix rows', () => {
    const missingPlanRow = cloneDefaultManifest();
    missingPlanRow.rows = missingPlanRow.rows.filter((row) => row.id !== 'ssr-document-html');

    expect(
      evaluateFundamentalFixesCensus({ manifest: missingPlanRow, planText }).violations,
    ).toContain(
      'scripts/fundamental-fixes-census.manifest.json: missing manifest row for output-wire-sink plan row ssr-document-html',
    );

    const missingMatrixRow = cloneDefaultManifest();
    missingMatrixRow.rows = missingMatrixRow.rows.filter(
      (row) => row.id !== 'dialect-pglite-execute',
    );

    expect(
      evaluateFundamentalFixesCensus({ manifest: missingMatrixRow, planText }).violations,
    ).toContain(
      'scripts/fundamental-fixes-census.manifest.json: missing dialect x sink matrix row pglite/execute',
    );
  });

  it('requires M1 prod artifact, supported dialects, and independent reviewer for closed rows', () => {
    const closedWithoutM1 = cloneDefaultManifest();
    closedWithoutM1.rows[0] = {
      ...closedWithoutM1.rows[0],
      evidence: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
      status: 'closed',
    };

    expect(
      evaluateFundamentalFixesCensus({ manifest: closedWithoutM1, planText }).violations,
    ).toContain(
      'readonlydb-read-only-loader-endpoint-handle-6-call-sites-bugz-25-b1: closed row is missing M1 adversarial evidence',
    );

    const closedWithM1 = cloneDefaultManifest();
    closedWithM1.rows[0] = {
      ...closedWithM1.rows[0],
      evidence: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
      m1: {
        dialects: {
          postgres: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
          sqlite: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
        },
        independentReviewer: 'agent/followup-reviewer@abc123',
        prodArtifact: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
      },
      status: 'closed',
    };

    expect(
      evaluateFundamentalFixesCensus({ manifest: closedWithM1, planText }).violations.filter(
        (violation) =>
          violation.startsWith(
            'readonlydb-read-only-loader-endpoint-handle-6-call-sites-bugz-25-b1:',
          ),
      ),
    ).toEqual([]);
  });

  it('has a separate completion mode that fails while denominator rows remain open', () => {
    const report = evaluateFundamentalFixesCensus({
      manifest: loadCensusManifest(),
      planText,
      requireComplete: true,
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toContain(
      'readonlydb-read-only-loader-endpoint-handle-6-call-sites-bugz-25-b1: M4 completion requires status "closed"',
    );
  });
});

function cloneDefaultManifest() {
  return JSON.parse(JSON.stringify(loadCensusManifest()));
}
