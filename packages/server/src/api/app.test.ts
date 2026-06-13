import { describe, expect, it } from 'vitest';

import * as packageClientModulesApi from '@jiso/server/app-shell/client-modules';
import * as packageCoreApi from '@jiso/server/app-shell/core';
import * as packageNodeApi from '@jiso/server/app-shell/node';
import * as packageStaticExportApi from '@jiso/server/app-shell/static-export';
import * as packageViteApi from '@jiso/server/app-shell/vite';
import serverPackage from '../../package.json' with { type: 'json' };
import * as publicApi from '../index.js';
import * as clientModulesApi from './app-shell/client-modules.js';
import * as coreApi from './app-shell/core.js';
import * as nodeApi from './app-shell/node.js';
import * as staticExportApi from './app-shell/static-export.js';
import * as viteApi from './app-shell/vite.js';
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
      'isJisoApp',
      'respond',
      'route',
    ]);
    expect(moduleValueKeys(packageNodeApi)).toEqual([
      'nodeRequestToWebRequest',
      'toNodeHandler',
      'writeWebResponseToNode',
    ]);
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
      'createJisoAppShellDevDiagnosticLedger',
      'createJisoAppShellViteBuild',
      'createJisoAppShellViteBuildFromBundle',
      'createJisoAppShellViteBuildFromManifestFile',
      'exportJisoAppShellViteBuild',
      'exportJisoAppShellViteBuildFromManifestFile',
      'exportJisoAppShellViteBuildWithManifest',
      'exportJisoAppShellViteBuildWithManifestFromManifestFile',
      'jisoAppShellViteBuildStaticExportAssets',
      'jisoAppShellViteManifestAssets',
      'jisoAppShellViteManifestAssetsFromFile',
      'jisoAppShellViteManifestFile',
      'jisoAppShellViteManifestFromBundle',
      'jisoAppShellViteManifestFromFile',
      'jisoAppShellViteManifestHints',
      'jisoAppShellViteManifestStylesheetHref',
      'jisoAppShellViteManifestStylesheetHrefFromFile',
      'jisoAppShellViteOutputDir',
      'jisoAppShellVitePlugin',
      'jisoAppShellViteRouteEntries',
      'jisoAppShellViteSsrDevPlugin',
      'jisoAppShellViteStaticExportAssets',
      'jisoAppShellViteStaticExportAssetsFromManifestFile',
      'renderJisoAppShellViteDevDiagnosticResponse',
      'shouldHandleJisoAppShellViteRequest',
      'staticExportInventoryForJisoAppShellViteBuild',
      'staticExportInventoryForJisoAppShellViteBuildFromManifestFile',
      'staticExportManifestForJisoAppShellViteBuild',
      'staticExportManifestForJisoAppShellViteBuildFromManifestFile',
      'writeJisoAppShellViteBuildOutput',
      'writeJisoAppShellVitePluginBuild',
    ]);

    expect(packageCoreApi.createApp).toBe(coreApi.createApp);
    expect(packageCoreApi.isJisoApp).toBe(coreApi.isJisoApp);
    expect(packageCoreApi.route).toBe(routeApi.route);
    expect(packageCoreApi.respond).toBe(responseApi.respond);
    expect(packageClientModulesApi.versionedClientModuleHref).toBe(
      clientModulesApi.versionedClientModuleHref,
    );
    expect(packageNodeApi.toNodeHandler).toBe(nodeApi.toNodeHandler);
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
    expect(packageViteApi.createJisoAppShellViteBuild).toBe(viteApi.createJisoAppShellViteBuild);
    expect(packageViteApi).not.toHaveProperty('createJisoAppShellBuild');
    expect(packageViteApi).not.toHaveProperty('JisoAppShellViteInput');
    expect(packageViteApi.writeJisoAppShellVitePluginBuild).toBe(
      viteApi.writeJisoAppShellVitePluginBuild,
    );
    expect(packageViteApi.exportJisoAppShellViteBuild).toBe(viteApi.exportJisoAppShellViteBuild);
    expect(viteApi.exportJisoAppShellViteBuild).toBe(
      viteStaticExportBuildApi.exportJisoAppShellViteBuild,
    );
    expect(packageViteApi.exportJisoAppShellViteBuildFromManifestFile).toBe(
      viteApi.exportJisoAppShellViteBuildFromManifestFile,
    );
    expect(viteApi.exportJisoAppShellViteBuildFromManifestFile).toBe(
      viteStaticExportManifestFileApi.exportJisoAppShellViteBuildFromManifestFile,
    );
    expect(packageViteApi.exportJisoAppShellViteBuildWithManifestFromManifestFile).toBe(
      viteApi.exportJisoAppShellViteBuildWithManifestFromManifestFile,
    );
    expect(viteApi.exportJisoAppShellViteBuildWithManifestFromManifestFile).toBe(
      viteStaticExportManifestFileApi.exportJisoAppShellViteBuildWithManifestFromManifestFile,
    );
    expect(packageViteApi.exportJisoAppShellViteBuildWithManifest).toBe(
      viteApi.exportJisoAppShellViteBuildWithManifest,
    );
    expect(viteApi.exportJisoAppShellViteBuildWithManifest).toBe(
      viteStaticExportBuildApi.exportJisoAppShellViteBuildWithManifest,
    );
    expect(packageViteApi.staticExportInventoryForJisoAppShellViteBuild).toBe(
      viteApi.staticExportInventoryForJisoAppShellViteBuild,
    );
    expect(viteApi.staticExportInventoryForJisoAppShellViteBuild).toBe(
      viteStaticExportBuildApi.staticExportInventoryForJisoAppShellViteBuild,
    );
    expect(packageViteApi.staticExportInventoryForJisoAppShellViteBuildFromManifestFile).toBe(
      viteApi.staticExportInventoryForJisoAppShellViteBuildFromManifestFile,
    );
    expect(viteApi.staticExportInventoryForJisoAppShellViteBuildFromManifestFile).toBe(
      viteStaticExportManifestFileApi.staticExportInventoryForJisoAppShellViteBuildFromManifestFile,
    );
    expect(packageViteApi.staticExportManifestForJisoAppShellViteBuild).toBe(
      viteApi.staticExportManifestForJisoAppShellViteBuild,
    );
    expect(viteApi.staticExportManifestForJisoAppShellViteBuild).toBe(
      viteStaticExportBuildApi.staticExportManifestForJisoAppShellViteBuild,
    );
    expect(packageViteApi.staticExportManifestForJisoAppShellViteBuildFromManifestFile).toBe(
      viteApi.staticExportManifestForJisoAppShellViteBuildFromManifestFile,
    );
    expect(viteApi.staticExportManifestForJisoAppShellViteBuildFromManifestFile).toBe(
      viteStaticExportManifestFileApi.staticExportManifestForJisoAppShellViteBuildFromManifestFile,
    );
    expect(packageViteApi.jisoAppShellViteManifestFile).toBe(viteApi.jisoAppShellViteManifestFile);
    expect(packageViteApi.jisoAppShellViteBuildStaticExportAssets).toBe(
      viteApi.jisoAppShellViteBuildStaticExportAssets,
    );
    expect(packageViteApi.jisoAppShellViteStaticExportAssetsFromManifestFile).toBe(
      viteApi.jisoAppShellViteStaticExportAssetsFromManifestFile,
    );
    expect(packageViteApi.jisoAppShellViteManifestStylesheetHrefFromFile).toBe(
      viteApi.jisoAppShellViteManifestStylesheetHrefFromFile,
    );
    expect(packageViteApi).not.toHaveProperty('jisoAppShellViteManifestStylesheetHrefs');
    expect(packageViteApi).not.toHaveProperty('jisoAppShellViteManifestStylesheetHrefsFromFile');
    expect(packageViteApi).not.toHaveProperty('shouldHandleJisoAppShellViteSsrRequest');

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

    expect(packageCoreApi.isJisoApp(app)).toBe(true);
    expect(packageCoreApi.isJisoApp({ ...app, document: undefined })).toBe(false);
    expect(packageCoreApi.isJisoApp({ ...app, errorShells: undefined })).toBe(false);
    expect(packageCoreApi.isJisoApp({ ...app, clientModules: {} })).toBe(false);
    expect(
      packageCoreApi.isJisoApp({
        ...app,
        clientModules: {
          resolve: () => ({ body: 'Not Found', headers: {}, status: 404 }),
        },
      }),
    ).toBe(false);
    expect(
      packageCoreApi.isJisoApp({
        ...app,
        clientModules: { put: () => '/c/cart.client.js?v=test' },
      }),
    ).toBe(false);
  });
});
