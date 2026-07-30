import { computeRenderPlanFingerprint } from '@kovojs/core/internal/render-plan-token';
import { describe, expect, it } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import {
  createMemoryVersionedClientModuleStore,
  snapshotVersionedClientModuleRegistry,
} from './client-modules.js';
import { claimGeneratedBuildClientModuleInstaller } from './internal/generated-build-client-modules.js';
import { runWithGeneratedLiveTargetRegistry } from './live-target-registry.js';

describe('empty generated build client-module boot scope', () => {
  it('joins the live-target lifecycle and clears every stale durable record', async () => {
    const fingerprint = computeRenderPlanFingerprint({});
    const stale = [
      {
        path: '/c/generated/app.client.js',
        source: 'export const staleReserved = true;',
      },
      {
        path: '/c/src/old.client.js',
        source: 'export const staleCompiler = true;',
      },
      {
        path: '/c/stale-manual.client.js',
        source: 'export const staleManual = true;',
      },
    ];
    const store = createMemoryVersionedClientModuleStore();
    store.replaceActiveSnapshot({
      modules: stale,
      renderPlanFingerprint: fingerprint,
    });
    const registry = snapshotVersionedClientModuleRegistry(store);
    const installer = claimGeneratedBuildClientModuleInstaller();

    const app = await runWithGeneratedLiveTargetRegistry(() =>
      installer.load(fingerprint, () => createApp({ clientModules: registry, routes: [] })),
    );
    expect(() =>
      installer.manual({
        path: '/c/late.client.js',
        source: 'export const late = true;',
      }),
    ).toThrow(/registration is already sealed/u);
    createRequestHandler(app);

    const entries = app.clientModules.entries();
    for (const staleModule of stale) {
      expect(entries).not.toContainEqual(staleModule);
    }
    expect(entries.map((module) => module.path)).toEqual(['/c/kovo-runtime.client.js']);
  });
});
