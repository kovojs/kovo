import { describe, expect, it } from 'vitest';

import * as packageRootApi from '@kovojs/server';
import * as packageClientModulesApi from '@kovojs/server/app-shell/client-modules';
import * as packageCoreApi from '@kovojs/server/app-shell/core';
import * as packageNodeApi from '@kovojs/server/app-shell/node';
import * as packageStaticExportApi from '@kovojs/server/app-shell/static-export';
import * as packageViteApi from '@kovojs/server/app-shell/vite';
import * as packageInternalClientModulesApi from '@kovojs/server/internal/client-modules';
import serverPackage from '../../package.json' with { type: 'json' };
import * as publicApi from '../index.js';
import * as clientModulesApi from './app-shell/client-modules.js';
import * as coreApi from './app-shell/core.js';
import * as internalClientModulesApi from '../internal/client-modules.js';
import * as nodeApi from './app-shell/node.js';
import * as staticExportApi from './app-shell/static-export.js';
import * as viteApi from './app-shell/vite.js';
import type * as vt from './app-shell/vite.js';
import * as dataApi from './data.js';
import * as documentCoreApi from '../document-core.js';
import * as documentDiagnosticsApi from '../document-diagnostics.js';
import * as renderingApi from './rendering.js';
import * as routingApi from './routing.js';
import * as responseApi from '../response.js';
import * as routeApi from '../route.js';
import * as staticExportDiagnosticsApi from '../static-export-diagnostics.js';
import * as staticExportOrchestratorApi from '../static-export.js';
import * as staticExportOutputApi from '../static-export-output.js';
import * as staticExportResultApi from '../static-export-result.js';
import * as viteStaticExportManifestFileApi from '../vite-static-export-manifest-file.js';
import * as viteDevApi from '../vite-dev.js';
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
type RootMemoryRegistryOptions = import('../index.js').MemoryVersionedClientModuleRegistryOptions;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootVersionedClientModuleRegistry = import('../index.js').VersionedClientModuleRegistry;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootVersionedClientModuleInput = import('../index.js').VersionedClientModuleInput;
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
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootKovoAppShellViteDevPluginFactory =
  typeof import('@kovojs/server').kovoAppShellViteDevPlugin;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootKovoAppShellViteDevPlugin = import('@kovojs/server').KovoAppShellViteDevPlugin;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootKovoAppShellViteDevPluginOptions =
  import('@kovojs/server').KovoAppShellViteDevPluginOptions;

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
type RemovedFocusedWriteWebResponseToNodeOptions =
  // @ts-expect-error SPEC.md §9.5: raw Node response writer options stay inside the node adapter
  // implementation; public app-shell/node consumers receive only the closed adapter entrypoint.
  import('./app-shell/node.js').WriteWebResponseToNodeOptions;

// @ts-expect-error SPEC.md §9.5: plugin build-output client-module planning stays internal to the
// Vite output writer, not a public app-shell/Vite consumer alias.
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedViteClientModuleOutputPlanItem = vt.KovoAppShellViteClientModuleOutputPlanItem;

// @ts-expect-error SPEC.md §9.5: plugin/build-output static-export option projection is an
// internal Vite write boundary, not an outside static-export task alias.
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedViteBuildOutputStaticExportOptions = vt.KovoAppShellViteBuildOutputStaticExportOptions;

// @ts-expect-error SPEC.md §9.5: plugin-hook build contexts stay internal to the Vite plugin
// bridge, not an outside app-shell/Vite consumer alias.
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedVitePluginBuildContext = vt.KovoAppShellVitePluginBuildContext;

// @ts-expect-error SPEC.md §9.5: plugin-hook build results stay internal to the Vite plugin
// bridge, not an outside app-shell/Vite consumer alias.
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedVitePluginBuildResult = vt.KovoAppShellVitePluginBuildResult;

// @ts-expect-error SPEC.md §9.5: Vite hook output-option plumbing stays internal to the plugin
// writer; outside app-shell/Vite consumers use the build/export bridge.
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedViteBuildOutputOptions = vt.KovoAppShellViteBuildOutputOptions;

