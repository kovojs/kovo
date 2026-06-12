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
import * as appApi from './app.js';

import type {
  JisoApp as PublicJisoApp,
  JisoAppShellBuild as PublicJisoAppShellBuild,
  StaticExportOptions as PublicStaticExportOptions,
  VersionedClientModuleRegistry as PublicVersionedClientModuleRegistry,
} from '../index.js';
import type { VersionedClientModuleRegistry as ClientModulesVersionedClientModuleRegistry } from './app-shell/client-modules.js';
import type { JisoApp as CoreJisoApp } from './app-shell/core.js';
import type { StaticExportOptions as StaticExportStaticExportOptions } from './app-shell/static-export.js';
import type { JisoAppShellBuild as ViteJisoAppShellBuild } from './app-shell/vite.js';

describe('server app-shell public API barrels', () => {
  it('keeps the package app-shell API on the public barrel while splitting ownership', () => {
    expect(appApi.createApp).toBe(coreApi.createApp);
    expect(publicApi.createApp).toBe(coreApi.createApp);
    expect(publicApi.createRequestHandler).toBe(coreApi.createRequestHandler);

    expect(appApi.createMemoryVersionedClientModuleRegistry).toBe(
      clientModulesApi.createMemoryVersionedClientModuleRegistry,
    );
    expect(publicApi.versionedClientModuleHref).toBe(clientModulesApi.versionedClientModuleHref);

    expect(appApi.toNodeHandler).toBe(nodeApi.toNodeHandler);
    expect(publicApi.writeWebResponseToNode).toBe(nodeApi.writeWebResponseToNode);

    expect(appApi.createJisoAppShellViteBuild).toBe(viteApi.createJisoAppShellViteBuild);
    expect(publicApi.jisoAppShellVitePlugin).toBe(viteApi.jisoAppShellVitePlugin);
    expect(publicApi.shouldHandleJisoAppShellViteRequest).toBe(
      viteApi.shouldHandleJisoAppShellViteRequest,
    );
    expect(publicApi.staticExportInventoryForJisoAppShellViteBuild).toBe(
      viteApi.staticExportInventoryForJisoAppShellViteBuild,
    );
    expect(publicApi.staticExportInventoryForJisoAppShellViteBuildFromManifestFile).toBe(
      viteApi.staticExportInventoryForJisoAppShellViteBuildFromManifestFile,
    );
    expect(publicApi.jisoAppShellViteManifestFile).toBe(viteApi.jisoAppShellViteManifestFile);
    expect(publicApi.jisoAppShellViteStaticExportAssetsFromManifestFile).toBe(
      viteApi.jisoAppShellViteStaticExportAssetsFromManifestFile,
    );

    expect(appApi.exportStaticApp).toBe(staticExportApi.exportStaticApp);
    expect(appApi.staticExportInventory).toBe(staticExportApi.staticExportInventory);
    expect(publicApi.StaticExportError).toBe(staticExportApi.StaticExportError);

    expect(appShellApi.createApp).toBe(coreApi.createApp);
    expect(appShellApi.createMemoryVersionedClientModuleRegistry).toBe(
      clientModulesApi.createMemoryVersionedClientModuleRegistry,
    );
    expect(appShellApi.toNodeHandler).toBe(nodeApi.toNodeHandler);
    expect(appShellApi.exportStaticApp).toBe(staticExportApi.exportStaticApp);
    expect(appShellApi.staticExportInventory).toBe(staticExportApi.staticExportInventory);
    expect(appShellApi.createJisoAppShellViteBuild).toBe(viteApi.createJisoAppShellViteBuild);
    expect(appShellApi.staticExportInventoryForJisoAppShellViteBuild).toBe(
      viteApi.staticExportInventoryForJisoAppShellViteBuild,
    );
    expect(appShellApi.staticExportInventoryForJisoAppShellViteBuildFromManifestFile).toBe(
      viteApi.staticExportInventoryForJisoAppShellViteBuildFromManifestFile,
    );
    expect(appShellApi.jisoAppShellViteManifestFile).toBe(viteApi.jisoAppShellViteManifestFile);
    expect(appShellApi.jisoAppShellViteStaticExportAssetsFromManifestFile).toBe(
      viteApi.jisoAppShellViteStaticExportAssetsFromManifestFile,
    );

    type PublicAppShellTypesStayAssignable = [
      PublicJisoApp extends CoreJisoApp ? true : false,
      PublicJisoAppShellBuild extends ViteJisoAppShellBuild ? true : false,
      PublicStaticExportOptions extends StaticExportStaticExportOptions ? true : false,
      PublicVersionedClientModuleRegistry extends ClientModulesVersionedClientModuleRegistry
        ? true
        : false,
    ];

    const publicAppShellTypesStayAssignable: PublicAppShellTypesStayAssignable = [
      true,
      true,
      true,
      true,
    ];

    expect(publicAppShellTypesStayAssignable).toEqual([true, true, true, true]);
  });

  it('exposes the split app-shell package subpaths for R5/R6/R7 consumers', () => {
    expect(packageCoreApi.createApp).toBe(coreApi.createApp);
    expect(packageClientModulesApi.versionedClientModuleHref).toBe(
      clientModulesApi.versionedClientModuleHref,
    );
    expect(packageNodeApi.toNodeHandler).toBe(nodeApi.toNodeHandler);
    expect(packageStaticExportApi.exportStaticApp).toBe(staticExportApi.exportStaticApp);
    expect(packageStaticExportApi.staticExportInventory).toBe(
      staticExportApi.staticExportInventory,
    );
    expect(packageViteApi.createJisoAppShellViteBuild).toBe(viteApi.createJisoAppShellViteBuild);
    expect(packageViteApi.staticExportInventoryForJisoAppShellViteBuild).toBe(
      viteApi.staticExportInventoryForJisoAppShellViteBuild,
    );
    expect(packageViteApi.staticExportInventoryForJisoAppShellViteBuildFromManifestFile).toBe(
      viteApi.staticExportInventoryForJisoAppShellViteBuildFromManifestFile,
    );
    expect(packageViteApi.jisoAppShellViteManifestFile).toBe(viteApi.jisoAppShellViteManifestFile);
    expect(packageViteApi.jisoAppShellViteStaticExportAssetsFromManifestFile).toBe(
      viteApi.jisoAppShellViteStaticExportAssetsFromManifestFile,
    );

    expect(packageAppShellApi.createRequestHandler).toBe(coreApi.createRequestHandler);
    expect(packageAppShellApi.renderVersionedClientModuleResponse).toBe(
      clientModulesApi.renderVersionedClientModuleResponse,
    );
    expect(packageAppShellApi.writeWebResponseToNode).toBe(nodeApi.writeWebResponseToNode);
    expect(packageAppShellApi.StaticExportError).toBe(staticExportApi.StaticExportError);
    expect(packageAppShellApi.staticExportInventory).toBe(staticExportApi.staticExportInventory);
    expect(packageAppShellApi.jisoAppShellVitePlugin).toBe(viteApi.jisoAppShellVitePlugin);
    expect(packageAppShellApi.staticExportInventoryForJisoAppShellViteBuild).toBe(
      viteApi.staticExportInventoryForJisoAppShellViteBuild,
    );
    expect(packageAppShellApi.staticExportInventoryForJisoAppShellViteBuildFromManifestFile).toBe(
      viteApi.staticExportInventoryForJisoAppShellViteBuildFromManifestFile,
    );
    expect(packageAppShellApi.jisoAppShellViteManifestFile).toBe(
      viteApi.jisoAppShellViteManifestFile,
    );
    expect(packageAppShellApi.jisoAppShellViteStaticExportAssetsFromManifestFile).toBe(
      viteApi.jisoAppShellViteStaticExportAssetsFromManifestFile,
    );
  });
});
