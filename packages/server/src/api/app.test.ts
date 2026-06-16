import { describe, expect, it } from 'vitest';

import * as packageClientModulesApi from '@kovojs/server/app-shell/client-modules';
import * as packageCoreApi from '@kovojs/server/app-shell/core';
import * as packageNodeApi from '@kovojs/server/app-shell/node';
import * as packageStaticExportApi from '@kovojs/server/app-shell/static-export';
import * as packageViteApi from '@kovojs/server/app-shell/vite';
import serverPackage from '../../package.json' with { type: 'json' };
import * as publicApi from '../index.js';
import * as clientModulesApi from './app-shell/client-modules.js';
import * as coreApi from './app-shell/core.js';
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
import * as viteStaticExportBuildApi from '../vite-static-export-build.js';
import * as viteStaticExportManifestFileApi from '../vite-static-export-manifest-file.js';
import * as wireHtmlApi from '../wire-html.js';

// @ts-expect-error SPEC.md §9.5: raw web request handlers are app-shell/core boundary types,
// not root @kovojs/server compatibility aliases.
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootRequestHandler = import('../index.js').RequestHandler;

// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootMemoryRegistryOptions =
  // @ts-expect-error SPEC.md §9.5: memory registry options belong to app-shell/client-modules.
  import('../index.js').MemoryVersionedClientModuleRegistryOptions;

// @ts-expect-error SPEC.md §9.5: versioned client-module registry contracts belong to the focused
// app-shell/client-modules subpath, not the root @kovojs/server barrel.
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootVersionedClientModuleRegistry = import('../index.js').VersionedClientModuleRegistry;

// @ts-expect-error SPEC.md §9.5: Node adapter options belong to the focused app-shell/node
// subpath, not the root @kovojs/server barrel.
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootNodeHandlerOptions = import('../index.js').NodeHandlerOptions;

// @ts-expect-error SPEC.md §9.5: Node request handlers belong to the focused app-shell/node
// subpath, not the root @kovojs/server barrel.
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootNodeRequestHandler = import('../index.js').NodeRequestHandler;

// Focused app-shell subpaths remain the public type homes for the removed root aliases.
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type FocusedRequestHandler = import('./app-shell/core.js').RequestHandler;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type FocusedMemoryRegistryOptions =
  import('./app-shell/client-modules.js').MemoryVersionedClientModuleRegistryOptions;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type FocusedVersionedClientModuleRegistry =
  import('./app-shell/client-modules.js').VersionedClientModuleRegistry;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type FocusedNodeHandlerOptions = import('./app-shell/node.js').NodeHandlerOptions;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type FocusedNodeRequestHandler = import('./app-shell/node.js').NodeRequestHandler;

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

function aggregateValueKeys(...modules: readonly Record<string, unknown>[]): string[] {
  return [...new Set(modules.flatMap((module) => Object.keys(module)))].sort();
}

function moduleValueKeys(module: Record<string, unknown>): string[] {
  return Object.keys(module).sort();
}

