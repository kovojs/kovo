import { describe, expect, it } from 'vitest';

import * as packageAppShellApi from '@jiso/server/app-shell';
import * as packageClientModulesApi from '@jiso/server/app-shell/client-modules';
import * as packageCoreApi from '@jiso/server/app-shell/core';
import * as packageNodeApi from '@jiso/server/app-shell/node';
import * as packageStaticExportApi from '@jiso/server/app-shell/static-export';
import * as packageViteApi from '@jiso/server/app-shell/vite';
import * as publicApi from '../index.js';
import * as clientModulesApi from './app-shell/client-modules.js';
import * as coreApi from './app-shell/core.js';
import * as appShellApi from './app-shell/index.js';
import * as nodeApi from './app-shell/node.js';
import * as staticExportApi from './app-shell/static-export.js';
import * as viteApi from './app-shell/vite.js';
import * as dataApi from './data.js';
import * as documentCoreApi from '../document-core.js';
import * as documentDiagnosticsApi from '../document-diagnostics.js';
import * as renderingApi from './rendering.js';
import * as staticExportDiagnosticsApi from '../static-export-diagnostics.js';
import * as staticExportOutputApi from '../static-export-output.js';
import * as staticExportTypesApi from '../static-export-types.js';
import * as wireHtmlApi from '../wire-html.js';

