import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';
import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { domain } from './domain.js';
import { appLiveTargetAttestationAudience } from './live-target-app-identity.js';
import { createLiveTargetAttestation as createAppLiveTargetAttestation } from './internal/wire.js';
import {
  registerGeneratedLiveTargetRenderer,
  runWithGeneratedLiveTargetRegistry,
} from './live-target-registry.js';
import { mutation, renderMutationEndpointResponse } from './mutation.js';
import {
  createLiveTargetAttestation,
  mutationWireRequestFromHeaders,
  type LiveTargetRenderer,
} from './mutation-wire.js';
import { query } from './query.js';
import { s } from './schema.js';
import { createLiveTargetTestAuthority } from './test-fixtures.js';

const appIds = {
  concurrentA: 'c1e6eb56-284e-4792-893c-f029c5903af0',
  concurrentB: 'a80bdb22-3c99-4e7f-b5d4-ddf60a72ad14',
  oneShotFirst: '70f4aa28-2f25-479a-842e-3154ad7815c2',
  oneShotSecond: '4565808c-42d7-410e-a2ce-dbd14fa7df91',
  rendererOwner: '0763f09d-3b43-43cb-8d8b-dd7bc7841de1',
  rendererless: 'ee443c98-19f2-4b57-b07c-504990f70b74',
  tenantA: '6cbfeea5-425b-46c6-b482-0895b74cfa20',
  tenantB: '8da1382e-a034-4a2b-9ef5-595c2cc20348',
} as const;

