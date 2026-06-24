import { describe, expect, it } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

import * as packageRootApi from '@kovojs/server';
import * as packageViteApi from '@kovojs/server/vite';
import * as packageInternalClientModulesApi from '@kovojs/server/internal/client-modules';
import * as packageInternalCsrfApi from '@kovojs/server/internal/csrf';
import * as packageInternalEscapeApi from '@kovojs/server/internal/escape';
import * as packageInternalExecutionApi from '@kovojs/server/internal/execution';
import * as packageInternalHtmlApi from '@kovojs/server/internal/html';
import * as packageInternalRouteApi from '@kovojs/server/internal/route';
import * as packageInternalStaticExportApi from '@kovojs/server/internal/static-export';
import * as packageInternalWireApi from '@kovojs/server/internal/wire';
import serverPackage from '../../package.json' with { type: 'json' };
import * as appApi from '../app.js';
import * as appGuardsApi from '../app-guards.js';
import * as writeGovernanceApi from '../write-governance.js';
import * as capabilityUrlApi from '../capability-url.js';
import * as egressApi from '../egress.js';
import * as egressBootstrapApi from '../egress-bootstrap.js';
import * as egressCredentialsApi from '../egress-credentials.js';
import * as envApi from '../env.js';
import * as componentRenderApi from '../component-render.js';
import * as cspApi from '../csp.js';
import * as deferredStreamApi from '../deferred-stream.js';
import * as publicApi from '../index.js';
import * as internalClientModulesApi from '../internal/client-modules.js';
import * as internalCsrfApi from '../internal/csrf.js';
import * as internalEscapeApi from '../internal/escape.js';
import * as internalExecutionApi from '../internal/execution.js';
import * as internalHtmlApi from '../internal/html.js';
import * as internalRouteApi from '../internal/route.js';
import * as mutationApi from '../mutation.js';
import * as nodeSourceApi from '../node.js';
import * as queryApi from '../query.js';
import * as dataApi from './data.js';
import * as documentCoreApi from '../document-core.js';
import * as documentDiagnosticsApi from '../document-diagnostics.js';
import * as documentStructuredApi from '../document-structured.js';
import * as hintsApi from '../hints.js';
import * as internalStaticExportApi from '../internal/static-export.js';
import * as renderingApi from './rendering.js';
import * as routingApi from './routing.js';
import * as responseApi from '../response.js';
import * as routeApi from '../route.js';
import * as staticExportDiagnosticsApi from '../static-export-diagnostics.js';
import * as staticExportOrchestratorApi from '../static-export.js';
import * as staticExportOutputApi from '../static-export-output.js';
import * as staticExportResultApi from '../static-export-result.js';
import * as viteApi from '../vite.js';
import * as viteDevApi from '../vite-dev.js';
import * as internalWireApi from '../internal/wire.js';
import * as wireHtmlApi from '../wire-html.js';

// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootAppDocumentOptions = import('../index.js').AppDocumentOptions;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootAppErrorShellOptions = import('../index.js').AppErrorShellOptions;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootAppMutationResponseContext = import('../index.js').AppMutationResponseContext;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootAppMutationResponseOptions = import('../index.js').AppMutationResponseOptions;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootAppMutationResponseResolver = import('../index.js').AppMutationResponseResolver;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootAppRouteRenderContext = import('../index.js').AppRouteRenderContext;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootErrorShellRenderer = import('../index.js').ErrorShellRenderer;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootRequestHandler = import('../index.js').RequestHandler;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootNodeHandlerOptions = import('../index.js').NodeHandlerOptions;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootNodeRequestHandler = import('../index.js').NodeRequestHandler;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootStaticExportOptions = import('../index.js').StaticExportOptions;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootStaticExportResult = import('../index.js').StaticExportResult;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootStaticExportDiagnostic = import('../index.js').StaticExportDiagnostic;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootStaticExportDiagnosticSeverity = import('../index.js').StaticExportDiagnosticSeverity;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalKovoAppShellViteDevPluginFactory =
  typeof import('@kovojs/server/internal/app-shell-vite').kovoAppShellViteDevPlugin;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalKovoAppShellViteDevIntegrationFactory =
  typeof import('@kovojs/server/internal/app-shell-vite').createKovoAppShellViteDevIntegration;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalKovoAppShellViteCompilerModuleDiagnosticReport =
  import('@kovojs/server/internal/app-shell-vite').KovoAppShellViteCompilerModuleDiagnosticReport;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalKovoAppShellViteDevIntegration =
  import('@kovojs/server/internal/app-shell-vite').KovoAppShellViteDevIntegration;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalKovoAppShellViteDevPlugin =
  import('@kovojs/server/internal/app-shell-vite').KovoAppShellViteDevPlugin;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalKovoAppShellViteDevPluginOptions =
  import('@kovojs/server/internal/app-shell-vite').KovoAppShellViteDevPluginOptions;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalMemoryRegistryOptions =
  import('@kovojs/server/internal/client-modules').MemoryVersionedClientModuleRegistryOptions;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalVersionedClientModuleRegistryType =
  import('@kovojs/server/internal/client-modules').VersionedClientModuleRegistry;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalVersionedClientModuleInputType =
  import('@kovojs/server/internal/client-modules').VersionedClientModuleInput;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootIsKovoApp = typeof import('@kovojs/server').isKovoApp;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootStylesheet = typeof import('@kovojs/server').stylesheet;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootDefer = typeof import('@kovojs/server').Defer;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootDeferProps = import('@kovojs/server').DeferProps;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootRegionPriority = import('@kovojs/server').RegionPriority;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootServerRenderable = import('@kovojs/server').ServerRenderable;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootDocumentConfig = import('@kovojs/server').DocumentConfig;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootDocumentDeclaration = import('@kovojs/server').DocumentDeclaration;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootDocumentAuthoringContext = import('@kovojs/server').DocumentAuthoringContext;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootDocumentShellAttributes = import('@kovojs/server').DocumentShellAttributes;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootDocumentShellAttributeValue = import('@kovojs/server').DocumentShellAttributeValue;