describe('server app-shell public API barrels', () => {
  it('keeps app-shell helpers on app-shell subpaths while root preserves CLI static export', () => {
    const localAppShellValues = appShellApi as Record<string, unknown>;
    const packageAppShellValues = packageAppShellApi as Record<string, unknown>;
    const publicValues = publicApi as Record<string, unknown>;
    const rootStaticExportCompatibility = new Set(['exportStaticApp']);

    expect(Object.keys(packageAppShellValues).sort()).toEqual(
      Object.keys(localAppShellValues).sort(),
    );

    for (const key of Object.keys(localAppShellValues)) {
      expect(packageAppShellValues[key]).toBe(localAppShellValues[key]);
      if (rootStaticExportCompatibility.has(key)) {
        expect(publicValues[key]).toBe(localAppShellValues[key]);
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
    expect(publicApi.renderQueryScript).toBe(wireHtmlApi.renderQueryScript);
    expect(publicApi.exportStaticApp).toBe(staticExportApi.exportStaticApp);

    expect(appShellApi.createApp).toBe(coreApi.createApp);
    expect(appShellApi.createMemoryVersionedClientModuleRegistry).toBe(
      clientModulesApi.createMemoryVersionedClientModuleRegistry,
    );
    expect(appShellApi.toNodeHandler).toBe(nodeApi.toNodeHandler);
    expect(appShellApi.exportStaticApp).toBe(staticExportApi.exportStaticApp);
    expect(appShellApi.staticExportInventory).toBe(staticExportTypesApi.staticExportInventory);
    expect(appShellApi.staticExportManifest).toBe(staticExportTypesApi.staticExportManifest);
    expect(appShellApi.staticExportOutputPlan).toBe(staticExportOutputApi.staticExportOutputPlan);
    expect(appShellApi.formatStaticExportDiagnostics).toBe(
      staticExportDiagnosticsApi.formatStaticExportDiagnostics,
    );
    expect(appShellApi.isStaticExportDiagnostic).toBe(staticExportApi.isStaticExportDiagnostic);
    expect(appShellApi.createJisoAppShellViteBuild).toBe(viteApi.createJisoAppShellViteBuild);
    expect(appShellApi.writeJisoAppShellVitePluginBuild).toBe(
      viteApi.writeJisoAppShellVitePluginBuild,
    );
    expect(appShellApi.exportJisoAppShellViteBuildFromManifestFile).toBe(
      viteApi.exportJisoAppShellViteBuildFromManifestFile,
    );
    expect(appShellApi.staticExportInventoryForJisoAppShellViteBuild).toBe(
      viteApi.staticExportInventoryForJisoAppShellViteBuild,
    );
    expect(appShellApi.staticExportInventoryForJisoAppShellViteBuildFromManifestFile).toBe(
      viteApi.staticExportInventoryForJisoAppShellViteBuildFromManifestFile,
    );
    expect(appShellApi.staticExportManifestForJisoAppShellViteBuild).toBe(
      viteApi.staticExportManifestForJisoAppShellViteBuild,
    );
    expect(appShellApi.staticExportManifestForJisoAppShellViteBuildFromManifestFile).toBe(
      viteApi.staticExportManifestForJisoAppShellViteBuildFromManifestFile,
    );
    expect(appShellApi.jisoAppShellViteManifestFile).toBe(viteApi.jisoAppShellViteManifestFile);
    expect(appShellApi.jisoAppShellViteBuildStaticExportAssets).toBe(
      viteApi.jisoAppShellViteBuildStaticExportAssets,
    );
    expect(appShellApi.jisoAppShellViteStaticExportAssetsFromManifestFile).toBe(
      viteApi.jisoAppShellViteStaticExportAssetsFromManifestFile,
    );
    expect(appShellApi.jisoAppShellViteManifestStylesheetHrefFromFile).toBe(
      viteApi.jisoAppShellViteManifestStylesheetHrefFromFile,
    );
  });

  it('exposes the split app-shell package subpaths for R5/R6/R7 consumers', () => {
    expect(packageCoreApi.createApp).toBe(coreApi.createApp);
    expect(packageClientModulesApi.versionedClientModuleHref).toBe(
      clientModulesApi.versionedClientModuleHref,
    );
    expect(packageNodeApi.toNodeHandler).toBe(nodeApi.toNodeHandler);
    expect(packageStaticExportApi.exportStaticApp).toBe(staticExportApi.exportStaticApp);
    expect(packageStaticExportApi.staticExportInventory).toBe(
      staticExportTypesApi.staticExportInventory,
    );
    expect(packageStaticExportApi.staticExportManifest).toBe(
      staticExportTypesApi.staticExportManifest,
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

    expect(packageAppShellApi.createRequestHandler).toBe(coreApi.createRequestHandler);
    expect(packageAppShellApi.renderVersionedClientModuleResponse).toBe(
      clientModulesApi.renderVersionedClientModuleResponse,
    );
    expect(packageAppShellApi.writeWebResponseToNode).toBe(nodeApi.writeWebResponseToNode);
    expect(packageAppShellApi.StaticExportError).toBe(staticExportDiagnosticsApi.StaticExportError);
    expect(packageAppShellApi.staticExportInventory).toBe(
      staticExportTypesApi.staticExportInventory,
    );
    expect(packageAppShellApi.staticExportManifest).toBe(staticExportTypesApi.staticExportManifest);
    expect(packageAppShellApi.staticExportOutputPlan).toBe(
      staticExportOutputApi.staticExportOutputPlan,
    );
    expect(packageAppShellApi.formatStaticExportDiagnostics).toBe(
      staticExportDiagnosticsApi.formatStaticExportDiagnostics,
    );
    expect(packageAppShellApi.isStaticExportDiagnostic).toBe(
      staticExportApi.isStaticExportDiagnostic,
    );
    expect(packageAppShellApi.jisoAppShellVitePlugin).toBe(viteApi.jisoAppShellVitePlugin);
    expect(packageAppShellApi.writeJisoAppShellVitePluginBuild).toBe(
      viteApi.writeJisoAppShellVitePluginBuild,
    );
    expect(packageAppShellApi.jisoAppShellViteSsrDevPlugin).toBe(
      viteApi.jisoAppShellViteSsrDevPlugin,
    );
    expect(packageAppShellApi.exportJisoAppShellViteBuildFromManifestFile).toBe(
      viteApi.exportJisoAppShellViteBuildFromManifestFile,
    );
    expect(packageAppShellApi.staticExportInventoryForJisoAppShellViteBuild).toBe(
      viteApi.staticExportInventoryForJisoAppShellViteBuild,
    );
    expect(packageAppShellApi.staticExportInventoryForJisoAppShellViteBuildFromManifestFile).toBe(
      viteApi.staticExportInventoryForJisoAppShellViteBuildFromManifestFile,
    );
    expect(packageAppShellApi.staticExportManifestForJisoAppShellViteBuild).toBe(
      viteApi.staticExportManifestForJisoAppShellViteBuild,
    );
    expect(packageAppShellApi.staticExportManifestForJisoAppShellViteBuildFromManifestFile).toBe(
      viteApi.staticExportManifestForJisoAppShellViteBuildFromManifestFile,
    );
    expect(packageAppShellApi.jisoAppShellViteManifestFile).toBe(
      viteApi.jisoAppShellViteManifestFile,
    );
    expect(packageAppShellApi.jisoAppShellViteBuildStaticExportAssets).toBe(
      viteApi.jisoAppShellViteBuildStaticExportAssets,
    );
    expect(packageAppShellApi.jisoAppShellViteStaticExportAssetsFromManifestFile).toBe(
      viteApi.jisoAppShellViteStaticExportAssetsFromManifestFile,
    );
    expect(packageAppShellApi.jisoAppShellViteManifestStylesheetHrefFromFile).toBe(
      viteApi.jisoAppShellViteManifestStylesheetHrefFromFile,
    );
  });
});
