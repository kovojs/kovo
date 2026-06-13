import { describe, expect, it } from 'vitest';

import { diagnosticDefinitions } from '@jiso/core';
import { csrfField, csrfToken, domain, mutation, query, s } from '@jiso/server';

import { createJisoTestHarness } from './harness.js';
import { createDbVerifier } from './verifier.js';
import {
  createVerificationFakeDb,
  verificationLayerBehaviorFact,
  verificationLayerFwCheckDiagnosticsFact,
} from './verification-fixtures.js';

describe('@jiso/test verification fixtures', () => {
  it('provides a fake DB fixture for verifier and harness tests', () => {
    const db = createVerificationFakeDb();

    db.write('cart_items', 'p1');

    expect(db.read('cart_items')).toEqual(['p1']);
    expect(db.sql('select * from cart_items')).toEqual([]);
  });

  it('projects verification-layer behavior into a structured public fact', async () => {
    await expect(
      verificationLayerBehaviorFact({
        createDbVerifier,
        createJisoTestHarness,
        csrfField,
        csrfToken,
        diagnosticDefinitions,
        domain,
        mutation,
        query,
        s,
      }),
    ).resolves.toMatchObject({
      csrf: {
        invalidResult: { error: { code: 'CSRF', payload: {} }, ok: false, status: 422 },
        mutationExecutions: 1,
        tokenMatchesField: true,
        validResult: { changes: [], ok: true, rerunQueries: [], value: 'p1' },
      },
      diagnosticMessages: {
        FW402: 'Write touched an undeclared domain.',
        FW404: 'Write to unmapped table.',
        FW407: 'Query read from undeclared domain.',
        FW408: 'Declared row key differs from observed row predicate.',
        FW410: 'Query result shape failed declared output schema.',
        FW411: 'Query read set includes an exempt table.',
      },
      failures: {
        exemptRawSql: 'FW411 Query read set includes an exempt table: audit_log',
        exemptRead: 'FW411 Query read set includes an exempt table: audit_log',
        invalidOutput:
          'FW410 Query result shape failed declared output schema: product/list Expected string',
        missingNestedRead: 'FW407 Query read from undeclared domain: price, price',
        rowKey:
          'FW408 Declared row key differs from observed row predicate: products expected id observed sku',
        selectSubqueryMissingRead: 'FW407 Query read from undeclared domain: price',
        undeclaredRead: 'FW407 Query read from undeclared domain: product',
        unmappedWrite: 'FW404 Write to unmapped table: unknown_table',
        writeOutsideGraph: 'FW402 Write touched an undeclared domain: audit',
      },
      harness: {
        validOutputQuery: { count: 2 },
        writeMutation: { changes: [], ok: true, rerunQueries: [], value: 'p1' },
      },
      pglite: {
        rawMutationFailure: 'FW402 Write touched an undeclared domain: audit',
        transactionFailure: 'FW402 Write touched an undeclared domain: audit',
      },
      sql: {
        compoundRowKeyCovered: true,
        nestedUpdateCovered: true,
        nestedUpdateReadsCovered: true,
        selectSubqueryCoveredWithBothDomains: true,
        structuredStatementForwarded: true,
        structuredStatementObserved: [
          {
            branch: undefined,
            domain: 'cart',
            kind: 'read',
            mutationRead: undefined,
            rowKey: undefined,
            sql: 'select * from cart_items',
            table: 'cart_items',
          },
        ],
      },
      verifier: {
        exemptWriteCovered: true,
      },
    });
  });

  it('projects fw-check verification diagnostics into a structured public fact', () => {
    const fact = verificationLayerFwCheckDiagnosticsFact({
      diagnosticDefinitions,
      fwCheck(graph) {
        const diagnostics = [
          ...(Array.isArray(graph.diagnostics) ? graph.diagnostics : []),
          ...(Array.isArray(graph.verificationDiagnostics) ? graph.verificationDiagnostics : []),
        ] as Array<{ code?: string; site?: string; start?: { column?: number; line?: number } }>;
        return {
          exitCode: diagnostics.length > 0 ? 1 : 0,
          output: [
            'fw-check/v1',
            ...(diagnostics.length > 0 ? [] : ['OK']),
            ...diagnostics.map((diagnostic) => {
              const site =
                diagnostic.site && diagnostic.start?.line && diagnostic.start?.column
                  ? `${diagnostic.site}:${diagnostic.start.line}:${diagnostic.start.column}`
                  : (diagnostic.site ?? 'domain:test');
              return `ERROR ${diagnostic.code ?? 'UNKNOWN'} ${site} ${diagnostic.code ?? 'UNKNOWN'} message`;
            }),
            '',
          ].join('\n'),
        };
      },
    });

    expect(fact.verificationDiagnosticMessages).toMatchObject({
      FW402: 'Write touched an undeclared domain.',
      FW403: 'Declared domain was never observed written.',
      FW404: 'Write to unmapped table.',
      FW405: 'Conditional write branch was never executed under instrumentation.',
      FW407: 'Query read from undeclared domain.',
      FW408: 'Declared row key differs from observed row predicate.',
      FW410: 'Query result shape failed declared output schema.',
      FW411: 'Query read set includes an exempt table.',
    });
    expect(fact.verificationDiagnostics).toMatchObject({
      diagnostics: [
        { code: 'FW410', severity: 'ERROR', target: 'cart.queries.ts:5' },
        { code: 'FW302', severity: 'ERROR', target: 'cart-badge.tsx:3:23' },
        { code: 'FW405', severity: 'ERROR', target: 'cart.domain.ts:2' },
        { code: 'FW402', severity: 'ERROR', target: 'domain:test' },
        { code: 'FW403', severity: 'ERROR', target: 'domain:test' },
        { code: 'FW404', severity: 'ERROR', target: 'domain:test' },
        { code: 'FW407', severity: 'ERROR', target: 'cart.queries.ts:7' },
        { code: 'FW408', severity: 'ERROR', target: 'product.domain.ts:9' },
        { code: 'FW410', severity: 'ERROR', target: 'cart.queries.ts:11' },
      ],
      exitCode: 1,
      status: 'issues',
      version: 'fw-check/v1',
    });
    expect(fact.exemptTableDiagnostic).toMatchObject({
      diagnostics: [{ code: 'FW411', severity: 'ERROR', target: 'cart.queries.ts:9' }],
      exitCode: 1,
      status: 'issues',
      version: 'fw-check/v1',
    });
  });
});
