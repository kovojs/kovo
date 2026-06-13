import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  assertMutationError as rootAssertMutationError,
  createDbVerifier as rootCreateDbVerifier,
  createJisoTestHarness as rootCreateJisoTestHarness,
  createPgliteTestDb as rootCreatePgliteTestDb,
  jisoTest as rootJisoTest,
  propertyTest as rootPropertyTest,
} from '@jiso/test';
import {
  assertMutationError,
  propertyTest,
  type MutationErrorExpectation,
  type PropertyTestOptions,
  type PropertyTestResult,
} from '@jiso/test/assertions';
import {
  createJisoTestHarness,
  type JisoTestContext,
  type JisoTestExecOptions,
  type JisoTestHarnessOptions,
  type JisoTestRequest,
} from '@jiso/test/harness';
import {
  executeHarnessMutation,
  executeHarnessQuery,
  loadHarnessPage,
  type HarnessMutationOptions,
  type HarnessOperationVerifier,
} from '@jiso/test/harness-operations';
import {
  fragmentHtml,
  fwFragmentFacts,
  fwQueryFacts,
  htmlElementFacts,
  htmlFormFacts,
  htmlKeyFacts,
  htmlTextContent,
} from '@jiso/test/html-fragment';
import { createPageAssertion, type PageAssertion } from '@jiso/test/page';
import { createPgliteTestDb, type PgliteTestDb } from '@jiso/test/pglite';
import {
  observeSqlStatementArgument,
  observeSqlStatementIfString,
  sqlStatementText,
} from '@jiso/test/sql-observer';
import { jisoTest, type JisoTestCase, type JisoTestRunner } from '@jiso/test/test-case';
import {
  createDbVerifier,
  type DbObservationOptions,
  type DbVerificationConfig,
  type DbVerificationDiagnostic,
  type DbVerifier,
  type ObservedDbOperation,
} from '@jiso/test/verifier';
import {
  diagnosticMessage,
  diagnosticsForObservations,
  type DiagnosticCode,
  type DbVerificationDiagnostic as DirectDbVerificationDiagnostic,
} from '@jiso/test/verifier-diagnostics';
import { parseSqlOperations, type ParsedSqlOperation } from '@jiso/test/verifier-sql';
import type { DiagnosticCode as RootDiagnosticCode } from '@jiso/test';

describe('@jiso/test package subpath exports', () => {
  it('resolves seam-specific public modules alongside the root barrel', () => {
    expect(createJisoTestHarness).toBe(rootCreateJisoTestHarness);
    expect(assertMutationError).toBe(rootAssertMutationError);
    expect(propertyTest).toBe(rootPropertyTest);
    expect(createPgliteTestDb).toBe(rootCreatePgliteTestDb);
    expect(jisoTest).toBe(rootJisoTest);
    expect(createDbVerifier).toBe(rootCreateDbVerifier);
  });

  it('keeps subpath-only helpers available through their owning modules', () => {
    expect(createPageAssertion('<main id="cart">Cart</main>').fragment('cart')).toBe(
      '<main id="cart">Cart</main>',
    );
    expect(
      fragmentHtml('<fw-fragment target="cart"><cart-badge>1</cart-badge></fw-fragment>', 'cart'),
    ).toBe('<cart-badge>1</cart-badge>');
    expect(
      htmlElementFacts('<a href="/cart">Cart</a>', { attrs: { href: '/cart' }, tag: 'a' }),
    ).toMatchObject([{ innerHtml: 'Cart', tag: 'a' }]);
    expect(fwQueryFacts('<fw-query name="cart">{"count":1}</fw-query>', 'cart')).toMatchObject([
      { json: { count: 1 }, name: 'cart' },
    ]);
    expect(
      fwFragmentFacts(
        '<fw-fragment target="cart"><link rel="stylesheet" href="/assets/tailwind.css"></fw-fragment>',
        'cart',
      ),
    ).toMatchObject([{ stylesheetHrefs: ['/assets/tailwind.css'], target: 'cart' }]);
    expect(
      htmlFormFacts(
        '<form method="post" action="/_m/cart/add"><input name="productId" value="p1"></form>',
      ),
    ).toMatchObject([{ action: '/_m/cart/add', fields: [{ name: 'productId', value: 'p1' }] }]);
    expect(htmlKeyFacts('<li fw-key="order-1"><span>Order</span></li>', 'order-1')).toMatchObject([
      { key: 'order-1', text: 'Order' },
    ]);
    expect(htmlTextContent('<p>Cart &amp; checkout</p>')).toBe('Cart & checkout');
    expect(diagnosticMessage('FW403', 'cart_items')).toContain('cart_items');
    expect(diagnosticsForObservations([], {})).toEqual([]);
    expect(executeHarnessMutation).toBeTypeOf('function');
    expect(executeHarnessQuery).toBeTypeOf('function');
    expect(loadHarnessPage).toBeTypeOf('function');
    expect(observeSqlStatementArgument).toBeTypeOf('function');
    expect(observeSqlStatementIfString).toBeTypeOf('function');
    expect(sqlStatementText({ text: 'select * from cart_items' })).toBe('select * from cart_items');
    expect(parseSqlOperations('select * from cart_items')).toEqual([
      {
        kind: 'read',
        mutationRead: undefined,
        rowKey: undefined,
        table: 'cart_items',
      },
    ]);
  });

  it('keeps harness exec options on the operation module surface', () => {
    expectTypeOf<JisoTestExecOptions<JisoTestRequest<{ cart: string[] }>>>().toEqualTypeOf<
      HarnessMutationOptions<JisoTestRequest<{ cart: string[] }>>
    >();
    expectTypeOf<DiagnosticCode>().toEqualTypeOf<RootDiagnosticCode>();
  });
});

type _PublicSubpathTypes = [
  MutationErrorExpectation<Record<'invalid', { parse(value: unknown): unknown }>, 'invalid'>,
  PropertyTestOptions<{ count: number }, { by: number }>,
  PropertyTestResult,
  JisoTestContext<{ cart: string[] }>,
  JisoTestExecOptions<JisoTestRequest<{ cart: string[] }>>,
  JisoTestHarnessOptions<{ cart: string[] }>,
  JisoTestRequest<{ cart: string[] }>,
  PageAssertion,
  PgliteTestDb,
  JisoTestCase,
  JisoTestRunner,
  HarnessMutationOptions<JisoTestRequest<{ cart: string[] }>>,
  HarnessOperationVerifier,
  ParsedSqlOperation,
  DbObservationOptions,
  DbVerificationConfig,
  DbVerificationDiagnostic,
  DirectDbVerificationDiagnostic,
  DbVerifier,
  ObservedDbOperation,
];
