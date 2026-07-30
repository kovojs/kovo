import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { kovoVitePlugin } from '@kovojs/compiler';
import {
  compilerOwnedViteClientModuleRole,
  compilerViteClientModuleRoleProtocol,
  compilerViteClientModuleRoleVocabulary,
  type CompilerOwnedViteClientModuleRole,
} from '@kovojs/compiler/internal';
import {
  clientModuleHrefForSourceFile,
  clientModuleRepresentationDigest,
  parseVersionedClientModuleTarget,
} from '@kovojs/core/internal/client-module-url';
import type { KovoAppShellCompiledClientModule } from '@kovojs/server/internal/app-shell-vite';
import type { CompilerClientModuleBuildInstaller, KovoApp } from '@kovojs/server/internal/build';
import { describe, expect, it } from 'vitest';
import { createRunnableDevEnvironment, resolveConfig } from 'vite-plus';

import { captureBuildTimeViteRunnableLifetime } from './build-vite-lifetime.js';

const repoRoot = process.cwd();
const serverInternalBuildUrl = pathToFileURL(
  join(repoRoot, 'packages/server/src/internal/build.ts'),
).href;
const serverFixtureAppUrl = pathToFileURL(
  join(repoRoot, 'packages/server/src/internal/fixture-app.ts'),
).href;