// @ts-expect-error SPEC.md §9.5: raw Vite output.dir/file projection is plugin hook plumbing,
// not a public app-shell/Vite consumer contract.
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedViteOutputOptions = vt.KovoAppShellViteOutputOptions;

// @ts-expect-error SPEC.md §9.5: raw route-entry arrays belong to the internal Vite build owner;
// outside app-shell/Vite consumers pass routeEntryMap to the build/export bridge.
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedViteRouteBuildEntry = vt.KovoAppShellRouteBuildEntry;

// @ts-expect-error SPEC.md §9.5: direct manifest route-entry helper options are internal Vite
// build plumbing, not an outside app-shell/Vite consumer alias.
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedViteRouteEntryOptions = vt.KovoAppShellViteRouteEntryOptions;

// @ts-expect-error SPEC.md §9.5: low-level Vite asset projection options stay inside the
// build/export bridge instead of the focused public app-shell/Vite subpath.
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedViteStaticExportAssetOptions = vt.KovoAppShellViteStaticExportAssetOptions;

// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedViteManifestFileStaticExportAssetOptions =
  // @ts-expect-error SPEC.md §9.5: manifest-file asset projection options stay inside the
  // build/export bridge instead of the focused public app-shell/Vite subpath.
  vt.KovoAppShellViteManifestFileStaticExportAssetOptions;

// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedViteBuildStaticExportAssetOptions =
  // @ts-expect-error SPEC.md §9.5: build asset projection options stay inside the build/export
  // bridge instead of the focused public app-shell/Vite subpath.
  vt.KovoAppShellViteBuildStaticExportAssetOptions;

// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedViteDevPluginFactory =
  // @ts-expect-error SPEC.md §9.5: the app-shell Vite dev setup API now has the root
  // @kovojs/server canonical home, not the app-shell/vite subpath.
  typeof import('@kovojs/server/app-shell/vite').kovoAppShellViteDevPlugin;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedViteDevPlugin =
  // @ts-expect-error SPEC.md §9.5: the app-shell Vite dev setup API now has the root
  // @kovojs/server canonical home, not the app-shell/vite subpath.
  import('@kovojs/server/app-shell/vite').KovoAppShellViteDevPlugin;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedViteDevPluginOptions =
  // @ts-expect-error SPEC.md §9.5: the app-shell Vite dev setup API now has the root
  // @kovojs/server canonical home, not the app-shell/vite subpath.
  import('@kovojs/server/app-shell/vite').KovoAppShellViteDevPluginOptions;

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
    const rootAppShellEntrypoints = new Set([
      'createApp',
      'createMemoryVersionedClientModuleRegistry',
      'createRequestHandler',
      'exportStaticApp',
      'layout',
      'respond',
      'route',
      'toNodeHandler',
    ]);
    const rootAppShellEntrypointValues = {
      createApp: coreApi.createApp,
      createMemoryVersionedClientModuleRegistry:
        clientModulesApi.createMemoryVersionedClientModuleRegistry,
      createRequestHandler: coreApi.createRequestHandler,
      exportStaticApp: staticExportApi.exportStaticApp,
      layout: coreApi.layout,
      respond: coreApi.respond,
      route: coreApi.route,
      toNodeHandler: nodeApi.toNodeHandler,
    };
    const rootValues = aggregateValueKeys(dataApi, renderingApi, routingApi, {
      createApp: coreApi.createApp,
      createMemoryVersionedClientModuleRegistry:
        clientModulesApi.createMemoryVersionedClientModuleRegistry,
      createRequestHandler: coreApi.createRequestHandler,
      exportStaticApp: staticExportOrchestratorApi.exportStaticApp,
      kovoAppShellViteDevPlugin: viteDevApi.kovoAppShellViteDevPlugin,
      StaticExportError: staticExportDiagnosticsApi.StaticExportError,
      toNodeHandler: nodeApi.toNodeHandler,
    });

    expect(Object.keys(publicValues).sort()).toEqual(rootValues);
    expect(Object.keys(packageRootValues).sort()).toEqual(rootValues);
    expect(Object.keys(staticExportOrchestratorApi).sort()).toEqual(['exportStaticApp']);

    const splitAppShellValues = aggregateValueKeys(
      clientModulesApi,
      coreApi,
      nodeApi,
      staticExportApi,
      viteApi,
    );
    for (const key of splitAppShellValues) {
      if (rootAppShellEntrypoints.has(key)) {
        expect(publicValues[key]).toBe(
          rootAppShellEntrypointValues[key as keyof typeof rootAppShellEntrypointValues],
        );
      } else {
        expect(publicValues).not.toHaveProperty(key);
      }
    }

    expect(publicApi.renderDocument).toBe(documentCoreApi.renderDocument);
    expect(publicApi.renderDeferredDocument).toBe(documentCoreApi.renderDeferredDocument);
    expect(publicApi.renderRouteDocumentResponse).toBe(documentCoreApi.renderRouteDocumentResponse);
    expect(publicApi.renderDiagnosticDocument).toBe(
      documentDiagnosticsApi.renderDiagnosticDocument,
    );
    expect(renderingApi.renderDocument).toBe(documentCoreApi.renderDocument);
    expect(renderingApi.renderDiagnosticDocument).toBe(
      documentDiagnosticsApi.renderDiagnosticDocument,
    );
    expect(dataApi.renderQueryScript).toBe(wireHtmlApi.renderQueryScript);
    expect(renderingApi.renderDocumentQueryScript).toBe(wireHtmlApi.renderQueryScript);
    expect(publicApi.renderQueryScript).toBe(wireHtmlApi.renderQueryScript);
    expect(publicApi.renderDocumentQueryScript).toBe(wireHtmlApi.renderQueryScript);
    expect(publicApi.createApp).toBe(coreApi.createApp);
    expect(publicApi.createMemoryVersionedClientModuleRegistry).toBe(
      clientModulesApi.createMemoryVersionedClientModuleRegistry,
    );
    expect(publicApi.createRequestHandler).toBe(coreApi.createRequestHandler);
    expect(publicApi.exportStaticApp).toBe(staticExportOrchestratorApi.exportStaticApp);
    expect(publicApi.kovoAppShellViteDevPlugin).toBe(viteDevApi.kovoAppShellViteDevPlugin);
    expect(packageRootApi.kovoAppShellViteDevPlugin).toBe(viteDevApi.kovoAppShellViteDevPlugin);
    expect(publicApi.StaticExportError).toBe(staticExportDiagnosticsApi.StaticExportError);
    expect(publicApi.toNodeHandler).toBe(nodeApi.toNodeHandler);

    expect(serverPackage.exports as Record<string, string>).not.toHaveProperty('./app-shell');
  });

  it('exposes the split app-shell package subpaths for R5/R6/R7 consumers', () => {
    // SPEC.md §9.5 keeps request-shell extension points declared and printable; the public
    // app-shell subpaths stay focused so Vite, static export, and outside adoption paths do not
    // regain an aggregate compatibility surface by accident.
    expect(moduleValueKeys(packageClientModulesApi)).toEqual([
      'createMemoryVersionedClientModuleRegistry',
    ]);
    expect(moduleValueKeys(packageInternalClientModulesApi)).toEqual([
      'renderVersionedClientModuleResponse',
      'versionedClientModuleHref',
    ]);
    expect(moduleValueKeys(packageCoreApi)).toEqual([
      'createApp',
      'createRequestHandler',
      'isKovoApp',
      'layout',
      'respond',
      'route',
    ]);
    expect(moduleValueKeys(packageNodeApi)).toEqual(['toNodeHandler']);
    expect(moduleValueKeys(packageStaticExportApi)).toEqual([
      'assertStaticExportManifestMatchesResult',
      'assertStaticExportManifestUsesDirectoryIndexDocuments',
      'exportStaticApp',
      'formatStaticExportDiagnostic',
      'formatStaticExportDiagnostics',
      'isStaticExportDiagnostic',
      'isStaticExportDiagnosticError',
      'staticExportInventory',
      'staticExportManifest',
      'staticExportOutputPlan',
    ]);
    expect(moduleValueKeys(packageViteApi)).toEqual([
      'exportKovoAppShellViteBuildWithManifestFromManifestFile',
      'kovoAppShellViteManifestStylesheetHrefFromFile',
    ]);

    expect(packageCoreApi.createApp).toBe(coreApi.createApp);
    expect(packageCoreApi.isKovoApp).toBe(coreApi.isKovoApp);
    expect(packageCoreApi.layout).toBe(coreApi.layout);
    expect(packageCoreApi.route).toBe(routeApi.route);
    expect(packageCoreApi.respond).toBe(responseApi.respond);
    expect(packageClientModulesApi).not.toHaveProperty('renderVersionedClientModuleResponse');
    expect(packageClientModulesApi).not.toHaveProperty('versionedClientModuleHref');
    expect(packageInternalClientModulesApi.renderVersionedClientModuleResponse).toBe(
      internalClientModulesApi.renderVersionedClientModuleResponse,
    );
    expect(packageInternalClientModulesApi.versionedClientModuleHref).toBe(
      internalClientModulesApi.versionedClientModuleHref,
    );
    expect(packageNodeApi.toNodeHandler).toBe(nodeApi.toNodeHandler);
    expect(packageNodeApi).not.toHaveProperty('nodeRequestToWebRequest');
    expect(packageNodeApi).not.toHaveProperty('writeWebResponseToNode');
    expect(packageStaticExportApi.exportStaticApp).toBe(staticExportApi.exportStaticApp);
    expect(packageStaticExportApi).not.toHaveProperty('StaticExportError');
    expect(packageStaticExportApi.staticExportInventory).toBe(
      staticExportResultApi.staticExportInventory,
    );
    expect(packageStaticExportApi.staticExportManifest).toBe(
      staticExportResultApi.staticExportManifest,
    );
    expect(packageStaticExportApi.assertStaticExportManifestMatchesResult).toBe(
      staticExportResultApi.assertStaticExportManifestMatchesResult,
    );
    expect(packageStaticExportApi.assertStaticExportManifestUsesDirectoryIndexDocuments).toBe(
      staticExportResultApi.assertStaticExportManifestUsesDirectoryIndexDocuments,
    );
    expect(packageStaticExportApi.staticExportOutputPlan).toBe(
      staticExportOutputApi.staticExportOutputPlan,
    );
    expect(packageStaticExportApi.formatStaticExportDiagnostic).toBe(
      staticExportDiagnosticsApi.formatStaticExportDiagnostic,
    );
    expect(packageStaticExportApi.isStaticExportDiagnosticError).toBe(
      staticExportDiagnosticsApi.isStaticExportDiagnosticError,
    );
    expect(packageViteApi.exportKovoAppShellViteBuildWithManifestFromManifestFile).toBe(
      viteStaticExportManifestFileApi.exportKovoAppShellViteBuildWithManifestFromManifestFile,
    );
    expect(packageViteApi.kovoAppShellViteManifestStylesheetHrefFromFile).toBe(
      viteApi.kovoAppShellViteManifestStylesheetHrefFromFile,
    );
    expect(packageViteApi).not.toHaveProperty('createKovoAppShellViteBuild');
    expect(packageViteApi).not.toHaveProperty('createKovoAppShellViteBuildFromBundle');
    expect(packageViteApi).not.toHaveProperty('createKovoAppShellViteBuildFromManifestFile');
    expect(packageViteApi).not.toHaveProperty('createKovoAppShellBuild');
    expect(packageViteApi).not.toHaveProperty('KovoAppShellViteInput');
    expect(packageViteApi).not.toHaveProperty('exportKovoAppShellViteBuild');
    expect(packageViteApi).not.toHaveProperty('exportKovoAppShellViteBuildFromManifestFile');
    expect(packageViteApi).not.toHaveProperty('exportKovoAppShellViteBuildWithManifest');
    expect(packageViteApi).not.toHaveProperty('writeKovoAppShellViteBuildOutput');
    expect(packageViteApi).not.toHaveProperty('writeKovoAppShellVitePluginBuild');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteOutputDir');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteManifestFile');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteBuildStaticExportAssets');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteManifestAssets');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteManifestAssetsFromFile');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteManifestFromBundle');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteManifestFromFile');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteManifestHints');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteManifestStylesheetHref');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteManifestStylesheetHrefs');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteManifestStylesheetHrefsFromFile');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellVitePlugin');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteRouteEntries');
    expect(packageViteApi).not.toHaveProperty('renderKovoAppShellViteDevDiagnosticResponse');
    expect(packageViteApi).not.toHaveProperty('shouldHandleKovoAppShellViteRequest');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteDevPlugin');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteStaticExportAssets');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteStaticExportAssetsFromManifestFile');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteSsrDevPlugin');
    expect(packageViteApi).not.toHaveProperty('shouldHandleKovoAppShellViteSsrRequest');

    const appShellPackageExports = Object.fromEntries(
      Object.entries(serverPackage.exports as Record<string, string>).filter(([subpath]) =>
        subpath.startsWith('./app-shell'),
      ),
    );
    expect(appShellPackageExports).toEqual({
      './app-shell/client-modules': './src/api/app-shell/client-modules.ts',
      './app-shell/core': './src/api/app-shell/core.ts',
      './app-shell/node': './src/api/app-shell/node.ts',
      './app-shell/static-export': './src/api/app-shell/static-export.ts',
      './app-shell/vite': './src/api/app-shell/vite.ts',
    });
    expect(serverPackage.exports as Record<string, string>).toMatchObject({
      './internal/client-modules': './src/internal/client-modules.ts',
    });
  });

  it('validates dynamically loaded app-shell aggregates through the shared core guard', () => {
    const app = coreApi.createApp();

    expect(packageCoreApi.isKovoApp(app)).toBe(true);
    expect(packageCoreApi.isKovoApp({ ...app, document: undefined })).toBe(false);
    expect(packageCoreApi.isKovoApp({ ...app, document: { template: '<html></html>' } })).toBe(
      false,
    );
    expect(packageCoreApi.isKovoApp({ ...app, errorShells: undefined })).toBe(false);
    expect(
      packageCoreApi.isKovoApp({ ...app, errorShells: { notFound: '<main>404</main>' } }),
    ).toBe(false);
    expect(packageCoreApi.isKovoApp({ ...app, clientModules: {} })).toBe(false);
    expect(packageCoreApi.isKovoApp({ ...app, renderRoute: '<main>compat</main>' })).toBe(false);
    expect(packageCoreApi.isKovoApp({ ...app, sessionProvider: { session: null } })).toBe(false);
    expect(
      packageCoreApi.isKovoApp({
        ...app,
        clientModules: {
          resolve: () => ({ body: 'Not Found', headers: {}, status: 404 }),
        },
      }),
    ).toBe(false);
    expect(
      packageCoreApi.isKovoApp({
        ...app,
        clientModules: { put: () => '/c/cart.client.js?v=test' },
      }),
    ).toBe(false);
    expect(packageCoreApi.isKovoApp({ ...app, endpoints: [{ path: '/status' }] })).toBe(false);
    expect(
      packageCoreApi.isKovoApp({
        ...app,
        mutations: [{ handler: () => ({ ok: true }), key: 'cart/add' }],
      }),
    ).toBe(false);
    expect(packageCoreApi.isKovoApp({ ...app, queries: [{ key: 'cart', reads: [{}] }] })).toBe(
      false,
    );
    expect(
      packageCoreApi.isKovoApp({ ...app, routes: [{ page: () => '<main>Cart</main>' }] }),
    ).toBe(false);
  });
});
