// v1-cleanup item 1: kept whole intentionally. This is a single cohesive
// public-API acceptance surface — its assertions all depend on one full-surface
// import manifest of every @kovojs/test subpath export plus every
// @kovojs/conformance-fixtures fixture subpath, so splitting would only
// duplicate that manifest and fragment a deliberately holistic "every canonical
// subpath resolves and type-matches" check into pieces that
// individually assert nothing meaningful. The fixture subpaths moved to the
// private @kovojs/conformance-fixtures package (api-cleanup R5); this suite
// lives here because that package can import both the public @kovojs/test subpath
// surface and its own fixtures while keeping the dependency graph acyclic.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type MutationErrorExpectation,
  type PropertyTestOptions,
  type PropertyTestResult,
} from '@kovojs/test/assertions';
import {
  commerceDeclaredQueriesHarnessFact,
  commerceFixtureFile,
  commerceHarnessQueryFact,
  commerceMutationQueryAcceptanceFact,
  commerceUpdateIntentFact,
  type CommerceDeclaredQueriesHarnessFact,
  type CommerceDeclaredQueriesHarnessOptions,
  type CommerceHarnessQueryFact,
  type CommerceHarnessQueryOptions,
  type CommerceMutationQueryAcceptanceFact,
  type CommerceMutationQueryAcceptanceOptions,
  type CommerceUpdateIntentFact,
  type CommerceUpdateIntentOptions,
} from '@kovojs/conformance-fixtures/commerce-fixtures';
import {
  assertOrderedItems,
  browserSuiteAcceptanceGateFact,
  browserSuiteAcceptanceModulePath,
  browserSuiteAcceptanceProjectFact,
  commandOutputLines,
  commandSequence,
  commandSequenceWithoutLast,
  conformanceGateFacts,
  loadVitePlusConfig,
  nodeTaskCommand,
  pnpmFilterTestCommands,
  pnpmRunScriptNames,
  p10PerfAcceptanceGateFact,
  p10PerfAcceptanceModulePath,
  p10PerfAcceptanceProjectFact,
  requiredVpRunTaskName,
  runCapturedCliCommand,
  runCommandSequenceSync,
  vitePlusAcceptanceTaskFacts,
  vitePlusTaskInputFacts,
  vitePlusTaskInputPatternEndingWith,
  vitestTaskCommand,
  vpRunTaskName,
  workflowVpRunTaskNames,
  workflowStepCommands,
  type BrowserSuiteAcceptanceGateFact,
  type BrowserSuiteAcceptanceShape,
  type CapturedCliCommandResult,
  type CliMainCommand,
  type ConformanceGateFacts,
  type CommandInvocation,
  type NodeTaskCommand,
  type P10PerfAcceptanceGateFact,
  type P10PerfAcceptanceProjectFactOptions,
  type P10PerfAcceptanceShape,
  type PnpmFilterTestCommand,
  type VitePlusAcceptanceTaskFacts,
  type VitePlusTaskInputFact,
  type VitestTaskCommand,
  type VitePlusConfig,
  type VitePlusTask,
  type WorkflowStepCommand,
} from '@kovojs/conformance-fixtures/command-fixtures';
import {
  compilerDataBindBehaviorFact,
  compilerDiagnosticMessageFacts,
  compilerDiagnosticFacts,
  compilerGeneratedQueryShapeFact,
  compilerLoweredIrKovoCheckBehaviorFact,
  compilerQueryUpdatePlanFacts,
  compilerUpdateCoverageFacts,
  type CompilerDataBindBehaviorFact,
  type CompilerDeriveFact,
  type CompilerDiagnosticFact,
  type CompilerDiagnosticMessageFact,
  type CompilerLoweredIrKovoCheckBehaviorFact,
  type CompilerQueryUpdatePlanFact,
  type CompilerQueryShapeFact,
  type CompilerStampFact,
  type CompilerUpdateCoverageFact,
} from '@kovojs/conformance-fixtures/compiler-fixtures';
import {
  viteLoweredEventDiagnosticFact,
  viteDiagnosticMessageFacts,
  viteDiagnosticMessageFactsFromOutput,
  type DiagnosticHelpFact,
  type DiagnosticOutputFact,
  type ViteLoweredEventDiagnosticFact,
  type ViteDiagnosticMessageFacts,
} from '@kovojs/conformance-fixtures/diagnostic-output-fixtures';
import {
  kovoExportCliResultFact,
  kovoExportStaticBehaviorFact,
  parseKovoExportOutput,
  type KovoExportCliArtifactFact,
  type KovoExportCliResultFact,
  type KovoExportCliResultLike,
  type KovoExportError,
  type KovoExportHtmlArtifact,
  type KovoExportOutput,
  type KovoExportStaticBehaviorFact,
  type KovoExportStaticBehaviorOptions,
  type KovoExportStaticDiagnosticLike,
  type KovoExportSummary,
} from '@kovojs/conformance-fixtures/kovo-export-fixtures';
import {
  kovoCheckAssertionFact,
  kovoCheckCoverageAssertionFacts,
  kovoCheckCoverageFacts,
  kovoCheckDiagnosticAssertionFacts,
  kovoCheckDiagnosticFacts,
  kovoCheckOkAssertionFact,
  kovoCheckOptimisticProofAssertionFacts,
  kovoCheckOptimisticProofFacts,
  kovoCheckResultFact,
  kovoCheckUnguardedAuditBehaviorFact,
  parseKovoCheckOutput,
  type KovoCheckAssertionFact,
  type KovoCheckCoverageAssertionFact,
  type KovoCheckCoverageFact,
  type KovoCheckDiagnosticAssertionFact,
  type KovoCheckDiagnosticFact,
  type KovoCheckOkAssertionFact,
  type KovoCheckOptimisticProofAssertionFact,
  type KovoCheckOptimisticProofFact,
  type KovoCheckOutput,
  type KovoCheckResultFact,
  type KovoCheckUnguardedAuditBehaviorFact,
} from '@kovojs/conformance-fixtures/kovo-check-fixtures';
import {
  kovoExplainComponentAssertionFact,
  kovoExplainComponentDeriveFacts,
  kovoExplainComponentHandlerFacts,
  kovoExplainComponentMergeFacts,
  kovoExplainComponentTriggerFacts,
  kovoExplainEndpointFacts,
  kovoExplainField,
  kovoExplainListField,
  kovoExplainMutationAssertionFact,
  kovoExplainMutationQueryMatrixFact,
  kovoExplainOptimisticStatuses,
  kovoExplainPageAssertionFact,
  kovoExplainQueryAssertionFact,
  kovoExplainRecords,
  kovoExplainScopeAuditFacts,
  kovoExplainSummary,
  kovoExplainUnguardedAssertionFact,
  kovoExplainUnguardedFacts,
  kovoExplainUpdateConsumerMap,
  kovoExplainUpdateConsumers,
  kovoExplainUpdateTargets,
  parseKovoExplainOutput,
  type KovoExplainComponentAssertionFact,
  type KovoExplainComponentDeriveFact,
  type KovoExplainComponentHandlerFact,
  type KovoExplainComponentMergeFact,
  type KovoExplainComponentTriggerFact,
  type KovoExplainEndpointFact,
  type KovoExplainMutationAssertionFact,
  type KovoExplainOutput,
  type KovoExplainPageAssertionFact,
  type KovoExplainQueryAssertionFact,
  type KovoExplainResultLike,
  type KovoExplainScopeAuditFact,
  type KovoExplainUnguardedAssertionFact,
  type KovoExplainUnguardedFact,
  type KovoExplainUpdateConsumerFact,
} from '@kovojs/conformance-fixtures/kovo-explain-fixtures';
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
  generatedTypedRouteNavigationBehaviorFact,
  generatedViewTransitionStampBehaviorFact,
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
  type GeneratedTypedRouteNavigationBehaviorFact,
  type GeneratedViewTransitionStampBehaviorFact,
  GeneratedFixtureElement,
  GeneratedFixtureMorphRoot,
  GeneratedFixtureMorphTarget,
  GeneratedFixtureTemplateStampHost,
  type GeneratedHandlerReferenceFact,
  type GeneratedHandlerReferenceSummaryFact,
  type GeneratedRenderedElementFact,
  type InlineEnhancedFormLoaderFact,
} from '@kovojs/conformance-fixtures/generated-module-fixtures';
import {
  commerceGraphBehaviorFact,
  generatedGraphArtifactAcceptanceChecklistFact,
  generatedGraphArtifactAcceptanceEvidenceFact,
  generatedGraphArtifactAcceptanceProjectFact,
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
  type CommerceGraphBehaviorFact,
  type CommerceGraphBehaviorOptions,
  type CommerceGraphComponentGraphFact,
  type CommerceGraphCompilerComponentFact,
  type CommerceGraphCompilerRegistryFact,
  type GeneratedGraphArtifactAcceptanceChecklistFact,
  type GeneratedGraphArtifactAcceptanceEvidenceFact,
  type GeneratedGraphArtifactHonestyFact,
  type GraphInvalidationMatrix,
  type GraphQueryConsumerFact,
  type ProjectGraphFixture,
} from '@kovojs/conformance-fixtures/graph-fixtures';
import {
  type DbVerificationDiagnostic,
  type KovoTestContext,
  type KovoTestExecOptions,
  type KovoTestHarnessOptions,
  type PageAssertion,
} from '@kovojs/test/harness';
import {
  executeHarnessMutation,
  executeHarnessQuery,
  loadHarnessPage,
  type HarnessMutationOptions,
  type HarnessOperationVerifier,
} from '@kovojs/test/internal/harness-operations';
import {
  cookiePair,
  firstSetCookiePair,
  headerValues,
  setCookieValues,
  type HeaderRecord,
} from '@kovojs/test/headers';
import {
  fragmentHtml,
  kovoQueryJsonValues,
  htmlDocumentFacts,
  htmlElementCount,
  htmlElementFacts,
  htmlFormActions,
  htmlFormFacts,
  htmlFormFieldsByName,
  htmlFormFields,
  htmlKeyValues,
  htmlTextContent,
  htmlKeyFacts,
  htmlKeyTextMap,
  htmlLinkHrefs,
} from '@kovojs/test/html-fragment';
import {
  documentQueryScriptBehaviorFact,
  kovoFragmentFacts,
  kovoQueryFacts,
  kovoResponseBodyFact,
  htmlDocumentRegions,
  htmlJsonScriptFacts,
  htmlMainMarkerFact,
  type DocumentQueryScriptBehaviorFact,
} from '@kovojs/test/internal/html-wire';
import {
  markdownBoldSectionHeadings,
  markdownCanonicalSpecRuleTitle,
  markdownCanonicalSpecRuleTitles,
  markdownFields,
  markdownLeadingTitle,
  legibilityStudyGateFact,
  markdownNumberedListItems,
  markdownNumberedListTitles,
  normativeDocsGateFact,
  prelaunchChecklistGateFact,
  markdownSection,
  markdownTableRows,
  normalizeMarkdownCell,
  v1AcceptanceLedgerGateFact,
  type LegibilityStudyGateFact,
  type MarkdownBoldSectionHeading,
  type MarkdownFields,
  type MarkdownTableRow,
  type NormativeDocsGateFact,
  type PrelaunchChecklistGateFact,
  type V1AcceptanceLedgerGateFact,
} from '@kovojs/conformance-fixtures/markdown-fixtures';
import {
  mcpCompileResponseFacts,
  mcpJsonRpcResponseFacts,
  type McpCompileDiagnosticFact,
  type McpCompileResponseFact,
  type McpJsonRpcResponseFact,
} from '@kovojs/conformance-fixtures/mcp-fixtures';
import { createPageAssertion } from '@kovojs/test/internal/page';
import type { PgliteTestDb } from '@kovojs/test/pglite';
import {
  enhancedMutationBehaviorFact,
  loaderSmokeBehaviorFact,
  morphFragmentBehaviorFact,
  optimismCleanupBehaviorFact,
  type EnhancedMutationBehaviorFact,
  type EnhancedMutationRuntime,
  type LoaderSmokeBehaviorFact,
  type LoaderSmokeRuntime,
  type MorphFragmentBehaviorFact,
  type MorphFragmentRuntime,
  type OptimismCleanupBehaviorFact,
  type OptimismCleanupRuntime,
} from '@kovojs/conformance-fixtures/runtime-fixtures';
import {
  serverCommerceAdoptDontInventBehaviorFact,
  serverCommerceStylesheetBehaviorFact,
  serverCommerceTransactionBehaviorFact,
  serverDataPlaneBehaviorFact,
  serverMutationLifecycleBehaviorFact,
  serverPageHintsBehaviorFact,
  type ServerCommerceAdoptDontInventBehaviorFact,
  type ServerCommerceAdoptDontInventRuntime,
  type ServerCommerceStylesheetBehaviorFact,
  type ServerCommerceStylesheetRuntime,
  type ServerCommerceTransactionBehaviorFact,
  type ServerDataPlaneBehaviorFact,
  type ServerDataPlaneRuntime,
  type ServerMutationLifecycleBehaviorFact,
  type ServerMutationLifecycleRuntime,
  type ServerPageHintsBehaviorFact,
  type ServerPageHintsRuntime,
} from '@kovojs/conformance-fixtures/server-fixtures';
import {
  cssLayerNames,
  cssScopeRules,
  drizzleQueryBehaviorSourceFixtures,
  forbiddenBrowserArchitectureFacts,
  forbiddenBrowserArchitectureProjectFact,
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
  type ForbiddenBrowserArchitectureProjectFact,
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
} from '@kovojs/conformance-fixtures/source-fixtures';
import {
  executeStarterClientTemplate,
  runPnpmFilterTaskCommand,
  runStarterTemplateGraphAssertions,
  runStarterTemplateViteTaskCommand,
  starterClientTemplateBehaviorFact,
  starterTemplateAcceptanceFact,
  starterTemplateFacts,
  type StarterTemplateAcceptanceFact,
  type StarterTemplateAcceptanceOptions,
  type StarterClientTemplateBehaviorFact,
  type StarterClientTemplateFixture,
  type StarterTemplateFacts,
  type StarterTemplateIndexHtmlFacts,
  type StarterTemplatePackageFacts,
  type StarterTemplateSources,
} from '@kovojs/conformance-fixtures/starter-template-fixtures';
import { observeSqlStatementArgument, sqlStatementText } from '@kovojs/test/internal/sql-observer';
import type { KovoTestCase, KovoTestRunner } from '@kovojs/test/test-case';
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
} from '@kovojs/conformance-fixtures/touch-graph-fixtures';
import {
  assertTypeScriptProgramHasNoDiagnostics,
  type TypeScriptInterfaceMemberTypes,
  typeScriptInterfaceMemberTypes,
} from '@kovojs/conformance-fixtures/typescript-fixtures';
import {
  type DbObservationOptions,
  type DbVerificationConfig,
  type DbVerifier,
  type ObservedDbOperation,
} from '@kovojs/test/internal/verifier';
import {
  diagnosticMessage,
  diagnosticsForObservations,
} from '@kovojs/test/internal/verifier-diagnostics';
import {
  createVerificationFakeDb,
  verificationLayerBehaviorFact,
  verificationLayerKovoCheckDiagnosticsFact,
  type VerificationLayerBehaviorFact,
  type VerificationLayerKovoCheckDiagnosticsFact,
  type VerificationLayerKovoCheckDiagnosticsRuntime,
  type VerificationLayerRuntime,
} from '@kovojs/conformance-fixtures/verification-fixtures';
import { parseSqlOperations, type ParsedSqlOperation } from '@kovojs/test/internal/verifier-sql';
import {
  viteGeneratedHandlerMiddlewareFact,
  viteHandlerTransformFact,
  vitePluginMiddlewareFact,
  viteProductionEmitContractFact,
  viteRedGreenBuildFixtureFact,
  viteTransformElementFact,
  type ViteGeneratedHandlerMiddlewareFact,
  type ViteHandlerTransformFact,
  type VitePluginLike,
  type VitePluginMiddlewareFact,
  type ViteProductionEmitContractFact,
  type ViteProductionEmitContractOptions,
  type ViteRedGreenBuildFixtureFact,
  type ViteTransformElementFact,
} from '@kovojs/conformance-fixtures/vite-fixtures';
import {
  generatedWireResponseBodies,
  loadWireFixtureSources,
  parseWireFixture,
  parseWireResponses,
  wireFixtureContentTypesFacts,
  wireFixturePresenceFacts,
  wireFixtureResponseBody,
  wireFixturesWithContentType,
  wireFragmentModeFacts,
  wireResponseBodyPinFacts,
  wireResponseMetadataFacts,
  type WireFixture,
  type WireFixtureContentTypesFact,
  type WireFixturePresenceFact,
  type WireFixtureSource,
  type WireFragmentModeFact,
  type WireResponseBodyPinFact,
  type WireResponseMetadataFact,
  type WireTranscriptExchange,
  type WireTranscriptResponse,
} from '@kovojs/conformance-fixtures/wire-fixtures';