describe('CLI compiler client-module provenance handoff', () => {
  it('adopts every exact native compiler role into two sequential isolated neutral builds', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-cli-neutral-provenance-'));
    try {
      const modules = await compilerModulesWithEveryRole();
      expect(new Set(modules.map((module) => compilerOwnedViteClientModuleRole(module)))).toEqual(
        new Set(compilerViteClientModuleRoleVocabulary),
      );
      const manifestFile = join(root, 'dist/.vite/manifest.json');
      mkdirSync(join(root, 'dist/.vite'), { recursive: true });
      writeFileSync(manifestFile, '{}', 'utf8');

      for (let iteration = 0; iteration < 2; iteration += 1) {
        await runIsolatedNeutralBuildIteration(root, manifestFile, modules, iteration);
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 30_000);
});

async function runIsolatedNeutralBuildIteration(
  root: string,
  manifestFile: string,
  modules: readonly KovoAppShellCompiledClientModule[],
  iteration: number,
): Promise<void> {
  const config = await resolveConfig(
    {
      appType: 'custom',
      configFile: false,
      logLevel: 'error',
      root: repoRoot,
      server: { hmr: false },
      ssr: { noExternal: [/^@kovojs\//] },
    },
    'serve',
  );
  const environment = createRunnableDevEnvironment('ssr', config, {
    hot: false,
    runnerOptions: { hmr: false, sourcemapInterceptor: false },
  });
  await environment.init();
  const lifetime = captureBuildTimeViteRunnableLifetime(environment);

  try {
    const buildModule = (await lifetime.ssrLoadModule(serverInternalBuildUrl)) as unknown as {
      claimCompilerClientModuleBuildInstaller(protocol: string): CompilerClientModuleBuildInstaller;
      resolveKovoAppToken(value: unknown, consumer: string): KovoApp;
      writeKovoNeutralBuild: typeof import('@kovojs/server/internal/build').writeKovoNeutralBuild;
    };
    const installer = buildModule.claimCompilerClientModuleBuildInstaller(
      compilerViteClientModuleRoleProtocol,
    );
    expect(() =>
      buildModule.claimCompilerClientModuleBuildInstaller(compilerViteClientModuleRoleProtocol),
    ).toThrow(/already claimed/u);

    // The claim happens before the app constructor is loaded, matching loadBuildAppModule().
    const fixtureModule = (await lifetime.ssrLoadModule(serverFixtureAppUrl)) as unknown as {
      createApp(): unknown;
    };
    const createRuntimeApp = (): KovoApp =>
      buildModule.resolveKovoAppToken(
        fixtureModule.createApp(),
        'CLI neutral-build provenance fixture',
      );

    await expect(
      buildModule.writeKovoNeutralBuild({
        app: createRuntimeApp(),
        clientModules: modules,
        manifestFile,
        outDir: join(root, `unadopted-${iteration}`),
      }),
    ).rejects.toThrow(/unproven compiler-generated client-module path/u);

    const adopted = adoptExactCompilerModules(modules, installer);
    installer.seal();
    expect(() => installer.adoptComponentClient(modules[0]!)).toThrow(/already sealed/u);

    const build = await buildModule.writeKovoNeutralBuild({
      app: createRuntimeApp(),
      clientModules: adopted,
      manifestFile,
      outDir: join(root, `accepted-${iteration}`),
    });
    const builtLogicalPaths = new Set(
      build.clientModules.map(
        (module) => parseVersionedClientModuleTarget(module.path)?.path ?? module.path,
      ),
    );
    for (const module of modules) {
      expect(builtLogicalPaths).toContain(module.path);
    }
    const neutralManifest = JSON.parse(readFileSync(build.manifestPath, 'utf8')) as {
      clientModules: readonly { path: string }[];
    };
    const manifestLogicalPaths = new Set(
      neutralManifest.clientModules.map(
        (module) => parseVersionedClientModuleTarget(module.path)?.path ?? module.path,
      ),
    );
    expect(manifestLogicalPaths).toContain('/c/generated/app.client.js');
    expect(manifestLogicalPaths).toContain('/c/kovo-generated-app-runtime.client.js');

    await expect(
      buildModule.writeKovoNeutralBuild({
        app: createRuntimeApp(),
        clientModules: adopted.map((module) => ({ ...module })),
        manifestFile,
        outDir: join(root, `lookalike-${iteration}`),
      }),
    ).rejects.toThrow(/unproven compiler-generated client-module path/u);
  } finally {
    await lifetime.close();
  }
}

function adoptExactCompilerModules(
  modules: readonly KovoAppShellCompiledClientModule[],
  installer: CompilerClientModuleBuildInstaller,
): KovoAppShellCompiledClientModule[] {
  const roles: CompilerOwnedViteClientModuleRole[] = [];
  for (const module of modules) {
    const role = compilerOwnedViteClientModuleRole(module);
    if (role === undefined) throw new TypeError('Expected an exact native compiler record.');
    roles.push(role);
  }
  return modules.map((module, index) => {
    const role = roles[index]!;
    switch (role) {
      case 'app-bootstrap':
        return installer.adoptAppBootstrap(module);
      case 'component-client':
        return installer.adoptComponentClient(module);
      case 'deferred-app-runtime':
        return installer.adoptDeferredAppRuntime(module);
      case 'optimistic-plan':
        return installer.adoptOptimisticPlan(module);
      default:
        return assertUnknownRole(role);
    }
  });
}

async function compilerModulesWithEveryRole(): Promise<
  readonly KovoAppShellCompiledClientModule[]
> {
  const optimisticFileName = 'src/optimistic-mutations.ts';
  const optimisticSource = [
    '// @kovojs-ir',
    'export const kovoOptimisticMutationPlans = Object.freeze({',
    "  'cart/add': Object.freeze({ schema: 'kovo.optimistic-plan/v1' }),",
    '});',
    '',
  ].join('\n');
  const optimisticHref = clientModuleHrefForSourceFile(
    optimisticFileName,
    clientModuleRepresentationDigest(optimisticSource),
  );
  const optimisticTarget = parseVersionedClientModuleTarget(optimisticHref);
  if (optimisticTarget === null) throw new Error('Expected an optimistic client-module target.');
  const plugin = kovoVitePlugin({
    include: ['src'],
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
          fileName: optimisticFileName,
          href: optimisticHref,
          mutationKeys: ['cart/add'],
          path: optimisticTarget.path,
          source: optimisticSource,
        },
      ],
    },
  });
  await plugin.transform("export const marker = 'server-only';\n", optimisticFileName);
  await plugin.transform(
    `
import { component } from '@kovojs/core';
export const ProvenanceCard = component({
  queries: { deals: {} },
  state: () => ({ count: 0 }),
  render: ({ deals }) => (
    <button onClick={() => { state.count += 1; }}>{deals.length}</button>
  ),
});
`,
    'src/provenance-card.tsx',
  );
  return plugin.getClientModules?.() ?? [];
}

function assertUnknownRole(role: never): never {
  throw new TypeError(`Unexpected compiler role: ${String(role)}`);
}
