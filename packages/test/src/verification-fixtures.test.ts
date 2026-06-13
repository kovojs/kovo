import { describe, expect, it } from 'vitest';

import { diagnosticDefinitions } from '@jiso/core';
import { csrfField, csrfToken, domain, mutation, query, s } from '@jiso/server';

import { createJisoTestHarness } from './harness.js';
import { createDbVerifier } from './verifier.js';
import {
  createVerificationFakeDb,
  verificationLayerBehaviorFact,
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
});
