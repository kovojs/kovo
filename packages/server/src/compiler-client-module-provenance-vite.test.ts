import {
  compilerOwnedViteClientModuleRoleForPlugin,
  compilerOwnedViteDiagnosticForPlugin,
  kovoVitePlugin,
} from '@kovojs/compiler/vite';
import {
  clientModuleRepresentationDigest,
  versionedClientModuleHref,
} from '@kovojs/core/internal/client-module-url';
import { describe, expect, it } from 'vitest';

import {
  claimCompilerClientModuleViteInstaller,
  compilerClientModuleViteProtocol,
  createCompilerClientModuleViteHandoff,
  createCompilerClientModuleViteSnapshotPreparer,
  installCompilerClientModulesFromViteHandoff,
} from './compiler-client-module-provenance-vite.js';
import { compilerOwnedClientModuleRole } from './compiler-client-module-provenance.js';

const componentSource = `
import { component } from '@kovojs/core';
export const ProvenanceButton = component({
  render: () => <button onClick={() => null}>Proof</button>,
});
`;

describe('standalone Vite compiler client-module provenance handoff', () => {
  it('claims once and pins only exact records from the bound genuine plugin', async () => {
    expect(() => claimCompilerClientModuleViteInstaller('wrong-protocol')).toThrow(
      /protocol must be kovo\.compiler-client-module-role\/v1/u,
    );

    const optimisticSource = 'export const optimisticProvenance = true;\n';
    const optimisticPath = '/c/src/provenance-optimism.client.js';
    const optimisticHref = versionedClientModuleHref(
      optimisticPath,
      clientModuleRepresentationDigest(optimisticSource),
    );
    const owner = kovoVitePlugin({
      registryFacts: {
        mutationOptimism: {
          'cart/add': {
            inputFields: [],
            invalidations: ['cart'],
            moduleHref: optimisticHref,
            mutation: 'cart/add',
            statuses: { cart: 'hand-written' },
          },
        },
        optimisticModules: [
          {
            fileName: 'src/provenance-optimism.ts',
            href: optimisticHref,
            mutationKeys: ['cart/add'],
            path: optimisticPath,
            source: optimisticSource,
          },
        ],
      },
    });
    const foreignOwner = kovoVitePlugin();
    await owner.transform?.(optimisticSource, 'src/provenance-optimism.ts');
    await owner.transform?.(componentSource, 'src/provenance-button.tsx');
    await foreignOwner.transform?.(componentSource, 'src/foreign-button.tsx');
    const owned = owner.getClientModules?.() ?? [];
    const foreign = foreignOwner.getClientModules?.() ?? [];
    expect(owned.length).toBeGreaterThan(0);
    expect(foreign.length).toBeGreaterThan(0);
    expect(
      new Set(owned.map((module) => compilerOwnedViteClientModuleRoleForPlugin(owner, module))),
    ).toEqual(
      new Set(['app-bootstrap', 'component-client', 'deferred-app-runtime', 'optimistic-plan']),
    );

    let installer: ReturnType<typeof claimCompilerClientModuleViteInstaller> | undefined;
    const claim = (protocol: string) => {
      installer = claimCompilerClientModuleViteInstaller(protocol);
      return installer;
    };
    const epoch = {};
    const liveModule = Object.defineProperties(
      {},
      {
        claimCompilerClientModuleViteInstaller: {
          enumerable: true,
          get: () => claim,
        },
        compilerClientModuleViteEpoch: {
          enumerable: true,
          get: () => epoch,
        },
      },
    );
    const prepare = createCompilerClientModuleViteSnapshotPreparer(handoffFor(owner), () => owned);
    const getter = prepare(liveModule);
    expect(prepare(liveModule)).toBe(getter);
    const adopted = getter();
    expect(installer).toBeDefined();
    expect(() => claimCompilerClientModuleViteInstaller(compilerClientModuleViteProtocol)).toThrow(
      /already claimed/u,
    );
    expect(adopted).toHaveLength(owned.length);
    expect(
      adopted.map((module) => ({
        path: module.path,
        role: compilerOwnedClientModuleRole(module),
      })),
    ).toEqual(
      owned.map((module) => ({
        path: module.path,
        role: compilerOwnedViteClientModuleRoleForPlugin(owner, module),
      })),
    );

    // The holder supports later request/HMR snapshots without reopening the one-shot claim.
    expect(getter()).toHaveLength(owned.length);

    for (const candidate of [
      owned.map((module) => ({ ...module })),
      owned.map((module) => new Proxy(module, {})),
      JSON.parse(JSON.stringify(owned)) as object[],
      foreign,
    ]) {
      expect(() =>
        installCompilerClientModulesFromViteHandoff(handoffFor(owner), installer!, candidate),
      ).toThrow(/not minted by its bound genuine plugin/u);
    }
    expect(() => installCompilerClientModulesFromViteHandoff({}, installer!, owned)).toThrow(
      /handoff is not authentic/u,
    );

    const conflicting = installer!.begin();
    const source = owned.find(
      (module) => compilerOwnedViteClientModuleRoleForPlugin(owner, module) === 'component-client',
    )!;
    conflicting.adoptComponentClient(source);
    conflicting.seal();
    const conflictAttempt = installer!.begin();
    expect(() => conflictAttempt.adoptOptimisticPlan(source)).toThrow(/conflicting roles/u);
    expect(() => installer!.begin()).toThrow(/permanently closed/u);
  });
});

function handoffFor(plugin: ReturnType<typeof kovoVitePlugin>): object {
  return createCompilerClientModuleViteHandoff(
    (value) => compilerOwnedViteClientModuleRoleForPlugin(plugin, value),
    (value) => compilerOwnedViteDiagnosticForPlugin(plugin, value),
  );
}
