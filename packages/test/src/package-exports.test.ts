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
  commandOutputLines,
  commandSequence,
  commandSequenceWithoutLast,
  conformanceGateFacts,
  loadVitePlusConfig,
  nodeTaskCommand,
  pnpmFilterTestCommands,
  pnpmRunScriptNames,
  requiredVpRunTaskName,
  runCommandSequenceSync,
  vitePlusAcceptanceTaskFacts,
  vitePlusTaskInputFacts,
  vitePlusTaskInputPatternEndingWith,
  vitestTaskCommand,
  vpRunTaskName,
  workflowVpRunTaskNames,
  workflowStepCommands,
  type ConformanceGateFacts,
  type CommandInvocation,
  type NodeTaskCommand,
  type PnpmFilterTestCommand,
  type VitePlusAcceptanceTaskFacts,
  type VitePlusTaskInputFact,
  type VitestTaskCommand,
  type VitePlusConfig,
  type VitePlusTask,
  type WorkflowStepCommand,
} from '@jiso/test/command-fixtures';
import {
  compilerDiagnosticMessageFacts,
  compilerDiagnosticFacts,
  compilerGeneratedQueryShapeFact,
  compilerQueryUpdatePlanFacts,
  compilerUpdateCoverageFacts,
  type CompilerDiagnosticFact,
  type CompilerDiagnosticMessageFact,
  type CompilerQueryUpdatePlanFact,
  type CompilerQueryShapeFact,
  type CompilerUpdateCoverageFact,
} from '@jiso/test/compiler-fixtures';
import {
  viteLoweredEventDiagnosticFact,
  viteDiagnosticMessageFacts,
  viteDiagnosticMessageFactsFromOutput,
  type DiagnosticHelpFact,
  type DiagnosticOutputFact,
  type ViteLoweredEventDiagnosticFact,
  type ViteDiagnosticMessageFacts,
} from '@jiso/test/diagnostic-output-fixtures';
import {
  fwExportCliResultFact,
  parseFwExportOutput,
  type FwExportCliArtifactFact,
  type FwExportCliResultFact,
  type FwExportCliResultLike,
  type FwExportError,
  type FwExportHtmlArtifact,
  type FwExportOutput,
  type FwExportSummary,
} from '@jiso/test/fw-export-fixtures';
import {
  fwCheckAssertionFact,
  fwCheckCoverageAssertionFacts,
  fwCheckCoverageFacts,
  fwCheckDiagnosticAssertionFacts,
  fwCheckDiagnosticFacts,
  fwCheckOkAssertionFact,
  fwCheckResultFact,
  parseFwCheckOutput,
  type FwCheckAssertionFact,
  type FwCheckCoverageAssertionFact,
  type FwCheckCoverageFact,
  type FwCheckDiagnosticAssertionFact,
  type FwCheckDiagnosticFact,
  type FwCheckOkAssertionFact,
  type FwCheckOutput,
  type FwCheckResultFact,
} from '@jiso/test/fw-check-fixtures';
import {
  fwExplainEndpointFacts,
  fwExplainField,
  fwExplainListField,
  fwExplainMutationAssertionFact,
  fwExplainMutationQueryMatrixFact,
  fwExplainOptimisticStatuses,
  fwExplainPageAssertionFact,
  fwExplainQueryAssertionFact,
  fwExplainRecords,
  fwExplainScopeAuditFacts,
  fwExplainSummary,
  fwExplainUpdateConsumerMap,
  fwExplainUpdateConsumers,
  fwExplainUpdateTargets,
  parseFwExplainOutput,
  type FwExplainEndpointFact,
  type FwExplainMutationAssertionFact,
  type FwExplainOutput,
  type FwExplainPageAssertionFact,
  type FwExplainQueryAssertionFact,
  type FwExplainResultLike,
  type FwExplainScopeAuditFact,
  type FwExplainUpdateConsumerFact,
} from '@jiso/test/fw-explain-fixtures';
import {
  assertGeneratedRegistryConsumerTypes,
  executeGeneratedBootstrapModule,
  executeGeneratedClientModule,
  executeGeneratedServerRenderSource,
  executeInlineEnhancedFormLoaderFixture,
  generatedBootstrapDeferredBehaviorFact,
  generatedClientExportTypeFacts,
  generatedComponentCommittedIrFacts,
  generatedComponentSourceFileFacts,
  generatedComponentSourceFacts,
  generatedCssScopeRulesFromArtifact,
  generatedHandlerReferenceFact,
  generatedHandlerReferenceSummaryFact,
  generatedMinifierNamePreservationBehaviorFact,
  generatedQueryUpdatePlanBehaviorFact,
  generatedRenderEquivalenceBehaviorFact,
  generatedServerDeferredBehaviorFact,
  generatedTypedDataParamCoercionBehaviorFact,
  generatedWireDeferredBehaviorFact,
  generatedRegistryInterfaceMemberTypes,
  generatedRenderedElementFactsFromArtifact,
  generatedRenderedElementFactsFromSource,
  type GeneratedComponentSourceFacts,
  type GeneratedComponentCommittedIrFact,
  type GeneratedComponentSourceFileFact,
  type GeneratedMinifierNamePreservationBehaviorFact,
  type GeneratedRenderEquivalenceBehaviorFact,
  type GeneratedRegistryConsumerTypeOptions,
  type GeneratedTypedDataParamCoercionBehaviorFact,
  GeneratedFixtureElement,
  GeneratedFixtureMorphRoot,
  GeneratedFixtureMorphTarget,
  GeneratedFixtureTemplateStampHost,
  type GeneratedHandlerReferenceFact,
  type GeneratedHandlerReferenceSummaryFact,
  type GeneratedRenderedElementFact,
  type InlineEnhancedFormLoaderFact,
} from '@jiso/test/generated-module-fixtures';
import {
  generatedGraphArtifactHonestyFact,
  graphFixtureFile,
  graphComponentTargetFacts,
  graphDomainFacts,
  graphFragmentTargetForQuery,
  graphInvalidationFacts,
  graphInvalidatedByQueries,
  graphInvalidatedQueries,
  graphMutationFact,
  graphMutationKeys,
  graphMutationUpdateConsumers,
  graphOptimisticFacts,
  graphOptimisticStatusMatrix,
  graphPageFact,
  graphQueryConsumers,
  graphRouteFacts,
  graphStaticBehaviorFact,
  graphTouchGraphKeys,
  type GeneratedGraphArtifactHonestyFact,
  type GraphInvalidationMatrix,
  type GraphQueryConsumerFact,
  type ProjectGraphFixture,
} from '@jiso/test/graph-fixtures';
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
  cookiePair,
  firstSetCookiePair,
  headerValues,
  setCookieValues,
  type HeaderRecord,
} from '@jiso/test/headers';
import {
  fragmentHtml,
  fwFragmentFacts,
  fwQueryFacts,
  fwQueryJsonValues,
  fwResponseBodyFact,
  htmlDocumentFacts,
  htmlDocumentRegions,
  htmlElementCount,
  htmlElementFacts,
  htmlFormActions,
  htmlFormFacts,
  htmlFormFieldsByName,
  htmlFormFields,
  htmlJsonScriptFacts,
  htmlKeyFacts,
  htmlKeyTextMap,
  htmlKeyValues,
  htmlLinkHrefs,
  htmlTextContent,
} from '@jiso/test/html-fragment';
import {
  markdownBoldSectionHeadings,
  markdownCanonicalSpecRuleTitle,
  markdownCanonicalSpecRuleTitles,
  markdownFields,
  markdownLeadingTitle,
  markdownNumberedListItems,
  markdownNumberedListTitles,
  markdownSection,
  markdownTableRows,
  normalizeMarkdownCell,
  type MarkdownBoldSectionHeading,
  type MarkdownFields,
  type MarkdownTableRow,
} from '@jiso/test/markdown-fixtures';
import {
  mcpCompileResponseFacts,
  mcpJsonRpcResponseFacts,
  type McpCompileDiagnosticFact,
  type McpCompileResponseFact,
  type McpJsonRpcResponseFact,
} from '@jiso/test/mcp-fixtures';
import { createPageAssertion, type PageAssertion } from '@jiso/test/page';
import { createPgliteTestDb, type PgliteTestDb } from '@jiso/test/pglite';
import {
  loaderSmokeBehaviorFact,
  optimismCleanupBehaviorFact,
  type LoaderSmokeBehaviorFact,
  type LoaderSmokeRuntime,
  type OptimismCleanupBehaviorFact,
  type OptimismCleanupRuntime,
} from '@jiso/test/runtime-fixtures';
import {
  cssScopeRules,
  cssSourceDirectives,
  drizzleQueryBehaviorSourceFixtures,
  forbiddenBrowserArchitectureFacts,
  moduleImportFailureFact,
  projectDirectoryNames,
  projectFilePaths,
  projectFileSources,
  projectJsonFile,
  projectPackageManifestFacts,
  projectQueryBehaviorFacts,
  projectQueryDiagnosticFacts,
  projectSourceLineFacts,
  projectSourceSiteFact,
  projectTouchGraphBehaviorFacts,
  type CssScopeRuleFact,
  type DrizzleQueryBehaviorSourceFixtures,
  type ForbiddenBrowserArchitectureFact,
  type ModuleImportFailureFact,
  type ProjectFileSourceFact,
  type ProjectFileTreeOptions,
  type ProjectPackageManifestFact,
  type ProjectQueryBehaviorFact,
  type ProjectQueryDiagnosticFact,
  type ProjectSourceFixture,
  type ProjectSourceLineFact,
  type ProjectSourceSiteFact,
  type ProjectTouchGraphBehaviorFact,
} from '@jiso/test/source-fixtures';
import {
  executeStarterClientTemplate,
  runPnpmFilterTaskCommand,
  runStarterTemplateEmitGraph,
  runStarterTemplateGraphAssertions,
  runStarterTemplateViteTaskCommand,
  starterClientTemplateBehaviorFact,
  starterTemplateFacts,
  type StarterClientTemplateBehaviorFact,
  type StarterClientTemplateFixture,
  type StarterTemplateFacts,
  type StarterTemplateIndexHtmlFacts,
  type StarterTemplatePackageFacts,
  type StarterTemplateSources,
} from '@jiso/test/starter-template-fixtures';
import {
  observeSqlStatementArgument,
  observeSqlStatementIfString,
  sqlStatementText,
} from '@jiso/test/sql-observer';
import { jisoTest, type JisoTestCase, type JisoTestRunner } from '@jiso/test/test-case';
import {
  touchGraphProvenanceFact,
  touchGraphProvenanceHonestyFact,
  touchGraphSourceFacts,
  touchGraphSourceSiteSummaryFact,
  touchGraphSummaryFacts,
  type TouchGraphProvenanceHonestyFact,
  type TouchGraphProvenanceFact,
  type TouchGraphSourceFact,
  type TouchGraphSummaryEntryFact,
} from '@jiso/test/touch-graph-fixtures';
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
  viteGeneratedHandlerMiddlewareFact,
  viteHandlerTransformFact,
  vitePluginMiddlewareFact,
  viteRedGreenBuildFixtureFact,
  viteTransformElementFact,
  type ViteGeneratedHandlerMiddlewareFact,
  type ViteHandlerTransformFact,
  type VitePluginLike,
  type VitePluginMiddlewareFact,
  type ViteRedGreenBuildFixtureFact,
  type ViteTransformElementFact,
} from '@jiso/test/vite-fixtures';
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
    expect(loaderSmokeBehaviorFact).toBeTypeOf('function');
    expect(optimismCleanupBehaviorFact).toBeTypeOf('function');
    expect(headerValues({ 'Set-Cookie': 'sid=1; Path=/' }, 'set-cookie')).toEqual([
      'sid=1; Path=/',
    ]);
    expect(setCookieValues({ 'Set-Cookie': ['sid=1; Path=/'] })).toEqual(['sid=1; Path=/']);
    expect(cookiePair('sid=1; Path=/')).toBe('sid=1');
    expect(firstSetCookiePair({ 'Set-Cookie': 'sid=1; Path=/' })).toBe('sid=1');
    expectTypeOf<HeaderRecord>().toEqualTypeOf<Record<string, string | string[] | undefined>>();
    expectTypeOf<LoaderSmokeBehaviorFact>().toMatchTypeOf<{
      calls: Array<[string, boolean]>;
    }>();
    expectTypeOf<LoaderSmokeRuntime>().toMatchTypeOf<{
      createQueryStore: () => unknown;
    }>();
    expectTypeOf<OptimismCleanupBehaviorFact>().toMatchTypeOf<{
      pendingCounts: { afterPagehide: number; afterResponse: number; afterSubmit: number };
    }>();
    expectTypeOf<OptimismCleanupRuntime>().toMatchTypeOf<{
      createQueryStore: () => unknown;
    }>();
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
      htmlElementCount('<div data-shell="cart"></div><div></div>', {
        attrs: { 'data-shell': 'cart' },
        tag: 'div',
      }),
    ).toBe(1);
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
      fwResponseBodyFact(
        '<fw-query name="cart">{"count":1}</fw-query><fw-fragment target="cart"><article fw-key="order-1">Order</article></fw-fragment>',
      ),
    ).toMatchObject({
      fragmentTargets: ['cart'],
      keyValues: ['order-1'],
      queryJsonByName: { cart: [{ count: 1 }] },
      queryNames: ['cart'],
    });
    expect(fwQueryJsonValues('<fw-query name="cart">{"count":1}</fw-query>', 'cart')).toEqual([
      { count: 1 },
    ]);
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
    expect(
      htmlFormFieldsByName(htmlFormFacts('<form><input name="productId" value="p1"></form>')[0]),
    ).toMatchObject({ productId: { value: 'p1' } });
    expect(htmlKeyFacts('<li fw-key="order-1"><span>Order</span></li>', 'order-1')).toMatchObject([
      { key: 'order-1', text: 'Order' },
    ]);
    expect(htmlKeyValues('<li fw-key="order-1">Order</li>')).toEqual(['order-1']);
    expect(htmlKeyTextMap('<li fw-key="order-1"><span>Order</span></li>')).toEqual({
      'order-1': 'Order',
    });
    expect(htmlTextContent('<p>Cart &amp; checkout</p>')).toBe('Cart & checkout');
    expect(markdownSection('# Docs\n\n## Gates\nReady\n## Next', 'Gates')).toBe('Ready');
    expect(markdownTableRows('| A | B |\n| --- | --- |\n| `one` | **two** |')).toEqual([
      { A: 'one', B: 'two' },
    ]);
    expect(Object.fromEntries(markdownFields('Status: ready'))).toEqual({ Status: 'ready' });
    expect(markdownNumberedListItems('1. **One.** Details')).toEqual(['One. Details']);
    expect(markdownNumberedListTitles('1. **One.** Details')).toEqual(['One']);
    expect(markdownLeadingTitle('**One.** Details')).toBe('One');
    expect(markdownCanonicalSpecRuleTitle('One-to-one file mapping')).toBe('1:1 file mapping');
    expect(markdownCanonicalSpecRuleTitles(['Platform behavior emission'])).toEqual([
      'Platform-behavior emission',
    ]);
    expect(normalizeMarkdownCell('`one` **two**')).toBe('one two');
    expect(markdownBoldSectionHeadings('**13.1 CSS:** details')).toEqual([
      { number: '13.1', title: 'CSS' },
    ]);
    expect(
      mcpCompileResponseFacts(
        JSON.stringify({
          id: 'compile',
          result: {
            structuredContent: {
              diagnostics: [{ code: 'FW201', severity: 'error' }],
              ok: false,
              version: 'compile/v1',
            },
            version: 'fw-mcp/v1',
          },
        }),
      ),
    ).toEqual([
      {
        contentVersion: 'compile/v1',
        diagnostics: [{ code: 'FW201', severity: 'error' }],
        id: 'compile',
        ok: false,
        version: 'fw-mcp/v1',
      },
    ]);
    expect(mcpJsonRpcResponseFacts).toBeTypeOf('function');
    expect(generatedMinifierNamePreservationBehaviorFact).toBeTypeOf('function');
    expect(generatedQueryUpdatePlanBehaviorFact).toBeTypeOf('function');
    expect(generatedRenderEquivalenceBehaviorFact).toBeTypeOf('function');
    expect(generatedBootstrapDeferredBehaviorFact).toBeTypeOf('function');
    expect(generatedServerDeferredBehaviorFact).toBeTypeOf('function');
    expect(generatedTypedDataParamCoercionBehaviorFact).toBeTypeOf('function');
    expect(generatedWireDeferredBehaviorFact).toBeTypeOf('function');
    expect(cssSourceDirectives('@source "../index.html";')).toEqual(['"../index.html"']);
    expect(cssScopeRules('@scope (doc-card) to (:scope [fw-c]) {')).toEqual([
      { limit: ':scope [fw-c]', raw: '@scope (doc-card) to (:scope [fw-c]) {', scope: 'doc-card' },
    ]);
    expect(drizzleQueryBehaviorSourceFixtures().selectShape[0]?.fileName).toBe('cart.queries.ts');
    expect(
      projectQueryBehaviorFacts([
        { query: 'cart', reads: ['cart'], shape: { count: 'number' }, site: 'cart.ts:1' },
      ]),
    ).toEqual([{ query: 'cart', reads: ['cart'], shape: { count: 'number' }, site: 'cart.ts:1' }]);
    expect(
      projectQueryDiagnosticFacts([
        {
          diagnostics: [
            { code: 'FW410', message: 'message', severity: 'error', site: 'cart.ts:1' },
          ],
          query: 'cart',
          reads: ['cart'],
          shape: { count: 'number' },
          site: 'cart.ts:1',
        },
      ]),
    ).toEqual([{ code: 'FW410', message: 'message', severity: 'error', site: 'cart.ts:1' }]);
    expect(projectTouchGraphBehaviorFacts({ addItem: {} })).toEqual({
      addItem: { reads: [], touches: [], unresolved: [] },
    });
    expect(forbiddenBrowserArchitectureFacts).toBeTypeOf('function');
    expect(projectDirectoryNames).toBeTypeOf('function');
    expect(projectFilePaths).toBeTypeOf('function');
    expect(projectFileSources).toBeTypeOf('function');
    expect(projectJsonFile).toBeTypeOf('function');
    expect(projectPackageManifestFacts).toBeTypeOf('function');
    expect(
      moduleImportFailureFact(new Error('Cannot load packages/core/src/diagnostics.js'), [
        'packages/core/src/diagnostics.js',
      ]),
    ).toEqual({
      allowed: true,
      matchedReason: 'packages/core/src/diagnostics.js',
    });
    expect(projectSourceLineFacts).toBeTypeOf('function');
    expect(projectSourceSiteFact('examples/commerce/src/app.ts:7')).toEqual({
      line: 7,
      path: 'examples/commerce/src/app.ts',
    });
    expectTypeOf<DrizzleQueryBehaviorSourceFixtures>()
      .toHaveProperty('selectShape')
      .toEqualTypeOf<ProjectSourceFixture[]>();
    expectTypeOf<ProjectQueryBehaviorFact>().toHaveProperty('query').toEqualTypeOf<string>();
    expectTypeOf<ProjectQueryDiagnosticFact>().toHaveProperty('code').toEqualTypeOf<string>();
    expectTypeOf<ProjectTouchGraphBehaviorFact>()
      .toHaveProperty('touches')
      .toMatchTypeOf<readonly unknown[]>();
    expectTypeOf<ProjectPackageManifestFact>().toHaveProperty('directory').toEqualTypeOf<string>();
    expect(graphFixtureFile).toBeTypeOf('function');
    expectTypeOf<GeneratedGraphArtifactHonestyFact>().toMatchTypeOf<{
      emitCheck: { clean: boolean };
    }>();
    expectTypeOf<ProjectGraphFixture>().toMatchTypeOf<Record<string, unknown>>();
    expect(touchGraphProvenanceFact).toBeTypeOf('function');
    expect(
      touchGraphProvenanceHonestyFact({
        entries: {
          'cart.addItem': {
            reads: [],
            touches: [
              {
                domain: 'cart',
                keys: null,
                predicate: undefined,
                sitePath: 'src/cart.ts',
                via: 'cart_items',
              },
            ],
            unresolved: [],
          },
        },
        siteSummary: { count: 1, linesArePositive: true, paths: ['src/cart.ts'] },
        sourceLineMismatches: [],
        unresolvedMutations: [],
      }),
    ).toEqual({
      entryKeys: ['cart.addItem'],
      sourceLineMismatches: [],
      sourceSites: { count: 1, linesArePositive: true, paths: ['src/cart.ts'] },
      touchCountsByMutation: { 'cart.addItem': 1 },
      unresolvedMutations: [],
    });
    expect(touchGraphSourceFacts).toBeTypeOf('function');
    expect(
      touchGraphSourceSiteSummaryFact({
        'cart.addItem': {
          touches: [{ domain: 'cart', site: 'src/cart.ts:3', via: 'cart_items' }],
        },
      }),
    ).toEqual({ count: 1, linesArePositive: true, paths: ['src/cart.ts'] });
    expect(touchGraphSummaryFacts).toBeTypeOf('function');
    expect(
      viteDiagnosticMessageFacts(
        [
          'Jiso Vite transform failed with 1 error diagnostic.',
          '',
          'FW201 routes/card.tsx:1:1 message.',
          '  help: Element params: -',
        ].join('\n'),
      ).diagnostics[0]?.help,
    ).toEqual([{ label: 'Element params', text: '-' }]);
    expect(
      viteDiagnosticMessageFactsFromOutput(
        'prefix\nJiso Vite transform failed with 1 error diagnostic.\n\nFW201 x.ts:1:1 message.',
      ).summary,
    ).toBe('Jiso Vite transform failed with 1 error diagnostic.');
    expect(
      viteLoweredEventDiagnosticFact(
        [
          'Jiso Vite transform failed with 1 error diagnostic.',
          '',
          'FW201 routes/card.tsx:1:1 message.',
          '  help: Would lower to: on:click="/c/routes/card.client.js?v=1234abcd#Card$click"',
          '  help: Element params: -',
        ].join('\n'),
      ).loweredHandler,
    ).toEqual({
      handlerName: 'Card$click',
      modulePath: '/c/routes/card.client.js',
      versionShape: 'lower-hex-8',
    });
    expect(starterTemplateFacts).toBeTypeOf('function');
    expect(executeStarterClientTemplate).toBeTypeOf('function');
    expect(starterClientTemplateBehaviorFact).toBeTypeOf('function');
    expect(runStarterTemplateEmitGraph).toBeTypeOf('function');
    expect(runStarterTemplateGraphAssertions).toBeTypeOf('function');
    expect(runStarterTemplateViteTaskCommand).toBeTypeOf('function');
    expect(runPnpmFilterTaskCommand).toBeTypeOf('function');
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
    expect(vitePluginMiddlewareFact).toBeTypeOf('function');
    expect(viteTransformElementFact).toBeTypeOf('function');
    expect(viteHandlerTransformFact).toBeTypeOf('function');
    expect(viteGeneratedHandlerMiddlewareFact).toBeTypeOf('function');
    expect(viteRedGreenBuildFixtureFact).toBeTypeOf('function');
    expect(commandSequence('vp run fw-check')).toMatchObject([
      { args: ['run', 'fw-check'], executable: 'vp' },
    ]);
    expect(
      compilerDiagnosticFacts([{ code: 'FW311', message: 'coverage', severity: 'warn' }]),
    ).toEqual([{ code: 'FW311', message: 'coverage', severity: 'warn' }]);
    expect(
      compilerDiagnosticMessageFacts([{ code: 'FW302', message: 'binding', severity: 'error' }]),
    ).toEqual([{ code: 'FW302', message: 'binding' }]);
    expect(compilerGeneratedQueryShapeFact({ query: 'cart', shape: { count: 'number' } })).toEqual({
      query: 'cart',
      shape: { count: 'number' },
      source: 'generated/queries/cart.shape.ts',
    });
    expect(
      compilerQueryUpdatePlanFacts([
        { componentName: 'Cart', paths: ['cart.count'], query: 'cart' },
      ]),
    ).toEqual([
      { componentName: 'Cart', paths: ['cart.count'], query: 'cart', templateStamps: [] },
    ]);
    expect(
      compilerUpdateCoverageFacts([
        { componentName: 'CartBadge', position: 'text', query: 'cart.count', status: 'plan' },
      ]),
    ).toEqual([{ component: 'CartBadge', position: 'text', query: 'cart.count', status: 'plan' }]);
    expectTypeOf<CompilerDiagnosticFact>().toHaveProperty('code').toEqualTypeOf<string>();
    expectTypeOf<CompilerDiagnosticMessageFact>().toHaveProperty('message').toEqualTypeOf<string>();
    expectTypeOf<CompilerQueryShapeFact>().toHaveProperty('source').toEqualTypeOf<string>();
    expectTypeOf<CompilerUpdateCoverageFact>().toHaveProperty('component').toEqualTypeOf<string>();
    expect(commandOutputLines('one\r\ntwo\n')).toEqual(['one', 'two']);
    expect(commandSequenceWithoutLast('vp run build && vp run fw-check')).toBe('vp run build');
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
      fwExplainListField(
        'fw-explain/v1\nMUTATION cart/add\ninput-fields: productId,quantity\n',
        'input-fields',
      ),
    ).toEqual(['productId', 'quantity']);
    expect(
      fwExplainRecords('fw-explain/v1\nMUTATION cart/add\nOPTIMISTIC cart plan\n', 'OPTIMISTIC'),
    ).toEqual(['cart plan']);
    expect(
      fwExplainOptimisticStatuses(
        'fw-explain/v1\nMUTATION cart/add\nOPTIMISTIC cart await-fragment\n',
      ),
    ).toEqual({ cart: 'await-fragment' });
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
    expect(fwExplainUpdateTargets('fw-explain/v1\nMUTATION cart/add\nupdates: -\n')).toEqual([]);
    expect(
      fwExplainUpdateConsumers(
        'fw-explain/v1\nMUTATION cart/add\nupdates: cart->component:CartBadge,page:/cart\n',
      ),
    ).toEqual([{ consumers: ['component:CartBadge', 'page:/cart'], query: 'cart' }]);
    expect(
      Object.fromEntries(
        fwExplainUpdateConsumerMap('fw-explain/v1\nMUTATION cart/add\nupdates: cart->page:/cart\n'),
      ),
    ).toEqual({ cart: ['page:/cart'] });
    expect(
      fwExplainMutationQueryMatrixFact({
        explainMutation: () => ({
          exitCode: 0,
          output:
            'fw-explain/v1\nMUTATION cart/add\nupdates: cart->page:/cart\nOPTIMISTIC cart hand-written\nOPTIMISTIC-SUMMARY total=1 UNHANDLED=0\n',
        }),
        graph: { mutations: [{ key: 'cart/add' }], queries: [{ query: 'cart' }] },
      }).matrix,
    ).toEqual({ 'cart/add': { cart: 'hand-written' } });
    expect(
      fwExplainEndpointFacts(
        [
          'fw-explain/v1',
          'ENDPOINTS',
          'ENDPOINT orders/export method=GET path=/exports/orders.csv mount=exact auth=authed csrf=checked writes=-',
          '',
        ].join('\n'),
      ),
    ).toEqual([
      {
        auth: 'authed',
        csrf: 'checked',
        endpoint: 'orders/export',
        method: 'GET',
        mount: 'exact',
        path: '/exports/orders.csv',
        writes: [],
      },
    ]);
    expect(
      fwExplainScopeAuditFacts(
        'fw-explain/v1\nUNSCOPED\nUNSCOPED QUERY cart domain=cart scope=unscoped site=src/app.ts:1 missing tenant filter\n',
        'UNSCOPED',
      ),
    ).toEqual([
      {
        domain: 'cart',
        reason: 'missing tenant filter',
        scope: 'unscoped',
        site: 'src/app.ts:1',
        target: 'cart',
        targetKind: 'QUERY',
      },
    ]);
    const graph = {
      components: [{ fragments: ['cart-badge'], name: 'CartBadge', queries: ['cart'] }],
      mutations: [{ invalidates: ['cart'], key: 'cart/add' }],
      optimistic: [{ mutation: 'cart/add', query: 'cart', status: 'hand-written' }],
      pages: [{ queries: ['cart'], route: '/cart' }],
      queries: [{ domains: ['cart'], query: 'cart' }],
      touchGraph: { 'cart.addItem': {} },
    };
    expect(graphComponentTargetFacts(graph)).toEqual([
      { fragments: ['cart-badge'], name: 'CartBadge', queries: ['cart'] },
    ]);
    expect(graphDomainFacts(graph)).toEqual(['cart']);
    expect(graphInvalidationFacts(graph)).toEqual({ 'cart/add': ['cart'] });
    expect(
      generatedGraphArtifactHonestyFact({
        emitCheck: { stderr: '', stdout: '' },
        graph,
        provenance: {
          entries: {},
          siteSummary: { count: 0, linesArePositive: true, paths: [] },
          sourceLineMismatches: [],
          unresolvedMutations: [],
        },
      }).emitCheck.clean,
    ).toBe(true);
    expect(graphMutationKeys(graph)).toEqual(['cart/add']);
    expect(graphPageFact(graph, '/cart')).toMatchObject({ route: '/cart' });
    expect(graphMutationFact(graph, 'cart/add')).toMatchObject({ key: 'cart/add' });
    expect(graphFragmentTargetForQuery(graph, 'cart')).toBe('cart-badge');
    expect(graphInvalidatedQueries(graph, 'cart/add')).toEqual(['cart']);
    expect(Object.fromEntries(graphInvalidatedByQueries(graph))).toEqual({ cart: ['cart/add'] });
    expect(graphQueryConsumers(graph)).toEqual([
      { consumers: ['component:CartBadge', 'page:/cart'], query: 'cart' },
    ]);
    expect(graphMutationUpdateConsumers(graph, 'cart/add')).toEqual([
      { consumers: ['component:CartBadge', 'page:/cart'], query: 'cart' },
    ]);
    expect(graphOptimisticStatusMatrix(graph)).toEqual({
      'cart/add': { cart: 'hand-written' },
    });
    expect(graphOptimisticFacts(graph)).toEqual([
      { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
    ]);
    expect(graphRouteFacts(graph)).toEqual(['/cart']);
    expect(graphTouchGraphKeys(graph)).toEqual(['cart.addItem']);
    expect(graphStaticBehaviorFact(graph)).toEqual({
      components: [{ fragments: ['cart-badge'], name: 'CartBadge', queries: ['cart'] }],
      domains: ['cart'],
      invalidations: { 'cart/add': ['cart'] },
      mutations: ['cart/add'],
      optimistic: [{ mutation: 'cart/add', query: 'cart', status: 'hand-written' }],
      routes: ['/cart'],
      touchGraphKeys: ['cart.addItem'],
    });
    expect(assertTypeScriptProgramHasNoDiagnostics).toBeTypeOf('function');
    expect(typeScriptInterfaceMemberTypes).toBeTypeOf('function');
    expect(
      workflowStepCommands(
        ['steps:', '  - uses: actions/checkout@v4', '  - run: vp check'].join('\n'),
      ),
    ).toEqual([{ uses: 'actions/checkout@v4' }, { run: 'vp check' }]);
    expect(workflowVpRunTaskNames('steps:\n  - run: vp run fw-check')).toEqual(['fw-check']);
    expect(() => assertOrderedItems(['build', 'fw-check'], 'build', 'fw-check')).not.toThrow();
    expect(conformanceGateFacts).toBeTypeOf('function');
    expectTypeOf<ConformanceGateFacts>().toHaveProperty('taskName').toEqualTypeOf<string>();
    expect(loadVitePlusConfig).toBeTypeOf('function');
    expect(vitePlusAcceptanceTaskFacts).toBeTypeOf('function');
    expect(vitePlusTaskInputFacts).toBeTypeOf('function');
    expect(vitePlusTaskInputPatternEndingWith).toBeTypeOf('function');
    expect(parseFwExportOutput('fw-export/v1\nSUMMARY html=0')).toMatchObject({
      summary: { html: '0' },
    });
    expect(
      fwExportCliResultFact({
        exitCode: 0,
        stderr: '',
        stdout: 'fw-export/v1\nHTML /index.html status=200 bytes=1\n',
      }),
    ).toMatchObject({
      exitCode: 0,
      html: [{ bytesArePositive: true, path: '/index.html', status: 200 }],
      outputStream: 'stdout',
    });
    expect(parseFwCheckOutput('fw-check/v1\nOK\n')).toMatchObject({ status: 'ok' });
    expect(fwCheckResultFact({ exitCode: 0, output: 'fw-check/v1\nOK\n' })).toMatchObject({
      exitCode: 0,
      status: 'ok',
    });
    expect(fwCheckAssertionFact({ exitCode: 0, output: 'fw-check/v1\nOK\n' })).toMatchObject({
      diagnostics: [],
      exitCode: 0,
    });
    expect(fwCheckOkAssertionFact({ exitCode: 0, output: 'fw-check/v1\nOK\n' })).toEqual({
      exitCode: 0,
      issueCount: 0,
      status: 'ok',
      version: 'fw-check/v1',
    });
    expect(
      fwCheckDiagnosticFacts(
        'fw-check/v1\nWARN FW310 cart/add -> cart Invalidated query lacks optimistic transform.\n',
      ),
    ).toMatchObject([{ code: 'FW310', target: 'cart/add -> cart' }]);
    expect(
      fwCheckDiagnosticAssertionFacts(
        'fw-check/v1\nWARN FW311 component=Cart query=cart.count position="conditional <dot>" Query-dependent DOM position has no update status.\n',
      ),
    ).toEqual([
      {
        code: 'FW311',
        message: 'Query-dependent DOM position has no update status.',
        properties: {
          component: 'Cart',
          position: 'conditional <dot>',
          query: 'cart.count',
        },
        severity: 'WARN',
        target: '',
      },
    ]);
    expect(
      fwCheckCoverageFacts(
        'fw-check/v1\nCOVERAGE component=Cart query=cart position=replace status=fragment\n',
      ),
    ).toMatchObject([{ properties: { component: 'Cart', status: 'fragment' } }]);
    expect(
      fwCheckCoverageAssertionFacts(
        'fw-check/v1\nCOVERAGE component=Cart query=cart position=replace status=fragment detail="text binding"\n',
      ),
    ).toEqual([
      {
        properties: {
          component: 'Cart',
          detail: 'text binding',
          position: 'replace',
          query: 'cart',
          status: 'fragment',
        },
      },
    ]);
    expect(
      fwExplainMutationAssertionFact({
        exitCode: 0,
        output: [
          'fw-explain/v1',
          'MUTATION cart/add',
          'guards: authed',
          'session: starterSession',
          'input-fields: productId,quantity',
          'writes: cart',
          'invalidates: cart',
          'manual-invalidates: -',
          'updates: cart->component:CartBadge,page:/cart',
          'OPTIMISTIC cart await-fragment',
          'OPTIMISTIC-SUMMARY total=1 hand-written=0 await-fragment=1 UNHANDLED=0',
          '',
        ].join('\n'),
      }),
    ).toMatchObject({
      inputFields: ['productId', 'quantity'],
      optimisticStatuses: { cart: 'await-fragment' },
      subject: 'MUTATION cart/add',
      updateConsumers: [{ consumers: ['component:CartBadge', 'page:/cart'], query: 'cart' }],
    });
    expect(
      fwExplainQueryAssertionFact({
        exitCode: 0,
        output:
          'fw-explain/v1\nQUERY cart\nreads: cart\nconsumers: page:/cart\ninvalidated-by: cart/add\ndomain-writes: cart.addItem\n',
      }),
    ).toMatchObject({ consumers: ['page:/cart'], domainWrites: ['cart.addItem'] });
    expect(
      fwExplainPageAssertionFact({
        exitCode: 0,
        output:
          'fw-explain/v1\nPAGE /cart\nprefetch: false\nmeta: title=Cart description=Ready image=-\ni18n: -\nmodulepreloads: -\nstylesheets: /src/styles.css\nqueries: cart\nview-transitions: -\n',
      }),
    ).toMatchObject({ queries: ['cart'], stylesheets: ['/src/styles.css'] });
    expect(executeGeneratedClientModule).toBeTypeOf('function');
    expect(executeGeneratedServerRenderSource).toBeTypeOf('function');
    expect(executeGeneratedBootstrapModule).toBeTypeOf('function');
    expect(
      generatedComponentSourceFacts({
        authoredSource: '<cart-badge></cart-badge>',
        generatedSource: '// @jiso-ir',
      }),
    ).toEqual({
      authoredLoweredStampAttributes: [],
      generatedHasLoweredIrMarker: true,
    } satisfies GeneratedComponentSourceFacts);
    expect(
      generatedComponentSourceFileFacts({
        components: ['cart-badge'],
        sourceRootUrl: new URL('../../../examples/commerce/src/', import.meta.url),
      })[0],
    ).toMatchObject({
      authoredPath: 'components/cart-badge.tsx',
      generatedPath: 'generated/cart-badge.tsx',
      name: 'cart-badge',
    } satisfies Partial<GeneratedComponentSourceFileFact>);
    expect(generatedComponentCommittedIrFacts).toBeTypeOf('function');
    expect({
      authoredLoweredStampAttributes: [],
      authoredPath: 'components/cart-badge.tsx',
      diagnostics: [],
      fixpointAsserted: true,
      generatedHasLoweredIrMarker: true,
      generatedMatchesCompilerOutput: true,
      generatedPath: 'generated/cart-badge.tsx',
      loweredRenderSourcePresent: true,
      name: 'cart-badge',
      provenance: {
        fileName: 'examples/commerce/src/components/cart-badge.tsx',
        spec: 'SPEC.md section 5.2',
      },
      renderEquivalenceAsserted: true,
    }).toMatchObject({
      generatedMatchesCompilerOutput: true,
    } satisfies Partial<GeneratedComponentCommittedIrFact>);
    expect(generatedHandlerReferenceFact('/c/cart.client.js?v=0a1b2c3d#Cart$click')).toMatchObject({
      handlerName: 'Cart$click',
      modulePath: '/c/cart.client.js',
      versionShape: 'lower-hex-8',
    });
    expect(generatedHandlerReferenceSummaryFact('/c/cart.client.js?v=0a1b2c3d#Cart$click')).toEqual(
      {
        handlerName: 'Cart$click',
        modulePath: '/c/cart.client.js',
        versionShape: 'lower-hex-8',
      } satisfies GeneratedHandlerReferenceSummaryFact,
    );
    expect(
      generatedRenderedElementFactsFromSource(
        "export function renderSource() { return '<button>Add</button>'; }",
        { tag: 'button' },
      ),
    ).toEqual([
      { attrs: {}, innerHtml: 'Add', tag: 'button' } satisfies GeneratedRenderedElementFact,
    ]);
    expect(
      generatedRenderedElementFactsFromArtifact([
        { kind: 'server', source: "export function renderSource() { return '<main></main>'; }" },
      ]),
    ).toEqual([{ attrs: {}, innerHtml: '', tag: 'main' }]);
    expect(
      generatedCssScopeRulesFromArtifact([
        { kind: 'css', source: '@scope (doc-card) to (:scope [fw-c]) {' },
      ]),
    ).toEqual([
      {
        limit: ':scope [fw-c]',
        raw: '@scope (doc-card) to (:scope [fw-c]) {',
        scope: 'doc-card',
      },
    ]);
    expect(generatedClientExportTypeFacts({ Cart$click: () => undefined }, ['Cart$click'])).toEqual(
      {
        Cart$click: 'function',
      },
    );
    expect(generatedRegistryInterfaceMemberTypes).toBeTypeOf('function');
    expect(assertGeneratedRegistryConsumerTypes).toBeTypeOf('function');
    expect(typeof executeInlineEnhancedFormLoaderFixture).toBe('function');
    expectTypeOf<InlineEnhancedFormLoaderFact>().toMatchTypeOf<{
      listenerEvents: string[];
    }>();
    expectTypeOf<GeneratedMinifierNamePreservationBehaviorFact>()
      .toHaveProperty('reservedNames')
      .toEqualTypeOf<string[]>();
    expectTypeOf<GeneratedRenderEquivalenceBehaviorFact>()
      .toHaveProperty('mismatchRejected')
      .toEqualTypeOf<boolean>();
    expectTypeOf<GeneratedTypedDataParamCoercionBehaviorFact>()
      .toHaveProperty('buttonAttributes')
      .toEqualTypeOf<Array<Record<string, string>>>();
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
  VitePlusAcceptanceTaskFacts,
  VitePlusTaskInputFact,
  VitestTaskCommand,
  VitePlusConfig,
  VitePlusTask,
  WorkflowStepCommand,
  DiagnosticHelpFact,
  DiagnosticOutputFact,
  ViteLoweredEventDiagnosticFact,
  ViteDiagnosticMessageFacts,
  CompilerDiagnosticFact,
  CompilerDiagnosticMessageFact,
  CompilerQueryUpdatePlanFact,
  CompilerQueryShapeFact,
  CompilerUpdateCoverageFact,
  FwExplainEndpointFact,
  FwExplainMutationAssertionFact,
  FwExplainOutput,
  FwExplainPageAssertionFact,
  FwExplainQueryAssertionFact,
  FwExplainResultLike,
  FwExplainScopeAuditFact,
  FwExplainUpdateConsumerFact,
  FwExportCliArtifactFact,
  FwExportCliResultFact,
  FwExportCliResultLike,
  FwExportError,
  FwExportHtmlArtifact,
  FwExportOutput,
  FwExportSummary,
  FwCheckAssertionFact,
  FwCheckCoverageAssertionFact,
  FwCheckCoverageFact,
  FwCheckDiagnosticAssertionFact,
  FwCheckDiagnosticFact,
  FwCheckOkAssertionFact,
  FwCheckOutput,
  FwCheckResultFact,
  GraphInvalidationMatrix,
  GraphQueryConsumerFact,
  ForbiddenBrowserArchitectureFact,
  ProjectFileSourceFact,
  ProjectFileTreeOptions,
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
  MarkdownBoldSectionHeading,
  McpCompileDiagnosticFact,
  McpCompileResponseFact,
  McpJsonRpcResponseFact,
  CssScopeRuleFact,
  ModuleImportFailureFact,
  ProjectSourceLineFact,
  ProjectSourceSiteFact,
  TouchGraphProvenanceHonestyFact,
  TouchGraphProvenanceFact,
  TouchGraphSourceFact,
  TouchGraphSummaryEntryFact,
  StarterClientTemplateBehaviorFact,
  StarterClientTemplateFixture,
  StarterTemplateFacts,
  StarterTemplateIndexHtmlFacts,
  StarterTemplatePackageFacts,
  StarterTemplateSources,
  WireFixture,
  WireTranscriptExchange,
  WireTranscriptResponse,
  ParsedSqlOperation,
  TypeScriptInterfaceMemberTypes,
  GeneratedHandlerReferenceFact,
  GeneratedRegistryConsumerTypeOptions,
  DbObservationOptions,
  DbVerificationConfig,
  DbVerificationDiagnostic,
  DirectDbVerificationDiagnostic,
  DbVerifier,
  ObservedDbOperation,
  ViteGeneratedHandlerMiddlewareFact,
  ViteHandlerTransformFact,
  VitePluginLike,
  VitePluginMiddlewareFact,
  ViteRedGreenBuildFixtureFact,
  ViteTransformElementFact,
];
