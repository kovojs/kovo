import { describe, expect, it } from 'vitest';

import { diagnosticDefinitions } from '@kovojs/core';
import { csrfField, csrfToken, domain, mutation, query, s } from '@kovojs/server';

import { createKovoTestHarness } from './harness.js';
import { createDbVerifier } from './verifier.js';
import {
  createVerificationFakeDb,
  verificationLayerBehaviorFact,
  verificationLayerKovoCheckDiagnosticsFact,
} from './verification-fixtures.js';

describe('@kovojs/test verification fixtures', () => {
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
        createKovoTestHarness,
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
        KV402: 'Write touched an undeclared domain.',
        KV404: 'Write to unmapped table.',
        KV407: 'Query read from undeclared domain.',
        KV408: 'Declared row key differs from observed row predicate.',
        KV410: 'Query result shape failed declared output schema.',
        KV411: 'Query read set includes an exempt table.',
      },
      failures: {
        exemptRawSql: 'KV411 Query read set includes an exempt table: audit_log',
        exemptRead: 'KV411 Query read set includes an exempt table: audit_log',
        invalidOutput:
          'KV410 Query result shape failed declared output schema: product/list Expected string',
        missingNestedRead: 'KV407 Query read from undeclared domain: price, price',
        rowKey:
          'KV408 Declared row key differs from observed row predicate: products expected id observed sku',
        selectSubqueryMissingRead: 'KV407 Query read from undeclared domain: price',
        undeclaredRead: 'KV407 Query read from undeclared domain: product',
        unmappedWrite: 'KV404 Write to unmapped table: unknown_table',
        writeOutsideGraph: 'KV402 Write touched an undeclared domain: audit',
      },
      harness: {
        validOutputQuery: { count: 2 },
        writeMutation: { changes: [], ok: true, rerunQueries: [], value: 'p1' },
      },
      pglite: {
        rawMutationFailure: 'KV402 Write touched an undeclared domain: audit',
        transactionFailure: 'KV402 Write touched an undeclared domain: audit',
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

  it('projects kovo-check verification diagnostics into a structured public fact', () => {
    const fact = verificationLayerKovoCheckDiagnosticsFact({
      diagnosticDefinitions,
      kovoCheck(graph) {
        const diagnostics = [
          ...(Array.isArray(graph.diagnostics) ? graph.diagnostics : []),
          ...(Array.isArray(graph.verificationDiagnostics) ? graph.verificationDiagnostics : []),
        ] as Array<{ code?: string; site?: string; start?: { column?: number; line?: number } }>;
        return {
          exitCode: diagnostics.length > 0 ? 1 : 0,
          output: [
            'kovo-check/v1',
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
      KV402: 'Write touched an undeclared domain.',
      KV403: 'Declared domain was never observed written.',
      KV404: 'Write to unmapped table.',
      KV405: 'Conditional write branch was never executed under instrumentation.',
      KV407: 'Query read from undeclared domain.',
      KV408: 'Declared row key differs from observed row predicate.',
      KV410: 'Query result shape failed declared output schema.',
      KV411: 'Query read set includes an exempt table.',
    });
    expect(fact.verificationDiagnostics).toMatchObject({
      diagnostics: [
        { code: 'KV410', severity: 'ERROR', target: 'cart.queries.ts:5' },
        { code: 'KV302', severity: 'ERROR', target: 'cart-badge.tsx:3:23' },
        { code: 'KV405', severity: 'ERROR', target: 'cart.domain.ts:2' },
        { code: 'KV402', severity: 'ERROR', target: 'domain:test' },
        { code: 'KV403', severity: 'ERROR', target: 'domain:test' },
        { code: 'KV404', severity: 'ERROR', target: 'domain:test' },
        { code: 'KV407', severity: 'ERROR', target: 'cart.queries.ts:7' },
        { code: 'KV408', severity: 'ERROR', target: 'product.domain.ts:9' },
        { code: 'KV410', severity: 'ERROR', target: 'cart.queries.ts:11' },
      ],
      exitCode: 1,
      status: 'issues',
      version: 'kovo-check/v1',
    });
    expect(fact.exemptTableDiagnostic).toMatchObject({
      diagnostics: [{ code: 'KV411', severity: 'ERROR', target: 'cart.queries.ts:9' }],
      exitCode: 1,
      status: 'issues',
      version: 'kovo-check/v1',
    });
  });
});