describe('@kovojs/test package subpath exports', () => {
  it('resolves seam-specific public modules from canonical subpaths', () => {
    expect(createVerificationFakeDb().read('cart_items')).toEqual([]);
    expect(verificationLayerBehaviorFact).toBeTypeOf('function');
    expect(verificationLayerKovoCheckDiagnosticsFact).toBeTypeOf('function');
    expect(commerceDeclaredQueriesHarnessFact).toBeTypeOf('function');
    expect(commerceFixtureFile).toBeTypeOf('function');
    expect(commerceHarnessQueryFact).toBeTypeOf('function');
    expect(commerceMutationQueryAcceptanceFact).toBeTypeOf('function');
    expect(commerceUpdateIntentFact).toBeTypeOf('function');
    expect(enhancedMutationBehaviorFact).toBeTypeOf('function');
    expect(loaderSmokeBehaviorFact).toBeTypeOf('function');
    expect(morphFragmentBehaviorFact).toBeTypeOf('function');
    expect(optimismCleanupBehaviorFact).toBeTypeOf('function');
    expect(serverMutationLifecycleBehaviorFact).toBeTypeOf('function');
    expect(serverDataPlaneBehaviorFact).toBeTypeOf('function');
    expect(serverCommerceTransactionBehaviorFact).toBeTypeOf('function');
    expect(serverCommerceStylesheetBehaviorFact).toBeTypeOf('function');
    expect(serverCommerceAdoptDontInventBehaviorFact).toBeTypeOf('function');
    expect(serverPageHintsBehaviorFact).toBeTypeOf('function');
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
    expectTypeOf<ServerPageHintsBehaviorFact>().toMatchTypeOf<{
      deduplicatedRules: unknown;
      emptyOptInHtml: string;
    }>();
    expectTypeOf<ServerPageHintsRuntime>().toMatchTypeOf<{
      renderPageHints(...args: any[]): { html: string };
    }>();
    expectTypeOf<LoaderSmokeRuntime>().toMatchTypeOf<{
      createQueryStore: () => unknown;
    }>();
    expectTypeOf<MorphFragmentBehaviorFact>().toMatchTypeOf<{
      keyedIdentity: { firstItemReusedAfterReorder: boolean; secondItemReusedAtFront: boolean };
    }>();
    expectTypeOf<MorphFragmentRuntime>().toMatchTypeOf<{
      createQueryStore: () => unknown;
    }>();
    expectTypeOf<OptimismCleanupBehaviorFact>().toMatchTypeOf<{
      pendingCounts: { afterPagehide: number; afterResponse: number; afterSubmit: number };
    }>();
    expectTypeOf<OptimismCleanupRuntime>().toMatchTypeOf<{
      createQueryStore: () => unknown;
    }>();
    expectTypeOf<EnhancedMutationBehaviorFact>().toMatchTypeOf<{
      optimistic: { pendingAfterResponse: string | null; resultQueries: string[] };
    }>();
    expectTypeOf<EnhancedMutationRuntime>().toMatchTypeOf<{
      submitEnhancedMutation: (options: unknown) => Promise<unknown>;
    }>();
    expectTypeOf<ServerMutationLifecycleBehaviorFact>().toMatchTypeOf<{
      fragmentResponse: Record<string, unknown>;
    }>();
    expectTypeOf<ServerMutationLifecycleRuntime>().toMatchTypeOf<{
      runMutation: (...args: any[]) => Promise<Record<string, unknown>>;
    }>();
    expectTypeOf<ServerDataPlaneBehaviorFact>().toMatchTypeOf<{
      csrf: { guardCallsAfterFailure: number; guardCallsAfterSuccess: number };
    }>();
    expectTypeOf<ServerDataPlaneRuntime>().toMatchTypeOf<{
      runQuery: (...args: any[]) => Promise<Record<string, unknown>>;
    }>();
    expectTypeOf<ServerCommerceTransactionBehaviorFact>().toMatchTypeOf<{
      failed: { db: Record<string, unknown>; result: Record<string, unknown> };
    }>();
    expectTypeOf<ServerCommerceStylesheetBehaviorFact>().toMatchTypeOf<{
      deferred: { tags: string[] };
      selectedStylesheets: Array<Record<string, unknown>>;
    }>();
    expectTypeOf<ServerCommerceStylesheetRuntime>().toMatchTypeOf<{
      renderDeferredStream: (...args: any[]) => unknown;
      stylesheetsForTargets: (...args: any[]) => Array<Record<string, unknown>>;
    }>();
    expectTypeOf<ServerCommerceAdoptDontInventBehaviorFact>().toMatchTypeOf<{
      graph: { cartPage: Record<string, unknown>; receiptMutation: Record<string, unknown> };
      upload: { pendingAfterSubmit: string | null };
    }>();
    expectTypeOf<ServerCommerceAdoptDontInventRuntime>().toMatchTypeOf<{
      submitEnhancedMutation: (options: Record<string, unknown>) => Promise<unknown>;
    }>();
    expectTypeOf<VerificationLayerBehaviorFact>().toMatchTypeOf<{
      failures: Record<string, string>;
    }>();
    expectTypeOf<VerificationLayerRuntime>().toMatchTypeOf<{
      createDbVerifier: (...args: any[]) => unknown;
    }>();
    expectTypeOf<VerificationLayerKovoCheckDiagnosticsFact>().toMatchTypeOf<{
      exemptTableDiagnostic: { diagnostics: unknown[] };
      verificationDiagnostics: { diagnostics: unknown[] };
    }>();
    expectTypeOf<VerificationLayerKovoCheckDiagnosticsRuntime>().toMatchTypeOf<{
      kovoCheck: (...args: any[]) => { exitCode: number; output: string };
    }>();
    expectTypeOf<CommerceMutationQueryAcceptanceFact>().toMatchTypeOf<{
      addToCart: { updateQueries: string[] };
      fragmentResponse: { expectedFragmentTargets: string[] };
    }>();
    expectTypeOf<CommerceMutationQueryAcceptanceOptions<unknown, { components: [] }>>()
      .toHaveProperty('kovoExplain')
      .toMatchTypeOf<unknown>();
    expectTypeOf<CommerceHarnessQueryFact>().toMatchTypeOf<{
      diagnostics: readonly unknown[];
      result: unknown;
    }>();
    expectTypeOf<CommerceHarnessQueryOptions<unknown>>()
      .toHaveProperty('createDb')
      .toMatchTypeOf<() => unknown>();
    expectTypeOf<CommerceDeclaredQueriesHarnessFact>().toMatchTypeOf<
      Record<string, { diagnostics: readonly unknown[]; result: unknown }>
    >();
    expectTypeOf<CommerceDeclaredQueriesHarnessOptions<unknown>>()
      .toHaveProperty('queries')
      .toMatchTypeOf<Record<string, unknown>>();
    expectTypeOf<CommerceUpdateIntentFact>().toMatchTypeOf<{
      missingComponentConsumers: string[];
      pageQueries: string[];
    }>();
    expectTypeOf<CommerceUpdateIntentOptions<{ components: [] }>>()
      .toHaveProperty('kovoExplain')
      .toMatchTypeOf<unknown>();
  });

  it('keeps subpath-only helpers available through their owning modules', () => {
    expect(createPageAssertion('<main id="cart">Cart</main>').fragment('cart')).toBe(
      '<main id="cart">Cart</main>',
    );
    expect(
      fragmentHtml(
        '<kovo-fragment target="cart"><cart-badge>1</cart-badge></kovo-fragment>',
        'cart',
      ),
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
        '<html><head><link rel="stylesheet" href="/assets/styles.css"></head><body>Ready</body></html>',
      ).head.tag,
    ).toBe('head');
    expect(
      htmlLinkHrefs(
        '<link rel="modulepreload" href="/c/app.js"><link rel="stylesheet" href="/assets/styles.css">',
        { rel: 'stylesheet' },
      ),
    ).toEqual(['/assets/styles.css']);
    expect(htmlMainMarkerFact('<main data-kovo-check-export="api"></main>')).toEqual({
      attribute: 'data-kovo-check-export',
      mainCount: 1,
      marker: 'api',
    });
    expect(
      documentQueryScriptBehaviorFact(
        '<html><head><script type="application/json" kovo-query="cart">{"count":1}</script></head><body><main></main></body></html>',
        {
          queryName: 'cart',
          renderedDocumentQueryScript:
            '<script type="application/json" kovo-query="cart">{"count":1}</script>',
          renderedQueryScript:
            '<script type="application/json" kovo-query="cart">{"count":1}</script>',
        },
      ),
    ).toMatchObject({
      bodyElements: [{ tag: 'main' }],
      documentQueryScripts: [{ rawJson: '{"count":1}' }],
    });
    expect(
      htmlJsonScriptFacts('<script type="application/json" data-id="cart">{"count":1}</script>', {
        'data-id': 'cart',
      }),
    ).toMatchObject([{ json: { count: 1 }, rawJson: '{"count":1}' }]);
    expect(
      kovoQueryFacts('<kovo-query name="cart">{"count":1}</kovo-query>', 'cart'),
    ).toMatchObject([{ json: { count: 1 }, name: 'cart' }]);
    expect(
      kovoFragmentFacts(
        '<kovo-fragment target="cart"><link rel="stylesheet" href="/assets/styles.css"></kovo-fragment>',
        'cart',
      ),
    ).toMatchObject([{ stylesheetHrefs: ['/assets/styles.css'], target: 'cart' }]);
    expect(
      kovoResponseBodyFact(
        '<kovo-query name="cart">{"count":1}</kovo-query><kovo-fragment target="cart"><article kovo-key="order-1">Order</article></kovo-fragment>',
      ),
    ).toMatchObject({
      fragmentTargets: ['cart'],
      keyValues: ['order-1'],
      queryJsonByName: { cart: [{ count: 1 }] },
      queryNames: ['cart'],
    });
    expect(kovoQueryJsonValues('<kovo-query name="cart">{"count":1}</kovo-query>', 'cart')).toEqual(
      [{ count: 1 }],
    );
    expect(
      htmlFormFacts(
        '<form method="post" action="/_m/cart/add"><input name="productId" value="p1"></form>',
      ),
    ).toMatchObject([{ action: '/_m/cart/add', fields: [{ name: 'productId', value: 'p1' }] }]);
    expect(
      htmlFormActions(
        '<form action="/_m/cart/add"></form><form action="/_m/auth/sign-out"></form>',
      ),
    ).toEqual(['/_m/cart/add', '/_m/auth/sign-out']);
    expect(
      htmlFormFields(
        '<form><input name="productId" value="p1"><input name="quantity" value="2"></form>',
        'quantity',
      ),
    ).toMatchObject([{ name: 'quantity', value: '2' }]);
    expect(
      htmlFormFieldsByName(htmlFormFacts('<form><input name="productId" value="p1"></form>')[0]),
    ).toMatchObject({ productId: { value: 'p1' } });
    expect(htmlKeyFacts('<li kovo-key="order-1"><span>Order</span></li>', 'order-1')).toMatchObject(
      [{ key: 'order-1', text: 'Order' }],
    );
    expect(htmlKeyValues('<li kovo-key="order-1">Order</li>')).toEqual(['order-1']);
    expect(htmlKeyTextMap('<li kovo-key="order-1"><span>Order</span></li>')).toEqual({
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
    expect(normativeDocsGateFact).toBeTypeOf('function');
    expect(v1AcceptanceLedgerGateFact).toBeTypeOf('function');
    expect(legibilityStudyGateFact).toBeTypeOf('function');
    expect(prelaunchChecklistGateFact).toBeTypeOf('function');
    expectTypeOf<NormativeDocsGateFact>().toMatchTypeOf<{
      compilerRuleTitles: string[];
      renderEquivalenceAsserted: boolean;
    }>();
    expectTypeOf<V1AcceptanceLedgerGateFact>().toMatchTypeOf<{
      gateCriteria: string[];
      gateCriteriaMatchRule: boolean;
      runFacts: Array<{ command: string; commit: string; result: string }>;
    }>();
    expectTypeOf<LegibilityStudyGateFact>().toMatchTypeOf<{
      resultFacts: Array<{ commit: string; date: string; participant: string; result: string }>;
      taskNames: string[];
    }>();
    expectTypeOf<PrelaunchChecklistGateFact>().toMatchTypeOf<{
      auditStatuses: Record<string, string>;
      evidenceStatuses: string[];
      requiredChecks: string[];
    }>();
    expect(
      mcpCompileResponseFacts(
        JSON.stringify({
          id: 'compile',
          result: {
            structuredContent: {
              diagnostics: [{ code: 'KV201', severity: 'error' }],
              ok: false,
              version: 'compile/v1',
            },
            version: 'kovo-mcp/v1',
          },
        }),
      ),
    ).toEqual([
      {
        contentVersion: 'compile/v1',
        diagnostics: [{ code: 'KV201', severity: 'error' }],
        id: 'compile',
        ok: false,
        version: 'kovo-mcp/v1',
      },
    ]);
    expect(mcpJsonRpcResponseFacts).toBeTypeOf('function');
    expect(generatedMinifierNamePreservationBehaviorFact).toBeTypeOf('function');
    expect(generatedQueryUpdatePlanBehaviorFact).toBeTypeOf('function');
    expect(generatedRenderEquivalenceBehaviorFact).toBeTypeOf('function');
    expect(generatedBootstrapDeferredBehaviorFact).toBeTypeOf('function');
    expect(generatedServerDeferredBehaviorFact).toBeTypeOf('function');
    expect(generatedTypedDataParamCoercionBehaviorFact).toBeTypeOf('function');
    expect(generatedTypedRouteNavigationBehaviorFact).toBeTypeOf('function');
    expect(generatedViewTransitionStampBehaviorFact).toBeTypeOf('function');
    expect(generatedWireDeferredBehaviorFact).toBeTypeOf('function');
    expect(cssLayerNames('@layer kovo-starter-base;')).toEqual(['kovo-starter-base']);
    expect(cssScopeRules('@scope (doc-card) to (:scope [kovo-c]) {')).toEqual([
      {
        limit: ':scope [kovo-c]',
        raw: '@scope (doc-card) to (:scope [kovo-c]) {',
        scope: 'doc-card',
      },
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
            { code: 'KV410', message: 'message', severity: 'error', site: 'cart.ts:1' },
          ],
          query: 'cart',
          reads: ['cart'],
          shape: { count: 'number' },
          site: 'cart.ts:1',
        },
      ]),
    ).toEqual([{ code: 'KV410', message: 'message', severity: 'error', site: 'cart.ts:1' }]);
    expect(projectTouchGraphBehaviorFacts({ addItem: {} })).toEqual({
      addItem: { reads: [], touches: [], unresolved: [] },
    });
    expect(forbiddenBrowserArchitectureFacts).toBeTypeOf('function');
    expect(forbiddenBrowserArchitectureProjectFact).toBeTypeOf('function');
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
    expectTypeOf<ForbiddenBrowserArchitectureProjectFact>()
      .toHaveProperty('violations')
      .toEqualTypeOf<ForbiddenBrowserArchitectureFact[]>();
    expectTypeOf<ProjectPackageManifestFact>().toHaveProperty('directory').toEqualTypeOf<string>();
    expect(graphFixtureFile).toBeTypeOf('function');
    expect(commerceGraphBehaviorFact).toBeTypeOf('function');
    expect(generatedGraphArtifactAcceptanceProjectFact).toBeTypeOf('function');
    expectTypeOf<CommerceGraphBehaviorFact>().toHaveProperty('kovoCheck').toMatchTypeOf<unknown>();
    expectTypeOf<CommerceGraphBehaviorOptions<ProjectGraphFixture>>()
      .toHaveProperty('graph')
      .toMatchTypeOf<ProjectGraphFixture>();
    expectTypeOf<CommerceGraphCompilerComponentFact>()
      .toHaveProperty('componentGraphFacts')
      .toMatchTypeOf<readonly CommerceGraphComponentGraphFact[]>();
    expectTypeOf<CommerceGraphCompilerRegistryFact>()
      .toHaveProperty('registryFacts')
      .toMatchTypeOf<unknown>();
    expectTypeOf<GeneratedGraphArtifactHonestyFact>().toMatchTypeOf<{
      emitCheck: { clean: boolean };
    }>();
    expectTypeOf<GeneratedViewTransitionStampBehaviorFact>().toMatchTypeOf<{
      jsxPropPreserved: boolean;
      viewTransitionNames: string[];
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
          'Kovo Vite transform failed with 1 error diagnostic.',
          '',
          'KV201 routes/card.tsx:1:1 message.',
          '  help: Element params: -',
        ].join('\n'),
      ).diagnostics[0]?.help,
    ).toEqual([{ label: 'Element params', text: '-' }]);
    expect(
      viteDiagnosticMessageFactsFromOutput(
        'prefix\nKovo Vite transform failed with 1 error diagnostic.\n\nKV201 x.ts:1:1 message.',
      ).summary,
    ).toBe('Kovo Vite transform failed with 1 error diagnostic.');
    expect(
      viteLoweredEventDiagnosticFact(
        [
          'Kovo Vite transform failed with 1 error diagnostic.',
          '',
          'KV201 routes/card.tsx:1:1 message.',
          '  help: Would lower to: on:click="/c/__v/3853abab13e04603-1234abcd/routes/card.client.js#Card$click"',
          '  help: Element params: -',
        ].join('\n'),
      ).loweredHandler,
    ).toEqual({
      handlerName: 'Card$click',
      modulePath: '/c/routes/card.client.js',
      versionShape: 'render-plan-hex-16-plus-hash-hex-8',
    });
    expect(starterTemplateFacts).toBeTypeOf('function');
    expect(starterTemplateAcceptanceFact).toBeTypeOf('function');
    expect(executeStarterClientTemplate).toBeTypeOf('function');
    expect(starterClientTemplateBehaviorFact).toBeTypeOf('function');
    expect(runStarterTemplateGraphAssertions).toBeTypeOf('function');
    expect(runStarterTemplateViteTaskCommand).toBeTypeOf('function');
    expect(runPnpmFilterTaskCommand).toBeTypeOf('function');
    expect(diagnosticMessage('KV403', 'cart_items')).toContain('cart_items');
    expect(diagnosticsForObservations([], {})).toEqual([]);
    expect(executeHarnessMutation).toBeTypeOf('function');
    expect(executeHarnessQuery).toBeTypeOf('function');
    expect(loadHarnessPage).toBeTypeOf('function');
    expect(observeSqlStatementArgument).toBeTypeOf('function');
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
    expect(viteProductionEmitContractFact).toBeTypeOf('function');
    expect(viteRedGreenBuildFixtureFact).toBeTypeOf('function');
    expect(commandSequence('vp run kovo-check')).toMatchObject([
      { args: ['run', 'kovo-check'], executable: 'vp' },
    ]);
    expect(
      compilerDiagnosticFacts([{ code: 'KV311', message: 'coverage', severity: 'warn' }]),
    ).toEqual([{ code: 'KV311', message: 'coverage', severity: 'warn' }]);
    expect(
      compilerDiagnosticMessageFacts([{ code: 'KV302', message: 'binding', severity: 'error' }]),
    ).toEqual([{ code: 'KV302', message: 'binding' }]);
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
      compilerDataBindBehaviorFact({
        compileComponentModule: () => ({ diagnostics: [], queryUpdatePlans: [] }),
        diagnosticDefinitions: { KV227: { help: 'Use ?.' }, KV302: { message: 'missing path' } },
        queryShapesFromFacts: (facts) => facts.map((fact) => fact.query),
      }),
    ).toMatchObject({
      diagnostics: { KV227Help: 'Use ?.', KV302Message: 'missing path' },
      optionalNullablePathDiagnostics: [],
      queryShapes: ['cart'],
    });
    expect(
      compilerLoweredIrKovoCheckBehaviorFact({
        compileComponentModule: () => ({
          diagnostics: [
            {
              code: 'KV235',
              fileName: 'cart-badge.tsx',
              message: 'lowered IR is not app source',
              severity: 'error',
            },
          ],
        }),
        kovoCheck: () => ({
          exitCode: 1,
          output: 'kovo-check/v1\nERROR KV235 cart-badge.tsx lowered IR is not app source\n',
        }),
      }),
    ).toMatchObject({
      kovoCheck: { exitCode: 1, status: 'issues' },
      specSection: 'SPEC §5.2',
    });
    expect(
      compilerUpdateCoverageFacts([
        { componentName: 'CartBadge', position: 'text', query: 'cart.count', status: 'plan' },
      ]),
    ).toEqual([{ component: 'CartBadge', position: 'text', query: 'cart.count', status: 'plan' }]);
    expectTypeOf<CompilerDataBindBehaviorFact>()
      .toHaveProperty('validCartBindingPlans')
      .toEqualTypeOf<CompilerQueryUpdatePlanFact[]>();
    expectTypeOf<CompilerDeriveFact>().toHaveProperty('selector').toEqualTypeOf<string>();
    expectTypeOf<CompilerDiagnosticFact>().toHaveProperty('code').toEqualTypeOf<string>();
    expectTypeOf<CompilerDiagnosticMessageFact>().toHaveProperty('message').toEqualTypeOf<string>();
    expectTypeOf<CompilerLoweredIrKovoCheckBehaviorFact>()
      .toHaveProperty('specSection')
      .toEqualTypeOf<'SPEC §5.2'>();
    expectTypeOf<CompilerQueryShapeFact>().toHaveProperty('source').toEqualTypeOf<string>();
    expectTypeOf<CompilerStampFact>().toHaveProperty('derive').toEqualTypeOf<CompilerDeriveFact>();
    expectTypeOf<CompilerUpdateCoverageFact>().toHaveProperty('component').toEqualTypeOf<string>();
    expect(commandOutputLines('one\r\ntwo\n')).toEqual(['one', 'two']);
    expect(commandSequenceWithoutLast('vp run build && vp run kovo-check')).toBe('vp run build');
    expect(pnpmRunScriptNames('pnpm run build && pnpm run test:browser')).toEqual([
      'build',
      'test:browser',
    ]);
    expect(
      requiredVpRunTaskName('check:kovo', { scripts: { 'check:kovo': 'vp run kovo-check' } }),
    ).toBe('kovo-check');
    expect(vpRunTaskName('vp run build')).toBe('build');
    expect(vitestTaskCommand('vitest --run --config vitest.browser.config.ts')).toEqual({
      configPath: 'vitest.browser.config.ts',
    });
    expect(nodeTaskCommand('node scripts/perf.mjs')).toEqual({ modulePath: 'scripts/perf.mjs' });
    expect(pnpmFilterTestCommands('pnpm --filter @kovojs/conformance-auth-spike test')).toEqual([
      {
        argv: ['pnpm', '--filter', '@kovojs/conformance-auth-spike', 'test'],
        packageName: '@kovojs/conformance-auth-spike',
        script: 'test',
      },
    ]);
    expect(parseKovoExplainOutput).toBeTypeOf('function');
    expect(kovoExplainField('kovo-explain/v1\nQUERY cart\nreads: cart\n', 'reads')).toBe('cart');
    expect(
      kovoExplainListField(
        'kovo-explain/v1\nMUTATION cart/add\ninput-fields: productId,quantity\n',
        'input-fields',
      ),
    ).toEqual(['productId', 'quantity']);
    expect(
      kovoExplainRecords(
        'kovo-explain/v1\nMUTATION cart/add\nOPTIMISTIC cart plan\n',
        'OPTIMISTIC',
      ),
    ).toEqual(['cart plan']);
    expect(
      kovoExplainOptimisticStatuses(
        'kovo-explain/v1\nMUTATION cart/add\nOPTIMISTIC cart await-fragment\n',
      ),
    ).toEqual({ cart: 'await-fragment' });
    expect(
      kovoExplainSummary(
        'kovo-explain/v1\nMUTATION cart/add\nOPTIMISTIC-SUMMARY total=1 UNHANDLED=0\n',
        'OPTIMISTIC-SUMMARY',
      ),
    ).toMatchObject({ UNHANDLED: '0', total: '1' });
    expect(
      kovoExplainUpdateTargets(
        'kovo-explain/v1\nMUTATION cart/add\nupdates: cart->page:/cart; product->page:/products\n',
      ),
    ).toEqual(['cart->page:/cart', 'product->page:/products']);
    expect(kovoExplainUpdateTargets('kovo-explain/v1\nMUTATION cart/add\nupdates: -\n')).toEqual(
      [],
    );
    expect(
      kovoExplainUpdateConsumers(
        'kovo-explain/v1\nMUTATION cart/add\nupdates: cart->component:CartBadge,page:/cart\n',
      ),
    ).toEqual([{ consumers: ['component:CartBadge', 'page:/cart'], query: 'cart' }]);
    expect(
      Object.fromEntries(
        kovoExplainUpdateConsumerMap(
          'kovo-explain/v1\nMUTATION cart/add\nupdates: cart->page:/cart\n',
        ),
      ),
    ).toEqual({ cart: ['page:/cart'] });
    expect(
      kovoExplainMutationQueryMatrixFact({
        explainMutation: () => ({
          exitCode: 0,
          output:
            'kovo-explain/v1\nMUTATION cart/add\nupdates: cart->page:/cart\nOPTIMISTIC cart hand-written\nOPTIMISTIC-SUMMARY total=1 UNHANDLED=0\n',
        }),
        graph: { mutations: [{ key: 'cart/add' }], queries: [{ query: 'cart' }] },
      }).matrix,
    ).toEqual({ 'cart/add': { cart: 'hand-written' } });
    expect(
      kovoExplainComponentAssertionFact({
        exitCode: 0,
        output: [
          'kovo-explain/v1',
          'COMPONENT CartBadge',
          'queries: cart',
          'fragments: -',
          'HANDLER click export=CartBadge$button_click ref=/cart.js#CartBadge$button_click captures=ctx params=- substitution=-',
          'DERIVE CartBadge$isEmpty inputs=cart ref=/cart.js#CartBadge$isEmpty target=data-bind:hidden',
          'TRIGGER visible export=CartBadge$mount ref=/cart.js#CartBadge$mount deps=cart justification=below the fold',
          'MERGE button attr=aria-expanded rule=primitive-owned decision=primitive diagnostics=-',
          '',
        ].join('\n'),
      }),
    ).toMatchObject({
      derives: [{ inputs: ['cart'], name: 'CartBadge$isEmpty', target: 'data-bind:hidden' }],
      fragments: [],
      handlers: [{ captures: ['ctx'], event: 'click', params: [] }],
      merges: [{ attr: 'aria-expanded', diagnostics: [] }],
      queries: ['cart'],
      triggers: [{ deps: ['cart'], trigger: 'visible' }],
    });
    expect(
      kovoExplainComponentHandlerFacts(
        'kovo-explain/v1\nCOMPONENT CartBadge\nHANDLER click export=CartBadge$button_click ref=/cart.js#CartBadge$button_click captures=ctx params=- substitution=-\n',
      ),
    ).toEqual([
      {
        captures: ['ctx'],
        event: 'click',
        exportName: 'CartBadge$button_click',
        params: [],
        ref: '/cart.js#CartBadge$button_click',
        substitution: '-',
      },
    ]);
    expect(
      kovoExplainComponentDeriveFacts(
        'kovo-explain/v1\nCOMPONENT CartBadge\nDERIVE CartBadge$isEmpty inputs=cart ref=/cart.js#CartBadge$isEmpty target=data-bind:hidden\n',
      ),
    ).toEqual([
      {
        inputs: ['cart'],
        name: 'CartBadge$isEmpty',
        ref: '/cart.js#CartBadge$isEmpty',
        target: 'data-bind:hidden',
      },
    ]);
    expect(
      kovoExplainComponentTriggerFacts(
        'kovo-explain/v1\nCOMPONENT CartBadge\nTRIGGER visible export=CartBadge$mount ref=/cart.js#CartBadge$mount deps=cart justification=below the fold\n',
      ),
    ).toEqual([
      {
        deps: ['cart'],
        exportName: 'CartBadge$mount',
        justification: 'below the fold',
        ref: '/cart.js#CartBadge$mount',
        trigger: 'visible',
      },
    ]);
    expect(
      kovoExplainComponentMergeFacts(
        'kovo-explain/v1\nCOMPONENT CartBadge\nMERGE button attr=aria-expanded rule=primitive-owned decision=primitive diagnostics=-\n',
      ),
    ).toEqual([
      {
        attr: 'aria-expanded',
        decision: 'primitive',
        diagnostics: [],
        element: 'button',
        rule: 'primitive-owned',
      },
    ]);
    expect(
      kovoExplainEndpointFacts(
        [
          'kovo-explain/v1',
          'ENDPOINTS',
          'ENDPOINT reports/export surface=route-file method=GET path=/exports/reports.ndjson mount=exact auth=authed csrf=checked cache=private,no-store body=bytes bodySize=stream rateLimit=export:user headers=Content-Type files=reports.ndjson dynamic=- writes=-',
          '',
        ].join('\n'),
      ),
    ).toEqual([
      {
        auth: 'authed',
        body: 'bytes',
        bodySize: 'stream',
        cache: 'private,no-store',
        csrf: 'checked',
        dynamic: [],
        endpoint: 'reports/export',
        files: ['reports.ndjson'],
        headers: ['Content-Type'],
        method: 'GET',
        mount: 'exact',
        path: '/exports/reports.ndjson',
        rateLimit: 'export:user',
        surface: 'route-file',
        writes: [],
      },
    ]);
    expect(
      kovoExplainScopeAuditFacts(
        'kovo-explain/v1\nUNSCOPED\nUNSCOPED QUERY cart domain=cart scope=unscoped site=src/app.ts:1 missing tenant filter\n',
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
    expect(
      kovoExplainUnguardedFacts(
        'kovo-explain/v1\nUNGUARDED\nQUERY cart guards=- reads=cart\nSUMMARY total=1\n',
      ),
    ).toEqual([
      {
        fields: { guards: [], reads: ['cart'] },
        target: 'cart',
        targetKind: 'QUERY',
      },
    ]);
    expect(
      kovoExplainUnguardedAssertionFact({
        exitCode: 0,
        output: 'kovo-explain/v1\nUNGUARDED\nQUERY cart guards=- reads=cart\nSUMMARY total=1\n',
      }),
    ).toEqual({
      exitCode: 0,
      records: [
        {
          fields: { guards: [], reads: ['cart'] },
          target: 'cart',
          targetKind: 'QUERY',
        },
      ],
      subject: 'UNGUARDED',
      summary: { total: '1' },
      version: 'kovo-explain/v1',
    });
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
    const acceptanceEvidence: GeneratedGraphArtifactAcceptanceEvidenceFact =
      generatedGraphArtifactAcceptanceEvidenceFact({
        kovoCheck: {
          exitCode: 0,
          issueCount: 0,
          status: 'ok',
          version: 'kovo-check/v1',
        },
        staticBehavior: graphStaticBehaviorFact(graph),
        summary: {
          emitCheck: { clean: true },
          invalidations: { 'cart/add': ['cart'] },
          touchGraph: {
            entries: {},
            honesty: {
              entryKeys: [],
              sourceLineMismatches: [],
              sourceSites: { count: 0, linesArePositive: true, paths: [] },
              touchCountsByMutation: {},
              unresolvedMutations: [],
            },
          },
        },
      });
    expect(acceptanceEvidence.emitCheck.clean).toBe(true);
    const acceptanceChecklist: GeneratedGraphArtifactAcceptanceChecklistFact =
      generatedGraphArtifactAcceptanceChecklistFact({
        kovoCheck: {
          exitCode: 0,
          issueCount: 0,
          status: 'ok',
          version: 'kovo-check/v1',
        },
        staticBehavior: graphStaticBehaviorFact(graph),
        summary: {
          emitCheck: { clean: true },
          invalidations: { 'cart/add': ['cart'] },
          touchGraph: {
            entries: {},
            honesty: {
              entryKeys: [],
              sourceLineMismatches: [],
              sourceSites: { count: 0, linesArePositive: true, paths: [] },
              touchCountsByMutation: {},
              unresolvedMutations: [],
            },
          },
        },
      });
    expect(acceptanceChecklist.emitCheckClean).toBe(true);
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
    expect(workflowVpRunTaskNames('steps:\n  - run: vp run kovo-check')).toEqual(['kovo-check']);
    expect(
      workflowVpRunTaskNames(
        'steps:\n  - run: vp exec node scripts/kovo-check.mjs --suite graph-cli',
      ),
    ).toEqual(['kovo-check']);
    expect(() => assertOrderedItems(['build', 'kovo-check'], 'build', 'kovo-check')).not.toThrow();
    expect(browserSuiteAcceptanceGateFact).toBeTypeOf('function');
    expect(browserSuiteAcceptanceModulePath).toBeTypeOf('function');
    expect(browserSuiteAcceptanceProjectFact).toBeTypeOf('function');
    expect(conformanceGateFacts).toBeTypeOf('function');
    expectTypeOf<ConformanceGateFacts>().toHaveProperty('taskName').toEqualTypeOf<string>();
    expect(loadVitePlusConfig).toBeTypeOf('function');
    expect(p10PerfAcceptanceGateFact).toBeTypeOf('function');
    expect(p10PerfAcceptanceModulePath).toBeTypeOf('function');
    expect(p10PerfAcceptanceProjectFact).toBeTypeOf('function');
    expect(vitePlusAcceptanceTaskFacts).toBeTypeOf('function');
    expect(vitePlusTaskInputFacts).toBeTypeOf('function');
    expect(vitePlusTaskInputPatternEndingWith).toBeTypeOf('function');
    expect(parseKovoExportOutput('kovo-export/v1\nSUMMARY html=0')).toMatchObject({
      summary: { html: '0' },
    });
    expect(
      kovoExportCliResultFact({
        exitCode: 0,
        stderr: '',
        stdout: 'kovo-export/v1\nHTML /index.html status=200 bytes=1\n',
      }),
    ).toMatchObject({
      exitCode: 0,
      html: [{ bytesArePositive: true, path: '/index.html', status: 200 }],
      outputStream: 'stdout',
    });
    expect(kovoExportStaticBehaviorFact).toBeTypeOf('function');
    expect(parseKovoCheckOutput('kovo-check/v1\nOK\n')).toMatchObject({ status: 'ok' });
    expect(kovoCheckResultFact({ exitCode: 0, output: 'kovo-check/v1\nOK\n' })).toMatchObject({
      exitCode: 0,
      status: 'ok',
    });
    expect(kovoCheckAssertionFact({ exitCode: 0, output: 'kovo-check/v1\nOK\n' })).toMatchObject({
      diagnostics: [],
      exitCode: 0,
    });
    expect(kovoCheckOkAssertionFact({ exitCode: 0, output: 'kovo-check/v1\nOK\n' })).toEqual({
      exitCode: 0,
      issueCount: 0,
      status: 'ok',
      version: 'kovo-check/v1',
    });
    expect(kovoCheckUnguardedAuditBehaviorFact).toBeTypeOf('function');
    expect(
      kovoCheckDiagnosticFacts(
        'kovo-check/v1\nWARN KV310 cart/add -> cart Invalidated query lacks optimistic transform.\n',
      ),
    ).toMatchObject([{ code: 'KV310', target: 'cart/add -> cart' }]);
    expect(
      kovoCheckDiagnosticAssertionFacts(
        'kovo-check/v1\nWARN KV311 component=Cart query=cart.count position="conditional <dot>" Query/state-dependent DOM position has no update status.\n',
      ),
    ).toEqual([
      {
        code: 'KV311',
        message: 'Query/state-dependent DOM position has no update status.',
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
      kovoCheckCoverageFacts(
        'kovo-check/v1\nCOVERAGE component=Cart query=cart position=replace status=fragment\n',
      ),
    ).toMatchObject([{ properties: { component: 'Cart', status: 'fragment' } }]);
    expect(
      kovoCheckCoverageAssertionFacts(
        'kovo-check/v1\nCOVERAGE component=Cart query=cart position=replace status=fragment detail="text binding"\n',
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
      kovoCheckOptimisticProofFacts(
        'kovo-check/v1\nOPTIMISTIC-PROOF mutation=cart/add query=cart status=derived derivation=derived level=exact-row private-scope=session:id\n',
      ),
    ).toMatchObject([{ properties: { level: 'exact-row', mutation: 'cart/add', query: 'cart' } }]);
    expect(
      kovoCheckOptimisticProofAssertionFacts(
        'kovo-check/v1\nOPTIMISTIC-PROOF mutation=cart/add query=orders status=await-fragment derivation=PUNTED level=opaque private-scope=- reason="Opaque: compute_total"\n',
      ),
    ).toEqual([
      {
        properties: {
          derivation: 'PUNTED',
          level: 'opaque',
          mutation: 'cart/add',
          'private-scope': '-',
          query: 'orders',
          reason: 'Opaque: compute_total',
          status: 'await-fragment',
        },
      },
    ]);
    expect(
      kovoExplainMutationAssertionFact({
        exitCode: 0,
        output: [
          'kovo-explain/v1',
          'MUTATION cart/add',
          'guards: authed',
          'session: starterSession',
          'input-fields: productId,quantity',
          'writes: cart',
          'invalidates: cart',
          'manual-invalidates: -',
          'updates: cart->component:CartBadge,page:/cart',
          'OPTIMISTIC cart await-fragment',
          'OPTIMISTIC-SUMMARY total=1 derived=0 hand-written=0 await-fragment=1 UNHANDLED=0 PUNTED=0',
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
      kovoExplainQueryAssertionFact({
        exitCode: 0,
        output:
          'kovo-explain/v1\nQUERY cart\nreads: cart\nconsumers: page:/cart\ninvalidated-by: cart/add\ndomain-writes: cart.addItem\n',
      }),
    ).toMatchObject({ consumers: ['page:/cart'], domainWrites: ['cart.addItem'] });
    expect(
      kovoExplainPageAssertionFact({
        exitCode: 0,
        output:
          'kovo-explain/v1\nPAGE /cart\nprefetch: false\nmeta: title=Cart description=Ready image=-\ni18n: -\nmodulepreloads: -\nstylesheets: /src/styles.css\nqueries: cart\nview-transitions: -\n',
      }),
    ).toMatchObject({ queries: ['cart'], stylesheets: ['/src/styles.css'] });
    expect(executeGeneratedClientModule).toBeTypeOf('function');
    expect(executeGeneratedServerRenderSource).toBeTypeOf('function');
    expect(executeGeneratedBootstrapModule).toBeTypeOf('function');
    expect(
      generatedComponentSourceFacts({
        authoredSource: '<cart-badge></cart-badge>',
        generatedSource: '// @kovojs-ir',
      }),
    ).toEqual({
      authoredLoweredStampAttributes: [],
      generatedHasLoweredIrMarker: true,
    } satisfies GeneratedComponentSourceFacts);
    const generatedSourceRoot = mkdtempSync(join(tmpdir(), 'kovo-generated-source-facts-'));
    try {
      mkdirSync(join(generatedSourceRoot, 'components'), { recursive: true });
      mkdirSync(join(generatedSourceRoot, 'generated'), { recursive: true });
      writeFileSync(
        join(generatedSourceRoot, 'components/cart-badge.tsx'),
        '<cart-badge></cart-badge>',
      );
      writeFileSync(join(generatedSourceRoot, 'generated/cart-badge.tsx'), '// @kovojs-ir');

      expect(
        generatedComponentSourceFileFacts({
          components: ['cart-badge'],
          sourceRootUrl: pathToFileURL(`${generatedSourceRoot}/`),
        })[0],
      ).toMatchObject({
        authoredPath: 'components/cart-badge.tsx',
        generatedPath: 'generated/cart-badge.tsx',
        name: 'cart-badge',
      } satisfies Partial<GeneratedComponentSourceFileFact>);
    } finally {
      rmSync(generatedSourceRoot, { force: true, recursive: true });
    }
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
    expect(
      generatedHandlerReferenceFact('/c/__v/3853abab13e04603-0a1b2c3d/cart.client.js#Cart$click'),
    ).toMatchObject({
      handlerName: 'Cart$click',
      modulePath: '/c/cart.client.js',
      versionShape: 'render-plan-hex-16-plus-hash-hex-8',
    });
    expect(
      generatedHandlerReferenceSummaryFact(
        '/c/__v/3853abab13e04603-0a1b2c3d/cart.client.js#Cart$click',
      ),
    ).toEqual({
      handlerName: 'Cart$click',
      modulePath: '/c/cart.client.js',
      versionShape: 'render-plan-hex-16-plus-hash-hex-8',
    } satisfies GeneratedHandlerReferenceSummaryFact);
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
        { kind: 'css', source: '@scope (doc-card) to (:scope [kovo-c]) {' },
      ]),
    ).toEqual([
      {
        limit: ':scope [kovo-c]',
        raw: '@scope (doc-card) to (:scope [kovo-c]) {',
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
    expectTypeOf<GeneratedTypedRouteNavigationBehaviorFact>()
      .toHaveProperty('provenance')
      .toEqualTypeOf<{ spec: 'SPEC.md section 6.4' }>();
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
    const wireSources = [{ name: 'cart-read.http', source: wireFixture }];
    expect(wireFixturePresenceFacts(wireSources)).toMatchObject([{ name: 'cart-read.http' }]);
    expect(wireFragmentModeFacts).toBeTypeOf('function');
    expect(
      wireResponseBodyPinFacts(wireSources, { 'cart-read.http': ['<main>Cart</main>'] }),
    ).toHaveProperty('0.matches', true);
    expect(generatedWireResponseBodies['typed-read.http']).toEqual([
      '<kovo-query name="product" key="product:p1">{"name":"Mug","stock":4}</kovo-query>\n',
    ]);
    expect(loadWireFixtureSources).toBeTypeOf('function');
    expect(wireFixtureResponseBody(wireSources, 'cart-read.http', 1)).toBe('<main>Cart</main>');
    expect(wireResponseMetadataFacts(wireSources)).toMatchObject([
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    ]);
    expect(wireFixtureContentTypesFacts(wireSources)).toEqual([
      { contentTypes: ['text/html; charset=utf-8'], name: 'cart-read.http' },
    ]);
    expect(wireFixturesWithContentType(wireSources, 'text/event-stream')).toEqual([]);
    expect(runCapturedCliCommand).toBeTypeOf('function');
    expect(runCommandSequenceSync).toBeTypeOf('function');
  });

  it('keeps harness exec options on the operation module surface', () => {
    expectTypeOf<KovoTestExecOptions<{ db: { cart: string[] } }>>().toEqualTypeOf<
      HarnessMutationOptions<{ db: { cart: string[] } }>
    >();
  });
});

type _PublicSubpathTypes = [
  MutationErrorExpectation<Record<'invalid', { parse(value: unknown): unknown }>, 'invalid'>,
  PropertyTestOptions<{ count: number }, { by: number }>,
  PropertyTestResult,
  BrowserSuiteAcceptanceGateFact,
  BrowserSuiteAcceptanceShape,
  CapturedCliCommandResult,
  CliMainCommand,
  CommandInvocation,
  NodeTaskCommand,
  P10PerfAcceptanceGateFact,
  P10PerfAcceptanceProjectFactOptions,
  P10PerfAcceptanceShape,
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
  KovoExplainComponentAssertionFact,
  KovoExplainComponentDeriveFact,
  KovoExplainComponentHandlerFact,
  KovoExplainComponentMergeFact,
  KovoExplainComponentTriggerFact,
  KovoExplainEndpointFact,
  KovoExplainMutationAssertionFact,
  KovoExplainOutput,
  KovoExplainPageAssertionFact,
  KovoExplainQueryAssertionFact,
  KovoExplainResultLike,
  KovoExplainScopeAuditFact,
  KovoExplainUnguardedAssertionFact,
  KovoExplainUnguardedFact,
  KovoExplainUpdateConsumerFact,
  KovoExportCliArtifactFact,
  KovoExportCliResultFact,
  KovoExportCliResultLike,
  KovoExportError,
  KovoExportHtmlArtifact,
  KovoExportOutput,
  KovoExportStaticBehaviorFact,
  KovoExportStaticBehaviorOptions,
  KovoExportStaticDiagnosticLike,
  KovoExportSummary,
  KovoCheckAssertionFact,
  KovoCheckCoverageAssertionFact,
  KovoCheckCoverageFact,
  KovoCheckDiagnosticAssertionFact,
  KovoCheckDiagnosticFact,
  KovoCheckOkAssertionFact,
  KovoCheckOptimisticProofAssertionFact,
  KovoCheckOptimisticProofFact,
  KovoCheckOutput,
  KovoCheckResultFact,
  KovoCheckUnguardedAuditBehaviorFact,
  DocumentQueryScriptBehaviorFact,
  CommerceGraphBehaviorFact,
  CommerceGraphBehaviorOptions<ProjectGraphFixture>,
  CommerceGraphComponentGraphFact,
  CommerceGraphCompilerComponentFact,
  CommerceGraphCompilerRegistryFact,
  GraphInvalidationMatrix,
  GraphQueryConsumerFact,
  ForbiddenBrowserArchitectureFact,
  ProjectFileSourceFact,
  ProjectFileTreeOptions,
  ServerCommerceAdoptDontInventBehaviorFact,
  ServerCommerceAdoptDontInventRuntime,
  KovoTestContext<{ cart: string[] }>,
  KovoTestExecOptions<{ db: { cart: string[] } }>,
  KovoTestHarnessOptions<{ cart: string[] }>,
  PageAssertion,
  PgliteTestDb,
  KovoTestCase,
  KovoTestRunner,
  HarnessMutationOptions<{ db: { cart: string[] } }>,
  HarnessOperationVerifier,
  MarkdownFields,
  MarkdownTableRow,
  MarkdownBoldSectionHeading,
  NormativeDocsGateFact,
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
  StarterTemplateAcceptanceFact,
  StarterTemplateAcceptanceOptions,
  StarterClientTemplateBehaviorFact,
  StarterClientTemplateFixture,
  StarterTemplateFacts,
  StarterTemplateIndexHtmlFacts,
  StarterTemplatePackageFacts,
  StarterTemplateSources,
  WireFixtureContentTypesFact,
  WireFixture,
  WireFixturePresenceFact,
  WireFixtureSource,
  WireFragmentModeFact,
  WireResponseBodyPinFact,
  WireResponseMetadataFact,
  WireTranscriptExchange,
  WireTranscriptResponse,
  ParsedSqlOperation,
  TypeScriptInterfaceMemberTypes,
  GeneratedHandlerReferenceFact,
  GeneratedRegistryConsumerTypeOptions,
  DbObservationOptions,
  DbVerificationConfig,
  DbVerificationDiagnostic,
  DbVerifier,
  ObservedDbOperation,
  ViteGeneratedHandlerMiddlewareFact,
  ViteHandlerTransformFact,
  VitePluginLike,
  VitePluginMiddlewareFact,
  ViteProductionEmitContractFact,
  ViteProductionEmitContractOptions,
  ViteRedGreenBuildFixtureFact,
  ViteTransformElementFact,
];