describe('server app-shell public API barrels', () => {
  it('keeps app-shell helpers on subpaths while root preserves SPEC §9.5 built-harness entries', () => {
    const publicValues = publicApi as Record<string, unknown>;
    const rootAppShellEntrypoints = new Set([
      'createApp',
      'createMemoryVersionedClientModuleRegistry',
      'createRequestHandler',
      'exportStaticApp',
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
      toNodeHandler: nodeApi.toNodeHandler,
    });

    expect(Object.keys(publicValues).sort()).toEqual(rootValues);
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
    expect(publicApi.toNodeHandler).toBe(nodeApi.toNodeHandler);

    expect(serverPackage.exports as Record<string, string>).not.toHaveProperty('./app-shell');
  });

  it('exposes the split app-shell package subpaths for R5/R6/R7 consumers', () => {
    // SPEC.md §9.5 keeps request-shell extension points declared and printable; the public
    // app-shell subpaths stay focused so Vite, static export, and outside adoption paths do not
    // regain an aggregate compatibility surface by accident.
    expect(moduleValueKeys(packageClientModulesApi)).toEqual([
      'createMemoryVersionedClientModuleRegistry',
      'renderVersionedClientModuleResponse',
      'versionedClientModuleHref',
    ]);
    expect(moduleValueKeys(packageCoreApi)).toEqual([
      'createApp',
      'createRequestHandler',
      'isKovoApp',
      'respond',
      'route',
    ]);
    expect(moduleValueKeys(packageNodeApi)).toEqual(['toNodeHandler']);
    expect(moduleValueKeys(packageStaticExportApi)).toEqual([
      'StaticExportError',
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
      'createKovoAppShellDevDiagnosticLedger',
      'createKovoAppShellViteBuild',
      'createKovoAppShellViteBuildFromBundle',
      'createKovoAppShellViteBuildFromManifestFile',
      'exportKovoAppShellViteBuild',
      'exportKovoAppShellViteBuildFromManifestFile',
      'exportKovoAppShellViteBuildWithManifest',
      'exportKovoAppShellViteBuildWithManifestFromManifestFile',
      'kovoAppShellViteDevPlugin',
      'kovoAppShellViteManifestFile',
      'kovoAppShellViteManifestStylesheetHrefFromFile',
      'kovoAppShellVitePlugin',
      'renderKovoAppShellViteDevDiagnosticResponse',
      'shouldHandleKovoAppShellViteRequest',
      'staticExportInventoryForKovoAppShellViteBuild',
      'staticExportInventoryForKovoAppShellViteBuildFromManifestFile',
      'staticExportManifestForKovoAppShellViteBuild',
      'staticExportManifestForKovoAppShellViteBuildFromManifestFile',
    ]);

    expect(packageCoreApi.createApp).toBe(coreApi.createApp);
    expect(packageCoreApi.isKovoApp).toBe(coreApi.isKovoApp);
    expect(packageCoreApi.route).toBe(routeApi.route);
    expect(packageCoreApi.respond).toBe(responseApi.respond);
    expect(packageClientModulesApi.versionedClientModuleHref).toBe(
      clientModulesApi.versionedClientModuleHref,
    );
    expect(packageNodeApi.toNodeHandler).toBe(nodeApi.toNodeHandler);
    expect(packageNodeApi).not.toHaveProperty('nodeRequestToWebRequest');
    expect(packageNodeApi).not.toHaveProperty('writeWebResponseToNode');
    expect(packageStaticExportApi.exportStaticApp).toBe(staticExportApi.exportStaticApp);
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
    expect(packageViteApi.createKovoAppShellViteBuild).toBe(viteApi.createKovoAppShellViteBuild);
    expect(packageViteApi).not.toHaveProperty('createKovoAppShellBuild');
    expect(packageViteApi).not.toHaveProperty('KovoAppShellViteInput');
    expect(packageViteApi).not.toHaveProperty('writeKovoAppShellViteBuildOutput');
    expect(packageViteApi).not.toHaveProperty('writeKovoAppShellVitePluginBuild');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteOutputDir');
    expect(packageViteApi.exportKovoAppShellViteBuild).toBe(viteApi.exportKovoAppShellViteBuild);
    expect(viteApi.exportKovoAppShellViteBuild).toBe(
      viteStaticExportBuildApi.exportKovoAppShellViteBuild,
    );
    expect(packageViteApi.exportKovoAppShellViteBuildFromManifestFile).toBe(
      viteApi.exportKovoAppShellViteBuildFromManifestFile,
    );
    expect(viteApi.exportKovoAppShellViteBuildFromManifestFile).toBe(
      viteStaticExportManifestFileApi.exportKovoAppShellViteBuildFromManifestFile,
    );
    expect(packageViteApi.exportKovoAppShellViteBuildWithManifestFromManifestFile).toBe(
      viteApi.exportKovoAppShellViteBuildWithManifestFromManifestFile,
    );
    expect(viteApi.exportKovoAppShellViteBuildWithManifestFromManifestFile).toBe(
      viteStaticExportManifestFileApi.exportKovoAppShellViteBuildWithManifestFromManifestFile,
    );
    expect(packageViteApi.exportKovoAppShellViteBuildWithManifest).toBe(
      viteApi.exportKovoAppShellViteBuildWithManifest,
    );
    expect(viteApi.exportKovoAppShellViteBuildWithManifest).toBe(
      viteStaticExportBuildApi.exportKovoAppShellViteBuildWithManifest,
    );
    expect(packageViteApi.staticExportInventoryForKovoAppShellViteBuild).toBe(
      viteApi.staticExportInventoryForKovoAppShellViteBuild,
    );
    expect(viteApi.staticExportInventoryForKovoAppShellViteBuild).toBe(
      viteStaticExportBuildApi.staticExportInventoryForKovoAppShellViteBuild,
    );
    expect(packageViteApi.staticExportInventoryForKovoAppShellViteBuildFromManifestFile).toBe(
      viteApi.staticExportInventoryForKovoAppShellViteBuildFromManifestFile,
    );
    expect(viteApi.staticExportInventoryForKovoAppShellViteBuildFromManifestFile).toBe(
      viteStaticExportManifestFileApi.staticExportInventoryForKovoAppShellViteBuildFromManifestFile,
    );
    expect(packageViteApi.staticExportManifestForKovoAppShellViteBuild).toBe(
      viteApi.staticExportManifestForKovoAppShellViteBuild,
    );
    expect(viteApi.staticExportManifestForKovoAppShellViteBuild).toBe(
      viteStaticExportBuildApi.staticExportManifestForKovoAppShellViteBuild,
    );
    expect(packageViteApi.staticExportManifestForKovoAppShellViteBuildFromManifestFile).toBe(
      viteApi.staticExportManifestForKovoAppShellViteBuildFromManifestFile,
    );
    expect(viteApi.staticExportManifestForKovoAppShellViteBuildFromManifestFile).toBe(
      viteStaticExportManifestFileApi.staticExportManifestForKovoAppShellViteBuildFromManifestFile,
    );
    expect(packageViteApi.kovoAppShellViteManifestFile).toBe(viteApi.kovoAppShellViteManifestFile);
    expect(packageViteApi.kovoAppShellViteManifestStylesheetHrefFromFile).toBe(
      viteApi.kovoAppShellViteManifestStylesheetHrefFromFile,
    );
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteBuildStaticExportAssets');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteManifestAssets');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteManifestAssetsFromFile');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteManifestFromBundle');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteManifestFromFile');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteManifestHints');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteManifestStylesheetHref');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteManifestStylesheetHrefs');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteManifestStylesheetHrefsFromFile');
    expect(packageViteApi).not.toHaveProperty('kovoAppShellViteRouteEntries');
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