describe('live-target app authority isolation', () => {
  it('keeps concurrent top-level-await app graphs in separate generated registries', async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstRenderer: LiveTargetRenderer = {
      component: 'shared/card',
      render: () => '<card>APP_A</card>',
    };
    const secondRenderer: LiveTargetRenderer = {
      component: 'shared/card',
      render: () => '<card>APP_B</card>',
    };

    const first = runWithGeneratedLiveTargetRegistry(async () => {
      registerGeneratedLiveTargetRenderer(firstRenderer);
      await gate;
      return createApp({ appId: appIds.concurrentA });
    });
    const second = runWithGeneratedLiveTargetRegistry(async () => {
      registerGeneratedLiveTargetRenderer(secondRenderer);
      releaseFirst();
      return createApp({ appId: appIds.concurrentB });
    });

    const [appA, appB] = await Promise.all([first, second]);
    expect(appA.liveTargetRenderers).toEqual([firstRenderer]);
    expect(appB.liveTargetRenderers).toEqual([secondRenderer]);
  });

  it('hands one generated registry to exactly one app and seals late registration', () => {
    const firstRenderer: LiveTargetRenderer = {
      component: 'shared/one-shot',
      render: () => '<card>FIRST</card>',
    };
    const lateRenderer: LiveTargetRenderer = {
      component: 'shared/late',
      render: () => '<card>LATE</card>',
    };

    runWithGeneratedLiveTargetRegistry(() => {
      registerGeneratedLiveTargetRenderer(firstRenderer);
      const first = createApp({ appId: appIds.oneShotFirst });
      const second = createApp({ appId: appIds.oneShotSecond });

      expect(first.liveTargetRenderers).toEqual([firstRenderer]);
      expect(second.liveTargetRenderers).toEqual([]);
      expect(() => registerGeneratedLiveTargetRenderer(lateRenderer)).toThrow(
        /after the app aggregate consumed/u,
      );
    });
  });

  it('rejects same-component descriptor replay between explicit app identities', () => {
    const rendererA: LiveTargetRenderer = {
      component: 'shared/card',
      render: () => '<card>APP_A</card>',
    };
    const rendererB: LiveTargetRenderer = {
      component: 'shared/card',
      render: () => '<card>APP_B</card>',
    };
    const appA = createApp({ appId: appIds.tenantA, liveTargetRenderers: [rendererA] });
    const appB = createApp({ appId: appIds.tenantB, liveTargetRenderers: [rendererB] });
    const descriptor = { component: 'shared/card', props: {}, target: 'shared' };
    expect(() =>
      (createAppLiveTargetAttestation as unknown as (...args: unknown[]) => string)(descriptor, {
        buildToken: appLiveTargetAttestationAudience(appB),
        request: {},
      }),
    ).toThrow(/requires a closed Kovo app owner/u);
    const tokenA = createAppLiveTargetAttestation(appA, descriptor, {});
    const header = `shared#shared/card@${tokenA}:{}`;

    expect(
      mutationWireRequestFromHeaders({
        buildToken: appB.clientModules.buildToken(),
        headers: { 'Kovo-Live-Targets': header },
        liveTargetAudience: appLiveTargetAttestationAudience(appB),
        rawInput: {},
        request: {},
      }).liveTargetDescriptors,
    ).toEqual([]);
    expect(
      mutationWireRequestFromHeaders({
        buildToken: appA.clientModules.buildToken(),
        headers: { 'Kovo-Live-Targets': header },
        liveTargetAudience: appLiveTargetAttestationAudience(appA),
        rawInput: {},
        request: {},
      }).liveTargetDescriptors,
    ).toHaveLength(1);
  });

  it('rejects duplicate explicit renderer component authority while closing the app', () => {
    const first: LiveTargetRenderer = {
      component: 'shared/collision',
      render: () => '<sensitive />',
    };
    const second: LiveTargetRenderer = {
      component: 'shared/collision',
      render: () => '<public />',
    };

    expect(() =>
      createApp({
        appId: '4889d1ef-435d-4398-9301-20217e1417a8',
        liveTargetRenderers: [first, second],
      }),
    ).toThrow(/Duplicate live-target renderer component "shared\/collision"/u);
  });

  it('isolates same-build development apps even when appId is omitted', () => {
    const renderer: LiveTargetRenderer = {
      component: 'shared/default-card',
      render: () => '<card />',
    };
    const appA = createApp({ liveTargetRenderers: [renderer] });
    const appB = createApp({ liveTargetRenderers: [renderer] });

    expect(appA.clientModules.buildToken()).toBe(appB.clientModules.buildToken());
    expect(appLiveTargetAttestationAudience(appA)).not.toBe(appLiveTargetAttestationAudience(appB));
  });

  it('never shares a live-target audience with a same-build rendererless app', () => {
    const renderer: LiveTargetRenderer = {
      component: 'shared/renderer-owned',
      render: () => '<card />',
    };
    const rendererless = createApp({ appId: appIds.rendererless });
    const rendererOwner = createApp({
      appId: appIds.rendererOwner,
      liveTargetRenderers: [renderer],
    });

    expect(appLiveTargetAttestationAudience(rendererless)).not.toBe(
      appLiveTargetAttestationAudience(rendererOwner),
    );
  });

  it('never falls back from an endpoint to a generated registry outside its owner scope', async () => {
    const records = domain('registry-owner-records');
    const recordsQuery = query('registry-owner-query', {
      load: () => ({ secret: 'OWNER_A' }),
      reads: [records],
    });
    const render = vi.fn(() => '<owner-a>secret</owner-a>');
    const renderer: LiveTargetRenderer = {
      component: 'owner/a',
      queries: ['registry-owner-query'],
      queryDefinitions: [recordsQuery],
      render,
    };
    runWithGeneratedLiveTargetRegistry(() => registerGeneratedLiveTargetRenderer(renderer));

    const update = mutation('owner/update', {
      csrf: false,
      csrfJustification: 'isolated internal endpoint regression',
      handler: () => ({}),
      input: s.object({}),
      registry: { queries: [recordsQuery], touches: [records] },
    });
    const descriptor = { component: 'owner/a', props: {}, target: 'owner-target' };
    const endpointAuthority = createLiveTargetTestAuthority('owner-b-build');
    const token = createLiveTargetAttestation(descriptor, {
      buildToken: endpointAuthority.audience,
      request: {},
    });
    const response = await renderMutationEndpointResponse(update, {
      buildToken: 'owner-b-build',
      headers: {
        'Kovo-Fragment': 'true',
        'Kovo-Live-Targets': `owner-target#owner/a@${token}:{}`,
      },
      liveTargetAttestationAuthority: endpointAuthority.authority,
      liveTargetAudience: endpointAuthority.audience,
      rawInput: {},
      request: {},
    });

    expect(response.status).toBe(200);
    expect(render).not.toHaveBeenCalled();
    expect(String(response.body)).not.toContain('OWNER_A');
  });

  it('rejects an empty custom build token before any app lifecycle can run', () => {
    const backing = createMemoryVersionedClientModuleRegistry();
    expect(() =>
      createApp({
        clientModules: {
          ...backing,
          buildToken: () => '',
        },
      }),
    ).toThrow(/buildToken\(\).*non-empty/u);
  });
});
