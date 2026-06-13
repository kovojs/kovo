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
import * as staticExportDiagnosticsApi from '../static-export-diagnostics.js';
import * as staticExportOrchestratorApi from '../static-export.js';
import * as staticExportOutputApi from '../static-export-output.js';
import * as staticExportResultApi from '../static-export-result.js';
import * as wireHtmlApi from '../wire-html.js';

function aggregateValueKeys(...modules: readonly Record<string, unknown>[]): string[] {
  return [...new Set(modules.flatMap((module) => Object.keys(module)))].sort();
}

describe('server app-shell public API barrels', () => {
  it('keeps app-shell helpers on app-shell subpaths while root preserves CLI static export', () => {
    const publicValues = publicApi as Record<string, unknown>;
    const rootAppShellEntrypoints = new Set([
      'createApp',
      'createRequestHandler',
      'exportStaticApp',
    ]);
    const rootAppShellEntrypointValues = {
      createApp: coreApi.createApp,
      createRequestHandler: coreApi.createRequestHandler,
      exportStaticApp: staticExportApi.exportStaticApp,
    };
    const rootValues = aggregateValueKeys(dataApi, renderingApi, routingApi, {
      createApp: coreApi.createApp,
      createRequestHandler: coreApi.createRequestHandler,
      exportStaticApp: staticExportOrchestratorApi.exportStaticApp,
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
    expect(publicApi.createRequestHandler).toBe(coreApi.createRequestHandler);
    expect(publicApi.exportStaticApp).toBe(staticExportOrchestratorApi.exportStaticApp);

    expect(serverPackage.exports as Record<string, string>).not.toHaveProperty('./app-shell');
  });

  it('exposes the split app-shell package subpaths for R5/R6/R7 consumers', () => {
    expect(packageCoreApi.createApp).toBe(coreApi.createApp);
    expect(packageCoreApi.isJisoApp).toBe(coreApi.isJisoApp);
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
    expect(packageViteApi.writeJisoAppShellVitePluginBuild).toBe(
      viteApi.writeJisoAppShellVitePluginBuild,
    );
    expect(packageViteApi.exportJisoAppShellViteBuildFromManifestFile).toBe(
      viteApi.exportJisoAppShellViteBuildFromManifestFile,
    );
    expect(packageViteApi.staticExportInventoryForJisoAppShellViteBuild).toBe(
      viteApi.staticExportInventoryForJisoAppShellViteBuild,
    );
    expect(packageViteApi.staticExportInventoryForJisoAppShellViteBuildFromManifestFile).toBe(
      viteApi.staticExportInventoryForJisoAppShellViteBuildFromManifestFile,
    );
    expect(packageViteApi.staticExportManifestForJisoAppShellViteBuild).toBe(
      viteApi.staticExportManifestForJisoAppShellViteBuild,
    );
    expect(packageViteApi.staticExportManifestForJisoAppShellViteBuildFromManifestFile).toBe(
      viteApi.staticExportManifestForJisoAppShellViteBuildFromManifestFile,
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
});