if (false) {
  // @ts-expect-error - SPEC.md §9.5 document customization uses structured primitives, not string templates.
  publicApi.createApp({ document: { template: () => '<html></html>' } });
}
// SPEC.md §9.5: the versioned client-module registry constructor and its option
// surface are public at the root barrel for `createApp({ clientModules })` consumers.
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootCreateMemoryVersionedClientModuleRegistry =
  typeof import('@kovojs/server').createMemoryVersionedClientModuleRegistry;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootMemoryVersionedClientModuleRegistryOptions =
  import('@kovojs/server').MemoryVersionedClientModuleRegistryOptions;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootVersionedClientModuleRegistry = import('@kovojs/server').VersionedClientModuleRegistry;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootVersionedClientModuleInput = import('@kovojs/server').VersionedClientModuleInput;

// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedCreateApp =
  // @ts-expect-error SPEC.md §9.5: createApp now has the root @kovojs/server
  // canonical home, not the app-shell/core subpath.
  typeof import('./app-shell/core.js').createApp;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedCreateRequestHandler =
  // @ts-expect-error SPEC.md §9.5: createRequestHandler now has the root
  // @kovojs/server canonical home, not the app-shell/core subpath.
  typeof import('./app-shell/core.js').createRequestHandler;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedIsKovoApp =
  // @ts-expect-error SPEC.md §9.5: the dynamic app guard now has the root
  // @kovojs/server canonical home, not the app-shell/core subpath.
  typeof import('./app-shell/core.js').isKovoApp;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedLayout =
  // @ts-expect-error SPEC.md §9.5: layout now has the root @kovojs/server
  // canonical home, not the app-shell/core subpath.
  typeof import('./app-shell/core.js').layout;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedRespond =
  // @ts-expect-error SPEC.md §9.5: respond now has the root @kovojs/server
  // canonical home, not the app-shell/core subpath.
  typeof import('./app-shell/core.js').respond;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedRoute =
  // @ts-expect-error SPEC.md §9.5: route now has the root @kovojs/server
  // canonical home, not the app-shell/core subpath.
  typeof import('./app-shell/core.js').route;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedCreateMemoryVersionedClientModuleRegistry =
  // @ts-expect-error SPEC.md §9.5: memory client-module registry construction now
  // has the root @kovojs/server canonical home.
  typeof import('./app-shell/client-modules.js').createMemoryVersionedClientModuleRegistry;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedToNodeHandler =
  // @ts-expect-error SPEC.md §9.5: toNodeHandler now has the root
  // @kovojs/server canonical home.
  typeof import('./app-shell/node.js').toNodeHandler;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedExportStaticApp =
  // @ts-expect-error SPEC.md §9.5: exportStaticApp now has the root
  // @kovojs/server canonical home.
  typeof import('./app-shell/static-export.js').exportStaticApp;

// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedAppDocumentOptions =
  // @ts-expect-error SPEC.md §9.5: app document options now have the root
  // @kovojs/server canonical home, not the app-shell/core subpath.
  import('./app-shell/core.js').AppDocumentOptions;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedAppErrorShellOptions =
  // @ts-expect-error SPEC.md §9.5: app error shell options now have the root
  // @kovojs/server canonical home, not the app-shell/core subpath.
  import('./app-shell/core.js').AppErrorShellOptions;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedAppMutationResponseContext =
  // @ts-expect-error SPEC.md §9.5: mutation response context now has the root
  // @kovojs/server canonical home, not the app-shell/core subpath.
  import('./app-shell/core.js').AppMutationResponseContext;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedAppMutationResponseOptions =
  // @ts-expect-error SPEC.md §9.5: mutation response options now have the root
  // @kovojs/server canonical home, not the app-shell/core subpath.
  import('./app-shell/core.js').AppMutationResponseOptions;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedAppMutationResponseResolver =
  // @ts-expect-error SPEC.md §9.5: mutation response resolvers now have the root
  // @kovojs/server canonical home, not the app-shell/core subpath.
  import('./app-shell/core.js').AppMutationResponseResolver;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedAppRouteRenderContext =
  // @ts-expect-error SPEC.md §9.5: route render context now has the root
  // @kovojs/server canonical home, not the app-shell/core subpath.
  import('./app-shell/core.js').AppRouteRenderContext;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedErrorShellRenderer =
  // @ts-expect-error SPEC.md §9.5: error shell renderers now have the root
  // @kovojs/server canonical home, not the app-shell/core subpath.
  import('./app-shell/core.js').ErrorShellRenderer;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedRequestHandler =
  // @ts-expect-error SPEC.md §9.5: request-handler types now have the root
  // @kovojs/server canonical home, not the app-shell/core subpath.
  import('./app-shell/core.js').RequestHandler;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedMemoryRegistryOptions =
  // @ts-expect-error SPEC.md §9.5: versioned client-module registry option types
  // now have the root @kovojs/server canonical home.
  import('./app-shell/client-modules.js').MemoryVersionedClientModuleRegistryOptions;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedVersionedClientModuleRegistry =
  // @ts-expect-error SPEC.md §9.5: versioned client-module registry types now have
  // the root @kovojs/server canonical home.
  import('./app-shell/client-modules.js').VersionedClientModuleRegistry;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedVersionedClientModuleInput =
  // @ts-expect-error SPEC.md §9.5: versioned client-module input types now have
  // the root @kovojs/server canonical home.
  import('./app-shell/client-modules.js').VersionedClientModuleInput;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedVersionedClientModuleRequest =
  // @ts-expect-error SPEC.md §9.5: client-module request helpers are framework
  // support internals, not public app-shell/client-modules API.
  import('./app-shell/client-modules.js').VersionedClientModuleRequest;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedVersionedClientModuleResponse =
  // @ts-expect-error SPEC.md §9.5: client-module response helpers are framework
  // support internals, not public app-shell/client-modules API.
  import('./app-shell/client-modules.js').VersionedClientModuleResponse;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalVersionedClientModuleRequest =
  import('@kovojs/server/internal/client-modules').VersionedClientModuleRequest;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalVersionedClientModuleResponse =
  import('@kovojs/server/internal/client-modules').VersionedClientModuleResponse;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalRenderMutationCsrfField =
  typeof import('@kovojs/server/internal/csrf').renderMutationCsrfField;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedNodeHandlerOptions =
  // @ts-expect-error SPEC.md §9.5: Node adapter companion types now have the root
  // @kovojs/server canonical home.
  import('./app-shell/node.js').NodeHandlerOptions;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedNodeRequestHandler =
  // @ts-expect-error SPEC.md §9.5: Node request handler types now have the root
  // @kovojs/server canonical home.
  import('./app-shell/node.js').NodeRequestHandler;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportOptions =
  // @ts-expect-error SPEC.md §9.5: static-export result/config types now have the
  // root @kovojs/server canonical home.
  import('./app-shell/static-export.js').StaticExportOptions;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportResult =
  // @ts-expect-error SPEC.md §9.5: static-export result/config types now have the
  // root @kovojs/server canonical home.
  import('./app-shell/static-export.js').StaticExportResult;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportDiagnostic =
  // @ts-expect-error SPEC.md §9.5: static-export diagnostics now have the root
  // @kovojs/server canonical home.
  import('./app-shell/static-export.js').StaticExportDiagnostic;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportDiagnosticSeverity =
  // @ts-expect-error SPEC.md §9.5: static-export diagnostics now have the root
  // @kovojs/server canonical home.
  import('./app-shell/static-export.js').StaticExportDiagnosticSeverity;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportManifestHelper =
  // @ts-expect-error SPEC.md §9.5: static-export manifest helpers are framework
  // export-task internals, not public app-shell/static-export helpers.
  typeof import('./app-shell/static-export.js').staticExportManifest;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportInventoryHelper =
  // @ts-expect-error SPEC.md §9.5: static-export inventory helpers are framework
  // export-task internals, not public app-shell/static-export helpers.
  typeof import('./app-shell/static-export.js').staticExportInventory;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportOutputPlanHelper =
  // @ts-expect-error SPEC.md §9.5: static-export output planning is framework
  // export-task plumbing, not a public app-shell/static-export helper.
  typeof import('./app-shell/static-export.js').staticExportOutputPlan;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportManifestAssertion =
  // @ts-expect-error SPEC.md §9.5: static-export manifest assertions stay behind
  // an internal server export-task subpath.
  typeof import('./app-shell/static-export.js').assertStaticExportManifestMatchesResult;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportDirectoryIndexAssertion =
  // @ts-expect-error SPEC.md §9.5: static-export manifest assertions stay behind
  // an internal server export-task subpath.
  typeof import('./app-shell/static-export.js').assertStaticExportManifestUsesDirectoryIndexDocuments;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportDiagnosticFormatter =
  // @ts-expect-error SPEC.md §9.5: static-export diagnostic rendering is framework
  // tooling support, not a public app-shell/static-export helper.
  typeof import('./app-shell/static-export.js').formatStaticExportDiagnostic;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportDiagnosticsFormatter =
  // @ts-expect-error SPEC.md §9.5: static-export diagnostic rendering is framework
  // tooling support, not a public app-shell/static-export helper.
  typeof import('./app-shell/static-export.js').formatStaticExportDiagnostics;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportDiagnosticGuard =
  // @ts-expect-error SPEC.md §9.5: static-export diagnostic shape guards stay
  // behind an internal server export-task subpath.
  typeof import('./app-shell/static-export.js').isStaticExportDiagnostic;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportDiagnosticErrorGuard =
  // @ts-expect-error SPEC.md §9.5: static-export diagnostic shape guards stay
  // behind an internal server export-task subpath.
  typeof import('./app-shell/static-export.js').isStaticExportDiagnosticError;

// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedWriteWebResponseToNodeOptions =
  // @ts-expect-error SPEC.md §9.5: raw Node response writer options stay inside the node adapter
  // implementation; public app-shell/node consumers receive only the closed adapter entrypoint.
  import('./app-shell/node.js').WriteWebResponseToNodeOptions;

// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedViteDevPluginFactory =
  // @ts-expect-error SPEC.md §9.5: Vite build/export replay helpers moved behind
  // `kovo export --vite`; the former public subpath is removed.
  typeof import('@kovojs/server/app-shell/vite');

function aggregateValueKeys(...modules: readonly Record<string, unknown>[]): string[] {
  return [...new Set(modules.flatMap((module) => Object.keys(module)))].sort();
}

function moduleValueKeys(module: Record<string, unknown>): string[] {
  return Object.keys(module).sort();
}

describe('server app-shell public API barrels', () => {
  it('keeps app-shell helpers on subpaths while root preserves SPEC §9.5 built-harness entries', () => {
    const publicValues = publicApi as Record<string, unknown>;
    const packageRootValues = packageRootApi as Record<string, unknown>;
    const renderingSubpathOnlyValues = new Set([
      'ComponentXmlError',
      'parseComponentXml',
      'renderRegistry',
      'renderTree',
    ]);
    const rootValues = aggregateValueKeys(dataApi, renderingApi, routingApi, {
      createApp: appApi.createApp,
      // SPEC.md §6.6 / §9.5 (plans/secure-framework.md Tier 1): refuse-to-boot
      // env/secret validation surface — the typed boot error, its guard, and the
      // committed-secret waiver are public at the root barrel.
      committedSecretWaiver: envApi.committedSecretWaiver,
      CreateAppBootError: envApi.CreateAppBootError,
      isCreateAppBootError: envApi.isCreateAppBootError,
      // SPEC.md §6.6 / plans/secure-framework.md Phase 5: the outbound-egress private-network
      // deny floor (runtime defense-in-depth). The typed blocked/config errors, the
      // worker-bootstrap install + self-probe helpers, the cloud credential factories, and the
      // `kovo` capability namespace are public at the root barrel.
      EgressBlockedError: egressApi.EgressBlockedError,
      EgressConfigError: egressApi.EgressConfigError,
      installEgressFloor: egressBootstrapApi.installEgressFloor,
      selfProbe: egressBootstrapApi.selfProbe,
      awsCredential: egressCredentialsApi.awsCredential,
      gcpCredential: egressCredentialsApi.gcpCredential,
      azureCredential: egressCredentialsApi.azureCredential,
      // SPEC.md §6.6 / §9.1 / plans/secure-framework.md Phase 5: capability-URL signing/verify
      // primitive (by-construction at the verify sink). Public at the root barrel; the download
      // route that hosts the sink is open work.
      DEFAULT_CAPABILITY_TTL_MS: capabilityUrlApi.DEFAULT_CAPABILITY_TTL_MS,
      createMemoryCapabilityReplayStore: capabilityUrlApi.createMemoryCapabilityReplayStore,
      signCapability: capabilityUrlApi.signCapability,
      verifyCapability: capabilityUrlApi.verifyCapability,
      // SPEC.md §9.5: dev integration/plugin stay public at the root barrel for the
      // create-kovo starter template's vite.config.ts.
      createKovoAppShellViteDevIntegration: viteDevApi.createKovoAppShellViteDevIntegration,
      createMemoryVersionedClientModuleRegistry:
        internalClientModulesApi.createMemoryVersionedClientModuleRegistry,
      createRequestHandler: appApi.createRequestHandler,
      exportStaticApp: staticExportOrchestratorApi.exportStaticApp,
      isKovoApp: appGuardsApi.isKovoApp,
      // SPEC.md §10.3/§11.1 / plans/secure-framework.md Phase 3: the mass-assignment
      // (KV438) author-assertion escapes — serverValue(non-input) + the audited
      // adminAssign + its drain — are public at the root barrel.
      adminAssign: writeGovernanceApi.adminAssign,
      drainAdminAssignFacts: writeGovernanceApi.drainAdminAssignFacts,
      serverValue: writeGovernanceApi.serverValue,
      kovoAppShellViteDevPlugin: viteDevApi.kovoAppShellViteDevPlugin,
      StaticExportError: staticExportDiagnosticsApi.StaticExportError,
      toNodeHandler: nodeSourceApi.toNodeHandler,
    }).filter((key) => !renderingSubpathOnlyValues.has(key));

    expect(Object.keys(publicValues).sort()).toEqual(rootValues);
    expect(Object.keys(packageRootValues).sort()).toEqual(rootValues);
    expect(Object.keys(staticExportOrchestratorApi).sort()).toEqual(['exportStaticApp']);

    expect(publicApi.createApp).toBe(appApi.createApp);
    expect(publicApi.createRequestHandler).toBe(appApi.createRequestHandler);
    expect(publicApi.exportStaticApp).toBe(staticExportOrchestratorApi.exportStaticApp);
    expect(publicApi.isKovoApp).toBe(appGuardsApi.isKovoApp);
    expect(publicApi.stylesheet).toBe(hintsApi.stylesheet);
    // SPEC.md §9.5: `createApp({ clientModules })` consumers construct a registry,
    // so the constructor stays public at the root and shares the internal value.
    expect(publicApi.createMemoryVersionedClientModuleRegistry).toBe(
      internalClientModulesApi.createMemoryVersionedClientModuleRegistry,
    );
    // SPEC.md §9.5: dev integration/plugin are public at the root barrel (create-kovo
    // starter template vite.config.ts) and share the vite-dev source values.
    expect(publicApi.createKovoAppShellViteDevIntegration).toBe(
      viteDevApi.createKovoAppShellViteDevIntegration,
    );
    expect(publicApi.kovoAppShellViteDevPlugin).toBe(viteDevApi.kovoAppShellViteDevPlugin);
    expect(packageRootApi.createKovoAppShellViteDevIntegration).toBe(
      viteDevApi.createKovoAppShellViteDevIntegration,
    );
    expect(packageRootApi.kovoAppShellViteDevPlugin).toBe(viteDevApi.kovoAppShellViteDevPlugin);
    expect(publicApi.StaticExportError).toBe(staticExportDiagnosticsApi.StaticExportError);
    expect(publicApi.toNodeHandler).toBe(nodeSourceApi.toNodeHandler);
    expect(publicValues).not.toHaveProperty('parseRouteRequest');
    expect(publicValues).not.toHaveProperty('endpointMatches');
    expect(publicValues).not.toHaveProperty('runEndpoint');
    expect(publicValues).not.toHaveProperty('runMutation');
    expect(publicValues).not.toHaveProperty('runQuery');
    expect(publicValues).not.toHaveProperty('runRoutePage');
    expect(publicValues).not.toHaveProperty('runWebhook');
    expect(publicValues).not.toHaveProperty('renderMutationEndpointResponse');
    expect(publicValues).not.toHaveProperty('renderMutationResponse');
    expect(publicValues).not.toHaveProperty('renderNoJsMutationResponse');
    expect(publicValues).not.toHaveProperty('renderQueryEndpointResponse');
    expect(publicValues).not.toHaveProperty('renderQueryRegistryEndpointResponse');
    // CSP-3 (bugs-part3): `renderContentSecurityPolicy` + `cspSha256` are now public at
    // the root barrel so apps can emit the framework's own hash-based CSP. (Inverts the
    // prior not-public assertions.)
    expect(publicApi.renderContentSecurityPolicy).toBe(cspApi.renderContentSecurityPolicy);
    expect(publicApi.cspSha256).toBe(cspApi.cspSha256);
    expect(publicApi.Defer).toBe(renderingApi.Defer);
    expect(publicApi.Document).toBe(documentStructuredApi.Document);
    expect(publicApi.Head).toBe(documentStructuredApi.Head);
    expect(publicApi.BodyStart).toBe(documentStructuredApi.BodyStart);
    expect(publicApi.BodyEnd).toBe(documentStructuredApi.BodyEnd);
    expect(publicApi.HtmlAttrs).toBe(documentStructuredApi.HtmlAttrs);
    expect(publicApi.BodyAttrs).toBe(documentStructuredApi.BodyAttrs);
    expect(publicApi.FontPreload).toBe(documentStructuredApi.FontPreload);
    expect(publicApi.InlineScript).toBe(documentStructuredApi.InlineScript);
    expect(publicApi.InlineStyle).toBe(documentStructuredApi.InlineStyle);
    expect(renderingApi.Link).toBe(documentStructuredApi.Link);
    expect(publicValues).not.toHaveProperty('DocumentLink');
    expect(publicValues).not.toHaveProperty('defer');
    expect(packageRootApi.renderContentSecurityPolicy).toBe(cspApi.renderContentSecurityPolicy);
    expect(packageRootApi.cspSha256).toBe(cspApi.cspSha256);
    expect(packageRootApi.Defer).toBe(renderingApi.Defer);
    expect(packageRootValues).not.toHaveProperty('defer');
    expect(publicValues).not.toHaveProperty('renderDeferredDocument');
    expect(publicValues).not.toHaveProperty('renderDeferredStream');
    expect(publicValues).not.toHaveProperty('renderDiagnosticDocument');
    expect(publicValues).not.toHaveProperty('renderDocument');
    expect(publicValues).not.toHaveProperty('renderDocumentQueryScript');
    expect(publicValues).not.toHaveProperty('renderErrorDocument');
    expect(publicValues).not.toHaveProperty('renderPageHints');
    expect(publicValues).not.toHaveProperty('renderQueryScript');
    expect(publicValues).not.toHaveProperty('renderRouteDocumentResponse');
    expect(publicValues).not.toHaveProperty('renderRoutePageResponse');
    expect(publicValues).not.toHaveProperty('readHeader');
    expect(publicValues).not.toHaveProperty('renderComponent');
    for (const key of renderingSubpathOnlyValues) {
      expect(publicValues).not.toHaveProperty(key);
      expect(packageRootValues).not.toHaveProperty(key);
    }
    expect(dataApi).not.toHaveProperty('renderMutationEndpointResponse');
    expect(dataApi).not.toHaveProperty('renderMutationResponse');
    expect(dataApi).not.toHaveProperty('renderNoJsMutationResponse');
    expect(dataApi).not.toHaveProperty('renderQueryEndpointResponse');
    expect(dataApi).not.toHaveProperty('renderQueryRegistryEndpointResponse');
    expect(dataApi).not.toHaveProperty('renderQueryScript');
    expect(dataApi).not.toHaveProperty('runMutation');
    expect(dataApi).not.toHaveProperty('runQuery');
    // CSP-3 (bugs-part3): the rendering barrel now re-exports the CSP helpers publicly.
    expect(renderingApi.renderContentSecurityPolicy).toBe(cspApi.renderContentSecurityPolicy);
    expect(renderingApi.cspSha256).toBe(cspApi.cspSha256);
    expect(renderingApi.Defer).toBe(internalHtmlApi.Defer);
    expect(renderingApi).not.toHaveProperty('defer');
    expect(renderingApi).not.toHaveProperty('renderDeferredDocument');
    expect(renderingApi).not.toHaveProperty('renderDeferredStream');
    expect(renderingApi).not.toHaveProperty('renderDiagnosticDocument');
    expect(renderingApi).not.toHaveProperty('renderDocument');
    expect(renderingApi).not.toHaveProperty('renderDocumentQueryScript');
    expect(renderingApi).not.toHaveProperty('renderErrorDocument');
    expect(renderingApi).not.toHaveProperty('renderPageHints');
    expect(renderingApi).not.toHaveProperty('renderComponent');
    expect(renderingApi).not.toHaveProperty('renderRouteDocumentResponse');
    expect(routingApi).not.toHaveProperty('endpointMatches');
    expect(routingApi).not.toHaveProperty('parseRouteRequest');
    expect(routingApi).not.toHaveProperty('renderRoutePageResponse');
    expect(routingApi).not.toHaveProperty('readHeader');
    expect(routingApi).not.toHaveProperty('runEndpoint');
    expect(routingApi).not.toHaveProperty('runRoutePage');
    expect(routingApi).not.toHaveProperty('runWebhook');

    expect(packageInternalHtmlApi.renderRouteDocumentResponse).toBe(
      documentCoreApi.renderRouteDocumentResponse,
    );
    expect(packageInternalHtmlApi).not.toHaveProperty('renderContentSecurityPolicy');
    expect(packageInternalHtmlApi.renderComponent).toBe(componentRenderApi.renderComponent);
    expect(packageInternalHtmlApi.renderDeferredDocument).toBe(
      documentCoreApi.renderDeferredDocument,
    );
    expect(packageInternalHtmlApi.renderDeferredStream).toBe(
      deferredStreamApi.renderDeferredStream,
    );
    expect(packageInternalHtmlApi.renderDiagnosticDocument).toBe(
      documentDiagnosticsApi.renderDiagnosticDocument,
    );
    expect(packageInternalHtmlApi.renderDocument).toBe(documentCoreApi.renderDocument);
    expect(packageInternalHtmlApi.renderDocumentQueryScript).toBe(wireHtmlApi.renderQueryScript);
    expect(packageInternalHtmlApi.renderErrorDocument).toBe(documentCoreApi.renderErrorDocument);
    expect(packageInternalHtmlApi.renderPageHints).toBe(hintsApi.renderPageHints);
    expect(packageInternalHtmlApi.renderQueryScript).toBe(wireHtmlApi.renderQueryScript);
    expect(packageInternalHtmlApi.readHeader).toBe(responseApi.readHeader);
    expect(packageInternalRouteApi.renderRoutePageResponse).toBe(routeApi.renderRoutePageResponse);
    expect(packageInternalWireApi.renderMutationEndpointResponse).toBe(
      mutationApi.renderMutationEndpointResponse,
    );
    expect(packageInternalWireApi.renderMutationResponse).toBe(mutationApi.renderMutationResponse);
    expect(packageInternalWireApi.renderNoJsMutationResponse).toBe(
      mutationApi.renderNoJsMutationResponse,
    );
    expect(packageInternalWireApi.renderQueryEndpointResponse).toBe(
      queryApi.renderQueryEndpointResponse,
    );
    expect(packageInternalWireApi.renderQueryRegistryEndpointResponse).toBe(
      queryApi.renderQueryRegistryEndpointResponse,
    );
    expect(packageInternalHtmlApi.renderRouteDocumentResponse).toBe(
      internalHtmlApi.renderRouteDocumentResponse,
    );
    expect(packageInternalRouteApi.renderRoutePageResponse).toBe(
      internalRouteApi.renderRoutePageResponse,
    );
    expect(packageInternalWireApi.renderMutationEndpointResponse).toBe(
      internalWireApi.renderMutationEndpointResponse,
    );

    expect(serverPackage.exports as Record<string, string>).not.toHaveProperty('./app-shell');
  });

  it('exposes the split app-shell package subpaths for R5/R6/R7 consumers', () => {
    // SPEC.md §9.5 keeps request-shell extension points declared and printable; the public
    // app-shell subpaths stay focused so Vite, static export, and outside adoption paths do not
    // regain an aggregate compatibility surface by accident.
    expect(moduleValueKeys(packageInternalClientModulesApi)).toEqual([
      // D1/DEPLOY-3: render-plan token preimage now folds in a grammar version + a query-shape
      // fingerprint (exported on the internal subpath for the build pipeline to wire).
      'RENDER_PLAN_GRAMMAR_VERSION',
      'computeRenderPlanFingerprint',
      'createMemoryVersionedClientModuleRegistry',
      'renderVersionedClientModuleResponse',
      'versionedClientModuleHref',
    ]);
    // A2: the per-submit Kovo-Idem hidden field is minted/rendered through the internal csrf subpath.
    expect(moduleValueKeys(packageInternalCsrfApi)).toEqual([
      'KOVO_IDEM_FIELD_NAME',
      'mintIdemToken',
      'renderMutationCsrfField',
      'renderMutationIdemField',
    ]);
    expect(packageInternalCsrfApi).toEqual(internalCsrfApi);
    expect(moduleValueKeys(packageInternalEscapeApi)).toEqual([
      'escapeAttribute',
      'escapeHtml',
      'escapeScriptJson',
      'escapeText',
      'safeUrlAttribute',
    ]);
    expect(packageInternalEscapeApi).toEqual(internalEscapeApi);
    expect(moduleValueKeys(packageInternalExecutionApi)).toEqual([
      'accessFactsFromApp',
      'createMemoryMutationReplayStore',
      'endpointMatches',
      'invalidate',
      'registerGeneratedMutationTouchRegistry',
      'registerGeneratedQueryReadRegistry',
      'resolveLifecycleRequest',
      'runEndpoint',
      'runMutation',
      'runQuery',
      'runRoutePage',
    ]);
    expect(packageInternalExecutionApi).toEqual(internalExecutionApi);
    expect(moduleValueKeys(packageViteApi)).toEqual(['kovo']);
    expect(packageViteApi.kovo).toBe(viteApi.kovo);
    expect(serverPackage.exports as Record<string, string>).toMatchObject({
      './vite': './src/vite.ts',
    });
    expect(serverPackage.exports as Record<string, string>).not.toHaveProperty('./app-shell/vite');

    expect(packageRootApi.createApp).toBe(appApi.createApp);
    expect(packageRootApi.createRequestHandler).toBe(appApi.createRequestHandler);
    expect(packageRootApi.exportStaticApp).toBe(staticExportOrchestratorApi.exportStaticApp);
    expect(packageRootApi.isKovoApp).toBe(appGuardsApi.isKovoApp);
    expect(packageRootApi.layout).toBe(routeApi.layout);
    expect(packageRootApi.respond).toBe(responseApi.respond);
    expect(packageRootApi.route).toBe(routeApi.route);
    expect(packageRootApi.stylesheet).toBe(hintsApi.stylesheet);
    expect(packageRootApi.toNodeHandler).toBe(nodeSourceApi.toNodeHandler);
    expect(packageInternalClientModulesApi.renderVersionedClientModuleResponse).toBe(
      internalClientModulesApi.renderVersionedClientModuleResponse,
    );
    expect(packageInternalClientModulesApi.versionedClientModuleHref).toBe(
      internalClientModulesApi.versionedClientModuleHref,
    );
    expect(packageInternalClientModulesApi.createMemoryVersionedClientModuleRegistry).toBe(
      internalClientModulesApi.createMemoryVersionedClientModuleRegistry,
    );
    expect(packageInternalStaticExportApi.staticExportInventory).toBe(
      staticExportResultApi.staticExportInventory,
    );
    expect(packageInternalStaticExportApi.staticExportManifest).toBe(
      staticExportResultApi.staticExportManifest,
    );
    expect(packageInternalStaticExportApi.assertStaticExportManifestMatchesResult).toBe(
      staticExportResultApi.assertStaticExportManifestMatchesResult,
    );
    expect(
      packageInternalStaticExportApi.assertStaticExportManifestUsesDirectoryIndexDocuments,
    ).toBe(staticExportResultApi.assertStaticExportManifestUsesDirectoryIndexDocuments);
    expect(packageInternalStaticExportApi.staticExportOutputPlan).toBe(
      staticExportOutputApi.staticExportOutputPlan,
    );
    expect(packageInternalStaticExportApi.formatStaticExportDiagnostic).toBe(
      staticExportDiagnosticsApi.formatStaticExportDiagnostic,
    );
    expect(packageInternalStaticExportApi.formatStaticExportDiagnostics).toBe(
      staticExportDiagnosticsApi.formatStaticExportDiagnostics,
    );
    expect(packageInternalStaticExportApi.isStaticExportDiagnostic).toBe(
      staticExportDiagnosticsApi.isStaticExportDiagnostic,
    );
    expect(packageInternalStaticExportApi.isStaticExportDiagnosticError).toBe(
      staticExportDiagnosticsApi.isStaticExportDiagnosticError,
    );
    expect(packageInternalStaticExportApi.staticExportManifest).toBe(
      internalStaticExportApi.staticExportManifest,
    );
    const appShellPackageExports = Object.fromEntries(
      Object.entries(serverPackage.exports as Record<string, string>).filter(([subpath]) =>
        subpath.startsWith('./app-shell'),
      ),
    );
    // Phase 9A removed the redundant `./app-shell/static-export` subpath; its 5 types
    // stay public via the root barrel through StaticExportResult/StaticExportOptions.
    expect(appShellPackageExports).toEqual({});
    expect(serverPackage.exports as Record<string, string>).not.toHaveProperty(
      './app-shell/static-export',
    );
    expect(serverPackage.exports as Record<string, string>).toMatchObject({
      './internal/client-modules': './src/internal/client-modules.ts',
      './internal/csrf': './src/internal/csrf.ts',
      './internal/escape': './src/internal/escape.ts',
      './internal/execution': './src/internal/execution.ts',
    });
  });

  it('validates dynamically loaded app-shell aggregates through the shared core guard', () => {
    const app = publicApi.createApp();

    expect(publicApi.isKovoApp(app)).toBe(true);
    expect(publicApi.isKovoApp(publicApi.createApp({ document: publicApi.Document({}) }))).toBe(
      true,
    );
    expect(() =>
      publicApi.createApp({ document: { template: () => '<html></html>' } as any }),
    ).toThrow('createApp({ document.template }) is not supported');
    expect(publicApi.isKovoApp({ ...app, document: undefined })).toBe(false);
    expect(publicApi.isKovoApp({ ...app, document: { template: '<html></html>' } })).toBe(false);
    expect(publicApi.isKovoApp({ ...app, document: { structured: {} } })).toBe(false);
    expect(publicApi.isKovoApp({ ...app, errorShells: undefined })).toBe(false);
    expect(publicApi.isKovoApp({ ...app, errorShells: { notFound: '<main>404</main>' } })).toBe(
      false,
    );
    expect(publicApi.isKovoApp({ ...app, clientModules: {} })).toBe(false);
    expect(publicApi.isKovoApp({ ...app, renderRoute: '<main>compat</main>' })).toBe(false);
    expect(publicApi.isKovoApp({ ...app, sessionProvider: { session: null } })).toBe(false);
    expect(
      publicApi.isKovoApp({
        ...app,
        clientModules: {
          resolve: () => ({ body: 'Not Found', headers: {}, status: 404 }),
        },
      }),
    ).toBe(false);
    expect(
      publicApi.isKovoApp({
        ...app,
        clientModules: { put: () => '/c/cart.client.js?v=test' },
      }),
    ).toBe(false);
    expect(publicApi.isKovoApp({ ...app, endpoints: [{ path: '/status' }] })).toBe(false);
    expect(
      publicApi.isKovoApp({
        ...app,
        mutations: [{ handler: () => ({ ok: true }), key: 'cart/add' }],
      }),
    ).toBe(false);
    expect(publicApi.isKovoApp({ ...app, queries: [{ key: 'cart' }] })).toBe(true);
    expect(publicApi.isKovoApp({ ...app, queries: [{ key: 'cart', reads: [{}] }] })).toBe(false);
    expect(
      publicApi.isKovoApp({ ...app, routes: [{ page: () => trustedHtml('<main>Cart</main>') }] }),
    ).toBe(false);
  });
});
