import { describe, expect, it } from 'vitest';

import * as publicApi from '../index.js';
import * as clientModulesApi from './app-shell/client-modules.js';
import * as coreApi from './app-shell/core.js';
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

    expect(appApi.exportStaticApp).toBe(staticExportApi.exportStaticApp);
    expect(publicApi.StaticExportError).toBe(staticExportApi.StaticExportError);

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
});
