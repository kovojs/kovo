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
  assertOrderedItems,
  commandSequence,
  loadVitePlusConfig,
  nodeTaskCommand,
  pnpmFilterTestCommands,
  pnpmRunScriptNames,
  requiredVpRunTaskName,
  runCommandSequenceSync,
  vitestTaskCommand,
  vpRunTaskName,
  workflowVpRunTaskNames,
  workflowStepCommands,
  type CommandInvocation,
  type NodeTaskCommand,
  type PnpmFilterTestCommand,
  type VitestTaskCommand,
  type VitePlusConfig,
  type VitePlusTask,
  type WorkflowStepCommand,
} from '@jiso/test/command-fixtures';
import {
  parseFwExportOutput,
  type FwExportError,
  type FwExportHtmlArtifact,
  type FwExportOutput,
  type FwExportSummary,
} from '@jiso/test/fw-export-fixtures';
import {
  fwExplainField,
  fwExplainRecords,
  fwExplainSummary,
  fwExplainUpdateTargets,
  parseFwExplainOutput,
  type FwExplainOutput,
} from '@jiso/test/fw-explain-fixtures';
import {
  executeGeneratedBootstrapModule,
  executeGeneratedClientModule,
  executeGeneratedServerRenderSource,
  GeneratedFixtureElement,
  GeneratedFixtureMorphRoot,
  GeneratedFixtureMorphTarget,
  GeneratedFixtureTemplateStampHost,
} from '@jiso/test/generated-module-fixtures';
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
  htmlDocumentFacts,
  htmlDocumentRegions,
  htmlElementFacts,
  htmlFormActions,
  htmlFormFacts,
  htmlFormFields,
  htmlJsonScriptFacts,
  htmlKeyFacts,
  htmlLinkHrefs,
  htmlTextContent,
} from '@jiso/test/html-fragment';
import {
  markdownFields,
  markdownLeadingTitle,
  markdownNumberedListItems,
  markdownNumberedListTitles,
  markdownSection,
  markdownTableRows,
  normalizeMarkdownCell,
  type MarkdownFields,
  type MarkdownTableRow,
} from '@jiso/test/markdown-fixtures';
import { createPageAssertion, type PageAssertion } from '@jiso/test/page';
import { createPgliteTestDb, type PgliteTestDb } from '@jiso/test/pglite';
import {
  cssSourceDirectives,
  forbiddenBrowserArchitectureFacts,
  projectSourceSiteFact,
  type ForbiddenBrowserArchitectureFact,
  type ProjectSourceSiteFact,
} from '@jiso/test/source-fixtures';
import {
  observeSqlStatementArgument,
  observeSqlStatementIfString,
  sqlStatementText,
} from '@jiso/test/sql-observer';
import { jisoTest, type JisoTestCase, type JisoTestRunner } from '@jiso/test/test-case';
import {
  assertTypeScriptProgramHasNoDiagnostics,
  type TypeScriptInterfaceMemberTypes,
  typeScriptInterfaceMemberTypes,
} from '@jiso/test/typescript-fixtures';
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
import {
  parseWireFixture,
  parseWireResponses,
  type WireFixture,
  type WireTranscriptExchange,
  type WireTranscriptResponse,
} from '@jiso/test/wire-fixtures';
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
    expect(
      htmlDocumentFacts(
        '<html><head><title>Cart</title><script type="application/json">{"count":1}</script></head><body class="page">Ready</body></html>',
      ),
    ).toMatchObject({
      bodyAttrs: { class: 'page' },
      jsonScripts: [{ json: { count: 1 } }],
      text: 'Ready',
      title: 'Cart',
    });
    expect(
      htmlDocumentRegions(
        '<html><head><link rel="stylesheet" href="/assets/tailwind.css"></head><body>Ready</body></html>',
      ).head.tag,
    ).toBe('head');
    expect(
      htmlLinkHrefs(
        '<link rel="modulepreload" href="/c/app.js"><link rel="stylesheet" href="/assets/tailwind.css">',
        { rel: 'stylesheet' },
      ),
    ).toEqual(['/assets/tailwind.css']);
    expect(
      htmlJsonScriptFacts('<script type="application/json" data-id="cart">{"count":1}</script>', {
        'data-id': 'cart',
      }),
    ).toMatchObject([{ json: { count: 1 }, rawJson: '{"count":1}' }]);
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
    expect(
      htmlFormActions(
        '<form action="/_m/cart/add"></form><form action="/_m/order/receipt"></form>',
      ),
    ).toEqual(['/_m/cart/add', '/_m/order/receipt']);
    expect(
      htmlFormFields(
        '<form><input name="productId" value="p1"><input name="quantity" value="2"></form>',
        'quantity',
      ),
    ).toMatchObject([{ name: 'quantity', value: '2' }]);
    expect(htmlKeyFacts('<li fw-key="order-1"><span>Order</span></li>', 'order-1')).toMatchObject([
      { key: 'order-1', text: 'Order' },
    ]);
    expect(htmlTextContent('<p>Cart &amp; checkout</p>')).toBe('Cart & checkout');
    expect(markdownSection('# Docs\n\n## Gates\nReady\n## Next', 'Gates')).toBe('Ready');
    expect(markdownTableRows('| A | B |\n| --- | --- |\n| `one` | **two** |')).toEqual([
      { A: 'one', B: 'two' },
    ]);
    expect(Object.fromEntries(markdownFields('Status: ready'))).toEqual({ Status: 'ready' });
    expect(markdownNumberedListItems('1. **One.** Details')).toEqual(['One. Details']);
    expect(markdownNumberedListTitles('1. **One.** Details')).toEqual(['One']);
    expect(markdownLeadingTitle('**One.** Details')).toBe('One');
    expect(normalizeMarkdownCell('`one` **two**')).toBe('one two');
    expect(cssSourceDirectives('@source "../index.html";')).toEqual(['"../index.html"']);
    expect(forbiddenBrowserArchitectureFacts).toBeTypeOf('function');
    expect(projectSourceSiteFact('examples/commerce/src/app.ts:7')).toEqual({
      line: 7,
      path: 'examples/commerce/src/app.ts',
    });
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
    expect(commandSequence('vp run fw-check')).toMatchObject([
      { args: ['run', 'fw-check'], executable: 'vp' },
    ]);
    expect(pnpmRunScriptNames('pnpm run build && pnpm run test:browser')).toEqual([
      'build',
      'test:browser',
    ]);
    expect(requiredVpRunTaskName('check:fw', { scripts: { 'check:fw': 'vp run fw-check' } })).toBe(
      'fw-check',
    );
    expect(vpRunTaskName('vp run build')).toBe('build');
    expect(vitestTaskCommand('vitest --run --config vitest.browser.config.ts')).toEqual({
      configPath: 'vitest.browser.config.ts',
    });
    expect(nodeTaskCommand('node scripts/perf.mjs')).toEqual({ modulePath: 'scripts/perf.mjs' });
    expect(pnpmFilterTestCommands('pnpm --filter @jiso/conformance-auth-spike test')).toEqual([
      {
        argv: ['pnpm', '--filter', '@jiso/conformance-auth-spike', 'test'],
        packageName: '@jiso/conformance-auth-spike',
        script: 'test',
      },
    ]);
    expect(parseFwExplainOutput).toBeTypeOf('function');
    expect(fwExplainField('fw-explain/v1\nQUERY cart\nreads: cart\n', 'reads')).toBe('cart');
    expect(
      fwExplainRecords('fw-explain/v1\nMUTATION cart/add\nOPTIMISTIC cart plan\n', 'OPTIMISTIC'),
    ).toEqual(['cart plan']);
    expect(
      fwExplainSummary(
        'fw-explain/v1\nMUTATION cart/add\nOPTIMISTIC-SUMMARY total=1 UNHANDLED=0\n',
        'OPTIMISTIC-SUMMARY',
      ),
    ).toMatchObject({ UNHANDLED: '0', total: '1' });
    expect(
      fwExplainUpdateTargets(
        'fw-explain/v1\nMUTATION cart/add\nupdates: cart->page:/cart; product->page:/products\n',
      ),
    ).toEqual(['cart->page:/cart', 'product->page:/products']);
    expect(assertTypeScriptProgramHasNoDiagnostics).toBeTypeOf('function');
    expect(typeScriptInterfaceMemberTypes).toBeTypeOf('function');
    expect(
      workflowStepCommands(
        ['steps:', '  - uses: actions/checkout@v4', '  - run: vp check'].join('\n'),
      ),
    ).toEqual([{ uses: 'actions/checkout@v4' }, { run: 'vp check' }]);
    expect(workflowVpRunTaskNames('steps:\n  - run: vp run fw-check')).toEqual(['fw-check']);
    expect(() => assertOrderedItems(['build', 'fw-check'], 'build', 'fw-check')).not.toThrow();
    expect(loadVitePlusConfig).toBeTypeOf('function');
    expect(parseFwExportOutput('fw-export/v1\nSUMMARY html=0')).toMatchObject({
      summary: { html: '0' },
    });
    expect(executeGeneratedClientModule).toBeTypeOf('function');
    expect(executeGeneratedServerRenderSource).toBeTypeOf('function');
    expect(executeGeneratedBootstrapModule).toBeTypeOf('function');
    expect(new GeneratedFixtureMorphRoot().querySelectorAll('*')).toEqual([]);
    expect(new GeneratedFixtureMorphTarget('ready').readHtml()).toBe('ready');
    expect(
      new GeneratedFixtureElement({ 'data-bind': 'cart.count' }).getAttribute('data-bind'),
    ).toBe('cart.count');
    expect(
      new GeneratedFixtureTemplateStampHost({ 'data-bind-list': 'cart.items' }),
    ).toBeInstanceOf(GeneratedFixtureElement);
    const wireFixture = [
      '### Cart read',
      '>>> REQUEST',
      'GET /cart HTTP/1.1',
      '',
      '<<< RESPONSE',
      'HTTP/1.1 200 OK',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<main>Cart</main>',
    ].join('\n');
    expect(parseWireFixture(wireFixture)).toMatchObject({
      request: { method: 'GET', path: '/cart' },
      response: { headersByName: { 'content-type': 'text/html; charset=utf-8' }, status: 200 },
      title: 'Cart read',
    });
    expect(parseWireResponses(wireFixture)).toMatchObject([{ status: 200 }]);
    expect(runCommandSequenceSync).toBeTypeOf('function');
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
  CommandInvocation,
  NodeTaskCommand,
  PnpmFilterTestCommand,
  VitestTaskCommand,
  VitePlusConfig,
  VitePlusTask,
  WorkflowStepCommand,
  FwExplainOutput,
  FwExportError,
  FwExportHtmlArtifact,
  FwExportOutput,
  FwExportSummary,
  ForbiddenBrowserArchitectureFact,
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
  MarkdownFields,
  MarkdownTableRow,
  ProjectSourceSiteFact,
  WireFixture,
  WireTranscriptExchange,
  WireTranscriptResponse,
  ParsedSqlOperation,
  TypeScriptInterfaceMemberTypes,
  DbObservationOptions,
  DbVerificationConfig,
  DbVerificationDiagnostic,
  DirectDbVerificationDiagnostic,
  DbVerifier,
  ObservedDbOperation,
];
