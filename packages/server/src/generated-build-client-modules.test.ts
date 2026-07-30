import { kovoVitePlugin } from '@kovojs/compiler';
import { compilerOwnedViteClientModuleRole } from '@kovojs/compiler/internal';
import {
  clientModuleRepresentationDigest,
  versionedClientModuleHref,
} from '@kovojs/core/internal/client-module-url';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { clientModuleBuildTokenHash } from './client-module-registry-intrinsics.js';
import {
  createMemoryVersionedClientModuleStore,
  snapshotVersionedClientModuleRegistry,
} from './client-modules.js';
import { claimGeneratedBuildClientModuleInstaller } from './internal/generated-build-client-modules.js';

async function genuineCompilerModules() {
  const plugin = kovoVitePlugin();
  await plugin.transform?.(
    `
import { component } from '@kovojs/core';
export const DealCard = component({
  queries: { deals: {} },
  state: () => ({ count: 0 }),
  render: ({ deals }) => (
    <button onClick={() => { state.count += 1; }}>{deals.length}</button>
  ),
});
`,
    'src/deal-card.tsx',
  );
  const modules = plugin.getClientModules?.() ?? [];
  if (modules.length === 0) throw new Error('Expected genuine compiler modules.');
  return modules;
}

describe('generated build client-module boot scope', () => {
  it('wholesale republishes the exact compiler plus current manual set and seals the installer', async () => {
    const modules = await genuineCompilerModules();
    const fingerprint = modules[0]!.renderPlanFingerprint!;
    const staleReserved = {
      path: '/c/generated/app.client.js',
      source: 'export const staleReserved = true;',
    };
    const staleCompiler = {
      path: '/c/src/old.client.js',
      source: 'export const staleCompiler = true;',
    };
    const staleManual = {
      path: '/c/stale-manual.client.js',
      source: 'export const staleManual = true;',
    };
    const currentManual = {
      path: '/c/current-manual.client.js',
      source: 'export const currentManual = true;',
    };
    const store = createMemoryVersionedClientModuleStore();
    store.replaceActiveSnapshot({
      modules: [staleReserved, staleCompiler, staleManual],
      renderPlanFingerprint: fingerprint,
    });
    const registry = snapshotVersionedClientModuleRegistry(store);
    registry.put(currentManual);

    const installer = claimGeneratedBuildClientModuleInstaller();
    for (const module of modules) {
      const role = compilerOwnedViteClientModuleRole(module);
      if (role === 'app-bootstrap') installer.appBootstrap(module);
      else if (role === 'component-client') installer.componentClient(module);
      else if (role === 'deferred-app-runtime') installer.deferredAppRuntime(module);
      else if (role === 'optimistic-plan') installer.optimisticPlan(module);
      else throw new Error('Genuine compiler module lost its private role.');
    }
    installer.manual(currentManual);

    const app = await installer.load(fingerprint, async () =>
      createApp({ clientModules: registry, routes: [] }),
    );
    const entries = app.clientModules.entries();
    expect(new Set(entries.map((module) => module.path))).toEqual(
      new Set([...modules.map((module) => module.path), currentManual.path]),
    );
    expect(entries).not.toContainEqual(staleReserved);
    expect(entries).not.toContainEqual(staleCompiler);
    expect(entries).not.toContainEqual(staleManual);

    const hrefs = entries
      .map((module) =>
        versionedClientModuleHref(module.path, clientModuleRepresentationDigest(module.source)),
      )
      .sort();
    expect(app.clientModules.buildToken()).toBe(clientModuleBuildTokenHash(fingerprint, hrefs));
    expect(() => installer.manual(currentManual)).toThrow(/registration is already sealed/u);
    expect(() => installer.load(fingerprint, () => undefined)).toThrow(
      /registration is already sealed/u,
    );
  });
});
