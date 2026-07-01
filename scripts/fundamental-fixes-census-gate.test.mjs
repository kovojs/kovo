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

    expect(rows.filter((row) => row.kind === 'write-capable-handle')).toHaveLength(23);
    expect(rows.filter((row) => row.kind === 'output-wire-sink')).toHaveLength(39);
    expect(rows.map((row) => row.id)).toContain(
      'unknown-future-drizzle-method-or-driver-dialect-fails-closed-by-default-not-a-matrix-update',
    );
    expect(rows.map((row) => row.id)).toContain(
      'direct-secret-projection-to-query-wire-fails-kv435-in-every-supported-dialect',
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
      outputWireSinkRows: 39,
      resolverExpressionKindRows: REQUIRED_RESOLVER_EXPRESSION_KINDS.length,
      writeCapableHandleRows: 23,
    });
    expect(report.openRows).toHaveLength(report.rowCount - 3);
    expect(report.openRows).not.toContain(
      'kv426-blocks-trustedhtml-request-taint-in-a-prod-artifact',
    );
    expect(report.openRows).not.toContain('kv426-blocks-trustedurl-query-taint-in-a-prod-artifact');
    expect(report.openRows).not.toContain(
      'kv426-blocks-internal-renderedhtml-query-taint-in-a-prod-artifact',
    );
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

    const missingBundle = cloneDefaultManifest();
    missingBundle.rows[1].evidenceBundles = ['missing-bundle'];

    expect(
      evaluateFundamentalFixesCensus({ manifest: missingBundle, planText }).violations,
    ).toContain(
      'readonlydb-raw-sql-methods-all-get-values-fail-closed-at-runtime: references missing evidence bundle missing-bundle',
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

  it('requires every resolver expression-kind row to have a B3 status and coverage expectation', () => {
    const blankResolverCell = cloneDefaultManifest();
    const resolverRow = blankResolverCell.rows.find(
      (row) => row.kind === 'resolver-expression-kind',
    );
    delete resolverRow.resolverStatus;
    resolverRow.coverageExpectation = 'todo';

    expect(
      evaluateFundamentalFixesCensus({ manifest: blankResolverCell, planText }).violations,
    ).toEqual(
      expect.arrayContaining([
        `${resolverRow.id}: resolverStatus must be one of resolved, fails-closed`,
        `${resolverRow.id}: resolver row is missing coverageExpectation`,
      ]),
    );
  });

  it('requires M1, M2, and M3 evidence for closed rows', () => {
    const rowId = 'readonlydb-raw-sql-methods-all-get-values-fail-closed-at-runtime';
    const closedPlanText = planText.replace(
      '  - [ ] `readonlyDb()` raw SQL methods (`.all/.get/.values`) fail closed at runtime [H]',
      '  - [x] `readonlyDb()` raw SQL methods (`.all/.get/.values`) fail closed at runtime [H]',
    );
    const closedWithoutM1 = cloneDefaultManifest();
    const rowIndex = closedWithoutM1.rows.findIndex((row) => row.id === rowId);
    closedWithoutM1.rows[rowIndex] = {
      ...closedWithoutM1.rows[rowIndex],
      evidence: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
      status: 'closed',
    };

    expect(
      evaluateFundamentalFixesCensus({ manifest: closedWithoutM1, planText: closedPlanText })
        .violations,
    ).toContain(`${rowId}: closed row is missing M1 adversarial evidence`);

    const closedWithOnlyM1 = cloneDefaultManifest();
    closedWithOnlyM1.rows[rowIndex] = {
      ...closedWithOnlyM1.rows[rowIndex],
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
      evaluateFundamentalFixesCensus({ manifest: closedWithOnlyM1, planText: closedPlanText })
        .violations,
    ).toEqual(
      expect.arrayContaining([
        `${rowId}: closed row is missing M2 real-build evidence`,
        `${rowId}: closed row is missing M3 mutation evidence`,
      ]),
    );

    const closedWithAllEvidence = cloneDefaultManifest();
    closedWithAllEvidence.rows[rowIndex] = {
      ...closedWithOnlyM1.rows[rowIndex],
      m2: {
        noFixtureOnlyCertification: 'pnpm run check:security-test-builds',
        productionBuild: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
      },
      m3: {
        mutationGate: 'pnpm run check:security-gate-mutations',
      },
    };

    expect(
      evaluateFundamentalFixesCensus({
        manifest: closedWithAllEvidence,
        planText: closedPlanText,
      }).violations.filter((violation) => violation.startsWith(`${rowId}:`)),
    ).toEqual([]);
  });

  it('keeps parent rollup rows open until every child row closes', () => {
    const parentId = 'readonlydb-read-only-loader-endpoint-handle-6-call-sites-bugz-25-b1';
    const manifest = cloneDefaultManifest();
    const parentIndex = manifest.rows.findIndex((row) => row.id === parentId);
    manifest.rows[parentIndex] = {
      ...manifest.rows[parentIndex],
      evidence: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
      m1: {
        dialects: {
          postgres: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
          sqlite: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
        },
        independentReviewer: 'agent/followup-reviewer@abc123',
        prodArtifact: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
      },
      m2: {
        noFixtureOnlyCertification: 'pnpm run check:security-test-builds',
        productionBuild: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
      },
      m3: {
        mutationGate: 'pnpm run check:security-gate-mutations',
      },
      status: 'closed',
    };

    const closedPlanText = planText.replace(
      '- [ ] `readonlyDb()` read-only loader/endpoint handle (×6 call sites) — `bugz-25` B1 [H]',
      '- [x] `readonlyDb()` read-only loader/endpoint handle (×6 call sites) — `bugz-25` B1 [H]',
    );

    expect(
      evaluateFundamentalFixesCensus({ manifest, planText: closedPlanText }).violations,
    ).toContain(
      `${parentId}: parent row cannot close while child row readonlydb-raw-sql-methods-all-get-values-fail-closed-at-runtime is open`,
    );
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
